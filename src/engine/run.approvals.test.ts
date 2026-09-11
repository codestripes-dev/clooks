import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { codexAdapter } from '../agents/codex/adapter.js'
import { claudeCodeAdapter } from '../agents/claude-code/adapter.js'
import { ApprovalStore } from '../agents/codex/approval-store.js'
import { prepareApprovalAttempt } from '../agents/codex/approvals.js'
import type { AgentAdapter } from '../agents/types.js'
import type { ClooksConfig } from '../config/schema.js'
import type { LoadedHook } from '../loader.js'
import { hn, ms } from '../test-utils.js'
import { runEngineCore } from './run.js'
import type { RunEngineDeps } from './types.js'

let root: string
let store: ApprovalStore
let config: ClooksConfig
let hooks: LoadedHook[]
let reads: number
const savedHome = process.env.CLOOKS_HOME_ROOT
const savedCode = process.exitCode
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'clooks-run-approvals-'))
  process.env.CLOOKS_HOME_ROOT = root
  store = new ApprovalStore(root)
  config = {
    version: '1',
    global: {
      timeout: ms(1000),
      onError: 'block',
      maxFailures: 3,
      maxFailuresMessage: 'failed',
      handoff: false,
    },
    hooks: {},
    events: {},
  }
  hooks = []
  reads = 0
})
afterEach(() => {
  if (savedHome === undefined) delete process.env.CLOOKS_HOME_ROOT
  else process.env.CLOOKS_HOME_ROOT = savedHome
  process.exitCode = savedCode
  rmSync(root, { recursive: true, force: true })
})
function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    hook_event_name: 'PreToolUse',
    session_id: 's',
    cwd: root,
    tool_name: 'exec_command',
    tool_input: { command: 'rm -rf scratch' },
    turn_id: 't',
    tool_use_id: 'id',
    model: 'm',
    permission_mode: 'default',
    ...overrides,
  }
}
function add(name: string, handler: (context: Record<string, unknown>) => unknown) {
  const hookPath = join(root, `${name}.ts`)
  writeFileSync(hookPath, `// fixture entry ${name}\n`)
  config.hooks[hn(name)] = {
    config: {},
    parallel: false,
    origin: 'project',
    resolvedPath: hookPath,
  }
  hooks.push({
    name: hn(name),
    config: {},
    hookPath,
    configPath: join(root, 'clooks.yml'),
    hook: { meta: { name }, PreToolUse: handler } as LoadedHook['hook'],
  })
}
function deps(input: unknown = raw()): RunEngineDeps {
  return {
    readStdin: async () => {
      reads++
      return input
    },
    loadConfig: async () => ({ config, shadows: [], hasProjectConfig: true }),
    loadAllHooks: async () => ({ loaded: hooks, loadErrors: [], dangling: [] }),
    discoverProjectRoot: async () => ({
      projectRoot: root,
      signal: 'walk-up',
      from: root,
      checked: [root],
      boundary: 'git-root',
      boundaryPath: root,
    }),
  }
}
class Exit extends Error {}
async function run(
  dependencies = deps(),
  adapter: AgentAdapter = codexAdapter,
  outputFailure = false,
  onOutputFailure?: () => void,
) {
  let stdout = ''
  let stderr = ''
  let code: string | number | undefined = 0
  const exit = spyOn(process, 'exit').mockImplementation((value) => {
    code = value ?? undefined
    throw new Exit()
  })
  const out = spyOn(process.stdout, 'write').mockImplementation((value) => {
    if (outputFailure) {
      outputFailure = false
      onOutputFailure?.()
      throw new Error('output unavailable')
    }
    stdout += String(value)
    return true
  })
  const err = spyOn(process.stderr, 'write').mockImplementation((value) => {
    stderr += String(value)
    return true
  })
  try {
    await runEngineCore(adapter, dependencies)
  } catch (error) {
    if (!(error instanceof Exit)) throw error
  } finally {
    exit.mockRestore()
    out.mockRestore()
    err.mockRestore()
  }
  return { stdout, stderr, code, json: stdout ? JSON.parse(stdout) : {} }
}
function token(output: Awaited<ReturnType<typeof run>>): string {
  expect(output.json.hookSpecificOutput?.permissionDecision).toBe('deny')
  const id = /ca1_[a-f0-9]{64}/.exec(output.stdout)?.[0]
  expect(id).toBeDefined()
  return id!
}
function seed(input = raw()) {
  const record = store.issueOrReuse({
    baseInvocationHash: prepareApprovalAttempt(input).baseInvocationHash,
    decisionHash: 'a'.repeat(64),
    confirmationHash: 'b'.repeat(64),
  })
  store.acknowledge(record.token)
  return record.token
}

