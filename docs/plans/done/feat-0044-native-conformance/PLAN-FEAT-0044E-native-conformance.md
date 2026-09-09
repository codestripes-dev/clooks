# Verify Native Codex Invocation and Consumption


This ExecPlan is a living document maintained according to `docs/plans/PLANS.md`. Keep Product Context, Progress, Surprises & Discoveries, Decision Log, Outcomes & Retrospective and Related Domain Knowledge Documents current. Editor: delegated Codex editor under Joe-Degler's parent coordination (handle established in the epic; this editor's `gh api user --jq '.login'` could not connect, so no fresh identity verification is claimed).

**Status:** M0 and scoped M1 complete. All six mandatory native cases passed in attempt 1; helper/static/ordinary E2E gates passed. Banach CODE/native-evidence GO, Raman QA/native-evidence GO and parent closure GO received. Both reviewers verified matching unit/smoke hashes and all statuses 0. Archived in `docs/plans/done/feat-0044-native-conformance/`. Remaining capabilities are unverified/unattempted; no full-ten-event or release-conformance claim.

**Originating Feature:** `docs/planned/FEAT-0044-cross-agent-hooks.md`.

**Coordinating Epic:** `docs/epics/EPIC-0044-cross-agent-hook-portability.md`.

## Instruction Prompts


Newest parent user prompt, recorded before fleshing out this plan:

> Continue.

## Purpose / Big Picture


Demonstrate that actual Codex invokes generated Clooks registration, supplies native event input, and consumes the resulting decision or context. A developer should be able to opt into a disposable Docker smoke that shows a harmless native tool call succeeding in a baseline and being prevented by a Clooks denial, with captures explaining both outcomes. A deterministic local server supplies model responses; it does not replace the native hook parser or executor.

Start with bounded feasibility, then retain only demonstrated cases in a separate smoke harness. Publish exactly which workflows can execute, which failed and which remain unresolved. Source inspection and Clooks replay already exist; repeating them does not meet this purpose.

## Product Context


**Problem:** Portable custom/vendored hooks need native invocation and consumption evidence before native enforcement is advertised. Plan D is complete: final local units 2,192/0, compiled Docker E2E 787/0 and static checks passed. Those results do not establish native behavior. The two upstream Rust attempts executed zero tests and are permanently exhausted under the current authorization.

**Metrics:** Reproducible native case coverage, observable decision effects and accurate support claims, not additional local test counts alone.

**Feature alignment:** FEAT-0044 describes common custom/vendored-hook configuration across agents. The epic and user explicitly select Codex first despite the feature's older Cursor examples; this is the agreed specialization, not new feature drift. Do not edit the feature or broaden other-agent scope. Claude plugin distribution stays Claude-only; README/distribution work belongs to Plan F.

Scope remains exactly SessionStart, SubagentStart, PreToolUse, PermissionRequest, PostToolUse, PreCompact, PostCompact, UserPromptSubmit, SubagentStop and Stop. SessionEnd/Interrupt, new public methods, `clooks test --agent`, trust redesign, Claude quoting fixes and deployment are outside this plan. Review history ambiguity is accepted and nonblocking; preserve ordinary best-effort history with no special workaround. Clooks assumes a trusted repository and retains merged home/project/local behavior. Keep all Codex handoff inline; recipient readability is optional research, not an M0/M1 completion prerequisite or authority to enable file delivery.

## Progress


