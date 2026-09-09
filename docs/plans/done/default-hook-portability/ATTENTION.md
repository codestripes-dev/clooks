# Attention Required

Approved default-hook implementation and validated local rollout completed; this worker owned planning and documentation, not deployment.

## Danger Zone Changes

### Permission Decisions and Shared Hook Behavior

**What changed:** M1-M4 implementation and validated local rollout are complete. Canonical E2E passed 1024/0, native nine-case smoke passed, and installed-image/backup/immutable checks and benign probes passed. Coverage exit 1 is disclosed and parent-accepted only for local trial; thresholds are unchanged.
**Why it changed:** Providers differ in tools and supported permission responses.
**Why it matters:** Verify unchanged deletion classification and Claude ask, unchanged git/package guard policies, no filesystem mutation by no-bare-mv, and no invented provider events.

### Live Project Vendor Activation

**What changed:** M2 edits are staged in candidate pack directories and mounted read-only at the canonical Docker path before guarded promotion to tracked vendor source.
**Why it changed:** The current checkout loads project vendor hooks live; incremental patch-protection edits could block their own completion.
**Why it matters:** Require candidate test results plus reviewer/QA GO before promotion, then standard full E2E before M3. Do not disable hooks or rewrite config to work around activation.

### Global Library and Provider Binary Deployment

The inspected artifact is `/export/clooks` from the successful nine-case native smoke, exported before sealing and hash-matched to every case's Clooks binary. Final native/helper/manifest reviewer and QA GO are parent-confirmed. Passed markers alone are insufficient: test, artifact, hash and final statuses were also inspected as 0. Actual deployment and benign receipts now passed with final reviewer/QA GO.

This is a local trial, not publication. External marketplace and plugin cache remain unchanged for later feedback/release; their promotion is not a completion gate.

**What changed:** Authorized runtime-first installation now targets the captured effective PATH binary `/home/joedegler/bin/clooks`; postimages, immutable snapshots and backups match the reviewed manifest. Other binaries and the existing launcher were preserved. Final benign probe receipts passed and remain distinct from installation evidence; see M4-DEPLOYMENT-EVIDENCE.md.
**Why it changed:** Local trials need a compatible provider-aware binary as well as portable hook source.
**Why it matters:** Require parent coordination, sequential reviewer and QA gates, explicit approval tools, verified backups and rollback. Preserve config, registrations, and lock provenance. Never run uninstall, init, or the global build script. Main-repository durable source is mandatory; scratch-only fixes are insufficient.

### Global Customizations and Tmux Shared State

**What changed:** Planned merge retains the task-notification skip, global compound-message wording, and already-newer global tmux behavior. No blind vendor replacement.
**Why it changed:** Global and repository preimages differ legitimately.
**Why it matters:** Review three-way merges and upstream tmux indexed-hook/global-style effects. The configured slot must be free: retained code can replace that slot, while tests establish preservation of other indices only. Shell interpolation remains an existing follow-up limitation, not a fix in this scope. Test with isolated tmux state. Preserve release lock bytes and separately document local source divergence; do not fabricate matching release hashes.
