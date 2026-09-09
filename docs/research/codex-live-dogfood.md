# Codex Live Dogfood Evidence

## Status and Scope

Checkpoint: 2026-09-08, updated with parent-reported child continuation and cleanup results. This document records observations from temporary, explicitly authorized real-session probes. The documentation delegate did not run tests or independently inspect runtime logs. Results below establish some native invocation evidence for all ten target events across the combined sources, not validation of every result variant, tool or Codex workflow. Live-phase code closure GO and QA closure GO are confirmed by the parent; the separate compatibility probe confirmed a hook-specific gap and compaction attempt 2 passed with final code closure GO and QA closure GO confirmed. The parent has closed testing; no further experiments are planned.

User prompt, verbatim: 'Do it. You have free reign. Try to test everything.'

The probes used the existing configured, restarted Codex session. No real authentication or trust changes were made. Temporary fixture work is distinct from production changes and general test policy. The initial evidence-only checkpoint was followed by authorized narrow living-document updates. No production code, global settings, or README changes were made.

## Environment and Artifacts

- Installed Codex CLI: `0.153.4`.
- Installed Clooks hash: `62b93d68dec129d02f9f9c5f516a010c6a9f448e950c0fd06d6ec62f96579278`.
- Scratch plan: `tmp/clooks-live-dogfood/PLAN.md`.
- Exact configuration backup before adding the temporary stanza: `tmp/clooks-live-dogfood/clooks.yml.before`.
- Event observations: `tmp/clooks-live-dogfood/observations.jsonl`.
- Separate context-token evidence: `tmp/clooks-live-dogfood/context-tokens.jsonl`.

The observer records bounded event metadata and exact authorized probe commands. Response capture was subsequently restricted to matching harmless probe commands at PostToolUse. Arbitrary tool responses, authentication data, and transcripts are outside this evidence collection. Token literals are intentionally not reproduced here; this delegate did not read the token log.

## Direct Tool Probes

The parent exercised eight direct `printf` probe cases, with a further post-block rerun after strengthening the output oracle.

| Case | Reported live result | Evidence boundary |
| --- | --- | --- |
| Allow | Expected stdout; PreToolUse and PostToolUse matched by call ID. | Execution and paired delivery demonstrated for this command. |
| Deny | Exact fixture denial reason; no PostToolUse. | Actual pre-execution denial, not merely a generated decision. |
| Rewrite | Original marker changed to rewritten stdout; PostToolUse command was rewritten. | Updated input reached execution and the post event. |
| Unsupported ask | Actual policy refusal; no PostToolUse. | Unsupported ask did not become permission to execute. |
| Controlled throw | Actual failure block; no PostToolUse. | Controlled fixture exception exercised the live failure path. |
| Pre context | Random nonce appeared directly in a developer message before the parent read the token log. | Direct injected-context receipt, not inference from a log. |
| Post context | Random nonce appeared directly in a developer message before the parent read the token log. | Direct injected-context receipt, not inference from a log. |
| Post block | Tool error exposed feedback but hid stdout. After matched-only response capture was added, the rerun recorded completed stdout plus block feedback. | PostToolUse blocking did not roll back the completed command. Initial feedback alone was insufficient proof of execution. |

An unmatched `printf` still worked, supporting noninterference for that ordinary command only.

## Actual Subagents

Two actual child agents were observed:

- `01a0821f-c7b8-7a50-b918-71fe36b26196`
- `01a08222-1326-7813-8b6d-cb39e8b4a8fa`

Each reported its own secret child token before the parent read the token log. The second reported exactly one token, distinct from the first child's token. Recorded SubagentStart, child UserPromptSubmit, PreToolUse, PostToolUse, and SubagentStop events carried matching child IDs. This supports delivery and child-context isolation for these two runs; it is not exhaustive isolation testing.

