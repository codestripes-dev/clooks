# Meet the Existing Engine Coverage Requirement

This ExecPlan is a living document maintained under `docs/plans/PLANS.md`.

**Originating Feature:** None; standalone follow-up to the blocked pending commit.

## Purpose / Big Picture

Make the existing engine coverage gate pass by exercising meaningful currently untested behavior. Keep the 95% per-file line and function requirement and existing exclusions unchanged. Users gain regression protection for adapter normalization, command updates, engine state, and supporting utilities; passing assertions alone are not acceptance.

## Product Context

The pending commit is blocked by real coverage shortfalls. This is test debt repair, not a runtime feature or permission to weaken the gate. Existing staged changes belong to the user and must remain intact.

## Progress

- [x] (2026-09-08, Joe-Degler, inherited verified handle supplied by parent) Read repository instructions, complete plan process, coverage domain, and findings process; inspect baseline report.
- [x] (2026-09-08) Record prompt and establish shared ownership before test edits.
- [x] (2026-09-08, Joe-Degler) Behavioral test additions and manifest-case repairs pass shared validation and subsequent review.
- [x] (2026-09-08, Joe-Degler) Adapter/type behavioral tests implemented, validated, and reviewed.
- [x] (2026-09-08, Joe-Degler) Parent ran two coordinated Docker validations; second report has 108 measured files and no line/function shortfalls.
- [x] (2026-09-08, Joe-Degler) Final Docker validation passes: 3175 tests, zero failures, zero exit status; parent confirms included typecheck passed.
- [x] (2026-09-08, Joe-Degler) Parent reports final code-review and QA GO, with no issues; both independently confirm 108 records at least 95% and 3175 passing tests with zero failures.
- [x] (2026-09-08, Joe-Degler) Added durable spy-restoration guidance; delegated findings owner removes resolved coverage finding after verified passing report.
- [x] (2026-09-08, Joe-Degler) Recorded final outcome and archived completed plan without staging or committing.
- [x] (2026-09-08, Joe-Degler) Reopened after parent released edits following completed failed commit attempt; only host coverage failed.
- [x] (2026-09-08, Joe-Degler) Milestone 4: Coverage hook uses existing Docker build/run scripts; domain guidance corrected.
- [x] (2026-09-08, Joe-Degler) Parent validates actual Lefthook coverage command: exit 0 in 10.37 seconds, then authorizes archival before the normal full commit retry.
- [x] (2026-09-08, Joe-Degler) Parent confirms final code-review and QA GO for the configuration addendum as well.

## Surprises & Discoveries

Baseline `tmp/coverage-ownership/engine-report/lcov.info` contains 18 failing records, including imported test fixtures. `gh api user --jq '.login'` failed connecting to api.github.com; parent supplied the previously verified handle Joe-Degler, inherited for attribution. No tests have been run by this worker.

Parent reports run 1 stopped at TypeScript checking because a fixture reference was dangling; that reference was fixed. Run 2, retained at `tmp/coverage-gate/run-ZzAwPsu0/`, meets coverage in all 108 measured files but reports 3172 passed and 3 failed tests. The failures arise from array argument ambiguity in new manifest `test.each` cases; the command worker is repairing them. Coverage success is not gate success while assertions fail.

The Hubble/Plato turn-state ownership confusion is resolved: the existing 190-line I/O test addition already brings the module to the required coverage. Do not duplicate that work.

Final run `tmp/coverage-gate/run-NnBWTIyD/` resolves the intermediate manifest failures: 3175 pass, zero fail, 77 test files, 5.79 seconds. Its exit-code file is zero; read-only LCOV inspection confirms 108 records, none below 95%, and zero vendor records. Parent reports the included typecheck passed. Parent subsequently reports independent code-review and QA GO with no issues.

## Decision Log

