import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRegistrationSandbox, registrationEnv } from './helpers/registration'
import type { Sandbox } from './helpers/sandbox'

let sandbox: Sandbox

afterEach(() => sandbox?.cleanup())

interface CommandHook {
  type: string
  command: string
}

interface MatcherGroup {
  matcher?: string
  hooks: CommandHook[]
}

function registration(relativePath: string): Record<string, MatcherGroup[]> {
  return JSON.parse(sandbox.readFile(relativePath)).hooks
}

function advisoryCommand(groups: MatcherGroup[]): string {
  const commands = groups.flatMap((group) => group.hooks.map((hook) => hook.command))
  const matches = commands.filter((command) => command.includes('runtime-advisory.sh'))
  expect(matches).toHaveLength(1)
  return matches[0]!
}

function runtimeCommand(groups: MatcherGroup[]): string {
  const commands = groups.flatMap((group) => group.hooks.map((hook) => hook.command))
  const matches = commands.filter(
    (command) => command.includes('/entrypoint.sh') && !command.includes('runtime-advisory.sh'),
  )
  expect(matches).toHaveLength(1)
  return matches[0]!
}

function runCommand(
  command: string,
  cwd: string,
  env: Record<string, string>,
  stdin = '{"secret":"must-not-echo"}',
): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(['/bin/bash', '-c', command], {
    cwd,
    env,
    stdin: Buffer.from(stdin),
    timeout: 10_000,
  })
  return {
    exitCode: result.exitCode ?? 2,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}

function checksum(bytes: Buffer): string {
  const result = Bun.spawnSync(['cksum'], { stdin: bytes })
  expect(result.exitCode).toBe(0)
  expect(result.stderr.toString()).toBe('')
  const match = /^(0|[1-9][0-9]*)[ \t]+(0|[1-9][0-9]*)\n$/u.exec(result.stdout.toString())
  expect(match).not.toBeNull()
  return `${match![1]}:${match![2]}`
}

function engineInput(agent: 'claude-code' | 'codex', event: 'SessionStart' | 'UserPromptSubmit') {
  const shared = {
    hook_event_name: event,
    session_id: `${agent}-${event}`,
    cwd: sandbox.dir,
  }
  if (agent === 'claude-code') {
    return JSON.stringify(
      event === 'SessionStart'
        ? { ...shared, source: 'startup' }
        : { ...shared, prompt: 'continue without installation inspection' },
    )
  }
  return JSON.stringify({
    ...shared,
    transcript_path: null,
    model: 'gpt-5.5',
    permission_mode: 'default',
    ...(event === 'SessionStart'
      ? { source: 'startup' }
      : { turn_id: 'turn-advisory', prompt: 'continue without installation inspection' }),
  })
}

function runEngine(agent: 'claude-code' | 'codex', event: 'SessionStart' | 'UserPromptSubmit') {
  return sandbox.run([], {
    stdin: engineInput(agent, event),
    env: {
      CLOOKS_AGENT: agent,
      ...(agent === 'claude-code' ? { CLAUDE_PROJECT_DIR: sandbox.dir } : {}),
    },
  })
}

function systemMessage(stdout: string): string {
  return (JSON.parse(stdout) as { systemMessage?: string }).systemMessage ?? ''
}

function installOldVersionProbe(): void {
  const bin = join(dirname(sandbox.dir), 'bin', 'clooks')
  sandbox.removeClooksBinary()
  writeFileSync(bin, "#!/bin/sh\nprintf '%s\\n' 'clooks 0.0.1'\n", { mode: 0o755 })
}

