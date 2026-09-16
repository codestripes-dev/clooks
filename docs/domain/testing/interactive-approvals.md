# Native Interactive Approval Probes

`test/fixtures/interactive-approvals/` contains illustrative command checkpoints,
not the production Clooks engine. The separate `--generated` mode below uses
`test/fixtures/production-approvals/` with compiled Clooks and actual init-generated
registration. Its 26-case inventory contains project shell, global-only shell,
project non-shell and six shell-only combined cases.
Native clients, hook schedulers, MCP connections and final tools execute for real.
Illustrative passes do not establish production ordering. In automated probes,
the loopback model and elicitation replies are scripted. Passing automated cases
do not establish human consent, model reasoning, normal trust policies, or release
conformance. Human TTY manual evidence with no scripted elicitation responder
can establish human replies for the observed case; the model remains scripted,
and that evidence does not establish production behavior.

## Commands

Run from the repository root with explicitly supplied existing executables:

    CLOOKS_CLAUDE_BINARY=/absolute/path/to/claude \
      CLOOKS_CODEX_BINARY=/absolute/path/to/codex \
      bun run test:approvals-native --baseline

In illustrative mode, `--baseline` selects two approvals in each handler order
for both providers. Omit it to select the illustrative inventory, or supply exact
case names such as `codex-long-command-first`. `--transport` instead runs the SDK
stdin-closure regression. Unknown, duplicate and empty selections fail. `passed.json` covers
only the named executed cases, never unimplemented scenarios.

### Generated Registration

Run the compiled-production mode with the same explicit native executables:

    CLOOKS_CLAUDE_BINARY=/absolute/path/to/claude \
      CLOOKS_CODEX_BINARY=/absolute/path/to/codex \
      bun run test:approvals-native --generated

This defaults to exactly 26 cases. The structured descriptors in
`test/native-approvals/generated.ts` use these names: each provider has project
shell `<provider>-generated-<approve|decline-first|decline-second|cancel-first|cancel-second|noask>`,
global-only shell `<provider>-generated-global-<approve|decline-second>`, and
project non-shell `<provider>-generated-project-non-shell-<approve|decline-second>`:
Claude uses `Write`; Codex uses `apply_patch`. The combined shell descriptors
are `claude-generated-combined-approve`,
`claude-generated-combined-decline-second`, `claude-generated-combined-noask`,
and the corresponding three `codex` names. Combined cases use one fixed
project-then-global init order; alternate init orders and non-shell combined
cases are not in this inventory.
Explicit subsets use those names, for example
`bun run test:approvals-native --generated codex-generated-project-non-shell-approve`
with the same environment assignments. Duplicate/unknown cases and illustrative
flags such as `--baseline` are rejected. The inventory is intentionally scoped,
not a Cartesian product.

`test/native-approvals/generated.ts` runs actual compiled
`clooks init --agent <agent> --json`, selecting `claude-code` or `codex`, in
disposable Git projects. Global cases run global-only init; project cases run
project init. Seed disposable trust metadata before `init` for both providers;
the test must not rely on a CLI override to suppress native trust writes. The
generated command/MCP pair, server entry, project identity and entrypoint are
captured and checked using the scope-aware snapshot rules below. Combined
fixtures place hooks 1-2 only in HOME config/files and hooks 3-5 only in the
project, with the source `import.meta.path` recorded in the journal to prove
the merged layer. For Codex combined cases, the observer is pre-seeded in the
project hooks before `init` because both native hook files are occupied; trust
metadata is seeded before `init` as described above, and pre-fixture snapshots
are retained. `native.ts` uses a distinct
generated branch for the existing model/RPC/cleanup machinery: no illustrative
server or CLI pair replaces init's registration. Claude uses print mode and
Codex uses app-server, not a human TTY approval session. Fixture-only observers,
scripted responders, local-model settings and native trust stay separate in
disposable local/user settings. Both init and native launch omit
`CLAUDE_CONFIG_DIR` and `CLOOKS_HOME_ROOT`; Claude uses default-layout
`HOME/.claude.json`, not `config/.claude.json`.

Only generated mode snapshots production build inputs, including the required
`.clooks/vendor/plugin` imports, and typechecks/compiles Clooks inside Docker with
`--compile --bytecode --format=esm`. The resulting `/export/build/clooks` is
selected on each disposable PATH; build logs, source
and binary hashes, Bun version and source commit accompany the frozen input
manifest. Illustrative mode does not compile production Clooks.

