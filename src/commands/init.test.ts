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
import { createInitCommand } from './init.js'
import { ENTRYPOINT_SCRIPT, GLOBAL_ENTRYPOINT_SCRIPT } from './init-entrypoint.js'
import { CLOOKS_ENTRYPOINT_PATH } from '../settings.js'
import os from 'os'

let tempDir: string
let originalCwd: () => string
let exitSpy: ReturnType<typeof spyOn>
let stdoutSpy: ReturnType<typeof spyOn>

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

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'clooks-init-test-'))
  originalCwd = process.cwd
  process.cwd = () => tempDir
  exitSpy = spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('process.exit called')
  }) as () => never)
  stdoutSpy = spyOn(process.stdout, 'write').mockImplementation(() => true)
})

afterEach(() => {
  process.cwd = originalCwd
  exitSpy.mockRestore()
  stdoutSpy.mockRestore()
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
    // Also verify exact content
    expect(content).toBe('version: "1.0.0"\n\nconfig: {}\n')
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

  test('registers all 18 events in settings.json', async () => {
    const program = createTestProgram()
    await program.parseAsync(['init'], { from: 'user' })

    const settings = readSettings(tempDir)
    const hooks = settings.hooks as Record<string, unknown[]>
    expect(Object.keys(hooks)).toHaveLength(18)

    // Every event should have a Clooks matcher group
    for (const matchers of Object.values(hooks)) {
      expect(matchers).toHaveLength(1)
      const mg = matchers[0] as Record<string, unknown>
      const hookEntries = mg.hooks as Record<string, string>[]
      expect(hookEntries).toHaveLength(1)
      expect(hookEntries[0]!.command).toBe(CLOOKS_ENTRYPOINT_PATH)
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

    const output = stdoutSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join('')
    const parsed = JSON.parse(output.trim())

    expect(parsed.ok).toBe(true)
    expect(parsed.command).toBe('init')
    expect(parsed.data.created).toBeInstanceOf(Array)
    expect(parsed.data.skipped).toBeInstanceOf(Array)
    expect(parsed.data.updated).toBeInstanceOf(Array)
    // On first run, should have created items
    expect(parsed.data.created.length).toBeGreaterThan(0)
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

    // settings.json should be created with 18 events
    const settings = readSettings(tempDir)
    const hooks = settings.hooks as Record<string, unknown[]>
    expect(Object.keys(hooks)).toHaveLength(18)

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
    await program.parseAsync(['init'], { from: 'user' }).catch(() => {})

    // Should have called process.exit(1) because stdin is not a TTY in tests
    expect(exitSpy).toHaveBeenCalledWith(1)
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
    expect(content).toBe('version: "1.0.0"\n\nconfig: {}\n')

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
    expect(Object.keys(hooks)).toHaveLength(18)

    const expectedPath = join(fakeHome, '.clooks/bin/entrypoint.sh')
    // Every event should have the absolute entrypoint path
    for (const matchers of Object.values(hooks)) {
      expect(matchers).toHaveLength(1)
      const mg = matchers[0] as Record<string, unknown>
      const hookEntries = mg.hooks as Record<string, string>[]
      expect(hookEntries).toHaveLength(1)
      expect(hookEntries[0]!.command).toBe(expectedPath)
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

    const output = stdoutSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join('')
    const parsed = JSON.parse(output.trim())

    expect(parsed.ok).toBe(true)
    expect(parsed.command).toBe('init')
    expect(parsed.data.global).toBe(true)
    expect(parsed.data.created).toBeInstanceOf(Array)
    expect(parsed.data.created.length).toBeGreaterThan(0)
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
})

describe('ENTRYPOINT_SCRIPT', () => {
  test('starts with shebang', () => {
    expect(ENTRYPOINT_SCRIPT.startsWith('#!/usr/bin/env bash')).toBe(true)
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
    expect(ENTRYPOINT_SCRIPT).toContain('if [ -f "$HOME/.clooks/.global-entrypoint-active" ]')
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
    const proc = Bun.spawnSync(['bash', entrypointPath], {
      env: { ...process.env, HOME: fakeHome },
      stdin: Buffer.from('{}'),
    })
    expect(proc.exitCode).toBe(0)
  })

  test('project entrypoint proceeds normally when flag file does not exist', async () => {
    // Init the project
    const program = createTestProgram()
    await program.parseAsync(['init'], { from: 'user' })

    const entrypointPath = join(tempDir, '.clooks', 'bin', 'entrypoint.sh')

    // Do NOT create the flag file — entrypoint should proceed to binary check
    // Since the binary doesn't exist, it should exit 2 (bootstrap detection)
    const proc = Bun.spawnSync(['bash', entrypointPath], {
      env: { ...process.env, HOME: fakeHome },
      stdin: Buffer.from('{}'),
    })
    // Should exit 2 because the binary isn't installed
    expect(proc.exitCode).toBe(2)
    const stderr = proc.stderr.toString()
    expect(stderr).toContain('Binary not found')
  })
})
