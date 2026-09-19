# E2E Testing — Codex & Approval Coverage

Compiled build/approval-registration coverage, build parity, and the per-capability Codex E2E coverage summaries (pack discovery, cross-agent pack updates, SessionEnd, current capability surface, local rewrites, empty stdin, token retirement). Part of [E2E Testing Architecture](../testing.md).

## Compiled Build Format

For `bun run test:approvals-native`, see [native interactive approval probes](interactive-approvals.md): default/baseline mode uses illustrative fixtures; `--generated` builds current Clooks and uses actual init-generated registration through real clients. The generated inventory contains 26 cases across project shell, global-only shell, project non-shell and combined shell registration.

The production [shared interactive approval transport](../interactive-approvals.md)
has separate command/channel and MCP server test boundaries. Its internal runtime
overrides support deterministic clock, liveness and disposable-HOME tests;
`createApprovalServer` supports the SDK's in-memory transport. CLI command tests
exercise shutdown awaiting, signal forwarding and stderr-only help/startup
failure behavior. Compiled SDK subprocess coverage must use `bun run test:e2e`
and the standard binary sandbox, not direct source imports or the native fixture
runner. Focused regressions cover terminal-write cancellation/drain and isolation
of unrelated checks from late cancelled RPC responses. Engine integration and
generated registration are not established by these transport tests. Token-runtime
receipts are historical and do not prove the shared engine checkpoint flow.

`src/interaction/{protocol,channel,storage,server}.test.ts` exercise protocol
validation, exact consent exchanges, bounded retention and SDK/stream lifecycle.
The compiled suite is `test/e2e/interactive-transport.e2e.test.ts`: it connects an
official SDK client to the compiled `mcp` command and uses the real command-side
channel in a disposable subprocess. Cases cover initialization without engine
config execution, neutral unmatched/no-ask/suppressed completion, approvals and
declines, invalid protocol denial, active-check cancellation/EOF/signals and
protocol-only stdout. This is compiled transport evidence, not native client
enforcement or engine ask integration.

Run the focused gate with
`bun run test:e2e ./test/e2e/interactive-transport.e2e.test.ts ./test/e2e/smoke.e2e.test.ts ./test/e2e/agent-adapter.e2e.test.ts`.
Keep source/test inputs frozen while it runs, and retain source hashes and cleanup
results with the receipt. This selection does not establish engine checkpoint
integration or native client conformance; use the full validation gate separately.

`test/e2e/interactive-approvals.e2e.test.ts` exercises the compiled engine with
paired command/MCP interactions. It covers checkpoint ordering, declines,
operation reconfirmation, cancellation and ordinary-path regression controls.
Source tests in `src/engine/{execute.approvals,run.approvals,live-approvals}.test.ts`
cover private execution and lifetime boundaries. Run the engine suite alongside
the transport suite through `bun run test:e2e`; generated registration and real
native-client conformance remain separate from these compiled subprocess tests.

## Generated Approval Registration

Registration unit boundaries are
`src/registration-{approvals,mcp}.test.ts`,
`src/interaction/registration-toml.test.ts` and the existing init/uninstall tests.
They exercise exact ownership, prewrite rejection, selected-agent independence
and preservation of unrelated JSON/TOML content.

`test/e2e/interaction-registration.e2e.test.ts` uses disposable homes/projects,
commands read from generated hooks and an SDK client attached to the generated
server command. Cases exercise both agents/scopes, consent and no-ask paths,
scope suppression, retained IPC, partial remnants, repeat init, copied projects,
disabled native settings, custom Codex homes and Claude layout refusal. Related
init/uninstall/entrypoint suites retain ordinary-path regression coverage.
Run through `bun run test:e2e`, not direct host execution. These are compiled
subprocess proofs; they do not show that a real native client loaded/trusted the
registration or eliminate cold-child readiness limits. Do not run the installer
against real client files to obtain a test receipt.