Decision: Reopen for a narrowly scoped hook integration repair: set only the Lefthook coverage command to `bun run test:e2e:build && bun run test:e2e:run --coverage src/`. Keep `test:coverage`, mounts, dependencies, thresholds, exclusions, and parallel hook scheduling unchanged. Rationale: the full unit suite contains intentional Docker guards; the hook must supply the required environment rather than skip tests. Each parallel coverage/E2E hook builds the same image inputs and runs a separate disposable container; no pre-existing image is required. Date/author: 2026-09-08, Joe-Degler (parent release).

Decision: Add tests only; retain coverage settings and measurement scope. Rationale: the user's request is to satisfy the requirement, not bypass it. Date/author: 2026-09-08, Joe-Degler (inherited verified handle).

Decision: Parent alone coordinates Docker tests; no host tests, global hooks, home mutation, staging, or commits. Rationale: concurrent workers share staged changes and test resources. Date/author: 2026-09-08, planning/adapters worker.

Decision: The worker restriction above does not prohibit the parent's pending user-authorized commit from running standard repository hooks after isolated validation. Permit repo-configured host lint/unit hooks and Docker E2E validation; do not bypass hooks or alter global configuration. This worker still does not stage or commit. Rationale: ordinary commit validation must remain intact. Date/author: 2026-09-08, Joe-Degler (parent clarification).

Decision: Require code review and QA of all changed tests before milestone completion. Hubble owns engine tests, Hegel commands/miscellaneous tests, and Leibniz fixture tests; all implementation remains tests-only. Rationale: broad concurrent test additions require shared validation and review, not isolated readiness claims. Date/author: 2026-09-08, Joe-Degler (parent instruction).

## Outcomes & Retrospective

The follow-up integration repair is also complete: only the coverage hook command changed, and the actual Lefthook coverage hook passed with exit 0 in 10.37 seconds. Coverage documentation correctly identifies the Docker build/run command rather than the unchanged direct package script. Parent authorized rearchival before the full commit retry, which remains a parent-owned operation with regular hooks enabled. This worker did not stage or commit.

Adapter/type additions in `src/agents/codex/runtime.test.ts` and `src/agents/types.test.ts` cover optional tool validation, unsupported envelopes, diagnostic composition, allow annotations, raw policy rejection, rewrite constraints, and error identity. All measured files reach the unchanged coverage threshold; final Docker validation passes all 3175 tests and the included typecheck. The coverage finding is resolved and removed by the delegated findings owner. Code review and QA both returned final GO without issues, completing the implementation milestones. This plan is archived; the parent's original pending commit retains its ordinary validation hooks. No production changes were needed.

## Context and Orientation

The tests-only milestones passed isolated Docker validation and review, but the subsequent normal commit attempt exposed a separate integration failure: Lefthook invoked unit coverage on the host. Two imported command-and-patch tests intentionally refused subprocess execution outside Docker, with 3169 pass, 2 fail, and 4 skip despite adequate coverage. Parent confirms session 32354 ended with exit 1 and only coverage failed; lint, formatting, typecheck, bundle generation, E2E, context examples, and lockfile checks passed. The plan was reopened for the narrow Docker coverage hook repair, which has now passed actual Lefthook execution.

Coverage counts executed lines and functions. Both must reach 95% for every measured file. Baseline targets are `src/agents/codex/adapter.ts`, `src/agents/codex/normalize.ts`, `src/agents/codex/policy.ts`, `src/agents/types.ts`, `src/commands/add.ts`, `src/commands/update.ts`, `src/engine/execute.ts`, `src/engine/handoff.ts`, `src/engine/run.ts`, `src/engine/translate.ts`, `src/engine/turn-state.ts`, `src/failures.ts`, `src/github-url.ts`, `src/manifest.ts`, `src/platform.ts`, `test/fixtures/hooks/allow-all.ts`, `test/fixtures/hooks/harness-lifecycle-block.ts`, and `test/fixtures/hooks/harness-lifecycle-skip.ts`.

## Related Domain Knowledge Documents

`docs/domain/testing/coverage.md` describes the unchanged thresholds, ownership exclusions, Docker configuration mounts, and report interpretation. Updated with durable guidance on restoring fault-injection spies and limiting injected filesystem failures to isolated paths. No dated validation counts belong in that guidance. No new runtime contract is introduced.

