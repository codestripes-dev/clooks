import { describe, expect, test, afterEach } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  appendTurnRecord,
  createTurnTracker,
  emptyTurnState,
  resetTurnStateWarnings,
  turnStatePath,
} from './turn-state.js'
import type { TurnState } from './turn-state.js'
import type { EventName, HookName } from '../types/branded.js'
import { hn } from '../test-utils.js'

const tempDirs: string[] = []

afterEach(() => {
  resetTurnStateWarnings()
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeHomeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'clooks-tracker-'))
  tempDirs.push(dir)
  return dir
}

const STOP = 'Stop' as EventName

function stateWith(
  entries: { hook: string; event: EventName; decision: 'block' | 'skip' | 'error'; at: string }[],
  scopeKey = 'main',
): TurnState {
  let state = emptyTurnState()
  for (const entry of entries) {
    state = appendTurnRecord(state, scopeKey, hn(entry.hook), {
      event: entry.event,
      decision: entry.decision,
      at: entry.at,
    })
  }
  return state
}

function trackerFor(homeRoot: string, state: TurnState, scopeKey = 'main') {
  return createTurnTracker({
    path: turnStatePath(homeRoot, 'session-under-test'),
    homeRoot,
    state,
    scopeKey,
  })
}

function readState(homeRoot: string): TurnState {
  return JSON.parse(
    readFileSync(turnStatePath(homeRoot, 'session-under-test'), 'utf8'),
  ) as TurnState
}

describe('createTurnTracker: materialize', () => {
  test('returns only the named hook’s records', () => {
    const home = makeHomeRoot()
    const tracker = trackerFor(
      home,
      stateWith([
        { hook: 'lint-reminder', event: STOP, decision: 'block', at: '2026-08-04T10:00:00.000Z' },
        { hook: 'other-hook', event: STOP, decision: 'block', at: '2026-08-04T10:00:01.000Z' },
      ]),
    )

    const mine = tracker.materialize(hn('lint-reminder'), STOP)
    expect(mine.prior).toHaveLength(1)
    expect(mine.priorRuns).toBe(1)
    expect(mine.priorInterventions).toBe(1)

    const theirs = tracker.materialize(hn('other-hook'), STOP)
    expect(theirs.prior).toHaveLength(1)

    const absent = tracker.materialize(hn('never-ran'), STOP)
    expect(absent.prior).toHaveLength(0)
    expect(absent.priorInterventions).toBe(0)
  })

  test('reads only the tracker’s own scope', () => {
    const home = makeHomeRoot()
    let state = stateWith(
      [{ hook: 'reminder', event: STOP, decision: 'block', at: '2026-08-04T10:00:00.000Z' }],
      'agent:sub-1',
    )
    state = appendTurnRecord(state, 'main', hn('reminder'), {
      event: STOP,
      decision: 'skip',
      at: '2026-08-04T10:00:02.000Z',
    })

    const main = trackerFor(home, state, 'main').materialize(hn('reminder'), STOP)
    expect(main.prior.map((r) => r.decision)).toEqual(['skip'])

    const sub = trackerFor(home, state, 'agent:sub-1').materialize(hn('reminder'), STOP)
    expect(sub.prior.map((r) => r.decision)).toEqual(['block'])
  })

  test('allocates a fresh object and a fresh array per call', () => {
    const home = makeHomeRoot()
    const tracker = trackerFor(
      home,
      stateWith([
        { hook: 'reminder', event: STOP, decision: 'block', at: '2026-08-04T10:00:00.000Z' },
      ]),
    )

    const first = tracker.materialize(hn('reminder'), STOP)
    const second = tracker.materialize(hn('reminder'), STOP)
    expect(first).not.toBe(second)
    expect(first.prior).not.toBe(second.prior)

    first.prior.push({ event: STOP, decision: 'error', at: '2026-08-04T11:00:00.000Z' })
    expect(second.prior).toHaveLength(1)
  })

  test('every hook in one invocation sees the same snapshot, unaffected by recording', () => {
    const home = makeHomeRoot()
    const tracker = trackerFor(
      home,
      stateWith([
        { hook: 'first', event: STOP, decision: 'block', at: '2026-08-04T10:00:00.000Z' },
      ]),
    )

    const before = tracker.materialize(hn('second'), STOP)
    // The first hook of the invocation intervenes...
    tracker.record(hn('first'), STOP, 'block')
    tracker.record(hn('second'), STOP, 'block')
    // ...and the second hook still sees the pre-invocation snapshot, because
    // completion order in a parallel group is nondeterministic and two hooks in
    // one batch must not see different histories.
    const after = tracker.materialize(hn('second'), STOP)

    expect(before.prior).toHaveLength(0)
    expect(after.prior).toHaveLength(0)
    expect(tracker.materialize(hn('first'), STOP).prior).toHaveLength(1)
  })
})

