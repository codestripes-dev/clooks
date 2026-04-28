# Hook Type System — Patterns

Conventions and patterns used throughout the Clooks type system: event categories, result tags and exit codes, base-context fields, tool-event pipeline, output fields, branded strings, normalization, and runtime validation.

## Event categories and result types

Events fall into 4 categories, each with a distinct result pattern:

| Category | Result options | Events |
|----------|--------------|--------|
| Guard | allow, block, skip (PreToolUse also: ask, defer) | PreToolUse, UserPromptSubmit, PermissionRequest, Stop, SubagentStop, ConfigChange, PreCompact |
| Observe | skip (PostToolUse also accepts block; PermissionDenied also accepts retry) | SessionStart, SessionEnd, InstructionsLoaded, PostToolUse, PostToolUseFailure, Notification, SubagentStart, WorktreeRemove, PostCompact, PermissionDenied |
| Implementation | success, failure | WorktreeCreate |
| Continuation | continue, stop, skip | TeammateIdle, TaskCreated, TaskCompleted |
| NOTIFY_ONLY | skip (output ignored upstream) | StopFailure |

## ResultTag and ExitCode

`ResultTag` (in `src/types/results.ts`) is a literal union of all result discriminant values: `"allow" | "block" | "skip" | "success" | "failure" | "continue" | "stop" | "retry" | "ask" | "defer"`. It names the union that already exists implicitly across the base result types. The engine uses `ResultTag` in the `EngineResult` interface to type result objects flowing through the execution pipeline, eliminating `as string` casts on result discriminants. `"ask"` and `"defer"` are PreToolUse-only — narrow per-event result types prevent hook authors from using them on other events at compile time; the translator's unknown-result fall-through catches any `as any` escape hatches.

`ExitCode` (in `src/engine.ts`) is a literal union derived from three `as const` constants:
- `EXIT_OK = 0` — Success. Stdout may contain JSON output.
- `EXIT_HOOK_FAILURE = 1` — Hook-level failure (e.g., WorktreeCreate failure).
- `EXIT_STDERR = 2` — Non-zero stderr channel. Used for both fail-closed errors and continuation event "continue" results (both deliver content via stderr). Named `EXIT_STDERR` rather than `EXIT_FAIL_CLOSED` because exit 2 describes the mechanism (stderr output), not a single semantic.

The `ExitCode` type is `typeof EXIT_OK | typeof EXIT_HOOK_FAILURE | typeof EXIT_STDERR`, which resolves to `0 | 1 | 2`. All `process.exit()` calls in the engine and CLI use the named constants.

## BaseContext fields for parallel execution

`BaseContext` includes two fields added for the parallel execution pipeline:

- `parallel: boolean` — True when the hook is running in a parallel batch, false for sequential execution. Hook authors can use this to guard against operations that are unsafe in parallel mode (e.g., mutating shared state).
- `signal: AbortSignal` — Scoped to the current execution group. In parallel groups, this signal is aborted when a short-circuit condition is detected (block result, contract violation). In sequential groups, the signal is scoped per-group but never aborted in the current implementation. Hooks can check `signal.aborted` or listen for the `abort` event to clean up early.

## BaseContext field optionality

Not all `BaseContext` fields are universally present across all events. The following field is optional because Claude Code omits it from certain event payloads:

- `permissionMode?: PermissionMode` — Absent from SessionStart, PreCompact, and WorktreeCreate payloads. Events that always include permission mode (PreToolUse, PermissionRequest, etc.) receive it, but the base type is optional to reflect the runtime reality.

## Tool event pipeline fields

`PreToolUseContext` is a **discriminated union on `toolName`**. Narrowing on `ctx.toolName` automatically narrows `ctx.toolInput` to a tool-specific camelCase interface — no `as` cast required:

```ts
if (ctx.toolName === 'Write') {
  ctx.toolInput.filePath   // string — auto-typed
  ctx.toolInput.content    // string — auto-typed
}
```

Typed variants: `BashToolInput`, `WriteToolInput`, `EditToolInput`, `ReadToolInput`, `GlobToolInput`, `GrepToolInput`, `AgentToolInput`, `WebFetchToolInput`, `WebSearchToolInput`, `AskUserQuestionToolInput`. All interfaces use camelCase keys because `src/normalize.ts` recursively camelCases every payload key before a handler sees it.

