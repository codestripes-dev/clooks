import type {
  DebugMessage,
  InjectContext,
  Reason,
  Feedback,
  Path,
  SessionTitle,
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
  PermissionDeniedResult,
  SessionStartResult,
  SessionEndResult,
  InstructionsLoadedResult,
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

export type UserPromptSubmitDecisionMethods = Allow<
  InjectContext & SessionTitle,
  UserPromptSubmitResult
> &
  Block<Reason & InjectContext & SessionTitle, UserPromptSubmitResult> &
  Skip<InjectContext & SessionTitle, UserPromptSubmitResult>

/**
 * `block({ reason })` prevents the agent from stopping; `reason` tells Claude
 * what to do next. There's no `stop` verb — stopping is the default.
 */
export type StopDecisionMethods = Allow<DebugMessage, StopEventResult> &
  Block<Reason, StopEventResult> &
  Skip<DebugMessage, StopEventResult>

/** Mirrors `StopDecisionMethods`, but for a subagent. */
export type SubagentStopDecisionMethods = Allow<DebugMessage, SubagentStopResult> &
  Block<Reason, SubagentStopResult> &
  Skip<DebugMessage, SubagentStopResult>

/**
 * `block` is silently downgraded to `skip` for `source: 'policy_settings'` —
 * those changes can't be blocked upstream.
 */
export type ConfigChangeDecisionMethods = Allow<DebugMessage, ConfigChangeResult> &
  Block<Reason, ConfigChangeResult> &
  Skip<DebugMessage, ConfigChangeResult>

/** PreCompact decisions don't accept `injectContext` — upstream contract doesn't carry it. */
export type PreCompactDecisionMethods = Allow<DebugMessage, PreCompactResult> &
  Block<Reason, PreCompactResult> &
  Skip<DebugMessage, PreCompactResult>

/**
 * `retry()` does NOT reverse the denial — the call stays denied. It only
 * hints that the model may try again. `skip` is a no-op.
 */
export type PermissionDeniedDecisionMethods = Retry<DebugMessage, PermissionDeniedResult> &
  Skip<DebugMessage, PermissionDeniedResult>

export type SessionStartDecisionMethods = Skip<InjectContext, SessionStartResult>

export type SessionEndDecisionMethods = Skip<DebugMessage, SessionEndResult>

export type InstructionsLoadedDecisionMethods = Skip<DebugMessage, InstructionsLoadedResult>

export type NotificationDecisionMethods = Skip<InjectContext, NotificationResult>

export type SubagentStartDecisionMethods = Skip<InjectContext, SubagentStartResult>

export type WorktreeRemoveDecisionMethods = Skip<DebugMessage, WorktreeRemoveResult>

export type PostCompactDecisionMethods = Skip<DebugMessage, PostCompactResult>

/**
 * Output is dropped upstream. `skip` exists for API uniformity — your handler
 * runs for side-effects (logging, alerting) only.
 */
export type StopFailureDecisionMethods = Skip<DebugMessage, StopFailureResult>

/**
 * Hooks REPLACE Claude Code's default `git worktree` behavior.
 * - `success({ path })` — the absolute path to the created worktree.
 * - `failure({ reason })` — the error to surface to the user.
 */
export type WorktreeCreateDecisionMethods = Success<Path, WorktreeCreateResult> &
  Failure<Reason, WorktreeCreateResult>

/**
 * - `continue({ feedback })` — keep the teammate working past idle.
 * - `stop({ reason })` — terminate the teammate.
 */
export type TeammateIdleDecisionMethods = Continue<Feedback, TeammateIdleResult> &
  Stop<Reason, TeammateIdleResult> &
  Skip<DebugMessage, TeammateIdleResult>

/**
 * - `continue({ feedback })` — refuse to create the task; `feedback` is sent
 *   back to the model.
 * - `stop({ reason })` — terminate the teammate.
 */
export type TaskCreatedDecisionMethods = Continue<Feedback, TaskCreatedResult> &
  Stop<Reason, TaskCreatedResult> &
  Skip<DebugMessage, TaskCreatedResult>

/**
 * - `continue({ feedback })` — refuse to mark the task complete; `feedback` is
 *   sent back to the model.
 * - `stop({ reason })` — terminate the teammate.
 */
export type TaskCompletedDecisionMethods = Continue<Feedback, TaskCompletedResult> &
  Stop<Reason, TaskCompletedResult> &
  Skip<DebugMessage, TaskCompletedResult>
