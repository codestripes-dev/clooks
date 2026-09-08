import { afterEach, describe, expect, test } from 'bun:test'
import {
  statSync,
  cpSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  existsSync,
  writeFileSync,
  realpathSync,
  utimesSync,
} from 'fs'
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

const receiptPath = '.clooks/.global-entrypoint-active.codex'
const trackedPath = '.clooks/.codex-registration-home'
const initGlobalCodex = ['init', '--global', '--agent', 'codex', '--json']
const unhookGlobalCodex = [
  'uninstall',
  '--global',
  '--agent',
  'codex',
  '--unhook',
  '--force',
  '--json',
]
const fullGlobalCodex = ['uninstall', '--global', '--agent', 'codex', '--full', '--force', '--json']
type ProbeEnv = Record<string, string | undefined>

function receiptProbe(): void {
  sandbox.writeStubBinary(`#!/bin/bash
set -euo pipefail
printf 'call\\n' >> "$PROBE_LOG"
printf '%s\\0' "\${CLOOKS_AGENT-unset}" "\${CLOOKS_PROJECT_ROOT-unset}" "\${CLAUDE_PROJECT_DIR-unset}" "$PWD" "$HOME" "\${CLOOKS_HOME_ROOT-unset}" "\${CODEX_HOME-unset}"
cat
`)
}

function calls(): number {
  const path = join(sandbox.dir, 'probe-calls')
  return existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').length : 0
}

function launchReceiptCommand(
  command: string,
  expected: 'project' | 'global' | 'suppressed',
  extra: ProbeEnv = {},
  agent = 'codex',
): void {
  const env: ProbeEnv = {
    ...registrationEnv(sandbox),
    PROBE_LOG: join(sandbox.dir, 'probe-calls'),
    ...extra,
  }
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key]
  const before = calls()
  const result = Bun.spawnSync(['/bin/bash', '-euo', 'pipefail', '-c', command], {
    cwd: sandbox.dir,
    env: env as Record<string, string>,
    stdin: Buffer.from('receipt-probe-input\n'),
    timeout: 10_000,
  })
  expect(result.exitCode).toBe(0)
  expect(result.stderr.toString()).toBe('')
  expect(calls()).toBe(before + (expected === 'suppressed' ? 0 : 1))
  if (expected === 'suppressed') {
    expect(before).toBeGreaterThan(0)
    return
  }
  expect(result.stdout.toString().split('\0')).toEqual([
    agent,
    expected === 'project' && agent === 'codex'
      ? sandbox.dir
      : (env.CLOOKS_PROJECT_ROOT ?? 'unset'),
    env.CLAUDE_PROJECT_DIR ?? 'unset',
    sandbox.dir,
    env.HOME!,
    env.CLOOKS_HOME_ROOT ?? 'unset',
    env.CODEX_HOME ?? 'unset',
    'receipt-probe-input\n',
  ])
}

function expectReceipt(codexHome = join(sandbox.home, '.codex'), home = sandbox.home): void {
  const hooks = readFileSync(join(codexHome, 'hooks.json'))
  const sum = Bun.spawnSync(['/usr/bin/cksum'], {
    cwd: sandbox.dir,
    stdin: hooks,
    env: { ...registrationEnv(sandbox), HOME: home, CLOOKS_HOME_ROOT: home, CODEX_HOME: codexHome },
    timeout: 10_000,
  })
  expect(sum.exitCode).toBe(0)
  const fields = sum.stdout.toString().trim().split(/\s+/)
  expect(fields).toHaveLength(2)
  expect(readFileSync(join(home, receiptPath), 'utf8')).toBe(
    `clooks-codex-registration-v1\n${realpathSync(home)}\n${realpathSync(codexHome)}\n${fields.join(':')}\n`,
  )
  expect(readFileSync(join(home, trackedPath), 'utf8')).toBe(
    `clooks-codex-home-v1\n${realpathSync(codexHome)}\n`,
  )
}

function initializeReceipt(codexHome?: string): ProbeEnv {
  sandbox = createSandbox()
  const env: Record<string, string> = codexHome ? { CODEX_HOME: join(sandbox.dir, codexHome) } : {}
  expect(sandbox.run(['init', '--agent', 'codex']).exitCode).toBe(0)
  receiptProbe()
  launchReceiptCommand(registeredCommand(sandbox.dir), 'project', env)
  expect(sandbox.run(initGlobalCodex, { env }).exitCode).toBe(0)
  expectReceipt(env.CODEX_HOME)
  const global = JSON.parse(
    readFileSync(join(env.CODEX_HOME ?? join(sandbox.home, '.codex'), 'hooks.json'), 'utf8'),
  ).hooks.Stop[0].hooks[0].command
  launchReceiptCommand(global, 'global', env)
  launchReceiptCommand(registeredCommand(sandbox.dir), 'suppressed', env)
  return env
}

