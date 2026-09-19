# E2E Testing Architecture

How Clooks validates its core safety invariant — fail-closed behavior — through a hermetic end-to-end test suite that exercises the compiled binary as a subprocess. E2E tests run in a Docker container.

**For agents and subagents:** Docker is a hard dependency of this project and is expected to be available. Use `bun run test:e2e` for E2E or `bun run test:validation` for the combined tooling/coverage/E2E gate; both manage Docker containers. Do **not** run `bun test test/e2e/…` directly — that bypasses the Docker orchestration and trips the `CLOOKS_E2E_DOCKER` guard in `createSandbox()`. If `docker ps` fails, the Docker **daemon/engine is not running** — start it (or alert the user) rather than concluding Docker is unavailable.

This index points to focused sub-docs in `docs/domain/testing/`. The detailed material is split across files to stay under the 300-line per-file domain-doc cap.

## Sub-docs

| Document | Path | Topics |
|----------|------|--------|
| Codex & Approval Coverage | `testing/codex-e2e-coverage.md` | Compiled build format, generated approval registration, build parity, and per-capability Codex E2E coverage (pack discovery, cross-agent pack updates, SessionEnd, current capability surface, local rewrites, empty stdin, token retirement) |
| E2E Conventions | `testing/e2e-conventions.md` | Sandbox pattern, Docker environment gate, non-root test user, domain-based test-file taxonomy, inline vs fixture hooks |
| Validation History | `testing/validation-history.md` | Milestone validation evidence for the agent-adapter/invocation-policy boundary, Codex registration/event/storage work, uninstall decisions, plus how to run and the validation-runner reference |

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
| `test/fixtures/codex/events/` | Codex hook payload fixtures shaped from official Codex wire docs. These are synthetic contract artifacts, not native payload captures. |
| `test/e2e/*.e2e.test.ts` | E2E test files organized by domain. |

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

See [Coverage Ownership](testing/coverage.md) for the engine ratchet, separate hook-pack report, commands and limitations. Coverage exclusions do not change unit, E2E or native test discovery.

## Related

- [Bun Runtime](bun-runtime.md) — compiled binary behavior, relevant to how tests invoke the binary
- [Bash Entrypoint](bash-entrypoint.md) — entrypoint script tested by the `entrypoint` E2E suite
- [Global Hooks](global-hooks.md) — home directory hook architecture tested by the `home-dir` E2E suite
