import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  activationsByLayer,
  defaultSettingsPaths,
  detectStaleAdvisories,
  lookupInstallPath,
  readEnabledPlugins,
  readInstalledPlugins,
  readVendoredPluginEntries,
} from './claude-settings.js'
import type {
  EnabledPluginsByLayer,
  InstalledPluginEntry,
  InstalledPluginsFile,
  SettingsLayerPaths,
  VendoredHookEntry,
} from './claude-settings.js'

interface Fixture {
  root: string
  cacheRoot: string
  settingsPaths: SettingsLayerPaths
  installedPath: string
  writeSettings: (scope: 'user' | 'project' | 'local' | 'managed', contents: unknown) => void
  writeSettingsRaw: (scope: 'user' | 'project' | 'local' | 'managed', raw: string) => void
  makeInstallDir: (name: string, opts?: { orphaned?: boolean }) => string
  writeInstalled: (file: unknown) => void
}

function build(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'clooks-claude-settings-'))
  const cacheRoot = join(root, 'cache')
  mkdirSync(cacheRoot, { recursive: true })
  const settingsPaths: SettingsLayerPaths = {
    managed: join(root, 'managed.json'),
    user: join(root, 'user.json'),
    project: join(root, 'project.json'),
    local: join(root, 'local.json'),
  }
  const installedPath = join(root, 'installed_plugins.json')

  const writeSettings: Fixture['writeSettings'] = (scope, contents) => {
    const path = settingsPaths[scope]
    if (!path) return
    writeFileSync(path, JSON.stringify(contents))
  }

  const writeSettingsRaw: Fixture['writeSettingsRaw'] = (scope, raw) => {
    const path = settingsPaths[scope]
    if (!path) return
    writeFileSync(path, raw)
  }

  const makeInstallDir: Fixture['makeInstallDir'] = (name, opts = {}) => {
    const dir = join(cacheRoot, name)
    mkdirSync(dir, { recursive: true })
    if (opts.orphaned) {
      writeFileSync(join(dir, '.orphaned_at'), new Date().toISOString())
    }
    return dir
  }

  const writeInstalled: Fixture['writeInstalled'] = (file) => {
    writeFileSync(installedPath, JSON.stringify(file, null, 2))
  }

  return {
    root,
    cacheRoot,
    settingsPaths,
    installedPath,
    writeSettings,
    writeSettingsRaw,
    makeInstallDir,
    writeInstalled,
  }
}

let fx: Fixture
let warnSpy: ReturnType<typeof spyOn> | undefined
beforeEach(() => {
  fx = build()
})
afterEach(() => {
  warnSpy?.mockRestore()
  warnSpy = undefined
  rmSync(fx.root, { recursive: true, force: true })
})

describe('defaultSettingsPaths', () => {
  test('returns documented paths and leaves managed undefined', () => {
    const paths = defaultSettingsPaths('/h', '/p')
    expect(paths.user).toBe(join('/h', '.claude', 'settings.json'))
    expect(paths.project).toBe(join('/p', '.claude', 'settings.json'))
    expect(paths.local).toBe(join('/p', '.claude', 'settings.local.json'))
    expect(paths.managed).toBeUndefined()
  })
})