The explicitly armed, resumed child `01a0821f-c7b8-7a50-b918-71fe36b26196` in root session `019e5738-0e00-7d12-a62e-605a2f22f09b` passed the one-shot SubagentStop continuation probe. Logs show resumed UserPromptSubmit, then SubagentStop with `priorInterventions=0` and older `priorRuns=1`, actual continuation-command execution with toolResponse `clooks-live-child-continuation-20260908\n`, and the next SubagentStop with `priorInterventions=1` and `priorRuns=2`. No UserPromptSubmit occurred between those last two stops. Exactly one consume was recorded and state reached `remaining=0`; the subsequent stop skipped.

This proves continuation in the same child and session with preserved hook history. Native turn ID was not included in observer data, so the probe does not independently prove equality of native turn IDs. The persisted one-shot counter, not history alone, bounded the intervention.

## PermissionRequest

Three live exact commands requested `sandbox_permissions=require_escalated`:

```sh
printf '%s\n' 'clooks-live-permission-skip-20260908'
printf '%s\n' 'clooks-live-permission-allow-20260908'
printf '%s\n' 'clooks-live-permission-deny-20260908'
```

Skip and allow both produced stdout with PreToolUse, PermissionRequest, and PostToolUse observations. Skip delegates to the normal approval policy; its successful execution in this run is not a general approval guarantee.

Deny produced a native rejected-process error with reason `CLOOKS_LIVE_PERMISSION_DENY_20260908: harmless escalation denied.` and PreToolUse/PermissionRequest observations but no PostToolUse. Current logs provide exact-command attribution. PermissionRequest natively has no `toolUseId`, so these results must not be described as PermissionRequest call-ID joins.

## Validation and Sequencing Friction

The parent reports three Docker fixture typechecks, each exiting zero. These are fixture typechecks, not a complete regression or end-to-end suite.

An active multi-file fixture hot edit briefly left the hook importing the removed `claimChildStop` export, blocking a tool call. The worker's remaining import update resolved the window; the parent's attempted recovery patch made no change because the import was already removed. Record this as test-sequencing friction, not a demonstrated production defect. Future fixture revisions should avoid exposing partially applied multi-file changes to the active loader.

The first post-block observation hid stdout in the tool wrapper. That limitation led to the stronger, matched-only PostToolUse response oracle and the successful rerun recorded above.

## Cleanup

Parent reports cleanup exited zero and `cmp .clooks/clooks.yml tmp/clooks-live-dogfood/clooks.yml.before` returned zero, establishing byte-exact restoration of the configuration. The arm state was archived to a uniquely named completed file. Evidence was retained; this delegate did not execute cleanup or inspect token contents.

## Review Closure

The parent reports both live-phase code closure GO and QA closure GO. Reviewers independently verified the logs and qualified the scope, with no contradictions reported. This is review-closure evidence supplied by the parent, not independent log inspection by this documentation delegate. It closes review of the bounded live phase, not broader conformance. The separate compaction probe subsequently received its own code closure GO and QA closure GO, and parent testing closure is complete.

## Separate Follow-up Probes