## Related Findings

`docs/findings/tooling-friction.md`, "Unit coverage does not meet the configured threshold", is resolved by final passing shared coverage and removed by this delegated findings owner. The same file's build/type-check finding reinforces that successful compilation is not a substitute for type checking and is not removed. `docs/findings/test-gaps.md` describes a deferred reusable new-event harness; this bounded change does not introduce that abstraction.

## Plan of Work

Milestone 1: Read each uncovered function and existing tests, then add observable input/output or state-transition assertions. Planning/adapters owns only `src/agents/**/*.test.ts` for Codex adapter, normalization, policy and agents/types deficits. Commands, engine, and miscellaneous workers own their corresponding tests under parent coordination. Production changes require prior discussion with parent. Use existing Bun test patterns and isolated temporary directories with local cleanup; never manipulate global home state.

Milestone 2: Parent runs the full suite with coverage in the existing Docker workflow, retaining the output and LCOV report. Inspect all failing records, not just the original 18. Workers repair assertions or missing behavioral cases only in their assigned files. Passing means tests pass, the command exits zero, measured source records exist, vendor records remain excluded, and every measured file satisfies both existing thresholds.

Milestone 3: Planning/adapters records shared evidence, reviews domain guidance, removes the resolved finding, and archives this plan. If validation still fails, leave the plan and finding open with exact remaining failures.

Milestone 4: After the parent releases the completed commit process, change only `pre-commit.commands.coverage.run` in `lefthook.yml` to build the existing Docker image and invoke `test:e2e:run` directly with `--coverage src/`. Direct arguments reach the entrypoint's `exec bun test "$@"`; do not append them to the compound `test:e2e` script. Update `docs/domain/testing/coverage.md` to distinguish the unchanged direct coverage script from Docker-backed commit validation and disposable report storage. Existing command-contract E2E tests and the parent's normal full commit retry validate the integration; do not add mounts, wrappers, serialization, or skip/bypass mechanisms. Completion requires parent-reported hook success and review of this bounded config change.

## Concrete Steps

Parent executed `/home/joedegler/.local/share/mise/installs/lefthook/2.1.4/lefthook_2.1.4_Linux_x86_64 run pre-commit --command coverage` after the config change and reports exit 0 in 10.37 seconds. This validates the actual updated hook command, including its image build and Docker argument chain. Parent will retry the original full commit normally after this archival; no bypass is authorized.

Work from `/opt/development/clooks`. Inspect `tmp/coverage-ownership/engine-report/lcov.info` and relevant source/test files using read-only tools. Add tests with `apply_patch`. Parent executes `bun run test:coverage` inside the coordinated Docker container with current source, tests, vendor, package metadata, and both coverage TOML files mounted read-only, as required by the coverage domain. Do not run this command on the host. Parent records the exact container command and report path here after execution. Review changes with `git diff --check` without touching the index.

## Validation and Acceptance

Behavioral assertions must prove normalization results, policy rejection/success, hook execution effects, command state changes, or utility outputs as appropriate. No empty function invocations merely to inflate counters. Require the full engine coverage command's zero exit status and all per-file lines/functions at least 95%; retain existing exclusions exactly. Parent also coordinates type/lint checks. Since this plan changes tests only, no new production E2E milestone is required; any proposed production fix must first update the plan and receive parent agreement.

## Idempotence and Recovery

Tests create and clean their own temporary state. Reruns must not depend on another test's files or environment. Preserve all pre-existing worktree/index changes, do not stage or commit, and do not revert concurrent edits. A failed gate requires targeted tests and another parent-coordinated run, not a threshold adjustment.

## Artifacts and Notes

Baseline adapter deficits: adapter lines 60/66, functions 8/9; normalize lines 184/188, functions 13/23; policy lines 121/130, functions 8/9; types lines 17/20, functions 2/3. Final evidence is recorded below.

