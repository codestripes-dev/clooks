# Preserve validation diagnostics and coverage failures

This ExecPlan follows `docs/plans/PLANS.md` and must remain self-contained and current.

**Originating Feature:** None; bounded tooling preparation for native hook verification.

## Purpose / Big Picture

Make a failed subprocess assertion explain whether the child exited or was killed, and make Docker coverage enforce the repository's actual configuration. No installed Clooks, production runtime, permissions or event support changes are needed.

## Product Context

Developers currently lose termination details during E2E failures and can mistake a successful coverage wrapper for an enforced coverage gate. This work improves diagnosis and confidence in validation without expanding the adapter project.

## Progress

- [x] (2026-09-08, Joe-Degler) Read process, testing domain, findings, harness and configuration; authenticated GitHub identity verified.
- [x] (2026-09-08, Joe-Degler) Add compatible diagnostics and focused real-process tests.
- [x] (2026-09-08, Joe-Degler) Correct Docker coverage wiring and exit propagation; add regression checks.
- [x] (2026-09-08, Joe-Degler) Update durable testing guidance and create fixed validation runner.
- [x] (2026-09-08, Joe-Degler) Removed resolved findings; retained the genuine coverage shortfall.
- [x] (2026-09-08, Joe-Degler) Parent approved documentation-only cleanup of resolved wrapper/branded-name incidents and replacement of historical coverage incident with the remaining 95% coverage shortfall. Diagnostics closure subsequently passed its final full E2E gate.
- [x] (2026-09-08, Joe-Degler) Added missing-config early-exit regression with compile sentinel and positive control.
- [x] (2026-09-08, Joe-Degler) Parent completed all validation; code and QA reviewers gave GO. Archived plan and ATTENTION. Coverage status correctly remains failing.
- [x] (2026-09-08, Joe-Degler) Final full E2E passed 798/0 across 49 files with 9,346 assertions in 117.92s; exit 0. Final units/static/focused passed; coverage completed with passing assertions and failing thresholds as recorded below.

## Surprises & Discoveries

Second focused attempt (`tmp/tooling-cleanup/focused-ZJq99tqk/output.log`) compiled successfully but executed zero tests: with bunfig's `root=src/`, Bun treats bare `test/e2e/...` arguments as filters under src. An initial path-rewriting solution passed focused tests but was removed after review. Final implementation uses an explicit `./test/e2e/` default and forwards caller arguments verbatim; focused callers use explicit paths. The forwarding regression verifies this final design.

First focused Docker attempt (`tmp/tooling-cleanup/focused-wLRHMHx3/output.log`) exited 2 during TypeScript compilation; zero tests ran. Required metadata also affects the registration sandbox override and a direct generated-command subprocess helper. An existing whole-result Claude equivalence assertion must compare only semantic fields because elapsed time varies across invocations. Extend those helpers with real raw/signal/timing metadata and audit whole-result equality before retry; do not make diagnostics optional to hide missed consumers.

The Docker run omits `bunfig.toml`; current thresholds are 0.95, not the historical 0.50 described in the domain. The `test:coverage` command uses `script` without child-status propagation followed by an `awk` pipeline, so either layer can hide failure. Existing normalized exitCode callers cannot distinguish a null status from a child-selected 2.

## Decision Log

- Decision: Default to `./test/e2e/` and forward supplied arguments verbatim; focused E2E callers must supply explicit `./test/e2e/...` paths.
  Rationale: A handwritten Bun option parser is unnecessary maintenance and risks changing option values. Bare paths now remain Bun name filters confined to the configured src root. This is a documented test-command usage adjustment, not a production change. Focused attempt 3 passed 20 tests with 120 assertions before this simplification; final post-format focused validation also passed.
  Date/Author: 2026-09-08, Joe-Degler.
- Decision: Preserve normalized exitCode and add rawExitCode, signalCode and elapsedMs. Provide explicit diagnostic assertion messages in targeted regression tests rather than globally rewriting assertions.
  Rationale: Existing success/failure semantics remain intact; failure evidence is available without noisy logs for expected denials.
  Date/Author: 2026-09-08, Joe-Degler.
- Decision: Remove the coverage output-filtering pipeline and invoke Bun coverage directly, retaining all output and the real status. Mount bunfig read-only and require it before compilation.
  Rationale: No output filter is worth concealing failed coverage; do not lower thresholds or exclude fixtures.
  Date/Author: 2026-09-08, Joe-Degler.

