import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { createSandbox, type Sandbox } from './helpers/sandbox'

const FIXTURES = join(import.meta.dir, '../fixtures')
const loadEvent = (name: string) => readFileSync(join(FIXTURES, 'events', name), 'utf8')

let sandbox: Sandbox | null = null

beforeEach(() => {
  sandbox = null
})

afterEach(() => {
  sandbox?.cleanup()
  sandbox = null
})

// ---------------------------------------------------------------------------
// Helper: set up a mock plugin cache + install record + optional enabledPlugins
// at one or more Claude settings layers.
//
// Install record's `scope` field (installRecordScope) is intentionally metadata
// only after M2. The `enable` option drives what clooks actually registers.
// ---------------------------------------------------------------------------

type Layer = 'user' | 'project' | 'local' | 'managed'

function setupPluginWithEnable(
  sandbox: Sandbox,
  opts: {
    pluginKey: string
    packName: string
    installRecordScope: 'user' | 'project' | 'local'
    installRecordProjectPath?: string
    enable: Partial<Record<Layer, boolean>>
    hooks: Record<string, { path: string; code: string; description: string }>
    orphaned?: boolean
  },
): string {
  const home = sandbox.home

  // 1. Cache dir under fake home.
  const cacheDir = join(
    home,
    '.claude',
    'plugins',
    'cache',
    'test-marketplace',
    opts.packName,
    '1.0.0',
  )
  mkdirSync(cacheDir, { recursive: true })

  // 2. Hook source files.
  for (const [, hookDef] of Object.entries(opts.hooks)) {
    const hookPath = join(cacheDir, hookDef.path)
    mkdirSync(join(hookPath, '..'), { recursive: true })
    writeFileSync(hookPath, hookDef.code)
  }

  // 3. clooks-pack.json manifest.
  const manifest = {
    version: 1,
    name: opts.packName,
    hooks: Object.fromEntries(
      Object.entries(opts.hooks).map(([name, def]) => [
        name,
        { path: def.path, description: def.description },
      ]),
    ),
  }
  writeFileSync(join(cacheDir, 'clooks-pack.json'), JSON.stringify(manifest))

  // 4. Optional .orphaned_at marker.
  if (opts.orphaned) {
    writeFileSync(join(cacheDir, '.orphaned_at'), '2026-01-01T00:00:00.000Z')
  }

  // 5. installed_plugins.json (merge with existing).
  const installedPluginsDir = join(home, '.claude', 'plugins')
  const installedPluginsPath = join(installedPluginsDir, 'installed_plugins.json')
  mkdirSync(installedPluginsDir, { recursive: true })
  let plugins: Record<string, unknown[]> = {}
  try {
    const existing = JSON.parse(readFileSync(installedPluginsPath, 'utf-8'))
    plugins = existing.plugins || {}
  } catch {
    // Fresh file.
  }
  if (!plugins[opts.pluginKey]) plugins[opts.pluginKey] = []
  const entry: Record<string, unknown> = {
    scope: opts.installRecordScope,
    installPath: cacheDir,
    version: '1.0.0',
    installedAt: '2026-01-01T00:00:00.000Z',
    lastUpdated: '2026-01-01T00:00:00.000Z',
  }
  if (opts.installRecordProjectPath) {
    entry.projectPath = opts.installRecordProjectPath
  }
  ;(plugins[opts.pluginKey] as unknown[]).push(entry)
  writeFileSync(installedPluginsPath, JSON.stringify({ version: 2, plugins }))

  // 6. Claude settings files for requested layers.
  // Managed layer is NOT plumbed into the sandbox: clooks skips managed entirely
  // per plan Decision Log entry 10. E2E-M2-8 asserts the equivalent — enabling
  // at no active layer yields no registration. Managed parity is covered by
  // plugin-discovery.test.ts's "managed-scope enable → no emission" unit test.
  for (const [layer, value] of Object.entries(opts.enable) as Array<[Layer, boolean]>) {
    if (layer === 'managed') continue
    writeEnabledPluginsAtLayer(sandbox, layer, opts.pluginKey, value)
  }

  return cacheDir
}

