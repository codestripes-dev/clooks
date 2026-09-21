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
    entrypoint.sh     # shared global launcher
    runtime-advisory.sh # SessionStart-only runtime-floor reminder
  failures/           # failure state for home-only projects
    <hash>.json       # SHA-256(projectRoot)[0:12] → failure state
  .cache/approvals-live/v1/          # shared invocation IPC, retained by full cleanup
  .global-entrypoint-active         # legacy Claude dedup flag
  .global-entrypoint-active.codex   # versioned Codex registration receipt
  .codex-registration-home         # Codex cleanup identity; never suppresses projects
```

Global hooks installed via `clooks add --global` use the same short address `uses:` format as project hooks (e.g., `uses: someuser/security-hooks:secret-scanner`). They resolve relative to `~/.clooks/` via origin-aware path construction in `resolveHookPath()`.

### Plugin Hooks in Home Config

User-scoped plugins (scope `"user"` in `installed_plugins.json`) are automatically vendored to `~/.clooks/vendor/plugin/<pack-name>/` and registered in `~/.clooks/clooks.yml` with path-like `uses` values. This happens during the engine's plugin discovery step — no manual setup required. See `docs/domain/vendoring/plugin-vendoring.md` for the full discovery and vendoring workflow.

## Guarded Local Hook Trials

Existing installations can trial reviewed canonical vendor updates without uninstalling, rerunning init, changing registrations or running a global build script. Capture the actual launcher PATH and resolved executable first: the runtime can be `~/bin/clooks`, not the layout's `~/.clooks/bin/clooks` or another installed copy. Inspect regular-file/symlink identity and preserve unrelated binaries and launcher bytes.

Validate the frozen source and binary before live replacement. The [native smoke export](./testing/codex-native.md#tested-binary-export) binds the deployable executable to all required native case receipts. Freeze exact source/destination hashes, modes and expected absence, plus immutable config/registration/provenance snapshots. Use separately approved outside-root operations and a unique backup directory with a manifest and verified original bytes; never reuse an existing clooks.bak.

Install only the effective runtime through a guarded sibling temporary and atomic rename, preserving executable mode. Check both agents' lifecycle markers with that exact binary in isolated configuration before replacing allowlisted hooks. Preserve already-equal global files and legitimate local customizations; add agent-bearing pack declarations only as explicit manifest entries. Verify postimages, backup images and immutable snapshots. Guard rollback against the owned postimage, restore original modes/bytes, and remove originally absent additions only when still owned. These are individually guarded operations, not a multi-file transaction or protection against hostile concurrent writers.

Canonical project overlays remain independently active through normal merge rules; global file identity alone does not establish project behavior. Separate benign native-session evidence from manually supplied agent wire probes. An absent global Codex registration cannot be treated as home-only native activation, and trial validation must not create registration or change trust merely to obtain that claim.

Local trial overrides are not published releases. Preserve marketplace, plugin cache and release/lock provenance; defer external promotion until later feedback and review. Plugin refresh may replace local overrides. Keep attempt hashes, backup locations and rollout status in plan evidence rather than this architecture guide.

## Config Scoping Rules

Three config layers, merged in order (last writer wins for scalars):

| Layer | File | Purpose |
|-------|------|---------|
| Home | `~/.clooks/clooks.yml` | User-wide hooks and defaults |
| Project | `.clooks/clooks.yml` | Project-specific hooks and overrides |
| Local | `.clooks/clooks.local.yml` | Developer-local overrides (gitignored) |

If neither home nor project config exists, the engine exits cleanly (no hooks to run). "Project config" here means the nearest `.clooks/clooks.yml` found by walking up from `$CLAUDE_PROJECT_DIR` (or cwd when `$CLAUDE_PROJECT_DIR` is unset or yields nothing) — not necessarily a file at cwd. On `SessionStart` events, an absent project config with a cwd-fallback produces a one-line stderr advisory. See `docs/domain/config/discovery.md` for the full discovery algorithm and precedence order.

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

Global invocations intentionally execute the merged home/project/local pipeline,
including trusted repository hooks. Existing ordering, shadowing and local
overrides apply. Dedup lets a project entrypoint yield to the same agent's global
registration; it does not add repository authorization. Paired yielding publishes explicit
suppressed completion through the binary, so its MCP companion returns neutral
without loading hooks. Global/project pairs have separate literal owner keys;
the MCP process does not mirror the launcher predicate.

Global init prepares paired PreToolUse handlers and a PATH-based `clooks mcp`
server. Claude uses `HOME/.claude/settings.json` plus `HOME/.claude.json`; Codex
uses `hooks.json` plus `config.toml` in its effective global home. Other events
remain command-only. Claude-selected operations reject any defined
`CLAUDE_CONFIG_DIR` or existing `HOME/.claude/.config.json` before writes; Codex-only
operations are independent. These checks do not add migration advisories.

Claude retains its empty `~/.clooks/.global-entrypoint-active` flag and existence-based project check. Global init publishes that flag after the Claude registrar succeeds and the launcher is executable. Codex uses a separate versioned receipt at `~/.clooks/.global-entrypoint-active.codex`. New project launchers require matching physical installation and Codex homes, an executable global launcher, readable regular `hooks.json`, and a matching POSIX `cksum` before yielding. Changes to any registration bytes, including unrelated hooks, invalidate freshness until re-init. Missing, malformed, legacy, stale or mismatched state and checksum failures fall through to project execution.

`CLOOKS_HOME_ROOT` remains the runtime config/state override, not the installation root. For Codex receipt eligibility, an unset override is allowed; a set override must be a nonempty absolute existing directory with the same physical identity as installation HOME. Empty, relative or different values disable suppression without changing the engine's interpretation of the override.

Neither receipt nor flag proves the native agent will invoke its global hook. Disabled or unreviewed hooks can remain inactive with valid persisted state. Recovery is external native hook enablement/review or matching global unhook to restore project eligibility. Existing project scripts only inspect flag existence; rerun project init as well as global init to obtain the new Codex checks. Other checkouts are not migrated automatically.

See `docs/domain/bash-entrypoint.md` for details.

## Codex Home and Registration State

Global Codex registration uses nonempty `CODEX_HOME`, otherwise `<installation-home>/.codex`. Overrides must be absolute and contain no CR/LF or NUL. `resolveCodexHome()` resolves existing directories physically through symlinks; for missing directories it resolves the nearest existing ancestor and appends missing components, without writes. It rejects files and dangling symlinks. Project registration stays at `<project>/.codex/hooks.json`. The shared launcher and Clooks configuration stay under the installation home, regardless of the selected Codex home.

Existing path components are resolved with filesystem `realpath` before processing a following `..`. This preserves physical parent semantics when a directory symlink points elsewhere; normalizing the whole path first can choose a different home. The default-home suffix is appended without first normalizing the installation path, so default and override resolution agree. Symlink interpretation remains delegated to the filesystem, without a separate symlink-target parser.

Cancelling a missing component with `..` resumes filesystem resolution: `missing/../alias` can resolve to an existing physical destination without creating `missing`. CLI registration accepts that canonical destination. Agreement with shell `cd -P` requires the original environment spelling to be traversable; the shell may reject this spelling while `missing` is absent and conservatively run the project entrypoint. That fallback is intentional, rather than a reason to reject the CLI path.

`src/registration-state.ts` owns synchronous parsing, atomic publication and matching cleanup. The recovery record contains exactly two LF-terminated lines:

```text
clooks-codex-home-v1
<canonical absolute Codex home>
```

The suppression receipt contains exactly four LF-terminated lines:

```text
clooks-codex-registration-v1
<canonical absolute installation home>
<canonical absolute Codex home>
<crc>:<byteCount>
```

Checksum fields use canonical unsigned decimal text. Publication runs POSIX `cksum` through `Bun.spawnSync` with the complete committed `hooks.json` bytes on stdin, without a shell or filename in its output. This detects incidental staleness; it is not a cryptographic check or native activation proof. State files use the shared atomic writer with existing mode preservation. Read errors propagate; malformed records and nonregular state files require repair rather than automatic deletion. Only an exactly empty receipt is legacy; empty recovery records are invalid.

The CLI checksum subprocess has a ten-second deadline and uses `SIGKILL` on timeout. Timeout, spawn errors, termination and nonzero status prevent publication and retain the recovery identity for retry. This bound does not alter hook execution timeouts or the project launcher's checksum checks.

Selected-Codex/all global init validates both records and the selected home before writes. It then persists recovery identity before retiring any old matching Codex receipt, and does both before repairing the shared launcher. This prevents failed selected-Codex/all re-init from reviving an old receipt merely by making its launcher executable. Recovery-write failure leaves the receipt untouched; receipt-removal failure retains cleanup identity and aborts setup. Runtime and advisory files, MCP registration and both exact hook groups precede new receipt publication. Failed checksum/publication leaves the committed registration recoverable.

Claude-only init stays independent of Codex state but preflights its selected
settings/server and shared outputs before launcher repair. Invalid Claude
registration therefore leaves the launcher unchanged; it no longer revives an
existing Codex receipt as a side effect of rejected preflight. A failure during
later commits can leave earlier writes in place. Receipt retirement remains
limited to Codex/all init, without changing repository permissions.

One recorded Codex home is supported per installation home. A different recorded home blocks init until explicitly unhooked; conflicting or malformed records block mutation. An empty legacy receipt identifies the default home and can upgrade only there. Same-home retries are allowed. Unhook in B does not mutate A or erase A's identity. Full global deletion preflights and deduplicates the selected and recorded homes, including a legacy default, before cleanup. No arbitrary directories are scanned; older unrecorded homes need explicit cleanup with their `CODEX_HOME`.

`clooks init --check --global` inspects only the known global installation and never mutates registration or receipt state. Presence comes from owned hook or MCP registration rather than `.clooks/` artifacts alone. Recorded Codex home and receipt data take precedence over ambient `CODEX_HOME`; disagreement is diagnosed and an actionable repair preserves the recorded value. Conflicting records, malformed registration data, uncertain ownership, or project-specific MCP ownership at installation HOME make the scope uninspectable with no repair command. The global launcher stamp reports launcher compatibility only and does not certify per-agent registration completion or native activation.

Matching Codex state clears only after hook/server removal and inspection of
every event for remaining owned runtime or advisory hooks, including custom Codex homes. If an
unrelated handler retains the owned server, its recovery identity also remains.
Unknown-event references or malformed containers block cleanup with
file/field evidence. Remaining handlers referencing `clooks` retain its server;
full runtime deletion also refuses remaining owned server references. The receipt
is removed before the recovery record, retaining retry identity on failure.
Invalid state is never silently erased. These are individually committed file
operations, not a transaction.

Full runtime cleanup preserves `.cache/approvals-live` even after unregistering
hooks, because a pending invocation can still use that IPC. JSON reports retained
paths and `deleted:false` when the directory remains; other removable contents
are deleted. Full removal refuses a runtime-root `.clooks` symlink before any
registration/state mutation, rather than unlinking it. This preservation
does not establish successful completion of already-running native calls.

Claude's global dedup flag is retired immediately after successful hook
unregistration, before committing MCP server removal. Thus a later server-write
failure does not leave project hooks suppressed by a flag for removed global
hooks. This ordering is distinct from retaining Codex's cleanup identity.

## Failure State Strategy

Failure state (circuit breaker data) is stored differently depending on project setup:

- **Project with `.clooks/`** — Stored at `.clooks/.failures` (same as before).
- **Home-only project** — Stored centrally at `~/.clooks/failures/<hash>.json`, where `<hash>` is the first 12 hex characters of `SHA-256(projectRoot)`.

The `getFailurePath()` function in `src/failures.ts` computes the path. `writeFailures()` ensures the parent directory exists before writing (handles the case where `~/.clooks/failures/` doesn't exist yet).

Those are the unchanged default Claude paths. The helper now accepts an optional fourth agent argument: `codex` selects `<projectRoot>/.clooks/.cache/agents/codex/failures.json` with project config, or `<homeRoot>/.clooks/failures/codex/<hash>.json` without it. The Codex engine uses `getFailureLocation()` to carry both path and selected managed root through failure reads, writes and clearing. Codex validates real parent directories and regular single-link files, uses no-follow reads and atomic staged writes; Claude retains its existing string-path I/O. See [Execution](./config/execution.md) for storage checks. `getConfigFailurePath()` uses the same Codex selection, including home-only configuration failures; Claude config failures retain their historical project `.clooks/.failures` path. Docker integration validation has passed. Registration receipts, installation-home selection and native activation behavior are unchanged.

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

## Unknown Agent Id Warnings

A sibling warning, also `SessionStart`-only and built the same way (computed before both of `run.ts`'s early returns, so it fires even with zero hooks registered or nothing matched): any string outside the ids this version recognizes (`claude-code`, `codex`) in an `agents` allowlist — global config, a hook entry, a per-event override, or a loaded hook's own `meta.agents` — is collected, deduplicated and sorted into one collapsed line:

```
clooks: unknown agent ids in agents lists (ignored): cursor, windsurf
```

Built by `buildUnknownAgentWarnings()` in `src/engine/match.ts`, independent of matching — every layer is scanned whether or not its hook ran for the current event. See `docs/domain/config/agents.md` for the allowlist cascade this reports on. Unlike shadowing, a hook simply being excluded for the current agent produces no warning at all — see `docs/domain/cross-agent-hooks/agent-scoping.md`.

## Key Files

- `src/config/index.ts` — `loadConfig()` with three-layer merge and origin annotation.
- `src/config/merge.ts` — `mergeThreeLayerConfig()` — merge logic, origin map, shadow detection.
- `src/config/types.ts` — `HookOrigin` type, `HookEntry.origin` field.
- `src/failures.ts` — `getFailurePath()`, `readFailures()`, `writeFailures()`.
- `src/engine/match.ts` — `buildShadowWarnings()`.
- `src/engine/run.ts` — `runEngine()`, `startupWarnings` assembly, failure path computation.
- `src/commands/config.ts` — `config --resolved` provenance command.
- `src/commands/init.ts` — `init --global` for home directory setup.
- `src/agents/codex/settings.ts` — physical Codex-home resolution and registration.
- `src/registration-state.ts` — Codex recovery records, suppression receipts and guarded cleanup.

## Related

- `docs/domain/config.md` — Config system details, merge rules, cascade rules.
- `docs/domain/vendoring/plugin-vendoring.md` — Plugin cache discovery, plugin hook vendoring, scope-based routing.
- `docs/domain/bash-entrypoint.md` — Entrypoint script and dedup mechanism.
- `docs/domain/hook-type-system.md` — `HookOrigin` type documentation.
- `docs/domain/cli-architecture.md` — CLI commands including `config --resolved`.