**`PreToolUseContext` does NOT include a catch-all variant.** A `toolName: string` catch-all cannot coexist with discriminated-union narrowing in TypeScript: because `string` is a supertype of every literal, narrowing on `ctx.toolName === 'Bash'` keeps both the `Bash` variant and the catch-all, making `ctx.toolInput` resolve to `BashToolInput | Record<string, unknown>` and defeating typed access. For unknown tool names (MCP tools, `ExitPlanMode`, future upstream tools), use `UnknownPreToolUseContext`:

```ts
import type { UnknownPreToolUseContext } from './types'

const ctx = rawCtx as unknown as UnknownPreToolUseContext
if (ctx.toolName.startsWith('mcp__')) {
  const val: unknown = ctx.toolInput.someField  // Record<string, unknown>
}
```

`UnknownPreToolUseContext` is exported from `src/types/index.ts` alongside `PreToolUseContext`.

`UnknownPostToolUseContext` and `UnknownPostToolUseFailureContext` are the equivalent escape-hatch siblings for the PostToolUse / PostToolUseFailure DUs. The full set of unknown-tool sibling types is therefore: `UnknownPreToolUseContext`, `UnknownPermissionRequestContext`, `UnknownPostToolUseContext`, `UnknownPostToolUseFailureContext`. All four follow the same pattern — an `unknown as Unknown<Event>Context` cast for handling MCP tools or future upstream additions, with `toolInput` typed as `Record<string, unknown>` and the per-event decision methods present.

The same DU narrowing flows through the **decision methods**: `ctx.allow({ updatedInput })`, `ctx.ask({ updatedInput })`, etc. are typed per-variant, so after `if (ctx.toolName === 'Bash')` the `updatedInput` parameter is `Patch<BashToolInput>` automatically — passing `{ filePath: '/tmp' }` on a `Bash` arm is a TypeScript error. `Patch<T>` is a partial-merge type with `null` permitted only on optional keys (`null` means "explicit unset"; the engine strips `null`-valued keys post-merge). `UnknownPreToolUseContext`'s methods are typed `Patch<Record<string, unknown>>`, matching the loose runtime input shape. `PostToolUseContext` and `PostToolUseFailureContext` follow the same DU pattern — narrowing on `ctx.toolName` types `ctx.toolInput` per-tool — though those events have no `updatedInput` in their decision-method opts.

## ToolInputMap and Prettify

`ToolInputMap` (in `src/types/contexts.ts`) is the single source of truth for the 10 known Claude Code tool names and their camelCase input shapes. The four tool-keyed DU contexts — `PreToolUseContext`, `PermissionRequestContext`, `PostToolUseContext`, `PostToolUseFailureContext` — derive their per-tool variants by mapping over this interface (`{ [K in keyof ToolInputMap & string]: ... }[keyof ToolInputMap & string]`). Adding a new tool means adding one key to `ToolInputMap`; the four contexts pick it up automatically. The `Unknown<Event>Context` siblings remain the escape hatches for tools NOT in the map (MCP tools, `ExitPlanMode`, future upstream additions).

`Prettify<T>` (in `src/types/method-primitives.ts`) is a structural no-op (`{ [K in keyof T]: T[K] } & {}`) that forces TypeScript to eagerly evaluate intersections so IDE hover tooltips render flat property lists instead of long chains like `BaseContext & ToolVariantWithOriginal<...> & PreToolUseDecisionMethods<...>`. The four tool-keyed contexts and their `Unknown*` siblings are wrapped in `Prettify`. Narrowing on `ctx.toolName` and `ctx.event` is preserved end-to-end.

`PreToolUseContext` also includes two fields for the tool input pipeline:

- `toolInput: <per-tool interface>` — The current tool input (typed per `toolName`), reflecting the **merge-so-far** across all prior sequential hook patches in execution order. Each prior hook's `updatedInput` is shallow-merged onto the running `toolInput`; keys whose patch value was literal `null` are stripped post-merge. **Null-propagation rule:** when hook A's patch sets a key to `null`, hook B sees that key as **absent** from `ctx.toolInput` (not as the literal `null`) — `stripNulls` runs at every merge step inside the engine, not only at the wire boundary. Comparing `ctx.toolInput.field === null` will never match a prior-hook unset; test for `ctx.toolInput.field === undefined` (or `'field' in ctx.toolInput`) instead.
- `originalToolInput: Record<string, unknown>` — The original tool input from Claude Code, before any hook modifications. Always reflects the unmodified input, even after multiple hooks have modified `toolInput`.

