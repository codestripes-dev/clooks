import { describe, test, expect, mock, spyOn, beforeEach, afterEach } from 'bun:test'
import { Command } from 'commander'
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  statSync,
} from 'fs'
import { join } from 'path'
import { tmpdir, homedir } from 'os'

// Mock @clack/prompts to avoid TTY issues in tests
mock.module('@clack/prompts', () => ({
  intro: mock(),
  outro: mock(),
  log: {
    success: mock(),
    info: mock(),
    warning: mock(),
    error: mock(),
  },
  confirm: mock(() => true),
  isCancel: mock(() => false),
  cancel: mock(),
}))

// Import after mocking
import { confirm, log } from '@clack/prompts'
import { createInitCommand } from './init.js'
import { ENTRYPOINT_SCRIPT, GLOBAL_ENTRYPOINT_SCRIPT } from './init-entrypoint.js'
import { CLOOKS_ENTRYPOINT_PATH } from '../settings.js'
import {
  CODEX_REGISTRATION_EVENTS,
  makeCodexGlobalEntrypointCommand,
  makeCodexProjectEntrypointCommand,
} from '../agents/codex/settings.js'
import os from 'os'
import * as registrationState from '../registration-state.js'
import * as fs from 'node:fs'
import * as codexSettings from '../agents/codex/settings.js'
import { approvalCommand, approvalCompanion } from '../registration-approvals.js'
import { hasOwnedMcpServer } from '../registration-mcp.js'

let tempDir: string
let originalCwd: () => string
let originalStdinIsTTY: boolean | undefined
let exitSpy: ReturnType<typeof spyOn>
let stdoutSpy: ReturnType<typeof spyOn>
let originalEnvironment: Record<string, string | undefined>

function createTestProgram() {
  const program = new Command()
  program.exitOverride()
  program.option('--json', 'JSON output')
  program.addCommand(createInitCommand())
  return program
}

function readSettings(root: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf-8'))
}

function readCodexHooks(root: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, '.codex', 'hooks.json'), 'utf-8'))
}

function warningMessages(): string[] {
  return ((log.warning as unknown as ReturnType<typeof mock>).mock.calls as unknown[][]).map(
    (call) => String(call[0]),
  )
}

function successMessages(): string[] {
  return ((log.success as unknown as ReturnType<typeof mock>).mock.calls as unknown[][]).map(
    (call) => String(call[0]),
  )
}

function infoMessages(): string[] {
  return ((log.info as unknown as ReturnType<typeof mock>).mock.calls as unknown[][]).map((call) =>
    String(call[0]),
  )
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'clooks-init-test-'))
  originalEnvironment = {
    HOME: process.env.HOME,
    CODEX_HOME: process.env.CODEX_HOME,
    CLOOKS_HOME_ROOT: process.env.CLOOKS_HOME_ROOT,
    CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
  }
  process.env.HOME = join(tempDir, 'home')
  mkdirSync(process.env.HOME, { recursive: true })
  delete process.env.CODEX_HOME
  delete process.env.CLAUDE_CONFIG_DIR
  process.env.CLOOKS_HOME_ROOT = process.env.HOME
  originalCwd = process.cwd
  originalStdinIsTTY = process.stdin.isTTY
  process.cwd = () => tempDir
  exitSpy = spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('process.exit called')
  }) as () => never)
  stdoutSpy = spyOn(process.stdout, 'write').mockImplementation(() => true)
  ;(log.success as unknown as ReturnType<typeof mock>).mockClear()
  ;(log.info as unknown as ReturnType<typeof mock>).mockClear()
  ;(log.warning as unknown as ReturnType<typeof mock>).mockClear()
  ;(confirm as unknown as ReturnType<typeof mock>).mockReset()
  ;(confirm as unknown as ReturnType<typeof mock>).mockImplementation(() => true)
})