## Outcomes & Retrospective

Completed without production, installed/global, README, TODO, threshold or exclusion changes. Raw process diagnostics are preserved across all affected helpers and visible in targeted failing assertions. Docker loads authoritative configuration, focused discovery is explicit and coverage failures propagate honestly. All functional/static gates and independent reviews passed; the 95% coverage shortfall remains actionable separate work. The main lessons were to trace structural result consumers before changing shared types and avoid writing a second CLI parser just to correct test-path spelling. No commits or staging performed.

## Context and Orientation

`test/e2e/helpers/sandbox.ts` invokes the compiled `dist/clooks` binary or an isolated Bash entrypoint. Its results feed ordinary Bun assertions. Keep the numeric `exitCode` mapping unchanged, and retain raw process metadata alongside it. `package.json` builds/runs `test/Dockerfile`; `test/docker-entrypoint.sh` typechecks and compiles mounted source before invoking Bun tests. `bunfig.toml` sets unit root and 95% coverage thresholds. Explicit E2E paths must still discover real tests when that configuration is mounted.

## Related Domain Knowledge Documents

`docs/domain/testing.md` needs additive diagnostics guidance, fixed-runner conventions, accurate coverage wiring/threshold descriptions and concise current behavior instead of obsolete run recaps. No README or other domain update is needed.

## Related Findings

`docs/findings/tooling-friction.md` contains subprocess diagnostic loss, active-wrapper mutation and missing Docker coverage config. Remove resolved entries when validated; retain the actual unresolved coverage gap without stale attempt counts. Other category files were consulted; unrelated findings remain unchanged.

## Plan of Work

### Single milestone: Honest validation and useful failure evidence

Extend all three sandbox run methods with raw status, signal and monotonic elapsed time. Export a pure `formatDiagnostics(result)` helper and use Bun's assertion message argument in the targeted circuit-breaker regression. Add focused helper tests and Docker smoke tests for normal, nonzero and signal termination, including an intentionally failing nested assertion whose error message contains diagnostics. This validates reporting, not just field existence.

Mount bunfig in the normal Docker command and fail early if absent. Simplify the coverage script to direct Bun execution. Test wiring through structured package/TOML reads and a fake Bun child with success/failure statuses. Do not modify thresholds. Document one owner per Docker run, immutable wrapper/source during execution, bounded commands, retained raw logs/status and nonzero test counts. Provide exact commands to the parent; only the parent executes tests/builds in disposable Docker.

## Concrete Steps

From `/opt/development/clooks`, the parent runs:

    bun run test:e2e ./test/e2e/harness-diagnostics.e2e.test.ts ./test/e2e/validation-config.e2e.test.ts ./test/e2e/circuit-breaker-advanced.e2e.test.ts
    bun run test:e2e
    bun run test:e2e src/
    bun run test:e2e --coverage src/

Each command builds the container and compiles only inside it. Retain the final coverage status even when all assertions pass. Do not run host build, deploy, init, uninstall or tests. Parent validation commands may require Docker socket approval. Run `git diff --check` for patch hygiene.

## Validation and Acceptance

All ordinary suites pass with nonzero executed counts. Diagnostic tests prove child-selected errors differ from signals, elapsed time is finite/nonnegative, stderr survives, and failing assertions include the metadata. Unit-style formatting tests run in the Docker harness suite. Coverage wiring tests prove mounted configuration equals repository policy and child failure is not hidden. A genuine coverage failure is reported as remaining work, never relabeled a successful gate.

## Idempotence and Recovery

Use only disposable test homes/projects. Each smoke cleans its sandbox in finally/afterEach. Do not edit active runners or mounted source mid-run; create a new attempt after completion. No commits are authorized. Leave TODO.md untouched. Plan files are gitignored and eventually require explicit force-add.

## Artifacts and Notes

Final post-format focused run passed 20/0 with 120 assertions in 1.78s and exit 0 after typecheck/compile (`tmp/tooling-cleanup/focused-bQqjZuUr`). Final code/QA GO confirmed. All validation for this bounded cleanup is complete; coverage enforcement works but coverage thresholds remain unmet.

Final static validation passed with exit 0 (`tmp/tooling-cleanup/static-HBXNZBCb`), including typecheck, lint (112 warnings, zero errors), project formatting and explicit formatting of every changed test/helper. Coverage validation (`tmp/tooling-cleanup/coverage-ZLbptRVI`) ran 2,192 passing tests with zero assertion failures and 8,229 assertions in 3.42s, then exited 1 because the unchanged coverage thresholds are not met. This nonzero status was correctly preserved. No coverage success is claimed; meaningful coverage improvement remains separately scoped. Final post-format focused validation subsequently passed, as recorded above.

