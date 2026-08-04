import { describe, expect, test } from 'bun:test'
import type { EventName, HookName } from '../types/branded.js'
import type { TurnDecision, TurnRecord } from '../types/turn.js'
import {
  advanceTurnGeneration,
  appendTurnRecord,
  clearTurnScopes,
  decisionForResult,
  emptyTurn,
  emptyTurnState,
  isTurnIntervention,
  isTurnStateShape,
  materializeTurn,
  turnScopeKey,
  type TurnState,
} from './turn-state.js'

const hook = 'lint-reminder' as HookName

function record(event: EventName, decision: TurnDecision, at: string): TurnRecord {
  return { event, decision, at }
}

describe('turnScopeKey', () => {
  test('main agent event with no agentId', () => {
    expect(turnScopeKey('Stop' as EventName, {})).toBe('main')
  })

  test('empty agentId still resolves to main', () => {
    expect(turnScopeKey('Stop' as EventName, { agentId: '' })).toBe('main')
  })

  test('subagent event keys on agentId', () => {
    expect(turnScopeKey('SubagentStop' as EventName, { agentId: 'def456' })).toBe('agent:def456')
  })

  test('non-string agentId falls back to main', () => {
    expect(turnScopeKey('Stop' as EventName, { agentId: 42 })).toBe('main')
  })

  test.each(['TeammateIdle', 'TaskCreated', 'TaskCompleted'])(
    '%s keys on the team/teammate pair',
    (event) => {
      const key = turnScopeKey(event as EventName, { teamName: 'alpha', teammateName: 'bob' })
      expect(key).toBe(JSON.stringify(['team', 'alpha', 'bob']))
    },
  )

  test('team events ignore agentId', () => {
    const key = turnScopeKey('TeammateIdle' as EventName, {
      agentId: 'xyz',
      teamName: 'alpha',
      teammateName: 'bob',
    })
    expect(key).toBe(JSON.stringify(['team', 'alpha', 'bob']))
  })

  test('a missing teammate name is distinct from a teammate named "unknown"', () => {
    const absent = turnScopeKey('TaskCreated' as EventName, { teamName: 'alpha' })
    const named = turnScopeKey('TaskCreated' as EventName, {
      teamName: 'alpha',
      teammateName: 'unknown',
    })
    expect(absent).not.toBe(named)
    expect(absent).toBe(JSON.stringify(['team', 'alpha', null]))
  })

  test('both names absent', () => {
    expect(turnScopeKey('TaskCompleted' as EventName, {})).toBe(
      JSON.stringify(['team', null, null]),
    )
  })

  test('a team name containing a colon cannot collide with another pair', () => {
    const a = turnScopeKey('TeammateIdle' as EventName, { teamName: 'a:b', teammateName: 'c' })
    const b = turnScopeKey('TeammateIdle' as EventName, { teamName: 'a', teammateName: 'b:c' })
    expect(a).not.toBe(b)
  })
})

describe('isTurnIntervention', () => {
  const allTags: TurnDecision[] = [
    'allow',
    'ask',
    'block',
    'defer',
    'skip',
    'success',
    'failure',
    'continue',
    'stop',
    'retry',
    'error',
  ]

  test.each(['Stop', 'PreToolUse', 'UserPromptSubmit', 'TeammateIdle', 'PermissionDenied'])(
    'block intervenes on %s',
    (event) => {
      expect(isTurnIntervention(event as EventName, 'block')).toBe(true)
    },
  )

  test.each(['TeammateIdle', 'TaskCreated', 'TaskCompleted'])(
    'continue intervenes on %s',
    (event) => {
      expect(isTurnIntervention(event as EventName, 'continue')).toBe(true)
    },
  )

  test.each(['Stop', 'PreToolUse', 'PermissionDenied'])(
    'continue does not intervene on %s',
    (event) => {
      expect(isTurnIntervention(event as EventName, 'continue')).toBe(false)
    },
  )

  test('retry intervenes only on PermissionDenied', () => {
    expect(isTurnIntervention('PermissionDenied' as EventName, 'retry')).toBe(true)
    expect(isTurnIntervention('Stop' as EventName, 'retry')).toBe(false)
    expect(isTurnIntervention('TeammateIdle' as EventName, 'retry')).toBe(false)
  })

  test('nothing but block, continue, and retry ever intervenes', () => {
    const neverIntervene = allTags.filter((t) => !['block', 'continue', 'retry'].includes(t))
    for (const event of ['Stop', 'PreToolUse', 'TeammateIdle', 'PermissionDenied']) {
      for (const tag of neverIntervene) {
        expect(isTurnIntervention(event as EventName, tag)).toBe(false)
      }
    }
  })
})

