# M1 Implementation Evidence

M1 only. No M2 implementation, native coverage, install, global write, configuration/registration change, staging, or commit is claimed. Parent owns independent reviewer/QA gates and any later promotion.

## Source Changes

Four actual vendor hooks changed:

- `.clooks/vendor/plugin/clooks-core-hooks/prefer-builtin-tools.ts`: explicit Codex exempts the six built-in read/search rules while retaining edit/sleep rules, configured disables, custom additional rules, and the existing escape semantics. Codex messages name apply_patch conditionally and available process tools without promising inventory. Claude and absent-provider behavior retain their existing guidance.
- `.clooks/vendor/plugin/clooks-core-hooks/no-pasted-placeholder.ts`: explicit Codex skip; Claude/absent-provider placeholder blocking; existing global task-notification-prefix skip adopted with a concise comment.
- `.clooks/vendor/plugin/clooks-core-hooks/no-compound-commands.ts`: provider-specific guidance only, plus preservation of the existing global SessionStart prefix removal. Classification and escapes unchanged.
- `.clooks/vendor/plugin/clooks-project-hooks/no-edit-protected.ts`: root/nested existing lock names plus bun.lock; custom glob semantics unchanged. Two source typing clarifications (bounded indexed character assertion and property-existence narrowing) permit strict checking without changing valid-input behavior.

Both pack `types.d.ts` files are byte-exact copies of `src/generated/clooks-types.d.ts`; unit assertions verify equality and provider-bearing types. The sole package.json edit is the unconditional read-only vendor mount in `test:e2e:run`.

`src/default-hooks/portability.test.ts` imports actual hook source. Static imports put the four edited hooks and unchanged package-manager guard under the existing strict project TypeScript check. Computed imports discover the six unmodified upstream test files beside the vendor hooks under ordinary src unit discovery; these are not separate default-discovered test files in Bun's summary. Tests do not depend on scratch or the marketplace mount at runtime.

`test/e2e/default-hooks.e2e.test.ts` copies actual pack bytes into isolated sandbox projects, verifies SHA-256 equality, invokes the compiled binary, checks exact permissive/denial output, and verifies persisted hook decisions. It covers both provider wire formats, combined configuration, and atomic local overrides with an explicit uses path. Lock wire tests exercise Claude Write only; provider-neutral unit contexts are not native Codex patch evidence. Both unchanged guards have fixed preimage-hash assertions.

## Preparation

`tmp/default-hook-portability/prepare.ts` was created with apply_patch and executed in Docker, mounting marketplace read-only. It retained 33 files from revision `a4a75c7e970c52e3f3edd8255ee9ea838aa4c224`, with SHA-256 file manifest at `tmp/default-hook-portability/source-manifest.json`. Six upstream tests were copied from that snapshot using apply_patch, without edits.

`tmp/default-hook-portability/run-m1.sh` is a new attempt-specific logger, not a reused active provider-context script. Focused/full-unit modes invoke current `clooks-e2e` with the normal mounts plus read-only vendor source; E2E mode invokes exactly `bun run test:e2e`. It preserves test and log-capture statuses.

## Validation

- Focused: `bash tmp/default-hook-portability/run-m1.sh focused`, attempt `m1-focused-SBQcjT`: typecheck and binary compilation passed; 618 tests passed, 0 failed, 2,353 assertions across 2 entry files; exit 0, capture exit 0. This includes 605 unit cases (new and imported upstream tests) and 13 compiled-binary E2E cases.
- Full units: `bash tmp/default-hook-portability/run-m1.sh units`, attempt `m1-units-YGwDfX`: typecheck and binary compilation passed; 2,819 tests passed, 0 failed, 9,712 assertions across 70 files; exit 0, capture exit 0.
- Standard full E2E: `bash tmp/default-hook-portability/run-m1.sh e2e` invokes `bun run test:e2e`; parent reports attempt `m1-e2e-TmfzAX` passed 822 tests, 0 failed across 51 files in 127.60 seconds; exit 0, capture exit 0.
- Formatting: only the two newly authored src/test files were formatted in Docker using repository Prettier settings. The first attempt failed on the container UID mismatch; retry as the host owner succeeded. No mass formatting.
- Full lint, repository-wide format check and coverage were NOT run for M1. Scoped formatting and passing typechecks do not establish those gates. Final M3/M4 static and coverage validation remain pending; report existing failures without changing thresholds or exclusions.
- `git diff --check` passed; both unchanged guard production files have empty diffs.