afterEach(() => {
  process.cwd = originalCwd
  Object.defineProperty(process.stdin, 'isTTY', { value: originalStdinIsTTY, writable: true })
  exitSpy.mockRestore()
  stdoutSpy.mockRestore()
  mock.restore()
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

describe('clooks init', () => {
  test('creates full directory structure', async () => {
    const program = createTestProgram()
    await program.parseAsync(['init'], { from: 'user' })

    expect(existsSync(join(tempDir, '.clooks'))).toBe(true)
    expect(existsSync(join(tempDir, '.clooks', 'hooks'))).toBe(true)
    expect(existsSync(join(tempDir, '.clooks', 'bin'))).toBe(true)
    expect(existsSync(join(tempDir, '.clooks', 'vendor'))).toBe(true)
  })

  test('writes starter clooks.yml with correct content', async () => {
    const program = createTestProgram()
    await program.parseAsync(['init'], { from: 'user' })

    const content = readFileSync(join(tempDir, '.clooks', 'clooks.yml'), 'utf-8')
    // Parse with Bun's built-in YAML parser to verify structure, not just string
    const parsed = Bun.YAML.parse(content) as Record<string, unknown>
    expect(parsed.version).toBe('1.0.0')
    expect(parsed.config).toEqual({})
    // Should include yaml-language-server schema directive
    expect(content).toContain('# yaml-language-server: $schema=./clooks.schema.json')
  })

  test('writes entrypoint script with executable permissions', async () => {
    const program = createTestProgram()
    await program.parseAsync(['init'], { from: 'user' })

    const entrypointPath = join(tempDir, '.clooks', 'bin', 'entrypoint.sh')
    expect(existsSync(entrypointPath)).toBe(true)

    const content = readFileSync(entrypointPath, 'utf-8')
    expect(content).toBe(ENTRYPOINT_SCRIPT)

    const stat = statSync(entrypointPath)
    // Check executable bit (0o755 = rwxr-xr-x)
    const mode = stat.mode & 0o777
    expect(mode & 0o111).toBeGreaterThan(0) // at least one execute bit set
  })

  test('registers all 22 events in settings.json', async () => {
    const program = createTestProgram()
    await program.parseAsync(['init'], { from: 'user' })

    const settings = readSettings(tempDir)
    const hooks = settings.hooks as Record<string, unknown[]>
    expect(Object.keys(hooks)).toHaveLength(22)

    // Every event should have a Clooks matcher group
    for (const [event, matchers] of Object.entries(hooks)) {
      expect(matchers).toHaveLength(1)
      const mg = matchers[0] as Record<string, unknown>
      const hookEntries = mg.hooks as Record<string, unknown>[]
      if (event === 'PreToolUse') {
        const owner = `project:${readFileSync(join(tempDir, '.clooks/bin/claude-project-id'), 'utf8').trim()}`
        expect(hookEntries).toEqual([
          {
            type: 'command',
            command: approvalCommand('claude-code', owner, CLOOKS_ENTRYPOINT_PATH),
            timeout: 2_147_483,
          },
          approvalCompanion('claude-code', owner),
        ])
      } else {
        expect(hookEntries).toHaveLength(1)
        expect(hookEntries[0]!.command).toBe(CLOOKS_ENTRYPOINT_PATH)
      }
    }
  })

  test('updates .gitignore with 4 entries', async () => {
    const program = createTestProgram()
    await program.parseAsync(['init'], { from: 'user' })

    const content = readFileSync(join(tempDir, '.gitignore'), 'utf-8')
    expect(content).toContain('# Clooks')
    expect(content).toContain('clooks.local.yml')
    expect(content).toContain('.clooks/.cache/')
    expect(content).toContain('.clooks/.failures')
  })

  test('idempotent — running twice does not duplicate gitignore entries, clooks.yml, or settings.json', async () => {
    // First run
    const program1 = createTestProgram()
    await program1.parseAsync(['init'], { from: 'user' })

    const configAfterFirst = readFileSync(join(tempDir, '.clooks', 'clooks.yml'), 'utf-8')
    const settingsAfterFirst = readFileSync(join(tempDir, '.claude', 'settings.json'), 'utf-8')
    const gitignoreAfterFirst = readFileSync(join(tempDir, '.gitignore'), 'utf-8')

    // Second run
    const program2 = createTestProgram()
    await program2.parseAsync(['init'], { from: 'user' })

    const configAfterSecond = readFileSync(join(tempDir, '.clooks', 'clooks.yml'), 'utf-8')
    const settingsAfterSecond = readFileSync(join(tempDir, '.claude', 'settings.json'), 'utf-8')
    const gitignoreAfterSecond = readFileSync(join(tempDir, '.gitignore'), 'utf-8')

    // Nothing should change
    expect(configAfterSecond).toBe(configAfterFirst)
    expect(settingsAfterSecond).toBe(settingsAfterFirst)
    expect(gitignoreAfterSecond).toBe(gitignoreAfterFirst)
  })

  test('skips existing clooks.yml (does not overwrite user config)', async () => {
    // Pre-create clooks.yml with custom content
    mkdirSync(join(tempDir, '.clooks'), { recursive: true })
    const customContent = 'version: "1.0.0"\n\nconfig:\n  foo: bar\n'
    writeFileSync(join(tempDir, '.clooks', 'clooks.yml'), customContent)

    const program = createTestProgram()
    await program.parseAsync(['init'], { from: 'user' })

    // clooks.yml should NOT be overwritten
    const content = readFileSync(join(tempDir, '.clooks', 'clooks.yml'), 'utf-8')
    expect(content).toBe(customContent)
  })

  test('always overwrites entrypoint script (machine-generated)', async () => {
    // Pre-create entrypoint with different content
    mkdirSync(join(tempDir, '.clooks', 'bin'), { recursive: true })
    writeFileSync(join(tempDir, '.clooks', 'bin', 'entrypoint.sh'), '#!/bin/bash\necho old\n')

    const program = createTestProgram()
    await program.parseAsync(['init'], { from: 'user' })

    const content = readFileSync(join(tempDir, '.clooks', 'bin', 'entrypoint.sh'), 'utf-8')
    expect(content).toBe(ENTRYPOINT_SCRIPT)
  })

  test('creates .claude/ directory if missing', async () => {
    expect(existsSync(join(tempDir, '.claude'))).toBe(false)

    const program = createTestProgram()
    await program.parseAsync(['init'], { from: 'user' })

    expect(existsSync(join(tempDir, '.claude'))).toBe(true)
    expect(existsSync(join(tempDir, '.claude', 'settings.json'))).toBe(true)
  })

  test('JSON mode produces correct envelope', async () => {
    const program = createTestProgram()
    await program.parseAsync(['--json', 'init'], { from: 'user' })

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    const parsed = JSON.parse(output.trim())

    expect(parsed.ok).toBe(true)
    expect(parsed.command).toBe('init')
    expect(parsed.data.created).toBeInstanceOf(Array)
    expect(parsed.data.skipped).toBeInstanceOf(Array)
    expect(parsed.data.updated).toBeInstanceOf(Array)
    // On first run, should have created items
    expect(parsed.data.created.length).toBeGreaterThan(0)
    // types.d.ts should be in created on fresh init
    expect(parsed.data.created).toContain('.clooks/hooks/types.d.ts')
    expect(parsed.data.agent).toBe('claude-code')
    expect(parsed.data.agents).toEqual(['claude-code'])
    expect(existsSync(join(tempDir, '.codex', 'hooks.json'))).toBe(false)
  })

  test('handles malformed settings.json with clear error', async () => {
    mkdirSync(join(tempDir, '.claude'), { recursive: true })
    writeFileSync(join(tempDir, '.claude', 'settings.json'), '{ not valid json !!!')

    const program = createTestProgram()
    await program.parseAsync(['init'], { from: 'user' }).catch(() => {})

    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  test('clone-and-onboard: existing clooks.yml but no .claude/', async () => {
    // Simulate a clone scenario: .clooks/clooks.yml exists with custom content
    mkdirSync(join(tempDir, '.clooks'), { recursive: true })
    const customConfig = 'version: "1.0.0"\n\nconfig:\n  custom: true\n'
    writeFileSync(join(tempDir, '.clooks', 'clooks.yml'), customConfig)

    expect(existsSync(join(tempDir, '.claude'))).toBe(false)

    const program = createTestProgram()
    await program.parseAsync(['init'], { from: 'user' })

    // settings.json should be created with 22 events
    const settings = readSettings(tempDir)
    const hooks = settings.hooks as Record<string, unknown[]>
    expect(Object.keys(hooks)).toHaveLength(22)

    // entrypoint should be written
    expect(existsSync(join(tempDir, '.clooks', 'bin', 'entrypoint.sh'))).toBe(true)

    // clooks.yml should NOT be overwritten
    const content = readFileSync(join(tempDir, '.clooks', 'clooks.yml'), 'utf-8')
    expect(content).toBe(customConfig)
  })

  test('guardrail: homedir detection aborts in non-interactive mode', async () => {
    const home = homedir()
    process.cwd = () => home

    const program = createTestProgram()
    await program.parseAsync(['init', '--json'], { from: 'user' }).catch(() => {})

    // Should have called process.exit(1) because --json forces non-interactive mode
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  test('guardrail: homedir detection with interactive confirm decline aborts', async () => {
    const confirmMock = confirm as unknown as ReturnType<typeof mock>
    confirmMock.mockImplementationOnce(() => false)

    // Use a fresh subdir as fake home, set cwd to it
    const fakeHome = join(tempDir, 'guardtest-home')
    mkdirSync(fakeHome, { recursive: true })
    // Create .git to bypass the no-git guard
    mkdirSync(join(fakeHome, '.git'), { recursive: true })
    process.cwd = () => fakeHome
    // Override homedir to match cwd — triggers the "cwd === home" guard
    const origHomedir = os.homedir
    os.homedir = () => fakeHome
    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true })

    const program = createTestProgram()
    await program.parseAsync(['init'], { from: 'user' }).catch(() => {})

    os.homedir = origHomedir
    // User declined — no clooks.yml should be created
    expect(existsSync(join(fakeHome, '.clooks', 'clooks.yml'))).toBe(false)
  })

  test('guardrail: no-git with interactive confirm decline aborts', async () => {
    const confirmMock = confirm as unknown as ReturnType<typeof mock>
    confirmMock.mockImplementationOnce(() => false)

    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true })
    // Fresh dir with no .git/ in any parent. /tmp has a synthetic .git in this test sandbox.
    const noGitDir = mkdtempSync(join('/dev/shm', 'clooks-init-no-git-'))
    mkdirSync(noGitDir, { recursive: true })
    process.cwd = () => noGitDir

    const program = createTestProgram()
    await program.parseAsync(['init'], { from: 'user' }).catch(() => {})

    // User declined — no clooks.yml should be created
    expect(existsSync(join(noGitDir, '.clooks', 'clooks.yml'))).toBe(false)
    rmSync(noGitDir, { recursive: true, force: true })
  })

  test('guardrail: no-git detection proceeds in non-interactive mode', async () => {
    // tempDir has no .git/ — should proceed with warning, not abort
    const program = createTestProgram()
    await program.parseAsync(['init'], { from: 'user' })

    // Should complete successfully (no process.exit called)
    expect(exitSpy).not.toHaveBeenCalled()

    // Files should be created
    expect(existsSync(join(tempDir, '.clooks', 'clooks.yml'))).toBe(true)
  })

  test('writes types.d.ts with correct content', async () => {
    const program = createTestProgram()
    await program.parseAsync(['init'], { from: 'user' })

    const typesPath = join(tempDir, '.clooks', 'hooks', 'types.d.ts')
    expect(existsSync(typesPath)).toBe(true)

    const content = readFileSync(typesPath, 'utf-8')
    expect(content).toContain('ClooksHook')
  })

  test('types.d.ts has version header', async () => {
    const program = createTestProgram()
    await program.parseAsync(['init'], { from: 'user' })

    const typesPath = join(tempDir, '.clooks', 'hooks', 'types.d.ts')
    const content = readFileSync(typesPath, 'utf-8')
    const firstLine = content.split('\n')[0]
    expect(firstLine!.startsWith('// Clooks v')).toBe(true)
  })

  test('types.d.ts updated on content change', async () => {
    // Pre-create types.d.ts with dummy content
    mkdirSync(join(tempDir, '.clooks', 'hooks'), { recursive: true })
    writeFileSync(join(tempDir, '.clooks', 'hooks', 'types.d.ts'), '// dummy old content\n')

    const program = createTestProgram()
    await program.parseAsync(['--json', 'init'], { from: 'user' })

    // Verify real content was written
    const typesPath = join(tempDir, '.clooks', 'hooks', 'types.d.ts')
    const content = readFileSync(typesPath, 'utf-8')
    expect(content).toContain('ClooksHook')

    // Verify JSON output reports it as updated
    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    const parsed = JSON.parse(output.trim())
    expect(parsed.data.updated).toContain('.clooks/hooks/types.d.ts')
  })

  test('writes clooks.schema.json with valid JSON Schema', async () => {
    const program = createTestProgram()
    await program.parseAsync(['init'], { from: 'user' })

    const schemaPath = join(tempDir, '.clooks', 'clooks.schema.json')
    expect(existsSync(schemaPath)).toBe(true)

    const content = readFileSync(schemaPath, 'utf-8')
    const parsed = JSON.parse(content)
    expect(parsed.$schema).toContain('json-schema.org')
    expect(parsed.title).toBe('clooks.yml')
    expect(parsed.required).toContain('version')
  })

  test('clooks.schema.json updated on content change', async () => {
    mkdirSync(join(tempDir, '.clooks'), { recursive: true })
    writeFileSync(join(tempDir, '.clooks', 'clooks.schema.json'), '{}')

    const program = createTestProgram()
    await program.parseAsync(['--json', 'init'], { from: 'user' })

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    const parsed = JSON.parse(output.trim())
    expect(parsed.data.updated).toContain('.clooks/clooks.schema.json')
  })

  test('project init with pre-existing settings.json reports settings updated', async () => {
    // Pre-create settings.json with existing hooks from a different path
    mkdirSync(join(tempDir, '.claude'), { recursive: true })
    const oldSettings = {
      hooks: {
        PreToolUse: [
          { hooks: [{ type: 'command', command: '/old/path/.clooks/bin/entrypoint.sh' }] },
        ],
      },
    }
    writeFileSync(join(tempDir, '.claude', 'settings.json'), JSON.stringify(oldSettings))

    const program = createTestProgram()
    await program.parseAsync(['--json', 'init'], { from: 'user' })

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    const parsed = JSON.parse(output.trim())
    expect(parsed.ok).toBe(true)
    // Settings should be updated (not created), so should appear in updated list
    expect(parsed.data.updated.some((item: string) => item.includes('settings.json'))).toBe(true)
  })

  test('clooks.schema.json skipped on idempotent re-run', async () => {
    const program1 = createTestProgram()
    await program1.parseAsync(['init'], { from: 'user' })

    stdoutSpy.mockClear()

    const program2 = createTestProgram()
    await program2.parseAsync(['--json', 'init'], { from: 'user' })

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    const parsed = JSON.parse(output.trim())
    expect(parsed.data.skipped).toContain('.clooks/clooks.schema.json')
  })

  test('types.d.ts skipped on idempotent re-run', async () => {
    // First run
    const program1 = createTestProgram()
    await program1.parseAsync(['init'], { from: 'user' })

    // Reset stdout spy for second run
    stdoutSpy.mockClear()

    // Second run in JSON mode
    const program2 = createTestProgram()
    await program2.parseAsync(['--json', 'init'], { from: 'user' })

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    const parsed = JSON.parse(output.trim())
    expect(parsed.data.skipped).toContain('.clooks/hooks/types.d.ts')
  })

  test('--agent claude-code is equivalent to omitted agent for project init', async () => {
    const program = createTestProgram()
    await program.parseAsync(['init', '--agent', 'claude-code'], { from: 'user' })

    expect(existsSync(join(tempDir, '.claude', 'settings.json'))).toBe(true)
    expect(existsSync(join(tempDir, '.codex', 'hooks.json'))).toBe(false)

    const settings = readSettings(tempDir)
    const hooks = settings.hooks as Record<string, unknown[]>
    expect(Object.keys(hooks)).toHaveLength(22)
  })

  test('--agent codex creates project hooks.json and not Claude settings', async () => {
    const program = createTestProgram()
    await program.parseAsync(['init', '--agent', 'codex'], { from: 'user' })

    expect(existsSync(join(tempDir, '.clooks', 'bin', 'entrypoint.sh'))).toBe(true)
    expect(existsSync(join(tempDir, '.gitignore'))).toBe(true)
    expect(existsSync(join(tempDir, '.claude', 'settings.json'))).toBe(false)
    expect(existsSync(join(tempDir, '.codex', 'hooks.json'))).toBe(true)

    const hooksFile = readCodexHooks(tempDir)
    const hooks = hooksFile.hooks as Record<string, unknown[]>
    expect(Object.keys(hooks)).toEqual([...CODEX_REGISTRATION_EVENTS])

    const expectedCommand = makeCodexProjectEntrypointCommand(
      readFileSync(join(tempDir, '.clooks/bin/codex-project-id'), 'utf8').trim(),
    )
    for (const event of CODEX_REGISTRATION_EVENTS) {
      const matcherGroups = hooks[event]!
      expect(matcherGroups).toHaveLength(1)
      const hookEntries = (matcherGroups[0] as Record<string, unknown>).hooks as Record<
        string,
        unknown
      >[]
      const projectId = readFileSync(join(tempDir, '.clooks/bin/codex-project-id'), 'utf8').trim()
      expect(hookEntries).toEqual(
        event === 'PreToolUse'
          ? [
              {
                type: 'command',
                command: approvalCommand(
                  'codex',
                  `project:${projectId}`,
                  makeCodexProjectEntrypointCommand(projectId, true),
                ),
                timeout: 2_147_483,
              },
              approvalCompanion('codex', `project:${projectId}`),
            ]
          : [
              {
                type: 'command',
                command: expectedCommand,
                ...(event === 'SessionEnd' || event === 'Interrupt' ? { timeout: 3 } : {}),
              },
            ],
      )
      expect(expectedCommand).toContain('CLOOKS_PROJECT_ROOT=')
    }
  })

  test('--agent all registers both Claude and Codex after shared project setup', async () => {
    const program = createTestProgram()
    await program.parseAsync(['init', '--agent', 'all'], { from: 'user' })

    expect(existsSync(join(tempDir, '.clooks', 'clooks.yml'))).toBe(true)
    expect(existsSync(join(tempDir, '.claude', 'settings.json'))).toBe(true)
    expect(existsSync(join(tempDir, '.codex', 'hooks.json'))).toBe(true)
  })

  test('--agent codex JSON output preserves existing keys and adds agent fields', async () => {
    const program = createTestProgram()
    await program.parseAsync(['--json', 'init', '--agent', 'codex'], { from: 'user' })

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    const parsed = JSON.parse(output.trim())

    expect(parsed.ok).toBe(true)
    expect(parsed.command).toBe('init')
    expect(parsed.data.created).toBeInstanceOf(Array)
    expect(parsed.data.skipped).toBeInstanceOf(Array)
    expect(parsed.data.updated).toBeInstanceOf(Array)
    expect(parsed.data.agent).toBe('codex')
    expect(parsed.data.agents).toEqual(['codex'])
    expect(parsed.data.created.some((item: string) => item.includes('.codex/hooks.json'))).toBe(
      true,
    )
  })

  test('--agent all JSON output reports expanded agents', async () => {
    const program = createTestProgram()
    await program.parseAsync(['--json', 'init', '--agent', 'all'], { from: 'user' })

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    const parsed = JSON.parse(output.trim())

    expect(parsed.data.agent).toBe('all')
    expect(parsed.data.agents).toEqual(['claude-code', 'codex'])
  })

  test('invalid --agent values fail clearly', async () => {
    const program = createTestProgram()
    await program
      .parseAsync(['--json', 'init', '--agent', 'unknown'], { from: 'user' })
      .catch(() => {})

    expect(exitSpy).toHaveBeenCalledWith(1)
    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    const parsed = JSON.parse(output.trim())
    expect(parsed.ok).toBe(false)
    expect(parsed.error).toContain('Invalid --agent value "unknown"')
    expect(parsed.error).toContain('claude-code, codex, all')
  })

  test('--agent codex idempotent rerun skips hooks.json without duplicate registrations', async () => {
    const program1 = createTestProgram()
    await program1.parseAsync(['init', '--agent', 'codex'], { from: 'user' })
    const hooksAfterFirst = readFileSync(join(tempDir, '.codex', 'hooks.json'), 'utf-8')

    stdoutSpy.mockClear()
    const program2 = createTestProgram()
    await program2.parseAsync(['--json', 'init', '--agent', 'codex'], { from: 'user' })

    expect(readFileSync(join(tempDir, '.codex', 'hooks.json'), 'utf-8')).toBe(hooksAfterFirst)
    const parsed = JSON.parse(
      stdoutSpy.mock.calls
        .map((c: unknown[]) => String(c[0]))
        .join('')
        .trim(),
    )
    expect(parsed.data.skipped).toContain('.codex/hooks.json')

    const hooks = readCodexHooks(tempDir).hooks as Record<string, unknown[]>
    for (const event of CODEX_REGISTRATION_EVENTS) {
      expect(hooks[event]).toHaveLength(1)
    }
  })

  test('--agent codex prints trust warning and no runtime-placeholder warning', async () => {
    const program = createTestProgram()
    await program.parseAsync(['init', '--agent', 'codex'], { from: 'user' })

    const warnings = warningMessages()
    expect(warnings.some((message) => message.includes('Codex hook'))).toBe(true)
    expect(warnings.join('\n')).not.toContain('runtime adapter')
    expect(warnings.join('\n')).not.toContain('not implemented')
  })

  test('--agent codex human output reports created and skipped hooks.json', async () => {
    const program1 = createTestProgram()
    await program1.parseAsync(['init', '--agent', 'codex'], { from: 'user' })

    expect(successMessages().some((message) => message.includes('Created .codex/hooks.json'))).toBe(
      true,
    )
    expect(warningMessages().some((message) => message.includes('Codex hook'))).toBe(true)
    expect(
      [...successMessages(), ...infoMessages(), ...warningMessages()].join('\n'),
    ).not.toContain('not implemented')
    ;(log.success as unknown as ReturnType<typeof mock>).mockClear()
    ;(log.info as unknown as ReturnType<typeof mock>).mockClear()
    ;(log.warning as unknown as ReturnType<typeof mock>).mockClear()

    const program2 = createTestProgram()
    await program2.parseAsync(['init', '--agent', 'codex'], { from: 'user' })

    expect(infoMessages()).toContain('Skipped .codex/hooks.json')
    expect(warningMessages().some((message) => message.includes('Codex hook'))).toBe(true)
    expect(
      [...successMessages(), ...infoMessages(), ...warningMessages()].join('\n'),
    ).not.toContain('runtime adapter')
  })

  test('--agent codex human output reports updated hooks.json', async () => {
    mkdirSync(join(tempDir, '.codex'), { recursive: true })
    writeFileSync(
      join(tempDir, '.codex', 'hooks.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: '*',
              hooks: [
                {
                  type: 'command',
                  command: "CLOOKS_AGENT=codex '/old/project/.clooks/bin/entrypoint.sh'",
                },
              ],
            },
          ],
        },
      }),
    )

    const program = createTestProgram()
    await program.parseAsync(['init', '--agent', 'codex'], { from: 'user' })

    expect(successMessages().some((message) => message.includes('Updated .codex/hooks.json'))).toBe(
      true,
    )
    expect(warningMessages().some((message) => message.includes('Codex hook'))).toBe(true)
  })

  test('--agent all project human output reports Codex hooks and trust warning', async () => {
    const program = createTestProgram()
    await program.parseAsync(['init', '--agent', 'all'], { from: 'user' })

    expect(successMessages().some((message) => message.includes('Created .codex/hooks.json'))).toBe(
      true,
    )
    expect(warningMessages().some((message) => message.includes('Codex hook'))).toBe(true)
    expect(
      [...successMessages(), ...infoMessages(), ...warningMessages()].join('\n'),
    ).not.toContain('runtime adapter')
  })
})

