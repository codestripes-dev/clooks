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
  EventBlockOptsMap,
  EventSkipOptsMap,
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
  Block<EventBlockOptsMap['UserPromptSubmit'], UserPromptSubmitResult> &
  Skip<EventSkipOptsMap['UserPromptSubmit'], UserPromptSubmitResult>

/**
 * `block({ reason })` prevents the agent from stopping; `reason` tells Claude
 * what to do next. There's no `stop` verb — stopping is the default.
 */
export type StopDecisionMethods = Allow<DebugMessage, StopEventResult> &
  Block<EventBlockOptsMap['Stop'], StopEventResult> &
  Skip<EventSkipOptsMap['Stop'], StopEventResult>

/** Mirrors `StopDecisionMethods`, but for a subagent. */
export type SubagentStopDecisionMethods = Allow<DebugMessage, SubagentStopResult> &
  Block<EventBlockOptsMap['SubagentStop'], SubagentStopResult> &
  Skip<EventSkipOptsMap['SubagentStop'], SubagentStopResult>

/**
 * `block` is silently downgraded to `skip` for `source: 'policy_settings'` —
 * those changes can't be blocked upstream.
 */
export type ConfigChangeDecisionMethods = Allow<DebugMessage, ConfigChangeResult> &
  Block<EventBlockOptsMap['ConfigChange'], ConfigChangeResult> &
  Skip<EventSkipOptsMap['ConfigChange'], ConfigChangeResult>

/** PreCompact decisions don't accept `injectContext` — upstream contract doesn't carry it. */
export type PreCompactDecisionMethods = Allow<DebugMessage, PreCompactResult> &
  Block<EventBlockOptsMap['PreCompact'], PreCompactResult> &
  Skip<EventSkipOptsMap['PreCompact'], PreCompactResult>

/**
 * `retry()` does NOT reverse the denial — the call stays denied. It only
 * hints that the model may try again. `skip` is a no-op.
 */
export type PermissionDeniedDecisionMethods = Retry<DebugMessage, PermissionDeniedResult> &
  Skip<EventSkipOptsMap['PermissionDenied'], PermissionDeniedResult>

export type SessionStartDecisionMethods = Skip<EventSkipOptsMap['SessionStart'], SessionStartResult>

export type SessionEndDecisionMethods = Skip<EventSkipOptsMap['SessionEnd'], SessionEndResult>

export type InstructionsLoadedDecisionMethods = Skip<
  EventSkipOptsMap['InstructionsLoaded'],
  InstructionsLoadedResult
>

export type NotificationDecisionMethods = Skip<EventSkipOptsMap['Notification'], NotificationResult>

export type SubagentStartDecisionMethods = Skip<
  EventSkipOptsMap['SubagentStart'],
  SubagentStartResult
>

export type WorktreeRemoveDecisionMethods = Skip<
  EventSkipOptsMap['WorktreeRemove'],
  WorktreeRemoveResult
>

export type PostCompactDecisionMethods = Skip<EventSkipOptsMap['PostCompact'], PostCompactResult>

/**
 * Output is dropped upstream. `skip` exists for API uniformity — your handler
 * runs for side-effects (logging, alerting) only.
 */
export type StopFailureDecisionMethods = Skip<EventSkipOptsMap['StopFailure'], StopFailureResult>

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
  Skip<EventSkipOptsMap['TeammateIdle'], TeammateIdleResult>

/**
 * - `continue({ feedback })` — refuse to create the task; `feedback` is sent
 *   back to the model.
 * - `stop({ reason })` — terminate the teammate.
 */
export type TaskCreatedDecisionMethods = Continue<Feedback, TaskCreatedResult> &
  Stop<Reason, TaskCreatedResult> &
  Skip<EventSkipOptsMap['TaskCreated'], TaskCreatedResult>

/**
 * - `continue({ feedback })` — refuse to mark the task complete; `feedback` is
 *   sent back to the model.
 * - `stop({ reason })` — terminate the teammate.
 */
export type TaskCompletedDecisionMethods = Continue<Feedback, TaskCompletedResult> &
  Stop<Reason, TaskCompletedResult> &
  Skip<EventSkipOptsMap['TaskCompleted'], TaskCompletedResult>
