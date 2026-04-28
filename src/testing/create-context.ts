// Test helper for constructing properly-attached context objects.
//
// Lives in `src/testing/` (NOT `src/test-utils.ts` and NOT re-exported from
// `src/types/index.ts`) so the type-only public package surface stays free of
// engine-runtime imports — see PLAN-FEAT-0063 Decision Log "createContext placement".

import type { EventName } from '../types/branded.js'
import type {
  BaseContext,
  PreToolUseContext,
  UnknownPreToolUseContext,
  UserPromptSubmitContext,
  PermissionRequestContext,
  UnknownPermissionRequestContext,
  PermissionDeniedContext,
  StopContext,
  StopFailureContext,
  SubagentStopContext,
  SubagentStartContext,
  ConfigChangeContext,
  SessionStartContext,
  SessionEndContext,
  InstructionsLoadedContext,
  PostToolUseContext,
  PostToolUseFailureContext,
  NotificationContext,
  WorktreeRemoveContext,
  PreCompactContext,
  PostCompactContext,
  WorktreeCreateContext,
  TeammateIdleContext,
  TaskCreatedContext,
  TaskCompletedContext,
} from '../types/contexts.js'
import { attachDecisionMethods } from '../engine/context-methods.js'

/**
 * Per-event context-map used by `createContext`. Mirrors `EventContextMap` from
 * `src/types/lifecycle.ts` — duplicated locally to avoid pulling lifecycle types
 * into the testing surface.
 */
export interface CreateContextEventMap {
  PreToolUse: PreToolUseContext | UnknownPreToolUseContext
  PostToolUse: PostToolUseContext
  UserPromptSubmit: UserPromptSubmitContext
  SessionStart: SessionStartContext
  SessionEnd: SessionEndContext
  Stop: StopContext
  StopFailure: StopFailureContext
  SubagentStop: SubagentStopContext
  SubagentStart: SubagentStartContext
  InstructionsLoaded: InstructionsLoadedContext
  PostToolUseFailure: PostToolUseFailureContext
  Notification: NotificationContext
  PermissionRequest: PermissionRequestContext | UnknownPermissionRequestContext
  PermissionDenied: PermissionDeniedContext
  ConfigChange: ConfigChangeContext
  WorktreeCreate: WorktreeCreateContext
  WorktreeRemove: WorktreeRemoveContext
  PreCompact: PreCompactContext
  PostCompact: PostCompactContext
  TeammateIdle: TeammateIdleContext
  TaskCreated: TaskCreatedContext
  TaskCompleted: TaskCompletedContext
}

/**
 * Fields the helper supplies defaults for. Callers may override any of them.
 */
type BaseDefaultedKeys = 'sessionId' | 'cwd' | 'transcriptPath' | 'parallel' | 'signal' | 'event'

/**
 * Decision-method keys the helper attaches at runtime via
 * `attachDecisionMethods`. Callers must NOT supply these in the payload — they
 * are intersected onto the variant types but produced by the helper.
 */
type DecisionMethodKeys =
  | 'allow'
  | 'ask'
  | 'block'
  | 'defer'
  | 'skip'
  | 'success'
  | 'failure'
  | 'continue'
  | 'stop'
  | 'retry'

/**
 * Per-event payload type. Caller supplies the event-specific fields and may
 * override any `BaseContext` defaults; the helper supplies the rest plus
 * `event: <E>` and the `signal`.
 *
 * For the two tool-keyed DU events (`PreToolUse` and `PermissionRequest`) the
 * payload type distributes `Omit` across the union so each tool-arm preserves
 * its narrowed `toolInput`. For the remaining 20 events the payload is a
 * single `Omit<EventContext, ...>` form — `BaseDefaultedKeys` and
 * `DecisionMethodKeys` are stripped because the helper supplies the defaults
 * and the runtime attaches the methods.
 */
export type CreateContextPayload<E extends EventName> = E extends 'PreToolUse'
  ? PreToolUsePayload
  : E extends 'PermissionRequest'
    ? PermissionRequestPayload
    : Omit<CreateContextEventMap[E], BaseDefaultedKeys | DecisionMethodKeys> & Partial<BaseContext>

// PreToolUse is a discriminated union; we need to distribute Omit across the
// union so the resulting payload type stays a DU on `toolName`. Decision
// methods are stripped — the helper attaches them at runtime.
type DistributePreToolUseOmit<U> = U extends PreToolUseContext
  ? Omit<U, BaseDefaultedKeys | DecisionMethodKeys> & Partial<BaseContext>
  : never

type PreToolUsePayload =
  | DistributePreToolUseOmit<PreToolUseContext>
  | (Omit<UnknownPreToolUseContext, BaseDefaultedKeys | DecisionMethodKeys> & Partial<BaseContext>)

// PermissionRequest is also a DU after M2; mirror the PreToolUse pattern.
type DistributePermissionRequestOmit<U> = U extends PermissionRequestContext
  ? Omit<U, BaseDefaultedKeys | DecisionMethodKeys> & Partial<BaseContext>
  : never

type PermissionRequestPayload =
  | DistributePermissionRequestOmit<PermissionRequestContext>
  | (Omit<UnknownPermissionRequestContext, BaseDefaultedKeys | DecisionMethodKeys> &
      Partial<BaseContext>)

/**
 * Build a per-event context object with sensible `BaseContext` defaults, the
 * caller's payload spread on top, and the per-event decision methods attached.
 *
 * Returns the same shape the engine builds at runtime, so handler code under
 * test sees identical behavior to production invocations.
 */
export function createContext<E extends EventName>(
  event: E,
  payload: CreateContextPayload<E>,
): CreateContextEventMap[E] {
  const base: BaseContext = {
    event,
    sessionId: 'test-session',
    cwd: '/tmp',
    transcriptPath: '/tmp/transcript.json',
    parallel: false,
    signal: new AbortController().signal,
  }
  // Caller's payload wins over defaults; `event` is then re-pinned to the
  // requested literal.
  const ctx: Record<string, unknown> = {
    ...base,
    ...(payload as Record<string, unknown>),
    event,
  }
  attachDecisionMethods(event, ctx)
  return ctx as unknown as CreateContextEventMap[E]
}

/**
 * Harness-flavored variant of `createContext` for `clooks test`. Pre-populates
 * the harness-spec defaults via the existing `Partial<BaseContext>` payload
 * override surface and delegates to `createContext`.
 *
 * Defaults applied (overridable by the caller's payload):
 * - `sessionId: 'test-session-0000000000000000'`
 * - `cwd: process.cwd()`
 * - `transcriptPath: '/tmp/clooks-test-transcript.jsonl'`
 * - `parallel: false`
 * - `signal: new AbortController().signal` (real signal, never aborted)
 *
 * `createContext`'s own defaults are deliberately untouched — existing in-repo
 * unit tests and the Docker E2E sandbox depend on them. See
 * `docs/plans/PLAN-FEAT-0067-clooks-test-harness.md` Decision Log.
 */
export function createHarnessContext<E extends EventName>(
  event: E,
  payload: CreateContextPayload<E>,
): CreateContextEventMap[E] {
  const harnessDefaults: Partial<BaseContext> = {
    sessionId: 'test-session-0000000000000000',
    cwd: process.cwd(),
    transcriptPath: '/tmp/clooks-test-transcript.jsonl',
    parallel: false,
    signal: new AbortController().signal,
  }
  // Caller's payload wins over harness defaults.
  const merged = {
    ...harnessDefaults,
    ...(payload as Record<string, unknown>),
  } as CreateContextPayload<E>
  return createContext(event, merged)
}
