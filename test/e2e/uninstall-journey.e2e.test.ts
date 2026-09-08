import { describe, test, expect, afterEach } from 'bun:test'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { join } from 'path'
import { createSandbox as createBaseSandbox, type Sandbox } from './helpers/sandbox'

function createSandbox(): Sandbox {
  const sandbox = createBaseSandbox()
  const run = sandbox.run.bind(sandbox)
  sandbox.run = (args, opts) =>
    run(args, {
      ...opts,
      timeout: opts?.timeout ?? 10_000,
      env: { CODEX_HOME: join(sandbox.home, '.codex'), ...opts?.env },
    })
  return sandbox
}

let sandbox: Sandbox
let oppositeScopeSentinels: [string, string][] = []

afterEach(() => {
  try {
    for (const [path, content] of oppositeScopeSentinels) {
      expect(readFileSync(path, 'utf8')).toBe(content)
    }
  } finally {
    oppositeScopeSentinels = []
    sandbox?.cleanup()
  }
})

type Scope = 'project' | 'global'
type Agent = 'claude-code' | 'codex'
type Reply = 'yes' | 'no' | 'cancel'
const registrationPaths = { 'claude-code': '.claude/settings.json', codex: '.codex/hooks.json' }
const customHook = 'export default { sentinel: "retain until deletion succeeds" }\n'

function root(scope: Scope): string {
  return scope === 'project' ? sandbox.dir : sandbox.home
}

function initialize(scope: Scope, agent: Agent | 'all' = 'all'): void {
  sandbox = createSandbox()
  const result = sandbox.run([
    'init',
    ...(scope === 'global' ? ['--global'] : []),
    '--agent',
    agent,
  ])
  expect(result.exitCode).toBe(0)
  writeFileSync(join(root(scope), '.clooks/hooks/keep.ts'), customHook)
  const opposite = scope === 'project' ? sandbox.home : sandbox.dir
  for (const relative of [
    '.claude/settings.json',
    '.codex/hooks.json',
    '.clooks/hooks/opposite.ts',
    '.clooks/.global-entrypoint-active',
    '.clooks/.global-entrypoint-active.codex',
  ]) {
    const path = join(opposite, relative)
    const content = relative.endsWith('.json')
      ? '{"oppositeScope":"untouched"}\n'
      : 'opposite scope sentinel\n'
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, content)
    oppositeScopeSentinels.push([path, content])
  }
}

function globalFlags(): [string, string | null][] {
  return ['.global-entrypoint-active', '.global-entrypoint-active.codex'].map((name) => {
    const path = join(sandbox.home, '.clooks', name)
    return [name, existsSync(path) ? readFileSync(path, 'utf8') : null]
  })
}

function bytes(scope: Scope, agent: Agent): string {
  return readFileSync(join(root(scope), registrationPaths[agent]), 'utf8')
}

function expectRuntimeRetained(scope: Scope): void {
  expect(readFileSync(join(root(scope), '.clooks/hooks/keep.ts'), 'utf8')).toBe(customHook)
  expect(existsSync(join(root(scope), '.clooks/bin/entrypoint.sh'))).toBe(true)
}

function expectUnregistered(scope: Scope, agent: Agent): void {
  const settings = JSON.parse(bytes(scope, agent))
  expect(settings.hooks).toBeUndefined()
}

function forced(scope: Scope, agent: Agent, action: '--full' | '--unhook' = '--full') {
  return sandbox.run(['uninstall', `--${scope}`, '--agent', agent, action, '--force', '--json'])
}