The production fixtures execute five real hooks, with asks at 2 and 4 except
in `noask`. Assertions bind native session/tool IDs (plus Codex turn ID), owner,
nonce and displayed operation to the production mailbox. Before each reply,
later hooks/effects must be absent. Approval requires exactly one original-call
effect after hook 5; declines require attributed native refusal, stopped later
hooks and no effect/PostToolUse; no ask requires zero prompts/questions/replies.
For combined cases, global owns the active merged pipeline and
`project:<persistedid>` is suppressed. Exactly two native-bound mailboxes are
required; pending active checks may observe a suppressed peer still starting
and must not require premature completion. Both mailbox pairs must settle before
native teardown. The suppressed project peer always completes neutrally with no
questions, replies or failures; an active global decline records its command
failure while its companion completion remains neutral.
No duplicate pipeline, prompt or effect is accepted. Helper regressions in
`generated.test.ts` check selection and false-pass resistance, not native
enforcement.

For a normal user decline or cancellation, the command is the sole native
denial source. The command publishes its attributed failure and, only after its
denial JSON has been written, a bound `denial-ack` containing the check claim,
refusal ordinal, displayed-question digest, decision and denial-output digest.
That acknowledgement proves completion of the command's pipe write; it does not
prove that the native client displayed or accepted the denial. The companion
must complete neutrally and return `{}`. The native original tool result must
independently contain the same command-attributed reason. Generated packet
oracles therefore require the exact `[hook-N] Approval <declined|cancelled>.
Operation not run.` command reason, a `confirmed: false` refusal reply, a valid
acknowledgement, neutral `check-done`, stopped later hooks and no effect or
PostToolUse. They do not infer an exact UI note count from mailbox packets.

If the command exits before publishing a valid acknowledgement, its output write
fails, or the acknowledgement is missing, malformed or does not bind the exact
denial, the companion remains fail-closed and reports denial. Approval and
no-ask paths publish no denial acknowledgement and retain their prior neutral
companion behavior.

Production elicitation keeps transport metadata in the bound mailbox rather
than displaying it to the user. Hook 2 supplies an optional question headline;
hook 4 omits it to retain the reason-first compatibility path. With a question,
the exact message contains the question, operation, complete multiline reason,
and `Requested by <hook>` sections. Without one, the complete reason is the
headline, followed by the operation and attribution. Only exact packet
`toolName === "Bash"` with an exact, one-line, control-free `{ command: string }`
input uses `Command`; every other tool or input uses `Tool` plus two-space
pretty-printed JSON `Input` without dropping fields.
Its strict form has one required `decision` string titled `Decision`, with the
decline-first enum `["Decline", "Approve"]` and no default; only accepted
`Approve` confirms the operation. Test responders must obtain identity and
ordinal metadata from the mailbox, independently compare the exact message and
schema with that snapshot, and leave the illustrative fixture's historical
boolean protocol unchanged.

Compiled-engine coverage runs both providers through headline and legacy asks,
rejects null, other non-string, empty, whitespace-only and
questions longer than 512 JavaScript UTF-16 code units before later hooks, and
verifies that an exact multiline headline survives final-operation rewrite
confirmation.
Operation cases independently cover non-Bash objects and primitives plus Bash
inputs with extra fields, multiline commands and control characters; none may
use the compact display or lose input detail.

Production Clooks excludes the interval after publication while attachment and
an elicitation request are outstanding from its local execution deadline and
passes exact `timeout: null` for that SDK request. The host supplies no prompt
render acknowledgement: command-side credit begins at question publication,
including bounded attachment and server pre-elicitation latency, while the server
credits from immediately before requesting elicitation. Cancellation, disconnect
and process death still refuse. Compiled engine E2E holds the prompt beyond a
deliberately shorter per-hook timeout for both providers, then covers acceptance,
refusal and cancellation without replay or later-hook execution. Compiled transport cases
cover request cancellation and peer loss for both provider identities. Focused
compiled refusal cases cover both providers and command-first/MCP-first startup:
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

