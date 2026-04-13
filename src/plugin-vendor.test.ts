import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { vendorAndRegisterPack } from './plugin-vendor.js'
import type { DiscoveredPack } from './plugin-discovery.js'
import type { Manifest } from './manifest.js'

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

/**
 * Creates an invalid hook .ts file that does NOT export the expected shape.
 */
function writeInvalidHook(dir: string, relativePath: string): void {
  const absPath = join(dir, relativePath)
  mkdirSync(join(absPath, '..'), { recursive: true })
  writeFileSync(absPath, `export const notAHook = 42\n`)
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

describe('vendorAndRegisterPack', () => {
  let tempDir: string
  let projectRoot: string
  let homeRoot: string
  let installPath: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'clooks-vendor-test-'))
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

  test('copies hook file to correct vendor path', async () => {
    writeValidHook(installPath, 'hooks/test-hook.ts', 'test-hook')

    const pack = makePack({
      installPath,
      scope: 'project',
    })

    const result = await vendorAndRegisterPack(pack, projectRoot, homeRoot, new Set())

    expect(result.registered).toEqual(['test-hook'])
    expect(result.skipped).toEqual([])
    expect(result.collisions).toEqual([])
    expect(result.errors).toEqual([])

    const vendorPath = join(projectRoot, '.clooks', 'vendor', 'plugin', 'test-pack', 'test-hook.ts')
    expect(existsSync(vendorPath)).toBe(true)
  })

  test('creates directory structure if absent', async () => {
    writeValidHook(installPath, 'hooks/test-hook.ts', 'test-hook')

    const pack = makePack({ installPath, scope: 'project' })

    // No .clooks directory exists yet
    expect(existsSync(join(projectRoot, '.clooks'))).toBe(false)

    await vendorAndRegisterPack(pack, projectRoot, homeRoot, new Set())

    // Verify the full directory structure was created
    expect(existsSync(join(projectRoot, '.clooks', 'vendor', 'plugin', 'test-pack'))).toBe(true)
    expect(existsSync(join(projectRoot, '.clooks', 'clooks.yml'))).toBe(true)
  })

  test('writes correct YAML entry with uses path', async () => {
    writeValidHook(installPath, 'hooks/test-hook.ts', 'test-hook')

    const pack = makePack({ installPath, scope: 'project' })

    await vendorAndRegisterPack(pack, projectRoot, homeRoot, new Set())

    const configPath = join(projectRoot, '.clooks', 'clooks.yml')
    const configContent = readFileSync(configPath, 'utf-8')

    expect(configContent).toContain('test-hook:')
    expect(configContent).toContain('uses: ./.clooks/vendor/plugin/test-pack/test-hook.ts')
  })

  test('skips already-vendored hooks (idempotent)', async () => {
    writeValidHook(installPath, 'hooks/test-hook.ts', 'test-hook')

    // Pre-create the vendor file
    const vendorPath = join(projectRoot, '.clooks', 'vendor', 'plugin', 'test-pack', 'test-hook.ts')
    mkdirSync(join(vendorPath, '..'), { recursive: true })
    writeFileSync(vendorPath, 'existing content')

    const pack = makePack({ installPath, scope: 'project' })

    const result = await vendorAndRegisterPack(pack, projectRoot, homeRoot, new Set())

    expect(result.skipped).toEqual(['test-hook'])
    expect(result.registered).toEqual([])
    expect(result.errors).toEqual([])

    // Verify original content is preserved (not overwritten)
    expect(readFileSync(vendorPath, 'utf-8')).toBe('existing content')
  })

  test('detects name collision and skips without copying', async () => {
    writeValidHook(installPath, 'hooks/test-hook.ts', 'test-hook')

    const pack = makePack({ installPath, scope: 'project' })
    const existingHookNames = new Set(['test-hook'])

    const result = await vendorAndRegisterPack(pack, projectRoot, homeRoot, existingHookNames)

    expect(result.collisions).toHaveLength(1)
    expect(result.collisions[0]).toContain('test-hook')
    expect(result.collisions[0]).toContain('conflicts')
    expect(result.registered).toEqual([])
    // File was NOT copied because collision was detected before copying
    const vendorPath = join(projectRoot, '.clooks', 'vendor', 'plugin', 'test-pack', 'test-hook.ts')
    expect(existsSync(vendorPath)).toBe(false)
  })

  test('handles validation failure — deletes vendored file and reports error', async () => {
    writeInvalidHook(installPath, 'hooks/bad-hook.ts')

    const manifest = makeManifest({
      hooks: {
        'bad-hook': {
          path: 'hooks/bad-hook.ts',
          description: 'A bad hook',
        },
      },
    })

    const pack = makePack({ installPath, manifest })

    const result = await vendorAndRegisterPack(pack, projectRoot, homeRoot, new Set())

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('bad-hook')
    expect(result.errors[0]).toContain('validation failed')
    expect(result.registered).toEqual([])

    // Vendored file should have been deleted
    const vendorPath = join(projectRoot, '.clooks', 'vendor', 'plugin', 'test-pack', 'bad-hook.ts')
    expect(existsSync(vendorPath)).toBe(false)
  })

  test('handles copy failure (source file missing)', async () => {
    // Don't create the source file — it doesn't exist
    const pack = makePack({
      installPath,
      scope: 'project',
    })

    const result = await vendorAndRegisterPack(pack, projectRoot, homeRoot, new Set())

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('test-hook')
    expect(result.errors[0]).toContain('copy failed')
    expect(result.registered).toEqual([])
  })

  test('creates config file if absent', async () => {
    writeValidHook(installPath, 'hooks/test-hook.ts', 'test-hook')

    const configPath = join(projectRoot, '.clooks', 'clooks.yml')
    expect(existsSync(configPath)).toBe(false)

    const pack = makePack({ installPath, scope: 'project' })
    await vendorAndRegisterPack(pack, projectRoot, homeRoot, new Set())

    expect(existsSync(configPath)).toBe(true)
    const content = readFileSync(configPath, 'utf-8')
    expect(content).toContain('version: "1.0.0"')
    expect(content).toContain('test-hook:')
  })

  test('different vendor paths for user vs project vs local scope', async () => {
    // Set up a valid hook in the install path
    writeValidHook(installPath, 'hooks/test-hook.ts', 'test-hook')

    // Test project scope
    const projectPack = makePack({ installPath, scope: 'project' })
    await vendorAndRegisterPack(projectPack, projectRoot, homeRoot, new Set())
    expect(
      existsSync(join(projectRoot, '.clooks', 'vendor', 'plugin', 'test-pack', 'test-hook.ts')),
    ).toBe(true)
    expect(existsSync(join(projectRoot, '.clooks', 'clooks.yml'))).toBe(true)

    // Clean for next test
    rmSync(join(projectRoot, '.clooks'), { recursive: true, force: true })

    // Test user scope
    const userPack = makePack({ installPath, scope: 'user' })
    await vendorAndRegisterPack(userPack, projectRoot, homeRoot, new Set())
    expect(
      existsSync(join(homeRoot, '.clooks', 'vendor', 'plugin', 'test-pack', 'test-hook.ts')),
    ).toBe(true)
    expect(existsSync(join(homeRoot, '.clooks', 'clooks.yml'))).toBe(true)

    // Clean for next test
    rmSync(join(homeRoot, '.clooks'), { recursive: true, force: true })

    // Test local scope
    const localPack = makePack({ installPath, scope: 'local' })
    await vendorAndRegisterPack(localPack, projectRoot, homeRoot, new Set())
    expect(
      existsSync(join(projectRoot, '.clooks', 'vendor', 'plugin', 'test-pack', 'test-hook.ts')),
    ).toBe(true)
    // Local uses clooks.local.yml
    expect(existsSync(join(projectRoot, '.clooks', 'clooks.local.yml'))).toBe(true)
  })

  test('multiple hooks from same pack registered correctly', async () => {
    writeValidHook(installPath, 'hooks/hook-one.ts', 'hook-one')
    writeValidHook(installPath, 'hooks/hook-two.ts', 'hook-two')

    const manifest = makeManifest({
      hooks: {
        'hook-one': {
          path: 'hooks/hook-one.ts',
          description: 'First hook',
        },
        'hook-two': {
          path: 'hooks/hook-two.ts',
          description: 'Second hook',
        },
      },
    })

    const pack = makePack({ installPath, manifest })

    const result = await vendorAndRegisterPack(pack, projectRoot, homeRoot, new Set())

    expect(result.registered.sort()).toEqual(['hook-one', 'hook-two'])
    expect(result.errors).toEqual([])

    // Both files vendored
    expect(
      existsSync(join(projectRoot, '.clooks', 'vendor', 'plugin', 'test-pack', 'hook-one.ts')),
    ).toBe(true)
    expect(
      existsSync(join(projectRoot, '.clooks', 'vendor', 'plugin', 'test-pack', 'hook-two.ts')),
    ).toBe(true)

    // Both registered in config
    const configPath = join(projectRoot, '.clooks', 'clooks.yml')
    const content = readFileSync(configPath, 'utf-8')
    expect(content).toContain('hook-one:')
    expect(content).toContain('uses: ./.clooks/vendor/plugin/test-pack/hook-one.ts')
    expect(content).toContain('hook-two:')
    expect(content).toContain('uses: ./.clooks/vendor/plugin/test-pack/hook-two.ts')
  })

  test('preserves existing config content when appending', async () => {
    writeValidHook(installPath, 'hooks/test-hook.ts', 'test-hook')

    // Create a config file with existing content
    const configDir = join(projectRoot, '.clooks')
    mkdirSync(configDir, { recursive: true })
    writeFileSync(
      join(configDir, 'clooks.yml'),
      'version: "1.0.0"\n\nexisting-hook:\n  uses: ./hooks/existing.ts\n',
    )

    const pack = makePack({ installPath, scope: 'project' })
    await vendorAndRegisterPack(pack, projectRoot, homeRoot, new Set())

    const content = readFileSync(join(configDir, 'clooks.yml'), 'utf-8')
    // Existing content preserved
    expect(content).toContain('existing-hook:')
    expect(content).toContain('uses: ./hooks/existing.ts')
    // New content appended
    expect(content).toContain('test-hook:')
    expect(content).toContain('uses: ./.clooks/vendor/plugin/test-pack/test-hook.ts')
  })

  test('preserves .js extension from manifest path', async () => {
    // Create a .js hook file
    const hookPath = join(installPath, 'hooks', 'js-hook.js')
    mkdirSync(join(hookPath, '..'), { recursive: true })
    writeFileSync(
      hookPath,
      `export const hook = {
  meta: { name: 'js-hook' },
  PreToolUse: () => ({ decision: 'continue' }),
}
`,
    )

    const manifest = makeManifest({
      hooks: {
        'js-hook': {
          path: 'hooks/js-hook.js',
          description: 'A JS hook',
        },
      },
    })

    const pack = makePack({ installPath, manifest })

    const result = await vendorAndRegisterPack(pack, projectRoot, homeRoot, new Set())

    expect(result.registered).toEqual(['js-hook'])

    const vendorPath = join(projectRoot, '.clooks', 'vendor', 'plugin', 'test-pack', 'js-hook.js')
    expect(existsSync(vendorPath)).toBe(true)

    const configContent = readFileSync(join(projectRoot, '.clooks', 'clooks.yml'), 'utf-8')
    expect(configContent).toContain('uses: ./.clooks/vendor/plugin/test-pack/js-hook.js')
  })

  test('rejects pack name with unsafe characters (path traversal)', async () => {
    writeValidHook(installPath, 'hooks/test-hook.ts', 'test-hook')

    const manifest = makeManifest({ name: '../../etc' })
    const pack = makePack({ installPath, manifest })

    const result = await vendorAndRegisterPack(pack, projectRoot, homeRoot, new Set())

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('unsafe characters')
    expect(result.registered).toEqual([])
  })

  test('collision within the same batch is detected', async () => {
    // Two packs try to register the same hook name — simulate by calling twice
    // with the second call having the name in existingHookNames
    writeValidHook(installPath, 'hooks/test-hook.ts', 'test-hook')

    const pack = makePack({ installPath, scope: 'project' })

    // First call succeeds
    const result1 = await vendorAndRegisterPack(pack, projectRoot, homeRoot, new Set())
    expect(result1.registered).toEqual(['test-hook'])

    // Second call — now the hook is already vendored (skipped) and name exists
    const result2 = await vendorAndRegisterPack(pack, projectRoot, homeRoot, new Set(['test-hook']))
    expect(result2.skipped).toEqual(['test-hook'])
    expect(result2.registered).toEqual([])
  })
})