- [x] (2026-09-08, final epic consistency correction) Narrow current Open Questions to measured Bash rewrite, unsupported-ask refusal and one Stop continuation/history 0 to 1; retain unverified permission/failure/root-reset/subagent capabilities and preserve historical milestone prose.
- [x] (2026-09-08, final documentation correction) Distinguish the public PreToolUse `ctx.skip()` helper's DebugMessage-only parameter from raw `PreToolUseResult` skip-context and Codex policy acceptance. Native skip-context consumption was not tested; narrow testing/matrix/evidence wording accordingly.
- [x] (2026-09-08) Recorded actual user prompt `Continue.`, scope decisions and ATTENTION; Hegel SPEC GO, parent M0 CLOSURE GO and parent M1 IMPLEMENTATION GO received before worker edits.
- [x] (2026-09-08) M0 baseline/denial complete with Franklin code/runtime-evidence and Dirac QA GO. Historical results/provenance and failed sealing remain in evidence; fixtures unchanged.
- [x] (2026-09-08) Hilbert implemented the six-case durable harness, structured text oracles, normal/mutant branch tests and truthful exits. PreToolUse context uses allow; SessionStart/UserPromptSubmit/PostToolUse context uses skip.
- [x] (2026-09-08) Final helper `unit-W6j6IhwL`: 17/0, 182 assertions, 834ms, typecheck/build and final statuses 0, no native launches. Final Docker format/package and shell syntax passed; ordinary E2E passed 798/0. Historical intermediate failures remain in evidence only.
- [x] (2026-09-08) Native `smoke-d7UBQ3EW`: all six mandatory cases passed, 1 test/0 failures/39.04s; 6 launches, 1 native attempt, final rc 0. One of two authorized native attempts consumed; no optional experiments performed.
- [x] (2026-09-08, parent report) Banach CODE/native-evidence GO, Raman QA/native-evidence GO and parent M1 closure GO received. Reviewers independently verified all six cases, matching unit/smoke hashes and all statuses 0. Parent label-filtered Docker container audit was empty, rc 0.
- [x] (2026-09-08) Final evidence/matrix/domain/epic/readiness/index closure; archived only this folder to `docs/plans/done/feat-0044-native-conformance/` and repaired links. Ignored documentation requires explicit force-add when committing; no staging/commit performed. Production src/schema/bun.lock unchanged.

## Surprises & Discoveries


Parent supplied an installed 0.153.4 binary location, expected digest and retained exact-source examples. The separate Docker metadata preflight reported exit 0/version 0.153.4; attempt 1 verified the expected binary hash and subsequently established the narrow native behavior in `native-conformance-evidence.md`. Parent-reported preflight and directly inspected attempt artifacts are distinguished there.

Observed baseline handler sequence is SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop; denial has no PostToolUse for `native_m0_call`. Raw payload directory iteration is unsorted and cannot establish event order. Both native cases exited 0 without timeout, under synthetic path trust, hook-trust bypass, approval_policy never and danger-full-access (`permission_mode: bypassPermissions`). No normal approval/sandbox result follows. Artifact caveats and literal warnings live in the evidence document; they do not invalidate this narrow result or require a rerun.

The retained `codex-rs/exec/tests/suite/hooks.rs` uses actual exec through `test.cmd_with_server`, `--skip-git-repo-check` and `--dangerously-bypass-hook-trust`, asserting a SessionStart marker. Reading it is S (source inspection), not an executed Rust test. `core/tests/suite/hooks.rs::non_openai_model_provider` sets a local base URL and disables WebSockets but clones a provider; that helper alone is not proof of no-auth configuration. The parent supplied official no-auth documentation, independently checked during drafting.

Earlier this editor incorrectly treated delegated editing as a requirement to delegate recursively. The user clarified direct apply_patch ownership; the skeleton is now persisted and M0 authorization was recorded before subsequent work. No execution evidence was fabricated during that correction.

## Decision Log


Decision: M1-CONTEXT uses `ctx.allow({injectContext})` for PreToolUse because the public `ctx.skip()` helper accepts only DebugMessage. Raw `PreToolUseResult` includes `SkipResult & InjectContext`, and Codex policy accepts it; native skip-context consumption was not tested. Baseline skip behavior remains unchanged. Rationale: typecheck caught the fixture's helper-parameter mismatch before native execution in `unit-QCFERToS` (rc 2, zero native launches). This fixture correction stays within M1 and consumes no native attempt. Date/Author: 2026-09-08, parent-reported correction clarified at final documentation review.

Decision: Parent owns feasibility research and execution; this delegated editor owns plan/epic edits directly. Initial draft-only scope is superseded solely for authorized M0 scratch work: Heisenberg writes `tmp/codex-native-m0/`, parent runs bounded baseline/deny attempts. No durable harness or production work before specification reviews and subsequent GO. Date/Author: 2026-09-08, delegated editor under parent direction.

Decision: Use the existing pinned native binary with a local Responses server and no credentials; no new source acquisition, Rust installation, Cargo execution or lock changes. Rationale: the prior routes are exhausted and retained assets offer a distinct native CLI route. Date/Author: 2026-09-08, parent direction, recorded by delegated editor.

Decision: M0 covers baseline SessionStart, UserPromptSubmit, PreToolUse, PostToolUse and Stop, then native PreToolUse denial in an isolated equivalent case. Require exact denial feedback, absent sentinel and no PostToolUse for the denied call ID. Context-token delivery, rewrite and other branches belong to M1. Rationale: align with the parent's bounded scratch assignment; the initial four-event/context draft added requirements outside that assignment. Date/Author: 2026-09-08, parent direction, recorded by delegated editor.

