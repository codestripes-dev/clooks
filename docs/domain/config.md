# Config System

Config file parsing, validation, merging, and hook path resolution. This module reads up to three config layers (`~/.clooks/clooks.yml`, `.clooks/clooks.yml`, `.clooks/clooks.local.yml`), validates and merges them, resolves hook names to file paths, and returns a typed `ClooksConfig` object with origin annotations.

## Overview

The config system is the bridge between the YAML files a user writes and the typed data the engine consumes. It handles five concerns:

1. **Parsing** — Read YAML files and return raw JavaScript objects.
2. **Three-layer merging** — Merge home, project, and local configs with semantic rules per field type.
3. **Validation** — Zod v4 `safeParse()` validates types and structure; `superRefine()` handles cross-field checks (alias chains, order refs, trace+injectable). JSON Schema is auto-generated from the same Zod definitions.
4. **Resolution** — Map hook names to file paths using convention rules.
5. **Origin tracking** — Annotate each hook with which layer it came from (`"home"` or `"project"`).

The public entry point is `loadConfig(projectRoot, options?)`, which performs all steps and returns a `LoadConfigResult` (or `null` if no config exists).

## Key Files

- `src/config/index.ts` — Public API: `loadConfig()` and type re-exports.
- `src/config/schema.ts` — Zod v4 schema definitions (single source of truth). Exports Zod schemas (`ClooksConfigSchema`, `GlobalConfigSchema`, `HookEntrySchema`, `EventEntrySchema`), derived TypeScript types (`ClooksConfig`, `HookEntry`, `EventEntry`, `GlobalConfig`, `ErrorMode`, `HookOrigin`), and `generateJsonSchema()` for auto-generating the JSON Schema. Uses branded types from `src/types/branded.ts`.
- `src/config/constants.ts` — `CLAUDE_CODE_EVENTS`, `RESERVED_CONFIG_KEYS`, defaults.
- `src/config/parse.ts` — `parseYamlFile()` — reads and parses a single YAML file.
- `src/config/validate.ts` — `validateConfig()` — calls Zod's `safeParse()` on the raw object, translates errors via `formatZodError()`, and transforms the validated output to `ClooksConfig`.
- `src/config/merge.ts` — `deepMerge()`, `mergeConfigFiles()`, `mergeThreeLayerConfig()` — merge logic including three-layer merge with origin tracking.
- `src/config/resolve.ts` — `resolveHookPath()` — convention-based path resolution.
- `src/loader.ts` — Consumer of `loadConfig()`. Dynamically imports hooks, validates exports, merges config.
- `src/failures.ts` — Circuit breaker failure state: read/write `.clooks/.failures`, record/clear/query failures.

## Config Format

The config file (`.clooks/clooks.yml`) uses a flat top-level structure. Keys are discriminated by type:

- `version` — Required. Semver string.
- `config` — Optional. Global settings (timeout, onError).
- Keys matching a Claude Code event name (e.g., `PreToolUse`) — Event entries.
- All other keys — Hook entries.

```yaml
version: "1.0.0"

config:
  timeout: 30000
  onError: block

log-bash-commands:
  config:
    logDir: ".clooks/logs"

no-production-writes: {}

anthropic/secret-scanner:
  config:
    strict: true
  timeout: 5000
  onError: trace
  events:
    PreToolUse:
      onError: block

PreToolUse:
  order: [anthropic/secret-scanner, no-production-writes]
```

