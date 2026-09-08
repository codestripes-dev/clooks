import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { symlinkSync, readlinkSync, statSync } from 'fs'
import {
  CODEX_REGISTRATION_EVENTS,
  isCodexClooksHook,
  isCodexClooksRegistered,
  makeCodexGlobalEntrypointCommand,
  makeCodexProjectEntrypointCommand,
  quotePosixSingleArg,
  registerCodexClooks,
  unregisterCodexClooks,
} from './settings.js'

let tempDir: string

describe('registration preservation', () => {
  test('no-op registration preserves noncanonical JSON bytes and inode', () => {
    const command = makeCodexProjectEntrypointCommand(tempDir)
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
      hooks: [{ type: 'command', command: makeCodexProjectEntrypointCommand(tempDir) }],
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
        () => registerCodexClooks(codexDir(), makeCodexProjectEntrypointCommand(tempDir)),
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
              { type: 'command', command: makeCodexProjectEntrypointCommand(tempDir) },
              unrelated,
            ],
          },
        ],
        Stop: [],
      },
    })
    registerCodexClooks(codexDir(), makeCodexProjectEntrypointCommand(tempDir))
    const registered = readFileSync(hooksPath(), 'utf8')
    registerCodexClooks(codexDir(), makeCodexProjectEntrypointCommand(tempDir))
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
          { hooks: [{ type: 'command', command: makeCodexProjectEntrypointCommand(tempDir) }] },
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
      registerCodexClooks(codexDir(), makeCodexProjectEntrypointCommand(tempDir)).created,
    ).toBe(false)
  })

  for (const dangling of [false, true]) {
    test(`rejects ${dangling ? 'dangling' : 'regular-target'} symlinks in every operation`, () => {
      mkdirSync(codexDir(), { recursive: true })
      const target = join(tempDir, 'target.json')
      if (!dangling) writeFileSync(target, '{ "keep": true }')
      symlinkSync(target, hooksPath())
      for (const operation of [
        () => registerCodexClooks(codexDir(), makeCodexProjectEntrypointCommand(tempDir)),
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
  test('exports exactly the ten registration events in stable order', () => {
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
    ])
  })
})

describe('Codex command builders', () => {
  test('quotes POSIX shell arguments with spaces and single quotes', () => {
    expect(quotePosixSingleArg('/tmp/a b')).toBe("'/tmp/a b'")
    expect(quotePosixSingleArg("/tmp/joe's repo")).toBe("'/tmp/joe'\\''s repo'")
  })

  test('project command sets agent, project root, and absolute project entrypoint', () => {
    const projectRoot = join(tempDir, "project with joe's files")

    const command = makeCodexProjectEntrypointCommand(projectRoot)

    expect(command).toBe(
      `CLOOKS_AGENT=codex CLOOKS_PROJECT_ROOT=${quotePosixSingleArg(projectRoot)} ${quotePosixSingleArg(
        join(projectRoot, '.clooks/bin/entrypoint.sh'),
      )}`,
    )
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
    const command = makeCodexProjectEntrypointCommand(tempDir)
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
  test('fresh registration creates hooks.json with ten Clooks events', () => {
    const command = makeCodexProjectEntrypointCommand(tempDir)

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
      const groupHooks = matcherGroup.hooks as Record<string, string>[]
      expect(groupHooks).toEqual([{ type: 'command', command }])
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

    registerCodexClooks(codexDir(), makeCodexProjectEntrypointCommand(tempDir))

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
    const command = makeCodexProjectEntrypointCommand(tempDir)
    registerCodexClooks(codexDir(), command)
    const firstContent = readFileSync(hooksPath(), 'utf-8')

    const result = registerCodexClooks(codexDir(), command)

    expect(result.added).toHaveLength(0)
    expect(result.skipped).toEqual([...CODEX_REGISTRATION_EVENTS])
    expect(result.updated).toHaveLength(0)
    expect(result.created).toBe(false)
    expect(readFileSync(hooksPath(), 'utf-8')).toBe(firstContent)
  })

  test('migrates older Clooks command strings without adding duplicates', () => {
    const oldCommand = "CLOOKS_AGENT=codex '/old/repo/.clooks/bin/entrypoint.sh'"
    const newCommand = makeCodexProjectEntrypointCommand(tempDir)
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
    const newCommand = makeCodexProjectEntrypointCommand(tempDir)
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
    const newCommand = makeCodexProjectEntrypointCommand(tempDir)
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

    const result = registerCodexClooks(codexDir(), makeCodexProjectEntrypointCommand(tempDir))

    expect(result.added).toHaveLength(10)
    expect(result.created).toBe(false)
  })

  test('invalid roots are rejected without changing bytes', () => {
    mkdirSync(codexDir(), { recursive: true })
    for (const text of ['null\n', '[]\n', '42', 'true', '"text"']) {
      writeFileSync(hooksPath(), text)
      expect(() =>
        registerCodexClooks(codexDir(), makeCodexProjectEntrypointCommand(tempDir)),
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
      registerCodexClooks(codexDir(), makeCodexProjectEntrypointCommand(tempDir)),
    ).toThrow('invalid hooks')
    expect(readFileSync(hooksPath(), 'utf8')).toBe(before)
  })

  test('malformed hooks.json throws a descriptive error', () => {
    mkdirSync(codexDir(), { recursive: true })
    writeFileSync(hooksPath(), '{ not valid json')

    expect(() =>
      registerCodexClooks(codexDir(), makeCodexProjectEntrypointCommand(tempDir)),
    ).toThrow(`\`${hooksPath()}\` contains invalid JSON. Repair the file, then retry.`)
  })

  test('unregister removes Clooks hooks and preserves unrelated hooks', () => {
    const command = makeCodexProjectEntrypointCommand(tempDir)
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
    registerCodexClooks(codexDir(), makeCodexProjectEntrypointCommand(tempDir))

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

    registerCodexClooks(codexDir(), makeCodexProjectEntrypointCommand(tempDir))
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
        makeCodexProjectEntrypointCommand(root),
        makeCodexGlobalEntrypointCommand(root),
      ]) {
        expect(isCodexClooksHook({ type: 'command', command })).toBe(true)
        expect(isCodexClooksHook({ type: 'prompt', command })).toBe(false)
      }
    }
  })

  test('preserves whole-command false positives through init and unhook', () => {
    const valid = makeCodexProjectEntrypointCommand(tempDir)
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
  test('accepts the legacy generated command but rejects extra syntax', () => {
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
    expect(isCodexClooksHook({ command: makeCodexProjectEntrypointCommand(tempDir) })).toBe(false)
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