describe('decisionForResult', () => {
  test('reads the tag off a result object', () => {
    expect(decisionForResult({ result: 'block', reason: 'no' })).toBe('block')
  })

  test('undefined records as skip', () => {
    expect(decisionForResult(undefined)).toBe('skip')
  })

  test('null records as skip', () => {
    expect(decisionForResult(null)).toBe('skip')
  })

  test('a non-object or tagless object records as skip', () => {
    expect(decisionForResult('block')).toBe('skip')
    expect(decisionForResult({})).toBe('skip')
    expect(decisionForResult({ result: null })).toBe('skip')
  })

  test('a result object carrying an unrecognized tag records as error', () => {
    // Not `skip`: the hook returned something, and recording an arbitrary
    // string would put a value outside TurnDecision in front of hook code
    // that switches on it.
    expect(decisionForResult({ result: 'nonsense' })).toBe('error')
    expect(decisionForResult({ result: '__proto__' })).toBe('error')
    expect(decisionForResult({ result: 'toString' })).toBe('error')
    expect(decisionForResult({ result: 7 })).toBe('error')
  })

  test('accepts every tag in the union', () => {
    const tags: TurnDecision[] = [
      'allow',
      'ask',
      'block',
      'defer',
      'skip',
      'success',
      'failure',
      'continue',
      'stop',
      'retry',
    ]
    for (const tag of tags) {
      expect(decisionForResult({ result: tag })).toBe(tag)
    }
  })
})

describe('materializeTurn', () => {
  test('empty when the scope has no records for this hook', () => {
    expect(materializeTurn(undefined, hook, 'Stop' as EventName)).toEqual(emptyTurn())
    expect(materializeTurn({}, hook, 'Stop' as EventName)).toEqual(emptyTurn())
  })

  test('filters to the named hook only', () => {
    const scope = {
      [hook]: [record('Stop' as EventName, 'block', '2026-08-04T10:00:00.000Z')],
      other: [record('Stop' as EventName, 'block', '2026-08-04T10:00:01.000Z')],
    }
    const turn = materializeTurn(scope, hook, 'Stop' as EventName)
    expect(turn.prior).toHaveLength(1)
    expect(turn.priorRuns).toBe(1)
  })

  test('priorRuns counts the current event only, prior spans every event', () => {
    const scope = {
      [hook]: [
        record('PostToolUse' as EventName, 'skip', '2026-08-04T10:00:00.000Z'),
        record('PostToolUse' as EventName, 'block', '2026-08-04T10:00:01.000Z'),
        record('Stop' as EventName, 'block', '2026-08-04T10:00:02.000Z'),
      ],
    }
    const turn = materializeTurn(scope, hook, 'Stop' as EventName)
    expect(turn.prior).toHaveLength(3)
    expect(turn.priorRuns).toBe(1)
    expect(turn.priorInterventions).toBe(1)
  })

  test('priorInterventions ignores interventions on other events', () => {
    const scope = {
      [hook]: [
        record('PostToolUse' as EventName, 'block', '2026-08-04T10:00:00.000Z'),
        record('Stop' as EventName, 'skip', '2026-08-04T10:00:01.000Z'),
      ],
    }
    const turn = materializeTurn(scope, hook, 'Stop' as EventName)
    expect(turn.priorRuns).toBe(1)
    expect(turn.priorInterventions).toBe(0)
  })

  test('returns records in timestamp order when the input is out of order', () => {
    const scope = {
      [hook]: [
        record('Stop' as EventName, 'skip', '2026-08-04T10:00:03.000Z'),
        record('Stop' as EventName, 'block', '2026-08-04T10:00:01.000Z'),
        record('Stop' as EventName, 'allow', '2026-08-04T10:00:02.000Z'),
      ],
    }
    const turn = materializeTurn(scope, hook, 'Stop' as EventName)
    expect(turn.prior.map((r) => r.at)).toEqual([
      '2026-08-04T10:00:01.000Z',
      '2026-08-04T10:00:02.000Z',
      '2026-08-04T10:00:03.000Z',
    ])
  })

  test('does not mutate the input array', () => {
    const records = [
      record('Stop' as EventName, 'skip', '2026-08-04T10:00:03.000Z'),
      record('Stop' as EventName, 'block', '2026-08-04T10:00:01.000Z'),
    ]
    materializeTurn({ [hook]: records }, hook, 'Stop' as EventName)
    expect(records[0]?.at).toBe('2026-08-04T10:00:03.000Z')
  })

  test('a non-array per-hook value degrades to empty', () => {
    const scope = { [hook]: 'corrupt' } as unknown as Record<string, TurnRecord[]>
    expect(materializeTurn(scope, hook, 'Stop' as EventName)).toEqual(emptyTurn())
  })
})

