# Codex Runtime M4 Evidence

Date: 2026-09-08 UTC. M4 test implementation and final local validation are complete: full units 2,192/0, full E2E 787/0, static checks all exit 0 on matching manifests. Final code GO and execution QA GO are confirmed. M4 is complete; documentation closure is authorized. M4 is test-only, with no production changes. Source/tests remain held. Native P/L remain absent. This writer inspected artifacts without executing tests.

## Final Local Gates

All artifact directories below are under `tmp/codex-runtime-m4/`.

| Gate / recorded snapshot | Exact command | Result | Artifact directory |
| --- | --- | --- | --- |
| U / `m4-final-6-bounded-unit-confirmation` | `bun run test:e2e src/` | 2,192 pass, 0 fail, 69 files, 8,229 assertions, 3.33 seconds; exit 0 | `20260908T093707Z-units-g43QGI/` |
| D / `m4-final-5-formatted` | `bun run test:e2e` | 787 pass, 0 fail, 47 files, 9,268 assertions, 104.18 seconds; exit 0 | `20260908T093440Z-e2e-4jueMy/` |
| Static / `m4-final-5-formatted` | `bash /opt/development/clooks/tmp/codex-runtime-m4/launch-static.sh static` | typecheck/lint/format:check each exit 0; lint 112 warnings, 0 errors; wrapper exit 0 | `20260908T093645Z-static-JThIEb/` |

All six before/after source manifest files independently hash to `11f1bc064814471e5c2edc41996eeae742d430ca06472c22717ae222f87e47eb` (manifest-file fingerprint, not Git commit). Each metadata file records unchanged source/wrappers and tee exit 0. The differently named confirmation snapshot did not change source. Final runner audit confirms no owned M4 containers remain. The separate wrapper-manifest fingerprint is `6ed9aa7f7fe33319d8fa656fcb2580d40e064a5f788425d2cc6a15fdfcaa6990`; all before/after wrapper manifests match, independently of the source fingerprint above. Final unit image: `sha256:3fe2f24dd9d7a515277d3b3f50cfe42ca935f97c2b7b610ad4ee5ed2f3de33f5`. Final E2E/static image: `sha256:93365cd1bc4b9222702b2bec14a250a83d05ea098132c8f82f5ffde99c318b53`. These audit details are parent/runner-confirmed.

Historical full-unit failure, `20260908T093414Z-units-CpazQA/`: 2,191 pass/1 fail, 69 files, 8,227 assertions, 4.08 seconds, exit 1. Existing `turn lock > gives up within the advertised wait budget when the lock is held and fresh` at `src/engine/turn-state.io.test.ts:404` expected elapsed >50ms but observed 38.53868899999998ms. One QA-approved bounded full-unit confirmation passed as recorded above. The original timing failure remains unexplained: no changed assertion, production fix, or established flake diagnosis. The passing confirmation supplies the final unit gate without erasing the failure.

M4 adds test coverage only; no production interface deviation, public API, selector, configuration, registration or schema change was needed. M1-M3 behavior remains covered by the full regression gates. Final code GO and execution QA GO are confirmed separately from passing execution; M4 is complete with documentation closure authorized.

## Focused Execution Record

Artifacts below are under `tmp/codex-runtime-m4/`. All five metadata files report unchanged source/wrappers and tee exit 0. Commands run the compiled Docker harness, not host tests.

U command: `bun run test:e2e src/agents/ src/engine/ src/engine.test.ts src/failures.test.ts src/failures.provider.test.ts src/lifecycle-integration.test.ts`

D command: `bun run test:e2e test/e2e/codex-state-delivery.e2e.test.ts test/e2e/codex-events.e2e.test.ts test/e2e/codex-runtime.e2e.test.ts test/e2e/agent-adapter.e2e.test.ts test/e2e/entrypoint.e2e.test.ts test/e2e/fail-closed.e2e.test.ts test/e2e/turn-state.e2e.test.ts`

| Snapshot / class | Result | Artifact directory |
| --- | --- | --- |
| `m4-first-1`, U | 923/0, 25 files, 3,337 assertions, 2.11 seconds, exit 0 | `20260908T091152Z-focused-8lLYTB/` |
| `m4-first-1`, D | 204/0, 7 files, 3,871 assertions, 35.64 seconds, exit 0 | `20260908T091217Z-focused-e2e-a9ThYG/` |
| `m4-second-2-parent-orchestrated`, U | 925/0, 25 files, 3,356 assertions, 2.27 seconds, exit 0 | `20260908T092525Z-focused-3Yhnba/` |
| `m4-second-2-parent-orchestrated`, D | 211 pass/1 fail, 7 files, 4,040 assertions, 37.98 seconds, exit 1 | `20260908T092555Z-focused-e2e-GzLtJZ/` |
| `m4-third-3-concurrent`, D | 213/0, 7 files, 4,134 assertions, 39.17 seconds, exit 0 | `20260908T092833Z-focused-e2e-tmvVQq/` |

