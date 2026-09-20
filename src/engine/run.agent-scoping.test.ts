import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { claudeCodeAdapter } from '../agents/claude-code/adapter.js'
import type { AgentAdapter } from '../agents/types.js'
import type { ClooksConfig, EventEntry, HookEntry } from '../config/schema.js'
import { getFailureCount, readFailures, LOAD_ERROR_EVENT } from '../failures.js'
import type { HookLoadError, LoadedHook } from '../loader.js'
import type { EventName, HookName, Milliseconds } from '../types/branded.js'
import { runEngineCore } from './run.js'
import type { RunEngineDeps } from './types.js'

class ExitCalled extends Error {
  constructor(public readonly code: number | string | undefined) {
    super(`ExitCalled(${String(code)})`)
    this.name = 'ExitCalled'
  }
}

function captureWrite(captured: string[]) {
  return (msg: unknown, encodingOrCallback?: unknown, callback?: unknown): boolean => {
    captured.push(String(msg))
    const complete =
      typeof encodingOrCallback === 'function'
        ? encodingOrCallback
        : typeof callback === 'function'
          ? callback
          : undefined
    complete?.()
    return true
  }
}

async function runCoreWithExitTrap(
  deps: RunEngineDeps,
  adapter: AgentAdapter = claudeCodeAdapter,
): Promise<{ code: number | string | undefined; stderr: string; stdout: string }> {
  const capturedStderr: string[] = []
  const capturedStdout: string[] = []
  const stderrSpy = spyOn(process.stderr, 'write').mockImplementation(captureWrite(capturedStderr))
  const stdoutSpy = spyOn(process.stdout, 'write').mockImplementation(captureWrite(capturedStdout))
  const origExit = process.exit.bind(process)
  process.exit = ((code?: number | string) => {
    throw new ExitCalled(code)
  }) as typeof process.exit

  try {
    await runEngineCore(adapter, deps)
  } catch (e) {
    if (e instanceof ExitCalled) {
      return { code: e.code, stderr: capturedStderr.join(''), stdout: capturedStdout.join('') }
    }
    throw e
  } finally {
    process.exit = origExit
    stderrSpy.mockRestore()
    stdoutSpy.mockRestore()
  }

  return {
    code: process.exitCode ?? undefined,
    stderr: capturedStderr.join(''),
    stdout: capturedStdout.join(''),
  }
}

/** Claude Code adapter wearing another agent's id, so one payload shape serves both. */
const asCodex: AgentAdapter = { ...claudeCodeAdapter, id: 'codex' }

function makeHook(name: string, handlers: Record<string, unknown>): LoadedHook {
  return {
    name: name as HookName,
    hook: { meta: { name }, ...handlers } as LoadedHook['hook'],
    config: {},
    hookPath: `/tmp/${name}.ts`,
    configPath: '/tmp/clooks.yml',
  }
}

function makeConfig(
  entries: Record<string, Partial<HookEntry>>,
  global: string[] | undefined = undefined,
  events: Partial<Record<EventName, EventEntry>> = {},
): ClooksConfig {
  const hooks = {} as Record<HookName, HookEntry>
  for (const [name, overrides] of Object.entries(entries)) {
    hooks[name as HookName] = {
      resolvedPath: `/tmp/${name}.ts`,
      config: {},
      parallel: false,
      origin: 'project',
      ...overrides,
    }
  }
  return {
    version: '1.0.0',
    global: {
      timeout: 30000 as Milliseconds,
      onError: 'block',
      maxFailures: 3,
      maxFailuresMessage: 'Too many failures',
      handoff: false,
      ...(global ? { agents: global } : {}),
    },
    hooks,
    events,
  }
}

function makeDeps(input: unknown, hooks: LoadedHook[], config: ClooksConfig): RunEngineDeps {
  return {
    discoverProjectRoot: async () => ({
      projectRoot: '/tmp/clooks-agent-scoping-project',
      signal: 'walk-up',
      from: '/tmp/clooks-agent-scoping-project',
      checked: ['/tmp/clooks-agent-scoping-project'],
      boundary: 'git-root',
      boundaryPath: '/tmp/clooks-agent-scoping-project',
    }),
    loadConfig: async () => ({ config, shadows: [], hasProjectConfig: true }),
    loadAllHooks: async () => ({ loaded: hooks, loadErrors: [], dangling: [] }),
    readStdin: async () => input,
  }
}

