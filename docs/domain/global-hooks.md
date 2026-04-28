# Global Hooks

Architecture for user-wide hooks that apply to all projects, even those without a `.clooks/` directory.

## Overview

Global hooks live in `~/.clooks/` and are loaded by the engine alongside project-level hooks. They enable security, logging, and compliance hooks that apply everywhere without per-project setup.

## Directory Structure

```
~/.clooks/
  clooks.yml          # home config — hooks, events, global settings
  hooks/              # home hook source files
  vendor/             # home vendor hooks
    github.com/       # manually added hooks (clooks add --global)
    plugin/           # plugin-delivered hooks (auto-vendored from plugin cache)
  bin/
    clooks            # compiled binary (shared across all projects)
  failures/           # failure state for home-only projects
    <hash>.json       # SHA-256(projectRoot)[0:12] → failure state
  .global-entrypoint-active   # flag file for entrypoint dedup
```

Global hooks installed via `clooks add --global` use the same short address `uses:` format as project hooks (e.g., `uses: someuser/security-hooks:secret-scanner`). They resolve relative to `~/.clooks/` via origin-aware path construction in `resolveHookPath()`.

### Plugin Hooks in Home Config

User-scoped plugins (scope `"user"` in `installed_plugins.json`) are automatically vendored to `~/.clooks/vendor/plugin/<pack-name>/` and registered in `~/.clooks/clooks.yml` with path-like `uses` values. This happens during the engine's plugin discovery step — no manual setup required. See `docs/domain/vendoring/plugin-vendoring.md` for the full discovery and vendoring workflow.

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
- **Hooks** — **Atomic replacement.** A project hook with the same name as a home hook replaces the home hook entirely. Local hooks can modify existing hooks or introduce new ones (new hooks get origin `"project"`).
- **Events** — Home order + project order are concatenated (home first). Local replaces the event entry entirely.

### Hook Origin Tracking

Every `HookEntry` carries an `origin: HookOrigin` field (`"home" | "project"`) set during config loading. The origin determines where the hook source file is resolved from:

- `"home"` hooks resolve paths relative to `~/.clooks/` (via `resolveHookPath()` with `homeRoot` as base).
- `"project"` hooks resolve paths relative to the project root.

See `src/config/types.ts` for the `HookOrigin` type and `src/config/index.ts` for origin annotation logic.

## Entrypoint Dedup

When both a global entrypoint (`~/.clooks/bin/entrypoint.sh` registered in `~/.claude/settings.json`) and a project entrypoint (`"$CLAUDE_PROJECT_DIR"/.clooks/bin/entrypoint.sh` registered in `.claude/settings.json`) exist, the global entrypoint handles everything. The project entrypoint checks for the flag file `~/.clooks/.global-entrypoint-active` and exits early if present.

See `docs/domain/bash-entrypoint.md` for details.

## Failure State Strategy

Failure state (circuit breaker data) is stored differently depending on project setup:

- **Project with `.clooks/`** — Stored at `.clooks/.failures` (same as before).
- **Home-only project** — Stored centrally at `~/.clooks/failures/<hash>.json`, where `<hash>` is the first 12 hex characters of `SHA-256(projectRoot)`.