The latest D before/after source manifests both hash to `b1b57b44847f4db0dc82fdd08cb247d12d5132beb99c3dd44f2a25b1baf56c90` (manifest-file fingerprint, not Git commit). `test-image-at-run.txt` records `sha256:53de5c950a8d114b0bf9fc9d4f8a0f6b3d924d56289d84a80a81d34e6e49e250`. The run spans 09:28:33-09:29:17Z with a 600-second outer deadline and 10-second kill grace. These seven-file totals include earlier suites; they are not counts of newly added M4 cases. Final formatting requires separately matched full-gate manifests.

Historical failed D: the global generated-command positive control reached its hook but writing the observation failed with ENOENT because global-only setup had no project `.clooks` directory. The fixture now explicitly creates that directory without creating project configuration or changing discovery. The latest 213/0 rerun resolves the fixture failure; no production defect or assertion weakening is claimed.

## Initial State Coverage

`test/e2e/codex-state-delivery.e2e.test.ts` initially added four compiled cases, now included in passing focused D:

- Two Codex sessions, root/two child scopes and interleaved Claude with shared IDs; unmatched root UPS resets only its Codex session.
- Unmatched SessionStart resume/compact preservation and clear/startup reset; missing required identity rejects before imports and leaves existing history bytes unchanged.
- Held Stop with explicit bounded ready/release barriers, without reset: accepted old-generation result remains visible to the next Stop.
- Same held Stop crossing an unmatched root UPS: its old-generation result cannot populate the new prompt's history.

These are literal compiled-replay oracles, not native continuation claims. Each invocation has disposable HOME/CODEX_HOME and a subprocess deadline; observations are cleared before reuse. The race uses readiness/release markers, not elapsed-time ordering, and always joins the bounded child before cleanup.

## Completed Focused Coverage

| Named case family | Matrix allocation / observed local behavior |
| --- | --- |
| `two sessions and two children retain independent reminders across a root reset and Claude interleave` | C11-C13: unmatched root UPS resets its Codex session, not the other session/provider; root/two children remain distinct |
| `unmatched session boundaries preserve or reset history and malformed identity leaves bytes unchanged` | C11/C13: no-match start boundaries and required-identity pre-import refusal; existing state bytes unchanged |
| `a held Stop commits only into its original prompt generation, reset=false/true` | C07/C13: explicit ready/release overlap with no-reset positive control; tests generation changes, not epoch recreation |
| `overlapping root and two child invocations retain every acknowledged write in their own scope` | C11/C13: warmed shared state, three distinct PIDs and per-process readiness markers before one release; clean completions followed by exact persisted block/skip records in each scope |
| `Stop/SubagentStop: requested long handoff stays inline, preserves raw reminder history and rejects before delivery` | C04/C10/C12: full long literal reason and one inline warning, correct root/child identity, subsequent reminder skip, rejected control terminates without text delivery or handoff files |
| `project/global: actual registered commands retain JSON refusal, local failure and advisory-only channels` | F07-F09/C08/C14: actual init-generated command through real launcher/binary; reachable baseline followed by PermissionRequest JSON denial, SubagentStart local stderr/exit 2, Stop continue diagnostic with no control output |
| `SIGTERM/SIGINT/uncaught exception/unhandled rejection after a reached hook exits locally without fabricated JSON` | F08/F09: real compiled process, exact stderr and raw exit 2, empty stdout, fresh reached marker. Under-five-second completion against a ten-second deadline prevents timeout-generated SIGTERM from satisfying the oracle |

No new public selector/helper API or production edit was needed for these additions. Existing M2/M3 event/codec matrices remain intact. The named D cases above are now also covered by the final 787/0 full run; the final 2,192/0 unit run supplies source-level integration/regression proof separately. Full formatted U/D/static gates pass; final code/execution QA GO is confirmed and M4 is complete with documentation closure authorized. These are local U/D proofs, not native activation, recipient readability, retry deduplication, command prevention, or continuation execution. The accepted best-effort ordinary prompt history and Review limitation remain nonblocking; no native P/L upgrade. Storage locking/cold-start limits and the unexplained held-lock timing failure remain explicit residual limitations, not repaired behavior.