`PostToolUseContext` and `PostToolUseFailureContext` are discriminated unions on `toolName` matching the `PreToolUseContext` pattern. They do NOT carry `originalToolInput` — that field is upstream-PreToolUse-only; Claude Code's wire payload doesn't include it on Post* events. Authors narrow on `ctx.toolName` to get a typed `ctx.toolInput` per tool. `UnknownPostToolUseContext` and `UnknownPostToolUseFailureContext` are sibling escape-hatch types for unknown tool names.

`PreToolUseResult` (the `AllowResult` variant only) includes:

- `updatedInput?: Record<string, unknown>` — **Partial patch** shallow-merged onto the running `toolInput`, not a full replacement. `null`-valued keys are an **explicit unset sentinel** — stripped post-merge. `undefined` / absent keys mean "no change on this key." With multiple sequential hooks, each hook's patch composes onto the merge-so-far; hook B's `ctx.toolInput` reflects the accumulated state from every prior patch. **Null-propagation rule:** when hook A's patch sets a key to `null`, hook B sees that key as absent from `ctx.toolInput` (not as the literal `null`). Upstream Claude Code still receives a full replacement object on the wire — the engine merges the patches internally before translation. **Contract rule: parallel hooks must not return `updatedInput`.** This applies to both parallel `PreToolUse` **and** parallel `PermissionRequest` hooks. If either does, the engine treats it as a contract violation — it blocks the pipeline and records a failure through the circuit breaker, regardless of the hook's `onError` configuration.

## InjectContext

`InjectContext` (`injectContext?: string`) is intersected into per-event result types only where Claude Code's output contract supports `additionalContext`. Not all events support it. The name reflects the field's mapping to upstream Claude Code's `additionalContext` field.

## PermissionRequest output fields

`PermissionRequestContext` is a **discriminated union on `toolName`** mirroring `PreToolUseContext`. The 10 known arms (`Bash`, `Write`, `Edit`, `Read`, `Glob`, `Grep`, `WebFetch`, `WebSearch`, `Agent`, `AskUserQuestion`) intersect a `PermissionRequestDecisionMethods<ToolInput>` set per variant, so `permCtx.allow({ updatedInput })` types the patch as `Patch<NarrowedToolInput>` after a `permCtx.toolName` discriminant check. `permissionSuggestions?` stays at the outer context level, not per-variant. `UnknownPermissionRequestContext` is the sibling type for unknown tool names (MCP, future upstream tools); cast via `as unknown as UnknownPermissionRequestContext` and the methods type the patch as `Patch<Record<string, unknown>>`.

`PermissionRequestResult` supports additional fields beyond the base guard result:

- **Allow variant:** `updatedInput?: Record<string, unknown>` and `updatedPermissions?: PermissionUpdateEntry[]`. When present, the engine emits `hookSpecificOutput.decision` with `behavior: "allow"` and the extra fields. When absent, allow is a bare exit 0. `PermissionUpdateEntry` is a discriminated union (tagged by `type`) with six variants: `addRules` / `replaceRules` / `removeRules` carry `rules: PermissionRule[]` and `behavior: PermissionRuleBehavior` (`"allow" | "deny" | "ask"`); `setMode` carries `mode: PermissionMode`; `addDirectories` / `removeDirectories` carry `directories: string[]`. Every entry carries a `destination: PermissionDestination` (`"session" | "localSettings" | "projectSettings" | "userSettings"`). The same entry shape is used by `PermissionRequestContext.permissionSuggestions` on the input side, so an allow-handler may echo a received suggestion verbatim (the upstream "always allow" pattern).
- **Block variant:** `interrupt?: boolean`. When true, Claude Code stops entirely (not just denies the permission). The engine maps `reason` to `decision.message` in the output.

## PostToolUse output fields

`PostToolUseResult` is a union of a skip-arm and a block-arm — hook authors may return `{result: "block", reason: "..."}` to surface a post-hoc block decision to Claude (the tool has already run). Both arms also support `updatedMCPToolOutput?: unknown` (replaces the MCP tool output at the **top level** of the output JSON, not inside `hookSpecificOutput`) and `injectContext`. PostToolUse sits in `OBSERVE_EVENTS` as a hybrid: the category still determines default translator behavior, but a PostToolUse-specific branch in `src/engine/translate.ts` emits `decision: "block"` when a block result arrives (whether from an author handler or an `onError: block` cascade).

## Branded strings and typed identifiers

The type system uses three distinct strategies for semantic types, depending on the domain:

**Closed literal union — `EventName`:**
`EventName` is a union of all 22 known Claude Code event name literals (e.g., `"PreToolUse" | "PostToolUse" | ...`). It does NOT include `(string & {})` — it is a closed set. The engine must know every event to translate results correctly. Unknown events are fail-closed errors, not forward-compatible pass-throughs. The type guard `isEventName()` (in `src/config/constants.ts`) narrows a runtime `string` to `EventName` at the stdin boundary.