Compiled registration E2E upgrades old 330-second pairs in both providers and
scopes, preserving ownership, unrelated 111-second hooks, other event defaults,
foreign servers, custom server environment/metadata, and repeated-init bytes.
Generated native checks independently assert the literal handler and server
values before launch, including both scopes in combined cases. The existing
26-case native inventory must still pass acceptance, decline and cancellation
with those generated values: normal pending prompts and attributed outcomes
check for immediate timer overflow or expiry. Helper tests reject old limits,
wrong units and asynchronous command registration; they do not establish native
runtime behavior. The illustrative fixtures retain the shorter budgets described
under Fixture Lifetime below.

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

### Claude Interactive Config Discriminators

Use the same explicit binary environment assignments above and select exactly
one existing interactive case, for example:

    bun run test:approvals-native --interactive-config=disk claude-defer-interactive-command-first
    bun run test:approvals-native --interactive-config=cli-no-tools claude-defer-interactive-command-first
    bun run test:approvals-native --interactive-config=cli-restart claude-defer-interactive-command-first
    bun run test:approvals-native --interactive-config=cli-second-turn claude-defer-interactive-command-first

`disk` uses the existing server object in project `.mcp.json` and the same hooks
and permissions in `.claude/settings.local.json`, plus
`enabledMcpjsonServers: ["checkpoints"]`. It removes explicit CLI MCP/settings
registration and empty setting sources, but keeps `--tools Bash,Write`.
`cli-no-tools` instead retains original CLI registration and removes only
`--tools Bash,Write`. Both start with fresh disposable HOME and project trust.
The default `cli` retains the original explicit CLI registration.

`--interactive-readiness=mcp-status` is a separately named diagnostic for explicit
interactive cases: it opens the native `/mcp` status view, observes the connected
server, closes the view, then submits the first tool request. Receipts identify
that context because opening the view may advance native state. The default
`input-render` barrier only observes the prompt and typed-input rendering after
connection; neither is a proven ordinary-startup fix.

`cli-restart` completes a priming tool turn under the original CLI flags, performs
native cleanup, then relaunches unchanged HOME/project/config/argv/environment.
Priming is labeled separately, not counted as a successful interaction. Its
logs, model responses, mailbox records and cleanup move under `priming/`; the
actual scenario uses fresh logs, model sequence and native call ID. Generated
config bytes are checked unchanged, and current debug/journal must be absent
before relaunch, so old connection/reply evidence cannot satisfy the new case.
`restart.json` records input continuity and identities; `priming/summary.json`
records the original result and whether native created a discovery cache. The
runner never fabricates a cache or rewrites native/vendor code to create one.

`cli-second-turn` instead keeps one interactive process alive across two distinct
tool turns. The denied first turn is priming evidence, not a successful operation.
After its command exits, the harness archives its model requests, mailbox and
journal records under `priming/`, assigns a new call ID and submits a second user
turn. It keeps the full process debug log and the original server-birth record
for cleanup; `second-turn.json` records both identities. The second turn must
independently satisfy the normal two-approval/original-effect oracle, not replay
or resume the denied call.

Observed Claude 2.1.272 result: the first three bounded variants failed with a native
connection before the hook's `server 'checkpoints' not connected` skip. No MCP
call, replies or native effect occurred; the original operation was denied
`MCP peer unavailable`. Failure rc remains 1, not a normal-flow pass. The restart
had no persisted discovery-cache directory, so a verified cached-client restart
is still unproved. Exact artifacts and version hashes are retained in runner-owned
`tmp/approvals-native/run-*/` directories. These fixture failures do not establish
healthy interactive pairing, production support, or the underlying native cause.
The separately tested same-process second turn passed with one MCP call, two
replies and exactly one native effect. That demonstrates later-turn behavior,
not reliable cold first-turn interaction or a proved native root cause. Scope,
concurrency and child-operation behavior remain unverified by these cases.
The same diagnostic can also encounter a successful first turn, which violates
its required denied-priming precondition and must not be labeled a second-turn
pass. Such a failed diagnostic is distinct from a native approval failure.
An unmet priming precondition is recorded in `diagnostic-precondition.json` as
`precondition-not-reproduced`. The fixture sends a controlled native completion
marker, then fails using the retained assertion error after native exit; it does
not force a denial, retry for a preferred outcome, or wait for the outer timeout.
Diagnostic pass receipts identify the config and second-turn-only phase and
explicitly exclude the denied first turn from success.
Late Codex line-handler errors remain test failures after turn completion, replacement journals use no-overwrite creation, and diagnostic receipts separate the required denied first turn from artifact-verified outcomes.

