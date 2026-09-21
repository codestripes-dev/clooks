import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { claudeCodeAdapter } from '../agents/claude-code/adapter.js'
import { codexAdapter } from '../agents/codex/adapter.js'
import type { AgentAdapter } from '../agents/types.js'
import type { ClooksConfig, HookEntry } from '../config/schema.js'
import type { LoadedHook } from '../loader.js'
import type { HookName, Milliseconds } from '../types/branded.js'
import { defaultDeps, runEngineCore } from './run.js'
import type { RunEngineDeps } from './types.js'

class ExitCalled extends Error {
  constructor(readonly code: number | string | undefined) {
    super(`ExitCalled(${String(code)})`)
  }
}

function captureWrite(captured: string[]) {
  return (message: unknown, encodingOrCallback?: unknown, callback?: unknown): boolean => {
    captured.push(String(message))
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

async function runWithExitTrap(adapter: AgentAdapter, deps: RunEngineDeps) {
  const stdout: string[] = []
  const stderr: string[] = []
  const stdoutSpy = spyOn(process.stdout, 'write').mockImplementation(captureWrite(stdout))
  const stderrSpy = spyOn(process.stderr, 'write').mockImplementation(captureWrite(stderr))
  const originalExit = process.exit.bind(process)
  process.exit = ((code?: number | string) => {
    throw new ExitCalled(code)
  }) as typeof process.exit
  try {
    await runEngineCore(adapter, deps)
  } catch (error) {
    if (!(error instanceof ExitCalled)) throw error
    return { code: error.code, stdout: stdout.join(''), stderr: stderr.join('') }
  } finally {
    process.exit = originalExit
    stdoutSpy.mockRestore()
    stderrSpy.mockRestore()
  }
  return { code: process.exitCode, stdout: stdout.join(''), stderr: stderr.join('') }
}

function configFor(hooks: LoadedHook[]): ClooksConfig {
  return {
    version: '1.0.0',
    global: {
      timeout: 30_000 as Milliseconds,
      onError: 'block',
      maxFailures: 3,
      maxFailuresMessage: 'Too many failures',
      handoff: false,
    },
    hooks: Object.fromEntries(
      hooks.map((hook) => [
        hook.name,
        {
          resolvedPath: hook.hookPath,
          config: {},
          parallel: false,
          origin: 'project',
        } satisfies HookEntry,
      ]),
    ) as Record<HookName, HookEntry>,
    events: {},
  }
}

function noMatchHook(): LoadedHook {
  return {
    name: 'stop-only' as HookName,
    hook: { meta: { name: 'stop-only' }, Stop: () => ({ result: 'skip' }) },
    config: {},
    hookPath: '/tmp/stop-only.ts',
    configPath: '/tmp/clooks.yml',
  }
}

function makeDeps(
  projectRoot: string,
  input: Record<string, unknown>,
  hooks: LoadedHook[] = [],
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
    loadConfig: async () => ({
      config: configFor(hooks),
      shadows: [],
      hasProjectConfig: true,
    }),
    loadAllHooks: async () => ({ loaded: hooks, loadErrors: [], dangling: [] }),
    readStdin: async () => input,
  }
}

let root: string
let projectRoot: string
let originalHomeRoot: string | undefined

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'clooks-installation-advisory-engine-'))
  projectRoot = join(root, 'project')
  mkdirSync(join(projectRoot, '.clooks'), { recursive: true })
  originalHomeRoot = process.env.CLOOKS_HOME_ROOT
  process.env.CLOOKS_HOME_ROOT = join(root, 'runtime-home')
})

afterEach(() => {
  if (originalHomeRoot === undefined) delete process.env.CLOOKS_HOME_ROOT
  else process.env.CLOOKS_HOME_ROOT = originalHomeRoot
  rmSync(root, { recursive: true, force: true })
})

describe('installation advisory engine integration', () => {
  test('default dependencies load the real collector for isolated absent and error states', async () => {
    const collect = defaultDeps.collectInstallationAdvisories
    expect(collect).toBeDefined()
    const options = {
      agent: 'claude-code' as const,
      projectRoot,
      installationHome: root,
      executable: process.execPath,
      binaryVersion: '0.3.0',
      env: {},
    }

    expect(await collect!(options)).toEqual([])
    expect(await collect!({ ...options, installationHome: join(root, 'missing') })).toEqual([])
  })

  for (const [agent, baseAdapter] of [
    ['claude-code', claudeCodeAdapter],
    ['codex', codexAdapter],
  ] as const) {
    for (const mode of ['no-hooks', 'no-match'] as const) {
      test(`${agent} SessionStart delivers installation and existing advisories with ${mode}`, async () => {
        const hooks = mode === 'no-match' ? [noMatchHook()] : []
        const input = {
          hook_event_name: 'SessionStart',
          session_id: `${agent}-${mode}`,
          cwd: projectRoot,
          source: 'startup',
          model: 'model',
          permission_mode: 'default',
          transcript_path: null,
        }
        const deps = makeDeps(projectRoot, input, hooks)
        let calls = 0
        deps.collectInstallationAdvisories = (options) => {
          calls++
          expect(options).toMatchObject({
            agent,
            projectRoot,
            installationHome: homedir(),
            executable: process.execPath,
          })
          expect(options.installationHome).not.toBe(process.env.CLOOKS_HOME_ROOT)
          return ['installation warning']
        }
        const adapter: AgentAdapter = {
          ...baseAdapter,
          collectSessionStartAdvisories: () => ['existing warning'],
        }

        const result = await runWithExitTrap(adapter, deps)
        expect(result.code).toBe(0)
        expect(result.stdout).toContain('existing warning')
        expect(result.stdout).toContain('installation warning')
        expect(calls).toBe(1)
      })
    }
  }

  test('non-SessionStart events perform zero installation inspection', async () => {
    const deps = makeDeps(projectRoot, {
      hook_event_name: 'UserPromptSubmit',
      session_id: 'prompt',
      prompt: 'hello',
      cwd: projectRoot,
    })
    let calls = 0
    deps.collectInstallationAdvisories = () => {
      calls++
      return ['unexpected']
    }

    const result = await runWithExitTrap(claudeCodeAdapter, deps)
    expect(result.code).toBe(0)
    expect(calls).toBe(0)
    expect(result.stdout).not.toContain('unexpected')
  })

  test('no-config behavior returns before installation inspection', async () => {
    const deps = makeDeps(projectRoot, {
      hook_event_name: 'SessionStart',
      session_id: 'no-config',
      cwd: projectRoot,
      source: 'startup',
    })
    deps.loadConfig = async () => null
    let calls = 0
    deps.collectInstallationAdvisories = () => {
      calls++
      return ['unexpected']
    }

    const result = await runWithExitTrap(claudeCodeAdapter, deps)
    expect(result.code).toBe(0)
    expect(calls).toBe(0)
    expect(result.stdout).toBe('')
  })

  test('inspection failures do not mask existing SessionStart warnings', async () => {
    const deps = makeDeps(projectRoot, {
      hook_event_name: 'SessionStart',
      session_id: 'inspection-failure',
      cwd: projectRoot,
      source: 'startup',
    })
    deps.collectInstallationAdvisories = () => {
      throw new Error('inspection failed')
    }
    const adapter: AgentAdapter = {
      ...claudeCodeAdapter,
      collectSessionStartAdvisories: () => ['existing warning'],
    }

    const result = await runWithExitTrap(adapter, deps)
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('existing warning')
    expect(result.stdout).not.toContain('inspection failed')
  })
})