function checksumStub(body: string): string {
  sandbox.writeFile('checksum-bin/cksum', '#!/bin/bash\n' + body + '\n')
  chmodSync(join(sandbox.dir, 'checksum-bin/cksum'), 0o755)
  return join(sandbox.dir, 'checksum-bin') + ':' + registrationEnv(sandbox).PATH
}

describe('Codex receipt launcher E2E', () => {
  for (const cancelledMissing of [true, false]) {
    test(`Codex home ${cancelledMissing ? 'missing component cancelled before alias falls through' : 'traversable alias parent and created leaf suppresses'}`, () => {
      sandbox = createSandbox()
      expect(sandbox.run(['init', '--agent', 'codex']).exitCode).toBe(0)
      receiptProbe()
      const physical = join(sandbox.dir, 'physical')
      const alias = join(sandbox.dir, 'alias')
      mkdirSync(join(physical, 'branch'), { recursive: true })
      mkdirSync(join(physical, 'existing'))
      symlinkSync(join(physical, 'branch'), alias)
      // Preserve spelling: path.join would erase the component cancellation being tested.
      const spelling = cancelledMissing
        ? `${sandbox.dir}/missing/../alias`
        : `${alias}/../existing/created-by-init`
      const destination = cancelledMissing
        ? join(physical, 'branch')
        : join(physical, 'existing/created-by-init')
      const env = { CODEX_HOME: spelling }
      launchReceiptCommand(registeredCommand(sandbox.dir), 'project', env)
      expect(sandbox.run(initGlobalCodex, { env }).exitCode).toBe(0)
      expectReceipt(destination)
      expect(existsSync(join(sandbox.dir, 'missing'))).toBe(false)
      const global = JSON.parse(readFileSync(join(destination, 'hooks.json'), 'utf8')).hooks.Stop[0]
        .hooks[0].command
      launchReceiptCommand(global, 'global', env)
      launchReceiptCommand(
        registeredCommand(sandbox.dir),
        cancelledMissing ? 'project' : 'suppressed',
        env,
      )
      // The canonical spelling is traversable in both cases and agrees with the receipt.
      launchReceiptCommand(registeredCommand(sandbox.dir), 'suppressed', {
        CODEX_HOME: destination,
      })
    })
  }

  test('same-size unrelated edit with restored mtime invalidates checksum until re-init', () => {
    initializeReceipt()
    const path = join(sandbox.home, '.codex/hooks.json')
    const document = JSON.parse(readFileSync(path, 'utf8'))
    document.hooks.Stop.push({ hooks: [{ type: 'command', command: 'echo unrelated-AAAA' }] })
    writeFileSync(path, JSON.stringify(document))
    expect(sandbox.run(initGlobalCodex).exitCode).toBe(0)
    expectReceipt()
    launchReceiptCommand(registeredCommand(sandbox.dir), 'suppressed')
    // Whole-second timestamps avoid filesystem/Date precision differences in the assertion.
    utimesSync(path, 1_700_000_000, 1_700_000_000)
    launchReceiptCommand(registeredCommand(sandbox.dir), 'suppressed')
    const before = statSync(path)
    const receipt = sandbox.readHomeFile(receiptPath)
    const original = readFileSync(path, 'utf8')
    const edited = original.replace('echo unrelated-AAAA', 'echo unrelated-BBBB')
    expect(edited).not.toBe(original)
    expect(Buffer.byteLength(edited)).toBe(Buffer.byteLength(original))
    writeFileSync(path, edited)
    utimesSync(path, before.atime, before.mtime)
    expect(statSync(path).size).toBe(before.size)
    expect(statSync(path).mtimeMs).toBe(before.mtimeMs)
    expect(sandbox.readHomeFile(receiptPath)).toBe(receipt)
    launchReceiptCommand(registeredCommand(sandbox.dir), 'project')
    expect(sandbox.run(initGlobalCodex).exitCode).toBe(0)
    expectReceipt()
    expect(sandbox.readHomeFile(receiptPath)).not.toBe(receipt)
    expect(readFileSync(path, 'utf8')).toContain('echo unrelated-BBBB')
    launchReceiptCommand(registeredCommand(sandbox.dir), 'suppressed')
  })

  test('default and custom homes produce the exact POSIX stdin checksum wire format', () => {
    const env = initializeReceipt("state joe's $(literal); 日本語/nested")
    expectReceipt(env.CODEX_HOME)
    expect(sandbox.homeFileExists('.codex/hooks.json')).toBe(false)
    expect(sandbox.run(initGlobalCodex, { env: env as Record<string, string> }).exitCode).toBe(0)
    launchReceiptCommand(registeredCommand(sandbox.dir), 'suppressed', env)
  })

  for (const override of [
    'unset',
    'empty',
    'relative',
    'different',
    'missing',
    'alias',
    'cr',
    'lf',
  ]) {
    test(`CLOOKS_HOME_ROOT ${override} has conservative receipt eligibility`, () => {
      initializeReceipt()
      const alias = join(sandbox.dir, 'home-alias')
      symlinkSync(sandbox.home, alias)
      const values: ProbeEnv = {
        unset: undefined,
        empty: '',
        relative: '.',
        different: sandbox.dir,
        missing: join(sandbox.dir, 'missing'),
        alias,
        cr: sandbox.home + '\r',
        lf: sandbox.home + '\n',
      }
      launchReceiptCommand(
        registeredCommand(sandbox.dir),
        ['unset', 'alias'].includes(override) ? 'suppressed' : 'project',
        {
          CLOOKS_HOME_ROOT: values[override],
        },
      )
    })
  }

  for (const override of [
    'unset',
    'empty',
    'relative',
    'different',
    'missing',
    'alias',
    'cr',
    'lf',
  ]) {
    test(`CODEX_HOME ${override} has conservative receipt eligibility`, () => {
      initializeReceipt()
      const alias = join(sandbox.dir, 'codex-alias')
      symlinkSync(join(sandbox.home, '.codex'), alias)
      const values: ProbeEnv = {
        unset: undefined,
        empty: '',
        relative: '.codex',
        different: sandbox.dir,
        missing: join(sandbox.dir, 'missing'),
        alias,
        cr: sandbox.home + '\r',
        lf: sandbox.home + '\n',
      }
      launchReceiptCommand(
        registeredCommand(sandbox.dir),
        ['unset', 'empty', 'alias'].includes(override) ? 'suppressed' : 'project',
        {
          CODEX_HOME: values[override],
        },
      )
    })
  }

  test('physical HOME and runtime aliases match without accepting noncanonical receipt paths', () => {
    initializeReceipt()
    const alias = join(sandbox.dir, "home joe's $(literal)")
    symlinkSync(sandbox.home, alias)
    const env = { HOME: alias, CLOOKS_HOME_ROOT: alias }
    launchReceiptCommand(registeredCommand(sandbox.dir), 'suppressed', env)
    sandbox.writeHomeFile(
      receiptPath,
      sandbox.readHomeFile(receiptPath).replace(sandbox.home + '\n', alias + '\n'),
    )
    launchReceiptCommand(registeredCommand(sandbox.dir), 'project', env)
  })

  const malformed: [string, (valid: string) => string][] = [
    ['empty legacy', () => ''],
    ['wrong version', (s) => s.replace('registration-v1', 'registration-v2')],
    ['missing last LF', (s) => s.slice(0, -1)],
    ['fifth empty line', (s) => s + '\n'],
    ['fifth unterminated line', (s) => s + 'extra'],
    ['missing checksum', (s) => s.split('\n').slice(0, 3).join('\n') + '\n'],
    ['CRLF', (s) => s.replaceAll('\n', '\r\n')],
    ['NUL byte', (s) => s.replace('registration', 'regis\0tration')],
    [
      'relative installation home',
      (s) =>
        s
          .split('\n')
          .map((v, i) => (i === 1 ? '.' : v))
          .join('\n'),
    ],
    [
      'relative Codex home',
      (s) =>
        s
          .split('\n')
          .map((v, i) => (i === 2 ? '.codex' : v))
          .join('\n'),
    ],
    [
      'wrong installation home',
      (s) =>
        s
          .split('\n')
          .map((v, i) => (i === 1 ? sandbox.dir : v))
          .join('\n'),
    ],
    [
      'wrong Codex home',
      (s) =>
        s
          .split('\n')
          .map((v, i) => (i === 2 ? sandbox.dir : v))
          .join('\n'),
    ],
    ...['-1:2', '1:+2', '1:2:3', '01:2', '1:02', 'crc:count', '1:2 ', '0:0'].map(
      (checksum): [string, (s: string) => string] => [
        `checksum ${checksum}`,
        (s) =>
          s
            .split('\n')
            .map((v, i) => (i === 3 ? checksum : v))
            .join('\n'),
      ],
    ),
  ]
  for (const [name, corrupt] of malformed) {
    test(`${name} falls through to positive project execution under strict bash`, () => {
      initializeReceipt()
      sandbox.writeHomeFile(receiptPath, corrupt(sandbox.readHomeFile(receiptPath)))
      launchReceiptCommand(registeredCommand(sandbox.dir), 'project')
    })
  }

  for (const failure of [
    'missing receipt',
    'receipt directory',
    'unreadable receipt',
    'missing launcher',
    'launcher directory',
    'nonexecutable launcher',
    'missing hooks',
    'hooks directory',
    'unreadable hooks',
    'changed hooks',
    'recovery only',
  ]) {
    test(`${failure} cannot suppress project execution`, () => {
      initializeReceipt()
      const receipt = join(sandbox.home, receiptPath)
      const hooks = join(sandbox.home, '.codex/hooks.json')
      const launcher = join(sandbox.home, '.clooks/bin/entrypoint.sh')
      expect(process.getuid!()).not.toBe(0)
      try {
        if (failure === 'missing receipt' || failure === 'recovery only') rmSync(receipt)
        if (failure === 'receipt directory') {
          rmSync(receipt)
          mkdirSync(receipt)
        }
        if (failure === 'unreadable receipt') chmodSync(receipt, 0)
        if (failure === 'missing launcher') rmSync(launcher)
        if (failure === 'launcher directory') {
          rmSync(launcher)
          mkdirSync(launcher)
        }
        if (failure === 'nonexecutable launcher') chmodSync(launcher, 0o600)
        if (failure === 'missing hooks') rmSync(hooks)
        if (failure === 'hooks directory') {
          rmSync(hooks)
          mkdirSync(hooks)
        }
        if (failure === 'unreadable hooks') chmodSync(hooks, 0)
        if (failure === 'changed hooks')
          sandbox.writeHomeFile(
            '.codex/hooks.json',
            sandbox.readHomeFile('.codex/hooks.json') + ' ',
          )
        launchReceiptCommand(registeredCommand(sandbox.dir), 'project')
      } finally {
        if (existsSync(receipt)) chmodSync(receipt, 0o700)
        if (existsSync(hooks)) chmodSync(hooks, 0o700)
        if (existsSync(launcher)) chmodSync(launcher, 0o700)
      }
    })
  }

  for (const artifact of ['receipt', 'hooks']) {
    test(`symlink ${artifact} with matching bytes falls through while directory aliases remain eligible`, () => {
      initializeReceipt()
      const path = join(sandbox.home, artifact === 'receipt' ? receiptPath : '.codex/hooks.json')
      const target = join(sandbox.dir, `retained-${artifact}`)
      const bytes = readFileSync(path, 'utf8')
      renameSync(path, target)
      symlinkSync(target, path)
      expect(readFileSync(path, 'utf8')).toBe(bytes)
      launchReceiptCommand(registeredCommand(sandbox.dir), 'project')
    })
  }

  test('symlink to a regular executable global launcher remains eligible', () => {
    initializeReceipt()
    const launcher = join(sandbox.home, '.clooks/bin/entrypoint.sh')
    const target = join(sandbox.dir, 'retained-global-launcher')
    renameSync(launcher, target)
    symlinkSync(target, launcher)
    launchReceiptCommand(registeredCommand(sandbox.dir), 'suppressed')
  })

  for (const body of [
    'exit 42',
    'printf "bad\\n"',
    'printf "1 2 filename\\n"',
    'printf "1 2\\n3 4\\n"',
    'printf "01 2\\n"',
  ]) {
    test(`checksum utility ${body} falls through`, () => {
      initializeReceipt()
      launchReceiptCommand(registeredCommand(sandbox.dir), 'project', { PATH: checksumStub(body) })
    })
  }

  test('missing checksum utility falls through with only required PATH programs present', () => {
    initializeReceipt()
    const bin = join(sandbox.dir, 'minimal-bin')
    mkdirSync(bin)
    for (const [name, target] of [
      ['bash', '/bin/bash'],
      ['cat', '/bin/cat'],
      ['clooks', join(dirname(sandbox.dir), 'bin/clooks')],
    ]) {
      symlinkSync(target!, join(bin, name!))
    }
    launchReceiptCommand(registeredCommand(sandbox.dir), 'project', { PATH: bin })
  })

  test('agent isolation preserves Claude legacy flags and never uses Codex recovery for suppression', () => {
    sandbox = createSandbox()
    expect(sandbox.run(['init', '--agent', 'all']).exitCode).toBe(0)
    receiptProbe()
    const codex = registeredCommand(sandbox.dir)
    const claude = CLAUDE_PROJECT_COMMAND
    const env = { CLAUDE_PROJECT_DIR: sandbox.dir, CLOOKS_AGENT: 'claude-code' }
    launchReceiptCommand(claude, 'project', env, 'claude-code')
    expect(sandbox.run(initGlobalCodex).exitCode).toBe(0)
    launchReceiptCommand(claude, 'project', env, 'claude-code')
    expect(
      sandbox.run(['uninstall', '--global', '--agent', 'codex', '--unhook', '--force']).exitCode,
    ).toBe(0)
    expect(sandbox.run(['init', '--global']).exitCode).toBe(0)
    launchReceiptCommand(codex, 'project')
    launchReceiptCommand(claude, 'suppressed', env, 'claude-code')
    expect(sandbox.readHomeFile('.clooks/.global-entrypoint-active')).toBe('')
  })

  test('persisted valid state cannot detect inactive native global hooks; matching unhook restores project eligibility', () => {
    initializeReceipt()
    // Simulate the native host not invoking global. This is the documented activation limitation.
    const before = calls()
    launchReceiptCommand(registeredCommand(sandbox.dir), 'suppressed')
    expect(calls()).toBe(before)
    expect(sandbox.run(unhookGlobalCodex).exitCode).toBe(0)
    launchReceiptCommand(registeredCommand(sandbox.dir), 'project')
  })

  test('old project scripts need project re-init even after global receipt upgrade', () => {
    initializeReceipt()
    const current = sandbox.readFile('.clooks/bin/entrypoint.sh')
    sandbox.writeEntrypoint(
      '#!/bin/bash\nset -euo pipefail\nif [ -f "$HOME/.clooks/.global-entrypoint-active.codex" ]; then exit 0; fi\n' +
        current.split('\n').slice(1).join('\n'),
    )
    sandbox.writeHomeFile(receiptPath, '')
    expect(sandbox.run(initGlobalCodex).exitCode).toBe(0)
    const env = { CODEX_HOME: sandbox.dir }
    launchReceiptCommand(registeredCommand(sandbox.dir), 'suppressed', env)
    expect(sandbox.run(['init', '--agent', 'codex']).exitCode).toBe(0)
    expect(sandbox.readFile('.clooks/bin/entrypoint.sh')).toBe(current)
    launchReceiptCommand(registeredCommand(sandbox.dir), 'project', env)
  })
})

