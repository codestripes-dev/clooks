import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { quote, save } from './native'

export type AdvisoryAgent = 'claude' | 'codex'
export type AdvisoryScope = 'project' | 'global'
export const runtimeBehaviors = [
  'success-output',
  'success-empty',
  'fail-output',
  'stderr-only',
  'continue-false',
] as const
export interface RuntimeAdvisoryCase {
  agent: AdvisoryAgent
  order: 'runtime-first' | 'advisory-first'
  scope: AdvisoryScope
  advisory: 'message' | 'absent' | 'skip'
  runtime: (typeof runtimeBehaviors)[number]
  mixed?: boolean
}

export function runtimeAdvisoryCases(): RuntimeAdvisoryCase[] {
  const cases: RuntimeAdvisoryCase[] = []
  for (const agent of ['claude', 'codex'] as const) {
    for (const runtime of runtimeBehaviors) {
      for (const advisory of ['absent', 'message'] as const)
        cases.push({ agent, runtime, advisory, scope: 'project', order: 'runtime-first' })
    }
    cases.push(
      {
        agent,
        runtime: 'success-output',
        advisory: 'message',
        scope: 'global',
        order: 'advisory-first',
      },
      {
        agent,
        runtime: 'success-output',
        advisory: 'message',
        scope: 'project',
        order: 'runtime-first',
        mixed: true,
      },
      {
        agent,
        runtime: 'success-output',
        advisory: 'skip',
        scope: 'project',
        order: 'runtime-first',
      },
    )
  }
  return cases
}

export function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export interface CommandGroup {
  hooks: [{ type: 'command'; command: string; [key: string]: unknown }]
  [key: string]: unknown
}

// Keep complete generated groups, including matcher/timeout fields. Never
// reconstruct a production command from the fixture's expectations.
export function sessionStartGroups(document: any): {
  runtime: CommandGroup
  advisory: CommandGroup
} {
  const groups = document?.hooks?.SessionStart
  assert.ok(
    Array.isArray(groups) && groups.length === 2,
    'Expected two generated SessionStart groups',
  )
  for (const group of groups) {
    assert.ok(
      Array.isArray(group?.hooks) && group.hooks.length === 1,
      'SessionStart must be unpaired',
    )
    assert.equal(group.hooks[0].type, 'command')
    assert.equal(typeof group.hooks[0].command, 'string')
    assert.notEqual(group.hooks[0].async, true)
  }
  const runtimes = groups.filter((g) => g.hooks[0].command.includes('/entrypoint.sh'))
  const advisories = groups.filter((g) => g.hooks[0].command.includes('/runtime-advisory.sh'))
  assert.equal(runtimes.length, 1, 'Expected one runtime command')
  assert.equal(advisories.length, 1, 'Expected one advisory command')
  assert.notEqual(runtimes[0], advisories[0])
  return { runtime: runtimes[0], advisory: advisories[0] }
}

export function selectSessionStartGroups(
  groups: ReturnType<typeof sessionStartGroups>,
  c: RuntimeAdvisoryCase,
  scope: AdvisoryScope,
): CommandGroup[] {
  const selected: CommandGroup[] = []
  if (scope === (c.mixed ? 'global' : c.scope)) selected.push(groups.runtime)
  if (c.advisory !== 'absent' && scope === c.scope) selected.push(groups.advisory)
  return c.order === 'advisory-first' ? selected.reverse() : selected
}

