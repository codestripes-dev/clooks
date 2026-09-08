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
| `test/fixtures/codex/events/` | Codex hook payload fixtures shaped from official Codex wire docs. These are synthetic contract artifacts, not native payload captures. |
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
- `agent-adapter` — compiled-binary engine mode adapter selection, default Claude behavior, explicit Claude selection, unknown-agent fail-closed behavior, and provider-specific runtime handling (the earlier placeholder refusal is historical coverage)
- `vendoring` — `clooks add` pipeline: URL parsing, download, vendor directory layout, validation, `clooks.yml` registration, conflict detection
- `plugin-vendoring` — plugin discovery, vendoring from plugin cache, registration, idempotency, collision detection, `clooks update` command, coexistence with manual hooks, local-scoped plugin registration
- `short-address` — short address resolution, backward compatibility with path-like hooks

### Inline vs fixture hooks
**Shared hooks** that are reused across multiple test files live in `test/fixtures/hooks/`. These are named by behavior (e.g., `allow-all.ts`, `crash-on-run.ts`, `hang-forever.ts`) and represent canonical test scenarios.

**Test-specific hooks** that are unique to a single test are written inline via `sandbox.writeHook()`. This keeps the fixture directory focused on truly shared artifacts and makes individual tests self-contained.

### Codex event fixtures
Codex wire fixtures live under `test/fixtures/codex/events/`. They use the snake_case input field names described by the documentation snapshot, not Clooks' camelCase normalized names. The fixture set is validated by `src/codex-fixtures.test.ts`, which checks coverage of the agreed ten-event target and basic per-event fields without treating the shapes as runtime-captured payloads. This hardcoded coverage check does not discover new upstream events or independently validate the wire contract. Revalidate each fixture against version-specific evidence before adapter consumption.

These historical fixtures remain docs-shaped contract artifacts, not native payload captures. The current PreToolUse unit and compiled E2E suites separately exercise the implemented adapter; passing replay does not upgrade fixture provenance. Live Codex CLI hook spikes should stay opt-in and disposable: use temporary `HOME`, `CODEX_HOME`, and project directories, avoid real `~/.codex` or trust-state changes, and promote only summarized evidence back into docs.

### Codex evidence levels
Keep three kinds of evidence separate:

| Evidence | What it establishes |
|---|---|
| Pinned source inspection (`S`; unsupported capabilities labeled `unsupported`) | Inspected producers, parser branches, consumers and test assertions at an immutable revision. Reading a test is not running it. |
| Actual upstream parser/executor execution (`P`) | Original upstream code executed at that revision with recorded command, exit status and matched/executed test counts. A Clooks replay or local parser mirror does not qualify. |
| Native execution (`L`) | Captured behavior from the actual Codex runtime for the exercised workflow. Source inspection, registration receipts and shell probes do not establish native activation or enforcement. |