The `getFailurePath()` function in `src/failures.ts` computes the path. `writeFailures()` ensures the parent directory exists before writing (handles the case where `~/.clooks/failures/` doesn't exist yet).

**`LOAD_ERROR_EVENT` recovery:** When a hook fails to load (missing file), failures are recorded under the synthetic event key `__load__` (not the runtime event name). When the hook file is restored and loads successfully, the engine clears the `__load__` counter. This was a bug fix — previously, the `__load__` counter was never cleared because the success path only cleared the runtime event counter.

## Shadow Warnings

When a project hook has the same name as a home hook, the home hook is replaced (shadowed). The engine emits a single collapsed warning on `SessionStart` events, listing all shadowed hook names alphabetically:

```
clooks: project hooks shadowing home: log-bash-commands, security-audit
```

A single shadowed hook produces a one-name line:

```
clooks: project hooks shadowing home: security-audit
```

**No-op suppression.** A shadow whose project hook source file is byte-identical to the home hook source file is silently dropped from the warning. This is the common team-vendoring case: every developer has the core hooks installed globally and the team also vendors the same hooks into the project — those shadows are noise, not signal. Genuine divergences (the project copy was modified, a stale fork, a typo'd patch) still warn, because that is the case worth surfacing. Comparison is byte-for-byte against the resolved `.ts` (or `.js`) source file, not against `clooks.yml` config — a project may legitimately tune `config:` per-environment without that counting as divergence.

**Strict byte-compare gotcha.** The comparison is intentionally raw — no whitespace normalization, no line-ending normalization, no BOM stripping. A vendored hook with CRLF line endings on a Windows clone, or a leading UTF-8 BOM inserted by an editor, will be treated as divergent from the home hook even when semantically identical. If a SessionStart warning is unexpected, run `diff ~/.clooks/hooks/<name>.ts <project>/.clooks/<path-to-vendored>/<name>.ts` to see what actually differs. On any I/O error reading either source file, the shadow is **kept** in the warning (preserve signal on uncertainty).

**Where the work happens.** Shadow detection (the name list) is performed during config merge (`mergeThreeLayerConfig()` in `src/config/merge.ts`); `mergeThreeLayerConfig` does no I/O and returns every detected shadow. The source-bytes equality filter lives in `loadConfig()` (`src/config/index.ts`), which re-derives both the project-side and home-side resolved paths via `resolveHookPath` (with explicit `projectRoot` and `homeRoot` bases — never trusting `entry.resolvedPath`, which `validateConfig` produces cwd-relative) and reads both files via `Bun.file(...).bytes()` for the comparison. The filtered list is returned in `LoadConfigResult.shadows` and consumed by `buildShadowWarnings()` in `src/engine/match.ts`.

**Local layer is out of scope by design.** The local config (`clooks.local.yml`) cannot introduce a new home-origin hook (`merge.ts:175-185` assigns `origin: "project"` to new local hook names), so a local entry can only ever override an existing project or home entry — preserving the source file. Under the source-bytes-equal suppression rule, every local "shadow" would be source-identical and silenced anyway, so no warning category is wired for it.

**Gotcha:** Shadow warnings are only emitted on `SessionStart` events. If no hooks match SessionStart (e.g., all hooks handle only PreToolUse), the shadow warning is still emitted because it runs before event matching. This was a bug fix — previously, shadow warnings were computed after the early-exit check and were lost when no hooks matched.

## Key Files

- `src/config/index.ts` — `loadConfig()` with three-layer merge and origin annotation.
- `src/config/merge.ts` — `mergeThreeLayerConfig()` — merge logic, origin map, shadow detection.
- `src/config/types.ts` — `HookOrigin` type, `HookEntry.origin` field.
- `src/failures.ts` — `getFailurePath()`, `readFailures()`, `writeFailures()`.
- `src/engine/match.ts` — `buildShadowWarnings()`.
- `src/engine/run.ts` — `runEngine()`, `startupWarnings` assembly, failure path computation.
- `src/commands/config.ts` — `config --resolved` provenance command.
- `src/commands/init.ts` — `init --global` for home directory setup.

## Related

- `docs/domain/config.md` — Config system details, merge rules, cascade rules.
- `docs/domain/vendoring/plugin-vendoring.md` — Plugin cache discovery, plugin hook vendoring, scope-based routing.
- `docs/domain/bash-entrypoint.md` — Entrypoint script and dedup mechanism.
- `docs/domain/hook-type-system.md` — `HookOrigin` type documentation.
- `docs/domain/cli-architecture.md` — CLI commands including `config --resolved`.
