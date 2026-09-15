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

  test('--help loads the CLI router', () => {
    sandbox = createSandbox()
    const result = sandbox.run(['--help'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Usage: clooks')
    expect(result.stdout).toContain('Commands:')
    expect(result.stderr).toBe('')
  })

  test('external TypeScript top-level await and relative imports preserve denial output', () => {
    sandbox = createSandbox()
    sandbox.writeFile(
      '.clooks/hooks/support/reason.ts',
      'export const reason: string = "esm-bytecode-denial"\n',
    )
    sandbox.writeHook(
      'async-deny.ts',
      `
import { reason } from './support/reason.ts'
const message: string = await Promise.resolve(reason)
export const hook = {
  meta: { name: "async-deny" },
  async PreToolUse() {
    return { result: "block", reason: await Promise.resolve(message) }
  },
}
`,
    )
    sandbox.writeConfig('version: "1.0.0"\nasync-deny: {}\n')
    const result = sandbox.run([], {
      stdin: JSON.stringify({
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'ls' },
      }),
    })
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout).hookSpecificOutput).toEqual({
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: 'esm-bytecode-denial',
    })
    expect(result.stderr).toBe('')
  })

  test('invalid configuration still fails closed', () => {
    sandbox = createSandbox()
    sandbox.writeConfig('version: "1.0.0"\nconfig: [\n')
    const result = sandbox.run([], {
      stdin: JSON.stringify({
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'ls' },
      }),
    })
    expect(result.exitCode).toBe(2)
    expect(result.rawExitCode).toBe(2)
    expect(result.signalCode).toBeNull()
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('invalid YAML')
    expect(result.stderr).toContain('.clooks/clooks.yml')
  })

  test('engine mode with no config exits 0 (no hooks = noop)', () => {
    sandbox = createSandbox()
    const event = JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
    })
    const result = sandbox.run([], { stdin: event })
    expect(result.exitCode).toBe(0)
  })

  test('engine mode with a hook runs it and returns result', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'allow-all.ts',
      `
export const hook = {
  meta: { name: "allow-all" },
  PreToolUse() { return { result: "allow" } },
}
`,
    )
    sandbox.writeConfig(`version: "1.0.0"
allow-all: {}
`)
    const event = JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
    })
    const result = sandbox.run([], { stdin: event })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('allow')
  })
})
