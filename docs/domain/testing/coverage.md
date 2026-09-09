# Coverage Ownership

Unit test coverage is configured in `bunfig.toml` at the project root. The relevant settings:

```toml
[test]
coverageReporter = ["text", "lcov"]
coverageDir = "coverage/unit"
coverageSkipTestFiles = true
coveragePathIgnorePatterns = ["**/tmp/**", ".clooks/vendor/plugin/**"]

[test.coverageThreshold]
lines = 0.95
functions = 0.95
```

Coverage is **not** enabled by default. Running `bun test src/` is the fast path — no instrumentation, no threshold checking. Coverage is only enabled explicitly:

```bash
# Run unit tests with coverage (prints per-file table, writes lcov)
bun test --coverage src/

# Convenience alias
bun run test:coverage
```

lcov output is written to `coverage/unit/lcov.info`. The entire `coverage/` directory is gitignored. The full suite includes subprocess tests that require Docker; run full coverage using the Docker command below, not directly on the host.

### Ratchet enforcement

The Lefthook `validation` pre-commit hook runs `bun run test:validation`. One image build supplies sequential disposable containers for uninstrumented tooling regressions, the full unsharded unit coverage suite, then E2E (four workers by user preference). Eight remains the retained benchmark winner, not the current default. `--workers` accepts 1, 2, 4, 8, 16 or 32; use 1 or 2 for lower-resource runs, with 1 selecting serial E2E. Coverage remains unsharded regardless of that setting and executes `bun test --coverage src/` after entrypoint typecheck/compile, including subprocess tests that refuse host execution. The image supplies `CLAUDECODE=1` and the Docker marker; coverage retains that environment. Failed phases stop later phases and fail the hook. No tests or measurement owners are removed to accommodate orchestration.

The package script `test:coverage` remains `CLAUDECODE=1 bun test --coverage src/` for use inside an appropriate test environment. The configured thresholds are 95% lines and functions; a threshold failure fails the gate even when all assertions pass. The combined runner copies LCOV before container cleanup to `tmp/isolated-e2e-workers/run-*/unit-lcov.info` and requires successful copying, complete unique source records, positive measured engine content, and no vendor/tooling records. Bun enforces the threshold; artifact checks do not replace it. `validation-config.e2e.test.ts` and Docker-only tooling regressions check wiring and failure propagation, not actual full-gate success.

Standalone coverage remains `bun run test:e2e:build` followed by `bun run test:e2e:run --coverage src/`; this unchanged direct-run interface does not retain LCOV outside its disposable container automatically. The combined runner mounts current package metadata and uses a captured immutable image ID; direct-run reuse expects a fresh image build. Finish formatting/generation before validation and freeze inputs. Other hooks retain their existing parallel ordering: a before/after input-hash mismatch fails the combined attempt and requires a full rerun after writers finish. Hashes neither prevent races nor detect every transient write restored before the final hash.

The thresholds in `bunfig.toml` are the ratchet. To raise the bar, increment the values in a separate PR. Thresholds can only move up.

Fault-injection tests should restore each owned spy in `finally` (or the existing scoped teardown), including when an assertion throws. Limit injected filesystem failures to the test's isolated paths and delegate other calls to the original implementation. Shared full-suite coverage must not depend on a previous test leaving a patched function behind.

Shared fixtures remain measured. In `src/commands/test.test.ts`, stdin/file-input parity checks assert exact decisions and empty stderr for the shared dispatch fixture. Lifecycle suppression tests first execute cloned fixture exports with an absent or passthrough `beforeHook`, assert ordered handler/observer markers, then assert the original gate suppresses those phases. Do not mutate cached fixture exports or duplicate suppression suites.

Keep constructor and platform tests bounded to public contracts: error identity/fields and the home-directory boundary. Avoid assertions about internal implementation steps.

### Limitations

- **No branch coverage.** Bun does not support branch coverage metrics ([oven-sh/bun#7100](https://github.com/oven-sh/bun/issues/7100)). Only line and function coverage are available.
- **No E2E coverage.** E2E tests spawn the compiled binary as a subprocess. A compiled Bun binary cannot be instrumented for coverage ([oven-sh/bun#17867](https://github.com/oven-sh/bun/issues/17867)). Coverage metrics reflect unit tests only.

## Hook-pack report

Engine coverage excludes only `.clooks/vendor/plugin/**` in addition to the existing temporary-file exclusion. All three `src/default-hooks/*.test.ts` files still run in normal units, including their imported pack tests. E2E and native discovery are unchanged. These are coverage measurement exclusions, not test discovery exclusions.

`bun run test:coverage:hooks` runs `CLAUDECODE=1 bun test --config=./hookcoverage.toml --coverage ./src/default-hooks/`. The explicit path selects the three actual source test files; their imports exercise the vendored hooks. The standalone config reports text and `coverage/hooks/lcov.info`, skips test-file measurement, and excludes `src/**`, `test/**` and temporary files from measurement. It does not inherit the engine threshold or vendor exclusion. This is report-only: test failures still fail the command, but no hook percentage gate is set. Hook-pack policy belongs with the marketplace owners; this command is a local report, not a marketplace configuration change.

Use the equals-form config flag with Bun 1.3.10. A separated `--config ./hookcoverage.toml` did not select the alternate config in validation. See the [official Bun CLI configuration reference](https://bun.com/docs/runtime) for the config option; verify behavior against the installed version.

Validate with the existing Docker image and read-only current source, test, vendor, package and both TOML mounts. The standard E2E wrapper mounts both configs; when directly running package scripts in an existing image, also mount current `package.json` rather than using baked metadata. Preserve reports from the disposable container if needed. Engine LCOV must contain positive source records and zero vendor records; hook LCOV must contain positive vendor records and no engine/support records. A successful process with an empty report is not evidence of coverage.

See [Testing Architecture](../testing.md) for the Docker entrypoint and sandbox conventions. The config regression in `test/e2e/validation-config.e2e.test.ts` pins the narrow exclusions, report-only hook policy, read-only mount and both scripts' success/failure propagation. A tiny synthetic fixture also runs both real commands and checks exact LCOV ownership, engine threshold failure and below-threshold hook success. Actual pack ownership still requires running the real reports, not just the fixture.
