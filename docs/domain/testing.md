# E2E Testing Architecture

How Clooks validates its core safety invariant — fail-closed behavior — through a hermetic end-to-end test suite that exercises the compiled binary as a subprocess. E2E tests run in a Docker container, but the `bun run test:e2e` command handles building and running the container automatically — no manual Docker setup required.

## Overview

Clooks uses a three-layer testing strategy:

1. **Unit tests** (`bun test src/`) — fast, module-level tests for individual functions and components.
2. **E2E tests** (`bun run test:e2e`) — invoke the compiled binary as a subprocess inside a hermetic Docker container, validating the full entrypoint-to-output pipeline. The command builds the container and runs the tests automatically.

The core invariant under test: **no code path where broken clooks silently allows an action through**. Every failure mode — crashes, timeouts, malformed output, missing config — must result in a blocked action, not a silent pass-through.

E2E tests never import modules directly. They invoke the compiled binary as a subprocess via the sandbox helper, ensuring the test exercises the same code path as production: bash entrypoint -> compiled binary -> config resolution -> hook execution -> serialized output.

## Key Files

| Path | Purpose |
|------|---------|
| `test/e2e/helpers/sandbox.ts` | Sandbox factory (`createSandbox`). Creates isolated temp directories, symlinks the binary, provides `run()` for subprocess invocation. |
| `test/Dockerfile` | Base image definition. Based on `oven/bun:1.3`, installs deps, creates a non-root `testuser`. Source is bind-mounted at runtime. |
| `test/docker-entrypoint.sh` | Container entrypoint. Compiles the binary from mounted source, then runs tests. |
| `test/fixtures/hooks/` | Shared hook fixtures used across multiple test files (e.g., allow-all, crash-on-run, hang-forever). |
| `test/fixtures/events/` | Event JSON fixtures representing Claude Code hook payloads. |
| `test/e2e/*.e2e.test.ts` | E2E test files organized by domain. |

## Patterns

### Sandbox pattern

Every E2E test uses `createSandbox()` to get an isolated environment:

- Creates a temp directory with `project/` and `home/` subdirectories.
- Symlinks the compiled binary into the sandbox.
- Sets `HOME` and `CLOOKS_HOME_ROOT` env vars to point at the sandbox's `home/` directory.
- Provides `run()` for subprocess invocation against the binary.
- Provides setup helpers: `writeConfig()`, `writeHook()`, `writeHomeConfig()`, `writeHomeHook()`.

This ensures every test starts from a clean state with no cross-test contamination.

### Docker environment gate

E2E tests are gated behind the `CLOOKS_E2E_DOCKER=true` environment variable, which is set in the Dockerfile. The `createSandbox()` helper checks for this variable and refuses to run if it is not set.

This prevents accidental E2E test execution on a developer's host machine, where filesystem permissions, binary paths, and OS-level behavior may differ from the expected environment.

**Debugging bypass:** To run E2E tests outside Docker during development:

```bash
CLOOKS_E2E_DOCKER=true bun test test/e2e/
```

### Non-root Docker user

The Dockerfile creates a `testuser` with non-root privileges. This is essential because root ignores `chmod` restrictions — filesystem permission tests (e.g., unreadable config files, non-executable hooks) would silently pass under root, masking real bugs.

### Test organization by domain

E2E test files are organized by the domain they exercise, not by implementation module:

- `smoke` — basic binary invocation and output format
- `hook-execution` — standard hook running and result aggregation
- `fail-closed` — crash, error, and missing-output scenarios
- `entrypoint` — bash entrypoint behavior
- `init-journey` — `clooks init` flow
- `fresh-clone` — clone-and-run without setup
- `composability` — multiple hooks per event, sequential and parallel
- `circuit-breaker` / `circuit-breaker-advanced` — failure threshold behavior
- `timeout` / `timeout-advanced` — hook timeout enforcement
- `config-layering` / `config-validation` — config merge and validation
- `adversarial` / `hook-adversarial` — malicious or malformed hooks
- `event-formats` / `cross-event` — event payload handling
- `home-dir` — global hooks from home directory
- `pipeline-edge-cases` — edge cases in the hook pipeline
- `bug-fixes` — regression tests for specific resolved bugs
- `error-cascade-advanced` — cascading failure scenarios
- `stdin-advanced` — stdin piping edge cases
- `environment-edge-cases` — unusual environment configurations
- `vendoring` — `clooks add` pipeline: URL parsing, download, vendor directory layout, validation, `clooks.yml` registration, conflict detection
- `plugin-vendoring` — plugin discovery, vendoring from plugin cache, registration, idempotency, collision detection, `clooks update` command, coexistence with manual hooks, local-scoped plugin registration
- `short-address` — short address resolution, backward compatibility with path-like hooks

### Inline vs fixture hooks

**Shared hooks** that are reused across multiple test files live in `test/fixtures/hooks/`. These are named by behavior (e.g., `allow-all.ts`, `crash-on-run.ts`, `hang-forever.ts`) and represent canonical test scenarios.

**Test-specific hooks** that are unique to a single test are written inline via `sandbox.writeHook()`. This keeps the fixture directory focused on truly shared artifacts and makes individual tests self-contained.

### How to run

```bash
# Full E2E suite (builds base image + runs all tests)
bun run test:e2e

# Fast re-run without rebuild (bind-mounts source, picks up changes instantly)
bun run test:e2e:run

# Run a specific test file
bun run test:e2e:run -- test/e2e/smoke.e2e.test.ts

# Rebuild base image (only needed when dependencies change)
bun run test:e2e:build

# Unit tests only
bun test src/

# Single E2E test file (with env bypass for local debugging)
CLOOKS_E2E_DOCKER=true bun test test/e2e/fail-closed.e2e.test.ts
```