describe('readEnabledPlugins', () => {
  test('all layers missing -> empty maps', () => {
    const out = readEnabledPlugins(fx.settingsPaths)
    expect(out).toEqual({ managed: {}, user: {}, project: {}, local: {} })
  })

  test('user file exists but empty -> user is {}', () => {
    fx.writeSettings('user', {})
    const out = readEnabledPlugins(fx.settingsPaths)
    expect(out.user).toEqual({})
    expect(out.project).toEqual({})
    expect(out.local).toEqual({})
    expect(out.managed).toEqual({})
  })

  test('user enabledPlugins with true+false values parsed verbatim', () => {
    fx.writeSettings('user', { enabledPlugins: { 'foo@bar': true, 'baz@mp': false } })
    const out = readEnabledPlugins(fx.settingsPaths)
    expect(out).toEqual({
      managed: {},
      user: { 'foo@bar': true, 'baz@mp': false },
      project: {},
      local: {},
    })
  })

  test('malformed JSON in project file -> {} and console.warn called', () => {
    warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
    fx.writeSettingsRaw('project', '{not valid json')
    const out = readEnabledPlugins(fx.settingsPaths)
    expect(out.project).toEqual({})
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]?.[0]).toContain('[clooks]')
  })

  test('non-boolean enabledPlugins value is dropped with a warn; booleans preserved', () => {
    warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
    fx.writeSettings('user', {
      enabledPlugins: { 'good@mp': true, 'bad@mp': 'yes', 'also-good@mp': false },
    })
    const out = readEnabledPlugins(fx.settingsPaths)
    expect(out.user).toEqual({ 'good@mp': true, 'also-good@mp': false })
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]?.[0]).toContain('[clooks]')
  })

  test('missing enabledPlugins key -> {} with no warn', () => {
    warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
    fx.writeSettings('user', { someOtherField: 42 })
    const out = readEnabledPlugins(fx.settingsPaths)
    expect(out.user).toEqual({})
    expect(warnSpy).not.toHaveBeenCalled()
  })

  test('all four layers populated with distinct enabledPlugins -> each returned verbatim, no cross-layer bleed', () => {
    fx.writeSettings('managed', { enabledPlugins: { 'm-only@mp': true } })
    fx.writeSettings('user', { enabledPlugins: { 'u-only@mp': true, 'u-off@mp': false } })
    fx.writeSettings('project', { enabledPlugins: { 'p-only@mp': true } })
    fx.writeSettings('local', { enabledPlugins: { 'l-only@mp': false } })
    const out = readEnabledPlugins(fx.settingsPaths)
    expect(out).toEqual({
      managed: { 'm-only@mp': true },
      user: { 'u-only@mp': true, 'u-off@mp': false },
      project: { 'p-only@mp': true },
      local: { 'l-only@mp': false },
    })
  })
})

describe('activationsByLayer', () => {
  test('derives per-layer true-keys without cross-layer merge', () => {
    const layers: EnabledPluginsByLayer = {
      managed: {},
      user: { a: true, b: false },
      project: { c: true },
      local: {},
    }
    expect(activationsByLayer(layers)).toEqual({
      managed: [],
      user: ['a'],
      project: ['c'],
      local: [],
    })
  })

  test('same key true at two layers appears in both arrays (no dedup, no precedence)', () => {
    const layers: EnabledPluginsByLayer = {
      managed: {},
      user: { x: true },
      project: { x: true },
      local: {},
    }
    const out = activationsByLayer(layers)
    expect(out.user).toEqual(['x'])
    expect(out.project).toEqual(['x'])
  })

  test('X: false at one layer and X: true at another: only true-layer lists X', () => {
    const layers: EnabledPluginsByLayer = {
      managed: {},
      user: { x: false },
      project: { x: true },
      local: {},
    }
    const out = activationsByLayer(layers)
    expect(out.user).toEqual([])
    expect(out.project).toEqual(['x'])
  })
})

describe('readInstalledPlugins', () => {
  test('missing file -> null', () => {
    expect(readInstalledPlugins(fx.installedPath)).toBeNull()
  })

  test('malformed JSON -> null + console.warn', () => {
    warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
    writeFileSync(fx.installedPath, '{not json')
    expect(readInstalledPlugins(fx.installedPath)).toBeNull()
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]?.[0]).toContain('[clooks]')
  })

  test('wrong shape (missing plugins key) -> null + console.warn', () => {
    warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
    fx.writeInstalled({ version: 2 })
    expect(readInstalledPlugins(fx.installedPath)).toBeNull()
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  test('valid file -> returns parsed structure (no path validation; installPath is opaque to the parser)', () => {
    const file: InstalledPluginsFile = {
      version: 2,
      plugins: {
        'a@mp': [{ scope: 'user', installPath: '/tmp/fake-install-path' }],
      },
    }
    fx.writeInstalled(file)
    expect(readInstalledPlugins(fx.installedPath)).toEqual(file)
  })
})

