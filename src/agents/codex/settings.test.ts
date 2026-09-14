import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { symlinkSync, readlinkSync, realpathSync, statSync } from 'fs'
import {
  CODEX_REGISTRATION_EVENTS,
  isCodexClooksHook,
  isCodexClooksRegistered,
  makeCodexGlobalEntrypointCommand,
  makeCodexProjectEntrypointCommand,
  quotePosixSingleArg,
  registerCodexClooks,
  resolveCodexHome,
  unregisterCodexClooks,
} from './settings.js'

let tempDir: string

describe('resolveCodexHome', () => {
  beforeEach(() => {
    tempDir = realpathSync(tempDir)
  })

  test('defaults unset and empty CODEX_HOME to the installation home', () => {
    const expected = join(realpathSync(tempDir), '.codex')
    expect(resolveCodexHome(tempDir, {})).toBe(expected)
    expect(resolveCodexHome(tempDir, { CODEX_HOME: '' })).toBe(expected)
    expect(resolveCodexHome(tempDir, { CLOOKS_HOME_ROOT: '/ignored' })).toBe(expected)
    expect(existsSync(expected)).toBe(false)
  })

  test('uses a custom absolute home without creating it', () => {
    const selected = join(tempDir, "custom 'quoted' $home", 'nested')
    expect(resolveCodexHome(tempDir, { CODEX_HOME: selected })).toBe(selected)
    expect(existsSync(join(tempDir, "custom 'quoted' $home"))).toBe(false)
  })

  test('canonicalizes existing symlinks and the nearest existing ancestor', () => {
    const physical = join(tempDir, 'physical')
    const alias = join(tempDir, 'alias')
    mkdirSync(physical)
    symlinkSync(physical, alias)
    expect(resolveCodexHome(tempDir, { CODEX_HOME: alias })).toBe(physical)
    expect(resolveCodexHome(tempDir, { CODEX_HOME: `${alias}/one/two` })).toBe(
      join(physical, 'one/two'),
    )
    expect(existsSync(join(physical, 'one'))).toBe(false)
    expect(resolveCodexHome(alias, {})).toBe(join(physical, '.codex'))
  })

  test('resolves parent components after following directory symlinks', () => {
    const physical = join(tempDir, 'physical', 'child')
    const alias = join(tempDir, 'alias')
    mkdirSync(physical, { recursive: true })
    symlinkSync(physical, alias)
    expect(resolveCodexHome(tempDir, { CODEX_HOME: `${alias}/../missing` })).toBe(
      join(tempDir, 'physical/missing'),
    )
    expect(existsSync(join(tempDir, 'physical/missing'))).toBe(false)
    expect(existsSync(join(tempDir, 'missing'))).toBe(false)
  })

  test('uses the physical parent even when both possible destination directories exist', () => {
    const physical = join(tempDir, 'physical', 'child')
    const alias = join(tempDir, 'alias')
    mkdirSync(physical, { recursive: true })
    mkdirSync(join(tempDir, 'physical/existing'))
    mkdirSync(join(tempDir, 'existing'))
    symlinkSync(physical, alias)
    expect(resolveCodexHome(tempDir, { CODEX_HOME: `${alias}/..` })).toBe(join(tempDir, 'physical'))
    expect(resolveCodexHome(tempDir, { CODEX_HOME: `${alias}/../existing` })).toBe(
      join(tempDir, 'physical/existing'),
    )
    expect(resolveCodexHome(tempDir, { CODEX_HOME: `${alias}//./../existing/./` })).toBe(
      join(tempDir, 'physical/existing'),
    )
  })

  test('preserves physical parent components in the default installation home', () => {
    const physical = join(tempDir, 'physical', 'child')
    const alias = join(tempDir, 'alias')
    mkdirSync(physical, { recursive: true })
    symlinkSync(physical, alias)
    const expected = join(tempDir, 'physical/.codex')
    expect(resolveCodexHome(`${alias}/..`, {})).toBe(expected)
    expect(resolveCodexHome(`${alias}/..`, { CODEX_HOME: '' })).toBe(expected)
    expect(existsSync(expected)).toBe(false)
    mkdirSync(expected)
    mkdirSync(join(tempDir, '.codex'))
    expect(resolveCodexHome(`${alias}/..`, {})).toBe(expected)
  })

  test('follows another symlink after resolving the first physical parent', () => {
    const physical = join(tempDir, 'physical', 'child')
    const target = join(tempDir, 'target', 'nested')
    const alias = join(tempDir, 'alias')
    mkdirSync(physical, { recursive: true })
    mkdirSync(target, { recursive: true })
    symlinkSync(physical, alias)
    symlinkSync(target, join(tempDir, 'physical/next'))
    expect(resolveCodexHome(tempDir, { CODEX_HOME: `${alias}/../next/../missing/deep` })).toBe(
      join(tempDir, 'target/missing/deep'),
    )
    expect(existsSync(join(tempDir, 'target/missing'))).toBe(false)
  })

  test('rejects CR/LF introduced by a directory symlink target', () => {
    const physical = join(tempDir, 'line\nbreak')
    const alias = join(tempDir, 'alias')
    mkdirSync(physical)
    symlinkSync(physical, alias)
    expect(() => resolveCodexHome(tempDir, { CODEX_HOME: `${alias}/missing` })).toThrow(
      'absolute path',
    )
    expect(existsSync(join(physical, 'missing'))).toBe(false)
  })

  test('resumes physical resolution after cancelling a missing component', () => {
    const physical = join(tempDir, 'physical')
    const alias = join(tempDir, 'alias')
    const missing = join(tempDir, 'missing')
    mkdirSync(physical)
    symlinkSync(physical, alias)
    expect(resolveCodexHome(tempDir, { CODEX_HOME: `${missing}/../alias` })).toBe(physical)
    expect(existsSync(missing)).toBe(false)
    expect(readlinkSync(alias)).toBe(physical)
  })

  test('rejects files and dangling links after cancelling a missing component', () => {
    const missing = join(tempDir, 'missing')
    const file = join(tempDir, 'file')
    const dangling = join(tempDir, 'dangling')
    const target = join(tempDir, 'absent')
    writeFileSync(file, 'keep')
    symlinkSync(target, dangling)
    expect(() => resolveCodexHome(tempDir, { CODEX_HOME: `${missing}/../file` })).toThrow(
      'directory',
    )
    expect(() => resolveCodexHome(tempDir, { CODEX_HOME: `${missing}/../dangling` })).toThrow()
    expect(existsSync(missing)).toBe(false)
    expect(existsSync(target)).toBe(false)
    expect(readFileSync(file, 'utf8')).toBe('keep')
    expect(readlinkSync(dangling)).toBe(target)
  })

  for (const value of [
    'relative',
    '.',
    '../state',
    '~/state',
    '/tmp/line\nbreak',
    '/tmp/line\rbreak',
    '/tmp/nul\0',
  ]) {
    test(`rejects invalid CODEX_HOME ${JSON.stringify(value)} without writes`, () => {
      expect(() => resolveCodexHome(tempDir, { CODEX_HOME: value })).toThrow('absolute path')
      expect(existsSync(join(tempDir, '.codex'))).toBe(false)
    })
  }

  test('rejects an invalid installation home even with an absolute override', () => {
    expect(() => resolveCodexHome('relative', { CODEX_HOME: tempDir })).toThrow('absolute path')
    expect(() => resolveCodexHome(`${tempDir}\n`, {})).toThrow('absolute path')
  })

  test('rejects files, file ancestors and dangling symlinks without writes', () => {
    const file = join(tempDir, 'file')
    writeFileSync(file, 'keep')
    expect(() => resolveCodexHome(tempDir, { CODEX_HOME: file })).toThrow('directory')
    expect(() => resolveCodexHome(tempDir, { CODEX_HOME: `${file}/child` })).toThrow()
    const link = join(tempDir, 'dangling')
    const target = join(tempDir, 'absent')
    symlinkSync(target, link)
    expect(() => resolveCodexHome(tempDir, { CODEX_HOME: link })).toThrow()
    expect(readlinkSync(link)).toBe(target)
    expect(existsSync(target)).toBe(false)
    expect(readFileSync(file, 'utf8')).toBe('keep')
  })
})

