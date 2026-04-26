// Result types — what each event handler returns. Most users construct
// these via `ctx.allow(...)`, `ctx.block(...)`, etc. rather than building
// them by hand.

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

/** Every possible value of a result's `result` discriminant. */
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

/** `{ result: 'allow' }` — proceed with the action. */
export type AllowResult = Result<'allow'>

/** `{ result: 'skip' }` — opt out of deciding; let other hooks (or Claude Code's defaults) handle it. */
export type SkipResult = Result<'skip'>

/**
 * `{ result: 'defer' }` — pause the tool call so a headless `claude -p`
 * caller can resume later. Honored only in `claude -p` mode AND only when
 * the turn contains a single tool call. Otherwise Claude Code ignores it.
 */
export type DeferResult = Result<'defer'>

/** `{ result: 'retry' }` — only valid on `PermissionDenied`. Hint that the model may retry. */
export type RetryResult = Result<'retry'>

/**
 * `{ result: 'ask', reason }` — surface a permission prompt to the user.
 * `reason` is the prompt text. Claude Code prefixes a source label
 * ([Project] / [User] / [Plugin] / [Local]); make `reason` clearly identify
 * which hook asked.
 */
export type AskResult = Result<'ask'> & Reason

/** `{ result: 'block', reason }` — refuse the action. `reason` is shown to the agent. */
export type BlockResult = Result<'block'> & Reason

/** `{ result: 'stop', reason }` — terminate the teammate. `reason` is the user-facing stop message. */
export type StopResult = Result<'stop'> & Reason

/** `{ result: 'failure', reason }` — for `WorktreeCreate` only. `reason` is the surfaced error. */
export type FailureResult = Result<'failure'> & Reason

/** `{ result: 'continue', feedback }` — keep working. `feedback` becomes the next-step instruction. */
export type ContinueResult = Result<'continue'> & Feedback

/** `{ result: 'success', path }` — for `WorktreeCreate` only. `path` is the absolute worktree path. */
export type SuccessResult = Result<'success'> & Path

// --- Per-event result types ---
// Most users return these implicitly via `ctx.allow(...)` / `ctx.block(...)` /
// etc. The intersected fields below show what each verb's opts bag accepts.

/** Return value of a `PreToolUse` hook. Construct via `ctx.allow / ask / block / defer / skip`. */
export type PreToolUseResult =
  | (AllowResult & InjectContext & UpdatedInput<Record<string, unknown>> & Partial<Reason>)
  | (AskResult & InjectContext & UpdatedInput<Record<string, unknown>>)
  | (BlockResult & InjectContext)
  | DeferResult
  | (SkipResult & InjectContext)

/** Return value of a `UserPromptSubmit` hook. */
export type UserPromptSubmitResult = (AllowResult | BlockResult | SkipResult) &
  InjectContext &
  SessionTitle

/** Return value of a `PermissionRequest` hook. */
export type PermissionRequestResult =
  | (AllowResult & UpdatedInput<Record<string, unknown>> & UpdatedPermissions)
  | (BlockResult & Interrupt)
  | SkipResult

/** Return value of a `Stop` hook. `block` prevents the agent from stopping. */
export type StopEventResult = AllowResult | BlockResult | SkipResult

/** Return value of a `SubagentStop` hook. `block` prevents the subagent from stopping. */
export type SubagentStopResult = AllowResult | BlockResult | SkipResult

/** Return value of a `ConfigChange` hook. `policy_settings` changes cannot be blocked. */
export type ConfigChangeResult = AllowResult | BlockResult | SkipResult

/** Return value of a `PreCompact` hook. `block` prevents the compaction. */
export type PreCompactResult = AllowResult | BlockResult | SkipResult

/**
 * Return value of a `StopFailure` hook. Output is dropped by Claude Code —
 * `skip` exists for API uniformity. Side-effects (logging, alerts) still run.
 */
export type StopFailureResult = SkipResult

/** Return value of a `SessionStart` hook. Use `injectContext` to seed the agent. */
export type SessionStartResult = SkipResult & InjectContext

/** Return value of a `SessionEnd` hook. Output is ignored upstream; useful for cleanup. */
export type SessionEndResult = SkipResult

/** Return value of an `InstructionsLoaded` hook. Pure observer. */
export type InstructionsLoadedResult = SkipResult

/** Return value of a `PostToolUse` hook. `block` flags the tool result back to the agent. */
export type PostToolUseResult =
  | (SkipResult & InjectContext & UpdatedMcpToolOutput)
  | (BlockResult & InjectContext & UpdatedMcpToolOutput)

/** Return value of a `PostToolUseFailure` hook. */
export type PostToolUseFailureResult = SkipResult & InjectContext

/** Return value of a `Notification` hook. */
export type NotificationResult = SkipResult & InjectContext

/** Return value of a `SubagentStart` hook. Use `injectContext` to seed the subagent. */
export type SubagentStartResult = SkipResult & InjectContext

/** Return value of a `WorktreeRemove` hook. */
export type WorktreeRemoveResult = SkipResult

/** Return value of a `PostCompact` hook. Pure observer. */
export type PostCompactResult = SkipResult

/**
 * Return value of a `PermissionDenied` hook. `retry` does NOT reverse the
 * denial — it only hints to the model that it may try again.
 */
export type PermissionDeniedResult = RetryResult | SkipResult

/**
 * Return value of a `WorktreeCreate` hook. Hooks REPLACE Claude Code's default
 * `git worktree` behavior. Return `success({ path })` with the absolute path
 * to the created directory, or `failure({ reason })` to surface an error.
 */
export type WorktreeCreateResult = SuccessResult | FailureResult

/** Return value of a `TeammateIdle` hook. */
export type TeammateIdleResult = ContinueResult | StopResult | SkipResult

/** Return value of a `TaskCreated` hook. */
export type TaskCreatedResult = ContinueResult | StopResult | SkipResult

/** Return value of a `TaskCompleted` hook. */
export type TaskCompletedResult = ContinueResult | StopResult | SkipResult
