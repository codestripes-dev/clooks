// Type-composition primitives. Two flavors:
//
// - Field-bag primitives — small object types (`DebugMessage`, `Inject`, `Reason`, …)
//   that compose into per-event opts shapes. Re-exported from `src/types/index.ts`
//   because hook authors composing custom event handlers in their own code may want
//   to import them. Field-bag primitives may now be generic — `UpdatedInput<T>` is
//   the first instance, parameterized over the inner value type so the same primitive
//   composes at result-type level (`UpdatedInput<Record<string, unknown>>`) and at
//   decision-method level (`UpdatedInput<Patch<Input>>`).
// - Method-shape primitives — single-property object types (`Allow<O, R>`, `Block<O, R>`, …)
//   that intersect into a method record. NOT re-exported from the barrel — they are
//   internal design vocabulary. Their declarations still survive in the generated
//   `.d.ts` bundle for internal reference (declaration-preservation behavior of
//   `dts-bundle-generator --export-referenced-types=false`); the `export` keyword is
//   omitted at the entry barrel — exactly what we want for an internal vocabulary.

import type { PermissionUpdateEntry } from './permissions.js'

// --- Field-bag primitives ---

/** Optional debug info, only visible in debug mode. */
export type DebugMessage = { debugMessage?: string }

/**
 * Text injected into the agent's conversation. Maps to Claude Code's
 * `additionalContext` output field. Only available on events whose Claude
 * Code contract supports it.
 */
export type Inject = { injectContext?: string }

/** Required. Shown to the agent (guard events) or user (continuation events). */
export type Reason = { reason: string } & DebugMessage

/** Required. Tells the teammate what to do next. */
export type Feedback = { feedback: string } & DebugMessage

/** Required. Absolute path to the resource (e.g. created worktree). */
export type Path = { path: string } & DebugMessage

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
 * Optional reason field. When present, surfaced as
 * `hookSpecificOutput.permissionDecisionReason` on allow per upstream's
 * decision-control contract.
 */
export type OptionalReason = { reason?: string }

/**
 * Permission update suggestions surfaced by Claude Code. Stays at the outer
 * context level (not per-variant) — Claude Code attaches it to every
 * permission request regardless of tool.
 */
export type PermissionSuggestions = { permissionSuggestions?: PermissionUpdateEntry[] }

/**
 * The original tool input from Claude Code, before any hook modifications.
 * Required on PreToolUse contexts (always present in upstream payloads);
 * optional on PostToolUse / PostToolUseFailure contexts where the field is
 * forwarded but not always populated.
 */
export type OriginalToolInput = { originalToolInput: Record<string, unknown> }

/** Optional form of `OriginalToolInput` for PostToolUse / PostToolUseFailure contexts. */
export type OriginalToolInputOptional = { originalToolInput?: Record<string, unknown> }

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

export type Allow<O, R> = { allow: (opts?: O) => R }
export type Block<O, R> = { block: (opts: O) => R }
export type Skip<O, R> = { skip: (opts?: O) => R }
export type Ask<O, R> = { ask: (opts: O) => R }
export type Defer<O, R> = { defer: (opts?: O) => R }
export type Continue<O, R> = { continue: (opts: O) => R }
export type Stop<O, R> = { stop: (opts: O) => R }
export type Retry<O, R> = { retry: (opts?: O) => R }
export type Success<O, R> = { success: (opts: O) => R }
export type Failure<O, R> = { failure: (opts: O) => R }
