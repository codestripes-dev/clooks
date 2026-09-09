import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  utimesSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { claudeCodeAdapter } from '../agents/claude-code/adapter.js'
import { codexAdapter } from '../agents/codex/adapter.js'
import { selectAgentAdapter } from '../agents/select.js'
import type { AgentAdapter } from '../agents/types.js'
import type { ClooksConfig, HookEntry } from '../config/schema.js'
import type { DanglingHook, LoadedHook } from '../loader.js'
import type { HookName, Milliseconds } from '../types/branded.js'
import { runEngine, runEngineCore } from './run.js'
import type { RunEngineDeps } from './types.js'
import { getConfigFailurePath } from '../failures.js'
import {
  createTurnTracker,
  emptyTurnState,
  readTurnState,
  turnStatePath,
  TURN_STATE_TTL_MS,
} from './turn-state.js'
import type { TurnContext } from '../types/turn.js'
import type { ClooksHook } from '../types/hook.js'
import { hn } from '../test-utils.js'

class ExitCalled extends Error {
  constructor(public readonly code: number | string | undefined) {
    super(`ExitCalled(${String(code)})`)
    this.name = 'ExitCalled'
  }
}

async function runWithExitTrap(
  deps?: RunEngineDeps,
): Promise<{ code: number | string | undefined; stderr: string; stdout: string }> {
  const capturedStderr: string[] = []
  const capturedStdout: string[] = []
  const stderrSpy = spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
    capturedStderr.push(String(msg))
    return true
  })
  const stdoutSpy = spyOn(process.stdout, 'write').mockImplementation((msg: unknown) => {
    capturedStdout.push(String(msg))
    return true
  })
  const origExit = process.exit.bind(process)
  process.exit = ((code?: number | string) => {
    throw new ExitCalled(code)
  }) as typeof process.exit

  try {
    await runEngine(deps)
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

function makeMinimalConfig(hookNames: string[] = []): ClooksConfig {
  const hooks = Object.fromEntries(
    hookNames.map((name) => [
      name as HookName,
      {
        resolvedPath: `/tmp/${name}.ts`,
        config: {},
        parallel: false,
        origin: 'project',
      } satisfies HookEntry,
    ]),
  ) as Record<HookName, HookEntry>

  return {
    version: '1.0.0',
    global: {
      timeout: 30000 as Milliseconds,
      onError: 'block' as const,
      maxFailures: 3,
      maxFailuresMessage: 'Too many failures',
      handoff: false,
    },
    hooks,
    events: {},
  }
}

function makeDeps(
  input: unknown,
  hooks: LoadedHook[] = [],
  shadows: HookName[] = [],
  dangling: DanglingHook[] = [],
): RunEngineDeps {
  const config = makeMinimalConfig(hooks.map((hook) => hook.name))
  return {
    discoverProjectRoot: async () => ({
      projectRoot: '/tmp/clooks-test-project',
      signal: 'walk-up',
      from: '/tmp/clooks-test-project',
      checked: ['/tmp/clooks-test-project'],
      boundary: 'git-root',
      boundaryPath: '/tmp/clooks-test-project',
    }),
    loadConfig: async () => ({
      config,
      shadows,
      hasProjectConfig: true,
    }),
    loadAllHooks: async () => ({ loaded: hooks, loadErrors: [], dangling }),
    readStdin: async () => input,
  }
}

function makeHook(name: string, hook: Record<string, unknown>): LoadedHook {
  return {
    name: name as HookName,
    hook: {
      meta: { name },
      ...hook,
    } as LoadedHook['hook'],
    config: {},
    hookPath: `/tmp/${name}.ts`,
    configPath: '/tmp/clooks.yml',
  }
}

function makeProjectDeps(input: unknown, roots: { projectRoot: string; homeRoot: string }) {
  process.env.CLOOKS_HOME_ROOT = roots.homeRoot
  return {
    discoverProjectRoot: async () => ({
      projectRoot: roots.projectRoot,
      signal: 'walk-up' as const,
      from: roots.projectRoot,
      checked: [roots.projectRoot],
      boundary: 'git-root' as const,
      boundaryPath: roots.projectRoot,
    }),
    loadConfig: async () => ({
      config: makeMinimalConfig(),
      shadows: [],
      hasProjectConfig: true,
    }),
    loadAllHooks: async () => ({ loaded: [], loadErrors: [], dangling: [] }),
    readStdin: async () => input,
  } satisfies RunEngineDeps
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2))
}

function writeClooksPluginFixture(root: string, opts: { pluginKey: string; packName: string }) {
  const installPath = join(root, 'plugin-cache', opts.packName)
  mkdirSync(installPath, { recursive: true })
  writeJson(join(installPath, 'clooks-pack.json'), {
    version: 1,
    name: opts.packName,
    hooks: {
      [`${opts.packName}-hook`]: {
        path: 'hooks/hook.ts',
        description: 'test hook',
      },
    },
  })
  return installPath
}

