// Base result types and per-event result types.
// Each base result is intersected with DebugFields.
// InjectableContext is intersected where Claude Code supports additionalContext.

/** Union of all result discriminant values across all base result types. */
export type ResultTag = "allow" | "block" | "skip" | "success" | "failure" | "continue" | "stop"

/** Optional debug info, only visible in debug mode. */
export interface DebugFields {
  debugMessage?: string
}

/**
 * Text injected into the agent's conversation.
 * Maps to Claude Code's `additionalContext` output field.
 * Only available on events whose Claude Code contract supports it.
 */
export interface InjectableContext {
  injectContext?: string
}

export type AllowResult = DebugFields & {
  result: "allow"
}

export type BlockResult = DebugFields & {
  result: "block"
  /** Required. Shown to the agent (guard events) or user (continuation events). */
  reason: string
}

export type SkipResult = DebugFields & {
  result: "skip"
}

export type SuccessResult = DebugFields & {
  result: "success"
  /** Absolute path to the created worktree. */
  path: string
}

export type FailureResult = DebugFields & {
  result: "failure"
  reason: string
}

export type ContinueResult = DebugFields & {
  result: "continue"
  /** Required. Tells the teammate what to do next. */
  feedback: string
}

export type StopResult = DebugFields & {
  result: "stop"
  reason: string
}

// --- Per-event result types ---

// Guard events — allow | block | skip
export type PreToolUseResult        = (AllowResult | BlockResult | SkipResult) & InjectableContext
export type UserPromptSubmitResult  = (AllowResult | BlockResult | SkipResult) & InjectableContext
export type PermissionRequestResult = AllowResult | BlockResult | SkipResult
export type StopEventResult         = AllowResult | BlockResult | SkipResult
export type SubagentStopResult      = AllowResult | BlockResult | SkipResult
export type ConfigChangeResult      = AllowResult | BlockResult | SkipResult

// Observe events — skip only
export type SessionStartResult       = SkipResult & InjectableContext
export type SessionEndResult         = SkipResult
export type InstructionsLoadedResult = SkipResult
export type PostToolUseResult        = SkipResult & InjectableContext
export type PostToolUseFailureResult = SkipResult & InjectableContext
export type NotificationResult       = SkipResult & InjectableContext
export type SubagentStartResult      = SkipResult & InjectableContext
export type WorktreeRemoveResult     = SkipResult
export type PreCompactResult         = SkipResult

// Implementation events — success | failure
export type WorktreeCreateResult = SuccessResult | FailureResult

// Continuation events — continue | stop | skip
export type TeammateIdleResult  = ContinueResult | StopResult | SkipResult
export type TaskCompletedResult = ContinueResult | StopResult | SkipResult
