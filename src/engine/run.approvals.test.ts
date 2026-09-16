import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { codexAdapter } from '../agents/codex/adapter.js'
import { claudeCodeAdapter } from '../agents/claude-code/adapter.js'
import type { AgentAdapter } from '../agents/types.js'
import type { ApprovalInteraction, ApprovalQuestion } from '../interaction/types.js'
import type { ClooksConfig } from '../config/schema.js'
import type { LoadedHook } from '../loader.js'
import { hn, ms } from '../test-utils.js'
import { runEngine, runEngineCore } from './run.js'
import type { RunEngineDeps } from './types.js'
import { createApprovalInteraction } from '../interaction/channel.js'
import { approvalRoot, Mailbox } from '../interaction/storage.js'
import {
  attachedSchema,
  digest,
  questionPacketSchema,
  startSchema,
} from '../interaction/protocol.js'

let root: string
let config: ClooksConfig
let hooks: LoadedHook[]
let questions: ApprovalQuestion[]
let journal: string[]
let interaction: ApprovalInteraction
let saved: NodeJS.ProcessEnv
let savedCode: typeof process.exitCode
beforeEach(() => {
  saved = { ...process.env }
  savedCode = process.exitCode
  root = mkdtempSync(join(tmpdir(), 'clooks-live-run-'))
  process.env.CLOOKS_HOME_ROOT = root
  process.env.CLOOKS_APPROVAL_OWNER = 'project:test'
  process.env.CLOOKS_APPROVAL_PROTOCOL = '1'
  delete process.env.CLOOKS_APPROVAL_DISPOSITION
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
  questions = []
  journal = []
  interaction = {
    async request(question) {
      questions.push(structuredClone(question))
      journal.push(`ask:${question.hookName}`)
      return { kind: 'approved' }
    },
    async close() {
      journal.push('close')
    },
  }
})
afterEach(() => {
  process.env = saved
  process.exitCode = savedCode
  rmSync(root, { recursive: true, force: true })
})
function raw(overrides: Record<string, unknown> = {}) {
  return {
    hook_event_name: 'PreToolUse',
    session_id: 's',
    cwd: root,
    tool_name: 'exec_command',
    tool_input: { command: 'original' },
    turn_id: 't',
    tool_use_id: 'id',
    model: 'm',
    permission_mode: 'default',
    ...overrides,
  }
}
function add(name: string, handler: (ctx: Record<string, unknown>) => unknown) {
  config.hooks[hn(name)] = {
    config: {},
    parallel: false,
    origin: 'project',
    resolvedPath: join(root, name),
  }
  hooks.push({
    name: hn(name),
    config: {},
    hookPath: join(root, name),
    configPath: join(root, 'clooks.yml'),
    hook: { meta: { name }, PreToolUse: handler } as LoadedHook['hook'],
  })
}
function deps(input: unknown = raw()): RunEngineDeps {
  return {
    readStdin: async () => {
      journal.push('read')
      return input
    },
    loadConfig: async () => {
      journal.push('config')
      return { config, shadows: [], hasProjectConfig: true }
    },
    loadAllHooks: async () => {
      journal.push('load')
      return { loaded: hooks, loadErrors: [], dangling: [] }
    },
    discoverProjectRoot: async () => {
      journal.push('discover')
      return {
        projectRoot: root,
        signal: 'walk-up',
        from: root,
        checked: [root],
        boundary: 'git-root',
        boundaryPath: root,
      }
    },
    createApprovalInteraction: async (options) => {
      journal.push('open')
      expect(options.identity.owner).toBe('project:test')
      return interaction
    },
  }
}
class Exit extends Error {}
async function run(
  dependencies = deps(),
  adapter: AgentAdapter = codexAdapter,
  onFlush?: (complete: (error?: Error | null) => void) => void,
  throughEntryPoint = false,
) {
  let stdout = ''
  let stderr = ''
  let code: unknown = 0
  const exit = spyOn(process, 'exit').mockImplementation((value) => {
    code = value
    journal.push('exit')
    throw new Exit()
  })
  const out = spyOn(process.stdout, 'write').mockImplementation(
    (
      value: string | Uint8Array,
      encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
      callback?: (error?: Error | null) => void,
    ) => {
      if (value === '' && onFlush) {
        const complete = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback
        if (!complete) throw new Error('Missing stream completion callback')
        onFlush(complete)
        return true
      }
      stdout += String(value)
      journal.push('output')
      return true
    },
  )
  const err = spyOn(process.stderr, 'write').mockImplementation((value) => {
    stderr += String(value)
    return true
  })
  try {
    if (throughEntryPoint) {
      process.env.CLOOKS_AGENT = adapter.id
      await runEngine(dependencies)
    } else {
      await runEngineCore(adapter, dependencies)
    }
  } catch (error) {
    if (!(error instanceof Exit)) throw error
  } finally {
    exit.mockRestore()
    out.mockRestore()
    err.mockRestore()
  }
  return { stdout, stderr, code, json: stdout ? JSON.parse(stdout) : {} }
}
function gate() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

