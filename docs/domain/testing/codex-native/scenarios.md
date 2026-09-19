# Codex Native Testing — Native Scenarios

Native SessionEnd shutdown, handoff/Interrupt/MCP observation, and local function-tool rewrite scenarios. Part of [Codex Native Testing](../codex-native.md).

## Native SessionEnd Shutdown

`test/native-codex/session-end-scenario.ts` starts real pinned Codex 0.153.4 against the loopback synthetic model and lets ordinary `codex exec` completion initiate orderly shutdown. The focused `session-end.smoke.test.ts` and regular `native-conformance.smoke.test.ts` both run this shared scenario; at the time of this receipt, full smoke required sixteen cases, including `SESSION-END`, while earlier fifteen-case receipts retained their original scope. It does not submit a SessionEnd JSON fixture. The then-generated eleven-event registration and tested compiled Clooks dispatched the native event to an observer and the actual vendored tmux hook; only the tmux executable was fake, so no real tmux server was touched.

The focused run `tmp/codex-native-m1/session-end-Dr8SSybz` passed ten tests across two files with 17 assertions in 8.53 seconds, one native launch and final exit 0. The captured SessionEnd carried matching session identity, cwd, transcript path and `reason: other`, without model, permission mode or turn ID. The ordered trace shows SessionStart, Stop, then tmux style reset/current-style removal/automatic-rename restoration before the SessionEnd observer removed its cleanup marker. The process exited 0 without timeout or signal and was reaped; disposable directory removal, container cleanup, publication, sealing and hash checks passed. The receipt identifies tested compiled Clooks SHA256 `d028a1c59857bd6c314128556015d36e7b5ad1b6950a1212c01e65cb32484d00`; focused mode does not export that binary. Separate harness validation `unit-FcVjKCd5` passed 26 tests with 317 assertions in 0.875 seconds and final exit 0. The expanded sixteen-case full smoke was not run for this change.

This proves one native orderly exec shutdown path through generated registration and Clooks cleanup. It does not prove all exit paths, interruption, observer failure behavior, normal trust/approval setup, live tmux rendering, diagnostic delivery or full conformance. The run uses synthetic project trust, hook-trust bypass, danger-full-access and an offline mock model, with no real home/auth mounts. Native raw captures stay in attempt artifacts; the durable contract fixture is not relabeled as a capture.

## Native Handoff, Interrupt, and MCP

Historical receipt `smoke-3h0FR9X0` passed full smoke with final exit 0, all 26 case
receipts and 28 native launches. Seven parent handoff cases passed; the child
case passed actual reads in `danger-full-access`, `workspace-write` and
`read-only`. Interrupt reached the observer and flushed transcript. All six
non-record MCP shapes were observed and denied before server execution; the
record replacement executed once and reached PostToolUse and the next model
request. Evidence is retained under `tmp/codex-native-m1/smoke-3h0FR9X0/`,
including `final.rc`, `native-launch-count` and `export/completed.json`.
This receipt applies to its tested snapshot, not later source or stricter
receipt-validation changes; it does not establish live-model behavior or server
acceptance of the denied non-record inputs.

Full smoke requires 24 case receipts across 26 native launches, including `LOCAL-REWRITE` and `LOCAL-DENY`. Historical 28-case/30-launch receipts include the six retired token cases. `handoff-scenarios.ts` exercises SessionStart, UserPromptSubmit, PreToolUse and PostToolUse context, plus PreToolUse, PostToolUse and Stop block reasons. Each case requires a pointer in an actual model request, no original payload before the read, and exact file contents in a subsequent native tool result. PreToolUse denial prevents the command effect; PostToolUse denial preserves the already-completed effect. Files use the shared private handoff protocol, including paths containing spaces.

The historical complete 26-case smoke passed on pinned Codex 0.153.4 across 28 native launches, including all three child sandbox modes, with successful publication, binary export, permission sealing and cleanup. The scripted run completed in 193.76 seconds. Per-attempt receipts and command/output captures remain under `tmp/codex-native-m1/smoke-*/`; source fixtures remain synthetic.