Run 2 artifacts are `tmp/coverage-gate/run-ZzAwPsu0/output.log`, `lcov.info`, and `exit-code`. Read-only inspection confirms 108 LCOV records and zero records below 95%. Adapter: 66/66 lines, 9/9 functions; normalize: 188/188 lines, 24/24 functions; policy: 128/130 lines, 9/9 functions; types: 20/20 lines, 3/3 functions. The three targeted fixtures each have 100% lines and functions. Output ends with 3172 pass, 3 fail, 11404 assertions, and 3175 tests across 77 files. This is intermediate evidence, not completion.

Final artifacts: `tmp/coverage-gate/run-NnBWTIyD/output.log`, `lcov.info`, and `exit-code`. Verified summary: 3175 pass, 0 fail, 11404 assertions, 77 test files, 5.79 seconds; exit status 0; 108 LCOV records, no per-file threshold shortfalls, no vendor records. Typecheck success and independent review/QA GO are parent-reported.

## Interfaces and Dependencies

Use existing `bun:test` assertions and the public functions already exported by production modules. No production interfaces, package dependencies, thresholds, or exclusions change.

## Instruction Prompts

RELEASE edits. Commit attempt complete exit1,ONLY coverage failed due host Docker guard. All other hooks passed: lint2.60s format1.87 typecheck4.74 bundle58.25 E2E157.30 verify-context2.86 lockfile0.13. Apply minimal lefthook Docker coverage command + domain/plan updates now; no need extra package script/mount unless compelling. Test existing script arg chain manually/commit normal full integration. Parent will rerun commit.

Implement coverage requirement fix in /opt/development/clooks as lead for planning + adapters ONLY. User latest: 'Then... make them pass that requirement??' after commit blocked by existing 95% per-file engine coverage. ALL existing changes are staged for pending commit; preserve index/worktree, no staging/commit/global changes. First read CLAUDE.md, full docs/plans/PLANS.md, docs/domain/testing/coverage.md, findings process; create brief ExecPlan (next0077) recording prompt BEFORE test edits, then immediately notify parent plan path/ready so other workers can start. Plan scope all18 failing files in tmp/coverage-ownership/engine-report/lcov.info; keep95% and existing exclusions unchanged; real behavioral tests, no trivial metric gaming. Your implementation ownership: src/agents/**/*.test.ts only for codex adapter/normalize/policy and agents/types coverage deficits. Do not modify production without discussing with parent. Other workers will own commands, engine, misc. No Docker runs until parent coordinates; no host tests. Tests should use existing patterns and isolated dirs, no global hooks or home mutation. Parent will run shared full coverage in Docker. You own plan and necessary domain/findings updates after results. Add code comments only valuable docs, no plan IDs in src/tests. Report plan ready early then implement.

Revision note (2026-09-08): Created before test edits to authorize bounded parallel coverage repair and preserve shared staged work.

Revision note (2026-09-08): Recorded parent-supplied verified attribution, worker assignments, mandatory review/QA gates, and adapter patch readiness without claiming milestone completion.

Revision note (2026-09-08): Recorded parent-reported run 1 repair, inspected run 2 coverage and test counts, resolved turn-state ownership, and retained final validation/review gates. Authorized the restored-spies domain note before editing knowledge documentation.

Revision note (2026-09-08): Verified final passing artifacts, recorded typecheck success, authorized resolved finding removal as delegated owner, and clarified standard parent commit-hook validation remains required. Archival awaits parent reviewer GO.

Revision note (2026-09-08): Parent delivered final code-review and QA GO with independent coverage/test confirmation and no issues. Completed progress and archived the plan; preserved the index and all unrelated changes.

Revision note (2026-09-08): Reopened before configuration edits for the host-only coverage hook blocker. Parent released edits after the commit process ended; milestone 4 preserves existing scripts and requires normal commit integration without bypasses.

Revision note (2026-09-08): Recorded actual Lefthook coverage success (exit 0, 10.37 seconds), verified corrected domain wording, and rearchived on parent authorization. The full commit retry remains parent-owned and is not claimed as completed.

Revision note (2026-09-08): Recorded both final review and QA GO for the configuration addendum. All plan work is complete; only the parent's normal full commit remains.
