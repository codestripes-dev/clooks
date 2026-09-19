# CLI Architecture — Setup Commands

The shared plugin installer helper, `clooks init` / `clooks init --global` (registration paths, receipt/recovery ordering), `clooks config`, and `clooks types`. Part of [CLI Architecture](../cli-architecture.md).

## Plugin Installer

The sibling marketplace owns `clooks/skills/setup/scripts/install.sh`, shared by
Claude `/clooks:setup` and Codex `$clooks:setup`. This is an installer-local helper,
not a new runtime command or resolver. Plugin startup never invokes it.

| Action | Behavior |
|--------|----------|
| `install` | Reuse executable PATH binary first, then managed `~/.local/bin/clooks`; download only when absent |
| `resolve` | Validate the selection and print only its absolute path to stdout; diagnostics go to stderr |
| `check` | Report selected binary/version and project config-file presence; missing/broken binaries return nonzero |
| `update` | Explicit checksum/version-validated managed replacement; refuse external PATH selections and managed symlinks |

Reuse validates `--version` and any explicit `CLOOKS_VERSION` pin without download
or shell-profile edits. A mismatch requires explicit update; broken selected
binaries do not silently fall back. Downloaded executables are validated before
atomic replacement from a temporary file on the destination filesystem, preserving
the previous binary on download/checksum/version failure. Fresh install retains
the existing shell-profile PATH setup; update does not edit profiles.

Skills call resolve, then invoke its exact quoted stdout path for version/init in
separate tool calls, stopping on failure. They do not rely on shell-variable
persistence or compound-command wrappers. Managed-only off-PATH selection warns:
absolute-path init may work while generated entrypoints cannot find `clooks`.
Child-shell exports/profile edits do not repair the running agent's PATH. Check
does not prove configuration validity or native activation. Global/both-agent
registration is never inferred from cwd.

## `clooks init` / `clooks init --global`

Project setup command. Creates `.clooks/` directory, writes default `clooks.yml`, generates the bash entrypoint, and registers it with the selected agent hook system.

Paired registration has passed compiled validation and independent review;
native generated-registration conformance remains separate.
`prepareInitRegistrations()` preflights every selected hook file, MCP
server destination, project identity and shared output before setup writes. A
malformed selected registration or server-name conflict therefore does not repair
the launcher as a side effect. Prepared writes commit per file, not as a transaction.

Claude-selected init/uninstall support only the default layout: any defined
`CLAUDE_CONFIG_DIR` (including empty or the default path) or existing
`HOME/.claude/.config.json` is rejected before mutation. Codex-only operations
remain independent. No new Claude receipt framework is introduced.

PreToolUse gets a command plus `mcp_tool` companion (`clooks.check`), each with a
2,147,483-second native timeout from shared `APPROVAL_TIMEOUT_SECONDS` (about
24.85 days, a finite fallback). Other events stay command-only. Registration paths:

| Agent/scope | Hooks | MCP server |
| --- | --- | --- |
| Claude project | `<project>/.claude/settings.json` | `<project>/.mcp.json` |
| Claude global | `<HOME>/.claude/settings.json` | `<HOME>/.claude.json` |
| Codex project | `<project>/.codex/hooks.json` | `<project>/.codex/config.toml` |
| Codex global | `<effective CODEX_HOME>/hooks.json` | `<effective CODEX_HOME>/config.toml` |

`registration-mcp.ts` manages only the `clooks` server, executing `clooks mcp`
through PATH. Foreign/conflicting entries are not overwritten. Claude JSON
preserves unrelated values; the Codex TOML helper uses parsed token/range edits
for owned fields, retaining unrelated content, comments and native disable/trust
settings. Codex retains ten-second startup and uses the shared 2,147,483 seconds
for tool timeout. Claude project/global servers use the derived 2,147,483,000 ms
`timeout`, overriding the wall timer and raising the default 30-minute stdio idle
floor below the JavaScript timer ceiling. Re-init upgrades old owned entries;
repeated canonical writes preserve bytes. Disk configuration does not
prove native connection, trust or activation.

Agent routing is explicit through `--agent claude-code`, `--agent codex`, or `--agent all`. Omitting `--agent` is equivalent to `--agent claude-code` for backward compatibility: project init writes `.claude/settings.json`, and global init writes `~/.claude/settings.json`.

`--agent codex` still creates the shared `.clooks/` runtime files, but registers Codex hooks and MCP server files instead of Claude settings. Global init and uninstall resolve a nonempty `CODEX_HOME`, otherwise `HOME/.codex`. Overrides must be absolute and contain no CR/LF; resolution uses physical directory identity, including the nearest existing ancestor of a missing directory, without creating it. Project registration ignores `CODEX_HOME`. `CLOOKS_HOME_ROOT` remains a runtime override and never selects an installation location. Codex registration writes one Clooks command per supported event, plus the PreToolUse companion, and retains the native hook-review/trust distinction. `--agent all` performs shared setup once, then registers both agents. Global Codex output uses the actual resolved registration paths.