describe('clooks init --global', () => {
  let originalHomedir: typeof os.homedir
  let fakeHome: string

  beforeEach(() => {
    // Use a subdirectory of tempDir as the fake home
    fakeHome = join(tempDir, 'fakehome')
    mkdirSync(fakeHome, { recursive: true })
    originalHomedir = os.homedir
    os.homedir = () => fakeHome
  })

  afterEach(() => {
    os.homedir = originalHomedir
  })

  test('creates expected directory structure', async () => {
    const program = createTestProgram()
    await program.parseAsync(['init', '--global'], { from: 'user' })

    expect(existsSync(join(fakeHome, '.clooks'))).toBe(true)
    expect(existsSync(join(fakeHome, '.clooks', 'hooks'))).toBe(true)
    expect(existsSync(join(fakeHome, '.clooks', 'bin'))).toBe(true)
    expect(existsSync(join(fakeHome, '.clooks', 'vendor'))).toBe(true)
  })

  test('creates .global-entrypoint-active flag file', async () => {
    const program = createTestProgram()
    await program.parseAsync(['init', '--global'], { from: 'user' })

    const flagPath = join(fakeHome, '.clooks', '.global-entrypoint-active')
    expect(existsSync(flagPath)).toBe(true)
    // Flag file should be empty
    const content = readFileSync(flagPath, 'utf-8')
    expect(content).toBe('')
  })

  test('writes starter clooks.yml with correct content', async () => {
    const program = createTestProgram()
    await program.parseAsync(['init', '--global'], { from: 'user' })

    const configPath = join(fakeHome, '.clooks', 'clooks.yml')
    expect(existsSync(configPath)).toBe(true)

    const content = readFileSync(configPath, 'utf-8')
    expect(content).toContain('# yaml-language-server: $schema=./clooks.schema.json')

    const parsed = Bun.YAML.parse(content) as Record<string, unknown>
    expect(parsed.version).toBe('1.0.0')
    expect(parsed.config).toEqual({})
  })

  test('writes global entrypoint with correct content (no dedup check)', async () => {
    const program = createTestProgram()
    await program.parseAsync(['init', '--global'], { from: 'user' })

    const entrypointPath = join(fakeHome, '.clooks', 'bin', 'entrypoint.sh')
    expect(existsSync(entrypointPath)).toBe(true)

    const content = readFileSync(entrypointPath, 'utf-8')
    expect(content).toBe(GLOBAL_ENTRYPOINT_SCRIPT)

    // Global entrypoint should NOT contain the dedup check
    expect(content).not.toContain('.global-entrypoint-active')

    // But should contain all other standard parts
    expect(content).toContain('SKIP_CLOOKS')
    expect(content).toContain('CLOOKS_BIN=')
    expect(content).toContain('fail-closed')
  })

  test('global entrypoint has executable permissions', async () => {
    const program = createTestProgram()
    await program.parseAsync(['init', '--global'], { from: 'user' })

    const entrypointPath = join(fakeHome, '.clooks', 'bin', 'entrypoint.sh')
    const stat = statSync(entrypointPath)
    const mode = stat.mode & 0o777
    expect(mode & 0o111).toBeGreaterThan(0)
  })

  test('registers in settings.json with absolute entrypoint path', async () => {
    const program = createTestProgram()
    await program.parseAsync(['init', '--global'], { from: 'user' })

    const settings = readSettings(fakeHome)
    const hooks = settings.hooks as Record<string, unknown[]>
    expect(Object.keys(hooks)).toHaveLength(22)

    const expectedPath = join(fakeHome, '.clooks/bin/entrypoint.sh')
    // Every event should have the absolute entrypoint path
    for (const [event, matchers] of Object.entries(hooks)) {
      expect(matchers).toHaveLength(1)
      const mg = matchers[0] as Record<string, unknown>
      const hookEntries = mg.hooks as Record<string, unknown>[]
      if (event === 'PreToolUse') {
        expect(hookEntries).toEqual([
          {
            type: 'command',
            command: approvalCommand(
              'claude-code',
              'global',
              codexSettings.quotePosixSingleArg(expectedPath),
            ),
            timeout: 2_147_483,
          },
          approvalCompanion('claude-code', 'global'),
        ])
      } else {
        expect(hookEntries).toHaveLength(1)
        expect(hookEntries[0]!.command).toBe(expectedPath)
      }
    }
  })

  test('does NOT create .gitignore (home directory is not a git repo)', async () => {
    const program = createTestProgram()
    await program.parseAsync(['init', '--global'], { from: 'user' })

    expect(existsSync(join(fakeHome, '.gitignore'))).toBe(false)
  })

  test('idempotent — running twice does not duplicate entries', async () => {
    // First run
    const program1 = createTestProgram()
    await program1.parseAsync(['init', '--global'], { from: 'user' })

    const configAfterFirst = readFileSync(join(fakeHome, '.clooks', 'clooks.yml'), 'utf-8')
    const settingsAfterFirst = readFileSync(join(fakeHome, '.claude', 'settings.json'), 'utf-8')

    // Second run
    const program2 = createTestProgram()
    await program2.parseAsync(['init', '--global'], { from: 'user' })

    const configAfterSecond = readFileSync(join(fakeHome, '.clooks', 'clooks.yml'), 'utf-8')
    const settingsAfterSecond = readFileSync(join(fakeHome, '.claude', 'settings.json'), 'utf-8')

    // Nothing should change
    expect(configAfterSecond).toBe(configAfterFirst)
    expect(settingsAfterSecond).toBe(settingsAfterFirst)
  })

  test('skips existing clooks.yml (does not overwrite user config)', async () => {
    mkdirSync(join(fakeHome, '.clooks'), { recursive: true })
    const customContent = 'version: "1.0.0"\n\nconfig:\n  myGlobalHook: true\n'
    writeFileSync(join(fakeHome, '.clooks', 'clooks.yml'), customContent)

    const program = createTestProgram()
    await program.parseAsync(['init', '--global'], { from: 'user' })

    const content = readFileSync(join(fakeHome, '.clooks', 'clooks.yml'), 'utf-8')
    expect(content).toBe(customContent)
  })

  test('JSON mode produces correct envelope with global flag', async () => {
    const program = createTestProgram()
    await program.parseAsync(['--json', 'init', '--global'], { from: 'user' })

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    const parsed = JSON.parse(output.trim())

    expect(parsed.ok).toBe(true)
    expect(parsed.command).toBe('init')
    expect(parsed.data.global).toBe(true)
    expect(parsed.data.created).toBeInstanceOf(Array)
    expect(parsed.data.created.length).toBeGreaterThan(0)
    // types.d.ts should be in created on fresh global init
    expect(parsed.data.created).toContain('~/.clooks/hooks/types.d.ts')
  })

  test('bypasses home directory guardrail (--global is explicit intent)', async () => {
    // Set cwd to the fake home — without --global this would trigger the guardrail
    process.cwd = () => fakeHome

    const program = createTestProgram()
    await program.parseAsync(['init', '--global'], { from: 'user' })

    // Should complete successfully (no process.exit called)
    expect(exitSpy).not.toHaveBeenCalled()

    // Files should be created
    expect(existsSync(join(fakeHome, '.clooks', 'clooks.yml'))).toBe(true)
  })

  test('global init with pre-existing files reports updated items in TUI mode', async () => {
    // First run creates everything
    const program1 = createTestProgram()
    await program1.parseAsync(['init', '--global'], { from: 'user' })

    // Modify types.d.ts so it triggers an update
    writeFileSync(join(fakeHome, '.clooks', 'hooks', 'types.d.ts'), '// old content\n')
    // Modify entrypoint so it triggers an update
    writeFileSync(join(fakeHome, '.clooks', 'bin', 'entrypoint.sh'), '#!/bin/bash\nold\n')
    // Modify schema so it triggers an update
    writeFileSync(join(fakeHome, '.clooks', 'clooks.schema.json'), '{}')

    // Second run (non-json TUI mode) should report updates
    const program2 = createTestProgram()
    await program2.parseAsync(['init', '--global'], { from: 'user' })

    // Should complete without error
    expect(exitSpy).not.toHaveBeenCalled()
  })

  test('global init JSON mode with pre-existing files reports updated items', async () => {
    // First run creates everything
    const program1 = createTestProgram()
    await program1.parseAsync(['init', '--global'], { from: 'user' })

    // Modify types.d.ts, entrypoint, and schema
    writeFileSync(join(fakeHome, '.clooks', 'hooks', 'types.d.ts'), '// old content\n')
    writeFileSync(join(fakeHome, '.clooks', 'bin', 'entrypoint.sh'), '#!/bin/bash\nold\n')
    writeFileSync(join(fakeHome, '.clooks', 'clooks.schema.json'), '{}')

    stdoutSpy.mockClear()
    const program2 = createTestProgram()
    await program2.parseAsync(['--json', 'init', '--global'], { from: 'user' })

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    const parsed = JSON.parse(output.trim())
    expect(parsed.ok).toBe(true)
    expect(parsed.data.updated.length).toBeGreaterThan(0)
  })

  test('global init with pre-existing settings.json reports settings updated', async () => {
    // Pre-create settings.json with existing hooks from a different path
    mkdirSync(join(fakeHome, '.claude'), { recursive: true })
    const oldSettings = {
      hooks: {
        PreToolUse: [
          { hooks: [{ type: 'command', command: '/old/path/.clooks/bin/entrypoint.sh' }] },
        ],
      },
    }
    writeFileSync(join(fakeHome, '.claude', 'settings.json'), JSON.stringify(oldSettings))

    const program = createTestProgram()
    await program.parseAsync(['init', '--global'], { from: 'user' })

    // Should complete successfully
    expect(exitSpy).not.toHaveBeenCalled()
  })

  test('--agent codex creates global hooks.json and not Claude settings', async () => {
    const program = createTestProgram()
    await program.parseAsync(['init', '--global', '--agent', 'codex'], { from: 'user' })

    expect(existsSync(join(fakeHome, '.clooks', '.global-entrypoint-active'))).toBe(false)
    expect(existsSync(join(fakeHome, '.clooks', '.global-entrypoint-active.codex'))).toBe(true)
    expect(existsSync(join(fakeHome, '.claude', 'settings.json'))).toBe(false)
    expect(existsSync(join(fakeHome, '.codex', 'hooks.json'))).toBe(true)

    const hooksFile = readCodexHooks(fakeHome)
    const hooks = hooksFile.hooks as Record<string, unknown[]>
    expect(Object.keys(hooks)).toEqual([...CODEX_REGISTRATION_EVENTS])

    const expectedCommand = makeCodexGlobalEntrypointCommand(fakeHome)
    expect(expectedCommand).not.toContain('CLOOKS_PROJECT_ROOT')
    for (const event of CODEX_REGISTRATION_EVENTS) {
      const matcherGroups = hooks[event]!
      const hookEntries = (matcherGroups[0] as Record<string, unknown>).hooks as Record<
        string,
        unknown
      >[]
      expect(hookEntries).toEqual(
        event === 'PreToolUse'
          ? [
              {
                type: 'command',
                command: approvalCommand('codex', 'global', expectedCommand),
                timeout: 2_147_483,
              },
              approvalCompanion('codex', 'global'),
            ]
          : [
              {
                type: 'command',
                command: expectedCommand,
                ...(event === 'SessionEnd' || event === 'Interrupt' ? { timeout: 3 } : {}),
              },
            ],
      )
    }
  })

  test('--agent all registers both Claude and Codex globally', async () => {
    const program = createTestProgram()
    await program.parseAsync(['init', '--global', '--agent', 'all'], { from: 'user' })

    expect(existsSync(join(fakeHome, '.clooks', '.global-entrypoint-active'))).toBe(true)
    expect(existsSync(join(fakeHome, '.clooks', '.global-entrypoint-active.codex'))).toBe(true)
    expect(existsSync(join(fakeHome, '.claude', 'settings.json'))).toBe(true)
    expect(existsSync(join(fakeHome, '.codex', 'hooks.json'))).toBe(true)
  })

  test('--agent codex global JSON output preserves global flag and adds agent fields', async () => {
    const program = createTestProgram()
    await program.parseAsync(['--json', 'init', '--global', '--agent', 'codex'], { from: 'user' })

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    const parsed = JSON.parse(output.trim())

    expect(parsed.ok).toBe(true)
    expect(parsed.command).toBe('init')
    expect(parsed.data.global).toBe(true)
    expect(parsed.data.created).toBeInstanceOf(Array)
    expect(parsed.data.skipped).toBeInstanceOf(Array)
    expect(parsed.data.updated).toBeInstanceOf(Array)
    expect(parsed.data.agent).toBe('codex')
    expect(parsed.data.agents).toEqual(['codex'])
    expect(
      parsed.data.created.some((item: string) =>
        item.includes(join(fakeHome, '.codex/hooks.json')),
      ),
    ).toBe(true)
  })

  test('--agent codex global rerun is idempotent', async () => {
    const program1 = createTestProgram()
    await program1.parseAsync(['init', '--global', '--agent', 'codex'], { from: 'user' })
    const hooksAfterFirst = readFileSync(join(fakeHome, '.codex', 'hooks.json'), 'utf-8')

    stdoutSpy.mockClear()
    const program2 = createTestProgram()
    await program2.parseAsync(['--json', 'init', '--global', '--agent', 'codex'], {
      from: 'user',
    })

    expect(readFileSync(join(fakeHome, '.codex', 'hooks.json'), 'utf-8')).toBe(hooksAfterFirst)
    const parsed = JSON.parse(
      stdoutSpy.mock.calls
        .map((c: unknown[]) => String(c[0]))
        .join('')
        .trim(),
    )
    expect(parsed.data.skipped).toContain(join(fakeHome, '.codex/hooks.json'))
  })

  test('--agent codex global human output reports trust warning and no runtime-placeholder warning', async () => {
    const program = createTestProgram()
    await program.parseAsync(['init', '--global', '--agent', 'codex'], { from: 'user' })

    expect(
      successMessages().some((message) =>
        message.includes(`Created ${join(fakeHome, '.codex/hooks.json')}`),
      ),
    ).toBe(true)
    expect(warningMessages().some((message) => message.includes('Codex hook'))).toBe(true)
    expect(
      [...successMessages(), ...infoMessages(), ...warningMessages()].join('\n'),
    ).not.toContain('runtime adapter')
  })

  test('--agent all global human output reports trust warning and no runtime-placeholder warning', async () => {
    const program = createTestProgram()
    await program.parseAsync(['init', '--global', '--agent', 'all'], { from: 'user' })

    expect(
      successMessages().some((message) =>
        message.includes(`Created ${join(fakeHome, '.codex/hooks.json')}`),
      ),
    ).toBe(true)
    expect(warningMessages().some((message) => message.includes('Codex hook'))).toBe(true)
    expect(
      [...successMessages(), ...infoMessages(), ...warningMessages()].join('\n'),
    ).not.toContain('not implemented')
  })
})

