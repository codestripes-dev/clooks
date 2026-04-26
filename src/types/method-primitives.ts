// Internal building blocks: small field bags + per-verb method shapes that
// compose into per-event decision-method records. Hook authors rarely import
// these directly — they're surfaced because they appear in opts-bag types.

import type { PermissionUpdateEntry } from './permissions.js'
import type { ResultTag } from './results.js'

// --- Field-bag primitives ---

/** `debugMessage` is shown only when the user runs in debug mode. Safe to log internals. */
export type DebugMessage = { debugMessage?: string }

/**
 * `injectContext` is appended to the agent's conversation as extra context.
 * Maps to Claude Code's `additionalContext` output. Only honored on events
 * whose decision arms accept it.
 */
export type InjectContext = { injectContext?: string }

/** Required `reason`. Shown to the agent (guard events) or to the user (continuation events). */
export type Reason = { reason: string }

/** Required `feedback`. Sent back to the teammate as next-step instruction. */
export type Feedback = { feedback: string }

/** Required `path`. Absolute path to a resource the hook produced (e.g. a worktree). */
export type Path = { path: string }

/**
 * `sessionTitle` renames the IDE session — equivalent to `/rename`.
 * Available on `UserPromptSubmit` decision arms.
 */
export type SessionTitle = { sessionTitle?: string }

/** `updatedPermissions` rewrites permission rules on `PermissionRequest.allow`. */
export type UpdatedPermissions = { updatedPermissions?: PermissionUpdateEntry[] }

/** MCP tools only. Built-in tools (Bash, Edit, Write, …) ignore this field. */
export type UpdatedMcpToolOutput = { updatedMCPToolOutput?: unknown }

/** `interrupt: true` on `PermissionRequest.block` halts the agent's current turn. */
export type Interrupt = { interrupt?: boolean }

/**
 * `updatedInput` patches the tool's input before it runs. Use a `Patch<T>`
 * shape:
 *
 * - Set a key to change it.
 * - Set an optional key to `null` to remove it.
 * - Omit a key to leave it alone.
 *
 * When several hooks run sequentially, each patch composes onto the result so
 * far — later hooks see prior hooks' edits on `ctx.toolInput`.
 *
 * @example
 * ctx.allow({ updatedInput: { command: 'rg --hidden foo' } })
 */
export type UpdatedInput<T> = { updatedInput?: T }

/** Permission update suggestions Claude Code attached to this request. Read-only. */
export type PermissionSuggestions = { permissionSuggestions?: PermissionUpdateEntry[] }

/** Internal: discriminant tag + DebugMessage carried by every result. */
export type Result<T extends ResultTag> = { result: T } & DebugMessage

/**
 * Per-tool DU arm carrying `toolName` and `toolInput`. Internal building block
 * for `PermissionRequestContext`, `PostToolUseContext`, and
 * `PostToolUseFailureContext`.
 */
export type ToolVariant<N extends string, I> = { toolName: N; toolInput: I }

/**
 * Per-tool DU arm for `PreToolUseContext`. Adds `originalToolInput`, a
 * read-only snapshot of the input as Claude Code first sent it — useful for
 * comparing against `toolInput` after upstream hooks have patched it.
 */
export type ToolVariantWithOriginal<N extends string, I> = ToolVariant<N, I> & {
  originalToolInput: I
}

// --- Method-shape primitives (internal) ---
// One-property records that compose into decision-method sets via intersection.

export type Allow<O, R> = { allow: (opts?: O & DebugMessage) => R }
export type Block<O, R> = { block: (opts: O & DebugMessage) => R }
export type Skip<O, R> = { skip: (opts?: O & DebugMessage) => R }
export type Ask<O, R> = { ask: (opts: O & DebugMessage) => R }
export type Defer<O, R> = { defer: (opts?: O & DebugMessage) => R }
export type Continue<O, R> = { continue: (opts: O & DebugMessage) => R }
export type Stop<O, R> = { stop: (opts: O & DebugMessage) => R }
export type Retry<O, R> = { retry: (opts?: O & DebugMessage) => R }
export type Success<O, R> = { success: (opts: O & DebugMessage) => R }
export type Failure<O, R> = { failure: (opts: O & DebugMessage) => R }

/** Internal: flattens an intersection so IDE hovers show one object instead of `A & B & C`. */
export type Prettify<T> = { [K in keyof T]: T[K] } & {}
