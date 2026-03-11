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

describe('adversarial', () => {
  test('Scenario 10: garbage return value triggers fail-closed', () => {
    sandbox = createSandbox()
    sandbox.writeHook('garbage-return.ts', loadHook('garbage-return.ts'))
    sandbox.writeConfig(`
version: "1.0.0"
garbage-return: {}
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('unknown result type')
    expect(result.stdout.trim()).toBe('')
  })

  describe('Scenario 11: malformed stdin', () => {
    test('11a: empty string stdin', () => {
      sandbox = createSandbox()
      sandbox.writeHook('allow-all.ts', loadHook('allow-all.ts'))
      sandbox.writeConfig(`
version: "1.0.0"
allow-all: {}
`)
      const result = sandbox.run([], { stdin: '' })
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('failed to parse stdin JSON')
    })

    test('11b: non-JSON string stdin', () => {
      sandbox = createSandbox()
      sandbox.writeHook('allow-all.ts', loadHook('allow-all.ts'))
      sandbox.writeConfig(`
version: "1.0.0"
allow-all: {}
`)
      const result = sandbox.run([], { stdin: 'not json at all' })
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('failed to parse stdin JSON')
    })

    test('11c: valid JSON missing hook_event_name', () => {
      sandbox = createSandbox()
      sandbox.writeHook('allow-all.ts', loadHook('allow-all.ts'))
      sandbox.writeConfig(`
version: "1.0.0"
allow-all: {}
`)
      const result = sandbox.run([], { stdin: JSON.stringify({ tool_name: 'Bash' }) })
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('missing or unrecognized hook_event_name')
    })
  })

  test('Scenario 12: onError continue — hook crashes but action proceeds', () => {
    sandbox = createSandbox()
    sandbox.writeHook('crash-on-run.ts', loadHook('crash-on-run.ts'))
    sandbox.writeConfig(`
version: "1.0.0"
crash-on-run:
  onError: continue
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    // With onError: continue and no other hooks, lastResult is undefined.
    // The engine outputs systemMessage with the diagnostic.
    const output = JSON.parse(result.stdout)
    expect(output.systemMessage).toBeDefined()
    expect(output.systemMessage).toContain('crash-on-run')
    // Verify action was NOT blocked (regression guard)
    expect(output.hookSpecificOutput?.permissionDecision).toBeUndefined()
  })

  test('Scenario 13: onError trace — error surfaces via additionalContext', () => {
    sandbox = createSandbox()
    sandbox.writeHook('crash-on-run.ts', loadHook('crash-on-run.ts'))
    sandbox.writeConfig(`
version: "1.0.0"
crash-on-run:
  onError: trace
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    // Trace messages are injected into additionalContext for injectable events
    expect(output.hookSpecificOutput).toBeDefined()
    expect(output.hookSpecificOutput.additionalContext).toContain('Hook "crash-on-run" errored')
    expect(output.hookSpecificOutput.additionalContext).toContain('intentional crash for testing')
    expect(output.hookSpecificOutput.additionalContext).toContain('onError: trace')
  })

  test('Scenario 23: config forward compatibility — unknown keys do not crash', () => {
    sandbox = createSandbox()
    sandbox.writeHook('allow-all.ts', loadHook('allow-all.ts'))
    sandbox.writeConfig(`
version: "1.0.0"
config:
  future_setting: true
allow-all:
  unknown_option: "should be ignored"
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    // The binary should not crash — exit 0 or a valid hook response
    expect(result.exitCode).toBe(0)
  })

  test('Scenario 24: performance regression tripwire — under 2000ms', () => {
    sandbox = createSandbox()
    sandbox.writeHook('allow-all.ts', loadHook('allow-all.ts'))
    sandbox.writeConfig(`
version: "1.0.0"
allow-all: {}
`)
    const event = loadEvent('pre-tool-use-bash.json')
    const start = performance.now()
    const result = sandbox.run([], { stdin: event })
    const elapsed = performance.now() - start
    expect(result.exitCode).toBe(0)
    expect(elapsed).toBeLessThan(2000)
  })
})
