# Bash Entrypoint

The bash entrypoint is the bridge between Claude Code's native hook system and the compiled Clooks binary. Claude Code invokes this script for every hook event; the script locates the binary, pipes stdin through, and translates exit codes.

## Overview

The entrypoint lives at `.clooks/bin/entrypoint.sh` in the project root. It is registered in `.claude/settings.json` for all Claude Code lifecycle events. No positional arguments are passed — the event name comes from the `hook_event_name` field in the stdin JSON payload. The script is written by `clooks init` from an embedded template in `src/commands/init-entrypoint.ts`.

The script performs six steps in order:

1. **Bypass check** — If `SKIP_CLOOKS=true`, exit 0 immediately (no binary invocation).
2. **Binary location** — Look up `clooks` on PATH via `command -v clooks`.
3. **Bootstrap detection** — If binary not found on PATH, print install instructions to stderr and exit 0 (allow). Missing binary is a setup state, not a runtime failure — blocking here would deadlock `/clooks:setup`, whose install invocation runs through the same hook.
4. **Stdin capture** — Read all of stdin into a variable (`STDIN_DATA=$(cat)`) so it can be logged and replayed.
5. **Debug logging** — If `CLOOKS_DEBUG=true`, write the captured stdin JSON to `${CLOOKS_LOGDIR:-/tmp/clooks-debug}/<timestamp>.json` for replay/diagnosis. The engine also outputs debug info (loaded hooks, matched hooks per event, per-hook results) to both stderr and `additionalContext` so Claude can read it.
6. **Delegation + exit code translation** — Pipe captured stdin to the binary (`echo "$STDIN_DATA" | "$CLOOKS_BIN"`). Exit codes 0 and 2 pass through; everything else becomes exit 2 (fail-closed).

## Key Files

- `.clooks/bin/entrypoint.sh` — The bash entrypoint script (machine-generated, do not edit).
- `src/commands/init-entrypoint.ts` — Canonical source of the script content (embedded template).
- `.claude/settings.json` — Hook registration for all events.
- `tmp/stub-binary/` — Test stubs (main, crash, block, output). Gitignored.
- `tmp/test-entrypoint/run-tests.sh` — Entrypoint test suite. Gitignored.

## Binary Location Strategy

The binary is found via `command -v clooks` — a standard PATH lookup. The `/clooks:setup` installer writes to `~/.local/bin/clooks` (the XDG user-binary directory) and ensures it's on PATH. Users who install via other means (Homebrew, manual download to `/usr/local/bin`, etc.) work equally well — any directory on PATH is valid.

The binary is a per-user global tool (like `git` or `node`). Hooks and config are per-project (in `.clooks/` within each project).

## Fail-Closed Semantics

Clooks inverts Claude Code's native error handling:

| Scenario | Claude Code native | Clooks entrypoint |
|---|---|---|
| Hook exits 0 | Allow | Allow |
| Hook exits 2 | Block | Block |
| Hook exits 1 (crash) | **Allow** (non-blocking error) | **Block** (fail-closed) |
| Hook exits 137 (OOM kill) | **Allow** | **Block** (fail-closed) |
| Binary missing | N/A | **Allow** + install advisory (exit 0, stderr) |

The translation logic: only exit codes 0 and 2 pass through unchanged. Any other exit code is converted to exit 2 with an error message on stderr.

## Bypass Mechanism

Set `SKIP_CLOOKS=true` to disable all Clooks processing:

```bash
export SKIP_CLOOKS=true
```

This is an escape hatch for when the binary is broken and blocking all Claude Code actions. The bypass check runs before binary location, so it works even if the binary path is invalid.

## Hook Registration

The entrypoint is registered in `.claude/settings.json` for all events with a single matcher group containing the Clooks entrypoint (no matchers, no timeout — Clooks handles event routing and timeouts internally).

Two registration scopes exist:

- **Project-level** — `.claude/settings.json` in the project root. Hooks travel with the repository. Created by `clooks init`. The entrypoint path uses `$CLAUDE_PROJECT_DIR` for reliable resolution (e.g., `"$CLAUDE_PROJECT_DIR"/.clooks/bin/entrypoint.sh`). Claude Code does not guarantee that the cwd is the project root for all hook events (notably Stop/SessionEnd), so relative paths like `.clooks/bin/entrypoint.sh` break. `$CLAUDE_PROJECT_DIR` is set by Claude Code for all hook commands and always contains the project root absolute path.
- **Global-level** — `~/.claude/settings.json` in the user's home directory. Hooks apply to all projects. Created by `clooks init --global`. The entrypoint path is absolute (e.g., `/home/joe/.clooks/bin/entrypoint.sh`).

## Global Entrypoint and Dedup

When a global entrypoint is registered, it handles all hook processing including merged home + project hooks. If a project also has its own entrypoint, the project entrypoint checks for the flag file `~/.clooks/.global-entrypoint-active` and exits early (exit 0) to avoid double execution:

