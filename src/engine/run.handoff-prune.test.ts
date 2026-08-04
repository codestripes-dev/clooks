import { describe, test, expect, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, utimesSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { runEngine } from './run.js'
import { HANDOFF_TTL_MS } from './handoff.js'
import type { RunEngineDeps } from './types.js'
import type { LoadConfigResult } from '../config/index.js'
import type { ClooksHook } from '../types/hook.js'
import type { Milliseconds } from '../types/branded.js'
import { hn } from '../test-utils.js'

class ExitCalled extends Error {
  constructor(public readonly code: number | string | undefined) {
    super(`ExitCalled(${String(code)})`)
    this.name = 'ExitCalled'
  }
}

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'clooks-run-prune-'))
  tempDirs.push(dir)
  return dir
}

function writeStaleHandoffFile(root: string): string {
  const dir = join(root, '.clooks', 'tmp')
  mkdirSync(dir, { recursive: true })
  const target = join(dir, 'handoff-h-abc123456789.md')
  writeFileSync(target, 'stale content')
  const stale = new Date(Date.now() - HANDOFF_TTL_MS - 60_000)
  utimesSync(target, stale, stale)
  return target
}

/**
 * Minimal LoadConfigResult with no hooks and no events, so loadAllHooks
 * returns empty and the engine exits at the hooks.length === 0 early-exit —
 * proving the prune runs even when it happens before that exit.
 */
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

function makeStubLoadAllHooks() {
  return async () => ({ loaded: [], loadErrors: [], dangling: [] })
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

describe('runEngineCore: handoff prune placement', () => {
  test('SessionStart prunes a stale handoff file even when zero hooks match', async () => {
    const root = makeTempRoot()
    const target = writeStaleHandoffFile(root)

    const deps: RunEngineDeps = {
      discoverProjectRoot: async () => ({
        projectRoot: root,
        signal: 'walk-up',
        from: root,
        checked: [root],
        boundary: 'git-root',
        boundaryPath: root,
      }),
      loadConfig: async () => makeMinimalResult(),
      loadAllHooks: makeStubLoadAllHooks(),
      readStdin: async () => ({
        hook_event_name: 'SessionStart',
        session_id: 'test-session',
      }),
    }

    await runWithExitTrap(deps)

    expect(existsSync(target)).toBe(false)
  })

  test('SessionStart prunes when hooks exist but none handle the event', async () => {
    const root = makeTempRoot()
    const target = writeStaleHandoffFile(root)

    // A registered, successfully loaded hook that only handles PreToolUse:
    // hooks.length > 0, so the engine reaches the matched.length === 0 exit
    // instead of the hooks.length === 0 one the test above covers.
    const result = makeMinimalResult()
    result.config.hooks = {
      [hn('pre-only')]: {
        resolvedPath: '.clooks/hooks/pre-only.ts',
        config: {},
        parallel: false,
        origin: 'project',
      },
    }

    const deps: RunEngineDeps = {
      discoverProjectRoot: async () => ({
        projectRoot: root,
        signal: 'walk-up',
        from: root,
        checked: [root],
        boundary: 'git-root',
        boundaryPath: root,
      }),
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
            hookPath: join(root, '.clooks/hooks/pre-only.ts'),
            configPath: join(root, '.clooks/clooks.yml'),
          },
        ],
        loadErrors: [],
        dangling: [],
      }),
      readStdin: async () => ({
        hook_event_name: 'SessionStart',
        session_id: 'test-session',
      }),
    }

    await runWithExitTrap(deps)

    expect(existsSync(target)).toBe(false)
  })

  test('non-SessionStart event does not prune a stale handoff file', async () => {
    const root = makeTempRoot()
    const target = writeStaleHandoffFile(root)

    const deps: RunEngineDeps = {
      discoverProjectRoot: async () => ({
        projectRoot: root,
        signal: 'walk-up',
        from: root,
        checked: [root],
        boundary: 'git-root',
        boundaryPath: root,
      }),
      loadConfig: async () => makeMinimalResult(),
      loadAllHooks: makeStubLoadAllHooks(),
      readStdin: async () => ({
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'ls' },
      }),
    }

    await runWithExitTrap(deps)

    expect(existsSync(target)).toBe(true)
  })
})