describe('registration preservation', () => {
  test('no-op registration preserves noncanonical JSON bytes and inode', () => {
    const command = makeCodexProjectEntrypointCommand('0123456789abcdef0123456789abcdef')
    registerCodexClooks(codexDir(), command)
    const bytes = '\t' + JSON.stringify(readHooksFile()) + '  \n\n'
    writeFileSync(hooksPath(), bytes)
    const inode = statSync(hooksPath()).ino
    const result = registerCodexClooks(codexDir(), command)
    expect(result.added).toEqual([])
    expect(result.updated).toEqual([])
    expect(readFileSync(hooksPath(), 'utf8')).toBe(bytes)
    expect(statSync(hooksPath()).ino).toBe(inode)
  })

  test('no-op unregistration preserves noncanonical JSON bytes and inode', () => {
    mkdirSync(codexDir(), { recursive: true })
    const bytes =
      '\t{ "hooks" : { "Stop": [ { "hooks": [] } ], "SessionStart": [] }, "keep": true }  \n'
    writeFileSync(hooksPath(), bytes)
    const inode = statSync(hooksPath()).ino
    expect(unregisterCodexClooks(codexDir()).removed).toEqual([])
    expect(readFileSync(hooksPath(), 'utf8')).toBe(bytes)
    expect(statSync(hooksPath()).ino).toBe(inode)
  })

  test('inspection validates later unknown events before returning an early owned match', () => {
    const owned = {
      hooks: [
        {
          type: 'command',
          command: makeCodexProjectEntrypointCommand('0123456789abcdef0123456789abcdef'),
        },
      ],
    }
    writeHooksFile({ hooks: { SessionStart: [owned], FutureEvent: [] } })
    expect(isCodexClooksRegistered(codexDir())).toBe(true)
    writeHooksFile({ hooks: { SessionStart: [owned], FutureEvent: [{ hooks: null }] } })
    const bytes = readFileSync(hooksPath(), 'utf8')
    expect(() => isCodexClooksRegistered(codexDir())).toThrow('hooks.FutureEvent[0].hooks')
    expect(readFileSync(hooksPath(), 'utf8')).toBe(bytes)
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
      mkdirSync(codexDir(), { recursive: true })
      const bytes = ' \n' + contents + '\n '
      writeFileSync(hooksPath(), bytes)
      for (const operation of [
        () =>
          registerCodexClooks(
            codexDir(),
            makeCodexProjectEntrypointCommand('0123456789abcdef0123456789abcdef'),
          ),
        () => unregisterCodexClooks(codexDir()),
        () => isCodexClooksRegistered(codexDir()),
      ]) {
        expect(operation).toThrow(hooksPath())
        expect(readFileSync(hooksPath(), 'utf8')).toBe(bytes)
      }
    })
  }

  test('preserves unknown values, empty groups and mixed metadata through init and unhook', () => {
    const unrelated = { type: 'prompt', prompt: 'retain', extension: { enabled: true } }
    const empty = { hooks: [], extension: [1, null] }
    const metadata = { matcher: 'Bash', custom: { keep: ['all'] } }
    writeHooksFile({
      extension: { nested: [null, false] },
      hooks: {
        FutureEvent: { opaque: ['not traversed'] },
        PreToolUse: [
          empty,
          {
            ...metadata,
            hooks: [
              {
                type: 'command',
                command: makeCodexProjectEntrypointCommand('0123456789abcdef0123456789abcdef'),
              },
              unrelated,
            ],
          },
        ],
        Stop: [],
      },
    })
    registerCodexClooks(
      codexDir(),
      makeCodexProjectEntrypointCommand('0123456789abcdef0123456789abcdef'),
    )
    const registered = readFileSync(hooksPath(), 'utf8')
    registerCodexClooks(
      codexDir(),
      makeCodexProjectEntrypointCommand('0123456789abcdef0123456789abcdef'),
    )
    expect(readFileSync(hooksPath(), 'utf8')).toBe(registered)
    unregisterCodexClooks(codexDir())
    const settings = readHooksFile()
    expect(settings.extension).toEqual({ nested: [null, false] })
    const hooks = settings.hooks as Record<string, unknown>
    expect(hooks.FutureEvent).toEqual({ opaque: ['not traversed'] })
    expect(hooks.PreToolUse).toEqual([empty, { ...metadata, hooks: [unrelated] }])
    const after = readFileSync(hooksPath(), 'utf8')
    unregisterCodexClooks(codexDir())
    expect(readFileSync(hooksPath(), 'utf8')).toBe(after)
    expect(() => isCodexClooksRegistered(codexDir())).toThrow('hooks.FutureEvent')
  })

  test('detects owned unknown-event references but does not unregister them', () => {
    writeHooksFile({
      hooks: {
        FutureEvent: [
          {
            hooks: [
              {
                type: 'command',
                command: makeCodexProjectEntrypointCommand('0123456789abcdef0123456789abcdef'),
              },
            ],
          },
        ],
      },
    })
    expect(isCodexClooksRegistered(codexDir())).toBe(true)
    const bytes = readFileSync(hooksPath(), 'utf8')
    expect(unregisterCodexClooks(codexDir()).removed).toEqual([])
    expect(readFileSync(hooksPath(), 'utf8')).toBe(bytes)
  })

  test('whitespace file remains compatible with detection, unhook and init', () => {
    mkdirSync(codexDir(), { recursive: true })
    writeFileSync(hooksPath(), ' \n\t')
    expect(isCodexClooksRegistered(codexDir())).toBe(false)
    expect(unregisterCodexClooks(codexDir()).removed).toEqual([])
    expect(readFileSync(hooksPath(), 'utf8')).toBe(' \n\t')
    expect(
      registerCodexClooks(
        codexDir(),
        makeCodexProjectEntrypointCommand('0123456789abcdef0123456789abcdef'),
      ).created,
    ).toBe(false)
  })

  for (const dangling of [false, true]) {
    test(`rejects ${dangling ? 'dangling' : 'regular-target'} symlinks in every operation`, () => {
      mkdirSync(codexDir(), { recursive: true })
      const target = join(tempDir, 'target.json')
      if (!dangling) writeFileSync(target, '{ "keep": true }')
      symlinkSync(target, hooksPath())
      for (const operation of [
        () =>
          registerCodexClooks(
            codexDir(),
            makeCodexProjectEntrypointCommand('0123456789abcdef0123456789abcdef'),
          ),
        () => unregisterCodexClooks(codexDir()),
        () => isCodexClooksRegistered(codexDir()),
      ]) {
        expect(operation).toThrow(hooksPath())
        expect(readlinkSync(hooksPath())).toBe(target)
        expect(existsSync(target)).toBe(!dangling)
        if (!dangling) expect(readFileSync(target, 'utf8')).toBe('{ "keep": true }')
      }
    })
  }
})

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'clooks-codex-settings-test-'))
})

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