async function interactive(scope: Scope, agent: Agent, steps: [string, Reply][]): Promise<string> {
  const proc = Bun.spawn(
    [
      '/usr/bin/expect',
      join(import.meta.dir, 'helpers/uninstall-prompts.exp'),
      join(import.meta.dir, '../../dist/clooks'),
      scope,
      agent,
      ...steps.flat(),
    ],
    {
      cwd: sandbox.dir,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        HOME: sandbox.home,
        CLOOKS_HOME_ROOT: sandbox.home,
        CODEX_HOME: join(sandbox.home, '.codex'),
        CLOOKS_E2E_DOCKER: 'true',
        PATH: '/usr/local/bin:/usr/bin:/bin',
        TERM: 'xterm',
        NO_COLOR: '1',
      },
    },
  )
  let timedOut = false
  let hardStop: ReturnType<typeof setTimeout> | undefined
  const deadline = setTimeout(() => {
    timedOut = true
    proc.kill('SIGTERM')
    hardStop = setTimeout(() => proc.kill('SIGKILL'), 2_000)
  }, 35_000)
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    if (timedOut || exitCode !== 0) {
      throw new Error(`PTY failure (timeout=${timedOut}, exit=${exitCode})\n${stdout}\n${stderr}`)
    }
    expect(stdout).toContain('PTY journey completed with CLI exit 0')
    return stdout
  } finally {
    clearTimeout(deadline)
    if (proc.exitCode === null) {
      proc.kill('SIGTERM')
      hardStop ??= setTimeout(() => proc.kill('SIGKILL'), 2_000)
    }
    try {
      await proc.exited
    } finally {
      if (hardStop) clearTimeout(hardStop)
    }
  }
}

