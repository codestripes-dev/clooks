import { describe, expect, test } from 'bun:test'
import { rankPreToolUseResult, reducePreToolUseVotes } from './execute.js'
import { translateResult } from './translate.js'
import { translateFinalOutput } from '../agents/codex/translate.js'
import type { EventName } from '../types/branded.js'
import type { EngineResult } from './types.js'

function reduce(results: EngineResult[]) {
  return reducePreToolUseVotes(
    results.map((engineResult) => ({ engineResult, rank: rankPreToolUseResult(engineResult) })),
  )
}

function translateCodexResult(eventName: EventName, result: EngineResult) {
  return translateFinalOutput({ eventName, result, systemMessages: [], diagnostics: [] })
}

describe('PreToolUse skip context', () => {
  for (const winner of ['skip', 'allow', 'ask', 'block'] as const) {
    test(`preserves context when a later empty ${winner} wins`, () => {
      const { result, warnings } = reduce([
        { result: 'skip', injectContext: 'first' },
        { result: winner, reason: 'winner' },
      ])
      expect(result).toEqual({ result: winner, reason: 'winner', injectContext: 'first' })
      expect(warnings).toEqual([])
    })
  }

  test('all skips accumulate nonempty context without changing the last winner', () => {
    expect(
      reduce([
        { result: 'skip', injectContext: 'A' },
        { result: 'skip', injectContext: '' },
        { result: 'skip', injectContext: 'B' },
        { result: 'skip', debugMessage: 'last' },
      ]).result,
    ).toEqual({ result: 'skip', injectContext: 'A\nB', debugMessage: 'last' })
  })

  for (const winner of ['allow', 'ask', 'block'] as const) {
    test(`${winner} keeps eligible contexts in configured order`, () => {
      const votes: EngineResult[] = [
        { result: 'skip', injectContext: 'S1' },
        { result: winner, injectContext: 'loser' },
        { result: 'allow', injectContext: 'A' },
        { result: 'skip', injectContext: 'S2' },
        { result: winner, reason: 'last', injectContext: 'W' },
        { result: 'skip', injectContext: 'S3' },
      ]
      expect(reduce(votes).result).toEqual({
        result: winner,
        reason: 'last',
        injectContext: winner === 'allow' ? 'S1\nloser\nA\nS2\nW\nS3' : 'S1\nA\nS2\nW\nS3',
      })
    })
  }

  test('block retains ask context but excludes a losing block', () => {
    expect(
      reduce([
        { result: 'block', injectContext: 'excluded' },
        { result: 'ask', injectContext: 'ask' },
        { result: 'skip', injectContext: 'skip' },
        { result: 'block', reason: 'last' },
      ]).result?.injectContext,
    ).toBe('ask\nskip')
  })

  test('defer still drops skip context with a warning', () => {
    const reduced = reduce([{ result: 'skip', injectContext: 'dropped' }, { result: 'defer' }])
    expect(reduced.result).toEqual({ result: 'defer' })
    expect(reduced.warnings).toHaveLength(1)
    expect(reduced.warnings[0]).toContain('dropping')
  })

  for (const [agent, translate] of [
    ['Claude', translateResult],
    ['Codex', translateCodexResult],
  ] as const) {
    test(`${agent} emits standalone skip context without a decision or mutation`, () => {
      const result = translate('PreToolUse', {
        result: 'skip',
        injectContext: 'note',
        reason: 'ignored',
        updatedInput: { command: 'ignored' },
      })
      expect(result.exitCode).toBe(0)
      expect(JSON.parse(result.output!)).toEqual({
        hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'note' },
      })
    })
    for (const injectContext of agent === 'Claude' ? [undefined, ''] : [undefined]) {
      test(`${agent} emits no stdout for ${JSON.stringify(injectContext)} skip context`, () => {
        expect(translate('PreToolUse', { result: 'skip', injectContext })).toEqual({ exitCode: 0 })
      })
    }
  }
})
