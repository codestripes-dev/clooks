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

### PreToolUse pipeline fields

`PreToolUseContext` includes two fields for the tool input pipeline:

- `toolInput: Record<string, unknown>` — The current tool input, which may differ from the original if a previous sequential hook returned `updatedInput`.
- `originalToolInput: Record<string, unknown>` — The original tool input from Claude Code, before any hook modifications. Always reflects the unmodified input, even after multiple hooks have modified `toolInput`.

`PreToolUseResult` (the `AllowResult` variant only) includes:

- `updatedInput?: Record<string, unknown>` — Modified tool input to pass to subsequent hooks and/or Claude Code. Only sequential hooks may return this field. **Contract rule: parallel hooks must not return `updatedInput`.** If a parallel hook returns `updatedInput`, the engine treats it as a contract violation — it blocks the pipeline and records a failure through the circuit breaker, regardless of the hook's `onError` configuration.

### InjectableContext

`InjectableContext` (`injectContext?: string`) is intersected into per-event result types only where Claude Code's output contract supports `additionalContext`. Not all events support it.

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

### Runtime validation

TypeScript types are erased when hook files are dynamically imported. The loader (`src/loader.ts`) performs runtime validation of every hook export via `validateHookExport()`. It checks: `hook` named export exists and is an object, `hook.meta` exists with a `name` string, and all non-`meta` properties are functions. Invalid hooks cause fail-closed behavior (the engine exits with code 2 and a diagnostic message on stderr).

### Two type layers

The codebase has two distinct type layers:
1. **Hook-author types** (`src/types/` except `claude-code.ts`) — camelCase, used in handler signatures.
2. **Engine types** (`src/types/claude-code.ts`) — snake_case, mirrors Claude Code's JSON wire format.

The engine uses `normalizeKeys()` to bridge these layers on input. Output translation (result → Claude Code JSON) is handled by `translateResult()` in the engine.

### `hookEventName` in `hookSpecificOutput`

Claude Code requires a `hookEventName` field set to the event name string inside every `hookSpecificOutput` object in the JSON output. This is a Claude Code requirement, not optional — without it, Claude Code treats the output as invalid and shows "hook error". The engine's `translateResult()` function sets this field automatically. The field is defined in `src/types/claude-code.ts` on output types like `PreToolUseOutput`.

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