### Hook Entry Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `config` | object | `{}` | Config overrides (shallow-merged with hook's `meta.config` at load time) |
| `uses` | string | — | Implementation source. Path-like values (`./`, `../`, `/`) are file paths. Hook names resolve via conventions. Enables aliases when different from the YAML key. |
| `timeout` | `Milliseconds` | — | Per-hook timeout in ms |
| `onError` | `"block"` \| `"continue"` \| `"trace"` | — | Per-hook error handling |
| `parallel` | boolean | `false` | Run independently of sequential pipeline |
| `maxFailures` | number | — | Per-hook override for consecutive failure threshold |
| `maxFailuresMessage` | string | — | Per-hook override for the reminder message template |
| `enabled` | boolean | `true` | If `false`, hook is fully disabled — loads but never runs for any event. |
| `events` | `Partial<Record<EventName, { onError?: ErrorMode; enabled?: boolean }>>` | — | Per-hook, per-event overrides. Keys are event names, values are objects with `onError` and/or `enabled`. |

### Event Entry Fields

| Field | Type | Description |
|-------|------|-------------|
| `order` | `HookName[]` | Explicit execution order for hooks on this event |

Event-level `timeout` and `onError` have been removed. Use per-hook `timeout` and per-hook event overrides (`hooks.<name>.events.<event>.onError`) instead.

### Global Config

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `timeout` | `Milliseconds` | 30000 | Default timeout for all hooks |
| `onError` | `"block"` \| `"continue"` | `"block"` | Default error handling. `"trace"` is not allowed at the global level. |
| `maxFailures` | number | `3` | Consecutive failures before a hook+event pair is degraded. `0` = disabled (classic fail-closed). |
| `maxFailuresMessage` | string | *(see below)* | Template for the reminder message when a degraded hook is skipped. Supports `{hook}`, `{event}`, `{count}`, `{error}` interpolation. |

## Hook Path Resolution

Hook paths are resolved using a two-step process: first determine the **resolution key** (what name to resolve), then apply **convention rules** to map it to a file path.

**Step 1 — Resolution key:**

- If `uses` is set and path-like (`./`, `../`, `/`, or bare `..`) — use `uses` as a direct file path (relative to the origin root). The path must be relative — absolute paths and path traversal sequences (`..`) are rejected at resolution time with a descriptive error.
- If `uses` is set and is a short address (`owner/repo:hook-name`) — resolve deterministically to the vendor file path (see below).
- If `uses` is set and is a hook name — resolve using convention rules with `uses` as the key.
- If `uses` is not set and the YAML key is a short address (`owner/repo:hook-name`) — resolve deterministically to the vendor file path, same as the short address `uses` branch above.
- If `uses` is not set and the YAML key is not a short address — resolve using convention rules with the YAML key as the key.

**Step 2 — Convention rules (applied to the resolution key):**

1. **Remote hook** — If the key contains `/`, resolve to `.clooks/vendor/<key>/index.ts`.
2. **Local hook** — Otherwise, resolve to `.clooks/hooks/<key>.ts`.

Resolution does not check file existence. That is a loading concern handled by the engine.

**Short address resolution** — `isShortAddress(value)` in `resolve.ts` detects values matching `owner/repo:hook-name` (contains `:`, not path-like). The resolver splits on `:`, constructs `.clooks/vendor/github.com/<owner>/<repo>/<hook-name>.{ts,js}`, and uses `existsSync` to detect the extension. No cache needed — resolution is a pure function of the address string.

**Vendored hook example** — `clooks add` writes short address `uses:` values (FEAT-0040+). Path-like values written by FEAT-0039 V0 remain fully supported via `isPathLike`.

```yaml
# Short address (current — FEAT-0040+)
lint-guard:
  uses: someuser/hooks:lint-guard

# Path-like (V0 legacy — still supported)
lint-guard:
  uses: ./.clooks/vendor/github.com/someuser/hooks/lint-guard.ts
```

Both formats skip `meta.name` validation (routed through `isShortAddress` or `isPathLike` before the convention rules are reached). See `docs/domain/vendoring.md` for the full vendoring workflow.

## Hook Aliases

A hook alias is a YAML entry whose `uses` field references a different hook implementation. This allows the same `.ts` file to run multiple times with different configs.

```yaml
verbose-logger:
  uses: log-bash
  config: { verbose: true }
quiet-logger:
  uses: log-bash
  config: { verbose: false }
```

