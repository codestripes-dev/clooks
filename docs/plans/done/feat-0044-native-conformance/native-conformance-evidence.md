# Native Conformance Evidence

M0 attempt 1 passed on 2026-09-08. This records actual Codex execution with a synthetic local model, not upstream Rust tests (`P`) or a hosted-model run. Franklin code/runtime-evidence GO and Dirac separate QA GO are parent-reported review results; Dirac confirmed that missing call IDs cannot falsely pass and the server does not fabricate tool results. No tests were added or rerun for this documentation closure.

## M0 Provenance and Commands

Clooks source HEAD: `de95c33d009e41ab93da3d7f377522ce8333fda2`. Parent confirms the actual source revision is known and unchanged since that commit. The parent-supplied **post-run audit**, not a capture made at run time, found the tracked diff for source/schema/tsconfig/lock empty. Its tracked `src` content-manifest fingerprint was:

    d654f34ecef67bb7ba06a158f6f9aadae4b5f3c621f5f530fde39fef262d9d44

Historical audit command:

    git ls-files -z src | xargs -0 sha256sum | sha256sum

This post-run fingerprint covers tracked `src` content only; it is not a before/after execution manifest or immutable-export proof. No audit command was rerun for this documentation update.

Real `codex-cli 0.153.4`; `/native/bin/codex` SHA-256:

    56ef98ab4032d317ab26e9b5e5a175650717351edb16ed9cde0cb6d1734d62da

The installed `@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl` distribution was mounted read-only at `/native`. The hash identifies retained bytes; it does not establish release-signing provenance. Version came from the separate successful Docker preflight; the attempt checked the hash.

Image: `sha256:fd92e10d305a6a901671923091cca035a2aa2592f25beb5117290b9e30b5cd5f`.
Docker used `--network none`; the synthetic Responses server ran on container loopback. No real home, auth or trust state was mounted. Fresh synthetic homes/projects used explicit project-path trust, approval policy `never`, hook-trust bypass and danger-full-access.

Historical parent orchestration from `/opt/development/clooks`:

    bash /opt/development/clooks/tmp/codex-native-m0/run.sh

Inside each fresh project, with the captured synthetic environment:

    /app/dist/clooks init --agent codex --json
    /native/bin/codex exec --skip-git-repo-check --dangerously-bypass-hook-trust --json --sandbox danger-full-access 'Run the scripted command once, then finish.'

Generated registration commands were unchanged. Deadlines were outer 300s, test 180s, each native case 60s. Parent Docker source/typecheck/compile through the entrypoint passed. This is a historical command record, not a request to rerun.

## M0 Observed Results

- `attempt.log`: 1 test passed, 0 failed, 41 assertions, 13.93s; `rc` 0 and `cleanup.rc` 0.
- Baseline `observed.json`: `marker: "native"`; actual raw payloads and handlers for SessionStart, UserPromptSubmit, PreToolUse, PostToolUse and Stop. The next actual request contains the successful tool result for `native_m0_call`.
- Deny `observed.json`: `marker: null`; no raw or handler PostToolUse for `native_m0_call`. Actual request 2 contains matching `function_call_output` with this exact output:

    Command blocked by PreToolUse hook: native-m0-denial-sentinel. Command: printf native > marker

- Both native processes exited 0 without timeout. The paired baseline supplies the positive execution control; the denial oracle uses the actual request, not the fixture assistant's final text.

## M0 Limitations

Export sealing failed because exported files were container-owned. Raw captures remain readable and cleanup succeeded, but no immutable-export claim is made. Fallback model-metadata and temporary PATH-alias warnings are retained in each `native.result.json`; they did not block the measured proof. Do not infer normal trust/approvals, default sandbox behavior, exactly-once delivery or full-release conformance.

