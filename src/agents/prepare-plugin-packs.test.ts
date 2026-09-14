import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { preparePluginPacks } from './prepare-plugin-packs.js'
import { claudeCodeAdapter } from './claude-code/adapter.js'
import { codexAdapter } from './codex/adapter.js'
import type { PrepareConfigAfterLoadInput } from './types.js'
import type { DiscoveredPack } from '../plugin-discovery.js'
import type { VendorResult } from '../plugin-vendor.js'
import type { HookName } from '../types/branded.js'

const pack: DiscoveredPack = {
  pluginName: 'test@market',
  scope: 'project',
  installPath: '/unused-cache',
  manifest: {
    version: 1,
    name: 'test-pack',
    hooks: { test: { path: 'test.ts', description: 'Test' } },
  },
}
let input: PrepareConfigAfterLoadInput
const empty: VendorResult = {
  registered: [],
  disabledHooks: [],
  skipped: [],
  collisions: [],
  errors: [],
}

beforeEach(() => {
  input = {
    projectRoot: '/unused-project',
    homeRoot: '/unused-home',
    codexHome: '/unused-codex',
    config: {
      version: '1.0.0',
      global: {
        timeout: 30000 as never,
        onError: 'block',
        maxFailures: 3,
        maxFailuresMessage: 'Failures',
        handoff: false,
      },
      hooks: {},
      events: {},
    },
    shadows: [],
    hasProjectConfig: false,
    loadConfig: mock(async () => null),
  }
})

describe('shared prepare/vendor/reload', () => {
  test('empty packs leave all config metadata unchanged without I/O', async () => {
    const vendor = mock(async () => empty)
    expect(await preparePluginPacks(input, [], vendor)).toEqual({
      config: input.config,
      shadows: input.shadows,
      hasProjectConfig: false,
      systemMessages: [],
    })
    expect(vendor).not.toHaveBeenCalled()
    expect(input.loadConfig).not.toHaveBeenCalled()
  })
  test('skips, collisions and errors do not trigger reload', async () => {
    const vendor = mock(async () => ({
      ...empty,
      skipped: ['old'],
      collisions: ['collision'],
      errors: ['error'],
    }))
    const result = await preparePluginPacks(input, [pack], vendor)
    expect(result.systemMessages).toEqual(['clooks: collision', 'clooks: error'])
    expect(input.loadConfig).not.toHaveBeenCalled()
    expect(vendor).toHaveBeenCalledWith(pack, input.projectRoot, input.homeRoot)
  })
  test('all packs vendor before a single reload; config, shadows and scope refresh together', async () => {
    const calls: string[] = []
    const config = { ...input.config, hooks: { added: {} } }
    const shadows = ['added' as HookName]
    input.loadConfig = mock(async (projectRoot, options) => {
      expect(projectRoot).toBe(input.projectRoot)
      expect(options).toEqual({ homeRoot: input.homeRoot })
      calls.push('reload')
      return { config, shadows, hasProjectConfig: true }
    })
    const vendor = mock(async () => {
      calls.push('vendor')
      return { ...empty, registered: ['added'] }
    })
    const result = await preparePluginPacks(input, [pack, pack], vendor)
    expect(calls).toEqual(['vendor', 'vendor', 'reload'])
    expect(result.config).toBe(config)
    expect(result.shadows).toBe(shadows)
    expect(result.hasProjectConfig).toBe(true)
    expect(result.systemMessages).toEqual(
      Array(2).fill('clooks: Registered 1 hook(s) from test-pack (plugin)'),
    )
  })
  for (const disabledHooks of [['disabled'], ['added', 'disabled']]) {
    test(`registration message distinguishes disabled hooks: ${disabledHooks}`, async () => {
      const result = await preparePluginPacks(input, [pack], async () => ({
        ...empty,
        registered: ['added', 'disabled'],
        disabledHooks,
      }))
      expect(result.systemMessages).toEqual([
        disabledHooks.length === 1
          ? 'clooks: Registered 2 hook(s) from test-pack (plugin): added (enabled); disabled (disabled -- enable in clooks.yml)'
          : 'clooks: Registered 2 hook(s) from test-pack (plugin): added, disabled (disabled -- enable in clooks.yml)',
      ])
      expect(result.hasProjectConfig).toBe(false)
    })
  }
  test('a later skip/error-only pack cannot reset the earlier registration reload', async () => {
    const second: DiscoveredPack = {
      ...pack,
      pluginName: 'second@market',
      installPath: '/second-cache',
      manifest: { ...pack.manifest, name: 'second-pack' },
    }
    const third: DiscoveredPack = {
      ...pack,
      pluginName: 'third@market',
      installPath: '/third-cache',
      manifest: { ...pack.manifest, name: 'third-pack' },
    }
    const calls: string[] = []
    const vendor = mock(
      async (candidate: DiscoveredPack, projectRoot: string, homeRoot: string) => {
        calls.push(candidate.pluginName)
        expect(projectRoot).toBe(input.projectRoot)
        expect(homeRoot).toBe(input.homeRoot)
        if (candidate === pack) return { ...empty, registered: ['added'] }
        if (candidate === second) return { ...empty, skipped: ['existing'] }
        return { ...empty, errors: ['third failed'] }
      },
    )
    input.loadConfig = mock(async () => {
      calls.push('reload')
      return { config: input.config, shadows: input.shadows, hasProjectConfig: true }
    })
    const result = await preparePluginPacks(input, [pack, second, third], vendor)
    expect(vendor.mock.calls).toEqual([
      [pack, input.projectRoot, input.homeRoot],
      [second, input.projectRoot, input.homeRoot],
      [third, input.projectRoot, input.homeRoot],
    ])
    expect(calls).toEqual(['test@market', 'second@market', 'third@market', 'reload'])
    expect(input.loadConfig).toHaveBeenCalledTimes(1)
    expect(result.hasProjectConfig).toBe(true)
    expect(result.systemMessages).toEqual([
      'clooks: Registered 1 hook(s) from test-pack (plugin)',
      'clooks: third failed',
    ])
  })
  for (const error of [new Error('reload error'), 'reload string']) {
    test(`reload failure retains all original metadata: ${error}`, async () => {
      input.loadConfig = mock(async () => {
        throw error
      })
      const result = await preparePluginPacks(input, [pack], async () => ({
        ...empty,
        registered: ['added'],
      }))
      expect(result.config).toBe(input.config)
      expect(result.shadows).toBe(input.shadows)
      expect(result.hasProjectConfig).toBe(false)
      expect(result.systemMessages[1]).toBe(
        `clooks: Config reload after plugin registration failed: ${error instanceof Error ? error.message : error}`,
      )
    })
  }
  test('vendor rejection remains visible to the caller', async () => {
    await expect(
      preparePluginPacks(input, [pack], async () => {
        throw new Error('vendor failure')
      }),
    ).rejects.toThrow('vendor failure')
    expect(input.loadConfig).not.toHaveBeenCalled()
  })
})