describe('ENTRYPOINT_SCRIPT', () => {
  test('starts with shebang', () => {
    expect(ENTRYPOINT_SCRIPT.startsWith('#!/usr/bin/env bash')).toBe(true)
  })

  test('contains project type header', () => {
    expect(ENTRYPOINT_SCRIPT).toContain('# clooks entrypoint: project')
    expect(ENTRYPOINT_SCRIPT).not.toContain('# clooks entrypoint: global')
  })

  test('contains CLOOKS_BIN variable', () => {
    expect(ENTRYPOINT_SCRIPT).toContain('CLOOKS_BIN=')
  })

  test('contains SKIP_CLOOKS bypass', () => {
    expect(ENTRYPOINT_SCRIPT).toContain('SKIP_CLOOKS')
  })

  test('contains fail-closed logic', () => {
    expect(ENTRYPOINT_SCRIPT).toContain('fail-closed')
  })

  test('project entrypoint includes dedup check for .global-entrypoint-active', () => {
    expect(ENTRYPOINT_SCRIPT).toContain('.global-entrypoint-active')
    expect(ENTRYPOINT_SCRIPT).toContain('CLOOKS_DEDUP_AGENT="${CLOOKS_AGENT:-claude-code}"')
    expect(ENTRYPOINT_SCRIPT).toContain(
      '[ "$CLOOKS_DEDUP_AGENT" = "claude-code" ] && [ -f "$HOME/.clooks/.global-entrypoint-active" ]',
    )
    expect(ENTRYPOINT_SCRIPT).toContain('clooks-codex-registration-v1')
    expect(ENTRYPOINT_SCRIPT).toContain('cksum')
  })

  test('dedup check appears after SKIP_CLOOKS and before CLOOKS_BIN', () => {
    const skipIdx = ENTRYPOINT_SCRIPT.indexOf('SKIP_CLOOKS')
    const dedupIdx = ENTRYPOINT_SCRIPT.indexOf('.global-entrypoint-active')
    const binIdx = ENTRYPOINT_SCRIPT.indexOf('CLOOKS_BIN=')

    expect(skipIdx).toBeGreaterThan(-1)
    expect(dedupIdx).toBeGreaterThan(-1)
    expect(binIdx).toBeGreaterThan(-1)
    expect(dedupIdx).toBeGreaterThan(skipIdx)
    expect(dedupIdx).toBeLessThan(binIdx)
  })
})

