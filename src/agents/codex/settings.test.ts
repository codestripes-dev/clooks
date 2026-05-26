import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
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
  test('exports exactly the ten Plan A registration events in stable order', () => {
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
      hookCommandsFor('PreToolUse').filter((command) => isCodexClooksHook({ command })),
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

  test('valid JSON with root null or array is treated as empty and overwritten on write', () => {
    mkdirSync(codexDir(), { recursive: true })
    writeFileSync(hooksPath(), 'null\n')
    let result = registerCodexClooks(codexDir(), makeCodexProjectEntrypointCommand(tempDir))
    expect(result.added).toHaveLength(10)
    expect(readHooksFile().hooks).toBeDefined()

    writeFileSync(hooksPath(), '[]\n')
    result = registerCodexClooks(codexDir(), makeCodexProjectEntrypointCommand(tempDir))
    expect(result.added).toHaveLength(10)
    expect(readHooksFile().hooks).toBeDefined()
  })

  test('valid JSON with invalid hooks shape preserves top-level fields and replaces hooks', () => {
    writeHooksFile({
      keep: true,
      hooks: [{ matcher: '*', hooks: [{ type: 'command', command: 'array-hook.sh' }] }],
    })

    const result = registerCodexClooks(codexDir(), makeCodexProjectEntrypointCommand(tempDir))

    expect(result.added).toHaveLength(10)
    const hooksFile = readHooksFile()
    expect(hooksFile.keep).toBe(true)
    expect(Array.isArray(hooksFile.hooks)).toBe(false)
    expect((hooksFile.hooks as Record<string, unknown>).PreToolUse).toBeDefined()
  })

  test('malformed hooks.json throws a descriptive error', () => {
    mkdirSync(codexDir(), { recursive: true })
    writeFileSync(hooksPath(), '{ not valid json')

    expect(() =>
      registerCodexClooks(codexDir(), makeCodexProjectEntrypointCommand(tempDir)),
    ).toThrow(
      `\`${hooksPath()}\` contains invalid JSON. Fix or delete the file, then re-run \`clooks init --agent codex\`.`,
    )
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
  test('uses required substrings instead of Claude endsWith detection', () => {
    expect(
      isCodexClooksHook({
        command: "CLOOKS_AGENT=codex '/tmp/project/.clooks/bin/entrypoint.sh'",
      }),
    ).toBe(true)
    expect(
      isCodexClooksHook({
        command:
          "CLOOKS_PROJECT_ROOT='/tmp/project' CLOOKS_AGENT=codex '/tmp/project/.clooks/bin/entrypoint.sh' --extra",
      }),
    ).toBe(true)
  })

  test('rejects edge cases missing either ownership substring', () => {
    expect(isCodexClooksHook(null)).toBe(false)
    expect(isCodexClooksHook({})).toBe(false)
    expect(isCodexClooksHook({ command: 42 })).toBe(false)
    expect(isCodexClooksHook({ command: '/tmp/project/.clooks/bin/entrypoint.sh' })).toBe(false)
    expect(isCodexClooksHook({ command: "CLOOKS_AGENT=codex '/tmp/other.sh'" })).toBe(false)
    expect(
      isCodexClooksHook({
        command: "CLOOKS_AGENT=claude-code '/tmp/project/.clooks/bin/entrypoint.sh'",
      }),
    ).toBe(false)
  })
})