Initial focused attempts are retained rather than hidden: `m1-focused-JyjGpT` stopped at two strict test tuple errors; `m1-focused-s6BRkP` had 614 pass/5 fail from incorrect Claude skip-output and atomic-overlay setup expectations; `m1-focused-swyt7l` stopped at protected-hook type narrowing; `m1-focused-ohS3O8` had 616 pass/2 fail, both atomic overlay fixtures missing uses. All were corrected narrowly before the green focused pass; no engine changes.

A supplemental all-six-hook strict indexed-access check found the unchanged git guard's pre-existing `no-destructive-git.ts:106` unchecked capture access. That file remains byte-identical. Do not claim a clean strict indexed-access check for that untouched module; its complete upstream runtime regressions and both-provider binary cases pass. Five other tested hooks participate in the passing normal strict typecheck.

## Independent Gates

Final parent status received 2026-09-08: Popper reviewer GO and Singer QA GO obtained; parent confirms M1 gates verified. Earlier conditional review is superseded. Standard full E2E `m1-e2e-TmfzAX` passed 822/0, with execution/capture statuses 0. M1 is complete and parent has started delegated M2 in inactive candidate packs. No global write or commit is claimed; later commit inclusion remains required for committed reproducibility.

## Later Commit Inclusion

No files were staged. The parent must include all imported/read sources before claiming committed reproducibility. New files currently untracked are:

- `.clooks/vendor/plugin/clooks-core-hooks/types.d.ts`
- `.clooks/vendor/plugin/clooks-core-hooks/prefer-builtin-tools.test.ts`
- `.clooks/vendor/plugin/clooks-core-hooks/no-pasted-placeholder.test.ts`
- `.clooks/vendor/plugin/clooks-core-hooks/no-compound-commands.test.ts`
- `.clooks/vendor/plugin/clooks-core-hooks/no-destructive-git.test.ts`
- `.clooks/vendor/plugin/clooks-project-hooks/types.d.ts`
- `.clooks/vendor/plugin/clooks-project-hooks/no-edit-protected.test.ts`
- `.clooks/vendor/plugin/clooks-project-hooks/js-package-manager-guard.test.ts`
- `src/default-hooks/portability.test.ts`
- `test/e2e/default-hooks.e2e.test.ts`

The four tracked production hook edits, tracked package runner change, and parent-owned documentation edits also need scoped inclusion later. Plan/evidence files are ignored and require explicit inclusion if committed. Preserve unrelated prior staged work.

## Frozen Input Hashes

Captured after the final test edits, before full units/E2E. Parent verified on 2026-09-08 that the post-run SHA-256 comparison matches all 22 listed files exactly, using `sha256sum .clooks/vendor/plugin/clooks-core-hooks/*.ts .clooks/vendor/plugin/clooks-project-hooks/*.ts src/default-hooks/portability.test.ts test/e2e/default-hooks.e2e.test.ts package.json`. Untouched pack hooks are included to make scope auditable. This records parent verification, not a second independent hash run by the documentation worker.

