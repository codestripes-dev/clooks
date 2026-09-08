# Hook Type System

The TypeScript type system for Clooks hook authoring. Provides typed per-event context and result types, config generics, and branded string enums. Hook authors get full type inference without importing individual types.

This index points to focused sub-docs in `docs/domain/hook-type-system/`. The detailed material is split across files to stay under the 300-line per-file domain-doc cap.

## Overview

The type system is organized around the `ClooksHook<C>` interface — a single typed object that hook files export. It maps event names to handler functions, each with event-specific context and result types. A config generic `C` flows through `HookMeta<C>` and all handler signatures.

**Key design properties:**
- **Single export** — `export const hook: ClooksHook<Config>` replaces separate `meta` and handler exports.
- **No `meta.events`** — The engine discovers handlers from the object's properties.
- **Per-event handlers** — Each handler is a property keyed by event name. No unions, no runtime discrimination.
- **All types inferred** — Context, config, and result types are inferred from `ClooksHook`. Hook authors don't need to import context or result types.

## Codex Compatibility

The public authoring types and decision-method surface are unchanged. Codex's ten-event normalizer selects envelope fields instead of recursively renaming tool data. Unknown tool input remains `Record<string, unknown>` through the existing unknown-tool context types; PostToolUse response remains `unknown` publicly and accepts any JSON value at this boundary. Known discriminators require compatible public field types, including canonical Bash for `exec_command`; aliases do not invent Claude Edit/Write shapes.

On relevant events, absent/null transcript paths, child transcript paths, compact instructions/summary and last assistant message become empty strings. This preserves existing string types without fabricated paths, but makes unavailable and genuinely empty values indistinguishable publicly; raw values remain private. Operational IDs are not fabricated. SessionStart preserves the supplied model; PermissionRequest has no invented tool-use ID. These implemented compatibility paths have passed expanded Docker runtime validation. The public types describe the Claude-oriented authoring surface, not a promise that every field or method is supported by Codex; its invocation policy rejects unsupported capabilities.

## Sub-docs

| Document | Path | Topics |
|----------|------|--------|
| Patterns | `hook-type-system/patterns.md` | Event categories, ResultTag/ExitCode, BaseContext, tool-event pipeline, PermissionRequest/PostToolUse output, branded strings, normalization, config overrides, runtime validation, two type layers |
| Decision Methods | `hook-type-system/decision-methods.md` | Per-event decision methods (`ctx.allow`, `ctx.block`, `ctx.skip`, …), runtime attachment, type-composition primitive vocabulary, worked composition example |
| Lifecycle Types | `hook-type-system/lifecycle-types.md` | `beforeHook` / `afterHook`, `BeforeHookEvent` / `AfterHookEvent`, `HookEventMeta` |
| `.d.ts` Type Declarations | `hook-type-system/dts-bundle.md` | Bundle generation, embedding, hook-author imports |

## Key Files

- `src/types/index.ts` — Public API barrel. Re-exports everything from submodules.
- `src/types/branded.ts` — `EventName` (closed literal union), `HookName` and `Milliseconds` (branded types), plus 8 forward-compatible union types for enum-like fields.
- `src/types/results.ts` — 10 base result types + 22 per-event result types.
- `src/types/contexts.ts` — `BaseContext` + 22 per-event context interfaces (also home to the two generic tool-keyed `*DecisionMethods<Input>` types).
- `src/types/decision-methods.ts` — 20 non-generic per-event `*DecisionMethods` types.
- `src/types/method-primitives.ts` — Field-bag and method-shape primitives (the design vocabulary the `*DecisionMethods` types compose from).
- `src/types/hook.ts` — `MaybeAsync<T>`, `HookMeta<C>`, `ClooksHook<C>`.
- `src/types/lifecycle.ts` — `EventContextMap`, `EventResultMap`, `HookEventMeta`, `BeforeHookEvent`, `AfterHookEvent`.
- `src/types/claude-code.ts` — Raw Claude Code types (snake_case). Used by the engine for stdin parsing and stdout serialization. Not part of the hook-author-facing API.
- `src/types/permissions.ts` — `PermissionUpdateEntry` discriminated union and `PermissionDestination` enum.
- `src/normalize.ts` — Recursive snake_case → camelCase key normalization. Used by the engine to convert Claude Code payloads into hook-author-facing context objects.

## Gotchas

- **`claude-code.ts` is separate** — Don't import engine types in hook code or vice versa. They serve different layers.
- **`DebugMessage` on every result** — All base results include `debugMessage?: string`. This is intersected, not extended, so it appears on every concrete result type.
- **Greenfield rename** — `DebugFields` was renamed to `DebugMessage`, `InjectableContext` to `Inject`. No aliases — the old names are gone. Update any imports accordingly.
- **`StopEventResult` vs `StopResult`** — `StopResult` is a base result (`{ result: "stop", reason }`) used in continuation events. `StopEventResult` is the per-event result for the `Stop` guard event (allow | block | skip). Don't confuse them.
- **`hookEventName` → `event` rename** — Generic key normalization converts `hook_event_name` to `hookEventName`. The engine then renames this to `event` to match the context types. This is a domain-specific mapping that lives in the engine, not in `normalizeKeys()`.
- **Claude `toolInput` fields are camelCase at runtime** — Claude normalization recursively maps nested keys such as `file_path` to `filePath`. Codex preserves opaque tool keys instead; do not assume recursive camelCase conversion across providers.

## Related

- `docs/domain/claude-code-hooks/events.md` — Claude Code event reference
- `docs/domain/claude-code-hooks/io-contract.md` — Claude Code I/O contract