describe('shared runtime cleanup', () => {
  for (const scope of ['project', 'global'] as const) {
    for (const selected of ['claude-code', 'codex'] as const) {
      const other: Agent = selected === 'claude-code' ? 'codex' : 'claude-code'

      test(`${scope} full removal selected as ${selected} cleans both agents and reports actual counts`, () => {
        initialize(scope)
        const claudeEvents = Object.keys(JSON.parse(bytes(scope, 'claude-code')).hooks)
        const codexEvents = Object.keys(JSON.parse(bytes(scope, 'codex')).hooks)
        const result = forced(scope, selected)
        expect(result.exitCode).toBe(0)
        const envelope = JSON.parse(result.stdout)
        expect(envelope.ok).toBe(true)
        expect(envelope.data.agent).toBe(selected)
        expect(envelope.data.agents).toEqual([selected])
        expect(claudeEvents.length).toBeGreaterThan(0)
        expect(codexEvents).toHaveLength(10)
        expect(envelope.data.claudeEventsRemoved).toEqual(claudeEvents)
        expect(envelope.data.codexEventsRemoved).toEqual(codexEvents)
        expect(envelope.data.eventsRemoved).toEqual(envelope.data.claudeEventsRemoved)
        expect(envelope.data.deleted).toBe(true)
        expectUnregistered(scope, selected)
        expectUnregistered(scope, other)
        expect(existsSync(join(root(scope), '.clooks'))).toBe(false)
        const retry = forced(scope, selected)
        expect(retry.exitCode).toBe(0)
        expect(JSON.parse(retry.stdout).data).toMatchObject({
          agent: selected,
          agents: [selected],
          unhooked: false,
          deleted: false,
          eventsRemoved: [],
          claudeEventsRemoved: [],
          codexEventsRemoved: [],
        })
      })

      test(`${scope} malformed ${other} blocks deletion before selected cleanup but not selected unhook`, () => {
        initialize(scope)
        const originalSelected = bytes(scope, selected)
        const invalid = '{"hooks":{"PreToolUse":false},"keep":"exact bytes"}\n'
        const path = join(root(scope), registrationPaths[other])
        writeFileSync(path, invalid)
        const result = forced(scope, selected)
        expect(result.exitCode).toBe(1)
        const envelope = JSON.parse(result.stdout)
        expect(envelope.ok).toBe(false)
        expect(envelope.error).toContain(path)
        expect(envelope.error).toContain('PreToolUse')
        expect(bytes(scope, selected)).toBe(originalSelected)
        expect(bytes(scope, other)).toBe(invalid)
        expectRuntimeRetained(scope)
        const unhook = forced(scope, selected, '--unhook')
        expect(unhook.exitCode).toBe(0)
        expectUnregistered(scope, selected)
        expect(bytes(scope, other)).toBe(invalid)
        expectRuntimeRetained(scope)
      })

      test(`${scope} unknown-event ${other} reference prevents full deletion and can be repaired`, () => {
        initialize(scope)
        const path = join(root(scope), registrationPaths[other])
        const settings = JSON.parse(bytes(scope, other))
        settings.hooks.FutureCleanupEvent = [settings.hooks.PreToolUse[0]]
        writeFileSync(path, JSON.stringify(settings))
        const claudeBefore = bytes(scope, 'claude-code')
        const codexBefore = bytes(scope, 'codex')
        const result = forced(scope, selected)
        expect(result.exitCode).toBe(1)
        const envelope = JSON.parse(result.stdout)
        expect(envelope.ok).toBe(false)
        expect(envelope.error).toContain(path)
        expect(envelope.error).toContain('FutureCleanupEvent')
        expect(bytes(scope, 'claude-code')).toBe(claudeBefore)
        expect(bytes(scope, 'codex')).toBe(codexBefore)
        expectRuntimeRetained(scope)
        const remaining = JSON.parse(bytes(scope, other))
        expect(remaining.hooks.FutureCleanupEvent).toEqual(settings.hooks.FutureCleanupEvent)
        delete remaining.hooks.FutureCleanupEvent
        writeFileSync(path, JSON.stringify(remaining))
        expect(forced(scope, selected).exitCode).toBe(0)
        expect(existsSync(join(root(scope), '.clooks'))).toBe(false)
      })
    }

    test(`${scope} second registrar write failure retains runtime and supports retry without rollback`, () => {
      initialize(scope)
      const codexBefore = bytes(scope, 'codex')
      const codexDir = join(root(scope), '.codex')
      chmodSync(codexDir, 0o555)
      try {
        const result = forced(scope, 'claude-code')
        expect(result.exitCode).toBe(1)
        expect(JSON.parse(result.stdout).ok).toBe(false)
        expectUnregistered(scope, 'claude-code')
        expect(bytes(scope, 'codex')).toBe(codexBefore)
        expect(readdirSync(codexDir)).toEqual(['hooks.json'])
        expectRuntimeRetained(scope)
        if (scope === 'global') {
          expect(sandbox.homeFileExists('.clooks/.global-entrypoint-active')).toBe(false)
          expect(sandbox.homeFileExists('.clooks/.global-entrypoint-active.codex')).toBe(true)
        }
      } finally {
        chmodSync(codexDir, 0o755)
      }
      expect(forced(scope, 'claude-code').exitCode).toBe(0)
      expectUnregistered(scope, 'codex')
      expect(existsSync(join(root(scope), '.clooks'))).toBe(false)
    })
  }

  for (const selected of ['claude-code', 'codex'] as const) {
    test(`global stale ${selected} flag clears without registration or deleting other state`, () => {
      initialize('global')
      rmSync(join(sandbox.home, registrationPaths[selected]))
      const selectedFlag =
        selected === 'codex' ? '.global-entrypoint-active.codex' : '.global-entrypoint-active'
      const otherFlag =
        selected === 'codex' ? '.global-entrypoint-active' : '.global-entrypoint-active.codex'
      const other: Agent = selected === 'codex' ? 'claude-code' : 'codex'
      const otherBefore = bytes('global', other)
      expect(sandbox.homeFileExists(`.clooks/${selectedFlag}`)).toBe(true)
      const result = forced('global', selected, '--unhook')
      expect(result.exitCode).toBe(0)
      expect(JSON.parse(result.stdout).data.globalFlagsRemoved).toEqual([selected])
      expect(JSON.parse(result.stdout).data).toMatchObject({
        agent: selected,
        agents: [selected],
        unhooked: true,
        deleted: false,
        eventsRemoved: [],
        claudeEventsRemoved: [],
        codexEventsRemoved: [],
      })
      expect(sandbox.homeFileExists(`.clooks/${selectedFlag}`)).toBe(false)
      expect(sandbox.homeFileExists(`.clooks/${otherFlag}`)).toBe(true)
      expect(bytes('global', other)).toBe(otherBefore)
      expectRuntimeRetained('global')
    })
  }

  test('global flag removal failure keeps runtime and retry clears stale state', () => {
    initialize('global')
    const flag = join(sandbox.home, '.clooks/.global-entrypoint-active.codex')
    rmSync(flag)
    mkdirSync(flag)
    writeFileSync(join(flag, 'keep'), 'not a removable flag')
    const result = forced('global', 'codex')
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stdout).ok).toBe(false)
    expect(readFileSync(join(flag, 'keep'), 'utf8')).toBe('not a removable flag')
    expectRuntimeRetained('global')
    rmSync(flag, { recursive: true })
    writeFileSync(flag, '')
    expect(forced('global', 'codex').exitCode).toBe(0)
    expect(existsSync(join(sandbox.home, '.clooks'))).toBe(false)
  })
})

