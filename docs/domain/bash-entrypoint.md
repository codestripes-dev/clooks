# Bash Entrypoint

The bash entrypoint is the bridge between Claude Code's native hook system and the compiled Clooks binary. Claude Code invokes this script for every hook event; the script locates the binary, pipes stdin through, and translates exit codes.

## Overview

The entrypoint lives at `bin/clooks-entrypoint.sh` in the project root. It is registered in `.claude/settings.json` for all 18 Claude Code lifecycle events. Each event's command string passes the event name as a positional argument (e.g., `bin/clooks-entrypoint.sh PreToolUse`).

The script performs five steps in order:

1. **Bypass check** — If `SKIP_CLOOKS=true`, exit 0 immediately (no binary invocation).
2. **Binary location** — Compute path: `${CLOOKS_HOME:-$HOME/.clooks}/bin/clooks`.
3. **Bootstrap detection** — If binary missing/not executable, print install instructions to stderr and exit 2 (block).
4. **Delegation** — Run binary as child process, passing all positional args. Stdin is inherited.
5. **Exit code translation** — 0 and 2 pass through; everything else becomes exit 2 (fail-closed).

## Key Files

- `bin/clooks-entrypoint.sh` — The bash entrypoint script.
- `.claude/settings.json` — Hook registration for all 18 events.
- `tmp/stub-binary/` — Test stubs (main, crash, block, output). Gitignored.
- `tmp/test-entrypoint/run-tests.sh` — Entrypoint test suite. Gitignored.

## Binary Location Strategy

The binary is located at `${CLOOKS_HOME:-$HOME/.clooks}/bin/clooks`:

- **Default:** `~/.clooks/bin/clooks` (per-user global install).
- **Override:** Set `CLOOKS_HOME` to point to a different base directory (useful for development, CI, or testing multiple versions).

The binary is a per-user global tool (like `git` or `node`). Hooks and config are per-project (in `.clooks/` within each project).

## Fail-Closed Semantics

Clooks inverts Claude Code's native error handling:

| Scenario | Claude Code native | Clooks entrypoint |
|---|---|---|
| Hook exits 0 | Allow | Allow |
| Hook exits 2 | Block | Block |
| Hook exits 1 (crash) | **Allow** (non-blocking error) | **Block** (fail-closed) |
| Hook exits 137 (OOM kill) | **Allow** | **Block** (fail-closed) |
| Binary missing | N/A | **Block** + install message |

The translation logic: only exit codes 0 and 2 pass through unchanged. Any other exit code is converted to exit 2 with an error message on stderr.

## Bypass Mechanism

Set `SKIP_CLOOKS=true` to disable all Clooks processing:

```bash
export SKIP_CLOOKS=true
```

This is an escape hatch for when the binary is broken and blocking all Claude Code actions. The bypass check runs before binary location, so it works even if the binary path is invalid.

## Hook Registration

The entrypoint is registered in the project-level `.claude/settings.json` (not user-level). This means hooks travel with the repository. All 18 events are registered with a 30-second timeout.

For `PreToolUse`, the Clooks entrypoint is a second matcher group after the existing `no-compound-commands.sh` hook (which has its own `"Bash"` matcher and no timeout).

## Gotchas

- **`set -e` and exit code capture:** The script uses `cmd && var=0 || var=$?` to capture exit codes without triggering `set -e`. A naive `cmd; var=$?` would cause the script to exit before reaching `$?` on non-zero.
- **No `exec`:** The script does NOT use `exec` to replace itself with the binary, because that would prevent exit code inspection. The binary runs as a child process instead.
- **Heredoc whitespace:** The bootstrap message uses `<<'MSG'` (single-quoted delimiter) to prevent variable expansion. The message lines must start at column 1 (no indentation).
- **stdin passthrough:** Child processes inherit the parent's stdin file descriptor, so stdin passthrough works without explicit piping.

## Related

- `docs/domain/claude-code-hooks/overview.md` — Hook configuration schema and handler types
- `docs/domain/claude-code-hooks/events.md` — All 18 lifecycle events
- `docs/domain/claude-code-hooks/io-contract.md` — Exit code semantics
- `docs/research/bash-entrypoint-overhead.md` — Performance measurements (~2ms bash overhead)
