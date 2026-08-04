import { describe, expect, it, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { tmpdir } from 'os'
import { executeHooks } from './execute.js'
import {
  createTurnTracker,
  emptyTurn,
  emptyTurnState,
  readTurnState,
  resetTurnStateWarnings,
  turnStatePath,
} from './turn-state.js'
import type { TurnTracker } from './turn-state.js'
import type { LoadedHook } from '../loader.js'
import type { ClooksHook } from '../types/hook.js'
import type { ClooksConfig, HookEntry, ErrorMode } from '../config/schema.js'
import type { EventName, HookName } from '../types/branded.js'
import type { TurnContext, TurnDecision } from '../types/turn.js'
import { getFailureCount, readFailures } from '../failures.js'
import { hn, ms } from '../test-utils.js'
import { DEFAULT_MAX_FAILURES_MESSAGE } from '../config/constants.js'

const tempDirs: string[] = []

afterEach(() => {
  resetTurnStateWarnings()
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'clooks-execute-turn-'))
  mkdirSync(join(dir, '.clooks'), { recursive: true })
  tempDirs.push(dir)
  return dir
}

function fp(dir: string): string {
  return join(dir, '.clooks/.failures')
}

interface Recorded {
  hook: string
  event: EventName
  decision: TurnDecision
}

/**
 * A tracker that captures instead of writing. The recording points are the
 * thing under test here; the storage layer has its own suite.
 */
function spyTracker(snapshot: Record<string, TurnContext> = {}): TurnTracker & {
  recorded: Recorded[]
  materialized: string[]
} {
  const recorded: Recorded[] = []
  const materialized: string[] = []
  return {
    recorded,
    materialized,
    materialize(hookName, _eventName) {
      materialized.push(hookName)
      return snapshot[hookName] ?? emptyTurn()
    },
    record(hookName, eventName, decision) {
      recorded.push({ hook: hookName, event: eventName, decision })
    },
    async commit() {},
  }
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
function makeLoadedHook(name: string, handlers: Record<string, Function>): LoadedHook {
  const hookName = hn(name)
  return {
    name: hookName,
    hook: { meta: { name: hookName }, ...handlers } as unknown as ClooksHook,
    config: {},
    hookPath: `/test/hooks/${name}.ts`,
    configPath: '/test/.clooks/clooks.yml',
  }
}

function makeTestConfig(
  hookOverrides: Record<
    string,
    { parallel?: boolean; maxFailures?: number; onError?: ErrorMode }
  > = {},
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
      maxFailures: 3,
      maxFailuresMessage: DEFAULT_MAX_FAILURES_MESSAGE,
      handoff: false,
    },
    hooks,
    events: {},
  }
}

function run(
  matched: LoadedHook[],
  eventName: EventName,
  normalized: Record<string, unknown>,
  config: ClooksConfig,
  dir: string,
  tracker?: TurnTracker,
  loadErrors: Parameters<typeof executeHooks>[6] = [],
): ReturnType<typeof executeHooks> {
  return executeHooks(
    matched,
    eventName,
    normalized,
    config,
    fp(dir),
    dirname(dirname(fp(dir))),
    loadErrors,
    undefined,
    tracker,
  )
}

const STOP = 'Stop' as EventName

