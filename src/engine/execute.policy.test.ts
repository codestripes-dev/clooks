import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { createHash } from 'crypto'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { executeHooks } from './execute.js'
import { legacyResultPolicy } from './result-policy.js'
import { claudeCodeAdapter } from '../agents/claude-code/adapter.js'
import { codexAdapter } from '../agents/codex/adapter.js'
import type { InvocationResultPolicy, ResultPolicyInput } from '../agents/types.js'
import type { EngineResult } from './types.js'
import type { ClooksConfig, ErrorMode } from '../config/schema.js'
import type { LoadedHook } from '../loader.js'
import type { EventName } from '../types/branded.js'
import type { TurnTracker } from './turn-state.js'
import { emptyTurn } from './turn-state.js'
import { hn, ms } from '../test-utils.js'
import { readFailures } from '../failures.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function root() {
  const dir = mkdtempSync(join(tmpdir(), 'clooks-policy-'))
  mkdirSync(join(dir, '.clooks'))
  roots.push(dir)
  return dir
}

function expectHandoff(dir: string, name: string, text: string): string {
  const digest = createHash('sha256').update(text).digest('hex').slice(0, 12)
  const path = join(dir, '.clooks/tmp', `handoff-${name}-${digest}.md`)
  expect(readFileSync(path, 'utf8')).toBe(text)
  return `[clooks] Hook "${name}": read ${path} and follow its instructions.`
}

function hook(name: string, handlers: Record<string, unknown>): LoadedHook {
  return {
    name: hn(name),
    hook: { meta: { name: hn(name) }, ...handlers } as LoadedHook['hook'],
    config: {},
    hookPath: `/test/${name}.ts`,
    configPath: '/test/clooks.yml',
  }
}

function config(names: string[], parallel = false, onError: ErrorMode = 'block'): ClooksConfig {
  return {
    version: '1.0.0',
    global: {
      timeout: ms(1000),
      onError,
      maxFailures: 1,
      maxFailuresMessage: 'degraded {hook}',
      handoff: false,
    },
    hooks: Object.fromEntries(
      names.map((name) => [
        hn(name),
        { resolvedPath: `/test/${name}.ts`, config: {}, origin: 'project' as const, parallel },
      ]),
    ),
    events: {},
  }
}

function tracker() {
  const records: { name: string; decision: string }[] = []
  let commits = 0
  const value: TurnTracker = {
    materialize: () => emptyTurn(),
    record: (name, _event, decision) => {
      records.push({ name, decision })
    },
    commit: async () => {
      commits++
    },
  }
  return { value, records, commits: () => commits }
}

function gate() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

const drain = () => new Promise<void>((resolve) => setImmediate(resolve))

async function bounded(promise: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('parallel hooks did not start')), 2000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

function rejecting(
  eventName: EventName,
  calls: ResultPolicyInput[],
  predicate: (input: ResultPolicyInput) => boolean,
): InvocationResultPolicy {
  return {
    checkResult(input) {
      calls.push(input)
      if (predicate(input))
        return {
          kind: 'rejected',
          failure: {
            eventName,
            hookName: input.hookName,
            capability: 'test-capability',
            message: `rejected ${input.hookName}`,
          },
        }
      return legacyResultPolicy.checkResult(input)
    },
  }
}

function run(
  hooks: LoadedHook[],
  event: EventName,
  cfg: ClooksConfig,
  policy?: InvocationResultPolicy,
  history = tracker(),
  dir = root(),
  input: Record<string, unknown> = {},
) {
  return executeHooks(
    hooks,
    event,
    { event, toolName: 'test', toolInput: {}, ...input },
    cfg,
    join(dir, '.clooks/.failures'),
    dir,
    [],
    undefined,
    history.value,
    policy,
    { request: async () => ({ kind: 'approved' }), close: async () => {} },
  )
}

