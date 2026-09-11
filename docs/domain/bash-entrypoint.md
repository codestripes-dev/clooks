# Bash Entrypoint

The bash entrypoint is the bridge between an agent's native hook system and the compiled Clooks binary. Claude Code and Codex registrations invoke this script for hook events; Codex identifies itself by setting an explicit agent marker. The script locates the binary, pipes stdin through, and translates exit codes.

## Overview

The entrypoint lives at `.clooks/bin/entrypoint.sh` in the project root. It is registered in `.claude/settings.json` for Claude Code lifecycle events and in `.codex/hooks.json` for Codex registration events. No positional arguments are passed; the event name comes from the agent's stdin JSON payload. The script is written by `clooks init` from an embedded template in `src/commands/init-entrypoint.ts`.

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

When configured Clooks receives empty or ASCII JSON-whitespace-only stdin, the engine reports `clooks: received empty stdin; no hook event was supplied.` and `No hook handlers were run.`, followed by conditional guidance: if Claude was launched inside another agent's sandbox, that sandbox may have prevented hook-input delivery; retry the Claude launch with approved permissions outside that sandbox, keeping Clooks enabled. This diagnoses absent input without claiming its cause or repairing transport. Claude module imports can still occur before parsing; Codex retains its existing failure prefix/disposition.

The diagnostic exits 2 with empty stdout. Capture/replay and exit translation are unchanged: replay can turn empty input into a newline, which receives the same diagnostic. The diagnostic itself adds no automatic retry, permission change or hook bypass. Separately, existing Codex approval storage requires identifying otherwise-bypassed no-config invocations for retirement; an unreadable or unidentifiable input cannot silently skip that work. Without that state, the missing-config bypass remains.

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

## Environment Variables

The entrypoint and the binary react to a small set of environment variables:

| Variable | Effect |
|----------|--------|
| `SKIP_CLOOKS=true` | Bypass all hook processing (entrypoint exits 0 immediately). |
| `CLOOKS_DEBUG=true` | Enable debug logging — stderr output + JSON request dumps to `CLOOKS_LOGDIR`. |
| `CLOOKS_LOGDIR=/path` | Directory for `CLOOKS_DEBUG` JSON dumps (default `/tmp/clooks-debug`). |
| `CLOOKS_AGENT=claude-code` | Optional explicit selector for the current Claude Code adapter. Unset or empty means the same thing for backward compatibility. |
| `CLOOKS_AGENT=codex` | Explicit selector used by generated Codex registrations. Enables eleven events through event-specific normalization and result policy before hook imports, including observation-only SessionEnd. Earlier ten-event Docker evidence does not establish SessionEnd native enforcement. |
| `CLOOKS_HOME_ROOT=/path` | Override the home directory used for config resolution (mostly for tests). |
| `CODEX_HOME=/absolute/path` | Select the Codex global registration directory; unset or empty uses `$HOME/.codex`. Does not relocate the shared Clooks launcher or project `.codex/hooks.json`. |
| `CLOOKS_PROJECT_ROOT=/path` | Skip discovery and treat `/path` as the project root unconditionally. Highest-priority override (wins over `$CLAUDE_PROJECT_DIR` and the cwd walk). Mirrors `prettier --config` / `tsc --project` / `GIT_DIR`. |
| `$CLAUDE_PROJECT_DIR` | Set by Claude Code itself. Used by clooks as the **primary anchor** for config discovery — the walk-up starts here so an agent that runs `cd /tmp && <action>` cannot bypass project hooks. |

Claude Code registration does not need to set `CLOOKS_AGENT`; the binary defaults to the Claude Code adapter. Codex registration always sets `CLOOKS_AGENT=codex`. Project Codex registration also sets `CLOOKS_PROJECT_ROOT` to the absolute project root so Codex cwd changes do not detach Clooks from the intended project. Global Codex registration intentionally omits `CLOOKS_PROJECT_ROOT`; the shell still forwards inherited `CLOOKS_PROJECT_ROOT` and `CLAUDE_PROJECT_DIR` unchanged. Before discovery, the Codex runtime uses an invocation-local environment copy with `CLAUDE_PROJECT_DIR` removed, retaining the explicit `CLOOKS_PROJECT_ROOT` override without mutating the process environment. Without that override, discovery walks from cwd so global hooks can merge with the current project's `.clooks/clooks.yml`. Shell forwarding and bootstrap behavior are unchanged.

SessionEnd alone registers `timeout: 3` seconds, budgeting the entire entrypoint/runtime/hook pipeline. Other event registrations retain their existing timeouts. Re-run init for existing installations: migration adds the eleventh event and repairs owned SessionEnd entries without the timeout; repeated canonical init does not rewrite the file. SessionEnd success produces no stdout. Its diagnostics are local stderr only, discarded by native Codex on successful hooks; failures do not veto closure.

## Approval Token Transport

