import { describe, test, expect, afterEach } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createSandbox, type Sandbox } from './helpers/sandbox'

const FIXTURES = join(import.meta.dir, '../fixtures')
const loadEvent = (name: string) => readFileSync(join(FIXTURES, 'events', name), 'utf8')
const CLOOKS_BIN = join(import.meta.dir, '../../dist/clooks')

let sandbox: Sandbox

afterEach(() => {
  sandbox?.cleanup()
})

describe('hook adversarial', () => {
  test('1. process.exit(0) bypasses fail-closed — known limitation', () => {
    sandbox = createSandbox()
    sandbox.writeHook('exit-zero.ts', `
export const hook = {
  meta: { name: "exit-zero" },
  PreToolUse() {
    process.exit(0)
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
exit-zero:
  path: .clooks/hooks/exit-zero.ts
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    // Known limitation: process.exit(0) kills the process before the engine
    // can produce output. The subprocess exits 0 with empty stdout.
    // This bypasses the fail-closed model — there's no way to recover
    // from a hook that calls process.exit() in the same process.
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('')
  })

  test('2. stdout.write corrupts JSON output', () => {
    sandbox = createSandbox()
    sandbox.writeHook('stdout-write.ts', `
export const hook = {
  meta: { name: "stdout-write" },
  PreToolUse() {
    process.stdout.write("garbage")
    return { result: "allow" as const }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
stdout-write:
  path: .clooks/hooks/stdout-write.ts
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    // The hook writes "garbage" to stdout before the engine writes JSON.
    // This corrupts the output — the combined stdout is not valid JSON.
    // Document as known limitation: hooks must not write to stdout directly.
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('garbage')
    // The stdout starts with "garbage" so parsing as JSON will fail
    let parseSucceeded = false
    try {
      JSON.parse(result.stdout)
      parseSucceeded = true
    } catch {
      // Expected: stdout is corrupted
    }
    // It may or may not parse depending on whether "garbage" appears as prefix
    // to valid JSON. The key assertion is that stdout contains the garbage.
    if (!parseSucceeded) {
      expect(result.stdout.startsWith('garbage')).toBe(true)
    }
  })

  test('3. infinite sync loop — only subprocess timeout can kill it', async () => {
    sandbox = createSandbox()
    sandbox.writeHook('sync-loop.ts', `
export const hook = {
  meta: { name: "sync-loop" },
  PreToolUse() {
    while (true) {}
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
sync-loop:
  path: .clooks/hooks/sync-loop.ts
`)
    // The engine's Promise.race timeout cannot interrupt synchronous code.
    // Bun.spawnSync timeout sends SIGTERM which can't interrupt a sync loop
    // in the same thread, so we use async Bun.spawn with manual SIGKILL.
    const proc = Bun.spawn([CLOOKS_BIN], {
      cwd: sandbox.dir,
      stdin: Buffer.from(loadEvent('pre-tool-use-bash.json')),
      env: { HOME: sandbox.home, CLOOKS_HOME_ROOT: sandbox.home, PATH: '/usr/local/bin:/usr/bin:/bin' },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const killTimer = setTimeout(() => proc.kill(9), 3000)
    const exitCode = await proc.exited
    clearTimeout(killTimer)

    // Process killed by SIGKILL → exit code 137 (128 + 9) or null
    // The key assertion: the process did not exit cleanly.
    expect(exitCode).not.toBe(0)
  }, 10000)

  test('4. mutate context.toolInput without returning updatedInput — check mutation behavior', () => {
    sandbox = createSandbox()
    // First hook mutates context.toolInput in place without returning updatedInput
    sandbox.writeHook('mutate-context.ts', `
export const hook = {
  meta: { name: "mutate-context" },
  PreToolUse(ctx: Record<string, unknown>) {
    const toolInput = ctx.toolInput as Record<string, unknown>
    toolInput.command = "hacked"
    return { result: "allow" as const }
  },
}
`)
    // Second hook reads toolInput and reports what it sees via injectContext
    sandbox.writeHook('observer.ts', `
export const hook = {
  meta: { name: "observer" },
  PreToolUse(ctx: Record<string, unknown>) {
    const toolInput = ctx.toolInput as Record<string, unknown>
    return {
      result: "allow" as const,
      injectContext: "observed-command=" + String(toolInput.command),
    }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
mutate-context:
  path: .clooks/hooks/mutate-context.ts
observer:
  path: .clooks/hooks/observer.ts
PreToolUse:
  order: [mutate-context, observer]
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('allow')
    // The engine spreads normalized context via { ...normalized } but toolInput
    // is an object reference, so in-place mutation on toolInput.command WILL leak
    // to the next sequential hook (shallow copy, same reference).
    // No updatedInput is returned, so the final output should NOT have updatedInput.
    expect(output.hookSpecificOutput.updatedInput).toBeUndefined()
    // Document: the observer sees the mutated value because the engine
    // shallow-copies the context object, and toolInput is a shared reference.
    expect(output.hookSpecificOutput.additionalContext).toContain('observed-command=hacked')
  })

  test('5. hook exported as class instance — works if shape matches', () => {
    sandbox = createSandbox()
    sandbox.writeHook('class-hook.ts', `
class MyHook {
  meta = { name: "class-hook" }
  PreToolUse() {
    return { result: "allow" as const, injectContext: "class-hook-ran" }
  }
}
export const hook = new MyHook()
`)
    sandbox.writeConfig(`
version: "1.0.0"
class-hook:
  path: .clooks/hooks/class-hook.ts
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('allow')
    expect(output.hookSpecificOutput.additionalContext).toContain('class-hook-ran')
  })

  test('6. hook handler returns null — treated as skip', () => {
    sandbox = createSandbox()
    sandbox.writeHook('null-return.ts', `
export const hook = {
  meta: { name: "null-return" },
  PreToolUse() {
    return null
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
null-return:
  path: .clooks/hooks/null-return.ts
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    // null is treated as skip — no output
    expect(result.stdout.trim()).toBe('')
  })

  test('7. hook rejects with a plain string — engine handles gracefully', () => {
    sandbox = createSandbox()
    sandbox.writeHook('reject-string.ts', `
export const hook = {
  meta: { name: "reject-string" },
  PreToolUse() {
    throw "plain string error"
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
reject-string:
  path: .clooks/hooks/reject-string.ts
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    // Default onError is "block", so this should block with exit 0 (PreToolUse)
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
    // The diagnostic should contain the string error
    expect(output.hookSpecificOutput.permissionDecisionReason).toContain('plain string error')
  })

  test('8. hook rejects with null — engine handles gracefully', () => {
    sandbox = createSandbox()
    sandbox.writeHook('reject-null.ts', `
export const hook = {
  meta: { name: "reject-null" },
  PreToolUse() {
    throw null
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
reject-null:
  path: .clooks/hooks/reject-null.ts
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    // Default onError is "block", so this should block with exit 0 (PreToolUse)
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
    // The diagnostic should contain "null" string representation
    expect(output.hookSpecificOutput.permissionDecisionReason).toContain('null')
  })

  test('9. hook handler returns undefined — treated as skip', () => {
    sandbox = createSandbox()
    sandbox.writeHook('undef-return.ts', `
export const hook = {
  meta: { name: "undef-return" },
  PreToolUse() {
    return undefined
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
undef-return:
  path: .clooks/hooks/undef-return.ts
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    // undefined is treated as skip — no output
    expect(result.stdout.trim()).toBe('')
  })
})
