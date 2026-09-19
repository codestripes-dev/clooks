import { afterEach, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { VERSION } from '../../src/version'
import { createRegistrationSandbox, registrationEnv } from '../e2e/helpers/registration'
import { freezeOnboardingInputs, verifyOnboardingInputs } from '../tooling/onboarding-inputs'

if (process.env.CLOOKS_E2E_DOCKER !== 'true' || process.getuid!() === 0) {
  throw new Error('Onboarding integration requires the non-root Docker validation runner')
}
if (process.env.CLOOKS_MARKETPLACE_ROOT !== '/onboarding-marketplace') {
  throw new Error(
    'Missing frozen package: set CLOOKS_MARKETPLACE_ROOT explicitly through bun run test:e2e',
  )
}
const frozen = process.env.CLOOKS_MARKETPLACE_ROOT
const compiled = resolve(import.meta.dir, '../../dist/clooks')
const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
const compiledHash = sha256(compiled)
const asset = `clooks-linux-${process.arch === 'arm64' ? 'arm64' : 'x64'}`
const cleanups: Array<() => void | Promise<unknown>> = []
afterEach(async () => {
  const errors: unknown[] = []
  for (const cleanup of cleanups.splice(0).reverse()) {
    try {
      await cleanup()
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length) throw new AggregateError(errors, 'Onboarding cleanup failed')
})

function fixture() {
  const sandbox = createRegistrationSandbox()
  cleanups.push(() => sandbox.cleanup())
  sandbox.removeClooksBinary()
  const cache = join(dirname(sandbox.dir), 'plugin cache')
  const manifest = freezeOnboardingInputs(frozen, cache)
  cleanups.push(() => verifyOnboardingInputs(cache, manifest))
  const plugin = join(cache, 'clooks')
  const codex = JSON.parse(readFileSync(join(plugin, '.codex-plugin/plugin.json'), 'utf8'))
  const claude = JSON.parse(readFileSync(join(plugin, '.claude-plugin/plugin.json'), 'utf8'))
  const codexSkill = resolve(plugin, codex.skills, 'setup')
  const installer = resolve(codexSkill, '../../skills/setup/scripts/install.sh')
  expect(installer).toBe(join(plugin, 'skills/setup/scripts/install.sh'))
  const requests: string[] = []
  let corrupt = false
  const prefix = `/releases/download/v${VERSION}`
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname
      requests.push(path)
      if (request.method !== 'GET') return new Response('GET only', { status: 405 })
      if (path === `${prefix}/checksums.txt`)
        return new Response(`${corrupt ? '0'.repeat(64) : compiledHash}  ${asset}\n`)
      if (path === `${prefix}/${asset}`) return new Response(Bun.file(compiled))
      return new Response('Unknown release asset', { status: 404 })
    },
  })
  cleanups.push(() => server.stop(true))
  const env = {
    ...registrationEnv(sandbox),
    PATH: '/usr/bin:/bin',
    SHELL: '/bin/bash',
    TMPDIR: dirname(sandbox.dir),
    CLOOKS_VERSION: VERSION,
    CLOOKS_INSTALL_BASE_URL: `http://127.0.0.1:${server.port}/releases`,
    PLUGIN_ROOT: plugin,
    CLAUDE_PLUGIN_ROOT: plugin,
    CLAUDE_PROJECT_DIR: sandbox.dir,
  }
  const managed = join(sandbox.home, '.local/bin/clooks')
  function seedBinary(path: string) {
    mkdirSync(dirname(path), { recursive: true })
    copyFileSync(compiled, path)
    chmodSync(path, 0o755)
    return path
  }
  return {
    sandbox,
    cache,
    plugin,
    codex,
    claude,
    installer,
    env,
    managed,
    requests,
    prefix,
    seedBinary,
    corruptChecksum: () => {
      corrupt = true
    },
  }
}

type Fixture = ReturnType<typeof fixture>
type AgentId = 'codex' | 'claude-code'

