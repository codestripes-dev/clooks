# E2E Testing Architecture

How Clooks validates its core safety invariant — fail-closed behavior — through a hermetic end-to-end test suite that exercises the compiled binary as a subprocess. E2E tests run in a Docker container.

**For agents and subagents:** Docker is a hard dependency of this project and is expected to be available. Use `bun run test:e2e` for E2E or `bun run test:validation` for the combined tooling/coverage/E2E gate; both manage Docker containers. Do **not** run `bun test test/e2e/…` directly — that bypasses the Docker orchestration and trips the `CLOOKS_E2E_DOCKER` guard in `createSandbox()`. If `docker ps` fails, the Docker **daemon/engine is not running** — start it (or alert the user) rather than concluding Docker is unavailable.

## Empty Stdin Coverage

`src/engine/stdin.test.ts` spies on the native byte reader and checks empty/ASCII-whitespace rejection, single-read behavior, rejection propagation and generic error formatting. Nonempty fixtures compare parsed values or error name/message against both `Blob.json()` and the original `Bun.stdin.json()` in `test/fixtures/native-stdin-json.ts`, including BOM, NBSP, NUL, malformed UTF-8/JSON and valid scalars/objects. The original-reader subprocess uses `process.execPath`, Blob byte input, a finite timeout and isolated cwd/environment. Adapter units preserve early Codex and late Claude reads, config-error order and no-config bypass.

`test/e2e/empty-stdin.e2e.test.ts` exercises the compiled binary with default/explicit Claude and Codex in isolated homes/projects, using an independent diagnostic literal rather than a production import. Positive handler markers are reset before rejected inputs; separate import markers distinguish Claude's allowed module imports from handler execution. Bare Codex allow expects empty stdout; Claude expects its allow JSON. Cases cover empty/whitespace/malformed input, semantic nonobject/missing-event failures, no-config bypass, configured zero hooks and generated-launcher forwarding. Run these through the Docker E2E runner. Blob fixtures avoid incremental child-process pipe writes when characterizing native parsing. These tests establish local runtime/launcher behavior, not sandbox transport repair or native agent enforcement.

## Codex Approval Store Coverage

`src/agents/codex/approval-store.test.ts` and `src/commands/approve.test.ts` cover the private record store and CLI without engine ask integration. Independent Bun processes race first issuance and final two-token consumption with explicit readiness barriers; a real SQLite-lock handshake proves post-lock clock sampling, and a held-lock timeout checks unchanged state plus successful retry. A test-only SQLite trigger forces the production issuance transaction to exceed its configured allocation limit, asserting rollback and recovery. These tests do not mock storage or alter host state.

`test/e2e/codex-approvals.e2e.test.ts` uses isolated homes/projects and the compiled binary for configuration loading, fixture hooks, CLI routing, registration and output. Test-only hooks import the source store to seed and finalize records; the `approve` command exercises the compiled store implementation. No production issuance command exists. The suite checks preserved ordinary hook blocks, exact consumption failures, fixed expiry, state preservation on rejection, home isolation, corruption and non-root storage failures. Run with `bun run test:e2e ./test/e2e/codex-approvals.e2e.test.ts`; this is local store/CLI coverage, not native Codex or runtime ask evidence.

## Codex Approval Runtime Coverage

The hybrid runtime is implemented separately from the store/CLI tests above. Full frozen-source Docker validation passed, including tooling regressions, unit coverage and compiled E2E, with matching before/after source hashes and successful container cleanup. The controller, executor and run-layer unit suites and both approval E2E files were included; this establishes Clooks runtime behavior, not native Codex approval workflows. `src/agents/codex/approvals.test.ts` exercises canonical binding, carrier eligibility/removal, ordered pipeline/config identity, independent per-ask confirmation changes, mixed transports, emitted-input binding, failure precedence and serialized-output checks. `src/engine/execute.approvals.test.ts` checks opt-in detached vote metadata, configured-order parallel observations, raw history, unchanged reducer context/patch behavior and incomplete execution under crashes, load failures, timeout, policy rejection and degradation.

`src/engine/run.approvals.test.ts` exercises run-layer integration with isolated state and injected dependencies. It checks mixed transports, carrier-free public/private normalization, retained reducer fields and emitted patches, binding changes, and block/failure precedence. Early-exit cases cover no-config/no-hook/no-match/no-ask and config/hook degradation, retiring only matching base acknowledgements. Read-count assertions cover absent-store fast paths and cached advisory payloads/errors, including thrown undefined, without rereading stdin. Storage spies check no approval access for Claude and identified SessionStart/PostToolUse events; a separate no-config case identifies the cached event after an existence-check failure. Adjustment/serialization failures, serialized-input mismatch, adjusted denial and injected finalization failure retain approvals; output-write failure after successful consumption leaves tokens consumed. These unit cases passed in the full Docker gate; they do not establish native dispatch. The injected finalization failure checks run-layer refusal, while real transaction rollback and contention are covered by the store tests.

