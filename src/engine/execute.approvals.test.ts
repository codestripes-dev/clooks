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
import type { ApprovalInteraction } from '../interaction/types.js'
import type { ApprovalQuestion } from '../interaction/types.js'
import type { TurnTracker } from './turn-state.js'
import {
  createTurnTracker,
  emptyTurn,
  emptyTurnState,
  readTurnState,
  turnStatePath,
} from './turn-state.js'
import { operationSchema } from '../interaction/protocol.js'

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
  deferRuntimeErrorAudit: true,
  approvalOperation: (input) => operationSchema.parse({ toolName: 'test', input }),
}

function run(
  hooks: LoadedHook[],
  options: {
    cfg?: ClooksConfig
    policy?: InvocationResultPolicy
    input?: Record<string, unknown>
    event?: EventName
    loadErrors?: HookLoadError[]
    interaction?: ApprovalInteraction | null
    signal?: AbortSignal
    tracker?: TurnTracker
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
      options.tracker,
      { ...(options.policy ?? observing), approvalOperation: observing.approvalOperation },
      options.interaction === null
        ? undefined
        : (options.interaction ??
            ({
              request: async () => ({ kind: 'approved' }),
              close: async () => {},
            } satisfies ApprovalInteraction)),
      options.signal,
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

describe('live PreToolUse observations', () => {
  for (const parallel of [false, true]) {
    test(`non-record snapshots retain null, falsy scalars and arrays, parallel=${parallel}`, async () => {
      for (const toolInput of [null, false, 0, '', 'raw {', [], [null, { snake_key: false }]]) {
        const seen: unknown[] = []
        const result = await run(
          [
            hook('observe', (ctx: { toolInput: unknown; originalToolInput: unknown }) => {
              seen.push(ctx.toolInput, ctx.originalToolInput)
              return { result: 'ask', reason: 'confirm' }
            }),
          ],
          { input: { toolInput }, cfg: config(['observe'], parallel) },
        ).result
        expect(seen).toEqual([toolInput, toolInput])
        expect(result.preToolUse?.votes).toHaveLength(1)
        expect(result.preToolUse?.votes[0]?.inputBefore).toEqual(toolInput)
        expect(result.preToolUse?.votes[0]?.inputAfter).toEqual(toolInput)
        expect(result.preToolUse?.finalToolInput).toEqual(toolInput)
        expect(result.preToolUse?.inputChanged).toBe(false)
        expect(result.lastResult?.updatedInput).toBeUndefined()
      }
    })
  }

  test('PreToolUse metadata is shared across policies but absent for other events', async () => {
    const invocation = claudeCodeAdapter.normalizeInvocation(
      {
        hook_event_name: 'PreToolUse',
        tool_input: { command: 'original' },
      },
      'PreToolUse',
    )
    for (const policy of [legacyResultPolicy, claudeCodeAdapter.createResultPolicy(invocation)]) {
      const result = await run([hook('ask', () => ({ result: 'ask', reason: 'confirm' }))], {
        policy,
      }).result
      expect(result.preToolUse?.approvals).toHaveLength(1)
      expect(result.lastResult).toEqual({ result: 'allow', reason: 'confirm' })
    }
    expect(await run([], { event: 'Stop' }).result).not.toHaveProperty('preToolUse')
    const dir = mkdtempSync(join(tmpdir(), 'clooks-no-optin-'))
    roots.push(dir)
    expect(
      await executeHooks([], 'PreToolUse', {}, config([]), join(dir, 'failures'), dir),
    ).toHaveProperty('preToolUse')
  })

  test('empty execution and undefined results complete without fabricated votes', async () => {
    expect((await run([], { input: {} }).result).preToolUse).toEqual({
      approvals: [],
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
        resolvedAsk: false,
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
      const { preToolUse } = result
      expect(result).toEqual(baseline)
      expect(result.lastResult?.reason).toBe('last')
      expect(result.lastResult?.injectContext).toBe('losing context\nallow context\nwinner context')
      expect(preToolUse?.votes.map((v) => [v.hookName, v.rank, v.ordinal])).toEqual([
        [hn('a'), 1, 0],
        [hn('allow'), 0, 1],
        [hn('b'), 1, 2],
      ])
      expect(preToolUse?.votes[0]?.engineResult).toEqual(first)
      expect(preToolUse?.votes[0]?.inputBefore).toHaveProperty('command', 'original')
      expect(preToolUse?.votes[0]?.inputAfter).toHaveProperty('command', 'first-patch')
      expect(preToolUse?.votes[2]?.inputBefore).toEqual(seen[0])
      expect(preToolUse?.inputChanged).toBe(true)
      expect(preToolUse?.completed).toBe(true)
      expect(preToolUse?.finalToolInput).toEqual(result.lastResult?.updatedInput)
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
    expect(observations.votes[0]?.inputAfter).toHaveProperty('nested', { values: [1] })
    expect(observations.votes[1]?.inputBefore).toHaveProperty('nested', { values: [1] })
    expect(observations.finalToolInput).toHaveProperty('nested', { values: [1] })
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
      const { preToolUse } = result
      expect(result).toEqual(baseline)
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
      ;(observation.inputBefore as { nested: { value: number } }).nested.value = 7
      expect(observation.inputAfter).toHaveProperty('nested', { value: 1 })
      expect(result.preToolUse!.finalToolInput).toHaveProperty('nested', { value: 1 })
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

describe('live checkpoint boundaries', () => {
  for (const tag of ['ask'] as const) {
    test(`${tag} patch on a non-record input refuses before consent or later hooks`, async () => {
      let requests = 0
      let later = 0
      const execution = run(
        [
          hook('patch', () => ({ result: tag, reason: 'confirm', updatedInput: { key: 'value' } })),
          hook('later', () => {
            later++
            return { result: 'allow' }
          }),
        ],
        {
          input: { toolInput: null },
          interaction: {
            async request() {
              requests++
              return { kind: 'approved' }
            },
            async close() {},
          },
        },
      )
      const result = await execution.result
      expect(result.policyFailure?.capability).toBe('approval')
      expect(result.lastResult).toBeUndefined()
      expect(requests).toBe(0)
      expect(later).toBe(0)
      expect(await readFailures(execution.failurePath)).toEqual({})
    })
  }
  test('handler rejection after cancellation stops without crash degradation', async () => {
    const entered = gate()
    const finish = gate()
    const controller = new AbortController()
    let later = 0
    const execution = run(
      [
        hook('pending', async () => {
          entered.release()
          await finish.promise
          throw new Error('cancelled handler')
        }),
        hook('later', () => {
          later++
          return { result: 'allow' }
        }),
      ],
      { signal: controller.signal },
    )
    await entered.promise
    controller.abort()
    finish.release()
    const result = await execution.result
    expect(result.policyFailure?.capability).toBe('approval')
    expect(result.lastResult).toBeUndefined()
    expect(later).toBe(0)
    expect(result.degradedMessages).toEqual([])
    expect(await readFailures(execution.failurePath)).toEqual({})
  })
  test('next invocation turn snapshot contains exactly one raw approved ask', async () => {
    const home = mkdtempSync(join(tmpdir(), 'clooks-ask-history-'))
    roots.push(home)
    const path = turnStatePath(home, 'session')
    const tracker = createTurnTracker({
      path,
      homeRoot: home,
      scopeKey: 'main',
      state: emptyTurnState(),
    })
    const result = await run([hook('ask', () => ({ result: 'ask', reason: 'confirm' }))], {
      tracker,
    }).result
    expect(result.lastResult?.result).toBe('allow')
    const state = await readTurnState(path)
    const next = createTurnTracker({ path, homeRoot: home, scopeKey: 'main', state })
    const turn = next.materialize(hn('ask'), 'PreToolUse')
    expect(turn.priorRuns).toBe(1)
    expect(turn.prior.map((record) => record.decision)).toEqual(['ask'])
  })
  test('afterHook mutation is audited before consent; history retains one raw ask', async () => {
    const records: string[] = []
    const questions: ApprovalQuestion[] = []
    let observed: unknown
    const tracker: TurnTracker = {
      materialize() {
        return emptyTurn()
      },
      record(_name, _event, decision) {
        records.push(decision)
      },
      async commit() {},
    }
    const raw = { result: 'ask', reason: 'original reason', updatedInput: { command: 'before' } }
    const result = await run(
      [
        hook('ask', () => raw, {
          afterHook(event: { handlerResult: typeof raw }) {
            observed = event.handlerResult
            event.handlerResult.updatedInput.command = 'after'
            return { result: 'block', reason: 'ignored override' }
          },
        }),
        hook('next', (ctx: { toolInput: unknown }) => {
          expect(records).toEqual(['ask'])
          expect(ctx.toolInput).toHaveProperty('command', 'after')
          return { result: 'allow' }
        }),
      ],
      {
        tracker,
        interaction: {
          async request(question) {
            questions.push(question)
            return { kind: 'approved' }
          },
          async close() {},
        },
      },
    ).result
    expect(observed).toBe(raw)
    expect(questions[0]).toMatchObject({
      reason: 'original reason',
      operation: { input: { command: 'after' } },
    })
    expect(records).toEqual(['ask', 'allow'])
    expect(result.lastResult?.result).toBe('allow')
  })
  test('consent outlives hook-code timeout without crash accounting', async () => {
    const asked = gate()
    const reply = gate()
    const cfg = config(['ask', 'next'])
    cfg.global.timeout = ms(10)
    let next = false
    const execution = run(
      [
        hook('ask', () => ({ result: 'ask', reason: 'wait' })),
        hook('next', () => {
          next = true
          return { result: 'allow' }
        }),
      ],
      {
        cfg,
        interaction: {
          async request() {
            asked.release()
            await reply.promise
            return { kind: 'approved' }
          },
          async close() {},
        },
      },
    )
    await asked.promise
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(next).toBe(false)
    reply.release()
    const result = await execution.result
    expect(result.policyFailure).toBeUndefined()
    expect(result.degradedMessages).toEqual([])
    expect(await readFailures(execution.failurePath)).toEqual({})
    expect(next).toBe(true)
  })
  test('parallel asks wait for audit then prompt in configured order', async () => {
    const finishA = gate()
    const askedA = gate()
    const approveA = gate()
    const finishB = gate()
    const started = gate()
    const seen: string[] = []
    let starts = 0
    let next = false
    const hooks = ['a', 'b'].map((name) =>
      hook(name, async () => {
        if (++starts === 2) started.release()
        await (name === 'a' ? finishA : finishB).promise
        return { result: 'ask', reason: name }
      }),
    )
    hooks.push(
      hook('next', () => {
        next = true
        return { result: 'allow' }
      }),
    )
    const cfg = config(['a', 'b', 'next'], true)
    cfg.hooks[hn('next')]!.parallel = false
    const execution = run(hooks, {
      cfg,
      interaction: {
        async request(question) {
          seen.push(question.hookName)
          if (question.hookName === 'a') {
            askedA.release()
            await approveA.promise
          }
          return { kind: 'approved' }
        },
        async close() {},
      },
    }).result
    await started.promise
    finishB.release()
    await drain()
    expect(seen).toEqual([])
    finishA.release()
    await askedA.promise
    expect(seen).toEqual(['a'])
    expect(next).toBe(false)
    approveA.release()
    await execution
    expect(seen).toEqual(['a', 'b'])
    expect(next).toBe(true)
  })
  for (const parallel of [false, true]) {
    for (const vote of ['block', 'defer'] as const) {
      test(`${vote} ${parallel ? 'parallel' : 'sequential'} only block suppresses questions`, async () => {
        let asks = 0
        const result = await run(
          [
            hook('vote', () => ({ result: vote, reason: 'reason' })),
            hook('ask', () => ({ result: 'ask', reason: 'confirm' })),
          ],
          {
            cfg: config(['vote', 'ask'], parallel),
            interaction: {
              async request() {
                asks++
                return { kind: 'approved' }
              },
              async close() {},
            },
          },
        ).result
        expect(asks).toBe(vote === 'block' ? 0 : 1)
        expect(result.lastResult?.result).toBe(vote)
      })
    }
  }
  for (const failure of [
    'declined',
    'cancelled',
    'timed-out',
    'unavailable',
    'throw',
    'absent',
  ] as const) {
    test(`checkpoint ${failure} stops later hooks without degradation`, async () => {
      let next = false
      const cfg = config(['ask', 'next'], false, 'continue')
      cfg.global.maxFailures = 1
      const execution = run(
        [
          hook('ask', () => ({ result: 'ask', reason: 'confirm' })),
          hook('next', () => {
            next = true
            return { result: 'allow' }
          }),
        ],
        {
          cfg,
          interaction:
            failure === 'absent'
              ? null
              : {
                  async request() {
                    if (failure === 'throw') throw new Error('protocol fault')
                    return { kind: failure, message: 'refused' }
                  },
                  async close() {},
                },
        },
      )
      const result = await execution.result
      expect(result.policyFailure?.capability).toBe('approval')
      expect(next).toBe(false)
      expect(result.degradedMessages).toEqual([])
      expect(await readFailures(execution.failurePath)).toEqual({})
    })
  }
  for (const updatedInput of [[], null, 'text', 1]) {
    test(`non-record ask patch ${JSON.stringify(updatedInput)} is refused before prompting`, async () => {
      let prompts = 0
      const result = await run(
        [hook('ask', () => ({ result: 'ask', reason: 'confirm', updatedInput }))],
        {
          interaction: {
            async request() {
              prompts++
              return { kind: 'approved' }
            },
            async close() {},
          },
        },
      ).result
      expect(prompts).toBe(0)
      expect(result.policyFailure).toBeDefined()
    })
  }
  test('ask patch preserves opaque keys, untouched null and undefined no-op', async () => {
    const patch = JSON.parse('{"__proto__":{"snake_key":true},"remove":null}')
    patch.command = undefined
    const result = await run(
      [hook('ask', () => ({ result: 'ask', reason: '', updatedInput: patch }))],
      {
        input: { toolInput: { command: 'original', remove: true, retain: null } },
      },
    ).result
    expect(result.lastResult?.updatedInput).toEqual(
      JSON.parse('{"command":"original","retain":null,"__proto__":{"snake_key":true}}'),
    )
    expect(result.lastResult?.updatedInput).toEqual(
      result.preToolUse?.approvals[0]?.operation.input as Record<string, unknown>,
    )
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
        expect(result.lastResult?.result).toBe(mode === 'block' ? 'block' : 'allow')
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
        expect(result.lastResult?.result).toBe(rejected ? undefined : degraded ? 'allow' : 'block')
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