PermissionRequest, PreCompact, PostCompact, SubagentStart and SubagentStop remain natively unverified. The subsequent M1 result below verifies shell rewrite, unsupported-ask refusal, specific context arms and one Stop continuation/history-skip. Other codecs, failure variants, layered activation and recipient readability remain unresolved. Handoff stays inline. Historical docs-shaped fixtures remain historical and were not overwritten. Subsequent Hegel specification GO and parent M1 GO authorize only the six mandatory cases; they add no native execution evidence.

## Artifact Links

- [Exact Docker invocation](../../../../tmp/codex-native-m0/attempts/1/command.sh), [frozen runner](../../../../tmp/codex-native-m0/attempts/1/runner.sh), [harness hashes](../../../../tmp/codex-native-m0/attempts/1/harness.sha256), [binary pin](../../../../tmp/codex-native-m0/attempts/1/export/pin.json).
- [Attempt log](../../../../tmp/codex-native-m0/attempts/1/attempt.log), [exit status](../../../../tmp/codex-native-m0/attempts/1/rc), [cleanup status](../../../../tmp/codex-native-m0/attempts/1/cleanup.rc), [sealing failures](../../../../tmp/codex-native-m0/attempts/1/seal.log).
- Baseline: [observations](../../../../tmp/codex-native-m0/attempts/1/export/baseline/observed.json), [native command/environment](../../../../tmp/codex-native-m0/attempts/1/export/baseline/native.command.json), [config](../../../../tmp/codex-native-m0/attempts/1/export/baseline/config.toml), [native result/warnings](../../../../tmp/codex-native-m0/attempts/1/export/baseline/native.result.json).
- Deny: [observations](../../../../tmp/codex-native-m0/attempts/1/export/deny/observed.json), [actual request 2](../../../../tmp/codex-native-m0/attempts/1/export/deny/request-2.json), [native result/warnings](../../../../tmp/codex-native-m0/attempts/1/export/deny/native.result.json).
- [Generated hooks](../../../../tmp/codex-native-m0/attempts/1/export/baseline/generated-hooks.json), [generated entrypoint](../../../../tmp/codex-native-m0/attempts/1/export/baseline/generated-entrypoint.sh), [raw baseline payloads](../../../../tmp/codex-native-m0/attempts/1/export/baseline/payloads/), [baseline handlers](../../../../tmp/codex-native-m0/attempts/1/export/baseline/handlers.jsonl), [raw deny payloads](../../../../tmp/codex-native-m0/attempts/1/export/deny/payloads/), [deny handlers](../../../../tmp/codex-native-m0/attempts/1/export/deny/handlers.jsonl).

## M1 Final Execution

[Native attempt 1](../../../../tmp/codex-native-m1/smoke-d7UBQ3EW/): all six cases passed, 1 test/0 failures/39.04s, 6 native launches, native attempt count 1. [Final helpers](../../../../tmp/codex-native-m1/unit-W6j6IhwL/attempt.log): 17/0, 182 assertions, 834ms; typecheck/build passed, zero native launches. Bun 1.3.10. Banach CODE/native-evidence and Raman QA/native-evidence GO are parent-reported; both verified all cases, matching unit/smoke hashes and all statuses 0. Parent closure GO received; parent label-filtered container audit was empty, rc 0.

M1 [revision](../../../../tmp/codex-native-m1/smoke-d7UBQ3EW/revision) is `de95c33d009e41ab93da3d7f377522ce8333fda2`; [image](../../../../tmp/codex-native-m1/smoke-d7UBQ3EW/image-id) and [binary pin](../../../../tmp/codex-native-m1/smoke-d7UBQ3EW/export/pin.json) match M0 above. The attempt records [source manifest](../../../../tmp/codex-native-m1/smoke-d7UBQ3EW/source.sha256), [tracked diff](../../../../tmp/codex-native-m1/smoke-d7UBQ3EW/tracked-source.diff), [artifact hashes](../../../../tmp/codex-native-m1/smoke-d7UBQ3EW/artifacts.sha256) and [hash check](../../../../tmp/codex-native-m1/smoke-d7UBQ3EW/hash-check.log). Parent confirms production src/schema/bun.lock unchanged; new harness/package/scripts are included in the frozen input, not attributed to the committed revision alone.

