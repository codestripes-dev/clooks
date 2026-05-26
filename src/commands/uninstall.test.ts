import { describe, test, expect, mock, spyOn, beforeEach, afterEach } from 'bun:test'
import { Command } from 'commander'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Mock @clack/prompts BEFORE imports
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
  select: mock(() => 'project'),
  isCancel: mock(() => false),
  cancel: mock(),
}))

// Mock platform module for getHomeDir
let fakeHome = ''
mock.module('../platform.js', () => ({
  getHomeDir: () => fakeHome,
}))

// Import after mocking
import { createUninstallCommand } from './uninstall.js'
import { registerClooks, CLOOKS_ENTRYPOINT_PATH } from '../settings.js'
import {
  CODEX_REGISTRATION_EVENTS,
  makeCodexGlobalEntrypointCommand,
  makeCodexProjectEntrypointCommand,
  registerCodexClooks,
} from '../agents/codex/settings.js'

let tempDir: string
let originalIsTTY: boolean | undefined
let exitSpy: ReturnType<typeof spyOn>
let stdoutSpy: ReturnType<typeof spyOn>

function createTestProgram() {
  const program = new Command()
  program.exitOverride()
  program.option('--json', 'JSON output')
  program.addCommand(createUninstallCommand(() => Promise.resolve(tempDir)))
  return program
}

// Helper to set up a project with Clooks initialized
function setupProject(root: string) {
  mkdirSync(join(root, '.clooks', 'hooks'), { recursive: true })
  mkdirSync(join(root, '.clooks', 'bin'), { recursive: true })
  mkdirSync(join(root, '.clooks', 'vendor'), { recursive: true })
  writeFileSync(join(root, '.clooks', 'clooks.yml'), 'version: "1.0.0"\nconfig: {}\n')
  writeFileSync(join(root, '.clooks', 'hooks', 'types.d.ts'), '// generated types\n')
  writeFileSync(join(root, '.clooks', 'bin', 'entrypoint.sh'), '#!/bin/bash\n')
  // Register Clooks in settings.json
  registerClooks(join(root, '.claude'), CLOOKS_ENTRYPOINT_PATH)
}

function setupCodexProject(root: string) {
  mkdirSync(join(root, '.clooks', 'hooks'), { recursive: true })
  mkdirSync(join(root, '.clooks', 'bin'), { recursive: true })
  mkdirSync(join(root, '.clooks', 'vendor'), { recursive: true })
  writeFileSync(join(root, '.clooks', 'clooks.yml'), 'version: "1.0.0"\nconfig: {}\n')
  writeFileSync(join(root, '.clooks', 'hooks', 'types.d.ts'), '// generated types\n')
  writeFileSync(join(root, '.clooks', 'bin', 'entrypoint.sh'), '#!/bin/bash\n')
  registerCodexClooks(join(root, '.codex'), makeCodexProjectEntrypointCommand(root))
}

function readSettings(root: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf-8'))
}

function readCodexHooks(root: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, '.codex', 'hooks.json'), 'utf-8'))
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'clooks-uninstall-test-'))
  fakeHome = join(tempDir, 'fakehome')
  mkdirSync(fakeHome, { recursive: true })
  originalIsTTY = process.stdin.isTTY
  exitSpy = spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('process.exit called')
  }) as () => never)
  stdoutSpy = spyOn(process.stdout, 'write').mockImplementation(() => true)
})

afterEach(() => {
  Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, writable: true })
  exitSpy.mockRestore()
  stdoutSpy.mockRestore()
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

describe('clooks uninstall — force mode', () => {
  test('--project --full --force removes settings.json hooks and .clooks/ directory', async () => {
    setupProject(tempDir)

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--project', '--full', '--force'], { from: 'user' })

    // settings.json should exist but have no Clooks hooks
    const settings = readSettings(tempDir)
    expect(settings.hooks).toBeUndefined()

    // .clooks/ directory should not exist
    expect(existsSync(join(tempDir, '.clooks'))).toBe(false)

    expect(exitSpy).not.toHaveBeenCalled()
  })

  test('--project --full --force preserves non-Clooks hooks', async () => {
    setupProject(tempDir)

    // Add a non-Clooks hook alongside Clooks on PreToolUse (a real event)
    const settings = readSettings(tempDir)
    const hooks = settings.hooks as Record<string, unknown[]>
    hooks['PreToolUse']!.push({ hooks: [{ type: 'command', command: '/my/other/hook.sh' }] })
    writeFileSync(
      join(tempDir, '.claude', 'settings.json'),
      JSON.stringify(settings, null, 2) + '\n',
    )

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--project', '--full', '--force'], { from: 'user' })

    // The non-Clooks hook on PreToolUse should still exist, Clooks hook removed
    const updatedSettings = readSettings(tempDir)
    const updatedHooks = updatedSettings.hooks as Record<string, unknown[]>
    expect(updatedHooks).toBeDefined()
    expect(updatedHooks['PreToolUse']).toBeDefined()
    expect(updatedHooks['PreToolUse']).toHaveLength(1)
    const mg = updatedHooks['PreToolUse']![0] as Record<string, unknown>
    const hookEntries = mg.hooks as Record<string, string>[]
    expect(hookEntries[0]!.command).toBe('/my/other/hook.sh')
  })

  test('--project --unhook --force only removes settings.json entries', async () => {
    setupProject(tempDir)

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--project', '--unhook', '--force'], { from: 'user' })

    // settings.json should have no Clooks hooks
    const settings = readSettings(tempDir)
    expect(settings.hooks).toBeUndefined()

    // .clooks/ directory should STILL exist
    expect(existsSync(join(tempDir, '.clooks'))).toBe(true)
    expect(existsSync(join(tempDir, '.clooks', 'clooks.yml'))).toBe(true)
  })

  test('--project --full --force with non-Clooks hooks prints preservation count', async () => {
    setupProject(tempDir)

    // Add a non-Clooks hook alongside Clooks on PreToolUse
    const settings = readSettings(tempDir)
    const hooks = settings.hooks as Record<string, unknown[]>
    hooks['PreToolUse']!.push({ hooks: [{ type: 'command', command: '/my/other/hook.sh' }] })
    writeFileSync(
      join(tempDir, '.claude', 'settings.json'),
      JSON.stringify(settings, null, 2) + '\n',
    )

    const clack = await import('@clack/prompts')
    const infoMock = clack.log.info as unknown as ReturnType<typeof mock>
    infoMock.mockClear()

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--project', '--full', '--force'], { from: 'user' })

    const infoCalls = infoMock.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(infoCalls.some((msg: string) => msg.includes('non-Clooks hook(s) preserved'))).toBe(true)
  })

  test('--project --full --json --force outputs envelope', async () => {
    setupProject(tempDir)

    const program = createTestProgram()
    await program.parseAsync(['--json', 'uninstall', '--project', '--full', '--force'], {
      from: 'user',
    })

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    const parsed = JSON.parse(output.trim())

    expect(parsed).toEqual({
      ok: true,
      command: 'uninstall',
      data: expect.objectContaining({
        scope: 'project',
        agent: 'claude-code',
        agents: ['claude-code'],
        unhooked: true,
        deleted: true,
        customHooksDeleted: [],
        eventsRemoved: expect.any(Array),
        nonClooksPreserved: 0,
        claudeEventsRemoved: expect.any(Array),
        codexEventsRemoved: [],
      }),
    })
    expect(parsed.data.eventsRemoved).toHaveLength(22)
    expect(parsed.data.claudeEventsRemoved).toHaveLength(22)
  })
})