As of the 2026-09-07 source audit, exact tag `rust-v0.153.4` is verified to commit `3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`. The ten-event source inspection resolves input/output, failure, codec and identity constraints; it does not upgrade the existing docs-shaped fixtures into captures. Generated schemas are not the upstream runtime validator: the [output parser](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/engine/output_parser.rs#L345-L363) uses Serde. Future conformance coverage must distinguish schema declarations from actual null, unknown-field and discriminator handling, plain allow without rewrite, discarded rewrite-allow reasons versus human-facing `systemMessage`, reserved PermissionRequest fields yielding no decision, exit 2 with blank/nonblank stderr, and ignored successful stderr.

The original offline feasibility probe verified the retained archive but found neither cargo nor rustc in the cached container; **zero upstream tests executed**. The [pinned toolchain](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/rust-toolchain.toml) requires Rust `1.95.0`. The one bounded retry stopped during dependency preparation: `cargo fetch --locked` refused the required update to upstream `Cargo.lock`, exiting 101 after 49 seconds. No tests ran in the retry either. The retry allowance is exhausted; execution remains unverified with no `P` evidence. This does not establish general toolchain unavailability or diagnose why the lockfile needed updating. The owned container was removed, and the label-filtered container listing was empty. Native `L` evidence remains absent. Full genuine-user-turn parity has the concrete [Review limitation](./turn-state.md#codex-source-constraints-and-proposed-mapping); normal best-effort history is approved as a planned mapping with Review as a nonblocking limitation and no special workaround. Provider-isolated history has the completed PreToolUse gate. Prompt-boundary handling is now implemented, with expanded Docker validation passed.

### Agent adapter boundary tests
Historical selector coverage established default/explicit Claude equivalence, unknown-agent refusal, no payload sniffing and Claude-only advisory isolation through units and `test/e2e/agent-adapter.e2e.test.ts`. The original Codex placeholder refusal assertion belongs to that snapshot, not the current adapter; it never established native fail-closed behavior.

### Invocation policy boundary tests

The implementation adds `NormalizedInvocation` with separate public context/private metadata, an invocation-bound result policy, structured diagnostic composition and explicit failure translation. Focused Docker validation of the frozen source passed typecheck/compile and 467 tests across 18 files, with 0 failures, 1,526 assertions and exit 0. Source remained unchanged during that run and the container was removed. That focused pass predates the added QA cases and boundary fixes. The subsequent full Docker unit run passed 2,000 tests across 64 files, with 0 failures, 7,207 assertions and exit 0; source remained unchanged during execution. It includes throwing-result-getter, parallel counter, timeout and overlapping-invocation regressions. On the same frozen source hash, full compiled-binary Docker E2E passed 603 tests across 44 files, with 0 failures, 5,369 assertions and exit 0. Typecheck, lint and format checks passed with 112 existing warnings and 0 errors. No owned containers remained and no host tests or host mutations occurred. These results establish the tested policy boundary and Claude preservation, not Codex runtime support or upstream P/L evidence.

| Test source | Evidence class and assertions |
|---|---|
| `src/engine/execute.policy.test.ts` | Unit (`U`): injects policies directly through the optional tenth `executeHooks()` argument. Checks omitted versus explicit Claude policy, detached full `nextToolInput`, rejection before later hooks/handoff, lifecycle origins, afterHook mutation versus ignored return, malformed results and raw history, parallel contract errors, checker throws, throwing result getters, timeout/late settlements, ordinary crash counters and overlapping invocation isolation. |
| `src/engine/run.agent-adapter.test.ts` | Unit (`U`): injects adapters/policies into the engine. Checks configured no-hooks/no-matches/no-result translation, no-config bypass, and latched failure translation even when diagnostics and adjustment return allow. These are engine-boundary assertions, not a real Codex translator. |
| `test/e2e/agent-adapter.e2e.test.ts` | Compiled Clooks Docker (`D`): runs real Claude handling for default and explicit selection. New cases assert exact public handler/lifecycle keys without private metadata, observer mutation with ignored replacement return, and detachment from later mutation of an author-held nested rewrite. Positive file/phase markers establish execution alongside exact output assertions. |

The injected-policy state assertions use temporary directories and a test `TurnTracker`: accepted handoff creates a file while the same rejected payload creates none; raw lifecycle decisions are recorded separately from policy acceptance; import failures record no started lifecycle; abandoned parallel work records error once. Barrier-controlled late fulfillment/rejection must not change result, files, policy-call count, history or commit count after abort. A throwing result getter must settle as a policy failure without an unhandled rejection or orphaned batch. Ordinary crash-counter tests distinguish siblings settled before abort (both counted) from arrivals after abort (no new counter), while timeout and overlapping-invocation cases check late-effect suppression and private-state separation. These assertions do not establish provider-specific persistent storage isolation, native Codex delivery or recipient file readability. The real Claude Docker cases exercise compiled compatibility, not the injected Codex policy examples. Codex was `supportsRuntime: false` at that completed boundary gate; neither `U` nor `D` substitutes for upstream `P` or native `L` evidence.

### Provider storage helper validation

Provider-aware storage helper validation is separate from Codex runtime acceptance. An early focused Docker run passed 716 tests across 21 files, with 0 failures, 2,317 assertions and exit 0 on unchanged source. It covers the helper-stage source snapshot, not the later integrated runtime or full milestone gates. `getFailurePath()` now has provider-path assertions; provider-aware turn-state directory, boundary, tracker, commit and prune support must not be mistaken for an enabled Codex history flow. Codex runtime was disabled at that helper snapshot; no P/L evidence follows from this run.

### Validation wrapper stability

Freeze each validation wrapper before starting it and leave its bytes unchanged until the process exits. Prepare a separate wrapper for a later attempt instead of editing an active Bash script. Use the verified executable path for external timeout commands (GNU `/usr/bin/timeout` in the current runner); that removes command-resolution ambiguity but does not protect a script being edited during execution.

### Codex PreToolUse integration validation

The completed initial runtime gate covered PreToolUse only; the current ten-event expansion has separate passing validation below. `src/agents/codex/runtime.test.ts`, `src/agents/codex/tool-codecs.test.ts` and `test/e2e/codex-runtime.e2e.test.ts` cover normalization before imports, capability refusal, command/MCP rewrites, human allow annotations, filtered discovery, provider state and inline handoff. These source assertions do not themselves establish passing execution.

Initial integrated validation reported 743 focused tests passing with zero failures. The compiled-binary subset reported 66 passing and 6 failing: five literal diagnostic mismatches and one fixture that registered a home hook as project-local. Those initial results predate the corrected frozen source. These historical results are superseded by the final passing Docker gates below and are not upstream/native evidence. Claude regular-file behavior and repository trust assumptions are unchanged; shared turn-snapshot reads now use `O_NONBLOCK` to avoid a FIFO open hang.

The storage correction is implemented with source tests saved in `src/failures.provider.test.ts` and `src/engine/turn-state.provider.test.ts`. Failure tests cover project/home-only locations, ordinary read/write/recovery, private file mode and staging cleanup, plus provider-directory and state-file symlinks rejected during read/write/clear while foreign sentinel bytes remain unchanged. Turn tests assert linked directories/files yield empty Codex snapshots and leave Claude history unchanged, including after pruning. The shared bounded reader now opens nonblocking and rejects nonregular snapshots before reading. An initial correction check found four helper-union type errors; fixes are saved and that attempt ran zero tests. These source assertions are included in the later full-unit result below; they do not independently establish native behavior.

Unit and compiled-binary Docker tests validate Clooks behavior, not upstream parser/executor or live-native enforcement. Keep per-attempt outcomes in milestone evidence; a passing rerun alone does not establish why an earlier attempt failed.

### Expanded Codex event validation

The saved ten-event implementation adds envelope, result-contract, diagnostic-channel and turn-policy assertions in `src/agents/codex/events.test.ts`. Cases include preserved SessionStart model, canonical Bash optional fields on approval/post events, opaque JSON post responses, unavailable-string compatibility, reserved-field refusal, observer/lifecycle distinction, author Stop continuation versus failure termination, and root/child boundaries with repeated native turn IDs. These source assertions are not passing-run evidence.

The first Docker compile attempt failed with TS2769 on readonly-event `test.each` overloads at the then-current lines 64 and 216; zero tests ran and E2E was skipped. Manifests were unchanged and cleanup completed. The readonly-array overload correction is implemented; the attempt above remains historical zero-test evidence. The generated-runtime-error accounting correction is implemented with `deferRuntimeErrorAudit`, which audits selected blocking errors after ordinary capture and configured accounting. The subsequent focused Docker run reported 898 passing tests and 3 failures in stale PreToolUse-only gating assertions; migrations are implemented and verified by the final passing gates. Final code review reports no findings and confirms the documented P1 behavior; this is not executed full-gate evidence. The completed PreToolUse gates above do not validate this expansion; no upstream P/L evidence is added. Preliminary M3 full Docker E2E passed 774/0 across 46 files with 8,784 assertions (`tmp/codex-runtime-m3/20260908T085502Z-e2e-2DEnPP/output.log`). Static checks passed with 112 lint warnings and 0 errors (`tmp/codex-runtime-m3/20260908T085705Z-static-JM73pR/output.log`). Full units reported 2,167 passes and one test-trap failure: mocked exit 0 was caught by the outer CLI and surfaced as 2. This is a test issue, not an identified production defect; its narrow correction is implemented in frozen `m3-final-5`. Final full gates passed against frozen `m3-final-5`; final code/QA GO is confirmed. M3 is complete and M4 is complete with final code/QA GO; no upstream P/L evidence is added. Final `m3-final-5` Docker validation passed: 2,168 units, 0 failures, 69 files, 8,035 assertions; 774 E2E, 0 failures, 46 files, 8,781 assertions in 98.17 seconds; typecheck/lint/format all exit 0, with 112 lint warnings and 0 errors. Bun was 1.3.10. Before/after source manifests matched `8224ddbd16af5dc77eb6e0cc29db315026378c2d0327c1166fbf5093c88e70ad`; wrapper manifests separately matched before/after; no source changes or owned containers remained. M3 is complete with final code/QA GO; M4 is complete with final code/QA GO. No P/L evidence is added. Artifacts: `tmp/codex-runtime-m3/20260908T085912Z-units-xyOGuo`, `tmp/codex-runtime-m3/20260908T085938Z-e2e-TyxHcI`, and `tmp/codex-runtime-m3/20260908T090136Z-static-edmPtE`.

### Cross-event state coverage
The first test-only expansion passed 923 focused tests and 204 compiled E2E tests with zero failures; manifests remained unchanged and cleanup completed. No production behavior changed. `run.agent-adapter.test.ts` verifies an explicit null turn resolver supplies empty history without legacy fallback or store mutation. Provider-store units separately test stale generation rejection, prune/recreation at an equal generation with a different epoch, and concurrent root/child commits. Repeating commit on the same tracker leaves bytes unchanged: this is tracker idempotence, not native hook retry deduplication.

`codex-state-delivery.e2e.test.ts` covers two sessions/two children with Claude interleaving, unmatched SessionStart reset/preservation, malformed-identity byte preservation, and held Stop writers with/without a root boundary. The no-boundary case is a positive commit control; boundary staleness is a generation proof, distinct from equal-generation epoch recreation in units. Added concurrent-process assertions require three distinct PIDs, positive ready markers, clean completion and exactly one acknowledged append per scope. Stop/SubagentStop delivery cases retain long reasons inline, inspect reminder history, assert no handoff files and reject unsupported controls before delivery. Generated project/global commands are read from actual registration and execute the compiled runtime, with positive reach markers and exact JSON/local-error/advisory channels. Separate SIGTERM, SIGINT, uncaught-exception and unhandled-rejection cases assert local exit 2, exact stderr and no JSON, with timing below the outer deadline so runner timeout cannot impersonate the injected signal. These are local Clooks checks, not native delivery or exactly-once evidence.
### Codex registration tests

Codex registration has unit and compiled-binary E2E coverage without invoking live Codex. Unit tests in `src/agents/codex/settings.test.ts` pin the `.codex/hooks.json` merge rules: exact ten-event registration coverage, one managed Clooks command group per event, idempotent convergence of stale/duplicate Clooks entries, preservation of unrelated hooks and top-level fields, shell quoting for project paths, and conservative unregistration.

`test/e2e/codex-registration.e2e.test.ts` exercises the user-facing CLI through the compiled binary. It verifies `clooks init --agent codex`, idempotent reruns, `clooks init --agent all`, global Codex registration, registration receipts, and selected-agent unhook. Together with `init-journey`, preservation cases cover malformed containers and JSON error envelopes, mixed groups and false ownership matches, symlinks, and non-root parent-directory permission failure followed by retry. That permission E2E proves temporary-file creation failure and retry only, not later write or rename failures. Permission fixtures restore modes in `finally`.

Generated-command probes run real shell commands against an isolated PATH stub without replacing the compiled CLI used by `sandbox.run()`. They capture positive invocation evidence, agent/root/cwd/stdin forwarding, and relocation repair with the old checkout retained or moved away. Nested/non-git roots and worktree cases preserve explicit-root behavior. Concurrent-reader stress coverage checks complete JSON during large CLI changes but can miss publication windows; it is not deterministic proof of atomic publication. Deterministic write and rename fault coverage belongs to units. These tests do not prove upstream discovery, trust, exactly-once invocation, or decision enforcement. Codex event fixtures under `test/fixtures/codex/events/` remain synthetic inputs, not native payload captures.

Receipt launcher cases first establish a positive project invocation, then a global invocation and matching project suppression. The PATH probe appends a call marker and reports agent, explicit root, inherited Claude root, cwd, HOME, runtime/Codex homes and stdin. Fallback cases require another captured invocation; suppression requires an unchanged positive call count, not empty stdout alone. The matrix covers exact four-LF-line receipts, malformed/legacy data, checksum freshness and numeric shape, regular/readable files, missing/nonexecutable/directory launchers, receipt/hooks symlinks, executable launcher symlinks, physical directory aliases, quoted paths, different homes, and unset versus empty runtime overrides. Minimal PATH cases retain Bash, cat and the probe while omitting `cksum` entirely.

Compound compiled CLI regressions commit registration in A while a subprocess-local failing `cksum` prevents publication, reject init in B, then fully clean selected B and recorded A. Another leaves an unknown-event reference in A after unhook, verifies retained identity and rejected B, then explicitly repairs and retries. Launcher-repair regressions start with a valid receipt and a missing or nonexecutable launcher, fail publication after repair, and restore normal PATH before the post-failure project probe. Otherwise a failing checksum stub would hide accidental reactivation. State preflight checks preserve bytes/modes; recovery-write failures precede retirement, and later setup failures retain identity and permit project execution until retry. Exact removal/rename faults remain unit coverage.

The freshness regression edits an unrelated hook command without changing `hooks.json` byte length and restores its original mtime. Project execution must resume despite matching metadata; global re-init publishes the changed checksum and restores suppression. Registration helpers impose a default ten-second deadline on compiled CLI and launcher subprocesses, with isolated environments. The independent POSIX checksum assertion likewise uses a controlled environment and timeout.

Path-resolution smoke preserves the literal spelling of `missing/../alias`: registration reaches the canonical existing destination without creating the cancelled component, but the untraversable original environment value must still produce a positive project invocation. A traversable alias/parent path whose final directory is created by init matches suppression. Passing the canonical destination also matches in both cases; this does not expand path acceptance policy.

Claude-only failure smoke pins the bounded scope exception: repairing a shared launcher can restore an existing matching Codex receipt's eligibility even if later Claude registration fails. Codex state bytes remain unchanged; receipt retirement applies to Codex/all init only.

The inactive-global case deliberately invokes only the project with valid persisted state and records the remaining limitation: a receipt cannot tell whether the native host runs its global hook. Matching unhook restores project eligibility. Old-script migration likewise requires project re-init after global upgrade. Neither scenario is evidence of live Codex activation. `entrypoint` also invokes the real compiled Claude binary through generated commands, asserting home/project/local merging, ordering, shadow replacement, local overrides and positive hook markers. Existing `home-dir` and `config-layering` regressions remain part of the full Docker suite.

`src/registration-file.test.ts` covers strict reader behavior, opaque unknown events during known-event mutation versus all-event inspection, nonregular destinations, file permissions, exclusive temp creation, partial write, chmod, close, and rename faults. Tests assert unchanged destination bytes, closure of opened descriptors, cleanup limited to owned temporary files, and successful retry. Both registrar suites pin byte preservation on rejection/no-op, bounded command recognition, unknown metadata, and mixed/empty groups. Codex canonicalization does not preserve custom options on removed owned entries; it does preserve unrelated entries and metadata on surviving mixed groups.

`src/registration-state.test.ts` covers exact receipt/recovery formats, physical identities and aliases, legacy migration, conflicting records, remaining-reference guards, publication and cleanup faults, retained recovery identity, and retry. Nonregular-file checks include directory and symlink fixtures. Real FIFO creation is Docker-only and bounded; a read guard makes accidental opening fail rather than hang. Checksum coverage pins POSIX stdin output against a fixed vector, rejects missing/failing/malformed utilities, and checks the ten-second publication deadline with injected timeout errors and killed results. Failed checksum publication retains committed hooks and recovery identity without publishing a new receipt.

### Uninstall decisions and recovery

`test/e2e/uninstall-journey.e2e.test.ts` exercises the compiled CLI for both project/global scopes and both initial agent selectors. Full deletion checks cover all-agent cleanup and JSON count aliases, malformed other-agent data before mutation, unknown-event references and repair, second-registrar failure followed by retry, stale selected flags without registration files, and failed flag removal. Selected unhook remains independent of malformed unselected registration. Failure assertions inspect exact registration bytes and retained custom-hook contents; successful earlier file writes are not rolled back after a later failure.

Interactive cases use test-only Docker `expect` through `test/e2e/helpers/uninstall-prompts.exp`, not piped answers or a production TTY bypass. A fixed-width PTY keeps confirmation text from wrapping, including the global prompt's actual selected and recorded registration paths. The driver matches each exact prompt before sending a reply, requires normal CLI exit, captures the transcript, and kills and waits for the child on timeout. The Bun caller has an outer deadline and awaits the driver before sandbox cleanup. Project fixtures retain the established prompt and decline selected unhook, accept deletion, then accept, refuse or cancel required all-agent cleanup. Global fixtures register only the other agent and prove the selected-agent unhook prompt is absent. Additional A/B fixtures accept, refuse or cancel pathful cleanup of both known Codex homes. Both scopes also cancel extra cleanup after accepting selected unhook and deletion. Refusal/cancellation preserves registration bytes, custom hooks and global state. Opposite-scope sentinels prove the command does not modify the other scope.

Every subprocess in these journeys receives temporary `HOME`, `CODEX_HOME`, and `CLOOKS_HOME_ROOT`; no host credentials or environment are copied. The non-root second-registrar failure makes the Codex registration directory unwritable after both registrations exist, then restores permissions in `finally`. It proves failure while creating the second registrar's temporary file, not an injected mid-write/rename failure. Precise writer-stage faults remain unit tests. Global-state tests establish persisted registration/recovery behavior, not native runtime activity.

Coordinate one Docker run at a time when workers share the checkout. The existing entrypoint supports forwarded test paths without a harness change:

```bash
bun run test:e2e
bun run test:e2e src/commands/uninstall.test.ts src/settings.test.ts src/agents/codex/settings.test.ts
```

The second command runs the focused unit files inside the same Docker environment; it does not bypass the E2E entry command. Neither command deploys or replaces the host binary.

### Engine tests must isolate turn-state storage

Mocking discovery, loading, and stdin does not prevent `runEngineCore` from accessing turn-state storage when a fixture contains `session_id`. Give every such test its own temporary `CLOOKS_HOME_ROOT`, or inject the storage boundary where supported, and restore the caller's original environment after each test. A suite-level environment override is insufficient if cleanup deletes it between tests. Otherwise tests can read/write real user state or fail with lock-write warnings in a restricted environment. `src/engine/run.agent-adapter.test.ts` follows this pattern with fresh per-test home isolation and environment restoration, preserving its empty-stderr assertion rather than hiding storage warnings.

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
