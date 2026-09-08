import { afterEach, describe, expect, test } from 'bun:test'
import { statSync, cpSync, mkdirSync, readFileSync, renameSync } from 'fs'
import { dirname, join } from 'path'
import { type Sandbox } from './helpers/sandbox'
import { createRegistrationSandbox as createSandbox, registrationEnv } from './helpers/registration'
import { chmodSync, readdirSync, symlinkSync, readlinkSync } from 'fs'

describe('codex registration preservation E2E', () => {
  for (const contents of [
    'null',
    '[]',
    'true',
    '42',
    '"scalar"',
    '{ bad',
    '{"hooks":null}',
    '{"hooks":[]}',
    '{"hooks":{"Stop":{}}}',
    '{"hooks":{"Stop":[null]}}',
    '{"hooks":{"Stop":[{}]}}',
    '{"hooks":{"Stop":[{"hooks":null}]}}',
    '{"hooks":{"Stop":[{"hooks":[[]]}]}}',
    '{"hooks":true}',
    '{"hooks":{"Stop":null}}',
    '{"hooks":{"Stop":[[]]}}',
    '{"hooks":{"Stop":[{"hooks":[null]}]}}',
    '{"hooks":{"Stop":[{"hooks":["bad"]}]}}',
  ]) {
    test(`init and unhook reject ${contents} with exact bytes intact`, () => {
      sandbox = createSandbox()
      sandbox.writeConfig('version: "1.0.0"\n')
      const bytes = '\n ' + contents + '\n'
      sandbox.writeFile('.codex/hooks.json', bytes)
      for (const args of [
        ['init', '--agent', 'codex', '--json'],
        ['uninstall', '--project', '--agent', 'codex', '--unhook', '--force', '--json'],
      ]) {
        const result = sandbox.run(args, { timeout: 10_000 })
        expect(result.exitCode).toBe(1)
        const envelope = JSON.parse(result.stdout)
        expect(envelope.ok).toBe(false)
        expect(envelope.error).toContain(join(sandbox.dir, '.codex/hooks.json'))
        expect(sandbox.readFile('.codex/hooks.json')).toBe(bytes)
      }
    })
  }

  test('mixed metadata, empty groups and command mentions survive init and unhook', () => {
    sandbox = createSandbox()
    expect(sandbox.run(['init', '--agent', 'codex']).exitCode).toBe(0)
    const owned = { type: 'command', command: projectCodexCommand() }
    const unrelated = [
      { type: 'command', command: 'echo CLOOKS_AGENT=codex .clooks/bin/entrypoint.sh' },
      { type: 'command', command: '/usr/bin/echo .clooks/bin/entrypoint.sh' },
      { type: 'command', command: owned.command + ' --extra' },
      ...['; echo extra', ' | cat', ' > output', ' # comment', '\n'].map((suffix) => ({
        type: 'command',
        command: owned.command + suffix,
      })),
      { type: 'command', command: 'printf "%s" ' + owned.command },
      {
        type: 'command',
        command: owned.command.replace('CLOOKS_AGENT=codex', 'CLOOKS_AGENT=claude-code'),
      },
      {
        type: 'command',
        command: owned.command.replace('CLOOKS_PROJECT_ROOT=', 'EXTRA=1 CLOOKS_PROJECT_ROOT='),
      },
      {
        type: 'command',
        command: owned.command.replace(
          `CLOOKS_PROJECT_ROOT='${sandbox.dir}'`,
          "CLOOKS_PROJECT_ROOT='/different'",
        ),
      },
      { type: 'prompt', command: owned.command, prompt: 'keep' },
    ]
    const empty = { hooks: [], extension: { keep: true } }
    const metadata = { matcher: 'Bash', extension: [null, 'keep'] }
    sandbox.writeFile(
      '.codex/hooks.json',
      JSON.stringify({
        extension: { keep: true },
        hooks: { Stop: [empty, { ...metadata, hooks: [owned, ...unrelated] }], Future: [] },
      }),
    )
    expect(sandbox.run(['init', '--agent', 'codex']).exitCode).toBe(0)
    const before = sandbox.readFile('.codex/hooks.json')
    expect(sandbox.run(['init', '--agent', 'codex']).exitCode).toBe(0)
    expect(sandbox.readFile('.codex/hooks.json')).toBe(before)
    const result = sandbox.run([
      'uninstall',
      '--project',
      '--agent',
      'codex',
      '--unhook',
      '--force',
      '--json',
    ])
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout).ok).toBe(true)
    expect(JSON.parse(sandbox.readFile('.codex/hooks.json'))).toEqual({
      extension: { keep: true },
      hooks: { Stop: [empty, { ...metadata, hooks: unrelated }], Future: [] },
    })
  })

  test('parent permission failure preserves bytes and mode, then retry succeeds', () => {
    expect(process.getuid!()).not.toBe(0)
    sandbox = createSandbox()
    expect(sandbox.run(['init', '--agent', 'codex']).exitCode).toBe(0)
    sandbox.writeFile('.codex/hooks.json', '{ "keep": true }\n')
    const directory = join(sandbox.dir, '.codex')
    chmodSync(join(sandbox.dir, '.codex/hooks.json'), 0o640)
    chmodSync(directory, 0o500)
    try {
      const result = sandbox.run(['init', '--agent', 'codex', '--json'])
      expect(result.exitCode).toBe(1)
      expect(JSON.parse(result.stdout).ok).toBe(false)
      expect(sandbox.readFile('.codex/hooks.json')).toBe('{ "keep": true }\n')
      expect(statSync(join(sandbox.dir, '.codex/hooks.json')).mode & 0o777).toBe(0o640)
      expect(readdirSync(directory)).toEqual(['hooks.json'])
    } finally {
      chmodSync(directory, 0o700)
    }
    expect(sandbox.run(['init', '--agent', 'codex']).exitCode).toBe(0)
    expect(JSON.parse(sandbox.readFile('.codex/hooks.json')).keep).toBe(true)
    expect(statSync(join(sandbox.dir, '.codex/hooks.json')).mode & 0o777).toBe(0o640)
    expect(readdirSync(directory)).toEqual(['hooks.json'])
    const registered = sandbox.readFile('.codex/hooks.json')
    const unhook = ['uninstall', '--project', '--agent', 'codex', '--unhook', '--force', '--json']
    chmodSync(directory, 0o500)
    try {
      const result = sandbox.run(unhook)
      expect(result.exitCode).toBe(1)
      expect(JSON.parse(result.stdout).error).toContain('hooks.json')
      expect(sandbox.readFile('.codex/hooks.json')).toBe(registered)
      expect(statSync(join(sandbox.dir, '.codex/hooks.json')).mode & 0o777).toBe(0o640)
      expect(readdirSync(directory)).toEqual(['hooks.json'])
    } finally {
      chmodSync(directory, 0o700)
    }
    expect(sandbox.run(unhook).exitCode).toBe(0)
    expect(JSON.parse(sandbox.readFile('.codex/hooks.json'))).toEqual({ keep: true })
    expect(statSync(join(sandbox.dir, '.codex/hooks.json')).mode & 0o777).toBe(0o640)
    expect(readdirSync(directory)).toEqual(['hooks.json'])
  })

  test('first registration write failure leaves no destination and can be retried', () => {
    sandbox = createSandbox()
    expect(process.getuid!()).not.toBe(0)
    sandbox.writeConfig('version: "1.0.0"\n')
    const directory = join(sandbox.dir, '.codex')
    mkdirSync(directory)
    chmodSync(directory, 0o500)
    try {
      const result = sandbox.run(['init', '--agent', 'codex', '--json'])
      expect(result.exitCode).toBe(1)
      const envelope = JSON.parse(result.stdout)
      expect(envelope.ok).toBe(false)
      expect(envelope.error).toContain(directory)
      expect(sandbox.fileExists('.codex/hooks.json')).toBe(false)
      expect(readdirSync(directory)).toEqual([])
    } finally {
      chmodSync(directory, 0o700)
    }
    expect(sandbox.run(['init', '--agent', 'codex']).exitCode).toBe(0)
    expect(JSON.parse(sandbox.readFile('.codex/hooks.json')).hooks.Stop).toHaveLength(1)
    expect(readdirSync(directory)).toEqual(['hooks.json'])
  })

  test('whitespace files initialize and unknown event values remain opaque', () => {
    sandbox = createSandbox()
    sandbox.writeFile('.codex/hooks.json', ' \n\t')
    expect(sandbox.run(['init', '--agent', 'codex']).exitCode).toBe(0)
    const document = JSON.parse(sandbox.readFile('.codex/hooks.json'))
    document.hooks.Future = { arbitrary: [null, false, { keep: true }] }
    document.extension = ['keep', 42]
    const bytes = JSON.stringify(document, null, 4) + '\n'
    sandbox.writeFile('.codex/hooks.json', bytes)
    expect(sandbox.run(['init', '--agent', 'codex']).exitCode).toBe(0)
    expect(sandbox.readFile('.codex/hooks.json')).toBe(bytes)
  })

  for (const dangling of [false, true]) {
    test(`CLI rejects ${dangling ? 'dangling' : 'regular-target'} registration symlinks`, () => {
      sandbox = createSandbox()
      sandbox.writeConfig('version: "1.0.0"\n')
      sandbox.writeFile('.codex/keep', '')
      const target = join(sandbox.dir, 'target.json')
      if (!dangling) sandbox.writeFile('target.json', '{ "keep": true }')
      symlinkSync(target, join(sandbox.dir, '.codex/hooks.json'))
      for (const args of [
        ['init', '--agent', 'codex', '--json'],
        ['uninstall', '--project', '--agent', 'codex', '--unhook', '--force', '--json'],
      ]) {
        const result = sandbox.run(args)
        expect(result.exitCode).toBe(1)
        expect(JSON.parse(result.stdout).error).toContain('hooks.json')
        expect(readlinkSync(join(sandbox.dir, '.codex/hooks.json'))).toBe(target)
        expect(sandbox.fileExists('target.json')).toBe(!dangling)
        if (!dangling) expect(sandbox.readFile('target.json')).toBe('{ "keep": true }')
      }
    })
  }
})