describe('lookupInstallPath', () => {
  test('first entry valid -> returned; works for scope: user and scope: local (no scope filter beyond managed)', () => {
    const userDir = fx.makeInstallDir('a-user')
    const userEntry: InstalledPluginEntry = { scope: 'user', installPath: userDir }
    const userFile: InstalledPluginsFile = { version: 2, plugins: { 'a@mp': [userEntry] } }
    expect(lookupInstallPath(userFile, 'a@mp')).toEqual({ installPath: userDir, entry: userEntry })

    const localDir = fx.makeInstallDir('a-local')
    const localEntry: InstalledPluginEntry = { scope: 'local', installPath: localDir }
    const localFile: InstalledPluginsFile = { version: 2, plugins: { 'a@mp': [localEntry] } }
    expect(lookupInstallPath(localFile, 'a@mp')).toEqual({
      installPath: localDir,
      entry: localEntry,
    })
  })

  test('first entry managed -> skipped; second entry returned', () => {
    const managedDir = fx.makeInstallDir('managed-a')
    const userDir = fx.makeInstallDir('user-a')
    const managedEntry: InstalledPluginEntry = { scope: 'managed', installPath: managedDir }
    const userEntry: InstalledPluginEntry = { scope: 'user', installPath: userDir }
    const file: InstalledPluginsFile = {
      version: 2,
      plugins: { 'a@mp': [managedEntry, userEntry] },
    }
    expect(lookupInstallPath(file, 'a@mp')).toEqual({ installPath: userDir, entry: userEntry })
  })

  test('first entry installPath missing on disk -> skipped; second returned', () => {
    const liveDir = fx.makeInstallDir('live')
    const deadEntry: InstalledPluginEntry = {
      scope: 'user',
      installPath: join(fx.cacheRoot, 'does-not-exist'),
    }
    const liveEntry: InstalledPluginEntry = { scope: 'user', installPath: liveDir }
    const file: InstalledPluginsFile = {
      version: 2,
      plugins: { 'a@mp': [deadEntry, liveEntry] },
    }
    expect(lookupInstallPath(file, 'a@mp')).toEqual({ installPath: liveDir, entry: liveEntry })
  })

  test('first entry has .orphaned_at marker -> skipped; second returned', () => {
    const orphanedDir = fx.makeInstallDir('orphaned', { orphaned: true })
    const liveDir = fx.makeInstallDir('live')
    const orphanedEntry: InstalledPluginEntry = { scope: 'user', installPath: orphanedDir }
    const liveEntry: InstalledPluginEntry = { scope: 'user', installPath: liveDir }
    const file: InstalledPluginsFile = {
      version: 2,
      plugins: { 'a@mp': [orphanedEntry, liveEntry] },
    }
    expect(lookupInstallPath(file, 'a@mp')).toEqual({ installPath: liveDir, entry: liveEntry })
  })

  test('all entries disqualified -> undefined', () => {
    const orphanedDir = fx.makeInstallDir('orphaned', { orphaned: true })
    const managedDir = fx.makeInstallDir('managed')
    const file: InstalledPluginsFile = {
      version: 2,
      plugins: {
        'a@mp': [
          { scope: 'managed', installPath: managedDir },
          { scope: 'user', installPath: join(fx.cacheRoot, 'nope') },
          { scope: 'user', installPath: orphanedDir },
        ],
      },
    }
    expect(lookupInstallPath(file, 'a@mp')).toBeUndefined()
  })

  test('plugin key absent from plugins map -> undefined', () => {
    const file: InstalledPluginsFile = { version: 2, plugins: {} }
    expect(lookupInstallPath(file, 'missing@mp')).toBeUndefined()
  })

  test('scope: project with projectPath pointing elsewhere -> returned (no projectPath filter)', () => {
    const dir = fx.makeInstallDir('p')
    const entry: InstalledPluginEntry = {
      scope: 'project',
      installPath: dir,
      projectPath: '/some/other/path',
    }
    const file: InstalledPluginsFile = { version: 2, plugins: { 'a@mp': [entry] } }
    expect(lookupInstallPath(file, 'a@mp')).toEqual({ installPath: dir, entry })
  })
})

