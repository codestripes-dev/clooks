import { describe, test, expect, afterEach } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createSandbox, type Sandbox } from './helpers/sandbox'

const FIXTURES = join(import.meta.dir, '../fixtures')
const loadHook = (name: string) => readFileSync(join(FIXTURES, 'hooks', name), 'utf8')

let sandbox: Sandbox

afterEach(() => {
  sandbox?.cleanup()
})

describe('stdin advanced', () => {
  test('1. stdin is JSON array — exit 2', () => {
    sandbox = createSandbox()
    sandbox.writeHook('allow-all.ts', loadHook('allow-all.ts'))
    sandbox.writeConfig(`
version: "1.0.0"
allow-all:
  path: .clooks/hooks/allow-all.ts
`)
    const result = sandbox.run([], { stdin: JSON.stringify([1, 2, 3]) })
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('not a JSON object')
  })

  test('2. hook_event_name is a number — exit 2', () => {
    sandbox = createSandbox()
    sandbox.writeHook('allow-all.ts', loadHook('allow-all.ts'))
    sandbox.writeConfig(`
version: "1.0.0"
allow-all:
  path: .clooks/hooks/allow-all.ts
`)
    const result = sandbox.run([], { stdin: JSON.stringify({ hook_event_name: 42 }) })
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('missing or unrecognized hook_event_name')
  })

  test('3. hook_event_name is an unknown string — exit 2', () => {
    sandbox = createSandbox()
    sandbox.writeHook('allow-all.ts', loadHook('allow-all.ts'))
    sandbox.writeConfig(`
version: "1.0.0"
allow-all:
  path: .clooks/hooks/allow-all.ts
`)
    const result = sandbox.run([], { stdin: JSON.stringify({ hook_event_name: "FooBar" }) })
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('missing or unrecognized hook_event_name')
  })

  test('4. stdin is JSON literal null — exit 2', () => {
    sandbox = createSandbox()
    sandbox.writeHook('allow-all.ts', loadHook('allow-all.ts'))
    sandbox.writeConfig(`
version: "1.0.0"
allow-all:
  path: .clooks/hooks/allow-all.ts
`)
    const result = sandbox.run([], { stdin: 'null' })
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('not a JSON object')
  })

  test('5. null field values (tool_input: null) — engine does not crash', () => {
    sandbox = createSandbox()
    sandbox.writeHook('allow-all.ts', loadHook('allow-all.ts'))
    sandbox.writeConfig(`
version: "1.0.0"
allow-all:
  path: .clooks/hooks/allow-all.ts
`)
    const result = sandbox.run([], {
      stdin: JSON.stringify({
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: null,
      }),
    })
    // Engine should not crash — hook runs and returns allow
    expect(result.exitCode).toBe(0)
  })
})