```text
45c9df128a5edc7937e3438dc30a35c7d2fde573117da66363b7ba4dc95393e4  .clooks/vendor/plugin/clooks-core-hooks/no-auto-confirm.ts
7eb0da1a90f2fff3a4683b7d33fea285cb83930564aac2d0661b5c1ce6d796b4  .clooks/vendor/plugin/clooks-core-hooks/no-bare-mv.ts
8ed6326ead33165f024635c90a38e8615a7fa8eeb824162f5fb1c48bcc0c3d03  .clooks/vendor/plugin/clooks-core-hooks/no-compound-commands.test.ts
7945c60489b977ec0b487f88d89264857bfa2cdf1ad8a511726fd07216e0810b  .clooks/vendor/plugin/clooks-core-hooks/no-compound-commands.ts
a1a4a547b8101fb902785ca4f7817dff4e2064c659d6b4979653813400b1dde8  .clooks/vendor/plugin/clooks-core-hooks/no-destructive-git.test.ts
4278f695615bb43e9516cf02a948a07dd6805d98dd9f1849c765fbbdc5f85ff8  .clooks/vendor/plugin/clooks-core-hooks/no-destructive-git.ts
c40410637127f3a2147758d19871330e18c8d05aae76358ded742691077c42f7  .clooks/vendor/plugin/clooks-core-hooks/no-pasted-placeholder.test.ts
b9261f2a138534b06f0bc6fbe50cafcb460e78e70705bc6b523caaa16bbf5bfc  .clooks/vendor/plugin/clooks-core-hooks/no-pasted-placeholder.ts
c5e20d134b087f994f4b37160089b003166d2a608125deeaaf7c8dadd39e007e  .clooks/vendor/plugin/clooks-core-hooks/no-rm-rf.ts
3bb36a97fd63ff10e16976020a15fde6b57d5eee2010014bb857c359565dceed  .clooks/vendor/plugin/clooks-core-hooks/prefer-builtin-tools.test.ts
77ad96815c885241c31d88c1b154bc3ccc5afc9b09feba8ea3bb67136c48df63  .clooks/vendor/plugin/clooks-core-hooks/prefer-builtin-tools.ts
1d65a20efbb0cb7f9aaae2583f6a25e87f5588cbfa91a622d6edffc515e00e4e  .clooks/vendor/plugin/clooks-core-hooks/tmux-notifications.ts
93fb9d610141aa502850653f3e49542a565e639f2b23c093eea43f77127321e1  .clooks/vendor/plugin/clooks-core-hooks/types.d.ts
6bab1bab2a1e6823f1966b4a19d8ae4523b1fd4c1add60bbd5fcb3b43f79d00d  .clooks/vendor/plugin/clooks-project-hooks/js-package-manager-guard.test.ts
7482fb75d6ba43f0675d102238d9a61b34c812f354de0fdc0abceb53c4805268  .clooks/vendor/plugin/clooks-project-hooks/js-package-manager-guard.ts
2e54193238e6d35dff3587092e8702b1aca5f7610abda270847d602e18e30e6f  .clooks/vendor/plugin/clooks-project-hooks/no-edit-protected.test.ts
ac459cc280b54e22d9f530fb7c58c25f65ae0e2a94bb41aa41a027093a8bf460  .clooks/vendor/plugin/clooks-project-hooks/no-edit-protected.ts
f875689caa780ba9b91a247cddd31b8828d6d9a78ff3f29b61eacc8f2696054c  .clooks/vendor/plugin/clooks-project-hooks/prefer-project-scripts.ts
93fb9d610141aa502850653f3e49542a565e639f2b23c093eea43f77127321e1  .clooks/vendor/plugin/clooks-project-hooks/types.d.ts
ecffc671c6c23a94cba90666ba9d16cb7f78435f241bd9d165e01f1d9187d5b0  src/default-hooks/portability.test.ts
68ae9e6817c3e71fd91579fa05e2ecfa621e4b42efc1606c16621ebb0fcc803f  test/e2e/default-hooks.e2e.test.ts
1911d2f7ecda57fdb82b05bed39c2b0789060b6f7cf2794ec10aa586d7df7fad  package.json
```