const UNKNOWN_WARNING = 'clooks: unknown agent ids in agents lists (ignored)'

let originalHomeRoot: string | undefined
let originalDebug: string | undefined
let tempDirs: string[] = []

beforeEach(() => {
  originalHomeRoot = process.env.CLOOKS_HOME_ROOT
  originalDebug = process.env.CLOOKS_DEBUG
  const homeRoot = mkdtempSync(join(tmpdir(), 'clooks-agent-scoping-home-'))
  tempDirs.push(homeRoot)
  process.env.CLOOKS_HOME_ROOT = homeRoot
})

afterEach(() => {
  if (originalHomeRoot === undefined) delete process.env.CLOOKS_HOME_ROOT
  else process.env.CLOOKS_HOME_ROOT = originalHomeRoot
  if (originalDebug === undefined) delete process.env.CLOOKS_DEBUG
  else process.env.CLOOKS_DEBUG = originalDebug
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
  tempDirs = []
})

describe('runEngine agent scoping', () => {
  test('an excluded hook never executes and its reason reaches debug output', async () => {
    process.env.CLOOKS_DEBUG = 'true'
    const calls: string[] = []
    const hooks = [
      makeHook('only-codex', {
        PreToolUse: () => {
          calls.push('only-codex')
          return { result: 'skip' }
        },
      }),
      makeHook('everywhere', {
        PreToolUse: () => {
          calls.push('everywhere')
          return { result: 'skip' }
        },
      }),
    ]
    const config = makeConfig({
      'only-codex': { agents: ['codex'] },
      everywhere: { agents: ['claude-code', 'codex'] },
    })

    const claude = await runCoreWithExitTrap(
      makeDeps({ hook_event_name: 'PreToolUse' }, hooks, config),
    )
    expect(claude.code).toBe(0)
    expect(calls).toEqual(['everywhere'])
    expect(claude.stderr).toContain(
      'hook "only-codex" skipped for agent "claude-code" via clooks.yml hook agents',
    )

    calls.length = 0
    const codex = await runCoreWithExitTrap(
      makeDeps({ hook_event_name: 'PreToolUse' }, hooks, config),
      asCodex,
    )
    expect(codex.code).toBe(0)
    expect(calls).toEqual(['only-codex', 'everywhere'])
    expect(codex.stderr).not.toContain('skipped for agent')
  })

  test('meta and global levels name themselves in the debug reason', async () => {
    process.env.CLOOKS_DEBUG = 'true'
    const byMeta = makeHook('by-meta', { PreToolUse: () => ({ result: 'skip' }) })
    Object.assign(byMeta.hook.meta, { agents: ['codex'] })
    const hooks = [
      byMeta,
      makeHook('by-global', { PreToolUse: () => ({ result: 'skip' }) }),
      makeHook('by-event', { PreToolUse: () => ({ result: 'skip' }) }),
    ]
    const config = makeConfig(
      {
        'by-meta': {},
        'by-global': {},
        'by-event': { events: { PreToolUse: { agents: ['codex'] } } },
      },
      ['codex'],
    )

    const result = await runCoreWithExitTrap(
      makeDeps({ hook_event_name: 'PreToolUse' }, hooks, config),
    )
    expect(result.code).toBe(0)
    expect(result.stderr).toContain(
      'hook "by-meta" skipped for agent "claude-code" via hook meta.agents',
    )
    expect(result.stderr).toContain(
      'hook "by-global" skipped for agent "claude-code" via clooks.yml config.agents',
    )
    expect(result.stderr).toContain(
      'hook "by-event" skipped for agent "claude-code" via clooks.yml events.PreToolUse.agents',
    )
  })

  test('an order list naming an excluded hook stays valid', async () => {
    const calls: string[] = []
    const hooks = [
      makeHook('only-codex', {
        PreToolUse: () => {
          calls.push('only-codex')
          return { result: 'skip' }
        },
      }),
      makeHook('inherits', {
        PreToolUse: () => {
          calls.push('inherits')
          return { result: 'skip' }
        },
      }),
    ]
    const config = makeConfig({ 'only-codex': { agents: ['codex'] }, inherits: {} }, undefined, {
      PreToolUse: { order: ['only-codex' as HookName, 'inherits' as HookName] },
    })

    const result = await runCoreWithExitTrap(
      makeDeps({ hook_event_name: 'PreToolUse' }, hooks, config),
    )
    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(calls).toEqual(['inherits'])
  })

  test('exclusion alone produces no startup warning', async () => {
    const calls: string[] = []
    const track = (name: string) => () => {
      calls.push(name)
      return null
    }
    const hooks = [
      makeHook('only-codex', {
        PreToolUse: () => ({ result: 'skip' }),
        SessionStart: track('only-codex'),
      }),
      makeHook('inherits', {
        PreToolUse: () => ({ result: 'skip' }),
        SessionStart: track('inherits'),
      }),
    ]
    const config = makeConfig({ 'only-codex': { agents: ['codex'] }, inherits: {} }, undefined, {
      PreToolUse: { order: ['only-codex' as HookName, 'inherits' as HookName] },
    })

    const result = await runCoreWithExitTrap(
      makeDeps({ hook_event_name: 'SessionStart' }, hooks, config),
    )
    expect(result.code).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')
    // Silence has to come from the in-scope hook running and saying nothing.
    expect(calls).toEqual(['inherits'])
  })

  test('onError: trace produces no warning for a hook excluded on this agent', async () => {
    const hooks = [
      makeHook('traced', { Stop: () => ({ result: 'skip' }) }),
      makeHook('plain', { Stop: () => ({ result: 'skip' }) }),
    ]

    const excluded = await runCoreWithExitTrap(
      makeDeps(
        { hook_event_name: 'Stop' },
        hooks,
        makeConfig({ traced: { onError: 'trace', agents: ['codex'] }, plain: {} }),
      ),
    )
    expect(excluded.code).toBe(0)
    expect(excluded.stdout).not.toContain('traced')

    // Control: the same hook, in scope, still warns.
    const included = await runCoreWithExitTrap(
      makeDeps(
        { hook_event_name: 'Stop' },
        hooks,
        makeConfig({ traced: { onError: 'trace' }, plain: {} }),
      ),
    )
    expect(included.code).toBe(0)
    expect(JSON.parse(included.stdout).systemMessage).toContain(
      'Hook "traced" has onError: "trace"',
    )
  })
})