describe('adapter-owned discovery dependencies', () => {
  for (const adapter of [claudeCodeAdapter, codexAdapter]) {
    for (const dependency of ['discovery', 'vendor']) {
      test(`${adapter.id} missing ${dependency} never reaches fallback discovery or vendor`, async () => {
        const discovery = mock(() => [pack])
        const vendor = mock(async () => empty)
        input.discoverPluginPacks = discovery
        input.discoverCodexPluginPacks = discovery
        input.vendorAndRegisterPack = vendor
        if (dependency === 'vendor') delete input.vendorAndRegisterPack
        else if (adapter.id === 'codex') delete input.discoverCodexPluginPacks
        else delete input.discoverPluginPacks
        expect(await adapter.prepareConfigAfterLoad(input)).toEqual({
          config: input.config,
          shadows: input.shadows,
          hasProjectConfig: false,
          systemMessages: [],
        })
        expect(discovery).not.toHaveBeenCalled()
        expect(vendor).not.toHaveBeenCalled()
      })
    }
    test(`${adapter.id} selects only its own discovery with explicit roots`, async () => {
      const claude = mock(() => [pack])
      const codex = mock(() => [pack])
      input.discoverPluginPacks = claude
      input.discoverCodexPluginPacks = codex
      input.vendorAndRegisterPack = mock(async () => empty)
      await adapter.prepareConfigAfterLoad(input)
      expect(adapter.id === 'codex' ? claude : codex).not.toHaveBeenCalled()
      expect(adapter.id === 'codex' ? codex : claude).toHaveBeenCalledWith({
        projectRoot: input.projectRoot,
        homeRoot: input.homeRoot,
        ...(adapter.id === 'codex' ? { codexHome: input.codexHome } : {}),
      })
      expect(input.vendorAndRegisterPack).toHaveBeenCalledTimes(1)
    })
  }
})
