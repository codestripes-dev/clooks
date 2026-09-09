# Separate engine and hook coverage ownership

This living plan follows `docs/plans/PLANS.md`. Originating feature: none; standalone approved maintenance task.

## Purpose / Big Picture

Keep shipped-hook tests running while separating their coverage from the engine's 95% gate. A local hook report should measure actual vendored implementations, not engine support code.

## Product Context

Only coverage accounting changes. Unit, E2E and native discovery and production behavior remain unchanged. Marketplace-owned hook policy is not introduced in this checkout.

## Progress

- [x] (2026-09-08, Joe-Degler) Read process, testing guidance and existing validation-config tests; verified Docker Bun 1.3.10.
- [x] (2026-09-08, Joe-Degler) Add narrow engine exclusion, standalone hook config and script, and extend existing configuration regression checks.
- [x] (2026-09-08, Joe-Degler) Extract coverage knowledge; validate both LCOV reports, ordinary discovery, focused E2Es and formatting in disposable Docker containers.

## Context and Orientation

`bunfig.toml` roots ordinary units at `src/`. Three `src/default-hooks/*.test.ts` files import actual `.clooks/vendor/plugin` modules and pack tests. LCOV is the coverage report whose `SF:` records identify measured source files. `test/e2e/validation-config.e2e.test.ts` already checks configuration and script status propagation.

## Milestones

One bounded milestone adds only `.clooks/vendor/plugin/**` to engine measurement exclusions, adds `hookcoverage.toml` with `src/` and `test/` measurement exclusions and no threshold, and exposes `test:coverage:hooks`. Extend existing regressions without new test infrastructure. Move the current coverage documentation into `docs/domain/testing/coverage.md` with a link from the 298-line parent.

## Concrete Steps and Validation

From the repository root, use existing `clooks-e2e` with read-only mounts of current source, tests, vendor packs, schemas, package metadata, tsconfig and both coverage configs. Run `bun run test:coverage` and `bun run test:coverage:hooks` inside disposable containers; preserve logs and reports under ignored `tmp/coverage-ownership/`. Run focused configuration E2Es through the existing container entrypoint, which typechecks and compiles inside Docker. Assert positive engine source records with zero vendor records, and positive hook records exclusively under the vendor path. Confirm all three hook test files execute in both unit selections. Engine threshold failure may remain; do not lower thresholds or remove fixtures. No image rebuild, host tests, deployment, staging or commits.

## Decision Log

2026-09-08, Joe-Degler: Keep `test:coverage` and Lefthook unchanged, with coverage exclusions only. Hook reporting is independent and report-only because no existing hook threshold policy was found. Use the user-provided prior verified author handle; the required fresh `gh api user` attempt failed on network access.

## Surprises & Discoveries

Docker socket access requires sandbox escalation; the existing image is available. No production danger zone is modified.

Bun 1.3.10 requires the equals form `bun test --config=./hookcoverage.toml`. The separated form ran 870 tests but retained engine configuration, producing an empty engine-owned report. Final package-script validation produced 11 vendor modules and exited 0 at 94.78% lines. Empty reports were rejected. A tiny existing-sandbox E2E fixture now executes both real scripts, proving engine failure and hook success with intentionally uncovered functions and exactly one correctly owned LCOV source record each. It does not recursively run repository coverage suites.

## Related Domain Knowledge Documents

`docs/domain/testing.md` now links to the extracted `docs/domain/testing/coverage.md` and is 263 lines. The child preserves the previous policy/limitations and explains ownership, exact CLI syntax and Docker mounts. Existing child testing docs were searched for policy; no hook coverage policy was found.

## Related Findings

`docs/findings/tooling-friction.md`, "Unit coverage does not meet the configured threshold", records existing engine per-file deficits. Vendor ownership separation does not resolve those source deficits or lower their gate. Existing hook parser and tmux findings in `code-quality.md` are unrelated and remain untouched.

## Instruction Prompts

Latest approval: "Yes, separate them". Context: retain hook unit/E2E/native execution, exclude only vendored plugin implementations from engine measurement, and add a local report-only hook command without changing marketplace files. Preserve all dirty/staged prior work; no staging, commits, host tests, global writes, image rebuilds or deployments. Use existing Docker image and record positive LCOV ownership evidence rather than adding recursive coverage E2Es.

## Outcomes & Retrospective

Complete. With existing `clooks-e2e` / Bun 1.3.10, `bun run test:coverage` passed 3,084 tests across 72 files but exited 1 on retained per-file coverage deficits (aggregate 95.60% functions, 97.20% lines). Its LCOV has 108 measured files, including existing engine fixtures, and zero vendor records. No engine threshold or fixture was removed.

`bun run test:coverage:hooks` exited 0 with 870 passing tests across three files, 2,640 assertions, 95.28% functions and 94.78% lines. Its 11 LCOV source records are exclusively actual `.clooks/vendor/plugin/` implementations, with no engine, support or test-file records. The below-95 line result confirms report-only behavior with both real configs mounted.

An ordinary `bun test src/ --reporter=junit --reporter-outfile=/dev/stdout` run independently passed all 3,084 tests. Its three top-level hook suites report scripts-and-removal 88, command-and-patch 142, portability 640: all 870 remain in ordinary discovery. The focused container entrypoint run of `./test/e2e/validation-config.e2e.test.ts` typechecked, compiled and passed 9 tests / 36 assertions. Prettier checked current package metadata and the edited regression using `.prettierrc`; `git diff --check` passed for tracked task edits.

Local evidence lives under ignored `tmp/coverage-ownership/`: `engine.log`, `engine-report/lcov.info`, `hooks.log`, `hooks-report/lcov.info`, `unit-discovery.xml`, `unit-discovery.log`, and `config-e2e.log`. `assert-reports.ts` passed structural ownership assertions; `run.sh` records exact report mounts/commands. No full E2E/native rerun was needed for this production-unchanged task; their discovery and commands are unchanged apart from the additional read-only config mount. No host tests, image rebuilds, global writes, staging, commits or deployments were performed. No public interfaces or dependencies changed.