Decision: Evidence is native CLI with synthetic model and explicit trust bypass. Rationale: real Codex executes, but fixture-generated assistant text is not an observation oracle, normal hook review is bypassed, and no hosted model or Rust test is exercised. Preserve P as absent. Date/Author: 2026-09-08, delegated editor.

Decision: Separate Plan E folder and opt-in smoke; no default native/auth-dependent tests. Rationale: independent archival and honest portability prerequisites. ATTENTION covers fixture execution and trust-bypass claims, not a new approval workflow. Date/Author: 2026-09-08, delegated editor.

Decision: M1 requires the explicit mandatory minimum below; missing any required native case leaves M1 partial, even if optional feasibility dispositions are complete. Rationale: resolve Hegel's full-spec HOLD without turning every candidate into an assumed CLI capability or inventing a coverage percentage. Date/Author: 2026-09-08, parent direction, recorded by delegated editor.

## Outcomes & Retrospective


M0 and scoped M1 are complete with independent code/QA native-evidence GO and parent closure GO. The durable smoke establishes generated baseline invocation, shell denial, command rewrite with actual A/B effects, unsupported-ask refusal, event-attributed context delivery and one Stop continuation with history-skip under the pinned synthetic-model/bypass boundary. Helper, static and ordinary E2E gates passed; production and historical fixtures are unchanged. Remaining capabilities are explicit in `native-execution-matrix.md`. Detailed run history and provenance stay in evidence; no broader native or release claim follows.

## Context and Orientation


Clooks is a Bun/TypeScript CLI. `src/commands/init.ts`, `src/agents/codex/settings.ts` and `src/commands/init-entrypoint.ts` generate one command registration per target event. That command selects `CLOOKS_AGENT=codex` and a project root, then launches compiled Clooks. `src/agents/codex/{adapter,normalize,policy,translate,tool-codecs}.ts` normalizes the native JSON, validates supported results and emits native output. `src/engine/run.ts` and `execute.ts` own config loading, matching, execution and reduction. Test actual generated commands; do not substitute a handwritten launcher, parser mirror or PATH stub.

The baseline local suites are `src/agents/codex/*.test.ts`, `test/e2e/codex-runtime.e2e.test.ts`, `codex-events.e2e.test.ts` and `codex-state-delivery.e2e.test.ts`. `test/Dockerfile` installs dependencies in Docker; `test/docker-entrypoint.sh` typechecks, compiles and runs explicit test paths. Use those patterns without modifying production behavior to make a probe pass.

U means unit tests of Clooks/harness helpers; D means compiled Clooks Docker replay; S means pinned upstream source inspection; P means separately executed upstream tests/parser harness; L means actual native CLI execution. Plan E records L with the qualifiers synthetic model, isolated container and hook-trust bypass for every relevant case. A successful native run necessarily uses upstream consumers, but does not retroactively pass the unrun P suite. Native transport into a captured model request proves that text was supplied to that request, not model comprehension or recipient file access.

Prior references remain in place: `docs/plans/done/feat-0044-codex-runtime/PLAN-FEAT-0044D-codex-runtime-capability-policy.md` and `docs/plans/feat-0044-cross-agent-portability/codex-runtime-acceptance-matrix.md`. Preserve its E01-E10, F01-F09, C01-C14 and N01-N07 IDs when cross-referencing evidence; do not rewrite historical coverage.

## Related Domain Knowledge Documents


Consulted `docs/domain/testing.md`: M0 closure adds native CLI/synthetic-model provenance and bounded result; M1 adds opt-in command, required assets, exact execution boundary, harness tests and matrix interpretation. Preserve local U/D versus S/P/L distinctions.

Consulted `docs/domain/cross-agent-hooks.md`: M0/M1 closure updates only measured native activation/consumption and remaining limitations, with version, synthetic model and bypass qualifiers. Do not claim normal project trust, all-event triggerability, recipient readability or release readiness. These updates follow implementation/evidence and are required in the same milestone, not deferred to Plan F. No domain edits occur merely to predict a successful spike.

## Related Findings


Read `docs/findings/index.md`, all six category files, `codex-portability-readiness.md` and `config-validation-deadlock.md`. Native conformance/readability motivates this plan; remove only proven resolved portions of readiness, retaining optional unreadable-recipient and unrelated Claude quoting limits. Historical credential failures are not an instruction to copy auth or request credentials again. Exhausted acquisition/Rust retry findings remain final.

