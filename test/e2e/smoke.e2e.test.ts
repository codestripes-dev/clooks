import { describe, test, expect, afterEach } from 'bun:test'
import { createSandbox, type Sandbox } from './helpers/sandbox'

let sandbox: Sandbox

afterEach(() => {
  sandbox?.cleanup()
})

describe('smoke: compiled binary', () => {
  test('--version prints version and exits 0', () => {
    sandbox = createSandbox()
    const result = sandbox.run(['--version'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toMatch(/^clooks \d+\.\d+\.\d+/)
  })

  test('engine mode with no config exits 0 (no hooks = noop)', () => {
    sandbox = createSandbox()
    const event = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } })
    const result = sandbox.run([], { stdin: event })
    expect(result.exitCode).toBe(0)
  })

  test('engine mode with a hook runs it and returns result', () => {
    sandbox = createSandbox()
    sandbox.writeHook('allow-all.ts', `
export const hook = {
  meta: { name: "allow-all" },
  PreToolUse() { return { result: "allow" } },
}
`)
    sandbox.writeConfig(`version: "1.0.0"
allow-all: {}
`)
    const event = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } })
    const result = sandbox.run([], { stdin: event })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('allow')
  })
})
