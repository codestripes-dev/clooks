import { describe, test, expect, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { runEngine } from './run.js'
import type { RunEngineDeps } from './types.js'
import type { LoadConfigResult } from '../config/index.js'

const MINIMAL_STDIN = {
  hook_event_name: 'SessionStart',
  session_id: 'test-session',
}

// Sentinel thrown by the exit stub. runEngine's outer catch re-throws it as
// another ExitCalled(2), so we just need to catch any ExitCalled.
class ExitCalled extends Error {
  constructor(public readonly code: number | string | undefined) {
    super(`ExitCalled(${String(code)})`)
    this.name = 'ExitCalled'
  }
}

function makeMinimalLoadConfig(capture: { projectRoot?: string }) {
  return async (projectRoot: string): Promise<LoadConfigResult | null> => {
    capture.projectRoot = projectRoot
    // Throw so execution stops before process.exit is reached, keeping the
    // exit-stub simple. runEngine's outer catch will write to stderr and call
    // process.exit(EXIT_STDERR), which throws ExitCalled(2) — expected.
    throw new Error('__test_stop__')
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

let failurePathTempDir = ''

afterEach(() => {
  if (failurePathTempDir) {
    rmSync(failurePathTempDir, { recursive: true, force: true })
    failurePathTempDir = ''
  }
})

function makeDiscovery(projectRoot: string): import('../config/discovery.js').DiscoveryResult {
  return {
    projectRoot,
    signal: 'walk-up',
    from: projectRoot,
    checked: [projectRoot],
    boundary: 'git-root',
    boundaryPath: projectRoot,
  }
}

describe('runEngine DI: discoverProjectRoot integration', () => {
  test('loadConfig receives the project root returned by injected discoverProjectRoot', async () => {
    const capture: { projectRoot?: string } = {}

    const deps: RunEngineDeps = {
      discoverProjectRoot: async () => makeDiscovery('/fake/project/root'),
      loadConfig: makeMinimalLoadConfig(capture),
      loadAllHooks: makeStubLoadAllHooks(),
      readStdin: async () => MINIMAL_STDIN,
    }

    await runWithExitTrap(deps)

    // The walked-up root from the injected stub must be passed verbatim to loadConfig.
    expect(capture.projectRoot).toBe('/fake/project/root')
  })

  test('configFailurePath is rooted under the projectRoot returned by discoverProjectRoot', async () => {
    failurePathTempDir = mkdtempSync(join(tmpdir(), 'clooks-failure-path-'))
    const fakeRoot = failurePathTempDir

    const throwingLoadConfig = async (): Promise<LoadConfigResult | null> => {
      throw new Error('config parse error')
    }

    const deps: RunEngineDeps = {
      discoverProjectRoot: async () => makeDiscovery(fakeRoot),
      loadConfig: throwingLoadConfig,
      loadAllHooks: makeStubLoadAllHooks(),
      readStdin: async () => MINIMAL_STDIN,
    }

    await runWithExitTrap(deps)

    const expectedFailurePath = join(fakeRoot, '.clooks/.failures')
    expect(existsSync(expectedFailurePath)).toBe(true)
  })

  test('loadConfig receives a non-empty path when discoverProjectRoot is not injected', async () => {
    // Omit discoverProjectRoot — the engine uses the real helper, which falls back
    // to cwd in a test environment that has no .clooks/clooks.yml above it.
    const capture: { projectRoot?: string } = {}

    const deps: RunEngineDeps = {
      loadConfig: makeMinimalLoadConfig(capture),
      loadAllHooks: makeStubLoadAllHooks(),
      readStdin: async () => MINIMAL_STDIN,
    }

    await runWithExitTrap(deps)

    // The root must be a non-empty absolute path; exact value depends on cwd.
    expect(typeof capture.projectRoot).toBe('string')
    expect((capture.projectRoot ?? '').length).toBeGreaterThan(0)
  })
})
