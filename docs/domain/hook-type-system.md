# Hook Type System

The TypeScript type system for Clooks hook authoring. Provides typed per-event context and result types, config generics, and branded string enums. Hook authors get full type inference without importing individual types.

## Overview

The type system is organized around the `ClooksHook<C>` interface — a single typed object that hook files export. It maps event names to handler functions, each with event-specific context and result types. A config generic `C` flows through `HookMeta<C>` and all handler signatures.

**Key design properties:**
- **Single export** — `export const hook: ClooksHook<Config>` replaces separate `meta` and handler exports.
- **No `meta.events`** — The engine discovers handlers from the object's properties.
- **Per-event handlers** — Each handler is a property keyed by event name. No unions, no runtime discrimination.
- **All types inferred** — Context, config, and result types are inferred from `ClooksHook`. Hook authors don't need to import context or result types.

## Key Files

- `src/types/index.ts` — Public API barrel. Re-exports everything from submodules.
- `src/types/branded.ts` — `EventName` (closed literal union), `HookName` and `Milliseconds` (branded types), plus 8 forward-compatible union types for enum-like fields.
- `src/types/results.ts` — 7 base result types + 18 per-event result types.
- `src/types/contexts.ts` — `BaseContext` + 18 per-event context interfaces.
- `src/types/hook.ts` — `MaybeAsync<T>`, `HookMeta<C>`, `ClooksHook<C>`.
- `src/types/lifecycle.ts` — `EventContextMap`, `EventResultMap`, `HookEventMeta`, `BeforeHookEvent`, `AfterHookEvent`.
- `src/types/claude-code.ts` — Raw Claude Code types (snake_case). Used by the engine for stdin parsing and stdout serialization. Not part of the hook-author-facing API.
- `src/normalize.ts` — Recursive snake_case → camelCase key normalization. Used by the engine to convert Claude Code payloads into hook-author-facing context objects.

## Patterns

### Event categories and result types

Events fall into 4 categories, each with a distinct result pattern:

| Category | Result options | Events |
|----------|--------------|--------|
| Guard | allow, block, skip | PreToolUse, UserPromptSubmit, PermissionRequest, Stop, SubagentStop, ConfigChange |
| Observe | skip only | SessionStart, SessionEnd, InstructionsLoaded, PostToolUse, PostToolUseFailure, Notification, SubagentStart, WorktreeRemove, PreCompact |
| Implementation | success, failure | WorktreeCreate |
| Continuation | continue, stop, skip | TeammateIdle, TaskCompleted |

### ResultTag and ExitCode

`ResultTag` (in `src/types/results.ts`) is a literal union of all result discriminant values: `"allow" | "block" | "skip" | "success" | "failure" | "continue" | "stop"`. It names the union that already exists implicitly across the base result types. The engine uses `ResultTag` in the `EngineResult` interface to type result objects flowing through the execution pipeline, eliminating `as string` casts on result discriminants.

`ExitCode` (in `src/engine.ts`) is a literal union derived from three `as const` constants:
- `EXIT_OK = 0` — Success. Stdout may contain JSON output.
- `EXIT_HOOK_FAILURE = 1` — Hook-level failure (e.g., WorktreeCreate failure).
- `EXIT_STDERR = 2` — Non-zero stderr channel. Used for both fail-closed errors and continuation event "continue" results (both deliver content via stderr). Named `EXIT_STDERR` rather than `EXIT_FAIL_CLOSED` because exit 2 describes the mechanism (stderr output), not a single semantic.

The `ExitCode` type is `typeof EXIT_OK | typeof EXIT_HOOK_FAILURE | typeof EXIT_STDERR`, which resolves to `0 | 1 | 2`. All `process.exit()` calls in the engine and CLI use the named constants.

### BaseContext fields for parallel execution

`BaseContext` includes two fields added for the parallel execution pipeline:

- `parallel: boolean` — True when the hook is running in a parallel batch, false for sequential execution. Hook authors can use this to guard against operations that are unsafe in parallel mode (e.g., mutating shared state).
- `signal: AbortSignal` — Scoped to the current execution group. In parallel groups, this signal is aborted when a short-circuit condition is detected (block result, contract violation). In sequential groups, the signal is scoped per-group but never aborted in the current implementation. Hooks can check `signal.aborted` or listen for the `abort` event to clean up early.

### BaseContext field optionality

Not all `BaseContext` fields are universally present across all events. The following field is optional because Claude Code omits it from certain event payloads:

