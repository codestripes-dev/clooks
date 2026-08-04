import { describe, test, expect, afterEach, beforeEach } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { runEngine } from './run.js'
import {
  appendTurnRecord,
  emptyTurnState,
  resetTurnStateWarnings,
  turnStatePath,
} from './turn-state.js'
import type { TurnState } from './turn-state.js'
import type { RunEngineDeps } from './types.js'
import type { LoadConfigResult } from '../config/index.js'
import type { ClooksHook } from '../types/hook.js'
import type { EventName, Milliseconds } from '../types/branded.js'
import type { TurnContext } from '../types/turn.js'
import { hn } from '../test-utils.js'

class ExitCalled extends Error {
  constructor(public readonly code: number | string | undefined) {
    super(`ExitCalled(${String(code)})`)
    this.name = 'ExitCalled'
  }
}

const SESSION = 'turn-boundary-session'
const tempDirs: string[] = []
let originalHomeRoot: string | undefined

beforeEach(() => {
  originalHomeRoot = process.env.CLOOKS_HOME_ROOT
})

afterEach(() => {
  resetTurnStateWarnings()
  if (originalHomeRoot === undefined) delete process.env.CLOOKS_HOME_ROOT
  else process.env.CLOOKS_HOME_ROOT = originalHomeRoot
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

/** A home root holding one session document with a single recorded run. */
function seedHomeRoot(): { home: string; path: string; before: TurnState } {
  const home = makeTempDir('clooks-turn-home-')
  process.env.CLOOKS_HOME_ROOT = home
  const path = turnStatePath(home, SESSION)
  mkdirSync(join(home, '.clooks', 'turn-state'), { recursive: true, mode: 0o700 })

  const state = appendTurnRecord(emptyTurnState(), 'main', hn('reminder'), {
    event: 'Stop' as EventName,
    decision: 'block',
    at: '2026-08-04T10:00:00.000Z',
  })
  writeFileSync(path, JSON.stringify(state), { mode: 0o600 })
  return { home, path, before: state }
}

function readStored(path: string): TurnState {
  return JSON.parse(readFileSync(path, 'utf8')) as TurnState
}

function recordCount(state: TurnState): number {
  let total = 0
  for (const scope of Object.values(state.scopes)) {
    for (const records of Object.values(scope)) total += records.length
  }
  return total
}

function makeMinimalResult(): LoadConfigResult {
  return {
    config: {
      version: '1.0.0',
      global: {
        timeout: 30000 as Milliseconds,
        onError: 'block',
        maxFailures: 3,
        maxFailuresMessage: 'Too many failures',
        handoff: false,
      },
      hooks: {},
      events: {},
    },
    shadows: [],
    hasProjectConfig: true,
  }
}

function makeDeps(payload: Record<string, unknown>, projectRoot: string): RunEngineDeps {
  return {
    discoverProjectRoot: async () => ({
      projectRoot,
      signal: 'walk-up',
      from: projectRoot,
      checked: [projectRoot],
      boundary: 'git-root',
      boundaryPath: projectRoot,
    }),
    loadConfig: async () => makeMinimalResult(),
    loadAllHooks: async () => ({ loaded: [], loadErrors: [], dangling: [] }),
    readStdin: async () => payload,
  }
}

/**
 * Same shape as `makeDeps`, but with one registered hook that only handles
 * `PreToolUse` — so hooks.length > 0 and the engine reaches the
 * matched.length === 0 exit rather than the hooks-empty one.
 */
function makeDepsWithNonMatchingHook(
  payload: Record<string, unknown>,
  projectRoot: string,
): RunEngineDeps {
  const result = makeMinimalResult()
  result.config.hooks = {
    [hn('pre-only')]: {
      resolvedPath: '.clooks/hooks/pre-only.ts',
      config: {},
      parallel: false,
      origin: 'project',
    },
  }
  return {
    ...makeDeps(payload, projectRoot),
    loadConfig: async () => result,
    loadAllHooks: async () => ({
      loaded: [
        {
          name: hn('pre-only'),
          hook: {
            meta: { name: hn('pre-only') },
            PreToolUse: () => ({ result: 'allow' }),
          } as unknown as ClooksHook,
          config: {},
          hookPath: join(projectRoot, '.clooks/hooks/pre-only.ts'),
          configPath: join(projectRoot, '.clooks/clooks.yml'),
        },
      ],
      loadErrors: [],
      dangling: [],
    }),
  }
}

/** Deps with one registered hook that actually matches `Stop`. */
function makeDepsWithStopHook(
  payload: Record<string, unknown>,
  projectRoot: string,
  handler: (ctx: { turn: TurnContext }) => unknown,
): RunEngineDeps {
  const result = makeMinimalResult()
  result.config.hooks = {
    [hn('reminder')]: {
      resolvedPath: '.clooks/hooks/reminder.ts',
      config: {},
      parallel: false,
      origin: 'project',
    },
  }
  return {
    ...makeDeps(payload, projectRoot),
    loadConfig: async () => result,
    loadAllHooks: async () => ({
      loaded: [
        {
          name: hn('reminder'),
          hook: {
            meta: { name: hn('reminder') },
            Stop: handler,
          } as unknown as ClooksHook,
          config: {},
          hookPath: join(projectRoot, '.clooks/hooks/reminder.ts'),
          configPath: join(projectRoot, '.clooks/clooks.yml'),
        },
      ],
      loadErrors: [],
      dangling: [],
    }),
  }
}

async function runWithExitTrap(deps: RunEngineDeps): Promise<void> {
  const origExit = process.exit.bind(process)
  process.exit = ((code?: number | string) => {
    throw new ExitCalled(code)
  }) as typeof process.exit

  try {
    await runEngine(deps)
  } catch (e) {
    if (!(e instanceof ExitCalled)) throw e
  } finally {
    process.exit = origExit
  }
}

describe('runEngineCore: UserPromptSubmit turn boundary', () => {
  test('advances the generation and clears scopes with zero hooks loaded', async () => {
    const project = makeTempDir('clooks-turn-project-')
    const { path, before } = seedHomeRoot()

    await runWithExitTrap(
      makeDeps({ hook_event_name: 'UserPromptSubmit', session_id: SESSION, prompt: 'hi' }, project),
    )

    const after = readStored(path)
    expect(after.generation).toBeGreaterThan(before.generation)
    expect(recordCount(after)).toBe(0)
  })

  test('advances the generation when hooks are loaded but none match', async () => {
    const project = makeTempDir('clooks-turn-project-')
    const { path, before } = seedHomeRoot()

    await runWithExitTrap(
      makeDepsWithNonMatchingHook(
        { hook_event_name: 'UserPromptSubmit', session_id: SESSION, prompt: 'hi' },
        project,
      ),
    )

    const after = readStored(path)
    expect(after.generation).toBeGreaterThan(before.generation)
    expect(recordCount(after)).toBe(0)
  })
})

describe('runEngineCore: SessionStart source handling', () => {
  for (const source of ['startup', 'clear']) {
    test(`source "${source}" resets and advances the generation`, async () => {
      const project = makeTempDir('clooks-turn-project-')
      const { path, before } = seedHomeRoot()

      await runWithExitTrap(
        makeDeps({ hook_event_name: 'SessionStart', session_id: SESSION, source }, project),
      )

      const after = readStored(path)
      expect(after.generation).toBeGreaterThan(before.generation)
      expect(recordCount(after)).toBe(0)
    })
  }

  for (const source of ['resume', 'compact', 'some-future-source']) {
    test(`source "${source}" preserves history and does not advance`, async () => {
      const project = makeTempDir('clooks-turn-project-')
      const { path, before } = seedHomeRoot()

      await runWithExitTrap(
        makeDeps({ hook_event_name: 'SessionStart', session_id: SESSION, source }, project),
      )

      const after = readStored(path)
      expect(after.generation).toBe(before.generation)
      expect(after.epoch).toBe(before.epoch)
      expect(recordCount(after)).toBe(1)
    })
  }

  test('a missing source preserves history', async () => {
    const project = makeTempDir('clooks-turn-project-')
    const { path, before } = seedHomeRoot()

    await runWithExitTrap(
      makeDeps({ hook_event_name: 'SessionStart', session_id: SESSION }, project),
    )

    expect(readStored(path).generation).toBe(before.generation)
    expect(recordCount(readStored(path))).toBe(1)
  })
})

describe('runEngineCore: non-boundary events', () => {
  test('a PostToolUse invocation neither advances nor clears', async () => {
    const project = makeTempDir('clooks-turn-project-')
    const { path, before } = seedHomeRoot()

    await runWithExitTrap(
      makeDeps({ hook_event_name: 'PostToolUse', session_id: SESSION, tool_name: 'Bash' }, project),
    )

    const after = readStored(path)
    expect(after.generation).toBe(before.generation)
    expect(after.epoch).toBe(before.epoch)
    expect(recordCount(after)).toBe(1)
  })
})

describe('runEngineCore: unusable session identity', () => {
  // An empty string is as unusable as an absent one: it hashes to a real path
  // that every identity-less session would share.
  const cases: { label: string; sessionId?: unknown }[] = [
    { label: 'missing' },
    { label: 'numeric', sessionId: 42 },
    { label: 'empty string', sessionId: '' },
  ]

  for (const { label, sessionId } of cases) {
    test(`a ${label} session_id runs hooks with an empty ctx.turn and writes nothing`, async () => {
      const project = makeTempDir('clooks-turn-project-')
      const home = makeTempDir('clooks-turn-home-')
      process.env.CLOOKS_HOME_ROOT = home

      let seen: TurnContext | undefined
      const payload: Record<string, unknown> = { hook_event_name: 'Stop' }
      if (sessionId !== undefined) payload.session_id = sessionId

      await runWithExitTrap(
        makeDepsWithStopHook(payload, project, (ctx) => {
          seen = ctx.turn
          return { result: 'block', reason: 'still deciding normally' }
        }),
      )

      expect(seen).toEqual({ prior: [], priorRuns: 0, priorInterventions: 0 })
      expect(existsSync(join(home, '.clooks', 'turn-state'))).toBe(false)
    })

    test(`a ${label} session_id skips the UserPromptSubmit boundary`, async () => {
      const project = makeTempDir('clooks-turn-project-')
      const home = makeTempDir('clooks-turn-home-')
      process.env.CLOOKS_HOME_ROOT = home

      const payload: Record<string, unknown> = { hook_event_name: 'UserPromptSubmit', prompt: 'hi' }
      if (sessionId !== undefined) payload.session_id = sessionId

      await runWithExitTrap(makeDeps(payload, project))

      expect(existsSync(join(home, '.clooks', 'turn-state'))).toBe(false)
    })
  }
})

describe('runEngineCore: the feature, through the engine entry point', () => {
  test('a hook that blocks in one invocation sees priorInterventions === 1 in the next', async () => {
    const project = makeTempDir('clooks-turn-project-')
    const home = makeTempDir('clooks-turn-home-')
    process.env.CLOOKS_HOME_ROOT = home

    const seen: TurnContext[] = []
    const oncePerTurn = (ctx: { turn: TurnContext }) => {
      seen.push(ctx.turn)
      if (ctx.turn.priorInterventions > 0) return { result: 'skip' }
      return { result: 'block', reason: 'Remember to lint the files you changed.' }
    }
    const payload = { hook_event_name: 'Stop', session_id: SESSION }

    await runWithExitTrap(makeDepsWithStopHook(payload, project, oncePerTurn))
    await runWithExitTrap(makeDepsWithStopHook(payload, project, oncePerTurn))

    expect(seen).toHaveLength(2)
    expect(seen[0]?.priorInterventions).toBe(0)
    // This is the wiring under test: run.ts read the snapshot and handed
    // executeHooks a tracker. Remove either and this drops back to 0.
    expect(seen[1]?.priorInterventions).toBe(1)
    expect(seen[1]?.priorRuns).toBe(1)
    expect(seen[1]?.prior.map((r) => r.decision)).toEqual(['block'])
  })

  test('a UserPromptSubmit between the two invocations resets the counter', async () => {
    const project = makeTempDir('clooks-turn-project-')
    const home = makeTempDir('clooks-turn-home-')
    process.env.CLOOKS_HOME_ROOT = home

    const seen: TurnContext[] = []
    const oncePerTurn = (ctx: { turn: TurnContext }) => {
      seen.push(ctx.turn)
      if (ctx.turn.priorInterventions > 0) return { result: 'skip' }
      return { result: 'block', reason: 'Remember to lint.' }
    }
    const stopPayload = { hook_event_name: 'Stop', session_id: SESSION }

    await runWithExitTrap(makeDepsWithStopHook(stopPayload, project, oncePerTurn))
    await runWithExitTrap(
      makeDeps(
        { hook_event_name: 'UserPromptSubmit', session_id: SESSION, prompt: 'next' },
        project,
      ),
    )
    await runWithExitTrap(makeDepsWithStopHook(stopPayload, project, oncePerTurn))

    expect(seen[0]?.priorInterventions).toBe(0)
    expect(seen[1]?.priorInterventions).toBe(0)
    expect(seen[1]?.prior).toHaveLength(0)
  })

  test('two different sessions do not see each other’s history', async () => {
    const project = makeTempDir('clooks-turn-project-')
    const home = makeTempDir('clooks-turn-home-')
    process.env.CLOOKS_HOME_ROOT = home

    const seen: TurnContext[] = []
    const handler = (ctx: { turn: TurnContext }) => {
      seen.push(ctx.turn)
      return { result: 'block', reason: 'intervening' }
    }

    await runWithExitTrap(
      makeDepsWithStopHook(
        { hook_event_name: 'Stop', session_id: 'session-one' },
        project,
        handler,
      ),
    )
    await runWithExitTrap(
      makeDepsWithStopHook(
        { hook_event_name: 'Stop', session_id: 'session-two' },
        project,
        handler,
      ),
    )

    expect(seen[1]?.prior).toHaveLength(0)
  })
})
