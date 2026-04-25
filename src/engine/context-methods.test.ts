import { describe, test, expect, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { executeHooks } from './index.js'
import type { LoadedHook } from '../loader.js'
import type { ClooksHook } from '../types/hook.js'
import type { ClooksConfig, HookEntry } from '../config/schema.js'
import type { HookName } from '../types/branded.js'
import { hn, ms } from '../test-utils.js'
import { DEFAULT_MAX_FAILURES_MESSAGE } from '../config/constants.js'
import { createContext } from '../testing/create-context.js'
import { hook as smokeHook } from '../../test/fixtures/hooks/method-smoke.js'
import {
  allow,
  ask,
  block,
  defer,
  skip,
  success,
  failure,
  cont,
  stop,
  retry,
  attachDecisionMethods,
} from './context-methods.js'
import type { EventName } from '../types/branded.js'

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- test helper, any callable shape is fine
function makeLoadedHook(name: string, handlers: Record<string, Function>): LoadedHook {
  const hookName = hn(name)
  const hook = {
    meta: { name: hookName },
    ...handlers,
  } as unknown as ClooksHook
  return {
    name: hookName,
    hook,
    config: {},
    hookPath: `/test/hooks/${name}.ts`,
    configPath: '/test/.clooks/clooks.yml',
  }
}

function makeTestConfig(hookOverrides: Record<string, { parallel?: boolean }> = {}): ClooksConfig {
  const hooks = {} as Record<HookName, HookEntry>
  for (const [name, overrides] of Object.entries(hookOverrides)) {
    hooks[hn(name)] = {
      resolvedPath: `.clooks/hooks/${name}.ts`,
      config: {},
      parallel: false,
      origin: 'project',
      ...overrides,
    }
  }
  return {
    version: '1.0.0',
    global: {
      timeout: ms(5000),
      onError: 'block',
      maxFailures: 3,
      maxFailuresMessage: DEFAULT_MAX_FAILURES_MESSAGE,
    },
    hooks,
    events: {},
  }
}

let tempDir: string

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

function makeTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), 'clooks-context-methods-'))
  mkdirSync(join(tempDir, '.clooks'), { recursive: true })
  return tempDir
}

function fp(dir: string): string {
  return join(dir, '.clooks/.failures')
}

describe('M1 decision-method smoke fixture', () => {
  test('createContext attaches PreToolUse methods', () => {
    const ctx = createContext('PreToolUse', {
      toolName: 'Bash',
      toolInput: { command: 'ls' },
      toolUseId: 'test-tool-use-id',
      originalToolInput: { command: 'ls' },
    })
    expect(typeof (ctx as unknown as { skip: unknown }).skip).toBe('function')
    expect(typeof (ctx as unknown as { allow: unknown }).allow).toBe('function')
    expect(typeof (ctx as unknown as { block: unknown }).block).toBe('function')
    // M2 Gap 4: confirm `defer` and `ask` are also attached for the full set,
    // and that calling `defer()` produces the constructor's pure return shape.
    expect(typeof (ctx as unknown as { defer: unknown }).defer).toBe('function')
    expect(typeof (ctx as unknown as { ask: unknown }).ask).toBe('function')
    const deferResult = (ctx as unknown as { defer: () => unknown }).defer()
    expect(deferResult).toEqual({ result: 'defer' })
  })

  test('smoke fixture handler returns { result: skip } via ctx.skip()', () => {
    const ctx = createContext('PreToolUse', {
      toolName: 'Bash',
      toolInput: { command: 'ls' },
      toolUseId: 'test-tool-use-id',
      originalToolInput: { command: 'ls' },
    })
    const result = smokeHook.PreToolUse(ctx as unknown as { skip: () => { result: 'skip' } })
    expect(result).toEqual({ result: 'skip' })
  })
})