`test/e2e/codex-approval-runtime.e2e.test.ts` exercises actual `ctx.ask` through compiled configuration loading, policy, execution, SQLite, CLI acknowledgement and serialized output. Cases cover inline/registered/mixed retries, two asks, root/child/session/input binding, turn/tool-use ID advancement, changed config/entry/confirmation, approval of the registration command itself, block/failure precedence, codec rewrites, losing-ask patch/context semantics, early-exit retirement and default/explicit Claude preservation. Test fixtures and subprocess homes are isolated. Its bounded dispatch helper checks denied-effect absence and permitted-effect presence for a safe fixture; that helper is not a native Codex executor.

Run the runtime file with `bun run test:e2e ./test/e2e/codex-approval-runtime.e2e.test.ts` and the full frozen-source gate with `bun run test:validation --workers 4`. One validation owner coordinates those runs. Synthetic patch/MCP payloads and compiled output establish Clooks contracts only, not native shell/non-shell approval workflows, native permission enforcement on approved rewrites, activation or release conformance. Historical unsupported-ask refusal probes remain historical evidence; neither they nor the earlier store/CLI pass validate the new fallback. Those compiled tests do not validate native harness or vendored-hook changes. Separate native case-level evidence is described below.

The final expanded native suite passed all 15 mandatory cases with 15 native launches, completion publication, tested-binary export and successful cleanup. Its six hybrid cases cover two-ask inline shell retries, agent-side CLI registration for direct patches, rewrite execution/denial controls, and actual-pack `rm -r` denial until both acknowledgements, successful removal and consumed-token replay refusal. Read-only patch denial uses separate compiled CLI registration simulating the user, outside the native shell sandbox. This is bounded pinned-version, synthetic-model native evidence, not native `rm -rf` allow proof or full conformance. The earlier 14-case partial run remains historical evidence, not the final receipt. See [precise native evidence and limits](testing/codex-native.md#hybrid-approval-case-evidence).

The final full frozen-source Docker validation gate passed with exit 0: 70 tooling tests, 3395 unit tests with coverage, and 1082 compiled E2E tests across 54 E2E files. Before/after source hashes matched and all six container cleanups succeeded. Separate hook-pack coverage also passed. These local gates validate the Clooks runtime and pack regressions; native enforcement evidence comes from the distinct 15-case suite above. Earlier runtime gates retain their historical scope. Final independent code and QA receipt reviews confirmed both gates.

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
- `agent-adapter` — compiled-binary engine mode adapter selection, default Claude behavior, explicit Claude selection, unknown-agent fail-closed behavior, and provider-specific runtime handling (the earlier placeholder refusal is historical coverage)
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
See [Codex Native Testing](testing/codex-native.md) for fixture provenance, evidence levels, real-session limits and opt-in native commands. These anchors preserve existing inbound links.

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

Assign one owner to validation execution and keep mounted source unchanged for the attempt. Persist the exact command, unfiltered output and exit status in an attempt-specific directory under `tmp/`; return the original nonzero status after displaying a log summary. Confirm the expected files and a nonzero test count actually ran. A compile failure means zero executed tests; an all-passing test count with nonzero coverage status is not a passing coverage gate. Do not infer completed checks from a wrapper's name.

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

Coordinate one validation attempt under one owner at a time when sharing the checkout; that attempt may manage multiple isolated worker containers. The existing entrypoint supports forwarded test paths without a harness change:

```bash
bun run test:e2e
bun run test:e2e src/commands/uninstall.test.ts src/settings.test.ts src/agents/codex/settings.test.ts
```

The second command runs the focused unit files inside the same Docker environment; it does not bypass the E2E entry command. Neither command deploys or replaces the host binary.

### Engine tests must isolate turn-state storage

Mocking discovery, loading, and stdin does not prevent `runEngineCore` from accessing turn-state storage when a fixture contains `session_id`. Give every such test its own temporary `CLOOKS_HOME_ROOT`, or inject the storage boundary where supported, and restore the caller's original environment after each test. A suite-level environment override is insufficient if cleanup deletes it between tests. Otherwise tests can read/write real user state or fail with lock-write warnings in a restricted environment. `src/engine/run.agent-adapter.test.ts` follows this pattern with fresh per-test home isolation and environment restoration, preserving its empty-stderr assertion rather than hiding storage warnings.

### How to run

With bunfig's unit root active, the Docker entrypoint uses the explicit default `./test/e2e/` and forwards supplied arguments verbatim. Use explicit paths for focused E2E runs, for example `bun run test:e2e ./test/e2e/smoke.e2e.test.ts`. Bare `test/e2e/...` arguments are Bun name filters beneath `src/`, not explicit file selections, and can run zero tests. The wrapper deliberately does not parse Bun flags or rewrite arguments.

```bash
# Full E2E suite (builds base image + runs all tests)
bun run test:e2e

# Unit tests only
bun test src/
```

The Docker image contains Bun, git, expect, testuser, dependencies and package metadata. Standard `bun run test:e2e` mounts source, tests, schemas, scripts, current package metadata, configuration and `.clooks/vendor/plugin` read-only; the latter maps to `/app/.clooks/vendor/plugin` unconditionally. Shipped-hook tests use actual pack modules rather than copied implementations. The entrypoint requires bunfig, typechecks and compiles before testing. Coordinate one validation attempt under one owner at a time, allowing its managed isolated worker containers, and freeze source throughout. Existing `test:e2e:run` remains direct Docker/Bun argument passthrough; rebuild its image before reuse because its package metadata is baked. Append `src/` or `--coverage src/` for focused units or coverage. These commands do not deploy a host binary.

### Isolated validation runner

The default is four by user preference. Eight was fastest in the retained paired full-suite comparisons of 2/4/8 and adjacent 8/16 runs on the validation machine; sixteen was slower. Choosing four does not revise that benchmark result. Select `--workers 1` or `--workers 2` for lower-resource environments, or explicitly select eight. Compare complete suites on frozen inputs when tuning concurrency without relaxing test limits.

`bun run test:e2e` runs the full E2E suite with four isolated workers by default; `--workers` accepts 1, 2, 4, 8, 16 or 32, and `bun run test:e2e --workers 1` selects serial execution. Supporting a count does not establish a speedup. The underlying command is `bun test/tooling/run-validation.ts e2e`. Each attempt builds once, updates the `clooks-e2e` tag for direct-run reuse and uses the captured immutable image ID for its separate non-root containers. Inputs are mounted read-only with before/after hashes, not copied snapshots. Multiple workers receive deterministic file-size-balanced selections; one receives the full directory. Keep inputs unchanged: an image ID does not freeze mounted source.

Focused/raw arguments, such as `bun run test:e2e ./test/e2e/smoke.e2e.test.ts`, run in one container and are forwarded unchanged after any initial runner `--workers` option. A supplied `--` is forwarded to Bun, not consumed as a runner separator. These invocations retain the image environment and require a positive passing summary; they do not assert the full-suite file manifest. The existing `test:e2e:run` interface is unchanged.

The underlying Bun package launcher may drop empty-string arguments before either wrapper receives them. The runner preserves the arguments it receives, including empty strings, spaces and metacharacters; package-launcher behavior is a separate boundary.

`bun run test:validation` (underlying `bun test/tooling/run-validation.ts all`) is the combined pre-commit gate. It builds once and runs uninstrumented tooling regressions, unsharded engine coverage, then full E2E in separate containers sharing that image ID. Failed earlier phases stop later phases. `--workers 1` selects serial E2E; arbitrary test filters are not accepted in the combined gate. Coverage is retained as attempt-local `unit-lcov.info`; see [Coverage Ownership](testing/coverage.md) for validation and threshold semantics.

Finish formatting and generation before validation, then keep input writers stopped. If parallel hooks change inputs, a before/after hash mismatch fails validation even when tests pass; wait for writers to finish and rerun the full validation. Hash comparison neither prevents races nor detects every transient write restored to its original bytes.

Only full E2E worker containers unset `CLAUDECODE`, `REPL_ID` and `AGENT` to retain Bun's verbose file/case evidence; tooling, coverage and raw passthrough retain the image environment. Full-suite acceptance requires exact selected-file headers, positive passes per file and consistent nonzero summary counts. The original entrypoint still typechecks/compiles; external `bash -x` tracing with timestamped `PS4` supplies phase timings without entrypoint edits. Unique `tmp/isolated-e2e-workers/run-*` directories retain manifests, image ID, raw argv/logs/statuses, coverage output when applicable and `report.json`. Worker, evidence, cleanup and detected-source-mutation failures remain nonzero. Docker-only `test/tooling/test-validation.test.ts` contains helper and fake-Docker regressions; these do not replace real full-suite trials.

Cleanup verifies the attempt ownership label and removes the identified container, preserving foreign name collisions. Structured inspection stdout is kept separate from warnings on stderr. Cancellation escalates for the owned process group even if its leader exits before a TERM-resistant descendant. Use `--workers 1` for a serial comparison; worker count changes scheduling, not the selected E2E files or timeout limits.

### Provider context regressions

`test/e2e/provider-context.e2e.test.ts` covers compiled engine dispatch with unset/explicit Claude and Codex, raw-provider spoofing, and before/handler/after receipt in sequential and parallel groups. Exact per-hook logs and returned context markers prove execution. Compiled synthetic harness cases cover explicit identity, environment-independent defaults and invalid-value rejection before dispatch. Helper units and explicit-adapter engine tests complement source/generated declaration checks in `test/types/provider-context.types.ts` and `scripts/verify-types-emit.ts`. These are local Clooks regressions, not native Codex conformance or proof of every provider capability.

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