describe('hybrid approval engine integration', () => {
  test.each([
    {
      fields: { session_id: '' },
      capability: 'session_id',
      detail: 'session_id must be a nonempty string',
    },
    {
      fields: { agent_id: null, agent_type: 'worker' },
      capability: 'agent_id',
      detail: 'agent_id must be a nonempty string',
    },
    {
      fields: { agent_id: true, agent_type: 'worker' },
      capability: 'agent_id',
      detail: 'agent_id must be a nonempty string',
    },
    {
      fields: { tool_input: [] },
      capability: 'tool_input',
      detail: 'tool input must be a JSON record; scalar, array and null inputs are unsupported',
    },
  ])(
    'preserves exact $capability diagnostics before imports, including config failure',
    async ({ fields, capability, detail }) => {
      for (const configFailure of [false, true]) {
        const dependencies = deps(raw(fields))
        let imports = 0
        dependencies.loadAllHooks = async () => {
          imports++
          throw new Error('must not import')
        }
        if (configFailure)
          dependencies.loadConfig = async () => {
            throw new Error('bad config')
          }
        const output = await run(dependencies)
        const reason = `clooks: Codex PreToolUse hook "runtime" capability "${capability}": ${detail}; hooks were not imported or executed. Pending call denial requested.`
        expect(output.json).toEqual({
          systemMessage: reason,
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: reason,
          },
        })
        expect(output.code).toBe(0)
        expect(output.stderr).toBe('')
        expect(imports).toBe(0)
      }
      expect(reads).toBe(2)
    },
  )
  test('valid envelope with malformed carrier keeps approval-input refusal before imports', async () => {
    const dependencies = deps(
      raw({ tool_input: { command: 'CLOOKS_APPROVAL_TOKENS=bad rm scratch' } }),
    )
    let imports = 0
    dependencies.loadAllHooks = async () => {
      imports++
      throw new Error('must not import')
    }
    const output = await run(dependencies)
    const reason =
      'clooks: Codex PreToolUse hook "runtime" capability "approval-input": Malformed or excessive approval tokens; use clooks approve; hooks were not imported or executed. Pending call denial requested.'
    expect(output.json).toEqual({
      systemMessage: reason,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    })
    expect(imports).toBe(0)
    expect(reads).toBe(1)
    expect(output.code).toBe(0)
    expect(output.stderr).toBe('')
  })
  test.each(['adjust', 'serialize'] as const)(
    'pending denial survives permissive %s output',
    async (stage) => {
      add('a', () => ({ result: 'ask', reason: 'pending' }))
      const adapter: AgentAdapter = { ...codexAdapter }
      if (stage === 'adjust')
        adapter.adjustResultBeforeFinalOutput = () => ({
          result: { result: 'allow' },
          systemMessages: [],
        })
      else adapter.translateFinalOutput = () => ({ exitCode: 0 })
      const denied = await run(deps(), adapter)
      expect(denied.json.hookSpecificOutput.permissionDecision).toBe('deny')
      expect(denied.stdout).toContain('removed a pending Codex denial')
    },
  )
  test('runs all asks, supports inline plus registration, keeps carrier out of public and private normalized input', async () => {
    const seen: unknown[] = []
    add('a', (context) => {
      seen.push(context.toolInput)
      return { result: 'ask', reason: 'first', injectContext: 'loser' }
    })
    add('b', () => ({ result: 'ask', reason: 'second', injectContext: 'winner' }))
    const a = token(await run())
    const normalize = codexAdapter.normalizeInvocation
    const adapter: AgentAdapter = {
      ...codexAdapter,
      normalizeInvocation(payload, event) {
        expect(payload.tool_input).toEqual({ command: 'rm -rf scratch' })
        const normalized = normalize(payload, event)
        expect(normalized.private.raw.tool_input).toEqual({ command: 'rm -rf scratch' })
        return normalized
      },
    }
    const inline = raw({ tool_input: { command: `CLOOKS_APPROVAL_TOKENS=${a} rm -rf scratch` } })
    const b = token(await run(deps(inline), adapter))
    expect(a).not.toBe(b)
    store.acknowledge(b)
    const allowed = await run(deps(raw({ turn_id: 'next', tool_use_id: 'retry' })))
    expect(allowed.json.hookSpecificOutput).toEqual({
      hookEventName: 'PreToolUse',
      additionalContext: 'winner',
    })
    expect(allowed.stdout).not.toContain('loser')
    expect(allowed.stdout).not.toContain('updatedInput')
    expect(seen).toEqual(Array(3).fill({ command: 'rm -rf scratch' }))
    expect(() => store.acknowledge(a)).toThrow('consumed')
    expect(() => store.acknowledge(b)).toThrow('consumed')
    expect(reads).toBe(3)
  })
  test.each([false, true])(
    'preserves losing-ask patch behavior, winning patch=%s',
    async (winningPatch) => {
      add('a', () => ({
        result: 'ask',
        reason: 'a',
        updatedInput: { command: 'rewritten' },
        injectContext: 'lost',
      }))
      add('b', (context) => {
        expect(context.toolInput).toEqual({ command: 'rewritten' })
        return {
          result: 'ask',
          reason: 'b',
          ...(winningPatch ? { updatedInput: { command: 'final' } } : {}),
        }
      })
      store.acknowledge(token(await run()))
      store.acknowledge(token(await run()))
      const allowed = await run()
      expect(allowed.json.hookSpecificOutput?.updatedInput).toEqual(
        winningPatch ? { command: 'final' } : undefined,
      )
      expect(allowed.json.hookSpecificOutput?.permissionDecision).toBe(
        winningPatch ? 'allow' : undefined,
      )
      expect(allowed.stdout).not.toContain('lost')
    },
  )
  test('allow loser patch still contributes and successful permit retires older base approvals', async () => {
    const old = seed()
    add('allow', () => ({
      result: 'allow',
      updatedInput: { command: 'rewritten' },
      injectContext: 'allow context',
    }))
    add('ask', () => ({ result: 'ask', reason: '' }))
    store.acknowledge(token(await run()))
    const allowed = await run()
    expect(allowed.json.hookSpecificOutput.updatedInput).toEqual({ command: 'rewritten' })
    expect(allowed.stdout).toContain('allow context')
    expect(() => store.acknowledge(old)).toThrow('consumed')
  })
  test('entry-byte, effective config and alias changes reissue confirmation', async () => {
    add('a', () => ({ result: 'ask', reason: 'a' }))
    const a = token(await run())
    store.acknowledge(a)
    writeFileSync(hooks[0]!.hookPath, '// updated entry')
    const b = token(await run())
    expect(b).not.toBe(a)
    store.acknowledge(b)
    hooks[0]!.config = { changed: true }
    const c = token(await run())
    expect(c).not.toBe(b)
  })
  test.each(['block', 'crash', 'degraded', 'policy'] as const)(
    '%s cannot discharge asks or consume acknowledgements',
    async (mode) => {
      add('ask', () => ({ result: 'ask', reason: 'ask' }))
      const id = token(await run())
      store.acknowledge(id)
      add('other', () => {
        if (mode === 'crash' || mode === 'degraded') throw new Error('broken')
        return mode === 'policy' ? { result: 'defer' } : { result: 'block', reason: 'explicit' }
      })
      if (mode === 'degraded') config.global.maxFailures = 1
      const denied = await run()
      expect(denied.json.hookSpecificOutput.permissionDecision).toBe('deny')
      expect(denied.stdout).not.toContain('Approval token:')
      expect(store.acknowledge(id).consumedAt).toBeNull()
    },
  )
  test.each(['adjust', 'serialize', 'mismatch', 'deny', 'commit', 'emit'] as const)(
    'fails closed at %s; only emission failure burns approvals',
    async (failure) => {
      add('ask', () => ({ result: 'ask', reason: 'ask', updatedInput: { command: 'approved' } }))
      const id = token(await run())
      store.acknowledge(id)
      const adapter: AgentAdapter = { ...codexAdapter }
      let reached = 0
      if (failure === 'adjust')
        adapter.adjustResultBeforeFinalOutput = () => {
          reached++
          throw new Error('adjustment failed')
        }
      if (failure === 'serialize')
        adapter.translateFinalOutput = () => {
          reached++
          throw new Error('serialization failed')
        }
      if (failure === 'mismatch')
        adapter.translateFinalOutput = () => {
          reached++
          return {
            exitCode: 0,
            output:
              '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","updatedInput":{"command":"wrong"}}}',
          }
        }
      if (failure === 'deny')
        adapter.adjustResultBeforeFinalOutput = () => {
          reached++
          return {
            result: { result: 'block', reason: 'adjusted denial' },
            systemMessages: [],
          }
        }
      const commit =
        failure === 'commit'
          ? spyOn(ApprovalStore.prototype, 'finalizePermit').mockImplementation(() => {
              reached++
              throw new Error('commit failed')
            })
          : undefined
      let denied: Awaited<ReturnType<typeof run>>
      try {
        denied = await run(deps(), adapter, failure === 'emit', () => {
          reached++
        })
      } finally {
        commit?.mockRestore()
      }
      expect(denied.json.hookSpecificOutput.permissionDecision).toBe('deny')
      expect(reached).toBe(1)
      const diagnostic = {
        adjust: 'adjustment failed',
        serialize: 'serialization failed',
        mismatch: 'Serialized tool input differs',
        deny: 'adjusted denial',
        commit: 'commit failed',
        emit: 'output unavailable',
      }[failure]
      expect(denied.stdout).toContain(diagnostic)
      expect(denied.stdout).not.toContain('Approval token:')
      expect(denied.json.hookSpecificOutput).not.toHaveProperty('updatedInput')
      if (failure === 'emit') expect(() => store.acknowledge(id)).toThrow('consumed')
      else {
        expect(store.acknowledge(id).consumedAt).toBeNull()
        const retry = await run()
        expect(retry.json.hookSpecificOutput.permissionDecision).toBe('allow')
        expect(retry.json.hookSpecificOutput.updatedInput).toEqual({ command: 'approved' })
        expect(() => store.acknowledge(id)).toThrow('consumed')
      }
    },
  )
  test('successful adjustment cannot replace the bound operation through the real translator', async () => {
    add('ask', () => ({ result: 'ask', reason: 'ask', updatedInput: { command: 'approved' } }))
    const id = token(await run())
    store.acknowledge(id)
    let adjusted = 0
    let serialized = 0
    const adapter: AgentAdapter = {
      ...codexAdapter,
      adjustResultBeforeFinalOutput(input) {
        adjusted++
        expect(input.result?.result).toBe('allow')
        return {
          result: { ...input.result!, updatedInput: { command: 'changed by adjustment' } },
          systemMessages: [],
        }
      },
      translateFinalOutput(input) {
        serialized++
        return codexAdapter.translateFinalOutput(input)
      },
    }
    const denied = await run(deps(), adapter)
    expect(adjusted).toBe(1)
    expect(serialized).toBe(1)
    expect(denied.json.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(denied.stdout).toContain('Serialized tool input differs')
    expect(denied.stdout).not.toContain('Approval token:')
    expect(denied.json.hookSpecificOutput).not.toHaveProperty('updatedInput')
    expect(store.acknowledge(id).consumedAt).toBeNull()
    const retry = await run()
    expect(retry.json.hookSpecificOutput.updatedInput).toEqual({ command: 'approved' })
    expect(retry.json.hookSpecificOutput.permissionDecision).toBe('allow')
    expect(() => store.acknowledge(id)).toThrow('consumed')
  })
})

