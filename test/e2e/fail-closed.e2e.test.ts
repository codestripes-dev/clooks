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

describe('fail-closed invariant', () => {
  test('hook that throws is caught and action is blocked', () => {
    sandbox = createSandbox()
    sandbox.writeHook('crash-on-run.ts', loadHook('crash-on-run.ts'))
    sandbox.writeConfig(`version: "1.0.0"
crash-on-run: {}
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    // PreToolUse blocks are communicated via JSON with exit code 0
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
  })

  test('malformed clooks.yml blocks the action', () => {
    sandbox = createSandbox()
    sandbox.writeConfig('hooks: [[[')
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(2)
    // stderr should mention something about config/parse error
    expect(result.stderr.length).toBeGreaterThan(0)
  })

  test('hook file that fails to import blocks the action', () => {
    sandbox = createSandbox()
    sandbox.writeHook('broken.ts', 'export const hook = {') // syntax error
    sandbox.writeConfig(`version: "1.0.0"
broken:
  maxFailures: 3
`)
    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    // Load errors go through circuit breaker. First failure (count 1 < maxFailures 3)
    // produces a block result, which for PreToolUse translates to deny + exit 0.
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
  })

  test('missing binary via entrypoint exits 0 with bootstrap advisory', () => {
    // Missing binary is a setup state, not a runtime failure. Exiting 0
    // allows the tool call to proceed so /clooks:setup (which runs through
    // the Bash tool this hook guards) can install the binary without deadlocking.
    sandbox = createSandbox()
    sandbox.writeEntrypoint(ENTRYPOINT_SCRIPT)
    sandbox.removeClooksBinary()
    const result = sandbox.runEntrypoint({
      stdin: loadEvent('pre-tool-use-bash.json'),
    })
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toContain('Binary not found')
    expect(result.stderr).toContain('/clooks:setup')
    expect(result.stderr).toContain('github.com/codestripes-dev/clooks/releases/latest')
    expect(result.stderr).toContain('SKIP_CLOOKS')
  })

  test('binary crash via entrypoint exits 2 (fail-closed translation)', () => {
    sandbox = createSandbox()
    sandbox.writeEntrypoint(ENTRYPOINT_SCRIPT)
    // Replace binary with a stub that exits 1
    sandbox.writeStubBinary('#!/bin/bash\nexit 1\n')
    const result = sandbox.runEntrypoint({ stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('unexpected code')
  })

  test('SKIP_CLOOKS=true bypasses everything', () => {
    sandbox = createSandbox()
    sandbox.writeEntrypoint(ENTRYPOINT_SCRIPT)
    sandbox.removeClooksBinary() // binary doesn't even exist
    const result = sandbox.runEntrypoint({
      stdin: loadEvent('pre-tool-use-bash.json'),
      env: { SKIP_CLOOKS: 'true' },
    })
    expect(result.exitCode).toBe(0)
  })
})
