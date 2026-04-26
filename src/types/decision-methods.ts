// Decision-method records for the 18 events that aren't tool-keyed.
// These get intersected into each event's context so authors call
// `ctx.allow(...)`, `ctx.block(...)`, etc. — fully typed.

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

// --- Guard events ---

export type UserPromptSubmitDecisionMethods = Allow<
  InjectContext & SessionTitle,
  UserPromptSubmitResult
> &
  Block<Reason & InjectContext & SessionTitle, UserPromptSubmitResult> &
  Skip<InjectContext & SessionTitle, UserPromptSubmitResult>

/**
 * `Stop` has no `stop` verb — `Stop` is the event whose default IS to stop.
 * Use `block({ reason })` to prevent the agent from stopping; `reason` tells
 * Claude what to do next.
 */
export type StopDecisionMethods = Allow<DebugMessage, StopEventResult> &
  Block<Reason, StopEventResult> &
  Skip<DebugMessage, StopEventResult>

/** Mirrors `StopDecisionMethods`. Use `block({ reason })` to prevent the subagent from stopping. */
export type SubagentStopDecisionMethods = Allow<DebugMessage, SubagentStopResult> &
  Block<Reason, SubagentStopResult> &
  Skip<DebugMessage, SubagentStopResult>

/**
 * `policy_settings` changes cannot actually be blocked upstream — the engine
 * downgrades a `block` to `skip` and emits a warning so you can see the
 * discrepancy.
 */
export type ConfigChangeDecisionMethods = Allow<DebugMessage, ConfigChangeResult> &
  Block<Reason, ConfigChangeResult> &
  Skip<DebugMessage, ConfigChangeResult>

/** PreCompact decisions don't accept `injectContext` — upstream contract doesn't carry it. */
export type PreCompactDecisionMethods = Allow<DebugMessage, PreCompactResult> &
  Block<Reason, PreCompactResult> &
  Skip<DebugMessage, PreCompactResult>

// --- Observe events ---

/**
 * `retry({ })` does NOT reverse the denial — the call stays denied. It only
 * sets a flag hinting that the model may try again. `skip` is a no-op.
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

// --- Notify-only events ---

/**
 * Output is dropped upstream. `skip` exists for API uniformity — your handler
 * runs for side-effects (logging, alerting) only.
 */
export type StopFailureDecisionMethods = Skip<DebugMessage, StopFailureResult>

// --- Implementation events ---

/**
 * Your hook REPLACES Claude Code's default `git worktree` behavior.
 * - `success({ path })` — the absolute path to the created worktree.
 * - `failure({ reason })` — the error to surface to the user.
 */
export type WorktreeCreateDecisionMethods = Success<Path, WorktreeCreateResult> &
  Failure<Reason, WorktreeCreateResult>

// --- Continuation events ---

/**
 * - `continue({ feedback })` — keep the teammate working past idle. `feedback`
 *   is the next-step instruction.
 * - `stop({ reason })` — terminate the teammate. `reason` is shown to the user.
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
