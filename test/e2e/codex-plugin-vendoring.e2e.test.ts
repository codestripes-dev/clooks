import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'crypto'
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { createSandbox, formatDiagnostics, type RunResult, type Sandbox } from './helpers/sandbox'

let sandbox: Sandbox
const vendor = '.clooks/vendor/plugin/test-pack'
const receipt = '.clooks/pack-receipt'
const imports = '.clooks/pack-imports'
afterEach(() => sandbox?.cleanup())

function write(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}
function wire(overrides: Record<string, unknown> = {}) {
  return {
    hook_event_name: 'PreToolUse',
    session_id: 'pack-session',
    turn_id: 'pack-turn',
    cwd: sandbox.dir,
    transcript_path: null,
    model: 'fixture',
    permission_mode: 'default',
    tool_name: 'Bash',
    tool_use_id: 'pack-call',
    tool_input: { command: 'echo fixture' },
    ...overrides,
  }
}
function run(payload = wire(), extra: Record<string, string> = {}) {
  return sandbox.run([], {
    stdin: JSON.stringify(payload),
    timeout: 10_000,
    env: { CLOOKS_AGENT: 'codex', CODEX_HOME: join(sandbox.home, '.codex'), ...extra },
  })
}
function ok(result: RunResult) {
  expect(result.exitCode, formatDiagnostics(result)).toBe(0)
  expect(result.signalCode, formatDiagnostics(result)).toBe(null)
}
function source(name: string, crash = false, metaName = name) {
  return `
import { appendFileSync } from 'fs'
appendFileSync(${JSON.stringify(join(sandbox.dir, imports))}, ${JSON.stringify(name + '\n')})
export const hook = {
  meta: { name: ${JSON.stringify(metaName)} },
  PreToolUse(ctx) {
    appendFileSync(${JSON.stringify(join(sandbox.dir, receipt))}, ${JSON.stringify(name + '\n')})
    ${crash ? 'throw new Error("pack-crash")' : `return ctx.block({ reason: ${JSON.stringify(name + '-denied')} })`}
  },
  SessionStart(ctx) {
    appendFileSync(${JSON.stringify(join(sandbox.dir, receipt))}, ${JSON.stringify(name + '\n')})
    ${crash ? 'throw new Error("pack-crash")' : `return { result: 'skip', injectContext: ${JSON.stringify(name + '-started')} }`}
  },
}
`
}
type Hook = { code?: string; autoEnable?: boolean }
function seed(
  options: {
    scope?: 'user' | 'project'
    codexHome?: string
    version?: string
    enabled?: boolean
    hooks?: Record<string, Hook>
    configRoot?: string
  } = {},
) {
  const codexHome = options.codexHome ?? join(sandbox.home, '.codex')
  const cache = join(codexHome, 'plugins/cache/market/test', options.version ?? '1.0.0')
  const hooks = options.hooks ?? { guard: {} }
  const manifest = {
    version: 1,
    name: 'test-pack',
    hooks: Object.fromEntries(
      Object.entries(hooks).map(([name, def]) => [
        name,
        {
          path: `hooks/${name}.ts`,
          description: name,
          ...(def.autoEnable === undefined ? {} : { autoEnable: def.autoEnable }),
        },
      ]),
    ),
  }
  for (const [name, def] of Object.entries(hooks))
    write(join(cache, 'hooks', `${name}.ts`), def.code ?? source(name))
  write(join(cache, 'clooks-pack.json'), JSON.stringify(manifest))
  const scope =
    options.configRoot ?? (options.scope === 'project' ? join(sandbox.dir, '.codex') : codexHome)
  write(
    join(scope, 'config.toml'),
    `[plugins."test@market"]\nenabled = ${options.enabled ?? true}\n`,
  )
  return cache
}
function setup(homeOnly = false) {
  sandbox = createSandbox()
  if (homeOnly) sandbox.writeHomeConfig('version: "1.0.0"\n')
  else sandbox.writeConfig('version: "1.0.0"\n')
  sandbox.writeFile(imports, '')
  sandbox.writeFile(receipt, '')
}
function clearReceipts() {
  sandbox.writeFile(imports, '')
  sandbox.writeFile(receipt, '')
}
function noExecution() {
  expect(sandbox.readFile(imports)).toBe('')
  expect(sandbox.readFile(receipt)).toBe('')
}

