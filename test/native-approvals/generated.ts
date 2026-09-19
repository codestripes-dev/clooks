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
import { isDeepStrictEqual } from 'node:util'
import { claude, codex, quote, save } from './native'
import {
  assertOutcome,
  packets,
  type Mode,
  type Case,
} from '../fixtures/production-approvals/evidence'
import { rows } from '../fixtures/production-approvals/records'
import type { AgentId } from '../fixtures/interactive-approvals/channel'

const fixtures = '/app/test/fixtures/production-approvals'
const binary = '/export/build/clooks'
type GeneratedScope = 'project' | 'global' | 'combined'
type GeneratedOperation = 'shell' | 'non-shell'
export interface GeneratedCaseDescriptor {
  name: string
  agent: AgentId
  mode: Mode
  scope: GeneratedScope
  operation: GeneratedOperation
}

const modes: Mode[] = [
  'approve',
  'decline-first',
  'decline-second',
  'cancel-first',
  'cancel-second',
  'noask',
]
const agents: AgentId[] = ['claude', 'codex']
export const generatedCases: GeneratedCaseDescriptor[] = agents.flatMap((agent) => [
  ...modes.map((mode) => ({
    name: `${agent}-generated-${mode}`,
    agent,
    mode,
    scope: 'project' as const,
    operation: 'shell' as const,
  })),
  ...(['approve', 'decline-second'] as const).map((mode) => ({
    name: `${agent}-generated-global-${mode}`,
    agent,
    mode,
    scope: 'global' as const,
    operation: 'shell' as const,
  })),
  ...(['approve', 'decline-second'] as const).map((mode) => ({
    name: `${agent}-generated-project-non-shell-${mode}`,
    agent,
    mode,
    scope: 'project' as const,
    operation: 'non-shell' as const,
  })),
  ...(['approve', 'decline-second', 'noask'] as const).map((mode) => ({
    name: `${agent}-generated-combined-${mode}`,
    agent,
    mode,
    scope: 'combined' as const,
    operation: 'shell' as const,
  })),
])
export const generatedNames = generatedCases.map(({ name }) => name)

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

type ManagedSnapshot = {
  path: string
  text: string
  compare?: 'claude-mcpServers'
}

function snapshot(path: string, compare?: ManagedSnapshot['compare']): ManagedSnapshot {
  return { path, text: readFileSync(path, 'utf8'), ...(compare ? { compare } : {}) }
}

export function assertApprovalPair(
  path: string,
  owner: string,
  observer?: Record<string, unknown>,
) {
  const settings = JSON.parse(readFileSync(path, 'utf8'))
  const handlers = settings.hooks.PreToolUse.flatMap((group: any) => group.hooks)
  const pair = handlers.filter(
    (handler: unknown) => !observer || !isDeepStrictEqual(handler, observer),
  )
  assert.equal(
    handlers.length - pair.length,
    observer ? 1 : 0,
    `Unexpected observer in generated ${path} PreToolUse hooks`,
  )
  assert.equal(pair.length, 2, `Expected exactly one production PreToolUse pair in ${path}`)
  assert.deepEqual(
    pair.map((handler: any) => handler.type),
    ['command', 'mcp_tool'],
  )
  assert.equal(pair[1].server, 'clooks')
  assert.equal(pair[1].tool, 'check')
  assert.ok(pair.every((handler: any) => handler.timeout === 2_147_483))
  assert.equal(pair[0].async, undefined)
  assert.equal(pair[1].input.owner, owner)
}

export function assertApprovalServer(path: string, agent: AgentId) {
  const text = readFileSync(path, 'utf8')
  if (agent === 'claude') {
    const server = JSON.parse(text).mcpServers.clooks
    assert.equal(server.command, 'clooks')
    assert.deepEqual(server.args, ['mcp'])
    assert.equal(server.timeout, 2_147_483_000)
  } else {
    const server = (Bun.TOML.parse(text) as any).mcp_servers.clooks
    assert.equal(server.command, 'clooks')
    assert.deepEqual(server.args, ['mcp'])
    assert.equal(server.startup_timeout_sec, 10)
    assert.equal(server.tool_timeout_sec, 2_147_483)
  }
}