Tooling findings require typecheck before compile, frozen lockfile/ignore-scripts for any Docker dependency preparation, unchanged wrapper bytes during runs and truthful coverage reporting. Existing 95% coverage shortfalls are separate scope; never lower thresholds or relabel a failed gate. Permission-failure tests must use a non-root container and an actually unwritable parent, not a directory repaired by the runtime. General new-event harness, stale event counts, marketplace types and config-deadlock findings do not authorize unrelated repairs. Preserve the process-feedback requirement to trace both unit and compiled behavior when any shared path later changes.

## Plan of Work


### M0: Bounded Native Binary and Local Server Proof


Heisenberg owns only `tmp/codex-native-m0/`; parent owns feasibility research, run serialization and execution. This editor owns this folder and the epic's current Plan E status/link. The scratch writer records exact runner and invocation commands before the parent launches them. Do not edit an active wrapper or mounted source. Use generated project init plus existing `CLOOKS_DEBUG` payload capture, without inserting a wrapper around the generated command. All writes from init, compilation and native tools stay in disposable container storage.

Pin the installed package reported by the parent at `/home/joedegler/.asdf/installs/nodejs/24.15.0/lib/node_modules/@openai/codex/package.json`, version `0.153.4`. Mount its specific distribution directory `/home/joedegler/.asdf/installs/nodejs/24.15.0/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl` read-only at `/native`, preserving that distribution's sibling binaries. Execute `/native/bin/codex`, expected SHA-256 `56ef98ab4032d317ab26e9b5e5a175650717351edb16ed9cde0cb6d1734d62da`. No shim, host execution, package acquisition or silent binary substitution is permitted. Verify the hash inside every attempt before native cases; the separate Docker `--version` preflight already reported exit 0/version 0.153.4. Record both forms of provenance without requiring a new version subprocess in each attempt. A hash mismatch stops before native cases; the supplied hash identifies retained bytes, not independently established release-signing provenance.

The executed runner used a pinned existing Docker image with `--network none`, no published ports and no Docker socket inside it. Its fixture HTTP server bound only to container `127.0.0.1`. Vendor and repo/script inputs were read-only; the only writable host bind was the owned attempt export at `/export` for synthetic captures, never a host home. Compilation, HOME, CODEX_HOME, CLOOKS_HOME_ROOT and projects were disposable. Root setup created a container-only clooks symlink before switching to non-root testuser. Native children received an explicit credential-free environment allowlist. M1 must preserve that boundary and handle export ownership/status explicitly; the original plan's container-local-only capture wording is superseded by this recorded actual interface. No real auth/config/trust copies or host install/build/test/deploy occurred.

The successful synthetic config selected a custom provider with local `base_url`, `wire_api = "responses"`, `requires_openai_auth = false`, no `env_key`, WebSockets disabled and request/stream retries zero. All four captured POST requests lack Authorization. Official no-auth behavior is documented at https://learn.chatgpt.com/docs/auth#alternative-model-providers; actual config and request evidence are now recorded separately in this folder. This establishes the exercised local route only.

Use retained source under `tmp/codex-runtime-m0/output/exact-tag/source/`, pinned by Plan D to commit `3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`. `codex-rs/exec/tests/suite/hooks.rs` supplies the exec/trust-bypass precedent. `codex-rs/core/tests/common/responses.rs:717-801` supplies server-sent event framing, response.created, assistant output_item.done and response.completed usage fields; its ev_function_call near line 933 supplies function-call items. `core/tests/suite/hooks.rs` supplies request-log consumption assertions. Reuse those wire shapes in a small Bun HTTP fixture, not Rust code execution or a reimplementation of hook parsing.

Each complete attempt contains two fresh cases: baseline and denial. The server first emits one deterministic `exec_command` call that writes a case-local sentinel and returns a token, then returns a final assistant response after receiving the tool result. Real generated Clooks init registers all ten unchanged events, while fixture hooks exercise SessionStart, UserPromptSubmit, PreToolUse, PostToolUse and Stop. Baseline requires captures/handler markers for those five events, a created sentinel and the matching tool-call result in the next request. Stop proves ordinary event invocation here, not reminder continuation. Context-token injection/delivery is not part of this scratch acceptance and belongs to M1. A server-scripted final answer repeating a token is never the oracle.