describe('clooks uninstall — force validation', () => {
  test('--project and --global together in interactive mode errors', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true })

    const program = createTestProgram()
    await program
      .parseAsync(['uninstall', '--project', '--global'], { from: 'user' })
      .catch(() => {})

    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  test('--force without action flag errors', async () => {
    const program = createTestProgram()
    await program
      .parseAsync(['uninstall', '--project', '--force'], { from: 'user' })
      .catch(() => {})

    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  test('--force without scope flag errors', async () => {
    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--full', '--force'], { from: 'user' }).catch(() => {})

    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  test('--unhook and --full together errors', async () => {
    const program = createTestProgram()
    await program
      .parseAsync(['uninstall', '--project', '--unhook', '--full', '--force'], { from: 'user' })
      .catch(() => {})

    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  test('invalid --agent value errors clearly', async () => {
    const program = createTestProgram()
    await program
      .parseAsync(['uninstall', '--project', '--agent', 'cursor', '--unhook', '--force'], {
        from: 'user',
      })
      .catch(() => {})

    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})

describe('clooks uninstall — codex agents', () => {
  test('--project --agent codex --unhook --force removes only .codex/hooks.json entries', async () => {
    setupProject(tempDir)
    setupCodexProject(tempDir)

    const claudeBefore = readFileSync(join(tempDir, '.claude', 'settings.json'), 'utf-8')

    const program = createTestProgram()
    await program.parseAsync(
      ['uninstall', '--project', '--agent', 'codex', '--unhook', '--force'],
      {
        from: 'user',
      },
    )

    expect(readFileSync(join(tempDir, '.claude', 'settings.json'), 'utf-8')).toBe(claudeBefore)
    expect(existsSync(join(tempDir, '.clooks'))).toBe(true)
    expect(readCodexHooks(tempDir).hooks).toBeUndefined()
  })

  test('--project --agent codex --unhook --force preserves unrelated Codex hooks', async () => {
    setupCodexProject(tempDir)

    const hooksFile = readCodexHooks(tempDir)
    const hooks = hooksFile.hooks as Record<string, unknown[]>
    const [firstGroup] = hooks['PreToolUse'] as Record<string, unknown>[]
    expect(firstGroup).toBeDefined()
    if (!firstGroup) throw new Error('expected PreToolUse Codex matcher group')
    firstGroup.hooks = [
      ...((firstGroup.hooks as unknown[]) ?? []),
      { type: 'command', command: '/usr/local/bin/unrelated-codex-hook' },
    ]
    writeFileSync(join(tempDir, '.codex', 'hooks.json'), JSON.stringify(hooksFile, null, 2) + '\n')

    const program = createTestProgram()
    await program.parseAsync(
      ['uninstall', '--project', '--agent', 'codex', '--unhook', '--force'],
      {
        from: 'user',
      },
    )

    const updatedHooks = readCodexHooks(tempDir).hooks as Record<string, unknown[]>
    expect(updatedHooks['PreToolUse']).toHaveLength(1)
    const preservedGroup = updatedHooks['PreToolUse']![0] as Record<string, unknown>
    expect(preservedGroup.hooks).toEqual([
      { type: 'command', command: '/usr/local/bin/unrelated-codex-hook' },
    ])
    for (const event of CODEX_REGISTRATION_EVENTS.filter((event) => event !== 'PreToolUse')) {
      expect(updatedHooks[event]).toBeUndefined()
    }
  })

  test('--project --agent all --unhook --force removes Claude and Codex registrations', async () => {
    setupProject(tempDir)
    setupCodexProject(tempDir)

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--project', '--agent', 'all', '--unhook', '--force'], {
      from: 'user',
    })

    expect(readSettings(tempDir).hooks).toBeUndefined()
    expect(readCodexHooks(tempDir).hooks).toBeUndefined()
    expect(existsSync(join(tempDir, '.clooks'))).toBe(true)
  })

  test('--project --agent codex --full --force unhooks all agents before deleting shared .clooks', async () => {
    setupProject(tempDir)
    setupCodexProject(tempDir)

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--project', '--agent', 'codex', '--full', '--force'], {
      from: 'user',
    })

    expect(readSettings(tempDir).hooks).toBeUndefined()
    expect(readCodexHooks(tempDir).hooks).toBeUndefined()
    expect(existsSync(join(tempDir, '.clooks'))).toBe(false)
  })

  test('--project --agent codex --full --force explains all-agent unhooking when shared .clooks is deleted', async () => {
    setupProject(tempDir)
    setupCodexProject(tempDir)

    const clack = await import('@clack/prompts')
    const infoMock = clack.log.info as unknown as ReturnType<typeof mock>
    infoMock.mockClear()

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--project', '--agent', 'codex', '--full', '--force'], {
      from: 'user',
    })

    const infoCalls = infoMock.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(
      infoCalls.some((msg: string) =>
        msg.includes(
          '--full removes all Clooks agent registrations because it deletes the shared .clooks/ entrypoint directory.',
        ),
      ),
    ).toBe(true)
  })

  test('--project --agent all --full --force does not print all-agent widening explanation', async () => {
    setupProject(tempDir)
    setupCodexProject(tempDir)

    const clack = await import('@clack/prompts')
    const infoMock = clack.log.info as unknown as ReturnType<typeof mock>
    infoMock.mockClear()

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--project', '--agent', 'all', '--full', '--force'], {
      from: 'user',
    })

    const infoCalls = infoMock.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(
      infoCalls.some((msg: string) => msg.includes('shared .clooks/ entrypoint directory')),
    ).toBe(false)
  })

  test('--project --agent codex --full --json --force reports codex counts separately', async () => {
    setupCodexProject(tempDir)

    const program = createTestProgram()
    await program.parseAsync(
      ['--json', 'uninstall', '--project', '--agent', 'codex', '--full', '--force'],
      { from: 'user' },
    )

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    const parsed = JSON.parse(output.trim())

    expect(parsed.data.agent).toBe('codex')
    expect(parsed.data.agents).toEqual(['codex'])
    expect(parsed.data.eventsRemoved).toEqual([])
    expect(parsed.data.claudeEventsRemoved).toEqual([])
    expect(parsed.data.codexEventsRemoved).toHaveLength(CODEX_REGISTRATION_EVENTS.length)
    expect(parsed.data.deleted).toBe(true)
  })

  test('--project --agent codex --full --force human output omits unregistered agent zero-count lines', async () => {
    setupCodexProject(tempDir)

    const clack = await import('@clack/prompts')
    const successMock = clack.log.success as unknown as ReturnType<typeof mock>
    successMock.mockClear()

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--project', '--agent', 'codex', '--full', '--force'], {
      from: 'user',
    })

    const successCalls = successMock.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(
      successCalls.some((msg: string) =>
        msg.includes('Removed Clooks hooks from .claude/settings.json (0 events).'),
      ),
    ).toBe(false)
    expect(
      successCalls.some((msg: string) =>
        msg.includes(
          `Removed Clooks hooks from .codex/hooks.json (${CODEX_REGISTRATION_EVENTS.length} events).`,
        ),
      ),
    ).toBe(true)
  })

  test('--project --agent codex --full --json --force reports Claude too when present', async () => {
    setupProject(tempDir)
    setupCodexProject(tempDir)

    const program = createTestProgram()
    await program.parseAsync(
      ['--json', 'uninstall', '--project', '--agent', 'codex', '--full', '--force'],
      { from: 'user' },
    )

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    const parsed = JSON.parse(output.trim())

    expect(parsed.data.agent).toBe('codex')
    expect(parsed.data.claudeEventsRemoved).toHaveLength(22)
    expect(parsed.data.codexEventsRemoved).toHaveLength(CODEX_REGISTRATION_EVENTS.length)
    expect(parsed.data.eventsRemoved).toHaveLength(22)
  })

  test('--project --agent claude-code --unhook --force preserves Codex registration', async () => {
    setupProject(tempDir)
    setupCodexProject(tempDir)
    const codexBefore = readFileSync(join(tempDir, '.codex', 'hooks.json'), 'utf-8')

    const program = createTestProgram()
    await program.parseAsync(
      ['uninstall', '--project', '--agent', 'claude-code', '--unhook', '--force'],
      { from: 'user' },
    )

    expect(readSettings(tempDir).hooks).toBeUndefined()
    expect(readFileSync(join(tempDir, '.codex', 'hooks.json'), 'utf-8')).toBe(codexBefore)
  })

  test('--project --agent codex --unhook --force human no-op is clear in Claude-only setup', async () => {
    setupProject(tempDir)

    const clack = await import('@clack/prompts')
    const infoMock = clack.log.info as unknown as ReturnType<typeof mock>
    infoMock.mockClear()

    const program = createTestProgram()
    await program.parseAsync(
      ['uninstall', '--project', '--agent', 'codex', '--unhook', '--force'],
      {
        from: 'user',
      },
    )

    const infoCalls = infoMock.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(
      infoCalls.some((msg: string) =>
        msg.includes('No Codex Clooks hook registrations found. Nothing changed.'),
      ),
    ).toBe(true)
  })

  test('--project --agent codex --unhook --force human output reports Codex count', async () => {
    setupCodexProject(tempDir)

    const clack = await import('@clack/prompts')
    const successMock = clack.log.success as unknown as ReturnType<typeof mock>
    successMock.mockClear()

    const program = createTestProgram()
    await program.parseAsync(
      ['uninstall', '--project', '--agent', 'codex', '--unhook', '--force'],
      {
        from: 'user',
      },
    )

    const successCalls = successMock.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(
      successCalls.some((msg: string) =>
        msg.includes(
          `Removed Clooks hooks from .codex/hooks.json (${CODEX_REGISTRATION_EVENTS.length} events).`,
        ),
      ),
    ).toBe(true)
  })

  test('--project --agent all --unhook --json --force reports Claude and Codex counts', async () => {
    setupProject(tempDir)
    setupCodexProject(tempDir)

    const program = createTestProgram()
    await program.parseAsync(
      ['--json', 'uninstall', '--project', '--agent', 'all', '--unhook', '--force'],
      { from: 'user' },
    )

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    const parsed = JSON.parse(output.trim())
    expect(parsed.data.agent).toBe('all')
    expect(parsed.data.agents).toEqual(['claude-code', 'codex'])
    expect(parsed.data.claudeEventsRemoved).toHaveLength(22)
    expect(parsed.data.codexEventsRemoved).toHaveLength(CODEX_REGISTRATION_EVENTS.length)
  })

  test('--project --agent all --unhook --force human output reports separate counts', async () => {
    setupProject(tempDir)
    setupCodexProject(tempDir)

    const clack = await import('@clack/prompts')
    const successMock = clack.log.success as unknown as ReturnType<typeof mock>
    successMock.mockClear()

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--project', '--agent', 'all', '--unhook', '--force'], {
      from: 'user',
    })

    const successCalls = successMock.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(
      successCalls.some((msg: string) =>
        msg.includes('Removed Clooks hooks from .claude/settings.json (22 events).'),
      ),
    ).toBe(true)
    expect(
      successCalls.some((msg: string) =>
        msg.includes(
          `Removed Clooks hooks from .codex/hooks.json (${CODEX_REGISTRATION_EVENTS.length} events).`,
        ),
      ),
    ).toBe(true)
  })

  test('omitted --agent remains Claude-only and preserves Codex registration', async () => {
    setupProject(tempDir)
    setupCodexProject(tempDir)

    const codexBefore = readFileSync(join(tempDir, '.codex', 'hooks.json'), 'utf-8')

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--project', '--unhook', '--force'], { from: 'user' })

    expect(readSettings(tempDir).hooks).toBeUndefined()
    expect(readFileSync(join(tempDir, '.codex', 'hooks.json'), 'utf-8')).toBe(codexBefore)
  })

  test('--project --agent codex --unhook --force JSON no-op when only Claude is registered', async () => {
    setupProject(tempDir)

    const program = createTestProgram()
    await program.parseAsync(
      ['--json', 'uninstall', '--project', '--agent', 'codex', '--unhook', '--force'],
      { from: 'user' },
    )

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    const parsed = JSON.parse(output.trim())
    expect(parsed.data).toEqual(
      expect.objectContaining({
        agent: 'codex',
        agents: ['codex'],
        unhooked: false,
        deleted: false,
        claudeEventsRemoved: [],
        codexEventsRemoved: [],
      }),
    )
    expect(readSettings(tempDir).hooks).toBeDefined()
  })
})

