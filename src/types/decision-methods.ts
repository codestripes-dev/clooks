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
// Composition pattern (PLAN-FEAT-0064C): each per-event method-set type is a
// one-line intersection over named method-shape primitives (`Allow<O, R>`,
// `Block<O, R>`, `Skip<O, R>`, …) from `./method-primitives.js`. Method-shape
// primitives carry no per-property JSDoc — TypeScript does not propagate
// type-alias-level JSDoc to method-property hover sites when an alias is
// intersected. Caveats that previously lived on inline method declarations have
// moved to the type-level JSDoc on the enclosing `*DecisionMethods` type;
// authors hovering the type itself (or navigating to source) see the caveat,
// method-property hover may not surface it. See PLAN-FEAT-0064C Decision Log
// "Drop the JSDoc-on-method-property hover preservation concern" (2026-04-25).
// Caveats that pertain to a field on an opts bag (e.g. `sessionTitle` on
// `UserPromptSubmit.allow`, `updatedMCPToolOutput` on `PostToolUse.block`) live
// on the field-bag primitive declaration in `./method-primitives.js` —
// primitive-level JSDoc on a property does surface at hover, so all arms
// intersecting the primitive inherit it.
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
  Continue,
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
 * continuation events (`TeammateIdle`, `TaskCreated`, `TaskCompleted`); it
 * does NOT exist on `StopContext` because `Stop` is the *event* whose default
 * behavior is to stop. For the `Stop` event, `block` is the verb that
 * *prevents* the stop — the required `reason` tells Claude *why to continue*,
 * effectively the next-turn instruction.
 */
export type StopDecisionMethods = Allow<DebugMessage, StopEventResult> &
  Block<Reason, StopEventResult> &
  Skip<DebugMessage, StopEventResult>

/**
 * Decision methods for `SubagentStopContext`. Mirrors `StopDecisionMethods`.
 *
 * Use `block` to *prevent* the subagent's stop. The verb `stop` belongs to
 * continuation events (`TeammateIdle`, `TaskCreated`, `TaskCompleted`); it
 * does NOT exist on `SubagentStopContext` because `SubagentStop` is the
 * *event* whose default behavior is for the subagent to stop. The required
 * `reason` is surfaced back to the subagent as next-step instruction.
 */
export type SubagentStopDecisionMethods = Allow<DebugMessage, SubagentStopResult> &
  Block<Reason, SubagentStopResult> &
  Skip<DebugMessage, SubagentStopResult>

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
 *
 * Output is dropped upstream by Claude Code. `skip` exists for API
 * uniformity. Side-effects (logging, alerts) inside the handler still run;
 * the method only constructs the engine-side telemetry result.
 */
export type StopFailureDecisionMethods = Skip<DebugMessage, StopFailureResult>

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
export type TeammateIdleDecisionMethods = Continue<Feedback, TeammateIdleResult> &
  Stop<Reason, TeammateIdleResult> &
  Skip<DebugMessage, TeammateIdleResult>

/**
 * Decision methods for `TaskCreatedContext`.
 *
 * - `continue` — "Don't create the task; feed feedback to the model." The task
 *   is not created; `feedback` is sent back to the model as stderr-equivalent.
 * - `stop` — terminate the teammate entirely.
 */
export type TaskCreatedDecisionMethods = Continue<Feedback, TaskCreatedResult> &
  Stop<Reason, TaskCreatedResult> &
  Skip<DebugMessage, TaskCreatedResult>

/**
 * Decision methods for `TaskCompletedContext`.
 *
 * - `continue` — "Don't mark complete; feed feedback to the model." The task
 *   is not marked complete; `feedback` is sent back to the model as
 *   stderr-equivalent.
 * - `stop` — terminate the teammate entirely.
 */
export type TaskCompletedDecisionMethods = Continue<Feedback, TaskCompletedResult> &
  Stop<Reason, TaskCompletedResult> &
  Skip<DebugMessage, TaskCompletedResult>