describe('Codex shared handoff delivery', () => {
  function policy(event: EventName, dir: string) {
    const invocation = codexAdapter.normalizeInvocation(
      {
        hook_event_name: event,
        session_id: 'session',
        turn_id: 'turn',
        cwd: dir,
        model: 'model',
        permission_mode: 'default',
        transcript_path: null,
        tool_name: 'Bash',
        tool_use_id: 'call',
        tool_input: { command: 'echo original' },
        tool_response: 'done',
        prompt: 'prompt',
        source: 'startup',
        agent_id: 'child',
        agent_type: 'worker',
        agent_transcript_path: null,
        stop_hook_active: false,
        last_assistant_message: null,
      },
      event,
    )
    return codexAdapter.createResultPolicy(invocation)
  }

  for (const event of [
    'PreToolUse',
    'PostToolUse',
    'UserPromptSubmit',
    'SessionStart',
    'SubagentStart',
  ] as const) {
    test(`${event} hands off model context without changing the raw result or decision`, async () => {
      const dir = root()
      const cfg = config(['note'])
      cfg.global.handoff = true
      const raw: EngineResult = { result: 'skip', injectContext: 'model context\n'.repeat(100) }
      const original = structuredClone(raw)
      const history = tracker()
      const stderr = spyOn(process.stderr, 'write').mockImplementation(() => true)
      try {
        const result = await run(
          [hook('note', { [event]: () => raw })],
          event,
          cfg,
          policy(event, dir),
          history,
          dir,
        )
        expect(result.policyFailure).toBeUndefined()
        expect(result.lastResult?.injectContext).toBe(
          expectHandoff(dir, 'note', raw.injectContext!),
        )
        cfg.global.handoff = false
        const inline = await run(
          [hook('note', { [event]: () => raw })],
          event,
          cfg,
          policy(event, dir),
          tracker(),
          dir,
        )
        expect(result.lastResult?.result).toBe(inline.lastResult?.result)
        expect(result.systemMessages).toEqual([])
        expect(stderr).not.toHaveBeenCalled()
        expect(raw).toEqual(original)
        expect(history.records).toEqual([{ name: 'note', decision: 'skip' }])
        expect(history.commits()).toBe(1)
      } finally {
        stderr.mockRestore()
      }
    })
  }

  for (const event of ['PreToolUse', 'PostToolUse', 'Stop', 'SubagentStop'] as const) {
    test(`${event} hands off block reasons and rejects new content before writing`, async () => {
      const dir = root()
      const cfg = config(['note'])
      cfg.global.handoff = true
      const raw: EngineResult = { result: 'block', reason: 'continue work\n'.repeat(100) }
      const history = tracker()
      const result = await run(
        [hook('note', { [event]: () => raw })],
        event,
        cfg,
        policy(event, dir),
        history,
        dir,
      )
      const pointer = expectHandoff(dir, 'note', raw.reason!)
      expect(result.lastResult).toEqual({ result: 'block', reason: pointer })
      expect(result.systemMessages).toEqual([])
      expect(result.policyFailure).toBeUndefined()
      expect(history.records).toEqual([{ name: 'note', decision: 'block' }])
      const files = readdirSync(join(dir, '.clooks/tmp')).sort()
      const rejected = await run(
        [
          hook('note', {
            [event]: () => ({ ...raw, reason: 'NEW rejected content', continue: false }),
          }),
        ],
        event,
        cfg,
        policy(event, dir),
        history,
        dir,
      )
      expect(rejected.policyFailure?.capability).toBe('continue')
      expect(rejected.lastResult).toBeUndefined()
      expect(readdirSync(join(dir, '.clooks/tmp')).sort()).toEqual(files)
      expect(expectHandoff(dir, 'note', raw.reason!)).toBe(pointer)
      expect(history.records).toEqual([
        { name: 'note', decision: 'block' },
        { name: 'note', decision: 'block' },
      ])
    })
  }

  for (const setting of [false, 10, true] as const) {
    test(`handoff=${setting} preserves inline fallback and measures the exact threshold`, async () => {
      const dir = root()
      const cfg = config(['note'])
      cfg.global.handoff = setting
      if (setting === true) writeFileSync(join(dir, '.clooks/tmp'), 'not a directory')
      const stderr = spyOn(process.stderr, 'write').mockImplementation(() => true)
      try {
        for (const text of ['123456789', '1234567890', '12345678901']) {
          const reason = text + '!'
          const raw = { result: 'block', reason, injectContext: text }
          const result = await run(
            [hook('note', { PreToolUse: () => raw })],
            'PreToolUse',
            cfg,
            policy('PreToolUse', dir),
            tracker(),
            dir,
          )
          expect(result.lastResult?.injectContext).toBe(
            setting === 10 && text.length > 10 ? expectHandoff(dir, 'note', text) : text,
          )
          expect(result.lastResult?.reason).toBe(
            setting === 10 && reason.length > 10 ? expectHandoff(dir, 'note', reason) : reason,
          )
          expect(result.lastResult?.result).toBe('block')
          expect(raw).toEqual({ result: 'block', reason, injectContext: text })
          expect(result.systemMessages).toEqual([])
          expect(result.policyFailure).toBeUndefined()
        }
        if (setting === true) {
          expect(stderr).toHaveBeenCalledTimes(6)
          for (const [message] of stderr.mock.calls)
            expect(String(message)).toContain('delivering inline')
          expect(readFileSync(join(dir, '.clooks/tmp'), 'utf8')).toBe('not a directory')
        } else {
          expect(stderr).not.toHaveBeenCalled()
          if (setting === false) expect(existsSync(join(dir, '.clooks/tmp'))).toBe(false)
        }
      } finally {
        stderr.mockRestore()
      }
    })
  }

  for (const [event, tag] of [
    ['UserPromptSubmit', 'block'],
    ['PreToolUse', 'allow'],
    ['PreToolUse', 'ask'],
  ] as const) {
    test(`${event} ${tag} keeps human reasons and debug messages inline`, async () => {
      const dir = root()
      const cfg = config(['note'])
      cfg.global.handoff = true
      const reason = 'human reason\n'.repeat(100)
      const debugMessage = 'human debug\n'.repeat(100)
      const raw = { result: tag, reason, debugMessage }
      const result = await run(
        [hook('note', { [event]: () => raw })],
        event,
        cfg,
        policy(event, dir),
        tracker(),
        dir,
      )
      expect(result.policyFailure).toBeUndefined()
      expect(result.lastResult?.result).toBe(tag === 'ask' ? 'allow' : tag)
      expect(result.lastResult?.debugMessage).toBe(debugMessage)
      if (tag === 'allow') {
        expect(result.lastResult?.reason).toBeUndefined()
        expect(result.systemMessages).toHaveLength(1)
        expect(result.systemMessages[0]).toContain(reason)
      } else expect(result.lastResult?.reason).toBe(reason)
      expect(existsSync(join(dir, '.clooks/tmp'))).toBe(false)
      expect(raw).toEqual({ result: tag, reason, debugMessage })
    })
  }
})