describe('clooks uninstall — non-interactive guard', () => {
  test('non-interactive without --force errors', async () => {
    const program = createTestProgram()
    await program.parseAsync(['--json', 'uninstall', '--project'], { from: 'user' }).catch(() => {})

    expect(exitSpy).toHaveBeenCalledWith(1)

    // Find the JSON error envelope in stdout calls
    const calls = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0]))
    const jsonLine = calls.find((s: string) => s.includes('"ok"'))
    expect(jsonLine).toBeDefined()
    const parsed = JSON.parse(jsonLine!.trim())
    expect(parsed.ok).toBe(false)
    expect(parsed.error).toContain('requires --force')
  })
})

describe('clooks uninstall — interactive mode', () => {
  test('--project declines both unhook and delete prints "Nothing changed."', async () => {
    setupProject(tempDir)

    const clack = await import('@clack/prompts')
    const confirmMock = clack.confirm as unknown as ReturnType<typeof mock>
    confirmMock.mockImplementationOnce(() => false) // decline unhook
    confirmMock.mockImplementationOnce(() => false) // decline delete

    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true })

    const infoMock = clack.log.info as unknown as ReturnType<typeof mock>
    infoMock.mockClear()

    const settingsBefore = readFileSync(join(tempDir, '.claude', 'settings.json'), 'utf-8')

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--project'], { from: 'user' })

    const infoCalls = infoMock.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(infoCalls.some((msg: string) => msg.includes('Nothing changed.'))).toBe(true)

    // settings.json unchanged
    const settingsAfter = readFileSync(join(tempDir, '.claude', 'settings.json'), 'utf-8')
    expect(settingsAfter).toBe(settingsBefore)

    // .clooks/ still exists
    expect(existsSync(join(tempDir, '.clooks'))).toBe(true)
  })

  test('--project unhook-only when user declines delete', async () => {
    setupProject(tempDir)

    const { confirm } = await import('@clack/prompts')
    const confirmMock = confirm as unknown as ReturnType<typeof mock>
    confirmMock.mockImplementationOnce(() => true) // unhook
    confirmMock.mockImplementationOnce(() => false) // don't delete

    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true })

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--project'], { from: 'user' })

    // settings.json should be cleaned
    const settings = readSettings(tempDir)
    expect(settings.hooks).toBeUndefined()

    // .clooks/ should still exist
    expect(existsSync(join(tempDir, '.clooks'))).toBe(true)
  })

  test('--project warns about custom hooks before deletion', async () => {
    setupProject(tempDir)
    writeFileSync(join(tempDir, '.clooks', 'hooks', 'my-hook.ts'), 'export default {}')

    const { confirm } = await import('@clack/prompts')
    const confirmMock = confirm as unknown as ReturnType<typeof mock>
    confirmMock.mockImplementationOnce(() => true) // unhook
    confirmMock.mockImplementationOnce(() => true) // delete

    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true })

    const clack = await import('@clack/prompts')
    const warningMock = clack.log.warning as unknown as ReturnType<typeof mock>
    warningMock.mockClear()

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--project'], { from: 'user' })

    // log.warning should have been called with a string containing my-hook.ts
    const warningCalls = warningMock.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(warningCalls.some((msg: string) => msg.includes('my-hook.ts'))).toBe(true)
  })

  test('--project cancel exits cleanly with no partial state', async () => {
    setupProject(tempDir)
    const settingsBefore = readFileSync(join(tempDir, '.claude', 'settings.json'), 'utf-8')

    const clack = await import('@clack/prompts')
    const confirmMock = clack.confirm as unknown as ReturnType<typeof mock>
    const isCancelMock = clack.isCancel as unknown as ReturnType<typeof mock>
    const cancelSymbol = Symbol('clack:cancel')
    confirmMock.mockImplementationOnce(() => cancelSymbol)
    isCancelMock.mockImplementationOnce(() => true)

    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true })

    const program = createTestProgram()
    let threw = false
    try {
      await program.parseAsync(['uninstall', '--project'], { from: 'user' })
    } catch (e) {
      if (e instanceof Error && e.name === 'CancelError') {
        threw = true
      }
    }

    expect(threw).toBe(true)
    // settings.json should be UNCHANGED
    const settingsAfter = readFileSync(join(tempDir, '.claude', 'settings.json'), 'utf-8')
    expect(settingsAfter).toBe(settingsBefore)
  })

  test('--project cancel on delete prompt exits cleanly with no partial state', async () => {
    setupProject(tempDir)
    const settingsBefore = readFileSync(join(tempDir, '.claude', 'settings.json'), 'utf-8')

    const clack = await import('@clack/prompts')
    const confirmMock = clack.confirm as unknown as ReturnType<typeof mock>
    const isCancelMock = clack.isCancel as unknown as ReturnType<typeof mock>
    const cancelSymbol = Symbol('clack:cancel')

    // First call: confirm unhook (true), second call: cancel on delete
    confirmMock.mockImplementationOnce(() => true)
    confirmMock.mockImplementationOnce(() => cancelSymbol)
    isCancelMock.mockImplementationOnce(() => false)
    isCancelMock.mockImplementationOnce(() => true)

    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true })

    const program = createTestProgram()
    let threw = false
    try {
      await program.parseAsync(['uninstall', '--project'], { from: 'user' })
    } catch (e) {
      if (e instanceof Error && e.name === 'CancelError') {
        threw = true
      }
    }

    expect(threw).toBe(true)
    // settings.json should be UNCHANGED (batch execution — no unhook happened even though user confirmed it)
    const settingsAfter = readFileSync(join(tempDir, '.claude', 'settings.json'), 'utf-8')
    expect(settingsAfter).toBe(settingsBefore)
  })

  test('--project already unhooked but .clooks/ exists', async () => {
    // Create .clooks/ directory but do NOT register in settings.json
    mkdirSync(join(tempDir, '.clooks', 'hooks'), { recursive: true })
    writeFileSync(join(tempDir, '.clooks', 'clooks.yml'), 'version: "1.0.0"\n')

    const { confirm } = await import('@clack/prompts')
    const confirmMock = confirm as unknown as ReturnType<typeof mock>
    confirmMock.mockImplementationOnce(() => true) // delete

    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true })

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--project'], { from: 'user' })

    // .clooks/ should be deleted
    expect(existsSync(join(tempDir, '.clooks'))).toBe(false)
  })
})

