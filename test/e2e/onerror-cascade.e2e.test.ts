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

describe('onError cascade', () => {
  test('event-level onError overrides hook-level for PreToolUse, hook-level applies for UserPromptSubmit', () => {
    sandbox = createSandbox()
    sandbox.writeHook('crash-on-run-multi.ts', loadHook('crash-on-run-multi.ts'))
    sandbox.writeConfig(`
version: "1.0.0"
crash-on-run-multi:
  path: .clooks/hooks/crash-on-run-multi.ts
  onError: block
  events:
    PreToolUse:
      onError: continue
`)

    // PreToolUse: event-level "continue" takes precedence over hook-level "block".
    // The crash is swallowed, lastResult stays undefined, engine outputs systemMessage and exits 0.
    const result1 = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result1.exitCode).toBe(0)
    const output1 = JSON.parse(result1.stdout)
    // Should NOT be blocked — no permissionDecision: "deny"
    expect(output1.hookSpecificOutput?.permissionDecision).toBeUndefined()
    // Should have a systemMessage with the diagnostic
    expect(output1.systemMessage).toBeDefined()

    // UserPromptSubmit: no event-level override, hook-level "block" applies.
    // Crash → onError: block → fail-closed. translateResult for guard event produces { decision: "block" }.
    const upsEvent = JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'test' })
    const result2 = sandbox.run([], { stdin: upsEvent })
    expect(result2.exitCode).toBe(0)
    const output2 = JSON.parse(result2.stdout)
    expect(output2.decision).toBe('block')
  })

  test('global onError: continue applies when no hook-level or event-level override exists', () => {
    sandbox = createSandbox()
    sandbox.writeHook('crash-on-run.ts', loadHook('crash-on-run.ts'))
    sandbox.writeConfig(`
version: "1.0.0"
config:
  onError: continue
crash-on-run:
  path: .clooks/hooks/crash-on-run.ts
`)

    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    // Global "continue" means crash is swallowed — action NOT blocked
    expect(output.hookSpecificOutput?.permissionDecision).toBeUndefined()
    // Should have a systemMessage with the diagnostic
    expect(output.systemMessage).toBeDefined()
  })
})
