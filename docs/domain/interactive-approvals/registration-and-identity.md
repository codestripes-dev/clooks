# Shared Interactive Approval Transport — Generated Registration & Identity

Registration command/companion/server preparation, suppression and uninstall handling, and the `CheckInput` identity/wire-key schema with mailbox rendezvous. Part of [Shared Interactive Approval Transport](../interactive-approvals.md).

## Generated Registration

Registration has passed compiled validation and independent review; this is not
generated-registration native conformance. `registration-approvals.ts`
creates a PreToolUse command/`mcp_tool` pair with explicit protocol, agent and
owner and `APPROVAL_TIMEOUT_SECONDS` native budgets of 2,147,483 seconds
(about 24.85 days). This is the very-high finite native fallback; it is not an
infinite timer. The companion calls `clooks.check` with
native session/tool-use IDs and Codex turn ID. Other events stay command-only.
`registration-project.ts` prepares separate Claude/Codex project markers; Codex
reuses its existing locator marker. Global owner is literal `global`.

`registration-mcp.ts` prepares only the owned `clooks` server. Claude project and
global files are `.mcp.json` and `HOME/.claude.json`; Codex uses project
`.codex/config.toml` or the effective global Codex home's `config.toml`. The TOML
helper parses before range edits, preserves unrelated syntax/comments and edits
owned command/args/timeouts without whole-file serialization. Init preflights
selected settings, server destinations, identities and shared outputs before
committing per file. Foreign server conflicts are not overwritten.
Codex uses the same seconds value for `tool_timeout_sec` and retains ten-second
startup. Claude project/global server entries use the derived 2,147,483,000
milliseconds in `timeout`, overriding the wall timer and raising the default
30-minute stdio idle floor. The value remains below the signed 32-bit millisecond
timer ceiling. Re-init upgrades older owned entries while retaining unrelated
metadata; canonical entries are byte-preserving no-ops. These registration
budgets do not change hook execution, discovery, attachment or SDK cancellation.

Claude-selected init/uninstall reject any defined `CLAUDE_CONFIG_DIR`, including
empty/default-valued overrides, and existing `HOME/.claude/.config.json` before
mutation. Codex-only operations and custom `CODEX_HOME` remain independent;
`CLOOKS_HOME_ROOT` does not relocate registration or approval IPC.

Suppression is command-authoritative: paired bypass/dedup calls the PATH-resolved
binary with disposition `suppressed` so the companion completes neutrally. The
MCP process never duplicates the launcher's selection logic. Uninstall recognizes
owned command/companion/server remnants, preserves servers still referenced by
other handlers, and full cleanup retains `.cache/approvals-live`. It reports
`retainedPaths` and `deleted:false` if the runtime directory remains. No runtime
migration advisories or automatic installation are introduced.

Full removal refuses a `.clooks` root symlink before mutations. A retained owned
Codex server keeps its recovery identity when unrelated hooks still reference
it. Claude global unhook instead retires its dedup flag after hook removal and
before the fallible server commit, avoiding project suppression if that commit
fails.

## Identity And Rendezvous

`protocol.ts` defines one strict `CheckInput` schema and derives the advertised
MCP input schema from it. Inputs contain literal protocol version `1`, agent
`claude-code` or `codex`, owner `global` or `project:<persisted-id>`, native
`session_id` and `tool_use_id`. Codex additionally requires native `turn_id`.
Unexpanded placeholders and extra fields are rejected. Owner scope is supplied
by the command/registration boundary, not inferred by the MCP process.

The mailbox key hashes canonical identity. Exclusive command/check claims,
a fresh command nonce, check claim identity, question ordinal and question digest
bind the exchange. Complete packets are published through a private temporary
file and an exclusive hard link; existing claims or packets are never replaced.

Explicit user decline/cancel uses one additional terminal packet,
`denial-ack.json`. Its strict body binds protocol version, full `CheckInput` key,
command nonce, check claim ID, ordinal, question digest, typed decision and a
digest of the exact native denial. The command publishes it only after the exact
exit-0 denial's stdout write callback completes. Ordinary `done` and `check-done`
publication may precede command output and is never denial acknowledgement.

One immutable election selects a started command or a closed unmatched check.
The check waits up to five seconds for a start, then returns neutral if it wins
closure. This longer command-startup discovery window mitigates observed native
startup delay; it cannot guarantee pairing when startup exceeds five seconds.
A finite cutoff remains necessary because a running MCP check cannot distinguish
a delayed command from a command that will never start, such as a missing binary.
A later command may still complete without asking, but an actual ask requires a
live attachment to its nonce and cannot reopen a closed election.
Process existence alone is not attachment. The check rereads completion after
observing command death, avoiding a false failure when completion publication
and process exit race.

## Related

- [Shared Interactive Approval Transport](../interactive-approvals.md) — parent overview
- [Engine Checkpoints](./engine-checkpoints.md)
- [MCP Server](./mcp-server.md)
