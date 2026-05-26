import { afterEach, describe, expect, test } from 'bun:test'
import { statSync } from 'fs'
import { join } from 'path'
import { createSandbox, type Sandbox } from './helpers/sandbox'

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

function projectCodexCommand(): string {
  const entrypointPath = join(sandbox.dir, '.clooks/bin/entrypoint.sh')
  return `CLOOKS_AGENT=codex CLOOKS_PROJECT_ROOT='${sandbox.dir}' '${entrypointPath}'`
}

function globalCodexCommand(): string {
  return `CLOOKS_AGENT=codex '${join(sandbox.home, '.clooks/bin/entrypoint.sh')}'`
}

describe('codex registration E2E', () => {
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