describe('clooks uninstall — general', () => {
  test('--project --full --force with only types.d.ts lists no custom hooks', async () => {
    setupProject(tempDir)

    const program = createTestProgram()
    await program.parseAsync(['--json', 'uninstall', '--project', '--full', '--force'], {
      from: 'user',
    })

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    const parsed = JSON.parse(output.trim())
    expect(parsed.data.customHooksDeleted).toEqual([])
  })

  test('--project --full --force JSON no-op when not initialized', async () => {
    // No .clooks/, no settings.json
    const program = createTestProgram()
    await program.parseAsync(['--json', 'uninstall', '--project', '--full', '--force'], {
      from: 'user',
    })

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    const parsed = JSON.parse(output.trim())
    expect(parsed).toEqual({
      ok: true,
      command: 'uninstall',
      data: expect.objectContaining({
        scope: 'project',
        agent: 'claude-code',
        agents: ['claude-code'],
        unhooked: false,
        deleted: false,
        customHooksDeleted: [],
        eventsRemoved: [],
        claudeEventsRemoved: [],
        codexEventsRemoved: [],
      }),
    })
  })

  test('detectCustomHooks excludes subdirectories', async () => {
    setupProject(tempDir)
    mkdirSync(join(tempDir, '.clooks', 'hooks', 'utils'), { recursive: true })
    writeFileSync(join(tempDir, '.clooks', 'hooks', 'my-hook.ts'), 'export default {}')

    const program = createTestProgram()
    await program.parseAsync(['--json', 'uninstall', '--project', '--full', '--force'], {
      from: 'user',
    })

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    const parsed = JSON.parse(output.trim())
    expect(parsed.data.customHooksDeleted).toContain('my-hook.ts')
    expect(parsed.data.customHooksDeleted).not.toContain('utils')
  })

  test('--project no-op when not initialized', async () => {
    // No .clooks/, no Clooks in settings.json
    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true })

    const clack = await import('@clack/prompts')
    const infoMock = clack.log.info as unknown as ReturnType<typeof mock>
    infoMock.mockClear()

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--project'], { from: 'user' })

    expect(exitSpy).not.toHaveBeenCalled()

    const infoCalls = infoMock.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(infoCalls.some((msg: string) => msg.includes('Nothing to uninstall'))).toBe(true)
  })

  test('--project --full --force idempotent', async () => {
    setupProject(tempDir)

    // First run
    const program1 = createTestProgram()
    await program1.parseAsync(['uninstall', '--project', '--full', '--force'], { from: 'user' })

    // Second run
    const clack = await import('@clack/prompts')
    const infoMock = clack.log.info as unknown as ReturnType<typeof mock>
    infoMock.mockClear()

    const program2 = createTestProgram()
    await program2.parseAsync(['uninstall', '--project', '--full', '--force'], { from: 'user' })

    // Second run should not error
    expect(exitSpy).not.toHaveBeenCalled()

    // Should print "Nothing to uninstall."
    const infoCalls = infoMock.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(infoCalls.some((msg: string) => msg.includes('Nothing to uninstall'))).toBe(true)
  })

  test('action flags ignored in interactive mode', async () => {
    setupProject(tempDir)

    const { confirm } = await import('@clack/prompts')
    const confirmMock = confirm as unknown as ReturnType<typeof mock>
    confirmMock.mockClear()
    confirmMock.mockImplementationOnce(() => true) // unhook
    confirmMock.mockImplementationOnce(() => false) // don't delete

    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true })

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--project', '--unhook'], { from: 'user' })

    // confirm should have been called (flags don't suppress prompts)
    expect(confirmMock).toHaveBeenCalled()
  })

  test('--project --full --force with custom hooks lists them in JSON', async () => {
    setupProject(tempDir)
    writeFileSync(join(tempDir, '.clooks', 'hooks', 'my-hook.ts'), 'export default {}')

    const program = createTestProgram()
    await program.parseAsync(['--json', 'uninstall', '--project', '--full', '--force'], {
      from: 'user',
    })

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    const parsed = JSON.parse(output.trim())
    expect(parsed.data.customHooksDeleted).toContain('my-hook.ts')
  })
})

