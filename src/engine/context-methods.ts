// Decision-method runtime: per-event method-set table + attach factory.
//
// Methods are pure value constructors — `(opts?) => ({ result: '<tag>', ...opts })`.
// They do not consult `ctx`, do not call any engine API, and have no side effects.
// `attachDecisionMethods(eventName, ctx)` mutates `ctx` in place via `Object.assign`,
// adding the per-event method set so handler code can write `ctx.allow({...})`.

import type { EventName } from '../types/branded.js'
import type {
  AllowResult,
  AskResult,
  BlockResult,
  DeferResult,
  SkipResult,
  SuccessResult,
  FailureResult,
  ContinueResult,
  StopResult,
  RetryResult,
  LifecyclePassthroughResult,
} from '../types'
import type {
  BlockOpts,
  DebugMessage,
  InjectContext,
  SessionTitle,
  SkipOpts,
  UpdatedPermissions,
} from '../types'

export type { BlockOpts, SkipOpts }

// --- Per-result-tag pure constructors ---
//
// Each constructor mirrors the corresponding result type from `src/types/results.ts`.
// The opts bag is spread onto a literal-tagged object. No `ctx` access; no closures.

export interface AllowOpts extends DebugMessage, InjectContext, SessionTitle, UpdatedPermissions {
  reason?: string
  updatedInput?: Record<string, unknown>
}

export interface AskOpts extends DebugMessage, InjectContext {
  reason: string
  updatedInput?: Record<string, unknown>
}

export type DeferOpts = DebugMessage

export interface SuccessOpts extends DebugMessage {
  path: string
}

export interface FailureOpts extends DebugMessage {
  reason: string
}

export interface ContinueOpts extends DebugMessage {
  feedback: string
}

export interface StopOpts extends DebugMessage {
  reason: string
}

export type RetryOpts = DebugMessage

export function allow(opts: AllowOpts = {}): AllowResult & Record<string, unknown> {
  return { result: 'allow', ...opts }
}

export function ask(opts: AskOpts): AskResult & Record<string, unknown> {
  return { result: 'ask', ...opts }
}

export function block(opts: BlockOpts): BlockResult & Record<string, unknown> {
  return { result: 'block', ...opts }
}

export function defer(opts: DeferOpts = {}): DeferResult & Record<string, unknown> {
  return { result: 'defer', ...opts }
}

export function skip(opts: SkipOpts = {}): SkipResult & Record<string, unknown> {
  return { result: 'skip', ...opts }
}

export function success(opts: SuccessOpts): SuccessResult & Record<string, unknown> {
  return { result: 'success', ...opts }
}

export function failure(opts: FailureOpts): FailureResult & Record<string, unknown> {
  return { result: 'failure', ...opts }
}

// `continue` is a reserved word in strict-mode TS function declarations, so this
// constructor is exported as `cont`. METHOD_SETS wires it under the property key
// `'continue'` (object property names are not subject to the reserved-word
// restriction), so hook authors call `ctx.continue()` at runtime.
export function cont(opts: ContinueOpts): ContinueResult & Record<string, unknown> {
  return { result: 'continue', ...opts }
}

export function stop(opts: StopOpts): StopResult & Record<string, unknown> {
  return { result: 'stop', ...opts }
}

export function retry(opts: RetryOpts = {}): RetryResult & Record<string, unknown> {
  return { result: 'retry', ...opts }
}

// Maps each `EventName` to its subset of decision-method constructors.
// `Record<EventName, ...>` enforces compile-time exhaustiveness — adding a
// new event to `EventName` fails compilation until its entry exists.

const METHOD_SETS: Record<EventName, Record<string, unknown>> = {
  // Guard events
  PreToolUse: { allow, ask, block, defer, skip },
  PermissionRequest: { allow, block, skip },
  UserPromptSubmit: { allow, block, skip },
  Stop: { allow, block, skip },
  SubagentStop: { allow, block, skip },
  ConfigChange: { allow, block, skip },
  PreCompact: { allow, block, skip },

  // Observe events (mostly skip; PostToolUse adds block; PermissionDenied adds retry)
  PostToolUse: { block, skip },
  PermissionDenied: { retry, skip },
  SessionStart: { skip },
  SessionEnd: { skip },
  InstructionsLoaded: { skip },
  PostToolUseFailure: { skip },
  Notification: { skip },
  SubagentStart: { skip },
  WorktreeRemove: { skip },
  PostCompact: { skip },

  // Notify-only event — output dropped upstream, kept for API symmetry
  StopFailure: { skip },

  // Implementation event
  WorktreeCreate: { success, failure },

  // Continuation events — `cont` is registered under the property key
  // `'continue'`; hook authors call `ctx.continue()`.
  TeammateIdle: { continue: cont, stop, skip },
  TaskCreated: { continue: cont, stop, skip },
  TaskCompleted: { continue: cont, stop, skip },
}

/**
 * Attach decision-method constructors to a context object. Idempotent.
 *
 * Throws on a missed `EventName` entry. The `Record<EventName, ...>` typing
 * already prevents this at compile time; the throw catches `as EventName`
 * escape-hatch misuse at runtime.
 */
export function attachDecisionMethods(eventName: EventName, ctx: object): void {
  const methods = METHOD_SETS[eventName]
  if (methods === undefined) {
    throw new Error('Unknown event: ' + String(eventName))
  }
  Object.assign(ctx, methods)
}

// --- Lifecycle-slot constructors ---
//
// `passthrough` is the lifecycle-internal no-op carrier. It does not appear in
// `ResultTag` and never reaches the per-event pipeline — it's consumed inside
// `runHookLifecycle` and translated to "continue to next phase."

export function passthrough(opts: { debugMessage?: string } = {}): LifecyclePassthroughResult {
  return { result: 'passthrough', ...opts }
}

/**
 * Universal verbs available to `beforeHook`. Same shape regardless of which
 * event is being wrapped — beforeHook is a gate, not a per-event handler.
 */
export const BEFORE_LIFECYCLE_METHODS: {
  block: typeof block
  skip: typeof skip
  passthrough: typeof passthrough
} = { block, skip, passthrough }

/**
 * `afterHook` is a pure observer — only `passthrough` is exposed.
 */
export const AFTER_LIFECYCLE_METHODS: {
  passthrough: typeof passthrough
} = { passthrough }

/**
 * Attach the lifecycle-slot method set onto a freshly constructed lifecycle
 * event object. Mirrors `attachDecisionMethods` for the handler `ctx`; neither
 * lifecycle method set varies by event, so no `eventName` argument is needed.
 */
export function attachLifecycleMethods(slot: 'before' | 'after', eventObj: object): void {
  if (slot === 'before') {
    Object.assign(eventObj, BEFORE_LIFECYCLE_METHODS)
  } else {
    Object.assign(eventObj, AFTER_LIFECYCLE_METHODS)
  }
}
