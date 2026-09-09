# Native Pack Proof and Binary Export

Documentation inspection on 2026-09-08, Joe-Degler. Retained attempt: `tmp/codex-native-m1/smoke-1Lt8qA2M`. Execution success is observed; parent subsequently confirms final native/helper/manifest reviewer and QA GO. Global deployment receipts remain a separate pending gate. No global installation receipt exists in this evidence.

## Result

`export/passed.json` reports mode --smoke, completed 9, passed true, testExitCode 0 and all mandatory names: M1-BASE, M1-DENY, M1-REWRITE, M1-ASK, M1-CONTEXT, M1-STOP, PACK-SHELL-READ, PACK-PATCH-ALLOW, PACK-PATCH-DENY. Inspected final.rc, export/test.rc, export/artifact.rc and hash.rc are all 0. All nine case passed.json receipts have status passed and the same clooksSha256.

Export `clooks` independently hashes to `ae66d726742c8ae29788236b7a4088d87e922de3cdd4014f7efbf568dafc2e71`, matching binary.json and every case. Metadata identifies linux/x64, original executable mode 0755, sealed mode 0555, and source /app/dist/clooks. This hash identifies Clooks, not the separate pinned Codex runtime.

## Added Native Cases

PACK-SHELL-READ: exact function_call_output with call_id pack_shell_read reports process exit 0 and token pack-read-effect-28471. Raw Pre/Post tool_use_id values match; prefer-builtin-tools records PreToolUse skip. Owned readable.txt bytes are unchanged.

PACK-PATCH-ALLOW: first request advertises custom apply_patch. Exact custom_tool_call_output for pack_patch_allow reports success and names both files. Raw Pre/Post IDs match; no-edit-protected records skip. editable.txt changes from before plus newline to after plus newline, and safe-companion.txt contains safe plus newline.

PACK-PATCH-DENY: first request advertises custom apply_patch. Exact custom_tool_call_output for pack_patch_deny contains the intentional no-edit-protected reason for owned/nested/bun.lock, rule lock-files, not an unavailable-tool/parser/unsupported-result error. The hook records block. The complete owned tree snapshot is unchanged, including protected before bytes; safe-companion.txt is absent even though its Add operation came first. No PostToolUse is captured for the denied call.

These observations were extracted from each observed.json's payloads, actual model-request feedback, actual-hook turn state and before/after snapshots. Raw request text is retained; no extra native execution was performed by the docs owner.

## Export Implementation and Limits

Inspected container-entrypoint.sh publishes completion after test success, calls exportSmokeBinary only for successful smoke, records artifact status, seals exports and propagates failures. exportSmokeBinary requires the exact nine-case pass record, regular executable source, matching successful per-case hashes, exclusive destination creation and post-copy hash equality. It records architecture/modes before sealing. The host runner hashes exported files and checks its manifest; a pass marker alone does not authorize installation after export or sealing failure.

The added cases use frozen actual hook bytes in fresh projects, real retained Codex 0.153.4, a synthetic model/catalog, offline non-root Docker, synthetic trust and no real home/auth mounts. The original six cases remain separate. This proves bounded native shell-read and direct-patch allow/deny behavior; it does not prove every patch grammar variant, MCP mutation, ordinary trust/approval paths, all hook combinations, tmux visual behavior, every event arm, global activation or full-release conformance.

Parent reports final standard `bun run test:e2e` completed 1024/0, 12,717 assertions across 51 files in 183.97 seconds, exit 0; session 15297 closed. Final native/helper/manifest reviewer and QA GO are confirmed, and reviewed global manifest prefix `3165b` is execution-authorized. Deployment and benign live receipts subsequently passed with final reviewer/QA GO; see M4-DEPLOYMENT-EVIDENCE.md. Coverage remains the separately disclosed local-trial limitation. External marketplace and plugin cache promotion are deferred, not publication gates for this local trial.
