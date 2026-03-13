/**
 * Tests for the runEngine() entry point function.
 *
 * Uses dependency injection (RunEngineDeps) instead of mock.module.
 * We cannot use mock.module("./config/index.js") or mock.module("./loader.js")
 * because bun's mock.module is process-wide — it poisons config/index.test.ts
 * and loader.test.ts (16+ broken tests).  The RunEngineDeps pattern injects
 * fakes through an optional parameter, avoiding any global mock state.
 */
import { describe, it, expect, spyOn, mock, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { HookName, Milliseconds } from './types/branded.js'
import { DEFAULT_MAX_FAILURES_MESSAGE } from './config/constants.js'
import { runEngine } from './engine'
import type { RunEngineDeps } from './engine'
import { defaultDeps } from './engine'

const hn = (s: string) => s as HookName
const ms = (n: number) => n as Milliseconds

let tempDir: string
let exitSpy: ReturnType<typeof spyOn>
let stdoutSpy: ReturnType<typeof spyOn>
let stderrSpy: ReturnType<typeof spyOn>
let originalCwd: () => string

// Mock dep functions that get reset each test
let mockLoadConfig: ReturnType<typeof mock>
let mockLoadAllHooks: ReturnType<typeof mock>
let mockReadStdin: ReturnType<typeof mock>

function makeDeps(): RunEngineDeps {
  return {
    loadConfig: mockLoadConfig as any,
    loadAllHooks: mockLoadAllHooks as any,
    readStdin: mockReadStdin as any,
  }
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'clooks-engine-run-test-'))
  mkdirSync(join(tempDir, '.clooks'), { recursive: true })
  originalCwd = process.cwd
  process.cwd = () => tempDir
  // process.exit must throw to prevent runEngine from continuing past exit
  // points.  The `as () => never` cast satisfies TS's noreturn expectation.
  exitSpy = spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('process.exit called')
  }) as () => never)
  stdoutSpy = spyOn(process.stdout, 'write').mockImplementation(() => true)
  stderrSpy = spyOn(process.stderr, 'write').mockImplementation(() => true)
  mockLoadConfig = mock(() => Promise.resolve(null))
  mockLoadAllHooks = mock(() => Promise.resolve({ loaded: [], loadErrors: [] }))
  mockReadStdin = mock(() => Promise.resolve({}))
})