describe('result policy before effects', () => {
  test.each([
    ['ask', 'vote'],
    ['ask', 'allow'],
    ['defer', 'vote'],
    ['defer', 'allow'],
  ] as const)(
    'parallel %s votes survive reduction when %s settles first',
    async (decision, first) => {
      const seen: string[] = []
      const started = gate()
      const releases = { vote: gate(), allow: gate() }
      const firstRecorded = gate()
      const begin = (name: string) => {
        seen.push(name)
        if (seen.length === 2) started.release()
      }
      const hooks = [
        hook('vote', {
          async PreToolUse() {
            begin('vote')
            await releases.vote.promise
            return decision === 'ask'
              ? { result: decision, reason: 'Confirm operation' }
              : { result: decision }
          },
        }),
        hook('allow', {
          async PreToolUse() {
            begin('allow')
            await releases.allow.promise
            return { result: 'allow', injectContext: 'Sibling context' }
          },
        }),
      ]
      const history = tracker()
      const record = history.value.record
      history.value.record = (name, event, recordedDecision) => {
        record(name, event, recordedDecision)
        if (name === first) firstRecorded.release()
      }
      const pending = run(
        hooks,
        'PreToolUse' as EventName,
        config(['vote', 'allow'], true),
        undefined,
        history,
      )
      let result: Awaited<typeof pending>
      try {
        await bounded(started.promise)
        releases[first].release()
        await bounded(firstRecorded.promise)
        // Hold the sibling until the first result reaches history, not merely its handler return.
        expect(history.records).toEqual([
          { name: first, decision: first === 'vote' ? decision : 'allow' },
        ])
        releases[first === 'vote' ? 'allow' : 'vote'].release()
        result = await pending
      } finally {
        releases.vote.release()
        releases.allow.release()
        await pending
      }
      expect(seen.sort()).toEqual(['allow', 'vote'])
      expect(result.lastResult).toEqual(
        decision === 'ask'
          ? { result: 'allow', injectContext: 'Sibling context' }
          : { result: 'defer' },
      )
      expect([...history.records].sort((a, b) => a.name.localeCompare(b.name))).toEqual([
        { name: 'allow', decision: 'allow' },
        { name: 'vote', decision },
      ])
      expect(history.commits()).toBe(1)
      expect(result.policyFailure).toBeUndefined()
      const contextWarning =
        'clooks: defer wins but one or more PreToolUse hooks returned additionalContext / injectContext — upstream Claude Code ignores additionalContext for defer; dropping.'
      const updatedInputWarning =
        'clooks: defer wins but one or more PreToolUse hooks returned updatedInput — upstream Claude Code ignores updatedInput for defer; dropping.'
      if (decision === 'defer') expect(result.systemMessages).toEqual([contextWarning])
      else expect(result.systemMessages).toEqual([])
      expect(result.systemMessages).not.toContain(updatedInputWarning)
    },
  )

  test.each(['sparse', 'extra-property'] as const)(
    'parallel Codex capture rejects a %s MCP rewrite before clone or late effects',
    async (shape) => {
      const dir = root()
      const invocation = codexAdapter.normalizeInvocation(
        {
          hook_event_name: 'PreToolUse',
          session_id: 'session',
          turn_id: 'turn',
          cwd: dir,
          model: 'model',
          permission_mode: 'default',
          transcript_path: null,
          tool_name: 'mcp__server__tool',
          tool_use_id: 'call',
          tool_input: { keep_key: null },
        },
        'PreToolUse',
      )
      const started = gate()
      const releaseLate = gate()
      let starts = 0
      const begin = () => {
        if (++starts === 2) started.release()
      }
      const malformed = shape === 'sparse' ? new Array(2) : Object.assign([1], { opaque_key: true })
      if (shape === 'sparse') malformed[1] = 1
      const history = tracker()
      const hooks = [
        hook('invalid', {
          PreToolUse: async () => {
            begin()
            await started.promise
            return {
              result: 'allow',
              updatedInput: { nested_key: malformed },
              injectContext: 'refused context',
            }
          },
        }),
        hook('late', {
          PreToolUse: async () => {
            begin()
            await releaseLate.promise
            return { result: 'block', reason: 'late denial', injectContext: 'late context' }
          },
        }),
      ]
      const cfg = config(['invalid', 'late'], true)
      cfg.global.handoff = true
      const pending = run(
        hooks,
        'PreToolUse',
        cfg,
        codexAdapter.createResultPolicy(invocation),
        history,
        dir,
        invocation.context,
      )
      try {
        await bounded(started.promise)
        await bounded(pending.then(() => {}))
        const result = await pending
        expect(result.policyFailure).toMatchObject({
          capability: 'result-shape',
          hookName: 'invalid',
        })
        expect(result.lastResult).toBeUndefined()
        expect(result.systemMessages).toEqual([])
        expect(history.records).toEqual([
          { name: 'invalid', decision: 'allow' },
          { name: 'late', decision: 'error' },
        ])
        expect(history.commits()).toBe(1)
        expect(readdirSync(join(dir, '.clooks'))).toEqual([])
        const snapshot = JSON.stringify({ result, records: history.records })
        releaseLate.release()
        await drain()
        await drain()
        expect(JSON.stringify({ result, records: history.records })).toBe(snapshot)
        expect(history.commits()).toBe(1)
        expect(readdirSync(join(dir, '.clooks'))).toEqual([])
        expect(invocation.context.toolInput).toEqual({ keep_key: null })
      } finally {
        started.release()
        releaseLate.release()
        await bounded(
          pending.then(
            () => {},
            () => {},
          ),
        )
        await drain()
      }
    },
  )

  test.each(['dense', 'sparse', 'extra-property', 'accessor'] as const)(
    'real Codex policy audits %s MCP rewrites before input and handoff effects',
    async (shape) => {
      const dir = root()
      const original = JSON.parse(
        '{"__proto__":{"original_key":null},"constructor":{"kept_key":false},"keep_null":null,"keep_value":1,"delete_value":2}',
      ) as Record<string, unknown>
      const invocation = codexAdapter.normalizeInvocation(
        {
          hook_event_name: 'PreToolUse',
          session_id: 'session',
          turn_id: 'native-turn',
          cwd: dir,
          model: 'model',
          permission_mode: 'default',
          transcript_path: null,
          tool_name: 'mcp__server__tool',
          tool_use_id: 'call',
          tool_input: original,
        },
        'PreToolUse',
      )
      const dense: { nested_key: unknown[] }[] = [
        { nested_key: [null, false, { untouched_key: 'text' }] },
      ]
      let getterReads = 0
      let value: unknown = dense
      if (shape === 'sparse') {
        const sparse = new Array(2)
        sparse[1] = dense[0]
        value = sparse
      } else if (shape === 'extra-property') {
        value = Object.assign([...dense], { opaque_key: true })
      } else if (shape === 'accessor') {
        value = Object.defineProperty({}, 'changing_key', {
          enumerable: true,
          get() {
            getterReads++
            return getterReads === 1 ? [1] : Object.assign([1], { hidden_loss: true })
          },
        })
      }
      const patch = { added_key: value, keep_value: undefined, delete_value: null }
      const expected = JSON.parse(
        '{"__proto__":{"original_key":null},"constructor":{"kept_key":false},"keep_null":null,"keep_value":1,"added_key":[{"nested_key":[null,false,{"untouched_key":"text"}]}]}',
      )
      const calls: string[] = []
      const history = tracker()
      const hooks = [
        hook('rewrite', {
          PreToolUse: () => {
            calls.push('rewrite')
            return { result: 'allow', updatedInput: patch, injectContext: 'inline rewrite context' }
          },
        }),
        hook('observe', {
          PreToolUse: (context: Record<string, unknown>) => {
            calls.push('observe')
            expect(context.toolInput).toEqual(expected)
            expect(context.originalToolInput).toEqual(original)
            dense[0]!.nested_key.push('changed after acceptance')
            return { result: 'allow' }
          },
        }),
      ]
      const cfg = config(['rewrite', 'observe'])
      cfg.global.handoff = true
      const result = await run(
        hooks,
        'PreToolUse',
        cfg,
        codexAdapter.createResultPolicy(invocation),
        history,
        dir,
        invocation.context,
      )
      expect(getterReads).toBe(0)
      expect(history.commits()).toBe(1)
      if (shape === 'dense') {
        const pointer = expectHandoff(dir, 'rewrite', 'inline rewrite context')
        expect(calls).toEqual(['rewrite', 'observe'])
        expect(result.policyFailure).toBeUndefined()
        expect(result.lastResult?.updatedInput).toEqual(expected)
        expect(result.systemMessages).toEqual([])
        const translated = codexAdapter.translateFinalOutput({
          eventName: 'PreToolUse',
          invocation,
          result: result.lastResult,
          systemMessages: result.systemMessages,
          diagnostics: [],
        })
        expect(JSON.parse(translated.output!).hookSpecificOutput).toEqual({
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          updatedInput: expected,
          additionalContext: pointer,
        })
        expect(history.records).toEqual([
          { name: 'rewrite', decision: 'allow' },
          { name: 'observe', decision: 'allow' },
        ])
      } else {
        expect(readdirSync(join(dir, '.clooks'))).toEqual([])
        expect(calls).toEqual(['rewrite'])
        expect(result.policyFailure).toMatchObject({
          capability: 'result-shape',
          hookName: 'rewrite',
        })
        expect(result.lastResult).toBeUndefined()
        expect(result.systemMessages).toEqual([])
        expect(history.records).toEqual([{ name: 'rewrite', decision: 'allow' }])
        expect(invocation.context.toolInput).toEqual(original)
        const translated = codexAdapter.translateFailure({
          eventName: 'PreToolUse',
          invocation,
          failure: result.policyFailure!,
        })
        expect(JSON.parse(translated.output!).hookSpecificOutput.permissionDecision).toBe('deny')
        expect(translated.output).toContain('Pending call denial requested.')
      }
    },
  )

  test('omitted policy equals explicit Claude policy for patch/null merging and configured votes', async () => {
    const make = () => [
      hook('a', {
        PreToolUse: () => ({
          result: 'allow',
          updatedInput: { command: 'new', remove: null },
          injectContext: 'A',
        }),
      }),
      hook('b', {
        PreToolUse: () => ({
          result: 'ask',
          reason: 'review',
          updatedInput: { other: 2 },
          injectContext: 'B',
        }),
      }),
    ]
    const input = { toolInput: { command: 'old', remove: 1, untouchedNull: null } }
    const cfg = config(['a', 'b'])
    const invocation = claudeCodeAdapter.normalizeInvocation(
      { hook_event_name: 'PreToolUse' },
      'PreToolUse',
    )
    const omitted = await run(make(), 'PreToolUse', cfg, undefined, tracker(), root(), input)
    const explicit = await run(
      make(),
      'PreToolUse',
      cfg,
      claudeCodeAdapter.createResultPolicy(invocation),
      tracker(),
      root(),
      input,
    )
    expect(explicit).toEqual(omitted)
    expect(explicit.lastResult).toEqual({
      result: 'allow',
      reason: 'review',
      injectContext: 'A\nB',
      updatedInput: { command: 'new', other: 2 },
    })
  })

  test('validated nextToolInput is detached and never merged again as a patch', async () => {
    const candidate = { command: 'validated', untouched_null: null, nested_key: { value: 1 } }
    const raw: EngineResult = { result: 'allow', updatedInput: { command: 'raw' } }
    const seen: unknown[] = []
    const policy: InvocationResultPolicy = {
      checkResult(input) {
        if (input.hookName === 'a')
          return { kind: 'accepted', result: raw, nextToolInput: candidate, diagnostics: [] }
        return legacyResultPolicy.checkResult(input)
      },
    }
    const result = await run(
      [
        hook('a', { PreToolUse: () => raw }),
        hook('b', {
          PreToolUse: (ctx: { toolInput: typeof candidate }) => {
            seen.push(structuredClone(ctx.toolInput))
            ctx.toolInput.nested_key.value = 99
            candidate.command = 'late candidate'
            raw.updatedInput!.command = 'late result'
            return { result: 'allow' }
          },
        }),
      ],
      'PreToolUse',
      config(['a', 'b']),
      policy,
      tracker(),
      root(),
      { toolInput: { command: 'original' } },
    )
    expect(seen).toEqual([{ command: 'validated', untouched_null: null, nested_key: { value: 1 } }])
    expect(result.lastResult?.updatedInput).toEqual({
      command: 'validated',
      untouched_null: null,
      nested_key: { value: 1 },
    })
  })

  for (const [event, value, field] of [
    ['PreToolUse', { result: 'ask', reason: 'confirm', injectContext: 'long context' }, 'result'],
    ['PermissionRequest', { result: 'allow', updatedInput: {} }, 'updatedInput'],
    ['PermissionRequest', { result: 'allow', updatedPermissions: [] }, 'updatedPermissions'],
    ['PermissionRequest', { result: 'block', reason: 'deny', interrupt: false }, 'interrupt'],
    [
      'UserPromptSubmit',
      { result: 'allow', sessionTitle: '', injectContext: 'long context' },
      'sessionTitle',
    ],
    [
      'PostToolUse',
      { result: 'skip', updatedMCPToolOutput: null, injectContext: 'long context' },
      'updatedMCPToolOutput',
    ],
  ] as const) {
    test(`${event} rejects present ${field} before handoff or later hook`, async () => {
      const dir = root()
      const cfg = config(['bad', 'later'])
      cfg.global.handoff = true
      const calls: ResultPolicyInput[] = []
      let later = 0
      const hooks = [
        hook('bad', { [event]: () => value }),
        hook('later', {
          [event]: () => {
            later++
            return { result: 'allow' }
          },
        }),
      ]
      const result = await run(
        hooks,
        event,
        cfg,
        rejecting(event, calls, (input) => input.hookName === 'bad'),
        tracker(),
        dir,
      )
      expect(calls.map((call) => call.hookName)).toEqual([hn('bad')])
      expect(result.policyFailure?.capability).toBe('test-capability')
      expect(result.lastResult).toBeUndefined()
      expect(later).toBe(0)
      expect(readdirSync(join(dir, '.clooks'))).toEqual([])
    })
  }

  test('positive accepted handoff writes a file, the same rejected payload writes none', async () => {
    const cfg = config(['note'])
    cfg.global.handoff = true
    const hooks = [
      hook('note', {
        PreToolUse: () => ({ result: 'allow', injectContext: 'policy handoff content' }),
      }),
    ]
    const allowedRoot = root()
    const accepted = await run(hooks, 'PreToolUse', cfg, undefined, tracker(), allowedRoot)
    expect(accepted.lastResult?.injectContext).toContain('read ')
    expect(
      readdirSync(join(allowedRoot, '.clooks/tmp')).some((name) =>
        name.startsWith('handoff-note-'),
      ),
    ).toBe(true)
    const rejectedRoot = root()
    const rejected = await run(
      hooks,
      'PreToolUse',
      cfg,
      rejecting('PreToolUse', [], () => true),
      tracker(),
      rejectedRoot,
    )
    expect(rejected.policyFailure).toBeDefined()
    expect(readdirSync(join(rejectedRoot, '.clooks'))).toEqual([])
  })

  for (const resultTag of ['allow', 'skip'] as const) {
    test(`parallel ${resultTag} with empty updatedInput is audited as a contract violation before handoff`, async () => {
      const calls: ResultPolicyInput[] = []
      const cfg = config(['patch'], true)
      cfg.global.handoff = true
      const dir = root()
      const history = tracker()
      const result = await run(
        [
          hook('patch', {
            PreToolUse: () => ({
              result: resultTag,
              updatedInput: {},
              injectContext: 'not delivered',
            }),
          }),
        ],
        'PreToolUse',
        cfg,
        rejecting('PreToolUse', calls, () => false),
        history,
        dir,
      )
      expect(calls.map((call) => call.origin)).toEqual(['handler', 'parallel-contract'])
      expect(result.lastResult?.result).toBe('block')
      expect(result.systemMessages.some((message) => message.includes('contract violation'))).toBe(
        true,
      )
      expect(history.records).toEqual([{ name: 'patch', decision: resultTag }])
      expect(readdirSync(join(dir, '.clooks')).filter((name) => name === 'tmp')).toEqual([])
    })
  }
})