function copyFixtureHooks(root: string, numbers: number[]) {
  const hookDir = join(root, 'hooks')
  mkdirSync(hookDir, { recursive: true })
  for (const number of numbers)
    copyFileSync(join(fixtures, `hook-${number}.ts`), join(hookDir, `hook-${number}.ts`))
  for (const name of ['hooks.ts', 'records.ts'])
    copyFileSync(join(fixtures, name), join(hookDir, name))
  for (let number = 1; number <= 5; number++)
    assert.equal(
      existsSync(join(hookDir, `hook-${number}.ts`)),
      numbers.includes(number),
      `Fixture hook ${number} is installed in the wrong scope`,
    )
  const names = numbers.map((number) => `hook-${number}`)
  writeFileSync(
    join(root, 'clooks.yml'),
    JSON.stringify({
      version: '1.0.0',
      ...Object.fromEntries(names.map((name) => [name, { handoff: false, maxFailures: 0 }])),
      PreToolUse: { order: names },
    }),
  )
}

function setupGenerated(root: string, descriptor: GeneratedCaseDescriptor) {
  const { agent, mode } = descriptor
  const project = join(root, 'project'),
    home = join(root, 'home')
  const config = join(home, agent === 'claude' ? '.claude' : '.codex')
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
  const onboarding = {
    hasCompletedOnboarding: true,
    theme: 'dark',
    customApiKeyResponses: { approved: ['local-test-only'], rejected: [] },
    projects: { [project]: { hasTrustDialogAccepted: true } },
  }
  if (agent === 'claude') save(join(home, '.claude.json'), onboarding)
  if (agent === 'codex' && descriptor.scope !== 'project')
    writeFileSync(
      join(config, 'config.toml'),
      `[projects.${JSON.stringify(project)}]\ntrust_level = "trusted"\n`,
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
  const git = Bun.spawnSync(['git', 'init', project], { env, timeout: 5000 })
  assert.equal(git.exitCode, 0, git.stderr.toString())
  if (descriptor.scope === 'combined' && agent === 'codex') {
    mkdirSync(join(project, '.codex'), { recursive: true })
    save(join(project, '.codex/hooks.json'), { hooks: observers })
  }
  const runInit = (global = false) =>
    Bun.spawnSync(
      [
        binary,
        'init',
        ...(global ? ['--global'] : []),
        '--agent',
        agent === 'claude' ? 'claude-code' : 'codex',
        '--json',
      ],
      { cwd: project, env, timeout: 15000 },
    )
  const receipt = (init: ReturnType<typeof runInit>) => ({
    code: init.exitCode,
    stdout: init.stdout.toString(),
    stderr: init.stderr.toString(),
  })
  let owner: string
  let suppressedOwner: string | undefined
  let initialManaged: ManagedSnapshot[] = []
  if (descriptor.scope === 'combined') {
    const projectInit = runInit()
    save(join(root, 'init-project.json'), receipt(projectInit))
    assert.equal(
      projectInit.exitCode,
      0,
      projectInit.stderr.toString() + projectInit.stdout.toString(),
    )
    const idPath = join(
      project,
      `.clooks/bin/${agent === 'claude' ? 'claude-project-id' : 'codex-project-id'}`,
    )
    suppressedOwner = `project:${readFileSync(idPath, 'utf8').trim()}`
    const projectManaged: ManagedSnapshot[] =
      agent === 'claude'
        ? [
            snapshot(join(project, '.clooks/hooks/types.d.ts')),
            snapshot(join(project, '.clooks/clooks.schema.json')),
            snapshot(join(project, '.claude/settings.json')),
            snapshot(join(project, '.mcp.json')),
            snapshot(join(project, '.clooks/bin/claude-project-id')),
            snapshot(join(project, '.clooks/bin/entrypoint.sh')),
          ]
        : [
            snapshot(join(project, '.clooks/hooks/types.d.ts')),
            snapshot(join(project, '.clooks/clooks.schema.json')),
            snapshot(join(project, '.codex/hooks.json')),
            snapshot(join(project, '.codex/config.toml')),
            snapshot(join(project, '.clooks/bin/codex-project-id')),
            snapshot(join(project, '.clooks/bin/entrypoint.sh')),
          ]
    const globalInit = runInit(true)
    save(join(root, 'init-global.json'), receipt(globalInit))
    assert.equal(
      globalInit.exitCode,
      0,
      globalInit.stderr.toString() + globalInit.stdout.toString(),
    )
    save(join(root, 'init.json'), { project: receipt(projectInit), global: receipt(globalInit) })
    for (const managed of projectManaged)
      assert.equal(
        readFileSync(managed.path, 'utf8'),
        managed.text,
        `Global init mutated combined project registration ${managed.path}`,
      )
    owner = 'global'
    const projectRegistration =
      agent === 'claude'
        ? join(project, '.claude/settings.json')
        : join(project, '.codex/hooks.json')
    const globalRegistration =
      agent === 'claude' ? join(home, '.claude/settings.json') : join(home, '.codex/hooks.json')
    assertApprovalPair(
      projectRegistration,
      suppressedOwner,
      agent === 'codex' ? observation : undefined,
    )
    assertApprovalPair(globalRegistration, owner)
    if (agent === 'codex') {
      const projectHooks = JSON.parse(readFileSync(projectRegistration, 'utf8')).hooks
      assert.ok(
        projectHooks.PostToolUse.flatMap((group: any) => group.hooks).some((handler: unknown) =>
          isDeepStrictEqual(handler, observation),
        ),
        'Codex project observer was not preserved by project init',
      )
    }
    initialManaged = [
      ...projectManaged,
      ...(agent === 'claude'
        ? [
            snapshot(join(home, '.clooks/hooks/types.d.ts')),
            snapshot(join(home, '.clooks/clooks.schema.json')),
            snapshot(join(home, '.claude/settings.json')),
            snapshot(join(home, '.claude.json'), 'claude-mcpServers'),
            snapshot(join(home, '.clooks/bin/entrypoint.sh')),
            snapshot(join(home, '.clooks/.global-entrypoint-active')),
          ]
        : [
            snapshot(join(home, '.clooks/hooks/types.d.ts')),
            snapshot(join(home, '.clooks/clooks.schema.json')),
            snapshot(join(home, '.codex/hooks.json')),
            snapshot(join(home, '.codex/config.toml')),
            snapshot(join(home, '.clooks/bin/entrypoint.sh')),
            snapshot(join(home, '.clooks/.global-entrypoint-active.codex')),
            snapshot(join(home, '.clooks/.codex-registration-home')),
          ]),
    ]
  } else {
    const init = runInit(descriptor.scope === 'global')
    save(join(root, 'init.json'), receipt(init))
    assert.equal(init.exitCode, 0, init.stderr.toString() + init.stdout.toString())
    owner =
      descriptor.scope === 'global'
        ? 'global'
        : `project:${readFileSync(
            join(
              project,
              `.clooks/bin/${agent === 'claude' ? 'claude-project-id' : 'codex-project-id'}`,
            ),
            'utf8',
          ).trim()}`
  }
  if (descriptor.scope === 'global') {
    for (const path of [
      join(project, '.mcp.json'),
      join(project, '.claude/settings.json'),
      join(project, '.codex/hooks.json'),
      join(project, '.codex/config.toml'),
      join(project, '.clooks/bin/claude-project-id'),
      join(project, '.clooks/bin/codex-project-id'),
      join(project, '.clooks'),
    ])
      assert.equal(existsSync(path), false, `Global init created project production file ${path}`)
  }
  if (descriptor.scope !== 'combined') {
    const registrationPath =
      agent === 'claude'
        ? join(descriptor.scope === 'global' ? home : project, '.claude/settings.json')
        : join(descriptor.scope === 'global' ? home : project, '.codex/hooks.json')
    assertApprovalPair(registrationPath, owner)
  }

  for (const scope of descriptor.scope === 'combined'
    ? ['project', 'global']
    : [descriptor.scope]) {
    const root = scope === 'global' ? home : project
    assertApprovalServer(
      join(
        root,
        agent === 'claude'
          ? scope === 'global'
            ? '.claude.json'
            : '.mcp.json'
          : '.codex/config.toml',
      ),
      agent,
    )
  }

  if (descriptor.scope === 'combined') {
    copyFixtureHooks(join(home, '.clooks'), [1, 2])
    copyFixtureHooks(join(project, '.clooks'), [3, 4, 5])
  } else {
    const hookRoot =
      descriptor.scope === 'global' ? join(home, '.clooks') : join(project, '.clooks')
    copyFixtureHooks(hookRoot, [1, 2, 3, 4, 5])
  }
  if (agent === 'claude') {
    mkdirSync(join(project, '.claude'), { recursive: true })
    save(join(project, '.claude/settings.local.json'), {
      permissions: { allow: ['Bash(*)', 'Write(*)'] },
      ...(['project', 'combined'].includes(descriptor.scope)
        ? { enabledMcpjsonServers: ['clooks'] }
        : {}),
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
  } else if (descriptor.scope === 'global') {
    mkdirSync(join(project, '.codex'), { recursive: true })
    save(join(project, '.codex/hooks.json'), { hooks: observers })
  } else if (descriptor.scope === 'project') save(join(config, 'hooks.json'), { hooks: observers })
  const managed: ManagedSnapshot[] =
    descriptor.scope === 'combined'
      ? [
          ...initialManaged,
          snapshot(join(home, '.clooks/clooks.yml')),
          snapshot(join(project, '.clooks/clooks.yml')),
          ...(agent === 'claude' ? [snapshot(join(project, '.claude/settings.local.json'))] : []),
        ]
      : descriptor.scope === 'global'
        ? agent === 'claude'
          ? [
              snapshot(join(home, '.clooks/hooks/types.d.ts')),
              snapshot(join(home, '.clooks/clooks.schema.json')),
              snapshot(join(home, '.clooks/clooks.yml')),
              snapshot(join(home, '.clooks/bin/entrypoint.sh')),
              snapshot(join(home, '.clooks/.global-entrypoint-active')),
              snapshot(join(home, '.claude/settings.json')),
              snapshot(join(home, '.claude.json'), 'claude-mcpServers'),
            ]
          : [
              snapshot(join(home, '.clooks/hooks/types.d.ts')),
              snapshot(join(home, '.clooks/clooks.schema.json')),
              snapshot(join(home, '.clooks/clooks.yml')),
              snapshot(join(home, '.clooks/bin/entrypoint.sh')),
              snapshot(join(home, '.codex/config.toml')),
              snapshot(join(home, '.clooks/.global-entrypoint-active.codex')),
              snapshot(join(home, '.clooks/.codex-registration-home')),
              snapshot(join(home, '.codex/hooks.json')),
            ]
        : agent === 'claude'
          ? [
              snapshot(join(project, '.claude/settings.json')),
              snapshot(join(project, '.mcp.json')),
              snapshot(join(project, '.clooks/bin/claude-project-id')),
              snapshot(join(project, '.clooks/bin/entrypoint.sh')),
            ]
          : [
              snapshot(join(project, '.codex/hooks.json')),
              snapshot(join(project, '.codex/config.toml')),
              snapshot(join(project, '.clooks/bin/codex-project-id')),
              snapshot(join(project, '.clooks/bin/entrypoint.sh')),
            ]
  save(join(root, 'generated-registration.json'), managed)
  const callId = `generated_native_call_${randomUUID()}`
  const cmd = `bun ${quote(join(fixtures, 'effect.ts'))}`
  const patch = '*** Begin Patch\n*** Add File: effect.txt\n+native-effect\n*** End Patch'
  const operation =
    descriptor.operation === 'non-shell'
      ? agent === 'claude'
        ? {
            toolName: 'Write',
            input: { file_path: join(project, 'effect.txt'), content: 'native-effect\n' },
          }
        : { toolName: 'apply_patch', input: { command: patch } }
      : { toolName: 'Bash', input: { command: cmd } }
  const c: Case = {
    root,
    home,
    agent,
    mode,
    callId,
    owner,
    ...(suppressedOwner ? { suppressedOwner } : {}),
    operation,
  }
  save(join(root, 'case.json'), c)
  return {
    kind: 'generated' as const,
    root,
    project,
    home,
    config,
    env,
    agent,
    cmd,
    callId,
    c,
    descriptor,
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
      if (managed.compare === 'claude-mcpServers') {
        const before = JSON.parse(managed.text)
        const after = JSON.parse(readFileSync(managed.path, 'utf8'))
        assert.deepEqual(
          after.mcpServers,
          before.mcpServers,
          `Native driver mutated generated ${managed.path} mcpServers`,
        )
      } else
        assert.equal(
          readFileSync(managed.path, 'utf8'),
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
  for (const agent of ['claude', 'codex']) {
    const path = `/native/${agent}`
    const version = Bun.spawnSync([path, '--version'], {
      env: { HOME: '/tmp', PATH: '/usr/local/bin:/usr/bin:/bin' },
      timeout: 5000,
    })
    assert.equal(version.exitCode, 0)
    versions[agent] = {
      version: version.stdout.toString().trim(),
      sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
    }
  }
  save('/export/versions.json', versions)
  for (const name of selected) {
    const descriptor = generatedCases.find((candidate) => candidate.name === name)
    assert.ok(descriptor, `Missing generated descriptor for ${name}`)
    const { agent, mode } = descriptor
    let runtime: GeneratedRuntime | undefined
    const result: any = { name, passed: false }
    try {
      runtime = setupGenerated(join('/export', name), descriptor)
      const native = await (agent === 'claude' ? claude(runtime) : codex(runtime))
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
      if (agent === 'codex') {
        const responders = JSON.parse(readFileSync(join(runtime.root, 'responders.json'), 'utf8'))
        assert.equal(responders.pending, 0)
        assert.equal(responders.started, responders.settled)
        assert.deepEqual(responders.errors, [])
        assert.equal(
          responders.started,
          mode === 'noask' ? 0 : mode === 'cancel-first' || mode === 'decline-first' ? 1 : 2,
        )
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
