# Tooling Friction

Build issues, slow commands, flaky CI, broken toolchain steps, or other tooling problems that blocked or slowed progress.

### E2E subprocess failures lose diagnostic information

**Severity:** friction
**Date:** 2026-09-08
**Context:** `test/e2e/helpers/sandbox.ts` exposes only normalized exit code, stdout and stderr.

The helper coerces a null exit code to 2 without retaining the raw exit code or termination signal, and does not measure elapsed time. Stderr is returned but is not automatically included when an exit-code assertion fails. This makes a child-selected failure hard to distinguish from signal termination or a timeout.

**Acceptance:** Preserve raw exit code, signal, stderr and elapsed time in failure diagnostics while keeping the existing normalized exit-code contract for callers. A deliberately failing subprocess test should show those diagnostics without requiring a rerun. This is a harness improvement, not a diagnosed runtime bug; historical failed and successful attempts remain in milestone evidence.

### Editing an active validation wrapper interrupted static checks

**Severity:** friction
**Date:** 2026-09-08
**Context:** Docker static validation of the frozen Codex runtime integration.

The runner edited an active Bash validation wrapper. The attempt then failed with `--kill-after=10s: command not found`, exit 127, before static checks ran. Diagnosis found no `timeout` shell function and verified GNU `/usr/bin/timeout`; this was not evidence that GNU timeout was unavailable.

**Resolution:** The retry uses the verified absolute `/usr/bin/timeout` path. Static retry `081005Z` completed all checks with exit 0, including lint with 112 warnings and 0 errors. The actual prevention is to freeze validation scripts for the entire run: never edit an active wrapper; prepare a separate wrapper for a later attempt. An absolute executable path alone does not prevent active-script mutation. This resolved tooling failure is separate from the unexplained GitHub add-pack smoke failure and does not establish full milestone acceptance.

### Policy tests need branded hook names

**Severity:** friction
**Date:** 2026-09-07
**Context:** First focused Docker validation of the invocation result-policy boundary.

The initial attempt stopped at three branded hook-name type errors. The test values were corrected with the existing `hn` helper. The subsequent Docker run passed typecheck/compile and 467 tests with zero failures; its source remained unchanged during execution and the container was removed. Evidence: `tmp/codex-runtime-m1/20260908T063150Z-focused-lWO01D/output.log`. Use branded test helpers when constructing typed policy inputs; this resolved typechecking friction does not close the pending full-suite and review gates.

### bun build --compile skips type checking

**Severity:** friction
**Date:** 2026-03-09
**Context:** During PLAN-08 circuit breaker implementation, extracting `executeHooks` from `runEngine` left a dangling `debug` variable reference.

`bun build --compile` compiled without error, but the binary crashed at runtime with "debug is not defined". Bun's compile step performs bundling and tree-shaking but does not run TypeScript type checking, so undeclared variable references slip through silently. The result is a binary that looks good but fails at runtime — the worst kind of feedback loop.

**Resolution:** Added `tsc --noEmit` before `bun build` in the build script. This is now the project convention — type errors block the build.

### Lint state on master drifting undetected despite Lefthook pre-commit

**Severity:** friction
**Date:** 2026-04-19
**Context:** During PLAN-0016 (GitHub release workflow), running `bun run lint` as part of local pre-commit validation revealed master carries 13 lint errors and 94 warnings.

PLAN-0010 set up Lefthook with pre-commit lint on staged files, yet these errors exist on master. The errors span unused imports, an `Function` type usage, unused fn args, and a `preserve-caught-error` violation across `src/config/index.ts`, `src/config/parse.test.ts`, `src/config/parse.ts:22`, `src/config/validate.ts`, `src/lifecycle.ts`, `src/tui/output.test.ts`, and `src/types/lifecycle.test.ts`. Possible mechanisms: (a) Lefthook isn't catching new errors, (b) errors were introduced via rebases / squash merges / `--no-verify` commits, or (c) the hook only lints staged files so errors in untouched files persist invisibly. Whatever the cause, master's lint state is drifting and no safety net catches it.

**Resolution:** Fixed the 13 errors as a separate commit immediately before PLAN-0016's work. The systemic gap — no PR-triggered CI lint gate — remains. PLAN-0016 has a deferred item to "stand up a separate PR-triggered CI workflow (Next)" which would address this; until then drift will recur.

### `package.json` prepare script fails on CI (Lefthook not installed)

**Severity:** friction
**Date:** 2026-04-19
**Context:** First tag-triggered run of PLAN-0016's GitHub release workflow.

`bun install --frozen-lockfile` failed on the GitHub-hosted runner because `package.json` declares `"prepare": "lefthook install"`. Lefthook is installed locally via mise (per PLAN-0010) but is not present on CI runners. The npm `prepare` lifecycle script ran automatically post-install, couldn't find `lefthook` on PATH, and exited 127 — breaking the entire install step.

