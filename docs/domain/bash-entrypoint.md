# Bash Entrypoint

The bash entrypoint is the bridge between an agent's native hook system and the compiled Clooks binary. Claude Code and Codex registrations invoke this script for hook events; Codex identifies itself by setting an explicit agent marker. The script locates the binary, pipes stdin through, and translates exit codes.

## Overview

The entrypoint lives at `.clooks/bin/entrypoint.sh` in the project root. It is registered in `.claude/settings.json` for Claude Code lifecycle events and in `.codex/hooks.json` for Codex registration events. No positional arguments are passed; the event name comes from the agent's stdin JSON payload. The script is written by `clooks init` from an embedded template in `src/commands/init-entrypoint.ts`.

The script performs six steps in order:

1. **Bypass check** — If `SKIP_CLOOKS=true`, skip hook execution. An unpaired invocation exits 0 immediately; a paired invocation calls the suppression publisher described below.
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

The diagnostic exits 2 with empty stdout. Capture/replay and exit translation are unchanged: replay can turn empty input into a newline, which receives the same diagnostic. The diagnostic itself adds no automatic retry, permission change or hook bypass. Paired PreToolUse identity is read before discovery so early exits can complete their native check; this no longer serves token-store retirement.

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

Unpaired bypass runs before normal binary lookup. Paired bypass instead invokes
the PATH-resolved binary with `CLOOKS_APPROVAL_DISPOSITION=suppressed` to complete
its companion neutrally without config discovery or hooks; it is not a way to
avoid all binary execution. Missing binary retains the existing exit-0 bootstrap
behavior. Compiled pairing tests do not establish native activation or readiness.

## Environment Variables

The entrypoint and the binary react to a small set of environment variables:

| Variable | Effect |
|----------|--------|
| `SKIP_CLOOKS=true` | Bypass hook processing; paired invocations publish suppressed completion through the binary. |
| `CLOOKS_DEBUG=true` | Enable debug logging — stderr output + JSON request dumps to `CLOOKS_LOGDIR`. |
| `CLOOKS_LOGDIR=/path` | Directory for `CLOOKS_DEBUG` JSON dumps (default `/tmp/clooks-debug`). |
| `CLOOKS_AGENT=claude-code` | Optional explicit selector for the current Claude Code adapter. Unset or empty means the same thing for backward compatibility. |
| `CLOOKS_AGENT=codex` | Explicit selector used by generated Codex registrations. Enables twelve events through event-specific normalization and result policy before hook imports, including observation-only SessionEnd and Interrupt. Native evidence is scoped separately from runtime support. |
| `CLOOKS_APPROVAL_PROTOCOL=1` / `CLOOKS_APPROVAL_OWNER` | Generated PreToolUse pairing metadata; owner is `global` or `project:<persisted-id>`. |
| `CLOOKS_APPROVAL_DISPOSITION` | Command-owned `run` or `suppressed`; the MCP process does not repeat launcher dedup decisions. |
| `CLOOKS_HOME_ROOT=/path` | Override the home directory used for config resolution (mostly for tests). |
| `CODEX_HOME=/absolute/path` | Select the Codex global registration directory; unset or empty uses `$HOME/.codex`. Does not relocate the shared Clooks launcher or project `.codex/hooks.json`. |
| `CLOOKS_PROJECT_ROOT=/path` | Skip discovery and treat `/path` as the project root unconditionally. Highest-priority override (wins over `$CLAUDE_PROJECT_DIR` and the cwd walk). Mirrors `prettier --config` / `tsc --project` / `GIT_DIR`. |
| `$CLAUDE_PROJECT_DIR` | Set by Claude Code itself. Used by clooks as the **primary anchor** for config discovery — the walk-up starts here so an agent that runs `cd /tmp && <action>` cannot bypass project hooks. |

Unpaired Claude commands may rely on the default adapter; generated paired
PreToolUse commands explicitly select either `claude-code` or `codex`. Codex
registration always selects `codex`. Project Codex registration locates its
declaration by a committed project ID, then sets `CLOOKS_PROJECT_ROOT` only when
no nonempty explicit override exists. It preserves cwd and relative overrides.
Global Codex registration omits that override; the shell forwards inherited
values unchanged. The Codex runtime removes `CLAUDE_PROJECT_DIR` from its local
discovery environment, preserving explicit `CLOOKS_PROJECT_ROOT`; otherwise it
walks from cwd to merge home/project config.