describe('GLOBAL_ENTRYPOINT_SCRIPT', () => {
  test('starts with shebang', () => {
    expect(GLOBAL_ENTRYPOINT_SCRIPT.startsWith('#!/usr/bin/env bash')).toBe(true)
  })

  test('contains global type header', () => {
    expect(GLOBAL_ENTRYPOINT_SCRIPT).toContain('# clooks entrypoint: global')
    expect(GLOBAL_ENTRYPOINT_SCRIPT).not.toContain('# clooks entrypoint: project')
  })

  test('does NOT contain dedup check', () => {
    expect(GLOBAL_ENTRYPOINT_SCRIPT).not.toContain('.global-entrypoint-active')
  })

  test('contains all standard parts', () => {
    expect(GLOBAL_ENTRYPOINT_SCRIPT).toContain('SKIP_CLOOKS')
    expect(GLOBAL_ENTRYPOINT_SCRIPT).toContain('CLOOKS_BIN=')
    expect(GLOBAL_ENTRYPOINT_SCRIPT).toContain('fail-closed')
    expect(GLOBAL_ENTRYPOINT_SCRIPT).toContain('STDIN_DATA=$(cat)')
  })
})

describe('entrypoint dedup behavior', () => {
  let fakeHome: string
  let originalHomedir: typeof os.homedir

  function runEntrypoint(entrypointPath: string, agent = 'claude-code') {
    return Bun.spawnSync(['/bin/bash', entrypointPath], {
      cwd: tempDir,
      env: {
        HOME: fakeHome,
        CODEX_HOME: join(fakeHome, '.codex'),
        CLOOKS_HOME_ROOT: fakeHome,
        CLOOKS_AGENT: agent,
        PATH: '/usr/bin:/bin',
      },
      stdin: Buffer.from('{}'),
      timeout: 2000,
      killSignal: 'SIGKILL',
    })
  }

  beforeEach(() => {
    fakeHome = join(tempDir, 'fakehome')
    mkdirSync(fakeHome, { recursive: true })
    originalHomedir = os.homedir
    os.homedir = () => fakeHome
  })

  afterEach(() => {
    os.homedir = originalHomedir
  })

  test('project entrypoint exits 0 when flag file exists (dedup works)', async () => {
    // First, init the project so we have the entrypoint
    const program = createTestProgram()
    await program.parseAsync(['init'], { from: 'user' })

    const entrypointPath = join(tempDir, '.clooks', 'bin', 'entrypoint.sh')

    // Create the flag file
    mkdirSync(join(fakeHome, '.clooks'), { recursive: true })
    writeFileSync(join(fakeHome, '.clooks', '.global-entrypoint-active'), '')

    // Run the entrypoint — it should exit 0 immediately due to dedup
    const proc = runEntrypoint(entrypointPath)
    expect(proc.exitCode).toBe(0)
  })

  test('project entrypoint proceeds normally when flag file does not exist', async () => {
    // Init the project
    const program = createTestProgram()
    await program.parseAsync(['init'], { from: 'user' })

    const entrypointPath = join(tempDir, '.clooks', 'bin', 'entrypoint.sh')

    // Do NOT create the flag file — entrypoint should proceed to binary check.
    // Use a restricted PATH so `command -v clooks` won't find a real binary.
    const proc = runEntrypoint(entrypointPath)
    // Should exit 0 (allow) with install advisory on stderr — missing binary
    // is a setup state, not a runtime failure. Blocking here would deadlock
    // /clooks:setup, which invokes the Bash tool guarded by this hook.
    expect(proc.exitCode).toBe(0)
    const stderr = proc.stderr.toString()
    expect(stderr).toContain('Binary not found')
  })

  test('Codex-only global init does not make Claude project entrypoint exit early', async () => {
    const globalProgram = createTestProgram()
    await globalProgram.parseAsync(['init', '--global', '--agent', 'codex'], { from: 'user' })

    expect(existsSync(join(fakeHome, '.clooks', '.global-entrypoint-active'))).toBe(false)
    expect(existsSync(join(fakeHome, '.clooks', '.global-entrypoint-active.codex'))).toBe(true)

    const projectProgram = createTestProgram()
    await projectProgram.parseAsync(['init'], { from: 'user' })

    const entrypointPath = join(tempDir, '.clooks', 'bin', 'entrypoint.sh')
    const proc = runEntrypoint(entrypointPath)

    expect(proc.exitCode).toBe(0)
    expect(proc.stderr.toString()).toContain('Binary not found')
  })

  test('Codex project entrypoint remains eligible with an empty legacy flag', async () => {
    const program = createTestProgram()
    await program.parseAsync(['init', '--agent', 'codex'], { from: 'user' })

    mkdirSync(join(fakeHome, '.clooks'), { recursive: true })
    writeFileSync(join(fakeHome, '.clooks', '.global-entrypoint-active.codex'), '')

    const entrypointPath = join(tempDir, '.clooks', 'bin', 'entrypoint.sh')
    const proc = runEntrypoint(entrypointPath, 'codex')

    expect(proc.exitCode).toBe(0)
    expect(proc.stderr.toString()).toContain('Binary not found')
  })
})