function writeEnabledPluginsAtLayer(
  sandbox: Sandbox,
  layer: 'user' | 'project' | 'local',
  pluginKey: string,
  value: boolean,
): void {
  // user and project both write to .claude/settings.json — the distinction is
  // handled by the caller choosing between sandbox.readHomeFile/writeHomeFile
  // (user, under $HOME) and sandbox.readFile/writeFile (project, under cwd).
  const relPath = layer === 'local' ? '.claude/settings.local.json' : '.claude/settings.json'

  let existing: { enabledPlugins?: Record<string, boolean> } = {}
  try {
    const raw = layer === 'user' ? sandbox.readHomeFile(relPath) : sandbox.readFile(relPath)
    existing = JSON.parse(raw)
  } catch {
    // Fresh file.
  }
  const enabled = existing.enabledPlugins ?? {}
  enabled[pluginKey] = value
  const content = JSON.stringify({ ...existing, enabledPlugins: enabled })
  if (layer === 'user') {
    sandbox.writeHomeFile(relPath, content)
  } else {
    sandbox.writeFile(relPath, content)
  }
}

const HOOK_CODE = (name: string, marker: string) => `
export const hook = {
  meta: { name: "${name}" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "${marker}" }
  },
}
`

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

describe('plugin-enabled-activation', () => {
  test('E2E-M2-1. user-only enable registers at user scope', () => {
    sandbox = createSandbox()
    sandbox.writeHomeConfig('version: "1.0.0"\n')

    setupPluginWithEnable(sandbox, {
      pluginKey: 'uonly@mp',
      packName: 'uonly-pack',
      installRecordScope: 'project', // metadata-only — should not drive routing
      enable: { user: true },
      hooks: {
        'uonly-hook': {
          path: 'hooks/uonly-hook.ts',
          description: 'User-only hook',
          code: HOOK_CODE('uonly-hook', 'uonly-user-ran'),
        },
      },
    })

    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)

    // Home (user) config has the entry.
    const homeConfig = sandbox.readHomeFile('.clooks/clooks.yml')
    expect(homeConfig).toContain('uonly-hook:')
    expect(homeConfig).toContain('uses: ./.clooks/vendor/plugin/uonly-pack/uonly-hook.ts')

    // Project config must NOT have it.
    expect(sandbox.fileExists('.clooks/clooks.yml')).toBe(false)

    // Hook runs.
    const out = JSON.parse(result.stdout)
    expect(out.hookSpecificOutput?.additionalContext ?? '').toContain('uonly-user-ran')
  })

  test('E2E-M2-2. project-only enable registers at project scope', () => {
    sandbox = createSandbox()
    sandbox.writeConfig('version: "1.0.0"\n')

    setupPluginWithEnable(sandbox, {
      pluginKey: 'ponly@mp',
      packName: 'ponly-pack',
      installRecordScope: 'user',
      enable: { project: true },
      hooks: {
        'ponly-hook': {
          path: 'hooks/ponly-hook.ts',
          description: 'Project-only hook',
          code: HOOK_CODE('ponly-hook', 'ponly-project-ran'),
        },
      },
    })

    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)

    const projectConfig = sandbox.readFile('.clooks/clooks.yml')
    expect(projectConfig).toContain('ponly-hook:')
    expect(projectConfig).toContain('uses: ./.clooks/vendor/plugin/ponly-pack/ponly-hook.ts')

    expect(sandbox.homeFileExists('.clooks/clooks.yml')).toBe(false)

    const out = JSON.parse(result.stdout)
    expect(out.hookSpecificOutput?.additionalContext ?? '').toContain('ponly-project-ran')
  })

  test('E2E-M2-3. local-only enable registers at local scope', () => {
    sandbox = createSandbox()
    sandbox.writeConfig('version: "1.0.0"\n')

    setupPluginWithEnable(sandbox, {
      pluginKey: 'lonly@mp',
      packName: 'lonly-pack',
      installRecordScope: 'project',
      enable: { local: true },
      hooks: {
        'lonly-hook': {
          path: 'hooks/lonly-hook.ts',
          description: 'Local-only hook',
          code: HOOK_CODE('lonly-hook', 'lonly-local-ran'),
        },
      },
    })

    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)

    // Registered in clooks.local.yml (not clooks.yml). Assert the local file
    // actually exists before reading it — otherwise a helper that returns ''
    // for missing files could mask a routing regression.
    expect(sandbox.fileExists('.clooks/clooks.local.yml')).toBe(true)
    const localConfig = sandbox.readFile('.clooks/clooks.local.yml')
    expect(localConfig).toContain('lonly-hook:')
    expect(localConfig).toContain('uses: ./.clooks/vendor/plugin/lonly-pack/lonly-hook.ts')

    // clooks.yml was pre-seeded with only `version: "1.0.0"\n`, so this
    // negative check guards against broken routing registering the hook at
    // project scope instead of local.
    const projectConfig = sandbox.readFile('.clooks/clooks.yml')
    expect(projectConfig).not.toContain('lonly-hook:')

    const out = JSON.parse(result.stdout)
    expect(out.hookSpecificOutput?.additionalContext ?? '').toContain('lonly-local-ran')
  })

  test('E2E-M2-4. layer independence: user true + project false yields user-scope registration only', () => {
    sandbox = createSandbox()
    sandbox.writeHomeConfig('version: "1.0.0"\n')
    sandbox.writeConfig('version: "1.0.0"\n')

    setupPluginWithEnable(sandbox, {
      pluginKey: 'indep@mp',
      packName: 'indep-pack',
      installRecordScope: 'user',
      enable: { user: true, project: false },
      hooks: {
        'indep-hook': {
          path: 'hooks/indep-hook.ts',
          description: 'Layer-independence hook',
          code: HOOK_CODE('indep-hook', 'indep-ran'),
        },
      },
    })

    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)

    const homeConfig = sandbox.readHomeFile('.clooks/clooks.yml')
    expect(homeConfig).toContain('indep-hook:')

    const projectConfig = sandbox.readFile('.clooks/clooks.yml')
    expect(projectConfig).not.toContain('indep-hook:')

    // Hook still runs — user-layer registration wins; Claude's `false` at project
    // does not shadow clooks registration (that requires clooks.local.yml).
    const out = JSON.parse(result.stdout)
    expect(out.hookSpecificOutput?.additionalContext ?? '').toContain('indep-ran')
  })

  test('E2E-M2-5. install-without-enable is a no-op (no registration, no systemMessage)', () => {
    sandbox = createSandbox()
    sandbox.writeHomeConfig('version: "1.0.0"\n')

    setupPluginWithEnable(sandbox, {
      pluginKey: 'noenable@mp',
      packName: 'noenable-pack',
      installRecordScope: 'user',
      enable: {}, // nothing enabled
      hooks: {
        'noenable-hook': {
          path: 'hooks/noenable-hook.ts',
          description: 'Installed but not enabled',
          code: HOOK_CODE('noenable-hook', 'noenable-ran'),
        },
      },
    })

    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)

    // No vendor file written.
    expect(sandbox.homeFileExists('.clooks/vendor/plugin/noenable-pack/noenable-hook.ts')).toBe(
      false,
    )
    expect(sandbox.fileExists('.clooks/vendor/plugin/noenable-pack/noenable-hook.ts')).toBe(false)

    // No hook entry in either config.
    const homeConfig = sandbox.readHomeFile('.clooks/clooks.yml')
    expect(homeConfig).not.toContain('noenable-hook:')

    // Either no stdout or no Registered message for this pack.
    const sysMsg = result.stdout.length > 0 ? (JSON.parse(result.stdout).systemMessage ?? '') : ''
    expect(sysMsg).not.toContain('noenable-pack')

    // And the hook did not run. Tolerate empty stdout (legitimate when no hooks
    // match), but when stdout is present assert unconditionally on the parsed
    // value — a crash producing empty stdout must not silently pass.
    const ctx =
      result.stdout.length > 0
        ? (JSON.parse(result.stdout).hookSpecificOutput?.additionalContext ?? '')
        : ''
    expect(ctx).not.toContain('noenable-ran')
  })

  test('E2E-M2-6. install record projectPath mismatch is ignored; user enable still registers', () => {
    sandbox = createSandbox()
    sandbox.writeHomeConfig('version: "1.0.0"\n')

    setupPluginWithEnable(sandbox, {
      pluginKey: 'mm@mp',
      packName: 'mm-pack',
      installRecordScope: 'project',
      installRecordProjectPath: '/some/other/project',
      enable: { user: true },
      hooks: {
        'mm-hook': {
          path: 'hooks/mm-hook.ts',
          description: 'projectPath mismatch regression guard',
          code: HOOK_CODE('mm-hook', 'mm-ran'),
        },
      },
    })

    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)

    const homeConfig = sandbox.readHomeFile('.clooks/clooks.yml')
    expect(homeConfig).toContain('mm-hook:')
    expect(sandbox.homeFileExists('.clooks/vendor/plugin/mm-pack/mm-hook.ts')).toBe(true)

    const out = JSON.parse(result.stdout)
    expect(out.hookSpecificOutput?.additionalContext ?? '').toContain('mm-ran')
  })

  test('E2E-M2-7. orphaned install + enabled → no registration', () => {
    sandbox = createSandbox()
    sandbox.writeHomeConfig('version: "1.0.0"\n')

    setupPluginWithEnable(sandbox, {
      pluginKey: 'orphan@mp',
      packName: 'orphan-pack',
      installRecordScope: 'user',
      enable: { user: true },
      orphaned: true,
      hooks: {
        'orphan-hook': {
          path: 'hooks/orphan-hook.ts',
          description: 'Orphaned install hook',
          code: HOOK_CODE('orphan-hook', 'orphan-ran'),
        },
      },
    })

    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)

    expect(sandbox.homeFileExists('.clooks/vendor/plugin/orphan-pack/orphan-hook.ts')).toBe(false)
    const homeConfig = sandbox.readHomeFile('.clooks/clooks.yml')
    expect(homeConfig).not.toContain('orphan-hook:')

    // Tolerate empty stdout (legitimate when no hooks match), but assert
    // unconditionally otherwise — a crash producing empty stdout must not
    // silently pass as "no orphan-ran marker present."
    const ctx =
      result.stdout.length > 0
        ? (JSON.parse(result.stdout).hookSpecificOutput?.additionalContext ?? '')
        : ''
    expect(ctx).not.toContain('orphan-ran')
  })

  // E2E-M2-8. Managed-scope enable is skipped.
  //
  // Rationale for skipping managed path plumbing in the E2E sandbox: clooks skips
  // managed entirely at the discovery level (plan Decision Log entry 10). There
  // is no CLOOKS_MANAGED_SETTINGS_PATH env var in the production code, and
  // wiring one up solely for this test would add a production seam that the
  // feature does not require.
  //
  // Unit-level parity is provided by src/plugin-discovery.test.ts
  // ("managed-scope enable → no emission"), which directly exercises
  // activationsByLayer with a managed-layer settings file.
  //
  // The E2E we CAN assert here is the equivalent observable behavior: when no
  // user/project/local layer enables the plugin, there is no registration. This
  // matches what managed-only enablement would look like from the engine's
  // perspective after managed is filtered out.
  test('E2E-M2-8. plugin enabled at no usable layer (managed analogue) → no registration', () => {
    sandbox = createSandbox()
    sandbox.writeHomeConfig('version: "1.0.0"\n')

    setupPluginWithEnable(sandbox, {
      pluginKey: 'mgd@mp',
      packName: 'mgd-pack',
      installRecordScope: 'user',
      enable: {}, // nothing at user/project/local. Managed would be filtered out identically.
      hooks: {
        'mgd-hook': {
          path: 'hooks/mgd-hook.ts',
          description: 'Managed-scope parity analogue',
          code: HOOK_CODE('mgd-hook', 'mgd-ran'),
        },
      },
    })

    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)

    expect(sandbox.homeFileExists('.clooks/vendor/plugin/mgd-pack/mgd-hook.ts')).toBe(false)
    const homeConfig = sandbox.readHomeFile('.clooks/clooks.yml')
    expect(homeConfig).not.toContain('mgd-hook:')
  })

  test('E2E-M3-1. co-enable at user + project emits parallel vendoring and dedupes at runtime', () => {
    sandbox = createSandbox()
    sandbox.writeHomeConfig('version: "1.0.0"\n')
    sandbox.writeConfig('version: "1.0.0"\n')

    setupPluginWithEnable(sandbox, {
      pluginKey: 'coe@mp',
      packName: 'coe-pack',
      installRecordScope: 'user',
      enable: { user: true, project: true },
      hooks: {
        'coe-hook': {
          path: 'hooks/coe-hook.ts',
          description: 'Co-enable parallel-vendor hook',
          code: HOOK_CODE('coe-hook', 'coe-ran'),
        },
      },
    })

    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)

    // Hook vendor file exists at BOTH destinations.
    expect(sandbox.homeFileExists('.clooks/vendor/plugin/coe-pack/coe-hook.ts')).toBe(true)
    expect(sandbox.fileExists('.clooks/vendor/plugin/coe-pack/coe-hook.ts')).toBe(true)

    // Both clooks.yml files carry the entry.
    const homeConfig = sandbox.readHomeFile('.clooks/clooks.yml')
    expect(homeConfig).toContain('coe-hook:')
    expect(homeConfig).toContain('uses: ./.clooks/vendor/plugin/coe-pack/coe-hook.ts')

    const projectConfig = sandbox.readFile('.clooks/clooks.yml')
    expect(projectConfig).toContain('coe-hook:')
    expect(projectConfig).toContain('uses: ./.clooks/vendor/plugin/coe-pack/coe-hook.ts')

    // Hook runs exactly once — the three-layer merge atomically replaces the
    // home entry with the project entry when names collide.
    const out = JSON.parse(result.stdout)
    const ctx = out.hookSpecificOutput?.additionalContext ?? ''
    expect(ctx).toContain('coe-ran')
    const occurrences = ctx.split('coe-ran').length - 1
    expect(occurrences).toBe(1)
  })

  test('E2E-M3-2. user-scope enable survives switch to a second project directory', () => {
    sandbox = createSandbox()
    sandbox.writeHomeConfig('version: "1.0.0"\n')

    setupPluginWithEnable(sandbox, {
      pluginKey: 'xproj@mp',
      packName: 'xproj-pack',
      installRecordScope: 'user',
      enable: { user: true },
      hooks: {
        'xproj-hook': {
          path: 'hooks/xproj-hook.ts',
          description: 'User-scope survives project switch',
          code: HOOK_CODE('xproj-hook', 'xproj-ran'),
        },
      },
    })

    // First invocation from the default sandbox project registers the hook at
    // ~/.clooks/clooks.yml (user scope).
    const first = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(first.exitCode).toBe(0)

    const homeConfigAfterFirst = sandbox.readHomeFile('.clooks/clooks.yml')
    expect(homeConfigAfterFirst).toContain('xproj-hook:')
    expect(homeConfigAfterFirst).toContain('uses: ./.clooks/vendor/plugin/xproj-pack/xproj-hook.ts')

    // Create a fresh "second project" directory adjacent to the first one.
    // Same HOME → user-scope clooks.yml carries over.
    const secondProject = join(sandbox.dir, '..', 'project2')
    mkdirSync(secondProject, { recursive: true })

    const second = sandbox.run([], {
      cwd: secondProject,
      stdin: loadEvent('pre-tool-use-bash.json'),
    })
    expect(second.exitCode).toBe(0)

    // Hook fires in the second project → proves user-scope registration
    // survives and was not silently written only to the first project's .clooks/.
    const out = JSON.parse(second.stdout)
    expect(out.hookSpecificOutput?.additionalContext ?? '').toContain('xproj-ran')

    // Idempotence: the second invocation must NOT re-register the hook.
    // User yml should contain exactly one occurrence of the hook name.
    const homeConfigAfterSecond = sandbox.readHomeFile('.clooks/clooks.yml')
    const hookOccurrences = (homeConfigAfterSecond.match(/xproj-hook:/g) ?? []).length
    expect(hookOccurrences).toBe(1)

    // Second project must remain untouched — user-scope registration is
    // strictly a HOME-side write, never a project-scope .clooks/ dir.
    expect(existsSync(join(secondProject, '.clooks'))).toBe(false)
  })

  test('E2E-M3-3. .clooks/clooks.local.yml shadow disables a user-enabled hook', () => {
    sandbox = createSandbox()
    sandbox.writeHomeConfig('version: "1.0.0"\n')

    setupPluginWithEnable(sandbox, {
      pluginKey: 'shadow@mp',
      packName: 'shadow-pack',
      installRecordScope: 'user',
      enable: { user: true },
      hooks: {
        'shadow-hook': {
          path: 'hooks/shadow-hook.ts',
          description: 'Local shadow disables user-enabled hook',
          code: HOOK_CODE('shadow-hook', 'shadow-ran'),
        },
      },
    })

    // First invocation registers the hook at user scope.
    const firstRun = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(firstRun.exitCode).toBe(0)
    const homeConfig = sandbox.readHomeFile('.clooks/clooks.yml')
    expect(homeConfig).toContain('shadow-hook:')

    // Positive assertion: the hook actually fires BEFORE the shadow is written.
    // Guards against a broken hook implementation that silently produces no
    // output (which would make the later negative assertion vacuously pass).
    const firstCtx =
      firstRun.stdout.length > 0
        ? (JSON.parse(firstRun.stdout).hookSpecificOutput?.additionalContext ?? '')
        : ''
    expect(firstCtx).toContain('shadow-ran')

    // Write a local shadow that disables the hook. We must preserve the
    // `uses:` field: clooks' layer merge performs ATOMIC replacement for local
    // hooks, so omitting `uses:` would drop it from the home-layer entry and
    // the hook would become dangling (silently dropped) rather than being
    // semantically disabled by the `enabled: false` check. Keeping `uses:`
    // ensures this test truly exercises the `enabled: false` contract.
    sandbox.writeLocalConfig(
      'version: "1.0.0"\n\nshadow-hook:\n  uses: ./.clooks/vendor/plugin/shadow-pack/shadow-hook.ts\n  enabled: false\n',
    )

    // Second invocation: the local shadow must suppress the hook.
    const secondRun = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(secondRun.exitCode).toBe(0)

    // Hook must NOT fire.
    const ctx =
      secondRun.stdout.length > 0
        ? (JSON.parse(secondRun.stdout).hookSpecificOutput?.additionalContext ?? '')
        : ''
    expect(ctx).not.toContain('shadow-ran')
  })

  // -------------------------------------------------------------------------
  // Milestone 4 — SessionStart stale-plugin advisories
  //
  // Helper: seed a plugin-vendored hook entry in the chosen scope's yml plus
  // the corresponding vendor file. This simulates the "leftover" state left
  // behind when a plugin is disabled/uninstalled but its registration in
  // clooks.yml lingers (by design — clooks never mutates user yml on its own).
  // -------------------------------------------------------------------------
  function seedVendoredEntry(
    sandbox: Sandbox,
    scopeYmlLocation: 'home' | 'project' | 'local',
    packName: string,
    hookName: string,
  ): void {
    const vendorRel = `.clooks/vendor/plugin/${packName}/${hookName}.ts`
    const usesPath = `./.clooks/vendor/plugin/${packName}/${hookName}.ts`
    const hookCode = HOOK_CODE(hookName, `${hookName}-ran`)
    const ymlEntry = `\n${hookName}:\n  uses: ${usesPath}\n`

    if (scopeYmlLocation === 'home') {
      sandbox.writeHomeFile(vendorRel, hookCode)
      let current = 'version: "1.0.0"\n'
      try {
        current = sandbox.readHomeFile('.clooks/clooks.yml')
      } catch {
        // Fresh file.
      }
      sandbox.writeHomeFile('.clooks/clooks.yml', current + ymlEntry)
    } else if (scopeYmlLocation === 'project') {
      sandbox.writeFile(vendorRel, hookCode)
      let current = 'version: "1.0.0"\n'
      try {
        current = sandbox.readFile('.clooks/clooks.yml')
      } catch {
        // Fresh file.
      }
      sandbox.writeFile('.clooks/clooks.yml', current + ymlEntry)
    } else {
      sandbox.writeFile(vendorRel, hookCode)
      let current = 'version: "1.0.0"\n'
      try {
        current = sandbox.readFile('.clooks/clooks.local.yml')
      } catch {
        // Fresh file.
      }
      sandbox.writeFile('.clooks/clooks.local.yml', current + ymlEntry)
    }
  }

  test('E2E-M4-1. Stale-registration advisory on SessionStart', () => {
    sandbox = createSandbox()
    sandbox.writeHomeConfig('version: "1.0.0"\n')

    // Seed an install record for the pack so packName → pluginKey resolves.
    // The install record exists but the plugin is NOT enabled at user scope
    // (enable map is empty) — this is the stale-registration drift case.
    setupPluginWithEnable(sandbox, {
      pluginKey: 'm4stale@mp',
      packName: 'm4stale',
      installRecordScope: 'user',
      enable: {},
      hooks: {
        'm4stale-hook': {
          path: 'hooks/m4stale-hook.ts',
          description: 'Stale-registration fixture',
          code: HOOK_CODE('m4stale-hook', 'm4stale-ran'),
        },
      },
    })

    // Seed the lingering home-yml entry + vendor file (as if previously vendored).
    seedVendoredEntry(sandbox, 'home', 'm4stale', 'm4stale-hook')

    const result = sandbox.run([], { stdin: loadEvent('session-start.json') })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.length).toBeGreaterThan(0)
    const out = JSON.parse(result.stdout)
    const sysMsg: string = out.systemMessage ?? ''
    expect(sysMsg).toContain('m4stale-hook')
    expect(sysMsg).toContain('registered in')
    expect(sysMsg).toContain('enabled: false')
    // Guard the actionable snippet's override-path rendering.
    expect(sysMsg).toContain('clooks.local.yml')
  })

  test('E2E-M4-2. Enable-without-install advisory on SessionStart', () => {
    sandbox = createSandbox()
    sandbox.writeHomeConfig('version: "1.0.0"\n')

    setupPluginWithEnable(sandbox, {
      pluginKey: 'ghost@mp',
      packName: 'ghost',
      installRecordScope: 'user',
      enable: { user: true },
      orphaned: true,
      hooks: {
        'ghost-hook': {
          path: 'hooks/ghost-hook.ts',
          description: 'Drift B fixture',
          code: HOOK_CODE('ghost-hook', 'ghost-ran'),
        },
      },
    })

    const result = sandbox.run([], { stdin: loadEvent('session-start.json') })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.length).toBeGreaterThan(0)
    const out = JSON.parse(result.stdout)
    const sysMsg: string = out.systemMessage ?? ''
    expect(sysMsg).toContain('ghost@mp')
    expect(sysMsg).toContain('no install record exists on disk')
    expect(sysMsg).toContain('/plugin install ghost@mp')
  })

  test('E2E-M4-2b. Non-clooks plugin enabled without install does NOT produce advisory', () => {
    sandbox = createSandbox()
    sandbox.writeHomeConfig('version: "1.0.0"\n')

    sandbox.writeHomeFile(
      '.claude/plugins/installed_plugins.json',
      JSON.stringify({
        version: 2,
        plugins: {
          'stale-skill@mp': [
            {
              scope: 'user',
              installPath: join(sandbox.home, '.claude/plugins/cache/mp/stale-skill/gone'),
              version: 'unknown',
            },
          ],
        },
      }),
    )
    sandbox.writeHomeFile(
      '.claude/settings.json',
      JSON.stringify({
        enabledPlugins: {
          'stale-skill@mp': true,
          'never-installed@mp': true,
        },
      }),
    )

    const result = sandbox.run([], { stdin: loadEvent('session-start.json') })
    expect(result.exitCode).toBe(0)
    const sysMsg: string =
      result.stdout.length > 0 ? (JSON.parse(result.stdout).systemMessage ?? '') : ''
    expect(sysMsg).not.toContain('stale-skill@mp')
    expect(sysMsg).not.toContain('never-installed@mp')
    expect(sysMsg).not.toContain('no install record exists on disk')
  })

  test('E2E-M4-3. Advisories do NOT appear on non-SessionStart events', () => {
    sandbox = createSandbox()
    sandbox.writeHomeConfig('version: "1.0.0"\n')

    // Drift state: seed a stale registration so the ADVISORY would be emitted
    // if advisories were emitted on non-SessionStart events.
    setupPluginWithEnable(sandbox, {
      pluginKey: 'm4nonss@mp',
      packName: 'm4nonss',
      installRecordScope: 'user',
      enable: {},
      hooks: {
        'm4nonss-hook': {
          path: 'hooks/m4nonss-hook.ts',
          description: 'Stale-registration fixture (non-SessionStart)',
          code: HOOK_CODE('m4nonss-hook', 'm4nonss-ran'),
        },
      },
    })
    seedVendoredEntry(sandbox, 'home', 'm4nonss', 'm4nonss-hook')

    // Sentinel: a separate plugin that IS properly enabled — it registers
    // cleanly and its PreToolUse hook fires, producing guaranteed non-empty
    // stdout so the negative advisory assertions below cannot vacuously pass
    // on a silent skip (e.g. binary crash, empty stdout).
    setupPluginWithEnable(sandbox, {
      pluginKey: 'm4nonss-sentinel@mp',
      packName: 'm4nonss-sentinel',
      installRecordScope: 'user',
      enable: { user: true },
      hooks: {
        'm4nonss-sentinel-hook': {
          path: 'hooks/m4nonss-sentinel-hook.ts',
          description: 'Always-firing sentinel for silent-skip hardening',
          code: HOOK_CODE('m4nonss-sentinel-hook', 'm4nonss-sentinel-ran'),
        },
      },
    })

    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.length).toBeGreaterThan(0)
    const out = JSON.parse(result.stdout)
    // Sentinel fired — proves the engine ran the full PreToolUse path, so the
    // absence of advisory text below is a meaningful signal rather than a
    // silent skip.
    const ctx = out.hookSpecificOutput?.additionalContext ?? ''
    expect(ctx).toContain('m4nonss-sentinel-ran')
    const sysMsg: string = out.systemMessage ?? ''
    expect(sysMsg).not.toContain('m4nonss-hook')
    expect(sysMsg).not.toContain('registered in')
  })

  test('E2E-M4-4. Silencer env var suppresses advisories', () => {
    sandbox = createSandbox()
    sandbox.writeHomeConfig('version: "1.0.0"\n')

    setupPluginWithEnable(sandbox, {
      pluginKey: 'ghost@mp',
      packName: 'ghost',
      installRecordScope: 'user',
      enable: { user: true },
      orphaned: true,
      hooks: {
        'ghost-hook': {
          path: 'hooks/ghost-hook.ts',
          description: 'Silencer fixture',
          code: HOOK_CODE('ghost-hook', 'ghost-ran'),
        },
      },
    })

    const result = sandbox.run([], {
      stdin: loadEvent('session-start.json'),
      env: { CLOOKS_SILENCE_STALE_PLUGIN_ADVISORIES: 'true' },
    })
    expect(result.exitCode).toBe(0)
    const sysMsg: string =
      result.stdout.length > 0 ? (JSON.parse(result.stdout).systemMessage ?? '') : ''
    expect(sysMsg).not.toContain('ghost@mp')
    expect(sysMsg).not.toContain('no install record')
  })

  test('E2E-M4-5. Both drift kinds coexist on SessionStart', () => {
    sandbox = createSandbox()
    sandbox.writeHomeConfig('version: "1.0.0"\n')

    // Drift A (stale-registration): install record exists, not enabled.
    setupPluginWithEnable(sandbox, {
      pluginKey: 'm4both@mp',
      packName: 'm4both',
      installRecordScope: 'user',
      enable: {},
      hooks: {
        'm4both-hook': {
          path: 'hooks/m4both-hook.ts',
          description: 'Stale-registration fixture',
          code: HOOK_CODE('m4both-hook', 'm4both-ran'),
        },
      },
    })
    seedVendoredEntry(sandbox, 'home', 'm4both', 'm4both-hook')

    setupPluginWithEnable(sandbox, {
      pluginKey: 'ghost@mp',
      packName: 'ghost',
      installRecordScope: 'user',
      enable: { user: true },
      orphaned: true,
      hooks: {
        'ghost-hook': {
          path: 'hooks/ghost-hook.ts',
          description: 'Drift B fixture',
          code: HOOK_CODE('ghost-hook', 'ghost-ran'),
        },
      },
    })

    const result = sandbox.run([], { stdin: loadEvent('session-start.json') })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.length).toBeGreaterThan(0)
    const sysMsg: string = JSON.parse(result.stdout).systemMessage ?? ''
    // Stale-registration advisory
    expect(sysMsg).toContain('m4both-hook')
    expect(sysMsg).toContain('registered in')
    // Enable-without-install advisory
    expect(sysMsg).toContain('ghost@mp')
    expect(sysMsg).toContain('no install record exists on disk')
  })

  test('E2E-M4-6. Clean state produces no advisory on SessionStart', () => {
    sandbox = createSandbox()
    sandbox.writeHomeConfig('version: "1.0.0"\n')

    // Properly enabled: install record exists, user layer enables it, yml entry
    // will be auto-registered by the vendoring step.
    setupPluginWithEnable(sandbox, {
      pluginKey: 'm4clean@mp',
      packName: 'm4clean',
      installRecordScope: 'user',
      enable: { user: true },
      hooks: {
        'm4clean-hook': {
          path: 'hooks/m4clean-hook.ts',
          description: 'Clean state fixture',
          code: HOOK_CODE('m4clean-hook', 'm4clean-ran'),
        },
      },
    })

    const result = sandbox.run([], { stdin: loadEvent('session-start.json') })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.length).toBeGreaterThan(0)
    const out = JSON.parse(result.stdout)
    const sysMsg: string = out.systemMessage ?? ''
    // Positive guard: the engine must have reached the plugin-registration
    // path (which is emitted downstream of any advisory short-circuit). The
    // HOOK_CODE template only exports PreToolUse, so we cannot observe a
    // hook-fire marker on SessionStart; the "Registered N hook(s)" line is
    // the stable positive signal that the engine ran the full path rather
    // than silently skipping.
    expect(sysMsg).toContain('Registered')
    expect(sysMsg).toContain('m4clean')
    // Negative assertions — no advisory text leaks through in clean state.
    expect(sysMsg).not.toContain('registered in')
    expect(sysMsg).not.toContain('no install record exists on disk')
  })
})