describe('Codex compiled file-backed pack discovery', () => {
  for (const scope of ['user', 'project'] as const) {
    test(`${scope} first discovery executes, repeats byte-idempotently, and preserves source/local edits`, () => {
      setup()
      const cache = seed({ scope })
      const root = scope === 'user' ? sandbox.home : sandbox.dir
      const opposite = scope === 'user' ? sandbox.dir : sandbox.home
      const first = run()
      ok(first)
      expect(JSON.parse(first.stdout).hookSpecificOutput.permissionDecision).toBe('deny')
      expect(JSON.parse(first.stdout).hookSpecificOutput.permissionDecisionReason).toBe(
        'guard-denied',
      )
      expect(first.stdout).toContain('Registered 1 hook(s)')
      expect(sandbox.readFile(receipt)).toBe('guard\n')
      const hookPath = join(root, vendor, 'guard.ts')
      const configPath = join(root, '.clooks/clooks.yml')
      const initialHook = readFileSync(hookPath, 'utf8')
      const initialConfig = readFileSync(configPath, 'utf8')
      expect(sandbox.fileExists(join(opposite, vendor, 'guard.ts'))).toBe(false)
      clearReceipts()
      const repeat = run()
      ok(repeat)
      expect(JSON.parse(repeat.stdout).hookSpecificOutput.permissionDecision).toBe('deny')
      expect(JSON.parse(repeat.stdout).hookSpecificOutput.permissionDecisionReason).toBe(
        'guard-denied',
      )
      expect(repeat.stdout).not.toContain('Registered')
      expect(sandbox.readFile(receipt)).toBe('guard\n')
      expect(readFileSync(hookPath, 'utf8')).toBe(initialHook)
      expect(readFileSync(configPath, 'utf8')).toBe(initialConfig)
      write(join(cache, 'hooks/guard.ts'), source('source-changed'))
      const edited = initialHook.replace('guard-denied', 'local-edit-denied')
      write(hookPath, edited)
      clearReceipts()
      const changed = run()
      ok(changed)
      expect(JSON.parse(changed.stdout).hookSpecificOutput.permissionDecision).toBe('deny')
      expect(JSON.parse(changed.stdout).hookSpecificOutput.permissionDecisionReason).toBe(
        'local-edit-denied',
      )
      expect(readFileSync(hookPath, 'utf8')).toBe(edited)
      expect(readFileSync(configPath, 'utf8')).toBe(initialConfig)
      expect(sandbox.readFile(receipt)).toBe('guard\n')
    })
  }

  test('first project discovery from home-only config refreshes failure storage and no-project advisory', () => {
    setup(true)
    const hookBytes = source('guard', true)
    seed({ scope: 'project', hooks: { guard: { code: hookBytes } } })
    const result = run(wire({ hook_event_name: 'SessionStart', source: 'startup' }))
    ok(result)
    expect(JSON.parse(result.stdout).continue).toBe(false)
    expect(JSON.parse(result.stdout).systemMessage).toContain('capability "engine-error"')
    expect(JSON.parse(result.stdout).stopReason).toContain('guard')
    expect(JSON.parse(result.stdout).stopReason).toContain('pack-crash')
    expect(result.stdout).toContain('pack-crash')
    expect(result.stderr).not.toContain('no .clooks/clooks.yml found')
    expect(sandbox.readFile(receipt)).toBe('guard\n')
    expect(sandbox.fileExists('.clooks/clooks.yml')).toBe(true)
    expect(sandbox.readFile('.clooks/clooks.yml')).toContain(
      'uses: ./.clooks/vendor/plugin/test-pack/guard.ts',
    )
    expect(sandbox.readFile(`${vendor}/guard.ts`)).toBe(hookBytes)
    expect(sandbox.readHomeFile('.clooks/clooks.yml')).toBe('version: "1.0.0"\n')
    const failures = JSON.parse(sandbox.readFile('.clooks/.cache/agents/codex/failures.json'))
    expect(failures.guard.SessionStart.consecutiveFailures).toBe(1)
    const hash = createHash('sha256').update(sandbox.dir).digest('hex').slice(0, 12)
    expect(sandbox.homeFileExists(`.clooks/failures/codex/${hash}.json`)).toBe(false)
  })

  test('successful SessionStart project discovery reloads home-only config in the same invocation', () => {
    setup(true)
    seed({ scope: 'project' })
    const result = run(wire({ hook_event_name: 'SessionStart', source: 'startup' }))
    ok(result)
    const output = JSON.parse(result.stdout)
    expect(output.systemMessage).toContain('Registered 1 hook(s)')
    expect(output.hookSpecificOutput.additionalContext).toBe('guard-started')
    expect(sandbox.readFile(receipt)).toBe('guard\n')
    expect(result.stderr).not.toContain('no .clooks/clooks.yml found')
    expect(sandbox.fileExists(`${vendor}/guard.ts`)).toBe(true)
    expect(sandbox.readHomeFile('.clooks/clooks.yml')).toBe('version: "1.0.0"\n')
  })

  test('no Clooks config does not initialize, vendor, or import packs', () => {
    setup()
    rmSync(join(sandbox.dir, '.clooks/clooks.yml'))
    seed({ scope: 'project' })
    const result = run()
    ok(result)
    expect(result.stdout).toBe('')
    noExecution()
    expect(sandbox.fileExists(`${vendor}/guard.ts`)).toBe(false)
    expect(sandbox.fileExists('.clooks/clooks.yml')).toBe(false)
    expect(sandbox.homeFileExists('.clooks/clooks.yml')).toBe(false)
  })

  test('malformed Codex envelope exits before pack discovery and module imports', () => {
    setup()
    seed({ scope: 'project' })
    const before = sandbox.readFile('.clooks/clooks.yml')
    const rejected = run(wire({ tool_input: null }))
    ok(rejected)
    expect(JSON.parse(rejected.stdout).hookSpecificOutput.permissionDecision).toBe('deny')
    expect(rejected.stdout).toContain('hooks were not imported or executed')
    noExecution()
    expect(sandbox.fileExists(`${vendor}/guard.ts`)).toBe(false)
    expect(sandbox.readFile('.clooks/clooks.yml')).toBe(before)
    const valid = run()
    ok(valid)
    expect(sandbox.readFile(receipt)).toBe('guard\n')
  })

  test('invalid Clooks config preserves its pre-load failure location before discovery', () => {
    setup(true)
    seed({ scope: 'project' })
    sandbox.writeHomeConfig('version: "1.0.0"\nonError: invalid\n')
    const result = run()
    ok(result)
    expect(result.stdout).toContain('config validation failed')
    noExecution()
    expect(sandbox.fileExists('.clooks/clooks.yml')).toBe(false)
    const hash = createHash('sha256').update(sandbox.dir).digest('hex').slice(0, 12)
    expect(sandbox.homeFileExists(`.clooks/failures/codex/${hash}.json`)).toBe(true)
    expect(sandbox.fileExists('.clooks/.cache/agents/codex/failures.json')).toBe(false)
  })

  test('disabled-by-default hooks register disabled and existing hook overrides survive', () => {
    setup()
    seed({ scope: 'project', hooks: { guard: {}, optional: { autoEnable: false } } })
    ok(run())
    expect(sandbox.readFile(receipt)).toBe('guard\n')
    expect(sandbox.readFile('.clooks/clooks.yml')).toContain(
      'optional:\n  uses: ./.clooks/vendor/plugin/test-pack/optional.ts\n  enabled: false',
    )
    sandbox.writeLocalConfig('guard:\n  enabled: false\n')
    const config = sandbox.readFile('.clooks/clooks.yml')
    clearReceipts()
    ok(run())
    expect(sandbox.readFile(receipt)).toBe('')
    expect(sandbox.readFile('.clooks/clooks.yml')).toBe(config)
    expect(sandbox.readFile('.clooks/clooks.local.yml')).toBe('guard:\n  enabled: false\n')
  })

  test('native disable and removal retain vendored execution and user config', () => {
    setup()
    const cache = seed({ scope: 'project' })
    ok(run())
    expect(sandbox.readFile(receipt)).toBe('guard\n')
    const config = sandbox.readFile('.clooks/clooks.yml')
    const bytes = sandbox.readFile(`${vendor}/guard.ts`)
    sandbox.writeFile('.codex/config.toml', '[plugins."test@market"]\nenabled = false')
    clearReceipts()
    ok(run())
    expect(sandbox.readFile(receipt)).toBe('guard\n')
    rmSync(cache, { recursive: true })
    clearReceipts()
    ok(run())
    expect(sandbox.readFile(receipt)).toBe('guard\n')
    expect(sandbox.readFile('.clooks/clooks.yml')).toBe(config)
    expect(sandbox.readFile(`${vendor}/guard.ts`)).toBe(bytes)
  })

  test('project false suppresses new user discovery without changing home config', () => {
    setup()
    seed()
    sandbox.writeHomeConfig('version: "1.0.0"\n')
    sandbox.writeFile('.codex/config.toml', '[plugins."test@market"]\nenabled = false')
    ok(run())
    noExecution()
    expect(sandbox.homeFileExists(`${vendor}/guard.ts`)).toBe(false)
    expect(sandbox.readHomeFile('.clooks/clooks.yml')).toBe('version: "1.0.0"\n')
    sandbox.writeFile('.codex/config.toml', '')
    ok(run())
    expect(sandbox.readFile(receipt)).toBe('guard\n')
    expect(sandbox.homeFileExists(`${vendor}/guard.ts`)).toBe(true)
  })

  test('malformed participating config suppresses the batch with a path warning', () => {
    setup()
    seed()
    sandbox.writeFile('.codex/config.toml', '[plugins."other@market"]\nenabled = "false"')
    const result = run()
    ok(result)
    expect(result.stderr).toContain(join(sandbox.dir, '.codex/config.toml'))
    expect(result.stderr).toContain('discovery suppressed')
    noExecution()
    expect(sandbox.homeFileExists(`${vendor}/guard.ts`)).toBe(false)
    sandbox.writeFile('.codex/config.toml', '')
    ok(run())
    expect(sandbox.readFile(receipt)).toBe('guard\n')
  })

  test('unreadable project config cannot expose broader user activation', () => {
    setup()
    seed()
    sandbox.writeFile('.codex/config.toml', '[plugins."test@market"]\nenabled = false')
    const path = join(sandbox.dir, '.codex/config.toml')
    chmodSync(path, 0)
    try {
      const result = run()
      ok(result)
      expect(result.stderr).toContain(path)
      noExecution()
      expect(sandbox.homeFileExists(`${vendor}/guard.ts`)).toBe(false)
    } finally {
      chmodSync(path, 0o600)
    }
    sandbox.writeFile('.codex/config.toml', '')
    ok(run())
    expect(sandbox.readFile(receipt)).toBe('guard\n')
  })

  test('collision preserves an existing custom hook without importing the pack copy', () => {
    setup()
    const customBytes = source('custom', false, 'guard')
    sandbox.writeHook('guard.ts', customBytes)
    sandbox.writeConfig('version: "1.0.0"\nguard: {}\n')
    const before = sandbox.readFile('.clooks/clooks.yml')
    const baseline = run()
    ok(baseline)
    expect(JSON.parse(baseline.stdout).hookSpecificOutput.permissionDecision).toBe('deny')
    expect(JSON.parse(baseline.stdout).hookSpecificOutput.permissionDecisionReason).toBe(
      'custom-denied',
    )
    expect(sandbox.readFile(receipt)).toBe('custom\n')
    expect(sandbox.readFile(imports)).toBe('custom\n')
    clearReceipts()
    seed({ scope: 'project' })
    const result = run()
    ok(result)
    expect(result.stdout).toContain('conflicts with existing hook')
    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('deny')
    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason).toBe(
      'custom-denied',
    )
    expect(sandbox.readFile(receipt)).toBe('custom\n')
    expect(sandbox.readFile(imports)).toBe('custom\n')
    expect(sandbox.fileExists(`${vendor}/guard.ts`)).toBe(false)
    expect(sandbox.readFile('.clooks/clooks.yml')).toBe(before)
    expect(sandbox.readFile('.clooks/hooks/guard.ts')).toBe(customBytes)
  })

  test('invalid hook export is removed and never registered or executed', () => {
    setup()
    seed({ scope: 'project', hooks: { bad: { code: 'export const notAHook = true' }, guard: {} } })
    const result = run()
    ok(result)
    expect(result.stdout).toContain('bad: validation failed')
    expect(sandbox.fileExists(`${vendor}/bad.ts`)).toBe(false)
    expect(sandbox.readFile('.clooks/clooks.yml')).not.toContain('bad:')
    expect(sandbox.readFile(receipt)).toBe('guard\n')
  })

  test('invalid active manifest never falls back to an older valid pack', () => {
    setup()
    seed({ scope: 'project' })
    const active = seed({ scope: 'project', version: '2.0.0' })
    write(join(active, 'clooks-pack.json'), '{}')
    const result = run()
    ok(result)
    expect(result.stderr).toContain(active)
    noExecution()
    expect(sandbox.fileExists(`${vendor}/guard.ts`)).toBe(false)
    rmSync(active, { recursive: true })
    ok(run())
    expect(sandbox.readFile(receipt)).toBe('guard\n')
  })

  test('custom CODEX_HOME selects only that cache and leaves the default cache untouched', () => {
    setup()
    seed({ hooks: { defaultguard: {} } })
    const custom = join(sandbox.home, 'custom codex')
    seed({ codexHome: custom, hooks: { guard: {} } })
    const result = run(wire(), { CODEX_HOME: custom })
    ok(result)
    expect(sandbox.readFile(receipt)).toBe('guard\n')
    expect(sandbox.homeFileExists(`${vendor}/defaultguard.ts`)).toBe(false)
    expect(sandbox.homeFileExists(`${vendor}/guard.ts`)).toBe(true)
  })

  test('anchored nested project inherits nearest marker layers, not payload cwd', () => {
    setup()
    sandbox.writeFile('.git', 'gitdir: unused')
    seed({ scope: 'project' })
    const anchor = join(sandbox.dir, 'nested')
    write(join(anchor, '.clooks/clooks.yml'), 'version: "1.0.0"\n')
    write(join(anchor, 'tool/.codex/config.toml'), '[plugins."test@market"]\nenabled = false')
    const result = run(wire({ cwd: join(anchor, 'tool') }), { CLOOKS_PROJECT_ROOT: anchor })
    ok(result)
    expect(sandbox.readFile(receipt)).toBe('guard\n')
    expect(sandbox.fileExists(`nested/${vendor}/guard.ts`)).toBe(true)
    expect(sandbox.fileExists(`${vendor}/guard.ts`)).toBe(false)
  })

  test('unset/explicit Claude agent never discovers Codex packs, then Codex does', () => {
    setup()
    seed({ scope: 'project' })
    sandbox.writeHook('sentinel.ts', source('sentinel'))
    sandbox.writeConfig('version: "1.0.0"\nsentinel: {}\n')
    for (const agent of [undefined, 'claude-code']) {
      clearReceipts()
      const result = sandbox.run([], {
        stdin: JSON.stringify(wire()),
        timeout: 10_000,
        env: {
          CODEX_HOME: join(sandbox.home, '.codex'),
          ...(agent ? { CLOOKS_AGENT: agent } : {}),
        },
      })
      ok(result)
      expect(sandbox.readFile(receipt)).toBe('sentinel\n')
      expect(sandbox.fileExists(`${vendor}/guard.ts`)).toBe(false)
    }
    sandbox.writeConfig('version: "1.0.0"\n')
    clearReceipts()
    ok(run())
    expect(sandbox.readFile(receipt)).toBe('guard\n')
  })
})