describe('lifecycle policy and raw history', () => {
  for (const tag of ['block', 'skip'] as const) {
    test(`beforeHook ${tag} has its own origin and no handler or observer`, async () => {
      const calls: ResultPolicyInput[] = []
      let handler = 0
      let after = 0
      const history = tracker()
      await run(
        [
          hook('gate', {
            beforeHook: () => ({ result: tag, reason: 'gate' }),
            PreToolUse: () => {
              handler++
              return { result: 'skip' }
            },
            afterHook: () => {
              after++
            },
          }),
        ],
        'PreToolUse',
        config(['gate']),
        rejecting('PreToolUse', calls, () => false),
        history,
      )
      expect(calls.map((call) => call.origin)).toEqual(['before-hook'])
      expect(handler).toBe(0)
      expect(after).toBe(0)
      expect(history.records).toEqual([{ name: 'gate', decision: tag }])
    })
  }

  test('afterHook mutation is audited while its attempted override remains ignored', async () => {
    const calls: ResultPolicyInput[] = []
    const history = tracker()
    const raw: EngineResult = { result: 'allow' }
    const result = await run(
      [
        hook('observer', {
          PreToolUse: () => raw,
          afterHook: (event: { handlerResult: EngineResult }) => {
            expect(event.handlerResult).toBe(raw)
            event.handlerResult.updatedInput = { forbidden: true }
            return { result: 'skip' }
          },
        }),
      ],
      'PreToolUse',
      config(['observer']),
      rejecting(
        'PreToolUse',
        calls,
        (input) => (input.value as EngineResult)?.updatedInput !== undefined,
      ),
      history,
    )
    expect(calls[0]?.origin).toBe('handler')
    expect(calls[0]?.value).toEqual({ result: 'allow', updatedInput: { forbidden: true } })
    expect(result.policyFailure).toBeDefined()
    expect(history.records).toEqual([{ name: 'observer', decision: 'allow' }])
  })

  for (const value of [42, 'bad', [], { result: 'bad' }]) {
    test(`malformed handler result ${JSON.stringify(value)} is audited and records raw error`, async () => {
      const history = tracker()
      const calls: ResultPolicyInput[] = []
      const result = await run(
        [hook('bad', { Stop: () => value })],
        'Stop',
        config(['bad']),
        rejecting('Stop', calls, () => true),
        history,
      )
      expect(calls[0]?.value).toEqual(value)
      expect(result.policyFailure).toBeDefined()
      expect(history.records).toEqual([{ name: 'bad', decision: 'error' }])
      expect(history.commits()).toBe(1)
    })
  }
})

