import { describe, expect, it, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { executeHooks, reducePreToolUseVotes } from './index.js'
import type { LoadedHook } from '../loader.js'
import type { ClooksHook } from '../types/hook.js'
import type { ClooksConfig, HookEntry, ErrorMode } from '../config/schema.js'
import type { HookName } from '../types/branded.js'
import { hn, ms } from '../test-utils.js'
import { DEFAULT_MAX_FAILURES_MESSAGE } from '../config/constants.js'

let tempDir: string

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

function makeTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), 'clooks-patchmerge-test-'))
  mkdirSync(join(tempDir, '.clooks'), { recursive: true })
  return tempDir
}

function fp(dir: string): string {
  return join(dir, '.clooks/.failures')
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
function makeLoadedHook(name: string, handlers: Record<string, Function>): LoadedHook {
  const hookName = hn(name)
  const hook = {
    meta: { name: hookName },
    ...handlers,
  } as unknown as ClooksHook
  return {
    name: hookName,
    hook,
    config: {},
    hookPath: `/test/hooks/${name}.ts`,
    configPath: '/test/.clooks/clooks.yml',
  }
}

function makeTestConfig(
  hookOverrides: Record<
    string,
    {
      parallel?: boolean
      maxFailures?: number
      maxFailuresMessage?: string
      onError?: ErrorMode
    }
  > = {},
  globalMaxFailures = 3,
  globalOnError: ErrorMode = 'block',
): ClooksConfig {
  const hooks = {} as Record<HookName, HookEntry>
  for (const [name, overrides] of Object.entries(hookOverrides)) {
    hooks[hn(name)] = {
      resolvedPath: `.clooks/hooks/${name}.ts`,
      config: {},
      parallel: false,
      origin: 'project',
      ...overrides,
    }
  }
  return {
    version: '1.0.0',
    global: {
      timeout: ms(30000),
      onError: globalOnError,
      maxFailures: globalMaxFailures,
      maxFailuresMessage: DEFAULT_MAX_FAILURES_MESSAGE,
    },
    hooks,
    events: {},
  }
}

describe('sequential PreToolUse patch-merge', () => {
  it('single hook: patch merges onto running toolInput (original fields preserved)', async () => {
    const dir = makeTempDir()
    const hook = makeLoadedHook('rewrite', {
      PreToolUse: () => ({ result: 'allow', updatedInput: { command: 'echo ok' } }),
    })
    const config = makeTestConfig({ rewrite: {} })
    const normalized = {
      event: 'PreToolUse',
      toolInput: { command: 'echo original', timeout: 5000 },
    }

    const result = await executeHooks([hook], 'PreToolUse', normalized, config, fp(dir))
    expect(result.lastResult?.result).toBe('allow')
    expect(result.lastResult?.updatedInput).toEqual({ command: 'echo ok', timeout: 5000 })
  })

  it('sequential chain composes two partial patches (A patches timeout, B patches description)', async () => {
    const dir = makeTempDir()
    const hookA = makeLoadedHook('hookA', {
      PreToolUse: () => ({ result: 'allow', updatedInput: { timeout: 10000 } }),
    })
    const hookB = makeLoadedHook('hookB', {
      PreToolUse: () => ({ result: 'allow', updatedInput: { description: 'step' } }),
    })
    const config = makeTestConfig({ hookA: {}, hookB: {} })
    const normalized = { event: 'PreToolUse', toolInput: { command: 'echo original' } }

    const result = await executeHooks([hookA, hookB], 'PreToolUse', normalized, config, fp(dir))
    expect(result.lastResult?.result).toBe('allow')
    expect(result.lastResult?.updatedInput).toEqual({
      command: 'echo original',
      timeout: 10000,
      description: 'step',
    })
  })

  it('sequential composition threads the merge — hook B sees merge-so-far', async () => {
    const dir = makeTempDir()
    let capturedBCtx: Record<string, unknown> | undefined

    const hookA = makeLoadedHook('hookA', {
      PreToolUse: () => ({ result: 'allow', updatedInput: { timeout: 10000 } }),
    })
    const hookB = makeLoadedHook('hookB', {
      PreToolUse: (ctx: Record<string, unknown>) => {
        capturedBCtx = ctx
        return { result: 'allow' }
      },
    })
    const config = makeTestConfig({ hookA: {}, hookB: {} })
    const normalized = { event: 'PreToolUse', toolInput: { command: 'echo', timeout: 5000 } }

    await executeHooks([hookA, hookB], 'PreToolUse', normalized, config, fp(dir))
    // Hook B sees the merge-so-far: original + A's patch.
    expect(capturedBCtx?.toolInput).toEqual({ command: 'echo', timeout: 10000 })
    expect(capturedBCtx?.originalToolInput).toEqual({ command: 'echo', timeout: 5000 })
  })

  it('null unset: patch { timeout: null } removes the key from wire output', async () => {
    const dir = makeTempDir()
    const hook = makeLoadedHook('unset', {
      PreToolUse: () => ({ result: 'allow', updatedInput: { timeout: null } }),
    })
    const config = makeTestConfig({ unset: {} })
    const normalized = { event: 'PreToolUse', toolInput: { command: 'x', timeout: 5000 } }

    const result = await executeHooks([hook], 'PreToolUse', normalized, config, fp(dir))
    expect(result.lastResult?.result).toBe('allow')
    expect(result.lastResult?.updatedInput).toEqual({ command: 'x' })
    expect(result.lastResult?.updatedInput).not.toHaveProperty('timeout')
  })

  it('null + non-null mixed patch', async () => {
    const dir = makeTempDir()
    const hook = makeLoadedHook('mixed', {
      PreToolUse: () => ({
        result: 'allow',
        updatedInput: { description: 'new', timeout: null },
      }),
    })
    const config = makeTestConfig({ mixed: {} })
    const normalized = { event: 'PreToolUse', toolInput: { command: 'x', timeout: 5000 } }

    const result = await executeHooks([hook], 'PreToolUse', normalized, config, fp(dir))
    expect(result.lastResult?.updatedInput).toEqual({ command: 'x', description: 'new' })
    expect(result.lastResult?.updatedInput).not.toHaveProperty('timeout')
  })

  it('null-unset propagates as key-absent to subsequent hooks (not key-null)', async () => {
    const dir = makeTempDir()
    let capturedBCtx: Record<string, unknown> | undefined

    const hookA = makeLoadedHook('hookA', {
      PreToolUse: () => ({ result: 'allow', updatedInput: { timeout: null } }),
    })
    const hookB = makeLoadedHook('hookB', {
      PreToolUse: (ctx: Record<string, unknown>) => {
        capturedBCtx = ctx
        return { result: 'allow' }
      },
    })
    const config = makeTestConfig({ hookA: {}, hookB: {} })
    const normalized = { event: 'PreToolUse', toolInput: { command: 'x', timeout: 5000 } }

    await executeHooks([hookA, hookB], 'PreToolUse', normalized, config, fp(dir))
    const bInput = capturedBCtx?.toolInput as Record<string, unknown>
    expect('timeout' in bInput).toBe(false)
    expect(bInput.timeout).toBeUndefined()
    expect(bInput.timeout).not.toBeNull()
  })

  it('backwards compatibility: full-shape return produces identical wire output to patch-style', async () => {
    const dir1 = makeTempDir()
    const fullShape = makeLoadedHook('full', {
      PreToolUse: (ctx: Record<string, unknown>) => ({
        result: 'allow',
        updatedInput: {
          ...(ctx.toolInput as Record<string, unknown>),
          command: 'new',
        },
      }),
    })
    const config1 = makeTestConfig({ full: {} })
    const normalized1 = { event: 'PreToolUse', toolInput: { command: 'orig', timeout: 5000 } }
    const fullResult = await executeHooks([fullShape], 'PreToolUse', normalized1, config1, fp(dir1))

    rmSync(tempDir, { recursive: true, force: true })

    const dir2 = makeTempDir()
    const patchStyle = makeLoadedHook('patch', {
      PreToolUse: () => ({ result: 'allow', updatedInput: { command: 'new' } }),
    })
    const config2 = makeTestConfig({ patch: {} })
    const normalized2 = { event: 'PreToolUse', toolInput: { command: 'orig', timeout: 5000 } }
    const patchResult = await executeHooks(
      [patchStyle],
      'PreToolUse',
      normalized2,
      config2,
      fp(dir2),
    )

    // Assert against the literal first — otherwise two `undefined` results
    // would compare equal and pass vacuously.
    expect(fullResult.lastResult?.updatedInput).toEqual({ command: 'new', timeout: 5000 })
    expect(patchResult.lastResult?.updatedInput).toEqual({ command: 'new', timeout: 5000 })
    expect(fullResult.lastResult?.updatedInput).toEqual(patchResult.lastResult?.updatedInput)
  })

  it('two-hook last-writer-wins: A nulls timeout, B restores timeout → B wins', async () => {
    const dir = makeTempDir()
    const hookA = makeLoadedHook('hookA', {
      PreToolUse: () => ({ result: 'allow', updatedInput: { timeout: null } }),
    })
    const hookB = makeLoadedHook('hookB', {
      PreToolUse: () => ({ result: 'allow', updatedInput: { timeout: 10000 } }),
    })
    const config = makeTestConfig({ hookA: {}, hookB: {} })
    const normalized = { event: 'PreToolUse', toolInput: { command: 'x', timeout: 5000 } }

    const result = await executeHooks([hookA, hookB], 'PreToolUse', normalized, config, fp(dir))
    expect(result.lastResult?.result).toBe('allow')
    // B's non-null value wins because it runs after A.
    expect(result.lastResult?.updatedInput).toEqual({ command: 'x', timeout: 10000 })
  })

  it('two-hook last-writer-wins: A sets timeout, B nulls timeout → stripNulls at each step, key absent', async () => {
    const dir = makeTempDir()
    const hookA = makeLoadedHook('hookA', {
      PreToolUse: () => ({ result: 'allow', updatedInput: { timeout: 10000 } }),
    })
    const hookB = makeLoadedHook('hookB', {
      PreToolUse: () => ({ result: 'allow', updatedInput: { timeout: null } }),
    })
    const config = makeTestConfig({ hookA: {}, hookB: {} })
    const normalized = { event: 'PreToolUse', toolInput: { command: 'x', timeout: 5000 } }

    const result = await executeHooks([hookA, hookB], 'PreToolUse', normalized, config, fp(dir))
    expect(result.lastResult?.result).toBe('allow')
    // B's null wins: stripNulls is applied at each merge step. If it were
    // applied only at the end, A's value would be present for B to observe
    // before the final strip — but the key must be absent here.
    expect(result.lastResult?.updatedInput).toEqual({ command: 'x' })
    expect(result.lastResult?.updatedInput).not.toHaveProperty('timeout')
  })

  it('empty-object patch: single sequential hook returns updatedInput: {} → merged is base content', async () => {
    const dir = makeTempDir()
    const hook = makeLoadedHook('empty', {
      PreToolUse: () => ({ result: 'allow', updatedInput: {} }),
    })
    const config = makeTestConfig({ empty: {} })
    const normalized = { event: 'PreToolUse', toolInput: { command: 'x', timeout: 5000 } }

    const result = await executeHooks([hook], 'PreToolUse', normalized, config, fp(dir))
    expect(result.lastResult?.result).toBe('allow')
    // Empty patch is a no-op on content (reference may differ, wire payload equals base).
    expect(result.lastResult?.updatedInput).toEqual({ command: 'x', timeout: 5000 })
  })
})

describe('sequential PermissionRequest patch-merge', () => {
  it('single hook: patch merges onto running toolInput', async () => {
    const dir = makeTempDir()
    const hook = makeLoadedHook('rewrite', {
      PermissionRequest: () => ({ result: 'allow', updatedInput: { command: 'echo ok' } }),
    })
    const config = makeTestConfig({ rewrite: {} })
    const normalized = {
      event: 'PermissionRequest',
      toolInput: { command: 'echo original', timeout: 5000 },
    }

    const result = await executeHooks([hook], 'PermissionRequest', normalized, config, fp(dir))
    expect(result.lastResult?.result).toBe('allow')
    expect(result.lastResult?.updatedInput).toEqual({ command: 'echo ok', timeout: 5000 })
  })

  it('sequential chain composes two partial patches on PermissionRequest', async () => {
    const dir = makeTempDir()
    const hookA = makeLoadedHook('hookA', {
      PermissionRequest: () => ({ result: 'allow', updatedInput: { timeout: 10000 } }),
    })
    const hookB = makeLoadedHook('hookB', {
      PermissionRequest: () => ({ result: 'allow', updatedInput: { description: 'step' } }),
    })
    const config = makeTestConfig({ hookA: {}, hookB: {} })
    const normalized = {
      event: 'PermissionRequest',
      toolInput: { command: 'echo original' },
    }

    const result = await executeHooks(
      [hookA, hookB],
      'PermissionRequest',
      normalized,
      config,
      fp(dir),
    )
    expect(result.lastResult?.result).toBe('allow')
    expect(result.lastResult?.updatedInput).toEqual({
      command: 'echo original',
      timeout: 10000,
      description: 'step',
    })
  })

  it('null unset on PermissionRequest: key removed from wire output', async () => {
    const dir = makeTempDir()
    const hook = makeLoadedHook('unset', {
      PermissionRequest: () => ({ result: 'allow', updatedInput: { timeout: null } }),
    })
    const config = makeTestConfig({ unset: {} })
    const normalized = {
      event: 'PermissionRequest',
      toolInput: { command: 'x', timeout: 5000 },
    }

    const result = await executeHooks([hook], 'PermissionRequest', normalized, config, fp(dir))
    expect(result.lastResult?.updatedInput).toEqual({ command: 'x' })
    expect(result.lastResult?.updatedInput).not.toHaveProperty('timeout')
  })
})

describe('null-unset sentinel preserves falsy values', () => {
  it('null unsets key while false/0/"" are preserved verbatim', async () => {
    const dir = makeTempDir()
    const hook = makeLoadedHook('falsy-preserve', {
      PreToolUse: () => ({
        result: 'allow',
        updatedInput: { timeout: null, label: 'updated' },
      }),
    })
    const config = makeTestConfig({ 'falsy-preserve': {} })
    const normalized = {
      event: 'PreToolUse',
      toolInput: { command: 'x', flag: false, count: 0, label: '', timeout: 5000 },
    }

    const result = await executeHooks([hook], 'PreToolUse', normalized, config, fp(dir))
    expect(result.lastResult?.result).toBe('allow')
    // timeout stripped (null sentinel); falsy values preserved verbatim;
    // command absent from patch is preserved from base.
    expect(result.lastResult?.updatedInput).toEqual({
      command: 'x',
      flag: false,
      count: 0,
      label: 'updated',
    })
    expect(result.lastResult?.updatedInput).not.toHaveProperty('timeout')
    // Sanity: falsy values really did survive (not stripped).
    const ui = result.lastResult?.updatedInput as Record<string, unknown>
    expect(ui.flag).toBe(false)
    expect(ui.count).toBe(0)
    expect(ui.label).toBe('updated')
  })
})

describe('sequential ask-winner merges loser allow patch', () => {
  it('allow loser patch { timeout } + ask winner patch { command } → merged wire output', async () => {
    const dir = makeTempDir()
    const allowHook = makeLoadedHook('allower', {
      PreToolUse: () => ({ result: 'allow', updatedInput: { timeout: 30000 } }),
    })
    const askHook = makeLoadedHook('asker', {
      PreToolUse: () => ({
        result: 'ask',
        reason: 'confirm',
        updatedInput: { command: 'echo ok' },
      }),
    })
    const config = makeTestConfig({ allower: {}, asker: {} })
    const normalized = {
      event: 'PreToolUse',
      toolInput: { command: 'echo original', timeout: 5000 },
    }

    const result = await executeHooks(
      [allowHook, askHook],
      'PreToolUse',
      normalized,
      config,
      fp(dir),
    )
    expect(result.lastResult?.result).toBe('ask')
    // The ask-winner's raw partial was { command: 'echo ok' }, but the merged
    // wire output must carry both the allow-loser's timeout patch and the
    // ask-winner's command patch.
    expect(result.lastResult?.updatedInput).toEqual({ command: 'echo ok', timeout: 30000 })
  })
})

describe('reducePreToolUseVotes mergedToolInput wiring', () => {
  it('ask-winner reducer emits merged currentToolInput, not raw winner patch', () => {
    const allowLoser = {
      result: 'allow' as const,
      updatedInput: { timeout: 30000 },
    }
    const askWinner = {
      result: 'ask' as const,
      reason: 'confirm',
      updatedInput: { command: 'echo ok' },
    }
    const merged = { command: 'echo ok', timeout: 30000 }
    const { result } = reducePreToolUseVotes(
      [
        { engineResult: allowLoser, rank: 0 },
        { engineResult: askWinner, rank: 1 },
      ],
      merged,
    )
    expect(result?.result).toBe('ask')
    expect(result?.updatedInput).toEqual({ command: 'echo ok', timeout: 30000 })
    expect(result?.updatedInput).not.toEqual({ command: 'echo ok' })
  })

  it('allow-winner reducer emits merged currentToolInput (two disjoint-field allow patches)', () => {
    const allowA = {
      result: 'allow' as const,
      updatedInput: { timeout: 10000 },
    }
    const allowB = {
      result: 'allow' as const,
      updatedInput: { description: 'step' },
    }
    const merged = { command: 'echo original', timeout: 10000, description: 'step' }
    const { result } = reducePreToolUseVotes(
      [
        { engineResult: allowA, rank: 0 },
        { engineResult: allowB, rank: 0 },
      ],
      merged,
    )
    expect(result?.result).toBe('allow')
    expect(result?.updatedInput).toEqual({
      command: 'echo original',
      timeout: 10000,
      description: 'step',
    })
    expect(result?.updatedInput).not.toEqual({ description: 'step' })
  })

  it('allow-winner with no hook contributing updatedInput → no updatedInput on result', () => {
    const allowA = { result: 'allow' as const }
    const allowB = { result: 'allow' as const }
    const { result } = reducePreToolUseVotes(
      [
        { engineResult: allowA, rank: 0 },
        { engineResult: allowB, rank: 0 },
      ],
      undefined,
    )
    expect(result?.result).toBe('allow')
    expect(result).not.toHaveProperty('updatedInput')
  })

  it('ask-winner with no hook contributing updatedInput → no updatedInput on result', () => {
    const ask = { result: 'ask' as const, reason: 'confirm' }
    const allow = { result: 'allow' as const }
    const { result } = reducePreToolUseVotes(
      [
        { engineResult: allow, rank: 0 },
        { engineResult: ask, rank: 1 },
      ],
      undefined,
    )
    expect(result?.result).toBe('ask')
    expect(result).not.toHaveProperty('updatedInput')
  })
})

describe('parallel updatedInput contract violation (both events)', () => {
  it('parallel PreToolUse hook returning updatedInput is rejected as contract violation', async () => {
    const dir = makeTempDir()
    const hook = makeLoadedHook('violator', {
      PreToolUse: () => ({ result: 'allow', updatedInput: { command: 'x' } }),
    })
    const config = makeTestConfig({ violator: { parallel: true } })
    const normalized = { event: 'PreToolUse', toolInput: { command: 'orig' } }

    const result = await executeHooks([hook], 'PreToolUse', normalized, config, fp(dir))
    expect(result.lastResult?.result).toBe('block')
    expect(result.systemMessages.some((m) => m.includes('contract violation'))).toBe(true)
  })

  it('parallel PreToolUse hook returning updatedInput: {} is rejected as contract violation (current behavior)', async () => {
    const dir = makeTempDir()
    const hook = makeLoadedHook('violator-empty', {
      PreToolUse: () => ({ result: 'allow', updatedInput: {} }),
    })
    const config = makeTestConfig({ 'violator-empty': { parallel: true } })
    const normalized = { event: 'PreToolUse', toolInput: { command: 'orig' } }

    const result = await executeHooks([hook], 'PreToolUse', normalized, config, fp(dir))
    // `{}` is truthy, so the parallel contract-violation guard trips on empty
    // objects too. Pinned as a regression guard, not an endorsement.
    expect(result.lastResult?.result).toBe('block')
    expect(result.systemMessages.some((m) => m.includes('contract violation'))).toBe(true)
  })

  it('parallel PermissionRequest hook returning updatedInput is rejected as contract violation', async () => {
    const dir = makeTempDir()
    const hook = makeLoadedHook('violator', {
      PermissionRequest: () => ({ result: 'allow', updatedInput: { command: 'x' } }),
    })
    const config = makeTestConfig({ violator: { parallel: true } })
    const normalized = { event: 'PermissionRequest', toolInput: { command: 'orig' } }

    const result = await executeHooks([hook], 'PermissionRequest', normalized, config, fp(dir))
    expect(result.lastResult?.result).toBe('block')
    expect(result.systemMessages.some((m) => m.includes('contract violation'))).toBe(true)
  })
})
