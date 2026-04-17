import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { discoverPluginPacks } from './plugin-discovery.js'
import type { SettingsLayerPaths } from './claude-settings.js'

const validManifest = {
  version: 1,
  name: 'test-pack',
  hooks: {
    'test-hook': {
      path: 'hooks/test-hook.ts',
      description: 'A test hook',
    },
  },
}

type Scope = 'user' | 'project' | 'local' | 'managed'

function createInstalledPluginsJson(tempDir: string, plugins: Record<string, unknown[]>): string {
  const filePath = join(tempDir, 'installed_plugins.json')
  writeFileSync(filePath, JSON.stringify({ version: 2, plugins }))
  return filePath
}

function createPluginDir(tempDir: string, name: string): string {
  const pluginDir = join(tempDir, 'cache', name)
  mkdirSync(pluginDir, { recursive: true })
  return pluginDir
}

// Writes a synthetic Claude settings file for the given layer and returns its absolute path.
function writeSettings(
  tempDir: string,
  scope: Scope,
  enabledPlugins: Record<string, boolean>,
): string {
  const path = join(tempDir, `${scope}-settings.json`)
  writeFileSync(path, JSON.stringify({ enabledPlugins }))
  return path
}

function settingsPathsWith(
  tempDir: string,
  overrides: Partial<Record<Scope, string>>,
): SettingsLayerPaths {
  return {
    managed: overrides.managed,
    user: overrides.user ?? join(tempDir, 'nonexistent-user.json'),
    project: overrides.project,
    local: overrides.local,
  }
}

