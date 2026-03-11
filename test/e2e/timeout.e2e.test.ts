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

describe('timeout', () => {
  test('hook exceeds global timeout and action is blocked', () => {
    sandbox = createSandbox()
    sandbox.writeHook('hang-forever.ts', loadHook('hang-forever.ts'))
    sandbox.writeConfig(`
version: "1.0.0"
config:
  timeout: 200
hang-forever: {}
`)

    const stdin = loadEvent('pre-tool-use-bash.json')

    // Safety net timeout for the subprocess itself (5s)
    const result = sandbox.run([], { stdin, timeout: 5000 })

    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    // Timeout causes fail-closed → block → deny
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
    // Stderr or systemMessage should mention timeout
    const combined = result.stderr + (output.systemMessage ?? '') + (output.hookSpecificOutput?.permissionDecisionReason ?? '')
    expect(combined).toContain('timed out')
  })

  test('per-hook timeout overrides global timeout', () => {
    sandbox = createSandbox()
    sandbox.writeHook('hang-forever.ts', loadHook('hang-forever.ts'))
    sandbox.writeConfig(`
version: "1.0.0"
config:
  timeout: 5000
hang-forever:
  timeout: 200
`)

    const stdin = loadEvent('pre-tool-use-bash.json')

    // If per-hook timeout works, this resolves in ~200ms, not 5000ms
    const start = Date.now()
    const result = sandbox.run([], { stdin, timeout: 5000 })
    const elapsed = Date.now() - start

    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny')

    // Should have timed out well before the global 5000ms timeout
    expect(elapsed).toBeLessThan(3000)

    const combined = result.stderr + (output.systemMessage ?? '') + (output.hookSpecificOutput?.permissionDecisionReason ?? '')
    expect(combined).toContain('timed out')
  })
})