[Exact Docker command](../../../../tmp/codex-native-m1/smoke-d7UBQ3EW/command.sh) uses read-only frozen inputs and `/native`, writable synthetic `/export`, network none and 300s outer timeout. Per-case native commands retain the M0 flags and 60s deadline, synthetic homes/project trust, approval never and no auth. [Baseline invocation](../../../../tmp/codex-native-m1/smoke-d7UBQ3EW/export/M1-BASE/native.command.json) also records a decoy inherited project root; generated init commands select the actual project. Fallback metadata warnings remain in raw native results.

[Completion](../../../../tmp/codex-native-m1/smoke-d7UBQ3EW/export/passed.json) lists M1-BASE/DENY/REWRITE/ASK/CONTEXT/STOP. [Attempt log](../../../../tmp/codex-native-m1/smoke-d7UBQ3EW/attempt.log) records container test/completion/export chmod 0; setup, runner, Docker, cleanup, native-launch scan, seal, export-permission, hash, status-write and final status files are all 0. Export permission sealing succeeded in M1; logs/status remain writable, so this is still not immutable storage.

Case details and raw links are in the [matrix](native-execution-matrix.md). Baseline marker is `native`; deny leaves it absent with exact `Command blocked by PreToolUse hook: m1-denied. Command: printf native > marker` feedback. Rewrite leaves original marker absent, creates `rewritten-marker` containing `rewritten` and returns `rewritten-result`. Ask produces actual unsupported-result-arm refusal and no marker. All use call ID `native_m1_call`; denial/ask have no denied-call PostToolUse.

Context tokens `m1ctx-start-71`, `m1ctx-prompt-82`, `m1ctx-pre-93`, `m1ctx-post-64` appear in attributed actual request text. PreToolUse uses ALLOW; SessionStart/UserPromptSubmit/PostToolUse use SKIP. No PreToolUse skip-context claim. Stop has one reminder, same-turn continuation without UserPromptSubmit, hook-visible history 0 then 1 and skip; its three requests are distinct from the other cases' two. Structured text oracles exclude metadata, function arguments and scripted assistant text.

Parent-reported final Docker formatting (five TypeScript files/package) and shell syntax passed. Ordinary E2E passed 798/0, 9,358 assertions, 124.00s, rc 0 using frozen `unit-zYmqo213/input` read-only src/test/schemas/tsconfig/bunfig and the existing image; production/E2E source unchanged.

## Historical M1 Preparation

Helper `unit-zYmqo213` passed 10/0, 51 assertions before QA hardening. `unit-QCFERToS` typecheck exited 2 because the public PreToolUse `ctx.skip()` helper accepts only DebugMessage (raw skip-context results are accepted by Codex policy, but native consumption was not tested); correction to allow-context passed final validation. Both launched zero native processes and consumed no native attempt. The first ordinary E2E run used network none in error: 797/1, 122.17s, rc 1 at the real GitHub add-pack case. Normal-network rerun passed above; this was runner configuration, not a regression. Native smoke remains network none. No stale active finding follows from either corrected preparation failure.

## Reuse and Limits

Existing local `clooks-e2e` image is required; the runner neither builds nor pulls it. Helpers: `bash scripts/test-codex-native.sh --unit`. Smoke: `CLOOKS_CODEX_DIST=/absolute/path/to/x86_64-unknown-linux-musl bun run test:codex-native` (or `bash scripts/test-codex-native.sh --smoke` with the same variable). It requires the retained executable `bin/codex`; no implicit home search or credential copy. Default tests are unchanged. PermissionRequest, PreCompact, PostCompact, SubagentStart/SubagentStop and other listed options remain unverified/unattempted. No normal trust/approvals, recipient readability, upstream Rust-test or full-release proof; handoff stays inline.