function codexDir(): string {
  return join(tempDir, '.codex')
}

function hooksPath(): string {
  return join(codexDir(), 'hooks.json')
}

function writeHooksFile(value: unknown): void {
  mkdirSync(codexDir(), { recursive: true })
  writeFileSync(hooksPath(), JSON.stringify(value, null, 2) + '\n')
}

function readHooksFile(): Record<string, unknown> {
  return JSON.parse(readFileSync(hooksPath(), 'utf-8'))
}

function hookCommandsFor(event: string): string[] {
  const hooksFile = readHooksFile()
  const hooks = hooksFile.hooks as Record<string, unknown[]>
  const matcherGroups = hooks[event]!
  return matcherGroups.flatMap((matcherGroup) => {
    const groupHooks = (matcherGroup as Record<string, unknown>).hooks as Record<string, string>[]
    return groupHooks.map((hook) => hook.command!)
  })
}

function clooksMatcherGroupsFor(event: string): Record<string, unknown>[] {
  const hooksFile = readHooksFile()
  const hooks = hooksFile.hooks as Record<string, unknown[]>
  const matcherGroups = hooks[event]!
  return matcherGroups.filter((matcherGroup) => {
    const groupHooks = (matcherGroup as Record<string, unknown>).hooks
    return Array.isArray(groupHooks) && groupHooks.some(isCodexClooksHook)
  }) as Record<string, unknown>[]
}

