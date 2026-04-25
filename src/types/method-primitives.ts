// Type-composition primitives. Three flavors:
//
// - Field-bag primitives — small object types (`DebugMessage`, `InjectContext`, `Reason`, …)
//   that compose into per-event opts shapes. Re-exported from `src/types/index.ts`
//   because hook authors composing custom event handlers in their own code may want
//   to import them. Field-bag primitives may now be generic — `UpdatedInput<T>` and
//   `Result<T>` are the two instances. `UpdatedInput<T>` is parameterized over the
//   inner value type so the same primitive composes at result-type level
//   (`UpdatedInput<Record<string, unknown>>`) and at decision-method level
//   (`UpdatedInput<Patch<Input>>`). `Result<T extends ResultTag>` composes the
//   discriminant literal with the universal `DebugMessage` field — every base
//   result type intersects `Result<'<tag>'>` with at most one per-tag field bag.
//
//   `Reason`, `Feedback`, and `Path` are pure single-field bags — they no longer
//   bundle `DebugMessage`. The universal `debugMessage` field is supplied via two
//   surfaces: (a) `Result<T>` bakes `DebugMessage` into every emitted result type;
//   (b) every method-shape primitive bakes `DebugMessage` into its opts type. Two
//   declarations, two surfaces (output and input). Per-event compositions
//   therefore drop the explicit `& DebugMessage` from opts shapes that have other
//   fields. For debug-only opts (e.g. `Allow<DebugMessage, StopEventResult>`),
//   the explicit form stays — `DebugMessage & DebugMessage` collapses to
//   `DebugMessage` per Decision Log entry "Explicit DebugMessage on debug-only
//   opts" (PLAN-FEAT-0064D, 2026-04-25).
// - Method-shape primitives — single-property object types (`Allow<O, R>`, `Block<O, R>`, …)
//   that intersect into a method record. NOT re-exported from the barrel — they are
//   internal design vocabulary. Their declarations still survive in the generated
//   `.d.ts` bundle for internal reference (declaration-preservation behavior of
//   `dts-bundle-generator --export-referenced-types=false`); the `export` keyword is
//   omitted at the entry barrel — exactly what we want for an internal vocabulary.
// - Per-arm DU shape helpers — `ToolVariant<N, I>` and `ToolVariantWithOriginal<N, I>`
//   collapse the per-tool `{ toolName; toolInput; (originalToolInput) }` arm shape
//   used by the four tool-keyed event DUs (PreToolUse, PermissionRequest, PostToolUse,
//   PostToolUseFailure).

import type { PermissionUpdateEntry } from './permissions.js'
import type { ResultTag } from './results.js'

// --- Field-bag primitives ---

/** Optional debug info, only visible in debug mode. */
export type DebugMessage = { debugMessage?: string }

/**
 * Text injected into the agent's conversation. Maps to Claude Code's
 * `additionalContext` output field. Only available on events whose Claude
 * Code contract supports it.
 */
export type InjectContext = { injectContext?: string }

/** Required. Shown to the agent (guard events) or user (continuation events). */
export type Reason = { reason: string }

/** Required. Tells the teammate what to do next. */
export type Feedback = { feedback: string }

/** Required. Absolute path to the resource (e.g. created worktree). */
export type Path = { path: string }

/**
 * Set the session title — equivalent to running `/rename`. Available on every
 * result arm per upstream's hookSpecificOutput shape; whether upstream honors
 * it on a `block` arm is unverified — the result type matches the upstream
 * output schema.
 */
export type SessionTitle = { sessionTitle?: string }

export type UpdatedPermissions = { updatedPermissions?: PermissionUpdateEntry[] }

/** MCP tools only. Built-in tools (Bash, Edit, Write, …) silently ignore this field. */
export type UpdatedMcpToolOutput = { updatedMCPToolOutput?: unknown }

export type Interrupt = { interrupt?: boolean }

/**
 * Partial patch object applied to the running tool input. The engine merges
 * this object onto the current `toolInput` via shallow spread, then strips
 * keys whose value is the literal `null`.
 *
 * - `null` = explicit unset; the key is removed post-merge.
 * - `undefined` / absent = no change on that key.
 *
 * With multiple sequential hooks, each hook's patch composes onto the
 * merge-so-far: hook B's `ctx.toolInput` reflects the running state after
 * every prior patch. Upstream Claude Code still receives a full replacement
 * object on the wire — the engine merges the patches internally before
 * translation.
 *
 * Generic over the inner value type so the same primitive composes at
 * result-type level (`UpdatedInput<Record<string, unknown>>`) and at
 * decision-method level with per-tool typed patches
 * (`UpdatedInput<Patch<BashToolInput>>`, etc.).
 *
 * Setting a field to `undefined` does NOT strip it — `JSON.stringify` drops
 * `undefined`-valued keys at serialization, but the engine's merge pass
 * sees the key as present. Use `null` to unset.
 */
export type UpdatedInput<T> = { updatedInput?: T }

/**
 * Permission update suggestions surfaced by Claude Code. Stays at the outer
 * context level (not per-variant) — Claude Code attaches it to every
 * permission request regardless of tool.
 */
export type PermissionSuggestions = { permissionSuggestions?: PermissionUpdateEntry[] }

/**
 * Generic result-tag primitive. Composes the discriminant literal with the
 * universal `DebugMessage` field. Every base result type intersects
 * `Result<'<tag>'>` with the per-tag required field bag (`Reason`, `Feedback`,
 * `Path`) or with nothing for tag-only results (`AllowResult`, `SkipResult`,
 * `DeferResult`, `RetryResult`).
 */
export type Result<T extends ResultTag> = { result: T } & DebugMessage

/**
 * Per-tool DU arm shape for tool-keyed events that lack a Clooks-internal
 * `originalToolInput` field. Used by `PermissionRequestVariant`,
 * `PostToolUseVariant`, and `PostToolUseFailureVariant`.
 */
export type ToolVariant<N extends string, I> = { toolName: N; toolInput: I }

/**
 * Per-tool DU arm shape for `PreToolUseVariant` only. Adds the
 * Clooks-internal `originalToolInput` field, which mirrors `toolInput`
 * shape exactly (the engine synthesizes it pre-normalization). Not used
 * by other tool-keyed events — Claude Code's wire payload does not carry
 * this field on PostToolUse / PostToolUseFailure / PermissionRequest.
 */
export type ToolVariantWithOriginal<N extends string, I> = ToolVariant<N, I> & {
  originalToolInput: I
}

// --- Method-shape primitives ---
//
// Single-property object types — intersect to compose a method record like
// `Allow<…> & Block<…> & Skip<…>`. `export`ed from this source file so consumers
// (`decision-methods.ts`, `contexts.ts`) can import them, but NOT re-exported from
// `src/types/index.ts`. See the file header for rationale.
//
// Opts-required vs opts-optional reflects whether the primitive's bag carries a
// required field: `Allow`, `Skip`, `Defer`, `Retry` accept optional opts; `Block`,
// `Ask`, `Continue`, `Stop`, `Success`, `Failure` require opts (their bags carry
// `reason`, `feedback`, `path`, etc.).

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

/**
 * Flattens an intersection into a single object shape for IDE hover tooltips.
 * Structural no-op: `T` and `Prettify<T>` are mutually assignable. The `& {}`
 * forces TS to eagerly evaluate the mapped type instead of preserving the
 * intersection in hover output.
 */
export type Prettify<T> = { [K in keyof T]: T[K] } & {}