afterEach(() => {
  process.cwd = originalCwd
  exitSpy.mockRestore()
  stdoutSpy.mockRestore()
  stderrSpy.mockRestore()
  delete process.env.CLOOKS_DEBUG
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

function makeConfig(
  hooks: Record<
    string,
    {
      parallel?: boolean
      onError?: string
      events?: Record<string, { onError?: string; enabled?: boolean }>
      enabled?: boolean
    }
  > = {},
) {
  const hooksEntries: Record<HookName, any> = {}
  for (const [name, overrides] of Object.entries(hooks)) {
    hooksEntries[hn(name)] = {
      resolvedPath: `.clooks/hooks/${name}.ts`,
      config: {},
      parallel: overrides.parallel ?? false,
      origin: 'project',
      ...(overrides.onError !== undefined ? { onError: overrides.onError } : {}),
      ...(overrides.events !== undefined ? { events: overrides.events } : {}),
      ...(overrides.enabled !== undefined ? { enabled: overrides.enabled } : {}),
    }
  }
  return {
    version: '1.0.0',
    global: {
      timeout: ms(30000),
      onError: 'block' as const,
      maxFailures: 3,
      maxFailuresMessage: DEFAULT_MAX_FAILURES_MESSAGE,
    },
    hooks: hooksEntries,
    events: {} as Record<string, any>,
  }
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- test helper, any callable shape is fine
function makeLoadedHook(name: string, handlers: Record<string, Function>) {
  return {
    name: hn(name),
    hook: { meta: { name: hn(name) }, ...handlers } as any,
    config: {},
    hookPath: `/test/hooks/${name}.ts`,
    configPath: '/test/.clooks/clooks.yml',
  }
}

function getStdout(): string {
  return stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
}

function getStderr(): string {
  return stderrSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
}

describe('runEngine', () => {
  it('exits 0 when loadConfig returns null (no config)', async () => {
    mockLoadConfig.mockResolvedValue(null)
    await runEngine(makeDeps()).catch(() => {})
    expect(exitSpy).toHaveBeenCalledWith(0)
  })

  it('exits 2 with stderr when loadConfig throws', async () => {
    mockLoadConfig.mockRejectedValue(new Error('config parse failed'))
    await runEngine(makeDeps()).catch(() => {})
    expect(exitSpy).toHaveBeenCalledWith(2)
    expect(getStderr()).toContain('config parse failed')
  })

  it('exits 0 when no hooks loaded and no load errors', async () => {
    mockLoadConfig.mockResolvedValue({
      config: makeConfig(),
      shadows: [],
      hasProjectConfig: true,
    })
    mockLoadAllHooks.mockResolvedValue({ loaded: [], loadErrors: [] })
    await runEngine(makeDeps()).catch(() => {})
    expect(exitSpy).toHaveBeenCalledWith(0)
  })

  it('exits 2 when stdin JSON parse fails', async () => {
    mockLoadConfig.mockResolvedValue({
      config: makeConfig({ 'my-hook': {} }),
      shadows: [],
      hasProjectConfig: true,
    })
    mockLoadAllHooks.mockResolvedValue({
      loaded: [makeLoadedHook('my-hook', { PreToolUse: () => ({ result: 'allow' }) })],
      loadErrors: [],
    })
    mockReadStdin.mockRejectedValue(new Error('JSON parse error'))
    await runEngine(makeDeps()).catch(() => {})
    expect(exitSpy).toHaveBeenCalledWith(2)
    expect(getStderr()).toContain('failed to parse stdin JSON')
  })

  it('exits 2 when stdin is not a JSON object (null)', async () => {
    mockLoadConfig.mockResolvedValue({
      config: makeConfig({ 'my-hook': {} }),
      shadows: [],
      hasProjectConfig: true,
    })
    mockLoadAllHooks.mockResolvedValue({
      loaded: [makeLoadedHook('my-hook', { PreToolUse: () => ({ result: 'allow' }) })],
      loadErrors: [],
    })
    mockReadStdin.mockResolvedValue(null)
    await runEngine(makeDeps()).catch(() => {})
    expect(exitSpy).toHaveBeenCalledWith(2)
    expect(getStderr()).toContain('not a JSON object')
  })

  it('exits 2 when stdin is an array', async () => {
    mockLoadConfig.mockResolvedValue({
      config: makeConfig({ 'my-hook': {} }),
      shadows: [],
      hasProjectConfig: true,
    })
    mockLoadAllHooks.mockResolvedValue({
      loaded: [makeLoadedHook('my-hook', { PreToolUse: () => ({ result: 'allow' }) })],
      loadErrors: [],
    })
    mockReadStdin.mockResolvedValue([1, 2, 3])
    await runEngine(makeDeps()).catch(() => {})
    expect(exitSpy).toHaveBeenCalledWith(2)
    expect(getStderr()).toContain('not a JSON object')
  })

  it('exits 2 when hook_event_name is unrecognized', async () => {
    mockLoadConfig.mockResolvedValue({
      config: makeConfig({ 'my-hook': {} }),
      shadows: [],
      hasProjectConfig: true,
    })
    mockLoadAllHooks.mockResolvedValue({
      loaded: [makeLoadedHook('my-hook', { PreToolUse: () => ({ result: 'allow' }) })],
      loadErrors: [],
    })
    mockReadStdin.mockResolvedValue({ hook_event_name: 'FakeEvent' })
    await runEngine(makeDeps()).catch(() => {})
    expect(exitSpy).toHaveBeenCalledWith(2)
    expect(getStderr()).toContain('unrecognized hook_event_name')
  })

  it('exits 0 when no hooks match the event', async () => {
    mockLoadConfig.mockResolvedValue({
      config: makeConfig({ 'my-hook': {} }),
      shadows: [],
      hasProjectConfig: true,
    })
    mockLoadAllHooks.mockResolvedValue({
      loaded: [makeLoadedHook('my-hook', { PostToolUse: () => ({ result: 'skip' }) })],
      loadErrors: [],
    })
    mockReadStdin.mockResolvedValue({ hook_event_name: 'PreToolUse' })
    await runEngine(makeDeps()).catch(() => {})
    expect(exitSpy).toHaveBeenCalledWith(0)
  })

  it('outputs allow result for matching PreToolUse hook', async () => {
    mockLoadConfig.mockResolvedValue({
      config: makeConfig({ 'my-hook': {} }),
      shadows: [],
      hasProjectConfig: true,
    })
    mockLoadAllHooks.mockResolvedValue({
      loaded: [
        makeLoadedHook('my-hook', {
          PreToolUse: () => ({ result: 'allow' }),
        }),
      ],
      loadErrors: [],
    })
    mockReadStdin.mockResolvedValue({ hook_event_name: 'PreToolUse' })
    await runEngine(makeDeps()).catch(() => {})
    const stdout = getStdout()
    expect(stdout).toContain('hookSpecificOutput')
  })

  it('handles block result for PreToolUse', async () => {
    mockLoadConfig.mockResolvedValue({
      config: makeConfig({ blocker: {} }),
      shadows: [],
      hasProjectConfig: true,
    })
    mockLoadAllHooks.mockResolvedValue({
      loaded: [
        makeLoadedHook('blocker', {
          PreToolUse: () => ({ result: 'block', reason: 'no rm -rf' }),
        }),
      ],
      loadErrors: [],
    })
    mockReadStdin.mockResolvedValue({ hook_event_name: 'PreToolUse' })
    await runEngine(makeDeps()).catch(() => {})
    const stdout = getStdout()
    expect(stdout).toContain('deny')
    expect(stdout).toContain('no rm -rf')
  })

  it('emits shadow warnings on SessionStart', async () => {
    mockLoadConfig.mockResolvedValue({
      config: makeConfig({ 'my-hook': {} }),
      shadows: [hn('my-hook')],
      hasProjectConfig: true,
    })
    mockLoadAllHooks.mockResolvedValue({
      loaded: [
        makeLoadedHook('my-hook', {
          SessionStart: () => ({ result: 'skip' }),
        }),
      ],
      loadErrors: [],
    })
    mockReadStdin.mockResolvedValue({ hook_event_name: 'SessionStart' })
    await runEngine(makeDeps()).catch(() => {})
    const stdout = getStdout()
    expect(stdout).toContain('shadowing')
  })

  it('emits debug lines when CLOOKS_DEBUG is true', async () => {
    process.env.CLOOKS_DEBUG = 'true'
    mockLoadConfig.mockResolvedValue({
      config: makeConfig({ 'my-hook': {} }),
      shadows: [],
      hasProjectConfig: true,
    })
    mockLoadAllHooks.mockResolvedValue({
      loaded: [
        makeLoadedHook('my-hook', {
          PreToolUse: () => ({ result: 'allow' }),
        }),
      ],
      loadErrors: [],
    })
    mockReadStdin.mockResolvedValue({ hook_event_name: 'PreToolUse' })
    await runEngine(makeDeps()).catch(() => {})
    const stderr = getStderr()
    expect(stderr).toContain('[clooks:debug]')
  })

  it('handles hook error with onError continue and emits systemMessage', async () => {
    mockLoadConfig.mockResolvedValue({
      config: makeConfig({ 'failing-hook': { onError: 'continue' } }),
      shadows: [],
      hasProjectConfig: true,
    })
    mockLoadAllHooks.mockResolvedValue({
      loaded: [
        makeLoadedHook('failing-hook', {
          PreToolUse: () => {
            throw new Error('hook crashed')
          },
        }),
      ],
      loadErrors: [],
    })
    mockReadStdin.mockResolvedValue({ hook_event_name: 'PreToolUse' })
    await runEngine(makeDeps()).catch(() => {})
    const stdout = getStdout()
    expect(stdout.length).toBeGreaterThan(0)
    const parsed = JSON.parse(stdout.trim().split('\n')[0]!)
    expect(parsed.systemMessage).toContain('hook crashed')
  })

  it('handles trace onError on injectable event', async () => {
    mockLoadConfig.mockResolvedValue({
      config: makeConfig({ 'trace-hook': { onError: 'trace' } }),
      shadows: [],
      hasProjectConfig: true,
    })
    mockLoadAllHooks.mockResolvedValue({
      loaded: [
        makeLoadedHook('trace-hook', {
          PreToolUse: () => {
            throw new Error('trace error')
          },
        }),
      ],
      loadErrors: [],
    })
    mockReadStdin.mockResolvedValue({ hook_event_name: 'PreToolUse' })
    await runEngine(makeDeps()).catch(() => {})
    const stdout = getStdout()
    expect(stdout).toContain('trace error')
  })

  it('handles continuation event stop result', async () => {
    mockLoadConfig.mockResolvedValue({
      config: makeConfig({ stopper: {} }),
      shadows: [],
      hasProjectConfig: true,
    })
    mockLoadAllHooks.mockResolvedValue({
      loaded: [
        makeLoadedHook('stopper', {
          TeammateIdle: () => ({ result: 'stop', reason: 'done working' }),
        }),
      ],
      loadErrors: [],
    })
    mockReadStdin.mockResolvedValue({ hook_event_name: 'TeammateIdle' })
    await runEngine(makeDeps()).catch(() => {})
    const stdout = getStdout()
    const parsed = JSON.parse(stdout.trim().split('\n')[0]!)
    expect(parsed.continue).toBe(false)
    expect(parsed.stopReason).toBe('done working')
  })

  it('disabled hook warnings in order lists', async () => {
    const config = makeConfig({ 'disabled-hook': { enabled: false }, other: {} })
    config.events = { SessionStart: { order: [hn('disabled-hook')] } }
    mockLoadConfig.mockResolvedValue({ config, shadows: [], hasProjectConfig: true })
    mockLoadAllHooks.mockResolvedValue({
      loaded: [makeLoadedHook('other', { PreToolUse: () => ({ result: 'skip' }) })],
      loadErrors: [],
    })
    mockReadStdin.mockResolvedValue({ hook_event_name: 'SessionStart' })
    await runEngine(makeDeps()).catch(() => {})
    const stdout = getStdout()
    expect(stdout).toContain('disabled')
  })

  it("warns about enabled: false on events the hook doesn't handle", async () => {
    const config = makeConfig({ 'my-hook': { events: { PostToolUse: { enabled: false } } } })
    mockLoadConfig.mockResolvedValue({ config, shadows: [], hasProjectConfig: true })
    mockLoadAllHooks.mockResolvedValue({
      loaded: [makeLoadedHook('my-hook', { PreToolUse: () => ({ result: 'skip' }) })],
      loadErrors: [],
    })
    mockReadStdin.mockResolvedValue({ hook_event_name: 'PreToolUse' })
    await runEngine(makeDeps()).catch(() => {})
    const stdout = getStdout()
    expect(stdout).toContain('does not handle event')
  })

  it('warns about trace on non-injectable event at startup', async () => {
    const config = makeConfig({ 'trace-hook': { onError: 'trace' } })
    mockLoadConfig.mockResolvedValue({ config, shadows: [], hasProjectConfig: true })
    mockLoadAllHooks.mockResolvedValue({
      loaded: [makeLoadedHook('trace-hook', { SessionEnd: () => ({ result: 'skip' }) })],
      loadErrors: [],
    })
    mockReadStdin.mockResolvedValue({ hook_event_name: 'SessionEnd' })
    await runEngine(makeDeps()).catch(() => {})
    const stdout = getStdout()
    expect(stdout).toContain('does not support additionalContext')
  })

  it('catches fatal exceptions and exits 2', async () => {
    mockLoadConfig.mockResolvedValue({
      config: makeConfig({ 'my-hook': {} }),
      shadows: [],
      hasProjectConfig: true,
    })
    mockLoadAllHooks.mockRejectedValue(new Error('catastrophic failure'))
    await runEngine(makeDeps()).catch(() => {})
    expect(exitSpy).toHaveBeenCalledWith(2)
    expect(getStderr()).toContain('fatal error')
  })

  it('debug with load errors', async () => {
    process.env.CLOOKS_DEBUG = 'true'
    mockLoadConfig.mockResolvedValue({
      config: makeConfig({ broken: {} }),
      shadows: [],
      hasProjectConfig: true,
    })
    mockLoadAllHooks.mockResolvedValue({
      loaded: [],
      loadErrors: [{ name: hn('broken'), error: 'not found', hookPath: '/test/broken.ts' }],
    })
    mockReadStdin.mockResolvedValue({ hook_event_name: 'PreToolUse' })
    await runEngine(makeDeps()).catch(() => {})
    const stderr = getStderr()
    expect(stderr).toContain('load error')
  })

  it('degraded messages on non-injectable event go to stderr', async () => {
    // The circuit breaker only degrades a hook after maxFailures (default 3)
    // consecutive failures.  We pre-seed the .failures file to put the hook
    // at the threshold so the *next* failure triggers the degraded path.
    const { writeFailures, recordFailure } = await import('./failures.js')
    const failurePath = join(tempDir, '.clooks/.failures')
    let state: any = {}
    state = recordFailure(state, hn('failing'), 'SessionEnd' as any, 'err')
    state = recordFailure(state, hn('failing'), 'SessionEnd' as any, 'err')
    state = recordFailure(state, hn('failing'), 'SessionEnd' as any, 'err')
    await writeFailures(failurePath, state)

    mockLoadConfig.mockResolvedValue({
      config: makeConfig({ failing: {} }),
      shadows: [],
      hasProjectConfig: true,
    })
    mockLoadAllHooks.mockResolvedValue({
      loaded: [
        makeLoadedHook('failing', {
          SessionEnd: () => {
            throw new Error('degraded')
          },
        }),
      ],
      loadErrors: [],
    })
    mockReadStdin.mockResolvedValue({ hook_event_name: 'SessionEnd' })
    await runEngine(makeDeps()).catch(() => {})
    const stderr = getStderr()
    expect(stderr).toContain('warning')
  })

  it('PermissionRequest block with interrupt', async () => {
    mockLoadConfig.mockResolvedValue({
      config: makeConfig({ perm: {} }),
      shadows: [],
      hasProjectConfig: true,
    })
    mockLoadAllHooks.mockResolvedValue({
      loaded: [
        makeLoadedHook('perm', {
          PermissionRequest: () => ({ result: 'block', reason: 'denied', interrupt: true }),
        }),
      ],
      loadErrors: [],
    })
    mockReadStdin.mockResolvedValue({ hook_event_name: 'PermissionRequest' })
    await runEngine(makeDeps()).catch(() => {})
    const stdout = getStdout()
    const parsed = JSON.parse(stdout.trim().split('\n')[0]!)
    expect(parsed.hookSpecificOutput.decision.interrupt).toBe(true)
  })

  it('PermissionRequest allow with updatedInput', async () => {
    mockLoadConfig.mockResolvedValue({
      config: makeConfig({ perm: {} }),
      shadows: [],
      hasProjectConfig: true,
    })
    mockLoadAllHooks.mockResolvedValue({
      loaded: [
        makeLoadedHook('perm', {
          PermissionRequest: () => ({ result: 'allow', updatedInput: { x: 1 } }),
        }),
      ],
      loadErrors: [],
    })
    mockReadStdin.mockResolvedValue({ hook_event_name: 'PermissionRequest' })
    await runEngine(makeDeps()).catch(() => {})
    const stdout = getStdout()
    const parsed = JSON.parse(stdout.trim().split('\n')[0]!)
    expect(parsed.hookSpecificOutput.decision.updatedInput).toEqual({ x: 1 })
  })

  it('PermissionRequest skip exits cleanly', async () => {
    mockLoadConfig.mockResolvedValue({
      config: makeConfig({ perm: {} }),
      shadows: [],
      hasProjectConfig: true,
    })
    mockLoadAllHooks.mockResolvedValue({
      loaded: [
        makeLoadedHook('perm', {
          PermissionRequest: () => ({ result: 'skip' }),
        }),
      ],
      loadErrors: [],
    })
    mockReadStdin.mockResolvedValue({ hook_event_name: 'PermissionRequest' })
    await runEngine(makeDeps()).catch(() => {})
    // Should complete without crash
  })

  it('debug no hooks loaded early exit', async () => {
    process.env.CLOOKS_DEBUG = 'true'
    mockLoadConfig.mockResolvedValue({
      config: makeConfig(),
      shadows: [],
      hasProjectConfig: true,
    })
    mockLoadAllHooks.mockResolvedValue({ loaded: [], loadErrors: [] })
    await runEngine(makeDeps()).catch(() => {})
    const stderr = getStderr()
    expect(stderr).toContain('[clooks:debug]')
    expect(exitSpy).toHaveBeenCalledWith(0)
  })

  it('per-event disabled hook in order list warning', async () => {
    const config = makeConfig({
      'ptu-disabled': { events: { PreToolUse: { enabled: false } } },
      other: {},
    })
    config.events = { PreToolUse: { order: [hn('ptu-disabled')] } }
    mockLoadConfig.mockResolvedValue({ config, shadows: [], hasProjectConfig: true })
    mockLoadAllHooks.mockResolvedValue({
      loaded: [makeLoadedHook('other', { PostToolUse: () => ({ result: 'skip' }) })],
      loadErrors: [],
    })
    mockReadStdin.mockResolvedValue({ hook_event_name: 'PreToolUse' })
    await runEngine(makeDeps()).catch(() => {})
    const stdout = getStdout()
    expect(stdout).toContain('enabled: false for PreToolUse')
  })

  it('debug mode with disabled hooks shows skip reasons', async () => {
    process.env.CLOOKS_DEBUG = 'true'
    const config = makeConfig({ dis: { enabled: false } })
    mockLoadConfig.mockResolvedValue({ config, shadows: [], hasProjectConfig: true })
    mockLoadAllHooks.mockResolvedValue({
      loaded: [makeLoadedHook('dis', { PreToolUse: () => ({ result: 'allow' }) })],
      loadErrors: [],
    })
    mockReadStdin.mockResolvedValue({ hook_event_name: 'PreToolUse' })
    await runEngine(makeDeps()).catch(() => {})
    const stderr = getStderr()
    expect(stderr).toContain('[clooks:debug]')
  })

  it('debug mode with no matched hooks but startup warnings emits debug lines', async () => {
    process.env.CLOOKS_DEBUG = 'true'
    const config = makeConfig({ 'my-hook': { events: { PostToolUse: { enabled: false } } } })
    mockLoadConfig.mockResolvedValue({ config, shadows: [], hasProjectConfig: true })
    mockLoadAllHooks.mockResolvedValue({
      loaded: [makeLoadedHook('my-hook', { PreToolUse: () => ({ result: 'skip' }) })],
      loadErrors: [],
    })
    mockReadStdin.mockResolvedValue({ hook_event_name: 'PostToolUse' })
    await runEngine(makeDeps()).catch(() => {})
    const stderr = getStderr()
    expect(stderr).toContain('[clooks:debug]')
  })

  it('degraded messages on injectable event inject into context', async () => {
    // Same pre-seeding as the non-injectable test above, but on PreToolUse
    // (an injectable event) so degraded messages get injected into
    // additionalContext instead of written to stderr.
    const { writeFailures, recordFailure } = await import('./failures.js')
    const failurePath = join(tempDir, '.clooks/.failures')
    let state: any = {}
    state = recordFailure(state, hn('failing'), 'PreToolUse' as any, 'err')
    state = recordFailure(state, hn('failing'), 'PreToolUse' as any, 'err')
    state = recordFailure(state, hn('failing'), 'PreToolUse' as any, 'err')
    await writeFailures(failurePath, state)

    mockLoadConfig.mockResolvedValue({
      config: makeConfig({ failing: {} }),
      shadows: [],
      hasProjectConfig: true,
    })
    mockLoadAllHooks.mockResolvedValue({
      loaded: [
        makeLoadedHook('failing', {
          PreToolUse: () => {
            throw new Error('degraded')
          },
        }),
      ],
      loadErrors: [],
    })
    mockReadStdin.mockResolvedValue({ hook_event_name: 'PreToolUse' })
    await runEngine(makeDeps()).catch(() => {})
    const stdout = getStdout()
    // Degraded messages should be injected as injectContext on injectable events
    expect(stdout.length).toBeGreaterThan(0)
  })

  it('continue result with systemMessages and no lastResult', async () => {
    mockLoadConfig.mockResolvedValue({
      config: makeConfig({ skipper: { onError: 'continue' } }),
      shadows: [hn('skipper')],
      hasProjectConfig: true,
    })
    mockLoadAllHooks.mockResolvedValue({
      loaded: [
        makeLoadedHook('skipper', {
          SessionStart: () => {
            throw new Error('hook broke')
          },
        }),
      ],
      loadErrors: [],
    })
    mockReadStdin.mockResolvedValue({ hook_event_name: 'SessionStart' })
    await runEngine(makeDeps()).catch(() => {})
    const stdout = getStdout()
    expect(stdout.length).toBeGreaterThan(0)
    const parsed = JSON.parse(stdout.trim().split('\n')[0]!)
    expect(parsed.systemMessage).toBeDefined()
  })

  it('translated output with stderr (continuation event continue result)', async () => {
    mockLoadConfig.mockResolvedValue({
      config: makeConfig({ feedback: {} }),
      shadows: [],
      hasProjectConfig: true,
    })
    mockLoadAllHooks.mockResolvedValue({
      loaded: [
        makeLoadedHook('feedback', {
          TeammateIdle: () => ({ result: 'continue', feedback: 'keep going' }),
        }),
      ],
      loadErrors: [],
    })
    mockReadStdin.mockResolvedValue({ hook_event_name: 'TeammateIdle' })
    await runEngine(makeDeps()).catch(() => {})
    const stderr = getStderr()
    expect(stderr).toContain('keep going')
  })

  it('systemMessages injected into translated output without existing output', async () => {
    // Hook that results in skip (no output) but with shadow warnings
    mockLoadConfig.mockResolvedValue({
      config: makeConfig({ 'my-hook': {} }),
      shadows: [hn('my-hook')],
      hasProjectConfig: true,
    })
    mockLoadAllHooks.mockResolvedValue({
      loaded: [
        makeLoadedHook('my-hook', {
          SessionStart: () => ({ result: 'allow' }),
        }),
      ],
      loadErrors: [],
    })
    mockReadStdin.mockResolvedValue({ hook_event_name: 'SessionStart' })
    await runEngine(makeDeps()).catch(() => {})
    const stdout = getStdout()
    expect(stdout).toContain('shadowing')
  })

  it('defaultDeps.readStdin wraps Bun.stdin.json', () => {
    // Why: the arrow function in defaultDeps.readStdin is a counted function
    // for coverage purposes.  Without invoking it, engine.ts drops below the
    // 95% function threshold.  We must replace Bun.stdin.json first because
    // the real one blocks forever waiting for stdin data in test environments.
    const origJson = Bun.stdin.json
    ;(Bun.stdin as any).json = () => Promise.resolve({ test: true })
    try {
      const result = defaultDeps.readStdin()
      expect(result).toBeInstanceOf(Promise)
    } finally {
      ;(Bun.stdin as any).json = origJson
    }
  })

  it('trace messages appended to existing lastResult on injectable event', async () => {
    // Covers lines 216-218: trace messages + existing lastResult (else branch)
    // Need two hooks: one succeeds (produces lastResult), one with onError: "trace" that throws
    mockLoadConfig.mockResolvedValue({
      config: makeConfig({ good: {}, tracer: { onError: 'trace' } }),
      shadows: [],
      hasProjectConfig: true,
    })
    mockLoadAllHooks.mockResolvedValue({
      loaded: [
        makeLoadedHook('good', { PreToolUse: () => ({ result: 'allow' }) }),
        makeLoadedHook('tracer', {
          PreToolUse: () => {
            throw new Error('trace append')
          },
        }),
      ],
      loadErrors: [],
    })
    mockReadStdin.mockResolvedValue({ hook_event_name: 'PreToolUse' })
    await runEngine(makeDeps()).catch(() => {})
    const stdout = getStdout()
    expect(stdout).toContain('trace append')
  })

  it('degraded messages appended to existing lastResult on injectable event', async () => {
    // Covers lines 228-230: degraded messages + existing lastResult (else branch)
    // Need a hook that succeeds + a hook degraded by circuit breaker on injectable event
    const { writeFailures, recordFailure } = await import('./failures.js')
    const failurePath = join(tempDir, '.clooks/.failures')
    let state: any = {}
    state = recordFailure(state, hn('failing'), 'PreToolUse' as any, 'err')
    state = recordFailure(state, hn('failing'), 'PreToolUse' as any, 'err')
    state = recordFailure(state, hn('failing'), 'PreToolUse' as any, 'err')
    await writeFailures(failurePath, state)

    mockLoadConfig.mockResolvedValue({
      config: makeConfig({ good: {}, failing: {} }),
      shadows: [],
      hasProjectConfig: true,
    })
    mockLoadAllHooks.mockResolvedValue({
      loaded: [
        makeLoadedHook('good', { PreToolUse: () => ({ result: 'allow' }) }),
        makeLoadedHook('failing', {
          PreToolUse: () => {
            throw new Error('degraded append')
          },
        }),
      ],
      loadErrors: [],
    })
    mockReadStdin.mockResolvedValue({ hook_event_name: 'PreToolUse' })
    await runEngine(makeDeps()).catch(() => {})
    const stdout = getStdout()
    expect(stdout).toContain('degraded append')
  })

  it('debug lines injected into context when no hook result (lastResult undefined)', async () => {
    // Covers line 252: debug mode with allDebug.length > 0 but lastResult === undefined
    // Need a hook with onError: "continue" that throws, so lastResult stays undefined,
    // but debug lines exist from the engine.
    process.env.CLOOKS_DEBUG = 'true'
    mockLoadConfig.mockResolvedValue({
      config: makeConfig({ crasher: { onError: 'continue' } }),
      shadows: [],
      hasProjectConfig: true,
    })
    mockLoadAllHooks.mockResolvedValue({
      loaded: [
        makeLoadedHook('crasher', {
          PreToolUse: () => {
            throw new Error('debug inject test')
          },
        }),
      ],
      loadErrors: [],
    })
    mockReadStdin.mockResolvedValue({ hook_event_name: 'PreToolUse' })
    await runEngine(makeDeps()).catch(() => {})
    const stdout = getStdout()
    expect(stdout).toContain('[clooks:debug]')
  })

  it('injectContext on guard event UserPromptSubmit', async () => {
    mockLoadConfig.mockResolvedValue({
      config: makeConfig({ injector: {} }),
      shadows: [],
      hasProjectConfig: true,
    })
    mockLoadAllHooks.mockResolvedValue({
      loaded: [
        makeLoadedHook('injector', {
          UserPromptSubmit: () => ({ result: 'allow', injectContext: 'extra' }),
        }),
      ],
      loadErrors: [],
    })
    mockReadStdin.mockResolvedValue({ hook_event_name: 'UserPromptSubmit' })
    await runEngine(makeDeps()).catch(() => {})
    const stdout = getStdout()
    expect(stdout).toContain('extra')
  })
})