describe('Codex ordinary crash dispositions', () => {
  function invocation(event: 'Stop' | 'UserPromptSubmit') {
    return codexAdapter.normalizeInvocation(
      {
        hook_event_name: event,
        session_id: 'session',
        turn_id: 'turn',
        cwd: '/project',
        model: 'model',
        permission_mode: 'default',
        transcript_path: null,
        ...(event === 'Stop'
          ? { stop_hook_active: false, last_assistant_message: null }
          : { prompt: 'prompt' }),
      },
      event,
    )
  }

  for (const parallel of [false, true]) {
    for (const event of ['Stop', 'UserPromptSubmit'] as const) {
      for (const onError of ['continue', 'trace', 'block'] as const) {
        test(`${event} ${parallel ? 'parallel' : 'sequential'} crash with ${onError} respects accounting and later groups`, async () => {
          const dir = root()
          const history = tracker()
          const cfg = config(['crash', 'peer', 'later'], parallel, onError)
          cfg.global.maxFailures = 3
          cfg.hooks[hn('later')]!.parallel = false
          let later = 0
          const normalized = invocation(event)
          const result = await run(
            [
              hook('crash', {
                [event]: () => {
                  throw new Error('ordinary crash')
                },
              }),
              hook('peer', { [event]: () => ({ result: 'skip' }) }),
              hook('later', {
                [event]: () => {
                  later++
                  return { result: 'skip' }
                },
              }),
            ],
            event,
            cfg,
            codexAdapter.createResultPolicy(normalized),
            history,
            dir,
            normalized.context,
          )
          const state = await readFailures(join(dir, '.clooks/.failures'))
          expect(history.records.filter((entry) => entry.name === 'crash')).toEqual([
            { name: 'crash', decision: 'error' },
          ])
          expect(history.commits()).toBe(1)
          if (onError === 'block') {
            expect(result.policyFailure).toMatchObject({
              capability: 'engine-error',
              hookName: 'crash',
            })
            expect(state[hn('crash')]?.[event]?.consecutiveFailures).toBe(1)
            expect(later).toBe(0)
            const translated = codexAdapter.translateFailure({
              eventName: event,
              failure: result.policyFailure!,
            })
            if (event === 'Stop') {
              expect(JSON.parse(translated.output!)).toMatchObject({ continue: false })
              expect(JSON.parse(translated.output!)).not.toHaveProperty('decision')
            }
          } else {
            expect(result.policyFailure).toBeUndefined()
            expect(state[hn('crash')]).toBeUndefined()
            expect(later).toBe(1)
            if (onError === 'trace' && event === 'UserPromptSubmit')
              expect(result.traceMessages.length).toBe(1)
            else expect(result.systemMessages.join('\n')).toContain('ordinary crash')
          }
        })
      }
    }

    test.each([0, 1, 2])(
      `${parallel ? 'parallel' : 'sequential'} Stop threshold %s retains configured degradation`,
      async (maxFailures) => {
        const dir = root()
        const cfg = config(['crash', 'peer', 'later'], parallel)
        cfg.global.maxFailures = maxFailures
        cfg.hooks[hn('later')]!.parallel = false
        let later = 0
        const normalized = invocation('Stop')
        const result = await run(
          [
            hook('crash', {
              Stop: () => {
                throw new Error('threshold crash')
              },
            }),
            hook('peer', { Stop: () => ({ result: 'skip' }) }),
            hook('later', {
              Stop: () => {
                later++
                return { result: 'skip' }
              },
            }),
          ],
          'Stop',
          cfg,
          codexAdapter.createResultPolicy(normalized),
          tracker(),
          dir,
          normalized.context,
        )
        expect(
          (await readFailures(join(dir, '.clooks/.failures')))[hn('crash')]?.Stop
            ?.consecutiveFailures,
        ).toBe(1)
        expect(later).toBe(maxFailures === 1 ? 1 : 0)
        if (maxFailures === 1) {
          expect(result.policyFailure).toBeUndefined()
          expect(result.degradedMessages).toEqual(['degraded crash'])
        } else {
          expect(result.policyFailure).toMatchObject({ capability: 'engine-error' })
          expect(result.degradedMessages).toEqual([])
        }
      },
    )

    test(`${parallel ? 'parallel' : 'sequential'} successful Stop recovery clears prior crash count`, async () => {
      const dir = root()
      const cfg = config(['recover', 'peer'], parallel)
      cfg.global.maxFailures = 3
      const normalized = invocation('Stop')
      for (const fails of [true, false, true]) {
        const result = await run(
          [
            hook('recover', {
              Stop: () => {
                if (fails) throw new Error('recoverable')
                return { result: 'skip' }
              },
            }),
            hook('peer', { Stop: () => ({ result: 'skip' }) }),
          ],
          'Stop',
          cfg,
          codexAdapter.createResultPolicy(normalized),
          tracker(),
          dir,
          normalized.context,
        )
        const state = await readFailures(join(dir, '.clooks/.failures'))
        if (fails) {
          expect(state[hn('recover')]?.Stop?.consecutiveFailures).toBe(1)
          expect(result.policyFailure).toBeDefined()
        } else {
          expect(state[hn('recover')]?.Stop).toBeUndefined()
          expect(result.policyFailure).toBeUndefined()
        }
      }
    })

    test(`${parallel ? 'parallel' : 'sequential'} author Stop block remains continuation`, async () => {
      const normalized = invocation('Stop')
      const result = await run(
        [hook('author', { Stop: () => ({ result: 'block', reason: 'continue work' }) })],
        'Stop',
        config(['author'], parallel),
        codexAdapter.createResultPolicy(normalized),
        tracker(),
        root(),
        normalized.context,
      )
      expect(result.policyFailure).toBeUndefined()
      expect(
        JSON.parse(
          codexAdapter.translateFinalOutput({
            eventName: 'Stop',
            result: result.lastResult,
            systemMessages: [],
            diagnostics: [],
          }).output!,
        ),
      ).toEqual({ decision: 'block', reason: 'continue work' })
    })
  }

  for (const late of [false, true]) {
    test(`Codex Stop preserves captured crash counters with sibling ${late ? 'after' : 'before'} cutoff`, async () => {
      const starts = { a: gate(), b: gate() }
      const finishes = { a: gate(), b: gate() }
      const dir = root()
      const history = tracker()
      const cfg = config(['a', 'b'], true)
      cfg.global.maxFailures = 3
      const normalized = invocation('Stop')
      const pending = run(
        (['a', 'b'] as const).map((name) =>
          hook(name, {
            Stop: async () => {
              starts[name].release()
              await finishes[name].promise
              throw new Error(`crash-${name}`)
            },
          }),
        ),
        'Stop',
        cfg,
        codexAdapter.createResultPolicy(normalized),
        history,
        dir,
        normalized.context,
      )
      try {
        await bounded(Promise.all([starts.a.promise, starts.b.promise]).then(() => {}))
        finishes.a.release()
        if (!late) finishes.b.release()
        await bounded(pending.then(() => {}))
        const result = await pending
        const path = join(dir, '.clooks/.failures')
        const state = await readFailures(path)
        expect(state[hn('a')]?.Stop?.consecutiveFailures).toBe(1)
        if (late) expect(state[hn('b')]).toBeUndefined()
        else expect(state[hn('b')]?.Stop?.consecutiveFailures).toBe(1)
        expect(result.policyFailure).toMatchObject({ capability: 'engine-error', hookName: 'a' })
        expect(result.lastResult).toBeUndefined()
        expect(history.records).toEqual([
          { name: 'a', decision: 'error' },
          { name: 'b', decision: 'error' },
        ])
        expect(history.commits()).toBe(1)
        expect(readdirSync(join(dir, '.clooks'))).toEqual(['.failures'])
        const snapshot = JSON.stringify({ result, records: history.records, state })
        finishes.b.release()
        await drain()
        expect(
          JSON.stringify({ result, records: history.records, state: await readFailures(path) }),
        ).toBe(snapshot)
        expect(history.commits()).toBe(1)
      } finally {
        finishes.a.release()
        finishes.b.release()
        await bounded(Promise.allSettled([pending]).then(() => {}))
        await drain()
      }
    })
  }
})

