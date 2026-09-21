import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CLAUDE_PROJECT_RUNTIME_ADVISORY_COMMAND,
  hasRuntimeAdvisoryRegistration,
  isClaudeRuntimeAdvisoryHook,
  isCodexRuntimeAdvisoryHook,
  makeClaudeGlobalRuntimeAdvisoryCommand,
  makeCodexGlobalRuntimeAdvisoryCommand,
  makeCodexProjectRuntimeAdvisoryCommand,
  registerRuntimeAdvisory,
  runtimeAdvisoryGlobalRoot,
  unregisterRuntimeAdvisory,
} from './registration-advisory.js'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'clooks-registration-advisory-'))
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

function hooksPath(agent: 'claude-code' | 'codex'): string {
  return join(root, agent === 'codex' ? '.codex/hooks.json' : '.claude/settings.json')
}

function registrationDir(agent: 'claude-code' | 'codex'): string {
  return join(root, agent === 'codex' ? '.codex' : '.claude')
}

function commandHook(command: string): Record<string, unknown> {
  return { type: 'command', command }
}

describe('runtime advisory command ownership', () => {
  test('builds stable project and global commands', () => {
    expect(CLAUDE_PROJECT_RUNTIME_ADVISORY_COMMAND).toBe(
      'CLOOKS_AGENT=claude-code sh -c \'advisory="$CLAUDE_PROJECT_DIR/.clooks/bin/runtime-advisory.sh"\n[ -f "$advisory" ] && [ -r "$advisory" ] || exit 0\nexec bash "$advisory"\' clooks-advisory-project',
    )
    expect(makeClaudeGlobalRuntimeAdvisoryCommand("/home/user's space")).toEndWith(
      " clooks-advisory-global '/home/user'\\''s space/.clooks/bin/runtime-advisory.sh'",
    )
    expect(makeCodexGlobalRuntimeAdvisoryCommand('/home/user')).toEndWith(
      " clooks-advisory-global '/home/user/.clooks/bin/runtime-advisory.sh'",
    )
    expect(makeCodexProjectRuntimeAdvisoryCommand('a'.repeat(32))).toEndWith(
      " clooks-advisory-project 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'",
    )
  })

  test('recognizes only canonical advisory commands', () => {
    const claude = makeClaudeGlobalRuntimeAdvisoryCommand(root)
    const codexProject = makeCodexProjectRuntimeAdvisoryCommand('b'.repeat(32))
    const codexGlobal = makeCodexGlobalRuntimeAdvisoryCommand(root)
    expect(isClaudeRuntimeAdvisoryHook(commandHook(CLAUDE_PROJECT_RUNTIME_ADVISORY_COMMAND))).toBe(
      true,
    )
    expect(isClaudeRuntimeAdvisoryHook(commandHook(claude))).toBe(true)
    expect(isCodexRuntimeAdvisoryHook(commandHook(codexProject))).toBe(true)
    expect(isCodexRuntimeAdvisoryHook(commandHook(codexGlobal))).toBe(true)

    for (const command of [
      `${claude} --extra`,
      claude.replace('clooks-advisory-global', 'clooks-project'),
      claude.replace(root, `/tmp/../${root.slice(1)}`),
      codexProject.replace('clooks-advisory-project', 'clooks-project'),
      codexProject.replace("'bbbb", "'Bbbb"),
      `CLOOKS_AGENT=codex ${claude} --extra`,
    ]) {
      expect(isClaudeRuntimeAdvisoryHook(commandHook(command))).toBe(false)
      expect(isCodexRuntimeAdvisoryHook(commandHook(command))).toBe(false)
    }
    expect(isCodexRuntimeAdvisoryHook({ type: 'command', command: codexGlobal, timeout: 3 })).toBe(
      true,
    )
  })

  test('extracts a strict global root without resolving filesystem aliases', () => {
    const physical = join(root, 'physical home')
    const alias = join(root, 'home alias')
    mkdirSync(physical)
    symlinkSync(physical, alias)

    for (const [agent, command] of [
      ['claude-code', makeClaudeGlobalRuntimeAdvisoryCommand(alias)],
      ['codex', makeCodexGlobalRuntimeAdvisoryCommand(alias)],
    ] as const) {
      expect(runtimeAdvisoryGlobalRoot(commandHook(command), agent)).toBe(alias)
      expect(runtimeAdvisoryGlobalRoot({ ...commandHook(command), timeout: 3 }, agent)).toBe(alias)
      expect(runtimeAdvisoryGlobalRoot(commandHook(`${command} --extra`), agent)).toBeUndefined()
      expect(
        runtimeAdvisoryGlobalRoot(
          commandHook(command.replace('clooks-advisory-global', 'clooks-global')),
          agent,
        ),
      ).toBeUndefined()
    }
  })

  test('guarded commands are quiet when generated files are missing', () => {
    for (const [command, env] of [
      [CLAUDE_PROJECT_RUNTIME_ADVISORY_COMMAND, { CLAUDE_PROJECT_DIR: root }],
      [makeClaudeGlobalRuntimeAdvisoryCommand(root), {}],
      [makeCodexGlobalRuntimeAdvisoryCommand(root), {}],
      [makeCodexProjectRuntimeAdvisoryCommand('d'.repeat(32)), { HOME: root }],
    ] as const) {
      const result = Bun.spawnSync(['/bin/sh', '-c', command], { cwd: root, env })
      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString()).toBe('')
      expect(result.stderr.toString()).toBe('')
    }
  })
})

