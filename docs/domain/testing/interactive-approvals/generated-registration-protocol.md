# Native Interactive Approval Probes — Generated Registration Protocol & Timing

Elicitation/UI mailbox protocol details, compiled-engine coverage, timing/deadline budgets, registration E2E, and acceptance/cancellation verification for `--generated` mode. Part of [Native Interactive Approval Probes](../interactive-approvals.md); continues [Generated Registration](./generated-registration.md).

Production elicitation keeps transport metadata in the bound mailbox rather
than displaying it to the user. Hook 2 supplies an optional question headline;
hook 4 omits it to retain the reason-first compatibility path. Codex messages
retain the prior layout byte-for-byte: question or full reason, operation,
optional complete multiline reason, and `Requested by <hook>` are separate
blocks. Only an exact one-line, control-free Bash `{ command: string }` uses its
`Command` block; every other Codex operation uses `Tool` plus two-space
pretty-printed JSON `Input` without dropping fields.

Claude alone previews an exact `toolName === "Bash"` record with an own string
`command` when that command is one line and free of the existing control-character
pattern. Its first block joins the question (or full legacy reason), exact
command, and `Requested by <hook>` with single newlines. A distinct full reason
follows verbatim as the next block. If the input has any extra keys, the complete
legacy `Tool: Bash` and pretty-printed `Input` block follows, including the
command and every other field; exact command-only input does not duplicate JSON.
Non-Bash inputs and multiline or control-bearing Bash commands retain the full
legacy layout. Blocks use one blank line. Questions and reasons are never
shortened; a multiline headline can consume Claude's bounded native preview, so
the tests do not promise that all details fit its first three displayed lines.
The bound mailbox agent selects the strict form. Claude Code receives exactly
`{ type: "object", properties: {} }`; only `action: "accept"` with exact empty
object content confirms the operation. Its decline and cancel responses may omit
content or use exact `{}`. Codex retains one required `decision` string titled
`Decision`, the decline-first enum `["Decline", "Approve"]`, and no default;
only accepted exact `{ decision: "Approve" }` confirms. Codex decline/cancel
responses remain refusals even when accompanied by valid `Approve` content.
Missing or malformed accept content, extra content, and malformed decline/cancel
content fail closed. Test responders must obtain agent identity and ordinal
metadata from the mailbox, independently compare the exact message and the one
agent-specific schema with that snapshot, and reject the other agent's
schema rather than accepting either shape. The illustrative fixture's historical
boolean protocol remains unchanged.

Compiled-engine coverage runs both agents through headline and legacy asks,
rejects null, other non-string, empty, whitespace-only and
questions longer than 512 JavaScript UTF-16 code units before later hooks, and
verifies that an exact multiline headline survives final-operation rewrite
confirmation. Exact-message assertions keep Codex unchanged and bind Claude's
first three lines for command-only and extra-field Bash inputs. They also cover
the reason-only compatibility path, no duplicate JSON for exact command-only
input, complete `command`/`description`/`timeout` retention below the preview,
and legacy fallback for non-Bash, multiline and control-bearing operations.
Shared-runtime responders send exact agent-specific acceptance content.
Focused transport cases verify Claude's empty-content decline/cancel forms and
fail closed for missing, null, array, extra-field, Codex-shaped, and malformed
refusal content without weakening Codex's existing malformed-response coverage.

Production Clooks excludes the interval after publication while attachment and
an elicitation request are outstanding from its local execution deadline and
passes exact `timeout: null` for that SDK request. The host supplies no prompt
render acknowledgement: command-side credit begins at question publication,
including bounded attachment and server pre-elicitation latency, while the server
credits from immediately before requesting elicitation. Cancellation, disconnect
and process death still refuse. Compiled engine E2E holds the prompt beyond a
deliberately shorter per-hook timeout for both agents, then covers acceptance,
refusal and cancellation without replay or later-hook execution. Compiled transport cases
cover request cancellation and peer loss for both agent identities. Focused
compiled engine regressions start each agent's MCP check, wait for the exact
identity-bound `check.json` claim, delay command startup by 1,500 milliseconds,
then require an approval and normal command/check completion. The claim barrier
ensures the delay measures command startup after discovery actually began rather
than MCP request startup. The production five-second discovery budget is a
bounded mitigation; startup later than that can still close before the command.
Focused
compiled refusal cases cover both agents and command-first/MCP-first startup:
the command emits exact denial-only JSON with no redundant Codex `systemMessage`,
input patch or context, while the companion is neutral only after the
emitted-denial receipt. Missing and corrupt acknowledgement cases keep the
companion fail-closed. These short tests prove that human response time is
separate from hook execution; they
do not simulate a five-minute wait. Injected-clock unit tests advance beyond the
former 295-second Clooks budget and the former 330-second native registration value.
Production registration now sets both paired handler timeouts and Codex's
`tool_timeout_sec` to `2147483` seconds (about 24.85 days). Claude's owned MCP
server `timeout` is `2147483000` milliseconds in project `.mcp.json` and global
`HOME/.claude.json`. These finite values stay below the signed 32-bit millisecond
timer boundary; they do not establish an unlimited native-host lifetime.

Compiled registration E2E upgrades old 330-second pairs in both agents and
scopes, preserving ownership, unrelated 111-second hooks, other event defaults,
foreign servers, custom server environment/metadata, and repeated-init bytes.
Generated native checks independently assert the literal handler and server
values before launch, including both scopes in combined cases. The existing
26-case native inventory must still pass acceptance, decline and cancellation
with those generated values: normal pending prompts and attributed outcomes
check for immediate timer overflow or expiry. Helper tests reject old limits,
wrong units and asynchronous command registration; they do not establish native
runtime behavior. The illustrative fixtures retain the shorter budgets described
under [Fixture Lifetime](./isolation-and-lifetime.md#fixture-lifetime).

Each case retains `init.json`, `generated-registration.json`, native observations
and `observed-packets.json`. Claude global cases may update native
`HOME/.claude.json` metadata: compare owned `mcpServers` structurally, while
hooks and launchers remain byte-for-byte unchanged. Other registration files,
including global Codex configuration, are byte-for-byte snapshots. The global
Codex fixture may use CLI `-c` overrides for fixture model and trust settings;
these overrides must never replace hooks or MCP. Aggregate `results.json` preserves failures;
`passed.json` is written only when all selected cases pass and labels
`productionEngine`, `generatedRegistration` and `scriptedUI`. Inspect final exit,
hash checks and cleanup as well.

Native acceptance requires real file creation, native PostToolUse and native
identity output for non-shell cases, not a direct shell-effect event; the file
must be absent while pending and after denial. Cancellation requires explicit
native elicitation action `cancel` at the selected ordinal and production
`failure.kind='cancelled'`; for normal user cancellation its message is
`[hook-name] Approval cancelled. Operation not run.` It is not `turn/interrupt`
evidence. Automated replies remain scripted and do not prove
human consent, normal trust policy or release conformance. Existing
cold-readiness and external-expiry limits remain. Pinned verification: 26
generated native cases passed on Claude Code 2.1.272 and Codex CLI 0.154.0;
typecheck, snapshot and hash checks, and disposable cleanup passed.

## Related

- [Native Interactive Approval Probes](../interactive-approvals.md) — parent overview and commands
- [Generated Registration](./generated-registration.md)
- [Claude Interactive Config Discriminators](./interactive-config.md)
- [Isolation & Fixture Lifetime](./isolation-and-lifetime.md)
