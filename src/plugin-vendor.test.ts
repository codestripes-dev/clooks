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

    const result = await vendorAndRegisterPack(pack, projectRoot, homeRoot)

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

    await vendorAndRegisterPack(pack, projectRoot, homeRoot)

    // Verify the full directory structure was created
    expect(existsSync(join(projectRoot, '.clooks', 'vendor', 'plugin', 'test-pack'))).toBe(true)
    expect(existsSync(join(projectRoot, '.clooks', 'clooks.yml'))).toBe(true)
  })

  test('writes correct YAML entry with uses path', async () => {
    writeValidHook(installPath, 'hooks/test-hook.ts', 'test-hook')

    const pack = makePack({ installPath, scope: 'project' })

    await vendorAndRegisterPack(pack, projectRoot, homeRoot)

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

    const result = await vendorAndRegisterPack(pack, projectRoot, homeRoot)

    expect(result.skipped).toEqual(['test-hook'])
    expect(result.registered).toEqual([])
    expect(result.errors).toEqual([])

    // Verify original content is preserved (not overwritten)
    expect(readFileSync(vendorPath, 'utf-8')).toBe('existing content')
  })

  test('detects name collision and skips without copying', async () => {
    writeValidHook(installPath, 'hooks/test-hook.ts', 'test-hook')

    // Pre-populate the target scope's yml with the hook name.  Collision
    // detection is scope-local: it reads this file and flags any name that
    // appears in it.
    const configDir = join(projectRoot, '.clooks')
    mkdirSync(configDir, { recursive: true })
    writeFileSync(
      join(configDir, 'clooks.yml'),
      'version: "1.0.0"\n\ntest-hook:\n  uses: ./hooks/existing.ts\n',
    )

    const pack = makePack({ installPath, scope: 'project' })

    const result = await vendorAndRegisterPack(pack, projectRoot, homeRoot)

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

    const result = await vendorAndRegisterPack(pack, projectRoot, homeRoot)

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

    const result = await vendorAndRegisterPack(pack, projectRoot, homeRoot)

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
    await vendorAndRegisterPack(pack, projectRoot, homeRoot)

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
    await vendorAndRegisterPack(projectPack, projectRoot, homeRoot)
    expect(
      existsSync(join(projectRoot, '.clooks', 'vendor', 'plugin', 'test-pack', 'test-hook.ts')),
    ).toBe(true)
    expect(existsSync(join(projectRoot, '.clooks', 'clooks.yml'))).toBe(true)

    // Clean for next test
    rmSync(join(projectRoot, '.clooks'), { recursive: true, force: true })

    // Test user scope
    const userPack = makePack({ installPath, scope: 'user' })
    await vendorAndRegisterPack(userPack, projectRoot, homeRoot)
    expect(
      existsSync(join(homeRoot, '.clooks', 'vendor', 'plugin', 'test-pack', 'test-hook.ts')),
    ).toBe(true)
    expect(existsSync(join(homeRoot, '.clooks', 'clooks.yml'))).toBe(true)

    // Clean for next test
    rmSync(join(homeRoot, '.clooks'), { recursive: true, force: true })

    // Test local scope
    const localPack = makePack({ installPath, scope: 'local' })
    await vendorAndRegisterPack(localPack, projectRoot, homeRoot)
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

    const result = await vendorAndRegisterPack(pack, projectRoot, homeRoot)

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
    await vendorAndRegisterPack(pack, projectRoot, homeRoot)

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

    const result = await vendorAndRegisterPack(pack, projectRoot, homeRoot)

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

    const result = await vendorAndRegisterPack(pack, projectRoot, homeRoot)

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('unsafe characters')
    expect(result.registered).toEqual([])
  })

  test('collision within the same batch is detected', async () => {
    // Two packs try to register the same hook name — simulate by calling twice.
    // The second call finds the vendor file already present → idempotent skip.
    writeValidHook(installPath, 'hooks/test-hook.ts', 'test-hook')

    const pack = makePack({ installPath, scope: 'project' })

    // First call succeeds
    const result1 = await vendorAndRegisterPack(pack, projectRoot, homeRoot)
    expect(result1.registered).toEqual(['test-hook'])

    // Second call — now the hook is already vendored (skipped) and name exists
    const result2 = await vendorAndRegisterPack(pack, projectRoot, homeRoot)
    expect(result2.skipped).toEqual(['test-hook'])
    expect(result2.registered).toEqual([])
  })

  test('registers hook with enabled: false when autoEnable is false', async () => {
    writeValidHook(installPath, 'hooks/test-hook.ts', 'test-hook')

    const manifest = makeManifest({
      hooks: {
        'test-hook': {
          path: 'hooks/test-hook.ts',
          description: 'A test hook',
          autoEnable: false,
        },
      },
    })

    const pack = makePack({ installPath, manifest })
    const result = await vendorAndRegisterPack(pack, projectRoot, homeRoot)

    expect(result.registered).toEqual(['test-hook'])
    expect(result.disabledHooks).toEqual(['test-hook'])

    const configPath = join(projectRoot, '.clooks', 'clooks.yml')
    const configContent = readFileSync(configPath, 'utf-8')
    expect(configContent).toContain('enabled: false')
  })

  test('registers hook without enabled field when autoEnable is true', async () => {
    writeValidHook(installPath, 'hooks/test-hook.ts', 'test-hook')

    const manifest = makeManifest({
      hooks: {
        'test-hook': {
          path: 'hooks/test-hook.ts',
          description: 'A test hook',
          autoEnable: true,
        },
      },
    })

    const pack = makePack({ installPath, manifest })
    const result = await vendorAndRegisterPack(pack, projectRoot, homeRoot)

    expect(result.registered).toEqual(['test-hook'])
    expect(result.disabledHooks).toEqual([])

    const configPath = join(projectRoot, '.clooks', 'clooks.yml')
    const configContent = readFileSync(configPath, 'utf-8')
    expect(configContent).not.toContain('enabled:')
  })

  test('registers hook without enabled field when autoEnable is omitted', async () => {
    writeValidHook(installPath, 'hooks/test-hook.ts', 'test-hook')

    const pack = makePack({ installPath, scope: 'project' })
    const result = await vendorAndRegisterPack(pack, projectRoot, homeRoot)

    expect(result.registered).toEqual(['test-hook'])
    expect(result.disabledHooks).toEqual([])

    const configPath = join(projectRoot, '.clooks', 'clooks.yml')
    const configContent = readFileSync(configPath, 'utf-8')
    expect(configContent).not.toContain('enabled:')
  })

  test('mixed pack: some hooks enabled, some disabled', async () => {
    writeValidHook(installPath, 'hooks/hook-a.ts', 'hook-a')
    writeValidHook(installPath, 'hooks/hook-b.ts', 'hook-b')

    const manifest = makeManifest({
      hooks: {
        'hook-a': {
          path: 'hooks/hook-a.ts',
          description: 'Enabled hook',
        },
        'hook-b': {
          path: 'hooks/hook-b.ts',
          description: 'Disabled hook',
          autoEnable: false,
        },
      },
    })

    const pack = makePack({ installPath, manifest })
    const result = await vendorAndRegisterPack(pack, projectRoot, homeRoot)

    expect(result.registered.sort()).toEqual(['hook-a', 'hook-b'])
    expect(result.disabledHooks).toEqual(['hook-b'])

    const configPath = join(projectRoot, '.clooks', 'clooks.yml')
    const configContent = readFileSync(configPath, 'utf-8')

    // hook-a should NOT have enabled: false
    const hookABlock = configContent.split('hook-a:')[1]!.split('hook-b:')[0]!
    expect(hookABlock).not.toContain('enabled:')

    // hook-b SHOULD have enabled: false
    const hookBBlock = configContent.split('hook-b:')[1]!
    expect(hookBBlock).toContain('enabled: false')
  })

  test('disabledHooks array populated correctly', async () => {
    writeValidHook(installPath, 'hooks/hook-a.ts', 'hook-a')
    writeValidHook(installPath, 'hooks/hook-b.ts', 'hook-b')
    writeValidHook(installPath, 'hooks/hook-c.ts', 'hook-c')

    const manifest = makeManifest({
      hooks: {
        'hook-a': {
          path: 'hooks/hook-a.ts',
          description: 'Enabled hook',
        },
        'hook-b': {
          path: 'hooks/hook-b.ts',
          description: 'Disabled hook',
          autoEnable: false,
        },
        'hook-c': {
          path: 'hooks/hook-c.ts',
          description: 'Another disabled hook',
          autoEnable: false,
        },
      },
    })

    const pack = makePack({ installPath, manifest })
    const result = await vendorAndRegisterPack(pack, projectRoot, homeRoot)

    expect(result.disabledHooks.sort()).toEqual(['hook-b', 'hook-c'])
    // Only disabled hooks appear in disabledHooks
    expect(result.disabledHooks).not.toContain('hook-a')
  })
})

