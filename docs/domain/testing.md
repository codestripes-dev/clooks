# E2E Testing Architecture

How Clooks validates its core safety invariant — fail-closed behavior — through a hermetic end-to-end test suite that exercises the compiled binary as a subprocess. E2E tests run in a Docker container.

**For agents and subagents:** Docker is a hard dependency of this project and is expected to be available. Always use `bun run test:e2e` (it builds and runs the container for you). Do **not** run `bun test test/e2e/…` directly — that bypasses the Docker orchestration and trips the `CLOOKS_E2E_DOCKER` guard in `createSandbox()`. If `docker ps` fails, the Docker **daemon/engine is not running** — start it (or alert the user) rather than concluding Docker is unavailable.

## Hook Author Testing

This document covers Clooks's own E2E suite, which validates Clooks itself. It is **not** the documentation hook authors need.

For the runtime-equivalent harness hook authors use to exercise a single hook against a synthetic event (`clooks test`), see [testing/hook-author-testing.md](testing/hook-author-testing.md). That doc covers the JSON shape, decision-result interpretation, exit-code mapping, and the CI loop pattern with bash + `jq`.

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
| `test/fixtures/codex/events/` | Codex hook payload fixtures shaped from official Codex wire docs. These are contract artifacts until the Codex adapter exists. |
| `test/e2e/*.e2e.test.ts` | E2E test files organized by domain. |

## Patterns

### Sandbox pattern

Every E2E test uses `createSandbox()` to get an isolated environment:

- Creates a temp directory with `project/` and `home/` subdirectories.
- Symlinks the compiled binary into the sandbox.
- Sets `HOME` and `CLOOKS_HOME_ROOT` env vars to point at the sandbox's `home/` directory.
- Provides `run()` for subprocess invocation against the binary.
- Provides `runAsync()` for invocations that must overlap in time.
- Provides setup helpers: `writeConfig()`, `writeHook()`, `writeHomeConfig()`, `writeHomeHook()`.

`run()` is synchronous (`Bun.spawnSync`) and is the default for everything. `runAsync()` is its promise-returning sibling built on `Bun.spawn`, with the same binary, environment, and defaults; use it only when a test needs several invocations in flight at once — lock contention, overlapping writers — and `Promise.all` the batch. A test that merely runs the binary repeatedly should stay on `run()`, which keeps ordering obvious.

This ensures every test starts from a clean state with no cross-test contamination.

### Docker environment gate

E2E tests are gated behind the `CLOOKS_E2E_DOCKER=true` environment variable, which is set in the Dockerfile. The `createSandbox()` helper checks for this variable and refuses to run if it is not set.

This prevents accidental E2E test execution on a developer's host machine, where filesystem permissions, binary paths, and OS-level behavior may differ from the expected environment.

Use `bun run test:e2e` for all E2E validation. Do not bypass the Docker guard, including during debugging.

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
- `agent-adapter` — compiled-binary engine mode adapter selection, default Claude behavior, explicit Claude selection, unknown-agent fail-closed behavior, and the reserved Codex placeholder fail-closed diagnostic
- `vendoring` — `clooks add` pipeline: URL parsing, download, vendor directory layout, validation, `clooks.yml` registration, conflict detection
- `plugin-vendoring` — plugin discovery, vendoring from plugin cache, registration, idempotency, collision detection, `clooks update` command, coexistence with manual hooks, local-scoped plugin registration
- `short-address` — short address resolution, backward compatibility with path-like hooks

### Inline vs fixture hooks

**Shared hooks** that are reused across multiple test files live in `test/fixtures/hooks/`. These are named by behavior (e.g., `allow-all.ts`, `crash-on-run.ts`, `hang-forever.ts`) and represent canonical test scenarios.

**Test-specific hooks** that are unique to a single test are written inline via `sandbox.writeHook()`. This keeps the fixture directory focused on truly shared artifacts and makes individual tests self-contained.

### Codex event fixtures

