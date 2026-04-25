// Decision-method runtime: per-event method-set table + attach factory.
//
// Methods are pure value constructors — `(opts?) => ({ result: '<tag>', ...opts })`.
// They do not consult `ctx`, do not call any engine API, and have no side effects.
// `attachDecisionMethods(eventName, ctx)` mutates `ctx` in place via `Object.assign`,
// adding the per-event method set so handler code can write `ctx.allow({...})`.
//
// The METHOD_SETS table below is fully wired — every EventName carries at least
// one method. The `undefined` branch in `attachDecisionMethods` guards against
// `as EventName` escape-hatch misuse at runtime, not against missing entries.
// `Record<EventName, …>` enforces compile-time exhaustiveness: a new event added
// to `EventName` will fail to compile until its method set is added below.

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
} from '../types'
import type {
  DebugMessage,
  Inject,
  Interrupt,
  SessionTitle,
  UpdatedMcpToolOutput,
  UpdatedPermissions,
} from '../types/method-primitives.js'

// --- Per-result-tag pure constructors ---
//
// Each constructor mirrors the corresponding result type from `src/types/results.ts`.
// The opts bag is spread onto a literal-tagged object. No `ctx` access; no closures.
//
// Composition note (PLAN-FEAT-0064B M2): each `*Opts` interface composes from the
// optional field-bag primitives in `src/types/method-primitives.ts` via `extends`,
// and inlines required fields (`reason`, `feedback`, `path`). Required-field
// primitives (`Reason`, `Feedback`, `Path`) are bundled with `DebugMessage` at
// their source declarations — extending them here alongside an explicit
// `extends DebugMessage` would silently merge identical inheritance (harmless,
// but reads as redundant). The runtime is structurally lenient; the per-event
// TS-side method types narrow what callers can legally pass. See PLAN-FEAT-0064B
// Decision Log entry "Runtime-parity audit conclusion (Open Question 8 resolution)".

export interface AllowOpts extends DebugMessage, Inject, SessionTitle, UpdatedPermissions {
  reason?: string
  updatedInput?: Record<string, unknown>
}

export interface AskOpts extends DebugMessage, Inject {
  reason: string
  updatedInput?: Record<string, unknown>
}

export interface BlockOpts
  extends DebugMessage, Inject, Interrupt, UpdatedMcpToolOutput, SessionTitle {
  reason: string
}

export type DeferOpts = DebugMessage

export interface SkipOpts extends DebugMessage, Inject, UpdatedMcpToolOutput {}

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
// constructor is exported as `cont`. M3 wires it into METHOD_SETS under the property
// key 'continue' (object property names are not subject to the reserved-word
// restriction), so hook authors call `ctx.continue()` at runtime — the property key,
// not the function name, is what they see. The export name is internal-only.
export function cont(opts: ContinueOpts): ContinueResult & Record<string, unknown> {
  return { result: 'continue', ...opts }
}

export function stop(opts: StopOpts): StopResult & Record<string, unknown> {
  return { result: 'stop', ...opts }
}

export function retry(opts: RetryOpts = {}): RetryResult & Record<string, unknown> {
  return { result: 'retry', ...opts }
}

// --- Per-event method-set table ---
//
// Maps each `EventName` to its subset of decision-method constructors. Hook
// authors writing `ctx.allow({...})` invoke the entry from this table for
// their event. `Record<EventName, ...>` enforces compile-time exhaustiveness:
// adding a new event to `EventName` fails compilation until its entry exists.

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
  // `'continue'` (object property names are not subject to the strict-mode
  // reserved-word restriction that prevents declaring a function called
  // `continue`). Hook authors call `ctx.continue()`.
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
