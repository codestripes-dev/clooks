import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { executeHooks } from './execute.js'
import { legacyResultPolicy } from './result-policy.js'
import { claudeCodeAdapter } from '../agents/claude-code/adapter.js'
import type { InvocationResultPolicy } from '../agents/types.js'
import type { EngineResult } from './types.js'
import type { ClooksConfig, ErrorMode } from '../config/schema.js'
import type { HookLoadError, LoadedHook } from '../loader.js'
import type { EventName } from '../types/branded.js'
import { hn, ms } from '../test-utils.js'
import { readFailures } from '../failures.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function hook(name: string, handler: unknown, extra: Record<string, unknown> = {}): LoadedHook {
  return {
    name: hn(name),
    hook: {
      meta: { name: hn('source-name') },
      PreToolUse: handler,
      ...extra,
    } as LoadedHook['hook'],
    config: {},
    hookPath: `/test/${name}.ts`,
    configPath: '/test/clooks.yml',
  }
}

function config(names: string[], parallel = false, onError: ErrorMode = 'block'): ClooksConfig {
  return {
    version: '1.0.0',
    global: {
      timeout: ms(1000),
      onError,
      maxFailures: 3,
      maxFailuresMessage: 'degraded {hook}',
      handoff: false,
    },
    hooks: Object.fromEntries(
      names.map((name) => [
        hn(name),
        {
          resolvedPath: `/test/${name}.ts`,
          config: {},
          origin: 'project' as const,
          parallel,
        },
      ]),
    ),
    events: {},
  }
}

const observing: InvocationResultPolicy = {
  ...legacyResultPolicy,
  collectPreToolUseVotes: true,
  deferRuntimeErrorAudit: true,
}

function run(
  hooks: LoadedHook[],
  options: {
    cfg?: ClooksConfig
    policy?: InvocationResultPolicy
    input?: Record<string, unknown>
    event?: EventName
    loadErrors?: HookLoadError[]
  } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), 'clooks-observations-'))
  mkdirSync(join(dir, '.clooks'))
  roots.push(dir)
  const failurePath = join(dir, '.clooks/.failures')
  return {
    failurePath,
    result: executeHooks(
      hooks,
      options.event ?? 'PreToolUse',
      options.input ?? {
        toolInput: { command: 'original', nested: { value: 1 } },
      },
      options.cfg ?? config(hooks.map((h) => h.name)),
      failurePath,
      dir,
      options.loadErrors ?? [],
      undefined,
      undefined,
      options.policy ?? observing,
    ),
  }
}

function gate() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

const drain = () => new Promise<void>((resolve) => setImmediate(resolve))

