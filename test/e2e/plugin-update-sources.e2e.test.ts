import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { createSandbox, formatDiagnostics, type RunResult, type Sandbox } from './helpers/sandbox'

let sandbox: Sandbox
const vendor = '.clooks/vendor/plugin/shared-pack'
const configPath = '.clooks/clooks.yml'
afterEach(() => sandbox?.cleanup())

function write(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}
function source(name: string, marker = name) {
  return `import { appendFileSync } from 'fs'
export const hook = {
  meta: { name: ${JSON.stringify(name)} },
  PreToolUse(ctx) {
    appendFileSync(${JSON.stringify(join(sandbox.dir, '.clooks/executed'))}, ${JSON.stringify(marker + '\n')})
    return ctx.block({ reason: ${JSON.stringify(marker + '-denied')} })
  },
  SessionStart() {
    appendFileSync(${JSON.stringify(join(sandbox.dir, '.clooks/executed'))}, ${JSON.stringify(marker + '\n')})
    return { result: 'skip', injectContext: ${JSON.stringify(marker + '-started')} }
  },
}`
}
function setup() {
  sandbox = createSandbox()
  sandbox.writeConfig('version: "1.0.0"\n')
  sandbox.writeFile('.clooks/executed', '')
}
type Scope = 'user' | 'project' | 'local'
function install(
  agent: 'claude-code' | 'codex',
  options: {
    key?: string
    scopes?: Scope[]
    enabled?: boolean
    code?: string
    optional?: boolean
  } = {},
) {
  const key = options.key ?? 'shared@market'
  const [plugin, market] = key.split('@') as [string, string]
  const scopes = options.scopes ?? ['project']
  const cache = join(
    sandbox.home,
    agent === 'codex' ? '.codex' : '.claude',
    'plugins/cache',
    market,
    plugin,
    '1.0.0',
  )
  const manifest = {
    version: 1,
    name: 'shared-pack',
    hooks: {
      guard: { path: 'hooks/guard.ts', description: 'Guard' },
      ...(options.optional
        ? { optional: { path: 'hooks/optional.ts', description: 'Optional', autoEnable: false } }
        : {}),
    },
  }
  write(join(cache, 'clooks-pack.json'), JSON.stringify(manifest))
  write(join(cache, 'hooks/guard.ts'), options.code ?? source('guard'))
  if (options.optional) write(join(cache, 'hooks/optional.ts'), source('optional'))
  if (agent === 'claude-code') {
    const registryPath = join(sandbox.home, '.claude/plugins/installed_plugins.json')
    let registry: { version: number; plugins: Record<string, unknown[]> }
    try {
      registry = JSON.parse(readFileSync(registryPath, 'utf8'))
    } catch {
      registry = { version: 2, plugins: {} }
    }
    registry.plugins[key] = [{ scope: 'user', installPath: cache }]
    write(registryPath, JSON.stringify(registry))
    for (const scope of scopes) {
      const root = scope === 'user' ? sandbox.home : sandbox.dir
      const path = join(
        root,
        '.claude',
        scope === 'local' ? 'settings.local.json' : 'settings.json',
      )
      let settings: { enabledPlugins?: Record<string, boolean> }
      try {
        settings = JSON.parse(readFileSync(path, 'utf8'))
      } catch {
        settings = {}
      }
      settings.enabledPlugins = { ...settings.enabledPlugins, [key]: options.enabled ?? true }
      write(path, JSON.stringify(settings))
    }
  } else {
    for (const scope of scopes) {
      const root = scope === 'user' ? sandbox.home : sandbox.dir
      const path = join(root, '.codex/config.toml')
      let previous = ''
      try {
        previous = readFileSync(path, 'utf8')
      } catch {
        /* New fixture file. */
      }
      write(
        path,
        previous + `\n[plugins.${JSON.stringify(key)}]\nenabled = ${options.enabled ?? true}\n`,
      )
    }
  }
  return cache
}
function env(agent?: string) {
  return {
    CODEX_HOME: join(sandbox.home, '.codex'),
    CLOOKS_PROJECT_ROOT: sandbox.dir,
    ...(agent === undefined ? {} : { CLOOKS_AGENT: agent }),
  }
}
function update(agent?: string, filter?: string) {
  return sandbox.run(
    ['--json', 'update', 'plugin:shared-pack', ...(filter ? ['--agent', filter] : [])],
    { env: env(agent), timeout: 10_000 },
  )
}
function event(agent: 'claude-code' | 'codex', session = false) {
  sandbox.writeFile('.clooks/executed', '')
  return sandbox.run([], {
    env: env(agent),
    timeout: 10_000,
    stdin: JSON.stringify({
      hook_event_name: session ? 'SessionStart' : 'PreToolUse',
      session_id: 'update-session',
      turn_id: 'update-turn',
      cwd: sandbox.dir,
      model: 'fixture',
      permission_mode: 'default',
      transcript_path: null,
      source: 'startup',
      tool_name: 'Bash',
      tool_use_id: 'update-tool',
      tool_input: { command: 'echo fixture' },
    }),
  })
}
function success(result: RunResult) {
  expect(result.exitCode, formatDiagnostics(result)).toBe(0)
  expect(result.signalCode, formatDiagnostics(result)).toBe(null)
  const output = JSON.parse(result.stdout)
  expect(output.ok, formatDiagnostics(result)).toBe(true)
  return output.data
}
function failure(result: RunResult, message: string) {
  expect(result.exitCode, formatDiagnostics(result)).toBe(1)
  expect(result.signalCode, formatDiagnostics(result)).toBe(null)
  const output = JSON.parse(result.stdout)
  expect(output.ok).toBe(false)
  expect(output.error).toContain(message)
  return output.error as string
}
function existing(root = sandbox.dir) {
  const bytes = source('guard', 'edited')
  write(join(root, vendor, 'guard.ts'), bytes)
  const config =
    'version: "1.0.0"\n# user comment\nguard:\n  uses: ./.clooks/vendor/plugin/shared-pack/guard.ts\n  enabled: false\n  timeout: 1234\n'
  write(join(root, configPath), config)
  return { bytes, config, root }
}
function unchanged(before: ReturnType<typeof existing>) {
  expect(readFileSync(join(before.root, vendor, 'guard.ts'), 'utf8')).toBe(before.bytes)
  expect(readFileSync(join(before.root, configPath), 'utf8')).toBe(before.config)
}
function denied(agent: 'claude-code' | 'codex', marker = 'guard') {
  const result = event(agent)
  expect(result.exitCode, formatDiagnostics(result)).toBe(0)
  const output = JSON.parse(result.stdout)
  expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
  expect(output.hookSpecificOutput.permissionDecisionReason).toBe(`${marker}-denied`)
  expect(sandbox.readFile('.clooks/executed')).toBe(`${marker}\n`)
}