describe.each(['claude-code', 'codex'] as const)('%s advisory registration', (agent) => {
  const command = () =>
    agent === 'codex'
      ? makeCodexProjectRuntimeAdvisoryCommand('c'.repeat(32))
      : CLAUDE_PROJECT_RUNTIME_ADVISORY_COMMAND

  test('adds one separate SessionStart group and preserves runtime and unrelated hooks', () => {
    const path = hooksPath(agent)
    mkdirSync(registrationDir(agent), { recursive: true })
    const runtime = commandHook('runtime-command')
    const unrelated = commandHook('unrelated-command')
    writeFileSync(
      path,
      JSON.stringify(
        {
          keep: true,
          hooks: {
            SessionStart: [{ matcher: 'keep', note: 'mixed', hooks: [runtime, unrelated] }],
            PreToolUse: [{ hooks: [unrelated] }],
          },
        },
        null,
        2,
      ) + '\n',
    )

    expect(registerRuntimeAdvisory(registrationDir(agent), agent, command())).toEqual({
      added: true,
      skipped: false,
      updated: false,
      created: false,
    })
    const contents = JSON.parse(readFileSync(path, 'utf8'))
    expect(contents.keep).toBe(true)
    expect(contents.hooks.PreToolUse).toEqual([{ hooks: [unrelated] }])
    expect(contents.hooks.SessionStart).toHaveLength(2)
    expect(contents.hooks.SessionStart[0]).toEqual({
      matcher: 'keep',
      note: 'mixed',
      hooks: [runtime, unrelated],
    })
    expect(contents.hooks.SessionStart[1]).toEqual({
      ...(agent === 'codex' ? { matcher: '*' } : {}),
      hooks: [commandHook(command())],
    })
    expect(hasRuntimeAdvisoryRegistration(registrationDir(agent), agent, command())).toBe(true)
  })

  test('is byte and inode stable when already canonical', () => {
    registerRuntimeAdvisory(registrationDir(agent), agent, command())
    const path = hooksPath(agent)
    const before = readFileSync(path, 'utf8')
    const inode = statSync(path).ino
    expect(registerRuntimeAdvisory(registrationDir(agent), agent, command())).toEqual({
      added: false,
      skipped: true,
      updated: false,
      created: false,
    })
    expect(readFileSync(path, 'utf8')).toBe(before)
    expect(statSync(path).ino).toBe(inode)
  })

  test('normalizes duplicate owned hooks without changing mixed metadata', () => {
    registerRuntimeAdvisory(registrationDir(agent), agent, command())
    const path = hooksPath(agent)
    const contents = JSON.parse(readFileSync(path, 'utf8'))
    contents.hooks.SessionStart.unshift({
      matcher: 'mixed',
      keep: 1,
      hooks: [commandHook(command()), commandHook('keep-me')],
    })
    writeFileSync(path, JSON.stringify(contents, null, 2) + '\n')

    expect(registerRuntimeAdvisory(registrationDir(agent), agent, command()).updated).toBe(true)
    const next = JSON.parse(readFileSync(path, 'utf8'))
    expect(next.hooks.SessionStart).toEqual([
      { matcher: 'mixed', keep: 1, hooks: [commandHook('keep-me')] },
      {
        ...(agent === 'codex' ? { matcher: '*' } : {}),
        hooks: [commandHook(command())],
      },
    ])
  })

  test('normalizes extra fields on owned handlers and preserves them on foreign handlers', () => {
    const path = hooksPath(agent)
    mkdirSync(registrationDir(agent), { recursive: true })
    writeFileSync(
      path,
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              keep: true,
              hooks: [
                { ...commandHook(command()), timeout: 3 },
                { ...commandHook('foreign'), timeout: 7 },
              ],
            },
          ],
        },
      }),
    )

    expect(hasRuntimeAdvisoryRegistration(registrationDir(agent), agent, command())).toBe(true)
    expect(registerRuntimeAdvisory(registrationDir(agent), agent, command()).updated).toBe(true)
    const next = JSON.parse(readFileSync(path, 'utf8'))
    expect(next.hooks.SessionStart[0]).toEqual({
      keep: true,
      hooks: [{ ...commandHook('foreign'), timeout: 7 }],
    })
    expect(next.hooks.SessionStart[1].hooks).toEqual([commandHook(command())])
  })

  test('removes advisory-only scope and preserves other registrations', () => {
    registerRuntimeAdvisory(registrationDir(agent), agent, command())
    const path = hooksPath(agent)
    const contents = JSON.parse(readFileSync(path, 'utf8'))
    contents.hooks.SessionStart.unshift({ hooks: [commandHook('runtime-command')] })
    contents.hooks.PreToolUse = [{ hooks: [commandHook('keep')] }]
    writeFileSync(path, JSON.stringify(contents, null, 2) + '\n')

    expect(unregisterRuntimeAdvisory(registrationDir(agent), agent)).toEqual({ removed: true })
    const next = JSON.parse(readFileSync(path, 'utf8'))
    expect(next.hooks).toEqual({
      SessionStart: [{ hooks: [commandHook('runtime-command')] }],
      PreToolUse: [{ hooks: [commandHook('keep')] }],
    })
    expect(unregisterRuntimeAdvisory(registrationDir(agent), agent)).toEqual({ removed: false })
  })
})