describe('interactive shared runtime cleanup', () => {
  const cleanupPrompt =
    'Remove all Claude Code and Codex Clooks hook registrations before deleting the shared directory?'

  for (const selected of ['claude-code', 'codex'] as const) {
    const label = selected === 'claude-code' ? 'Claude Code' : 'Codex'
    const other: Agent = selected === 'claude-code' ? 'codex' : 'claude-code'
    for (const scope of ['project', 'global'] as const) {
      test(`${scope} ${selected}: cancel extra cleanup after accepting selected unhook and deletion`, async () => {
        initialize(scope)
        const claudeBefore = bytes(scope, 'claude-code')
        const codexBefore = bytes(scope, 'codex')
        const flagsBefore = globalFlags()
        const transcript = await interactive(scope, selected, [
          [
            `Remove ${label}${scope === 'global' ? ' global' : ''} Clooks hook registrations?`,
            'yes',
          ],
          [
            scope === 'global' ? 'Delete ~/.clooks/ directory?' : 'Delete .clooks/ directory?',
            'yes',
          ],
          [cleanupPrompt, 'cancel'],
        ])
        expect(transcript).toContain('Operation cancelled.')
        expect(bytes(scope, 'claude-code')).toBe(claudeBefore)
        expect(bytes(scope, 'codex')).toBe(codexBefore)
        expect(globalFlags()).toEqual(flagsBefore)
        expectRuntimeRetained(scope)
      }, 40_000)
    }
    for (const answer of ['yes', 'no', 'cancel'] as const) {
      test(`project ${selected}: declined unhook, accepted delete, ${answer} all-agent cleanup`, async () => {
        initialize('project')
        const claudeBefore = bytes('project', 'claude-code')
        const codexBefore = bytes('project', 'codex')
        const flagsBefore = globalFlags()
        const transcript = await interactive('project', selected, [
          [`Remove ${label} Clooks hook registrations?`, 'no'],
          ['Delete .clooks/ directory?', 'yes'],
          [cleanupPrompt, answer],
        ])
        expect(transcript).toContain(cleanupPrompt)
        if (answer === 'yes') {
          expectUnregistered('project', 'claude-code')
          expectUnregistered('project', 'codex')
          expect(existsSync(join(sandbox.dir, '.clooks'))).toBe(false)
        } else {
          expect(bytes('project', 'claude-code')).toBe(claudeBefore)
          expect(bytes('project', 'codex')).toBe(codexBefore)
          expectRuntimeRetained('project')
          expect(globalFlags()).toEqual(flagsBefore)
          if (answer === 'cancel') expect(transcript).toContain('Operation cancelled.')
        }
      }, 40_000)

      test(`global other-only ${other}: ${answer} cleanup with no ${selected} unhook prompt`, async () => {
        initialize('global', other)
        const before = bytes('global', other)
        const selectedPath = join(sandbox.home, registrationPaths[selected])
        expect(existsSync(selectedPath)).toBe(false)
        const flagsBefore = globalFlags()
        const transcript = await interactive('global', selected, [
          ['Delete ~/.clooks/ directory?', 'yes'],
          [cleanupPrompt, answer],
        ])
        expect(transcript).not.toContain(`Remove ${label} global Clooks hook registrations?`)
        expect(transcript).toContain(cleanupPrompt)
        if (answer === 'yes') {
          expectUnregistered('global', other)
          expect(existsSync(join(sandbox.home, '.clooks'))).toBe(false)
        } else {
          expect(bytes('global', other)).toBe(before)
          expect(existsSync(selectedPath)).toBe(false)
          expectRuntimeRetained('global')
          expect(globalFlags()).toEqual(flagsBefore)
          if (answer === 'cancel') expect(transcript).toContain('Operation cancelled.')
        }
      }, 40_000)
    }
  }
})