The denial case changes only the PreToolUse fixture decision to a nonblank block, preserving the tool request. Require native payload capture, actual Clooks handler marker, absent sentinel, exact expected denied tool-result feedback in the following model request and no PostToolUse for that denied call ID. The scratch test asserted the unique reason substring and call-ID-keyed absence; independent inspection confirms the full literal feedback in the saved request. M1 must assert full literal denial feedback. Compare against the successful baseline; absent files or empty stdout alone cannot pass. The executed config explicitly trusted each disposable project, set approval_policy never and invoked `--dangerously-bypass-hook-trust --skip-git-repo-check --sandbox danger-full-access`. Captured permission_mode is bypassPermissions. This proves denial under those settings, not normal trust establishment, approval/sandbox behavior, review UX or universal interception.

Budget: at most two technical attempts total for this initial baseline/deny proof. One attempt is one frozen runner execution of the paired cases, not each native CLI subprocess. Parent's completed metadata-only preflight is recorded separately, not a hook attempt. First technical failure may receive one diagnosed correction and refrozen retry; compile/startup/server failures after launching the attempt count too. No automatic whole-run retry or per-event budget reset. The outer runner deadline is 300 seconds including compilation and cases, the test deadline is 180 seconds, and each native case is limited to 60 seconds. Use the bounded scratch server's finite baseline/deny response sequence; do not add further acceptance scenarios while it is underway. Kill/reap the whole owned process tree on timeout. After attempt two, stop and reassess, preserving both failures and unresolved cells; no credential demands, Rust fallback or third attempt under this GO.

M0 evidence is saved in `native-conformance-evidence.md`, linking the existing scratch captures. `native-execution-matrix.md` separates historical M0 capability proof, pending durable M1 validation and deferred unverified/unattempted capabilities. M1 source/artifact hash manifests and permission-sealing statuses are retained in the attempt directory; these are not immutable storage. Testing/cross-agent domains and readiness state the limited passed cases and remaining work; M1 measured capability updates are complete. Sealing failed because exports were container-owned; readable captures and cleanup success do not establish immutability. M1 authority comes from the separately recorded parent GO.

### M1: Durable Opt-In Smoke and Explicit Ten-Event Coverage


Hegel specification GO, completed M0 and parent GO now authorize Hilbert to promote the proven scratch helpers into `test/native-codex/fixture-server.ts`, `harness.ts`, `harness.test.ts` and `native-conformance.smoke.test.ts`; keep reusable hook fixtures under `test/fixtures/codex/native/`. Add `scripts/test-codex-native.sh` as Docker orchestration only and a separate `test:codex-native` package command. Parent owns Docker execution; delegated editor owns plan/epic/domain/findings and matrix. Do not change default `test` or `test:e2e` selection or add auth-dependent native tests to `src/`. Reuse Bun and the existing Docker compile/typecheck sequence. Source snapshot and required metadata/config remain read-only; outputs/homes stay disposable. No production fix is authorized by a native mismatch: record the defect, update plan/ATTENTION and seek separate scope GO.

The tables below separate passed M0 capabilities, six mandatory named M1 cases and deferred feasibility candidates. Each alternative has its own case ID, expected effect and evidence/status; passing M0 is not durable M1 validation. Parent GO authorizes these six cases:

| Mandatory M1 ID | Required native proof |
| --- | --- |
| M1-BASE (baseline) | Retain the five-event baseline in the durable runner; check actual native command success, marker and raw/handler events. |
| M1-DENY (deny) | Paired executable baseline, actual denial feedback exactly matched, absent marker, and raw-call-ID-keyed absence of denied PostToolUse; missing call IDs must fail. |
| M1-REWRITE | Actual shell request would write A; accepted Clooks rewrite writes B, with B present/A absent, original native payload and consumed command independently captured. |
| M1-ASK | Unsupported public ask reaches the Clooks policy and produces actual native refusal feedback with no tool effect, paired with the same executable baseline. A local diagnostic alone cannot pass. |
| M1-CONTEXT (four-event context) | Four independent event-specific unique context tokens from SessionStart, UserPromptSubmit, PreToolUse and PostToolUse must appear in the appropriate actual model requests. PreToolUse uses `ctx.allow({injectContext})`. The public PreToolUse `ctx.skip()` helper does not accept `injectContext`; native skip-context consumption was not tested. Never count tokens scripted into fixture assistant responses; assert event/call attribution. |
| M1-STOP | First Stop records one reminder/block; native continuation uses the same turn ID with no intervening UserPromptSubmit; second Stop sees that history and skips, ending after exactly one reminder. Verify native captures, resumed request and actual hook-visible history. |

