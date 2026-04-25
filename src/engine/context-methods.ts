// Decision-method runtime: per-event method-set table + attach factory.
//
// Methods are pure value constructors — `(opts?) => ({ result: '<tag>', ...opts })`.
// They do not consult `ctx`, do not call any engine API, and have no side effects.
// `attachDecisionMethods(eventName, ctx)` mutates `ctx` in place via `Object.assign`,
// adding the per-event method set so handler code can write `ctx.allow({...})`.
//
// M1 intentionally only wires the PreToolUse method set; remaining events ship in
// M2/M3. For events without a wired set, `attachDecisionMethods` is a no-op
// (`Object.assign(ctx, {})`), so handlers using plain-object returns continue to
// work unchanged. The table type still requires every `EventName` key, providing
// compile-time exhaustiveness.

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
} from '../types/results.js'
import type { Inject } from '../types/method-primitives.js'
import type { PermissionUpdateEntry } from '../types/permissions.js'

// --- Per-result-tag pure constructors ---
//
// Each constructor mirrors the corresponding result type from `src/types/results.ts`.
// The opts bag is spread onto a literal-tagged object. No `ctx` access; no closures.

export interface AllowOpts extends Inject {
  updatedInput?: Record<string, unknown>
  reason?: string
  debugMessage?: string
  // PermissionRequest extends with updatedPermissions; carried via the same
  // constructor since the spread is structural and the per-event TS signature
  // narrows what the caller can legally pass.
  updatedPermissions?: PermissionUpdateEntry[]
  // UserPromptSubmit extends with sessionTitle.
  sessionTitle?: string
}

export interface AskOpts extends Inject {
  reason: string
  updatedInput?: Record<string, unknown>
  debugMessage?: string
}

export interface BlockOpts extends Inject {
  reason: string
  debugMessage?: string
  // PermissionRequest.block extends with interrupt.
  interrupt?: boolean
  // PostToolUse.block extends with updatedMCPToolOutput.
  updatedMCPToolOutput?: unknown
  // UserPromptSubmit.block extends with sessionTitle.
  sessionTitle?: string
}

export interface DeferOpts {
  debugMessage?: string
}

export interface SkipOpts extends Inject {
  debugMessage?: string
  // PostToolUse.skip extends with updatedMCPToolOutput.
  updatedMCPToolOutput?: unknown
}

export interface SuccessOpts {
  path: string
  debugMessage?: string
}

export interface FailureOpts {
  reason: string
  debugMessage?: string
}

export interface ContinueOpts {
  feedback: string
  debugMessage?: string
}

export interface StopOpts {
  reason: string
  debugMessage?: string
}

export interface RetryOpts {
  debugMessage?: string
}

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
// `Record<EventName, ...>` enforces compile-time exhaustiveness: if a new event
// is added to `EventName`, this object will fail to compile until the entry is
// added. M1 only wires PreToolUse with `{ allow, ask, block, defer, skip }`.
// All other events use `{}` as a sentinel — `attachDecisionMethods` falls back
// to a no-op `Object.assign(ctx, {})` so plain-object returns keep working.

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
