import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { claudeCodeAdapter } from '../agents/claude-code/adapter.js'
import { codexAdapter } from '../agents/codex/adapter.js'
import type { AgentAdapter } from '../agents/types.js'
import type { ClooksConfig, HookEntry } from '../config/schema.js'
import type { DanglingHook, LoadedHook } from '../loader.js'
import type { HookName, Milliseconds } from '../types/branded.js'
import { runEngine, runEngineCore } from './run.js'
import type { RunEngineDeps } from './types.js'

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
let tempDirs: string[] = []

afterEach(() => {
  if (originalAgent === undefined) {
    delete process.env.CLOOKS_AGENT
  } else {
    process.env.CLOOKS_AGENT = originalAgent
  }
  delete process.env.CLOOKS_HOME_ROOT
  delete process.env.CLOOKS_SILENCE_STALE_PLUGIN_ADVISORIES
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
  tempDirs = []
})

describe('runEngine agent adapter selection', () => {
  test('fails closed for unknown CLOOKS_AGENT values before runtime', async () => {
    process.env.CLOOKS_AGENT = 'unknown-agent'

    const result = await runWithExitTrap()

    expect(result.code).toBe(2)
    expect(result.stderr).toContain('unsupported CLOOKS_AGENT "unknown-agent"')
  })

  test('fails closed for the Codex placeholder before Codex translation', async () => {
    process.env.CLOOKS_AGENT = 'codex'

    const result = await runWithExitTrap()

    expect(result.code).toBe(2)
    expect(result.stderr).toContain('CLOOKS_AGENT=codex is not implemented yet')
  })

  test('does not payload-sniff Claude-shaped stdin when CLOOKS_AGENT selects Codex', async () => {
    process.env.CLOOKS_AGENT = 'codex'
    let readStdinCalled = false
    const deps = makeDeps({
      hook_event_name: 'SessionStart',
      session_id: 'claude-shaped-session',
    })
    deps.readStdin = async () => {
      readStdinCalled = true
      return {
        hook_event_name: 'SessionStart',
        session_id: 'claude-shaped-session',
      }
    }

    const result = await runWithExitTrap(deps)

    expect(result.code).toBe(2)
    expect(result.stderr).toContain('CLOOKS_AGENT=codex is not implemented yet')
    expect(readStdinCalled).toBe(false)
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

describe('runEngineCore Codex placeholder isolation', () => {
  test('Codex placeholder fails before plugin/advisory isolation can be observed in core', async () => {
    const deps = makeDeps({
      hook_event_name: 'SessionStart',
      session_id: 'codex-placeholder-direct-core-test',
    })
    deps.discoverPluginPacks = () => {
      throw new Error('Claude plugin discovery must not run for Codex')
    }
    deps.vendorAndRegisterPack = async () => {
      throw new Error('Claude plugin vendoring must not run for Codex')
    }

    const result = await runCoreWithExitTrap(deps, codexAdapter)

    expect(result.code).toBe(2)
    expect(result.stderr).toContain('missing or unrecognized hook_event_name')
    expect(result.stdout).toBe('')
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
