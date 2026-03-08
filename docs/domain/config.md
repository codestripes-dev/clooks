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
- `src/config/types.ts` — `ClooksConfig`, `HookEntry`, `EventEntry`, `GlobalConfig`, `ErrorMode`.
- `src/config/constants.ts` — `CLAUDE_CODE_EVENTS`, `RESERVED_CONFIG_KEYS`, defaults.
- `src/config/parse.ts` — `parseYamlFile()` — reads and parses a single YAML file.
- `src/config/validate.ts` — `validateConfig()` — validates raw object, returns `ClooksConfig`.
- `src/config/merge.ts` — `deepMerge()`, `mergeConfigFiles()` — deep merge with array replacement.
- `src/config/resolve.ts` — `resolveHookPath()` — convention-based path resolution.

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

PreToolUse:
  order: [anthropic/secret-scanner, no-production-writes]
  timeout: 10000
```

### Hook Entry Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `config` | object | `{}` | Config overrides (shallow-merged with hook's `meta.config` at load time) |
| `path` | string | convention | Explicit file path relative to project root |
| `timeout` | number | — | Per-hook timeout in ms |
| `onError` | `"block"` \| `"continue"` | — | Per-hook error handling |
| `parallel` | boolean | `false` | Run independently of sequential pipeline |

### Event Entry Fields

| Field | Type | Description |
|-------|------|-------------|
| `order` | string[] | Explicit execution order for hooks on this event |
| `timeout` | number | Per-event timeout in ms |
| `onError` | `"block"` \| `"continue"` | Per-event error handling |

### Global Config

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `timeout` | number | 30000 | Default timeout for all hooks |
| `onError` | `"block"` \| `"continue"` | `"block"` | Default error handling |

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

**Note:** This file-level merge is distinct from the hook `meta.config` merge. The `meta.config` merge (hook defaults + config overrides) happens at hook loading time and is a shallow merge. The `deepMerge` utility can be reused for that purpose.

## Cascade Rules

Timeout and onError resolve through a cascade: hook → event → global → default.

- If a hook entry specifies `timeout`, use it.
- Otherwise, if the event entry specifies `timeout`, use it.
- Otherwise, use the global `config.timeout`.
- If no global timeout, use the default (30000ms).

The same cascade applies to `onError`. The cascade is applied at runtime by the engine, not by the config module.

## Performance

Config parsing takes ~18ms per invocation using js-yaml (2 bundled modules in the compiled binary). No caching is implemented — caching is deferred as a future optimization. The research in `docs/research/config-file-parsing.md` documents a JSON cache strategy that can reduce this to ~14ms.

## Gotchas

- **Event names are reserved** — All 18 Claude Code event names are classified as event entries, never hook entries. A key like `Stop` always goes to `events`, even if its value looks like a hook entry.
- **`noUncheckedIndexedAccess`** — The project uses strict TypeScript. Accessing `config.hooks["name"]` returns `HookEntry | undefined`. Always check before use.
- **Arrays replace, don't append** — In config merging, arrays in the override file completely replace arrays in the base file. There is no array concatenation.
- **`meta.config` merge is not here** — The config module stores overrides in `HookEntry.config`. The merge with `meta.config` defaults from the hook's TypeScript file happens at hook loading time (FEAT-0003), not at config parsing time.

## Related

- `docs/domain/hook-type-system.md` — Hook contract and type system
- `docs/planned/FEAT-0001-config-format.md` — Config format feature
- `docs/planned/FEAT-0003-dynamic-hook-loading.md` — Dynamic hook loading (consumes config)
- `docs/research/config-file-parsing.md` — YAML parser research and benchmarks
- `docs/research/layered-config-local-overrides.md` — Config merging research