**Resolution:** Release workflow now runs `bun install --frozen-lockfile --ignore-scripts`. CI doesn't need git hooks installed, so skipping lifecycle scripts is safe. The underlying `package.json` coupling remains — any future CI setup (PR-triggered workflow, Docker image build, new contributor running `bun install` without mise) will hit the same failure unless they remember the `--ignore-scripts` flag.

**Durable fix candidates:** (a) move the `lefthook install` call out of the npm `prepare` lifecycle into a dedicated `bun run install-hooks` target that local devs invoke explicitly; (b) gate the `prepare` script on `CI` env var so it no-ops on CI (`"prepare": "[ \"$CI\" = \"true\" ] || lefthook install"`). Option (b) is the least-invasive durable fix.

### Disposable Codex live hook spikes need explicit binaries and auth state

**Severity:** friction
**Date:** 2026-05-24
**Context:** During EPIC-0044 Plan A, running a disposable Codex live hook spike under `/tmp` with temporary `HOME` and `CODEX_HOME`.

The asdf shim failed because the temp project had no configured node/codex version. The workaround was to resolve the real `codex` and `node` binaries with `asdf which` and put the node bin dir on `PATH` in the spike script. A later live spike was blocked first by sandbox networking, then by `401 Unauthorized` with disposable `CODEX_HOME`, so live hook firing could not be verified without carrying usable auth state into the disposable environment.

### Docker coverage validation omits config and exposes fixture thresholds

**Severity:** friction
**Date:** 2026-09-07
**Context:** Commit validation for completed C1M1M2 at the user's request, with all uninstall tests restricted to Docker and no new production changes.

`bun run test:e2e --coverage src/` initially reported 1,830 passing tests, 0 failures, 6,309 assertions, and exit 0, but the default Docker setup omitted `bunfig.toml`. Repeating `docker run` with the same read-only `src`, `test`, schema, and tsconfig mounts plus read-only `bunfig.toml` reported 1,830 passing tests and 0 failures but exited 1. Three unchanged hook fixtures each had 33.33% function coverage, below the configured 50% threshold: `test/fixtures/hooks/allow-all.ts` (77.78% lines), `test/fixtures/hooks/harness-lifecycle-block.ts` (61.54% lines), and `test/fixtures/hooks/harness-lifecycle-skip.ts` (72.73% lines). The files are unchanged; a baseline coverage failure was not independently proven. The previous full E2E gate reported 510 passing tests.

**Workaround:** The parent plans to use `LEFTHOOK_EXCLUDE=coverage git commit` to honor Docker-only test execution while reporting the threshold failure; remaining hooks will run. Fixture coverage-threshold treatment remains unresolved. No fixture or threshold fixes were made.

### Exact-release source acquisition required the remaining git route

**Severity:** friction
**Date:** 2026-09-07
**Context:** Bounded Codex `0.153.4` source acquisition for the runtime contract audit.

The initial GitHub `commits/rust-v0.153.4` lookup was ambiguous between a branch and tag with that name, and the downloaded archive was discarded with its container. Its commit and checksum therefore did not establish exact-tag provenance with retained bytes. The second and final permitted route fetched `refs/tags/rust-v0.153.4` explicitly and retained a git-generated archive. Tag object `042fb41b7c813ac7999105e886b2b7aa715b5081` peeled to the already inspected commit `3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`; matching 4,177-file manifests bound the inspection to the exact release. The retained archive SHA-256 is `45375e73d04b57a0e36520f88c8ebfd22f0eb400410b5ce40ad9b3b2dcbf07a0`. It is a different archive representation from codeload, so the historical hashes are not interchangeable.

**Resolution:** Acquisition is resolved within the two-route allowance; both routes are consumed and no third source fetch is authorized. Preserve both attempt records and distinguish exact refs, peeled commits, retained bytes and hashes in future bounded acquisitions. Docker socket permission denial was resolved through sandbox escalation with the daemon already running; this was an access issue, not evidence that Docker was unavailable. This acquisition resolution does not report the separate bounded toolchain retry's outcome or imply upstream tests ran.

### Bounded upstream execution retry stopped at locked dependency preparation

**Severity:** friction
**Date:** 2026-09-07
**Context:** Attempting original upstream parser/executor validation after exact-release source acquisition.

The initial cached-container feasibility attempt found no cargo/rustc and executed zero tests. The parent reports that the one permitted retry stopped during dependency preparation: `cargo fetch --locked` refused the required update to upstream `Cargo.lock`. The retry exited 101 after 49 seconds. No tests ran in either attempt, and no parser/executor `P` evidence was produced. The reason the lockfile needed updating is not established by this report.

**Disposition:** The bounded retry allowance is exhausted; execution remains unverified. Cleanup is confirmed: the owned container was removed and the label-filtered container listing was empty. Detailed evidence recording remains with the runner. Source acquisition remains resolved, and this dependency-preparation failure does not invalidate the pinned-source inspection or establish general toolchain unavailability.