describe('compiled agent-aware plugin updates', () => {
  test('restores an own-registered missing file while preserving a genuine custom collision', () => {
    setup()
    const cache = install('claude-code', { optional: true })
    const before = existing()
    rmSync(join(sandbox.dir, vendor, 'guard.ts'))
    const customBytes = source('optional', 'custom')
    sandbox.writeFile('custom.ts', customBytes)
    const config = before.config + '\noptional:\n  uses: ./custom.ts\n'
    sandbox.writeConfig(config)
    const result = success(update())
    expect(result).toEqual({
      updated: ['guard'],
      registered: [],
      skipped: ['optional'],
      errors: [],
    })
    expect(sandbox.readFile(`${vendor}/guard.ts`)).toBe(
      readFileSync(join(cache, 'hooks/guard.ts'), 'utf8'),
    )
    expect(sandbox.readFile(configPath)).toBe(config)
    expect(sandbox.readFile('custom.ts')).toBe(customBytes)
    expect(sandbox.fileExists(`${vendor}/optional.ts`)).toBe(false)
    denied('claude-code', 'custom')
    denied('codex', 'custom')
    expect(sandbox.readFile(configPath)).toBe(config)
    const enabled = Bun.YAML.parse(config) as Record<string, { enabled?: boolean }>
    enabled.guard!.enabled = true
    enabled.optional!.enabled = false
    sandbox.writeConfig(Bun.YAML.stringify(enabled))
    denied('claude-code', 'guard')
    denied('codex', 'guard')
  })

  test('invalid own-registration repair leaves YAML intact and no vendor file', () => {
    setup()
    install('codex', { code: 'export const invalid = true' })
    const before = existing()
    rmSync(join(sandbox.dir, vendor, 'guard.ts'))
    failure(update(), 'validation failed')
    expect(sandbox.fileExists(`${vendor}/guard.ts`)).toBe(false)
    expect(sandbox.readFile(configPath)).toBe(before.config)
  })

  for (const inherited of [undefined, 'claude-code', 'codex', 'not-a-runtime-agent']) {
    test(`default source discovery ignores inherited CLOOKS_AGENT=${inherited}`, () => {
      setup()
      const a = install('claude-code')
      install('codex')
      const before = existing()
      const result = success(update(inherited))
      expect(result).toEqual({ updated: ['guard'], registered: [], skipped: [], errors: [] })
      expect(sandbox.readFile(`${vendor}/guard.ts`)).toBe(
        readFileSync(join(a, 'hooks/guard.ts'), 'utf8'),
      )
      expect(sandbox.readFile(configPath)).toBe(before.config)
    })
    test(`default source conflicts remain visible with inherited CLOOKS_AGENT=${inherited}`, () => {
      setup()
      install('claude-code')
      install('codex', { code: source('guard', 'different') })
      const before = existing()
      const error = failure(update(inherited), 'Ambiguous')
      expect(error).toContain('claude-code:shared@market')
      expect(error).toContain('codex:shared@market')
      unchanged(before)
    })
  }

  for (const disagreement of ['bytes', 'manifest']) {
    test(`${disagreement} conflict leaves every destination unchanged`, () => {
      setup()
      install('claude-code', { scopes: ['user', 'project'] })
      const cache = install('codex', {
        code: disagreement === 'bytes' ? source('guard', 'other') : undefined,
      })
      if (disagreement === 'manifest') {
        const path = join(cache, 'clooks-pack.json')
        const manifest = JSON.parse(readFileSync(path, 'utf8'))
        manifest.hooks.guard.autoEnable = false
        write(path, JSON.stringify(manifest))
      }
      const project = existing()
      const home = existing(sandbox.home)
      const error = failure(update('codex'), 'Ambiguous')
      expect(error).toContain('claude-code:shared@market')
      expect(error).toContain('codex:shared@market')
      unchanged(project)
      unchanged(home)
    })
  }

  for (const selected of ['claude-code', 'codex']) {
    test(`explicit --agent ${selected} resolves cross-agent disagreement`, () => {
      setup()
      const claude = install('claude-code', { code: source('guard', 'claude-copy') })
      const codex = install('codex', { code: source('guard', 'codex-copy') })
      const before = existing()
      success(update(selected === 'codex' ? 'claude-code' : 'codex', selected))
      expect(sandbox.readFile(`${vendor}/guard.ts`)).toBe(
        readFileSync(join(selected === 'codex' ? codex : claude, 'hooks/guard.ts'), 'utf8'),
      )
      expect(sandbox.readFile(configPath)).toBe(before.config)
    })
  }

  test('unknown --agent fails without touching config or vendor files', () => {
    setup()
    install('codex')
    const before = existing()
    const result = update(undefined, 'unknown')
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Allowed choices')
    unchanged(before)
  })

  for (const agent of ['claude-code', 'codex'] as const) {
    test(`multiple marketplaces in ${agent} remain ambiguous after filtering`, () => {
      setup()
      install(agent, { key: 'shared@a' })
      install(agent, { key: 'shared@b', code: source('guard', 'different') })
      const before = existing()
      const error = failure(update(undefined, agent), 'Ambiguous')
      expect(error).toContain(`${agent}:shared@a`)
      expect(error).toContain(`${agent}:shared@b`)
      expect(error).toContain('--agent cannot distinguish')
      unchanged(before)
    })
  }

  test('missing final source blocks updates to earlier user and project destinations', () => {
    setup()
    install('claude-code', { scopes: ['user', 'project'] })
    const cache = install('codex')
    rmSync(join(cache, 'hooks/guard.ts'))
    const project = existing()
    const home = existing(sandbox.home)
    failure(update(), 'source preflight failed')
    unchanged(project)
    unchanged(home)
  })

  test('vendor symlink alias conflict is rejected before either physical destination changes', () => {
    setup()
    install('claude-code', { scopes: ['user'] })
    install('codex', { code: source('guard', 'other') })
    const before = existing(sandbox.home)
    sandbox.writeFile(configPath, before.config)
    mkdirSync(join(sandbox.dir, '.clooks/vendor/plugin'), { recursive: true })
    symlinkSync(join(sandbox.home, vendor), join(sandbox.dir, vendor))
    failure(update(), 'Ambiguous')
    unchanged(before)
    expect(sandbox.readFile(`${vendor}/guard.ts`)).toBe(before.bytes)
    expect(sandbox.readFile(configPath)).toBe(before.config)
  })

  test('equivalent project/local sources append disabled new hooks at both config destinations', () => {
    setup()
    install('claude-code', { scopes: ['project', 'local'], optional: true })
    const codex = install('codex', { optional: true })
    const path = join(codex, 'clooks-pack.json')
    const original = JSON.parse(readFileSync(path, 'utf8'))
    write(
      path,
      JSON.stringify({
        hooks: { optional: original.hooks.optional, guard: original.hooks.guard },
        name: original.name,
        version: original.version,
      }),
    )
    const result = success(update())
    expect(result.updated).toEqual([])
    expect(result.registered.sort()).toEqual(['guard', 'guard', 'optional', 'optional'])
    expect(result.errors).toEqual([])
    for (const file of ['clooks.yml', 'clooks.local.yml']) {
      const config = Bun.YAML.parse(sandbox.readFile(`.clooks/${file}`)) as Record<
        string,
        { enabled?: boolean }
      >
      expect(config.optional!.enabled).toBe(false)
    }
    denied('claude-code')
    denied('codex')
    const before = [sandbox.readFile(configPath), sandbox.readFile('.clooks/clooks.local.yml')]
    expect(success(update()).updated.sort()).toEqual(['guard', 'optional'])
    expect([sandbox.readFile(configPath), sandbox.readFile('.clooks/clooks.local.yml')]).toEqual(
      before,
    )
  })

  test('alternating agents never duplicate execution; edits and disabled defaults survive discovery/removal', () => {
    setup()
    const claude = install('claude-code', { optional: true })
    const codex = install('codex', { optional: true })
    for (const agent of ['codex', 'claude-code', 'codex', 'claude-code'] as const) denied(agent)
    const config = sandbox.readFile(configPath)
    const edit = source('guard', 'edited')
    sandbox.writeFile(`${vendor}/guard.ts`, edit)
    sandbox.writeFile(configPath, config + '\n# user preserved\n')
    denied('claude-code', 'edited')
    denied('codex', 'edited')
    expect(sandbox.readFile(`${vendor}/guard.ts`)).toBe(edit)
    const updatedCode = source('guard', 'updated')
    for (const cache of [claude, codex]) write(join(cache, 'hooks/guard.ts'), updatedCode)
    const before = sandbox.readFile(configPath)
    success(update())
    expect(sandbox.readFile(configPath)).toBe(before)
    expect(
      (Bun.YAML.parse(before) as Record<string, { enabled?: boolean }>).optional!.enabled,
    ).toBe(false)
    denied('claude-code', 'updated')
    denied('codex', 'updated')
    sandbox.writeFile('.claude/settings.json', '{}')
    sandbox.writeFile('.codex/config.toml', '')
    sandbox.writeHomeFile('.claude/plugins/installed_plugins.json', '{"version":2,"plugins":{}}')
    rmSync(claude, { recursive: true })
    rmSync(codex, { recursive: true })
    denied('claude-code', 'updated')
    denied('codex', 'updated')
    expect(sandbox.readFile(configPath)).toBe(before)
    expect(sandbox.readFile(`${vendor}/guard.ts`)).toBe(updatedCode)
    const start = event('claude-code', true)
    expect(start.exitCode).toBe(0)
    expect(JSON.parse(start.stdout).hookSpecificOutput.additionalContext).toBe('updated-started')
    expect(start.stdout).not.toContain('not enabled')
  })
})

