import { describe, test, expect, afterEach, spyOn } from 'bun:test'
import { runEngine } from './run.js'
import type { RunEngineDeps } from './types.js'
import type { DiscoveryResult } from '../config/discovery.js'
import type { LoadConfigResult } from '../config/index.js'
import type { Milliseconds } from '../types/branded.js'

class ExitCalled extends Error {
  constructor(public readonly code: number | string | undefined) {
    super(`ExitCalled(${String(code)})`)
    this.name = 'ExitCalled'
  }
}

function makeCwdFallbackDiscovery(overrides?: Partial<DiscoveryResult>): DiscoveryResult {
  return {
    projectRoot: '/some/cwd',
    signal: 'cwd-fallback',
    from: '/some/cwd',
    boundary: 'home',
    boundaryPath: '/home/user',
    checked: ['/some/cwd'],
    ...overrides,
  }
}

function makeStubLoadAllHooks() {
  return async () => ({ loaded: [], loadErrors: [], dangling: [] })
}

/**
 * Builds a minimal LoadConfigResult that the engine can process without
 * crashing. The config has no hooks and no events, so loadAllHooks returns
 * empty and the engine exits cleanly at the hooks.length === 0 early-exit.
 */
function makeMinimalResult(hasProjectConfig: boolean): LoadConfigResult {
  return {
    config: {
      version: '1.0.0',
      global: {
        timeout: 30000 as Milliseconds,
        onError: 'block',
        maxFailures: 3,
        maxFailuresMessage: 'Too many failures',
      },
      hooks: {},
      events: {},
    },
    shadows: [],
    hasProjectConfig,
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

let stderrSpy: ReturnType<typeof spyOn>

afterEach(() => {
  if (stderrSpy) {
    stderrSpy.mockRestore()
  }
})

describe('runEngine M5b: cwd-fallback warning', () => {
  test('emits warning on SessionStart when signal is cwd-fallback and no project config', async () => {
    const capturedStderr: string[] = []
    stderrSpy = spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      capturedStderr.push(String(msg))
      return true
    })

    const deps: RunEngineDeps = {
      discoverProjectRoot: async () => makeCwdFallbackDiscovery(),
      loadConfig: async () => null,
      loadAllHooks: makeStubLoadAllHooks(),
      readStdin: async () => ({
        hook_event_name: 'SessionStart',
        session_id: 'test-session',
      }),
    }

    await runWithExitTrap(deps)

    const allStderr = capturedStderr.join('')
    expect(allStderr).toContain(
      'clooks: no .clooks/clooks.yml found walking up from /some/cwd (bounded by home at /home/user)',
    )
  })

  test('does NOT emit warning on non-SessionStart event (PreToolUse)', async () => {
    const capturedStderr: string[] = []
    stderrSpy = spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      capturedStderr.push(String(msg))
      return true
    })

    const deps: RunEngineDeps = {
      discoverProjectRoot: async () => makeCwdFallbackDiscovery(),
      loadConfig: async () => null,
      loadAllHooks: makeStubLoadAllHooks(),
      readStdin: async () => ({
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'ls' },
      }),
    }

    await runWithExitTrap(deps)

    const allStderr = capturedStderr.join('')
    expect(allStderr).not.toContain('no .clooks/clooks.yml found walking up')
  })

  // Realistic replacement: walk-up + non-null result + hasProjectConfig:true suppresses warning
  test('does NOT emit warning when signal is walk-up (non-null result, hasProjectConfig true) on SessionStart', async () => {
    const capturedStderr: string[] = []
    stderrSpy = spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      capturedStderr.push(String(msg))
      return true
    })

    const deps: RunEngineDeps = {
      discoverProjectRoot: async () => ({
        projectRoot: '/some/cwd',
        signal: 'walk-up',
        from: '/some/cwd',
        checked: ['/some/cwd'],
        boundary: 'home',
        boundaryPath: '/home/user',
      }),
      loadConfig: async () => makeMinimalResult(true),
      loadAllHooks: makeStubLoadAllHooks(),
      readStdin: async () => ({
        hook_event_name: 'SessionStart',
        session_id: 'test-session',
      }),
    }

    await runWithExitTrap(deps)

    const allStderr = capturedStderr.join('')
    expect(allStderr).not.toContain('no .clooks/clooks.yml found walking up')
  })

  // --- Second M5b block (non-null result path, lines 356-366 in run.ts) ---

  test('second M5b block: emits warning on SessionStart when signal is cwd-fallback and hasProjectConfig is false (non-null result)', async () => {
    const capturedStderr: string[] = []
    stderrSpy = spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      capturedStderr.push(String(msg))
      return true
    })

    const deps: RunEngineDeps = {
      discoverProjectRoot: async () => ({
        projectRoot: '/some/cwd',
        signal: 'cwd-fallback',
        from: '/some/cwd',
        checked: ['/some/cwd'],
        boundary: 'home',
        boundaryPath: '/home/user',
      }),
      loadConfig: async () => makeMinimalResult(false),
      loadAllHooks: makeStubLoadAllHooks(),
      readStdin: async () => ({
        hook_event_name: 'SessionStart',
        session_id: 'test-session',
      }),
    }

    await runWithExitTrap(deps)

    const allStderr = capturedStderr.join('')
    expect(allStderr).toContain(
      'clooks: no .clooks/clooks.yml found walking up from /some/cwd (bounded by home at /home/user)',
    )
  })

  test('second M5b block: does NOT emit warning when hasProjectConfig is true (non-null result, cwd-fallback, SessionStart)', async () => {
    const capturedStderr: string[] = []
    stderrSpy = spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      capturedStderr.push(String(msg))
      return true
    })

    const deps: RunEngineDeps = {
      discoverProjectRoot: async () => ({
        projectRoot: '/some/cwd',
        signal: 'cwd-fallback',
        from: '/some/cwd',
        checked: ['/some/cwd'],
        boundary: 'home',
        boundaryPath: '/home/user',
      }),
      loadConfig: async () => makeMinimalResult(true),
      loadAllHooks: makeStubLoadAllHooks(),
      readStdin: async () => ({
        hook_event_name: 'SessionStart',
        session_id: 'test-session',
      }),
    }

    await runWithExitTrap(deps)

    const allStderr = capturedStderr.join('')
    expect(allStderr).not.toContain('no .clooks/clooks.yml found walking up')
  })

  test('warning format includes boundary and boundaryPath', async () => {
    const capturedStderr: string[] = []
    stderrSpy = spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
      capturedStderr.push(String(msg))
      return true
    })

    const deps: RunEngineDeps = {
      discoverProjectRoot: async () =>
        makeCwdFallbackDiscovery({
          from: '/workspace/myapp',
          boundary: 'git-root',
          boundaryPath: '/workspace',
        }),
      loadConfig: async () => null,
      loadAllHooks: makeStubLoadAllHooks(),
      readStdin: async () => ({
        hook_event_name: 'SessionStart',
        session_id: 'test-session',
      }),
    }

    await runWithExitTrap(deps)

    const allStderr = capturedStderr.join('')
    expect(allStderr).toContain(
      'clooks: no .clooks/clooks.yml found walking up from /workspace/myapp (bounded by git-root at /workspace)',
    )
  })
})
