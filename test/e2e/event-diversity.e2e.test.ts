import { describe, test, expect, afterEach } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createSandbox, type Sandbox } from './helpers/sandbox'

const FIXTURES = join(import.meta.dir, '../fixtures')
const loadHook = (name: string) => readFileSync(join(FIXTURES, 'hooks', name), 'utf8')
const loadEvent = (name: string) => readFileSync(join(FIXTURES, 'events', name), 'utf8')

let sandbox: Sandbox

afterEach(() => {
  sandbox?.cleanup()
})

describe('event diversity', () => {
  test('Scenario 15: TeammateIdle continue — exit 2 with feedback on stderr', () => {
    sandbox = createSandbox()
    sandbox.writeHook('continue-teammate.ts', loadHook('continue-teammate.ts'))
    sandbox.writeConfig(`
version: "1.0.0"
continue-teammate:
  path: .clooks/hooks/continue-teammate.ts
`)
    const result = sandbox.run([], { stdin: loadEvent('teammate-idle.json') })
    // Continuation "continue" result uses exit 2 + stderr for feedback
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('keep going')
    expect(result.stdout.trim()).toBe('')
  })

  test('Scenario 16: TeammateIdle stop — exit 0 with stop reason', () => {
    sandbox = createSandbox()
    sandbox.writeHook('stop-teammate.ts', `
export const hook = {
  meta: { name: "stop-teammate" },
  TeammateIdle() {
    return { result: "stop" as const, reason: "test complete" }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
stop-teammate:
  path: .clooks/hooks/stop-teammate.ts
`)
    const result = sandbox.run([], { stdin: loadEvent('teammate-idle.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.continue).toBe(false)
    expect(output.stopReason).toBe('test complete')
  })

  test('Scenario 17: SessionStart with shadow warning in systemMessage', () => {
    sandbox = createSandbox()
    // Write the same hook name in both home and project configs
    const hookContent = `
export const hook = {
  meta: { name: "shared-hook" },
  SessionStart() {
    return { result: "skip" as const }
  },
}
`
    sandbox.writeHook('shared-hook.ts', hookContent)
    sandbox.writeConfig(`
version: "1.0.0"
shared-hook:
  path: .clooks/hooks/shared-hook.ts
`)
    sandbox.writeHomeHook('shared-hook.ts', hookContent)
    sandbox.writeHomeConfig(`
version: "1.0.0"
shared-hook:
  path: .clooks/hooks/shared-hook.ts
`)
    const result = sandbox.run([], { stdin: loadEvent('session-start.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.systemMessage).toContain(
      'clooks: project hook "shared-hook" is shadowing a global hook with the same name.'
    )
  })

  test('Scenario 18: WorktreeCreate success returns path on stdout', () => {
    sandbox = createSandbox()
    sandbox.writeHook('worktree-success.ts', loadHook('worktree-success.ts'))
    sandbox.writeConfig(`
version: "1.0.0"
worktree-success:
  path: .clooks/hooks/worktree-success.ts
`)
    const result = sandbox.run([], { stdin: loadEvent('worktree-create.json') })
    expect(result.exitCode).toBe(0)
    // WorktreeCreate success returns raw path string, not JSON
    expect(result.stdout.trim()).toBe('/tmp/worktree-123')
  })

  test('Scenario 19: WorktreeCreate failure returns exit 1', () => {
    sandbox = createSandbox()
    sandbox.writeHook('worktree-fail.ts', `
export const hook = {
  meta: { name: "worktree-fail" },
  WorktreeCreate() {
    return { result: "failure" as const, reason: "disk full" }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
worktree-fail:
  path: .clooks/hooks/worktree-fail.ts
`)
    const result = sandbox.run([], { stdin: loadEvent('worktree-create.json') })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('disk full')
  })

  test('Scenario 25: non-injectable observe event block path uses systemMessage', () => {
    sandbox = createSandbox()
    // SessionEnd is a non-injectable observe event.
    // With onError: block, a crash produces a block result which
    // translateResult surfaces via systemMessage (not additionalContext).
    sandbox.writeHook('crash-session-end.ts', `
export const hook = {
  meta: { name: "crash-session-end" },
  SessionEnd() {
    throw new Error("session end crash")
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
crash-session-end:
  path: .clooks/hooks/crash-session-end.ts
  onError: block
`)
    const result = sandbox.run([], { stdin: loadEvent('session-end.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    // Non-injectable observe event with block result outputs systemMessage
    expect(output.systemMessage).toBeDefined()
    expect(output.systemMessage).toContain('crash-session-end')
    // Should NOT have hookSpecificOutput with additionalContext
    expect(output.hookSpecificOutput).toBeUndefined()
  })
})