M1 completion requires every mandatory native case plus the durable harness unit/smoke, export-ownership/status, documentation and review requirements. If any mandatory case cannot execute or fails, record M1 as partial/not complete; source inspection, optional-case dispositions or passing local units cannot substitute. Do not invent a coverage percentage or relax existing repo gates.

This pass authorizes at most two full native smoke attempts, with one diagnosed correction initially. Unit/static/compile fixes do not consume the native budget when no native process launched; the runner must truthfully record launches and consumed attempts, including partial failed smoke runs. Parent owns execution. No optional approval, subagent or compaction experiments are authorized this pass; mark them unresolved/unattempted. Global/project coexistence, other result variants, codecs, failure channels, root-reset and recipient-readability experiments are also deferred. There is no arbitrary candidate minimum. A completed mandatory set with honest unresolved dispositions can complete scoped M1, not full ten-event/native release conformance.

Statuses are per capability, result arm, tool codec and recipient, never event-level blanket passes. For example, shell denial passing cannot mark PreToolUse rewrite/MCP passed; SessionStart context passing cannot mark startup failure or normal trust passed. The table groups candidate work for readability; the durable ledger splits those capabilities into independent rows.

| Existing event / IDs | Candidate native trigger and independently observed consumption | Initial execution boundary |
| --- | --- | --- |
| SessionStart E01/N01/N05 | Generated registration invocation; unique skip+context token in first model request. Separate generated-failure case stops sampling with a positive baseline. | Invocation passed M0/M1; skip-context passed M1; failure unverified/unattempted. |
| UserPromptSubmit E08/N01/N05 | Prompt event; unique hook context in first request. Separate block/title-refusal cases reject prompt with no sampling after positive control. | Invocation passed M0/M1; skip-context passed M1; negative variants unverified/unattempted. |
| PreToolUse E03/N02/N03 | Shell baseline/deny, rewrite A to B, unsupported ask refusal and unique context delivery. Separate defer/patch/MCP cases need actual tool schemas/effects. | Baseline/deny passed M0/M1; shell rewrite, unsupported-ask refusal and allow-context passed M1; other codecs/variants unverified/unattempted. |
| PostToolUse E05/N05 | Completed tool result reaches follow-up; unique hook context. Separate block/output-rewrite-refusal yields feedback with completed sentinel intact. | Invocation/result passed M0/M1; skip-context passed M1; feedback variants unverified/unattempted, no rollback. |
| PermissionRequest E04/N04 | Native approval-requiring command under an explicit fixture-only approval policy, capturing the event. Compare actual allow/deny and reserved-field refusal, not waiting at an unanswered prompt. | Unresolved CLI trigger; bypass-hook-trust is not proof of approval behavior. No bypass-all-safety substitute. |
| PreCompact E06/N07 | Reach pinned native local compaction path with bounded synthetic usage/history; capture actual event and compare normal compact request versus block suppressing that request. | Unresolved; fabricated stdin/usage without actual compact dispatch is not proof. |
| PostCompact E07/N05 | Same actual compaction workflow must complete, then emit event/marker; verify continued work and observer/error distinction. | Unresolved with compaction prerequisite; no rollback or handler block claim. |
| Stop E10/N06 | Ordinary Stop; one reminder block, same-ID native continuation without prompt, then second Stop sees history/skips. Separate later ordinary root prompt reset. | Ordinary invocation passed M0/M1; one-continuation/history sequence passed M1; later root re-prompt/reset unverified/unattempted. |
| SubagentStart E02/N05 | Advertised native spawn tool starts a real child; capture child event/identity and context in that child's request, absent from parent/sibling requests. | Unresolved tool availability/routing. Do not synthesize child hook stdin. |
| SubagentStop E09/N06 | Complete that real child; block once and observe child-only continued request then skip with preserved history. | Unresolved, depends on actual child execution; no parent-continuation substitute. |

Cross-cutting M1 cases retain actual generated registration and `CLOOKS_PROJECT_ROOT` with a decoy root, and compare generated project/global coexistence only if native activation of both is demonstrable (N01/N07, C08/C09). Record invocation counts, never universal exactly-once delivery. Test source-backed failure channels in actual reachable native events, including local exit 2 versus supported JSON refusals; unsupported or unreachable cases remain separately stated. Model-request context, human systemMessage events and child delivery are distinct recipients. No file-readability claim from file existence, printed pointers or synthetic assistant replies; optional future recipient experiments leave inline mode unchanged.

