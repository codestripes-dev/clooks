# Codex Runtime M3 Evidence

Date: 2026-09-08 UTC. M3 is complete with final code-review milestone GO; final QA GO is confirmed. M4 is authorized and in progress. Final units passed 2,168/0, E2E 774/0, and typecheck/lint/format all exited 0 on matching frozen manifests. M3 validation source remains the recorded frozen snapshot; M4 now has separate implementation and acceptance. This writer inspected artifacts and did not run tests. No native P/L evidence or release-confidence upgrade.

## Final Validation

Recorded freeze reference: `m3-final-5-testtrap` (parent shorthand `m3-final-5`). Artifact directories are under `tmp/codex-runtime-m3/`.

| Gate | Exact command | Result | Artifact directory |
| --- | --- | --- | --- |
| U | `bun run test:e2e src/` | 2,168 pass, 0 fail, 69 files, 8,035 assertions, 2.96 seconds; exit 0 | `20260908T085912Z-units-xyOGuo/` |
| D | `bun run test:e2e` | 774 pass, 0 fail, 46 files, 8,781 assertions, 98.17 seconds; exit 0 | `20260908T085938Z-e2e-TyxHcI/` |
| Static | `bash /opt/development/clooks/tmp/codex-runtime-m3/launch-static.sh static` | Docker typecheck, lint and format:check each exit 0; wrapper exit 0; lint 112 warnings, 0 errors | `20260908T090136Z-static-edmPtE/` |

All six before/after source manifest files independently hash to `8224ddbd16af5dc77eb6e0cc29db315026378c2d0327c1166fbf5093c88e70ad`: a manifest-file fingerprint, not a Git commit or wrapper hash. Metadata records unchanged source and wrappers and tee exit 0 for each gate. Parent confirms no owned containers remain. Bun is 1.3.10. The unit `test-image-at-run.txt` records `sha256:1b2ea73774984ea7ece193dc991cf91fae846be7d55ebc2d4bade99947d77f53`; E2E records `sha256:645fb95d4cb3aa950717cf36d058d46fc999d43804a1933520abcca830abfb0c`, also explicitly executed by the static Docker command. Equal source inputs do not imply equal image IDs.

## Interface and Review Check

The reviewed private refinement is optional `InvocationResultPolicy.deferRuntimeErrorAudit`, enabled by Codex. Selected generated runtime failures are audited after ordinary error configuration/accounting; author results and parallel contract violations remain immediately audited. This corrects the earlier bypass of continue/trace/degraded behavior, without a new public author API or test selector. M3 reuses existing normalization, translation, diagnostics and turn-policy boundaries. The final test-trap correction is test-only, parent-reported with production unchanged; the full passing unit rerun closes that failure. Final code-review milestone GO and final QA GO are confirmed. History remains enabled under the accepted best-effort ordinary prompt policy with the Review limitation nonblocking; no workaround scope or native confidence is added.

## Historical Preliminary Full Validation

Snapshot `m3-final-4-formatted` follows the parent-reported verified 12-file formatting export at `tmp/codex-runtime-m3/20260908T085208Z-format-export-MiPTwd/` (reported hash prefix `86469d...`, not an independently recorded full fingerprint here).

| Evidence | Exact command | Outcome | Artifact directory under `tmp/codex-runtime-m3/` |
| --- | --- | --- | --- |
| Full U, failed | `bun run test:e2e src/` | 2,167 pass, 1 fail, 2,168 tests, 69 files, 8,021 assertions, 3.71 seconds; exit 1 | `20260908T085412Z-units-8yk4Aw/` |
| Full D, preliminary pass | `bun run test:e2e` | 774 pass, 0 fail, 46 files, 8,784 assertions, 98.45 seconds; exit 0 | `20260908T085502Z-e2e-2DEnPP/` |

Both attempts' saved metadata report `source_changed=false`, `wrappers_changed=false` and tee exit 0. The full-unit failure was `explicit Codex selection validates SessionStart without payload-sniffing a Claude fallback`, at `src/engine/run.agent-adapter.test.ts:381`: the exit trap returned 2 where the test expected 0. Parent identified a test-trap correction with production unchanged. The final post-fix gates above supersede this failed snapshot; its preliminary E2E pass alone did not close the unit failure. Its 8,784 E2E assertions are historical, distinct from the final 8,781.

QA migration GO measures plugin discovery/vendoring behavior; these tests do not contain a direct Claude settings-read spy and do not prove absence of such reads.

## Recorded Attempts

Commands ran from `/opt/development/clooks`. The project harness typechecks/builds and runs tests inside Docker. Artifact directories below are relative to `tmp/codex-runtime-m3/`; each retains `metadata.txt`, `output.log`, `docker-commands.log` and source manifests. All three attempts report `source_changed=false`, `wrappers_changed=false`, and tee exit 0. Each has a 600-second deadline and 10-second kill grace; Codex replay subprocesses also have their own 10-second bound and disposable HOME/CODEX_HOME/project roots.

| Snapshot / evidence | Exact command | Outcome | Artifact directory |
| --- | --- | --- | --- |
| `m3-first-1`, compiler-only | `bun run test:e2e src/agents/ src/engine/ src/engine.test.ts src/failures.test.ts src/failures.provider.test.ts src/lifecycle-integration.test.ts` | Typecheck exit 2, zero tests. New event-unit `test.each` passed a readonly event tuple to incompatible overloads, producing downstream unknown/EventName errors. Not an E2E failure | `20260908T084107Z-focused-RcykT2/` |
| `m3-second-2`, focused U | Same source-test command above | 898 pass, 3 fail, 901 tests, 25 files, 3,134 assertions; exit 1 | `20260908T084758Z-focused-u3XKTK/` |
| `m3-second-2`, focused D | `bun run test:e2e test/e2e/codex-events.e2e.test.ts test/e2e/codex-runtime.e2e.test.ts test/e2e/agent-adapter.e2e.test.ts` | 178 pass, 0 fail, 3 files, 3,503 assertions, 31.08 seconds test time; command exit 0 | `20260908T084828Z-focused-e2e-NmgbcG/` |

