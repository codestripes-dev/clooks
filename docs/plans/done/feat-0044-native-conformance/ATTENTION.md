# Attention Required

Plan E M0 and scoped M1 are complete with independent code/QA runtime-evidence GO and parent closure GO. All six mandatory cases passed in one native attempt; no production changes or optional approval/subagent/compaction experiments were made. This archived note preserves the measured execution boundary.

## Danger Zone Changes

### Native Subprocess and Filesystem Boundary

**What was exercised:** Execute the pinned native Codex binary and generated registration in disposable Docker, with the explicit `x86_64-unknown-linux-musl` distribution read-only at `/native` and frozen source/script inputs read-only. Homes, configuration and tool effects remain disposable; owned synthetic captures export through `/export`. Each attempt verifies the binary SHA; version comes from the separate successful Docker preflight. M0 export sealing failed; M1 permission sealing and hash verification passed. Logs/status remain writable, so neither result establishes immutable storage.

**Why:** Local Clooks replay cannot establish that Codex invokes or consumes the integration.

**Why it matters:** Review the exact mount/environment allowlist, version/hash provenance, network-none loopback server, deadlines and cleanup. Outer runner is 300 seconds including compilation, test 180 seconds and each native case 60 seconds. No host home/auth/config/trust copies, shim execution, writable source mounts or host build/test/install/deploy. M0 has at most two technical attempts, with no Rust/acquisition fallback.

### Hook Trust and Enforcement Claims

**What is planned:** Use explicit disposable-project path trust and the pinned upstream exec-test precedent's hook-trust bypass with generated registration and synthetic configuration.

**Why:** Exercise native hooks without credentials or real trust-state changes.

**Why it matters:** Explicit path trust, hook-trust bypass and `--sandbox danger-full-access` do not prove ordinary trust establishment/review, default permissions or exactly-once delivery. The smoke verified baseline invocation, shell denial, rewrite effects, unsupported-ask refusal, context delivery and one Stop continuation/history-skip. PreToolUse context used ALLOW; SessionStart/UserPromptSubmit/PostToolUse used SKIP. Structured actual-request text proves delivery, not scripted assistant replies. Other events/options remain unverified; no upstream Rust-test or full-release claim follows.

### Shared Runtime and Recipient Delivery

**What is planned:** Test current behavior without changing production interfaces, launcher logic, failure policy, provider state or handoff eligibility. Keep handoff inline.

**Why:** Native conformance is the missing evidence; local implementation gates are complete.

**Why it matters:** A mismatch is not permission for an incidental production fix or broader event support. Amend plan/ATTENTION and obtain separate scope GO before changes in these shared areas. File existence, a pointer or parent readability does not establish native child access. Review remains an accepted nonblocking history limitation; trusted-repository policy is settled.
