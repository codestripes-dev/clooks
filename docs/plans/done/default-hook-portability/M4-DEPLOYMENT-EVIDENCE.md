# Local Trial Installation Evidence

Inspected on 2026-09-08 by Joe-Degler after parent-confirmed authorized delegated execution. Parent confirms final rollout success; final probe evidence is recorded below. No publication, staging or commit is claimed.

## Installed Images

Receipt: `tmp/default-hook-portability/local-rollout-fixtures/postdeployment.json`. Its approval manifest identity is `3165b93c00d171ee3b7bdc598314bb7994530520e9f904c2fbf667b34790a628`, defined by SHA-256 of JSON.stringify(manifest) without a newline. Inspected all 13 postimage matches, all 38 immutable matches and all 11 backup matches as true.

Installed effective binary `/home/joedegler/bin/clooks` is mode 0755 and SHA-256 `ae66d726742c8ae29788236b7a4088d87e922de3cdd4014f7efbf568dafc2e71`, the exact nine-case native-tested export. Parent independently verified installed binary/global hook hashes. The previous binary hash is `62b93d68dec129d02f9f9c5f516a010c6a9f448e950c0fd06d6ec62f96579278`.

Unique backup directory: `/home/joedegler/.clooks/backups/default-hook-portability-20260909T003451Z-a092fcfe-7648-4a11-8667-b457ed424ffb`. Read-only listing confirms manifest.json and indexed originals 0 through 10. Backups cover the previous runtime, all eight core hooks and both changed project hooks; declaration additions were originally absent and are recorded accordingly.

Actual hook writes were six changed core files and two changed project files plus two pack declaration additions. Already-equal tmux and unchanged destructive-git were preserved. Source is canonical repository vendor, not marketplace/cache. Configuration, registrations, shared declarations, launchers, other binaries and known backups remained immutable. No marketplace/plugin-cache or release/lock update was made.

## Runtime-First Check

The receipt contains exactly six lifecycle records: before, handler and after for claude-code, followed by before, handler and after for codex. These isolated checks used the installed binary before hook promotion. They are provider/binary wire validation, not a new native-agent activation claim.

## Final Benign Probes and Limits

Inspected final-probe-evidence.json: all 12 compiled-wire results have status 0, covering two scopes, both providers and SessionStart/PreToolUse/Stop. All target and immutable comparisons remain true. These manual wire invocations are not native dispatch or proof a read executed.

Parent and deployment owner separately report actual current-project read success, unprotected edit success and mixed protected-patch denial. Inspected before/after editable hashes change from 862fd5af9efc5e03d6800af97a96152cd65656a6ce8e9c8fc6498d7ce941b579 to f93ea3e70809390b51fcb45274b903990bd31fee7783c700acc0d2f0c6f20e92. Protected nested/bun.lock remains 92c59602915ed910feef154b021c2eaceec4ae78bca5e01a607efde59b4ea344; safe-companion.txt remains absent. Docs owner inspected snapshots, not a new native run.

Global Codex hooks.json remains absent; home-only manual wire probes do not establish native home activation. No config, registration, auth, cache or marketplace changes were made. Local trial is complete, not upstream publication, and plugin refresh may replace overrides. Coverage remains nonzero with zero failing unit assertions, accepted for local trial only; rm/tmux computed imports do not prove general strict checking. Existing code/reviewer/QA gates were GO before execution; final postdeployment reviewer and QA GO are parent-confirmed after checking the receipts.