describe('emptyTurn', () => {
  test('allocates a distinct object and array every call', () => {
    const a = emptyTurn()
    const b = emptyTurn()
    expect(a).not.toBe(b)
    expect(a.prior).not.toBe(b.prior)
  })

  test('a push onto one result is invisible to another', () => {
    const a = emptyTurn()
    const b = emptyTurn()
    a.prior.push(record('Stop' as EventName, 'block', '2026-08-04T10:00:00.000Z'))
    expect(b.prior).toHaveLength(0)
  })
})

describe('pure state transforms', () => {
  function seeded(): TurnState {
    return {
      version: 1,
      epoch: 'abcdef0123456789',
      generation: 2,
      updatedAt: '2026-08-04T10:00:00.000Z',
      scopes: {
        main: { [hook]: [record('Stop' as EventName, 'block', '2026-08-04T10:00:00.000Z')] },
      },
    }
  }

  test('appendTurnRecord returns a new state and leaves the input untouched', () => {
    const before = seeded()
    const after = appendTurnRecord(
      before,
      'main',
      hook,
      record('Stop' as EventName, 'skip', '2026-08-04T10:00:05.000Z'),
    )
    expect(after).not.toBe(before)
    expect(before.scopes.main?.[hook]).toHaveLength(1)
    expect(after.scopes.main?.[hook]).toHaveLength(2)
  })

  test('appendTurnRecord creates a missing scope and hook bucket', () => {
    const after = appendTurnRecord(
      emptyTurnState(),
      'agent:abc',
      hook,
      record('SubagentStop' as EventName, 'block', '2026-08-04T10:00:05.000Z'),
    )
    expect(after.scopes['agent:abc']?.[hook]).toHaveLength(1)
  })

  test('appendTurnRecord does not disturb a sibling scope', () => {
    const before = seeded()
    const after = appendTurnRecord(
      before,
      'agent:abc',
      hook,
      record('SubagentStop' as EventName, 'skip', '2026-08-04T10:00:05.000Z'),
    )
    expect(after.scopes.main?.[hook]).toHaveLength(1)
  })

  test('clearTurnScopes empties the scopes and increments the generation', () => {
    const before = seeded()
    const after = clearTurnScopes(before)
    expect(after.scopes).toEqual({})
    expect(after.generation).toBe(3)
    expect(after.epoch).toBe(before.epoch)
    expect(before.scopes.main).toBeDefined()
    expect(before.generation).toBe(2)
  })

  test('advanceTurnGeneration increments without clearing', () => {
    const before = seeded()
    const after = advanceTurnGeneration(before)
    expect(after.generation).toBe(3)
    expect(after.scopes.main?.[hook]).toHaveLength(1)
    expect(before.generation).toBe(2)
  })

  test('a boundary at the counter ceiling reborns the document under a fresh epoch', () => {
    // `MAX_SAFE_INTEGER + 1` compares equal to itself, so a naive increment
    // would stop separating turns and every stale stamp would match forever.
    const before = { ...seeded(), generation: Number.MAX_SAFE_INTEGER }
    const after = clearTurnScopes(before)

    expect(after.epoch).not.toBe(before.epoch)
    expect(after.generation).toBe(0)
    expect(after.scopes).toEqual({})
    expect(advanceTurnGeneration(before).epoch).not.toBe(before.epoch)
  })

  test('a boundary on a corrupt generation reborns rather than propagating it', () => {
    for (const generation of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const after = clearTurnScopes({ ...seeded(), generation })
      expect(after.epoch).not.toBe('abcdef0123456789')
      expect(after.generation).toBe(0)
    }
  })

  test('emptyTurnState allocates a fresh document each call', () => {
    const a = emptyTurnState()
    const b = emptyTurnState()
    expect(a).not.toBe(b)
    expect(a.scopes).not.toBe(b.scopes)
    expect(a.generation).toBe(0)
  })

  test('emptyTurnState mints a distinct epoch each call', () => {
    // The whole point: two fresh documents must never compare equal, so a
    // tracker from a discarded document can never match the replacement.
    const epochs = new Set(Array.from({ length: 50 }, () => emptyTurnState().epoch))
    expect(epochs.size).toBe(50)
    for (const epoch of epochs) expect(epoch).toMatch(/^[0-9a-f]{16}$/)
  })

  test('dictionaries resist hook names that collide with Object.prototype', () => {
    let state = emptyTurnState()
    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      state = appendTurnRecord(
        state,
        'main',
        name as HookName,
        record('Stop' as EventName, 'block', '2026-08-04T10:00:00.000Z'),
      )
    }

    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      const turn = materializeTurn(state.scopes.main, name as HookName, 'Stop' as EventName)
      expect(turn.prior).toHaveLength(1)
      expect(turn.priorInterventions).toBe(1)
    }
    // A name never appended must still read as absent, not as an inherited member.
    expect(materializeTurn(state.scopes.main, 'valueOf' as HookName, 'Stop' as EventName)).toEqual(
      emptyTurn(),
    )
    expect(JSON.parse(JSON.stringify(state)).scopes.main.toString).toHaveLength(1)
  })
})