With `--global`, operates on `HOME/.clooks/`: creates the home directory structure, writes global `clooks.yml`, generates an executable global entrypoint, and registers the selected global agent files. Claude Code publishes its legacy `.global-entrypoint-active` flag only after successful Claude registration. Codex publishes a versioned `.global-entrypoint-active.codex` receipt only after successful Codex registration and executable launcher creation. The receipt records the physical installation and Codex homes plus POSIX `cksum` of committed registration bytes; it detects stale registration, not native hook activation.

Before any Codex/all global init writes, read-only preflight validates the effective home and both persisted identities. Invalid, conflicting, or different-home records abort before shared types/schema/launcher or Claude writes. An empty legacy Codex flag identifies the default home and must be unhooked before switching to a custom home. After preflight, init atomically persists `.codex-registration-home`, a separate single-home recovery record, then retires any old Codex receipt before repairing shared runtime files. This prevents launcher repair from making old suppression newly eligible when later registration fails. Recovery-write failure leaves the old receipt untouched; retirement failure aborts before launcher repair. Later setup, registration, checksum, or publication failure retains cleanup identity without a newly eligible receipt. Same-home retry republishes success; another home cannot overwrite that cleanup identity. Successful earlier Claude registration in an all-agent attempt remains committed on later Codex failure.

The recovery record never suppresses project execution. Newly generated project scripts require a matching, fresh receipt and usable global launcher; legacy empty Codex flags are insufficient. Existing project scripts require project re-init to obtain these checks. Receipt freshness cannot establish that native Codex hooks are enabled, reviewed, or firing. External activation and Codex runtime implementation remain separate concerns.

Claude-only global init neither reads nor retires Codex state and ignores
`CODEX_HOME`. It now preflights Claude settings and server files before launcher
repair, so malformed Claude registration cannot restore Codex receipt eligibility
as a side effect of a rejected preflight. A later commit failure can still leave
earlier writes in place; successful shared-launcher repair can affect an existing
matching Codex receipt without proving native activation.

Both registrars reject invalid nonempty JSON roots, hook maps, managed-event arrays, and traversed group/hook containers with a path/field-specific error and repair-and-retry guidance. Rejection leaves registration bytes unchanged. Missing containers and empty or whitespace files remain valid initialization inputs. Unknown fields and untraversed event values are preserved as JSON values. Detection and uninstall counters use the shared strict reader across all events, so ambiguous unknown-event containers produce errors rather than an absence result. Normal unhook only removes owned hooks from the existing supported event catalog.

Registration writes use `src/registration-file.ts`: an exclusive temporary file in the destination directory is created with initial access permissions no broader than the existing destination, before any bytes are written. After writing, existing permission bits are restored and the closed file is renamed over the destination. New destinations use ordinary `0666` permissions filtered by the process umask. Failed writes preserve the previous destination and clean up only the attempt's own temporary file, best effort. Reads and writes reject symlink destinations, including dangling links, and other nonregular files. No-op registration and unhook preserve exact file bytes. Successful changes may reformat JSON. This guarantees atomic visibility per file, not power-loss durability, concurrent-writer merging, or a transaction across both agents.

Command ownership requires a bounded generated form; companion ownership requires
the `clooks.check` shape and exact agent/owner/native-ID input template.
Project init creates or retains separate `.clooks/bin/claude-project-id` and
`.clooks/bin/codex-project-id` markers for selected agents. The existing Codex
marker also remains the portable locator identity; global init uses owner
`global`, not a project marker. See [Bash Entrypoint](../bash-entrypoint.md#hook-registration).
Init converges owned PreToolUse entries to one canonical command/companion group
and other events to their existing command form, preserving unrelated hooks and
metadata on surviving mixed groups. Command detectors recognize the exact paired
prefix around supported launcher forms, not arbitrary shell mentions. Existing
CLI selectors and legacy Claude JSON count aliases remain unchanged.

## `clooks config` / `clooks config --resolved`

Shows the resolved clooks configuration. In default mode, displays hook count, timeout, onError, maxFailures, and handoff, plus the global `agents` allowlist when one is set.

With `--resolved`, outputs the fully merged config with **provenance annotations** — showing each value's source layer (home/project/local) and file path. This is useful for debugging three-layer config merge behavior. Supports `--json` for structured output.

The resolved command loads all three config files independently (does not reuse `loadConfig()`) to track per-value provenance. It also performs a live `existsSync()` check on each hook's source file — hooks whose files are missing are tagged `(dangling)` in human output and include `"dangling": true` / `"status": "dangling"` in JSON output. Shadowed hooks are not checked (they are inactive).

## `clooks types` / `clooks types --global`

Extracts the embedded `.d.ts` type declarations to `.clooks/hooks/types.d.ts`. The file provides `ClooksHook`, all 22 event context types, all result types, and config generics — giving hook authors full IntelliSense without npm or package.json.

Always overwrites unconditionally (no version check). With `--global`, writes to `~/.clooks/hooks/types.d.ts` instead. Supports `--json` for structured output.

## Related

- [CLI Architecture](../cli-architecture.md) — parent overview and key files
- [Engine Mode & Dispatch](./dispatch.md)
- [Command Framework](./command-framework.md)
- [Hook & Lifecycle Commands](./commands-hooks.md) — `add`, `new-hook`, `update`, `test`, `uninstall`