describe('compiled runtime advisory lifecycle', () => {
  test('project init registers separate Claude and Codex SessionStart commands only', () => {
    sandbox = createRegistrationSandbox()
    const initialized = sandbox.run(['init', '--agent', 'all'])
    expect(initialized.exitCode).toBe(0)

    const advisoryPath = join(sandbox.dir, '.clooks/bin/runtime-advisory.sh')
    expect(readFileSync(advisoryPath, 'utf8')).toStartWith('#!/usr/bin/env bash\n')
    expect(statSync(advisoryPath).mode & 0o111).toBeGreaterThan(0)

    const claude = registration('.claude/settings.json')
    const codex = registration('.codex/hooks.json')
    expect(claude.SessionStart).toHaveLength(2)
    expect(codex.SessionStart).toHaveLength(2)
    expect(claude.PreToolUse).toHaveLength(1)
    expect(codex.PreToolUse).toHaveLength(1)
    expect(JSON.stringify(claude.PreToolUse)).not.toContain('runtime-advisory.sh')
    expect(JSON.stringify(codex.PreToolUse)).not.toContain('runtime-advisory.sh')

    const claudeCommand = advisoryCommand(claude.SessionStart!)
    const codexCommand = advisoryCommand(codex.SessionStart!)
    expect(claudeCommand).toContain('CLOOKS_AGENT=claude-code')
    expect(codexCommand).toContain('CLOOKS_AGENT=codex')
    expect(codexCommand).toContain('clooks-advisory-project')

    installOldVersionProbe()
    const env = { ...registrationEnv(sandbox), CLAUDE_PROJECT_DIR: sandbox.dir }
    for (const [command, spelling] of [
      [claudeCommand, '/clooks:setup update'],
      [codexCommand, '$clooks:setup update'],
    ] as const) {
      const result = runCommand(command, sandbox.dir, env)
      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe('')
      expect(result.stdout).not.toContain('must-not-echo')
      expect(JSON.parse(result.stdout).systemMessage).toContain(spelling)
    }

    unlinkSync(advisoryPath)
    for (const command of [claudeCommand, codexCommand]) {
      expect(runCommand(command, sandbox.dir, env)).toEqual({
        exitCode: 0,
        stdout: '',
        stderr: '',
      })
    }
  })

  test('global receipt follows both advisory registrations and current unhook removes them', () => {
    sandbox = createRegistrationSandbox()
    const initialized = sandbox.run(['init', '--global', '--agent', 'all'])
    expect(initialized.exitCode).toBe(0)
    expect(sandbox.homeFileExists('.clooks/bin/runtime-advisory.sh')).toBe(true)
    expect(sandbox.homeFileExists('.clooks/.global-entrypoint-active.codex')).toBe(true)

    const claude = JSON.parse(sandbox.readHomeFile('.claude/settings.json')).hooks
    const codex = JSON.parse(sandbox.readHomeFile('.codex/hooks.json')).hooks
    const claudeCommand = advisoryCommand(claude.SessionStart)
    const codexCommand = advisoryCommand(codex.SessionStart)
    expect(claudeCommand).toContain('clooks-advisory-global')
    expect(codexCommand).toContain('clooks-advisory-global')

    const hooksBytes = readFileSync(join(sandbox.home, '.codex/hooks.json'))
    expect(sandbox.readHomeFile('.clooks/.global-entrypoint-active.codex')).toBe(
      `clooks-codex-registration-v1\n${realpathSync(sandbox.home)}\n${realpathSync(join(sandbox.home, '.codex'))}\n${checksum(hooksBytes)}\n`,
    )

    installOldVersionProbe()
    const env = registrationEnv(sandbox)
    for (const [command, spelling] of [
      [claudeCommand, '/clooks:setup update'],
      [codexCommand, '$clooks:setup update'],
    ] as const) {
      const normal = runCommand(command, sandbox.dir, env)
      expect(normal.exitCode).toBe(0)
      expect(normal.stderr).toBe('')
      expect(systemMessage(normal.stdout)).toContain(spelling)

      expect(runCommand(command, sandbox.dir, { ...env, SKIP_CLOOKS: 'true' })).toEqual({
        exitCode: 0,
        stdout: '',
        stderr: '',
      })
      expect(
        systemMessage(runCommand(command, sandbox.dir, { ...env, SKIP_CLOOKS: '1' }).stdout),
      ).toContain(spelling)
    }
    sandbox.restoreBinary()

    const removed = sandbox.run([
      'uninstall',
      '--global',
      '--agent',
      'all',
      '--unhook',
      '--force',
      '--json',
    ])
    expect(removed.exitCode).toBe(0)
    expect(JSON.parse(removed.stdout).data).toMatchObject({
      unhooked: true,
      deleted: false,
    })
    expect(sandbox.readHomeFile('.claude/settings.json')).not.toContain('runtime-advisory.sh')
    expect(sandbox.readHomeFile('.codex/hooks.json')).not.toContain('runtime-advisory.sh')
    expect(sandbox.homeFileExists('.clooks/.global-entrypoint-active.codex')).toBe(false)
    expect(sandbox.homeFileExists('.clooks/bin/runtime-advisory.sh')).toBe(true)
  })

  test('check reports a selected missing advisory registration as partial repair', () => {
    sandbox = createRegistrationSandbox()
    expect(sandbox.run(['init', '--agent', 'all']).exitCode).toBe(0)
    const path = join(sandbox.dir, '.claude/settings.json')
    const settings = JSON.parse(readFileSync(path, 'utf8'))
    settings.hooks.SessionStart = settings.hooks.SessionStart.filter(
      (group: MatcherGroup) => !JSON.stringify(group).includes('runtime-advisory.sh'),
    )
    writeFileSync(path, JSON.stringify(settings, null, 2) + '\n')
    chmodSync(path, 0o644)

    const checked = sandbox.run(['init', '--check', '--agent', 'claude-code', '--json'])
    expect(checked.exitCode).toBe(0)
    const project = JSON.parse(checked.stdout).data.scopes.find(
      (scope: { scope: string }) => scope.scope === 'project',
    )
    expect(project).toMatchObject({
      agents: ['claude-code', 'codex'],
      state: 'outdated',
      needsIntegrationRefresh: true,
    })
    expect(project.repair.args).toEqual(['init', '--agent', 'all'])
  })

  for (const scenario of [
    {
      agent: 'claude-code' as const,
      mode: 'no hooks',
      spelling: '/clooks:setup update',
      makeStale() {
        const path = join(sandbox.dir, '.clooks/bin/entrypoint.sh')
        const launcher = readFileSync(path, 'utf8')
          .replace(/^# clooks launcher revision: .*\n/mu, '')
          .replace(/^CLOOKS_REQUIRED_RUNTIME=.*\n/mu, '')
        writeFileSync(path, launcher)
      },
    },
    {
      agent: 'codex' as const,
      mode: 'no match',
      spelling: '$clooks:setup update',
      makeStale() {
        const path = join(sandbox.dir, '.clooks/bin/runtime-advisory.sh')
        unlinkSync(path)
        sandbox.writeHook(
          'stop-only.ts',
          `export const hook = {
  meta: { name: 'stop-only' },
  Stop() { return { result: 'skip' as const } },
}\n`,
        )
        sandbox.writeConfig('version: "1.0.0"\nstop-only: {}\n')
      },
    },
  ]) {
    test(`compiled ${scenario.agent} engine reports reverse advisory with ${scenario.mode}`, () => {
      sandbox = createRegistrationSandbox()
      expect(sandbox.run(['init', '--agent', 'all']).exitCode).toBe(0)
      scenario.makeStale()

      const started = runEngine(scenario.agent, 'SessionStart')
      expect(started.exitCode).toBe(0)
      expect(started.stderr).toBe('')
      const message = systemMessage(started.stdout)
      expect(message).toContain("This project's Clooks integration is outdated")
      expect(message).toContain(scenario.spelling)
      expect(message).toContain("'init' '--agent' 'all'")

      const prompt = runEngine(scenario.agent, 'UserPromptSubmit')
      expect(prompt).toMatchObject({ exitCode: 0, stdout: '', stderr: '' })
    })
  }

  test('global runtime reports stale project installation without a duplicate global notice', () => {
    sandbox = createRegistrationSandbox()
    expect(sandbox.run(['init', '--agent', 'claude-code']).exitCode).toBe(0)
    expect(sandbox.run(['init', '--global', '--agent', 'claude-code']).exitCode).toBe(0)
    unlinkSync(join(sandbox.dir, '.clooks/bin/runtime-advisory.sh'))

    const globalSettings = JSON.parse(sandbox.readHomeFile('.claude/settings.json')).hooks
    const command = runtimeCommand(globalSettings.SessionStart)
    const result = runCommand(
      command,
      sandbox.dir,
      { ...registrationEnv(sandbox), CLAUDE_PROJECT_DIR: sandbox.dir },
      engineInput('claude-code', 'SessionStart'),
    )
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    const message = systemMessage(result.stdout)
    expect(message).toContain("This project's Clooks integration is outdated")
    expect(message).not.toContain('The global Clooks integration is outdated')
  })

  test('compatible future launcher without an advisory stays quiet in the real engine', () => {
    sandbox = createRegistrationSandbox()
    expect(sandbox.run(['init', '--agent', 'all']).exitCode).toBe(0)
    const launcherPath = join(sandbox.dir, '.clooks/bin/entrypoint.sh')
    writeFileSync(
      launcherPath,
      readFileSync(launcherPath, 'utf8').replace(
        '# clooks launcher revision: 1',
        '# clooks launcher revision: 2',
      ),
    )
    unlinkSync(join(sandbox.dir, '.clooks/bin/runtime-advisory.sh'))

    for (const agent of ['claude-code', 'codex'] as const) {
      expect(runEngine(agent, 'SessionStart')).toMatchObject({
        exitCode: 0,
        stdout: '',
        stderr: '',
      })
    }
  })

  test('reverse advisory is limited to the active agent owned by the stale scope', () => {
    sandbox = createRegistrationSandbox()
    expect(sandbox.run(['init', '--agent', 'codex']).exitCode).toBe(0)
    unlinkSync(join(sandbox.dir, '.clooks/bin/runtime-advisory.sh'))

    expect(runEngine('claude-code', 'SessionStart')).toMatchObject({
      exitCode: 0,
      stdout: '',
      stderr: '',
    })
    const codex = runEngine('codex', 'SessionStart')
    expect(codex.exitCode).toBe(0)
    expect(codex.stderr).toBe('')
    expect(systemMessage(codex.stdout)).toContain("This project's Clooks integration is outdated")
  })

  test('project unhook removes runtime and advisory groups but retains the shared script', () => {
    sandbox = createRegistrationSandbox()
    expect(sandbox.run(['init', '--agent', 'all']).exitCode).toBe(0)

    const removed = sandbox.run([
      'uninstall',
      '--project',
      '--agent',
      'all',
      '--unhook',
      '--force',
      '--json',
    ])
    expect(removed.exitCode).toBe(0)
    expect(JSON.parse(removed.stdout).data).toMatchObject({ unhooked: true, deleted: false })
    expect(sandbox.readFile('.claude/settings.json')).not.toContain('entrypoint.sh')
    expect(sandbox.readFile('.claude/settings.json')).not.toContain('runtime-advisory.sh')
    expect(sandbox.readFile('.codex/hooks.json')).not.toContain('entrypoint.sh')
    expect(sandbox.readFile('.codex/hooks.json')).not.toContain('runtime-advisory.sh')
    expect(sandbox.fileExists('.clooks/bin/runtime-advisory.sh')).toBe(true)
  })
})
