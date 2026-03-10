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

describe('lifecycle', () => {
  test('beforeHook blocks the handler', () => {
    sandbox = createSandbox()
    sandbox.writeHook('before-block.ts', loadHook('before-block.ts'))
    sandbox.writeConfig(`
version: "1.0.0"
before-block:
  path: .clooks/hooks/before-block.ts
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(output.hookSpecificOutput.permissionDecisionReason).toContain('before blocked')
  })

  test('beforeHook block shows in debug output', () => {
    sandbox = createSandbox()
    sandbox.writeHook('before-block.ts', loadHook('before-block.ts'))
    sandbox.writeConfig(`
version: "1.0.0"
before-block:
  path: .clooks/hooks/before-block.ts
`)
    const result = sandbox.run([], {
      stdin: loadEvent('pre-tool-use-bash.json'),
      env: { CLOOKS_DEBUG: 'true' },
    })
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toContain('beforeHook: blocked')
  })
})