const CODEX_EVENTS = [
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
]

const CLAUDE_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'UserPromptSubmit',
  'SessionStart',
  'SessionEnd',
  'Stop',
  'StopFailure',
  'SubagentStop',
  'SubagentStart',
  'InstructionsLoaded',
  'PostToolUseFailure',
  'Notification',
  'PermissionRequest',
  'PermissionDenied',
  'ConfigChange',
  'WorktreeCreate',
  'WorktreeRemove',
  'PreCompact',
  'PostCompact',
  'TeammateIdle',
  'TaskCreated',
  'TaskCompleted',
]

const CLAUDE_PROJECT_COMMAND = '"$CLAUDE_PROJECT_DIR"/.clooks/bin/entrypoint.sh'

let sandbox: Sandbox

afterEach(() => {
  sandbox?.cleanup()
})

function readProjectCodexHooks(): Record<string, unknown> {
  return JSON.parse(sandbox.readFile('.codex/hooks.json')) as Record<string, unknown>
}

function readHomeCodexHooks(): Record<string, unknown> {
  return JSON.parse(sandbox.readHomeFile('.codex/hooks.json')) as Record<string, unknown>
}

function expectCodexRegistration(
  hooksFile: Record<string, unknown>,
  expectedCommand: string,
): void {
  expect(Object.keys(hooksFile)).toEqual(['hooks'])
  expect(typeof hooksFile.hooks).toBe('object')
  expect(hooksFile.hooks).not.toBeNull()
  expect(Array.isArray(hooksFile.hooks)).toBe(false)

  const hooks = hooksFile.hooks as Record<string, unknown>
  expect(Object.keys(hooks).sort()).toEqual([...CODEX_EVENTS].sort())

  for (const event of CODEX_EVENTS) {
    expect(hooks[event]).toEqual([
      {
        matcher: '*',
        hooks: [{ type: 'command', command: expectedCommand }],
      },
    ])
  }
}

