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

A Lefthook pre-commit hook runs `bun run test:e2e:build && bun run test:e2e:run --coverage src/`. It builds the existing test image before running the full unit coverage suite in Docker, including subprocess tests that refuse host execution. Pass coverage arguments directly to `test:e2e:run`, not the compound `test:e2e` script. The entrypoint typechecks, compiles, and executes `bun test --coverage src/`; failures propagate through the Docker command and hook. The image supplies `CLAUDECODE=1` and the Docker test marker. No tests are excluded to accommodate host execution, and the separate E2E hook remains unchanged.

The package script `test:coverage` remains `CLAUDECODE=1 bun test --coverage src/` for direct use inside an appropriate test environment. The configured thresholds are 95% lines and functions; a threshold failure is a failed gate even if all test assertions pass. `validation-config.e2e.test.ts` checks the read-only Docker configuration wiring, direct script success/failure status propagation, and entrypoint argument forwarding. It does not establish that the actual suite or commit hook passes; validate those through the normal full hook run. Docker hook output is retained by the caller, but its LCOV file lives in the disposable container unless explicitly preserved in a separate reporting run.

The thresholds in `bunfig.toml` are the ratchet. To raise the bar, increment the values in a separate PR. Thresholds can only move up.

Fault-injection tests should restore each owned spy in `finally` (or the existing scoped teardown), including when an assertion throws. Limit injected filesystem failures to the test's isolated paths and delegate other calls to the original implementation. Shared full-suite coverage must not depend on a previous test leaving a patched function behind.

### Limitations

- **No branch coverage.** Bun does not support branch coverage metrics ([oven-sh/bun#7100](https://github.com/oven-sh/bun/issues/7100)). Only line and function coverage are available.
- **No E2E coverage.** E2E tests spawn the compiled binary as a subprocess. A compiled Bun binary cannot be instrumented for coverage ([oven-sh/bun#17867](https://github.com/oven-sh/bun/issues/17867)). Coverage metrics reflect unit tests only.

## Hook-pack report

Engine coverage excludes only `.clooks/vendor/plugin/**` in addition to the existing temporary-file exclusion. All three `src/default-hooks/*.test.ts` files still run in normal units, including their imported pack tests. E2E and native discovery are unchanged. These are coverage measurement exclusions, not test discovery exclusions.

`bun run test:coverage:hooks` runs `CLAUDECODE=1 bun test --config=./hookcoverage.toml --coverage ./src/default-hooks/`. The explicit path selects the three actual source test files; their imports exercise the vendored hooks. The standalone config reports text and `coverage/hooks/lcov.info`, skips test-file measurement, and excludes `src/**`, `test/**` and temporary files from measurement. It does not inherit the engine threshold or vendor exclusion. This is report-only: test failures still fail the command, but no hook percentage gate is set. Hook-pack policy belongs with the marketplace owners; this command is a local report, not a marketplace configuration change.

Use the equals-form config flag with Bun 1.3.10. A separated `--config ./hookcoverage.toml` did not select the alternate config in validation. See the [official Bun CLI configuration reference](https://bun.com/docs/runtime) for the config option; verify behavior against the installed version.

Validate with the existing Docker image and read-only current source, test, vendor, package and both TOML mounts. The standard E2E wrapper mounts both configs; when directly running package scripts in an existing image, also mount current `package.json` rather than using baked metadata. Preserve reports from the disposable container if needed. Engine LCOV must contain positive source records and zero vendor records; hook LCOV must contain positive vendor records and no engine/support records. A successful process with an empty report is not evidence of coverage.

See [Testing Architecture](../testing.md) for the Docker entrypoint and sandbox conventions. The config regression in `test/e2e/validation-config.e2e.test.ts` pins the narrow exclusions, report-only hook policy, read-only mount and both scripts' success/failure propagation. A tiny synthetic fixture also runs both real commands and checks exact LCOV ownership, engine threshold failure and below-threshold hook success. Actual pack ownership still requires running the real reports, not just the fixture.