async function command(f: Fixture, argv: string[], env = f.env, stdin = '') {
  // GNU timeout bounds the command process group, including installer curl children.
  const child = Bun.spawn(
    ['/usr/bin/timeout', '--signal=TERM', '--kill-after=1s', '15s', ...argv],
    {
      cwd: f.sandbox.dir,
      env,
      stdin: Buffer.from(stdin),
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { code, signal: child.signalCode, stdout, stderr }
}

function success(result: Awaited<ReturnType<typeof command>>) {
  expect(result.code, JSON.stringify(result)).toBe(0)
  expect(result.signal).toBeNull()
  return result
}

async function setup(f: Fixture, env = f.env) {
  success(await command(f, ['/bin/bash', f.installer, 'install'], env))
  const selected = success(await command(f, ['/bin/bash', f.installer, 'resolve'], env))
  const binary = selected.stdout.trim()
  expect(success(await command(f, [binary, '--version'], env)).stdout.trim()).toBe(
    `clooks ${VERSION}`,
  )
  return { binary, warning: selected.stderr }
}

async function init(f: Fixture, binary: string, args: string[], env = f.env) {
  const result = success(await command(f, [binary, 'init', ...args, '--json'], env))
  expect(JSON.parse(result.stdout).ok).toBe(true)
}

function registration(f: Fixture, agent: AgentId, global = false) {
  return global
    ? join(f.sandbox.home, agent === 'codex' ? '.codex/hooks.json' : '.claude/settings.json')
    : join(f.sandbox.dir, agent === 'codex' ? '.codex/hooks.json' : '.claude/settings.json')
}

function registeredCommand(f: Fixture, agent: AgentId, global = false) {
  const config = JSON.parse(readFileSync(registration(f, agent, global), 'utf8'))
  const hooks = config.hooks.PreToolUse.flatMap(
    (group: { hooks: Array<{ command?: string }> }) => group.hooks,
  ).filter((hook: { command?: string }) => hook.command?.includes('.clooks/bin/entrypoint.sh'))
  expect(hooks).toHaveLength(1)
  return hooks[0].command as string
}

function probe(f: Fixture, global = false) {
  const name = 'onboarding-probe'
  const log = join(f.sandbox.dir, 'hook-calls.jsonl')
  const source = `import { appendFileSync } from 'node:fs'
export const hook = {
  meta: { name: '${name}' },
  PreToolUse(ctx) {
    appendFileSync(${JSON.stringify(log)}, JSON.stringify({ agent: ctx.agent, event: ctx.event }) + '\\n')
    return ctx.block({ reason: 'onboarding-fixture-deny' })
  },
}
`
  if (global) {
    f.sandbox.writeHomeHook(`${name}.ts`, source)
    f.sandbox.writeHomeConfig(`version: '1.0.0'\n${name}: {}\n`)
  } else {
    f.sandbox.writeHook(`${name}.ts`, source)
    f.sandbox.writeConfig(`version: '1.0.0'\n${name}: {}\n`)
  }
  return log
}

async function dispatch(f: Fixture, agent: AgentId, env = f.env, global = false) {
  const input = {
    hook_event_name: 'PreToolUse',
    session_id: 'onboarding-session',
    cwd: f.sandbox.dir,
    transcript_path: null,
    model: 'fixture',
    permission_mode: 'default',
    turn_id: 'onboarding-turn',
    tool_name: 'Bash',
    tool_use_id: 'onboarding-call',
    tool_input: { command: 'echo fixture' },
  }
  return command(
    f,
    ['/bin/bash', '-c', registeredCommand(f, agent, global)],
    env,
    JSON.stringify(input),
  )
}

function denied(result: Awaited<ReturnType<typeof command>>) {
  success(result)
  expect(JSON.parse(result.stdout).hookSpecificOutput).toEqual({
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: 'onboarding-fixture-deny',
  })
}

// Snapshot state, not timestamps: reading the package must not count as mutation.
function tree(root: string): unknown[] {
  return readdirSync(root)
    .sort()
    .flatMap((name): unknown[] => {
      const path = join(root, name)
      const stat = lstatSync(path)
      return stat.isDirectory()
        ? [[name, stat.mode & 0o777, tree(path)]]
        : [[name, stat.mode & 0o777, sha256(path)]]
    })
}

async function reminder(f: Fixture, agent: AgentId, env = f.env) {
  const path =
    agent === 'codex' ? resolve(f.plugin, f.codex.hooks) : join(f.plugin, 'hooks/hooks.json')
  const hooks = JSON.parse(readFileSync(path, 'utf8')).hooks
  expect(Object.keys(hooks)).toEqual(['SessionStart'])
  expect(hooks.SessionStart).toHaveLength(1)
  expect(hooks.SessionStart[0].hooks).toHaveLength(1)
  return command(
    f,
    ['/bin/bash', '-c', hooks.SessionStart[0].hooks[0].command],
    env,
    JSON.stringify({
      hook_event_name: 'SessionStart',
      cwd: f.sandbox.dir,
      session_id: 'onboarding-reminder',
    }),
  )
}

test('actual catalogs and isolated agent manifests address one cached package and installer', () => {
  const f = fixture()
  for (const catalogPath of [
    '.claude-plugin/marketplace.json',
    '.agents/plugins/marketplace.json',
  ]) {
    const catalog = JSON.parse(readFileSync(join(f.cache, catalogPath), 'utf8'))
    const entry = catalog.plugins.find((item: { name: string }) => item.name === 'clooks')
    expect(catalog.name).toBe('clooks-marketplace')
    expect(
      resolve(f.cache, typeof entry.source === 'string' ? entry.source : entry.source.path),
    ).toBe(f.plugin)
  }
  expect(f.codex.name).toBe(f.claude.name)
  expect(f.codex.version).toBe(VERSION)
  expect(f.claude.version).toBe(VERSION)
  expect(f.codex.skills).toBe('./codex-skills/')
  expect(f.codex.hooks).toBe('./codex-hooks/hooks.json')
  const policy = Bun.YAML.parse(
    readFileSync(join(f.plugin, 'codex-skills/setup/agents/openai.yaml'), 'utf8'),
  ) as { policy: { allow_implicit_invocation: boolean } }
  expect(policy.policy.allow_implicit_invocation).toBe(false)
  const claudeSkill = readFileSync(join(f.plugin, 'skills/setup/SKILL.md'), 'utf8')
  const frontmatter = Bun.YAML.parse(claudeSkill.split('---')[1]!) as {
    'disable-model-invocation': boolean
  }
  expect(frontmatter['disable-model-invocation']).toBe(true)
  expect(sha256(f.installer)).toBe(sha256(join(frozen, 'clooks/skills/setup/scripts/install.sh')))
})

test.each(['codex', 'claude-code'] as const)(
  'fresh actual-package setup -> %s init -> registered compiled hook',
  async (agent) => {
    const f = fixture()
    const other: AgentId = agent === 'codex' ? 'claude-code' : 'codex'
    const untouched = '{"onboardingSentinel":"other-agent","hooks":{}}\n'
    const otherPath = registration(f, other)
    mkdirSync(dirname(otherPath), { recursive: true })
    writeFileSync(otherPath, untouched)
    const targetPath = registration(f, agent)
    mkdirSync(dirname(targetPath), { recursive: true })
    const unrelated = { type: 'command', command: 'printf unrelated-onboarding-hook' }
    writeFileSync(
      targetPath,
      JSON.stringify({
        onboardingSentinel: 'same-agent',
        hooks: { PreToolUse: [{ matcher: 'OtherTool', hooks: [unrelated] }] },
      }),
    )
    const { binary, warning } = await setup(f)
    expect(binary).toBe(f.managed)
    expect(warning).toContain('unavailable on this process PATH')
    expect(sha256(binary)).toBe(compiledHash)
    expect(f.requests).toEqual([`${f.prefix}/checksums.txt`, `${f.prefix}/${asset}`])
    const env = { ...f.env, PATH: `${dirname(binary)}:${f.env.PATH}` }
    const args = agent === 'codex' ? ['--agent', 'codex'] : []
    await init(f, binary, args, env)
    const registered = readFileSync(registration(f, agent), 'utf8')
    const config = JSON.parse(registered)
    expect(config.onboardingSentinel).toBe('same-agent')
    expect(config.hooks.PreToolUse[0].hooks).toEqual([unrelated])
    await init(f, binary, args, env)
    expect(readFileSync(registration(f, agent), 'utf8')).toBe(registered)
    expect(readFileSync(otherPath, 'utf8')).toBe(untouched)
    expect(existsSync(registration(f, 'codex', true))).toBe(false)
    expect(existsSync(registration(f, 'claude-code', true))).toBe(false)
    const log = probe(f)
    denied(await dispatch(f, agent, env))
    expect(
      readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line)),
    ).toEqual([{ agent, event: 'PreToolUse' }])
    await setup(f, env)
    expect(f.requests).toHaveLength(2)
  },
  30_000,
)

