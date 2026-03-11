import { describe, test, expect, afterEach } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createSandbox, type Sandbox } from './helpers/sandbox'

const FIXTURES = join(import.meta.dir, '../fixtures')
const loadEvent = (name: string) => readFileSync(join(FIXTURES, 'events', name), 'utf8')

let sandbox: Sandbox

afterEach(() => {
  sandbox?.cleanup()
})

describe('timeout advanced', () => {
  test('1. timeout during beforeHook phase — blocked', () => {
    sandbox = createSandbox()
    sandbox.writeHook('before-hang.ts', `
export const hook = {
  meta: { name: "before-hang" },
  async beforeHook() {
    // Hang forever in beforeHook
    await new Promise(() => {})
  },
  PreToolUse() {
    return { result: "allow" as const }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
config:
  timeout: 200
before-hang: {}
`)

    const stdin = loadEvent('pre-tool-use-bash.json')
    const result = sandbox.run([], { stdin, timeout: 5000 })

    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    // Timeout during lifecycle → block (fail-closed default)
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
    const combined = result.stderr + (output.systemMessage ?? '') + (output.hookSpecificOutput?.permissionDecisionReason ?? '')
    expect(combined).toContain('timed out')
  })

  test('2. timeout during afterHook phase — blocked', () => {
    sandbox = createSandbox()
    sandbox.writeHook('after-hang.ts', `
export const hook = {
  meta: { name: "after-hang" },
  async afterHook() {
    // Hang forever in afterHook
    await new Promise(() => {})
  },
  PreToolUse() {
    return { result: "allow" as const }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
config:
  timeout: 200
after-hang: {}
`)

    const stdin = loadEvent('pre-tool-use-bash.json')
    const result = sandbox.run([], { stdin, timeout: 5000 })

    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    // Timeout during afterHook lifecycle → block (fail-closed default)
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
    const combined = result.stderr + (output.systemMessage ?? '') + (output.hookSpecificOutput?.permissionDecisionReason ?? '')
    expect(combined).toContain('timed out')
  })

  test('3. near-miss timing (hook completes just under timeout) — success', () => {
    sandbox = createSandbox()
    // Hook sleeps for 100ms with a 500ms timeout — generous margin to avoid flakiness
    sandbox.writeHook('near-miss.ts', `
export const hook = {
  meta: { name: "near-miss" },
  async PreToolUse() {
    await new Promise(resolve => setTimeout(resolve, 100))
    return { result: "allow" as const, injectContext: "completed-in-time" }
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
config:
  timeout: 500
near-miss: {}
`)

    const stdin = loadEvent('pre-tool-use-bash.json')
    const result = sandbox.run([], { stdin, timeout: 5000 })

    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    // Should succeed — hook completed before timeout
    expect(output.hookSpecificOutput.permissionDecision).toBe('allow')
    expect(output.hookSpecificOutput.additionalContext).toContain('completed-in-time')
  })

  test('4. timeout with onError:continue — timed-out hook does not block', () => {
    sandbox = createSandbox()
    sandbox.writeHook('hang-continue.ts', `
export const hook = {
  meta: { name: "hang-continue" },
  PreToolUse() {
    return new Promise(() => {})  // never resolves
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
config:
  timeout: 200
hang-continue:
  onError: continue
`)

    const stdin = loadEvent('pre-tool-use-bash.json')
    const result = sandbox.run([], { stdin, timeout: 5000 })

    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    // onError:continue — timeout is swallowed, action NOT blocked
    expect(output.hookSpecificOutput?.permissionDecision).toBeUndefined()
    // systemMessage should contain the diagnostic about the timeout
    expect(output.systemMessage).toContain('timed out')
    expect(output.systemMessage).toContain('Continuing')
  })

  test('5. timeout with onError:trace on injectable event — trace message in additionalContext', () => {
    sandbox = createSandbox()
    sandbox.writeHook('hang-trace.ts', `
export const hook = {
  meta: { name: "hang-trace" },
  PreToolUse() {
    return new Promise(() => {})  // never resolves
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
config:
  timeout: 200
hang-trace:
  onError: trace
`)

    const stdin = loadEvent('pre-tool-use-bash.json')
    const result = sandbox.run([], { stdin, timeout: 5000 })

    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    // onError:trace on injectable event — error injected into additionalContext.
    // The engine creates a synthetic "allow" result with the trace in additionalContext.
    expect(output.hookSpecificOutput.permissionDecision).toBe('allow')
    // additionalContext should contain trace message about the timeout
    expect(output.hookSpecificOutput.additionalContext).toContain('timed out')
    expect(output.hookSpecificOutput.additionalContext).toContain('onError: trace')
  })

  test('6. timeout increments circuit breaker failure counter — degradation after threshold', () => {
    sandbox = createSandbox()
    sandbox.writeHook('hang-breaker.ts', `
export const hook = {
  meta: { name: "hang-breaker" },
  PreToolUse() {
    return new Promise(() => {})  // never resolves
  },
}
`)
    sandbox.writeConfig(`
version: "1.0.0"
config:
  timeout: 200
hang-breaker:
  maxFailures: 2
`)

    const stdin = loadEvent('pre-tool-use-bash.json')

    // Invocation 1: timeout → block (count 1 < 2)
    const r1 = sandbox.run([], { stdin, timeout: 5000 })
    expect(r1.exitCode).toBe(0)
    expect(JSON.parse(r1.stdout).hookSpecificOutput.permissionDecision).toBe('deny')

    // Invocation 2: timeout → degraded (count 2 == 2)
    const r2 = sandbox.run([], { stdin, timeout: 5000 })
    expect(r2.exitCode).toBe(0)
    const o2 = JSON.parse(r2.stdout)
    // Hook degraded — should see "will be skipped" message
    expect(o2.hookSpecificOutput.additionalContext).toContain('will be skipped')
    // Should NOT be blocked
    expect(o2.hookSpecificOutput.permissionDecision).not.toBe('deny')
  })
})