describe('runEngine unknown agent id warning', () => {
  function occurrences(text: string): number {
    return text.split(UNKNOWN_WARNING).length - 1
  }

  for (const adapter of [claudeCodeAdapter, asCodex]) {
    test(`${adapter.id}: emitted once when no hooks are loaded`, async () => {
      const result = await runCoreWithExitTrap(
        makeDeps({ hook_event_name: 'SessionStart' }, [], makeConfig({}, ['cursor'])),
        adapter,
      )
      expect(result.code).toBe(0)
      expect(JSON.parse(result.stdout).systemMessage).toContain(`${UNKNOWN_WARNING}: cursor`)
      expect(occurrences(result.stdout)).toBe(1)
    })

    test(`${adapter.id}: emitted once when no hook matches the event`, async () => {
      const hooks = [makeHook('pre-only', { PreToolUse: () => ({ result: 'skip' }) })]
      const result = await runCoreWithExitTrap(
        makeDeps(
          { hook_event_name: 'SessionStart' },
          hooks,
          makeConfig({ 'pre-only': {} }, ['claude-code', 'codex', 'cursor']),
        ),
        adapter,
      )
      expect(result.code).toBe(0)
      expect(JSON.parse(result.stdout).systemMessage).toContain(`${UNKNOWN_WARNING}: cursor`)
      expect(occurrences(result.stdout)).toBe(1)
    })

    test(`${adapter.id}: emitted once on the normal path, alongside the handler's own output`, async () => {
      let calls = 0
      const hooks = [
        makeHook('starter', {
          SessionStart: () => {
            calls++
            return { result: 'skip', injectContext: 'starter ran' }
          },
        }),
      ]
      const result = await runCoreWithExitTrap(
        makeDeps(
          { hook_event_name: 'SessionStart' },
          hooks,
          makeConfig({ starter: { agents: ['claude-code', 'codex', 'windsurf', 'cursor'] } }),
        ),
        adapter,
      )
      expect(result.code).toBe(0)
      expect(calls).toBe(1)
      const output = JSON.parse(result.stdout)
      expect(output.hookSpecificOutput.additionalContext).toBe('starter ran')
      expect(output.systemMessage).toContain(`${UNKNOWN_WARNING}: cursor, windsurf`)
      expect(occurrences(result.stdout)).toBe(1)
    })

    test(`${adapter.id}: silent on events other than SessionStart`, async () => {
      const hooks = [makeHook('pre-only', { PreToolUse: () => ({ result: 'skip' }) })]
      const result = await runCoreWithExitTrap(
        makeDeps(
          { hook_event_name: 'PreToolUse' },
          hooks,
          makeConfig({ 'pre-only': { agents: ['claude-code', 'codex', 'cursor'] } }),
        ),
        adapter,
      )
      expect(result.code).toBe(0)
      expect(occurrences(result.stdout)).toBe(0)
      expect(occurrences(result.stderr)).toBe(0)
    })
  }
})

