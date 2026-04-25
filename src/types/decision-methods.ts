// Per-event decision-method types for the 20 events that are not the two
// tool-keyed DUs. The two tool-keyed DU method types — `PreToolUseDecisionMethods`
// and `PermissionRequestDecisionMethods` — stay in `src/types/contexts.ts`
// because they are generic over `ToolInput` and intersect into the per-variant
// arms of the DU. The 20 method types in this file are not generic over input.
//
// File-split rationale (PLAN-FEAT-0063 M3): adding all 20 method types into
// `contexts.ts` would push it past the ~300-line domain-doc convention. Splitting
// keeps `contexts.ts` focused on the context interfaces and isolates the
// per-event method-set declarations here.
//
// Composition pattern (PLAN-FEAT-0064 M2): each per-event method-set type is a
// one-line intersection over named primitives from `./method-primitives.js`.
// JSDoc reattaches to property declarations on the consumer type — the composed
// type is structurally `{ allow: ...; block: ...; skip: ... }`, so per-property
// JSDoc renders at hover. Where a JSDoc caveat must live on a sub-field of an
// opts bag (e.g. `sessionTitle` on `UserPromptSubmit.allow`), the caveat is
// hung on the field-bag primitive declaration in `./method-primitives.js`
// (`SessionTitle` carries the upstream-quirk note); primitive-level JSDoc still
// surfaces at hover, so all arms intersecting the primitive get it for free.
//
// Each method type is intersected onto its corresponding context interface in
// `src/types/contexts.ts`. The runtime constructors live in
// `src/engine/context-methods.ts` and are wired into `METHOD_SETS` keyed by
// `EventName`.

import type {
  DebugMessage,
  Inject,
  Reason,
  Feedback,
  Path,
  SessionTitle,
  UpdatedMcpToolOutput,
  Allow,
  Block,
  Skip,
  Stop,
  Retry,
  Success,
  Failure,
} from './method-primitives.js'
import type {
  UserPromptSubmitResult,
  StopEventResult,
  SubagentStopResult,
  ConfigChangeResult,
  PreCompactResult,
  PostToolUseResult,
  PermissionDeniedResult,
  SessionStartResult,
  SessionEndResult,
  InstructionsLoadedResult,
  PostToolUseFailureResult,
  NotificationResult,
  SubagentStartResult,
  WorktreeRemoveResult,
  PostCompactResult,
  StopFailureResult,
  WorktreeCreateResult,
  TeammateIdleResult,
  TaskCreatedResult,
  TaskCompletedResult,
} from './results.js'

// --- Guard events ---

/**
 * Decision methods for `UserPromptSubmitContext`.
 *
 * The `sessionTitle` field on every arm's opts bag is equivalent to running
 * `/rename`; see the JSDoc on the `SessionTitle` primitive for the
 * upstream-quirk caveat.
 */
export type UserPromptSubmitDecisionMethods = Allow<
  DebugMessage & Inject & SessionTitle,
  UserPromptSubmitResult
> &
  Block<Reason & Inject & SessionTitle, UserPromptSubmitResult> &
  Skip<DebugMessage & Inject & SessionTitle, UserPromptSubmitResult>

/**
 * Decision methods for `StopContext`.
 *
 * Note: the verb `stop` is NOT on `StopContext`. The `stop` verb belongs to
 * continuation events (`TeammateIdle`, `TaskCreated`, `TaskCompleted`). For the
 * `Stop` event the default behavior is to stop, so `block` is the verb that
 * prevents the stop.
 */
export type StopDecisionMethods = Allow<DebugMessage, StopEventResult> & {
  /**
   * Use this to *prevent* the stop. The verb `stop` belongs to continuation
   * events (`TeammateIdle`, `TaskCreated`, `TaskCompleted`); it does NOT exist
   * on `StopContext` because `Stop` is the *event* whose default behavior is
   * to stop. `reason` is required and tells Claude *why to continue* — it's
   * effectively the next-turn instruction.
   */
  block(opts: Reason): StopEventResult
} & Skip<DebugMessage, StopEventResult>

/**
 * Decision methods for `SubagentStopContext`. Mirrors `StopDecisionMethods`.
 */
export type SubagentStopDecisionMethods = Allow<DebugMessage, SubagentStopResult> & {
  /**
   * Use this to *prevent* the subagent's stop. The verb `stop` belongs to
   * continuation events (`TeammateIdle`, `TaskCreated`, `TaskCompleted`); it
   * does NOT exist on `SubagentStopContext` because `SubagentStop` is the
   * *event* whose default behavior is for the subagent to stop. `reason` is
   * required and is surfaced back to the subagent as next-step instruction.
   */
  block(opts: Reason): SubagentStopResult
} & Skip<DebugMessage, SubagentStopResult>

/**
 * Decision methods for `ConfigChangeContext`.
 *
 * Note: `policy_settings` changes cannot be blocked upstream — the engine
 * downgrades a `block` to `skip` and emits a `systemMessage` warning so authors
 * see the discrepancy.
 */