M1 completion requires meaningful unit tests for server request sequencing, byte-correct event framing, unexpected requests, metadata mismatch, bounded timeout/reaping, missing captures and nonzero result propagation, plus all mandatory native cases with positive/negative controls. Deliberately missing hook markers or a mismatched call ID must make the harness fail. Fix durable export ownership by arranging the UID/GID or sealing inside the container; explicitly record export/sealing status independently of native test and cleanup status, and test failure propagation. Units test the fixture/oracle, never count as native proof. Run container-only focused units and opt-in native smoke on the same frozen bytes; run ordinary compiled Docker regressions for changed test infrastructure and all unit/E2E gates if a separately authorized change touches production. Record interface deviations and unresolved cells before completion, update domains in the same milestone, and obtain independent code/QA review. A missing mandatory case means partial M1, never a passing minimum.

## Concrete Steps


M0 execution is finished; `bash /opt/development/clooks/tmp/codex-native-m0/run.sh` was the parent runner, whose frozen invocation is retained under attempts/1. Do not run it again to prepare documentation. This editor performs read-only artifact checks and documentation edits; parent owns future authorized Docker execution.

Working directory for host orchestration is `/opt/development/clooks`. The writer supplies the exact M0 Docker invocation under `tmp/codex-native-m0/` before execution, including resolved image ID, read-only mount allowlist and 300-second outer timeout. Do not invent an already-existing runner filename or run a command with unresolved paths. The parent's separate successful version preflight command, with the supplied distribution path expanded, is:

    docker run --rm --network none --entrypoint /native/bin/codex -v /home/joedegler/.asdf/installs/nodejs/24.15.0/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl:/native:ro clooks-e2e --version

Parent reports `codex-cli 0.153.4`, exit 0. Record the resolved image ID alongside this tag-based historical command. Inside every attempt, before native cases, verify:

    sha256sum /native/bin/codex

Require the pinned digest above. Typecheck/compile Clooks inside the outer 300-second runner using `test/docker-entrypoint.sh`'s existing sequence, generate init in the disposable project, start the loopback fixture and invoke `/native/bin/codex` with synthetic project-path trust and hook-trust bypass. The test deadline is 180 seconds and native cases each have 60 seconds. Exact successful case commands belong in M0 evidence and the later durable M1 runner; metadata alone cannot start M1.

Implemented opt-in commands require an existing local `clooks-e2e` image (no automatic build/pull). The helper route needs no native distribution; smoke requires an explicit retained distribution containing `bin/codex`:

    bash scripts/test-codex-native.sh --unit
    CLOOKS_CODEX_DIST=/absolute/path/to/x86_64-unknown-linux-musl bash scripts/test-codex-native.sh --smoke

The shell script starts Docker and exports evidence; Bun/build/test code runs inside it. `CLOOKS_CODEX_DIST=/absolute/path/to/x86_64-unknown-linux-musl bun run test:codex-native` is the opt-in smoke alias. Default test selection is unchanged; native/helper Docker uses network none, while ordinary E2E retains normal network access for real GitHub cases. Ordinary repo regression orchestration remains `bun run test:e2e src/` and `bun run test:e2e`; these launch Docker, not host tests. Explicit focused E2E paths must start `./test/e2e/` to avoid zero-test name filtering. Capture real counts and exits; no expected numeric pass count is asserted before tests exist.

## Validation and Acceptance


All builds, tests and probes use disposable Docker. M0 passed baseline SessionStart, UserPromptSubmit, PreToolUse, PostToolUse and Stop invocation plus native shell result, followed by reached denial with absent sentinel, independently inspected exact native feedback and no raw PostToolUse for that call ID. Context-token delivery and one Stop continuation are mandatory M1 cases, not retrospective M0 gates. Explicit temporary-project trust, hook-trust bypass, approval_policy never and danger-full-access establish no normal approval/sandbox/trust, real-host-model or Rust-test evidence. Every missing mandatory M1 case leaves M1 partial. Preserve assigned deadlines, positive guards, per-capability status and independent review rather than inferring acceptance from counts.