describe('runEngine load-failure counters', () => {
  const flakyName = 'flaky' as HookName

  function makeCounterDeps(
    projectRoot: string,
    loaded: LoadedHook[],
    loadErrors: HookLoadError[],
    config: ClooksConfig,
  ): RunEngineDeps {
    return {
      discoverProjectRoot: async () => ({
        projectRoot,
        signal: 'walk-up',
        from: projectRoot,
        checked: [projectRoot],
        boundary: 'git-root',
        boundaryPath: projectRoot,
      }),
      loadConfig: async () => ({ config, shadows: [], hasProjectConfig: true }),
      loadAllHooks: async () => ({ loaded, loadErrors, dangling: [] }),
      readStdin: async () => ({ hook_event_name: 'PreToolUse' }),
    }
  }

  function makeProject(): { root: string; failurePath: string } {
    const root = mkdtempSync(join(tmpdir(), 'clooks-agent-scoping-project-'))
    tempDirs.push(root)
    mkdirSync(join(root, '.clooks'), { recursive: true })
    return { root, failurePath: join(root, '.clooks/.failures') }
  }

  async function loadCount(failurePath: string): Promise<number> {
    return getFailureCount(await readFailures(failurePath), flakyName, LOAD_ERROR_EVENT)
  }

  // A hook that imports cleanly but never executes still proves its file is
  // healthy, so consecutive load failures separated by it are not consecutive.
  for (const [reason, hook, config] of [
    [
      'excluded for this agent',
      makeHook('flaky', { PreToolUse: () => ({ result: 'skip' }) }),
      makeConfig({ flaky: { agents: ['codex'] } }),
    ],
    [
      'no handler for this event',
      makeHook('flaky', { PostToolUse: () => ({ result: 'skip' }) }),
      makeConfig({ flaky: {} }),
    ],
  ] as const) {
    test(`a successful import clears the load counter when the hook is ${reason}`, async () => {
      const { root, failurePath } = makeProject()
      const loadErrors: HookLoadError[] = [{ name: flakyName, error: 'import exploded' }]

      const first = await runCoreWithExitTrap(makeCounterDeps(root, [], loadErrors, config))
      expect(first.code).toBe(0)
      expect(JSON.parse(first.stdout).hookSpecificOutput.permissionDecision).toBe('deny')
      expect(await loadCount(failurePath)).toBe(1)

      const healthy = await runCoreWithExitTrap(makeCounterDeps(root, [hook], [], config))
      expect(healthy.code).toBe(0)
      expect(await loadCount(failurePath)).toBe(0)

      const second = await runCoreWithExitTrap(makeCounterDeps(root, [], loadErrors, config))
      expect(second.code).toBe(0)
      expect(await loadCount(failurePath)).toBe(1)
    })
  }

  test('an executing hook still clears its own stale load counter', async () => {
    const { root, failurePath } = makeProject()
    const config = makeConfig({ flaky: {} })
    const hook = makeHook('flaky', { PreToolUse: () => ({ result: 'skip' }) })
    const loadErrors: HookLoadError[] = [{ name: flakyName, error: 'import exploded' }]

    await runCoreWithExitTrap(makeCounterDeps(root, [], loadErrors, config))
    expect(await loadCount(failurePath)).toBe(1)

    await runCoreWithExitTrap(makeCounterDeps(root, [hook], [], config))
    expect(await loadCount(failurePath)).toBe(0)
  })

  test('a hook that keeps failing to load still degrades at its threshold', async () => {
    const { root, failurePath } = makeProject()
    const config = makeConfig({ flaky: {} })
    const loadErrors: HookLoadError[] = [{ name: flakyName, error: 'import exploded' }]

    for (const expected of [1, 2]) {
      const blocked = await runCoreWithExitTrap(makeCounterDeps(root, [], loadErrors, config))
      expect(JSON.parse(blocked.stdout).hookSpecificOutput.permissionDecision).toBe('deny')
      expect(await loadCount(failurePath)).toBe(expected)
    }

    const degraded = await runCoreWithExitTrap(makeCounterDeps(root, [], loadErrors, config))
    expect(JSON.parse(degraded.stdout).systemMessage).toContain(
      'has been disabled after 3 consecutive load failures',
    )
    expect(await loadCount(failurePath)).toBe(3)
  })

  test('an order list naming a hook that keeps failing to load degrades instead of throwing', async () => {
    const { root, failurePath } = makeProject()
    const calls: string[] = []
    const healthy = makeHook('healthy', {
      PreToolUse: () => {
        calls.push('healthy')
        return { result: 'skip' }
      },
    })
    const config = makeConfig({ flaky: {}, healthy: {} }, undefined, {
      PreToolUse: { order: [flakyName, 'healthy' as HookName] },
    })
    const loadErrors: HookLoadError[] = [{ name: flakyName, error: 'import exploded' }]

    for (const expected of [1, 2]) {
      const blocked = await runCoreWithExitTrap(makeCounterDeps(root, [], loadErrors, config))
      expect(JSON.parse(blocked.stdout).hookSpecificOutput.permissionDecision).toBe('deny')
      expect(await loadCount(failurePath)).toBe(expected)
    }

    const degraded = await runCoreWithExitTrap(makeCounterDeps(root, [healthy], loadErrors, config))
    expect(degraded.stderr).not.toContain('does not handle this event')
    expect(JSON.parse(degraded.stdout).systemMessage).toContain(
      'has been disabled after 3 consecutive load failures',
    )
    expect(calls).toEqual(['healthy'])
    expect(await loadCount(failurePath)).toBe(3)
  })

  test('once the listed hook imports again, an order list it cannot serve is an error once more', async () => {
    const { root, failurePath } = makeProject()
    const healthy = makeHook('healthy', { PreToolUse: () => ({ result: 'skip' }) })
    const recovered = makeHook('flaky', { PostToolUse: () => ({ result: 'skip' }) })
    const config = makeConfig({ flaky: {}, healthy: {} }, undefined, {
      PreToolUse: { order: [flakyName, 'healthy' as HookName] },
    })
    const loadErrors: HookLoadError[] = [{ name: flakyName, error: 'import exploded' }]

    // Below the limit an import failure blocks before ordering is reached ...
    for (const expected of [1, 2]) {
      await runCoreWithExitTrap(makeCounterDeps(root, [], loadErrors, config))
      expect(await loadCount(failurePath)).toBe(expected)
    }
    // ... at the limit ordering runs and the exemption keeps the list valid ...
    const degraded = await runCoreWithExitTrap(makeCounterDeps(root, [healthy], loadErrors, config))
    expect(degraded.stderr).not.toContain('does not handle this event')
    expect(await loadCount(failurePath)).toBe(3)

    // ... and the exemption is gone once the same hook imports again.
    await expect(
      runCoreWithExitTrap(makeCounterDeps(root, [recovered, healthy], [], config)),
    ).rejects.toThrow('order references hook "flaky" which does not handle this event')
  })
})