Codex wire fixtures live under `test/fixtures/codex/events/`. They use the snake_case input field names described by the documentation snapshot, not Clooks' camelCase normalized names. The fixture set is validated by `src/codex-fixtures.test.ts`, which checks coverage of the agreed ten-event target and basic per-event fields without treating the shapes as runtime-captured payloads. This hardcoded coverage check does not discover new upstream events or independently validate the wire contract. Revalidate each fixture against version-specific evidence before adapter consumption.

Until the Codex adapter ships, these fixtures are not E2E inputs for Clooks. They are docs-shaped, runtime-unverified contract artifacts for later normalization, translation, and registration tests. Live Codex CLI hook spikes should stay opt-in and disposable: use temporary `HOME`, `CODEX_HOME`, and project directories, avoid real `~/.codex` or trust-state changes, and promote only summarized evidence back into docs.

### Agent adapter boundary tests

The adapter boundary has unit and E2E coverage. Unit tests cover selector behavior, no payload sniffing, Claude event recognition/final-output behavior, Claude plugin/advisory isolation, and the Codex placeholder's no-op/fail-closed contract. The E2E file `test/e2e/agent-adapter.e2e.test.ts` exercises the compiled binary in engine mode with a Claude fixture and asserts:

- unset `CLOOKS_AGENT` produces the existing Claude Code output shape
- `CLOOKS_AGENT=claude-code` matches the unset path
- unknown `CLOOKS_AGENT` values fail closed before hook execution
- `CLOOKS_AGENT=codex` fails closed with a not-implemented diagnostic until Codex runtime support exists

### Codex registration tests

Codex registration has unit and compiled-binary E2E coverage without invoking live Codex. Unit tests in `src/agents/codex/settings.test.ts` pin the `.codex/hooks.json` merge rules: exact ten-event registration coverage, one managed Clooks command group per event, idempotent convergence of stale/duplicate Clooks entries, preservation of unrelated hooks and top-level fields, shell quoting for project paths, and conservative unregistration.

`test/e2e/codex-registration.e2e.test.ts` exercises the user-facing CLI through the compiled binary. It verifies `clooks init --agent codex`, idempotent reruns, `clooks init --agent all`, global Codex registration, agent-aware global dedup flags, and selected-agent unhook. Together with `init-journey`, preservation cases cover malformed containers and JSON error envelopes, mixed groups and false ownership matches, symlinks, and non-root parent-directory permission failure followed by retry. That permission E2E proves temporary-file creation failure and retry only, not later write or rename failures. Permission fixtures restore modes in `finally`.

Generated-command probes run real shell commands against an isolated PATH stub without replacing the compiled CLI used by `sandbox.run()`. They capture positive invocation evidence, agent/root/cwd/stdin forwarding, and relocation repair with the old checkout retained or moved away. Nested/non-git roots and worktree cases preserve explicit-root behavior. Concurrent-reader stress coverage checks complete JSON during large CLI changes but can miss publication windows; it is not deterministic proof of atomic publication. Deterministic write and rename fault coverage belongs to units. These tests do not prove upstream discovery, trust, exactly-once invocation, or decision enforcement. Codex event fixtures under `test/fixtures/codex/events/` remain synthetic inputs for future normalization and translation tests.

`src/registration-file.test.ts` covers strict reader behavior, opaque unknown events during known-event mutation versus all-event inspection, nonregular destinations, file permissions, exclusive temp creation, partial write, chmod, close, and rename faults. Tests assert unchanged destination bytes, closure of opened descriptors, cleanup limited to owned temporary files, and successful retry. Both registrar suites pin byte preservation on rejection/no-op, bounded command recognition, unknown metadata, and mixed/empty groups. Codex canonicalization does not preserve custom options on removed owned entries; it does preserve unrelated entries and metadata on surviving mixed groups.

### Uninstall decisions and recovery

