import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { Command } from 'commander'
import * as platform from '../platform.js'
import * as discovery from '../plugin-discovery.js'
import * as output from '../tui/output.js'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createUpdateCommand, updatePluginPack } from './update.js'
import type { DiscoveredPack, DiscoverOptions } from '../plugin-discovery.js'
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

describe('clooks update command', () => {
  let root: string
  let home: string
  let cache: string
  let packs: DiscoveredPack[]
  let homeSpy: ReturnType<typeof spyOn>
  let discoverSpy: ReturnType<typeof spyOn>
  let exitSpy: ReturnType<typeof spyOn>
  let stdoutSpy: ReturnType<typeof spyOn>
  let outputSpies: ReturnType<typeof spyOn>[]

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'clooks-update-command-'))
    home = join(root, 'home')
    cache = join(root, 'cache')
    mkdirSync(home)
    mkdirSync(cache)
    packs = []
    homeSpy = spyOn(platform, 'getHomeDir').mockReturnValue(home)
    discoverSpy = spyOn(discovery, 'discoverPluginPacks').mockImplementation(() => packs)
    exitSpy = spyOn(process, 'exit').mockImplementation((): never => {
      throw new Error('process.exit called')
    })
    stdoutSpy = spyOn(process.stdout, 'write').mockReturnValue(true)
    outputSpies = (
      ['printIntro', 'printOutro', 'printSuccess', 'printWarning', 'printInfo'] as const
    ).map((name) => spyOn(output, name).mockImplementation(() => {}))
    const printError = output.printError
    outputSpies.push(
      spyOn(output, 'printError').mockImplementation((ctx, command, message) => {
        if (ctx.json) printError(ctx, command, message)
      }),
    )
  })

  afterEach(() => {
    homeSpy.mockRestore()
    discoverSpy.mockRestore()
    exitSpy.mockRestore()
    stdoutSpy.mockRestore()
    for (const spy of outputSpies) spy.mockRestore()
    rmSync(root, { recursive: true, force: true })
  })

  function run(target = 'plugin:test-pack', json = false, findRoot = async () => root) {
    return new Command()
      .option('--json')
      .addCommand(createUpdateCommand(findRoot))
      .parseAsync([...(json ? ['--json'] : []), 'update', target], { from: 'user' })
  }

  function envelopes() {
    return stdoutSpy.mock.calls.map((call: unknown[]) => JSON.parse(String(call[0])))
  }

  for (const json of [false, true]) {
    test.each([
      ['test-pack', 'Expected format: plugin:<pack-name>'],
      ['plugin:', 'Missing pack name'],
    ])(`rejects malformed target %s before discovery; json=${json}`, async (target, message) => {
      await expect(run(target, json)).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(discoverSpy).not.toHaveBeenCalled()
      if (json) expect(envelopes()[0].error).toContain(message)
      else
        expect(output.printError).toHaveBeenCalledWith(
          { json: false },
          'update',
          expect.stringContaining(message),
        )
    })

    test(`reports a missing pack and exits unsuccessfully; json=${json}`, async () => {
      await expect(run('plugin:missing', json)).rejects.toThrow('process.exit called')
      expect(discoverSpy).toHaveBeenCalledWith({ homeRoot: home, projectRoot: root })
      if (json) expect(envelopes()[0]).toMatchObject({ ok: false, command: 'update' })
      else
        expect(output.printError).toHaveBeenCalledWith(
          { json: false },
          'update',
          expect.stringContaining('No installed plugin'),
        )
      expect(exitSpy).toHaveBeenCalledWith(1)
    })

    test(`reports updates, registrations, collisions and partial errors; json=${json}`, async () => {
      const hooks = Object.fromEntries(
        ['existing', 'fresh', 'collision', 'missing'].map((name) => [
          name,
          { path: `${name}.ts`, description: name },
        ]),
      )
      packs = [makePack({ installPath: cache, manifest: makeManifest({ hooks }) })]
      for (const name of ['existing', 'fresh', 'collision'])
        writeValidHook(cache, `${name}.ts`, name)
      const vendor = join(root, '.clooks/vendor/plugin/test-pack')
      mkdirSync(vendor, { recursive: true })
      writeFileSync(join(vendor, 'existing.ts'), 'old bytes')
      const original = 'version: "1.0.0"\ncollision:\n  uses: ./local.ts\n'
      writeFileSync(join(root, '.clooks/clooks.yml'), original)
      await run('plugin:test-pack', json)
      expect(exitSpy).not.toHaveBeenCalled()
      expect(readFileSync(join(vendor, 'existing.ts'), 'utf8')).toBe(
        readFileSync(join(cache, 'existing.ts'), 'utf8'),
      )
      expect(readFileSync(join(root, '.clooks/clooks.yml'), 'utf8')).toBe(
        original + '\nfresh:\n  uses: ./.clooks/vendor/plugin/test-pack/fresh.ts\n',
      )
      if (json) {
        expect(envelopes()[0]).toMatchObject({
          ok: true,
          command: 'update',
          data: { updated: ['existing'], registered: ['fresh'], skipped: ['collision'] },
        })
        expect(envelopes()[0].data.errors).toHaveLength(1)
        expect(envelopes()[0].data.errors[0]).toContain('missing: copy failed')
      } else {
        expect(output.printSuccess).toHaveBeenCalledWith(
          { json: false },
          'Updated 1 hook(s): existing',
        )
        expect(output.printSuccess).toHaveBeenCalledWith(
          { json: false },
          'Registered 1 new hook(s): fresh',
        )
        expect(output.printWarning).toHaveBeenCalledWith(
          { json: false },
          'Skipped 1 hook(s) due to name collision: collision',
        )
        expect(output.printError).toHaveBeenCalledWith(
          { json: false },
          'update',
          expect.stringContaining('missing: copy failed'),
        )
        expect(output.printOutro).toHaveBeenCalledWith({ json: false }, 'Done.')
      }
    })
  }

  test('reports no work when the discovered pack has no hook entries', async () => {
    packs = [makePack({ manifest: makeManifest({ hooks: {} }) })]
    await run()
    expect(output.printInfo).toHaveBeenCalledWith({ json: false }, 'Nothing to update.')
    expect(exitSpy).not.toHaveBeenCalled()
    expect(existsSync(join(root, '.clooks'))).toBe(false)
  })

  test.each([new Error('root unavailable'), 'root unavailable'])(
    'reports root discovery exceptions as JSON errors: %j',
    async (error) => {
      await expect(
        run('plugin:test-pack', true, async () => {
          throw error
        }),
      ).rejects.toThrow('process.exit called')
      expect(envelopes()).toEqual([{ ok: false, command: 'update', error: 'root unavailable' }])
      expect(discoverSpy).not.toHaveBeenCalled()
    },
  )

  test('reports root discovery exceptions in text mode before discovery', async () => {
    await expect(
      run('plugin:test-pack', false, async () => {
        throw new Error('root unavailable')
      }),
    ).rejects.toThrow('process.exit called')
    expect(output.printError).toHaveBeenCalledWith({ json: false }, 'update', 'root unavailable')
    expect(stdoutSpy).not.toHaveBeenCalled()
    expect(discoverSpy).not.toHaveBeenCalled()
    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})

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

  test.each(['export const invalid = true', 'throw "import failed"'])(
    'removes an invalid newly copied hook and leaves configuration unchanged: %s',
    async (source) => {
      writeFileSync(join(installPath, 'invalid.ts'), source)
      const config = join(projectRoot, '.clooks/clooks.yml')
      mkdirSync(join(projectRoot, '.clooks'))
      const original = 'version: "1.0.0"\n'
      writeFileSync(config, original)
      const pack = makePack({
        installPath,
        manifest: makeManifest({
          hooks: { invalid: { path: 'invalid.ts', description: 'Invalid hook' } },
        }),
      })
      const result = await updatePluginPack('test-pack', projectRoot, homeRoot, () => [pack])
      expect(result).toMatchObject({ updated: [], registered: [], skipped: [] })
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toContain('invalid: validation failed')
      expect(existsSync(join(projectRoot, '.clooks/vendor/plugin/test-pack/invalid.ts'))).toBe(
        false,
      )
      expect(readFileSync(config, 'utf8')).toBe(original)
    },
  )

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
    const discoverFn = (_opts?: DiscoverOptions) => [pack]

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
    const discoverFn = (_opts?: DiscoverOptions) => [pack]

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
    const discoverFn = (_opts?: DiscoverOptions) => [pack]

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
    const discoverFn = (_opts?: DiscoverOptions) => [] as DiscoveredPack[]

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
    const result = await updatePluginPack(
      '../../etc',
      projectRoot,
      homeRoot,
      (_opts?: DiscoverOptions) => [],
    )

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('unsafe characters')
    expect(result.updated).toEqual([])
    expect(result.registered).toEqual([])
  })

  test('handles copy failure gracefully', async () => {
    // Don't create the source hook file — it won't exist
    const pack = makePack({ installPath, scope: 'project' })
    const discoverFn = (_opts?: DiscoverOptions) => [pack]

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
    const discoverFn = (_opts?: DiscoverOptions) => [pack]

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
    const result1 = await updatePluginPack(
      'BadName',
      projectRoot,
      homeRoot,
      (_opts?: DiscoverOptions) => [],
    )
    expect(result1.errors).toHaveLength(1)
    expect(result1.errors[0]).toContain('unsafe characters')

    // Names with spaces
    const result2 = await updatePluginPack(
      'bad name',
      projectRoot,
      homeRoot,
      (_opts?: DiscoverOptions) => [],
    )
    expect(result2.errors).toHaveLength(1)
    expect(result2.errors[0]).toContain('unsafe characters')

    // Path traversal
    const result3 = await updatePluginPack(
      '../escape',
      projectRoot,
      homeRoot,
      (_opts?: DiscoverOptions) => [],
    )
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
    const discoverFn = (_opts?: DiscoverOptions) => [pack]

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
    const discoverFn = (_opts?: DiscoverOptions) => [pack]

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
    const discoverFn = (_opts?: DiscoverOptions) => [pack]

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
    const discoverFn = (_opts?: DiscoverOptions) => [pack]

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

  test('update registers new hook with enabled: false when autoEnable is false', async () => {
    // Write both hook sources in cache
    writeValidHook(installPath, 'hooks/test-hook.ts', 'test-hook')
    writeValidHook(installPath, 'hooks/new-disabled-hook.ts', 'new-disabled-hook')

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

    // Manifest now has both hooks, with the new one disabled
    const manifest = makeManifest({
      hooks: {
        'test-hook': {
          path: 'hooks/test-hook.ts',
          description: 'Original hook',
        },
        'new-disabled-hook': {
          path: 'hooks/new-disabled-hook.ts',
          description: 'New disabled hook',
          autoEnable: false,
        },
      },
    })

    const pack = makePack({ installPath, manifest, scope: 'project' })
    const discoverFn = (_opts?: DiscoverOptions) => [pack]

    const result = await updatePluginPack('test-pack', projectRoot, homeRoot, discoverFn)

    expect(result.updated).toEqual(['test-hook'])
    expect(result.registered).toEqual(['new-disabled-hook'])

    // New hook should have enabled: false in config
    const configContent = readFileSync(join(configDir, 'clooks.yml'), 'utf-8')
    expect(configContent).toContain('new-disabled-hook:')
    const hookBlock = configContent.split('new-disabled-hook:')[1]!
    expect(hookBlock).toContain('enabled: false')
  })

  test('update registers new hook without enabled when autoEnable is omitted', async () => {
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

    // Manifest now has both hooks, new one has no autoEnable
    const manifest = makeManifest({
      hooks: {
        'test-hook': {
          path: 'hooks/test-hook.ts',
          description: 'Original hook',
        },
        'new-hook': {
          path: 'hooks/new-hook.ts',
          description: 'New hook without autoEnable',
        },
      },
    })

    const pack = makePack({ installPath, manifest, scope: 'project' })
    const discoverFn = (_opts?: DiscoverOptions) => [pack]

    const result = await updatePluginPack('test-pack', projectRoot, homeRoot, discoverFn)

    expect(result.updated).toEqual(['test-hook'])
    expect(result.registered).toEqual(['new-hook'])

    // New hook should NOT have enabled: in its config block
    const configContent = readFileSync(join(configDir, 'clooks.yml'), 'utf-8')
    const hookBlock = configContent.split('new-hook:')[1]!
    expect(hookBlock).not.toContain('enabled:')
  })

  test('co-enable: same pack discovered at user and project scope vendors to both destinations', async () => {
    // Hook source lives in the shared install cache.
    writeValidHook(installPath, 'hooks/test-hook.ts', 'test-hook')

    // Two DiscoveredPack entries: same pack, different Claude-settings scopes.
    // Under the M2/M3 semantics this models a plugin enabled at BOTH user and
    // project Claude settings layers — both destinations must be vendored.
    const userPack = makePack({ installPath, scope: 'user' })
    const projectPack = makePack({ installPath, scope: 'project' })
    const discoverFn = (_opts?: DiscoverOptions) => [userPack, projectPack]

    const result = await updatePluginPack('test-pack', projectRoot, homeRoot, discoverFn)

    expect(result.errors).toEqual([])
    // Both scopes are "new" registrations because neither config/vendor-file exists yet.
    // Asserts the hook was registered twice (once per scope). The authoritative
    // per-scope check is the filesystem assertions below.
    expect(result.registered.sort()).toEqual(['test-hook', 'test-hook'])
    expect(result.skipped).toEqual([])

    // Vendor files exist at BOTH scopes.
    expect(
      existsSync(join(homeRoot, '.clooks', 'vendor', 'plugin', 'test-pack', 'test-hook.ts')),
    ).toBe(true)
    expect(
      existsSync(join(projectRoot, '.clooks', 'vendor', 'plugin', 'test-pack', 'test-hook.ts')),
    ).toBe(true)

    // Both clooks.yml files got an entry.
    const userYml = readFileSync(join(homeRoot, '.clooks', 'clooks.yml'), 'utf-8')
    expect(userYml).toContain('test-hook:')
    expect(userYml).toContain('uses: ./.clooks/vendor/plugin/test-pack/test-hook.ts')

    const projectYml = readFileSync(join(projectRoot, '.clooks', 'clooks.yml'), 'utf-8')
    expect(projectYml).toContain('test-hook:')
    expect(projectYml).toContain('uses: ./.clooks/vendor/plugin/test-pack/test-hook.ts')
  })
})