// Helper to set up a global Clooks installation
function setupGlobal(homeRoot: string) {
  mkdirSync(join(homeRoot, '.clooks', 'hooks'), { recursive: true })
  mkdirSync(join(homeRoot, '.clooks', 'bin'), { recursive: true })
  mkdirSync(join(homeRoot, '.clooks', 'vendor'), { recursive: true })
  writeFileSync(join(homeRoot, '.clooks', 'clooks.yml'), 'version: "1.0.0"\nconfig: {}\n')
  writeFileSync(join(homeRoot, '.clooks', 'hooks', 'types.d.ts'), '// generated types\n')
  writeFileSync(join(homeRoot, '.clooks', 'bin', 'entrypoint.sh'), '#!/bin/bash\n')
  const globalEntrypointCommand = join(homeRoot, '.clooks/bin/entrypoint.sh')
  registerClooks(join(homeRoot, '.claude'), globalEntrypointCommand)
}

function setupCodexGlobal(homeRoot: string) {
  mkdirSync(join(homeRoot, '.clooks', 'hooks'), { recursive: true })
  mkdirSync(join(homeRoot, '.clooks', 'bin'), { recursive: true })
  mkdirSync(join(homeRoot, '.clooks', 'vendor'), { recursive: true })
  writeFileSync(join(homeRoot, '.clooks', 'clooks.yml'), 'version: "1.0.0"\nconfig: {}\n')
  writeFileSync(join(homeRoot, '.clooks', 'hooks', 'types.d.ts'), '// generated types\n')
  writeFileSync(join(homeRoot, '.clooks', 'bin', 'entrypoint.sh'), '#!/bin/bash\n')
  registerCodexClooks(join(homeRoot, '.codex'), makeCodexGlobalEntrypointCommand(homeRoot))
}