test.each(['external', 'managed', 'both'] as const)(
  '%s executable reuse selects the real binary with no downloads or rc edits',
  async (location) => {
    const f = fixture()
    const external = join(dirname(f.sandbox.dir), 'external bin/clooks')
    if (location !== 'managed') f.seedBinary(external)
    if (location !== 'external') f.seedBinary(f.managed)
    f.sandbox.writeHomeFile('.bashrc', '# preserve user profile\n')
    const env = {
      ...f.env,
      PATH: location === 'managed' ? f.env.PATH : `${dirname(external)}:${f.env.PATH}`,
    }
    const before = tree(f.sandbox.home)
    const { binary } = await setup(f, env)
    expect(binary).toBe(location === 'managed' ? f.managed : external)
    expect(tree(f.sandbox.home)).toEqual(before)
    await init(f, binary, ['--agent', 'codex'], env)
    const log = probe(f)
    const ready = { ...env, PATH: `${dirname(binary)}:${env.PATH}` }
    denied(await dispatch(f, 'codex', ready))
    expect(JSON.parse(readFileSync(log, 'utf8').trim()).agent).toBe('codex')
    expect(f.requests).toEqual([])
  },
  30_000,
)

test('managed-only setup reports missing PATH; absolute init alone does not run hooks', async () => {
  const f = fixture()
  f.seedBinary(f.managed)
  const { binary, warning } = await setup(f)
  expect(warning).toContain('init alone does not establish hook readiness')
  await init(f, binary, ['--agent', 'codex'])
  const log = probe(f)
  const notice = JSON.parse(success(await reminder(f, 'codex')).stdout)
  expect(notice.systemMessage).toContain('installed at ~/.local/bin/clooks but unavailable')
  expect(notice.systemMessage).toContain('$clooks:setup check')
  expect(success(await dispatch(f, 'codex')).stdout).toBe('')
  expect(existsSync(log)).toBe(false)
  denied(await dispatch(f, 'codex', { ...f.env, PATH: `${dirname(binary)}:${f.env.PATH}` }))
  expect(JSON.parse(readFileSync(log, 'utf8').trim()).agent).toBe('codex')
  expect(f.requests).toEqual([])
}, 30_000)

