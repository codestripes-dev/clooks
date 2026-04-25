// Base result types and per-event result types.
// Each base result composes `Result<'<tag>'>` (which bakes DebugMessage) with
// at most one per-tag field bag (`Reason`, `Feedback`, `Path`).
// InjectContext is intersected where Claude Code supports additionalContext.

import type {
  InjectContext,
  Reason,
  Feedback,
  Path,
  SessionTitle,
  UpdatedPermissions,
  UpdatedMcpToolOutput,
  Interrupt,
  UpdatedInput,
  Result,
} from './method-primitives.js'

/** Union of all result discriminant values across all base result types. */
export type ResultTag =
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

export type AllowResult = Result<'allow'>
export type SkipResult = Result<'skip'>
/**
 * PreToolUse `defer` decision. Pauses the tool call so a headless
 * `claude -p` caller can resume via `claude -p --resume`. Only honored
 * in -p mode AND only when the turn contains a single tool call.
 * Otherwise Claude Code ignores this result.
 *
 * Upstream ignores reason / updatedInput / additionalContext for
 * defer. This type forbids all three at compile time.
 */
export type DeferResult = Result<'defer'>
export type RetryResult = Result<'retry'>
/**
 * PreToolUse `ask` decision. Upstream displays the permission prompt
 * to the user with permissionDecisionReason as the prompt text.
 * The source label ([Project]/[User]/[Plugin]/[Local]) is added by
 * Claude Code — reason should disambiguate which hook asked.
 */
export type AskResult = Result<'ask'> & Reason
export type BlockResult = Result<'block'> & Reason
export type StopResult = Result<'stop'> & Reason
export type FailureResult = Result<'failure'> & Reason
export type ContinueResult = Result<'continue'> & Feedback
export type SuccessResult = Result<'success'> & Path

// --- Per-event result types ---

// Guard events — allow | ask | block | defer | skip
export type PreToolUseResult =
  // `Partial<Reason>`: optional `reason?: string` surfaced as
  // `hookSpecificOutput.permissionDecisionReason` on allow per upstream's
  // decision-control contract.
  | (AllowResult & InjectContext & UpdatedInput<Record<string, unknown>> & Partial<Reason>)
  | (AskResult & InjectContext & UpdatedInput<Record<string, unknown>>)
  | (BlockResult & InjectContext)
  | DeferResult
  | (SkipResult & InjectContext)
export type UserPromptSubmitResult = (AllowResult | BlockResult | SkipResult) &
  InjectContext &
  SessionTitle
export type PermissionRequestResult =
  | (AllowResult & UpdatedInput<Record<string, unknown>> & UpdatedPermissions)
  | (BlockResult & Interrupt)
  | SkipResult
export type StopEventResult = AllowResult | BlockResult | SkipResult
export type SubagentStopResult = AllowResult | BlockResult | SkipResult
export type ConfigChangeResult = AllowResult | BlockResult | SkipResult
export type PreCompactResult = AllowResult | BlockResult | SkipResult

// Notify-only events — skip only, output is dropped upstream
// StopFailureResult is intentionally NOT intersected with InjectContext:
// upstream drops all output, so additionalContext would silently never reach Claude.
export type StopFailureResult = SkipResult

// Observe events — skip only
export type SessionStartResult = SkipResult & InjectContext
export type SessionEndResult = SkipResult
export type InstructionsLoadedResult = SkipResult
export type PostToolUseResult =
  | (SkipResult & InjectContext & UpdatedMcpToolOutput)
  | (BlockResult & InjectContext & UpdatedMcpToolOutput)
export type PostToolUseFailureResult = SkipResult & InjectContext
export type NotificationResult = SkipResult & InjectContext
export type SubagentStartResult = SkipResult & InjectContext
export type WorktreeRemoveResult = SkipResult
export type PostCompactResult = SkipResult

export type PermissionDeniedResult = RetryResult | SkipResult

// Implementation events — success | failure
export type WorktreeCreateResult = SuccessResult | FailureResult

// Continuation events — continue | stop | skip
export type TeammateIdleResult = ContinueResult | StopResult | SkipResult
export type TaskCreatedResult = ContinueResult | StopResult | SkipResult
export type TaskCompletedResult = ContinueResult | StopResult | SkipResult