describe('isTurnStateShape', () => {
  const valid = {
    version: 1,
    epoch: 'abcdef0123456789',
    generation: 3,
    updatedAt: '2026-08-04T10:12:33.041Z',
    scopes: { main: { 'lint-reminder': [{ event: 'Stop', decision: 'block', at: 'x' }] } },
  }

  test('accepts a well-formed document', () => {
    expect(isTurnStateShape(valid)).toBe(true)
  })

  test('accepts an empty scope map', () => {
    expect(isTurnStateShape({ ...valid, scopes: {} })).toBe(true)
  })

  test('rejects non-objects and arrays', () => {
    expect(isTurnStateShape(null)).toBe(false)
    expect(isTurnStateShape('x')).toBe(false)
    expect(isTurnStateShape([])).toBe(false)
  })

  test('rejects missing or mistyped top-level fields', () => {
    expect(isTurnStateShape({ ...valid, version: '1' })).toBe(false)
    expect(isTurnStateShape({ ...valid, generation: null })).toBe(false)
    expect(isTurnStateShape({ ...valid, updatedAt: 5 })).toBe(false)
    expect(isTurnStateShape({ ...valid, scopes: 'main' })).toBe(false)
  })

  test('rejects a missing or empty epoch', () => {
    const { epoch: _dropped, ...withoutEpoch } = valid
    expect(isTurnStateShape(withoutEpoch)).toBe(false)
    expect(isTurnStateShape({ ...valid, epoch: '' })).toBe(false)
    expect(isTurnStateShape({ ...valid, epoch: 42 })).toBe(false)
  })

  test('rejects a generation that cannot be advanced monotonically', () => {
    expect(isTurnStateShape({ ...valid, generation: -1 })).toBe(false)
    expect(isTurnStateShape({ ...valid, generation: 1.5 })).toBe(false)
    expect(isTurnStateShape({ ...valid, generation: Number.NaN })).toBe(false)
    expect(isTurnStateShape({ ...valid, generation: Number.POSITIVE_INFINITY })).toBe(false)
    expect(isTurnStateShape({ ...valid, generation: Number.MAX_SAFE_INTEGER + 2 })).toBe(false)
  })

  test('rejects a scopes value that is a string', () => {
    expect(isTurnStateShape({ ...valid, scopes: { main: 'nope' } })).toBe(false)
  })

  test('rejects a per-hook value that is an object instead of an array', () => {
    expect(isTurnStateShape({ ...valid, scopes: { main: { h: { event: 'Stop' } } } })).toBe(false)
  })

  test('rejects a record missing `at`', () => {
    expect(
      isTurnStateShape({
        ...valid,
        scopes: { main: { h: [{ event: 'Stop', decision: 'block' }] } },
      }),
    ).toBe(false)
  })

  test('rejects a record that is not an object', () => {
    expect(isTurnStateShape({ ...valid, scopes: { main: { h: ['nope'] } } })).toBe(false)
  })
})
