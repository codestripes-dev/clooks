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
- `src/types/branded.ts` — 8 branded string types for enum-like fields.
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

### InjectableContext

`InjectableContext` (`injectContext?: string`) is intersected into per-event result types only where Claude Code's output contract supports `additionalContext`. Not all events support it.

### Branded strings

Enum-like fields use `KnownValue | (string & {})`. This gives autocomplete for known values while remaining forward-compatible with new values Claude Code may add.

### Normalization

The engine normalizes Claude Code's snake_case JSON payload into camelCase context objects before passing them to hook handlers. This is done by `src/normalize.ts`, which recursively converts all object keys (including nested objects and objects inside arrays).

After generic key normalization, the engine applies one domain-specific rename: `hookEventName` → `event`. Claude Code sends `hook_event_name` which normalizes to `hookEventName`, but the context types use `event` as the discriminant field. This rename happens in the engine, not in the normalize utility.

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