test('explicit both/global init preserves other scope and repeat registration', async () => {
  const f = fixture()
  const binary = f.seedBinary(f.managed)
  const env = { ...f.env, PATH: `${dirname(binary)}:${f.env.PATH}` }
  await setup(f, env)
  await init(f, binary, ['--agent', 'all'], env)
  const project = (['codex', 'claude-code'] as const).map((agent) =>
    readFileSync(registration(f, agent), 'utf8'),
  )
  expect(existsSync(registration(f, 'codex', true))).toBe(false)
  expect(existsSync(registration(f, 'claude-code', true))).toBe(false)
  await init(f, binary, ['--global', '--agent', 'codex'], env)
  expect(existsSync(registration(f, 'claude-code', true))).toBe(false)
  await init(f, binary, ['--global', '--agent', 'all'], env)
  const global = (['codex', 'claude-code'] as const).map((agent) =>
    readFileSync(registration(f, agent, true), 'utf8'),
  )
  await init(f, binary, ['--global', '--agent', 'all'], env)
  const log = probe(f, true)
  for (const [index, agent] of (['codex', 'claude-code'] as const).entries()) {
    expect(readFileSync(registration(f, agent), 'utf8')).toBe(project[index]!)
    expect(readFileSync(registration(f, agent, true), 'utf8')).toBe(global[index]!)
    denied(await dispatch(f, agent, env, true))
  }
  expect(
    readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line).agent),
  ).toEqual(['codex', 'claude-code'])
  expect(f.requests).toEqual([])
}, 30_000)

test.each(['codex', 'claude-code'] as const)(
  '%s plugin registers only a read-only reminder, never setup',
  async (agent) => {
    const f = fixture()
    const before = [tree(f.sandbox.home), tree(f.sandbox.dir), tree(f.cache)]
    const output = JSON.parse(success(await reminder(f, agent)).stdout)
    expect(output.systemMessage).toContain(agent === 'codex' ? '$clooks:setup' : '/clooks:setup')
    expect(output.hookSpecificOutput.hookEventName).toBe('SessionStart')
    expect(output.hookSpecificOutput.additionalContext).toContain('do not run setup')
    expect([tree(f.sandbox.home), tree(f.sandbox.dir), tree(f.cache)]).toEqual(before)
    expect(f.requests).toEqual([])
  },
  30_000,
)

test('a corrupt fixture checksum cannot replace the installed compiled runtime', async () => {
  const f = fixture()
  f.seedBinary(f.managed)
  f.sandbox.writeHomeFile('.bashrc', '# unchanged on update\n')
  const before = tree(f.sandbox.home)
  f.corruptChecksum()
  const result = await command(f, ['/bin/bash', f.installer, 'update'])
  expect(result.code).toBe(1)
  expect(result.stderr).toContain('checksum mismatch')
  expect(f.requests).toEqual([`${f.prefix}/checksums.txt`, `${f.prefix}/${asset}`])
  expect(tree(f.sandbox.home)).toEqual(before)
  expect(sha256(f.managed)).toBe(compiledHash)
}, 30_000)