describe('compiled Claude ownership advisories with Codex packs', () => {
  for (const scenario of ['no vendor', 'unknown vendor', 'enabled Claude']) {
    test(`malformed Codex config produces no Claude stderr with ${scenario}`, () => {
      setup()
      sandbox.writeHomeFile('.codex/config.toml', '[plugins]\nbroken = false\n')
      if (scenario !== 'no vendor') {
        sandbox.writeFile(`${vendor}/guard.ts`, source('guard'))
        sandbox.writeConfig(
          'version: "1.0.0"\nguard:\n  uses: ./.clooks/vendor/plugin/shared-pack/guard.ts\n',
        )
      }
      if (scenario === 'enabled Claude') install('claude-code')
      const result = event('claude-code', true)
      expect(result.exitCode, formatDiagnostics(result)).toBe(0)
      expect(result.stderr, formatDiagnostics(result)).toBe('')
      if (scenario === 'no vendor') {
        expect(result.stdout).toBe('')
        expect(sandbox.readFile('.clooks/executed')).toBe('')
      } else {
        expect(JSON.parse(result.stdout).hookSpecificOutput.additionalContext).toBe('guard-started')
        expect(sandbox.readFile('.clooks/executed')).toBe('guard\n')
      }
      expect(result.stdout).not.toContain('not enabled')
    })
  }

  test('known disabled Claude source warns unless Codex enables the same destination', () => {
    setup()
    install('claude-code', { enabled: false })
    sandbox.writeFile(`${vendor}/guard.ts`, source('guard'))
    sandbox.writeConfig(
      'version: "1.0.0"\nguard:\n  uses: ./.clooks/vendor/plugin/shared-pack/guard.ts\n',
    )
    const baseline = event('claude-code', true)
    expect(baseline.exitCode).toBe(0)
    expect(JSON.parse(baseline.stdout).hookSpecificOutput.additionalContext).toBe('guard-started')
    expect(baseline.stdout).toContain('not enabled')
    install('codex')
    const suppressed = event('claude-code', true)
    expect(suppressed.exitCode).toBe(0)
    expect(JSON.parse(suppressed.stdout).hookSpecificOutput.additionalContext).toBe('guard-started')
    expect(suppressed.stdout).not.toContain('not enabled')
    expect(sandbox.readFile('.clooks/executed')).toBe('guard\n')
    sandbox.writeFile('.codex/config.toml', '[plugins."shared@market"]\nenabled = false')
    expect(event('claude-code', true).stdout).toContain('not enabled')
    sandbox.writeFile('.codex/config.toml', '')
    sandbox.writeHomeFile('.codex/config.toml', '[plugins."shared@market"]\nenabled = true')
    const otherDestination = event('claude-code', true)
    expect(otherDestination.exitCode).toBe(0)
    expect(JSON.parse(otherDestination.stdout).hookSpecificOutput.additionalContext).toBe(
      'guard-started',
    )
    expect(otherDestination.stdout).toContain('not enabled')
    mkdirSync(join(sandbox.home, '.clooks/vendor/plugin'), { recursive: true })
    symlinkSync(join(sandbox.dir, vendor), join(sandbox.home, vendor))
    const aliasedDestination = event('claude-code', true)
    expect(aliasedDestination.exitCode).toBe(0)
    expect(JSON.parse(aliasedDestination.stdout).hookSpecificOutput.additionalContext).toBe(
      'guard-started',
    )
    expect(aliasedDestination.stdout).not.toContain('not enabled')
    expect(sandbox.readFile('.clooks/executed')).toBe('guard\n')
  })
})
