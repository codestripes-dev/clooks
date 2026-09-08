# Codex Runtime M2 Evidence

Date: 2026-09-08 UTC. M2 is complete with final milestone GO: full units 2,047/0, final full E2E 674/0, static checks all exit 0 on the same frozen source manifests, and final documentation review complete. Two earlier full E2E failures, focused retries and the bounded scratch reproduction remain recorded below; the original circuit-breaker exit 2 is unexplained, not an established flake. This document records retained runner artifacts, not tests executed by this writer. Evidence is local U/D and static validation only; no P/L or native-confidence upgrade. M3 has separate implementation and acceptance gates.

## Final Formatted Snapshot

Freeze reference: `m2-final-7`. SHA256 of each retained source manifest file is `e8a92eeffb2ce09ec459e781e743da17306c7b8d7209beb3856825ee9fcb2586`. This is a **manifest-file fingerprint, not a Git commit**. Direct inspection confirms identical before/after fingerprints for the unit, first full E2E, focused add-pack retry and successful static attempts below. Each metadata file reports `source_changed=false`; source was not changed to obtain the network retry pass.

The approved 27-file mechanical format export is retained at `tmp/codex-runtime-m2/20260908T075919Z-format-export-hRlbEL/export/formatted-owned-files.tar`, with `formatter.log` and `format-owned-files.txt`. The export ran under `m2-final-format-6`, exit 0, without changing the mounted source. The owner subsequently recovered only approved formatted files before freezing `m2-final-7`. Export immutability is not a claim that format recovery left the pre-format tree unchanged.

## Commands and Results

Commands ran from `/opt/development/clooks`. Test commands build and run the compiled binary inside the project's Docker harness. Metadata records a 600-second deadline and 10-second kill grace for each attempt; the new Codex replay subprocesses additionally have their own 10-second timeout and disposable HOME/CODEX_HOME/project roots. `tee_exit_code=0` is distinct from the command's exit code.

Artifact directories in this table are relative to `tmp/codex-runtime-m2/`; each retains `output.log`, `metadata.txt`, `docker-commands.log`, and before/after source manifests.

| Evidence | Exact outer command | Result | Artifact directory |
| --- | --- | --- | --- |
| U: full units | `bun run test:e2e src/` | 2,047 pass, 0 fail, 68 files, 7,495 assertions; typecheck/build passed; exit 0 | `20260908T080040Z-units-0MN0cd/` |
| D: first full E2E | `bun run test:e2e` | 673 pass, 1 fail, 674 tests, 45 files, 6,687 assertions; exit 1. All Codex cases passed; this is not a full-suite pass | `20260908T080102Z-e2e-rpIz7o/` |
| D: focused existing network smoke retry | `bun run test:e2e test/e2e/add-pack.e2e.test.ts` | 11 pass, 0 fail, 1 file, 84 assertions; exit 0. Does not substitute for final full E2E confirmation | `20260908T080908Z-focused-add-pack-wwzJ3X/` |
| Static | `bash /opt/development/clooks/tmp/codex-runtime-m2/launch-static.sh static` | In-container typecheck, lint and format:check each exit 0; wrapper exit 0; lint 112 warnings, 0 errors | `20260908T081005Z-static-e10Fgt/` |
| D: second full E2E attempt | `bun run test:e2e` | 673 pass, 1 fail, 674 tests, 45 files, 6,690 assertions; exit 1. Existing parallel circuit-breaker case failed; GitHub smoke passed | `20260908T081120Z-e2e-CpEi3W/` |
| D: focused circuit-breaker diagnostic | `bun run test:e2e test/e2e/circuit-breaker-advanced.e2e.test.ts` | 9 pass, 0 fail, 1 file, 59 assertions, 1.57 seconds test time; exit 0. Root cause of the full-run failure remains unknown | `20260908T081455Z-focused-circuit-breaker-d3NS0z/` |
| D: bounded scratch reproduction | `bun run test:e2e test/e2e/circuit-breaker-advanced.e2e.test.ts` with scratch test mounted over that in-container path | 1 pass, 0 fail, 140 assertions; 20 fresh sandboxes, 60 exact-fixture calls, all exit 0 and empty stderr; wrapper exit 0. Not an execution of the unchanged nine-test file | `20260908T081736Z-diagnostic-circuit-breaker-39qirj/` |
| D: final full E2E pass | `bun run test:e2e` | 674 pass, 0 fail, 45 files, 6,714 assertions; 79.36 seconds test time, 84 seconds overall; command/tee exit 0 | `20260908T081921Z-e2e-5bJ5J5/` |

