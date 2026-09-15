import assert from 'node:assert/strict'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { claude, codex, quote, save } from './native'
import {
  assertOutcome,
  packets,
  type Mode,
  type Case,
} from '../fixtures/production-approvals/evidence'
import { rows } from '../fixtures/production-approvals/records'
import type { Provider } from '../fixtures/interactive-approvals/channel'

const fixtures = '/app/test/fixtures/production-approvals'
const binary = '/export/build/clooks'
const modes: Mode[] = ['approve', 'decline-first', 'decline-second', 'noask']
export const generatedNames = ['claude', 'codex'].flatMap((provider) =>
  modes.map((mode) => `${provider}-generated-${mode}`),
)

export function selectGenerated(args: string[]) {
  assert.equal(args.filter((arg) => arg === '--generated').length, 1)
  const selected = args.filter((arg) => arg !== '--generated')
  assert.equal(new Set(selected).size, selected.length, 'Duplicate generated case')
  assert.ok(
    selected.every((name) => generatedNames.includes(name)),
    'Unknown generated case or incompatible flag',
  )
  return selected.length ? selected : generatedNames
}

function setupGenerated(root: string, provider: Provider, mode: Mode) {
  const project = join(root, 'project'),
    home = join(root, 'home')
  const config = join(home, provider === 'claude' ? '.claude' : '.codex')
  for (const dir of [project, config, join(root, 'temp'), join(root, 'bin')])
    mkdirSync(dir, { recursive: true })
  symlinkSync(binary, join(root, 'bin/clooks'))
  const env: Record<string, string> = {
    HOME: home,
    CODEX_HOME: join(home, '.codex'),
    TMPDIR: join(root, 'temp'),
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_CACHE_HOME: join(home, '.cache'),
    XDG_DATA_HOME: join(home, '.local/share'),
    PATH: `${join(root, 'bin')}:/usr/local/bin:/usr/bin:/bin`,
    SHELL: '/bin/bash',
    LANG: 'C.UTF-8',
    TERM: 'dumb',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_AUTOUPDATER: '1',
    DISABLE_TELEMETRY: '1',
    DISABLE_ERROR_REPORTING: '1',
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
    APPROVAL_ROOT: root,
    APPROVAL_CASE: mode,
  }
  const git = Bun.spawnSync(['git', 'init', project], { env, timeout: 5000 })
  assert.equal(git.exitCode, 0, git.stderr.toString())
  const init = Bun.spawnSync(
    [binary, 'init', '--agent', provider === 'claude' ? 'claude-code' : 'codex', '--json'],
    { cwd: project, env, timeout: 15000 },
  )
  save(join(root, 'init.json'), {
    code: init.exitCode,
    stdout: init.stdout.toString(),
    stderr: init.stderr.toString(),
  })
  assert.equal(init.exitCode, 0, init.stderr.toString() + init.stdout.toString())
  const managedPaths =
    provider === 'claude'
      ? ['.claude/settings.json', '.mcp.json', '.clooks/bin/claude-project-id']
      : ['.codex/hooks.json', '.codex/config.toml', '.clooks/bin/codex-project-id']
  managedPaths.push('.clooks/bin/entrypoint.sh')
  const managed = managedPaths.map((path) => ({
    path,
    text: readFileSync(join(project, path), 'utf8'),
  }))
  save(join(root, 'generated-registration.json'), managed)
  const settings = JSON.parse(managed[0]!.text)
  const pair = settings.hooks.PreToolUse.flatMap((group: any) => group.hooks)
  assert.equal(pair.length, 2)
  assert.deepEqual(
    pair.map((handler: any) => handler.type),
    ['command', 'mcp_tool'],
  )
  assert.equal(pair[1].server, 'clooks')
  assert.equal(pair[1].tool, 'check')
  assert.ok(pair.every((handler: any) => handler.timeout === 330))
  const owner = `project:${managed[2]!.text.trim()}`
  assert.equal(pair[1].input.owner, owner)

  const hookDir = join(project, '.clooks/hooks')
  for (let number = 1; number <= 5; number++)
    copyFileSync(join(fixtures, `hook-${number}.ts`), join(hookDir, `hook-${number}.ts`))
  for (const name of ['hooks.ts', 'records.ts'])
    copyFileSync(join(fixtures, name), join(hookDir, name))
  const names = [1, 2, 3, 4, 5].map((number) => `hook-${number}`)
  writeFileSync(
    join(project, '.clooks/clooks.yml'),
    JSON.stringify({
      version: '1.0.0',
      ...Object.fromEntries(names.map((name) => [name, { handoff: false, maxFailures: 0 }])),
      PreToolUse: { order: names },
    }),
  )
  const observation = {
    type: 'command',
    command: `exec bun ${quote(join(fixtures, 'observe.ts'))}`,
    timeout: 5,
  }
  const observers = {
    PreToolUse: [{ hooks: [observation] }],
    PostToolUse: [{ hooks: [observation] }],
  }
  if (provider === 'claude') {
    save(join(project, '.claude/settings.local.json'), {
      permissions: { allow: ['Bash(*)'] },
      enabledMcpjsonServers: ['clooks'],
      hooks: {
        ...observers,
        Elicitation: [
          {
            hooks: [
              {
                type: 'command',
                command: `exec bun ${quote(join(fixtures, 'responder.ts'))}`,
                timeout: 15,
              },
            ],
          },
        ],
      },
    })
    save(join(home, '.claude.json'), {
      hasCompletedOnboarding: true,
      theme: 'dark',
      customApiKeyResponses: { approved: ['local-test-only'], rejected: [] },
      projects: { [project]: { hasTrustDialogAccepted: true } },
    })
  } else save(join(config, 'hooks.json'), { hooks: observers })
  const callId = `generated_native_call_${randomUUID()}`
  const cmd = `bun ${quote(join(fixtures, 'effect.ts'))}`
  const c: Case = {
    root,
    home,
    provider,
    mode,
    callId,
    owner,
    operation: { toolName: 'Bash', input: { command: cmd } },
  }
  save(join(root, 'case.json'), c)
  return {
    kind: 'generated' as const,
    root,
    project,
    home,
    config,
    env,
    provider,
    cmd,
    callId,
    c,
    managed,
    interactiveConfig: 'disk' as const,
    interactiveReadiness: 'input-render' as const,
    scoped: false as const,
  }
}
export type GeneratedRuntime = ReturnType<typeof setupGenerated>