async function waitForStarts(starts: Promise<void>, execution: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      starts,
      execution.then(() => {
        throw new Error('execution completed before all parallel hooks started')
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('parallel hook startup timed out')), 2000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

describe('opt-in PreToolUse observations', () => {
  test('metadata is absent for legacy, Claude, explicit opt-out, and other events', async () => {
    const invocation = claudeCodeAdapter.normalizeInvocation(
      {
        hook_event_name: 'PreToolUse',
        tool_input: { command: 'original' },
      },
      'PreToolUse',
    )
    for (const policy of [
      legacyResultPolicy,
      claudeCodeAdapter.createResultPolicy(invocation),
      { ...observing, collectPreToolUseVotes: false },
    ]) {
      const result = await run([hook('ask', () => ({ result: 'ask', reason: 'confirm' }))], {
        policy,
      }).result
      expect(result).not.toHaveProperty('preToolUse')
      expect(result.lastResult).toEqual({ result: 'ask', reason: 'confirm' })
    }
    expect(await run([], { event: 'Stop' }).result).not.toHaveProperty('preToolUse')
    const dir = mkdtempSync(join(tmpdir(), 'clooks-no-optin-'))
    roots.push(dir)
    expect(
      await executeHooks([], 'PreToolUse', {}, config([]), join(dir, 'failures'), dir),
    ).not.toHaveProperty('preToolUse')
  })

  test('empty execution and undefined results complete without fabricated votes', async () => {
    expect((await run([], { input: {} }).result).preToolUse).toEqual({
      votes: [],
      finalToolInput: undefined,
      inputChanged: false,
      completed: true,
    })
    const result = await run([
      hook('empty', () => undefined),
      hook('null', () => null),
      hook('skip', () => ({ result: 'skip' })),
    ]).result
    expect(result.preToolUse?.votes).toEqual([
      {
        engineResult: { result: 'skip' },
        rank: -1,
        hookName: hn('skip'),
        origin: 'handler',
        ordinal: 2,
        inputBefore: { command: 'original', nested: { value: 1 } },
        inputAfter: { command: 'original', nested: { value: 1 } },
      },
    ])
    expect(result.preToolUse?.completed).toBe(true)
  })

  for (const patchSource of ['losing-ask', 'winning-ask', 'allow-loser'] as const) {
    test(`ask ties preserve reducer context and ${patchSource} patch emission`, async () => {
      const first: EngineResult = {
        result: 'ask',
        reason: 'first',
        injectContext: 'losing context',
        updatedInput: { command: 'first-patch' },
      }
      const last: EngineResult = { result: 'ask', reason: 'last', injectContext: 'winner context' }
      if (patchSource === 'winning-ask') last.updatedInput = { command: 'winner-patch' }
      const allow: EngineResult = { result: 'allow', injectContext: 'allow context' }
      if (patchSource === 'allow-loser') allow.updatedInput = { extra: true }
      const seen: Record<string, unknown>[] = []
      const hooks = [
        hook('a', () => first),
        hook('allow', () => allow),
        hook('b', (ctx: { toolInput: Record<string, unknown> }) => {
          seen.push(ctx.toolInput)
          return last
        }),
      ]
      const result = await run(hooks).result
      const baseline = await run(hooks, { policy: legacyResultPolicy }).result
      const { preToolUse, ...withoutObservations } = result
      expect(withoutObservations).toEqual(baseline)
      expect(result.lastResult?.reason).toBe('last')
      expect(result.lastResult?.injectContext).toBe('allow context\nwinner context')
      expect(result.lastResult?.injectContext).not.toContain('losing context')
      expect(preToolUse?.votes.map((v) => [v.hookName, v.rank, v.ordinal])).toEqual([
        [hn('a'), 1, 0],
        [hn('allow'), 0, 1],
        [hn('b'), 1, 2],
      ])
      expect(preToolUse?.votes[0]?.engineResult).toEqual(first)
      expect(preToolUse?.votes[0]?.inputBefore.command).toBe('original')
      expect(preToolUse?.votes[0]?.inputAfter.command).toBe('first-patch')
      expect(preToolUse?.votes[2]?.inputBefore).toEqual(seen[0])
      expect(preToolUse?.inputChanged).toBe(true)
      expect(preToolUse?.completed).toBe(true)
      if (patchSource === 'losing-ask') {
        expect(result.lastResult).not.toHaveProperty('updatedInput')
        expect(preToolUse?.finalToolInput?.command).toBe('first-patch')
      } else {
        expect(result.lastResult?.updatedInput).toEqual(preToolUse?.finalToolInput)
      }
    })
  }

  test('codec candidates, null unsets, and equal patches use actual materialized input', async () => {
    const policy: InvocationResultPolicy = {
      ...observing,
      checkResult(input) {
        return {
          kind: 'accepted',
          result: input.value as EngineResult,
          diagnostics: [],
          nextToolInput: { command: 'candidate', retainedNull: null },
        }
      },
    }
    const result = await run(
      [hook('ask', () => ({ result: 'ask', reason: '', updatedInput: { command: 'raw' } }))],
      { policy },
    ).result
    expect(result.preToolUse?.votes[0]?.engineResult.updatedInput).toEqual({ command: 'raw' })
    expect(result.preToolUse?.votes[0]?.inputAfter).toEqual({
      command: 'candidate',
      retainedNull: null,
    })
    for (const patch of [{ command: 'original' }, { nested: null }]) {
      const result = await run([hook('allow', () => ({ result: 'allow', updatedInput: patch }))])
        .result
      expect(result.preToolUse?.inputChanged).toBe(true)
      expect(result.preToolUse?.votes[0]?.inputAfter).toEqual(result.lastResult?.updatedInput)
      if ('nested' in patch) expect(result.preToolUse?.finalToolInput).not.toHaveProperty('nested')
    }
  })

  test('accepted result and nested patches are detached from downstream input and final output', async () => {
    const candidate = { command: 'candidate', nested: { values: [1] } }
    const raw: EngineResult = { result: 'ask', reason: 'raw', updatedInput: { command: 'raw' } }
    const policy: InvocationResultPolicy = {
      ...observing,
      checkResult(input) {
        if (input.hookName !== hn('patch')) return legacyResultPolicy.checkResult(input)
        return {
          kind: 'accepted',
          diagnostics: ['accepted diagnostic'],
          nextToolInput: candidate,
          result: { result: 'ask', reason: 'accepted', updatedInput: candidate },
        }
      },
    }
    const result = await run(
      [
        hook('patch', () => raw),
        hook('downstream', (ctx: { toolInput: typeof candidate }) => {
          ctx.toolInput.nested.values.push(99)
          return { result: 'allow', updatedInput: { extra: true } }
        }),
      ],
      { policy },
    ).result
    const observations = result.preToolUse!
    expect(observations.votes[0]?.engineResult.reason).toBe('accepted')
    expect(observations.votes[0]?.inputAfter).toEqual(candidate)
    expect(observations.votes[1]?.inputBefore).toEqual(candidate)
    expect(result.systemMessages).toEqual(['accepted diagnostic'])
    candidate.nested.values.push(2)
    raw.reason = 'mutated raw'
    ;(result.lastResult!.updatedInput!.nested as { values: number[] }).values.push(3)
    expect(observations.votes[0]?.engineResult.updatedInput).toEqual({
      command: 'candidate',
      nested: { values: [1] },
    })
    expect(observations.votes[0]?.inputAfter.nested).toEqual({ values: [1] })
    expect(observations.votes[1]?.inputBefore.nested).toEqual({ values: [1] })
    expect(observations.finalToolInput?.nested).toEqual({ values: [1] })
  })

  for (const parallel of [false, true]) {
    test(`defer rank and dropped-context diagnostics do not mutate observations, parallel=${parallel}`, async () => {
      const hooks = [
        hook('ask', () => ({ result: 'ask', reason: 'confirm', injectContext: 'ask context' })),
        hook('defer', () => ({ result: 'defer' })),
      ]
      const cfg = config(['ask', 'defer'], parallel)
      const result = await run(hooks, { cfg }).result
      const baseline = await run(hooks, { cfg, policy: legacyResultPolicy }).result
      const { preToolUse, ...withoutObservations } = result
      expect(withoutObservations).toEqual(baseline)
      expect(result.lastResult).toEqual({ result: 'defer' })
      expect(preToolUse?.votes.map((v) => v.rank)).toEqual([1, 2])
      expect(preToolUse?.votes[0]?.engineResult.injectContext).toBe('ask context')
      expect(preToolUse?.completed).toBe(true)
      expect(result.systemMessages).toHaveLength(1)
    })
  }

  for (const parallel of [false, true]) {
    test(`snapshots precede real handoff and stay detached, parallel=${parallel}`, async () => {
      const raw: EngineResult = {
        result: 'ask',
        reason: '  exact reason  ',
        injectContext: 'original author context',
        debugMessage: 'debug',
      }
      const input = { toolInput: { command: 'original', nested: { value: 1 } } }
      const cfg = config(['alias'], parallel)
      cfg.global.handoff = true
      const result = await run([hook('alias', () => raw)], { cfg, input }).result
      const observation = result.preToolUse!.votes[0]!
      expect(result.lastResult?.injectContext).toContain('[clooks] Hook "alias": read ')
      expect(observation.engineResult).toEqual(raw)
      expect(observation.hookName).toBe(hn('alias'))
      expect(observation.origin).toBe('handler')
      input.toolInput.nested.value = 9
      raw.reason = 'mutated'
      result.lastResult!.injectContext = 'mutated output'
      expect(observation.engineResult.reason).toBe('  exact reason  ')
      expect(observation.engineResult.injectContext).toBe('original author context')
      expect(observation.inputBefore).toEqual({ command: 'original', nested: { value: 1 } })
      expect(observation.inputAfter).toEqual(observation.inputBefore)
      ;(observation.inputBefore.nested as { value: number }).value = 7
      expect(observation.inputAfter.nested).toEqual({ value: 1 })
      expect(result.preToolUse!.finalToolInput?.nested).toEqual({ value: 1 })
    })

    test(`before-hook identity and explicit blocks retain collect-all semantics, parallel=${parallel}`, async () => {
      let handlerRan = false
      const result = await run(
        [
          hook(
            'gate',
            () => {
              handlerRan = true
            },
            { beforeHook: () => ({ result: 'block', reason: 'denied' }) },
          ),
          hook('ask', () => ({ result: 'ask', reason: 'confirmation' })),
          hook('allow', () => ({ result: 'allow' })),
        ],
        { cfg: config(['gate', 'ask', 'allow'], parallel) },
      ).result
      expect(handlerRan).toBe(false)
      expect(result.lastResult?.result).toBe('block')
      expect(result.preToolUse?.completed).toBe(true)
      expect(result.preToolUse?.votes.map((v) => [v.origin, v.rank])).toEqual([
        ['before-hook', 3],
        ['handler', 1],
        ['handler', 0],
      ])
    })
  }

  test('parallel settlement order never becomes observation or reducer tie order', async () => {
    const starts = gate()
    const finishA = gate()
    const finishB = gate()
    let started = 0
    const settled: string[] = []
    const cfg = config(['a', 'b'], true)
    cfg.events.PreToolUse = { order: [hn('b'), hn('a')] }
    const pending = run(
      ['a', 'b'].map((name) =>
        hook(name, async () => {
          if (++started === 2) starts.release()
          await (name === 'a' ? finishA : finishB).promise
          settled.push(name)
          return { result: 'ask', reason: name }
        }),
      ),
      { cfg },
    ).result
    try {
      await waitForStarts(starts.promise, pending)
      finishA.release()
      await drain()
      expect(settled).toEqual(['a'])
      finishB.release()
      const result = await pending
      expect(result.preToolUse?.votes.map((v) => [v.hookName, v.ordinal])).toEqual([
        [hn('b'), 0],
        [hn('a'), 1],
      ])
      expect(result.lastResult?.reason).toBe('a')
      expect(result.preToolUse?.inputChanged).toBe(false)
      expect(result.preToolUse?.completed).toBe(true)
      for (const vote of result.preToolUse!.votes) expect(vote.inputBefore).toEqual(vote.inputAfter)
    } finally {
      finishA.release()
      finishB.release()
      await Promise.allSettled([pending])
    }
  })
})

describe('incomplete approval observations', () => {
  test('structural execution errors still reject instead of returning approval metadata', async () => {
    const cfg = config(['ask'])
    cfg.events.PreToolUse = { order: [hn('missing')] }
    await expect(
      run([hook('ask', () => ({ result: 'ask', reason: 'confirm' }))], { cfg }).result,
    ).rejects.toThrow('does not handle this event')
    const dir = mkdtempSync(join(tmpdir(), 'clooks-observation-io-'))
    roots.push(dir)
    await expect(
      executeHooks(
        [],
        'PreToolUse',
        {},
        config([]),
        {
          path: join(dir, '..', 'outside.json'),
          root: dir,
        },
        dir,
        [],
        undefined,
        undefined,
        observing,
      ),
    ).rejects.toThrow('failure state path is outside its selected managed root')
  })

  for (const lateThrows of [false, true]) {
    test(`parallel abort retains accepted votes but ignores late ${lateThrows ? 'crash' : 'ask'}`, async () => {
      const starts = gate()
      const finishCrash = gate()
      const finishLate = gate()
      let started = 0
      const startedHook = () => {
        if (++started === 3) starts.release()
      }
      const pending = run(
        [
          hook('ask', () => {
            startedHook()
            return { result: 'ask', reason: 'early' }
          }),
          hook('crash', async () => {
            startedHook()
            await finishCrash.promise
            throw new Error('abort batch')
          }),
          hook('late', async () => {
            startedHook()
            await finishLate.promise
            if (lateThrows) throw new Error('late failure')
            return { result: 'ask', reason: 'late' }
          }),
        ],
        { cfg: config(['ask', 'crash', 'late'], true) },
      ).result
      try {
        await waitForStarts(starts.promise, pending)
        await drain()
        finishCrash.release()
        const result = await pending
        expect(result.preToolUse?.completed).toBe(false)
        expect(result.preToolUse?.votes.map((v) => v.hookName)).toEqual([hn('ask')])
        expect(result.lastResult?.result).toBe('block')
        const snapshot = JSON.stringify(result)
        finishLate.release()
        await drain()
        expect(JSON.stringify(result)).toBe(snapshot)
      } finally {
        finishCrash.release()
        finishLate.release()
        await Promise.allSettled([pending])
        await drain()
      }
    })
  }

  for (const parallel of [false, true]) {
    for (const mode of ['block', 'continue', 'trace', 'degraded'] as const) {
      test(`runtime failure stays incomplete under ${mode}, parallel=${parallel}`, async () => {
        const cfg = config(
          ['ask', 'crash', 'later'],
          parallel,
          mode === 'degraded' ? 'block' : mode,
        )
        if (mode === 'degraded') cfg.global.maxFailures = 1
        let laterRan = false
        const execution = run(
          [
            hook('ask', () => ({ result: 'ask', reason: 'confirm' })),
            hook('crash', () => {
              throw new Error('crashed')
            }),
            hook('later', () => {
              laterRan = true
              return { result: 'allow' }
            }),
          ],
          { cfg },
        )
        const result = await execution.result
        expect(result.preToolUse?.completed).toBe(false)
        expect(result.policyFailure).toBeUndefined()
        expect(result.lastResult?.result).toBe(mode === 'block' ? 'block' : 'ask')
        expect(result.preToolUse?.votes.some((v) => v.hookName === hn('ask'))).toBe(true)
        expect(result.preToolUse?.votes.some((v) => v.hookName === hn('crash'))).toBe(false)
        expect(laterRan).toBe(parallel || mode !== 'block')
        const failures = await readFailures(execution.failurePath)
        expect(failures[hn('crash')]?.PreToolUse?.consecutiveFailures).toBe(
          mode === 'block' || mode === 'degraded' ? 1 : undefined,
        )
        expect(result.degradedMessages).toEqual(mode === 'degraded' ? ['degraded crash'] : [])
      })
    }

    test(`policy rejection and throw cannot authorize accepted asks, parallel=${parallel}`, async () => {
      for (const throws of [false, true]) {
        const policy: InvocationResultPolicy = {
          ...observing,
          checkResult(input) {
            if (input.hookName === hn('bad')) {
              if (throws) throw new Error('policy crash')
              return {
                kind: 'rejected',
                failure: { eventName: 'PreToolUse', capability: 'test', message: 'refused' },
              }
            }
            return legacyResultPolicy.checkResult(input)
          },
        }
        const result = await run(
          [
            hook('ask', () => ({ result: 'ask', reason: 'confirm' })),
            hook('bad', () => ({ result: 'allow' })),
          ],
          { cfg: config(['ask', 'bad'], parallel), policy },
        ).result
        expect(result.preToolUse?.completed).toBe(false)
        expect(result.policyFailure).toBeDefined()
        expect(result.lastResult).toBeUndefined()
        expect(result.preToolUse?.votes.some((v) => v.hookName === hn('bad'))).toBe(false)
      }
    })
  }

  for (const degraded of [false, true]) {
    for (const rejected of [false, true]) {
      test(`load failure metadata, degraded=${degraded}, rejected=${rejected}`, async () => {
        const cfg = config(['missing', 'ask'])
        if (degraded) cfg.global.maxFailures = 1
        const policy: InvocationResultPolicy = rejected
          ? {
              ...observing,
              checkResult: () => ({
                kind: 'rejected',
                failure: { eventName: 'PreToolUse', capability: 'load', message: 'failed' },
              }),
            }
          : observing
        const result = await run([hook('ask', () => ({ result: 'ask', reason: 'confirm' }))], {
          cfg,
          policy,
          loadErrors: [{ name: hn('missing'), error: 'import failed' }],
        }).result
        expect(result.preToolUse?.completed).toBe(false)
        expect(result.preToolUse?.votes).toHaveLength(degraded && !rejected ? 1 : 0)
        expect(result.lastResult?.result).toBe(rejected ? undefined : degraded ? 'ask' : 'block')
      })
    }
  }

  test('parallel rewrite contract violation stays incomplete even at degradation threshold', async () => {
    const cfg = config(['rewrite'], true)
    cfg.global.maxFailures = 1
    const result = await run(
      [hook('rewrite', () => ({ result: 'ask', reason: 'confirm', updatedInput: {} }))],
      { cfg },
    ).result
    expect(result.lastResult?.result).toBe('block')
    expect(result.preToolUse).toMatchObject({ votes: [], completed: false, inputChanged: false })
    expect(result.degradedMessages).toEqual(['degraded rewrite'])
  })

  for (const parallel of [false, true]) {
    test(`timeout cannot append a late ask, parallel=${parallel}`, async () => {
      const finish = gate()
      const cfg = config(['slow'], parallel, 'continue')
      cfg.global.timeout = ms(20)
      const pending = run(
        [
          hook('slow', async () => {
            await finish.promise
            return { result: 'ask', reason: 'late' }
          }),
        ],
        { cfg },
      ).result
      try {
        const result = await pending
        expect(result.preToolUse).toMatchObject({ votes: [], completed: false })
        const snapshot = JSON.stringify(result)
        finish.release()
        await drain()
        expect(JSON.stringify(result)).toBe(snapshot)
      } finally {
        finish.release()
        await pending
      }
    })
  }
})