describe('Codex registration events', () => {
  test.each(['SessionEnd', 'Interrupt'] as const)(
    '%s upgrades missing and timeout-free registrations without unrelated changes',
    (target) => {
      const command = makeCodexProjectEntrypointCommand('0123456789abcdef0123456789abcdef')
      const owned = { matcher: '*', hooks: [{ type: 'command', command }] }
      const unrelated = {
        matcher: '*',
        hooks: [{ type: 'command', command: 'echo retained', timeout: 20 }],
      }
      for (const existingEnd of [false, true]) {
        writeHooksFile({
          hooks: {
            ...Object.fromEntries(
              CODEX_REGISTRATION_EVENTS.filter((event) => event !== target).map((event) => [
                event,
                [
                  {
                    matcher: '*',
                    hooks: [
                      {
                        type: 'command',
                        command,
                        ...(event === 'SessionEnd' || event === 'Interrupt' ? { timeout: 3 } : {}),
                      },
                    ],
                  },
                ],
              ]),
            ),
            [target]: existingEnd ? [owned, unrelated] : [unrelated],
          },
        })
        const result = registerCodexClooks(codexDir(), command)
        expect(result.skipped).toHaveLength(11)
        expect(existingEnd ? result.updated : result.added).toEqual([target])
        const bytes = readFileSync(hooksPath(), 'utf8')
        expect(registerCodexClooks(codexDir(), command).skipped).toHaveLength(12)
        expect(readFileSync(hooksPath(), 'utf8')).toBe(bytes)
        const hooks = readHooksFile().hooks as Record<string, unknown>
        expect(hooks[target]).toEqual([
          unrelated,
          { matcher: '*', hooks: [{ type: 'command', command, timeout: 3 }] },
        ])
        for (const event of CODEX_REGISTRATION_EVENTS.filter((event) => event !== target)) {
          expect(hooks[event]).toEqual([
            {
              matcher: '*',
              hooks: [
                {
                  type: 'command',
                  command,
                  ...(event === 'SessionEnd' || event === 'Interrupt' ? { timeout: 3 } : {}),
                },
              ],
            },
          ])
        }
        expect(unregisterCodexClooks(codexDir()).removed).toHaveLength(12)
        expect(readHooksFile()).toEqual({ hooks: { [target]: [unrelated] } })
      }
    },
  )

  test('exports exactly the twelve registration events in stable order', () => {
    expect(CODEX_REGISTRATION_EVENTS).toEqual([
      'SessionStart',
      'SubagentStart',
      'PreToolUse',
      'PermissionRequest',
      'PostToolUse',
      'PreCompact',
      'PostCompact',
      'UserPromptSubmit',
      'SubagentStop',
      'Stop',
      'SessionEnd',
      'Interrupt',
    ])
  })
})

