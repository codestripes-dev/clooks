import { describe, test, expect, afterEach } from 'bun:test'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { type Sandbox } from './helpers/sandbox'
import { ENTRYPOINT_SCRIPT } from '../../src/commands/init-entrypoint'
import { createRegistrationSandbox as createSandbox, registrationEnv } from './helpers/registration'

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
    sandbox.writeHook('allow-all.ts', loadHook('allow-all.ts'))
    sandbox.writeConfig('version: "1.0.0"\nallow-all: {}\n')
    const baseline = sandbox.runEntrypoint({ stdin: loadEvent('pre-tool-use-bash.json') })
    expect(baseline.exitCode).toBe(0)
    expect(JSON.parse(baseline.stdout).hookSpecificOutput.permissionDecision).toBe('allow')
    // Create the global entrypoint active flag file after proving project execution.
    sandbox.writeHomeFile('.clooks/.global-entrypoint-active', '')
    const result = sandbox.runEntrypoint({ stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('')
  })

  test('compiled Claude global launcher preserves merged ordering, shadowing and local overrides', () => {
    sandbox = createSandbox()
    expect(sandbox.run(['init']).exitCode).toBe(0)
    const marker = join(sandbox.dir, 'merged-calls')
    const source = (name: string, message: string) => `
import { appendFileSync } from 'fs'
export const hook = {
  meta: { name: ${JSON.stringify(name)} },
  PreToolUse() {
    appendFileSync(${JSON.stringify(marker)}, ${JSON.stringify(message + '\n')})
    return { result: 'allow', injectContext: ${JSON.stringify(message)} }
  },
}
`
    sandbox.writeHomeHook('home-only.ts', source('home-only', 'HOME-ONLY'))
    sandbox.writeHomeHook('shared.ts', source('shared', 'HOME-SHARED'))
    sandbox.writeHomeConfig(
      'version: "1.0.0"\nhome-only: {}\nshared: {}\nPreToolUse:\n  order: [home-only, shared]\n',
    )
    const projectCommand = JSON.parse(sandbox.readFile('.claude/settings.json')).hooks.PreToolUse[0]
      .hooks[0].command
    const invoke = (command: string) => {
      const result = Bun.spawnSync(['/bin/bash', '-c', command], {
        cwd: sandbox.dir,
        env: { ...registrationEnv(sandbox), CLAUDE_PROJECT_DIR: sandbox.dir },
        stdin: Buffer.from(
          JSON.stringify({
            ...JSON.parse(loadEvent('pre-tool-use-bash.json')),
            session_id: crypto.randomUUID(),
            tool_use_id: crypto.randomUUID(),
          }),
        ),
        timeout: 10_000,
      })
      expect(result.exitCode).toBe(0)
      return result.stdout.toString()
    }
    const baseline = JSON.parse(invoke(projectCommand))
    expect(baseline.hookSpecificOutput.permissionDecision).toBe('allow')
    expect(baseline.hookSpecificOutput.additionalContext).toContain('HOME-SHARED')
    expect(readFileSync(marker, 'utf8').trim().split('\n')).toEqual(['HOME-ONLY', 'HOME-SHARED'])
    sandbox.writeHook('shared.ts', source('shared', 'PROJECT-SHARED'))
    sandbox.writeHook('project-only.ts', source('project-only', 'PROJECT-ONLY'))
    sandbox.writeHook('config-echo.ts', loadHook('config-echo.ts'))
    sandbox.writeConfig(
      'version: "1.0.0"\nshared: {}\nproject-only: {}\nconfig-echo: {}\nPreToolUse:\n  order: [project-only, config-echo]\n',
    )
    expect(sandbox.run(['init', '--global']).exitCode).toBe(0)
    const globalCommand = JSON.parse(sandbox.readHomeFile('.claude/settings.json')).hooks
      .PreToolUse[0].hooks[0].command
    const merged = JSON.parse(invoke(globalCommand))
    expect(merged.hookSpecificOutput.permissionDecision).toBe('allow')
    const context = merged.hookSpecificOutput.additionalContext as string
    for (const text of ['HOME-ONLY', 'PROJECT-SHARED', 'PROJECT-ONLY', 'default-hello'])
      expect(context).toContain(text)
    expect(context).not.toContain('HOME-SHARED')
    expect(context.indexOf('HOME-ONLY')).toBeLessThan(context.indexOf('PROJECT-ONLY'))
    const before = readFileSync(marker, 'utf8')
    invoke(projectCommand)
    expect(readFileSync(marker, 'utf8')).toBe(before)
    sandbox.writeLocalConfig(
      'config-echo:\n  config:\n    greeting: local-receipt-regression\nPreToolUse:\n  order: [project-only, shared, home-only, config-echo]\n',
    )
    const local = JSON.parse(invoke(globalCommand))
    expect(local.hookSpecificOutput.permissionDecision).toBe('allow')
    expect(local.hookSpecificOutput.additionalContext).toContain('local-receipt-regression')
    expect(local.hookSpecificOutput.additionalContext).not.toContain('default-hello')
    expect(readFileSync(marker, 'utf8').slice(before.length).trim().split('\n')).toEqual([
      'PROJECT-ONLY',
      'PROJECT-SHARED',
      'HOME-ONLY',
    ])
    expect(existsSync(marker)).toBe(true)
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
      env: { CLOOKS_DEBUG: 'true', CLOOKS_LOGDIR: logDir },
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