export function oldRuntimeScript(root: string, behavior: RuntimeAdvisoryCase['runtime']): string {
  const output =
    behavior === 'continue-false'
      ? { continue: false, stopReason: 'OLD_RUNTIME_STOP' }
      : {
          systemMessage: 'OLD_RUNTIME_VISIBLE',
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: 'OLD_RUNTIME_CONTEXT',
          },
        }
  return [
    '#!/bin/bash',
    'set -eu',
    'if [ "$#" = 1 ] && [ "$1" = --version ]; then',
    '  if IFS= read -r input; then probe=input; else probe=eof; fi',
    '  printf \'probe:%s\\n\' "$probe" >> ' + quote(join(root, 'binary-invocations.log')),
    "  printf '%s\\n' 'clooks 0.0.1'",
    '  exit 0',
    'fi',
    'if [ "$#" != 0 ]; then',
    '  printf \'unexpected:%s\\n\' "$*" >> ' + quote(join(root, 'binary-invocations.log')),
    '  exit 71',
    'fi',
    "printf '%s\\n' runtime >> " + quote(join(root, 'binary-invocations.log')),
    'cat >> ' + quote(join(root, 'runtime-input.json')),
    ...(behavior === 'success-empty' || behavior === 'stderr-only'
      ? []
      : ["printf '%s\\n' " + quote(JSON.stringify(output))]),
    ...(behavior === 'fail-output' || behavior === 'stderr-only'
      ? ["printf '%s\\n' OLD_RUNTIME_STDERR >&2", 'exit 2']
      : ['exit 0']),
    '',
  ].join('\n')
}

export function entryProbeScript(
  root: string,
  scopes: { scope: AdvisoryScope; root: string }[],
): string {
  return scopes
    .flatMap((s) =>
      ['runtime', 'advisory'].map((kind) => {
        const path = join(
          s.root,
          '.clooks/bin',
          kind === 'runtime' ? 'entrypoint.sh' : 'runtime-advisory.sh',
        )
        return (
          'if [ "$0" = ' +
          quote(path) +
          " ]; then printf '%s\\n' " +
          quote(kind + ':' + s.scope) +
          ' >> ' +
          quote(join(root, 'entry-invocations.log')) +
          '; fi\n'
        )
      }),
    )
    .join('')
}