**Branded types — `HookName`, `Milliseconds`:**
These use TypeScript's intersection branding pattern to prevent type confusion between semantically different primitives:
- `HookName = string & { __brand: "HookName" }` — Distinguishes hook names from event names and other strings. Open set (user-defined names). Boundary casts in `validate.ts` and test helpers convert plain strings to `HookName`.
- `Milliseconds = number & { __brand: "Milliseconds" }` — Distinguishes timeout values from plain numbers (failure counts, etc.). Used in `GlobalConfig.timeout`, `HookEntry.timeout`, and `DEFAULT_TIMEOUT`. Scoped to config/engine internals only — not exposed in hook-author-facing context types.

**Forward-compatible unions — `PermissionMode`, `SessionStartSource`, etc.:**
Enum-like context fields use `KnownValue | (string & {})`. This gives autocomplete for known values while remaining forward-compatible with new values Claude Code may add. These are used in hook-author-facing context types, where Claude Code may add new enum members in future versions.

## Normalization

The engine normalizes Claude Code's snake_case JSON payload into camelCase context objects before passing them to hook handlers. This is done by `src/normalize.ts`, which recursively converts all object keys (including nested objects and objects inside arrays).

After generic key normalization, the engine applies one domain-specific rename: `hookEventName` → `event`. Claude Code sends `hook_event_name` which normalizes to `hookEventName`, but the context types use `event` as the discriminant field. This rename happens in the engine, not in the normalize utility.

## HookOrigin and origin field

`HookOrigin` (in `src/config/types.ts`) is a literal union `"home" | "project"` indicating which config layer a hook originated from. Every `HookEntry` carries an `origin: HookOrigin` field, annotated by `loadConfig()` after the three-layer merge.

The origin determines path resolution: home hooks resolve source paths relative to `~/.clooks/`, project hooks relative to the project root. The engine uses origin for debugging and the `config --resolved` command uses it for provenance display.

## Config overrides and meta.config

Hook `meta.config` defaults are shallow-merged with config overrides from `clooks.yml` in the loader (`src/loader.ts`). The `loadHook()` function reads `hook.meta.config`, spreads the config overrides from `HookEntry.config` on top (`{ ...metaDefaults, ...overrides }`), and returns the merged config in `LoadedHook.config`. This merged config is what gets passed to handlers at runtime — handlers never see the raw meta.config or raw overrides separately.

`LoadedHook` also carries `usesTarget?: string` — the raw `uses` value from YAML config, present only when the hook is an alias. The engine uses this for error message formatting (including provenance like `(uses: crasher, .clooks/hooks/crasher.ts)`) and for `config --resolved` output.

## Runtime validation

TypeScript types are erased when hook files are dynamically imported. The loader (`src/loader.ts`) performs runtime validation of every hook export via `validateHookExport()`. It checks: `hook` named export exists and is an object, `hook.meta` exists with a `name` string, all property keys are in the allowed set (`meta`, `beforeHook`, `afterHook`, plus 22 event names), and all non-`meta` properties are functions. Invalid hooks cause fail-closed behavior (the engine exits with code 2 and a diagnostic message on stderr).

**`meta.name` relaxation for aliases:** After `validateHookExport()`, the loader checks `meta.name` against an expected name. For regular hooks (no `uses`), `meta.name` must match the YAML key. For aliases with hook-name `uses`, `meta.name` must match the `uses` target (not the YAML key). For aliases with path-like `uses` (`./`, `../`, `/`), `meta.name` validation is skipped entirely — the hook file is a custom path and its `meta.name` is whatever the author set.

## Two type layers

The codebase has two distinct type layers:
1. **Hook-author types** (`src/types/` except `claude-code.ts`) — camelCase, used in handler signatures.
2. **Engine types** (`src/types/claude-code.ts`) — snake_case, mirrors Claude Code's JSON wire format.

The engine uses `normalizeKeys()` to bridge these layers on input. Output translation (result → Claude Code JSON) is handled by `translateResult()` in the engine.

## `hookEventName` in `hookSpecificOutput`

Claude Code requires a `hookEventName` field set to the event name string inside every `hookSpecificOutput` object in the JSON output. This is a Claude Code requirement, not optional — without it, Claude Code treats the output as invalid and shows "hook error". The engine's `translateResult()` function sets this field automatically. The field is defined in `src/types/claude-code.ts` on output types like `PreToolUseOutput`.
