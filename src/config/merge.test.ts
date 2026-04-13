import { describe, expect, test } from 'bun:test'
import { deepMerge, mergeConfigFiles, mergeThreeLayerConfig } from './merge.js'

describe('deepMerge', () => {
  test('scalar override', () => {
    expect(deepMerge({ a: 1 }, { a: 2 })).toEqual({ a: 2 })
  })

  test('new key added', () => {
    expect(deepMerge({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 })
  })

  test('nested object merge', () => {
    expect(deepMerge({ x: { a: 1, b: 2 } }, { x: { b: 3 } })).toEqual({
      x: { a: 1, b: 3 },
    })
  })

  test('array replacement', () => {
    expect(deepMerge({ arr: [1, 2] }, { arr: [3] })).toEqual({ arr: [3] })
  })

  test('null replaces object', () => {
    expect(deepMerge({ x: { a: 1 } }, { x: null })).toEqual({ x: null })
  })

  test('object replaces scalar', () => {
    expect(deepMerge({ x: 1 }, { x: { a: 2 } })).toEqual({ x: { a: 2 } })
  })

  test('deep nested merge (3 levels)', () => {
    expect(deepMerge({ a: { b: { c: 1, d: 2 }, e: 3 } }, { a: { b: { c: 99 } } })).toEqual({
      a: { b: { c: 99, d: 2 }, e: 3 },
    })
  })

  test('realistic config merge', () => {
    const base = {
      version: '1.0.0',
      'lint-guard': {
        config: { strict: true, blocked_tools: ['Bash'] },
      },
    }
    const local = {
      'lint-guard': {
        config: { strict: false },
      },
    }
    const result = deepMerge(base, local)
    expect(result).toEqual({
      version: '1.0.0',
      'lint-guard': {
        config: { strict: false, blocked_tools: ['Bash'] },
      },
    })
  })
})

describe('mergeConfigFiles', () => {
  test('undefined local returns base unchanged', () => {
    const base = { version: '1.0.0' }
    expect(mergeConfigFiles(base, undefined)).toBe(base)
  })
})

describe('mergeThreeLayerConfig', () => {
  test("home only → hooks have origin 'home'", () => {
    const home = {
      version: '1.0.0',
      'security-scanner': { config: { level: 'strict' } },
    }
    const result = mergeThreeLayerConfig(home, undefined, undefined)

    expect(result.originMap.get('security-scanner')).toBe('home')
    expect(result.shadows).toEqual([])
    expect(result.merged.version).toBe('1.0.0')
    expect(result.merged['security-scanner']).toEqual({ config: { level: 'strict' } })
  })

  test("project only → hooks have origin 'project'", () => {
    const project = {
      version: '1.0.0',
      'lint-guard': { config: { strict: true } },
    }
    const result = mergeThreeLayerConfig(undefined, project, undefined)

    expect(result.originMap.get('lint-guard')).toBe('project')
    expect(result.shadows).toEqual([])
  })

  test('home + project, no overlap → all hooks present, home first', () => {
    const home = {
      version: '1.0.0',
      'home-hook': {},
    }
    const project = {
      version: '1.0.0',
      'project-hook': {},
    }
    const result = mergeThreeLayerConfig(home, project, undefined)

    expect(result.originMap.get('home-hook')).toBe('home')
    expect(result.originMap.get('project-hook')).toBe('project')
    expect(result.shadows).toEqual([])
    // Both hooks should be in the merged output
    expect(result.merged['home-hook']).toEqual({})
    expect(result.merged['project-hook']).toEqual({})
  })

  test('home + project, same hook name → project shadows home', () => {
    const home = {
      version: '1.0.0',
      'shared-hook': { config: { from: 'home' } },
    }
    const project = {
      version: '1.0.0',
      'shared-hook': { config: { from: 'project' } },
    }
    const result = mergeThreeLayerConfig(home, project, undefined)

    expect(result.originMap.get('shared-hook')).toBe('project')
    expect(result.shadows).toEqual(['shared-hook'])
    expect(result.merged['shared-hook']).toEqual({ config: { from: 'project' } })
  })

  test('home + project + local override → local replaces atomically', () => {
    const home = {
      version: '1.0.0',
      'home-hook': { config: { x: 1, y: 2 } },
    }
    const project = {
      version: '1.0.0',
      'project-hook': { config: { a: 1 } },
    }
    const local = {
      'home-hook': { config: { x: 99 } },
    }
    const result = mergeThreeLayerConfig(home, project, local)

    // Local replaces home-hook atomically, origin stays "home"
    expect(result.merged['home-hook']).toEqual({ config: { x: 99 } })
    expect(result.originMap.get('home-hook')).toBe('home')
  })

  test('local can define new hooks not in home or project', () => {
    const project = {
      version: '1.0.0',
      'project-hook': {},
    }
    const local = {
      'new-hook': { config: { something: true } },
    }

    const result = mergeThreeLayerConfig(undefined, project, local)
    expect(result.merged['new-hook']).toEqual({ config: { something: true } })
  })

  test('home + project + local unified order → local replaces concatenated', () => {
    const home = {
      version: '1.0.0',
      'home-hook': {},
      PreToolUse: { order: ['home-hook'] },
    }
    const project = {
      version: '1.0.0',
      'project-hook': {},
      PreToolUse: { order: ['project-hook'] },
    }
    // Without local, event order should be concatenated: home-hook, project-hook
    const resultNoLocal = mergeThreeLayerConfig(home, project, undefined)
    expect((resultNoLocal.merged.PreToolUse as Record<string, unknown>).order).toEqual([
      'home-hook',
      'project-hook',
    ])

    // With local, event order replaces entirely
    const local = {
      PreToolUse: { order: ['project-hook', 'home-hook'] },
    }
    const resultWithLocal = mergeThreeLayerConfig(home, project, local)
    expect((resultWithLocal.merged.PreToolUse as Record<string, unknown>).order).toEqual([
      'project-hook',
      'home-hook',
    ])
  })

  test('config: section deep merges across all three', () => {
    const home = {
      version: '1.0.0',
      config: { timeout: 10000, onError: 'block' },
    }
    const project = {
      version: '1.0.0',
      config: { timeout: 20000 },
    }
    const local = {
      config: { onError: 'continue' },
    }
    const result = mergeThreeLayerConfig(home, project, local)

    expect(result.merged.config).toEqual({
      timeout: 20000,
      onError: 'continue',
    })
  })

  test('version last-writer-wins', () => {
    const home = { version: '1.0.0' }
    const project = { version: '2.0.0' }
    const local = { version: '3.0.0' }

    // project overrides home
    expect(mergeThreeLayerConfig(home, project, undefined).merged.version).toBe('2.0.0')

    // local overrides both
    expect(mergeThreeLayerConfig(home, project, local).merged.version).toBe('3.0.0')

    // local overrides home when no project
    expect(mergeThreeLayerConfig(home, undefined, local).merged.version).toBe('3.0.0')
  })

  test('scoping violation: home order references project hook → error', () => {
    const home = {
      version: '1.0.0',
      PreToolUse: { order: ['project-hook'] },
    }
    const project = {
      version: '1.0.0',
      'project-hook': {},
    }

    expect(() => mergeThreeLayerConfig(home, project, undefined)).toThrow(
      'home config event "PreToolUse" order references hook "project-hook" which is not defined in the home config',
    )
  })

  test('scoping violation: project order references home hook → error', () => {
    const home = {
      version: '1.0.0',
      'home-hook': {},
    }
    const project = {
      version: '1.0.0',
      PreToolUse: { order: ['home-hook'] },
    }

    expect(() => mergeThreeLayerConfig(home, project, undefined)).toThrow(
      'project config event "PreToolUse" order references hook "home-hook" which is not defined in the project config',
    )
  })

  test('local order references both → OK', () => {
    const home = {
      version: '1.0.0',
      'home-hook': {},
    }
    const project = {
      version: '1.0.0',
      'project-hook': {},
    }
    const local = {
      PreToolUse: { order: ['home-hook', 'project-hook'] },
    }

    // Should not throw
    const result = mergeThreeLayerConfig(home, project, local)
    expect((result.merged.PreToolUse as Record<string, unknown>).order).toEqual([
      'home-hook',
      'project-hook',
    ])
  })

  test('shadow + scoping: shadowed hook can be referenced by project order', () => {
    const home = {
      version: '1.0.0',
      'shared-hook': { config: { from: 'home' } },
    }
    const project = {
      version: '1.0.0',
      'shared-hook': { config: { from: 'project' } },
      PreToolUse: { order: ['shared-hook'] },
    }

    const result = mergeThreeLayerConfig(home, project, undefined)
    expect(result.shadows).toEqual(['shared-hook'])
    expect(result.originMap.get('shared-hook')).toBe('project')
    expect((result.merged.PreToolUse as Record<string, unknown>).order).toEqual(['shared-hook'])
  })

  test('shadow + scoping: home can reference hook that gets shadowed', () => {
    const home = {
      version: '1.0.0',
      'shared-hook': { config: { from: 'home' } },
      PreToolUse: { order: ['shared-hook'] },
    }
    const project = {
      version: '1.0.0',
      'shared-hook': { config: { from: 'project' } },
    }

    // Home order references shared-hook, which exists in home — valid
    const result = mergeThreeLayerConfig(home, project, undefined)
    expect(result.shadows).toEqual(['shared-hook'])
    // Event order is concatenated: home order comes first
    expect((result.merged.PreToolUse as Record<string, unknown>).order).toEqual(['shared-hook'])
  })

  test('events from different layers with no order get merged', () => {
    const home = {
      version: '1.0.0',
      'home-hook': {},
      PreToolUse: { order: ['home-hook'] },
    }
    const project = {
      version: '1.0.0',
      'project-hook': {},
      PostToolUse: { order: ['project-hook'] },
    }

    const result = mergeThreeLayerConfig(home, project, undefined)
    expect((result.merged.PreToolUse as Record<string, unknown>).order).toEqual(['home-hook'])
    expect((result.merged.PostToolUse as Record<string, unknown>).order).toEqual(['project-hook'])
  })

  test('all undefined layers returns empty result', () => {
    const result = mergeThreeLayerConfig(undefined, undefined, undefined)
    expect(result.merged).toEqual({})
    expect(result.originMap.size).toBe(0)
    expect(result.shadows).toEqual([])
  })

  test('Empty hook entry ({}) in project shadows home hook with config → home config gone', () => {
    const home = {
      version: '1.0.0',
      'security-hook': { config: { level: 'strict' } },
    }
    const project = {
      version: '1.0.0',
      'security-hook': {},
    }
    const result = mergeThreeLayerConfig(home, project, undefined)

    // Project's {} replaces home's config atomically — no merge
    expect(result.merged['security-hook']).toEqual({})
    expect(result.shadows).toEqual(['security-hook'])
  })

  test('Shadow + scoping: project references hook name in order but does NOT define it → error', () => {
    const home = {
      version: '1.0.0',
      'security-audit': { config: { level: 'strict' } },
    }
    const project = {
      version: '1.0.0',
      PreToolUse: { order: ['security-audit'] },
    }

    expect(() => mergeThreeLayerConfig(home, project, undefined)).toThrow(
      'project config event "PreToolUse" order references hook "security-audit" which is not defined in the project config',
    )
  })

  test('local config defines new hook not in home or project → succeeds', () => {
    const project = {
      version: '1.0.0',
      'project-hook': {},
    }
    const local = {
      'brand-new-hook': { config: { something: true } },
    }

    const result = mergeThreeLayerConfig(undefined, project, local)
    expect(result.merged['brand-new-hook']).toEqual({ config: { something: true } })
  })

  test("new hooks from local config get origin 'project'", () => {
    const project = {
      version: '1.0.0',
      'project-hook': {},
    }
    const local = {
      'new-hook': { config: { value: 42 } },
    }

    const result = mergeThreeLayerConfig(undefined, project, local)
    expect(result.originMap.get('new-hook')).toBe('project')
  })

  test("local-only config with new hooks → hooks get origin 'project'", () => {
    const local = {
      'standalone-hook': { config: { x: 1 } },
    }
    const result = mergeThreeLayerConfig(undefined, undefined, local)
    expect(result.merged['standalone-hook']).toEqual({ config: { x: 1 } })
    expect(result.originMap.get('standalone-hook')).toBe('project')
  })

  test('homeHookUses tracks original home hook uses before local override', () => {
    const home = {
      version: '1.0.0',
      'home-hook': { uses: './custom/home-hook.ts' },
    }
    const local = {
      'home-hook': { uses: './overridden/path.ts' },
    }
    const result = mergeThreeLayerConfig(home, undefined, local)

    // homeHookUses should have the ORIGINAL home uses, not the local override
    expect(result.homeHookUses.get('home-hook')).toBe('./custom/home-hook.ts')
    // merged should have the local override
    expect((result.merged['home-hook'] as Record<string, unknown>).uses).toBe(
      './overridden/path.ts',
    )
  })

  test('homeHookUses is undefined when home hook has no explicit uses', () => {
    const home = {
      version: '1.0.0',
      'home-hook': {},
    }
    const result = mergeThreeLayerConfig(home, undefined, undefined)

    expect(result.homeHookUses.get('home-hook')).toBeUndefined()
  })

  test('non-string element (number) in home order → throws', () => {
    const home = {
      version: '1.0.0',
      'home-hook': {},
      PreToolUse: { order: [1, 'home-hook'] },
    }

    expect(() => mergeThreeLayerConfig(home, undefined, undefined)).toThrow(
      'invalid element at index 0',
    )
    expect(() => mergeThreeLayerConfig(home, undefined, undefined)).toThrow('got number')
  })

  test('null element in home order → throws', () => {
    const home = {
      version: '1.0.0',
      'home-hook': {},
      PreToolUse: { order: ['home-hook', null] },
    }

    expect(() => mergeThreeLayerConfig(home, undefined, undefined)).toThrow(
      'invalid element at index 1',
    )
    expect(() => mergeThreeLayerConfig(home, undefined, undefined)).toThrow('got null')
  })

  test('empty-string element in home order → throws', () => {
    const home = {
      version: '1.0.0',
      'home-hook': {},
      PreToolUse: { order: [''] },
    }

    expect(() => mergeThreeLayerConfig(home, undefined, undefined)).toThrow(
      'invalid element at index 0',
    )
    expect(() => mergeThreeLayerConfig(home, undefined, undefined)).toThrow('got empty string')
  })
})
