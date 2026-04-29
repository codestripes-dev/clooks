import type { EventName } from './branded.js'
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

/**
 * Per-event `block` opts for the **ctx side** (`*DecisionMethods` types in
 * `decision-methods.ts` / `contexts.ts`). These are the wire-faithful entries —
 * what Claude Code's wire format honors per arm. Mutations belong here because
 * per-event handlers ARE the place to express mutations (output rewrites, session
 * renames, etc.).
 *
 * Map keys are the 22 `EventName` values; values intersect only the primitives
 * that event's wire format honors upstream. The four wire-gated primitives are:
 *
 * - `InjectContext` (`injectContext?: string`) — honored only on the seven
 *   injectable events in `INJECTABLE_EVENTS` (see `src/config/constants.ts`):
 *   `PreToolUse`, `UserPromptSubmit`, `SessionStart`, `PostToolUse`,
 *   `PostToolUseFailure`, `Notification`, `SubagentStart`.
 * - `Interrupt` (`interrupt?: boolean`) — `PermissionRequest.block` only.
 * - `UpdatedMcpToolOutput` (`updatedMCPToolOutput?: unknown`) — `PostToolUse`
 *   only (and even then silently ignored on non-MCP tools).
 * - `SessionTitle` (`sessionTitle?: string`) — `UserPromptSubmit` only.
 *
 * Explicit per-event entries (matching the `EventContextMap` / `EventResultMap`
 * style in `lifecycle.ts`) are used so misuse produces clean TS errors and
 * the file reads straightforwardly. `extends Record<EventName, unknown>`
 * does NOT fail the build at the map definition site if a new event is added
 * to `EventName` without an entry here — the missing key silently inherits
 * `unknown`. The compile error surfaces at the first consumer site that
 * indexes the map by the new event (e.g., a `*DecisionMethods` arm or
 * `BeforeHookEventVariants`). See `docs/CODE_QUALITY_BACKLOG.md` for the open
 * stricter-exhaustiveness item that affects this map and the sibling event
 * maps in `lifecycle.ts`.
 *
 * ## Lifecycle-vs-ctx split
 *
 * The lifecycle wrapper (`BeforeHookEvent.block` / `BeforeHookEvent.skip`) uses
 * a **separate, narrower** map (`LifecycleBlockOptsMap` / `LifecycleSkipOptsMap`)
 * that excludes mutation primitives (`UpdatedMcpToolOutput`, `SessionTitle`).
 * Mutations belong on per-event handlers (`ctx.block(...)`), not on
 * meta-gates. This map represents the wire-faithful per-event opts consumed by
 * the ctx-side `*DecisionMethods` types; lifecycle uses its own narrower maps.
 */
export interface EventBlockOptsMap extends Record<EventName, unknown> {
  PreToolUse: Reason & DebugMessage & InjectContext
  PostToolUse: Reason & DebugMessage & InjectContext & UpdatedMcpToolOutput
  UserPromptSubmit: Reason & DebugMessage & InjectContext & SessionTitle
  SessionStart: Reason & DebugMessage & InjectContext
  SessionEnd: Reason & DebugMessage
  Stop: Reason & DebugMessage
  StopFailure: Reason & DebugMessage
  SubagentStop: Reason & DebugMessage
  SubagentStart: Reason & DebugMessage & InjectContext
  InstructionsLoaded: Reason & DebugMessage
  PostToolUseFailure: Reason & DebugMessage & InjectContext
  Notification: Reason & DebugMessage & InjectContext
  PermissionRequest: Reason & DebugMessage & Interrupt
  PermissionDenied: Reason & DebugMessage
  ConfigChange: Reason & DebugMessage
  WorktreeCreate: Reason & DebugMessage
  WorktreeRemove: Reason & DebugMessage
  PreCompact: Reason & DebugMessage
  PostCompact: Reason & DebugMessage
  TeammateIdle: Reason & DebugMessage
  TaskCreated: Reason & DebugMessage
  TaskCompleted: Reason & DebugMessage
}

/**
 * Per-event `skip` opts — same gating rules as `EventBlockOptsMap` above, but
 * the base is `DebugMessage` only (skip does not require `reason`).
 *
 * See `EventBlockOptsMap` for full documentation on the four wire-gated
 * primitives and the exhaustiveness guarantee.
 */