describe('global init registration recovery', () => {
  let home: string
  beforeEach(() => {
    home = join(tempDir, 'installation')
    mkdirSync(home)
    spyOn(os, 'homedir').mockReturnValue(home)
  })

  function run(agent = 'codex') {
    return createTestProgram().parseAsync(['--json', 'init', '--global', '--agent', agent], {
      from: 'user',
    })
  }

  test.each(['relative', '/bad\npath', '/bad\rpath'])(
    'rejects invalid CODEX_HOME %j before all shared writes',
    async (value) => {
      process.env.CODEX_HOME = value
      await expect(run('all')).rejects.toThrow('process.exit called')
      expect(fs.readdirSync(home)).toEqual([])
    },
  )

  test.each(['.codex-registration-home', '.global-entrypoint-active.codex'])(
    'malformed %s prevents types, schema, launcher and Claude writes',
    async (name) => {
      mkdirSync(join(home, '.clooks/hooks'), { recursive: true })
      const sentinel = join(home, '.clooks/hooks/types.d.ts')
      writeFileSync(sentinel, 'keep types')
      writeFileSync(join(home, '.clooks', name), 'malformed\n')
      await expect(run('all')).rejects.toThrow('process.exit called')
      expect(readFileSync(sentinel, 'utf-8')).toBe('keep types')
      expect(existsSync(join(home, '.clooks/clooks.schema.json'))).toBe(false)
      expect(existsSync(join(home, '.clooks/bin'))).toBe(false)
      expect(existsSync(join(home, '.claude'))).toBe(false)
      expect(existsSync(join(home, '.codex'))).toBe(false)
    },
  )

  test('custom home output and receipt use installation HOME, ignoring runtime override', async () => {
    const custom = join(tempDir, 'codex custom')
    process.env.CODEX_HOME = custom
    process.env.CLOOKS_HOME_ROOT = join(tempDir, 'runtime-only')
    await run()
    expect(existsSync(join(custom, 'hooks.json'))).toBe(true)
    expect(existsSync(process.env.CLOOKS_HOME_ROOT)).toBe(false)
    expect(registrationState.readCodexTrackedHome(home)).toEqual({
      kind: 'home',
      codexHome: custom,
    })
    const receipt = registrationState.readCodexReceipt(home)
    expect(receipt.kind).toBe('receipt')
    if (receipt.kind === 'receipt') expect(receipt.value.codexHome).toBe(custom)
    expect(stdoutSpy.mock.calls.map((call: unknown[]) => String(call[0])).join('')).toContain(
      join(custom, 'hooks.json'),
    )
  })

  test('recovery write failure precedes Codex registration', async () => {
    spyOn(registrationState, 'trackCodexHome').mockImplementation(() => {
      throw new Error('track fault')
    })
    await expect(run()).rejects.toThrow('process.exit called')
    expect(existsSync(join(home, '.codex/hooks.json'))).toBe(false)
    expect(existsSync(join(home, '.clooks/.global-entrypoint-active.codex'))).toBe(false)
    expect(fs.readdirSync(home)).toEqual([])
  })

  test('invalid Codex destination prevents all selected-agent writes and recovery mutation', async () => {
    mkdirSync(join(home, '.codex'))
    writeFileSync(join(home, '.codex/hooks.json'), '{broken')
    await expect(run('all')).rejects.toThrow('process.exit called')
    expect(readFileSync(join(home, '.codex/hooks.json'), 'utf-8')).toBe('{broken')
    expect(existsSync(join(home, '.clooks/.global-entrypoint-active'))).toBe(false)
    expect(existsSync(join(home, '.clooks/.global-entrypoint-active.codex'))).toBe(false)
    expect(registrationState.readCodexTrackedHome(home).kind).toBe('missing')
    expect(existsSync(join(home, '.claude/settings.json'))).toBe(false)
    expect(existsSync(join(home, '.claude.json'))).toBe(false)
  })

  test('failed Claude registrar does not publish a Claude flag', async () => {
    mkdirSync(join(home, '.claude'))
    writeFileSync(join(home, '.claude/settings.json'), '{broken')
    await expect(run('all')).rejects.toThrow('process.exit called')
    expect(existsSync(join(home, '.clooks/.global-entrypoint-active'))).toBe(false)
    expect(existsSync(join(home, '.clooks/.global-entrypoint-active.codex'))).toBe(false)
  })

  test('publication runs after committed hooks, server and executable launcher; failure permits same-home retry', async () => {
    let observed: { hooksExist: boolean; serverOwned: boolean; launcherMode: number } | undefined
    const publish = spyOn(registrationState, 'publishCodexReceipt').mockImplementation(() => {
      observed = {
        hooksExist: existsSync(join(home, '.codex/hooks.json')),
        serverOwned: hasOwnedMcpServer(join(home, '.codex/config.toml'), 'codex'),
        launcherMode: statSync(join(home, '.clooks/bin/entrypoint.sh')).mode,
      }
      throw new Error('publication fault')
    })
    await expect(run()).rejects.toThrow('process.exit called')
    expect(publish).toHaveBeenCalledTimes(1)
    expect(observed?.hooksExist).toBe(true)
    expect(observed?.serverOwned).toBe(true)
    expect((observed?.launcherMode ?? 0) & 0o111).toBeGreaterThan(0)
    expect(stdoutSpy.mock.calls.map((call: unknown[]) => String(call[0])).join('')).toContain(
      'publication fault',
    )
    expect(registrationState.readCodexTrackedHome(home).kind).toBe('home')
    expect(registrationState.readCodexReceipt(home).kind).toBe('missing')
    publish.mockRestore()
    await run()
    expect(registrationState.readCodexReceipt(home).kind).toBe('receipt')
  })

  test('malformed server preflight preserves existing receipt, recovery and launcher before all-agent writes', async () => {
    await run()
    const paths = [
      '.clooks/.global-entrypoint-active.codex',
      '.clooks/.codex-registration-home',
      '.clooks/bin/entrypoint.sh',
      '.codex/hooks.json',
    ].map((path) => join(home, path))
    const before = paths.map((path) => readFileSync(path))
    const server = join(home, '.codex/config.toml')
    writeFileSync(server, '[broken')
    const track = spyOn(registrationState, 'trackCodexHome')
    await expect(run('all')).rejects.toThrow('process.exit called')
    expect(track).not.toHaveBeenCalled()
    paths.forEach((path, index) => expect(readFileSync(path)).toEqual(before[index]!))
    expect(readFileSync(server, 'utf-8')).toBe('[broken')
    expect(existsSync(join(home, '.claude.json'))).toBe(false)
    expect(existsSync(join(home, '.claude/settings.json'))).toBe(false)
    expect(stdoutSpy.mock.calls.map((call: unknown[]) => String(call[0])).join('')).toContain(
      server,
    )
  })

  test('server commit failure never publishes receipt and same-home retry completes the pair', async () => {
    const server = join(home, '.codex/config.toml')
    const rename = fs.renameSync
    const fault = spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (String(to) === server) throw new Error('server commit fault')
      rename(from, to)
    })
    const publish = spyOn(registrationState, 'publishCodexReceipt')
    await expect(run()).rejects.toThrow('process.exit called')
    expect(publish).not.toHaveBeenCalled()
    expect(registrationState.readCodexReceipt(home).kind).toBe('missing')
    expect(registrationState.readCodexTrackedHome(home).kind).toBe('home')
    expect(existsSync(server)).toBe(false)
    fault.mockRestore()
    await run()
    expect(hasOwnedMcpServer(server, 'codex')).toBe(true)
    expect(readCodexHooks(home).hooks).toHaveProperty('PreToolUse')
    expect(registrationState.readCodexReceipt(home).kind).toBe('receipt')
  })

  test.each(['missing', 'nonexecutable'])(
    'retires old receipt before repairing %s launcher on failed re-init',
    async (condition) => {
      await run()
      const launcher = join(home, '.clooks/bin/entrypoint.sh')
      if (condition === 'missing') fs.unlinkSync(launcher)
      else fs.chmodSync(launcher, 0o644)
      const hooksPath = join(home, '.codex/hooks.json')
      const hooks = readFileSync(hooksPath, 'utf-8')
      let observedMode: number | undefined
      const register = spyOn(codexSettings, 'registerCodexClooks').mockImplementation(() => {
        observedMode = statSync(launcher).mode
        throw new Error('registration fault')
      })
      await expect(run()).rejects.toThrow('process.exit called')
      expect(register).toHaveBeenCalledTimes(1)
      expect((observedMode ?? 0) & 0o111).toBeGreaterThan(0)
      expect(stdoutSpy.mock.calls.map((call: unknown[]) => String(call[0])).join('')).toContain(
        'registration fault',
      )
      expect(readFileSync(hooksPath, 'utf-8')).toBe(hooks)
      expect(existsSync(join(home, '.clooks/.global-entrypoint-active.codex'))).toBe(false)
      expect(registrationState.readCodexTrackedHome(home).kind).toBe('home')
    },
  )

  test('failed recovery write preserves old receipt and missing launcher', async () => {
    await run()
    const receiptPath = join(home, '.clooks/.global-entrypoint-active.codex')
    const receipt = readFileSync(receiptPath, 'utf-8')
    const launcher = join(home, '.clooks/bin/entrypoint.sh')
    fs.unlinkSync(launcher)
    spyOn(registrationState, 'trackCodexHome').mockImplementation(() => {
      throw new Error('track fault')
    })
    await expect(run()).rejects.toThrow('process.exit called')
    expect(readFileSync(receiptPath, 'utf-8')).toBe(receipt)
    expect(existsSync(launcher)).toBe(false)
  })

  test('receipt retirement failure retains identity and aborts before launcher repair', async () => {
    await run()
    const receiptPath = join(home, '.clooks/.global-entrypoint-active.codex')
    const receipt = readFileSync(receiptPath, 'utf-8')
    const launcher = join(home, '.clooks/bin/entrypoint.sh')
    fs.unlinkSync(launcher)
    const unlink = fs.unlinkSync
    spyOn(fs, 'unlinkSync').mockImplementation((path) => {
      if (String(path) === receiptPath) throw new Error('retire fault')
      unlink(path)
    })
    await expect(run()).rejects.toThrow('process.exit called')
    expect(readFileSync(receiptPath, 'utf-8')).toBe(receipt)
    expect(existsSync(launcher)).toBe(false)
    expect(registrationState.readCodexTrackedHome(home).kind).toBe('home')
  })

  for (const agent of ['codex', 'all']) {
    for (const condition of ['missing', 'nonexecutable']) {
      test(`${agent}: publication failure after repairing ${condition} launcher retires old receipt until retry`, async () => {
        await run(agent)
        const launcher = join(home, '.clooks/bin/entrypoint.sh')
        const hooksPath = join(home, '.codex/hooks.json')
        const hooks = readFileSync(hooksPath, 'utf-8')
        if (condition === 'missing') fs.unlinkSync(launcher)
        else fs.chmodSync(launcher, 0o644)
        const publish = spyOn(registrationState, 'publishCodexReceipt').mockImplementation(() => {
          throw new Error('publication fault')
        })
        await expect(run(agent)).rejects.toThrow('process.exit called')
        expect(readFileSync(hooksPath, 'utf-8')).toBe(hooks)
        expect(statSync(launcher).mode & 0o111).toBeGreaterThan(0)
        expect(registrationState.readCodexReceipt(home).kind).toBe('missing')
        expect(registrationState.readCodexTrackedHome(home).kind).toBe('home')
        publish.mockRestore()
        await run(agent)
        expect(registrationState.readCodexReceipt(home).kind).toBe('receipt')
      })
    }

    test(`${agent}: malformed recovery preflight preserves previously eligible receipt, hooks and launcher bytes/mode`, async () => {
      await run(agent)
      const paths = [
        '.clooks/.global-entrypoint-active.codex',
        '.codex/hooks.json',
        '.clooks/bin/entrypoint.sh',
        '.clooks/hooks/types.d.ts',
        '.clooks/clooks.schema.json',
      ].map((path) => join(home, path))
      const before = paths.map((path) => ({
        path,
        bytes: readFileSync(path),
        mode: statSync(path).mode,
      }))
      writeFileSync(join(home, '.clooks/.codex-registration-home'), 'malformed\n')
      await expect(run(agent)).rejects.toThrow('process.exit called')
      for (const { path, bytes, mode } of before) {
        expect(readFileSync(path)).toEqual(bytes)
        expect(statSync(path).mode).toBe(mode)
      }
    })
  }

  test('project Codex init ignores invalid global CODEX_HOME', async () => {
    process.env.CODEX_HOME = 'relative-invalid-global-home'
    await createTestProgram().parseAsync(['--json', 'init', '--agent', 'codex'], { from: 'user' })
    expect(existsSync(join(tempDir, '.codex/hooks.json'))).toBe(true)
    expect(fs.readdirSync(home)).toEqual([])
  })

  test('conflicting records prevent all init writes', async () => {
    await run()
    const alternate = join(tempDir, 'alternate')
    const recovery = join(home, '.clooks/.codex-registration-home')
    writeFileSync(recovery, `clooks-codex-home-v1\n${alternate}\n`)
    const paths = [
      recovery,
      join(home, '.clooks/.global-entrypoint-active.codex'),
      join(home, '.codex/hooks.json'),
      join(home, '.clooks/bin/entrypoint.sh'),
    ]
    const before = paths.map((path) => readFileSync(path))
    await expect(run('all')).rejects.toThrow('process.exit called')
    paths.forEach((path, index) => expect(readFileSync(path)).toEqual(before[index]!))
    expect(existsSync(join(home, '.claude'))).toBe(false)
    expect(existsSync(alternate)).toBe(false)
  })

  test('legacy default identity rejects custom init before writes and upgrades on default retry', async () => {
    mkdirSync(join(home, '.clooks'))
    const receipt = join(home, '.clooks/.global-entrypoint-active.codex')
    writeFileSync(receipt, '')
    process.env.CODEX_HOME = join(tempDir, 'custom')
    await expect(run('all')).rejects.toThrow('process.exit called')
    expect(readFileSync(receipt, 'utf-8')).toBe('')
    expect(fs.readdirSync(join(home, '.clooks'))).toEqual(['.global-entrypoint-active.codex'])
    expect(existsSync(join(home, '.claude'))).toBe(false)
    delete process.env.CODEX_HOME
    await run()
    expect(registrationState.readCodexReceipt(home).kind).toBe('receipt')
  })

  test.each(['missing', 'nonexecutable'])(
    'Claude-only invalid destination preserves %s launcher and old Codex state',
    async (condition) => {
      await run('codex')
      const launcher = join(home, '.clooks/bin/entrypoint.sh')
      const receiptPath = join(home, '.clooks/.global-entrypoint-active.codex')
      const recoveryPath = join(home, '.clooks/.codex-registration-home')
      const hooksPath = join(home, '.codex/hooks.json')
      const before = [receiptPath, recoveryPath, hooksPath].map((path) => readFileSync(path))
      if (condition === 'missing') fs.unlinkSync(launcher)
      else fs.chmodSync(launcher, 0o644)
      mkdirSync(join(home, '.claude'))
      writeFileSync(join(home, '.claude/settings.json'), '{broken')
      process.env.CODEX_HOME = 'invalid-but-unselected'
      const readReceipt = spyOn(registrationState, 'readCodexReceipt')
      const readTracked = spyOn(registrationState, 'readCodexTrackedHome')
      const track = spyOn(registrationState, 'trackCodexHome')
      const publish = spyOn(registrationState, 'publishCodexReceipt')
      await expect(run('claude-code')).rejects.toThrow('process.exit called')
      expect(readReceipt).not.toHaveBeenCalled()
      expect(readTracked).not.toHaveBeenCalled()
      expect(track).not.toHaveBeenCalled()
      expect(publish).not.toHaveBeenCalled()
      ;[receiptPath, recoveryPath, hooksPath].forEach((path, index) =>
        expect(readFileSync(path)).toEqual(before[index]!),
      )
      if (condition === 'missing') expect(existsSync(launcher)).toBe(false)
      else expect(statSync(launcher).mode & 0o111).toBe(0)
      expect(readFileSync(join(home, '.claude/settings.json'), 'utf-8')).toBe('{broken')
      expect(existsSync(join(home, '.clooks/.global-entrypoint-active'))).toBe(false)
    },
  )
})