- `permissionMode?: PermissionMode` — Absent from SessionStart, PreCompact, and WorktreeCreate payloads. Events that always include permission mode (PreToolUse, PermissionRequest, etc.) receive it, but the base type is optional to reflect the runtime reality.

### Tool event pipeline fields

`PreToolUseContext` includes two fields for the tool input pipeline:

- `toolInput: Record<string, unknown>` — The current tool input, which may differ from the original if a previous sequential hook returned `updatedInput`.
- `originalToolInput: Record<string, unknown>` — The original tool input from Claude Code, before any hook modifications. Always reflects the unmodified input, even after multiple hooks have modified `toolInput`.

`PostToolUseContext` and `PostToolUseFailureContext` also include `originalToolInput?: Record<string, unknown>`. The engine adds this field for all tool events (any event whose normalized payload contains `toolInput`). It is optional on post-tool events because it is engine-injected, not contractually guaranteed by Claude Code for these event types.

`PreToolUseResult` (the `AllowResult` variant only) includes:

- `updatedInput?: Record<string, unknown>` — Modified tool input to pass to subsequent hooks and/or Claude Code. Only sequential hooks may return this field. **Contract rule: parallel hooks must not return `updatedInput`.** If a parallel hook returns `updatedInput`, the engine treats it as a contract violation — it blocks the pipeline and records a failure through the circuit breaker, regardless of the hook's `onError` configuration.

### InjectableContext

`InjectableContext` (`injectContext?: string`) is intersected into per-event result types only where Claude Code's output contract supports `additionalContext`. Not all events support it.

### PermissionRequest output fields

`PermissionRequestResult` supports additional fields beyond the base guard result:

- **Allow variant:** `updatedInput?: Record<string, unknown>` and `updatedPermissions?: unknown[]`. When present, the engine emits `hookSpecificOutput.decision` with `behavior: "allow"` and the extra fields. When absent, allow is a bare exit 0.
- **Block variant:** `interrupt?: boolean`. When true, Claude Code stops entirely (not just denies the permission). The engine maps `reason` to `decision.message` in the output.

### PostToolUse output fields

`PostToolUseResult` includes `updatedMCPToolOutput?: unknown`. This field replaces the MCP tool output at the **top level** of the output JSON (not inside `hookSpecificOutput`). It is a passthrough field — PostToolUse is observe-only in Clooks, but this capability allows modifying what the agent sees from MCP tool calls.

### Branded strings and typed identifiers

The type system uses three distinct strategies for semantic types, depending on the domain:

**Closed literal union — `EventName`:**
`EventName` is a union of all 18 known Claude Code event name literals (e.g., `"PreToolUse" | "PostToolUse" | ...`). It does NOT include `(string & {})` — it is a closed set. The engine must know every event to translate results correctly. Unknown events are fail-closed errors, not forward-compatible pass-throughs. The type guard `isEventName()` (in `src/config/constants.ts`) narrows a runtime `string` to `EventName` at the stdin boundary.

**Branded types — `HookName`, `Milliseconds`:**
These use TypeScript's intersection branding pattern to prevent type confusion between semantically different primitives:
- `HookName = string & { __brand: "HookName" }` — Distinguishes hook names from event names and other strings. Open set (user-defined names). Boundary casts in `validate.ts` and test helpers convert plain strings to `HookName`.
- `Milliseconds = number & { __brand: "Milliseconds" }` — Distinguishes timeout values from plain numbers (failure counts, etc.). Used in `GlobalConfig.timeout`, `HookEntry.timeout`, and `DEFAULT_TIMEOUT`. Scoped to config/engine internals only — not exposed in hook-author-facing context types.

**Forward-compatible unions — `PermissionMode`, `SessionStartSource`, etc.:**
Enum-like context fields use `KnownValue | (string & {})`. This gives autocomplete for known values while remaining forward-compatible with new values Claude Code may add. These are used in hook-author-facing context types, where Claude Code may add new enum members in future versions.

### Normalization

The engine normalizes Claude Code's snake_case JSON payload into camelCase context objects before passing them to hook handlers. This is done by `src/normalize.ts`, which recursively converts all object keys (including nested objects and objects inside arrays).

After generic key normalization, the engine applies one domain-specific rename: `hookEventName` → `event`. Claude Code sends `hook_event_name` which normalizes to `hookEventName`, but the context types use `event` as the discriminant field. This rename happens in the engine, not in the normalize utility.

### HookOrigin and origin field

`HookOrigin` (in `src/config/types.ts`) is a literal union `"home" | "project"` indicating which config layer a hook originated from. Every `HookEntry` carries an `origin: HookOrigin` field, annotated by `loadConfig()` after the three-layer merge.