function expectClaudeProjectRegistration(): void {
  const settings = JSON.parse(sandbox.readFile('.claude/settings.json')) as Record<string, unknown>
  expect(typeof settings.hooks).toBe('object')
  expect(settings.hooks).not.toBeNull()
  expect(Array.isArray(settings.hooks)).toBe(false)

  const hooks = settings.hooks as Record<string, unknown>
  expect(Object.keys(hooks).sort()).toEqual([...CLAUDE_EVENTS].sort())

  for (const event of CLAUDE_EVENTS) {
    expect(hooks[event]).toEqual([
      {
        hooks: [{ type: 'command', command: CLAUDE_PROJECT_COMMAND }],
      },
    ])
  }
}

function projectCodexCommand(root = sandbox.dir): string {
  const quote = (value: string) => "'" + value.split("'").join("'\\''") + "'"
  const entrypointPath = join(root, '.clooks/bin/entrypoint.sh')
  return `CLOOKS_AGENT=codex CLOOKS_PROJECT_ROOT=${quote(root)} ${quote(entrypointPath)}`
}

function globalCodexCommand(): string {
  return `CLOOKS_AGENT=codex '${join(sandbox.home, '.clooks/bin/entrypoint.sh')}'`
}

function registeredCommand(root: string): string {
  return JSON.parse(readFileSync(join(root, '.codex/hooks.json'), 'utf8')).hooks.Stop[0].hooks[0]
    .command
}