SessionEnd and Interrupt register `timeout: 3` seconds, budgeting each entire entrypoint/runtime/hook pipeline, not individual hooks. Native defaults for both are 1 second with a 3-second maximum; other event registrations retain their existing timeouts. Re-run init for existing installations: migration adds missing events and repairs owned observer entries without the timeout; repeated canonical init does not rewrite the file. SessionEnd success produces no stdout; its local stderr diagnostics are discarded by native Codex on success, and failures do not veto closure. Interrupt observes root-turn interruption and emits only optional stdout `systemMessage` diagnostics, with no decision, injected context or cancellation veto.

## Live Approval Pairing

The launcher forwards MCP input unchanged. The Codex runtime preserves JSON
null/scalar/array/raw-string input for observation and approval binding; only
record inputs support partial patches.
Typed PreToolUse skip context and PermissionRequest block's `interrupt:false`
are runtime capabilities, not launcher controls. Configured handoff uses the
shared file/pointer path, with inline fallback on write failure; no launcher
inline-only guard applies. See [current capabilities](cross-agent-hooks.md#current-runtime-capabilities).

`registration-approvals.ts` supplies the exact metadata prefix and companion
template. PreToolUse pairs the command with `clooks.check`, using native session
and tool-use IDs plus Codex turn ID, literal provider/owner and protocol 1. Both
handlers use shared `APPROVAL_TIMEOUT_SECONDS` of 2,147,483 seconds (about 24.85
days, a finite native fallback). Codex MCP uses the same seconds value; Claude's
server `timeout` uses the derived 2,147,483,000 ms to override its wall timer and
raise its default 30-minute idle floor. Other events remain command-only. The engine
waits at checkpoints; the launcher does not parse denial output or mailbox
acknowledgements. For an explicit user refusal, the command emits the exact native
deny and acknowledges it only after the stdout write callback; the companion is
neutral only after that private receipt and otherwise retains its fallback deny.
The [former token transport](codex-approvals.md) and its native receipts are
historical, not validation of this generated pairing.

## Hook Registration

Paired registration and suppression have passed compiled E2E and independent
review. Those subprocess tests do not establish native discovery/activation;
older command-only launcher receipts retain their original snapshot scope.

The entrypoint is registered with the selected agent hook system. Registration
points at one Clooks command per event rather than individual hook files, plus
the PreToolUse MCP companion. Server locations and supported layouts are listed
in [CLI Architecture](cli-architecture.md#clooks-init--clooks-init---global).

Two registration scopes exist:

- **Project-level** — `.claude/settings.json` in the project root. Hooks travel with the repository. Created by `clooks init`. The entrypoint path uses `$CLAUDE_PROJECT_DIR` for reliable resolution (e.g., `"$CLAUDE_PROJECT_DIR"/.clooks/bin/entrypoint.sh`). Claude Code does not guarantee that the cwd is the project root for all hook events (notably Stop/SessionEnd), so relative paths like `.clooks/bin/entrypoint.sh` break. `$CLAUDE_PROJECT_DIR` is set by Claude Code for all hook commands and always contains the project root absolute path.
- **Global-level** — `~/.claude/settings.json` in the user's home directory. Hooks apply to all projects. Created by `clooks init --global`. The entrypoint path is absolute (e.g., `/home/joe/.clooks/bin/entrypoint.sh`).

Codex registration uses project `.codex/hooks.json` or global `${CODEX_HOME:-$HOME/.codex}/hooks.json` and command strings shaped like:

```bash
CLOOKS_AGENT=codex sh -c '<project-ID locator>' clooks-project '<32-hex-id>'
CLOOKS_AGENT=codex '/home/joe/.clooks/bin/entrypoint.sh'
```

The first form abbreviates the fixed project locator script; its sole argument is the declaration's ID, never a checkout path. The second form is global registration and deliberately has no `CLOOKS_PROJECT_ROOT`.

`registration-project.ts` prepares a 32-lowercase-hex identifier plus LF for each
selected project agent: `.clooks/bin/claude-project-id` or the reused
`.clooks/bin/codex-project-id`. Claude's separate marker supplies pairing ownership;
its launcher still uses `CLAUDE_PROJECT_DIR`. Codex's marker also supplies locator
identity. Re-init retains valid bytes and rejects malformed or nonregular files.
Global registration uses owner `global` and creates neither marker. Unhook retains
project files. Copies/worktrees retain their persisted declaration identity.

The fixed POSIX shell locator starts at physical cwd and scans ancestors for its exact marker bytes. An applicable Git root is the inclusive boundary, even above HOME; otherwise an ancestral physical HOME is the boundary, then `/`. Without an applicable Git root, an encountered `.git` marker is a conservative stopping point when Git discovery is unavailable. The scan completes before execution: repeated matching IDs within the boundary refuse ambiguous ownership, rather than choosing one nested copy. Distinct child IDs do not redirect ancestor declarations. A missing ID or unreadable/missing owning entrypoint emits a diagnostic and exits 2, with no fallback to another declaration. There is no identity-regeneration command or execution/dedup state.

After locating its owner, the command preserves stdin and cwd, retains any nonempty explicit CLOOKS_PROJECT_ROOT, otherwise exports the located root, and `exec`s Bash with the entrypoint path. The launcher need not have executable bits; Bash must be available. Relative overrides resolve against the original cwd, not the owning root. Deliberately overriding two declarations to the same config is caller intent. The locator never reads YAML or implements config discovery. Ownership recognition accepts only the exact generated project script plus canonical ID argument, or the supported quoted global form; unreleased absolute project commands have no compatibility parser.

Registered-command shell probes cover forwarding and existing global receipt behavior. Separate compiled portability E2E asserts real hook decisions and exact receipts for clone/move/worktree dispatch, nested declaration ownership, boundaries, missing artifacts, explicit overrides and ambiguity. Native recorder probes establish ancestor declarations are not deduplicated and main-checkout declarations can run in linked-worktree cwd; recorder evidence is distinct from compiled pipeline execution.

## Global Entrypoint and Dedup

The global entrypoint handles merged home, project and local hooks. A project
launcher can yield to the same agent's global registration. Claude retains its
legacy presence check; Codex requires a fresh registration receipt. Neither proves
native activation. When paired, yielding calls `clooks_suppress` rather than
exiting before the companion receives completion. That helper uses PATH lookup
and invokes `clooks` with disposition `suppressed`, preserving native stdin and
identity; exit 0/2 pass through and other failures become exit 2. Unpaired yielding
still exits 0. The MCP side never re-evaluates shell suppression predicates.

Claude Code uses the legacy flag:

```bash
if [ -f "$HOME/.clooks/.global-entrypoint-active" ]; then
  clooks_suppress
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

Claude-only init does not inspect or retire Codex state. Selected Claude settings,
server and shared outputs are now preflighted before launcher repair: invalid
Claude registration cannot revive Codex suppression during failed preflight.
Writes after preflight remain individually committed, so later commit failures
are not a rollback guarantee. Codex receipt retirement remains Codex/all-only.

The launcher never reads the recovery record. It retains cleanup identity after failed registration/publication and does not suppress execution. One global Codex home is recorded per installation. Unhook that home before switching; global full cleanup inspects both the selected and recorded homes. Unknown-event references retain identity and block switching/deletion until explicitly repaired. Unrecorded historical homes still require explicit cleanup with their old `CODEX_HOME`; Clooks does not search for them.

An empty legacy Codex flag is unverifiable and never suppresses a newly generated project launcher. Global default-home re-init upgrades it, but older project scripts still test only file existence. Rerun project init in each checkout as well as global init to acquire corrected behavior; no automatic migration of every checkout is claimed.

A valid persisted receipt can still suppress the project when the native global hook is disabled, unreviewed or never invoked. Enable/review the native global hook externally, or unhook its matching global registration so the project becomes eligible. Controlled PATH-probe counts establish only shell behavior, not live Codex support, native activation or universal exactly-once execution. Clooks continues to assume repository trust and preserves merged execution and inherited environment.

## Plugin Entrypoint (Bootstrap)

The shared read-only SessionStart reminder lives in the **sibling marketplace repository**, at `clooks/hooks/install-entrypoint.sh` (`../clooks-marketplace/clooks/hooks/install-entrypoint.sh` from this checkout). Its co-located Bun tests are `clooks/hooks/install-entrypoint.test.ts`. It is plugin-owned source intended to run from the cached package, not a runtime launcher generated by `clooks init`.

**Processing order:** Drain stdin immediately with `cat >/dev/null`, then exit 0 silently if `SKIP_CLOOKS=true`. Otherwise, resolve `clooks` with `command -v` and check that the result is an executable regular file. The script never invokes the binary, including for a version or health check.

| Executable availability | Reminder behavior |
|---|---|
| Executable `clooks` on the agent's PATH | Exit 0 silently, including when a managed binary also exists |
| No executable PATH result, but executable `$HOME/.local/bin/clooks` exists | Exit 0 with an installed-but-unavailable-on-this-agent's-PATH reminder; suggest explicit setup `check` and PATH correction |
| Neither location has an executable regular file | Exit 0 with an explicit setup reminder; non-executable files and directories do not count as an executable runtime |

**Provider selection:** Only `CLOOKS_AGENT=codex` selects the literal `$clooks:setup` command. An absent, empty, or other value defaults to Claude's `/clooks:setup`. The script does not infer provider identity from `CLAUDE_PLUGIN_ROOT`. The managed-only reminder names `$clooks:setup check` or `/clooks:setup check`, respectively.

**Output envelope:** Reminder branches emit nonblocking exit 0 JSON with a top-level `systemMessage` for the user-facing warning and `hookSpecificOutput` containing `hookEventName: "SessionStart"` and `additionalContext` for agent context. `systemMessage` is not nested. Only fixed message strings and the selected literal setup command enter JSON; paths and arbitrary environment values are not interpolated into it.

**Explicit setup only:** The context asks the agent to tell the user about explicit setup, not to run it. Startup does not download, install, update, initialize, invoke skills, edit profiles/configuration, create state, or request setup consent automatically. Native plugin hook trust/review is a separate agent-owned step, not consent requested by this script.

**PATH readiness:** A managed binary off PATH remains visible to the reminder even after successful initialization via its absolute path. Editing shell rc or exporting PATH in a child setup shell does not repair the running agent's environment; relaunching the agent with corrected PATH may be needed for this condition. This is not a blanket restart requirement after plugin trust approval. Conversely, silence establishes executable PATH presence only, not version compatibility, initialization, native activation, or hook readiness.

**Relationship to runtime launchers:** Explicit setup can run `clooks init` to create project/global runtime registrations. Those launchers retain their existing PATH-only resolution, missing-binary exit 0 stderr advisory, stdin capture/replay, binary execution and fail-closed translation of runtime failures. The plugin reminder performs none of that dispatch or translation and needs no runtime deduplication check. Its silence depends on executable PATH presence, not whether init ran.

**Evidence boundary:** The co-located tests exercise the actual script copied into disposable cache-shaped paths, parse JSON, verify stdin delivery/draining, and use command spies plus filesystem snapshots. They cover provider selection, bypass, executable PATH/managed states, non-executable files and paths containing spaces. These are isolated script checks, not verification of native loading, trust, context delivery, or execution of the actual packaged plugin.

### Comparison Table

| Aspect              | Project entrypoint              | Global entrypoint                | Plugin install-entrypoint       |
|---------------------|---------------------------------|----------------------------------|---------------------------------|
| Location            | .clooks/bin/entrypoint.sh       | ~/.clooks/bin/entrypoint.sh      | plugin cache (read-only)        |
| Events              | All                             | All                              | SessionStart only               |
| Invokes binary?     | Yes                             | Yes                              | No                              |
| Dedup checks        | Claude flag / Codex receipt     | None (authoritative)             | None (no binary invocation)     |
| Missing binary      | Exit 0 + install advisory (stderr) | Exit 0 + install advisory (stderr) | Exit 0 + JSON: top-level systemMessage and nested additionalContext |
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