async function runCoreWithExitTrap(
  deps: RunEngineDeps,
  adapter: AgentAdapter = claudeCodeAdapter,
): Promise<{
  code: number | string | undefined
  stderr: string
  stdout: string
}> {
  const capturedStderr: string[] = []
  const capturedStdout: string[] = []
  const stderrSpy = spyOn(process.stderr, 'write').mockImplementation((msg: unknown) => {
    capturedStderr.push(String(msg))
    return true
  })
  const stdoutSpy = spyOn(process.stdout, 'write').mockImplementation((msg: unknown) => {
    capturedStdout.push(String(msg))
    return true
  })
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

const originalAgent = process.env.CLOOKS_AGENT
let originalHomeRoot: string | undefined
let tempDirs: string[] = []

beforeEach(() => {
  originalHomeRoot = process.env.CLOOKS_HOME_ROOT
  const homeRoot = mkdtempSync(join(tmpdir(), 'clooks-adapter-home-'))
  tempDirs.push(homeRoot)
  process.env.CLOOKS_HOME_ROOT = homeRoot
})

afterEach(() => {
  if (originalAgent === undefined) {
    delete process.env.CLOOKS_AGENT
  } else {
    process.env.CLOOKS_AGENT = originalAgent
  }
  if (originalHomeRoot === undefined) delete process.env.CLOOKS_HOME_ROOT
  else process.env.CLOOKS_HOME_ROOT = originalHomeRoot
  delete process.env.CLOOKS_SILENCE_STALE_PLUGIN_ADVISORIES
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
  tempDirs = []
})

describe('public provider identity', () => {
  for (const adapter of [claudeCodeAdapter, codexAdapter]) {
    test(`${adapter.id} overrides raw provider and opposite environment in every lifecycle stage`, async () => {
      const opposite = adapter.id === 'codex' ? 'claude-code' : 'codex'
      process.env.CLOOKS_AGENT = opposite
      for (const rawProvider of [opposite, null, '', 'unknown']) {
        const received: unknown[] = []
        const observe = (phase: string, input: Record<string, unknown>) => {
          received.push([phase, input.provider, input.toolName, input.parallel])
        }
        const hook = makeHook('provider-probe', {
          beforeHook(event) {
            observe('before', event.input as unknown as Record<string, unknown>)
          },
          PreToolUse(ctx) {
            observe('handler', ctx as unknown as Record<string, unknown>)
            return ctx.allow({ injectContext: `provider:${ctx.provider}` })
          },
          afterHook(event) {
            observe('after', event.input as unknown as Record<string, unknown>)
          },
        } satisfies Partial<ClooksHook>)
        const result = await runCoreWithExitTrap(
          makeDeps(
            {
              hook_event_name: 'PreToolUse',
              provider: rawProvider,
              session_id: 'provider-session',
              cwd: '/tmp/clooks-test-project',
              transcript_path: '/tmp/transcript',
              permission_mode: 'default',
              model: 'model',
              turn_id: 'provider-turn',
              tool_name: 'Bash',
              tool_use_id: 'provider-call',
              tool_input: { command: 'printf provider' },
            },
            [hook],
          ),
          adapter,
        )
        expect(result.code).toBe(0)
        expect(result.stderr).toBe('')
        expect(JSON.parse(result.stdout).hookSpecificOutput.additionalContext).toBe(
          `provider:${adapter.id}`,
        )
        expect(received).toEqual(
          ['before', 'handler', 'after'].map((phase) => [phase, adapter.id, 'Bash', false]),
        )
      }
    })
  }
})

describe('Codex turn and delivery integration', () => {
  function payload(
    event: 'SessionStart' | 'UserPromptSubmit' | 'Stop' | 'SubagentStop',
    overrides: Record<string, unknown> = {},
  ) {
    return {
      hook_event_name: event,
      session_id: 'shared',
      cwd: '/project',
      model: 'model',
      permission_mode: 'default',
      transcript_path: null,
      ...(event === 'SessionStart' ? { source: 'startup' } : { turn_id: 'same-turn' }),
      ...(event === 'UserPromptSubmit' ? { prompt: 'same prompt' } : {}),
      ...(event === 'Stop' || event === 'SubagentStop'
        ? { stop_hook_active: true, last_assistant_message: null }
        : {}),
      ...(event === 'SubagentStop'
        ? { agent_id: 'child-a', agent_type: 'worker', agent_transcript_path: null }
        : {}),
      ...overrides,
    }
  }

  async function seed(provider: 'codex' | 'claude-code' = 'codex', session = 'shared') {
    const homeRoot = process.env.CLOOKS_HOME_ROOT!
    const path = turnStatePath(homeRoot, session, provider)
    for (const scopeKey of ['main', 'agent:child-a', 'agent:child-b']) {
      const tracker = createTurnTracker({
        path,
        homeRoot,
        provider,
        scopeKey,
        state: existsSync(path)
          ? await readTurnState(path, { homeRoot, provider })
          : emptyTurnState(),
      })
      tracker.record(hn('reminder'), scopeKey === 'main' ? 'Stop' : 'SubagentStop', 'block')
      await tracker.commit()
    }
    return path
  }

  for (const mode of ['no-hooks', 'no-matches'] as const) {
    for (const [event, fields, resets] of [
      ['UserPromptSubmit', {}, true],
      ['UserPromptSubmit', { agent_id: 'child-a', agent_type: 'worker' }, false],
      ['SessionStart', { source: 'startup' }, true],
      ['SessionStart', { source: 'clear' }, true],
      ['SessionStart', { source: 'resume' }, false],
      ['SessionStart', { source: 'compact' }, false],
    ] as const) {
      test(`${mode} ${event} ${JSON.stringify(fields)} applies only its Codex boundary`, async () => {
        const path = await seed()
        const foreignPath = await seed('claude-code')
        const foreignBytes = readFileSync(foreignPath, 'utf8')
        const before = await readTurnState(path)
        let calls = 0
        const hooks =
          mode === 'no-hooks'
            ? []
            : [
                makeHook('other', {
                  Stop: () => {
                    calls++
                    return { result: 'skip' }
                  },
                }),
              ]
        const result = await runCoreWithExitTrap(
          makeDeps(payload(event, fields), hooks),
          codexAdapter,
        )
        expect(result).toEqual({ code: 0, stdout: '', stderr: '' })
        expect(calls).toBe(0)
        const after = await readTurnState(path)
        expect(after.generation).toBe(before.generation + (resets ? 1 : 0))
        expect(after.scopes).toEqual(resets ? {} : before.scopes)
        expect(readFileSync(foreignPath, 'utf8')).toBe(foreignBytes)
        if (mode === 'no-matches') {
          expect(
            (await runCoreWithExitTrap(makeDeps(payload('Stop'), hooks), codexAdapter)).code,
          ).toBe(0)
          expect(calls).toBe(1)
        }
      })
    }
  }

  test.each(['SessionStart', 'UserPromptSubmit', 'Stop'] as const)(
    'explicit null turn resolver for %s never falls back to legacy tracking',
    async (event) => {
      const path = await seed()
      const foreignPath = await seed('claude-code')
      const before = readFileSync(path, 'utf8')
      const foreignBefore = readFileSync(foreignPath, 'utf8')
      let seen: TurnContext | undefined
      let resolutions = 0
      const adapter: AgentAdapter = {
        ...codexAdapter,
        resolveTurnPolicy() {
          resolutions++
          return null
        },
      }
      const result = await runCoreWithExitTrap(
        makeDeps(payload(event), [
          makeHook('reminder', {
            [event]: (ctx: { turn: TurnContext }) => {
              seen = ctx.turn
              return { result: 'skip' }
            },
          }),
        ]),
        adapter,
      )
      expect(result).toEqual({ code: 0, stdout: '', stderr: '' })
      expect(resolutions).toBe(1)
      expect(seen?.prior).toEqual([])
      expect(seen?.priorRuns).toBe(0)
      expect(seen?.priorInterventions).toBe(0)
      expect(readFileSync(path, 'utf8')).toBe(before)
      expect(readFileSync(foreignPath, 'utf8')).toBe(foreignBefore)
    },
  )

  test.each(['no-hooks', 'no-matches'])(
    'SessionStart %s prunes stale Codex files without deleting aged Claude state',
    async (mode) => {
      const stalePath = await seed('codex', 'stale-session')
      const foreignPath = await seed('claude-code', 'stale-session')
      const freshPath = await seed('codex', 'fresh-session')
      const foreignBefore = readFileSync(foreignPath, 'utf8')
      const freshBefore = readFileSync(freshPath, 'utf8')
      const old = new Date(Date.now() - TURN_STATE_TTL_MS - 60_000)
      utimesSync(stalePath, old, old)
      utimesSync(foreignPath, old, old)
      expect(existsSync(stalePath)).toBe(true)
      let calls = 0
      const hooks =
        mode === 'no-hooks'
          ? []
          : [
              makeHook('other', {
                Stop: () => {
                  calls++
                  return { result: 'skip' }
                },
              }),
            ]
      const result = await runCoreWithExitTrap(
        makeDeps(payload('SessionStart', { source: 'resume' }), hooks),
        codexAdapter,
      )
      expect(result).toEqual({ code: 0, stdout: '', stderr: '' })
      expect(calls).toBe(0)
      expect(existsSync(stalePath)).toBe(false)
      expect(readFileSync(foreignPath, 'utf8')).toBe(foreignBefore)
      expect(readFileSync(freshPath, 'utf8')).toBe(freshBefore)
      if (mode === 'no-matches') {
        expect(
          (await runCoreWithExitTrap(makeDeps(payload('Stop'), hooks), codexAdapter)).code,
        ).toBe(0)
        expect(calls).toBe(1)
      }
    },
  )

  test('two sessions and two child scopes retain independent history across equal provider IDs', async () => {
    const observed: number[] = []
    const handler = (ctx: { turn: TurnContext }) => {
      observed.push(ctx.turn.priorRuns)
      return { result: 'skip' }
    }
    const hooks = [makeHook('reminder', { Stop: handler, SubagentStop: handler })]
    const replay = async (
      session: string,
      child: string | null,
      provider: 'codex' | 'claude-code',
      expected: number,
    ) => {
      const event = child ? 'SubagentStop' : 'Stop'
      const raw = payload(event, { session_id: session, ...(child ? { agent_id: child } : {}) })
      const result = await runCoreWithExitTrap(
        makeDeps(raw, hooks),
        provider === 'codex' ? codexAdapter : claudeCodeAdapter,
      )
      expect(result).toEqual({ code: 0, stdout: '', stderr: '' })
      expect(observed.at(-1)).toBe(expected)
    }
    for (const session of ['shared', 'second']) {
      for (const provider of ['codex', 'claude-code'] as const) {
        for (const child of [null, 'child-a', 'child-b']) await replay(session, child, provider, 0)
      }
    }
    for (const session of ['shared', 'second']) {
      for (const child of [null, 'child-a', 'child-b']) await replay(session, child, 'codex', 1)
    }
    const boundary = await runCoreWithExitTrap(makeDeps(payload('UserPromptSubmit')), codexAdapter)
    expect(boundary.code).toBe(0)
    for (const child of [null, 'child-a', 'child-b']) {
      await replay('shared', child, 'codex', 0)
      await replay('second', child, 'codex', 2)
      await replay('shared', child, 'claude-code', 1)
    }
    expect(observed).toHaveLength(27)
  })

  test('inline Stop handoff preserves raw history and rejects unsupported delivery without files', async () => {
    const home = process.env.CLOOKS_HOME_ROOT!
    const projectRoot = join(home, 'project')
    mkdirSync(projectRoot)
    let reject = false
    const prior: number[] = []
    const reason = 'continue work '.repeat(100)
    const hook = makeHook('reminder', {
      Stop: (ctx: { turn: TurnContext }) => {
        prior.push(ctx.turn.priorInterventions)
        if (reject) return { result: 'block', reason, updatedInput: {} }
        return ctx.turn.priorInterventions === 0 ? { result: 'block', reason } : { result: 'skip' }
      },
    })
    const deps = makeDeps(payload('Stop'), [hook])
    deps.discoverProjectRoot = makeProjectDeps(payload('Stop'), {
      projectRoot,
      homeRoot: home,
    }).discoverProjectRoot
    const loadConfig = deps.loadConfig
    deps.loadConfig = async (...args) => {
      const result = await loadConfig(...args)
      if (result) result.config.global.handoff = true
      return result
    }
    const first = await runCoreWithExitTrap(deps, codexAdapter)
    expect(first.code).toBe(0)
    expect(JSON.parse(first.stdout)).toEqual({
      decision: 'block',
      reason,
      systemMessage:
        'clooks: requested Codex handoff remains inline; recipient file readability is unverified.',
    })
    expect(existsSync(join(projectRoot, '.clooks/tmp'))).toBe(false)
    expect((await runCoreWithExitTrap(deps, codexAdapter)).stdout).toBe('')
    reject = true
    const refused = await runCoreWithExitTrap(deps, codexAdapter)
    expect(JSON.parse(refused.stdout)).toMatchObject({ continue: false })
    expect(refused.stdout).not.toContain('requested Codex handoff')
    expect(existsSync(join(projectRoot, '.clooks/tmp'))).toBe(false)
    expect(prior).toEqual([0, 1, 1])
    const state = await readTurnState(turnStatePath(home, 'shared', 'codex'))
    expect(state.scopes.main?.[hn('reminder')]?.map((entry) => entry.decision)).toEqual([
      'block',
      'skip',
      'block',
    ])
  })
})

describe('runEngine agent adapter selection', () => {
  for (const path of ['no-hooks', 'no-matches', 'no-result'] as const) {
    test(`configured ${path} invokes final translation with no messages and retains its exit`, async () => {
      let handlerCalls = 0
      const handler = () => {
        handlerCalls++
        return undefined
      }
      const hooks =
        path === 'no-hooks'
          ? []
          : [makeHook('quiet', path === 'no-matches' ? { Stop: handler } : { PreToolUse: handler })]
      if (path === 'no-matches') {
        const baseline = await runCoreWithExitTrap(makeDeps({ hook_event_name: 'Stop' }, hooks))
        expect(baseline.code).toBe(0)
        expect(handlerCalls).toBe(1)
      }
      const deps = makeDeps({ hook_event_name: 'PreToolUse' }, hooks)
      let translations = 0
      const adapter: AgentAdapter = {
        ...claudeCodeAdapter,
        translateFinalOutput(input) {
          translations++
          expect(input.result).toBeUndefined()
          expect(input.systemMessages).toEqual([])
          expect(input.invocation?.eventName).toBe('PreToolUse')
          return { output: '{"empty":"translated"}', stderr: 'adapter stderr', exitCode: 1 }
        },
      }
      const result = await runCoreWithExitTrap(deps, adapter)
      expect(translations).toBe(1)
      expect(handlerCalls).toBe(path === 'no-hooks' ? 0 : 1)
      expect(result).toEqual({
        code: 1,
        stdout: '{"empty":"translated"}\n',
        stderr: 'adapter stderr\n',
      })
    })
  }

  test('no config preserves bypass without normalizing or translating malformed input', async () => {
    const deps = makeDeps(null)
    deps.loadConfig = async () => null
    deps.readStdin = async () => {
      throw new Error('unused stdin')
    }
    const adapter: AgentAdapter = {
      ...claudeCodeAdapter,
      normalizeInvocation() {
        throw new Error('must not normalize')
      },
      translateFinalOutput() {
        throw new Error('must not translate')
      },
    }
    expect(await runCoreWithExitTrap(deps, adapter)).toEqual({ code: 0, stdout: '', stderr: '' })
  })

  test('latched rejection selects failure translation even when diagnostics and adjustment return allow', async () => {
    const deps = makeDeps({ hook_event_name: 'PreToolUse' }, [
      makeHook('bad', { PreToolUse: () => ({ result: 'ask', reason: 'unsupported' }) }),
    ])
    let failures = 0
    let normal = 0
    const adapter: AgentAdapter = {
      ...claudeCodeAdapter,
      createResultPolicy: () => ({
        checkResult: () => ({
          kind: 'rejected',
          failure: { eventName: 'PreToolUse', capability: 'ask', message: 'no ask' },
        }),
      }),
      composeDiagnostics: () => ({ result: { result: 'allow' }, stderr: [], systemMessages: [] }),
      adjustResultBeforeFinalOutput: () => ({ result: { result: 'allow' }, systemMessages: [] }),
      translateFinalOutput() {
        normal++
        return { output: '{"wrong":"allow"}', exitCode: 0 }
      },
      translateFailure(input) {
        failures++
        expect(input.failure.capability).toBe('ask')
        expect(input.invocation?.eventName).toBe('PreToolUse')
        return { output: '{"decision":"deny"}', exitCode: 0 }
      },
    }
    const result = await runCoreWithExitTrap(deps, adapter)
    expect(failures).toBe(1)
    expect(normal).toBe(0)
    expect(result).toEqual({ code: 0, stdout: '{"decision":"deny"}\n', stderr: '' })
  })

  test('fails closed for unknown CLOOKS_AGENT values before runtime', async () => {
    process.env.CLOOKS_AGENT = 'unknown-agent'

    const result = await runWithExitTrap()

    expect(result.code).toBe(2)
    expect(result.stderr).toContain('unsupported CLOOKS_AGENT "unknown-agent"')
  })

  test('Codex rejects an unidentified configured event before imports', async () => {
    process.env.CLOOKS_AGENT = 'codex'

    const deps = makeDeps({ hook_event_name: 'UnknownEvent' })
    let imports = 0
    deps.loadAllHooks = async () => {
      imports++
      return { loaded: [], loadErrors: [], dangling: [] }
    }
    const result = await runCoreWithExitTrap(deps, codexAdapter)

    expect(result.code).toBe(2)
    expect(result.stderr).toContain('missing or unrecognized hook_event_name')
    expect(result.stdout).toBe('')
    expect(imports).toBe(0)
  })

  test('explicit Codex selection validates SessionStart without payload-sniffing a Claude fallback', async () => {
    process.env.CLOOKS_AGENT = 'codex'
    for (const valid of [false, true]) {
      const raw = {
        hook_event_name: 'SessionStart',
        session_id: 'claude-shaped-session',
        ...(valid
          ? {
              cwd: '/project',
              model: 'actual-model',
              permission_mode: 'default',
              transcript_path: null,
              source: 'startup',
            }
          : {}),
      }
      let reads = 0
      let imports = 0
      const deps = makeDeps(raw)
      deps.readStdin = async () => {
        reads++
        return raw
      }
      deps.loadAllHooks = async () => {
        imports++
        return { loaded: [], loadErrors: [], dangling: [] }
      }
      const selectedAdapter = selectAgentAdapter()
      expect(selectedAdapter).toBe(codexAdapter)
      const result = await runCoreWithExitTrap(deps, selectedAdapter)
      expect(result.code).toBe(0)
      expect(result.stderr).toBe('')
      expect(reads).toBe(1)
      expect(imports).toBe(valid ? 1 : 0)
      if (valid) expect(result.stdout).toBe('')
      else {
        expect(JSON.parse(result.stdout)).toMatchObject({ continue: false })
        expect(result.stdout).toContain('Codex SessionStart')
        expect(JSON.parse(result.stdout).systemMessage).toContain('capability "cwd"')
        expect(result.stdout).toContain('hooks were not imported or executed')
      }
    }
  })

  test('defaults to Claude Code without inferring Codex from stdin shape', async () => {
    delete process.env.CLOOKS_AGENT
    const deps = makeDeps(
      {
        hook_event_name: 'PreToolUse',
        session_id: 'codex-shaped-session',
        cwd: '/tmp/codex-project',
        transcript_path: '/tmp/codex-project/.codex/sessions/session.jsonl',
        model: 'gpt-5.5',
        permission_mode: 'default',
        turn_id: 'turn-123',
        tool_name: 'Bash',
        tool_use_id: 'tool-123',
        tool_input: {
          command: 'bun test',
        },
      },
      [
        makeHook('allow-hook', {
          PreToolUse(ctx: { toolName?: string; allow: () => unknown }) {
            return ctx.toolName === 'Bash' ? ctx.allow() : undefined
          },
        }),
      ],
    )

    const result = await runWithExitTrap(deps)

    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('allow')
  })

  test('preserves runtime output when CLOOKS_AGENT=claude-code is explicit versus unset', async () => {
    const deps = makeDeps({ hook_event_name: 'PreToolUse' }, [
      makeHook('allow-hook', {
        PreToolUse() {
          return { result: 'allow' }
        },
      }),
    ])

    delete process.env.CLOOKS_AGENT
    const unset = await runWithExitTrap(deps)

    process.env.CLOOKS_AGENT = 'claude-code'
    const explicit = await runWithExitTrap(deps)

    expect(explicit).toEqual(unset)
    expect(JSON.parse(explicit.stdout).hookSpecificOutput.permissionDecision).toBe('allow')
  })
})

describe('runEngineCore Claude adapter boundary', () => {
  test('uses adapter event validation for unknown event names', async () => {
    const result = await runCoreWithExitTrap(makeDeps({ hook_event_name: 'NoSuchEvent' }))

    expect(result.code).toBe(2)
    expect(result.stderr).toContain('missing or unrecognized hook_event_name')
  })

  test('uses adapter event validation for missing event names', async () => {
    const result = await runCoreWithExitTrap(makeDeps({ session_id: 'missing-event' }))

    expect(result.code).toBe(2)
    expect(result.stderr).toContain('missing or unrecognized hook_event_name')
  })

  test('uses adapter event validation for non-string event names', async () => {
    const result = await runCoreWithExitTrap(makeDeps({ hook_event_name: 42 }))

    expect(result.code).toBe(2)
    expect(result.stderr).toContain('missing or unrecognized hook_event_name')
  })

  test('uses adapter PermissionDenied normalization before hook execution', async () => {
    const hook = makeHook('permission-denied-normalizer', {
      PermissionDenied(ctx: { denialReason?: string; retry: () => unknown; skip: () => unknown }) {
        return ctx.denialReason === 'tool was denied' ? ctx.retry() : ctx.skip()
      },
    })

    const result = await runCoreWithExitTrap(
      makeDeps({ hook_event_name: 'PermissionDenied', reason: 'tool was denied' }, [hook]),
    )

    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout).hookSpecificOutput.retry).toBe(true)
  })

  test('uses adapter final output for systemMessage-only output', async () => {
    const result = await runCoreWithExitTrap(
      makeDeps(
        { hook_event_name: 'SessionStart', session_id: 's1' },
        [],
        [],
        [
          {
            name: 'missing-hook' as HookName,
            resolvedPath: '/tmp/missing-hook.ts',
            origin: 'project',
          },
        ],
      ),
    )

    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout).systemMessage).toContain('missing-hook')
  })

  test('uses adapter notify-only routing for system messages', async () => {
    const hook = makeHook('notify-message', {
      StopFailure() {
        throw new Error('notify failed')
      },
    })

    const result = await runCoreWithExitTrap(makeDeps({ hook_event_name: 'StopFailure' }, [hook]))

    expect(result.code).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('notify-message')
    expect(result.stderr).toContain('notify-only event')
  })

  test('uses adapter ConfigChange policy_settings downgrade before final output', async () => {
    const hook = makeHook('policy-downgrade', {
      ConfigChange(ctx: { block: (input: { reason: string }) => unknown }) {
        return ctx.block({ reason: 'disallowed' })
      },
    })

    const result = await runCoreWithExitTrap(
      makeDeps({ hook_event_name: 'ConfigChange', source: 'policy_settings' }, [hook]),
    )

    const output = JSON.parse(result.stdout)
    expect(result.code).toBe(0)
    expect(output.decision).toBeUndefined()
    expect(output.systemMessage).toContain('Clooks downgraded')
    expect(output.systemMessage).toContain('disallowed')
  })

  test('routes stale-registration advisory through Claude final output on SessionStart', async () => {
    const root = mkdtempSync(join(tmpdir(), 'clooks-stale-registration-'))
    tempDirs.push(root)
    const projectRoot = join(root, 'project')
    const homeRoot = join(root, 'home')
    mkdirSync(join(projectRoot, '.clooks'), { recursive: true })
    mkdirSync(join(homeRoot, '.claude', 'plugins'), { recursive: true })

    const installPath = writeClooksPluginFixture(root, {
      pluginKey: 'foo@mp',
      packName: 'foo',
    })
    writeJson(join(homeRoot, '.claude', 'plugins', 'installed_plugins.json'), {
      version: 2,
      plugins: {
        'foo@mp': [{ scope: 'user', installPath }],
      },
    })
    writeFileSync(
      join(projectRoot, '.clooks', 'clooks.yml'),
      ['version: "1.0.0"', 'foo-hook:', '  uses: ./.clooks/vendor/plugin/foo/foo-hook.ts', ''].join(
        '\n',
      ),
    )

    const result = await runCoreWithExitTrap(
      makeProjectDeps({ hook_event_name: 'SessionStart' }, { projectRoot, homeRoot }),
    )

    const output = JSON.parse(result.stdout)
    expect(result.code).toBe(0)
    expect(output.systemMessage).toContain('foo-hook')
    expect(output.systemMessage).toContain('foo@mp')
    expect(output.systemMessage).toContain('not enabled at project scope in Claude settings')
  })

  test('routes enable-without-install advisory through Claude final output on SessionStart', async () => {
    const root = mkdtempSync(join(tmpdir(), 'clooks-enable-without-install-'))
    tempDirs.push(root)
    const projectRoot = join(root, 'project')
    const homeRoot = join(root, 'home')
    mkdirSync(join(projectRoot, '.clooks'), { recursive: true })
    mkdirSync(join(projectRoot, '.claude'), { recursive: true })
    mkdirSync(join(homeRoot, '.claude', 'plugins'), { recursive: true })

    const installPath = writeClooksPluginFixture(root, {
      pluginKey: 'ghost@mp',
      packName: 'ghost',
    })
    writeFileSync(join(installPath, '.orphaned_at'), '2026-05-25T00:00:00Z\n')
    writeJson(join(homeRoot, '.claude', 'plugins', 'installed_plugins.json'), {
      version: 2,
      plugins: {
        'ghost@mp': [{ scope: 'project', installPath }],
      },
    })
    writeJson(join(projectRoot, '.claude', 'settings.json'), {
      enabledPlugins: {
        'ghost@mp': true,
      },
    })

    const result = await runCoreWithExitTrap(
      makeProjectDeps({ hook_event_name: 'SessionStart' }, { projectRoot, homeRoot }),
    )

    const output = JSON.parse(result.stdout)
    expect(result.code).toBe(0)
    expect(output.systemMessage).toContain('plugin ghost@mp is enabled at project scope')
    expect(output.systemMessage).toContain('but no install record exists on disk')
  })

  test('does not emit Claude stale settings advisories on non-SessionStart', async () => {
    const root = mkdtempSync(join(tmpdir(), 'clooks-non-session-advisory-'))
    tempDirs.push(root)
    const projectRoot = join(root, 'project')
    const homeRoot = join(root, 'home')
    mkdirSync(join(projectRoot, '.clooks'), { recursive: true })
    mkdirSync(join(homeRoot, '.claude', 'plugins'), { recursive: true })

    const installPath = writeClooksPluginFixture(root, {
      pluginKey: 'foo@mp',
      packName: 'foo',
    })
    writeJson(join(homeRoot, '.claude', 'plugins', 'installed_plugins.json'), {
      version: 2,
      plugins: {
        'foo@mp': [{ scope: 'user', installPath }],
      },
    })
    writeFileSync(
      join(projectRoot, '.clooks', 'clooks.yml'),
      ['version: "1.0.0"', 'foo-hook:', '  uses: ./.clooks/vendor/plugin/foo/foo-hook.ts', ''].join(
        '\n',
      ),
    )

    const result = await runCoreWithExitTrap(
      makeProjectDeps({ hook_event_name: 'PreToolUse' }, { projectRoot, homeRoot }),
    )

    expect(result.code).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')
  })
})