describe('Codex command builders', () => {
  test('quotes POSIX shell arguments with spaces and single quotes', () => {
    expect(quotePosixSingleArg('/tmp/a b')).toBe("'/tmp/a b'")
    expect(quotePosixSingleArg("/tmp/joe's repo")).toBe("'/tmp/joe'\\''s repo'")
  })

  test('project command carries only its stable identity, not a checkout path', () => {
    const id = '0123456789abcdef0123456789abcdef'
    const command = makeCodexProjectEntrypointCommand(id)
    expect(command).toStartWith('CLOOKS_AGENT=codex sh -c ')
    expect(command).toEndWith(` clooks-project '${id}'`)
    expect(command).not.toContain(tempDir)
    expect(isCodexClooksHook({ type: 'command', command })).toBe(true)
    expect(() => makeCodexProjectEntrypointCommand('bad id')).toThrow('Invalid Codex project ID')
  })

  test('global command sets only agent and absolute home entrypoint', () => {
    const homeRoot = join(tempDir, "home with joe's files")

    const command = makeCodexGlobalEntrypointCommand(homeRoot)

    expect(command).toBe(
      `CLOOKS_AGENT=codex ${quotePosixSingleArg(join(homeRoot, '.clooks/bin/entrypoint.sh'))}`,
    )
    expect(command).not.toContain('CLOOKS_PROJECT_ROOT')
  })
})