`CLOOKS_APPROVAL_TOKENS` is reserved syntax in a pending Codex Bash/exec_command tool command, not a launcher environment switch. The runtime controller parses a byte-zero token prefix and strips it before hook inspection and binding; an inherited hook-process variable never acknowledges approval. Without a real input rewrite, the original native command retains its prefix. The launcher still only captures/replays stdin and translates exit codes; it does not parse, register or consume tokens.

Only narrowly recognized direct external commands can carry the prefix. Other shell forms and non-shell tools use `clooks approve <token>` followed by unchanged arguments. An agent shell call to that command still runs through ordinary hooks, with no exemption. See [Codex Approvals](codex-approvals.md) for exact syntax, lifecycle and passing Docker validation. The passing [15-case native suite](testing/codex-native.md#hybrid-approval-case-evidence) covers bounded shell and direct-patch approval workflows, including actual-pack `rm -r`, not forced-removal permission or full conformance.

## Hook Registration

Focused compiled E2E reads actual generated project/global Codex commands from registration, runs them through Bash, and asserts positive hook reach markers plus exact approval-denial JSON, SubagentStart local failure and Stop advisory-only output. This is launcher/runtime coverage, not proof of native discovery, activation or exactly-once execution. No shell or production behavior changed; final full Docker gates passed.

The entrypoint is registered with the selected agent hook system. Clooks handles event routing and timeouts internally, so upstream registration points at one Clooks command per upstream event rather than at individual hook files.

Two registration scopes exist:

- **Project-level** — `.claude/settings.json` in the project root. Hooks travel with the repository. Created by `clooks init`. The entrypoint path uses `$CLAUDE_PROJECT_DIR` for reliable resolution (e.g., `"$CLAUDE_PROJECT_DIR"/.clooks/bin/entrypoint.sh`). Claude Code does not guarantee that the cwd is the project root for all hook events (notably Stop/SessionEnd), so relative paths like `.clooks/bin/entrypoint.sh` break. `$CLAUDE_PROJECT_DIR` is set by Claude Code for all hook commands and always contains the project root absolute path.
- **Global-level** — `~/.claude/settings.json` in the user's home directory. Hooks apply to all projects. Created by `clooks init --global`. The entrypoint path is absolute (e.g., `/home/joe/.clooks/bin/entrypoint.sh`).

Codex registration uses project `.codex/hooks.json` or global `${CODEX_HOME:-$HOME/.codex}/hooks.json` and command strings shaped like:

```bash
CLOOKS_AGENT=codex CLOOKS_PROJECT_ROOT='/abs/repo' '/abs/repo/.clooks/bin/entrypoint.sh'
CLOOKS_AGENT=codex '/home/joe/.clooks/bin/entrypoint.sh'
```

The first form is project registration. The second form is global registration and deliberately has no `CLOOKS_PROJECT_ROOT`.

Codex project commands are machine-local absolute paths. After copying, moving, or creating a new worktree, rerun `clooks init --agent codex` in that checkout before activating its hooks. A copied registration still targets the old checkout if it remains present. Re-init recognizes both the current project form and the older quoted absolute form without a root assignment, replacing old paths without adding duplicates. Explicit project roots remain independent of git-root discovery and cwd, including nested Clooks roots and non-git projects. Generated single-argument quoting preserves literal spaces, apostrophes, and shell punctuation in Codex paths.

Registered-command E2E probes execute the generated shell with an isolated PATH binary and capture agent, root, cwd, and stdin. Relocation tests establish the old-root invocation before repair and the new-root invocation afterward. These probes establish shell forwarding only; they do not demonstrate native Codex activation or runtime decision handling. Claude's historical global command remains an unquoted absolute path; registration recognizes its exact scope-derived form for idempotence and cleanup, but shell execution of paths requiring quoting remains a separate limitation.

## Global Entrypoint and Dedup

The global entrypoint handles merged home, project and local hooks. A project launcher can yield to the same agent's global registration. Claude retains its legacy presence check; Codex requires a fresh registration receipt. Neither check proves that the native agent will invoke the global command.

Claude Code uses the legacy flag:

```bash
if [ -f "$HOME/.clooks/.global-entrypoint-active" ]; then
  exit 0
fi
```

Codex uses `<HOME>/.clooks/.global-entrypoint-active.codex` with exactly four LF-terminated lines:

```text
clooks-codex-registration-v1
/physical/installation/home
/physical/codex/home
crc:byteCount
```

The checksum line contains canonical decimal numbers from POSIX `cksum` over the complete committed `hooks.json` bytes via stdin. Filenames are not part of its output. This is incidental stale-file detection, not cryptographic integrity or authorization. Changing even an unrelated registration invalidates the receipt until global re-init.

The generated Bash never sources the receipt. Guarded reads require the version, four complete lines and EOF; extra or unterminated lines, CRLF, NUL bytes, relative paths and malformed checksum fields are ineligible. The receipt and hooks must be readable regular files, not symlinks. The expected launcher is derived from the recorded installation home and must resolve to a regular executable file; a symlink to such a launcher is permitted. Existing HOME and Codex directories are canonicalized using subshell `cd -P` and `pwd -P`, so directory aliases match their physical identity. Missing paths, unreadable files, checksum failures, a missing `cksum`, or any mismatch fall through to project execution under strict Bash.

`CLOOKS_HOME_ROOT` remains a runtime config/state override, not an installation root. When unset it permits receipt eligibility. When set it must be a nonempty absolute existing directory resolving to the installation home; empty, relative, missing or different values disable suppression. A nonempty `CODEX_HOME` must likewise be absolute and free of CR/LF. Global CLI operations reject invalid values before writes; project launch conservatively falls through. CLI resolution canonicalizes the nearest existing ancestor of a new Codex directory without creating it during preflight.

CLI and shell identity agreement applies to traversable original path spellings. The CLI can resolve `missing/../alias` to an existing alias target without creating `missing`; Bash cannot traverse that original spelling, so project execution deliberately remains eligible even after registration. Passing the canonical destination restores matching suppression. Traversable alias/parent paths with a final directory created by init agree with physical shell resolution.

For Codex/all global init, read-only state/home preflight precedes writes. The selected physical Codex home is then retained in `.clooks/.codex-registration-home`, a separate two-line recovery record (`clooks-codex-home-v1`, then the absolute Codex home, both LF-terminated). After that succeeds, any old Codex receipt is retired before shared files or launcher permissions change. This prevents launcher repair from reviving an old receipt when later setup, registration or checksum publication fails. Successful registration with an executable launcher publishes a new receipt atomically. Failed retries can therefore favor extra project execution. Claude keeps its empty flag, published after successful Claude registration. File updates are recoverable individually, not a cross-file transaction.

Claude-only init does not inspect or retire Codex state. Because the launcher is shared, Claude-only repair of a missing or nonexecutable launcher can restore eligibility of an existing matching Codex receipt, even if Claude registration subsequently fails. This bounded exception preserves agent scope; the receipt-retirement guarantee applies to Codex/all init only.

The launcher never reads the recovery record. It retains cleanup identity after failed registration/publication and does not suppress execution. One global Codex home is recorded per installation. Unhook that home before switching; global full cleanup inspects both the selected and recorded homes. Unknown-event references retain identity and block switching/deletion until explicitly repaired. Unrecorded historical homes still require explicit cleanup with their old `CODEX_HOME`; Clooks does not search for them.

An empty legacy Codex flag is unverifiable and never suppresses a newly generated project launcher. Global default-home re-init upgrades it, but older project scripts still test only file existence. Rerun project init in each checkout as well as global init to acquire corrected behavior; no automatic migration of every checkout is claimed.

A valid persisted receipt can still suppress the project when the native global hook is disabled, unreviewed or never invoked. Enable/review the native global hook externally, or unhook its matching global registration so the project becomes eligible. Controlled PATH-probe counts establish only shell behavior, not live Codex support, native activation or universal exactly-once execution. Clooks continues to assume repository trust and preserves merged execution and inherited environment.

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
| Dedup checks        | Claude flag / Codex receipt     | None (authoritative)             | None (no binary invocation)     |
| Missing binary      | Exit 0 + install advisory (stderr) | Exit 0 + install advisory (stderr) | Exit 0 + JSON hookSpecificOutput |
| Created by          | clooks init                     | clooks init --global             | Plugin install                  |
| Purpose             | Event dispatch                  | Event dispatch (all projects)    | Bootstrap check                 |

## Gotchas

- **Claude Code cwd is not guaranteed to be project root.** Some hook events (notably Stop, SessionEnd) may run with a different cwd. This means relative paths in `settings.json` (e.g., `.clooks/bin/entrypoint.sh`) can fail with `/bin/sh: .clooks/bin/entrypoint.sh: not found`. Project-level registration must use `$CLAUDE_PROJECT_DIR` to resolve the entrypoint path reliably. Global-level registration uses absolute paths and is unaffected. The same cwd-instability also affects *config discovery*; clooks handles that internally by walking up parent directories anchored on `$CLAUDE_PROJECT_DIR` — see `docs/domain/config/discovery.md` for the full discovery algorithm and precedence order.
- **`$CLAUDE_PROJECT_DIR` fallback surprise.** When `$CLAUDE_PROJECT_DIR` is set but its walk-up finds no `.clooks/clooks.yml`, clooks falls back to walking up from cwd. If cwd happens to be inside a *different* project that has `.clooks/clooks.yml`, that project's hooks fire — even though cwd is unrelated to the Claude session's project directory. This is the correct fall-through behavior (the anchor walk found nothing; cwd walk is the designed fallback), but it can be surprising in unusual layouts such as nested git repositories or workspaces where the agent changes directory across project boundaries. Run `clooks config --resolved` to see which config clooks resolved and via which signal (`claude-project-dir`, `walk-up`, or `cwd-fallback`).
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