The separate [generated native smoke](interactive-approvals/generated-registration.md#generated-registration)
runs as `bun run test:approvals-native --generated` with explicit Claude/Codex
binary paths. The generated inventory has 26 structured descriptors; the exact
names and case contracts are maintained in the [full native approval reference](interactive-approvals/generated-registration.md#generated-registration).
Frozen production inputs are typechecked and bytecode-compiled inside Docker,
and actual init identity/effects, refusal and cleanup are asserted with a
scripted local model and replies. Pinned verification: 26 generated native
cases passed on Claude Code 2.1.272 and Codex CLI 0.154.0; typecheck, snapshot
and hash checks, and disposable cleanup passed.

## Build Parity

Production package builds, release cross-compiles and `test/docker-entrypoint.sh` all use `--compile --bytecode --format=esm`. Native Codex tests reach compilation through the same Docker entrypoint. The existing checksum-verified prebuilt override remains unchanged; when validating source-build format, leave `CLOOKS_TEST_BINARY` unset. Docker currently selects floating `oven/bun:1.3`, while release CI reads `.bun-version` (1.3.10); build-flag parity does not imply identical Bun patch versions.

`test/tooling/prebuilt-entrypoint.test.ts` pins all six production package build commands, all five release targets from the parsed workflow, and the Docker compiler's actual arguments while preserving prebuilt selection/failure checks. The standard validation runner hashes and mounts `.github/workflows/release.yml` read-only for that regression. `test/tooling/test-validation.test.ts` pins timing extraction for the new compile trace. These tooling checks alone do not prove runtime compatibility. `test/e2e/smoke.e2e.test.ts` runs the freshly compiled binary for version/help routing, no-config behavior, allow output, an external TypeScript hook with top-level await and a relative import producing exact denial output, and invalid-config fail-closed behavior.

Run focused validation with `bun run test:e2e ./test/e2e/smoke.e2e.test.ts ./test/tooling/prebuilt-entrypoint.test.ts ./test/tooling/test-validation.test.ts`; use `bun run test:e2e` for the full suite. Neither command installs or deploys the binary. The focused command validates actual ESM-bytecode execution because the entrypoint compiles before running tests, not because a source-level test imports CLI modules.

## Codex Pack Discovery Coverage

`src/agents/codex/plugin-discovery.test.ts` exercises disposable user/project/custom homes, physical aliases, empty-home defaults, actual conflicting environment/cwd controls, field provenance, nearest-marker layers, malformed-field batch suppression, unreadable config/cache, configured-only identities, symlink rejection and deterministic selected-version behavior. Cache controls contain discoverable manifests before introducing symlinks; unsafe identities have actual destinations inside temporary roots. Version fixtures cover strict full syntax, local preference, lexical fallback, u64 limits, large prerelease/build numbers and leading-zero build ordering. Syntax-error tests cover errors reported by the required Bun TOML parser, not a claim that Bun rejects every malformed TOML document.

`src/agents/prepare-plugin-packs.test.ts` covers both adapters' DI isolation, empty/missing dependencies, sequential vendoring, one reload, disabled-hook messages, collisions/errors, and successful/null/failed metadata reloads. Engine adapter regressions preserve Codex input-before-discovery/import and no-config gating. No `mock.module()` or production coverage exclusions are introduced.

`test/e2e/codex-plugin-vendoring.e2e.test.ts` invokes compiled Clooks with synthetic Codex payloads and explicit disposable homes. It checks user/project first-event execution, repeated file/config bytes, local/source edits, disabled defaults and overlays, native disable/removal retention, collisions with a proven running custom hook, invalid exports/active manifests, custom home, nested anchors, malformed input/config before imports, and no-env/explicit Claude isolation. Home-only-to-project first discovery separately proves successful SessionStart registration and crash refusal with refreshed project failure storage and no stale no-project advisory. These are compiled fixture tests, not native hook-enforcement evidence. They do not establish origin-aware Claude diagnostics or agent-aware explicit updates.

Run the focused compiled regressions with `bun run test:e2e ./test/e2e/plugin-vendoring.e2e.test.ts ./test/e2e/codex-plugin-vendoring.e2e.test.ts`. Full unit coverage retains the repository's 0.95 line/function thresholds, with Docker coverage invoked through `bun run test:e2e --coverage ./src/`.

## Cross-Agent Pack Updates

`src/commands/update.test.ts` covers legacy discovery DI isolation, agent filtering, structural manifest equality, byte disagreement, same-agent marketplace conflicts, source/destination preflight failures, physical destination aliases, separate config registrations, quoted-key collisions and preserved YAML. A valid earlier candidate carries an import sentinel that remains absent when a later conflict rejects the batch, with a successful import control. `src/claude-settings.test.ts` covers known install/settings identities, loss of unknown-origin warnings, multiple Claude keys, same-destination Codex suppression, aliases and distinct-destination controls. Engine adapter tests verify explicit roots/Codex-home injection and that non-SessionStart/silenced calls do not perform Codex advisory discovery.

`test/e2e/plugin-update-sources.e2e.test.ts` runs the compiled CLI with disposable homes and synthetic events. Cases cover inherited-agent independence, explicit source filtering, all-destination zero-write conflicts, missing sources, vendor aliases, equivalent reordered manifests, project/local registration, disabled defaults, alternating-agent single execution, preserved edits until explicit refresh, native removal retention and positive-guarded Claude advisory suppression. These are runtime integration tests, not native plugin-manager or model-session evidence. Run alongside preservation cases with `bun run test:e2e ./test/e2e/plugin-update-sources.e2e.test.ts ./test/e2e/plugin-vendoring.e2e.test.ts ./test/e2e/codex-plugin-vendoring.e2e.test.ts ./test/e2e/plugin-enabled-activation.e2e.test.ts`.

## Codex SessionEnd Coverage

`src/agents/codex/session-end.test.ts` covers the minimal SessionEnd envelope, nullable transcript path, exact `other` reason, absent/ignored model and permission mode, spoof-resistant null private turn identity, skip-only result policy and local diagnostics. Registration tests cover migration to twelve events, timeout-free owned SessionEnd/Interrupt repair, repeat byte-idempotence and unrelated-hook preservation on uninstall. SessionEnd's native three-second timeout covers the whole pipeline, not individual hooks.

`test/e2e/codex-session-end.e2e.test.ts` invokes the actual registered compiled entrypoint in disposable homes/projects with synthetic source-shaped payloads. It checks empty stdout, local exit-2 failure without closure veto, error-mode/circuit accounting, empty hook-visible history, unchanged real home-store bytes/directory entries and no turn-state creation when absent. This is scoped compiled smoke, not a native Codex launch or closure-delivery proof. The durable fixture `test/fixtures/codex/events/session-end-other.json` documents synthetic provenance. Run focused coverage with `bun run test:e2e ./test/e2e/codex-session-end.e2e.test.ts`; older ten-event native evidence remains historical and does not cover SessionEnd.

Separate [native orderly-shutdown coverage](codex-native/scenarios.md#native-sessionend-shutdown) runs real pinned Codex with generated registration and current compiled Clooks using `scripts/test-codex-native.sh --session-end`. Receipt `session-end-Dr8SSybz` records ten passing tests, one native launch and native SessionEnd with actual hook cleanup via fake tmux. Focused mode publishes evidence only, not a binary. That evidence covers orderly exec completion, not all shutdown paths or live tmux behavior; it does not change the synthetic fixture's provenance.

## Current Codex Capability Coverage

The adapter implements twelve events, including the root-only Interrupt observer.
SessionEnd and Interrupt each register a three-second total pipeline budget.
`src/agents/codex/interrupt.test.ts` and `test/e2e/codex-interrupt.e2e.test.ts`
cover required input, skip-only results, stdout system diagnostics and failures
without cancellation veto, context injection or a new turn boundary.

`src/agents/codex/mcp-input.test.ts`, approval/executor units and
`test/e2e/codex-mcp-input.e2e.test.ts` cover exact null/scalar/array/raw-string
MCP observation, detached snapshots, block/skip, approval binding and record-only
partial patches. Unknown-tool inputs require narrowing; known-tool discrimination
is preserved. These tests do not establish server acceptance of non-object arguments.

`test/e2e/codex-permission-interrupt.e2e.test.ts` covers ordinary PermissionRequest
denial with accepted, omitted-on-output `interrupt:false`; true and effective
mutations remain refused. `src/engine/pretooluse-skip-context.test.ts` and
`test/e2e/pretooluse-skip-context.e2e.test.ts` cover typed PreToolUse skip context,
configured-order accumulation and context-only output on both agents.

Codex handoff is enabled through the shared configured file/pointer path, with
inline fallback on write failure. `test/e2e/codex-handoff.e2e.test.ts` covers
compiled delivery, not native recipient readability. Separate full native receipt
`smoke-3h0FR9X0` passed 26 cases with 28 launches, including seven parent handoff
cases, child reads in three sandbox modes, Interrupt observation and six-shape
MCP denial plus record rewrite/PostToolUse. See [native capability evidence](codex-native/scenarios.md#native-handoff-interrupt-and-mcp)
for scope and snapshot identity; historical gates do not validate later changes.

## Generic Codex Local Rewrites

`src/agents/codex/local-rewrite.test.ts` and `tool-codecs.test.ts` cover object-only local function codecs, unchanged native/namespaced names, opaque own keys, null deletion versus untouched null, undefined no-ops, deep detachment and known public required/optional field validation. Command-only and MCP regression coverage remains in the Codex unit suite.

`test/e2e/codex-local-rewrite.e2e.test.ts` adds compiled sequential full replacements, original-input snapshots, allow/ask rewrites with live approval of each actual replacement, malformed candidate refusal before later hooks/context/handoff/elicitation, and parallel/non-PreToolUse/write_stdin refusal. These are source-shaped replays, not native tool-effect evidence. Run through `bun run test:e2e ./test/e2e/codex-local-rewrite.e2e.test.ts`.

## Empty Stdin Coverage

`src/engine/stdin.test.ts` spies on the native byte reader and checks empty/ASCII-whitespace rejection, single-read behavior, rejection propagation and generic error formatting. Nonempty fixtures compare parsed values or error name/message against both `Blob.json()` and the original `Bun.stdin.json()` in `test/fixtures/native-stdin-json.ts`, including BOM, NBSP, NUL, malformed UTF-8/JSON and valid scalars/objects. The original-reader subprocess uses `process.execPath`, Blob byte input, a finite timeout and isolated cwd/environment. Adapter units preserve early Codex and late Claude reads, config-error order and no-config bypass.

`test/e2e/empty-stdin.e2e.test.ts` exercises the compiled binary with default/explicit Claude and Codex in isolated homes/projects, using an independent diagnostic literal rather than a production import. Positive handler markers are reset before rejected inputs; separate import markers distinguish Claude's allowed module imports from handler execution. Bare Codex allow expects empty stdout; Claude expects its allow JSON. Cases cover empty/whitespace/malformed input, semantic nonobject/missing-event failures, no-config bypass, configured zero hooks and generated-launcher forwarding. Run these through the Docker E2E runner. Blob fixtures avoid incremental child-process pipe writes when characterizing native parsing. These tests establish local runtime/launcher behavior, not sandbox transport repair or native agent enforcement.

## Codex Token Retirement Coverage

`src/router.test.ts` checks that `approve` is no longer a registered command;
Codex input tests preserve token-looking shell text as literal input.
`test/e2e/codex-token-retirement.e2e.test.ts` checks unknown-command routing,
absence of an `approve` help row with positive `mcp` and empty-stderr controls,
no legacy state or empty approvals-directory creation, byte-preservation of
existing database/WAL/SHM files, and attributed `Live approval unavailable`
refusal despite legacy environment and command carriers, without replacement
input or token-retry instructions. The former store/controller/CLI unit suites and store-only
E2E suite are removed.

`test/e2e/codex-approval-runtime.e2e.test.ts` remains live-checkpoint coverage:
legacy storage and token-looking commands cannot grant consent, aliases sharing
a module require independent answers, invalid replacements refuse before
elicitation, and default/explicit Claude without registration refuse asks.
Run both files through `bun run test:e2e`; these compiled subprocess contracts
do not establish native client enforcement.

The [historical fifteen-case native suite](codex-native/approval-cases.md#hybrid-approval-case-evidence)
included six token-retry cases that are no longer in the harness. Its pinned
Codex 0.153.4 receipts establish only the retired implementation, not live
checkpoint behavior. Current native approval coverage is maintained in the
[shared approval reference](interactive-approvals.md).

The separate [Codex native conformance harness](codex-native/approval-cases.md#direct-rewrite-native-policy-controls)
requires 24 cases across 26 launches and 26 helper unit tests. Its two native
policy-denial controls use direct allow-plus-input-rewrite results, not MCP
approval rewrites; they retain shell command-policy and read-only patch safety
coverage independently of the generated 26-case shared-approval suite.

## Hook Author Testing
This document covers Clooks's own E2E suite, which validates Clooks itself. It is **not** the documentation hook authors need.

For the runtime-equivalent harness hook authors use to exercise a single hook against a synthetic event (`clooks test`), see [testing/hook-author-testing.md](hook-author-testing.md). That doc covers the JSON shape, decision-result interpretation, exit-code mapping, and the CI loop pattern with bash + `jq`.

## Related

- [E2E Testing Architecture](../testing.md) — parent overview, Key Files, Anti-patterns, Gotchas
- [E2E Conventions](./e2e-conventions.md) — sandbox pattern, Docker gate, test organization
- [Validation History](./validation-history.md) — agent-adapter/policy-boundary milestone evidence, how to run