Every Docker invocation also runs the fixture helper tests. Run those alone with
`bun test ./test/native-approvals/channel.test.ts`; the leading `./` selects the
file outside Bun's default `src/` root. These are validation-helper tests, not
native enforcement evidence. Full compiled tests still use `bun run test:e2e`.

### Scoped Registration And Bootstrap

Select scoped cases as
`<claude|codex>-scope-<project|global>-<approve|decline>-<command|mcp>-first`.
For example, `codex-scope-global-decline-mcp-first` loads project and global
registrations, with explicit project suppression and one active global pipeline.
These native fixture cases verify neutral suppressed peers, no duplicate pipeline,
independent native identities, and approval/refusal effects. They do not execute
generated Clooks launchers or reproduce the production suppression predicate.

Scoped peers independently resolve
`realpath(HOME)/.clooks/.cache/approvals-live/v1`, ignoring configuration overrides
for IPC only. `APPROVAL_LOG_ROOT` locates artifacts, not coordination; no absolute
IPC path is injected. Existing same-owner, non-writable `.clooks` and `.cache`
directories may be 0755 and are never chmodded; dedicated live directories must
be private. Root/input failures still emit command denial. Completion is reread
after observing peer death so a just-published terminal result is not lost.

Bootstrap cases use modes `bootstrap-no-start`, `bootstrap-late-ask` and
`bootstrap-late-noask` with the same provider/order suffixes. The illustrative
no-start branch stands for a launcher that cannot publish, not a tested binary
lookup or migration implementation. Late commands wait on an explicit closed
record, not a fixed sleep: no ask means ordinary completion; an actual ask must
deny promptly even while the MCP server lives. Unmatched neutral is not approval.
Claude bootstrap settings explicitly allow disposable Bash execution to separate
native permission from hook disposition; the negative late-ask case must still
deny. Neither peer manufactures an allow result for a no-start invocation.
These cases remain subject to their own retained results and snapshot review.

Overlap candidates use `<claude|codex>-overlap-<same-session|parent-child>`.
`overlap.test.ts` adds synthetic per-call barrier and cancellation helpers to
each Docker invocation; these helpers alone do not prove native overlap.
The explicit-only `codex-overlap-serial-child-control` is excluded from default
and baseline selection and labels receipts `diagnosticOnly: true` and
`overlapProof: false`. It tests a cold child without requiring simultaneous calls.
Overlap requires A's approved effect while B is pending and eventual exact
PostToolUse attribution; native hosts may deliver PostToolUse after B's answer.

`codex-overlap-primed-child-control` is a diagnostic using a direct normal MCP
call before child hook interaction, not a production startup strategy. Codex
0.154.0 selects `LazyWhenCached` for subagents in
[its runtime policy](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/session/mcp_runtime.rs#L368-L372),
while [MCP hooks](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/hook_mcp_executor.rs)
use `wait_for_server=false`. A successful direct-call-warmed diagnostic does not
prove cold-child availability or that generated registration fixes lazy startup.

### External Native Boundaries

`<claude|codex>-boundary-timeout-command-first` shortens both native handler
limits to two seconds but retains the long internal budget.
`<claude|codex>-boundary-dual-exit-command-first` instead freezes both live peers
before killing either. A dedicated harness holder never answers checkpoint one.
These use explicit disposable native Bash permission and a 20-second outer
observation ceiling; no production timeout or permission setting is changed.

Receipts label these as `characterizationOnly`, never controlled-enforcement
passes. Native execution without consent is an observed boundary, not an oracle
failure to hide. A final-result timeout remains a failed/incomplete
characterization even when the journal already proves an effect. Inspect raw
native hooks/results, exact call identity, effect/PostToolUse and cleanup together;
missing final completion is not evidence of refusal. Containment is recorded
separately from native settlement.

Boundary attribution requires actual native timeout/cancellation evidence or
the exact peer-kill journal record, with any effect following that boundary;
teardown elapsed time is descriptive only. Refusal requires native feedback
matching an invocation-bound, actually emitted denial. An unrelated native
execution error is not hook refusal, and one expired handler with a surviving
companion denial does not prove both handlers expired.

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

Cancellation is provider-specific. Codex turn interruption can leave the server
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

The atomic mailbox uses provider, owner and native session/tool IDs, plus Codex
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
exclusive closure, not a production timeout selection. An ask requires live
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
