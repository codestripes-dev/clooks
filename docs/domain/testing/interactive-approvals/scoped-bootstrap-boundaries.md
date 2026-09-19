# Native Interactive Approval Probes — Scoped Registration & External Boundaries

Scoped registration/bootstrap cases, overlap candidates, and external native timeout/dual-exit boundary characterization. Part of [Native Interactive Approval Probes](../interactive-approvals.md).

## Scoped Registration And Bootstrap

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
`bootstrap-late-noask` with the same agent/order suffixes. The illustrative
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

## External Native Boundaries

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

## Related

- [Native Interactive Approval Probes](../interactive-approvals.md) — parent overview and commands
- [Claude Interactive Config Discriminators](./interactive-config.md)
- [Isolation & Fixture Lifetime](./isolation-and-lifetime.md)