describe('Codex hooks.json registration', () => {
  test('direct unregistration preserves mixed metadata and untouched empty containers', () => {
    const command = makeCodexProjectEntrypointCommand('0123456789abcdef0123456789abcdef')
    const unrelated = { type: 'command', command: 'keep.sh', custom: { enabled: true } }
    const empty = { matcher: 'Bash', hooks: [], custom: ['retain'] }
    const metadata = { matcher: '*', custom: { nested: [null, 42] } }
    writeHooksFile({
      extension: { untouched: true },
      hooks: {
        SessionStart: [],
        PreToolUse: [
          empty,
          {
            ...metadata,
            hooks: [
              { type: 'command', command },
              unrelated,
              { type: 'command', command: makeCodexGlobalEntrypointCommand('/old/root') },
            ],
          },
          { hooks: [{ type: 'command', command }] },
        ],
        FutureEvent: { opaque: true },
      },
    })
    expect(unregisterCodexClooks(codexDir()).removed).toEqual(['PreToolUse'])
    expect(readHooksFile()).toEqual({
      extension: { untouched: true },
      hooks: {
        SessionStart: [],
        PreToolUse: [empty, { ...metadata, hooks: [unrelated] }],
        FutureEvent: { opaque: true },
      },
    })
  })
  test('fresh registration creates hooks.json with twelve Clooks events', () => {
    const command = makeCodexProjectEntrypointCommand('0123456789abcdef0123456789abcdef')

    const result = registerCodexClooks(codexDir(), command)

    expect(result.added).toEqual([...CODEX_REGISTRATION_EVENTS])
    expect(result.skipped).toHaveLength(0)
    expect(result.updated).toHaveLength(0)
    expect(result.created).toBe(true)
    expect(existsSync(hooksPath())).toBe(true)

    const hooksFile = readHooksFile()
    const hooks = hooksFile.hooks as Record<string, unknown[]>
    expect(Object.keys(hooks)).toEqual([...CODEX_REGISTRATION_EVENTS])

    for (const event of CODEX_REGISTRATION_EVENTS) {
      expect(hooks[event]).toHaveLength(1)
      const matcherGroup = hooks[event]![0] as Record<string, unknown>
      expect(matcherGroup.matcher).toBe('*')
      const groupHooks = matcherGroup.hooks as Record<string, unknown>[]
      expect(groupHooks).toEqual([
        {
          type: 'command',
          command,
          ...(event === 'SessionEnd' || event === 'Interrupt' ? { timeout: 3 } : {}),
        },
      ])
      expect(matcherGroup.statusMessage).toBeUndefined()
    }
  })

  test('preserves unknown top-level fields and unrelated hooks', () => {
    writeHooksFile({
      version: 1,
      note: 'preserve me',
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: 'existing-hook.sh' }],
          },
        ],
        FutureEvent: [
          {
            matcher: '*',
            hooks: [{ type: 'command', command: 'future-hook.sh' }],
          },
        ],
      },
    })

    registerCodexClooks(
      codexDir(),
      makeCodexProjectEntrypointCommand('0123456789abcdef0123456789abcdef'),
    )

    const hooksFile = readHooksFile()
    expect(hooksFile.version).toBe(1)
    expect(hooksFile.note).toBe('preserve me')

    const hooks = hooksFile.hooks as Record<string, unknown[]>
    expect(hooks.FutureEvent).toEqual([
      {
        matcher: '*',
        hooks: [{ type: 'command', command: 'future-hook.sh' }],
      },
    ])
    expect(hooks.PreToolUse).toHaveLength(2)
    expect((hooks.PreToolUse![0] as Record<string, unknown>).matcher).toBe('Bash')
  })

  test('idempotent second registration skips all events and does not rewrite', () => {
    const command = makeCodexProjectEntrypointCommand('0123456789abcdef0123456789abcdef')
    registerCodexClooks(codexDir(), command)
    const firstContent = readFileSync(hooksPath(), 'utf-8')

    const result = registerCodexClooks(codexDir(), command)

    expect(result.added).toHaveLength(0)
    expect(result.skipped).toEqual([...CODEX_REGISTRATION_EVENTS])
    expect(result.updated).toHaveLength(0)
    expect(result.created).toBe(false)
    expect(readFileSync(hooksPath(), 'utf-8')).toBe(firstContent)
  })

  test('replaces an owned project command without adding duplicates', () => {
    const oldCommand = makeCodexProjectEntrypointCommand('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    const newCommand = makeCodexProjectEntrypointCommand('0123456789abcdef0123456789abcdef')
    writeHooksFile({
      hooks: Object.fromEntries(
        CODEX_REGISTRATION_EVENTS.map((event) => [
          event,
          [{ matcher: '*', hooks: [{ type: 'command', command: oldCommand }] }],
        ]),
      ),
    })

    const result = registerCodexClooks(codexDir(), newCommand)

    expect(result.added).toHaveLength(0)
    expect(result.updated).toEqual([...CODEX_REGISTRATION_EVENTS])
    expect(result.skipped).toHaveLength(0)

    for (const event of CODEX_REGISTRATION_EVENTS) {
      expect(hookCommandsFor(event)).toEqual([newCommand])
    }
  })

  test('converges duplicate Clooks hooks and groups to one canonical registration', () => {
    const oldCommand = "CLOOKS_AGENT=codex '/old/repo/.clooks/bin/entrypoint.sh'"
    const duplicateCommand = "CLOOKS_AGENT=codex '/another/repo/.clooks/bin/entrypoint.sh'"
    const newCommand = makeCodexProjectEntrypointCommand('0123456789abcdef0123456789abcdef')
    writeHooksFile({
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [
              { type: 'command', command: 'existing-bash-hook.sh' },
              { type: 'command', command: oldCommand },
              { type: 'command', command: duplicateCommand },
            ],
          },
          {
            matcher: '*',
            timeout: 5,
            hooks: [{ type: 'command', command: duplicateCommand }],
          },
        ],
      },
    })

    const result = registerCodexClooks(codexDir(), newCommand)

    expect(result.updated).toContain('PreToolUse')

    const hooks = (readHooksFile().hooks as Record<string, unknown[]>).PreToolUse!
    expect(hooks).toEqual([
      {
        matcher: 'Bash',
        hooks: [{ type: 'command', command: 'existing-bash-hook.sh' }],
      },
      {
        matcher: '*',
        hooks: [{ type: 'command', command: newCommand }],
      },
    ])
    expect(clooksMatcherGroupsFor('PreToolUse')).toHaveLength(1)
    expect(
      hookCommandsFor('PreToolUse').filter((command) =>
        isCodexClooksHook({ type: 'command', command }),
      ),
    ).toEqual([newCommand])
  })

  test('moves Clooks hook out of a mixed matcher group while preserving unrelated hooks', () => {
    const oldCommand = "CLOOKS_AGENT=codex '/old/repo/.clooks/bin/entrypoint.sh'"
    const newCommand = makeCodexProjectEntrypointCommand('0123456789abcdef0123456789abcdef')
    writeHooksFile({
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [
              { type: 'command', command: oldCommand },
              { type: 'command', command: 'existing-bash-hook.sh' },
            ],
          },
        ],
      },
    })

    registerCodexClooks(codexDir(), newCommand)

    const hooks = (readHooksFile().hooks as Record<string, unknown[]>).PreToolUse!
    expect(hooks).toEqual([
      {
        matcher: 'Bash',
        hooks: [{ type: 'command', command: 'existing-bash-hook.sh' }],
      },
      {
        matcher: '*',
        hooks: [{ type: 'command', command: newCommand }],
      },
    ])
  })

  test('empty hooks.json is treated as an existing empty file', () => {
    mkdirSync(codexDir(), { recursive: true })
    writeFileSync(hooksPath(), '')

    const result = registerCodexClooks(
      codexDir(),
      makeCodexProjectEntrypointCommand('0123456789abcdef0123456789abcdef'),
    )

    expect(result.added).toHaveLength(12)
    expect(result.created).toBe(false)
  })

  test('invalid roots are rejected without changing bytes', () => {
    mkdirSync(codexDir(), { recursive: true })
    for (const text of ['null\n', '[]\n', '42', 'true', '"text"']) {
      writeFileSync(hooksPath(), text)
      expect(() =>
        registerCodexClooks(
          codexDir(),
          makeCodexProjectEntrypointCommand('0123456789abcdef0123456789abcdef'),
        ),
      ).toThrow('invalid root')
      expect(readFileSync(hooksPath(), 'utf8')).toBe(text)
    }
  })

  test('invalid hooks shape is rejected', () => {
    writeHooksFile({
      keep: true,
      hooks: [{ matcher: '*', hooks: [{ type: 'command', command: 'array-hook.sh' }] }],
    })

    const before = readFileSync(hooksPath(), 'utf8')
    expect(() =>
      registerCodexClooks(
        codexDir(),
        makeCodexProjectEntrypointCommand('0123456789abcdef0123456789abcdef'),
      ),
    ).toThrow('invalid hooks')
    expect(readFileSync(hooksPath(), 'utf8')).toBe(before)
  })

  test('malformed hooks.json throws a descriptive error', () => {
    mkdirSync(codexDir(), { recursive: true })
    writeFileSync(hooksPath(), '{ not valid json')

    expect(() =>
      registerCodexClooks(
        codexDir(),
        makeCodexProjectEntrypointCommand('0123456789abcdef0123456789abcdef'),
      ),
    ).toThrow(`\`${hooksPath()}\` contains invalid JSON. Repair the file, then retry.`)
  })

  test('unregister removes Clooks hooks and preserves unrelated hooks', () => {
    const command = makeCodexProjectEntrypointCommand('0123456789abcdef0123456789abcdef')
    writeHooksFile({
      keep: true,
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: 'existing-hook.sh' }],
          },
          {
            matcher: '*',
            hooks: [
              { type: 'command', command },
              { type: 'command', command: 'same-group-unrelated.sh' },
            ],
          },
        ],
        SessionStart: [{ matcher: '*', hooks: [{ type: 'command', command }] }],
      },
    })

    const result = unregisterCodexClooks(codexDir())

    expect(result.removed).toEqual(['SessionStart', 'PreToolUse'])

    const hooksFile = readHooksFile()
    expect(hooksFile.keep).toBe(true)
    const hooks = hooksFile.hooks as Record<string, unknown[]>
    expect(hooks.PreToolUse).toEqual([
      {
        matcher: 'Bash',
        hooks: [{ type: 'command', command: 'existing-hook.sh' }],
      },
      {
        matcher: '*',
        hooks: [{ type: 'command', command: 'same-group-unrelated.sh' }],
      },
    ])
    expect(hooks.SessionStart).toBeUndefined()
  })

  test('unregister removes empty hooks object when only Clooks hooks exist', () => {
    registerCodexClooks(
      codexDir(),
      makeCodexProjectEntrypointCommand('0123456789abcdef0123456789abcdef'),
    )

    const result = unregisterCodexClooks(codexDir())

    expect(result.removed).toEqual([...CODEX_REGISTRATION_EVENTS])
    expect(readHooksFile().hooks).toBeUndefined()
  })

  test('unregister on missing hooks.json is a no-op', () => {
    const result = unregisterCodexClooks(codexDir())

    expect(result.removed).toHaveLength(0)
    expect(existsSync(hooksPath())).toBe(false)
  })

  test('unregister on hooks.json with no hooks object is a no-op', () => {
    writeHooksFile({ keep: true })
    const firstContent = readFileSync(hooksPath(), 'utf-8')

    const result = unregisterCodexClooks(codexDir())

    expect(result.removed).toHaveLength(0)
    expect(readFileSync(hooksPath(), 'utf-8')).toBe(firstContent)
  })

  test('registration checks return false for missing or empty files and true after register', () => {
    expect(isCodexClooksRegistered(codexDir())).toBe(false)

    mkdirSync(codexDir(), { recursive: true })
    writeFileSync(hooksPath(), '')
    expect(isCodexClooksRegistered(codexDir())).toBe(false)

    registerCodexClooks(
      codexDir(),
      makeCodexProjectEntrypointCommand('0123456789abcdef0123456789abcdef'),
    )
    expect(isCodexClooksRegistered(codexDir())).toBe(true)
  })
})

