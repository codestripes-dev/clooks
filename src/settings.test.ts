import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { symlinkSync, readlinkSync, statSync } from 'fs'
import {
  registerClooks,
  unregisterClooks,
  isClooksRegistered,
  isClooksHook,
  CLOOKS_ENTRYPOINT_PATH,
} from './settings.js'

let tempDir: string

describe('registration preservation', () => {
  test('no-op registration preserves noncanonical JSON bytes and inode', () => {
    const command = CLOOKS_ENTRYPOINT_PATH
    registerClooks(claudeDir(), command)
    const bytes = '\t' + JSON.stringify(readSettings()) + '  \n\n'
    writeFileSync(settingsPath(), bytes)
    const inode = statSync(settingsPath()).ino
    const result = registerClooks(claudeDir(), command)
    expect(result.added).toEqual([])
    expect(result.updated).toEqual([])
    expect(readFileSync(settingsPath(), 'utf8')).toBe(bytes)
    expect(statSync(settingsPath()).ino).toBe(inode)
  })

  test('no-op unregistration preserves noncanonical JSON bytes and inode', () => {
    mkdirSync(claudeDir(), { recursive: true })
    const bytes =
      '\t{ "hooks" : { "Stop": [ { "hooks": [] } ], "SessionStart": [] }, "keep": true }  \n'
    writeFileSync(settingsPath(), bytes)
    const inode = statSync(settingsPath()).ino
    expect(unregisterClooks(claudeDir()).removed).toEqual([])
    expect(readFileSync(settingsPath(), 'utf8')).toBe(bytes)
    expect(statSync(settingsPath()).ino).toBe(inode)
  })

  test('inspection validates later unknown events before returning an early owned match', () => {
    const owned = { hooks: [{ type: 'command', command: CLOOKS_ENTRYPOINT_PATH }] }
    writeSettings({ hooks: { SessionStart: [owned], FutureEvent: [] } })
    expect(isClooksRegistered(claudeDir())).toBe(true)
    writeSettings({ hooks: { SessionStart: [owned], FutureEvent: [{ hooks: null }] } })
    const bytes = readFileSync(settingsPath(), 'utf8')
    expect(() => isClooksRegistered(claudeDir())).toThrow('hooks.FutureEvent[0].hooks')
    expect(readFileSync(settingsPath(), 'utf8')).toBe(bytes)
  })

  const invalid = [
    'null',
    '[]',
    '1',
    'true',
    '"value"',
    '{ invalid',
    '{"hooks":null}',
    '{"hooks":[]}',
    '{"hooks":42}',
    '{"hooks":{"Stop":null}}',
    '{"hooks":{"Stop":{}}}',
    '{"hooks":{"Stop":[null]}}',
    '{"hooks":{"Stop":[[]]}}',
    '{"hooks":{"Stop":[{}]}}',
    '{"hooks":{"Stop":[{"hooks":null}]}}',
    '{"hooks":{"Stop":[{"hooks":{}}]}}',
    '{"hooks":{"Stop":[{"hooks":[null]}]}}',
    '{"hooks":{"Stop":[{"hooks":[[]]}]}}',
    '{"hooks":{"Stop":[{"hooks":[1]}]}}',
  ]
  for (const contents of invalid) {
    test(`rejects malformed containers without writes: ${contents}`, () => {
      mkdirSync(claudeDir(), { recursive: true })
      const bytes = ' \n' + contents + '\n '
      writeFileSync(settingsPath(), bytes)
      for (const operation of [
        () => registerClooks(claudeDir(), CLOOKS_ENTRYPOINT_PATH),
        () => unregisterClooks(claudeDir()),
        () => isClooksRegistered(claudeDir()),
      ]) {
        expect(operation).toThrow(settingsPath())
        expect(readFileSync(settingsPath(), 'utf8')).toBe(bytes)
      }
    })
  }

  test('preserves unknown values, empty groups and mixed metadata through init and unhook', () => {
    const unrelated = { type: 'prompt', prompt: 'retain', extension: { enabled: true } }
    const empty = { hooks: [], extension: [1, null] }
    const metadata = { matcher: 'Bash', custom: { keep: ['all'] } }
    writeSettings({
      extension: { nested: [null, false] },
      hooks: {
        FutureEvent: { opaque: ['not traversed'] },
        PreToolUse: [
          empty,
          { ...metadata, hooks: [{ type: 'command', command: CLOOKS_ENTRYPOINT_PATH }, unrelated] },
        ],
        Stop: [],
      },
    })
    registerClooks(claudeDir(), CLOOKS_ENTRYPOINT_PATH)
    const registered = readFileSync(settingsPath(), 'utf8')
    registerClooks(claudeDir(), CLOOKS_ENTRYPOINT_PATH)
    expect(readFileSync(settingsPath(), 'utf8')).toBe(registered)
    unregisterClooks(claudeDir())
    const settings = readSettings()
    expect(settings.extension).toEqual({ nested: [null, false] })
    const hooks = settings.hooks as Record<string, unknown>
    expect(hooks.FutureEvent).toEqual({ opaque: ['not traversed'] })
    expect(hooks.PreToolUse).toEqual([empty, { ...metadata, hooks: [unrelated] }])
    const after = readFileSync(settingsPath(), 'utf8')
    unregisterClooks(claudeDir())
    expect(readFileSync(settingsPath(), 'utf8')).toBe(after)
    expect(() => isClooksRegistered(claudeDir())).toThrow('hooks.FutureEvent')
  })

  test('detects owned unknown-event references but does not unregister them', () => {
    writeSettings({
      hooks: { FutureEvent: [{ hooks: [{ type: 'command', command: CLOOKS_ENTRYPOINT_PATH }] }] },
    })
    expect(isClooksRegistered(claudeDir())).toBe(true)
    const bytes = readFileSync(settingsPath(), 'utf8')
    expect(unregisterClooks(claudeDir()).removed).toEqual([])
    expect(readFileSync(settingsPath(), 'utf8')).toBe(bytes)
  })

  test('whitespace file remains compatible with detection, unhook and init', () => {
    mkdirSync(claudeDir(), { recursive: true })
    writeFileSync(settingsPath(), ' \n\t')
    expect(isClooksRegistered(claudeDir())).toBe(false)
    expect(unregisterClooks(claudeDir()).removed).toEqual([])
    expect(readFileSync(settingsPath(), 'utf8')).toBe(' \n\t')
    expect(registerClooks(claudeDir(), CLOOKS_ENTRYPOINT_PATH).created).toBe(false)
  })

  for (const dangling of [false, true]) {
    test(`rejects ${dangling ? 'dangling' : 'regular-target'} symlinks in every operation`, () => {
      mkdirSync(claudeDir(), { recursive: true })
      const target = join(tempDir, 'target.json')
      if (!dangling) writeFileSync(target, '{ "keep": true }')
      symlinkSync(target, settingsPath())
      for (const operation of [
        () => registerClooks(claudeDir(), CLOOKS_ENTRYPOINT_PATH),
        () => unregisterClooks(claudeDir()),
        () => isClooksRegistered(claudeDir()),
      ]) {
        expect(operation).toThrow(settingsPath())
        expect(readlinkSync(settingsPath())).toBe(target)
        expect(existsSync(target)).toBe(!dangling)
        if (!dangling) expect(readFileSync(target, 'utf8')).toBe('{ "keep": true }')
      }
    })
  }
})

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'clooks-settings-test-'))
})

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