`handoff-child-scenarios.ts` exercises SubagentStart context and a one-shot SubagentStop continuation, using the shared `native-feedback.ts` request/output reader. The child itself reads both files; the parent reading them does not count. All three attempts must pass: `danger-full-access`, `workspace-write`, and `read-only`. An unavailable sandbox fails the case and prevents binary export. Docker's default seccomp profile prevents the unprivileged namespaces needed by Codex's bubblewrap sandbox. Only the disposable full-smoke container uses `seccomp=unconfined`; it retains network isolation, default capabilities, read-only source/native mounts, and non-root test execution. No host home or credentials are mounted.

`interrupt-scenario.ts` sends SIGINT only after the real native process has started a model request. It checks generated three-second registration, the executed Interrupt hook's agent/session/model/permission context, and the flushed interrupted transcript. Interrupted `codex exec` exits 1 by design; success requires the hook evidence and graceful reaping, not exit zero.

`mcp-observation-scenario.ts` connects the real runtime to a local stdio MCP server. Null, array, number, boolean, JSON string, and malformed raw string arguments must reach the PreToolUse hook unchanged. Hook denials must appear on their exact tool calls, with no server execution or PostToolUse. A valid object is rewritten, executed once by the server, and observed unchanged in PostToolUse and the subsequent model request. These probes use a scripted local model provider and synthetic trust, not a live model or host installation.

## Native Local Function-Tool Rewrites

`local-tool-rewrite-scenario.ts` adds `LOCAL-REWRITE` and `LOCAL-DENY` to
`harness.ts` mandatory cases and `native-conformance.smoke.test.ts`. Each case
launches real pinned Codex 0.153.4 once in offline Docker against
the scripted local provider/catalog, using generated `clooks init --agent codex`
registration and disposable HOME, CODEX_HOME and project directories. Existing
deadlines remain unchanged. Both cases passed in the expanded full smoke.
The disposable Codex config must explicitly set `[tools.update_plan]` with
`enabled = true`: pinned 0.153.4 defaults this tool off, so the model catalog
alone does not register or advertise it.

The first provider request must advertise the native `update_plan` function
tool with object arguments supporting `explanation` and `plan`. `LOCAL-REWRITE`
uses Clooks `ctx.allow({ updatedInput: ... })` to replace the explanation and
first step while preserving both statuses and the second step. Exact raw and
normalized PreToolUse inputs must equal the original object; PostToolUse inputs
must equal the rewritten object, with the matching tool/call identity and the
real `Plan updated` response.

Pinned source inspection shows that the plan handler uses the registry's
default function-argument rewrite and emits a native PlanUpdate. Its tool
response contains only `Plan updated`, JSON exec output omits the explanation,
and rollout storage excludes PlanUpdate events. The scenario therefore checks
the native human renderer with color disabled: the rewritten explanation and
exact ordered steps must appear, and the original explanation and replaced
step must not. Independently, both the native transcript and subsequent model
request must contain the exact real tool output on the original call ID.
Scripted assistant responses supply neither rewritten content nor tool output;
argument echoes or hook captures alone cannot satisfy the execution oracle.

`LOCAL-DENY` requires the exact attributed feedback
`Tool call blocked by PreToolUse hook: local-plan-denied-local_deny. Tool: update_plan`
on its call ID, no PostToolUse, and no rendered plan update. Scope is generic
local function-tool object rewrites and denial through `update_plan`, not
non-record observation (#2), all local handlers, approval binding or an
ask/approve retry. The cases retain synthetic project trust, hook-trust bypass,
`danger-full-access` and a scripted provider; they do not establish live-model
behavior or normal interactive trust/approvals.

Measured native proof includes the exact rewritten explanation and step in the
renderer, preserved plan fields in PostToolUse, and real transcript/model
feedback matched by call ID. Denial produced the exact reason with no plan
update or PostToolUse. The historical 28-case/30-launch run passed with final,
completion, binary export and cleanup statuses zero. This is bounded proof of
the tested local object contract, not all function tools or full release
conformance. Exact run receipts and the tested binary hash are recorded in the
capability-completion plan; no global installation was performed.

## Related

- [Codex Native Testing](../codex-native.md) — parent overview and key files
- [Fixtures & Evidence](./fixtures-and-evidence.md)
- [Approval Case Evidence](./approval-cases.md)
- [Native Plugin Onboarding](./onboarding.md)