describe('Codex global registration recovery E2E', () => {
  for (const broken of ['missing', 'nonexecutable']) {
    test(`Claude-only failed init may restore Codex eligibility by repairing a ${broken} shared launcher`, () => {
      initializeReceipt()
      const receipt = sandbox.readHomeFile(receiptPath)
      const tracked = sandbox.readHomeFile(trackedPath)
      const hooks = sandbox.readHomeFile('.codex/hooks.json')
      const launcher = join(sandbox.home, '.clooks/bin/entrypoint.sh')
      if (broken === 'missing') rmSync(launcher)
      else chmodSync(launcher, 0o600)
      launchReceiptCommand(registeredCommand(sandbox.dir), 'project')
      sandbox.writeHomeFile('.claude/settings.json', '{ bad\n')
      const failed = sandbox.run(['init', '--global', '--agent', 'claude-code', '--json'])
      expect(failed.exitCode).toBe(1)
      expect(JSON.parse(failed.stdout).ok).toBe(false)
      expect(sandbox.readHomeFile('.claude/settings.json')).toBe('{ bad\n')
      expect(sandbox.homeFileExists('.clooks/.global-entrypoint-active')).toBe(false)
      expect(sandbox.readHomeFile(receiptPath)).toBe(receipt)
      expect(sandbox.readHomeFile(trackedPath)).toBe(tracked)
      expect(sandbox.readHomeFile('.codex/hooks.json')).toBe(hooks)
      expect(statSync(launcher).mode & 0o111).not.toBe(0)
      launchReceiptCommand(registeredCommand(sandbox.dir), 'suppressed')
    })
  }

  test('failed publication in A retains cleanup identity, rejects B, and full cleanup from B removes both homes', () => {
    sandbox = createSandbox()
    expect(sandbox.run(['init', '--agent', 'codex']).exitCode).toBe(0)
    receiptProbe()
    const a = join(sandbox.dir, 'state-A')
    const b = join(sandbox.dir, 'state-B')
    launchReceiptCommand(registeredCommand(sandbox.dir), 'project', { CODEX_HOME: a })
    const failed = sandbox.run(initGlobalCodex, {
      env: { CODEX_HOME: a, PATH: checksumStub('exit 42') },
    })
    expect(failed.exitCode).toBe(1)
    expect(JSON.parse(failed.stdout).ok).toBe(false)
    const aBytes = readFileSync(join(a, 'hooks.json'), 'utf8')
    expectCodexRegistration(JSON.parse(aBytes), globalCodexCommand())
    expect(sandbox.readHomeFile(trackedPath)).toBe(`clooks-codex-home-v1\n${a}\n`)
    expect(sandbox.homeFileExists(receiptPath)).toBe(false)
    launchReceiptCommand(registeredCommand(sandbox.dir), 'project', { CODEX_HOME: a })
    const tracked = sandbox.readHomeFile(trackedPath)
    const rejected = sandbox.run(initGlobalCodex, { env: { CODEX_HOME: b } })
    expect(rejected.exitCode).toBe(1)
    expect(JSON.parse(rejected.stdout).error).toContain(a)
    expect(existsSync(b)).toBe(false)
    expect(readFileSync(join(a, 'hooks.json'), 'utf8')).toBe(aBytes)
    expect(sandbox.readHomeFile(trackedPath)).toBe(tracked)
    // B is an independently known registration file, not another successful global init.
    mkdirSync(b)
    const bDocument = JSON.parse(aBytes)
    bDocument.hooks.Stop.push({ hooks: [{ type: 'command', command: 'echo keep-B' }] })
    writeFileSync(join(b, 'hooks.json'), JSON.stringify(bDocument))
    const cleaned = sandbox.run(fullGlobalCodex, { env: { CODEX_HOME: b } })
    expect(cleaned.exitCode).toBe(0)
    expect(JSON.parse(cleaned.stdout).ok).toBe(true)
    expect(JSON.parse(readFileSync(join(a, 'hooks.json'), 'utf8')).hooks).toBeUndefined()
    expect(JSON.parse(readFileSync(join(b, 'hooks.json'), 'utf8')).hooks).toEqual({
      Stop: [{ hooks: [{ type: 'command', command: 'echo keep-B' }] }],
    })
    expect(sandbox.homeFileExists('.clooks')).toBe(false)
    launchReceiptCommand(registeredCommand(sandbox.dir), 'project', { CODEX_HOME: b })
    expect(sandbox.run(initGlobalCodex, { env: { CODEX_HOME: b } }).exitCode).toBe(0)
    expectReceipt(b)
  })

  test('unknown event in A survives unhook, retains identity and rejects B until explicit repair', () => {
    const env = initializeReceipt('state-A')
    const a = env.CODEX_HOME!
    const b = join(sandbox.dir, 'state-B')
    const document = JSON.parse(readFileSync(join(a, 'hooks.json'), 'utf8'))
    document.hooks.Future = document.hooks.Stop
    writeFileSync(join(a, 'hooks.json'), JSON.stringify(document))
    const tracked = sandbox.readHomeFile(trackedPath)
    const receipt = sandbox.readHomeFile(receiptPath)
    const unhooked = sandbox.run(unhookGlobalCodex, { env: { CODEX_HOME: a } })
    expect(unhooked.exitCode).toBe(1)
    expect(JSON.parse(unhooked.stdout).error).toContain('Future')
    expect(JSON.parse(readFileSync(join(a, 'hooks.json'), 'utf8')).hooks.Future).toEqual(
      document.hooks.Future,
    )
    expect(sandbox.readHomeFile(trackedPath)).toBe(tracked)
    expect(sandbox.readHomeFile(receiptPath)).toBe(receipt)
    const before = readFileSync(join(a, 'hooks.json'), 'utf8')
    const rejected = sandbox.run(initGlobalCodex, { env: { CODEX_HOME: b } })
    expect(rejected.exitCode).toBe(1)
    expect(JSON.parse(rejected.stdout).error).toContain(a)
    expect(readFileSync(join(a, 'hooks.json'), 'utf8')).toBe(before)
    expect(existsSync(b)).toBe(false)
    launchReceiptCommand(registeredCommand(sandbox.dir), 'project', env)
    const repaired = JSON.parse(before)
    delete repaired.hooks.Future
    writeFileSync(join(a, 'hooks.json'), JSON.stringify(repaired))
    expect(sandbox.run(unhookGlobalCodex, { env: { CODEX_HOME: a } }).exitCode).toBe(0)
    expect(sandbox.homeFileExists(trackedPath)).toBe(false)
    expect(sandbox.homeFileExists(receiptPath)).toBe(false)
    expect(sandbox.run(initGlobalCodex, { env: { CODEX_HOME: b } }).exitCode).toBe(0)
    expectReceipt(b)
    launchReceiptCommand(registeredCommand(sandbox.dir), 'project', env)
    launchReceiptCommand(registeredCommand(sandbox.dir), 'suppressed', { CODEX_HOME: b })
  })

  for (const agent of ['codex', 'all']) {
    for (const broken of ['missing', 'nonexecutable']) {
      test(`${agent} retry cannot revive an old receipt by repairing a ${broken} launcher before failed publication`, () => {
        initializeReceipt()
        const launcher = join(sandbox.home, '.clooks/bin/entrypoint.sh')
        if (broken === 'missing') rmSync(launcher)
        else chmodSync(launcher, 0o600)
        launchReceiptCommand(registeredCommand(sandbox.dir), 'project')
        const failed = sandbox.run(['init', '--global', '--agent', agent, '--json'], {
          env: { PATH: checksumStub('exit 42') },
        })
        expect(failed.exitCode).toBe(1)
        expect(JSON.parse(failed.stdout).ok).toBe(false)
        expect(statSync(launcher).mode & 0o111).not.toBe(0)
        expect(sandbox.homeFileExists(receiptPath)).toBe(false)
        expect(sandbox.readHomeFile(trackedPath)).toContain(join(sandbox.home, '.codex'))
        // Normal PATH here proves failure retired the receipt, not merely checksum-tool failure.
        launchReceiptCommand(registeredCommand(sandbox.dir), 'project')
        expect(sandbox.run(initGlobalCodex).exitCode).toBe(0)
        expectReceipt()
        launchReceiptCommand(registeredCommand(sandbox.dir), 'suppressed')
      })
    }
  }

  test('same-home failed registration preserves committed hooks but retires suppression until retry', () => {
    initializeReceipt()
    sandbox.writeHomeFile('.codex/hooks.json', '{ bad\n')
    const failed = sandbox.run(initGlobalCodex)
    expect(failed.exitCode).toBe(1)
    expect(JSON.parse(failed.stdout).ok).toBe(false)
    expect(sandbox.readHomeFile('.codex/hooks.json')).toBe('{ bad\n')
    launchReceiptCommand(registeredCommand(sandbox.dir), 'project')
    sandbox.writeHomeFile('.codex/hooks.json', '{}\n')
    expect(sandbox.run(initGlobalCodex).exitCode).toBe(0)
    expectReceipt()
    launchReceiptCommand(registeredCommand(sandbox.dir), 'suppressed')
  })

  test('failed first all-agent init publishes Claude success only and project Codex still launches', () => {
    sandbox = createSandbox()
    expect(sandbox.run(['init', '--agent', 'all']).exitCode).toBe(0)
    receiptProbe()
    launchReceiptCommand(registeredCommand(sandbox.dir), 'project')
    sandbox.writeHomeFile('.codex/hooks.json', '{ bad\n')
    const result = sandbox.run(['init', '--global', '--agent', 'all', '--json'])
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stdout).ok).toBe(false)
    expect(sandbox.homeFileExists('.claude/settings.json')).toBe(true)
    expect(sandbox.readHomeFile('.clooks/.global-entrypoint-active')).toBe('')
    expect(sandbox.homeFileExists(receiptPath)).toBe(false)
    expect(sandbox.readHomeFile('.codex/hooks.json')).toBe('{ bad\n')
    launchReceiptCommand(registeredCommand(sandbox.dir), 'project')
  })

  test('failed Claude registration does not publish its legacy flag', () => {
    sandbox = createSandbox()
    sandbox.writeHomeFile('.claude/settings.json', '{ bad\n')
    const result = sandbox.run(['init', '--global', '--json'])
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stdout).ok).toBe(false)
    expect(sandbox.homeFileExists('.clooks/.global-entrypoint-active')).toBe(false)
    expect(sandbox.readHomeFile('.claude/settings.json')).toBe('{ bad\n')
  })

  test('recovery-record write failure precedes hooks mutation and receipt retirement', () => {
    initializeReceipt()
    const receipt = sandbox.readHomeFile(receiptPath)
    const hooks = sandbox.readHomeFile('.codex/hooks.json')
    const runtime = join(sandbox.home, '.clooks')
    expect(process.getuid!()).not.toBe(0)
    chmodSync(runtime, 0o500)
    try {
      const failed = sandbox.run(initGlobalCodex)
      expect(failed.exitCode).toBe(1)
      expect(JSON.parse(failed.stdout).ok).toBe(false)
      expect(sandbox.readHomeFile(receiptPath)).toBe(receipt)
      expect(sandbox.readHomeFile('.codex/hooks.json')).toBe(hooks)
    } finally {
      chmodSync(runtime, 0o700)
    }
    expect(sandbox.run(initGlobalCodex).exitCode).toBe(0)
    launchReceiptCommand(registeredCommand(sandbox.dir), 'suppressed')
  })

  test('later shared setup failure keeps recovery identity and project eligibility until retry', () => {
    initializeReceipt()
    const types = join(sandbox.home, '.clooks/hooks/types.d.ts')
    const tracked = sandbox.readHomeFile(trackedPath)
    const hooks = sandbox.readHomeFile('.codex/hooks.json')
    expect(process.getuid!()).not.toBe(0)
    chmodSync(types, 0o400)
    try {
      const failed = sandbox.run(initGlobalCodex)
      expect(failed.exitCode).toBe(1)
      expect(JSON.parse(failed.stdout).ok).toBe(false)
      expect(sandbox.readHomeFile(trackedPath)).toBe(tracked)
      expect(sandbox.readHomeFile('.codex/hooks.json')).toBe(hooks)
      expect(sandbox.homeFileExists(receiptPath)).toBe(false)
      launchReceiptCommand(registeredCommand(sandbox.dir), 'project')
    } finally {
      chmodSync(types, 0o600)
    }
    expect(sandbox.run(initGlobalCodex).exitCode).toBe(0)
    expectReceipt()
    launchReceiptCommand(registeredCommand(sandbox.dir), 'suppressed')
  })

  for (const invalid of ['relative/path', '/absolute\rcodex', '/absolute\ncodex']) {
    test(`invalid CODEX_HOME ${JSON.stringify(invalid)} is rejected before global writes, project remains local`, () => {
      sandbox = createSandbox()
      for (const args of [initGlobalCodex, unhookGlobalCodex, fullGlobalCodex]) {
        const result = sandbox.run(args, { env: { CODEX_HOME: invalid } })
        expect(result.exitCode).toBe(1)
        expect(JSON.parse(result.stdout).error).toContain('absolute')
        expect(sandbox.homeFileExists('.clooks')).toBe(false)
        expect(sandbox.homeFileExists('.codex')).toBe(false)
      }
      expect(
        sandbox.run(['init', '--agent', 'codex'], { env: { CODEX_HOME: invalid } }).exitCode,
      ).toBe(0)
      expect(sandbox.fileExists('.codex/hooks.json')).toBe(true)
      receiptProbe()
      launchReceiptCommand(registeredCommand(sandbox.dir), 'project', { CODEX_HOME: invalid })
    })
  }

  test('selected-home B unhook cannot erase A receipts or hooks', () => {
    const env = initializeReceipt('state-A')
    const a = env.CODEX_HOME!
    const b = join(sandbox.dir, 'state-B')
    const receipt = sandbox.readHomeFile(receiptPath)
    const tracked = sandbox.readHomeFile(trackedPath)
    const hooks = readFileSync(join(a, 'hooks.json'), 'utf8')
    expect(sandbox.run(unhookGlobalCodex, { env: { CODEX_HOME: b } }).exitCode).toBe(0)
    expect(readFileSync(join(a, 'hooks.json'), 'utf8')).toBe(hooks)
    expect(sandbox.readHomeFile(receiptPath)).toBe(receipt)
    expect(sandbox.readHomeFile(trackedPath)).toBe(tracked)
    launchReceiptCommand(registeredCommand(sandbox.dir), 'project', { CODEX_HOME: b })
    launchReceiptCommand(registeredCommand(sandbox.dir), 'suppressed', env)
  })

  test('legacy empty receipt requires default-home cleanup before switching', () => {
    initializeReceipt()
    sandbox.writeHomeFile(receiptPath, '')
    rmSync(join(sandbox.home, trackedPath))
    const b = join(sandbox.dir, 'state-B')
    const rejected = sandbox.run(initGlobalCodex, { env: { CODEX_HOME: b } })
    expect(rejected.exitCode).toBe(1)
    expect(JSON.parse(rejected.stdout).error).toContain(join(sandbox.home, '.codex'))
    expect(sandbox.readHomeFile(receiptPath)).toBe('')
    expect(sandbox.run(unhookGlobalCodex, { env: { CODEX_HOME: b } }).exitCode).toBe(0)
    expect(sandbox.readHomeFile(receiptPath)).toBe('')
    launchReceiptCommand(registeredCommand(sandbox.dir), 'project')
    expect(sandbox.run(unhookGlobalCodex).exitCode).toBe(0)
    expect(sandbox.homeFileExists(receiptPath)).toBe(false)
    expect(sandbox.run(initGlobalCodex, { env: { CODEX_HOME: b } }).exitCode).toBe(0)
    expectReceipt(b)
  })

  for (const state of [
    'malformed receipt',
    'malformed recovery',
    'empty recovery',
    'conflicting identities',
  ]) {
    test(`${state} blocks global init/full deletion without writes`, () => {
      initializeReceipt()
      if (state === 'malformed receipt') sandbox.writeHomeFile(receiptPath, 'invalid\n')
      if (state === 'malformed recovery') sandbox.writeHomeFile(trackedPath, 'invalid\n')
      if (state === 'empty recovery') sandbox.writeHomeFile(trackedPath, '')
      if (state === 'conflicting identities')
        sandbox.writeHomeFile(trackedPath, `clooks-codex-home-v1\n${sandbox.dir}\n`)
      const before = [
        receiptPath,
        trackedPath,
        '.codex/hooks.json',
        '.clooks/bin/entrypoint.sh',
      ].map((path) => sandbox.readHomeFile(path))
      const modes = [
        receiptPath,
        trackedPath,
        '.codex/hooks.json',
        '.clooks/bin/entrypoint.sh',
      ].map((path) => statSync(join(sandbox.home, path)).mode)
      for (const args of [initGlobalCodex, fullGlobalCodex]) {
        const failed = sandbox.run(args)
        expect(failed.exitCode).toBe(1)
        expect(JSON.parse(failed.stdout).ok).toBe(false)
        expect(
          [receiptPath, trackedPath, '.codex/hooks.json', '.clooks/bin/entrypoint.sh'].map((path) =>
            sandbox.readHomeFile(path),
          ),
        ).toEqual(before)
        expect(
          [receiptPath, trackedPath, '.codex/hooks.json', '.clooks/bin/entrypoint.sh'].map(
            (path) => statSync(join(sandbox.home, path)).mode,
          ),
        ).toEqual(modes)
      }
      launchReceiptCommand(
        registeredCommand(sandbox.dir),
        state === 'malformed receipt' ? 'project' : 'suppressed',
      )
    })
  }
})
