// Base result types and per-event result types.
// Each base result is intersected with DebugMessage.
// Inject is intersected where Claude Code supports additionalContext.

import type { PermissionUpdateEntry } from './permissions.js'
import type { DebugMessage, Inject } from './method-primitives.js'

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

export type AllowResult = DebugMessage & {
  result: 'allow'
}

export type BlockResult = DebugMessage & {
  result: 'block'
  /** Required. Shown to the agent (guard events) or user (continuation events). */
  reason: string
}

export type SkipResult = DebugMessage & {
  result: 'skip'
}

export type SuccessResult = DebugMessage & {
  result: 'success'
  /** Absolute path to the created worktree. */
  path: string
}

export type FailureResult = DebugMessage & {
  result: 'failure'
  reason: string
}

export type ContinueResult = DebugMessage & {
  result: 'continue'
  /** Required. Tells the teammate what to do next. */
  feedback: string
}

export type StopResult = DebugMessage & {
  result: 'stop'
  reason: string
}

export type RetryResult = DebugMessage & {
  result: 'retry'
}

/**
 * PreToolUse `ask` decision. Upstream displays the permission prompt
 * to the user with permissionDecisionReason as the prompt text.
 * The source label ([Project]/[User]/[Plugin]/[Local]) is added by
 * Claude Code — reason should disambiguate which hook asked.
 */
export type AskResult = DebugMessage & {
  result: 'ask'
  /** Required. Shown to the user in the confirmation prompt. */
  reason: string
}

/**
 * PreToolUse `defer` decision. Pauses the tool call so a headless
 * `claude -p` caller can resume via `claude -p --resume`. Only honored
 * in -p mode AND only when the turn contains a single tool call.
 * Otherwise Claude Code ignores this result.
 *
 * Upstream ignores reason / updatedInput / additionalContext for
 * defer. This type forbids all three at compile time.
 */
export type DeferResult = DebugMessage & {
  result: 'defer'
}

// --- Per-event result types ---

// Guard events — allow | ask | block | defer | skip
export type PreToolUseResult =
  | (AllowResult &
      Inject & {
        /**
         * Partial patch applied to the running tool input. The engine merges
         * this object onto the current `toolInput` via shallow spread, then
         * strips keys whose value is the literal `null`.
         *
         * - `null` = explicit unset; the key is removed post-merge.
         * - `undefined` / absent = no change on that key.
         *
         * With multiple sequential hooks, each hook's patch composes onto the
         * merge-so-far: hook B's `ctx.toolInput` reflects the running state
         * after every prior patch. Upstream Claude Code still receives a full
         * replacement object on the wire — the engine merges the patches
         * internally before translation.
         *
         * ```ts
         * // ✗ Wrong — undefined is treated as "no patch," the field is left unchanged.
         * return ctx.allow({ updatedInput: { timeout: undefined } })
         *
         * // ✓ Right — null explicitly unsets.
         * return ctx.allow({ updatedInput: { timeout: null } })
         * ```
         */
        updatedInput?: Record<string, unknown>
        /**
         * Optional. When present, surfaced as
         * hookSpecificOutput.permissionDecisionReason on allow.
         * Shown to the user per upstream's decision-control contract.
         */
        reason?: string
      })
  | (AskResult &
      Inject & {
        /**
         * Partial patch applied to the running tool input. The engine merges
         * this object onto the current `toolInput` via shallow spread, then
         * strips keys whose value is the literal `null`.
         *
         * - `null` = explicit unset; the key is removed post-merge.
         * - `undefined` / absent = no change on that key.
         *
         * With multiple sequential hooks, each hook's patch composes onto the
         * merge-so-far: hook B's `ctx.toolInput` reflects the running state
         * after every prior patch. Upstream Claude Code still receives a full
         * replacement object on the wire — the engine merges the patches
         * internally before translation.
         *
         * ```ts
         * // ✗ Wrong — undefined is treated as "no patch," the field is left unchanged.
         * return ctx.allow({ updatedInput: { timeout: undefined } })
         *
         * // ✓ Right — null explicitly unsets.
         * return ctx.allow({ updatedInput: { timeout: null } })
         * ```
         */
        updatedInput?: Record<string, unknown>
      })
  | (BlockResult & Inject)
  | DeferResult
  | (SkipResult & Inject)
export type UserPromptSubmitResult = (AllowResult | BlockResult | SkipResult) &
  Inject & { sessionTitle?: string }
export type PermissionRequestResult =
  | (AllowResult & {
      /**
       * Partial patch applied to the running tool input. The engine merges
       * this object onto the current `toolInput` via shallow spread, then
       * strips keys whose value is the literal `null`.
       *
       * - `null` = explicit unset; the key is removed post-merge.
       * - `undefined` / absent = no change on that key.
       *
       * With multiple sequential hooks, each hook's patch composes onto the
       * merge-so-far: hook B's `ctx.toolInput` reflects the running state
       * after every prior patch. Upstream Claude Code still receives a full
       * replacement object on the wire — the engine merges the patches
       * internally before translation.
       *
       * ```ts
       * // ✗ Wrong — undefined is treated as "no patch," the field is left unchanged.
       * return { result: 'allow', updatedInput: { timeout: undefined } }
       *
       * // ✓ Right — null explicitly unsets.
       * return { result: 'allow', updatedInput: { timeout: null } }
       * ```
       */
      updatedInput?: Record<string, unknown>
      updatedPermissions?: PermissionUpdateEntry[]
    })
  | (BlockResult & {
      interrupt?: boolean
    })
  | SkipResult
export type StopEventResult = AllowResult | BlockResult | SkipResult
export type SubagentStopResult = AllowResult | BlockResult | SkipResult
export type ConfigChangeResult = AllowResult | BlockResult | SkipResult
export type PreCompactResult = AllowResult | BlockResult | SkipResult

// Notify-only events — skip only, output is dropped upstream
// StopFailureResult is intentionally NOT intersected with Inject:
// upstream drops all output, so additionalContext would silently never reach Claude.
export type StopFailureResult = SkipResult

// Observe events — skip only
export type SessionStartResult = SkipResult & Inject
export type SessionEndResult = SkipResult
export type InstructionsLoadedResult = SkipResult
export type PostToolUseResult =
  | (SkipResult & Inject & { updatedMCPToolOutput?: unknown })
  | (BlockResult & Inject & { updatedMCPToolOutput?: unknown })
export type PostToolUseFailureResult = SkipResult & Inject
export type NotificationResult = SkipResult & Inject
export type SubagentStartResult = SkipResult & Inject
export type WorktreeRemoveResult = SkipResult
export type PostCompactResult = SkipResult

export type PermissionDeniedResult = RetryResult | SkipResult

// Implementation events — success | failure
export type WorktreeCreateResult = SuccessResult | FailureResult

// Continuation events — continue | stop | skip
export type TeammateIdleResult = ContinueResult | StopResult | SkipResult
export type TaskCreatedResult = ContinueResult | StopResult | SkipResult
export type TaskCompletedResult = ContinueResult | StopResult | SkipResult