Metadata times: compiler-only 08:41:07-08:41:13Z; focused U 08:47:58-08:48:05Z; focused D 08:48:28-08:49:04Z. Bun reports `1.3.10 (30e609e0)` in the focused D log. Build stdout reports image `sha256:5d2f0de9a78290181290f5d5cc7696569379f81bddf0d9f2fbb48efee5395e03`; the actual test invocation names the `clooks-e2e` tag, so this is a build-reported ID rather than a separately captured runtime digest.

All four before/after source manifest files for the second snapshot's U and D attempts hash to `28f80c8f5b78dd621cfb2970c28855055e1526a62d1c56cf0c12408b3489906d`. This is a **manifest-file fingerprint, not a Git commit**. It bounds this focused proof; later unit fixes or final formatting require their own frozen-source evidence.

## Historical Failed Expectations

The second snapshot's three unit failures are retained, not counted as passes:

- `src/agents/select.test.ts:92`, `Codex recognizes gated events without enabling their execution or Claude plugins`: parsed undefined output after the formerly gated event became a valid no-op.
- `src/engine/run.agent-adapter.test.ts:372`, `does not payload-sniff Claude-shaped stdin when CLOOKS_AGENT selects Codex`: stale unsupported-event expectation; malformed selected-Codex SessionStart now reports missing cwd.
- `src/engine/run.agent-adapter.test.ts:726`, `a gated event refuses execution before plugin discovery or vendoring`: same stale gate expectation. The negative plugin/import guarantee still needs preservation with an appropriate current envelope.

These stale pre-M3 expectations and the readonly-table compiler error were corrected before final validation. The final 2,168/0 unit run closes their execution gate; the earlier compiler attempt still ran zero tests and the failed runs remain recorded.

## Focused Compiled Coverage

The 178 passing cases span **all three named files**, not 178 new nine-event tests. The acceptance matrix maps their E/F/C IDs. New `codex-events.e2e.test.ts` cases use real TypeScript modules, fresh import/handler/observation markers, full source-shaped envelopes, literal wire expectations and bounded subprocesses. Only the obsolete nine unsupported-runtime cases were removed from `codex-runtime.e2e.test.ts`; its PreToolUse/storage tests and the existing Claude preservation suite remain.

| Named family | Focused D proof |
| --- | --- |
| `<event>: source-shaped input reaches a real skip handler without native control output`; supported event decisions/context | All nine remaining events have reachable handlers and no-ops. SessionStart model remains public; start context is main/child-shaped; PermissionRequest allow is an explicit grant; PreCompact block stops compaction; PostCompact is skip-only; stop block requests continuation |
| Required/nullable input cases; nested PermissionRequest description; PostToolUse response/input cases | Required common/event fields reject before import; designated absence/null sentinels remain compatibility; no fabricated PermissionRequest tool-use ID or compact permission mode. PostToolUse preserves arbitrary JSON responses and refuses non-record input |
| Unsupported field parameters; afterHook mutation; lifecycle block | Falsy/null permission rewrites/updates/interrupt, prompt title on all arms, MCP output and foreign controls cannot disappear. Observer mutation is audited; start/observer lifecycle blocks use event-aware failure, not widened methods |
| `unsupported allow fails before a reachable later block`; two bounded parallel variants | Sequential downstream markers stay absent after rejection. One parallel case aborts a pending stronger block; another lets PermissionRequest allow settle before rejecting an unsupported skip, draining settlement microtasks through a bounded task boundary |
| `selected crash refuses, threshold degrades, and successful repair clears its counter` | All nine events exercise actual handler crashes, selected event-aware failure, persisted count 1, warning-only threshold count 2, and successful recovery. Stop/SubagentStop runtime failures terminate instead of requesting continuation |
| Stop continue, PostToolUse context trace, Stop non-context trace fallback | Literal human/model channels and absence of invented control/context fields; continue/trace preserve existing counter semantics instead of becoming unconditional policy failures |
| Known-event config and import failures | Real config/import paths use event-aware outputs and local accounting; hooks are not fabricated as reached after import/config failure. SubagentStart stderr-only failure is local, not a native veto claim |
| `root same-ID prompts reset root and child reminders; child prompts and repeated stops preserve them` | Persisted ordinary reminder sequence: root same-ID UPS resets all scopes, child UPS preserves, repeated root/child Stops set stop_hook_active true, startup/clear reset, resume/compact preserve, interleaved Claude history stays separate |

## Proof Limits and Remaining Gates

Final full U/D/static gates are passed as recorded above; focused proof remains separately identified. M3 code-review milestone GO and final QA GO are confirmed; M4 is authorized and in progress. The private deferred selected-runtime-error audit and existing onError/circuit-breaker behavior are covered by the final unit/regression gate, not asserted as native executor behavior.

These are compiled Clooks replays, not native Codex sessions, executor probes, actual command prevention, child delivery, or MCP server acceptance. The ordinary prompt-history policy remains best-effort with the accepted internal Review limitation; no deduplication workaround or full genuine-user parity is claimed. Cross-event/concurrent/storage combinations allocated to M4 remain distinct. M0's pinned S evidence is unchanged; P/L remain absent and no upstream probe was repeated.