The owned fake-vendor compatibility probe confirmed a hook-specific gap: `no-edit-protected.ts` checks only Write/Edit/MultiEdit and skips native apply_patch. The actual patch added `tmp/clooks-tool-compat/vendor/probe.txt`, matching the configured `**/vendor/**` rule; reading verified its harmless content, and deleting that exact owned file succeeded with absence subsequently confirmed. See [probe note](../../tmp/clooks-tool-compat/NOTE.md) and [finding](../findings/code-quality.md#protected-path-hook-assumes-claude-file-tools). The note alone does not establish hook loading; source inspection establishes the tool-name mismatch. No actual vendor/source file was touched and no hook fix is authorized.

Compaction attempt 1 failed before native execution with `env: 'node': No such file or directory` (exit 127): the wrapper dropped the Docker fallback PATH. One worker correction added `/usr/local/bun-node-fallback-bin` to the container compile environment. This failed attempt is retained as sequencing evidence, not a permanent finding or native compaction result.

Parent reports attempt 2 passed at `tmp/clooks-compaction-probe/attempt-2`: 1 test, 0 failures, 8.72 seconds; native exit 0, no signal or timeout, and `reaped=true`. Exactly two model requests were recorded. Raw events and configured handler observations show PreCompact followed by PostCompact with trigger `auto` and the same raw turn ID. The actual summary appeared in user-message content in the second request, followed by final stdout. Raw SessionStart startup/source-compact, UserPromptSubmit and Stop were also captured, but only the two compaction handlers were configured; those raw events are not additional Clooks handler coverage.

This was forced zero-threshold local compaction in a NEW session using a synthetic loopback model in offline Docker, not compaction of the real conversation, rich-history testing or block-variant coverage. Both attempts cleaned up with exit 0; the parent-filtered container listing was empty. Final compaction code closure GO and QA closure GO are confirmed separately from the interactive live-phase approvals.

## Combined Native Invocation Matrix

Final parent closure: compaction code and QA reviewers independently verified actual requests, raw hook events and the configured handler pair. Native, test and runner exits were all zero; cleanup exited zero for both attempts. The second request carried the summary specifically in user-message content, not metadata. Native warnings exist; success is not a warning-free claim. Both compaction closure GOs are received, parent testing is complete, and no review gate or further experiment remains for this task. Coverage limitations below remain limitations, not pending work in this closed task.

Sources: **Earlier native suite** = historical Plan E six-case native smoke in synthetic-model, network-disabled Docker with explicit trust/sandbox bypass; **Interactive** = authorized probes in the existing configured session; **Compaction probe** = disposable forced-compaction attempt 2 in offline Docker. All ten target events now have some native invocation evidence across these sources, not all variants, all tools or full release conformance. The historical Plan E snapshot is unchanged.

| Event | Source | Bounded evidence |
| --- | --- | --- |
| SessionStart | Earlier native suite | Generated handler invocation and measured context; the compaction probe additionally captured raw startup/source-compact events only. |
| UserPromptSubmit | Earlier native suite, Interactive | Root handler/context in the earlier native suite; child prompts with matching identity in the interactive probes. The compaction probe adds raw capture only. |
| PreToolUse | Earlier native suite, Interactive | Shell allow/deny/rewrite/refusal/context; controlled throw in the interactive probes. |
| PostToolUse | Earlier native suite, Interactive | Paired shell delivery/context; completed stdout plus post-block feedback in the interactive probes. |
| PermissionRequest | Interactive | Exact-command allow/deny/default skip; no native tool-use ID. |
| SubagentStart | Interactive | Two actual children reported distinct injected tokens before parent token-log inspection. |
| SubagentStop | Interactive | One targeted continuation, then skip; same child/session and preserved hook history, not observed native turn-ID equality. |
| Stop | Earlier native suite | Ordinary handler and one same-turn continuation/history-skip. The compaction probe adds raw capture only. |
| PreCompact | Compaction probe | Raw and handler invocation, auto trigger, ordered before PostCompact. |
| PostCompact | Compaction probe | Raw and handler invocation sharing raw turn ID; summary in user-message content in request two and final stdout. |

## Remaining Coverage

- Real-conversation/rich-history compaction and block variants were not tested; these are remaining coverage limits, not pending review gates.
- Root SessionStart, root UserPromptSubmit, and root Stop: not newly tested under this fixture, which was installed mid-turn. Child UserPromptSubmit does not substitute for root coverage.
- Living domain, findings, index, and epic updates summarize only the proven capabilities; historical Plan E case results remain unchanged.

Remaining gaps include failure/result variants, patch/MCP mutation, file-handoff readability, layered activation, root reset and broader trust/approval modes, plus the confirmed no-edit-protected/apply_patch hook compatibility gap. Some invocation evidence for every target event does not close these gaps.