describe('readVendoredPluginEntries', () => {
  test('missing file -> empty list', () => {
    const ymlPath = join(fx.root, 'missing.yml')
    expect(readVendoredPluginEntries(ymlPath)).toEqual([])
  })

  test('malformed yml -> empty list + console.warn', () => {
    warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
    const ymlPath = join(fx.root, 'bad.yml')
    writeFileSync(ymlPath, ':\n  not: [valid')
    expect(readVendoredPluginEntries(ymlPath)).toEqual([])
    expect(warnSpy).toHaveBeenCalled()
    expect(warnSpy.mock.calls[0]?.[0]).toContain('[clooks]')
  })

  test('only plugin-vendored entries are returned; custom/hand-written uses paths are skipped', () => {
    const ymlPath = join(fx.root, 'clooks.yml')
    const yml = [
      'version: "1.0.0"',
      '',
      'plugin-hook:',
      '  uses: ./.clooks/vendor/plugin/foo-pack/plugin-hook.ts',
      '',
      'custom-hook:',
      '  uses: ./.clooks/hooks/custom-hook.ts',
      '',
      'absolute-hook:',
      '  uses: /tmp/elsewhere.ts',
      '',
      'other-hook:',
      '  uses: ./.clooks/vendor/plugin/bar-pack/other-hook.js',
      '',
    ].join('\n')
    writeFileSync(ymlPath, yml)
    const out = readVendoredPluginEntries(ymlPath)
    expect(out).toEqual([
      {
        hookName: 'plugin-hook',
        packName: 'foo-pack',
        usesPath: './.clooks/vendor/plugin/foo-pack/plugin-hook.ts',
      },
      {
        hookName: 'other-hook',
        packName: 'bar-pack',
        usesPath: './.clooks/vendor/plugin/bar-pack/other-hook.js',
      },
    ])
  })

  test('hook entry without string uses is skipped silently', () => {
    const ymlPath = join(fx.root, 'clooks.yml')
    const yml = ['version: "1.0.0"', '', 'no-uses-hook:', '  enabled: true', ''].join('\n')
    writeFileSync(ymlPath, yml)
    expect(readVendoredPluginEntries(ymlPath)).toEqual([])
  })
})

interface DetectorFixture {
  cacheRoot: string
  writePack: (
    pluginKey: string,
    packName: string,
    opts?: { missingManifest?: boolean; orphaned?: boolean },
  ) => string
}

function buildDetectorFx(): DetectorFixture {
  const cacheRoot = mkdtempSync(join(tmpdir(), 'clooks-detector-'))
  const writePack: DetectorFixture['writePack'] = (pluginKey, packName, opts = {}) => {
    const installPath = join(cacheRoot, pluginKey.replace('@', '__'), packName)
    mkdirSync(installPath, { recursive: true })
    if (!opts.missingManifest) {
      writeFileSync(
        join(installPath, 'clooks-pack.json'),
        JSON.stringify({ version: 1, name: packName, hooks: {} }),
      )
    }
    if (opts.orphaned) {
      writeFileSync(join(installPath, '.orphaned_at'), new Date().toISOString())
    }
    return installPath
  }
  return { cacheRoot, writePack }
}