describe('executeHooks: ctx.turn injection', () => {
  it('gives a sequential hook the tracker’s materialized turn', async () => {
    const dir = makeTempDir()
    let seen: TurnContext | undefined
    const hook = makeLoadedHook('reminder', {
      Stop: (ctx: { turn: TurnContext }) => {
        seen = ctx.turn
        return { result: 'skip' }
      },
    })
    const tracker = spyTracker({
      [hn('reminder')]: { prior: [], priorRuns: 2, priorInterventions: 1 },
    })

    await run([hook], STOP, { event: 'Stop' }, makeTestConfig({ reminder: {} }), dir, tracker)

    expect(seen?.priorInterventions).toBe(1)
    expect(tracker.materialized).toEqual([hn('reminder')])
  })

  it('gives a parallel hook the tracker’s materialized turn', async () => {
    const dir = makeTempDir()
    let seen: TurnContext | undefined
    const hook = makeLoadedHook('reminder', {
      Stop: (ctx: { turn: TurnContext }) => {
        seen = ctx.turn
        return { result: 'skip' }
      },
    })
    const tracker = spyTracker({
      [hn('reminder')]: { prior: [], priorRuns: 5, priorInterventions: 3 },
    })

    await run(
      [hook],
      STOP,
      { event: 'Stop' },
      makeTestConfig({ reminder: { parallel: true } }),
      dir,
      tracker,
    )

    expect(seen?.priorInterventions).toBe(3)
  })

  it('supplies a fresh empty turn when no tracker was passed', async () => {
    const dir = makeTempDir()
    const seen: TurnContext[] = []
    const handler = (ctx: { turn: TurnContext }) => {
      seen.push(ctx.turn)
      return { result: 'skip' }
    }
    const hookA = makeLoadedHook('a', { Stop: handler })
    const hookB = makeLoadedHook('b', { Stop: handler })

    await run([hookA, hookB], STOP, { event: 'Stop' }, makeTestConfig({ a: {}, b: {} }), dir)

    expect(seen).toHaveLength(2)
    expect(seen[0]).toEqual({ prior: [], priorRuns: 0, priorInterventions: 0 })
    // Distinct objects and distinct arrays: a shared `prior` would let one
    // hook's push rewrite what the next hook sees.
    expect(seen[0]).not.toBe(seen[1])
    expect(seen[0]!.prior).not.toBe(seen[1]!.prior)
  })
})