The origin determines path resolution: home hooks resolve source paths relative to `~/.clooks/`, project hooks relative to the project root. The engine uses origin for debugging and the `config --resolved` command uses it for provenance display.

### Config overrides and meta.config

Hook `meta.config` defaults are shallow-merged with config overrides from `clooks.yml` in the loader (`src/loader.ts`). The `loadHook()` function reads `hook.meta.config`, spreads the config overrides from `HookEntry.config` on top (`{ ...metaDefaults, ...overrides }`), and returns the merged config in `LoadedHook.config`. This merged config is what gets passed to handlers at runtime — handlers never see the raw meta.config or raw overrides separately.

`LoadedHook` also carries `usesTarget?: string` — the raw `uses` value from YAML config, present only when the hook is an alias. The engine uses this for error message formatting (including provenance like `(uses: crasher, .clooks/hooks/crasher.ts)`) and for `config --resolved` output.

### Runtime validation

TypeScript types are erased when hook files are dynamically imported. The loader (`src/loader.ts`) performs runtime validation of every hook export via `validateHookExport()`. It checks: `hook` named export exists and is an object, `hook.meta` exists with a `name` string, all property keys are in the allowed set (`meta`, `beforeHook`, `afterHook`, plus 18 event names), and all non-`meta` properties are functions. Invalid hooks cause fail-closed behavior (the engine exits with code 2 and a diagnostic message on stderr).

**`meta.name` relaxation for aliases:** After `validateHookExport()`, the loader checks `meta.name` against an expected name. For regular hooks (no `uses`), `meta.name` must match the YAML key. For aliases with hook-name `uses`, `meta.name` must match the `uses` target (not the YAML key). For aliases with path-like `uses` (`./`, `../`, `/`), `meta.name` validation is skipped entirely — the hook file is a custom path and its `meta.name` is whatever the author set.

### Two type layers

The codebase has two distinct type layers:
1. **Hook-author types** (`src/types/` except `claude-code.ts`) — camelCase, used in handler signatures.
2. **Engine types** (`src/types/claude-code.ts`) — snake_case, mirrors Claude Code's JSON wire format.

The engine uses `normalizeKeys()` to bridge these layers on input. Output translation (result → Claude Code JSON) is handled by `translateResult()` in the engine.

### `hookEventName` in `hookSpecificOutput`

Claude Code requires a `hookEventName` field set to the event name string inside every `hookSpecificOutput` object in the JSON output. This is a Claude Code requirement, not optional — without it, Claude Code treats the output as invalid and shows "hook error". The engine's `translateResult()` function sets this field automatically. The field is defined in `src/types/claude-code.ts` on output types like `PreToolUseOutput`.

## Lifecycle Types

Hook authors can define optional `beforeHook` and `afterHook` methods on their `ClooksHook` objects. These lifecycle methods run before and after the matched event handler, enabling cross-cutting concerns like environment gating, timing, and result inspection/override.

### Type definitions

All lifecycle types live in `src/types/lifecycle.ts` and are re-exported from `src/types/index.ts`.

**`EventContextMap` and `EventResultMap`** — Mapped types that associate each `EventName` with its context and result type. Used internally to generate the discriminated union types. Also independently useful for generic hook utilities that need to map over all events.

**`HookEventMeta`** — Environment metadata carried by lifecycle events:

| Field | Type | Description |
|-------|------|-------------|
| `gitRoot` | `string \| null` | Repo root via `git rev-parse --show-toplevel` |
| `gitBranch` | `string \| null` | Current branch (null if detached HEAD) |
| `platform` | `"darwin" \| "linux"` | OS platform |
| `hookName` | `string` | This hook's name (same as `meta.name`) |
| `hookPath` | `string` | Absolute path to the hook's `.ts` file |
| `timestamp` | `string` | ISO 8601 timestamp of engine invocation start |
| `clooksVersion` | `string` | Runtime version string |
| `configPath` | `string` | Path to the `clooks.yml` that registered this hook |

**`BeforeHookEvent`** — Discriminated union for `beforeHook`. Narrows `event.input` by `event.type`. The `respond()` callback accepts `BlockResult | SkipResult` — `beforeHook` can block the action or skip the hook entirely. Not calling `respond()` proceeds to the handler.

```typescript
// After narrowing on event.type:
if (event.type === "PreToolUse") {
  event.input.toolName  // ✅ narrowed to PreToolUseContext
  event.respond({ result: "block", reason: "gated" })  // ✅ BlockResult
  event.respond({ result: "skip" })  // ✅ SkipResult — hook becomes invisible
}
```