describe('detectStaleAdvisories', () => {
  let dfx: DetectorFixture

  beforeEach(() => {
    dfx = buildDetectorFx()
  })

  afterEach(() => {
    rmSync(dfx.cacheRoot, { recursive: true, force: true })
  })

  const emptyLayers: EnabledPluginsByLayer = {
    managed: {},
    user: {},
    project: {},
    local: {},
  }

  const emptyReaders = {
    user: () => [] as VendoredHookEntry[],
    project: () => [] as VendoredHookEntry[],
    local: () => [] as VendoredHookEntry[],
  }

  test('no drift -> empty list', () => {
    const installPath = dfx.writePack('foo@mp', 'foo')
    const installedPluginsFile: InstalledPluginsFile = {
      version: 2,
      plugins: { 'foo@mp': [{ scope: 'user', installPath }] },
    }
    const out = detectStaleAdvisories({
      installedPluginsFile,
      layers: { ...emptyLayers, user: { 'foo@mp': true } },
      clooksYmlReaders: {
        ...emptyReaders,
        user: () => [
          {
            hookName: 'foo-hook',
            packName: 'foo',
            usesPath: './.clooks/vendor/plugin/foo/foo-hook.ts',
          },
        ],
      },
    })
    expect(out).toEqual([])
  })

  test('Env-var silencer set -> returns [] regardless', () => {
    // Isolated with try/finally (not afterEach) because this is the only test
    // in the file that manipulates process.env. Restoring in finally keeps the
    // mutation scoped to this test and survives assertion failures.
    const prev = process.env.CLOOKS_SILENCE_STALE_PLUGIN_ADVISORIES
    try {
      process.env.CLOOKS_SILENCE_STALE_PLUGIN_ADVISORIES = 'true'
      const installPath = dfx.writePack('foo@mp', 'foo')
      const orphanedInstallPath = dfx.writePack('orphaned@mp', 'orphaned', { orphaned: true })
      const installedPluginsFile: InstalledPluginsFile = {
        version: 2,
        plugins: {
          'foo@mp': [{ scope: 'user', installPath }],
          'orphaned@mp': [{ scope: 'user', installPath: orphanedInstallPath }],
        },
      }
      const out = detectStaleAdvisories({
        installedPluginsFile,
        // Drift state present at every scope — both kinds.
        layers: {
          ...emptyLayers,
          user: { 'orphaned@mp': true, 'foo@mp': false },
        },
        clooksYmlReaders: {
          ...emptyReaders,
          user: () => [
            {
              hookName: 'foo-hook',
              packName: 'foo',
              usesPath: './.clooks/vendor/plugin/foo/foo-hook.ts',
            },
          ],
        },
      })
      expect(out).toEqual([])
    } finally {
      if (prev === undefined) {
        delete process.env.CLOOKS_SILENCE_STALE_PLUGIN_ADVISORIES
      } else {
        process.env.CLOOKS_SILENCE_STALE_PLUGIN_ADVISORIES = prev
      }
    }
  })

  // Exercises the "absent from enabledPlugins" case (undefined at user scope).
  // Distinct from the "explicitly false" case covered in its own test below.
  test('stale registration at user scope only -> one advisory tagged user', () => {
    const installPath = dfx.writePack('foo@mp', 'foo')
    const installedPluginsFile: InstalledPluginsFile = {
      version: 2,
      plugins: { 'foo@mp': [{ scope: 'user', installPath }] },
    }
    const out = detectStaleAdvisories({
      installedPluginsFile,
      layers: emptyLayers,
      clooksYmlReaders: {
        ...emptyReaders,
        user: () => [
          {
            hookName: 'foo-hook',
            packName: 'foo',
            usesPath: './.clooks/vendor/plugin/foo/foo-hook.ts',
          },
        ],
      },
    })
    expect(out).toEqual([
      {
        kind: 'stale-registration',
        scope: 'user',
        pluginKey: 'foo@mp',
        hookName: 'foo-hook',
        vendorPackDir: './.clooks/vendor/plugin/foo/',
      },
    ])
  })

  test('stale registration at local scope only -> one advisory tagged local', () => {
    const installedPluginsFile: InstalledPluginsFile = { version: 2, plugins: {} }
    const out = detectStaleAdvisories({
      installedPluginsFile,
      layers: { managed: {}, user: {}, project: {}, local: {} },
      clooksYmlReaders: {
        user: () => [],
        project: () => [],
        local: () => [
          {
            hookName: 'loc-hook',
            packName: 'loc',
            usesPath: './.clooks/vendor/plugin/loc/loc-hook.ts',
          },
        ],
      },
    })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      kind: 'stale-registration',
      scope: 'local',
      hookName: 'loc-hook',
      pluginKey: 'loc',
      vendorPackDir: './.clooks/vendor/plugin/loc/',
    })
  })

  test('stale registration at two scopes -> two advisories', () => {
    const installPath = dfx.writePack('foo@mp', 'foo')
    const installedPluginsFile: InstalledPluginsFile = {
      version: 2,
      plugins: { 'foo@mp': [{ scope: 'user', installPath }] },
    }
    const entry: VendoredHookEntry = {
      hookName: 'foo-hook',
      packName: 'foo',
      usesPath: './.clooks/vendor/plugin/foo/foo-hook.ts',
    }
    const out = detectStaleAdvisories({
      installedPluginsFile,
      layers: emptyLayers,
      clooksYmlReaders: {
        user: () => [entry],
        project: () => [entry],
        local: () => [],
      },
    })
    expect(out).toHaveLength(2)
    expect(out[0]?.scope).toBe('user')
    expect(out[0]?.kind).toBe('stale-registration')
    expect(out[1]?.scope).toBe('project')
    expect(out[1]?.kind).toBe('stale-registration')
  })

  test('enable-without-install at project scope only -> one advisory tagged project', () => {
    const installPath = dfx.writePack('ghost@mp', 'ghost', { orphaned: true })
    const installedPluginsFile: InstalledPluginsFile = {
      version: 2,
      plugins: { 'ghost@mp': [{ scope: 'project', installPath }] },
    }
    const out = detectStaleAdvisories({
      installedPluginsFile,
      layers: { ...emptyLayers, project: { 'ghost@mp': true } },
      clooksYmlReaders: emptyReaders,
    })
    expect(out).toEqual([
      {
        kind: 'enable-without-install',
        scope: 'project',
        pluginKey: 'ghost@mp',
      },
    ])
  })

  test('enable-without-install does NOT fire for non-clooks plugins (no clooks-pack.json)', () => {
    const noManifestPath = dfx.writePack('skill@mp', 'skill', { missingManifest: true })
    const installedPluginsFile: InstalledPluginsFile = {
      version: 2,
      plugins: {
        'skill@mp': [{ scope: 'user', installPath: noManifestPath }],
        'stale@mp': [{ scope: 'user', installPath: join(dfx.cacheRoot, 'gone') }],
      },
    }
    const out = detectStaleAdvisories({
      installedPluginsFile,
      layers: {
        ...emptyLayers,
        user: { 'skill@mp': true, 'stale@mp': true, 'never-installed@mp': true },
      },
      clooksYmlReaders: emptyReaders,
    })
    expect(out).toEqual([])
  })

  test('both drift types coexisting -> both advisories returned', () => {
    const installPath = dfx.writePack('foo@mp', 'foo')
    const orphanedPath = dfx.writePack('ghost@mp', 'ghost', { orphaned: true })
    const installedPluginsFile: InstalledPluginsFile = {
      version: 2,
      plugins: {
        'foo@mp': [{ scope: 'user', installPath }],
        'ghost@mp': [{ scope: 'user', installPath: orphanedPath }],
      },
    }
    const out = detectStaleAdvisories({
      installedPluginsFile,
      layers: { ...emptyLayers, user: { 'ghost@mp': true } },
      clooksYmlReaders: {
        ...emptyReaders,
        user: () => [
          {
            hookName: 'foo-hook',
            packName: 'foo',
            usesPath: './.clooks/vendor/plugin/foo/foo-hook.ts',
          },
        ],
      },
    })
    expect(out).toHaveLength(2)
    const kinds = out.map((a) => a.kind).sort()
    expect(kinds).toEqual(['enable-without-install', 'stale-registration'])
    // Both anchored at user scope.
    expect(out.every((a) => a.scope === 'user')).toBe(true)
  })

  test('plugin explicitly disabled (false) at its own scope + lingering vendored entry -> advisory fires', () => {
    const installPath = dfx.writePack('foo@mp', 'foo')
    const installedPluginsFile: InstalledPluginsFile = {
      version: 2,
      plugins: { 'foo@mp': [{ scope: 'user', installPath }] },
    }
    const out = detectStaleAdvisories({
      installedPluginsFile,
      layers: { ...emptyLayers, user: { 'foo@mp': false } },
      clooksYmlReaders: {
        ...emptyReaders,
        user: () => [
          {
            hookName: 'foo-hook',
            packName: 'foo',
            usesPath: './.clooks/vendor/plugin/foo/foo-hook.ts',
          },
        ],
      },
    })
    expect(out).toEqual([
      {
        kind: 'stale-registration',
        scope: 'user',
        pluginKey: 'foo@mp',
        hookName: 'foo-hook',
        vendorPackDir: './.clooks/vendor/plugin/foo/',
      },
    ])
  })

  test('null installedPluginsFile + some enabled key -> no advisory (cannot verify clooks ownership)', () => {
    const out = detectStaleAdvisories({
      installedPluginsFile: null,
      layers: { ...emptyLayers, user: { 'ghost@mp': true } },
      clooksYmlReaders: emptyReaders,
    })
    expect(out).toEqual([])
  })

  test('when packName cannot be resolved to a pluginKey, falls back to packName as pluginKey', () => {
    // installed_plugins has no record for this pack.
    const installedPluginsFile: InstalledPluginsFile = { version: 2, plugins: {} }
    const out = detectStaleAdvisories({
      installedPluginsFile,
      layers: emptyLayers,
      clooksYmlReaders: {
        ...emptyReaders,
        user: () => [
          {
            hookName: 'orphan-hook',
            packName: 'orphan-pack',
            usesPath: './.clooks/vendor/plugin/orphan-pack/orphan-hook.ts',
          },
        ],
      },
    })
    expect(out).toEqual([
      {
        kind: 'stale-registration',
        scope: 'user',
        pluginKey: 'orphan-pack',
        hookName: 'orphan-hook',
        vendorPackDir: './.clooks/vendor/plugin/orphan-pack/',
      },
    ])
  })

  test('deterministic scope ordering user -> project -> local', () => {
    const aPath = dfx.writePack('a@mp', 'a', { orphaned: true })
    const bPath = dfx.writePack('b@mp', 'b', { orphaned: true })
    const cPath = dfx.writePack('c@mp', 'c', { orphaned: true })
    const installedPluginsFile: InstalledPluginsFile = {
      version: 2,
      plugins: {
        'a@mp': [{ scope: 'user', installPath: aPath }],
        'b@mp': [{ scope: 'user', installPath: bPath }],
        'c@mp': [{ scope: 'user', installPath: cPath }],
      },
    }
    const out = detectStaleAdvisories({
      installedPluginsFile,
      layers: {
        managed: {},
        user: { 'a@mp': true },
        project: { 'b@mp': true },
        local: { 'c@mp': true },
      },
      clooksYmlReaders: emptyReaders,
    })
    expect(out.map((a) => a.scope)).toEqual(['user', 'project', 'local'])
    expect(out.map((a) => a.pluginKey)).toEqual(['a@mp', 'b@mp', 'c@mp'])
  })
})