describe('bounded parallel settlement', () => {
  for (const late of [false, true]) {
    test(`ordinary crash counters: sibling ${late ? 'after abort' : 'before abort'}`, async () => {
      const starts = { a: gate(), b: gate() }
      const finishes = { a: gate(), b: gate() }
      const history = tracker()
      const calls: ResultPolicyInput[] = []
      const dir = root()
      const cfg = config(['a', 'b'], true)
      cfg.global.maxFailures = 3
      const pending = run(
        (['a', 'b'] as const).map((name) =>
          hook(name, {
            PreToolUse: async () => {
              starts[name].release()
              await finishes[name].promise
              throw new Error(`crash-${name}`)
            },
          }),
        ),
        'PreToolUse',
        cfg,
        rejecting('PreToolUse', calls, () => false),
        history,
        dir,
      )
      try {
        await bounded(Promise.all([starts.a.promise, starts.b.promise]).then(() => {}))
        finishes.a.release()
        if (!late) finishes.b.release()
        await bounded(pending.then(() => {}))
        const result = await pending
        expect(result.lastResult?.result).toBe('block')
        expect(result.policyFailure).toBeUndefined()
        const failurePath = join(dir, '.clooks/.failures')
        const state = await readFailures(failurePath)
        expect(state[hn('a')]?.PreToolUse?.consecutiveFailures).toBe(1)
        if (late) expect(state[hn('b')]).toBeUndefined()
        else expect(state[hn('b')]?.PreToolUse?.consecutiveFailures).toBe(1)
        expect(calls.map((call) => call.hookName)).toEqual(late ? [hn('a')] : [hn('a'), hn('b')])
        expect(history.records).toEqual([
          { name: 'a', decision: 'error' },
          { name: 'b', decision: 'error' },
        ])
        expect(history.commits()).toBe(1)
        const snapshot = JSON.stringify({ result, records: history.records, calls, state })
        finishes.b.release()
        await drain()
        expect(
          JSON.stringify({
            result,
            records: history.records,
            calls,
            state: await readFailures(failurePath),
          }),
        ).toBe(snapshot)
        expect(history.commits()).toBe(1)
      } finally {
        finishes.a.release()
        finishes.b.release()
        await bounded(Promise.allSettled([pending]).then(() => {}))
        await drain()
      }
    })
  }

  test('a throwing result getter resolves as a policy failure without orphaning the parallel batch', async () => {
    const siblingStarted = gate()
    const finishSibling = gate()
    const history = tracker()
    const dir = root()
    const cfg = config(['unreadable', 'sibling'], true, 'continue')
    cfg.global.handoff = true
    let getterReads = 0
    const unreadable = {
      get result(): string {
        getterReads++
        throw new Error('unreadable result tag')
      },
      injectContext: 'must not create a handoff',
    }
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    const pending = run(
      [
        hook('unreadable', {
          PreToolUse: async () => {
            await siblingStarted.promise
            return unreadable
          },
        }),
        hook('sibling', {
          PreToolUse: async () => {
            siblingStarted.release()
            await finishSibling.promise
            return { result: 'allow', injectContext: 'late sibling context' }
          },
        }),
      ],
      'PreToolUse',
      cfg,
      undefined,
      history,
      dir,
    )
    try {
      await bounded(pending.then(() => {}))
      const result = await pending
      expect(getterReads).toBeGreaterThan(0)
      expect(result.policyFailure).toMatchObject({
        hookName: hn('unreadable'),
        capability: 'result-policy',
      })
      expect(result.lastResult).toBeUndefined()
      expect(history.records).toEqual([
        { name: 'unreadable', decision: 'error' },
        { name: 'sibling', decision: 'error' },
      ])
      expect(history.commits()).toBe(1)
      expect(readdirSync(join(dir, '.clooks'))).toEqual([])
      const snapshot = JSON.stringify({ result, records: history.records })
      finishSibling.release()
      await drain()
      expect(JSON.stringify({ result, records: history.records })).toBe(snapshot)
      expect(history.commits()).toBe(1)
      expect(readdirSync(join(dir, '.clooks'))).toEqual([])
      expect(unhandled).toEqual([])
    } finally {
      siblingStarted.release()
      finishSibling.release()
      try {
        await bounded(Promise.allSettled([pending]).then(() => {}))
        await drain()
      } finally {
        process.off('unhandledRejection', onUnhandled)
      }
    }
  })

  for (const parallel of [false, true]) {
    test(`lifecycle timeout ignores a later fulfilled result, parallel=${parallel}`, async () => {
      const started = gate()
      const finish = gate()
      const completed = gate()
      const calls: ResultPolicyInput[] = []
      const history = tracker()
      const dir = root()
      const cfg = config(['slow'], parallel, 'continue')
      cfg.global.timeout = ms(25)
      cfg.global.handoff = true
      const pending = run(
        [
          hook('slow', {
            PreToolUse: async () => {
              started.release()
              await finish.promise
              completed.release()
              return {
                result: 'allow',
                injectContext: 'late timeout content',
                updatedInput: { command: 'late' },
              }
            },
          }),
        ],
        'PreToolUse',
        cfg,
        rejecting('PreToolUse', calls, (input) => input.origin === 'engine-error'),
        history,
        dir,
      )
      try {
        await bounded(started.promise)
        const result = await pending
        expect(calls.map((call) => call.origin)).toEqual(['engine-error'])
        expect((calls[0]?.value as EngineResult).reason).toContain('timed out after 25ms')
        expect(result.policyFailure).toBeDefined()
        expect(result.lastResult).toBeUndefined()
        expect(history.records).toEqual([{ name: 'slow', decision: 'error' }])
        expect(history.commits()).toBe(1)
        expect(readdirSync(join(dir, '.clooks'))).toEqual([])
        const snapshot = JSON.stringify({ result, records: history.records, calls })
        finish.release()
        await bounded(completed.promise)
        await drain()
        expect(JSON.stringify({ result, records: history.records, calls })).toBe(snapshot)
        expect(history.commits()).toBe(1)
        expect(readdirSync(join(dir, '.clooks'))).toEqual([])
      } finally {
        finish.release()
        await Promise.allSettled([pending])
        await drain()
      }
    })
  }

  test('overlapping invocations keep policies, candidates, diagnostics and raw histories separate', async () => {
    const starts = { reject: gate(), accept: gate() }
    const finishes = { reject: gate(), accept: gate() }
    const histories = { reject: tracker(), accept: tracker() }
    const calls = { reject: [] as ResultPolicyInput[], accept: [] as ResultPolicyInput[] }
    const invocations = {
      reject: claudeCodeAdapter.normalizeInvocation(
        {
          hook_event_name: 'PreToolUse',
          session_id: 'reject',
          tool_input: { command: 'reject-original' },
        },
        'PreToolUse',
      ),
      accept: claudeCodeAdapter.normalizeInvocation(
        {
          hook_event_name: 'PreToolUse',
          session_id: 'accept',
          tool_input: { command: 'accept-original' },
        },
        'PreToolUse',
      ),
    }
    const makePolicy = (name: 'reject' | 'accept'): InvocationResultPolicy => ({
      checkResult(input) {
        calls[name].push(input)
        expect(input.currentToolInput).toEqual({ command: `${name}-original` })
        expect(invocations[name].private.sessionId).toBe(name)
        if (name === 'reject')
          return {
            kind: 'rejected',
            failure: {
              eventName: 'PreToolUse',
              hookName: input.hookName,
              capability: 'isolated-rejection',
              message: 'reject invocation only',
            },
          }
        return {
          kind: 'accepted',
          result: input.value as EngineResult,
          nextToolInput: { command: 'accepted-candidate', untouched_null: null },
          diagnostics: ['accept invocation only'],
        }
      },
    })
    const runInvocation = (name: 'reject' | 'accept') =>
      run(
        [
          hook('shared', {
            beforeHook: (event: { input: Record<string, unknown> }) => {
              expect(event.input).not.toHaveProperty('private')
              expect(event.input).not.toHaveProperty('raw')
            },
            PreToolUse: async (ctx: { sessionId: string; toolInput: { command: string } }) => {
              expect(ctx.sessionId).toBe(name)
              expect(ctx).not.toHaveProperty('private')
              expect(ctx).not.toHaveProperty('provider')
              ctx.toolInput.command = 'hook-owned mutation'
              starts[name].release()
              await finishes[name].promise
              return name === 'reject'
                ? { result: 'ask', reason: 'unsupported' }
                : {
                    result: 'allow',
                    updatedInput: { command: 'raw patch' },
                    injectContext: 'accepted context',
                  }
            },
            afterHook: (event: { input: Record<string, unknown> }) => {
              expect(event.input).not.toHaveProperty('private')
              expect(event.input).not.toHaveProperty('raw')
            },
          }),
        ],
        'PreToolUse',
        config(['shared']),
        makePolicy(name),
        histories[name],
        root(),
        invocations[name].context,
      )
    const rejected = runInvocation('reject')
    const accepted = runInvocation('accept')
    try {
      await bounded(Promise.all([starts.reject.promise, starts.accept.promise]).then(() => {}))
      finishes.reject.release()
      const failure = await rejected
      expect(failure.policyFailure?.capability).toBe('isolated-rejection')
      expect(failure.lastResult).toBeUndefined()
      expect(failure.systemMessages).toEqual([])
      expect(histories.accept.records).toEqual([])
      finishes.accept.release()
      const success = await accepted
      expect(success.policyFailure).toBeUndefined()
      expect(success.lastResult).toEqual({
        result: 'allow',
        updatedInput: { command: 'accepted-candidate', untouched_null: null },
        injectContext: 'accepted context',
      })
      expect(success.systemMessages).toEqual(['accept invocation only'])
      expect(histories.reject.records).toEqual([{ name: 'shared', decision: 'ask' }])
      expect(histories.accept.records).toEqual([{ name: 'shared', decision: 'allow' }])
      expect(histories.reject.commits()).toBe(1)
      expect(histories.accept.commits()).toBe(1)
      for (const name of ['reject', 'accept'] as const) {
        expect(calls[name]).toHaveLength(1)
        expect(invocations[name].context.toolInput).toEqual({ command: `${name}-original` })
        expect(invocations[name].private.raw.tool_input).toEqual({ command: `${name}-original` })
      }
    } finally {
      finishes.reject.release()
      finishes.accept.release()
      await Promise.allSettled([rejected, accepted])
      await drain()
    }
  })

  for (const first of ['a', 'b'])
    for (const lateThrows of [false, true]) {
      test(`${first} rejects first; late ${lateThrows ? 'rejection' : 'fulfillment'} cannot change effects or history`, async () => {
        const barriers = { a: gate(), b: gate() }
        const started = gate()
        let starts = 0
        const signals: AbortSignal[] = []
        const history = tracker()
        const calls: ResultPolicyInput[] = []
        const dir = root()
        const cfg = config(['a', 'b'], true, 'continue')
        cfg.global.handoff = true
        const pending = run(
          ['a', 'b'].map((name) =>
            hook(name, {
              PreToolUse: async (ctx: { signal: AbortSignal }) => {
                signals.push(ctx.signal)
                if (++starts === 2) started.release()
                await barriers[name as 'a' | 'b'].promise
                if (name !== first && lateThrows) throw new Error('late crash')
                return { result: 'ask', reason: 'confirm', injectContext: `context ${name}` }
              },
            }),
          ),
          'PreToolUse',
          cfg,
          rejecting('PreToolUse', calls, () => true),
          history,
          dir,
        )
        try {
          await bounded(started.promise)
          barriers[first as 'a' | 'b'].release()
          const result = await pending
          expect(result.policyFailure?.hookName).toBe(hn(first))
          expect(result.lastResult).toBeUndefined()
          expect(readdirSync(join(dir, '.clooks'))).toEqual([])
          expect(calls.map((call) => call.hookName)).toEqual([hn(first)])
          expect(signals.every((signal) => signal.aborted)).toBe(true)
          expect(history.records).toHaveLength(2)
          expect(history.records.find((record) => record.name === first)?.decision).toBe('ask')
          expect(history.records.find((record) => record.name !== first)?.decision).toBe('error')
          expect(history.commits()).toBe(1)
          const snapshot = JSON.stringify({
            result,
            records: history.records,
            files: readdirSync(join(dir, '.clooks')),
          })
          barriers[first === 'a' ? 'b' : 'a'].release()
          await drain()
          expect(
            JSON.stringify({
              result,
              records: history.records,
              files: readdirSync(join(dir, '.clooks')),
            }),
          ).toBe(snapshot)
          expect(calls).toHaveLength(1)
          expect(history.commits()).toBe(1)
        } finally {
          barriers.a.release()
          barriers.b.release()
          await Promise.allSettled([pending])
          await drain()
        }
      })
    }

  for (const mode of ['block', 'continue', 'trace'] as const)
    for (const parallel of [false, true]) {
      test(`policy throw bypasses ${mode}, parallel=${parallel}, and maxFailures degradation`, async () => {
        const cfg = config(['bad', 'later'], parallel, mode)
        const calls: ResultPolicyInput[] = []
        const policy: InvocationResultPolicy = {
          checkResult(input) {
            calls.push(input)
            throw new Error('private implementation error')
          },
        }
        const result = await run(
          [hook('bad', { PreToolUse: () => ({ result: 'allow' }) })],
          'PreToolUse',
          cfg,
          policy,
        )
        expect(result.policyFailure?.capability).toBe('result-policy')
        expect(result.policyFailure?.message).not.toContain('private implementation error')
        expect(result.lastResult).toBeUndefined()
        expect(result.degradedMessages).toEqual([])
        expect(calls).toHaveLength(1)
      })
    }

  test('generated engine errors and degraded load errors retain typed audit origins', async () => {
    const calls: ResultPolicyInput[] = []
    const cfg = config(['bad'], false, 'continue')
    const policy = rejecting(
      'Stop',
      calls,
      (input) => input.origin === 'engine-error' || input.origin === 'load-error',
    )
    const history = tracker()
    const crash = await run(
      [
        hook('bad', {
          Stop: () => {
            throw new Error('crash')
          },
        }),
      ],
      'Stop',
      cfg,
      policy,
      history,
    )
    expect(crash.policyFailure).toBeDefined()
    expect(history.records).toEqual([{ name: 'bad', decision: 'error' }])
    const dir = root()
    const loadHistory = tracker()
    const load = await executeHooks(
      [],
      'Stop',
      {},
      cfg,
      join(dir, '.clooks/.failures'),
      dir,
      [{ name: hn('bad'), error: 'import failed' }],
      undefined,
      loadHistory.value,
      policy,
    )
    expect(load.policyFailure).toBeDefined()
    expect(calls.map((call) => call.origin)).toEqual(['engine-error', 'load-error'])
    expect(loadHistory.records).toEqual([])
  })
})
