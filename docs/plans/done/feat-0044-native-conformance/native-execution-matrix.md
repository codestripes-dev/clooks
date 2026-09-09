# Native Execution Matrix

Status: M0 historical proof and scoped M1 are complete. Native attempt 1 passed all six cases; Banach CODE/native-evidence and Raman QA/native-evidence GO plus parent closure GO received. Case IDs are plan identifiers, not separate test titles.

Evidence is real Codex 0.153.4 with a synthetic local model, network-disabled Docker, synthetic project trust, hook-trust bypass and danger-full-access. A passed row applies only to its stated capability, not every result arm of an event. See [M0/M1 evidence](native-conformance-evidence.md) and [execution plan](PLAN-FEAT-0044E-native-conformance.md).

## Historical M0 Proof

| Capability | Status | Observed boundary |
| --- | --- | --- |
| SessionStart generated registration/input/handler invocation | Historical M0 pass | Actual raw payload and handler; context delivery and startup failure effects unverified. |
| UserPromptSubmit generated registration/input/handler invocation | Historical M0 pass | Actual raw payload and handler; context and prompt refusal unverified. |
| PreToolUse shell baseline invocation and execution | Historical M0 pass | Actual payload/handler, marker `native`, successful tool result in next request; rewrite and other codecs unverified. |
| PostToolUse completed-shell invocation | Historical M0 pass | Actual payload/handler after baseline execution; context and feedback variants unverified. |
| Stop ordinary invocation | Historical M0 pass | Actual payload/handler; continuation and history-skip unverified. |
| PreToolUse shell denial consumption | Historical M0 pass | Marker absent, exact feedback in actual request 2, no raw/handler PostToolUse for `native_m0_call`; paired executable baseline. |

These are separate historical attempt 1 scratch results; durable M1 results are below. Export sealing failed; readable captures and successful cleanup do not establish immutability. Historical docs-shaped fixtures are unchanged.

## Six Mandatory M1 Cases: Passed

| Case ID / capability | Durable validation status | Required proof |
| --- | --- | --- |
| M1-BASE / baseline | Passed, attempt 1 | Generated registration, raw payloads and handlers for the baseline events above, actual shell marker and successful tool feedback. |
| M1-DENY / shell denial | Passed, attempt 1 | Paired baseline, absent marker, exact actual-request denial feedback and raw-call-ID-keyed absence of denied PostToolUse; missing call IDs fail. |
| M1-REWRITE / shell replacement | Passed, attempt 1 | Original command would write A; consumed rewrite writes B, with B present/A absent and original payload plus consumed command captured. |
| M1-ASK / unsupported ask refusal | Passed, attempt 1 | Actual native refusal feedback from reached Clooks policy and no tool effect, with executable baseline; diagnostic alone insufficient. |
| M1-CONTEXT / four-event request delivery | Passed, attempt 1 | Distinct SessionStart, UserPromptSubmit, PreToolUse and PostToolUse tokens in appropriate actual requests, each attributed to its event/call. PreToolUse uses `ctx.allow({injectContext})`; SessionStart/UserPromptSubmit/PostToolUse use `ctx.skip({injectContext})`. The public PreToolUse `ctx.skip()` helper does not accept `injectContext`; native skip-context consumption was not tested. No scripted assistant-token oracle. |
| M1-STOP / one continuation and history-skip | Passed, attempt 1 | First Stop reminder/block, same-turn native continuation without UserPromptSubmit, second Stop sees actual history and skips; exactly one reminder. |

All six passed in `test/native-codex/native-conformance.smoke.test.ts`, test `six mandatory native cases, baseline positive control first`. `test/native-codex/harness.test.ts` passed the final 17 helper tests, including positive/mutant oracles and exit propagation. Intermediate failure history is retained only in evidence.

## Deferred Capabilities

Every row below is natively unverified and unattempted in this pass. Source-supported constraints are not execution proof.

| Capability | Native status |
| --- | --- |
| PermissionRequest invocation under normal approval policy | Unverified / unattempted |
| PermissionRequest allow/deny and reserved-field refusal effects | Unverified / unattempted |
| PreCompact actual compaction-path invocation | Unverified / unattempted |
| PreCompact block suppressing compact request | Unverified / unattempted |
| PostCompact invocation after completed compaction | Unverified / unattempted |
| PostCompact observer/error effects and continued work | Unverified / unattempted |
| SubagentStart actual child invocation/identity | Unverified / unattempted |
| SubagentStart child-only context delivery | Unverified / unattempted |
| SubagentStop actual child completion/invocation | Unverified / unattempted |
| SubagentStop child continuation/history preservation | Unverified / unattempted |
| SessionStart startup failure effects | Unverified / unattempted |
| UserPromptSubmit block/title-refusal effects | Unverified / unattempted |
| PreToolUse defer, patch/MCP and other tool-codec effects | Unverified / unattempted |
| PostToolUse block/output-rewrite refusal feedback | Unverified / unattempted |
| Stop later root-prompt reset | Unverified / unattempted |
| Other process/JSON failure variants | Unverified / unattempted |
| Global/project coexistence and layered activation | Unverified / unattempted |
| Normal trust/review, approvals and default sandbox behavior | Unverified / unattempted |
| Exactly-once delivery and native retry deduplication | Unverified / unattempted |
| Recipient file readability | Unverified / unattempted; handoff stays inline |

## Execution Boundary

Parent owns Docker. Only the six mandatory cases are authorized, with at most two full native smoke attempts and one diagnosed correction initially. Pre-native unit/static/compile fixes consume no native attempt if no native process launched; runner evidence must report actual launches and consumed attempts, including partial failed smoke runs. One native attempt was consumed (six launches); no optional approval/subagent/compaction or other experiments ran. No production changes or upstream Rust-test execution are authorized; no full-release conformance claim follows.

## Durable Case Artifacts

All paths below belong to [smoke-d7UBQ3EW](../../../../tmp/codex-native-m1/smoke-d7UBQ3EW/). Each case directory retains raw payloads, handlers, actual requests, commands/config, native result and pass receipt.

| Case | Captured result |
| --- | --- |
| M1-BASE | [Observed](../../../../tmp/codex-native-m1/smoke-d7UBQ3EW/export/M1-BASE/observed.json): marker `native`, matching successful tool feedback. |
| M1-DENY | [Observed](../../../../tmp/codex-native-m1/smoke-d7UBQ3EW/export/M1-DENY/observed.json): marker absent, exact `m1-denied` feedback, no denied-call PostToolUse. |
| M1-REWRITE | [Observed](../../../../tmp/codex-native-m1/smoke-d7UBQ3EW/export/M1-REWRITE/observed.json): original marker absent, rewritten marker `rewritten`, actual output `rewritten-result`. |
| M1-ASK | [Observed](../../../../tmp/codex-native-m1/smoke-d7UBQ3EW/export/M1-ASK/observed.json): marker absent, actual unsupported-result-arm-ask refusal feedback. |
| M1-CONTEXT | [Observed](../../../../tmp/codex-native-m1/smoke-d7UBQ3EW/export/M1-CONTEXT/observed.json): event-attributed tokens in actual request text via the stated allow/skip arms. |
| M1-STOP | [Observed](../../../../tmp/codex-native-m1/smoke-d7UBQ3EW/export/M1-STOP/observed.json): three requests, same-turn continuation, Stop history 0 then 1, one reminder then skip. |