function claudeDir(): string {
  return join(tempDir, '.claude')
}

function settingsPath(): string {
  return join(tempDir, '.claude', 'settings.json')
}

function writeSettings(obj: unknown): void {
  mkdirSync(join(tempDir, '.claude'), { recursive: true })
  writeFileSync(settingsPath(), JSON.stringify(obj, null, 2) + '\n')
}

function readSettings(): Record<string, unknown> {
  return JSON.parse(readFileSync(settingsPath(), 'utf-8'))
}

describe('settings', () => {
  test('fresh registration into non-existent file creates file with 22 events', () => {
    const result = registerClooks(claudeDir(), CLOOKS_ENTRYPOINT_PATH)

    expect(result.added).toHaveLength(22)
    expect(result.skipped).toHaveLength(0)
    expect(result.updated).toHaveLength(0)
    expect(result.created).toBe(true)

    const settings = readSettings()
    const hooks = settings.hooks as Record<string, unknown[]>
    expect(Object.keys(hooks)).toHaveLength(22)

    // Every event should have exactly one matcher group with the canonical path
    for (const matchers of Object.values(hooks)) {
      expect(matchers).toHaveLength(1)
      const mg = matchers[0] as Record<string, unknown>
      const hookEntries = mg.hooks as Record<string, string>[]
      expect(hookEntries).toHaveLength(1)
      expect(hookEntries[0]!.type).toBe('command')
      expect(hookEntries[0]!.command).toBe(CLOOKS_ENTRYPOINT_PATH)
    }
  })

  test('registration preserves existing settings', () => {
    writeSettings({
      permissions: { allow: ['Bash(git:*)'], deny: [] },
      env: { FOO: 'bar' },
      someOtherKey: 'preserved',
    })

    registerClooks(claudeDir(), CLOOKS_ENTRYPOINT_PATH)
    const settings = readSettings()

    expect(settings.permissions).toEqual({ allow: ['Bash(git:*)'], deny: [] })
    expect(settings.env).toEqual({ FOO: 'bar' })
    expect(settings.someOtherKey).toBe('preserved')
    expect(settings.hooks).toBeDefined()
  })

  test('merging with existing hooks appends without clobbering', () => {
    writeSettings({
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: 'existing-hook.sh' }],
          },
        ],
      },
    })

    registerClooks(claudeDir(), CLOOKS_ENTRYPOINT_PATH)
    const settings = readSettings()
    const hooks = settings.hooks as Record<string, unknown[]>

    // PreToolUse should have 2 matcher groups: existing + clooks
    expect(hooks.PreToolUse).toHaveLength(2)

    // First should be the existing one, untouched
    const existing = hooks.PreToolUse![0] as Record<string, unknown>
    expect(existing.matcher).toBe('Bash')
    const existingHooks = existing.hooks as Record<string, string>[]
    expect(existingHooks[0]!.command).toBe('existing-hook.sh')

    // Second should be Clooks
    const clooks = hooks.PreToolUse![1] as Record<string, unknown>
    const clooksHooks = clooks.hooks as Record<string, string>[]
    expect(clooksHooks[0]!.command).toBe(CLOOKS_ENTRYPOINT_PATH)
  })

  test('idempotent — second run adds 0, skips 22, file unchanged', () => {
    registerClooks(claudeDir(), CLOOKS_ENTRYPOINT_PATH)
    const firstContent = readFileSync(settingsPath(), 'utf-8')

    const result = registerClooks(claudeDir(), CLOOKS_ENTRYPOINT_PATH)

    expect(result.added).toHaveLength(0)
    expect(result.skipped).toHaveLength(22)
    expect(result.updated).toHaveLength(0)
    expect(result.created).toBe(false)

    // File should be byte-identical (not rewritten)
    const secondContent = readFileSync(settingsPath(), 'utf-8')
    expect(secondContent).toBe(firstContent)
  })

  test('unregister removes only Clooks hooks, preserves others', () => {
    writeSettings({
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: 'existing-hook.sh' }],
          },
          {
            hooks: [{ type: 'command', command: CLOOKS_ENTRYPOINT_PATH }],
          },
        ],
        SessionStart: [
          {
            hooks: [{ type: 'command', command: CLOOKS_ENTRYPOINT_PATH }],
          },
        ],
      },
      permissions: { allow: [] },
    })

    const result = unregisterClooks(claudeDir())

    expect(result.removed).toHaveLength(2)
    expect(result.removed).toContain('PreToolUse')
    expect(result.removed).toContain('SessionStart')

    const settings = readSettings()
    const hooks = settings.hooks as Record<string, unknown[]>

    // PreToolUse should still have the existing hook
    expect(hooks.PreToolUse).toHaveLength(1)
    const remaining = hooks.PreToolUse![0] as Record<string, unknown>
    expect(remaining.matcher).toBe('Bash')

    // SessionStart should be removed (was empty after filtering)
    expect(hooks.SessionStart).toBeUndefined()

    // Permissions preserved
    expect(settings.permissions).toEqual({ allow: [] })
  })

  test('unregister cleans up empty event arrays and empty hooks object', () => {
    // All events only have Clooks hooks
    registerClooks(claudeDir(), CLOOKS_ENTRYPOINT_PATH)
    const result = unregisterClooks(claudeDir())

    expect(result.removed).toHaveLength(22)

    const settings = readSettings()
    // hooks object should be entirely removed
    expect(settings.hooks).toBeUndefined()
  })

  test('isClooksRegistered returns true after register, false after unregister', () => {
    expect(isClooksRegistered(claudeDir())).toBe(false)

    registerClooks(claudeDir(), CLOOKS_ENTRYPOINT_PATH)
    expect(isClooksRegistered(claudeDir())).toBe(true)

    unregisterClooks(claudeDir())
    expect(isClooksRegistered(claudeDir())).toBe(false)
  })

  test('empty file handled gracefully', () => {
    mkdirSync(join(tempDir, '.claude'), { recursive: true })
    writeFileSync(settingsPath(), '')

    const result = registerClooks(claudeDir(), CLOOKS_ENTRYPOINT_PATH)

    expect(result.added).toHaveLength(22)
    expect(result.created).toBe(false) // file existed, even if empty
    expect(existsSync(settingsPath())).toBe(true)
  })

  test('malformed JSON throws descriptive error', () => {
    mkdirSync(join(tempDir, '.claude'), { recursive: true })
    writeFileSync(settingsPath(), '{ not valid json !!!')

    expect(() => registerClooks(claudeDir(), CLOOKS_ENTRYPOINT_PATH)).toThrow(
      `\`${settingsPath()}\` contains invalid JSON. Repair the file, then retry.`,
    )
  })

  test('creates settings directory if missing', () => {
    // tempDir has no .claude/ subdirectory
    expect(existsSync(join(tempDir, '.claude'))).toBe(false)

    registerClooks(claudeDir(), CLOOKS_ENTRYPOINT_PATH)

    expect(existsSync(join(tempDir, '.claude'))).toBe(true)
    expect(existsSync(settingsPath())).toBe(true)
  })

  test('isClooksHook detects relative project entrypoint path', () => {
    expect(isClooksHook({ type: 'command', command: '.clooks/bin/entrypoint.sh' })).toBe(true)
  })

  test('isClooksHook detects absolute global entrypoint path', () => {
    expect(isClooksHook({ type: 'command', command: '/home/joe/.clooks/bin/entrypoint.sh' })).toBe(
      true,
    )
  })

  test('isClooksHook rejects legacy paths that do not match the canonical pattern', () => {
    // Legacy paths that the old loose check would have matched
    expect(isClooksHook({ type: 'command', command: '.clooks/bin/clooks-entrypoint.sh' })).toBe(
      false,
    )
    expect(isClooksHook({ type: 'command', command: '.clooks/clooks-entrypoint.sh' })).toBe(false)
    expect(isClooksHook({ type: 'command', command: 'some-other-hook.sh' })).toBe(false)
  })

  test('isClooksHook rejects non-hook objects', () => {
    expect(isClooksHook(null)).toBe(false)
    expect(isClooksHook({})).toBe(false)
    expect(isClooksHook({ type: 'command', command: 42 })).toBe(false)
    expect(isClooksHook({ command: CLOOKS_ENTRYPOINT_PATH })).toBe(false)
  })
})