describe('executeHooks: sequential recording points', () => {
  it('records the raw result tag for a hook that blocks', async () => {
    const dir = makeTempDir()
    const hook = makeLoadedHook('reminder', {
      Stop: () => ({ result: 'block', reason: 'lint first' }),
    })
    const tracker = spyTracker()

    const result = await run(
      [hook],
      STOP,
      { event: 'Stop' },
      makeTestConfig({ reminder: {} }),
      dir,
      tracker,
    )

    expect(result.lastResult?.result).toBe('block')
    expect(tracker.recorded).toEqual([{ hook: hn('reminder'), event: STOP, decision: 'block' }])
  })

  it('records skip for a hook that returns nothing', async () => {
    const dir = makeTempDir()
    const hook = makeLoadedHook('quiet', { Stop: () => undefined })
    const tracker = spyTracker()

    await run([hook], STOP, { event: 'Stop' }, makeTestConfig({ quiet: {} }), dir, tracker)

    expect(tracker.recorded).toEqual([{ hook: hn('quiet'), event: STOP, decision: 'skip' }])
  })

  it('records skip for a hook that returns null', async () => {
    const dir = makeTempDir()
    const hook = makeLoadedHook('quiet', { Stop: () => null })
    const tracker = spyTracker()

    await run([hook], STOP, { event: 'Stop' }, makeTestConfig({ quiet: {} }), dir, tracker)

    expect(tracker.recorded.map((r) => r.decision)).toEqual(['skip'])
  })

  for (const mode of ['block', 'continue', 'trace'] as ErrorMode[]) {
    it(`records error for a crashing hook under onError: ${mode}`, async () => {
      const dir = makeTempDir()
      const hook = makeLoadedHook('crasher', {
        Stop: () => {
          throw new Error('boom')
        },
      })
      const tracker = spyTracker()

      await run(
        [hook],
        STOP,
        { event: 'Stop' },
        makeTestConfig({ crasher: { onError: mode } }),
        dir,
        tracker,
      )

      expect(tracker.recorded).toEqual([{ hook: hn('crasher'), event: STOP, decision: 'error' }])
    })
  }

  it('records error for a hook that was ALREADY degraded before the invocation', async () => {
    const dir = makeTempDir()
    let handlerRuns = 0
    const hook = makeLoadedHook('flaky', {
      Stop: () => {
        handlerRuns++
        throw new Error('boom')
      },
    })
    const config = makeTestConfig({ flaky: { maxFailures: 1 } })

    // First invocation only *reaches* the threshold — it proves nothing about
    // an already-degraded hook, which is the case that matters here.
    const first = await run([hook], STOP, { event: 'Stop' }, config, dir, spyTracker())
    expect(first.degradedMessages).toHaveLength(1)
    expect(await readFailures(fp(dir)).then((s) => getFailureCount(s, hn('flaky'), STOP))).toBe(1)

    // Second invocation: the hook enters already at its threshold. Degraded
    // mode suppresses the block; there is no execution quarantine, so the hook
    // is retried and the retry records.
    const tracker = spyTracker()
    const second = await run([hook], STOP, { event: 'Stop' }, config, dir, tracker)

    expect(handlerRuns).toBe(2)
    expect(second.degradedMessages).toHaveLength(1)
    expect(second.lastResult).toBeUndefined()
    expect(tracker.recorded).toEqual([{ hook: hn('flaky'), event: STOP, decision: 'error' }])
  })

  it('records error for an already-degraded parallel hook too', async () => {
    const dir = makeTempDir()
    let handlerRuns = 0
    const hook = makeLoadedHook('flaky', {
      Stop: async () => {
        handlerRuns++
        throw new Error('boom')
      },
    })
    const config = makeTestConfig({ flaky: { maxFailures: 1, parallel: true } })

    await run([hook], STOP, { event: 'Stop' }, config, dir, spyTracker())
    const tracker = spyTracker()
    await run([hook], STOP, { event: 'Stop' }, config, dir, tracker)

    expect(handlerRuns).toBe(2)
    expect(tracker.recorded).toEqual([{ hook: hn('flaky'), event: STOP, decision: 'error' }])
  })

  it('records block when a beforeHook blocked before the handler ran', async () => {
    const dir = makeTempDir()
    let handlerRan = false
    const hook = makeLoadedHook('gated', {
      beforeHook: () => ({ result: 'block', reason: 'not now' }),
      Stop: () => {
        handlerRan = true
        return { result: 'skip' }
      },
    })
    const tracker = spyTracker()

    await run([hook], STOP, { event: 'Stop' }, makeTestConfig({ gated: {} }), dir, tracker)

    expect(handlerRan).toBe(false)
    expect(tracker.recorded).toEqual([{ hook: hn('gated'), event: STOP, decision: 'block' }])
  })

  it('records skip when a beforeHook skipped before the handler ran', async () => {
    const dir = makeTempDir()
    const hook = makeLoadedHook('gated', {
      beforeHook: () => ({ result: 'skip' }),
      Stop: () => ({ result: 'block', reason: 'never reached' }),
    })
    const tracker = spyTracker()

    await run([hook], STOP, { event: 'Stop' }, makeTestConfig({ gated: {} }), dir, tracker)

    expect(tracker.recorded).toEqual([{ hook: hn('gated'), event: STOP, decision: 'skip' }])
  })

  it('records each hook of a sequential group once, in execution order', async () => {
    const dir = makeTempDir()
    const hookA = makeLoadedHook('a', { Stop: () => ({ result: 'allow' }) })
    const hookB = makeLoadedHook('b', { Stop: () => undefined })
    const tracker = spyTracker()

    await run(
      [hookA, hookB],
      STOP,
      { event: 'Stop' },
      makeTestConfig({ a: {}, b: {} }),
      dir,
      tracker,
    )

    expect(tracker.recorded).toEqual([
      { hook: hn('a'), event: STOP, decision: 'allow' },
      { hook: hn('b'), event: STOP, decision: 'skip' },
    ])
  })

  it('does not record a hook that never ran because an earlier one blocked', async () => {
    const dir = makeTempDir()
    const blocker = makeLoadedHook('blocker', { Stop: () => ({ result: 'block', reason: 'no' }) })
    const later = makeLoadedHook('later', { Stop: () => ({ result: 'allow' }) })
    const tracker = spyTracker()

    await run(
      [blocker, later],
      STOP,
      { event: 'Stop' },
      makeTestConfig({ blocker: {}, later: {} }),
      dir,
      tracker,
    )

    expect(tracker.recorded.map((r) => r.hook)).toEqual([hn('blocker')])
  })
})

