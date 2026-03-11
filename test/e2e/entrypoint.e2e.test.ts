import { describe, test, expect, afterEach } from 'bun:test'
import { readFileSync, readdirSync } from 'fs'
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

describe('bash entrypoint', () => {
  test('full chain: entrypoint -> binary -> hook -> result', () => {
    sandbox = createSandbox()
    sandbox.writeEntrypoint(ENTRYPOINT_SCRIPT)
    sandbox.writeHook('allow-all.ts', loadHook('allow-all.ts'))
    sandbox.writeConfig(`version: "1.0.0"
allow-all: {}
`)
    const result = sandbox.runEntrypoint({ stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('allow')
  })

  test('dedup: global flag file causes early exit', () => {
    sandbox = createSandbox()
    sandbox.writeEntrypoint(ENTRYPOINT_SCRIPT)
    // Create the global entrypoint active flag file
    sandbox.writeHomeFile('.clooks/.global-entrypoint-active', '')
    const result = sandbox.runEntrypoint({ stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('')
  })

  test('debug logging writes stdin to file', () => {
    sandbox = createSandbox()
    sandbox.writeEntrypoint(ENTRYPOINT_SCRIPT)
    sandbox.writeHook('allow-all.ts', loadHook('allow-all.ts'))
    sandbox.writeConfig(`version: "1.0.0"
allow-all: {}
`)
    const logDir = join(sandbox.dir, 'debug-logs')
    const event = loadEvent('pre-tool-use-bash.json')
    const result = sandbox.runEntrypoint({
      stdin: event,
      env: { CLOOKS_DEBUG: 'true', CLOOKS_LOGDIR: logDir }
    })
    expect(result.exitCode).toBe(0)
    // Check that a .json file was created in the log directory
    // The filename is a timestamp, so we just check the directory has a file
    const files = readdirSync(logDir)
    expect(files.length).toBeGreaterThan(0)
    const logContent = readFileSync(join(logDir, files[0]!), 'utf8')
    expect(logContent).toContain('PreToolUse')
  })

  describe('exit code translation', () => {
    test('binary exit 0 -> entrypoint exit 0', () => {
      sandbox = createSandbox()
      sandbox.writeEntrypoint(ENTRYPOINT_SCRIPT)
      sandbox.writeStubBinary('#!/bin/bash\nexit 0\n')
      const result = sandbox.runEntrypoint({ stdin: loadEvent('pre-tool-use-bash.json') })
      expect(result.exitCode).toBe(0)
    })

    test('binary exit 2 -> entrypoint exit 2', () => {
      sandbox = createSandbox()
      sandbox.writeEntrypoint(ENTRYPOINT_SCRIPT)
      sandbox.writeStubBinary('#!/bin/bash\nexit 2\n')
      const result = sandbox.runEntrypoint({ stdin: loadEvent('pre-tool-use-bash.json') })
      expect(result.exitCode).toBe(2)
    })

    test('binary exit 1 -> entrypoint exit 2 (fail-closed)', () => {
      sandbox = createSandbox()
      sandbox.writeEntrypoint(ENTRYPOINT_SCRIPT)
      sandbox.writeStubBinary('#!/bin/bash\nexit 1\n')
      const result = sandbox.runEntrypoint({ stdin: loadEvent('pre-tool-use-bash.json') })
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('unexpected code')
    })

    test('binary exit 42 -> entrypoint exit 2 (fail-closed)', () => {
      sandbox = createSandbox()
      sandbox.writeEntrypoint(ENTRYPOINT_SCRIPT)
      sandbox.writeStubBinary('#!/bin/bash\nexit 42\n')
      const result = sandbox.runEntrypoint({ stdin: loadEvent('pre-tool-use-bash.json') })
      expect(result.exitCode).toBe(2)
      expect(result.stderr).toContain('unexpected code')
    })
  })
})