describe('runEngineCore Codex plugin isolation', () => {
  test.each([false, true])(
    'invalid configured input preserves existing counters when config fails=%s',
    async (configFails) => {
      const projectRoot = mkdtempSync(join(tmpdir(), 'clooks-codex-state-'))
      tempDirs.push(projectRoot)
      mkdirSync(join(projectRoot, '.clooks'))
      writeFileSync(join(projectRoot, '.clooks/clooks.yml'), 'present')
      const path = getConfigFailurePath(projectRoot, process.env.CLOOKS_HOME_ROOT!, true, 'codex')
      mkdirSync(join(projectRoot, '.clooks/.cache/agents/codex'), { recursive: true })
      const bytes =
        '{"__config__":{"__parse__":{"consecutiveFailures":2,"lastError":"existing","lastFailedAt":"old"}}}\n'
      writeFileSync(path, bytes)
      const deps = makeDeps({ hook_event_name: 'PreToolUse' })
      deps.discoverProjectRoot = async () => ({
        projectRoot,
        signal: 'walk-up',
        from: projectRoot,
        checked: [projectRoot],
      })
      if (configFails)
        deps.loadConfig = async () => {
          throw new Error('invalid config')
        }
      let imports = 0
      deps.loadAllHooks = async () => {
        imports++
        return { loaded: [], loadErrors: [], dangling: [] }
      }
      const result = await runCoreWithExitTrap(deps, codexAdapter)
      expect(result.code).toBe(0)
      expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('deny')
      expect(result.stdout).toContain('hooks were not imported or executed')
      expect(result.stdout).toContain('Pending call denial requested.')
      expect(imports).toBe(0)
      expect(readFileSync(path, 'utf8')).toBe(bytes)
      expect(existsSync(join(process.env.CLOOKS_HOME_ROOT!, '.clooks/turn-state'))).toBe(false)
    },
  )

  test('valid configured PreToolUse normalizes once before imports and executes a real handler', async () => {
    const calls: string[] = []
    const raw = {
      hook_event_name: 'PreToolUse',
      session_id: 'session',
      turn_id: 'turn',
      cwd: '/project',
      model: 'model',
      permission_mode: 'default',
      transcript_path: null,
      tool_name: 'Bash',
      tool_use_id: 'call',
      tool_input: { command: 'old' },
    }
    const hook = makeHook('guard', {
      PreToolUse: () => {
        calls.push('handler')
        return { result: 'block', reason: 'denied' }
      },
    })
    const deps = makeDeps(raw, [hook])
    deps.readStdin = async () => {
      calls.push('stdin')
      return raw
    }
    const load = deps.loadAllHooks
    deps.loadAllHooks = async (...args) => {
      calls.push('import')
      return load(...args)
    }
    const result = await runCoreWithExitTrap(deps, codexAdapter)
    expect(calls).toEqual(['stdin', 'import', 'handler'])
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'denied',
      },
    })
  })

  test('Codex valid and malformed SessionStart never discover or vendor Claude plugins', async () => {
    for (const valid of [false, true]) {
      let handlers = 0
      let imports = 0
      let discoveries = 0
      let vendors = 0
      const deps = makeDeps(
        {
          hook_event_name: 'SessionStart',
          session_id: 'codex-direct-core-test',
          ...(valid
            ? {
                cwd: '/project',
                model: 'actual-model',
                permission_mode: 'default',
                transcript_path: null,
                source: 'startup',
              }
            : {}),
        },
        [
          makeHook('start', {
            SessionStart: () => {
              handlers++
              return { result: 'skip', injectContext: 'session context' }
            },
          }),
        ],
      )
      const load = deps.loadAllHooks
      deps.loadAllHooks = async (...args) => {
        imports++
        return load(...args)
      }
      deps.discoverPluginPacks = () => {
        discoveries++
        throw new Error('Claude plugin discovery must not run for Codex')
      }
      deps.vendorAndRegisterPack = async () => {
        vendors++
        throw new Error('Claude plugin vendoring must not run for Codex')
      }
      const result = await runCoreWithExitTrap(deps, codexAdapter)
      expect(result.code).toBe(0)
      expect(result.stderr).toBe('')
      expect(discoveries).toBe(0)
      expect(vendors).toBe(0)
      expect(imports).toBe(valid ? 1 : 0)
      expect(handlers).toBe(valid ? 1 : 0)
      if (valid)
        expect(JSON.parse(result.stdout)).toEqual({
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: 'session context',
          },
        })
      else {
        expect(JSON.parse(result.stdout)).toMatchObject({ continue: false })
        expect(JSON.parse(result.stdout).systemMessage).toContain('capability "cwd"')
        expect(result.stdout).toContain('hooks were not imported or executed')
      }
    }
  })

  test('runtime-capable adapter can run SessionStart without Claude plugin or settings hooks', async () => {
    const adapter: AgentAdapter = {
      ...claudeCodeAdapter,
      id: 'codex',
      supportsRuntime: true,
      supportsClaudePluginAdvisories: false,
      prepareConfigAfterLoad: async (input) => ({
        config: input.config,
        shadows: input.shadows,
        systemMessages: [],
      }),
      collectSessionStartAdvisories: () => [],
    }
    const deps = makeDeps({
      hook_event_name: 'SessionStart',
      session_id: 'fake-runtime-session',
    })
    deps.discoverPluginPacks = () => {
      throw new Error('Claude plugin discovery must not run for fake adapter')
    }
    deps.vendorAndRegisterPack = async () => {
      throw new Error('Claude plugin vendoring must not run for fake adapter')
    }

    const result = await runCoreWithExitTrap(deps, adapter)

    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toBe('')
  })
})