function readHomeSettings(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(fakeHome, '.claude', 'settings.json'), 'utf-8'))
}

function readHomeCodexHooks(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(fakeHome, '.codex', 'hooks.json'), 'utf-8'))
}

describe('clooks uninstall — global scope', () => {
  test('--global --full --force JSON no-op when not initialized', async () => {
    // No ~/.clooks/, no ~/.claude/settings.json
    const program = createTestProgram()
    await program.parseAsync(['--json', 'uninstall', '--global', '--full', '--force'], {
      from: 'user',
    })

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    const parsed = JSON.parse(output.trim())
    expect(parsed).toEqual({
      ok: true,
      command: 'uninstall',
      data: expect.objectContaining({
        scope: 'global',
        agent: 'claude-code',
        agents: ['claude-code'],
        unhooked: false,
        deleted: false,
        customHooksDeleted: [],
        eventsRemoved: [],
        claudeEventsRemoved: [],
        codexEventsRemoved: [],
      }),
    })
  })

  test('--global --full --force with custom hooks lists them in JSON', async () => {
    setupGlobal(fakeHome)
    writeFileSync(join(fakeHome, '.clooks', 'hooks', 'my-hook.ts'), 'export default {}')

    const program = createTestProgram()
    await program.parseAsync(['--json', 'uninstall', '--global', '--full', '--force'], {
      from: 'user',
    })

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    const parsed = JSON.parse(output.trim())
    expect(parsed.data.customHooksDeleted).toContain('my-hook.ts')
  })

  test('--global unhook-only when user declines delete (interactive)', async () => {
    setupGlobal(fakeHome)

    const clack = await import('@clack/prompts')
    const confirmMock = clack.confirm as unknown as ReturnType<typeof mock>
    confirmMock.mockImplementationOnce(() => true) // unhook
    confirmMock.mockImplementationOnce(() => false) // don't delete

    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true })

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--global'], { from: 'user' })

    // ~/.claude/settings.json should be cleaned
    const settings = readHomeSettings()
    expect(settings.hooks).toBeUndefined()

    // ~/.clooks/ should still exist
    expect(existsSync(join(fakeHome, '.clooks'))).toBe(true)
  })

  test('--global --full --force removes ~/.claude/settings.json hooks and ~/.clooks/', async () => {
    setupGlobal(fakeHome)

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--global', '--full', '--force'], { from: 'user' })

    // ~/.claude/settings.json should have no Clooks hooks
    const settings = readHomeSettings()
    expect(settings.hooks).toBeUndefined()

    // ~/.clooks/ should not exist
    expect(existsSync(join(fakeHome, '.clooks'))).toBe(false)

    expect(exitSpy).not.toHaveBeenCalled()
  })

  test('--global --unhook --force only removes ~/.claude/settings.json entries', async () => {
    setupGlobal(fakeHome)

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--global', '--unhook', '--force'], { from: 'user' })

    // settings cleaned
    const settings = readHomeSettings()
    expect(settings.hooks).toBeUndefined()

    // ~/.clooks/ should still exist
    expect(existsSync(join(fakeHome, '.clooks'))).toBe(true)
    expect(existsSync(join(fakeHome, '.clooks', 'clooks.yml'))).toBe(true)
  })

  test('--global --full --force recovery messaging references init --global', async () => {
    setupGlobal(fakeHome)

    const clack = await import('@clack/prompts')
    const infoMock = clack.log.info as unknown as ReturnType<typeof mock>
    infoMock.mockClear()

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--global', '--full', '--force'], { from: 'user' })

    const infoCalls = infoMock.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(infoCalls.some((msg: string) => msg.includes('clooks init --global'))).toBe(true)
  })

  test('--global no-op when not initialized', async () => {
    // No ~/.clooks/, no Clooks in ~/.claude/settings.json
    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true })

    const clack = await import('@clack/prompts')
    const infoMock = clack.log.info as unknown as ReturnType<typeof mock>
    infoMock.mockClear()

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--global'], { from: 'user' })

    expect(exitSpy).not.toHaveBeenCalled()

    const infoCalls = infoMock.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(infoCalls.some((msg: string) => msg.includes('Nothing to uninstall'))).toBe(true)
  })

  test('--global --full --json --force outputs envelope with scope global', async () => {
    setupGlobal(fakeHome)

    const program = createTestProgram()
    await program.parseAsync(['--json', 'uninstall', '--global', '--full', '--force'], {
      from: 'user',
    })

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    const parsed = JSON.parse(output.trim())

    expect(parsed.data.scope).toBe('global')
    expect(parsed.ok).toBe(true)
    expect(parsed.data.unhooked).toBe(true)
    expect(parsed.data.deleted).toBe(true)
  })

  test('--global --agent codex --unhook --force removes Codex registration and codex flag only', async () => {
    setupGlobal(fakeHome)
    setupCodexGlobal(fakeHome)
    writeFileSync(join(fakeHome, '.clooks', '.global-entrypoint-active'), '')
    writeFileSync(join(fakeHome, '.clooks', '.global-entrypoint-active.codex'), '')

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--global', '--agent', 'codex', '--unhook', '--force'], {
      from: 'user',
    })

    expect(readHomeSettings().hooks).toBeDefined()
    expect(readHomeCodexHooks().hooks).toBeUndefined()
    expect(existsSync(join(fakeHome, '.clooks', '.global-entrypoint-active'))).toBe(true)
    expect(existsSync(join(fakeHome, '.clooks', '.global-entrypoint-active.codex'))).toBe(false)
    expect(existsSync(join(fakeHome, '.clooks'))).toBe(true)
  })

  test('--global omitted agent --unhook --force preserves Codex registration and flag', async () => {
    setupGlobal(fakeHome)
    setupCodexGlobal(fakeHome)
    writeFileSync(join(fakeHome, '.clooks', '.global-entrypoint-active'), '')
    writeFileSync(join(fakeHome, '.clooks', '.global-entrypoint-active.codex'), '')
    const codexBefore = readFileSync(join(fakeHome, '.codex', 'hooks.json'), 'utf-8')

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--global', '--unhook', '--force'], { from: 'user' })

    expect(readHomeSettings().hooks).toBeUndefined()
    expect(readFileSync(join(fakeHome, '.codex', 'hooks.json'), 'utf-8')).toBe(codexBefore)
    expect(existsSync(join(fakeHome, '.clooks', '.global-entrypoint-active.codex'))).toBe(true)
  })

  test('--global --agent claude-code --unhook --force preserves Codex registration and flag', async () => {
    setupGlobal(fakeHome)
    setupCodexGlobal(fakeHome)
    writeFileSync(join(fakeHome, '.clooks', '.global-entrypoint-active'), '')
    writeFileSync(join(fakeHome, '.clooks', '.global-entrypoint-active.codex'), '')
    const codexBefore = readFileSync(join(fakeHome, '.codex', 'hooks.json'), 'utf-8')

    const program = createTestProgram()
    await program.parseAsync(
      ['uninstall', '--global', '--agent', 'claude-code', '--unhook', '--force'],
      { from: 'user' },
    )

    expect(readHomeSettings().hooks).toBeUndefined()
    expect(readFileSync(join(fakeHome, '.codex', 'hooks.json'), 'utf-8')).toBe(codexBefore)
    expect(existsSync(join(fakeHome, '.clooks', '.global-entrypoint-active.codex'))).toBe(true)
  })

  test('--global --agent codex --full --force unhooks all agents before deleting shared .clooks', async () => {
    setupGlobal(fakeHome)
    setupCodexGlobal(fakeHome)
    writeFileSync(join(fakeHome, '.clooks', '.global-entrypoint-active'), '')
    writeFileSync(join(fakeHome, '.clooks', '.global-entrypoint-active.codex'), '')

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--global', '--agent', 'codex', '--full', '--force'], {
      from: 'user',
    })

    expect(readHomeSettings().hooks).toBeUndefined()
    expect(readHomeCodexHooks().hooks).toBeUndefined()
    expect(existsSync(join(fakeHome, '.clooks'))).toBe(false)
  })

  test('--global --agent codex --full --force explains all-agent unhooking when shared ~/.clooks is deleted', async () => {
    setupGlobal(fakeHome)
    setupCodexGlobal(fakeHome)

    const clack = await import('@clack/prompts')
    const infoMock = clack.log.info as unknown as ReturnType<typeof mock>
    infoMock.mockClear()

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--global', '--agent', 'codex', '--full', '--force'], {
      from: 'user',
    })

    const infoCalls = infoMock.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(
      infoCalls.some((msg: string) =>
        msg.includes(
          '--full removes all Clooks agent registrations because it deletes the shared ~/.clooks/ entrypoint directory.',
        ),
      ),
    ).toBe(true)
  })

  test('--global --agent codex --unhook --force human no-op is clear in Claude-only setup', async () => {
    setupGlobal(fakeHome)

    const clack = await import('@clack/prompts')
    const infoMock = clack.log.info as unknown as ReturnType<typeof mock>
    infoMock.mockClear()

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--global', '--agent', 'codex', '--unhook', '--force'], {
      from: 'user',
    })

    const infoCalls = infoMock.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(
      infoCalls.some((msg: string) =>
        msg.includes('No Codex global Clooks hook registrations found. Nothing changed.'),
      ),
    ).toBe(true)
  })

  test('--global --agent all --unhook --json --force reports Claude and Codex counts', async () => {
    setupGlobal(fakeHome)
    setupCodexGlobal(fakeHome)

    const program = createTestProgram()
    await program.parseAsync(
      ['--json', 'uninstall', '--global', '--agent', 'all', '--unhook', '--force'],
      { from: 'user' },
    )

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    const parsed = JSON.parse(output.trim())
    expect(parsed.data.agent).toBe('all')
    expect(parsed.data.claudeEventsRemoved).toHaveLength(22)
    expect(parsed.data.codexEventsRemoved).toHaveLength(CODEX_REGISTRATION_EVENTS.length)
  })

  test('--global --agent all --unhook --force human output reports separate counts', async () => {
    setupGlobal(fakeHome)
    setupCodexGlobal(fakeHome)

    const clack = await import('@clack/prompts')
    const successMock = clack.log.success as unknown as ReturnType<typeof mock>
    successMock.mockClear()

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--global', '--agent', 'all', '--unhook', '--force'], {
      from: 'user',
    })

    const successCalls = successMock.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(
      successCalls.some((msg: string) =>
        msg.includes('Removed Clooks hooks from ~/.claude/settings.json (22 events).'),
      ),
    ).toBe(true)
    expect(
      successCalls.some((msg: string) =>
        msg.includes(
          `Removed Clooks hooks from ~/.codex/hooks.json (${CODEX_REGISTRATION_EVENTS.length} events).`,
        ),
      ),
    ).toBe(true)
  })

  test('--global --agent all --unhook --force removes both registrations and both flags', async () => {
    setupGlobal(fakeHome)
    setupCodexGlobal(fakeHome)
    writeFileSync(join(fakeHome, '.clooks', '.global-entrypoint-active'), '')
    writeFileSync(join(fakeHome, '.clooks', '.global-entrypoint-active.codex'), '')

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--global', '--agent', 'all', '--unhook', '--force'], {
      from: 'user',
    })

    expect(readHomeSettings().hooks).toBeUndefined()
    expect(readHomeCodexHooks().hooks).toBeUndefined()
    expect(existsSync(join(fakeHome, '.clooks', '.global-entrypoint-active'))).toBe(false)
    expect(existsSync(join(fakeHome, '.clooks', '.global-entrypoint-active.codex'))).toBe(false)
  })

  test('--global --agent codex --unhook --json --force reports global flag removal', async () => {
    setupCodexGlobal(fakeHome)
    writeFileSync(join(fakeHome, '.clooks', '.global-entrypoint-active.codex'), '')

    const program = createTestProgram()
    await program.parseAsync(
      ['--json', 'uninstall', '--global', '--agent', 'codex', '--unhook', '--force'],
      { from: 'user' },
    )

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    const parsed = JSON.parse(output.trim())

    expect(parsed.data.agent).toBe('codex')
    expect(parsed.data.codexEventsRemoved).toHaveLength(CODEX_REGISTRATION_EVENTS.length)
    expect(parsed.data.globalFlagsRemoved).toEqual(['codex'])
  })

  test('--global --agent codex --unhook --force human output omits hook zero-count line when only flag is removed', async () => {
    mkdirSync(join(fakeHome, '.clooks'), { recursive: true })
    writeFileSync(join(fakeHome, '.clooks', '.global-entrypoint-active.codex'), '')

    const clack = await import('@clack/prompts')
    const successMock = clack.log.success as unknown as ReturnType<typeof mock>
    const infoMock = clack.log.info as unknown as ReturnType<typeof mock>
    successMock.mockClear()
    infoMock.mockClear()

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--global', '--agent', 'codex', '--unhook', '--force'], {
      from: 'user',
    })

    const successCalls = successMock.mock.calls.map((c: unknown[]) => String(c[0]))
    const infoCalls = infoMock.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(
      successCalls.some((msg: string) =>
        msg.includes('Removed Clooks hooks from ~/.codex/hooks.json (0 events).'),
      ),
    ).toBe(false)
    expect(
      infoCalls.some((msg: string) => msg.includes('Removed 1 global entrypoint flag(s).')),
    ).toBe(true)
  })

  test('--project and --global together errors', async () => {
    const program = createTestProgram()
    await program
      .parseAsync(['uninstall', '--project', '--global', '--full', '--force'], { from: 'user' })
      .catch(() => {})

    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})

