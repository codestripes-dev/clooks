# Tooling Friction

Build issues, slow commands, flaky CI, broken toolchain steps, or other tooling problems that blocked or slowed progress.

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