/**
 * Cross-scope collision semantics.
 *
 * A hook name registered at one scope (e.g. project) must not cause a collision
 * when the same-or-different plugin tries to register that name at a different
 * scope (e.g. user). Cross-scope same-name is a shadow, not a collision — the
 * existing three-layer merge machinery handles shadows at load time.
 *
 * Collisions only apply within a single scope's yml.
 */
describe('vendorAndRegisterPack — cross-scope collision semantics', () => {
  let tempDir: string
  let projectRoot: string
  let homeRoot: string
  let installPath: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'clooks-vendor-xscope-test-'))
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

  test('cross-scope same-plugin install succeeds (project first, then user)', async () => {
    // Pre-populate project yml and vendor dir as if a project-scope install already ran.
    writeValidHook(installPath, 'hooks/no-bare-mv.ts', 'no-bare-mv')

    const projectConfigDir = join(projectRoot, '.clooks')
    mkdirSync(projectConfigDir, { recursive: true })
    writeFileSync(
      join(projectConfigDir, 'clooks.yml'),
      'version: "1.0.0"\n\nno-bare-mv:\n  uses: ./.clooks/vendor/plugin/test-pack/no-bare-mv.ts\n',
    )
    const projectVendorDir = join(projectConfigDir, 'vendor', 'plugin', 'test-pack')
    mkdirSync(projectVendorDir, { recursive: true })
    writeFileSync(
      join(projectVendorDir, 'no-bare-mv.ts'),
      `export const hook = { meta: { name: 'no-bare-mv' }, PreToolUse: () => ({ decision: 'continue' }) }\n`,
    )

    const manifest = makeManifest({
      hooks: {
        'no-bare-mv': { path: 'hooks/no-bare-mv.ts', description: 'Block bare mv' },
      },
    })

    // Now try to install the same plugin at user scope. The user-scope yml
    // is empty; the project-scope yml already has "no-bare-mv". Collision
    // detection must be scope-local and ignore the project entry.
    const userPack = makePack({ installPath, manifest, scope: 'user' })

    const result = await vendorAndRegisterPack(userPack, projectRoot, homeRoot)

    // User-scope vendoring must NOT treat cross-scope same-name as a collision.
    expect(result.collisions).toEqual([])
    expect(result.errors).toEqual([])
    expect(result.registered).toEqual(['no-bare-mv'])

    // User-scope vendor file was written.
    expect(
      existsSync(join(homeRoot, '.clooks', 'vendor', 'plugin', 'test-pack', 'no-bare-mv.ts')),
    ).toBe(true)

    // User-scope yml was written and contains the entry.
    const userYml = readFileSync(join(homeRoot, '.clooks', 'clooks.yml'), 'utf-8')
    expect(userYml).toContain('no-bare-mv:')
    expect(userYml).toContain('uses: ./.clooks/vendor/plugin/test-pack/no-bare-mv.ts')

    // Project yml is untouched.
    const projectYml = readFileSync(join(projectConfigDir, 'clooks.yml'), 'utf-8')
    expect(projectYml).toContain('no-bare-mv:')
    expect(projectYml).toContain('uses: ./.clooks/vendor/plugin/test-pack/no-bare-mv.ts')
  })

  test('cross-scope same-name different-plugin is a shadow, not a collision', async () => {
    // Project yml has "shared-hook" from plugin A.
    const projectConfigDir = join(projectRoot, '.clooks')
    mkdirSync(projectConfigDir, { recursive: true })
    writeFileSync(
      join(projectConfigDir, 'clooks.yml'),
      'version: "1.0.0"\n\nshared-hook:\n  uses: ./.clooks/vendor/plugin/plugin-a/shared-hook.ts\n',
    )

    // Plugin B (different pack name) defines the same hook name and is installed
    // at user scope. User-scope yml does not contain "shared-hook".
    writeValidHook(installPath, 'hooks/shared-hook.ts', 'shared-hook')
    const pluginBManifest = makeManifest({
      name: 'plugin-b',
      hooks: {
        'shared-hook': { path: 'hooks/shared-hook.ts', description: 'B version' },
      },
    })
    const userPack = makePack({ installPath, manifest: pluginBManifest, scope: 'user' })

    const result = await vendorAndRegisterPack(userPack, projectRoot, homeRoot)

    // Cross-scope → shadow, not collision.
    expect(result.collisions).toEqual([])
    expect(result.errors).toEqual([])
    expect(result.registered).toEqual(['shared-hook'])

    expect(
      existsSync(join(homeRoot, '.clooks', 'vendor', 'plugin', 'plugin-b', 'shared-hook.ts')),
    ).toBe(true)
  })

  test('same-scope same-name different-plugin IS a true collision', async () => {
    // User yml already registers "shared-hook" from plugin A.
    const userConfigDir = join(homeRoot, '.clooks')
    mkdirSync(userConfigDir, { recursive: true })
    writeFileSync(
      join(userConfigDir, 'clooks.yml'),
      'version: "1.0.0"\n\nshared-hook:\n  uses: ./.clooks/vendor/plugin/plugin-a/shared-hook.ts\n',
    )

    // Plugin B installs at user scope and tries to register the same name.
    writeValidHook(installPath, 'hooks/shared-hook.ts', 'shared-hook')
    const pluginBManifest = makeManifest({
      name: 'plugin-b',
      hooks: {
        'shared-hook': { path: 'hooks/shared-hook.ts', description: 'B version' },
      },
    })
    const userPack = makePack({ installPath, manifest: pluginBManifest, scope: 'user' })

    // User-scope yml already has shared-hook → true collision.
    const result = await vendorAndRegisterPack(userPack, projectRoot, homeRoot)

    expect(result.collisions).toHaveLength(1)
    expect(result.collisions[0]).toContain('shared-hook')
    expect(result.collisions[0]).toContain('conflicts')
    expect(result.registered).toEqual([])

    // Plugin B vendor file must not have been written.
    expect(
      existsSync(join(homeRoot, '.clooks', 'vendor', 'plugin', 'plugin-b', 'shared-hook.ts')),
    ).toBe(false)
  })

  test('same-scope same-plugin reinstall is idempotent (skip)', async () => {
    writeValidHook(installPath, 'hooks/no-bare-mv.ts', 'no-bare-mv')

    // Pre-populate user yml and vendor dir to simulate a prior user-scope install.
    const userConfigDir = join(homeRoot, '.clooks')
    mkdirSync(userConfigDir, { recursive: true })
    writeFileSync(
      join(userConfigDir, 'clooks.yml'),
      'version: "1.0.0"\n\nno-bare-mv:\n  uses: ./.clooks/vendor/plugin/test-pack/no-bare-mv.ts\n',
    )
    const userVendorDir = join(userConfigDir, 'vendor', 'plugin', 'test-pack')
    mkdirSync(userVendorDir, { recursive: true })
    const existingVendorPath = join(userVendorDir, 'no-bare-mv.ts')
    writeFileSync(
      existingVendorPath,
      `export const hook = { meta: { name: 'no-bare-mv' }, PreToolUse: () => ({ decision: 'continue' }) }\n`,
    )

    const manifest = makeManifest({
      hooks: {
        'no-bare-mv': { path: 'hooks/no-bare-mv.ts', description: 'Block bare mv' },
      },
    })
    const userPack = makePack({ installPath, manifest, scope: 'user' })

    // User-scope yml + vendor file already present → idempotent skip.
    const result = await vendorAndRegisterPack(userPack, projectRoot, homeRoot)

    // Existing vendor file means skip path, NOT collision.
    expect(result.skipped).toEqual(['no-bare-mv'])
    expect(result.registered).toEqual([])
    expect(result.collisions).toEqual([])
    expect(result.errors).toEqual([])
  })
})
