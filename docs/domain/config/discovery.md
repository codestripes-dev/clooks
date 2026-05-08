# Config Discovery

How clooks resolves the project root before loading any config files.

## Overview

Before any `.clooks/clooks.yml` is read, the engine resolves the **project root** — the directory that contains `.clooks/clooks.yml`. Resolution follows a strict precedence order:

1. **`CLOOKS_PROJECT_ROOT`** (explicit env override) — If this variable is set, its value is used as the project root unconditionally. No walk is performed. Mirrors `prettier --config`, `tsc --project`, `GIT_DIR`. Highest priority.

2. **Walk-up from `$CLAUDE_PROJECT_DIR`** (primary anchor) — If `$CLAUDE_PROJECT_DIR` is set (Claude Code sets it for every hook invocation), the walk starts from that directory and walks toward the filesystem root looking for a directory containing `.clooks/clooks.yml`. This ensures that an agent that runs `cd /tmp && <action>` cannot bypass project hooks — the anchor is the session's project directory, not the mutable cwd.

3. **Walk-up from cwd** — If `$CLAUDE_PROJECT_DIR` is unset (manual CLI use, other agents) or its walk yields nothing, the walk runs from the current working directory. This is the same pattern used by `git`, `tsc`, and `prettier` for their config files.

4. **cwd fallback** — If no `.clooks/clooks.yml` is found anywhere on the walk, cwd is used as the project root. This is a no-op for the project config layer. On `SessionStart` events the engine emits a one-line stderr advisory so users in unusual layouts can detect the fallback.

## Walk Boundary

The walk stops at whichever of the following is reached first:

1. The git root (detected via `git rev-parse --show-toplevel`).
2. `$HOME`.
3. The filesystem root (`/`).

The boundary directory itself is included in the search. Once the boundary is reached and no config is found, the walk returns `found: null`.

## First Match Wins

The walk returns the first directory that contains `.clooks/clooks.yml`. Configs from multiple ancestor directories are never aggregated or merged. This is an intentional constraint — aggregation would make hook registration order-dependent on directory depth, which is difficult to reason about.

## Monorepo Trade-off

When `$CLAUDE_PROJECT_DIR` is set and its walk finds a config at the repo root, that config wins — even if cwd is inside a sub-package that has its own `.clooks/clooks.yml`. This is the documented behavior: the anchor (the Claude Code session's project) takes precedence over the cwd (where the agent happened to run a command). Use `CLOOKS_PROJECT_ROOT` to override per-invocation if a different behavior is needed.

## Key Files

- `src/config/discovery.ts` — `discoverProjectRoot()` and `findProjectRoot()`. Returns `DiscoveryResult` with `projectRoot`, `signal`, `from`, `checked`, `boundary`, `boundaryPath`.
- `src/config/constants.ts` — `CLOOKS_DIR`, `CLOOKS_CONFIG_FILENAME`.

## Observability

`clooks config --resolved` prints the resolved project root and the discovery signal at the top of its output. From a subdirectory:

```
Project root: /your/project (via walk-up from /your/project/src)
  checked: [/your/project/src, /your/project]
  boundary: git-root at /your/project
```

The `signal` field is one of:
- `"explicit-env"` — `CLOOKS_PROJECT_ROOT` was set.
- `"claude-project-dir"` — Walk from `$CLAUDE_PROJECT_DIR` found a config.
- `"walk-up"` — Walk from cwd found a config.
- `"cwd-fallback"` — No config found; cwd was used.

## Gotchas

- **`$CLAUDE_PROJECT_DIR` fallback surprise** — When `$CLAUDE_PROJECT_DIR` is set but its walk finds nothing, the cwd walk runs as a fallback. If cwd is inside a different project, that project's hooks fire. Run `clooks config --resolved` to verify which config clooks is using.
- **Symlinks** — The walk uses `realpath()` to canonicalize before walking, so symlinked directories are resolved to their real paths before boundary comparison.
- **`CLOOKS_HOME_ROOT`** — The home directory used for boundary computation can be overridden via `CLOOKS_HOME_ROOT` (used in tests). This does not affect `$HOME`-based path expansion in user-facing output.

## Related

- `docs/domain/config.md` — Config format, parsing, validation, merging, resolution.
- `docs/domain/bash-entrypoint.md` — Full environment variable table; the same `$CLAUDE_PROJECT_DIR` that drives discovery is set by Claude Code for every hook invocation.
- `docs/domain/global-hooks.md` — Home/project/local layering; how "project config" is now discovered rather than assumed to be at cwd.
