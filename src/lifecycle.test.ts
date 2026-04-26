import { describe, test, expect } from 'bun:test'
import { buildBeforeHookEvent, buildAfterHookEvent, LifecycleMetaCache } from './lifecycle.js'
import type { HookEventMeta } from './types/lifecycle.js'
import type { HookName } from './types/branded.js'
import type { LoadedHook } from './loader.js'
import { VERSION } from './version.js'

const dummyMeta: HookEventMeta = {
  gitRoot: '/repo',
  gitBranch: 'main',
  platform: 'linux',
  hookName: 'test-hook',
  hookPath: '/repo/.clooks/hooks/test-hook.ts',
  timestamp: '2026-01-01T00:00:00.000Z',
  clooksVersion: '0.0.1',
  configPath: '/repo/.clooks/clooks.yml',
}

function makeDummyLoadedHook(name: string): LoadedHook {
  return {
    name: name as HookName,
    hook: { meta: { name } } as any,
    config: {},
    hookPath: `/repo/.clooks/hooks/${name}.ts`,
    configPath: '/repo/.clooks/clooks.yml',
  }
}

describe('buildBeforeHookEvent', () => {
  test('returns event with type, input, meta and lifecycle methods', () => {
    const event = buildBeforeHookEvent('PreToolUse', { toolName: 'Bash' }, dummyMeta)
    expect(event.type).toBe('PreToolUse')
    expect((event as any).input).toEqual({ toolName: 'Bash' })
    expect(event.meta).toBe(dummyMeta)
    expect(typeof (event as any).block).toBe('function')
    expect(typeof (event as any).skip).toBe('function')
    expect(typeof (event as any).passthrough).toBe('function')
    expect((event as any).respond).toBeUndefined()
  })

  test('block constructs a BlockResult', () => {
    const event = buildBeforeHookEvent('PreToolUse', { toolName: 'Bash' }, dummyMeta) as any
    expect(event.block({ reason: 'no' })).toEqual({ result: 'block', reason: 'no' })
  })

  test('skip constructs a SkipResult', () => {
    const event = buildBeforeHookEvent('PreToolUse', { toolName: 'Bash' }, dummyMeta) as any
    expect(event.skip()).toEqual({ result: 'skip' })
    expect(event.skip({ debugMessage: 'x' })).toEqual({ result: 'skip', debugMessage: 'x' })
  })

  test('passthrough constructs a LifecyclePassthroughResult', () => {
    const event = buildBeforeHookEvent('PreToolUse', { toolName: 'Bash' }, dummyMeta) as any
    expect(event.passthrough()).toEqual({ result: 'passthrough' })
    expect(event.passthrough({ debugMessage: 'x' })).toEqual({
      result: 'passthrough',
      debugMessage: 'x',
    })
  })
})

describe('buildAfterHookEvent', () => {
  test('returns event with type, input, handlerResult, meta and passthrough only', () => {
    const event = buildAfterHookEvent(
      'PreToolUse',
      { toolName: 'Bash' },
      { result: 'allow' },
      dummyMeta,
    )
    expect(event.type).toBe('PreToolUse')
    expect((event as any).input).toEqual({ toolName: 'Bash' })
    expect((event as any).handlerResult).toEqual({ result: 'allow' })
    expect(event.meta).toBe(dummyMeta)
    expect(typeof (event as any).passthrough).toBe('function')
    // afterHook is observer-only — no decision verbs
    expect((event as any).block).toBeUndefined()
    expect((event as any).skip).toBeUndefined()
    expect((event as any).respond).toBeUndefined()
  })

  test('passthrough constructs a LifecyclePassthroughResult', () => {
    const event = buildAfterHookEvent(
      'PreToolUse',
      { toolName: 'Bash' },
      { result: 'allow' },
      dummyMeta,
    ) as any
    expect(event.passthrough({ debugMessage: 'observed' })).toEqual({
      result: 'passthrough',
      debugMessage: 'observed',
    })
  })
})

describe('LifecycleMetaCache', () => {
  test('buildMeta returns correct HookEventMeta', async () => {
    const cache = new LifecycleMetaCache('2026-03-10T00:00:00.000Z')
    const hook = makeDummyLoadedHook('test-hook')
    const meta = await cache.buildMeta(hook)

    expect(meta.hookName).toBe('test-hook')
    expect(meta.hookPath).toBe('/repo/.clooks/hooks/test-hook.ts')
    expect(meta.configPath).toBe('/repo/.clooks/clooks.yml')
    expect(meta.timestamp).toBe('2026-03-10T00:00:00.000Z')
    expect(meta.clooksVersion).toBe(VERSION)
    expect(['darwin', 'linux']).toContain(meta.platform)
    expect(meta.gitRoot).toBeTypeOf('string')
    expect(meta.gitBranch).toBeTypeOf('string')
  })

  test('caches git values across multiple buildMeta calls', async () => {
    const cache = new LifecycleMetaCache()
    const hook1 = makeDummyLoadedHook('hook-1')
    const hook2 = makeDummyLoadedHook('hook-2')
    const meta1 = await cache.buildMeta(hook1)
    const meta2 = await cache.buildMeta(hook2)

    expect(meta1.gitRoot).toBe(meta2.gitRoot)
    expect(meta1.gitBranch).toBe(meta2.gitBranch)
    expect(meta1.hookName).toBe('hook-1')
    expect(meta2.hookName).toBe('hook-2')
  })
})