describe('executeHooks: parallel recording points', () => {
  it('records error for a hook abandoned by a short circuit', async () => {
    const dir = makeTempDir()
    const fast = makeLoadedHook('fast', { Stop: () => ({ result: 'block', reason: 'stop now' }) })
    const slow = makeLoadedHook('slow', {
      Stop: async () => {
        await new Promise((r) => setTimeout(r, 50))
        return { result: 'allow' }
      },
    })
    const tracker = spyTracker()

    await run(
      [fast, slow],
      STOP,
      { event: 'Stop' },
      makeTestConfig({ fast: { parallel: true }, slow: { parallel: true } }),
      dir,
      tracker,
    )

    const bySlow = tracker.recorded.filter((r) => r.hook === hn('slow'))
    expect(bySlow).toEqual([{ hook: hn('slow'), event: STOP, decision: 'error' }])
    expect(tracker.recorded.filter((r) => r.hook === hn('fast'))[0]?.decision).toBe('block')
  })

  it('records skip for a parallel hook that returns nothing', async () => {
    const dir = makeTempDir()
    const hook = makeLoadedHook('quiet', { Stop: () => undefined })
    const tracker = spyTracker()

    await run(
      [hook],
      STOP,
      { event: 'Stop' },
      makeTestConfig({ quiet: { parallel: true } }),
      dir,
      tracker,
    )

    expect(tracker.recorded).toEqual([{ hook: hn('quiet'), event: STOP, decision: 'skip' }])
  })

  it('records error for a parallel hook that rejects', async () => {
    const dir = makeTempDir()
    const hook = makeLoadedHook('crasher', {
      Stop: async () => {
        throw new Error('boom')
      },
    })
    const tracker = spyTracker()

    await run(
      [hook],
      STOP,
      { event: 'Stop' },
      makeTestConfig({ crasher: { parallel: true } }),
      dir,
      tracker,
    )

    expect(tracker.recorded).toEqual([{ hook: hn('crasher'), event: STOP, decision: 'error' }])
  })

  it('records the raw tag for a parallel hook that returns a result', async () => {
    const dir = makeTempDir()
    const hook = makeLoadedHook('allower', { Stop: () => ({ result: 'allow' }) })
    const tracker = spyTracker()

    await run(
      [hook],
      STOP,
      { event: 'Stop' },
      makeTestConfig({ allower: { parallel: true } }),
      dir,
      tracker,
    )

    expect(tracker.recorded).toEqual([{ hook: hn('allower'), event: STOP, decision: 'allow' }])
  })
})

describe('executeHooks: recording exclusions', () => {
  it('does not record a hook whose module failed to import', async () => {
    const dir = makeTempDir()
    const tracker = spyTracker()

    const result = await run(
      [],
      STOP,
      { event: 'Stop' },
      makeTestConfig({ broken: {} }),
      dir,
      tracker,
      [{ name: hn('broken'), error: 'SyntaxError: unexpected token' }],
    )

    expect(result.lastResult?.result).toBe('block')
    expect(tracker.recorded).toEqual([])
  })
})

