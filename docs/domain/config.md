# Config System

Config file parsing, validation, merging, and hook path resolution. This module reads `clooks.yml`, validates it, optionally merges with `clooks.local.yml`, resolves hook names to file paths, and returns a typed `ClooksConfig` object.

## Overview

The config system is the bridge between the YAML files a user writes and the typed data the engine consumes. It handles four concerns:

1. **Parsing** — Read YAML files and return raw JavaScript objects.
2. **Merging** — Deep-merge the base config with optional local overrides.
3. **Validation** — Check types and structure, separate hooks from events.
4. **Resolution** — Map hook names to file paths using convention rules.

The public entry point is `loadConfig(projectRoot)`, which performs all four steps and returns a `ClooksConfig`.

## Key Files

- `src/config/index.ts` — Public API: `loadConfig()` and type re-exports.
- `src/config/types.ts` — `ClooksConfig`, `HookEntry`, `EventEntry`, `GlobalConfig`, `ErrorMode`. Uses branded types from `src/types/branded.ts`: `HookName` for hook record keys, `EventName` for event record keys, `Milliseconds` for timeout fields.
- `src/config/constants.ts` — `CLAUDE_CODE_EVENTS`, `RESERVED_CONFIG_KEYS`, defaults.
- `src/config/parse.ts` — `parseYamlFile()` — reads and parses a single YAML file.
- `src/config/validate.ts` — `validateConfig()` — validates raw object, returns `ClooksConfig`.
- `src/config/merge.ts` — `deepMerge()`, `mergeConfigFiles()` — deep merge with array replacement.
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
| `path` | string | convention | Explicit file path relative to project root |
| `timeout` | `Milliseconds` | — | Per-hook timeout in ms |
| `onError` | `"block"` \| `"continue"` \| `"trace"` | — | Per-hook error handling |
| `parallel` | boolean | `false` | Run independently of sequential pipeline |
| `maxFailures` | number | — | Per-hook override for consecutive failure threshold |
| `maxFailuresMessage` | string | — | Per-hook override for the reminder message template |
| `events` | `Partial<Record<EventName, { onError?: ErrorMode }>>` | — | Per-hook, per-event overrides. Keys are event names, values are objects with `onError`. |

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

Hook names are resolved to file paths using these rules (in order):

1. **Explicit path** — If `path` is set in the hook entry, use it as-is (relative to project root).
2. **Remote hook** — If the name contains `/`, resolve to `.clooks/vendor/<name>/index.ts`.
3. **Local hook** — Otherwise, resolve to `.clooks/hooks/<name>.ts`.

Resolution does not check file existence. That is a loading concern handled by the engine.

## Config Merging

Two config files are supported:

- `.clooks/clooks.yml` — Base config (committed to git).
- `.clooks/clooks.local.yml` — Local overrides (gitignored).

Files are deep-merged: plain objects merge recursively, everything else (scalars, arrays, null) replaces. This means a local override only needs to specify the keys being changed.

```yaml
# clooks.yml
lint-guard:
  config:
    strict: true
    blocked_tools: [Bash]

# clooks.local.yml
lint-guard:
  config:
    strict: false

# Result after merge
lint-guard:
  config:
    strict: false           # replaced
    blocked_tools: [Bash]   # preserved (not specified in local)
```

**Note:** This file-level merge is distinct from the hook `meta.config` merge. The `meta.config` merge (hook defaults + config overrides) happens at hook loading time in `src/loader.ts` and is a shallow merge (spread operator, not `deepMerge`).

## Cascade Rules

**Timeout** cascades: hook → global → default (30000ms). No event level.

**onError** cascades through three levels: hook+event → hook → global → `"block"` default. The `"trace"` mode is only valid at hook or hook+event level (rejected at global level). At hook+event level, `"trace"` is rejected at parse time for non-injectable events. At hook level, `"trace"` triggers a runtime fallback to `"continue"` for non-injectable events (with a startup warning).

**maxFailures** and **maxFailuresMessage** cascade: hook → global → default. `maxFailures: 0` disables the circuit breaker. `maxFailures` does NOT increment for execution errors on hooks configured with `onError: "continue"` or `"trace"`. Import/load failures always count regardless of onError config.

## Circuit Breaker

A hook+event pair that fails N consecutive times (default 3) enters "degraded mode." In degraded mode the hook is skipped instead of blocking, but it is still retried on every invocation inside a safe try/catch. If it succeeds, the failure counter resets and the hook resumes normal operation automatically.

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
