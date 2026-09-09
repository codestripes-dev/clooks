# Attention Required

All milestones are complete with final code/QA GO and mandatory summaries. M4 default four is implemented by user choice and passed combined validation; Cicero completed the no-lookup summary, and parent authorized archival. Supported counts stay 1/2/4/8/16/32; eight remains the historical benchmark winner. The unchanged baseline generated-declaration project-format failure remains explicitly excepted.

## Danger Zone Changes

### User-Selected Default - M4

**What changed:** Default eight became four, with matching tooling expectations and domain updates. No other runner or runtime behavior changed.

**Why:** The user explicitly chose four; this is not a claim that four won the benchmark.

**Why it matters:** The actual default-four combined command passed all 70 tooling, 3,172 unit and 1,029 E2E tests in 123.513525111 seconds with one build, six same-ID consumers, unchanged coverage/timeouts and successful owned cleanup. Final code/QA GO and Cicero's no-lookup summary are complete. Historical M3 descriptions below retain their measured context, not the current default.

### Historical Higher-Count Measurements - M3

**What changed:** Implemented bounded 1/2/4/8/16/32 support, generic stable greedy partitioning and default eight. Ten full trials passed: 2/4/8 in both directions, then adjacent 8/16/16/8. Sixteen regressed, so the escalation requirement for measuring 32 was unmet.

**Why:** Comparing one against two did not establish the best concurrency level. Higher-count paired measurements supported eight on this machine; explicit 1/2/4 overrides remain available for lower-resource environments.

**Why it matters:** Increased concurrency can amplify contention, timeout failures and cleanup mistakes. Require exact-once file execution, nonempty groups, stable inputs and owned cleanup at every count; stop escalation on any failure or below-10% improvement plateau. Do not relax timeouts, coverage or assertions. Select the smallest count consistently within approximately 5% of the fastest reliable result, then revalidate the combined gate and obtain final code/QA GO and no-lookup summary. Supporting 32 does not require running it when earlier measurements plateau.

### Shared Validation Runner - scripts, test Docker environment and tooling tests

**What changed:** Implemented isolated-worker orchestration and Docker-only tooling regressions, one immutable build image ID per attempt and explicit file selection/status tracking. The integrated runner now uses four workers by user choice with explicit count overrides.

**Why it changed:** Measure whether isolated E2E concurrency improves full-suite time without state collisions or weakened checks.

**Why it matters:** Missing or duplicate files, empty selection, swallowed failures, stale image selection or leaked containers can make every validation result misleading. Preserve exact-once execution evidence, unchanged timeouts, read-only mounts, non-root behavior, signal handling and label-verified cleanup. Early M1 trials supported two; completed M3 comparisons support the current default eight, not a universal optimum.

### Historical Default-Eight Gate Proof - M3

**What changed:** Implemented a single `validation` hook: one build followed by uninstrumented tooling regressions, unsharded coverage and default eight-worker E2E using the captured image ID. LCOV is retained before cleanup. Focused/raw calls use one container; direct-run remains unchanged. Final combined proof passed 69 tooling, 3,172 unit and 1,029 E2E tests in 90.701608606 seconds with one build, ten same-ID consumers and successful cleanup; final code/QA acceptance is complete.

**Why it changed:** Avoid redundant image builds, shared-tag races and simultaneous coverage/E2E CPU contention.

**Why it matters:** Preserve direct test:e2e:run argument passthrough, explicit focused paths, full test selection, 95% coverage thresholds/exclusions and original failure status. A passing test count is not a passing coverage gate. Review build count, image identity and downstream hook failure reporting. No global writes, remote operations, prune, staging, commits or changes to TODO.md are authorized.

Other parallel Lefthook gates may format, lint-fix or regenerate mounted inputs. M2 deliberately fails on detected input mutation and requires a full rerun after writers finish; it does not automatically guarantee stable source. Review the mutation-failure regression and documentation. Before/after hashes cannot detect every transient write restored to its original bytes. Gate ordering changes require a bounded parent decision and verification of the actual Lefthook API first.