`test/e2e/uninstall-journey.e2e.test.ts` exercises the compiled CLI for both project/global scopes and both initial agent selectors. Full deletion checks cover all-agent cleanup and JSON count aliases, malformed other-agent data before mutation, unknown-event references and repair, second-registrar failure followed by retry, stale selected flags without registration files, and failed flag removal. Selected unhook remains independent of malformed unselected registration. Failure assertions inspect exact registration bytes and retained custom-hook contents; successful earlier file writes are not rolled back after a later failure.

Interactive cases use test-only Docker `expect` through `test/e2e/helpers/uninstall-prompts.exp`, not piped answers or a production TTY bypass. A fixed-width PTY keeps confirmation text from wrapping. The driver matches each exact prompt before sending a reply, requires normal CLI exit, captures the transcript, and kills and waits for the child on timeout. The Bun caller has an outer deadline and awaits the driver before sandbox cleanup. Project fixtures decline selected unhook, accept deletion, then accept, refuse or cancel required all-agent cleanup. Global fixtures register only the other agent and prove the selected-agent unhook prompt is absent. Both scopes also cancel extra cleanup after accepting selected unhook and deletion. Refusal/cancellation preserves registration bytes, custom hooks and global flags. Opposite-scope sentinels prove the command does not modify the other scope.

Every subprocess in these journeys receives temporary `HOME`, `CODEX_HOME`, and `CLOOKS_HOME_ROOT`; no host credentials or environment are copied. The non-root second-registrar failure makes the Codex registration directory unwritable after both registrations exist, then restores permissions in `finally`. It proves failure while creating the second registrar's temporary file, not an injected mid-write/rename failure. Precise writer-stage faults remain unit tests. Global-state tests here cover existing flag cleanup, not registration receipts or native runtime activity.

Coordinate one Docker run at a time when workers share the checkout. The existing entrypoint supports forwarded test paths without a harness change:

```bash
bun run test:e2e
bun run test:e2e src/commands/uninstall.test.ts src/settings.test.ts src/agents/codex/settings.test.ts
```

The second command runs the focused unit files inside the same Docker environment; it does not bypass the E2E entry command. Neither command deploys or replaces the host binary.

### Engine tests must isolate turn-state storage

Mocking discovery, loading, and stdin does not prevent `runEngineCore` from accessing turn-state storage when a fixture contains `session_id`. Give every such test its own temporary `CLOOKS_HOME_ROOT`, or inject the storage boundary where supported, and restore the caller's original environment after each test. A suite-level environment override is insufficient if cleanup deletes it between tests. Otherwise tests can read/write real user state or fail with lock-write warnings in a restricted environment. `src/engine/run.agent-adapter.test.ts` currently contains this isolation gap; correcting it must preserve its empty-stderr assertion rather than hide the storage warning.

### How to run

```bash
# Full E2E suite (builds base image + runs all tests)
bun run test:e2e

# Unit tests only
bun test src/
```

The Docker image contains only the base environment (Bun, git, expect, testuser, `node_modules`). Source code and tests are bind-mounted at runtime via `-v` flags, so `bun run test:e2e` picks up current changes. The `test/docker-entrypoint.sh` script typechecks and compiles the binary from the mounted source before running tests. Coordinate one Docker run at a time when multiple workers share the checkout.

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

### PreToolUse deny output may carry additionalContext

When a hook denies a `PreToolUse` event, the serialized output emits `permissionDecision: "deny"` plus `permissionDecisionReason`. The translator also emits `additionalContext` when the winning deny result has an `injectContext` field, and the multi-hook reducer accumulates `injectContext` from allow/ask losers into the deny winner. Tests asserting on deny output should check for `additionalContext` whenever a deny carries (or accumulates) injected context — see the positive reference in `src/engine.test.ts` ("PreToolUse block with injectContext → additionalContext emitted alongside deny fields").

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

- [Bun Runtime](bun-runtime.md) — compiled binary behavior, relevant to how tests invoke the binary
- [Bash Entrypoint](bash-entrypoint.md) — entrypoint script tested by the `entrypoint` E2E suite
- [Global Hooks](global-hooks.md) — home directory hook architecture tested by the `home-dir` E2E suite