export function createRuntimeAdvisoryFixture(
  root: string,
  c: RuntimeAdvisoryCase,
  binary: string,
  runtime: 'old' | 'candidate' = 'old',
) {
  const home = join(root, 'home'),
    project = join(root, 'project')
  const codexHome = join(home, '.codex'),
    claudeHome = join(home, '.claude')
  for (const path of [home, project, codexHome, claudeHome, join(root, 'temp')])
    mkdirSync(path, { recursive: true })
  const env: Record<string, string> = {
    HOME: home,
    CODEX_HOME: codexHome,
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_CACHE_HOME: join(home, '.cache'),
    XDG_DATA_HOME: join(home, '.local/share'),
    TMPDIR: join(root, 'temp'),
    PATH: '/usr/local/bin:/usr/bin:/bin',
    SHELL: '/bin/bash',
    LANG: 'C.UTF-8',
    TERM: 'xterm-256color',
    CLOOKS_E2E_DOCKER: 'true',
    DISABLE_AUTOUPDATER: '1',
    DISABLE_TELEMETRY: '1',
    DISABLE_ERROR_REPORTING: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
  }
  const scopes: { scope: AdvisoryScope; root: string }[] = c.mixed
    ? [
        { scope: 'project', root: project },
        { scope: 'global', root: home },
      ]
    : [{ scope: c.scope, root: c.scope === 'project' ? project : home }]
  const managed: { path: string; sha256: string }[] = []
  const registrations: unknown[] = []
  const archive = join(root, 'generated')
  mkdirSync(archive)
  for (const s of scopes) {
    mkdirSync(join(s.root, '.clooks'), { recursive: true })
    writeFileSync(join(s.root, '.clooks/clooks.yml'), 'version: "1.0.0"\n')
    const argv = [binary, 'init', '--agent', 'all', ...(s.scope === 'global' ? ['--global'] : [])]
    const init = Bun.spawnSync(argv, { cwd: project, env, stdin: new Uint8Array(), timeout: 30000 })
    save(join(archive, s.scope + '-init.json'), {
      argv,
      exitCode: init.exitCode,
      stdout: init.stdout.toString(),
      stderr: init.stderr.toString(),
    })
    assert.equal(init.exitCode, 0, init.stderr.toString())
    for (const name of ['entrypoint.sh', 'runtime-advisory.sh']) {
      const path = join(s.root, '.clooks/bin', name)
      copyFileSync(path, join(archive, s.scope + '-' + name))
      managed.push({ path, sha256: sha256(path) })
    }
  }
  for (const s of scopes) {
    for (const agent of ['claude', 'codex'] as const) {
      const path = join(s.root, agent === 'claude' ? '.claude/settings.json' : '.codex/hooks.json')
      copyFileSync(path, join(archive, s.scope + '-' + agent + '.json'))
      const groups = sessionStartGroups(JSON.parse(readFileSync(path, 'utf8')))
      const selected = selectSessionStartGroups(groups, c, s.scope)
      registrations.push({
        scope: s.scope,
        agent,
        path,
        generatedSha256: sha256(path),
        groups,
        selected,
      })
      save(path, { hooks: { SessionStart: selected } })
      managed.push({ path, sha256: sha256(path) })
    }
  }
  // SessionStart-only production-registration fixtures, not full native-init
  // coverage. The old binary must never impersonate an MCP server.
  const omitted: string[] = []
  for (const [label, path] of [
    ['project-mcp.json', join(project, '.mcp.json')],
    ['global-claude.json', join(home, '.claude.json')],
    ['project-codex.toml', join(project, '.codex/config.toml')],
    ['global-codex.toml', join(codexHome, 'config.toml')],
  ] as const) {
    if (existsSync(path)) {
      copyFileSync(path, join(archive, label))
      rmSync(path)
      omitted.push(path)
    }
  }
  const fixtureBin = join(root, 'fixture-bin')
  mkdirSync(fixtureBin)
  const fake = join(fixtureBin, 'clooks')
  if (runtime === 'old') {
    writeFileSync(fake, oldRuntimeScript(root, c.runtime))
    chmodSync(fake, 0o755)
  } else symlinkSync(binary, fake)
  const probe = join(root, 'entry-probe.sh')
  writeFileSync(probe, entryProbeScript(root, scopes))
  env.PATH = fixtureBin + ':' + env.PATH
  env.BASH_ENV = probe
  if (c.advisory === 'skip') env.SKIP_CLOOKS = 'true'
  const advisoryRoot = c.scope === 'global' ? home : project
  const floor = /^CLOOKS_REQUIRED_RUNTIME='([^']+)'$/m.exec(
    readFileSync(join(advisoryRoot, '.clooks/bin/runtime-advisory.sh'), 'utf8'),
  )?.[1]
  assert.ok(floor, 'Missing generated runtime floor')
  save(join(root, 'generated.json'), {
    evidence: 'SessionStart production registration proof; not full native init',
    candidateBinarySha256: sha256(binary),
    registrations,
    managed,
    omitted,
    runtime,
    fixtureBinarySha256: sha256(fake),
    entryProbeSha256: sha256(probe),
  })
  return { root, home, project, codexHome, claudeHome, env, managed, floor }
}

export type RuntimeAdvisoryNativeFixture = ReturnType<typeof createRuntimeAdvisoryFixture>

export async function runRuntimeAdvisoryNative(): Promise<void> {
  assert.equal(process.env.CLOOKS_E2E_DOCKER, 'true')
  assert.notEqual(process.getuid!(), 0)
  const root = '/export/runtime-advisory'
  mkdirSync(root, { recursive: true })
  const { runGeneratedRuntimeAdvisoryCases } = await import('./runtime-advisory-native')
  const { forward, reverse } = await runGeneratedRuntimeAdvisoryCases(root, '/export/build/clooks')
  save('/export/passed.json', {
    cases: [...forward, ...reverse].map((r) => r.id),
    productionGenerator: true,
    evidence: 'SessionStart production registration proof; not full native init',
  })
}
