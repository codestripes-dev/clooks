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

describe('debug mode', () => {
  test('CLOOKS_DEBUG=true produces debug output in stderr and additionalContext', () => {
    sandbox = createSandbox()
    sandbox.writeHook('allow-all.ts', loadHook('allow-all.ts'))
    sandbox.writeConfig(`
version: "1.0.0"
allow-all: {}
`)
    const result = sandbox.run([], {
      stdin: loadEvent('pre-tool-use-bash.json'),
      env: { CLOOKS_DEBUG: 'true' },
    })
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toContain('[clooks:debug]')
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.additionalContext).toContain('[clooks:debug]')
  })
})
