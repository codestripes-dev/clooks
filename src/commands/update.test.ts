import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { updatePluginPack } from './update.js'
import type { DiscoveredPack } from '../plugin-discovery.js'
import type { Manifest } from '../manifest.js'

/**
 * Creates a valid hook .ts file that exports the expected shape.
 */
function writeValidHook(dir: string, relativePath: string, hookMetaName: string): void {
  const absPath = join(dir, relativePath)
  mkdirSync(join(absPath, '..'), { recursive: true })
  writeFileSync(
    absPath,
    `export const hook = {
  meta: { name: '${hookMetaName}' },
  PreToolUse: () => ({ decision: 'continue' }),
}
`,
  )
}

function makeManifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    version: 1,
    name: 'test-pack',
    hooks: {
      'test-hook': {
        path: 'hooks/test-hook.ts',
        description: 'A test hook',
      },
    },
    ...overrides,
  }
}

function makePack(overrides: Partial<DiscoveredPack> = {}): DiscoveredPack {
  return {
    pluginName: 'test-pack@marketplace',
    scope: 'project',
    installPath: '/tmp/fake',
    manifest: makeManifest(),
    ...overrides,
  }
}

describe('updatePluginPack', () => {
  let tempDir: string
  let projectRoot: string
  let homeRoot: string
  let installPath: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'clooks-update-test-'))
    projectRoot = join(tempDir, 'project')
    homeRoot = join(tempDir, 'home')
    installPath = join(tempDir, 'cache', 'test-pack')
    mkdirSync(projectRoot, { recursive: true })
    mkdirSync(homeRoot, { recursive: true })
    mkdirSync(installPath, { recursive: true })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('updates files in vendor directory', async () => {
    // Write original hook source in cache
    writeValidHook(installPath, 'hooks/test-hook.ts', 'test-hook')

    // Pre-vendor the hook with old content
    const vendorPath = join(projectRoot, '.clooks', 'vendor', 'plugin', 'test-pack', 'test-hook.ts')
    mkdirSync(join(vendorPath, '..'), { recursive: true })
    writeFileSync(vendorPath, 'old content that should be overwritten')

    // Pre-create config with existing entry
    const configDir = join(projectRoot, '.clooks')
    writeFileSync(
      join(configDir, 'clooks.yml'),
      'version: "1.0.0"\n\ntest-hook:\n  uses: ./.clooks/vendor/plugin/test-pack/test-hook.ts\n',
    )

    const pack = makePack({ installPath, scope: 'project' })
    const discoverFn = () => [pack]

    const result = await updatePluginPack('test-pack', projectRoot, homeRoot, discoverFn)

    expect(result.updated).toEqual(['test-hook'])
    expect(result.registered).toEqual([])
    expect(result.skipped).toEqual([])
    expect(result.errors).toEqual([])

    // Verify the vendor file was overwritten with new content from cache
    const content = readFileSync(vendorPath, 'utf-8')
    expect(content).not.toBe('old content that should be overwritten')
    expect(content).toContain('test-hook')
  })

  test('preserves existing YAML entries', async () => {
    // Write hook source in cache
    writeValidHook(installPath, 'hooks/test-hook.ts', 'test-hook')

    // Pre-vendor the hook
    const vendorPath = join(projectRoot, '.clooks', 'vendor', 'plugin', 'test-pack', 'test-hook.ts')
    mkdirSync(join(vendorPath, '..'), { recursive: true })
    writeFileSync(vendorPath, 'old content')

    // Pre-create config with existing entries
    const configDir = join(projectRoot, '.clooks')
    const originalConfig =
      'version: "1.0.0"\n\nexisting-hook:\n  uses: ./hooks/existing.ts\n\ntest-hook:\n  uses: ./.clooks/vendor/plugin/test-pack/test-hook.ts\n'
    writeFileSync(join(configDir, 'clooks.yml'), originalConfig)

    const pack = makePack({ installPath, scope: 'project' })
    const discoverFn = () => [pack]

    const result = await updatePluginPack('test-pack', projectRoot, homeRoot, discoverFn)

    expect(result.updated).toEqual(['test-hook'])
    expect(result.errors).toEqual([])

    // Verify existing YAML entries are preserved
    const configContent = readFileSync(join(configDir, 'clooks.yml'), 'utf-8')
    expect(configContent).toContain('existing-hook:')
    expect(configContent).toContain('uses: ./hooks/existing.ts')
    // Config should NOT have been modified (test-hook already existed)
    expect(configContent).toBe(originalConfig)
  })

  test('registers new hooks from updated manifest', async () => {
    // Write both hook sources in cache
    writeValidHook(installPath, 'hooks/test-hook.ts', 'test-hook')
    writeValidHook(installPath, 'hooks/new-hook.ts', 'new-hook')

    // Pre-vendor only the original hook
    const vendorDir = join(projectRoot, '.clooks', 'vendor', 'plugin', 'test-pack')
    mkdirSync(vendorDir, { recursive: true })
    writeFileSync(join(vendorDir, 'test-hook.ts'), 'old content')

    // Pre-create config with only the original hook
    const configDir = join(projectRoot, '.clooks')
    writeFileSync(
      join(configDir, 'clooks.yml'),
      'version: "1.0.0"\n\ntest-hook:\n  uses: ./.clooks/vendor/plugin/test-pack/test-hook.ts\n',
    )

    // Manifest now has both hooks
    const manifest = makeManifest({
      hooks: {
        'test-hook': {
          path: 'hooks/test-hook.ts',
          description: 'Original hook',
        },
        'new-hook': {
          path: 'hooks/new-hook.ts',
          description: 'Newly added hook',
        },
      },
    })

    const pack = makePack({ installPath, manifest, scope: 'project' })
    const discoverFn = () => [pack]

    const result = await updatePluginPack('test-pack', projectRoot, homeRoot, discoverFn)

    expect(result.updated).toEqual(['test-hook'])
    expect(result.registered).toEqual(['new-hook'])
    expect(result.skipped).toEqual([])
    expect(result.errors).toEqual([])

    // New hook file should be vendored
    expect(existsSync(join(vendorDir, 'new-hook.ts'))).toBe(true)

    // New hook should be registered in config
    const configContent = readFileSync(join(configDir, 'clooks.yml'), 'utf-8')
    expect(configContent).toContain('new-hook:')
    expect(configContent).toContain('uses: ./.clooks/vendor/plugin/test-pack/new-hook.ts')
  })

  test('handles missing plugin (error message)', async () => {
    const discoverFn = () => [] as DiscoveredPack[]

    const result = await updatePluginPack('nonexistent-pack', projectRoot, homeRoot, discoverFn)

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain(
      'No installed plugin found with pack name "nonexistent-pack"',
    )
    expect(result.updated).toEqual([])
    expect(result.registered).toEqual([])
  })

  test('invalid target format (not plugin:xxx) — pack name safety validation', async () => {
    // Test with unsafe pack name characters
    const result = await updatePluginPack('../../etc', projectRoot, homeRoot, () => [])

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('unsafe characters')
    expect(result.updated).toEqual([])
    expect(result.registered).toEqual([])
  })

  test('handles copy failure gracefully', async () => {
    // Don't create the source hook file — it won't exist
    const pack = makePack({ installPath, scope: 'project' })
    const discoverFn = () => [pack]

    const result = await updatePluginPack('test-pack', projectRoot, homeRoot, discoverFn)

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('test-hook')
    expect(result.errors[0]).toContain('copy failed')
    expect(result.updated).toEqual([])
    expect(result.registered).toEqual([])
  })

  test('collision detection for new hooks', async () => {
    // Write hook source in cache
    writeValidHook(installPath, 'hooks/colliding-hook.ts', 'colliding-hook')

    // Pre-create config with an existing hook that has the same name
    const configDir = join(projectRoot, '.clooks')
    mkdirSync(configDir, { recursive: true })
    writeFileSync(
      join(configDir, 'clooks.yml'),
      'version: "1.0.0"\n\ncolliding-hook:\n  uses: ./hooks/something-else.ts\n',
    )

    const manifest = makeManifest({
      hooks: {
        'colliding-hook': {
          path: 'hooks/colliding-hook.ts',
          description: 'A hook that collides',
        },
      },
    })

    const pack = makePack({ installPath, manifest, scope: 'project' })
    const discoverFn = () => [pack]

    const result = await updatePluginPack('test-pack', projectRoot, homeRoot, discoverFn)

    // Hook should be skipped because it's new (no vendor file existed) but name
    // already exists in config
    expect(result.skipped).toEqual(['colliding-hook'])
    expect(result.registered).toEqual([])
    expect(result.updated).toEqual([])

    // Config should NOT have a duplicate entry
    const configContent = readFileSync(join(configDir, 'clooks.yml'), 'utf-8')
    const matches = configContent.match(/colliding-hook:/g)
    expect(matches).toHaveLength(1) // only the original entry
  })

  test('pack name safety validation rejects unsafe names', async () => {
    // Names starting with uppercase
    const result1 = await updatePluginPack('BadName', projectRoot, homeRoot, () => [])
    expect(result1.errors).toHaveLength(1)
    expect(result1.errors[0]).toContain('unsafe characters')

    // Names with spaces
    const result2 = await updatePluginPack('bad name', projectRoot, homeRoot, () => [])
    expect(result2.errors).toHaveLength(1)
    expect(result2.errors[0]).toContain('unsafe characters')

    // Path traversal
    const result3 = await updatePluginPack('../escape', projectRoot, homeRoot, () => [])
    expect(result3.errors).toHaveLength(1)
    expect(result3.errors[0]).toContain('unsafe characters')
  })

  test('handles user scope correctly', async () => {
    writeValidHook(installPath, 'hooks/test-hook.ts', 'test-hook')

    // Pre-vendor at user scope
    const vendorPath = join(homeRoot, '.clooks', 'vendor', 'plugin', 'test-pack', 'test-hook.ts')
    mkdirSync(join(vendorPath, '..'), { recursive: true })
    writeFileSync(vendorPath, 'old user content')

    // Pre-create user config
    const configDir = join(homeRoot, '.clooks')
    writeFileSync(
      join(configDir, 'clooks.yml'),
      'version: "1.0.0"\n\ntest-hook:\n  uses: ./.clooks/vendor/plugin/test-pack/test-hook.ts\n',
    )

    const pack = makePack({ installPath, scope: 'user' })
    const discoverFn = () => [pack]

    const result = await updatePluginPack('test-pack', projectRoot, homeRoot, discoverFn)

    expect(result.updated).toEqual(['test-hook'])
    expect(result.errors).toEqual([])

    // User-scoped vendor path should be updated
    const content = readFileSync(vendorPath, 'utf-8')
    expect(content).not.toBe('old user content')
  })

  test('handles local scope config path correctly', async () => {
    writeValidHook(installPath, 'hooks/test-hook.ts', 'test-hook')

    // No pre-existing vendor file (new hook)
    // Pre-create local config
    const configDir = join(projectRoot, '.clooks')
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(configDir, 'clooks.local.yml'), 'version: "1.0.0"\n')

    const pack = makePack({ installPath, scope: 'local' })
    const discoverFn = () => [pack]

    const result = await updatePluginPack('test-pack', projectRoot, homeRoot, discoverFn)

    expect(result.registered).toEqual(['test-hook'])
    expect(result.errors).toEqual([])

    // Should have written to clooks.local.yml, not clooks.yml
    const localConfigContent = readFileSync(join(configDir, 'clooks.local.yml'), 'utf-8')
    expect(localConfigContent).toContain('test-hook:')
    expect(localConfigContent).toContain('uses: ./.clooks/vendor/plugin/test-pack/test-hook.ts')
  })

  test('creates config file if absent when registering new hooks', async () => {
    writeValidHook(installPath, 'hooks/test-hook.ts', 'test-hook')

    // No config or vendor directory exists
    const pack = makePack({ installPath, scope: 'project' })
    const discoverFn = () => [pack]

    const result = await updatePluginPack('test-pack', projectRoot, homeRoot, discoverFn)

    expect(result.registered).toEqual(['test-hook'])
    expect(result.errors).toEqual([])

    const configPath = join(projectRoot, '.clooks', 'clooks.yml')
    expect(existsSync(configPath)).toBe(true)
    const content = readFileSync(configPath, 'utf-8')
    expect(content).toContain('version: "1.0.0"')
    expect(content).toContain('test-hook:')
  })

  test('multiple new hooks registered in a single update', async () => {
    writeValidHook(installPath, 'hooks/hook-a.ts', 'hook-a')
    writeValidHook(installPath, 'hooks/hook-b.ts', 'hook-b')
    writeValidHook(installPath, 'hooks/hook-c.ts', 'hook-c')

    const manifest = makeManifest({
      hooks: {
        'hook-a': { path: 'hooks/hook-a.ts', description: 'Hook A' },
        'hook-b': { path: 'hooks/hook-b.ts', description: 'Hook B' },
        'hook-c': { path: 'hooks/hook-c.ts', description: 'Hook C' },
      },
    })

    const pack = makePack({ installPath, manifest, scope: 'project' })
    const discoverFn = () => [pack]

    const result = await updatePluginPack('test-pack', projectRoot, homeRoot, discoverFn)

    expect(result.registered.sort()).toEqual(['hook-a', 'hook-b', 'hook-c'])
    expect(result.errors).toEqual([])

    // All hooks should be in config without clobbering each other
    const configContent = readFileSync(join(projectRoot, '.clooks', 'clooks.yml'), 'utf-8')
    expect(configContent).toContain('hook-a:')
    expect(configContent).toContain('uses: ./.clooks/vendor/plugin/test-pack/hook-a.ts')
    expect(configContent).toContain('hook-b:')
    expect(configContent).toContain('uses: ./.clooks/vendor/plugin/test-pack/hook-b.ts')
    expect(configContent).toContain('hook-c:')
    expect(configContent).toContain('uses: ./.clooks/vendor/plugin/test-pack/hook-c.ts')
  })
})
