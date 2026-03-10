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

describe('hook execution', () => {
  test('allow hook passes through', () => {
    sandbox = createSandbox()
    sandbox.writeHook('allow-all.ts', loadHook('allow-all.ts'))
    sandbox.writeConfig(`
version: "1.0.0"
allow-all:
  path: .clooks/hooks/allow-all.ts
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('allow')
  })

  test('block hook blocks the action (PreToolUse)', () => {
    sandbox = createSandbox()
    sandbox.writeHook('block-always.ts', loadHook('block-always.ts'))
    sandbox.writeConfig(`
version: "1.0.0"
block-always:
  path: .clooks/hooks/block-always.ts
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
  })

  test('skip result produces no output for PostToolUse', () => {
    sandbox = createSandbox()
    sandbox.writeHook('allow-all.ts', loadHook('allow-all.ts'))
    sandbox.writeConfig(`
version: "1.0.0"
allow-all:
  path: .clooks/hooks/allow-all.ts
`)
    const event = JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } })
    const result = sandbox.run([], { stdin: event })
    expect(result.exitCode).toBe(0)
    // PostToolUse with skip result produces no meaningful output
    // stdout may be empty or contain empty JSON
    expect(result.stdout.trim()).toBe('')
  })

  test('multiple hooks execute in order — block wins', () => {
    sandbox = createSandbox()
    sandbox.writeHook('allow-all.ts', loadHook('allow-all.ts'))
    sandbox.writeHook('block-always.ts', loadHook('block-always.ts'))
    sandbox.writeConfig(`
version: "1.0.0"
allow-all:
  path: .clooks/hooks/allow-all.ts
block-always:
  path: .clooks/hooks/block-always.ts
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
  })

  test('hook for non-matching event is not executed', () => {
    sandbox = createSandbox()
    sandbox.writeHook('log-event.ts', loadHook('log-event.ts'))
    sandbox.writeConfig(`
version: "1.0.0"
log-event:
  path: .clooks/hooks/log-event.ts
`)
    // log-event only handles PreToolUse, but we send Notification
    const result = sandbox.run([], { stdin: loadEvent('notification.json') })
    expect(result.exitCode).toBe(0)
    // The sidecar file should NOT exist — hook was never invoked
    expect(sandbox.fileExists('.clooks/hooks/log-event.log')).toBe(false)
  })

  test('sequential updatedInput pipeline carries mutations forward', () => {
    sandbox = createSandbox()
    sandbox.writeHook('rewrite-command.ts', loadHook('rewrite-command.ts'))
    sandbox.writeHook('read-command.ts', loadHook('read-command.ts'))
    sandbox.writeConfig(`
version: "1.0.0"
rewrite-command:
  path: .clooks/hooks/rewrite-command.ts
read-command:
  path: .clooks/hooks/read-command.ts
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.additionalContext).toContain('read-command saw: echo rewritten')
  })
})