function probeCommand(command: string, cwd: string, extra: Record<string, string> = {}): string[] {
  const result = Bun.spawnSync(['bash', '-c', command], {
    cwd,
    stdin: Buffer.from('probe-input\n'),
    env: {
      ...registrationEnv(sandbox),
      ...extra,
    },
    timeout: 10_000,
  })
  expect(result.exitCode).toBe(0)
  expect(result.stderr.toString()).toBe('')
  const fields = result.stdout.toString().split('\0')
  expect(fields.splice(5, 3)).toEqual([sandbox.home, sandbox.home, join(sandbox.home, '.codex')])
  expect(fields[5]).toBe('probe-input\n')
  fields[5] = 'probe-input'
  return fields
}

function installProbe(): void {
  sandbox.writeStubBinary(`#!/bin/bash
set -euo pipefail
printf '%s\\0' invoked "$CLOOKS_AGENT" "\${CLOOKS_PROJECT_ROOT-unset}" "\${CLAUDE_PROJECT_DIR-unset}" "$PWD" "$HOME" "$CLOOKS_HOME_ROOT" "$CODEX_HOME"
cat
`)
}

describe('registered Codex shell commands', () => {
  for (const moved of [false, true]) {
    test(`re-init repairs copied paths with old checkout ${moved ? 'moved away' : 'still present'}`, () => {
      sandbox = createSandbox()
      const oldRoot = join(sandbox.dir, "A joe's $(literal); 日本語")
      const newRoot = join(sandbox.dir, "B joe's $(literal); 日本語")
      mkdirSync(oldRoot)
      expect(sandbox.run(['init', '--agent', 'codex'], { cwd: oldRoot }).exitCode).toBe(0)
      const oldBytes = readFileSync(join(oldRoot, '.codex/hooks.json'), 'utf8')
      cpSync(oldRoot, newRoot, { recursive: true })
      installProbe()
      expect(registeredCommand(newRoot)).toBe(projectCodexCommand(oldRoot))
      expect(probeCommand(registeredCommand(newRoot), newRoot)).toEqual([
        'invoked',
        'codex',
        oldRoot,
        'unset',
        newRoot,
        'probe-input',
      ])
      const retained = moved ? join(sandbox.dir, 'retained-old') : oldRoot
      if (moved) renameSync(oldRoot, retained)
      expect(sandbox.run(['init', '--agent', 'codex'], { cwd: newRoot }).exitCode).toBe(0)
      const command = registeredCommand(newRoot)
      expect(command).toBe(projectCodexCommand(newRoot))
      mkdirSync(join(newRoot, 'subdir'))
      for (const cwd of [newRoot, join(newRoot, 'subdir')]) {
        expect(
          probeCommand(command, cwd, {
            CLOOKS_PROJECT_ROOT: '/ignored',
            CLAUDE_PROJECT_DIR: '/inherited-claude',
          }),
        ).toEqual(['invoked', 'codex', newRoot, '/inherited-claude', cwd, 'probe-input'])
      }
      expect(readFileSync(join(retained, '.codex/hooks.json'), 'utf8')).toBe(oldBytes)
      const repaired = readFileSync(join(newRoot, '.codex/hooks.json'), 'utf8')
      expect(repaired).not.toContain(oldRoot)
      expectCodexRegistration(JSON.parse(repaired), projectCodexCommand(newRoot))
      expect(sandbox.run(['init', '--agent', 'codex'], { cwd: newRoot }).exitCode).toBe(0)
      expect(readFileSync(join(newRoot, '.codex/hooks.json'), 'utf8')).toBe(repaired)
    })
  }

  test('nested non-git roots retain their explicit command roots', () => {
    sandbox = createSandbox()
    expect(sandbox.run(['init', '--agent', 'codex']).exitCode).toBe(0)
    const nested = join(sandbox.dir, 'nested')
    mkdirSync(nested)
    expect(sandbox.run(['init', '--agent', 'codex'], { cwd: nested }).exitCode).toBe(0)
    installProbe()
    expect(registeredCommand(sandbox.dir)).toBe(projectCodexCommand(sandbox.dir))
    expect(registeredCommand(nested)).toBe(projectCodexCommand(nested))
    expect(probeCommand(registeredCommand(sandbox.dir), nested)[2]).toBe(sandbox.dir)
    expect(probeCommand(registeredCommand(nested), nested)[2]).toBe(nested)
  })

  test('worktree registration targets the worktree instead of the main git root', () => {
    sandbox = createSandbox()
    const git = (args: string[]) => {
      const result = Bun.spawnSync(['git', ...args], {
        cwd: sandbox.dir,
        env: registrationEnv(sandbox),
        timeout: 10_000,
      })
      expect(result.exitCode).toBe(0)
    }
    git(['init'])
    git([
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '--allow-empty',
      '-m',
      'fixture',
    ])
    const worktree = join(dirname(sandbox.dir), 'worktree')
    git(['worktree', 'add', '-b', 'fixture-worktree', worktree])
    expect(sandbox.run(['init', '--agent', 'codex'], { cwd: worktree }).exitCode).toBe(0)
    installProbe()
    expect(registeredCommand(worktree)).toBe(projectCodexCommand(worktree))
    expect(probeCommand(registeredCommand(worktree), sandbox.dir)[2]).toBe(worktree)
  })

  test('global command forwards intentional root and inherited Claude environment', () => {
    sandbox = createSandbox()
    expect(sandbox.run(['init', '--global', '--agent', 'codex']).exitCode).toBe(0)
    installProbe()
    expect(
      probeCommand(registeredCommand(sandbox.home), sandbox.dir, {
        CLOOKS_PROJECT_ROOT: '/intentional',
        CLAUDE_PROJECT_DIR: '/inherited-claude',
      }),
    ).toEqual(['invoked', 'codex', '/intentional', '/inherited-claude', sandbox.dir, 'probe-input'])
  })

  test('reader stress coverage observes complete JSON during repeated large CLI changes', async () => {
    // Scheduling is uncontrolled; this supplements deterministic writer fault-injection tests.
    sandbox = createSandbox()
    expect(sandbox.run(['init', '--agent', 'codex']).exitCode).toBe(0)
    const document = readProjectCodexHooks()
    document.padding = 'x'.repeat(1_000_000)
    sandbox.writeFile('.codex/hooks.json', JSON.stringify(document))
    let observations = 0
    for (let iteration = 0; iteration < 6; iteration++) {
      let done = false
      const args =
        iteration % 2 === 0
          ? ['uninstall', '--project', '--agent', 'codex', '--unhook', '--force', '--json']
          : ['init', '--agent', 'codex', '--json']
      const writing = sandbox.runAsync(args, { timeout: 10_000 }).finally(() => {
        done = true
      })
      try {
        while (!done) {
          const observed = JSON.parse(sandbox.readFile('.codex/hooks.json'))
          expect(observed).toEqual(
            observed.hooks === undefined ? { padding: document.padding } : document,
          )
          observations++
          await Bun.sleep(1)
        }
      } finally {
        expect((await writing).exitCode).toBe(0)
      }
      expect(JSON.parse(sandbox.readFile('.codex/hooks.json'))).toEqual(
        iteration % 2 === 0 ? { padding: document.padding } : document,
      )
    }
    expect(observations).toBeGreaterThan(0)
  }, 30_000)
})