Each durable evidence row records release/package origin, exact binary path/hash/version, container image ID/tool versions, repo revision plus dirty-source hash, runner/server/fixture hashes, full synthetic config/flags, event/call IDs, capture paths, expected and observed effects, raw exit/signal, command, request counts and attempt index. Preserve every failure separately. Captures remain native-with-synthetic-model; do not overwrite historical docs-shaped fixtures or relabel them. Redact only necessary environmental identifiers and retain the relationship between raw scratch hashes and sanitized durable excerpts. Unknown and unsupported are different: only inspected contract or actual rejection supports unsupported; an untriggered workflow stays unresolved.

## Idempotence and Recovery


At most two technical attempts for initial M0; stop and reassess after the limit, without resetting the count for a new wrapper or event. Do not reopen exhausted upstream acquisition or Rust retries. Each case uses fresh homes/project and reset fixture request state, so the baseline cannot supply the denial's sentinel or counters. Freeze scripts until run completion. Preserve failed artifacts before deleting only the owned container and its process tree; never prune unrelated Docker resources. Missing image dependencies stop for a recorded disposition, not host installation or covert network enablement. Container build preparation, if separately needed and authorized, cannot alter the network-none probe boundary.

## Artifacts and Notes


Keep this plan, `ATTENTION.md`, `native-conformance-evidence.md` and `native-execution-matrix.md` in `docs/plans/done/feat-0044-native-conformance/` for independent archival. The matrix records the six passed capabilities and unverified/unattempted alternatives. Do not move/copy the shared A/B/C plans, archived D or prior matrices/evidence. This edit changes the epic only at current Plan E status/link, preserving historical prose. No artifact is staged or committed; these documentation paths may be gitignored, so verify actual files directly rather than relying on an empty git diff.

Current evidence: `native-conformance-evidence.md` and `native-execution-matrix.md` retain historical M0 and final M1 results, source/capture provenance, actual commands and limitations. Banach/Raman independent code/QA runtime-evidence GO and parent scoped closure GO are recorded. One M1 native attempt was consumed; no immutable-storage claim is made.

## Interfaces and Dependencies


Use the retained pinned native binary and a local Responses fixture server under the recorded M1 parent GO. No real auth/config/trust copies, host installation/build/test/deployment, production edits, TODO edits or commits. Hilbert owns new tests/scripts/package; parent owns Docker; this editor owns documentation and the matrix.

M1 uses Bun's HTTP server and subprocess APIs already available in the test image, with a finite queue of Responses SSE fixtures and structured request JSON capture. `fixture-server.ts` exposes start/stop and captured requests; `harness.ts` verifies pinned metadata, runs isolated cases with deadlines and produces structured case results. Case results carry ID, evidence class, status (`passed`, `failed`, `unresolved`, `unsupported`), expected/observed artifacts, invocation metadata and limitations. Missing prerequisites must not return a passing zero-case run. No SDK/provider abstraction, new runtime adapter methods or public hook API is required. Keep expected outcomes literal and independent of `src/agents/codex/translate.ts`.

`ATTENTION.md` documents the native subprocess boundary, generated launcher use, synthetic trust bypass and potential evidence overstatement. Any later production/root/failure/state/delivery change requires a recorded plan amendment and updated ATTENTION before edits; it is not authorized by the test harness milestone.

Decision: Hegel final specification GO and parent GO authorize Hilbert's six-case M1 harness work, parent-only Docker execution and an initial maximum of two full native smoke attempts with one diagnosed correction. Pre-native unit/static/compile fixes do not consume native attempts; optional experiments remain unresolved/unattempted. Rationale: begin the reviewed mandatory scope while preserving truthful attempt accounting and excluding production changes. Date/Author: 2026-09-08, parent authorization recorded by delegated editor.

Revision note (2026-09-08): Closed M0 documentation with concise evidence and narrow domain/readiness corrections; recorded Franklin code/runtime-evidence, Dirac QA and Hegel final specification GO. Parent M1 GO was recorded in Progress before worker edits, authorizing Hilbert's six mandatory cases with parent-only Docker and the initial two-smoke-attempt budget. Optional experiments remain unresolved/unattempted; no production changes are authorized. Corrected missing-artifact claims, failed sealing, /native/export boundaries and deadlines; preserved historical fixtures and the actual user prompt. Living domains contain no newly added planning IDs or ignored-plan links.

Closure revision (2026-09-08): Consolidated current status/progress/outcome after six-case native success and final independent review GO; recorded per-arm context proof, commands/prerequisites and remaining capabilities. Updated living docs without internal planning IDs, archived only Plan E and repaired evidence links. Actual user prompt and decisions are preserved.