describe('uninstall journey', () => {
  test('init then uninstall --project --full --force removes everything', () => {
    sandbox = createSandbox()

    const initResult = sandbox.run(['init'], { timeout: 10_000 })
    expect(initResult.exitCode).toBe(0)

    const result = sandbox.run(['uninstall', '--project', '--full', '--force'])
    expect(result.exitCode).toBe(0)

    // .clooks/ directory should be gone
    expect(sandbox.fileExists('.clooks/clooks.yml')).toBe(false)

    // .claude/settings.json should still exist but have no Clooks hooks
    expect(sandbox.fileExists('.claude/settings.json')).toBe(true)
    const settings = JSON.parse(sandbox.readFile('.claude/settings.json'))
    expect(settings.hooks).toBeUndefined()
  })

  test('uninstall --project --full --force preserves non-Clooks hooks', () => {
    sandbox = createSandbox()

    const initResult = sandbox.run(['init'], { timeout: 10_000 })
    expect(initResult.exitCode).toBe(0)

    // Add a non-Clooks hook alongside Clooks on PreToolUse (a real event)
    const settings = JSON.parse(sandbox.readFile('.claude/settings.json'))
    settings.hooks.PreToolUse.push({
      hooks: [{ type: 'command', command: '/my/other/hook.sh' }],
    })
    sandbox.writeFile('.claude/settings.json', JSON.stringify(settings, null, 2) + '\n')

    const result = sandbox.run(['uninstall', '--project', '--full', '--force'])
    expect(result.exitCode).toBe(0)

    // The non-Clooks hook on PreToolUse should still be there
    const after = JSON.parse(sandbox.readFile('.claude/settings.json'))
    expect(after.hooks).toBeDefined()
    expect(after.hooks.PreToolUse).toBeDefined()
    expect(after.hooks.PreToolUse).toHaveLength(1)
    expect(after.hooks.PreToolUse[0].hooks[0].command).toBe('/my/other/hook.sh')
  })

  test('uninstall --project --unhook --force only removes settings.json entries', () => {
    sandbox = createSandbox()

    const initResult = sandbox.run(['init'], { timeout: 10_000 })
    expect(initResult.exitCode).toBe(0)

    const result = sandbox.run(['uninstall', '--project', '--unhook', '--force'])
    expect(result.exitCode).toBe(0)

    // settings.json should have no Clooks hooks
    const settings = JSON.parse(sandbox.readFile('.claude/settings.json'))
    expect(settings.hooks).toBeUndefined()

    // .clooks/ directory should still exist
    expect(sandbox.fileExists('.clooks/clooks.yml')).toBe(true)
  })

  test('uninstall --project --full --json --force outputs valid envelope', () => {
    sandbox = createSandbox()

    const initResult = sandbox.run(['init'], { timeout: 10_000 })
    expect(initResult.exitCode).toBe(0)

    const result = sandbox.run(['uninstall', '--project', '--full', '--force', '--json'])
    expect(result.exitCode).toBe(0)

    const envelope = JSON.parse(result.stdout)
    expect(envelope.ok).toBe(true)
    expect(envelope.command).toBe('uninstall')
    expect(envelope.data.scope).toBe('project')
    expect(envelope.data.unhooked).toBe(true)
    expect(envelope.data.deleted).toBe(true)
  })

  test('uninstall --project --full --force is idempotent', () => {
    sandbox = createSandbox()

    const initResult = sandbox.run(['init'], { timeout: 10_000 })
    expect(initResult.exitCode).toBe(0)

    // First uninstall
    const firstResult = sandbox.run(['uninstall', '--project', '--full', '--force'])
    expect(firstResult.exitCode).toBe(0)

    // Second uninstall — should be a no-op
    const result = sandbox.run(['uninstall', '--project', '--full', '--force'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout + result.stderr).toContain('Nothing to uninstall')
  })

  test('init --global then uninstall --global --full --force removes global hooks', () => {
    sandbox = createSandbox()

    const initResult = sandbox.run(['init', '--global'], { timeout: 10_000 })
    expect(initResult.exitCode).toBe(0)

    const result = sandbox.run(['uninstall', '--global', '--full', '--force'])
    expect(result.exitCode).toBe(0)

    // Global .clooks/ should be gone
    expect(sandbox.homeFileExists('.clooks/clooks.yml')).toBe(false)

    // Global settings.json should still exist but have no Clooks hooks
    expect(sandbox.homeFileExists('.claude/settings.json')).toBe(true)
    const settings = JSON.parse(sandbox.readHomeFile('.claude/settings.json'))
    expect(settings.hooks).toBeUndefined()
  })

  test('uninstall --json without --force errors', () => {
    sandbox = createSandbox()

    const result = sandbox.run(['uninstall', '--project', '--json'])
    expect(result.exitCode).toBe(1)

    const envelope = JSON.parse(result.stdout)
    expect(envelope.ok).toBe(false)
    expect(envelope.error).toContain('--force')
  })

  test('uninstall --project --force without action flag errors', () => {
    sandbox = createSandbox()

    const result = sandbox.run(['uninstall', '--project', '--force'])
    expect(result.exitCode).toBe(1)
  })

  test('init --global then uninstall --global --unhook --force keeps ~/.clooks/', () => {
    sandbox = createSandbox()

    const initResult = sandbox.run(['init', '--global'], { timeout: 10_000 })
    expect(initResult.exitCode).toBe(0)

    const result = sandbox.run(['uninstall', '--global', '--unhook', '--force'])
    expect(result.exitCode).toBe(0)

    // ~/.clooks/ should still exist
    expect(sandbox.homeFileExists('.clooks/clooks.yml')).toBe(true)

    // Global settings.json should have no Clooks hooks
    expect(sandbox.homeFileExists('.claude/settings.json')).toBe(true)
    const settings = JSON.parse(sandbox.readHomeFile('.claude/settings.json'))
    expect(settings.hooks).toBeUndefined()
  })

  test('uninstall --project --full --force --json includes custom hooks in envelope', () => {
    sandbox = createSandbox()

    const initResult = sandbox.run(['init'], { timeout: 10_000 })
    expect(initResult.exitCode).toBe(0)

    sandbox.writeHook('my-hook.ts', 'export default {}')

    const result = sandbox.run(['uninstall', '--project', '--full', '--force', '--json'])
    expect(result.exitCode).toBe(0)

    const envelope = JSON.parse(result.stdout)
    expect(envelope.ok).toBe(true)
    expect(envelope.data.customHooksDeleted).toContain('my-hook.ts')
  })

  test('uninstall --project --full --force deletes custom hooks without warning', () => {
    sandbox = createSandbox()

    const initResult = sandbox.run(['init'], { timeout: 10_000 })
    expect(initResult.exitCode).toBe(0)

    sandbox.writeHook(
      'my-hook.ts',
      'export default { meta: { name: "test" }, handler: () => ({}) }',
    )

    const result = sandbox.run(['uninstall', '--project', '--full', '--force'])
    expect(result.exitCode).toBe(0)

    // Custom hook should be gone along with the entire .clooks/ directory
    expect(sandbox.fileExists('.clooks/hooks/my-hook.ts')).toBe(false)
  })
})
