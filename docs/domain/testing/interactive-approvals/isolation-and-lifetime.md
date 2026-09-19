# Native Interactive Approval Probes — Isolation & Fixture Lifetime

Illustrative-fixture isolation and evidence contracts, plus the mailbox's fixture lifetime and timing budgets. Part of [Native Interactive Approval Probes](../interactive-approvals.md).

## Isolation And Evidence

The following illustrative-fixture contracts are separate from generated mode
above. Illustrative evidence establishes implementation readiness, not release readiness or
compiled production enforcement. Cold-child MCP availability and external
expiry/dual-loss limits remain explicit; no production warming is prescribed.
The container helper set includes the runner receipt-label regressions in
`run.test.ts`, alongside protocol, overlap and boundary oracle helpers.

The runner reuses the existing `clooks-e2e` image and the native Responses model
fixture/catalog from `test/native-codex/`. It does not build upstream clients,
download native binaries, install Clooks, or change host configuration. Docker
socket denial in the shared sandbox requires escalation, not daemon startup.

Executable copies, test sources and installed dependencies are frozen under
`tmp/approvals-native/run-*/` and mounted read-only. Hashes and client versions
are retained. Tests run non-root with Docker networking disabled and fresh HOME,
CODEX_HOME, Claude config, cache, project and temporary roots. No real credentials
or host client configuration are mounted. Only the owned test container is
removed; symlink targets are excluded from artifact permission changes.

Codex filters arbitrary inherited environment variables from MCP subprocesses.
Ordinary fixtures explicitly supply disposable `APPROVAL_ROOT` and `APPROVAL_CASE`
in the MCP server's `env` table. Scoped fixtures instead supply `APPROVAL_LOG_ROOT`,
`APPROVAL_CASE` and `APPROVAL_SHARED_HOME=1` to exercise independent HOME lookup.
Neither implements production root selection or configuration loading.

Each case retains generated configs, original native inputs, expanded MCP
arguments, model requests, native original-call results, a chronological journal,
and cleanup observations. The five illustrative hooks run once, with checkpoints
at 2 and 4. Before replies, assertions check absent later hooks/effects and exact
displayed tool/input equality. Shell effects must occur once after hook 5;
non-shell cases additionally require native PostToolUse input/result evidence.
Command and companion identities are also compared to independent Codex
thread/start and turn/start receipts, or Claude's stdout session ID when present.
Interactive terminal output lacks that JSON anchor; equality between peers alone
does not prove concurrent or child-session attribution.
Refusals require their specific reason in the original native tool result.
Explicit decline/cancel cases compare the actual elicitation action to the script.

Paired handlers can independently emit different denials, and the native client
may select either reason for the original tool result. Under the explicit
unmatched-closure contract, wrong-owner cases instead require exactly one command
and companion, different expected owners and equal remaining native identity:
the unmatched companion closes neutrally, while the command must deny with its
actual unavailable-peer reason. Neither may prompt or produce an effect. Earlier
two-denial wrong-owner receipts describe the previous fixture protocol, not this
contract. Deadline cases still require causal deadline or subsequent
peer-exit evidence. Only a validated, actually emitted denial reason may satisfy
the native refusal check, not an arbitrary alternate error string.

Cancellation is agent-specific. Codex turn interruption can leave the server
alive: its check must settle before teardown. Claude process interruption may
terminate both peers: native `aborted_tools`, absent effects, and pre-teardown
process disappearance are then the evidence. Forced containment is recorded
separately and cannot turn an abandoned waiter into a passing case. Codex
interruption checks actual interrupted-turn identity and check settlement, not
one required error phrase: cancellation may settle without a command-exit error.

Scripted Codex responders capture their case directory and mode before waiting.
Native turn completion or driver failure cancels outstanding replies, and the
driver awaits every responder before native teardown. `responders.json` records
started/settled counts and zero pending work. Cleanup tolerates an already-exited
PID (`ESRCH`); other signal errors remain failures and cannot replace an earlier
primary failure. Helper regressions cover cancellation, case capture and signal
error handling.

Exclusive role claims publish fully written JSON via a no-replace hard link in
the Linux Docker fixture. Publication-barrier and collision helpers verify that
readers cannot see partial JSON and a second claimant cannot overwrite the first.

## Fixture Lifetime

The atomic mailbox uses agent, owner and native session/tool IDs, plus Codex
turn ID, exclusive role claims, nonce, question ordinal and deadline. It is not
a durable queue or adversarial security boundary. Terminal check failure must
notify the command; a live server PID does not mean its check is still active.
While elicitation is pending, command death aborts the SDK request. SDK 1.26.0's
stdio transport does not handle stdin EOF itself; the fixture explicitly closes
the server on EOF. The transport regression closes stdin without the client's
kill-based transport cleanup, then checks peer exit and denial before teardown.

Normal fixture budgets are 300 seconds per invocation including a five-second
output reserve, 330-second native handlers/Codex tool limit, and explicit SDK
timeouts bounded by remaining live time. Missing-peer discovery is three seconds;
unmatched check discovery is a separate one-second fixture window, followed by
exclusive closure, not the production five-second timeout selection. An ask requires live
nonce-bound attachment, not a provisional MCP role claim or server PID;
mailbox polling is 20 ms. The long case holds the first response for at least
65 seconds. Controlled deadline cases shorten the internal budget without
shortening the native deadline. Tests have a 110-second case ceiling and a
900-second container ceiling, independent of production timeout contracts.

The interactive Claude driver waits for native MCP connection establishment
before submitting the first user turn. Both this barrier and holding an already
started model response have still produced companion-not-connected refusals;
connection logs alone therefore do not prove hook readiness. Known title-generation
requests are recorded and answered separately, without advancing the scripted
tool sequence; unknown auxiliary requests fail.

## Related

- [Native Interactive Approval Probes](../interactive-approvals.md) — parent overview and commands
- [Generated Registration — Protocol & Timing](./generated-registration-protocol.md)
- [Scoped Registration & External Boundaries](./scoped-bootstrap-boundaries.md)