describe('global settings', () => {
  test('current generated global paths with spaces and Unicode remain idempotent and removable', () => {
    const home = join(tempDir, 'home with 日本語')
    const directory = join(home, '.claude')
    const command = join(home, '.clooks/bin/entrypoint.sh')
    registerClooks(directory, command)
    const bytes = readFileSync(join(directory, 'settings.json'), 'utf8')
    expect(registerClooks(directory, command).skipped).toHaveLength(22)
    expect(readFileSync(join(directory, 'settings.json'), 'utf8')).toBe(bytes)
    expect(isClooksRegistered(directory)).toBe(true)
    expect(unregisterClooks(directory).removed).toHaveLength(22)
    expect(isClooksRegistered(directory)).toBe(false)
    expect(
      isClooksHook({ type: 'command', command: '/home/日本語/.clooks/bin/entrypoint.sh' }),
    ).toBe(true)
  })

  test('shell mentions and non-command hooks survive init and unhook', () => {
    const commands = [
      'echo .clooks/bin/entrypoint.sh',
      '/usr/bin/echo .clooks/bin/entrypoint.sh',
      '# .clooks/bin/entrypoint.sh',
      `${CLOOKS_ENTRYPOINT_PATH}; echo done`,
      `${CLOOKS_ENTRYPOINT_PATH} | cat`,
      `${CLOOKS_ENTRYPOINT_PATH} > out`,
      '/tmp/$(echo wrong)/.clooks/bin/entrypoint.sh',
      `${CLOOKS_ENTRYPOINT_PATH} --extra`,
    ]
    const unrelated = commands.map((command) => ({ type: 'command', command }))
    unrelated.push({ type: 'prompt', command: CLOOKS_ENTRYPOINT_PATH })
    for (const hook of unrelated) expect(isClooksHook(hook)).toBe(false)
    writeSettings({ hooks: { Stop: [{ hooks: unrelated, custom: true }] } })
    registerClooks(claudeDir(), CLOOKS_ENTRYPOINT_PATH)
    unregisterClooks(claudeDir())
    expect((readSettings().hooks as Record<string, unknown>).Stop).toEqual([
      { hooks: unrelated, custom: true },
    ])
  })
  test('registerClooks with global settings path creates correct entries with absolute entrypoint', () => {
    const globalSettingsDir = join(tempDir, '.claude')
    const globalEntrypoint = join(tempDir, '.clooks/bin/entrypoint.sh')

    const result = registerClooks(globalSettingsDir, globalEntrypoint)

    expect(result.added).toHaveLength(22)
    expect(result.created).toBe(true)

    const settings = readSettings()
    const hooks = settings.hooks as Record<string, unknown[]>

    // Every event should have the absolute entrypoint path
    for (const matchers of Object.values(hooks)) {
      const mg = matchers[0] as Record<string, unknown>
      const hookEntries = mg.hooks as Record<string, string>[]
      expect(hookEntries[0]!.command).toBe(globalEntrypoint)
    }
  })

  test('registerClooks called twice with same global path is idempotent (no duplicate entries)', () => {
    const globalSettingsDir = join(tempDir, '.claude')
    const globalEntrypoint = join(tempDir, '.clooks/bin/entrypoint.sh')

    registerClooks(globalSettingsDir, globalEntrypoint)
    const firstContent = readFileSync(settingsPath(), 'utf-8')

    const result = registerClooks(globalSettingsDir, globalEntrypoint)

    expect(result.added).toHaveLength(0)
    expect(result.skipped).toHaveLength(22)
    expect(result.updated).toHaveLength(0)

    // File should be byte-identical
    const secondContent = readFileSync(settingsPath(), 'utf-8')
    expect(secondContent).toBe(firstContent)
  })

  test('unregisterClooks works with global settings dir', () => {
    const globalSettingsDir = join(tempDir, '.claude')
    const globalEntrypoint = join(tempDir, '.clooks/bin/entrypoint.sh')

    registerClooks(globalSettingsDir, globalEntrypoint)
    expect(isClooksRegistered(globalSettingsDir)).toBe(true)

    const result = unregisterClooks(globalSettingsDir)
    expect(result.removed).toHaveLength(22)
    expect(isClooksRegistered(globalSettingsDir)).toBe(false)
  })

  test('migration: updates existing Clooks command when entrypoint path changes', () => {
    // Register with an absolute global path (still ends with .clooks/bin/entrypoint.sh)
    registerClooks(claudeDir(), '/home/olduser/.clooks/bin/entrypoint.sh')

    // Re-register with new path — should update, not add
    const result = registerClooks(claudeDir(), CLOOKS_ENTRYPOINT_PATH)

    expect(result.updated).toHaveLength(22)
    expect(result.added).toHaveLength(0)
    expect(result.skipped).toHaveLength(0)

    // Verify the command was migrated
    const settings = readSettings()
    const hooks = settings.hooks as Record<string, unknown[]>
    for (const matchers of Object.values(hooks)) {
      expect(matchers).toHaveLength(1)
      const mg = matchers[0] as Record<string, unknown>
      const hookEntries = mg.hooks as Record<string, string>[]
      expect(hookEntries[0]!.command).toBe(CLOOKS_ENTRYPOINT_PATH)
    }
  })

  test('unregister on non-existent file returns empty removed', () => {
    const result = unregisterClooks(join(tempDir, 'nonexistent'))
    expect(result.removed).toHaveLength(0)
  })

  test('unregister on settings with no hooks key returns empty removed', () => {
    writeSettings({ permissions: { allow: [] } })
    const result = unregisterClooks(claudeDir())
    expect(result.removed).toHaveLength(0)
  })

  test('isClooksRegistered detects both relative project and absolute global paths', () => {
    // Register with relative project path
    const projectSettingsDir = join(tempDir, 'project', '.claude')
    mkdirSync(projectSettingsDir, { recursive: true })
    registerClooks(projectSettingsDir, CLOOKS_ENTRYPOINT_PATH)
    expect(isClooksRegistered(projectSettingsDir)).toBe(true)

    // Register with absolute global path
    const globalSettingsDir = join(tempDir, 'global', '.claude')
    mkdirSync(globalSettingsDir, { recursive: true })
    registerClooks(globalSettingsDir, '/home/joe/.clooks/bin/entrypoint.sh')
    expect(isClooksRegistered(globalSettingsDir)).toBe(true)
  })
})
