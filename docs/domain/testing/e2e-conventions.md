# E2E Testing — Conventions

The sandbox pattern, the Docker environment gate, the non-root test user, the domain-based test-file taxonomy, and the inline-vs-fixture hook convention. Part of [E2E Testing Architecture](../testing.md).

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

All three invocation methods return `rawExitCode`, `signalCode` and monotonic `elapsedMs` alongside stdout/stderr. The existing numeric `exitCode` still maps a null raw status to 2; inspect the raw fields to distinguish child-selected failure from signal termination. Include `formatDiagnostics(result)` as the second argument to `expect` for subprocess assertions that need failure evidence, for example `expect(result.exitCode, formatDiagnostics(result)).toBe(0)`. This prints both streams and termination metadata only when that assertion fails. Existing assertions without the message do not automatically gain diagnostics. `harness-diagnostics.e2e.test.ts` checks the actual failing-assertion message and real compiled/entrypoint subprocesses.

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
- `agent-adapter` — compiled-binary engine mode adapter selection, default Claude behavior, explicit Claude selection, unknown-agent fail-closed behavior, and agent-specific runtime handling (the earlier placeholder refusal is historical coverage)
- `agent-scoping` — `agents` allowlist eligibility under both adapters: precedence across all five levels, per-event overrides, alias independence, unknown-id warnings, and that an excluded hook's handler (and `beforeHook`/`afterHook`) never runs even though the hook is still imported; marker-file evidence, not empty output, proves which handlers ran
- `vendoring` — `clooks add` pipeline: URL parsing, download, vendor directory layout, validation, `clooks.yml` registration, conflict detection
- `plugin-vendoring` — plugin discovery, vendoring from plugin cache, registration, idempotency, collision detection, `clooks update` command, coexistence with manual hooks, local-scoped plugin registration
- `short-address` — short address resolution, backward compatibility with path-like hooks

### Inline vs fixture hooks
**Shared hooks** that are reused across multiple test files live in `test/fixtures/hooks/`. These are named by behavior (e.g., `allow-all.ts`, `crash-on-run.ts`, `hang-forever.ts`) and represent canonical test scenarios.

**Test-specific hooks** that are unique to a single test are written inline via `sandbox.writeHook()`. This keeps the fixture directory focused on truly shared artifacts and makes individual tests self-contained.

<a id="codex-event-fixtures"></a>
<a id="codex-evidence-levels"></a>
<a id="authorized-real-session-evidence"></a>
<a id="opt-in-native-cli-smoke"></a>
See [Codex Native Testing](codex-native.md) for fixture provenance, evidence levels, real-session limits and opt-in native commands. These anchors preserve existing inbound links.

## Related

- [E2E Testing Architecture](../testing.md) — parent overview, Key Files, Anti-patterns, Gotchas
- [Codex & Approval Coverage](./codex-e2e-coverage.md)
- [Validation History](./validation-history.md) — agent-adapter/policy-boundary milestone evidence, how to run
