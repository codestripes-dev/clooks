import type { PermissionUpdateEntry } from './permissions.js'
import type { ResultTag } from './results.js'

/** `debugMessage` is shown only when the user runs in debug mode. Safe to log internals. */
export type DebugMessage = { debugMessage?: string }

/**
 * Appended to the agent's conversation as extra context. Only honored on
 * events whose decision arms accept it.
 */
export type InjectContext = { injectContext?: string }

/** Shown to the agent (guard events) or to the user (continuation events). */
export type Reason = { reason: string }

/** Sent back to the teammate as next-step instruction. */
export type Feedback = { feedback: string }

/** Absolute path to a resource the hook produced (e.g. a worktree). */
export type Path = { path: string }

/** Renames the IDE session — equivalent to `/rename`. */
export type SessionTitle = { sessionTitle?: string }

/** Rewrites permission rules on `PermissionRequest.allow`. */
export type UpdatedPermissions = { updatedPermissions?: PermissionUpdateEntry[] }

/** MCP tools only. Built-in tools (Bash, Edit, Write, …) silently ignore this field. */
export type UpdatedMcpToolOutput = { updatedMCPToolOutput?: unknown }

/** `interrupt: true` on `PermissionRequest.block` halts the agent's current turn. */
export type Interrupt = { interrupt?: boolean }

/**
 * Patches the tool's input before it runs. See `Patch<T>` for the shape.
 * Patches compose across sequential hooks — later hooks see prior hooks' edits
 * on `ctx.toolInput`.
 */
export type UpdatedInput<T> = { updatedInput?: T }

/** Permission update suggestions Claude Code attached to this request. Read-only. */
export type PermissionSuggestions = { permissionSuggestions?: PermissionUpdateEntry[] }

export type Result<T extends ResultTag> = { result: T } & DebugMessage

export type ToolVariant<N extends string, I> = { toolName: N; toolInput: I }

/**
 * `originalToolInput` is a read-only snapshot of the input as Claude Code
 * first sent it. Use it to detect whether earlier hooks have patched
 * `ctx.toolInput`.
 */
export type ToolVariantWithOriginal<N extends string, I> = ToolVariant<N, I> & {
  originalToolInput: I
}

/** Opts for `event.block(...)` inside `beforeHook`. */
export interface BlockOpts
  extends DebugMessage, InjectContext, Interrupt, UpdatedMcpToolOutput, SessionTitle {
  reason: string
}

/** Opts for `event.skip(...)` inside `beforeHook`. */
export interface SkipOpts extends DebugMessage, InjectContext, UpdatedMcpToolOutput {}

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

export type Prettify<T> = { [K in keyof T]: T[K] } & {}