describe('approval retirement early exits', () => {
  test.each([
    'no-config',
    'no-hooks',
    'no-match',
    'no-ask',
    'config-degraded',
    'hook-degraded',
  ] as const)('%s retires matching base acknowledgements only', async (path) => {
    const id = seed()
    const other = seed(raw({ session_id: 'other' }))
    let input = raw()
    if (path === 'no-config') {
      input = {
        hook_event_name: 'PreToolUse',
        session_id: 's',
        cwd: root,
        tool_name: 'exec_command',
        tool_input: { command: 'rm -rf scratch' },
      }
    }
    if (path === 'no-match') {
      add('stop', () => ({ result: 'skip' }))
      delete (hooks[0]!.hook as unknown as Record<string, unknown>).PreToolUse
    }
    if (path === 'no-ask') add('allow', () => ({ result: 'allow' }))
    if (path === 'hook-degraded') {
      config.global.maxFailures = 1
      add('broken', () => {
        throw new Error('broken')
      })
    }
    const dependencies = deps(input)
    if (path === 'no-config') dependencies.loadConfig = async () => null
    if (path === 'config-degraded') {
      dependencies.loadConfig = async () => {
        throw new Error('bad config')
      }
      expect((await run(dependencies)).json.hookSpecificOutput.permissionDecision).toBe('deny')
      expect((await run(dependencies)).json.hookSpecificOutput.permissionDecision).toBe('deny')
      expect(store.acknowledge(id).consumedAt).toBeNull()
    }
    const allowed = await run(dependencies)
    expect(allowed.json.hookSpecificOutput?.permissionDecision).not.toBe('deny')
    expect(() => store.acknowledge(id)).toThrow('consumed')
    expect(store.acknowledge(other).consumedAt).toBeNull()
    expect(reads).toBe(path === 'config-degraded' ? 3 : 1)
  })
  test.each([false, true])(
    'absent store preserves no-config reads, advisory=%s',
    async (advisory) => {
      const dependencies = deps(null)
      dependencies.loadConfig = async () => null
      if (advisory)
        dependencies.discoverProjectRoot = async () => ({
          projectRoot: root,
          signal: 'cwd-fallback',
          from: root,
          checked: [root],
        })
      expect((await run(dependencies)).stdout).toBe('')
      expect(reads).toBe(advisory ? 1 : 0)
      expect(store.exists()).toBe(false)
    },
  )
  test.each(['malformed', 'throw', 'undefined-throw', 'missing-identity'] as const)(
    'existing-store advisory caches %s and never rereads stdin',
    async (failure) => {
      const id = seed()
      const dependencies = deps(failure === 'missing-identity' ? raw({ session_id: '' }) : [])
      dependencies.loadConfig = async () => null
      dependencies.discoverProjectRoot = async () => ({
        projectRoot: root,
        signal: 'cwd-fallback',
        from: root,
        checked: [root],
      })
      if (failure === 'throw' || failure === 'undefined-throw')
        dependencies.readStdin = async () => {
          reads++
          throw failure === 'throw' ? new Error('stdin failed') : undefined
        }
      const refused = await run(dependencies)
      if (failure === 'missing-identity') expect(refused.stdout).toContain('Pending call denial')
      else {
        expect(refused.stderr).toContain('local failure')
        expect(refused.code).toBe(2)
        expect(refused.stdout).toBe('')
      }
      expect(reads).toBe(1)
      expect(store.acknowledge(id).consumedAt).toBeNull()
    },
  )
  test.each(['SessionStart', 'PostToolUse'] as const)(
    'known %s does not access approval storage',
    async (event) => {
      const exists = spyOn(ApprovalStore.prototype, 'exists').mockImplementation(() => {
        throw new Error('unavailable')
      })
      try {
        const output = await run(
          deps(raw({ hook_event_name: event, source: 'startup', tool_response: {} })),
        )
        expect(output.stdout).toBe('')
        expect(exists).not.toHaveBeenCalled()
      } finally {
        exists.mockRestore()
      }
    },
  )
  test('no-config non-PreToolUse ignores inaccessible store after identifying cached event', async () => {
    const exists = spyOn(ApprovalStore.prototype, 'exists').mockImplementation(() => {
      throw new Error('unavailable')
    })
    try {
      const dependencies = deps({ hook_event_name: 'PostToolUse' })
      dependencies.loadConfig = async () => null
      expect((await run(dependencies)).stdout).toBe('')
      expect(reads).toBe(1)
    } finally {
      exists.mockRestore()
    }
  })
  test('existing corrupt store refuses no-ask success, but explicit denial does not consult it', async () => {
    seed()
    writeFileSync(store.path, 'corrupt')
    expect((await run()).json.hookSpecificOutput.permissionDecision).toBe('deny')
    add('deny', () => ({ result: 'block', reason: 'explicit' }))
    expect((await run()).json.hookSpecificOutput.permissionDecisionReason).toBe('explicit')
  })
  test('Claude never accesses Codex approvals', async () => {
    const exists = spyOn(ApprovalStore.prototype, 'exists').mockImplementation(() => {
      throw new Error('Codex store')
    })
    try {
      expect((await run(deps(raw()), claudeCodeAdapter)).stdout).toBe('')
      expect(exists).not.toHaveBeenCalled()
    } finally {
      exists.mockRestore()
    }
  })
  test.each(['claude-ask', 'SessionStart', 'PostToolUse'] as const)(
    'matched %s executes and never calls approval store methods',
    async (event) => {
      let executed = 0
      add('matched', () => {
        executed++
        return { result: 'ask', reason: 'native Claude confirmation' }
      })
      if (event !== 'claude-ask') {
        const hook = hooks[0]!.hook as unknown as Record<string, unknown>
        delete hook.PreToolUse
        hook[event] = () => {
          executed++
          return { result: 'skip', injectContext: 'matched context' }
        }
      }
      const spies = [
        spyOn(ApprovalStore.prototype, 'exists'),
        spyOn(ApprovalStore.prototype, 'issueOrReuse'),
        spyOn(ApprovalStore.prototype, 'acknowledge'),
        spyOn(ApprovalStore.prototype, 'resolveAttempt'),
        spyOn(ApprovalStore.prototype, 'finalizePermit'),
      ]
      for (const spy of spies)
        spy.mockImplementation(() => {
          throw new Error('unexpected approval I/O')
        })
      try {
        const output = await run(
          deps(
            event === 'claude-ask'
              ? raw()
              : raw({ hook_event_name: event, source: 'startup', tool_response: {} }),
          ),
          event === 'claude-ask' ? claudeCodeAdapter : codexAdapter,
        )
        expect(executed).toBe(1)
        expect(output.code).toBe(0)
        if (event === 'claude-ask')
          expect(output.json.hookSpecificOutput.permissionDecision).toBe('ask')
        else
          expect(output.json.hookSpecificOutput).toEqual({
            hookEventName: event,
            additionalContext: 'matched context',
          })
        for (const spy of spies) expect(spy).not.toHaveBeenCalled()
      } finally {
        for (const spy of spies) spy.mockRestore()
      }
    },
  )
})