describe('discoverPluginPacks', () => {
  let tempDir: string
  let warnSpy: ReturnType<typeof spyOn> | null = null

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'clooks-plugin-discovery-test-'))
  })

  afterEach(() => {
    if (warnSpy) {
      warnSpy.mockRestore()
      warnSpy = null
    }
    rmSync(tempDir, { recursive: true, force: true })
  })

  // ---- Happy paths ----

  test('user-only enable produces scope "user"', () => {
    const pluginDir = createPluginDir(tempDir, 'test-pack')
    writeFileSync(join(pluginDir, 'clooks-pack.json'), JSON.stringify(validManifest))

    const installedPluginsPath = createInstalledPluginsJson(tempDir, {
      'test-pack@test-marketplace': [
        {
          scope: 'user',
          installPath: pluginDir,
        },
      ],
    })
    const userPath = writeSettings(tempDir, 'user', { 'test-pack@test-marketplace': true })

    const result = discoverPluginPacks({
      installedPluginsPath,
      settingsPaths: settingsPathsWith(tempDir, { user: userPath }),
    })
    expect(result).toHaveLength(1)
    expect(result[0]!.pluginName).toBe('test-pack@test-marketplace')
    expect(result[0]!.scope).toBe('user')
    expect(result[0]!.installPath).toBe(pluginDir)
    expect(result[0]!.manifest.name).toBe('test-pack')
  })

  test('project-only enable produces scope "project"', () => {
    const pluginDir = createPluginDir(tempDir, 'proj-pack')
    writeFileSync(
      join(pluginDir, 'clooks-pack.json'),
      JSON.stringify({ ...validManifest, name: 'proj-pack' }),
    )

    const installedPluginsPath = createInstalledPluginsJson(tempDir, {
      'proj-pack@mp': [{ scope: 'user', installPath: pluginDir }],
    })
    const projectPath = writeSettings(tempDir, 'project', { 'proj-pack@mp': true })

    const result = discoverPluginPacks({
      installedPluginsPath,
      settingsPaths: settingsPathsWith(tempDir, { project: projectPath }),
    })
    expect(result).toHaveLength(1)
    expect(result[0]!.pluginName).toBe('proj-pack@mp')
    expect(result[0]!.scope).toBe('project')
  })

  test('local-only enable produces scope "local"', () => {
    const pluginDir = createPluginDir(tempDir, 'local-pack')
    writeFileSync(
      join(pluginDir, 'clooks-pack.json'),
      JSON.stringify({ ...validManifest, name: 'local-pack' }),
    )

    const installedPluginsPath = createInstalledPluginsJson(tempDir, {
      'local-pack@mp': [{ scope: 'project', installPath: pluginDir }],
    })
    const localPath = writeSettings(tempDir, 'local', { 'local-pack@mp': true })

    const result = discoverPluginPacks({
      installedPluginsPath,
      settingsPaths: settingsPathsWith(tempDir, { local: localPath }),
    })
    expect(result).toHaveLength(1)
    expect(result[0]!.scope).toBe('local')
  })

  // ---- Layer independence ----

  test('user true + project false still emits at user scope (no effect from project false)', () => {
    const pluginDir = createPluginDir(tempDir, 'indep-pack')
    writeFileSync(join(pluginDir, 'clooks-pack.json'), JSON.stringify(validManifest))

    const installedPluginsPath = createInstalledPluginsJson(tempDir, {
      'indep@mp': [{ scope: 'user', installPath: pluginDir }],
    })
    const userPath = writeSettings(tempDir, 'user', { 'indep@mp': true })
    const projectPath = writeSettings(tempDir, 'project', { 'indep@mp': false })

    const result = discoverPluginPacks({
      installedPluginsPath,
      settingsPaths: settingsPathsWith(tempDir, { user: userPath, project: projectPath }),
    })
    expect(result).toHaveLength(1)
    expect(result[0]!.scope).toBe('user')
  })

  test('user true + project true emits TWO entries, one per scope', () => {
    const pluginDir = createPluginDir(tempDir, 'co-pack')
    writeFileSync(join(pluginDir, 'clooks-pack.json'), JSON.stringify(validManifest))

    const installedPluginsPath = createInstalledPluginsJson(tempDir, {
      'co@mp': [{ scope: 'user', installPath: pluginDir }],
    })
    const userPath = writeSettings(tempDir, 'user', { 'co@mp': true })
    const projectPath = writeSettings(tempDir, 'project', { 'co@mp': true })

    const result = discoverPluginPacks({
      installedPluginsPath,
      settingsPaths: settingsPathsWith(tempDir, { user: userPath, project: projectPath }),
    })
    expect(result).toHaveLength(2)
    const scopes = result.map((p) => p.scope).sort()
    expect(scopes).toEqual(['project', 'user'])
    // Emission order is a deterministic contract from the discovery algorithm
    // (iterates user → project → local; see plugin-discovery.ts and
    // PLAN-0013 M2 algorithm step 5). Keep BOTH the set-equality assertion
    // above and the positional assertions below.
    expect(result[0]!.scope).toBe('user')
    expect(result[1]!.scope).toBe('project')
  })

  // ---- Absence / invalid states ----

  test('all settings absent → []', () => {
    const pluginDir = createPluginDir(tempDir, 'noenable')
    writeFileSync(join(pluginDir, 'clooks-pack.json'), JSON.stringify(validManifest))

    const installedPluginsPath = createInstalledPluginsJson(tempDir, {
      'noenable@mp': [{ scope: 'user', installPath: pluginDir }],
    })

    const result = discoverPluginPacks({
      installedPluginsPath,
      settingsPaths: settingsPathsWith(tempDir, {}),
    })
    expect(result).toHaveLength(0)
  })

  test('enabled in user settings but no install record → no emission', () => {
    const installedPluginsPath = createInstalledPluginsJson(tempDir, {})
    const userPath = writeSettings(tempDir, 'user', { 'ghost@mp': true })

    const result = discoverPluginPacks({
      installedPluginsPath,
      settingsPaths: settingsPathsWith(tempDir, { user: userPath }),
    })
    expect(result).toHaveLength(0)
  })

  test('install record exists but no enabledPlugins anywhere → no emission', () => {
    const pluginDir = createPluginDir(tempDir, 'unused')
    writeFileSync(join(pluginDir, 'clooks-pack.json'), JSON.stringify(validManifest))

    const installedPluginsPath = createInstalledPluginsJson(tempDir, {
      'unused@mp': [{ scope: 'user', installPath: pluginDir }],
    })

    const result = discoverPluginPacks({
      installedPluginsPath,
      settingsPaths: settingsPathsWith(tempDir, {}),
    })
    expect(result).toHaveLength(0)
  })

  test('orphaned install + enabled → no emission', () => {
    const pluginDir = createPluginDir(tempDir, 'orphaned')
    writeFileSync(join(pluginDir, 'clooks-pack.json'), JSON.stringify(validManifest))
    writeFileSync(join(pluginDir, '.orphaned_at'), '2026-01-01T00:00:00.000Z')

    const installedPluginsPath = createInstalledPluginsJson(tempDir, {
      'orphan@mp': [{ scope: 'user', installPath: pluginDir }],
    })
    const userPath = writeSettings(tempDir, 'user', { 'orphan@mp': true })

    const result = discoverPluginPacks({
      installedPluginsPath,
      settingsPaths: settingsPathsWith(tempDir, { user: userPath }),
    })
    expect(result).toHaveLength(0)
  })

  test('managed-scope enable → no emission', () => {
    const pluginDir = createPluginDir(tempDir, 'mgd')
    writeFileSync(join(pluginDir, 'clooks-pack.json'), JSON.stringify(validManifest))

    const installedPluginsPath = createInstalledPluginsJson(tempDir, {
      'mgd@mp': [{ scope: 'user', installPath: pluginDir }],
    })
    const managedPath = writeSettings(tempDir, 'managed', { 'mgd@mp': true })

    const result = discoverPluginPacks({
      installedPluginsPath,
      settingsPaths: settingsPathsWith(tempDir, { managed: managedPath }),
    })
    expect(result).toHaveLength(0)
  })

  test('malformed installed_plugins.json → []', () => {
    const installedPluginsPath = join(tempDir, 'installed_plugins.json')
    writeFileSync(installedPluginsPath, '{not json')
    const userPath = writeSettings(tempDir, 'user', { 'whatever@mp': true })

    warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
    const result = discoverPluginPacks({
      installedPluginsPath,
      settingsPaths: settingsPathsWith(tempDir, { user: userPath }),
    })
    expect(result).toHaveLength(0)
  })

  test('missing installed_plugins.json → []', () => {
    const result = discoverPluginPacks({
      installedPluginsPath: join(tempDir, 'does-not-exist.json'),
      settingsPaths: settingsPathsWith(tempDir, {}),
    })
    expect(result).toHaveLength(0)
  })

  test('missing clooks-pack.json → no emission, no warn', () => {
    const pluginDir = createPluginDir(tempDir, 'no-manifest')
    // No clooks-pack.json written — not a hook pack.

    const installedPluginsPath = createInstalledPluginsJson(tempDir, {
      'nomanifest@mp': [{ scope: 'user', installPath: pluginDir }],
    })
    const userPath = writeSettings(tempDir, 'user', { 'nomanifest@mp': true })

    warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
    const result = discoverPluginPacks({
      installedPluginsPath,
      settingsPaths: settingsPathsWith(tempDir, { user: userPath }),
    })
    expect(result).toHaveLength(0)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  test('invalid manifest warns once and skips', () => {
    const pluginDir = createPluginDir(tempDir, 'bad-manifest')
    writeFileSync(join(pluginDir, 'clooks-pack.json'), JSON.stringify({}))

    const installedPluginsPath = createInstalledPluginsJson(tempDir, {
      'bad@mp': [{ scope: 'user', installPath: pluginDir }],
    })
    const userPath = writeSettings(tempDir, 'user', { 'bad@mp': true })

    warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
    const result = discoverPluginPacks({
      installedPluginsPath,
      settingsPaths: settingsPathsWith(tempDir, { user: userPath }),
    })
    expect(result).toHaveLength(0)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]![0]).toContain('Failed to load manifest')
  })

  test('projectPath mismatch is ignored: install record projectPath does not filter user-scope activation', () => {
    const pluginDir = createPluginDir(tempDir, 'mismatched-proj')
    writeFileSync(join(pluginDir, 'clooks-pack.json'), JSON.stringify(validManifest))

    const installedPluginsPath = createInstalledPluginsJson(tempDir, {
      'mm@mp': [
        {
          scope: 'project',
          projectPath: '/some/other/project',
          installPath: pluginDir,
        },
      ],
    })
    const userPath = writeSettings(tempDir, 'user', { 'mm@mp': true })

    const result = discoverPluginPacks({
      installedPluginsPath,
      settingsPaths: settingsPathsWith(tempDir, { user: userPath }),
    })
    expect(result).toHaveLength(1)
    expect(result[0]!.scope).toBe('user')
    expect(result[0]!.installPath).toBe(pluginDir)
  })

  test('non-existent installPath + enabled → no emission', () => {
    const installedPluginsPath = createInstalledPluginsJson(tempDir, {
      'ghostpath@mp': [
        {
          scope: 'user',
          installPath: join(tempDir, 'does-not-exist'),
        },
      ],
    })
    const userPath = writeSettings(tempDir, 'user', { 'ghostpath@mp': true })

    const result = discoverPluginPacks({
      installedPluginsPath,
      settingsPaths: settingsPathsWith(tempDir, { user: userPath }),
    })
    expect(result).toHaveLength(0)
  })

  test('multiple plugins across layers discovered in user→project order', () => {
    const userPluginDir = createPluginDir(tempDir, 'u-pack')
    writeFileSync(
      join(userPluginDir, 'clooks-pack.json'),
      JSON.stringify({ ...validManifest, name: 'u-pack' }),
    )
    const projectPluginDir = createPluginDir(tempDir, 'p-pack')
    writeFileSync(
      join(projectPluginDir, 'clooks-pack.json'),
      JSON.stringify({ ...validManifest, name: 'p-pack' }),
    )

    const installedPluginsPath = createInstalledPluginsJson(tempDir, {
      'u@mp': [{ scope: 'user', installPath: userPluginDir }],
      'p@mp': [{ scope: 'user', installPath: projectPluginDir }],
    })
    const userPath = writeSettings(tempDir, 'user', { 'u@mp': true })
    const projectPath = writeSettings(tempDir, 'project', { 'p@mp': true })

    const result = discoverPluginPacks({
      installedPluginsPath,
      settingsPaths: settingsPathsWith(tempDir, { user: userPath, project: projectPath }),
    })
    expect(result).toHaveLength(2)
    expect(result[0]!.pluginName).toBe('u@mp')
    expect(result[0]!.scope).toBe('user')
    expect(result[1]!.pluginName).toBe('p@mp')
    expect(result[1]!.scope).toBe('project')
  })
})