describe('executeHooks: a tracker that throws', () => {
  /** Every method rejects the contract. Nothing about the run may change. */
  function hostileTracker(): TurnTracker {
    return {
      materialize() {
        throw new Error('materialize exploded')
      },
      record() {
        throw new Error('record exploded')
      },
      async commit() {
        throw new Error('commit exploded')
      },
    }
  }

  it('leaves hook execution, ctx.turn, and the final result unaffected', async () => {
    const dir = makeTempDir()
    let seen: TurnContext | undefined
    const hookA = makeLoadedHook('observer', {
      Stop: (ctx: { turn: TurnContext }) => {
        seen = ctx.turn
        return { result: 'allow', injectContext: 'from A' }
      },
    })
    const hookB = makeLoadedHook('decider', {
      Stop: () => ({ result: 'block', reason: 'lint first' }),
    })
    const config = makeTestConfig({ observer: {}, decider: {} })

    const healthy = await run([hookA, hookB], STOP, { event: 'Stop' }, config, dir, spyTracker())
    const hostile = await run(
      [hookA, hookB],
      STOP,
      { event: 'Stop' },
      config,
      makeTempDir(),
      hostileTracker(),
    )

    // A failed materialize degrades to the same empty turn a failed read gives.
    expect(seen).toEqual({ prior: [], priorRuns: 0, priorInterventions: 0 })
    expect(hostile.lastResult).toEqual(healthy.lastResult!)
    expect(hostile.lastResult?.result).toBe('block')
    expect(hostile.systemMessages).toEqual(healthy.systemMessages)
    expect(hostile.degradedMessages).toEqual(healthy.degradedMessages)
  })

  it('does not turn a crashing hook’s recording failure into a second failure', async () => {
    const dir = makeTempDir()
    const hook = makeLoadedHook('crasher', {
      Stop: () => {
        throw new Error('boom')
      },
    })
    const config = makeTestConfig({ crasher: {} })

    const healthy = await run([hook], STOP, { event: 'Stop' }, config, dir, spyTracker())
    const hostile = await run(
      [hook],
      STOP,
      { event: 'Stop' },
      config,
      makeTempDir(),
      hostileTracker(),
    )

    expect(hostile.lastResult?.result).toBe('block')
    expect(hostile.lastResult?.reason).toBe(healthy.lastResult!.reason!)
  })
})

describe('executeHooks: the feature, end to end in process', () => {
  it('a hook that blocked in one invocation sees priorInterventions === 1 in the next', async () => {
    const dir = makeTempDir()
    const home = mkdtempSync(join(tmpdir(), 'clooks-execute-turn-home-'))
    tempDirs.push(home)
    const path = turnStatePath(home, 'session-abc')
    const config = makeTestConfig({ reminder: {} })

    const seen: TurnContext[] = []
    const hook = makeLoadedHook('reminder', {
      Stop: (ctx: { turn: TurnContext }) => {
        seen.push(ctx.turn)
        if (ctx.turn.priorInterventions > 0) return { result: 'skip' }
        return { result: 'block', reason: 'lint first' }
      },
    })

    // First invocation: nothing on disk, so the hook intervenes.
    const first = await run(
      [hook],
      STOP,
      { event: 'Stop' },
      config,
      dir,
      createTurnTracker({ path, homeRoot: home, state: emptyTurnState(), scopeKey: 'main' }),
    )
    expect(first.lastResult?.result).toBe('block')

    // Second invocation reads what the first committed.
    const second = await run(
      [hook],
      STOP,
      { event: 'Stop' },
      config,
      dir,
      createTurnTracker({
        path,
        homeRoot: home,
        state: await readTurnState(path),
        scopeKey: 'main',
      }),
    )

    expect(seen[0]?.priorInterventions).toBe(0)
    expect(seen[1]?.priorInterventions).toBe(1)
    expect(seen[1]?.priorRuns).toBe(1)
    // A lone skip produces no result at all, which is the point: the second
    // invocation no longer blocks.
    expect(second.lastResult).toBeUndefined()
  })
})
