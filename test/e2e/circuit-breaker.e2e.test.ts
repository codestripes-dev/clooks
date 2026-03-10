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

describe('circuit breaker', () => {
  test('hook reaches maxFailures and enters degraded mode', () => {
    sandbox = createSandbox()
    sandbox.writeHook('crash-on-run.ts', loadHook('crash-on-run.ts'))
    sandbox.writeConfig(`
version: "1.0.0"
crash-on-run:
  path: .clooks/hooks/crash-on-run.ts
  maxFailures: 2
`)

    const stdin = loadEvent('pre-tool-use-bash.json')

    // Invocation 1: crash → failure count 1 < 2 → block
    const r1 = sandbox.run([], { stdin })
    expect(r1.exitCode).toBe(0)
    const o1 = JSON.parse(r1.stdout)
    expect(o1.hookSpecificOutput.permissionDecision).toBe('deny')

    // Invocation 2: crash → failure count 2 == threshold → degraded (skipped)
    const r2 = sandbox.run([], { stdin })
    expect(r2.exitCode).toBe(0)
    const o2 = JSON.parse(r2.stdout)
    // Degraded mode: hook is disabled, not blocking. additionalContext contains degraded notice.
    expect(o2.hookSpecificOutput.additionalContext).toContain('will be skipped')

    // Invocation 3: still degraded → not blocked
    const r3 = sandbox.run([], { stdin })
    expect(r3.exitCode).toBe(0)
    const o3 = JSON.parse(r3.stdout)
    expect(o3.hookSpecificOutput.permissionDecision).not.toBe('deny')
    expect(o3.hookSpecificOutput.additionalContext).toContain('will be skipped')
  })

  test('recovery from failure resets counter', () => {
    sandbox = createSandbox()
    sandbox.writeHook('crash-on-run.ts', loadHook('crash-on-run.ts'))
    sandbox.writeConfig(`
version: "1.0.0"
crash-on-run:
  path: .clooks/hooks/crash-on-run.ts
  maxFailures: 3
`)

    const stdin = loadEvent('pre-tool-use-bash.json')

    // Invocation 1: crash → failure count 1, blocked
    const r1 = sandbox.run([], { stdin })
    expect(r1.exitCode).toBe(0)
    const o1 = JSON.parse(r1.stdout)
    expect(o1.hookSpecificOutput.permissionDecision).toBe('deny')

    // Replace crash-on-run with a working allow-all hook (same meta.name)
    sandbox.writeHook('crash-on-run.ts', `
export const hook = {
  meta: { name: "crash-on-run" },
  PreToolUse() {
    return { result: "allow" as const }
  },
}
`)

    // Invocation 2: hook works → failure counter resets
    const r2 = sandbox.run([], { stdin })
    expect(r2.exitCode).toBe(0)
    const o2 = JSON.parse(r2.stdout)
    expect(o2.hookSpecificOutput.permissionDecision).toBe('allow')
  })

  test('maxFailures: 0 disables circuit breaker — always blocks', () => {
    sandbox = createSandbox()
    sandbox.writeHook('crash-on-run.ts', loadHook('crash-on-run.ts'))
    sandbox.writeConfig(`
version: "1.0.0"
crash-on-run:
  path: .clooks/hooks/crash-on-run.ts
  maxFailures: 0
`)

    const stdin = loadEvent('pre-tool-use-bash.json')

    // Every invocation should block (never degraded)
    for (let i = 0; i < 5; i++) {
      const r = sandbox.run([], { stdin })
      expect(r.exitCode).toBe(0)
      const o = JSON.parse(r.stdout)
      expect(o.hookSpecificOutput.permissionDecision).toBe('deny')
    }
  })

  test('.clooks/.failures file lifecycle', () => {
    sandbox = createSandbox()
    sandbox.writeHook('crash-on-run.ts', loadHook('crash-on-run.ts'))
    sandbox.writeConfig(`
version: "1.0.0"
crash-on-run:
  path: .clooks/hooks/crash-on-run.ts
  maxFailures: 3
`)

    const stdin = loadEvent('pre-tool-use-bash.json')

    // Invocation 1: crash → .failures file should be created
    sandbox.run([], { stdin })
    expect(sandbox.fileExists('.clooks/.failures')).toBe(true)

    // Replace with working hook
    sandbox.writeHook('crash-on-run.ts', `
export const hook = {
  meta: { name: "crash-on-run" },
  PreToolUse() {
    return { result: "allow" as const }
  },
}
`)

    // Invocation 2: success → failure entry cleared, .failures removed (empty state)
    sandbox.run([], { stdin })
    // When failure state is empty, writeFailures deletes the file
    expect(sandbox.fileExists('.clooks/.failures')).toBe(false)
  })

  test('load-error circuit breaker — missing hook file', () => {
    sandbox = createSandbox()
    // Register a hook pointing to a nonexistent file
    sandbox.writeConfig(`
version: "1.0.0"
missing-hook:
  path: .clooks/hooks/does-not-exist.ts
  maxFailures: 2
`)

    const stdin = loadEvent('pre-tool-use-bash.json')

    // Invocation 1: import fails → block
    const r1 = sandbox.run([], { stdin })
    expect(r1.exitCode).toBe(0)
    const o1 = JSON.parse(r1.stdout)
    expect(o1.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(o1.systemMessage).toContain('failed to load')

    // Invocation 2: import fails again → degraded (disabled)
    const r2 = sandbox.run([], { stdin })
    expect(r2.exitCode).toBe(0)
    const o2 = JSON.parse(r2.stdout)
    expect(o2.systemMessage).toContain('has been disabled')
  })
})
