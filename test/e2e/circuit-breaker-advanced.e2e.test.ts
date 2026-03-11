import { describe, test, expect, afterEach } from 'bun:test'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import { createSandbox, type Sandbox } from './helpers/sandbox'

const FIXTURES = join(import.meta.dir, '../fixtures')
const loadHook = (name: string) => readFileSync(join(FIXTURES, 'hooks', name), 'utf8')
const loadEvent = (name: string) => readFileSync(join(FIXTURES, 'events', name), 'utf8')

let sandbox: Sandbox

afterEach(() => {
  sandbox?.cleanup()
})

describe('circuit breaker advanced', () => {
  test('1. corrupted .failures file (invalid JSON) — silently reset, stderr warning', () => {
    sandbox = createSandbox()
    sandbox.writeHook('crash-on-run.ts', loadHook('crash-on-run.ts'))
    sandbox.writeConfig(`
version: "1.0.0"
crash-on-run:
  maxFailures: 3
`)

    // Write garbage to .failures
    sandbox.writeFile('.clooks/.failures', '{not valid json!!!')

    const stdin = loadEvent('pre-tool-use-bash.json')
    const result = sandbox.run([], { stdin })

    // Engine should warn about malformed failures and reset
    expect(result.stderr).toContain('malformed')

    // Hook still runs (crashes → block, proving the engine didn't die)
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
  })

  test('2. .failures is valid JSON but not a plain object (array) — silently reset', () => {
    sandbox = createSandbox()
    sandbox.writeHook('crash-on-run.ts', loadHook('crash-on-run.ts'))
    sandbox.writeConfig(`
version: "1.0.0"
crash-on-run:
  maxFailures: 3
`)

    // Write a JSON array to .failures
    sandbox.writeFile('.clooks/.failures', '[]')

    const stdin = loadEvent('pre-tool-use-bash.json')
    const result = sandbox.run([], { stdin })

    // Engine should warn about malformed failures
    expect(result.stderr).toContain('malformed')

    // Hook still runs (crashes → block)
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
  })

  test('3. maxFailures changed between invocations (config edited mid-stream) — new threshold applies', () => {
    sandbox = createSandbox()
    sandbox.writeHook('crash-on-run.ts', loadHook('crash-on-run.ts'))
    sandbox.writeConfig(`
version: "1.0.0"
crash-on-run:
  maxFailures: 5
`)

    const stdin = loadEvent('pre-tool-use-bash.json')

    // Invocations 1-2: crash → failure count grows (under threshold of 5)
    sandbox.run([], { stdin })
    sandbox.run([], { stdin })

    // Now change the threshold to 2 (below current count of 2)
    sandbox.writeConfig(`
version: "1.0.0"
crash-on-run:
  maxFailures: 2
`)

    // Invocation 3: new threshold applies — count is already at 2, so it should be at or above threshold
    // The engine records failure FIRST (incrementing to 3), then checks threshold (2).
    // Since 3 >= 2, it degrades.
    const r3 = sandbox.run([], { stdin })
    expect(r3.exitCode).toBe(0)
    const o3 = JSON.parse(r3.stdout)
    // Should be degraded (not blocked)
    expect(o3.hookSpecificOutput?.additionalContext ?? '').toContain('will be skipped')
  })

  test('4. recovery from degraded mode (count >= maxFailures, then fixed) — counter clears', () => {
    sandbox = createSandbox()
    sandbox.writeHook('crash-on-run.ts', loadHook('crash-on-run.ts'))
    sandbox.writeConfig(`
version: "1.0.0"
crash-on-run:
  maxFailures: 2
`)

    const stdin = loadEvent('pre-tool-use-bash.json')

    // Invocation 1: crash → block (count 1 < 2)
    const r1 = sandbox.run([], { stdin })
    expect(r1.exitCode).toBe(0)
    expect(JSON.parse(r1.stdout).hookSpecificOutput.permissionDecision).toBe('deny')

    // Invocation 2: crash → degraded (count 2 == 2)
    const r2 = sandbox.run([], { stdin })
    expect(r2.exitCode).toBe(0)
    const o2 = JSON.parse(r2.stdout)
    expect(o2.hookSpecificOutput?.additionalContext ?? '').toContain('will be skipped')

    // Replace with working hook
    sandbox.writeHook('crash-on-run.ts', `
export const hook = {
  meta: { name: "crash-on-run" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "recovered" }
  },
}
`)

    // Invocation 3: hook works → counter clears
    const r3 = sandbox.run([], { stdin })
    expect(r3.exitCode).toBe(0)
    const o3 = JSON.parse(r3.stdout)
    expect(o3.hookSpecificOutput.permissionDecision).toBe('allow')
    expect(o3.hookSpecificOutput.additionalContext).toContain('recovered')

    // Put the crashing hook back and verify counter starts from 0
    sandbox.writeHook('crash-on-run.ts', loadHook('crash-on-run.ts'))

    // Invocation 4: crash → block (count 1 < 2, proving counter was cleared)
    const r4 = sandbox.run([], { stdin })
    expect(r4.exitCode).toBe(0)
    expect(JSON.parse(r4.stdout).hookSpecificOutput.permissionDecision).toBe('deny')
  })

  test('5. load error circuit breaker: 3rd invocation after degradation — still degraded, no crash', () => {
    sandbox = createSandbox()
    // Register a hook pointing to a nonexistent file
    sandbox.writeConfig(`
version: "1.0.0"
missing-hook:
  uses: ./.clooks/hooks/does-not-exist.ts
  maxFailures: 2
`)

    const stdin = loadEvent('pre-tool-use-bash.json')

    // Invocation 1: load error → block (count 1 < 2)
    const r1 = sandbox.run([], { stdin })
    expect(r1.exitCode).toBe(0)
    expect(JSON.parse(r1.stdout).hookSpecificOutput.permissionDecision).toBe('deny')

    // Invocation 2: load error → degraded (count 2 == 2)
    const r2 = sandbox.run([], { stdin })
    expect(r2.exitCode).toBe(0)
    expect(JSON.parse(r2.stdout).systemMessage).toContain('has been disabled')

    // Invocation 3: still degraded — should NOT crash, should still show degraded message
    const r3 = sandbox.run([], { stdin })
    expect(r3.exitCode).toBe(0)
    const o3 = JSON.parse(r3.stdout)
    // Hook is degraded and skipped. Should see the degraded "will be skipped" message.
    const combined = (o3.hookSpecificOutput?.additionalContext ?? '') + (o3.systemMessage ?? '')
    expect(combined).toContain('will be skipped')

    // Invocation 4: same — stable degraded state
    const r4 = sandbox.run([], { stdin })
    expect(r4.exitCode).toBe(0)
    const o4 = JSON.parse(r4.stdout)
    const combined4 = (o4.hookSpecificOutput?.additionalContext ?? '') + (o4.systemMessage ?? '')
    expect(combined4).toContain('will be skipped')
  })

  test('6. load error + runtime error use separate counters (LOAD_ERROR_EVENT vs event name)', () => {
    sandbox = createSandbox()

    // Create a hook that loads successfully but crashes at runtime
    sandbox.writeHook('runtime-crash.ts', `
export const hook = {
  meta: { name: "runtime-crash" },
  PreToolUse() {
    throw new Error("runtime boom")
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
runtime-crash:
  maxFailures: 3
`)

    const stdin = loadEvent('pre-tool-use-bash.json')

    // Invocation 1: runtime crash → block (PreToolUse counter = 1)
    const r1 = sandbox.run([], { stdin })
    expect(r1.exitCode).toBe(0)
    expect(JSON.parse(r1.stdout).hookSpecificOutput.permissionDecision).toBe('deny')

    // Read the .failures file to verify counter key is "PreToolUse", not "__load__"
    const failures1 = JSON.parse(sandbox.readFile('.clooks/.failures'))
    expect(failures1['runtime-crash']).toBeDefined()
    expect(failures1['runtime-crash']['PreToolUse']).toBeDefined()
    expect(failures1['runtime-crash']['PreToolUse'].consecutiveFailures).toBe(1)
    expect(failures1['runtime-crash']['__load__']).toBeUndefined()

    // Now break the hook file to cause a load error
    sandbox.writeHook('runtime-crash.ts', 'this is not valid typescript export')

    // Invocation 2: load error → block (__load__ counter = 1)
    const r2 = sandbox.run([], { stdin })
    expect(r2.exitCode).toBe(0)
    expect(JSON.parse(r2.stdout).hookSpecificOutput.permissionDecision).toBe('deny')

    // Read .failures: should have BOTH __load__ and PreToolUse counters
    const failures2 = JSON.parse(sandbox.readFile('.clooks/.failures'))
    expect(failures2['runtime-crash']['__load__']).toBeDefined()
    expect(failures2['runtime-crash']['__load__'].consecutiveFailures).toBe(1)
    // The PreToolUse counter should still be present (it's per-event, not cleared by load error)
    expect(failures2['runtime-crash']['PreToolUse'].consecutiveFailures).toBe(1)
  })

  test('7. parallel hook driven to degradation through repeated invocations', () => {
    sandbox = createSandbox()

    sandbox.writeHook('parallel-crash.ts', `
export const hook = {
  meta: { name: "parallel-crash" },
  PreToolUse() {
    throw new Error("parallel crash")
  },
}
`)
    sandbox.writeHook('allow-all.ts', loadHook('allow-all.ts'))
    sandbox.writeConfig(`
version: "1.0.0"
parallel-crash:
  parallel: true
  maxFailures: 2
allow-all:
  parallel: true
`)

    const stdin = loadEvent('pre-tool-use-bash.json')

    // Invocation 1: parallel-crash throws → block (count 1 < 2)
    const r1 = sandbox.run([], { stdin })
    expect(r1.exitCode).toBe(0)
    const o1 = JSON.parse(r1.stdout)
    expect(o1.hookSpecificOutput.permissionDecision).toBe('deny')

    // Invocation 2: parallel-crash throws again → degraded (count 2 == 2)
    const r2 = sandbox.run([], { stdin })
    expect(r2.exitCode).toBe(0)
    const o2 = JSON.parse(r2.stdout)
    // Should see degraded message and allow-all should still run
    expect(o2.hookSpecificOutput.permissionDecision).toBe('allow')
    expect(o2.hookSpecificOutput.additionalContext).toContain('will be skipped')
  })

  test('8. failure path switches when project config added (home-only → project)', () => {
    sandbox = createSandbox()

    // Start with home-only config
    sandbox.writeHomeHook('crash-hook.ts', `
export const hook = {
  meta: { name: "crash-hook" },
  PreToolUse() {
    throw new Error("home crash")
  },
}
`)
    sandbox.writeHomeConfig(`
version: "1.0.0"
crash-hook:
  maxFailures: 5
`)

    const stdin = loadEvent('pre-tool-use-bash.json')

    // Invocation 1: crash → block. Failures stored at hash-based path
    const r1 = sandbox.run([], { stdin })
    expect(r1.exitCode).toBe(0)
    expect(JSON.parse(r1.stdout).hookSpecificOutput.permissionDecision).toBe('deny')

    // Verify failure is at hash-based path
    const hash = createHash('sha256').update(sandbox.dir).digest('hex').slice(0, 12)
    const hashPath = join(sandbox.home, '.clooks/failures', `${hash}.json`)
    expect(existsSync(hashPath)).toBe(true)

    // Now add a project config — this shadows the home hook
    sandbox.writeHook('crash-hook.ts', `
export const hook = {
  meta: { name: "crash-hook" },
  PreToolUse() {
    throw new Error("project crash")
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
crash-hook:
  maxFailures: 5
`)

    // Invocation 2: now project config exists, failures go to .clooks/.failures
    const r2 = sandbox.run([], { stdin })
    expect(r2.exitCode).toBe(0)
    expect(JSON.parse(r2.stdout).hookSpecificOutput.permissionDecision).toBe('deny')

    // Verify failure is now at project path
    expect(sandbox.fileExists('.clooks/.failures')).toBe(true)

    // The hash-based file is now orphaned (still exists from before)
    expect(existsSync(hashPath)).toBe(true)
  })

  test('9. load error uses single __load__ counter across different events — no per-event multiplication', () => {
    sandbox = createSandbox()
    // Register a hook pointing to a nonexistent file
    sandbox.writeConfig(`
version: "1.0.0"
missing-hook:
  uses: ./.clooks/hooks/does-not-exist.ts
  maxFailures: 3
`)

    // Invocation 1: PreToolUse event → load error → block (count 1 < 3)
    const r1 = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(r1.exitCode).toBe(0)
    const o1 = JSON.parse(r1.stdout)
    expect(o1.hookSpecificOutput.permissionDecision).toBe('deny')

    // Verify __load__ counter is 1
    const failures1 = JSON.parse(sandbox.readFile('.clooks/.failures'))
    expect(failures1['missing-hook']['__load__'].consecutiveFailures).toBe(1)

    // Invocation 2: PostToolUse event (different event!) → load error → block (count 2 < 3)
    const r2 = sandbox.run([], { stdin: loadEvent('post-tool-use.json') })
    expect(r2.exitCode).toBe(0)

    // Verify __load__ counter incremented to 2 (not starting fresh for PostToolUse)
    const failures2 = JSON.parse(sandbox.readFile('.clooks/.failures'))
    expect(failures2['missing-hook']['__load__'].consecutiveFailures).toBe(2)
    // No per-event counter should exist — only __load__
    expect(failures2['missing-hook']['PostToolUse']).toBeUndefined()
    expect(failures2['missing-hook']['PreToolUse']).toBeUndefined()

    // Invocation 3: Notification event (yet another event!) → load error → degraded (count 3 == 3)
    const r3 = sandbox.run([], { stdin: loadEvent('notification.json') })
    expect(r3.exitCode).toBe(0)

    // Verify __load__ counter is 3 and hook is degraded
    const failures3 = JSON.parse(sandbox.readFile('.clooks/.failures'))
    expect(failures3['missing-hook']['__load__'].consecutiveFailures).toBe(3)

    // Invocation 4: back to PreToolUse — hook should still be degraded, not blocking
    const r4 = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(r4.exitCode).toBe(0)
    const o4 = JSON.parse(r4.stdout)
    // Should NOT be blocked (deny) — should be degraded (hook skipped)
    expect(o4.hookSpecificOutput?.permissionDecision).not.toBe('deny')
  })
})