test('Claude legacy allow spreads scalar patches and removes existing null values', async () => {
  add('legacy', () => ({ result: 'allow', updatedInput: 'ok' }))
  const output = await run(
    deps(raw({ tool_name: 'Bash', tool_input: { command: 'original', absent: null } })),
    claudeCodeAdapter,
  )
  expect(output.json.hookSpecificOutput.permissionDecision).toBe('allow')
  expect(output.json.hookSpecificOutput.updatedInput).toEqual({
    command: 'original',
    0: 'o',
    1: 'k',
  })
  expect(questions).toEqual([])
})

for (const parallel of [false, true]) {
  test(`Claude operation binding preserves mutable context input, parallel=${parallel}`, async () => {
    let observed: unknown
    add('mutate', (ctx) => {
      ;(ctx.toolInput as Record<string, unknown>).command = 'hacked'
      return { result: 'allow' }
    })
    add('observe', (ctx) => {
      observed = (ctx.toolInput as Record<string, unknown>).command
      return { result: 'allow' }
    })
    for (const hook of Object.values(config.hooks)) hook.parallel = parallel
    const output = await run(deps(raw({ tool_name: 'Bash' })), claudeCodeAdapter)
    expect(observed).toBe('hacked')
    expect(output.json.hookSpecificOutput.permissionDecision).toBe('allow')
    expect(output.json.hookSpecificOutput.updatedInput).toBeUndefined()
    expect(questions).toEqual([])
  })
}

test('Claude invalid event ordering remains a fatal error, with paired cleanup', async () => {
  add('post-only', () => ({ result: 'allow' }))
  hooks[0]!.hook = { meta: { name: 'post-only' }, PostToolUse: () => ({ result: 'skip' }) }
  add('pre', () => ({ result: 'allow' }))
  config.events.PreToolUse = { order: [hn('post-only'), hn('pre')] }
  const output = await run(deps(raw({ tool_name: 'Bash' })), claudeCodeAdapter, undefined, true)
  expect(output.code).toBe(2)
  expect(output.stdout).toBe('')
  expect(output.stderr).toContain('clooks: fatal error:')
  expect(output.stderr).toContain('does not handle this event')
  expect(journal).toContain('close')
  expect(journal).not.toContain('output')
})

test('Claude failure-store write errors remain fatal, with paired cleanup', async () => {
  mkdirSync(join(root, '.clooks', '.failures'), { recursive: true })
  add('crash', () => {
    throw new Error('hook failure')
  })
  const output = await run(deps(raw({ tool_name: 'Bash' })), claudeCodeAdapter, undefined, true)
  expect(output.code).toBe(2)
  expect(output.stdout).toBe('')
  expect(output.stderr).toContain('clooks: fatal error:')
  expect(output.stderr).toContain('.failures')
  expect(journal).toContain('close')
  expect(journal).not.toContain('output')
})

