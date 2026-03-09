# Global Hooks

Architecture for user-wide hooks that apply to all projects, even those without a `.clooks/` directory.

## Overview

Global hooks live in `~/.clooks/` and are loaded by the engine alongside project-level hooks. They enable security, logging, and compliance hooks that apply everywhere without per-project setup.

## Directory Structure

```
~/.clooks/
  clooks.yml          # home config — hooks, events, global settings
  hooks/              # home hook source files
  vendor/             # home vendor hooks (marketplace)
  bin/
    clooks            # compiled binary (shared across all projects)
  failures/           # failure state for home-only projects
    <hash>.json       # SHA-256(projectRoot)[0:12] → failure state
  .global-entrypoint-active   # flag file for entrypoint dedup
```

## Config Scoping Rules

Three config layers, merged in order (last writer wins for scalars):

| Layer | File | Purpose |
|-------|------|---------|
| Home | `~/.clooks/clooks.yml` | User-wide hooks and defaults |
| Project | `.clooks/clooks.yml` | Project-specific hooks and overrides |
| Local | `.clooks/clooks.local.yml` | Developer-local overrides (gitignored) |

If neither home nor project config exists, the engine exits cleanly (no hooks to run).

## Merge Semantics

- **`version`** — Last-writer-wins (project > home, local > both).
- **`config`** — Deep merge across all layers. Nested objects merge recursively; scalars and arrays replace.
- **Hooks** — **Atomic replacement.** A project hook with the same name as a home hook replaces the home hook entirely. Local hooks can only modify existing hooks (cannot introduce new ones).
- **Events** — Home order + project order are concatenated (home first). Local replaces the event entry entirely.

### Hook Origin Tracking

Every `HookEntry` carries an `origin: HookOrigin` field (`"home" | "project"`) set during config loading. The origin determines where the hook source file is resolved from:

- `"home"` hooks resolve paths relative to `~/.clooks/` (via `resolveHookPath()` with `homeRoot` as base).
- `"project"` hooks resolve paths relative to the project root.

See `src/config/types.ts` for the `HookOrigin` type and `src/config/index.ts` for origin annotation logic.

## Entrypoint Dedup

When both a global entrypoint (`~/.clooks/bin/entrypoint.sh` registered in `~/.claude/settings.json`) and a project entrypoint (`.clooks/bin/entrypoint.sh` registered in `.claude/settings.json`) exist, the global entrypoint handles everything. The project entrypoint checks for the flag file `~/.clooks/.global-entrypoint-active` and exits early if present.

See `docs/domain/bash-entrypoint.md` for details.

## Failure State Strategy

Failure state (circuit breaker data) is stored differently depending on project setup:

- **Project with `.clooks/`** — Stored at `.clooks/.failures` (same as before).
- **Home-only project** — Stored centrally at `~/.clooks/failures/<hash>.json`, where `<hash>` is the first 12 hex characters of `SHA-256(projectRoot)`.

The `getFailurePath()` function in `src/failures.ts` computes the path. `writeFailures()` ensures the parent directory exists before writing (handles the case where `~/.clooks/failures/` doesn't exist yet).

## Shadow Warnings

When a project hook has the same name as a home hook, the home hook is replaced (shadowed). The engine emits a warning on `SessionStart` events:

```
clooks: project hook "security-audit" is shadowing a global hook with the same name.
```

Shadow detection is performed during config merge (`mergeThreeLayerConfig()` in `src/config/merge.ts`). The `shadows` list is returned in `LoadConfigResult` and consumed by `buildShadowWarnings()` in `src/engine.ts`.

## Key Files

- `src/config/index.ts` — `loadConfig()` with three-layer merge and origin annotation.
- `src/config/merge.ts` — `mergeThreeLayerConfig()` — merge logic, origin map, shadow detection.
- `src/config/types.ts` — `HookOrigin` type, `HookEntry.origin` field.
- `src/failures.ts` — `getFailurePath()`, `readFailures()`, `writeFailures()`.
- `src/engine.ts` — `buildShadowWarnings()`, failure path computation in `runEngine()`.
- `src/commands/config.ts` — `config --resolved` provenance command.
- `src/commands/init.ts` — `init --global` for home directory setup.

## Related

- `docs/domain/config.md` — Config system details, merge rules, cascade rules.
- `docs/domain/bash-entrypoint.md` — Entrypoint script and dedup mechanism.
- `docs/domain/hook-type-system.md` — `HookOrigin` type documentation.
- `docs/domain/cli-architecture.md` — CLI commands including `config --resolved`.