describe('createTurnTracker: buffering and commit', () => {
  test('writes nothing before commit and everything at commit', async () => {
    const home = makeHomeRoot()
    const path = turnStatePath(home, 'session-under-test')
    const tracker = trackerFor(home, emptyTurnState())

    tracker.record(hn('reminder'), STOP, 'block')
    tracker.record(hn('reminder'), 'PostToolUse' as EventName, 'skip')
    expect(existsSync(path)).toBe(false)

    await tracker.commit()

    expect(existsSync(path)).toBe(true)
    const stored = readState(home)
    const records = stored.scopes['main']?.[hn('reminder') as unknown as string]
    expect(records).toHaveLength(2)
    expect(records?.map((r) => r.decision)).toEqual(['block', 'skip'])
    expect(records?.map((r) => r.event)).toEqual(['Stop', 'PostToolUse'])
  })

  test('commit with no records writes nothing', async () => {
    const home = makeHomeRoot()
    const tracker = trackerFor(home, emptyTurnState())

    await tracker.commit()

    expect(existsSync(turnStatePath(home, 'session-under-test'))).toBe(false)
  })

  test('a second commit does not duplicate the first batch', async () => {
    const home = makeHomeRoot()
    const tracker = trackerFor(home, emptyTurnState())

    tracker.record(hn('reminder'), STOP, 'block')
    await tracker.commit()
    await tracker.commit()

    const key = hn('reminder') as unknown as string
    expect(readState(home).scopes['main']?.[key]).toHaveLength(1)
  })

  test('records land in the tracker’s scope, not the default one', async () => {
    const home = makeHomeRoot()
    const tracker = trackerFor(home, emptyTurnState(), 'agent:sub-7')

    tracker.record(hn('reminder'), STOP, 'block')
    await tracker.commit()

    const stored = readState(home)
    expect(Object.keys(stored.scopes)).toEqual(['agent:sub-7'])
  })

  test('commit does not throw when the home root is unusable', async () => {
    const home = makeHomeRoot()
    const tracker = trackerFor(home, emptyTurnState())
    tracker.record(hn('reminder'), STOP, 'block')

    rmSync(home, { recursive: true, force: true })
    // The parent no longer exists, so directory creation fails. The engine's
    // return path must not care.
    await tracker.commit()
  })

  test('a commit whose captured stamp is stale writes nothing', async () => {
    const home = makeHomeRoot()
    const path = turnStatePath(home, 'session-under-test')

    // A tracker built against one document...
    const stale = trackerFor(home, emptyTurnState())
    stale.record(hn('reminder'), STOP, 'block')

    // ...while a different document is published under a different epoch.
    const fresh = trackerFor(home, emptyTurnState())
    fresh.record(hn('other'), STOP, 'skip')
    await fresh.commit()

    await stale.commit()

    const stored = JSON.parse(readFileSync(path, 'utf8')) as TurnState
    expect(Object.keys(stored.scopes['main'] ?? {})).toEqual([hn('other') as unknown as string])
  })
})

describe('createTurnTracker: hook name typing', () => {
  test('accepts branded hook names without casting', () => {
    const home = makeHomeRoot()
    const tracker = trackerFor(home, emptyTurnState())
    const name: HookName = hn('reminder')
    tracker.record(name, STOP, 'error')
    expect(tracker.materialize(name, STOP).prior).toHaveLength(0)
  })
})