**Rules:**

1. Referenced hook does NOT need its own YAML entry.
2. Each alias is an independent hook for ordering, circuit breaker, and error tracking (keyed by YAML key, not `uses` target).
3. `meta.name` is validated against the `uses` target, not the YAML key. Path-like `uses` skips `meta.name` validation entirely.
4. Alias chains are not allowed — if `uses` references a YAML key that itself has `uses`, validation fails.
5. Module-level state is shared between aliases of the same `.ts` file within a single invocation (Bun's module cache).
6. Error messages include the `uses` target: `Hook "my-alias" (uses: crasher, .clooks/hooks/crasher.ts) failed on PreToolUse`.

**Local overrides:** Because local config uses atomic replacement, a local override of an alias must repeat the `uses` field. Without `uses`, the alias name resolves as a file path (which likely does not exist).

## Config Merging — Three-Layer Loading

Three config files are supported, loaded in order:

1. `~/.clooks/clooks.yml` — Home config (user-wide hooks and defaults).
2. `.clooks/clooks.yml` — Project config (committed to git).
3. `.clooks/clooks.local.yml` — Local overrides (gitignored).

Merge rules differ by field type (implemented in `mergeThreeLayerConfig()`):

- **`version`** — Last-writer-wins (project overrides home, local overrides both).
- **`config`** — Deep merge across all layers. Plain objects merge recursively; scalars and arrays replace.
- **Hooks** — **Atomic replacement.** A project hook with the same name as a home hook replaces it entirely (this is a "shadow"). Local hooks can modify existing hooks but cannot introduce new ones.
- **Events** — Home order + project order are concatenated (home hooks first). Local replaces the event entry entirely.

### Scoping Rules

Home event order lists can only reference hooks defined in the home config. Project event order lists can only reference hooks defined in the project config. Violations produce descriptive errors at config load time.

### Origin Tracking

Each `HookEntry` carries an `origin: HookOrigin` field (`"home" | "project"`) annotated during `loadConfig()`. Home hooks resolve their source paths relative to `~/.clooks/`; project hooks resolve relative to the project root.

**Note:** The file-level merge is distinct from the hook `meta.config` merge. The `meta.config` merge (hook defaults + config overrides) happens at hook loading time in `src/loader.ts` and is a shallow merge (spread operator, not `deepMerge`).

## Cascade Rules

**Timeout** cascades: hook → global → default (30000ms). No event level. The resolution function `resolveTimeout(hookName, config)` in the engine checks `config.hooks[hookName]?.timeout` first, then falls back to `config.global.timeout` (which defaults to 30000ms / `DEFAULT_TIMEOUT`). Each hook invocation gets its own timeout via `runHookLifecycle`, which races the entire lifecycle (beforeHook + handler + afterHook) against a single `setTimeout` reject. A `beforeHook` that consumes most of the timeout budget leaves less time for the handler and `afterHook`.

**onError** cascades through three levels: hook+event → hook → global → `"block"` default. The `"trace"` mode is only valid at hook or hook+event level (rejected at global level). At hook+event level, `"trace"` is rejected at parse time for non-injectable events. At hook level, `"trace"` triggers a runtime fallback to `"continue"` for non-injectable events (with a startup warning). Errors in lifecycle methods (`beforeHook` and `afterHook`) use the same onError cascade as the event handler — the engine does not distinguish which phase threw.

**maxFailures** and **maxFailuresMessage** cascade: hook → global → default. `maxFailures: 0` disables the circuit breaker. `maxFailures` does NOT increment for execution errors on hooks configured with `onError: "continue"` or `"trace"`. Import/load failures always count regardless of onError config.

## Disabling Hooks

The `enabled` field controls whether a hook runs. It can be set at two levels:

**Hook-level disable** (`enabled: false` on the hook entry) — the hook loads but never runs for any event. Hook-level disable takes precedence over per-event settings; even if a per-event override sets `enabled: true`, the hook remains fully disabled.

**Per-event disable** (`events.<EventName>.enabled: false`) — the hook is skipped for that specific event but runs normally for others.

**Interaction with order lists:** A disabled hook that appears in an event's `order` list is silently skipped at runtime (no error). A startup warning is emitted on SessionStart to alert the user that the order list references a disabled hook.

**Unhandled event warning:** If `enabled: false` is set for an event the hook does not handle (i.e., the hook has no handler for that event), a startup warning is emitted on SessionStart. This catches typos and stale config.

**Config layering:** Because hook entries merge atomically across layers, a local override of `enabled: false` replaces the entire hook entry — other fields (`uses`, `timeout`, `onError`, `events`) from the base layer are lost. To re-enable a hook, remove the local entry entirely rather than changing `enabled: false` to `enabled: true` (which would leave the other fields missing).

## Execution Group Model

When the engine executes hooks for an event, it partitions them into **execution groups** — contiguous runs of hooks that share the same execution mode (parallel or sequential). The pipeline processes groups in order, and a block result from any group stops the entire pipeline.

### Lifecycle Methods

When a hook defines `beforeHook` and/or `afterHook`, the lifecycle is an atomic unit within the hook's execution. In sequential groups, the lifecycle (beforeHook → handler → afterHook) runs as part of the sequential flow. In parallel groups, the lifecycle is atomic within the hook's promise chain — each hook's lifecycle runs independently of other hooks in the batch.

The `LoadedHook` interface carries fields used by the lifecycle system and alias tracking:
- `hookPath: string` — Absolute path to the hook's `.ts` file. Populated by `loadHook()`.
- `configPath: string` — Absolute path to the `clooks.yml` that registered the hook. Derived from the hook's origin (home or project).
- `usesTarget?: string` — Raw `uses` value from YAML config, present only for alias hooks. Used by error formatting to include provenance in diagnostic messages.

### Ordering

Hook execution order is determined by `orderHooksForEvent()` in `src/ordering.ts`. There are two modes:

1. **No order list** — Parallel hooks are hoisted to the front, sequential hooks follow. Declaration order is preserved within each group.
2. **Order list exists** (`EventEntry.order`) — The ordered hooks go in the positions specified by the list. Unordered parallel hooks go at the beginning, unordered sequential hooks go at the end. Original matched order is preserved within unordered groups.

### Order list validation

The order list (`EventEntry.order`) is validated at two levels:

- **Config-time** — Names in the order list must be defined hooks in the config (validated by `validateConfig()`).
- **Runtime** — Names in the order list must appear in the matched hook set for the current event. If an order list references a hook that does not handle the event (i.e., it was filtered out by `matchHooksForEvent()`), `orderHooksForEvent()` throws with a descriptive error. This is a structural/config error — the engine cannot proceed with an invalid order list. **Exception:** hooks disabled via `enabled: false` are silently skipped in the order list (not an error).

### Partitioning

After ordering, `partitionIntoGroups()` walks the ordered list and starts a new group whenever the `parallel` flag changes. The result is a sequence of `ExecutionGroup` objects, each with a `type` ("parallel" or "sequential") and a list of hooks.

Example: given hooks `[par-A, par-B, seq-C, seq-D, par-E]`, the groups would be:
1. `parallel: [par-A, par-B]`
2. `sequential: [seq-C, seq-D]`
3. `parallel: [par-E]`

A diagnostic warning is emitted when a single parallel hook is sandwiched between sequential groups (functionally equivalent to sequential).

### Group execution

- **Sequential groups** — Hooks run one at a time. Each hook receives the current `toolInput` (possibly modified by a prior hook's `updatedInput`). A block result stops the group and the pipeline.
- **Parallel groups** — All hooks in the group start concurrently. They all see the same `toolInput` snapshot. A short-circuit mechanism aborts remaining hooks when a block or contract violation (`updatedInput` in parallel mode) is detected. Results are merged after all hooks settle (or short-circuit).

## Circuit Breaker

A hook+event pair that fails N consecutive times (default 3) enters "degraded mode." In degraded mode the hook is skipped instead of blocking, but it is still retried on every invocation inside a safe try/catch. Lifecycle method failures (`beforeHook` and `afterHook` throws) share the hook's `(hookName, eventName)` failure counter — they are not tracked separately from handler failures. If it succeeds, the failure counter resets and the hook resumes normal operation automatically.

**State storage:** Failure state is persisted in `.clooks/.failures` (JSON, gitignored). The file is managed entirely by the engine. It is created on first failure, updated on subsequent failures, and deleted when all hooks are healthy. The in-memory type is `FailureState = Record<HookName, Partial<Record<EventName, HookEventFailure>>>` — both dimensions are branded, preventing key confusion between hook names and event names.

**File format:**

```json
{
  "hook-name": {
    "PreToolUse": {
      "consecutiveFailures": 3,
      "lastError": "Cannot find module '@clooks/utils'",
      "lastFailedAt": "2026-03-09T10:15:00Z"
    }
  }
}
```

**Reminder delivery:** When a degraded hook is skipped, a reminder message is injected into the agent's context via `injectContext` / `additionalContext` for injectable events (PreToolUse, UserPromptSubmit, SessionStart, PostToolUse, PostToolUseFailure, Notification, SubagentStart). For non-injectable events, the message is written to stderr.

**Disabling:** Set `maxFailures: 0` on a hook entry to disable the circuit breaker for that hook. It will always fail-closed regardless of how many times it fails.

**Load errors:** Hooks that fail to import (missing file, broken dependency) are also routed through the circuit breaker. `loadAllHooks` is fault-tolerant — it uses `Promise.allSettled` and returns load errors alongside successfully loaded hooks. The engine processes load errors through the same threshold logic as execution errors. Note: load error counters are currently tracked per hook+event (same as execution errors), which means a load failure must independently reach the threshold on each event type. See FEAT-0015 for a planned improvement to degrade load errors globally across all events.

## Performance

Config parsing takes ~15ms per invocation using Bun's native YAML parser (`Bun.YAML.parse`), which is written in Zig and built into the Bun runtime. No external dependencies and no caching needed. The parser adds ~0.17ms of parse time (the remaining overhead is file I/O and binary startup). See `docs/research/yaml-parser-comparison.md` for benchmarks comparing this to js-yaml and other alternatives.

## Gotchas

- **Unknown keys are rejected** — Unrecognized keys in any config section (global config, event entries, hook entries, hook event overrides) produce an immediate error naming the unknown key and listing valid keys. This catches typos like `tiemout` instead of `timeout`.
- **Event names are reserved** — All 18 Claude Code event names are classified as event entries, never hook entries. A key like `Stop` always goes to `events`, even if its value looks like a hook entry.
- **`noUncheckedIndexedAccess`** — The project uses strict TypeScript. Accessing `config.hooks["name"]` returns `HookEntry | undefined`. Always check before use.
- **Arrays replace, don't append** — In config merging, arrays in the override file completely replace arrays in the base file. There is no array concatenation.
- **`meta.config` merge is not here** — The config module stores overrides in `HookEntry.config`. The merge with `meta.config` defaults from the hook's TypeScript file happens at hook loading time in `src/loader.ts` (`loadHook()`), not at config parsing time.

## Related

- `docs/domain/hook-type-system.md` — Hook contract and type system
- `docs/planned/done/FEAT-0001-config-file-parsing.md` — Config format feature
- `docs/planned/done/FEAT-0003-dynamic-hook-loading.md` — Dynamic hook loading (consumes config)
- `docs/research/config-file-parsing.md` — YAML parser research and benchmarks
- `docs/research/yaml-parser-comparison.md` — Bun.YAML vs js-yaml comparison and benchmarks
- `docs/research/layered-config-local-overrides.md` — Config merging research