Unit metadata spans 08:00:40-08:00:48Z; first full E2E 08:01:02-08:02:25Z; focused network retry 08:09:08-08:09:14Z; successful static 08:10:05-08:10:14Z. Bun reports `1.3.10 (30e609e0)` in the test logs.

Second full E2E metadata spans 08:11:20-08:12:59Z (`m2-final-7-e2e-confirmation`, exit 1); focused circuit-breaker diagnostic spans 08:14:55-08:15:02Z (`m2-final-7-circuit-breaker-diagnostic`, exit 0). Both report `source_changed=false` and tee exit 0; their before/after manifest-file fingerprints also equal the final formatted fingerprint above. Their build-reported image IDs are respectively `sha256:ea6aa652896a7ed825a3536becfde32a1a7b23aa2d7007be3700864d3e73293e` and `sha256:d19ecdc759e9eb78dd6fcc7f76868dfcf1b0206e12d862566936fc58ba0cad47`; their execution commands use the `clooks-e2e` tag.

The bounded reproduction ran 08:17:36-08:17:45Z under `m2-final-7-bounded-circuit-reproduction`, command/tee exit 0, `source_changed=false`. Its Docker command read-only-mounted `tmp/codex-runtime-m2/circuit-diagnostic.test.ts` over `/app/test/e2e/circuit-breaker-advanced.e2e.test.ts`; production/test source on the host was unchanged. Scratch-test SHA256: `2c753f2dd0754bbab2c257733a6ac9849fb457a07dca7243178208187ca1b0de`, retained in diagnostic before/after manifests. `DIAGNOSTIC_RESULT` entries capture actual stdout/stderr/exit for all 60 invocations; parent reports durations 60.46-92.45 ms, all exit 0 with empty stderr. This bounded non-reproduction does not explain the original exit 2 or establish a flake. Source fingerprint remains `e8a92eeffb2ce09ec459e781e743da17306c7b8d7209beb3856825ee9fcb2586`. The single authorized post-diagnostic full run subsequently passed; no further automatic retries were authorized.

Final full E2E metadata spans 08:19:21-08:20:45Z under `m2-final-7-post-diagnostic`, with command/tee exit 0 and `source_changed=false`. Both source manifest files hash to `e8a92eeffb2ce09ec459e781e743da17306c7b8d7209beb3856825ee9fcb2586`, matching final units/static. Build stdout reports `sha256:20fe2ad7370f7bede1c718d9ff0a89c69dc702be7190fd4c8dff9234ce235e4e`; the execution command uses the `clooks-e2e` tag. This is the full-suite pass, not an aggregation of passing subsets from earlier attempts.

The unit build stdout reports image `sha256:555a5fc7fd1d51e3433e0010c2eb15a1783eb0b6df1b8dcee113146eed23ef10`; the first full E2E build reports `sha256:cc9bf7693a711d470c300e9ae4dacaa43918929346baf735477d234082e1ad39`; the focused retry build reports `sha256:0b394d583c7462f718e142a21f3882eeea777048280bc0f097c8279cc7edabaa`. These are build-reported IDs. Those test execution commands use the `clooks-e2e` tag; identical source manifests do not imply identical images. The successful static Docker command explicitly executes `sha256:0b394d583c7462f718e142a21f3882eeea777048280bc0f097c8279cc7edabaa`.

The static wrapper invokes a read-only-mounted `/app/codex-check.sh` using `docker run --rm --entrypoint bash` and the explicit image above. Its exact container name, cidfile, label and mounts are retained in `20260908T081005Z-static-e10Fgt/docker-commands.log`. Script commands recorded in `output.log` are `bun run typecheck` (`tsc --noEmit`), `bun run lint` (`eslint src/`), and `bun run format:check` (`prettier --check 'src/**/*.ts' '*.json' '*.mjs'`). The formatting check does not cover E2E test files or Markdown; the approved export separately included the owned test files.

## Failed Attempts and Corrections

Pre-format observations below are historical and their proofs apply to their own snapshots. The two earlier final-tree full E2E failures remain retained failed evidence despite the subsequent full-suite pass; focused or final success is not a root-cause diagnosis.

