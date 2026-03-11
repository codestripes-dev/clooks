import { describe, test, expect, afterEach } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createSandbox, type Sandbox } from './helpers/sandbox'
import { ENTRYPOINT_SCRIPT } from '../../src/commands/init-entrypoint'

const FIXTURES = join(import.meta.dir, '../fixtures')
const loadHook = (name: string) => readFileSync(join(FIXTURES, 'hooks', name), 'utf8')
const loadEvent = (name: string) => readFileSync(join(FIXTURES, 'events', name), 'utf8')

let sandbox: Sandbox

afterEach(() => {
  sandbox?.cleanup()
})

describe('fresh clone', () => {
  test('no binary → bootstrap message → install → works', () => {
    sandbox = createSandbox()

    // Pre-populate a complete .clooks/ directory (config, hooks, entrypoint)
    // simulating a repo that was set up with clooks and then cloned fresh.
    sandbox.writeEntrypoint(ENTRYPOINT_SCRIPT)
    sandbox.writeHook('allow-all.ts', loadHook('allow-all.ts'))
    sandbox.writeConfig(`version: "1.0.0"
allow-all: {}
`)

    // Remove the binary to simulate a fresh clone where clooks is not installed.
    sandbox.removeClooksBinary()

    // Step 1: Run entrypoint — should fail with bootstrap message (exit 2).
    const event = loadEvent('pre-tool-use-bash.json')
    const failResult = sandbox.runEntrypoint({ stdin: event })
    expect(failResult.exitCode).toBe(2)
    expect(failResult.stderr).toContain('Binary not found')
    expect(failResult.stderr).toContain('clooks.cc/install')
    expect(failResult.stderr).toContain('SKIP_CLOOKS')

    // Step 2: "Install" the binary — restore the symlink in the sandbox home.
    sandbox.restoreBinary()

    // Step 3: Run entrypoint again — should work now.
    const successResult = sandbox.runEntrypoint({ stdin: event })
    expect(successResult.exitCode).toBe(0)
    const output = JSON.parse(successResult.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('allow')
  })
})
