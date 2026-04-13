import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { discoverPluginPacks } from './plugin-discovery.js'

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

function createInstalledPluginsJson(tempDir: string, plugins: Record<string, unknown[]>): string {
  const filePath = join(tempDir, 'installed_plugins.json')
  writeFileSync(
    filePath,
    JSON.stringify({
      version: 2,
      plugins,
    }),
  )
  return filePath
}

function createPluginDir(tempDir: string, name: string): string {
  const pluginDir = join(tempDir, 'cache', name)
  mkdirSync(pluginDir, { recursive: true })
  return pluginDir
}

describe('discoverPluginPacks', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'clooks-plugin-discovery-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('discovers a plugin with valid clooks-pack.json', () => {
    const pluginDir = createPluginDir(tempDir, 'test-pack')
    writeFileSync(join(pluginDir, 'clooks-pack.json'), JSON.stringify(validManifest))

    const installedPath = createInstalledPluginsJson(tempDir, {
      'test-pack@test-marketplace': [
        {
          scope: 'user',
          installPath: pluginDir,
          version: '1.0.0',
          installedAt: '2026-01-01T00:00:00.000Z',
          lastUpdated: '2026-01-01T00:00:00.000Z',
        },
      ],
    })

    const result = discoverPluginPacks(installedPath)
    expect(result).toHaveLength(1)
    expect(result[0]!.pluginName).toBe('test-pack@test-marketplace')
    expect(result[0]!.scope).toBe('user')
    expect(result[0]!.installPath).toBe(pluginDir)
    expect(result[0]!.manifest.name).toBe('test-pack')
    expect(result[0]!.manifest.version).toBe(1)
    expect(Object.keys(result[0]!.manifest.hooks)).toHaveLength(1)
  })

  test('skips plugins without clooks-pack.json', () => {
    const pluginDir = createPluginDir(tempDir, 'no-manifest')

    const installedPath = createInstalledPluginsJson(tempDir, {
      'no-manifest@test-marketplace': [
        {
          scope: 'user',
          installPath: pluginDir,
          version: '1.0.0',
          installedAt: '2026-01-01T00:00:00.000Z',
          lastUpdated: '2026-01-01T00:00:00.000Z',
        },
      ],
    })

    const result = discoverPluginPacks(installedPath)
    expect(result).toHaveLength(0)
  })

  test('skips orphaned directories (.orphaned_at present)', () => {
    const pluginDir = createPluginDir(tempDir, 'orphaned')
    writeFileSync(join(pluginDir, 'clooks-pack.json'), JSON.stringify(validManifest))
    writeFileSync(join(pluginDir, '.orphaned_at'), '2026-01-01T00:00:00.000Z')

    const installedPath = createInstalledPluginsJson(tempDir, {
      'orphaned@test-marketplace': [
        {
          scope: 'user',
          installPath: pluginDir,
          version: '1.0.0',
          installedAt: '2026-01-01T00:00:00.000Z',
          lastUpdated: '2026-01-01T00:00:00.000Z',
        },
      ],
    })

    const result = discoverPluginPacks(installedPath)
    expect(result).toHaveLength(0)
  })

  test('skips managed scope', () => {
    const pluginDir = createPluginDir(tempDir, 'managed')
    writeFileSync(join(pluginDir, 'clooks-pack.json'), JSON.stringify(validManifest))

    const installedPath = createInstalledPluginsJson(tempDir, {
      'managed@test-marketplace': [
        {
          scope: 'managed',
          installPath: pluginDir,
          version: '1.0.0',
          installedAt: '2026-01-01T00:00:00.000Z',
          lastUpdated: '2026-01-01T00:00:00.000Z',
        },
      ],
    })

    const result = discoverPluginPacks(installedPath)
    expect(result).toHaveLength(0)
  })

  test('handles missing installed_plugins.json (returns empty array)', () => {
    const result = discoverPluginPacks(join(tempDir, 'nonexistent', 'installed_plugins.json'))
    expect(result).toHaveLength(0)
  })

  test('invalid manifest produces a warning, does not crash', () => {
    const pluginDir = createPluginDir(tempDir, 'invalid-manifest')
    writeFileSync(join(pluginDir, 'clooks-pack.json'), JSON.stringify({}))

    const installedPath = createInstalledPluginsJson(tempDir, {
      'invalid@test-marketplace': [
        {
          scope: 'user',
          installPath: pluginDir,
          version: '1.0.0',
          installedAt: '2026-01-01T00:00:00.000Z',
          lastUpdated: '2026-01-01T00:00:00.000Z',
        },
      ],
    })

    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
    const result = discoverPluginPacks(installedPath)
    expect(result).toHaveLength(0)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]![0]).toContain('Failed to load manifest')
    warnSpy.mockRestore()
  })

  test('multiple plugins discovered correctly', () => {
    const pluginDir1 = createPluginDir(tempDir, 'pack-one')
    writeFileSync(
      join(pluginDir1, 'clooks-pack.json'),
      JSON.stringify({
        ...validManifest,
        name: 'pack-one',
      }),
    )

    const pluginDir2 = createPluginDir(tempDir, 'pack-two')
    writeFileSync(
      join(pluginDir2, 'clooks-pack.json'),
      JSON.stringify({
        ...validManifest,
        name: 'pack-two',
      }),
    )

    const installedPath = createInstalledPluginsJson(tempDir, {
      'pack-one@marketplace': [
        {
          scope: 'user',
          installPath: pluginDir1,
          version: '1.0.0',
          installedAt: '2026-01-01T00:00:00.000Z',
          lastUpdated: '2026-01-01T00:00:00.000Z',
        },
      ],
      'pack-two@marketplace': [
        {
          scope: 'project',
          installPath: pluginDir2,
          version: '2.0.0',
          installedAt: '2026-01-01T00:00:00.000Z',
          lastUpdated: '2026-01-01T00:00:00.000Z',
        },
      ],
    })

    const result = discoverPluginPacks(installedPath)
    expect(result).toHaveLength(2)

    const names = result.map((p) => p.pluginName).sort()
    expect(names).toEqual(['pack-one@marketplace', 'pack-two@marketplace'])

    const packOne = result.find((p) => p.pluginName === 'pack-one@marketplace')!
    expect(packOne.scope).toBe('user')
    expect(packOne.manifest.name).toBe('pack-one')

    const packTwo = result.find((p) => p.pluginName === 'pack-two@marketplace')!
    expect(packTwo.scope).toBe('project')
    expect(packTwo.manifest.name).toBe('pack-two')
  })

  test('skips entries with unknown scope', () => {
    const pluginDir = createPluginDir(tempDir, 'unknown-scope')
    writeFileSync(join(pluginDir, 'clooks-pack.json'), JSON.stringify(validManifest))

    const installedPath = createInstalledPluginsJson(tempDir, {
      'unknown@test-marketplace': [
        {
          scope: 'organization',
          installPath: pluginDir,
          version: '1.0.0',
          installedAt: '2026-01-01T00:00:00.000Z',
          lastUpdated: '2026-01-01T00:00:00.000Z',
        },
      ],
    })

    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
    const result = discoverPluginPacks(installedPath)
    expect(result).toHaveLength(0)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]![0]).toContain('unknown scope')
    warnSpy.mockRestore()
  })

  test('discovers multiple scopes for the same plugin key', () => {
    const userDir = createPluginDir(tempDir, 'user-scope')
    writeFileSync(join(userDir, 'clooks-pack.json'), JSON.stringify(validManifest))

    const projectDir = createPluginDir(tempDir, 'project-scope')
    writeFileSync(join(projectDir, 'clooks-pack.json'), JSON.stringify(validManifest))

    const installedPath = createInstalledPluginsJson(tempDir, {
      'multi-scope@marketplace': [
        {
          scope: 'user',
          installPath: userDir,
          version: '1.0.0',
          installedAt: '2026-01-01T00:00:00.000Z',
          lastUpdated: '2026-01-01T00:00:00.000Z',
        },
        {
          scope: 'project',
          installPath: projectDir,
          version: '1.0.0',
          installedAt: '2026-01-01T00:00:00.000Z',
          lastUpdated: '2026-01-01T00:00:00.000Z',
        },
      ],
    })

    const result = discoverPluginPacks(installedPath)
    expect(result).toHaveLength(2)
    expect(result[0]!.scope).toBe('user')
    expect(result[1]!.scope).toBe('project')
    expect(result[0]!.pluginName).toBe('multi-scope@marketplace')
    expect(result[1]!.pluginName).toBe('multi-scope@marketplace')
  })

  test('skips entries with non-existent installPath', () => {
    const installedPath = createInstalledPluginsJson(tempDir, {
      'ghost@test-marketplace': [
        {
          scope: 'user',
          installPath: join(tempDir, 'does-not-exist'),
          version: '1.0.0',
          installedAt: '2026-01-01T00:00:00.000Z',
          lastUpdated: '2026-01-01T00:00:00.000Z',
        },
      ],
    })

    const result = discoverPluginPacks(installedPath)
    expect(result).toHaveLength(0)
  })
})