describe('Codex Clooks hook detection', () => {
  test('recognizes literal punctuation and apostrophes only inside generated quoting', () => {
    for (const root of [
      "/tmp/joe's repo",
      '/tmp/$(touch nope); | `literal`',
      '/tmp/space & brackets[]',
      '/tmp/日本語',
    ]) {
      for (const command of [
        makeCodexProjectEntrypointCommand('0123456789abcdef0123456789abcdef'),
        makeCodexGlobalEntrypointCommand(root),
      ]) {
        expect(isCodexClooksHook({ type: 'command', command })).toBe(true)
        expect(isCodexClooksHook({ type: 'prompt', command })).toBe(false)
      }
    }
  })

  test('preserves whole-command false positives through init and unhook', () => {
    const valid = makeCodexProjectEntrypointCommand('0123456789abcdef0123456789abcdef')
    const commands = [
      `echo ${valid}`,
      `printf '%s' ${valid}`,
      `# ${valid}`,
      `${valid} # comment`,
      `${valid}\n`,
      `${valid}; echo next`,
      `${valid} > /tmp/out`,
      `${valid} | cat`,
      `${valid} --extra`,
      `env ${valid}`,
      valid.replace('=codex', '=other'),
      "CLOOKS_AGENT=codex CLOOKS_PROJECT_ROOT='/different' '/tmp/repo/.clooks/bin/entrypoint.sh'",
      "CLOOKS_AGENT=codex '.clooks/bin/entrypoint.sh'",
      'CLOOKS_AGENT=codex "/tmp/repo/.clooks/bin/entrypoint.sh"',
    ]
    const unrelated = commands.map((command) => ({ type: 'command', command }))
    unrelated.push({ type: 'prompt', command: valid })
    for (const hook of unrelated) expect(isCodexClooksHook(hook)).toBe(false)
    writeHooksFile({ hooks: { Stop: [{ hooks: unrelated, custom: 42 }] } })
    registerCodexClooks(codexDir(), valid)
    unregisterCodexClooks(codexDir())
    expect((readHooksFile().hooks as Record<string, unknown>).Stop).toEqual([
      { hooks: unrelated, custom: 42 },
    ])
  })
  test('accepts the supported global command but rejects extra syntax', () => {
    expect(
      isCodexClooksHook({
        type: 'command',
        command: "CLOOKS_AGENT=codex '/tmp/project/.clooks/bin/entrypoint.sh'",
      }),
    ).toBe(true)
    expect(
      isCodexClooksHook({
        type: 'command',
        command:
          "CLOOKS_PROJECT_ROOT='/tmp/project' CLOOKS_AGENT=codex '/tmp/project/.clooks/bin/entrypoint.sh' --extra",
      }),
    ).toBe(false)
  })

  test('rejects missing or invalid command hook types', () => {
    expect(isCodexClooksHook(null)).toBe(false)
    expect(isCodexClooksHook({})).toBe(false)
    expect(
      isCodexClooksHook({
        command: makeCodexProjectEntrypointCommand('0123456789abcdef0123456789abcdef'),
      }),
    ).toBe(false)
    expect(isCodexClooksHook({ type: 'command', command: 42 })).toBe(false)
  })

  test('rejects command hooks missing the Codex assignment or entrypoint suffix', () => {
    expect(
      isCodexClooksHook({ type: 'command', command: '/tmp/project/.clooks/bin/entrypoint.sh' }),
    ).toBe(false)
    expect(
      isCodexClooksHook({ type: 'command', command: "CLOOKS_AGENT=codex '/tmp/other.sh'" }),
    ).toBe(false)
    expect(
      isCodexClooksHook({
        type: 'command',
        command: "CLOOKS_AGENT=claude-code '/tmp/project/.clooks/bin/entrypoint.sh'",
      }),
    ).toBe(false)
  })
})