describe('codex registration E2E', () => {
  test('re-init migrates duplicate legacy absolute commands to one command per event', () => {
    sandbox = createSandbox()
    const legacy = {
      matcher: '*',
      hooks: [
        {
          type: 'command',
          command: "CLOOKS_AGENT=codex '/old checkout/.clooks/bin/entrypoint.sh'",
        },
      ],
    }
    sandbox.writeFile(
      '.codex/hooks.json',
      JSON.stringify({
        hooks: Object.fromEntries(CODEX_EVENTS.map((event) => [event, [legacy, legacy]])),
      }),
    )
    expect(sandbox.run(['init', '--agent', 'codex']).exitCode).toBe(0)
    expectCodexRegistration(readProjectCodexHooks(), projectCodexCommand())
    const bytes = sandbox.readFile('.codex/hooks.json')
    expect(sandbox.run(['init', '--agent', 'codex']).exitCode).toBe(0)
    expect(sandbox.readFile('.codex/hooks.json')).toBe(bytes)
  })

  test('init --agent codex creates project entrypoint and Codex hooks.json commands', () => {
    sandbox = createSandbox()

    const result = sandbox.run(['init', '--agent', 'codex'], { timeout: 10_000 })
    expect(result.exitCode).toBe(0)

    expect(sandbox.fileExists('.clooks/bin/entrypoint.sh')).toBe(true)
    expect(statSync(join(sandbox.dir, '.clooks/bin/entrypoint.sh')).mode & 0o111).not.toBe(0)
    expect(sandbox.fileExists('.codex/hooks.json')).toBe(true)
    expect(sandbox.fileExists('.claude/settings.json')).toBe(false)

    expectCodexRegistration(readProjectCodexHooks(), projectCodexCommand())
  })

  test('second init --agent codex is idempotent and does not duplicate Clooks hooks', () => {
    sandbox = createSandbox()

    const first = sandbox.run(['init', '--agent', 'codex'], { timeout: 10_000 })
    expect(first.exitCode).toBe(0)

    const before = sandbox.readFile('.codex/hooks.json')
    const second = sandbox.run(['init', '--agent', 'codex'], { timeout: 10_000 })
    expect(second.exitCode).toBe(0)

    expect(sandbox.readFile('.codex/hooks.json')).toBe(before)
    expectCodexRegistration(readProjectCodexHooks(), projectCodexCommand())
  })

  test('init --agent all preserves Claude registration and adds Codex registration', () => {
    sandbox = createSandbox()

    const result = sandbox.run(['init', '--agent', 'all'], { timeout: 10_000 })
    expect(result.exitCode).toBe(0)

    expect(sandbox.fileExists('.clooks/bin/entrypoint.sh')).toBe(true)
    expect(sandbox.fileExists('.claude/settings.json')).toBe(true)
    expect(sandbox.fileExists('.codex/hooks.json')).toBe(true)

    expectClaudeProjectRegistration()
    expectCodexRegistration(readProjectCodexHooks(), projectCodexCommand())
  })

  test('global init --agent codex registers Codex without project root or Claude global flag', () => {
    sandbox = createSandbox()

    const result = sandbox.run(['init', '--global', '--agent', 'codex'], { timeout: 10_000 })
    expect(result.exitCode).toBe(0)

    expect(sandbox.homeFileExists('.clooks/bin/entrypoint.sh')).toBe(true)
    expect(sandbox.homeFileExists('.codex/hooks.json')).toBe(true)
    expect(sandbox.homeFileExists('.clooks/.global-entrypoint-active.codex')).toBe(true)
    expect(sandbox.homeFileExists('.clooks/.global-entrypoint-active')).toBe(false)
    expect(sandbox.homeFileExists('.claude/settings.json')).toBe(false)

    const hooksFile = readHomeCodexHooks()
    expectCodexRegistration(hooksFile, globalCodexCommand())

    for (const matcherGroups of Object.values(hooksFile.hooks as Record<string, unknown[]>)) {
      const firstGroup = (matcherGroups as Array<{ hooks: Array<{ command: string }> }>)[0]
      expect(firstGroup?.hooks[0]?.command).not.toContain('CLOOKS_PROJECT_ROOT')
    }
  })

  test('uninstall --agent codex --unhook removes only Codex registration', () => {
    sandbox = createSandbox()

    const init = sandbox.run(['init', '--agent', 'all'], { timeout: 10_000 })
    expect(init.exitCode).toBe(0)

    const hooksFile = readProjectCodexHooks()
    const hooks = hooksFile.hooks as Record<string, unknown[]>
    const preToolUseGroups = hooks.PreToolUse
    expect(Array.isArray(preToolUseGroups)).toBe(true)
    preToolUseGroups!.push({
      matcher: 'Bash',
      hooks: [{ type: 'command', command: '/usr/local/bin/other-codex-hook' }],
    })
    sandbox.writeFile('.codex/hooks.json', JSON.stringify(hooksFile, null, 2) + '\n')

    const result = sandbox.run([
      'uninstall',
      '--agent',
      'codex',
      '--project',
      '--unhook',
      '--force',
    ])
    expect(result.exitCode).toBe(0)

    expect(sandbox.fileExists('.clooks/clooks.yml')).toBe(true)
    expectClaudeProjectRegistration()

    const afterCodex = readProjectCodexHooks()
    expect(afterCodex.hooks).toEqual({
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [{ type: 'command', command: '/usr/local/bin/other-codex-hook' }],
        },
      ],
    })
  })
})