```bash
# Global entrypoint dedup check
if [ -f "$HOME/.clooks/.global-entrypoint-active" ]; then
  exit 0
fi
```

The flag file is a simple empty file created by `clooks init --global`. Its presence signals that the global entrypoint is active and project entrypoints should defer to it.

## Plugin Entrypoint (Bootstrap)

A third entrypoint variant exists for the plugin distribution model. It lives at `clooks-marketplace/clooks/hooks/install-entrypoint.sh` in the plugin source, and at runtime resides in the Claude Code plugin cache (read-only).

**What it does:** Fires on SessionStart only. Checks if the clooks binary is on PATH via `command -v clooks`. If found, exits 0 silently. If missing, exits 0 with JSON output containing `hookSpecificOutput` — a `systemMessage` shown to the user and `additionalContext` injected into Claude's context directing it to suggest `/clooks:setup`.

**Why exit 0 + JSON, not exit 2:** SessionStart ignores blocking errors (exit 2). The hooks config screen explicitly says "Blocking errors are ignored" for SessionStart. To surface a message, the hook must exit 0 and put the message in `hookSpecificOutput.systemMessage` (shown to user) and `hookSpecificOutput.additionalContext` (injected into Claude's context).

**How it differs from project/global entrypoints:**

- No binary invocation — only checks file existence
- SessionStart only (not all events)
- No dedup checks needed (no binary invocation = no double-execution risk)
- No fail-closed exit code translation (no binary exit code to translate)
- No stdin capture/replay (consumes stdin immediately via `cat >/dev/null`)
- Uses exit 0 + JSON (not exit 2 + stderr like project/global entrypoints)

**Relationship:** The plugin entrypoint bootstraps the user. After `/clooks:setup` runs `clooks init`, the project entrypoint takes over for all events. The plugin's SessionStart hook becomes a silent no-op (binary found -> exit 0).

**Created by:** Plugin installation (`claude plugin install clooks@clooks-marketplace`), not `clooks init`.

### Comparison Table

| Aspect              | Project entrypoint              | Global entrypoint                | Plugin install-entrypoint       |
|---------------------|---------------------------------|----------------------------------|---------------------------------|
| Location            | .clooks/bin/entrypoint.sh       | ~/.clooks/bin/entrypoint.sh      | plugin cache (read-only)        |
| Events              | All                             | All                              | SessionStart only               |
| Invokes binary?     | Yes                             | Yes                              | No                              |
| Dedup checks        | Global flag file                | None (authoritative)             | None (no binary invocation)     |
| Missing binary      | Exit 0 + install advisory (stderr) | Exit 0 + install advisory (stderr) | Exit 0 + JSON hookSpecificOutput |
| Created by          | clooks init                     | clooks init --global             | Plugin install                  |
| Purpose             | Event dispatch                  | Event dispatch (all projects)    | Bootstrap check                 |

## Gotchas

- **Claude Code cwd is not guaranteed to be project root.** Some hook events (notably Stop, SessionEnd) may run with a different cwd. This means relative paths in `settings.json` (e.g., `.clooks/bin/entrypoint.sh`) can fail with `/bin/sh: .clooks/bin/entrypoint.sh: not found`. Project-level registration must use `$CLAUDE_PROJECT_DIR` to resolve the entrypoint path reliably. Global-level registration uses absolute paths and is unaffected.
- **`set -e` and exit code capture:** The script uses `cmd && var=0 || var=$?` to capture exit codes without triggering `set -e`. A naive `cmd; var=$?` would cause the script to exit before reaching `$?` on non-zero.
- **No `exec`:** The script does NOT use `exec` to replace itself with the binary, because that would prevent exit code inspection. The binary runs as a child process instead.
- **Heredoc whitespace:** The bootstrap message uses `<<'MSG'` (single-quoted delimiter) to prevent variable expansion. The message lines must start at column 1 (no indentation).
- **Stdin capture and replay:** Stdin is read into a variable (`STDIN_DATA=$(cat)`) rather than inherited directly. This is necessary because stdin must be both (a) logged for debug and (b) piped to the binary. A file descriptor can only be consumed once, so capture-and-replay is required.
- **`date +%s%N` on macOS:** BSD `date` does not support `%N` (nanoseconds). The debug log filename becomes `1710000000N.json` instead of `1710000000123456789.json`. Only affects the debug path, does not break correctness.

## Related

- `docs/domain/claude-code-hooks/overview.md` — Hook configuration schema and handler types
- `docs/domain/claude-code-hooks/events.md` — All lifecycle events
- `docs/domain/claude-code-hooks/io-contract.md` — Exit code semantics
- `docs/research/bash-entrypoint-overhead.md` — Performance measurements (~2ms bash overhead)
- `docs/domain/testing.md` — E2E test patterns for entrypoint verification
- `docs/plans/plugin-distribution/PLAN-FEAT-0041-D-plugin-packaging.md` — Plugin packaging plan