Parent unit validation passed 2,192/0 with 8,229 assertions in 3.68s (`tmp/tooling-cleanup/units-EnXSurSm`). Static typecheck, lint (112 warnings, zero errors) and project formatting passed; explicit E2E formatting failed for `validation-config.e2e.test.ts` and `circuit-breaker-advanced.e2e.test.ts`. The Docker formatter exported only these two files; its exact formatting-only diff was applied and final static validation passed.

Final E2E evidence: `tmp/tooling-cleanup/e2e-WwLieG3A/output.log`. Parent reported 798 passes, zero failures, 49 files, 9,346 assertions and exit 0. No unit/static/coverage success is inferred from that result.

Record executed commands, counts and failures here after parent validation; do not copy attempt logs into living domain docs.

Parent runner: `bash tmp/tooling-cleanup/validate.sh focused` (also `e2e`, `units`, `coverage`, `static`). It records the command, raw log and exit status under a unique attempt directory, applies a ten-minute outer deadline and returns the original status. Run focused first so the Docker image exists before static checks. The runner and plan are ignored and are not silently staged.

## Interfaces and Dependencies

RunResult retains exitCode:number, stdout:string, stderr:string and adds rawExitCode:number|null, signalCode:string|null, elapsedMs:number. formatDiagnostics(result:RunResult):string formats these without mutating output. Bun spawn metadata and performance.now supply raw evidence. No new dependencies or production modules.

## Instruction Prompts

Follow-up: Focused completed exit2 compile only zero tests. Read tmp/tooling-cleanup/focused-wLRHMHx3/output.log fix required RunResult consumers registration helper, codex-state-delivery direct results, agent-adapter equality. Audit all whole-object equality on results: elapsed makes invocation equality nondeterministic, compare semantic fields explicitly not optional metadata compromise. Update plan before expanded test helper edits. Parent no runs active. Preserve direct raw/signal/timing in alternate subprocess helpers. Report ready.

User approval: "Okay, do that."

Approved scope: subprocess diagnostics preserving raw exit/signal/stderr/elapsed with focused tests and Docker smoke; reproducible fixed validation runners; investigate/fix Docker coverage configuration mismatch without lowering thresholds or hiding coverage failures; lean documentation. All implementation is delegated; parent owns test execution. No host installation changes, TODO edits or commits.

Delegated instruction: Implement approved bounded tooling cleanup, all edits delegated to you. Read CLAUDE.md docs/plans/PLANS.md fully, docs/domain/testing.md findings relevant files and current harness/config before edits. FIRST create concise self-contained plan per process recording user prompt 'Okay, do that.' and preceding approved scope: subprocess diagnostics raw exit/signal/stderr/elapsed with focused tests+Docker smoke; reproducible fixed validation runner conventions; investigate/fix Docker coverage config mismatch without lowering thresholds or hiding coverage failures; lean docs. gh identity per process. Create ATTENTION for shared harness if appropriate. No production src changes unless necessary (prefer test/helpers), no installed/global changes, TODO untouched, no commits. All tests/builds ONLY Docker repo orchestration; parent owns execution so provide commands, don't execute tests. Keep existing normalized exitCode API compatible; ensure diagnostics actually appear on failing assertion, avoid migration of all tests unless necessary. Add tests for normal/nonzero/signal, diagnostics, coverage configuration wiring as appropriate. Fix runner mounting bunfig if omitted, but don't broadly refactor infrastructure. Update testing domain as behavior changes, remove resolved findings and obsolete incident notes once durable guidance replaces them. Record remaining coverage threshold failures honestly. Use apply_patch. Report implementation ready plus exact validation commands. Parent reads existing runners and handles Docker while you implement.

Revision note: Initial bounded plan records approval before implementation and leaves execution to the parent.

Revision note: Implementation is ready for parent validation. Consolidated into one milestone to keep this bounded cleanup lightweight. No production files, thresholds or fixture exclusions changed.

Revision note: Final parent validation and review results recorded; completed plan and ATTENTION archived to `docs/plans/done/validation-diagnostics/`. Historical failed attempts remain evidence, not active incident findings. Archived files require force-add when a later commit is authorized.