The Docker image contains only the base environment (Bun, git, testuser, `node_modules`). Source code and tests are bind-mounted at runtime via `-v` flags, so source changes are picked up on the next `test:e2e:run` without rebuilding the image. The `test/docker-entrypoint.sh` script compiles the binary from the mounted source before running tests.

## Anti-patterns

### Never gate a negative assertion on `stdout.length > 0`

The sandbox's `run()` may return empty `stdout` for several reasons: the hook didn't match the event, the engine hit a silent early-exit, or the binary crashed. If a test asserts "advisory text should NOT appear" but does so inside `if (result.stdout.length > 0) { … }`, a crashed or short-circuited binary satisfies the assertion vacuously — the test passes for the wrong reason.

When writing a negative assertion, either:

- Seed a sentinel hook that is guaranteed to fire for the event under test (so `stdout` is always non-empty), then parse unconditionally and assert on `systemMessage` / `additionalContext`.
- Assert on filesystem state instead (the vendor file does not exist, the yml does not contain the entry, etc.). Filesystem assertions cannot be satisfied by an empty-stdout short-circuit.

Do not assume empty stdout means "nothing happened so the assertion holds." In a fail-closed system, empty stdout often means "something went very wrong and the engine didn't emit anything." That is exactly the case a negative assertion must distinguish from the healthy path.

### Every `X should NOT happen` test needs a positive guard that X's code path was reached

A test that asserts "shadow config suppresses the hook" must first prove the hook fires without the shadow. Otherwise a silently broken hook (missing export, typo in marker string, wrong event name) passes the negative assertion trivially.

Structure these tests as two phases in the same sandbox:

1. **Baseline.** Run the scenario in the state that should produce X. Assert X happened.
2. **Under test.** Change the one variable the test is about (apply the shadow, enable the silencer, disable the plugin). Assert X no longer happens.

The baseline is not optional padding — it is the only thing that distinguishes "the mitigation worked" from "the code was never exercised at all."

## Gotchas

### PreToolUse deny output drops additionalContext

When a hook denies a `PreToolUse` event, only `permissionDecision` and `permissionDecisionReason` are emitted in the serialized output. The `injectContext` from prior hooks is merged internally by the engine but is not observable in the final JSON output. Tests asserting on deny output should only check for decision fields.

### macOS BSD `date` lacks nanosecond support

The BSD `date` command on macOS does not support `%N` (nanoseconds). Debug log filenames that attempt to use nanoseconds will contain a literal `N` character instead. This only affects the debug logging path and does not impact test correctness.

### `Bun.file().exists()` returns false for directories

If the config file path resolves to a directory rather than a file, `Bun.file().exists()` returns `false`. The engine treats this as "no config found" (silent noop) rather than raising an error. Tests that set up directory paths where config files are expected should be aware of this behavior.

### Infinite synchronous loops defeat Promise.race timeout

The engine uses `Promise.race` to enforce hook timeouts. However, an infinite synchronous loop in a hook starves the event loop, preventing the timeout promise from ever resolving. Only subprocess-level `SIGKILL` can interrupt such hooks. E2E tests for this scenario rely on the subprocess timeout, not the engine timeout.

### `process.exit(0)` bypasses fail-closed

If a hook calls `process.exit(0)`, the process terminates before the engine can produce output. The entrypoint receives a zero exit code with no stdout, which — depending on the event type — may be interpreted as "allow." This is a known edge case where fail-closed semantics are bypassed.

### Context mutation leaks across sequential hooks

When hooks run sequentially, `context.toolInput` modifications in one hook leak to the next because the engine performs a shallow copy of the context object. Tests that assert on context isolation between sequential hooks must account for this behavior.

## Coverage

Unit test coverage is configured in `bunfig.toml` at the project root. The relevant settings:

```toml
[test]
coverageReporter = ["text", "lcov"]
coverageDir = "coverage/unit"
coverageSkipTestFiles = true
coveragePathIgnorePatterns = ["**/tmp/**"]

[test.coverageThreshold]
lines = 0.5
functions = 0.5
```

Coverage is **not** enabled by default. Running `bun test src/` is the fast path — no instrumentation, no threshold checking. Coverage is only enabled explicitly:

```bash
# Run unit tests with coverage (prints per-file table, writes lcov)
bun test --coverage src/

# Convenience alias
bun run test:coverage
```

lcov output is written to `coverage/unit/lcov.info`. The entire `coverage/` directory is gitignored.

### Ratchet enforcement

A Lefthook pre-commit hook runs `bun test --coverage src/` on every commit. Bun enforces the `coverageThreshold` values **per file**, not just in aggregate — if any individual source file drops below 50% line or 50% function coverage, Bun exits non-zero and the commit is blocked.

The thresholds in `bunfig.toml` are the ratchet. To raise the bar, increment the values in a separate PR. Thresholds can only move up.

### Limitations

- **No branch coverage.** Bun does not support branch coverage metrics ([oven-sh/bun#7100](https://github.com/oven-sh/bun/issues/7100)). Only line and function coverage are available.
- **No E2E coverage.** E2E tests spawn the compiled binary as a subprocess. A compiled Bun binary cannot be instrumented for coverage ([oven-sh/bun#17867](https://github.com/oven-sh/bun/issues/17867)). Coverage metrics reflect unit tests only.

## Related

- [E2E Testing Strategy Plan](../plans/PLAN-0009-e2e-testing-strategy.md) — original plan for the E2E test infrastructure
- [Bun Runtime](bun-runtime.md) — compiled binary behavior, relevant to how tests invoke the binary
- [Bash Entrypoint](bash-entrypoint.md) — entrypoint script tested by the `entrypoint` E2E suite
- [Global Hooks](global-hooks.md) — home directory hook architecture tested by the `home-dir` E2E suite