export function finalizeGeneratedCase(runtime: GeneratedRuntime, result: Record<string, unknown>) {
  try {
    for (const managed of runtime.managed)
      assert.equal(
        readFileSync(join(runtime.project, managed.path), 'utf8'),
        managed.text,
        `Native driver mutated generated ${managed.path}`,
      )
  } catch (error) {
    Object.assign(result, { passed: false, registrationError: String(error) })
  }
  try {
    save(join(runtime.root, 'observed-packets.json'), packets(runtime.home))
  } catch (error) {
    Object.assign(result, { passed: false, packetError: String(error) })
  }
}

export async function runGenerated(args: string[]) {
  const selected = selectGenerated(args)
  const results: any[] = []
  const versions: Record<string, unknown> = {}
  for (const provider of ['claude', 'codex']) {
    const path = `/native/${provider}`
    const version = Bun.spawnSync([path, '--version'], {
      env: { HOME: '/tmp', PATH: '/usr/local/bin:/usr/bin:/bin' },
      timeout: 5000,
    })
    assert.equal(version.exitCode, 0)
    versions[provider] = {
      version: version.stdout.toString().trim(),
      sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
    }
  }
  save('/export/versions.json', versions)
  for (const name of selected) {
    const provider = name.startsWith('claude-') ? 'claude' : 'codex'
    const mode = name.slice(`${provider}-generated-`.length) as Mode
    let runtime: GeneratedRuntime | undefined
    const result: any = { name, passed: false }
    try {
      runtime = setupGenerated(join('/export', name), provider, mode)
      const native = await (provider === 'claude' ? claude(runtime) : codex(runtime))
      const anchor = JSON.parse(readFileSync(join(runtime.root, 'native-identity.json'), 'utf8'))
      const effect = join(runtime.project, 'effect.txt')
      assertOutcome(
        runtime.c,
        packets(runtime.home),
        rows(runtime.root),
        anchor,
        existsSync(effect) ? readFileSync(effect, 'utf8') : undefined,
        native,
      )
      if (provider === 'codex') {
        const responders = JSON.parse(readFileSync(join(runtime.root, 'responders.json'), 'utf8'))
        assert.equal(responders.pending, 0)
        assert.equal(responders.started, responders.settled)
        assert.deepEqual(responders.errors, [])
        assert.equal(responders.started, mode === 'noask' ? 0 : mode === 'decline-first' ? 1 : 2)
      }
      Object.assign(result, { passed: true, native })
    } catch (error) {
      result.error = error instanceof Error ? error.stack : String(error)
    } finally {
      if (runtime) finalizeGeneratedCase(runtime, result)
    }
    results.push(result)
    save('/export/results.json', {
      productionEngine: true,
      generatedRegistration: true,
      scriptedUI: true,
      results,
    })
    console.log(
      `${name}: ${result.passed ? 'PASS' : (result.error ?? result.registrationError ?? result.packetError)}`,
    )
  }
  assert.ok(
    results.every((result) => result.passed),
    'Generated native cases failed; inspect results.json',
  )
  save('/export/passed.json', {
    productionEngine: true,
    generatedRegistration: true,
    scriptedUI: true,
    milestoneComplete: false,
    cases: selected,
  })
}