| Artifact directory under `tmp/codex-runtime-m2/` | Historical result and correction |
| --- | --- |
| `20260908T072239Z-focused-0Q4PAh/` | Early compiler/focused snapshot passed 716/0 while Codex runtime was still disabled; not compiled runtime proof |
| `20260908T073912Z-focused-AU9rpf/` | Two unit loader mocks omitted required dangling fields; typecheck failed before tests. Narrow mock correction followed |
| `20260908T074038Z-focused-hmQWmT/` | Post-mock-fix focused attempt retained separately; superseded by final full units |
| `20260908T074058Z-focused-e2e-ZBbjzS/` | 66 pass/6 fail, 72 tests. Four command-key diagnostic expectations needed the approved additional-key/null-deletion message; primitive-envelope diagnostic needed runtime/capability attribution; layering fixture incorrectly re-registered a home hook in project scope |
| `20260908T074950Z-focused-WmxODN/` | Four unit helper type errors after FailureLocation gained a managed descriptor; no tests executed. Helpers were corrected without weakening storage behavior |
| `20260908T075555Z-focused-0F4td5/` | Focused source tests passed 755/0, 23 files; superseded by final full units |
| `20260908T075615Z-focused-e2e-yBxh1s/` | 77 pass/1 fail, 78 tests. Project event order illegally referenced the home-only hook. Project now lists only its own shared hook; unordered sequential home hook appends, and local order reverses the pair. Exact output/order assertions were preserved |
| `20260908T080102Z-e2e-rpIz7o/` | First final-tree full E2E failure: existing `clooks add -- smoke test against real GitHub > --all --project works against real GitHub (network)`, `test/e2e/add-pack.e2e.test.ts:296`, expected exit 0, received 1. Child stderr was not printed, so the cause is not established. No Codex case failed; one focused retry passed without source changes |
| `20260908T080836Z-static-OSW2Af/` | Exit 127 before checks: `run.sh: line 54: --kill-after=10s: command not found`. Parent attributed this to editing an active Bash runner wrapper, not production. The later static attempt completed all checks; the failed attempt remains recorded |
| `20260908T081120Z-e2e-CpEi3W/` | Second full E2E: existing `circuit breaker advanced > 7. parallel hook driven to degradation through repeated invocations`, `test/e2e/circuit-breaker-advanced.e2e.test.ts:257`. First crash invocation expected exit 0, received 2; test reported 15,766.47 ms and a 5,000 ms timeout. Original child stderr was not logged. Root cause UNKNOWN, not an established flake. GitHub smoke passed |
| `20260908T081455Z-focused-circuit-breaker-d3NS0z/` | Focused circuit-breaker file passed 9/0 on unchanged source. Parent reports read-only source review found no identified defect and selected settlement code remains the preserved M1 Claude behavior. That is inspection evidence, not proof of why the full run failed |
| `20260908T081736Z-diagnostic-circuit-breaker-39qirj/` | Bounded scratch reproduction completed 20 fresh sandboxes/60 calls with actual output capture, all exit 0 and empty stderr. Original exit 2 remains unexplained; not a proven flake or a full-suite pass |

Source/code review also required opaque MCP record replacement instead of blanket refusal; ignoring undefined and preserving untouched null/own prototype-named keys; malformed-envelope validation before config counter reads/writes/clears; provider-managed failure locations through actual engine calls; guarded linked-directory/file state access and nonblocking special-file reads; and parallel raw-shape validation before effect classification. Final U/D evidence must remain distinct from review/source-inspection evidence for these changes.

## Acceptance Allocation

The acceptance matrix names the concrete compiled cases and E/F/C IDs. `test/e2e/codex-runtime.e2e.test.ts` covers PreToolUse wire translation, command-only and opaque MCP input, full replacement, attributed sticky refusal, sequential/controlled parallel reduction, real home/project/local ordering, root selection, pre-import validation, provider/scope history, config/ordinary failure accounting, and inline handoff. Six linked-directory/file cases exercise config accounting, a reached hook's ordinary failure commit, and history read/commit, with valid positive controls and unchanged foreign bytes. `test/e2e/agent-adapter.e2e.test.ts` preserves default/explicit Claude behavior and checks enabled Codex PreToolUse against configured invalid input.

The other nine recognized Codex events are tested only for their explicit event-aware unsupported failures until M3, not successful runtime handling. These D assertions replay source-shaped envelopes through compiled Clooks. They do not run native Codex, prove command prevention or approval bypass, prove downstream MCP server validation, or establish native handoff-file readability. Best-effort ordinary prompt history remains accepted with the documented Review limitation; M3/M4 boundaries and release confidence are not closed here.

Pinned release-source S evidence remains the M0 audit of tag `042fb41b7c813ac7999105e886b2b7aa715b5081` -> commit `3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`. The exhausted M0 executor attempts produced zero tests; P and L remain absent. This writer made documentation/test changes only and ran no tests, host builds, native probes, staging or commits.