export interface EventSkipOptsMap extends Record<EventName, unknown> {
  PreToolUse: DebugMessage // InjectContext dropped — translator silently drops on PreToolUse.skip (src/engine/translate.ts:50-51)
  PostToolUse: DebugMessage & InjectContext & UpdatedMcpToolOutput
  UserPromptSubmit: DebugMessage & InjectContext & SessionTitle
  SessionStart: DebugMessage & InjectContext
  SessionEnd: DebugMessage
  Stop: DebugMessage
  StopFailure: DebugMessage
  SubagentStop: DebugMessage
  SubagentStart: DebugMessage & InjectContext
  InstructionsLoaded: DebugMessage
  PostToolUseFailure: DebugMessage & InjectContext
  Notification: DebugMessage & InjectContext
  PermissionRequest: DebugMessage
  PermissionDenied: DebugMessage
  ConfigChange: DebugMessage
  WorktreeCreate: DebugMessage
  WorktreeRemove: DebugMessage
  PreCompact: DebugMessage
  PostCompact: DebugMessage
  TeammateIdle: DebugMessage
  TaskCreated: DebugMessage
  TaskCompleted: DebugMessage
}

/**
 * Per-event `block` opts for the LIFECYCLE wrapper (`BeforeHookEvent.block`).
 * Narrower than `EventBlockOptsMap` — **by project convention**, not by wire
 * constraint. The wire format DOES accept `updatedMCPToolOutput` on
 * `PostToolUse.block` and `sessionTitle` on `UserPromptSubmit.block` (the
 * runtime translator emits them on either arm); we exclude them here because
 * lifecycle gates are meta-decisions ("should this hook run?"), and content
 * mutations belong on per-event handlers (`ctx.block(...)`) where the
 * decision is co-located with the mutation. The ctx-side `EventBlockOptsMap`
 * carries the wire-faithful primitives.
 *
 * Distinct from the `PreToolUse.skip` exclusion of `injectContext` (in
 * `EventSkipOptsMap` / `LifecycleSkipOptsMap`), which is *by wire reality* —
 * the runtime translator silently drops the field on that arm.
 *
 * `Interrupt` on `PermissionRequest.block` is kept here because it modifies
 * how the block decision is delivered (control flow), not the content.
 *
 * Consumed by `BeforeHookEventVariants` in `src/types/lifecycle.ts`.
 * Same exhaustiveness caveat as `EventBlockOptsMap` applies — see that map's
 * JSDoc and `docs/CODE_QUALITY_BACKLOG.md` for the open exhaustiveness item.
 */
export interface LifecycleBlockOptsMap extends Record<EventName, unknown> {
  PreToolUse: Reason & DebugMessage & InjectContext
  PostToolUse: Reason & DebugMessage & InjectContext // UpdatedMcpToolOutput dropped
  UserPromptSubmit: Reason & DebugMessage & InjectContext // SessionTitle dropped
  SessionStart: Reason & DebugMessage & InjectContext
  SessionEnd: Reason & DebugMessage
  Stop: Reason & DebugMessage
  StopFailure: Reason & DebugMessage
  SubagentStop: Reason & DebugMessage
  SubagentStart: Reason & DebugMessage & InjectContext
  InstructionsLoaded: Reason & DebugMessage
  PostToolUseFailure: Reason & DebugMessage & InjectContext
  Notification: Reason & DebugMessage & InjectContext
  PermissionRequest: Reason & DebugMessage & Interrupt // Interrupt KEPT — control-flow modifier on the block decision, not a content mutation
  PermissionDenied: Reason & DebugMessage
  ConfigChange: Reason & DebugMessage
  WorktreeCreate: Reason & DebugMessage
  WorktreeRemove: Reason & DebugMessage
  PreCompact: Reason & DebugMessage
  PostCompact: Reason & DebugMessage
  TeammateIdle: Reason & DebugMessage
  TaskCreated: Reason & DebugMessage
  TaskCompleted: Reason & DebugMessage
}

/**
 * Per-event `skip` opts for the LIFECYCLE wrapper (`BeforeHookEvent.skip`).
 * See `LifecycleBlockOptsMap` for full documentation on the lifecycle-vs-ctx
 * surface split.
 */
export interface LifecycleSkipOptsMap extends Record<EventName, unknown> {
  PreToolUse: DebugMessage // InjectContext dropped (translator silently drops on PreToolUse.skip — see src/engine/translate.ts:50-51)
  PostToolUse: DebugMessage & InjectContext // UpdatedMcpToolOutput dropped
  UserPromptSubmit: DebugMessage & InjectContext // SessionTitle dropped
  SessionStart: DebugMessage & InjectContext
  SessionEnd: DebugMessage
  Stop: DebugMessage
  StopFailure: DebugMessage
  SubagentStop: DebugMessage
  SubagentStart: DebugMessage & InjectContext
  InstructionsLoaded: DebugMessage
  PostToolUseFailure: DebugMessage & InjectContext
  Notification: DebugMessage & InjectContext
  PermissionRequest: DebugMessage
  PermissionDenied: DebugMessage
  ConfigChange: DebugMessage
  WorktreeCreate: DebugMessage
  WorktreeRemove: DebugMessage
  PreCompact: DebugMessage
  PostCompact: DebugMessage
  TeammateIdle: DebugMessage
  TaskCreated: DebugMessage
  TaskCompleted: DebugMessage
}

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
