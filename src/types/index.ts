/**
 * Placeholder types for the hook system.
 * These will be replaced with precise types in PLAN-03 (Minimum Engine),
 * based on the full I/O contract in docs/domain/claude-code-hooks/io-contract.md.
 */

/** The name of a hook lifecycle event (e.g., "PreToolUse", "PostToolUse"). */
export type HookEventName = string

/** Input provided to a hook by the agent via stdin JSON. */
export interface HookInput {
  event: HookEventName
  [key: string]: unknown
}

/**
 * Output a hook may produce (written to stdout as JSON on exit 0).
 *
 * The real contract uses exit codes for blocking (exit 2 = block) and
 * JSON fields like `decision`, `reason`, `continue`, and event-specific
 * `hookSpecificOutput` for richer control. See io-contract.md for details.
 * This placeholder captures only the most common pattern.
 */
export interface HookOutput {
  /** Decision string (e.g., "block" or "approve"). */
  decision?: string
  /** Human-readable reason for the decision. */
  reason?: string
}
