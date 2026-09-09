# M3 Candidate and Promotion Evidence

Author: Joe-Degler. Status on 2026-09-08: candidate source/docs reviewer, QA and helper GO received; all six approved files promoted; standard post-promotion E2E passed. No native or global rollout success is claimed.

## Candidate Gates

Parent reports focused 1081/0, full candidate 1024/0, full units 3084/0, lint pass and properly scoped formatting pass. Final approvals bind manifest `11ab549d6617d314380a6054c800317884fb687c7f09b6cac3dc6ef0d9cc245f` at `tmp/default-hook-portability/m3-reviewed-manifest.json`. Coverage exited 1 with zero failed test assertions: unresolved and explicitly accepted by parent as nonblocking for local trial, not a coverage pass. No thresholds or exclusions changed. Computed rm/tmux imports do not establish general strict TypeScript checking for those modules.

## Promotion Scope

Parent authorized three runtime replacements plus three additions, with reviewed preimages/backups: core no-rm-rf.ts and tmux-notifications.ts, project prefer-project-scripts.ts, core tmux-notifications.test.ts, and the two pack README.md files. Documentation owner observed matching canonical/candidate runtime hashes:

    clooks-core-hooks/no-rm-rf.ts
    1a92c2195d2f2816a9c6b516f400bf92a8e925a0a15a3e35e6748cb056638b8f
    clooks-core-hooks/tmux-notifications.ts
    d2d83264c6f303331e4b4491c0005291104316b0c68473727663d88449236ab9
    clooks-project-hooks/prefer-project-scripts.ts
    7e82a985ace4a251c45a5bbb924503402d2801de9b0b28d4f842a26e1d0878dc

Canonical root is `.clooks/vendor/plugin`. The documentation owner also verified the manifest hash itself and all three canonical addition hashes against the manifest:

    clooks-core-hooks/tmux-notifications.test.ts
    17d410c8a3b4ad7ad1422ab53d66ad65ed53fbd43ebfda1d52a783083c1ebfe2
    clooks-core-hooks/README.md
    89736b9e2c67772ae53c0cf16a87308ea8a5f501e037661a0c9abebcc8706458
    clooks-project-hooks/README.md
    fcab102d286f02e49d8caaddc1d537a482fa0ef8306f3b6ecf4943912a747769

The runtime changes preserve removal classification while making Codex confirmation refusal explicit, restrict script recommendations to verified ordered literal words with explicit runner run syntax, and retain newer upstream tmux Stop behavior with configured-slot/interpolation limitations. No new events or shared runtime/type policy changes are claimed. Repo-local promotion is not a global deployment or committed reproducibility; final source/test/doc inclusion remains separately required.

## Remaining Gates

Standard canonical E2E passed in `tmp/default-hook-portability/promoted-e2e-9ybqpU`: 1024 pass, 0 fail, 12660 assertions across 51 files, 132.98s. Both execution and capture statuses are 0 in `result.txt`; `output.log` retains the standard `bun run test:e2e` command, typecheck, compilation and test output. No source or test changes occurred during the run. The implementation owner rehashed all six installed files afterward; all match the approved manifest. No global writes, staging or commit occurred.

M4 native harness/export changes and native-specific domain split remain planned, not implemented by this docs update. Existing M2 evidence/candidates remain untouched.

## Validation Details

Final focused `m3-focused-RymCuJ`: 1081/0, 5807 assertions, 32.09s, exit/capture 0. Full units `m3-units-w2gGyo`: 3084/0, 10927 assertions, 4.95s, exit/capture 0. Full candidate `m3-e2e-RVL09p`: 1024/0, 12662 assertions, 135.30s, exit/capture 0. After that frozen full candidate run, only the one-line unconfigured Yarn guidance changed to explicit `yarn run`; final focused and standard canonical E2E cover final bytes. Helper guards `m3-tools-jifftL`: 8/0, 53 assertions, exit/capture 0.

Coverage `m3-coverage-YP3xXe`: 3084/0, aggregate 95.57% functions and 96.98% lines, exit 1/capture 0; not a pass. Full lint `m3-lint-LGSLnb`: exit/capture 0, 112 existing-file warnings, no new test-file diagnostic. The overly broad format attempt against `.` was superseded by a read-only Docker invocation of the exact project globs `--check 'src/**/*.ts' '*.json' '*.mjs'`, with repository `.prettierrc` and `.prettierignore`: exit 0, all matched files formatted. An initial one-off missing `.prettierrc` is discarded. No formatting writes or frozen helper/runner edits occurred for that correction.

Normal project `tsc --noEmit` statically checks the changed script hook through `scripts-and-removal.test.ts`. A separate strict Docker probe of the computed-import hooks exited 2: rm has possibly undefined regex captures at lines 179/180, first path segment at 324, and aggregate `head` at 594/598/603/608; tmux has a possibly undefined parsed pane ID at 167. The new Codex branch's line 598 shares the existing runtime-guarded first-entry assumption, but is not independently strict-clean. Tmux remains byte-identical to upstream/global. No broad upstream refactor was made; actual-source runtime and binary tests do not establish general strict typechecking of these modules.