for (const adapter of [codexAdapter, claudeCodeAdapter]) {
  test(`${adapter.id} accepts an ask question of exactly 512 UTF-16 code units`, async () => {
    const question = '\u{1f642}'.repeat(256)
    add('boundary-question', () => ({
      result: 'ask',
      question,
      reason: 'This operation needs review.',
    }))
    await run(deps(raw({ tool_name: adapter.id === 'codex' ? 'exec_command' : 'Bash' })), adapter)
    expect(questions).toHaveLength(1)
    expect(questions[0]?.question).toBe(question)
  })
  test(`${adapter.id} missing ask reason keeps an explicit reason diagnostic`, async () => {
    add('bad-ask', () => ({ result: 'ask' }))
    const output = await run(
      deps(raw({ tool_name: adapter.id === 'codex' ? 'exec_command' : 'Bash' })),
      adapter,
    )
    expect(output.json.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(output.json.hookSpecificOutput.permissionDecisionReason).toContain(
      'ask reason must be a string',
    )
    if (adapter.id === 'codex')
      expect(output.json.hookSpecificOutput.permissionDecisionReason).toContain(
        'capability "reason"',
      )
    expect(questions).toEqual([])
  })
  test.each(['', ' \t\n ', 'x'.repeat(513), `${'\u{1f642}'.repeat(256)}x`, 42, null])(
    `${adapter.id} malformed ask question %j fails closed before prompting or later hooks`,
    async (question) => {
      let later = 0
      add('bad-question', () => ({
        result: 'ask',
        question,
        reason: 'This operation needs review.',
      }))
      add('later', () => {
        later++
        return { result: 'allow' }
      })
      const output = await run(
        deps(raw({ tool_name: adapter.id === 'codex' ? 'exec_command' : 'Bash' })),
        adapter,
      )
      expect(output.json.hookSpecificOutput.permissionDecision).toBe('deny')
      expect(output.json.hookSpecificOutput.permissionDecisionReason).toContain('question')
      expect(questions).toEqual([])
      expect(later).toBe(0)
    },
  )
}

for (const event of ['PreToolUse', 'Stop']) {
  for (const paired of [false, true]) {
    test(`graceful lifecycle ownership event=${event} paired=${paired}`, async () => {
      if (!paired) {
        delete process.env.CLOOKS_APPROVAL_OWNER
        delete process.env.CLOOKS_APPROVAL_PROTOCOL
      }
      const active: boolean[] = []
      const dependencies = deps(raw({ hook_event_name: event }))
      dependencies.onApprovalLifecycle = (value) => active.push(value)
      interaction.close = async () => {
        expect(active.at(-1)).toBe(true)
        journal.push('close')
      }
      await run(dependencies)
      expect(active).toEqual(paired && event === 'PreToolUse' ? [true, false] : [false])
      expect(journal.includes('close')).toBe(paired && event === 'PreToolUse')
    })
  }
}

for (const failure of [false, true]) {
  test(`pending output flush is awaited after interaction closure, failure=${failure}`, async () => {
    const originalLength = Object.getOwnPropertyDescriptor(process.stdout, 'writableLength')
    Object.defineProperty(process.stdout, 'writableLength', { configurable: true, get: () => 1 })
    const flushing = gate()
    let complete!: (error?: Error | null) => void
    let settled = false
    const error = new Error('output stream failed')
    const pending = run(deps(), codexAdapter, (callback) => {
      complete = callback
      flushing.release()
    })
      .then(
        (output) => ({ output }),
        (error: unknown) => ({ error }),
      )
      .finally(() => {
        settled = true
      })
    try {
      await flushing.promise
      await new Promise((resolve) => setImmediate(resolve))
      expect(journal.filter((entry) => entry === 'close')).toHaveLength(1)
      expect(journal).not.toContain('exit')
      expect(settled).toBe(false)
      complete(failure ? error : undefined)
      const result = await pending
      if (failure) {
        expect(result).toEqual({ error })
        expect(journal).not.toContain('exit')
      } else {
        expect('output' in result && result.output.code).toBe(0)
        expect(journal).toContain('exit')
      }
    } finally {
      complete?.()
      await pending
      if (originalLength) Object.defineProperty(process.stdout, 'writableLength', originalLength)
      else Reflect.deleteProperty(process.stdout, 'writableLength')
    }
  })
}

for (const adapter of [codexAdapter, claudeCodeAdapter]) {
  test(`${adapter.id}: five hooks execute once around two live checkpoints`, async () => {
    for (let i = 1; i <= 5; i++)
      add(String(i), () => {
        journal.push(`hook:${i}`)
        return i === 2 || i === 4
          ? { result: 'ask', reason: `confirm ${i}`, injectContext: `context ${i}` }
          : { result: 'allow' }
      })
    const output = await run(deps(), adapter)
    expect(journal.filter((v) => /^(hook|ask):/.test(v))).toEqual([
      'hook:1',
      'hook:2',
      'ask:2',
      'hook:3',
      'hook:4',
      'ask:4',
      'hook:5',
    ])
    expect(output.json.hookSpecificOutput.additionalContext).toBe('context 2\ncontext 4')
    expect(journal.indexOf('close')).toBeLessThan(journal.indexOf('output'))
  })
  test(`${adapter.id}: decline is terminal and not a crashing hook`, async () => {
    let later = 0
    config.global.onError = 'continue'
    config.global.maxFailures = 1
    add('ask', () => ({ result: 'ask', reason: 'confirm' }))
    add('later', () => {
      later++
      return { result: 'allow' }
    })
    interaction.request = async () => ({ kind: 'declined', message: 'No' })
    const output = await run(deps(), adapter)
    expect(output.stdout + output.stderr).toContain('declined')
    expect(output.json.hookSpecificOutput?.permissionDecision).toBe('deny')
    expect(later).toBe(0)
    expect(journal.filter((v) => v === 'close')).toHaveLength(1)
  })
  test(`${adapter.id}: changed operation reconfirms affected asks in configured order`, async () => {
    add('a', () => ({
      result: 'ask',
      question: '  Approve A?\nExactly as shown.  ',
      reason: 'A',
      updatedInput: { command: 'middle' },
    }))
    add('b', () => ({ result: 'ask', reason: 'B' }))
    add('rewrite', () => ({ result: 'allow', updatedInput: { command: 'final' } }))
    const output = await run(deps(), adapter)
    expect(questions.map((q) => [q.hookName, q.ordinal, q.question, q.operation.input])).toEqual([
      ['a', 1, '  Approve A?\nExactly as shown.  ', { command: 'middle' }],
      ['b', 2, undefined, { command: 'middle' }],
      ['a', 3, '  Approve A?\nExactly as shown.  ', { command: 'final' }],
      ['b', 4, undefined, { command: 'final' }],
    ])
    expect(output.json.hookSpecificOutput.updatedInput).toEqual({ command: 'final' })
    expect(output.stdout).not.toContain('Approve A?')
  })
  test(`${adapter.id}: unpaired ask denies without opening storage`, async () => {
    delete process.env.CLOOKS_APPROVAL_OWNER
    delete process.env.CLOOKS_APPROVAL_PROTOCOL
    add('ask', () => ({ result: 'ask', reason: 'confirm' }))
    const output = await run(deps(), adapter)
    expect(output.stdout + output.stderr).toContain('Live approval unavailable')
    expect(output.json.hookSpecificOutput?.permissionDecision).toBe('deny')
    expect(journal).not.toContain('open')
  })
}
test('Claude unchanged raw input differs from normalized context without a fabricated rewrite', async () => {
  const input = { snake_key: { nested_key: null }, file_path: 'file' }
  add('ask', (ctx) => {
    expect(ctx.toolInput).toEqual({ snakeKey: { nestedKey: null }, filePath: 'file' })
    return { result: 'ask', reason: 'inspect' }
  })
  const output = await run(
    deps(raw({ tool_name: 'mcp__inspect', tool_input: input })),
    claudeCodeAdapter,
  )
  expect(questions[0]!.operation.input).toEqual(input)
  expect(output.json.hookSpecificOutput.updatedInput).toBeUndefined()
})
test('Claude mixed defer reconfirms original native input, retaining defer', async () => {
  add('ask', () => ({ result: 'ask', reason: 'confirm', updatedInput: { command: 'changed' } }))
  add('defer', () => ({ result: 'defer' }))
  const output = await run(deps(), claudeCodeAdapter)
  expect(questions.map((q) => q.operation.input)).toEqual([
    { command: 'changed' },
    { command: 'original' },
  ])
  expect(output.json.hookSpecificOutput).toEqual({
    hookEventName: 'PreToolUse',
    permissionDecision: 'defer',
  })
})
for (const stage of ['adjust', 'serialize'] as const) {
  test(`final ${stage} divergence requires confirmation of actual wire operation`, async () => {
    add('ask', () => ({ result: 'ask', reason: 'confirm' }))
    const adapter: AgentAdapter = { ...codexAdapter }
    if (stage === 'adjust')
      adapter.adjustResultBeforeFinalOutput = ({ result }) => ({
        result: { ...result!, updatedInput: { command: 'actual' } },
        systemMessages: [],
      })
    else
      adapter.translateFinalOutput = (input) =>
        codexAdapter.translateFinalOutput({
          ...input,
          result: { ...input.result!, updatedInput: { command: 'actual' } },
        })
    const output = await run(deps(), adapter)
    expect(questions.map((q) => q.operation.input)).toEqual([
      { command: 'original' },
      { command: 'actual' },
    ])
    expect(output.json.hookSpecificOutput.updatedInput).toEqual({ command: 'actual' })
  })
}
for (const adapter of [claudeCodeAdapter, codexAdapter]) {
  for (const failure of ['declined', 'throw'] as const) {
    test(`${adapter.id}: final reconfirmation ${failure} denies after cleanup, never fatally exits`, async () => {
      let askExecutions = 0
      let rewriteExecutions = 0
      add('ask', () => {
        askExecutions++
        return { result: 'ask', reason: 'original consent' }
      })
      add('rewrite', () => {
        rewriteExecutions++
        return { result: 'allow', updatedInput: { command: 'changed after consent' } }
      })
      interaction.request = async (question) => {
        questions.push(structuredClone(question))
        journal.push(`ask:${question.ordinal}`)
        if (question.ordinal === 1) return { kind: 'approved' }
        if (failure === 'throw') throw new Error('reconfirmation transport failed')
        return { kind: 'declined', message: 'rewrite not authorized' }
      }
      const output = await run(deps(), adapter)
      expect(
        questions.map((question) => [question.ordinal, question.reason, question.operation.input]),
      ).toEqual([
        [1, 'original consent', { command: 'original' }],
        [2, 'original consent', { command: 'changed after consent' }],
      ])
      expect(askExecutions).toBe(1)
      expect(rewriteExecutions).toBe(1)
      expect(output.code).toBe(0)
      expect(output.stderr).not.toContain('fatal error')
      expect(output.json.hookSpecificOutput.permissionDecision).toBe('deny')
      expect(output.json.hookSpecificOutput.permissionDecisionReason).toContain(
        failure === 'throw' ? 'reconfirmation transport failed' : 'rewrite not authorized',
      )
      expect(output.json.hookSpecificOutput.updatedInput).toBeUndefined()
      expect(journal.filter((entry) => entry === 'close')).toHaveLength(1)
      expect(journal.indexOf('ask:2')).toBeLessThan(journal.indexOf('close'))
      expect(journal.indexOf('close')).toBeLessThan(journal.indexOf('output'))
    })
  }
}
for (const path of [
  'no-config',
  'empty',
  'no-match',
  'suppressed',
  'config-error',
  'import-error',
] as const) {
  test(`paired ${path} closes exactly once`, async () => {
    const dependencies = deps()
    if (path === 'no-config') dependencies.loadConfig = async () => null
    if (path === 'no-match') {
      add('other', () => undefined)
      hooks[0]!.hook = { meta: { name: hn('other') } } as LoadedHook['hook']
    }
    if (path === 'suppressed') process.env.CLOOKS_APPROVAL_DISPOSITION = 'suppressed'
    if (path === 'config-error')
      dependencies.loadConfig = async () => {
        throw new Error('bad config')
      }
    if (path === 'import-error')
      dependencies.loadAllHooks = async () => {
        throw new Error('bad import')
      }
    await run(dependencies)
    expect(journal.filter((v) => v === 'close')).toHaveLength(1)
    if (path === 'suppressed') expect(journal).not.toContain('discover')
  })
}
test('transport setup failure denies asks but no-ask completion remains available', async () => {
  const dependencies = deps()
  dependencies.createApprovalInteraction = async () => {
    throw new Error('disk unavailable')
  }
  expect((await run(dependencies)).code).toBe(0)
  add('ask', () => ({ result: 'ask', reason: 'confirm' }))
  const output = await run(dependencies)
  expect(output.stdout).toContain('disk unavailable')
  expect(output.json.hookSpecificOutput.permissionDecision).toBe('deny')
  expect(output.stdout).toContain('clooks init --agent codex')
})
test('suppression stays authoritative when transport setup fails', async () => {
  process.env.CLOOKS_APPROVAL_DISPOSITION = 'suppressed'
  const dependencies = deps()
  dependencies.createApprovalInteraction = async () => {
    throw new Error('cannot publish')
  }
  const output = await run(dependencies)
  expect(journal).not.toContain('discover')
  expect(journal).not.toContain('load')
  expect(output.json.hookSpecificOutput.permissionDecision).toBe('deny')
})
test('suppressed disposition alone refuses before discovery or hooks', async () => {
  process.env.CLOOKS_APPROVAL_DISPOSITION = 'suppressed'
  delete process.env.CLOOKS_APPROVAL_OWNER
  delete process.env.CLOOKS_APPROVAL_PROTOCOL
  let executed = 0
  add('guard', () => {
    executed++
    return { result: 'allow' }
  })
  const output = await run()
  expect(executed).toBe(0)
  expect(journal).not.toContain('discover')
  expect(journal).not.toContain('load')
  expect(journal).not.toContain('open')
  expect(output.json.hookSpecificOutput.permissionDecision).toBe('deny')
})
for (const lateRejects of [false, true]) {
  test(`parallel cancellation drains held sibling before cleanup, rejects=${lateRejects}`, async () => {
    const controller = new AbortController()
    const started = gate()
    const releaseA = gate()
    const releaseB = gate()
    let starts = 0
    let later = 0
    let settled = false
    let siblingSettled = false
    add('a', async () => {
      if (++starts === 2) started.release()
      await releaseA.promise
      return { result: 'ask', reason: 'A' }
    })
    add('b', async () => {
      if (++starts === 2) started.release()
      await releaseB.promise
      siblingSettled = true
      if (lateRejects) throw new Error('late sibling rejection')
      return { result: 'ask', reason: 'B' }
    })
    add('later', () => {
      later++
      return { result: 'allow' }
    })
    config.hooks[hn('a')]!.parallel = true
    config.hooks[hn('b')]!.parallel = true
    const dependencies = deps()
    dependencies.signal = controller.signal
    const pending = run(dependencies, { ...codexAdapter, resolveTurnPolicy: () => null }).finally(
      () => {
        settled = true
      },
    )
    try {
      await started.promise
      controller.abort()
      releaseA.release()
      await new Promise((resolve) => setImmediate(resolve))
      expect(settled).toBe(false)
      expect(siblingSettled).toBe(false)
      expect(journal).not.toContain('close')
      expect(journal).not.toContain('output')
      expect(questions).toEqual([])
      releaseB.release()
      const output = await pending
      expect(siblingSettled).toBe(true)
      expect(later).toBe(0)
      expect(output.json.hookSpecificOutput.permissionDecision).toBe('deny')
      expect(journal.filter((entry) => entry === 'close')).toHaveLength(1)
      const snapshot = [...journal]
      await new Promise((resolve) => setImmediate(resolve))
      expect(journal).toEqual(snapshot)
    } finally {
      releaseA.release()
      releaseB.release()
      await pending
    }
  })
}
test('parallel cancellation drain is bounded by the existing hook timeout', async () => {
  const controller = new AbortController()
  const started = gate()
  const releaseA = gate()
  const releaseB = gate()
  let starts = 0
  let later = 0
  let settled = false
  add('a', async () => {
    if (++starts === 2) started.release()
    await releaseA.promise
    return { result: 'ask', reason: 'A' }
  })
  add('b', async () => {
    if (++starts === 2) started.release()
    await releaseB.promise
    return { result: 'ask', reason: 'late B' }
  })
  add('later', () => {
    later++
    return { result: 'allow' }
  })
  config.hooks[hn('a')]!.parallel = true
  config.hooks[hn('b')]!.parallel = true
  config.global.timeout = ms(200)
  const dependencies = deps()
  dependencies.signal = controller.signal
  const pending = run(dependencies, { ...codexAdapter, resolveTurnPolicy: () => null }).finally(
    () => {
      settled = true
    },
  )
  try {
    await started.promise
    controller.abort()
    releaseA.release()
    await new Promise((resolve) => setImmediate(resolve))
    expect(settled).toBe(false)
    expect(journal).not.toContain('close')
    const output = await pending
    expect(output.json.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(later).toBe(0)
    expect(questions).toEqual([])
    const snapshot = [...journal]
    releaseB.release()
    await new Promise((resolve) => setImmediate(resolve))
    expect(journal).toEqual(snapshot)
  } finally {
    releaseA.release()
    releaseB.release()
    await pending
  }
})
test('close failure is awaited and cannot emit permissive bytes', async () => {
  const entered = gate()
  const finish = gate()
  add('ask', () => ({ result: 'ask', reason: 'confirm' }))
  interaction.close = async () => {
    entered.release()
    await finish.promise
    throw new Error('publication failed')
  }
  const pending = run()
  await entered.promise
  expect(journal).not.toContain('output')
  finish.release()
  const output = await pending
  expect(output.json.hookSpecificOutput.permissionDecision).toBe('deny')
  expect(output.stdout).toContain('publication failed')
})
for (const phase of ['pre-aborted', 'config', 'import', 'handler', 'ask'] as const) {
  test(`cancellation at ${phase} drains orchestration before return`, async () => {
    const controller = new AbortController()
    const entered = gate()
    const finish = gate()
    const dependencies = deps()
    dependencies.signal = controller.signal
    add('a', async () => {
      journal.push('hook:a')
      if (phase === 'handler') {
        entered.release()
        await finish.promise
      }
      return { result: 'ask', reason: 'confirm' }
    })
    add('b', () => {
      journal.push('hook:b')
      return { result: 'allow' }
    })
    if (phase === 'config')
      dependencies.loadConfig = async () => {
        entered.release()
        await finish.promise
        return { config, shadows: [], hasProjectConfig: true }
      }
    if (phase === 'import')
      dependencies.loadAllHooks = async () => {
        entered.release()
        await finish.promise
        return { loaded: hooks, loadErrors: [], dangling: [] }
      }
    if (phase === 'ask')
      interaction.request = async () => {
        entered.release()
        await finish.promise
        return { kind: 'approved' }
      }
    if (phase === 'pre-aborted') controller.abort()
    let settled = false
    const pending = run(dependencies).finally(() => {
      settled = true
    })
    if (phase !== 'pre-aborted') {
      await entered.promise
      controller.abort()
      await new Promise((resolve) => setImmediate(resolve))
      expect(settled).toBe(false)
      expect(journal).not.toContain('close')
      expect(journal).not.toContain('output')
      finish.release()
    }
    const output = await pending
    if (phase !== 'pre-aborted') {
      expect(output.json.hookSpecificOutput.permissionDecision).toBe('deny')
      expect(journal.filter((v) => v === 'close')).toHaveLength(1)
    }
    expect(journal).not.toContain('hook:b')
    if (phase === 'pre-aborted') {
      expect(journal).not.toContain('read')
      expect(journal).not.toContain('discover')
    }
    const snapshot = [...journal]
    await new Promise((resolve) => setImmediate(resolve))
    expect(journal).toEqual(snapshot)
  })
}
test('old token storage is inert and shell carriers remain literal input', async () => {
  const directory = join(root, '.clooks/approvals')
  mkdirSync(directory, { recursive: true })
  const path = join(directory, 'codex.sqlite')
  writeFileSync(path, 'old data')
  const command = 'CLOOKS_APPROVAL_TOKENS=ca1_deadbeef echo literal'
  add('ask', (ctx) => {
    expect(ctx.toolInput).toEqual({ command })
    return { result: 'ask', reason: 'confirm' }
  })
  const output = await run(deps(raw({ tool_input: { command } })))
  expect(output.code).toBe(0)
  expect(output.json.hookSpecificOutput?.permissionDecision).toBeUndefined()
  expect(questions).toHaveLength(1)
  expect(questions[0]!.operation.input).toEqual({ command })
  expect(readFileSync(path, 'utf8')).toBe('old data')
})
test('real channel publication failure drains queued acceptance before run emits denial', async () => {
  const controller = new AbortController()
  const paused = gate()
  const resume = gate()
  const dependencies = deps()
  dependencies.signal = controller.signal
  let box: Mailbox
  let settled = false
  let requestSettled = false
  let later = 0
  add('ask', () => ({ result: 'ask', reason: 'confirm' }))
  add('later', () => {
    later++
    return { result: 'allow' }
  })
  dependencies.createApprovalInteraction = async (options) => {
    const channel = await createApprovalInteraction(options, {
      home: root,
      pause: async () => {
        paused.release()
        await resume.promise
      },
    })
    box = new Mailbox(approvalRoot(root), options.identity)
    const start = box.bound('start', startSchema)!
    const peer = box.claim('check', Date.now())
    box.publish('attached', {
      version: 1,
      key: options.identity,
      nonce: start.nonce,
      checkId: peer.id,
    })
    return {
      async request(question, signal) {
        try {
          return await channel.request(question, signal)
        } finally {
          requestSettled = true
        }
      },
      async close() {
        await channel.close()
      },
    }
  }
  const originalPublish = Mailbox.prototype.publish
  const publish = spyOn(Mailbox.prototype, 'publish').mockImplementation(function (
    this: Mailbox,
    name,
    packet,
  ) {
    if (name === 'done') throw new Error('done publication fault')
    originalPublish.call(this, name, packet)
  })
  const pending = run(dependencies).finally(() => {
    settled = true
  })
  try {
    await paused.promise
    const packet = box!.bound('question-1', questionPacketSchema)!
    const attached = box!.bound('attached', attachedSchema)!
    box!.publish('reply-1', {
      version: 1,
      key: packet.key,
      nonce: packet.nonce,
      checkId: attached.checkId,
      ordinal: 1,
      digest: digest(packet.question),
      confirmed: true,
    })
    controller.abort()
    await new Promise((resolve) => setImmediate(resolve))
    expect(settled).toBe(false)
    expect(requestSettled).toBe(false)
    expect(journal).not.toContain('output')
    resume.release()
    const output = await pending
    expect(requestSettled).toBe(true)
    expect(later).toBe(0)
    expect(output.json.hookSpecificOutput.permissionDecision).toBe('deny')
  } finally {
    resume.release()
    await pending
    publish.mockRestore()
  }
})