export type ConfigChangeDecisionMethods = Allow<DebugMessage, ConfigChangeResult> &
  Block<Reason, ConfigChangeResult> &
  Skip<DebugMessage, ConfigChangeResult>

/**
 * Decision methods for `PreCompactContext`.
 *
 * Per the upstream contract, PreCompact does not support `additionalContext`
 * on its result arms — none of the methods accept `injectContext`.
 */
export type PreCompactDecisionMethods = Allow<DebugMessage, PreCompactResult> &
  Block<Reason, PreCompactResult> &
  Skip<DebugMessage, PreCompactResult>

// --- Observe events ---

/**
 * Decision methods for `PostToolUseContext`.
 *
 * `PostToolUseContext` is intentionally flat (not promoted to a DU) — see
 * PLAN-FEAT-0063 Decision Log "PostToolUseContext stays flat." `toolName` is
 * `string`, so the `updatedMCPToolOutput` MCP-only caveat is documented in
 * JSDoc and not enforced at the type level.
 */
export type PostToolUseDecisionMethods = Block<
  Reason & Inject & UpdatedMcpToolOutput,
  PostToolUseResult
> &
  Skip<DebugMessage & Inject & UpdatedMcpToolOutput, PostToolUseResult>

/**
 * Decision methods for `PermissionDeniedContext`.
 *
 * `retry: true` does not reverse the denial — it adds a hint that the model
 * may retry. The denial itself stands. Only fires in auto mode.
 */
export type PermissionDeniedDecisionMethods = Retry<DebugMessage, PermissionDeniedResult> &
  Skip<DebugMessage, PermissionDeniedResult>

export type SessionStartDecisionMethods = Skip<DebugMessage & Inject, SessionStartResult>

export type SessionEndDecisionMethods = Skip<DebugMessage, SessionEndResult>

export type InstructionsLoadedDecisionMethods = Skip<DebugMessage, InstructionsLoadedResult>

export type PostToolUseFailureDecisionMethods = Skip<
  DebugMessage & Inject,
  PostToolUseFailureResult
>

export type NotificationDecisionMethods = Skip<DebugMessage & Inject, NotificationResult>

export type SubagentStartDecisionMethods = Skip<DebugMessage & Inject, SubagentStartResult>

export type WorktreeRemoveDecisionMethods = Skip<DebugMessage, WorktreeRemoveResult>

export type PostCompactDecisionMethods = Skip<DebugMessage, PostCompactResult>

// --- Notify-only events ---

/**
 * Decision methods for `StopFailureContext`.
 */
export type StopFailureDecisionMethods = {
  /**
   * Output is dropped upstream by Claude Code. This method exists for API
   * uniformity. Side-effects (logging, alerts) inside the handler still run;
   * the method only constructs the engine-side telemetry result.
   */
  skip(opts?: DebugMessage): StopFailureResult
}

// --- Implementation events ---

/**
 * Decision methods for `WorktreeCreateContext`.
 *
 * The hook *replaces* default `git worktree` behavior. `success.path` must be
 * an absolute path to the created worktree. `failure.reason` becomes the
 * surfaced error.
 */
export type WorktreeCreateDecisionMethods = Success<Path, WorktreeCreateResult> &
  Failure<Reason, WorktreeCreateResult>

// --- Continuation events ---

/**
 * Decision methods for `TeammateIdleContext`.
 *
 * - `continue` — "Keep working past idle." Sends `feedback` to the teammate
 *   and the teammate continues its loop.
 * - `stop` — terminate the teammate; `reason` is the `stopReason` shown to
 *   the user.
 */
export type TeammateIdleDecisionMethods = {
  /**
   * Keep working past idle. The teammate's loop continues; `feedback` is sent
   * back as a stderr-equivalent retry signal.
   */
  continue(opts: Feedback): TeammateIdleResult
} & Stop<Reason, TeammateIdleResult> &
  Skip<DebugMessage, TeammateIdleResult>

/**
 * Decision methods for `TaskCreatedContext`.
 *
 * - `continue` — "Don't create the task; feed feedback to the model." The task
 *   is not created; `feedback` is sent back to the model as stderr-equivalent.
 * - `stop` — terminate the teammate entirely.
 */
export type TaskCreatedDecisionMethods = {
  /**
   * Don't create the task; feed feedback to the model. The task creation is
   * blocked; `feedback` is sent back to the model as stderr-equivalent.
   */
  continue(opts: Feedback): TaskCreatedResult
} & Stop<Reason, TaskCreatedResult> &
  Skip<DebugMessage, TaskCreatedResult>

/**
 * Decision methods for `TaskCompletedContext`.
 *
 * - `continue` — "Don't mark complete; feed feedback to the model." The task
 *   is not marked complete; `feedback` is sent back to the model as
 *   stderr-equivalent.
 * - `stop` — terminate the teammate entirely.
 */
export type TaskCompletedDecisionMethods = {
  /**
   * Don't mark complete; feed feedback to the model. The completion is
   * blocked; `feedback` is sent back to the model as stderr-equivalent.
   */
  continue(opts: Feedback): TaskCompletedResult
} & Stop<Reason, TaskCompletedResult> &
  Skip<DebugMessage, TaskCompletedResult>