describe('M1 decision-method engine integration', () => {
  test('sequential path: PreToolUse:Bash ctx carries allow/block/skip methods', async () => {
    let observed: { allow: boolean; block: boolean; skip: boolean } | null = null

    const hook = makeLoadedHook('seq-method-probe', {
      PreToolUse(ctx: Record<string, unknown>) {
        observed = {
          allow: typeof ctx.allow === 'function',
          block: typeof ctx.block === 'function',
          skip: typeof ctx.skip === 'function',
        }
        return { result: 'allow' }
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({ 'seq-method-probe': {} })
    await executeHooks(
      [hook],
      'PreToolUse',
      { event: 'PreToolUse', toolName: 'Bash', toolInput: { command: 'ls' } },
      config,
      fp(dir),
    )

    expect(observed).not.toBeNull()
    expect(observed!.allow).toBe(true)
    expect(observed!.block).toBe(true)
    expect(observed!.skip).toBe(true)
  })

  test('parallel path: both per-hook ctxs carry allow/block/skip methods', async () => {
    const observations: Set<string> = new Set()

    const hookA = makeLoadedHook('par-probe-a', {
      PreToolUse(ctx: Record<string, unknown>) {
        if (
          typeof ctx.allow === 'function' &&
          typeof ctx.block === 'function' &&
          typeof ctx.skip === 'function'
        ) {
          observations.add('par-probe-a')
        }
        return { result: 'skip' }
      },
    })

    const hookB = makeLoadedHook('par-probe-b', {
      PreToolUse(ctx: Record<string, unknown>) {
        if (
          typeof ctx.allow === 'function' &&
          typeof ctx.block === 'function' &&
          typeof ctx.skip === 'function'
        ) {
          observations.add('par-probe-b')
        }
        return { result: 'skip' }
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({
      'par-probe-a': { parallel: true },
      'par-probe-b': { parallel: true },
    })
    await executeHooks(
      [hookA, hookB],
      'PreToolUse',
      { event: 'PreToolUse', toolName: 'Bash', toolInput: { command: 'ls' } },
      config,
      fp(dir),
    )

    expect(observations.has('par-probe-a')).toBe(true)
    expect(observations.has('par-probe-b')).toBe(true)
  })
})

describe('per-result-tag constructor return shapes', () => {
  test('allow() returns { result: "allow" }', () => {
    expect(allow()).toEqual({ result: 'allow' })
  })

  test('allow(opts) spreads opts onto { result: "allow" }', () => {
    expect(
      allow({
        reason: 'r',
        debugMessage: 'd',
        injectContext: 'c',
        updatedInput: { x: 1 },
      }),
    ).toEqual({
      result: 'allow',
      reason: 'r',
      debugMessage: 'd',
      injectContext: 'c',
      updatedInput: { x: 1 },
    })
  })

  test('ask({ reason }) returns { result: "ask", reason }', () => {
    expect(ask({ reason: 'r' })).toEqual({ result: 'ask', reason: 'r' })
  })

  test('block({ reason }) returns { result: "block", reason }', () => {
    expect(block({ reason: 'r' })).toEqual({ result: 'block', reason: 'r' })
  })

  test('defer() returns { result: "defer" }', () => {
    expect(defer()).toEqual({ result: 'defer' })
  })

  test('skip() returns { result: "skip" }', () => {
    expect(skip()).toEqual({ result: 'skip' })
  })

  test('success({ path }) returns { result: "success", path } (WorktreeCreate)', () => {
    expect(success({ path: '/tmp/worktree' })).toEqual({
      result: 'success',
      path: '/tmp/worktree',
    })
  })

  test('failure({ reason }) returns { result: "failure", reason }', () => {
    expect(failure({ reason: 'r' })).toEqual({ result: 'failure', reason: 'r' })
  })

  test('cont({ feedback }) returns { result: "continue", feedback }', () => {
    expect(cont({ feedback: 'f' })).toEqual({ result: 'continue', feedback: 'f' })
  })

  test('stop({ reason }) returns { result: "stop", reason }', () => {
    expect(stop({ reason: 'r' })).toEqual({ result: 'stop', reason: 'r' })
  })

  test('retry() returns { result: "retry" } (PermissionDenied)', () => {
    expect(retry()).toEqual({ result: 'retry' })
  })
})

describe('attachDecisionMethods runtime behavior', () => {
  // M3: with the table now complete, attachDecisionMethods throws on a missed
  // EventName lookup. The Record<EventName, ...> typing prevents this at
  // compile time; the throw catches `as EventName` escape-hatch misuse at
  // runtime. Replaces the M1 no-op behavior.
  test('unknown event name throws (M3 tightening)', () => {
    const ctx: Record<string, unknown> = { event: 'UnknownEvent', flag: 1 }
    expect(() => {
      attachDecisionMethods('UnknownEvent' as EventName, ctx)
    }).toThrow(/Unknown event: UnknownEvent/)
    expect(typeof (ctx as { allow?: unknown }).allow).toBe('undefined')
  })

  test('attaches PreToolUse methods on Unknown variant context', () => {
    // Hand-roll the ctx to mirror UnknownPreToolUseContext shape (toolName not in
    // the 10-arm DU). Going through createContext fights the DU narrowing, so we
    // build the object directly and call attachDecisionMethods.
    const ctx = {
      event: 'PreToolUse',
      sessionId: 'test-session',
      cwd: '/tmp',
      transcriptPath: '/tmp/transcript.json',
      parallel: false,
      signal: new AbortController().signal,
      toolName: 'mcp__some__tool',
      toolInput: { foo: 'bar' },
      toolUseId: 'tu-x',
      originalToolInput: { foo: 'bar' },
    } as Record<string, unknown>
    attachDecisionMethods('PreToolUse' as EventName, ctx)

    expect(typeof ctx.allow).toBe('function')
    expect(typeof ctx.ask).toBe('function')
    expect(typeof ctx.block).toBe('function')
    expect(typeof ctx.defer).toBe('function')
    expect(typeof ctx.skip).toBe('function')

    const r = (ctx.allow as (opts: { updatedInput: Record<string, unknown> }) => unknown)({
      updatedInput: { foo: 'baz' },
    })
    expect(r).toEqual({ result: 'allow', updatedInput: { foo: 'baz' } })
  })

  test('idempotent: re-attach preserves the same function references', () => {
    const ctx = createContext('PreToolUse', {
      toolName: 'Bash',
      toolInput: { command: 'ls' },
      toolUseId: 'tu-1',
      originalToolInput: { command: 'ls' },
    })
    const firstAllow = (ctx as unknown as { allow: unknown }).allow
    expect(typeof firstAllow).toBe('function')
    expect(() => {
      attachDecisionMethods('PreToolUse', ctx)
    }).not.toThrow()
    const secondAllow = (ctx as unknown as { allow: unknown }).allow
    expect(secondAllow).toBe(firstAllow)
  })
})

describe('createContext per-event behavior', () => {
  // M2 wired the PermissionRequest method set: { allow, block, skip }. The DU
  // promotion of PermissionRequestContext mirrors PreToolUseContext so per-tool
  // narrowing flows through `ctx.allow({ updatedInput })`.
  test('PermissionRequest M2: allow/block/skip methods attached', () => {
    const ctx = createContext('PermissionRequest', {
      toolName: 'Bash',
      toolInput: { command: 'ls' },
    })
    const c = ctx as unknown as {
      event: string
      toolName: string
      toolInput: { command: string }
      allow?: unknown
      block?: unknown
      skip?: unknown
    }
    expect(c.event).toBe('PermissionRequest')
    expect(c.toolName).toBe('Bash')
    expect(c.toolInput.command).toBe('ls')
    expect(typeof c.allow).toBe('function')
    expect(typeof c.block).toBe('function')
    expect(typeof c.skip).toBe('function')
  })

  test('createContext supplies BaseContext defaults', () => {
    const ctx = createContext('PreToolUse', {
      toolName: 'Bash',
      toolInput: { command: 'ls' },
      toolUseId: 'tu-1',
      originalToolInput: { command: 'ls' },
    })
    const c = ctx as unknown as {
      sessionId: string
      cwd: string
      transcriptPath: string
      parallel: boolean
      signal: AbortSignal
    }
    expect(c.sessionId).toBe('test-session')
    expect(c.cwd).toBe('/tmp')
    expect(c.transcriptPath).toBe('/tmp/transcript.json')
    expect(c.parallel).toBe(false)
    expect(c.signal).toBeInstanceOf(AbortSignal)
  })
})

// M3: per-event method-attachment smoke tests. One representative event per
// category (guard / observe / observe-with-multi-method / continuation /
// notify-only / impl / retry-shaped). Verifies METHOD_SETS wiring landed and
// that the runtime constructors return the expected discriminated shapes.
describe('M3 per-event method attachment', () => {
  test('UserPromptSubmit (guard): allow/block/skip attached', () => {
    const ctx = createContext('UserPromptSubmit', { prompt: 'hi' })
    const c = ctx as unknown as Record<string, unknown>
    expect(typeof c.allow).toBe('function')
    expect(typeof c.block).toBe('function')
    expect(typeof c.skip).toBe('function')
    // No `defer` or `ask` for this event.
    expect(typeof c.defer).toBe('undefined')
    expect(typeof c.ask).toBe('undefined')
    const r = (c.allow as (opts?: { sessionTitle?: string }) => unknown)({
      sessionTitle: 'renamed',
    })
    expect(r).toEqual({ result: 'allow', sessionTitle: 'renamed' })
  })

  test('PostToolUse (observe with multi-method): skip + block attached', () => {
    const ctx = createContext('PostToolUse', {
      toolName: 'Bash',
      toolInput: { command: 'ls' },
      toolResponse: { stdout: '' },
      toolUseId: 'tu-pt-1',
    })
    const c = ctx as unknown as Record<string, unknown>
    expect(typeof c.skip).toBe('function')
    expect(typeof c.block).toBe('function')
    expect(typeof c.allow).toBe('undefined')
    const r = (c.block as (opts: { reason: string; updatedMCPToolOutput?: unknown }) => unknown)({
      reason: 'tool result rejected',
      updatedMCPToolOutput: { ok: false },
    })
    expect(r).toEqual({
      result: 'block',
      reason: 'tool result rejected',
      updatedMCPToolOutput: { ok: false },
    })
  })

  test('WorktreeCreate (implementation): success + failure attached', () => {
    const ctx = createContext('WorktreeCreate', { name: 'feature-branch' })
    const c = ctx as unknown as Record<string, unknown>
    expect(typeof c.success).toBe('function')
    expect(typeof c.failure).toBe('function')
    expect(typeof c.skip).toBe('undefined')
    const ok = (c.success as (opts: { path: string }) => unknown)({ path: '/tmp/wt' })
    expect(ok).toEqual({ result: 'success', path: '/tmp/wt' })
    const bad = (c.failure as (opts: { reason: string }) => unknown)({ reason: 'no space' })
    expect(bad).toEqual({ result: 'failure', reason: 'no space' })
  })

  test('TeammateIdle (continuation): continue/stop/skip attached, property key is `continue`', () => {
    const ctx = createContext('TeammateIdle', { teammateName: 'alice', teamName: 'team-a' })
    const c = ctx as unknown as Record<string, unknown>
    expect(typeof c.continue).toBe('function')
    expect(typeof c.stop).toBe('function')
    expect(typeof c.skip).toBe('function')
    const r = (c.continue as (opts: { feedback: string }) => unknown)({ feedback: 'keep going' })
    expect(r).toEqual({ result: 'continue', feedback: 'keep going' })
  })

  test('StopFailure (notify-only): only skip attached', () => {
    const ctx = createContext('StopFailure', { error: 'rate_limit' })
    const c = ctx as unknown as Record<string, unknown>
    expect(typeof c.skip).toBe('function')
    expect(typeof c.allow).toBe('undefined')
    expect(typeof c.block).toBe('undefined')
    expect((c.skip as () => unknown)()).toEqual({ result: 'skip' })
  })

  test('PermissionDenied (observe-with-retry): retry + skip attached', () => {
    const ctx = createContext('PermissionDenied', {
      toolName: 'Bash',
      toolInput: { command: 'rm -rf /' },
      toolUseId: 'tu-pd-1',
      denialReason: 'destructive',
    })
    const c = ctx as unknown as Record<string, unknown>
    expect(typeof c.retry).toBe('function')
    expect(typeof c.skip).toBe('function')
    expect(typeof c.allow).toBe('undefined')
    expect((c.retry as () => unknown)()).toEqual({ result: 'retry' })
  })

  // M3 Gap 3: cover the two remaining continuation events. TeammateIdle is
  // already covered above; TaskCreated and TaskCompleted share the verb set
  // but live on different event names and must each be exercised.
  test('TaskCreated (continuation): continue/stop/skip attached, no allow/block', () => {
    const ctx = createContext('TaskCreated', {
      taskId: 'task-001',
      taskSubject: 'investigate flake',
      taskDescription: 'flake in CI',
      teammateName: 'alice',
      teamName: 'team-a',
    })
    const c = ctx as unknown as Record<string, unknown>
    expect(typeof c.continue).toBe('function')
    expect(typeof c.stop).toBe('function')
    expect(typeof c.skip).toBe('function')
    expect(typeof c.allow).toBe('undefined')
    expect(typeof c.block).toBe('undefined')
    const r = (c.continue as (opts: { feedback: string }) => unknown)({
      feedback: 'do not create',
    })
    expect(r).toEqual({ result: 'continue', feedback: 'do not create' })
  })

  test('TaskCompleted (continuation): continue/stop/skip attached, no allow/block', () => {
    const ctx = createContext('TaskCompleted', {
      taskId: 'task-001',
      taskSubject: 'investigate flake',
      taskDescription: 'flake in CI',
      teammateName: 'alice',
      teamName: 'team-a',
    })
    const c = ctx as unknown as Record<string, unknown>
    expect(typeof c.continue).toBe('function')
    expect(typeof c.stop).toBe('function')
    expect(typeof c.skip).toBe('function')
    expect(typeof c.allow).toBe('undefined')
    expect(typeof c.block).toBe('undefined')
    const r = (c.continue as (opts: { feedback: string }) => unknown)({
      feedback: 'not ready',
    })
    expect(r).toEqual({ result: 'continue', feedback: 'not ready' })
  })
})

// M3 Gap 1: exhaustive table-driven test that asserts EVERY event in
// `EventName` exposes EXACTLY the method names the spike documents — no more,
// no less. The `Record<EventName, ...>` typing on EXPECTED_METHODS forces TS
// to flag any drift between EventName and the table at compile time; the
// runtime set-comparison catches drift between METHOD_SETS and the table.
//
// Source of truth: `docs/research/feat-0063-decision-methods.md` Summary
// Matrix + per-event sections. Kept in lockstep with
// `src/engine/context-methods.ts:METHOD_SETS`.
describe('METHOD_SETS exhaustive wiring', () => {
  const EXPECTED_METHODS: Record<EventName, ReadonlyArray<string>> = Object.freeze({
    // Guard events — `allow`/`block`/`skip` plus PreToolUse extras.
    PreToolUse: ['allow', 'ask', 'block', 'defer', 'skip'],
    PermissionRequest: ['allow', 'block', 'skip'],
    UserPromptSubmit: ['allow', 'block', 'skip'],
    // Stop / SubagentStop: spike + METHOD_SETS both wire allow/block/skip
    // (StopEventResult = AllowResult | BlockResult | SkipResult). Diverges
    // from the gap-spec's draft table which listed only block/skip.
    Stop: ['allow', 'block', 'skip'],
    SubagentStop: ['allow', 'block', 'skip'],
    ConfigChange: ['allow', 'block', 'skip'],
    PreCompact: ['allow', 'block', 'skip'],

    // Observe events.
    PostToolUse: ['block', 'skip'],
    PermissionDenied: ['retry', 'skip'],
    SessionStart: ['skip'],
    SessionEnd: ['skip'],
    InstructionsLoaded: ['skip'],
    PostToolUseFailure: ['skip'],
    Notification: ['skip'],
    SubagentStart: ['skip'],
    WorktreeRemove: ['skip'],
    PostCompact: ['skip'],

    // Notify-only — only skip, kept for API symmetry (output dropped upstream).
    StopFailure: ['skip'],

    // Implementation event.
    WorktreeCreate: ['success', 'failure'],

    // Continuation events — `cont` is registered under the property key
    // `'continue'`; the runtime verb is `continue`, not `cont`.
    TeammateIdle: ['continue', 'stop', 'skip'],
    TaskCreated: ['continue', 'stop', 'skip'],
    TaskCompleted: ['continue', 'stop', 'skip'],
  } as const)

  // Minimal payloads keyed by event. Only the fields the type system requires
  // are supplied — method attachment is not gated on payload contents, so
  // this is purely about satisfying the per-event payload type. Any field
  // shape concerns are covered elsewhere.
  function buildCtx(event: EventName): Record<string, unknown> {
    switch (event) {
      case 'PreToolUse':
        return createContext('PreToolUse', {
          toolName: 'Bash',
          toolInput: { command: 'ls' },
          toolUseId: 'tu-1',
          originalToolInput: { command: 'ls' },
        }) as unknown as Record<string, unknown>
      case 'PostToolUse':
        return createContext('PostToolUse', {
          toolName: 'Bash',
          toolInput: { command: 'ls' },
          toolResponse: { stdout: '' },
          toolUseId: 'tu-1',
        }) as unknown as Record<string, unknown>
      case 'PostToolUseFailure':
        return createContext('PostToolUseFailure', {
          toolName: 'Bash',
          toolInput: { command: 'ls' },
          toolUseId: 'tu-1',
          error: 'tool failed',
        }) as unknown as Record<string, unknown>
      case 'PermissionRequest':
        return createContext('PermissionRequest', {
          toolName: 'Bash',
          toolInput: { command: 'ls' },
        }) as unknown as Record<string, unknown>
      case 'PermissionDenied':
        return createContext('PermissionDenied', {
          toolName: 'Bash',
          toolInput: { command: 'ls' },
          toolUseId: 'tu-1',
          denialReason: 'rule',
        }) as unknown as Record<string, unknown>
      case 'UserPromptSubmit':
        return createContext('UserPromptSubmit', { prompt: 'hi' }) as unknown as Record<
          string,
          unknown
        >
      case 'Stop':
        return createContext('Stop', {
          stopHookActive: false,
          lastAssistantMessage: '',
        }) as unknown as Record<string, unknown>
      case 'StopFailure':
        return createContext('StopFailure', { error: 'rate_limit' }) as unknown as Record<
          string,
          unknown
        >
      case 'SubagentStart':
        return createContext('SubagentStart', {
          agentId: 'agent-1',
          agentType: 'general-purpose',
        }) as unknown as Record<string, unknown>
      case 'SubagentStop':
        return createContext('SubagentStop', {
          agentId: 'agent-1',
          agentType: 'general-purpose',
          stopHookActive: false,
          agentTranscriptPath: '/tmp/agent.json',
          lastAssistantMessage: '',
        }) as unknown as Record<string, unknown>
      case 'SessionStart':
        return createContext('SessionStart', { source: 'startup' }) as unknown as Record<
          string,
          unknown
        >
      case 'SessionEnd':
        return createContext('SessionEnd', { reason: 'clear' }) as unknown as Record<
          string,
          unknown
        >
      case 'PreCompact':
        return createContext('PreCompact', {
          trigger: 'auto',
          customInstructions: '',
        }) as unknown as Record<string, unknown>
      case 'PostCompact':
        return createContext('PostCompact', {
          trigger: 'auto',
          compactSummary: '',
        }) as unknown as Record<string, unknown>
      case 'ConfigChange':
        return createContext('ConfigChange', {
          source: 'user_settings',
        }) as unknown as Record<string, unknown>
      case 'Notification':
        return createContext('Notification', {
          message: 'hi',
          notificationType: 'idle_prompt',
        }) as unknown as Record<string, unknown>
      case 'InstructionsLoaded':
        return createContext('InstructionsLoaded', {
          memoryType: 'Project',
          loadReason: 'session_start',
          filePath: '/tmp/CLAUDE.md',
        }) as unknown as Record<string, unknown>
      case 'WorktreeCreate':
        return createContext('WorktreeCreate', { name: 'feature-branch' }) as unknown as Record<
          string,
          unknown
        >
      case 'WorktreeRemove':
        return createContext('WorktreeRemove', {
          worktreePath: '/tmp/wt',
        }) as unknown as Record<string, unknown>
      case 'TeammateIdle':
        return createContext('TeammateIdle', {
          teammateName: 'alice',
          teamName: 'team-a',
        }) as unknown as Record<string, unknown>
      case 'TaskCreated':
        return createContext('TaskCreated', {
          taskId: 't-1',
          taskSubject: 'subj',
          taskDescription: 'desc',
          teammateName: 'alice',
          teamName: 'team-a',
        }) as unknown as Record<string, unknown>
      case 'TaskCompleted':
        return createContext('TaskCompleted', {
          taskId: 't-1',
          taskSubject: 'subj',
          taskDescription: 'desc',
          teammateName: 'alice',
          teamName: 'team-a',
        }) as unknown as Record<string, unknown>
    }
  }

  // Drive the table-test off the EXPECTED_METHODS keys so a missing entry
  // (which would have been caught by `Record<EventName, ...>` at compile
  // time) also fails at runtime if someone bypasses the type with `as`.
  const events = Object.keys(EXPECTED_METHODS) as EventName[]

  for (const event of events) {
    test(`${event}: ctx carries exactly the spike-documented method set`, () => {
      const ctx = buildCtx(event)
      const actual = Object.keys(ctx)
        .filter((k) => typeof (ctx as Record<string, unknown>)[k] === 'function')
        .sort()
      const expected = [...EXPECTED_METHODS[event]].sort()
      expect(actual).toEqual(expected)
    })
  }
})