**`AfterHookEvent`** — Discriminated union for `afterHook`. Both `handlerResult` and `respond()` narrow together with `type`. The `respond()` callback pattern provides compile-time type safety that return-based overrides cannot achieve (TypeScript does not narrow return types based on discriminant checks).

```typescript
if (event.type === "PreToolUse") {
  event.handlerResult  // narrowed to PreToolUseResult
  event.respond({ result: "allow" })  // ✅ accepts PreToolUseResult
}
```

### ClooksHook extension

`ClooksHook<C>` has two optional methods:

```typescript
beforeHook?: (event: BeforeHookEvent, config: C) => MaybeAsync<void>
afterHook?: (event: AfterHookEvent, config: C) => MaybeAsync<void>
```

Both communicate results through the `respond()` callback, not through return values. If `respond()` is not called, the lifecycle phase is a no-op.

### Runtime validation

`validateHookExport()` in `src/loader.ts` enumerates allowed property keys on hook objects: `meta`, `beforeHook`, `afterHook`, plus all 18 event names. Unknown keys (e.g., typos like `beforHook`) produce a descriptive error listing the allowed names.

## .d.ts Type Declarations

Hook authors get full TypeScript type support via a generated `types.d.ts` file placed in the hooks directory (`.clooks/hooks/types.d.ts` for project scope, `~/.clooks/hooks/types.d.ts` for global scope). This file contains the complete public type surface — `ClooksHook`, all 18 event contexts, all result types, config generics, and branded string unions.

### Build pipeline

The build pipeline produces a single `.d.ts` file and embeds it in the compiled binary:

1. **Generate** — `scripts/generate-types.ts` runs `dts-bundle-generator` with `--no-check` and `--export-referenced-types=false` against `src/types/index.ts`. Output goes to `src/generated/clooks-types.d.ts` (gitignored).
2. **Embed** — The binary imports the generated file as a string constant via Bun text import: `import EMBEDDED_TYPES_DTS from '../generated/clooks-types.d.ts' with { type: 'text' }`. TypeScript is satisfied by an ambient module declaration in `src/text-imports.d.ts`. This works in both `bun run` (interpreted) and `bun build --compile` (compiled binary).
3. **Extract** — `clooks types` and `clooks init` write the embedded string to disk as `types.d.ts` with a version header comment.

### Source of truth vs. generated artifact

`src/types/index.ts` is the source of truth for the public type surface. It re-exports exactly 57 types from the submodules in `src/types/`. The generated `.clooks/hooks/types.d.ts` is a build artifact derived entirely from this barrel — hook authors should never edit it. Running `clooks types` regenerates it from the binary's embedded copy.

### Hook author import

Hook files import types from the co-located declarations file:

```typescript
import type { ClooksHook } from './types'
```

This replaces the previous repo-internal import (`../../src/types/hook.js`) and works in any project directory after `clooks init` or `clooks types`.

## Gotchas

- **`claude-code.ts` is separate** — Don't import engine types in hook code or vice versa. They serve different layers.
- **`DebugFields` on every result** — All base results include `debugMessage?: string`. This is intersected, not extended, so it appears on every concrete result type.
- **`StopEventResult` vs `StopResult`** — `StopResult` is a base result (`{ result: "stop", reason }`) used in continuation events. `StopEventResult` is the per-event result for the `Stop` guard event (allow | block | skip). Don't confuse them.
- **`hookEventName` → `event` rename** — Generic key normalization converts `hook_event_name` to `hookEventName`. The engine then renames this to `event` to match the context types. This is a domain-specific mapping that lives in the engine, not in `normalizeKeys()`.
- **`toolInput` fields are camelCase at runtime** — The engine normalizes the entire payload recursively, including nested objects like `tool_input`. This means `tool_input.file_path` becomes `toolInput.filePath`, `old_string` becomes `oldString`, etc. Hook authors must use camelCase keys when accessing `toolInput` fields. If a hook needs to work with both raw and normalized payloads (e.g., in unit tests), use fallback access: `toolInput.filePath ?? toolInput.file_path`.

## Related

- `docs/plans/2026-03-08-hook-type-system-design.md` — Design document (spec)
- `docs/planned/done/FEAT-0002-hook-file-contract.md` — Originating feature
- `docs/planned/FEAT-0012-tool-input-types.md` — Deferred typed tool inputs
- `docs/domain/claude-code-hooks/events.md` — Claude Code event reference
- `docs/domain/claude-code-hooks/io-contract.md` — Claude Code I/O contract