describe('clooks uninstall — scope picker', () => {
  test('no flags in interactive mode shows scope picker', async () => {
    setupProject(tempDir)

    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true })

    const clack = await import('@clack/prompts')
    const selectMock = clack.select as unknown as ReturnType<typeof mock>
    selectMock.mockImplementationOnce(() => 'project')

    const confirmMock = clack.confirm as unknown as ReturnType<typeof mock>
    confirmMock.mockImplementationOnce(() => true) // unhook
    confirmMock.mockImplementationOnce(() => true) // delete

    const program = createTestProgram()
    await program.parseAsync(['uninstall'], { from: 'user' })

    // select was called
    expect(selectMock).toHaveBeenCalled()

    // project was uninstalled
    expect(existsSync(join(tempDir, '.clooks'))).toBe(false)
  })

  test("scope picker with 'both' uninstalls project and global", async () => {
    setupProject(tempDir)
    setupGlobal(fakeHome)

    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true })

    const clack = await import('@clack/prompts')
    const selectMock = clack.select as unknown as ReturnType<typeof mock>
    selectMock.mockImplementationOnce(() => 'both')

    const confirmMock = clack.confirm as unknown as ReturnType<typeof mock>
    // Project: unhook + delete
    confirmMock.mockImplementationOnce(() => true)
    confirmMock.mockImplementationOnce(() => true)
    // Global: unhook + delete
    confirmMock.mockImplementationOnce(() => true)
    confirmMock.mockImplementationOnce(() => true)

    const program = createTestProgram()
    await program.parseAsync(['uninstall'], { from: 'user' })

    // Both project and global should be uninstalled
    expect(existsSync(join(tempDir, '.clooks'))).toBe(false)
    expect(existsSync(join(fakeHome, '.clooks'))).toBe(false)
  })

  test('no flags in non-interactive mode errors', async () => {
    const program = createTestProgram()
    await program.parseAsync(['--json', 'uninstall'], { from: 'user' }).catch(() => {})

    expect(exitSpy).toHaveBeenCalledWith(1)

    const calls = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0]))
    const jsonLine = calls.find((s: string) => s.includes('"ok"'))
    expect(jsonLine).toBeDefined()
    const parsed = JSON.parse(jsonLine!.trim())
    expect(parsed.ok).toBe(false)
    expect(parsed.error).toContain('requires --force')
  })
})
