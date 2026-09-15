# Tooling Friction

Build issues, slow commands, flaky CI, broken toolchain steps, or other tooling problems that blocked or slowed progress.

### Repository shell lint reports an existing trap warning and traverses excluded artifacts

**Severity:** friction
**Date:** 2026-09-15
**Context:** Optional shell lint during generated native approval smoke validation.

The validation owner reports `bun run lint:sh` fails on pre-existing ShellCheck
SC2329 at `scripts/test-codex-native.sh:31` (trap function reported never invoked).
Its `find` also traverses excluded `./tmp` exports and emits permission warnings.
Targeted `shellcheck scripts/test-approvals-native.sh test/native-approvals/container.sh`
passes; the full Docker validation separately passes. The targeted result does
not turn the repository-wide lint failure into a pass.

**Disposition:** Unresolved, outside the smoke scope. No lint/script correction
or artifact permission changes made; retain the existing warning and traversal
issue for a separately scoped fix.

### Claude interactive MCP connection logs do not establish first-turn hook readiness

**Severity:** friction
**Date:** 2026-09-15
**Context:** Isolated native approval probes with Claude Code 2.1.272, Codex CLI 0.154.0 and MCP SDK 1.26.0; local model and approval replies are scripted.

Claude reported a connected MCP server before first-turn hooks skipped it as not connected. Normal disk config, removing only `--tools`, and an unchanged same-home fresh-session restart still denied `MCP peer unavailable`, with no MCP call or effect. In `tmp/approvals-native/run-8DWosWUB` (rc 0), the first call denied but a distinct second call in the same process/session/server completed two approvals and one native effect. Conversely, `run-Ct839KZ6` completed approvals and an effect on its first turn; the diagnostic's required-denial assertion failed and the run retained rc 1. That diagnostic did not reproduce the first-denial precondition, rather than demonstrating a native approval failure.

**Disposition:** Bounded diagnosis stopped without a readiness fix. First-turn availability is intermittent in this fixture, not universally broken. Connection logs are insufficient readiness evidence; per-turn state publication is a hypothesis, not a proved merge bug or documented solution. Retain native failures and distinguish second-turn diagnostic success from reliable first-turn interaction. No production go, real configuration changes or further experiments are implied. See [native probe limitations](../domain/testing/interactive-approvals.md#claude-interactive-config-discriminators); detailed receipts remain in the owned run directories.

### Codex sandbox drops Bun child-process stdin over sockets

**Severity:** friction
**Date:** 2026-09-10
**Context:** Planned Claude review stdin diagnosis in [PLAN-0080 progress](../plans/codex-ask-hybrid/PLAN-0080-codex-ask-hybrid.md#progress).

Claude 2.1.268 launched inside the Codex exec sandbox reached the global Clooks launcher with empty stdin (four capture dumps contained only one newline byte), causing the JSON parse failure. The parent reports that the normal-permission launch with hooks enabled succeeds. Inspected Claude embedded hook code imports `child_process.spawn` with `shell: true, detached: true`, then calls `stdin.write` and `stdin.end`.

The disposable probe `timeout --signal=KILL 35s bun tmp/claude-stdin-diagnosis/transport-probe.ts`, run from the repository root under Bun 1.3.10, reproduced zero-byte delivery to `/usr/bin/cat` with valid `Bun.spawn` writer `write(payload); end()`: `end()` returned `EPERM: operation not permitted, send`. Under Bun, `node:child_process` both `end(payload)` and write/end silently delivered zero bytes without stream error events, including with shell/detached enabled. The API's `"pipe"` stdin descriptors were sockets, not FIFOs. Blob (memfd) and shell printf (FIFO) controls delivered the exact 29-byte JSON payload; `Bun.stdin.json()` parsed both successfully. No sandbox case timed out. The parent reports the identical elevated probe passed all 13 cases with correct output bytes, exit 0, and no errors or timeouts.

This reproduces a sandbox/Bun transport incompatibility that strongly explains the Claude symptom, not a demonstrated Clooks parser defect. No denied `send` was traced inside embedded Claude itself; the probe's descriptor inspection does not establish exact UNIX-STREAM/socketpair creation. Claude's separate `EROFS` creating `~/.claude/session-env/<session>` before SessionStart does not directly explain UserPromptSubmit's empty input.

**Disposition:** Use approved normal-permission Claude launches with hooks enabled, not `SKIP_CLOOKS` or a weakened parser. The original disposable diagnostic spike made no production or global hook changes. Clooks now has a tested diagnostic-only empty-input correction; it does not repair this unresolved transport incompatibility or establish an upstream fix. Global hook settings remain unchanged.

### Generated declaration formatting after regeneration remains unverified

**Severity:** note
**Date:** 2026-09-08
**Context:** Read-only static checks during validation-runner integration.

Historical `static-PrdZbw` passed lint and changed-file Prettier checks, but project `format:check` failed solely for tracked `src/generated/clooks-types.d.ts`. That baseline failure is no longer current: full format checks passed on 2026-09-10 and the generated file has no diff against HEAD. No generated source was changed to hide the earlier failure.

Read-only inspection of `scripts/generate-types.ts` still shows bundle output written directly to all three mirrors without a formatter. Regeneration was not run during diagnostic-only finalization, so formatting after regeneration remains unverified rather than a demonstrated current failure. Retain this bounded generator caveat; no generator correction is claimed.

### bun build --compile skips type checking

**Severity:** friction
**Date:** 2026-03-09
**Context:** During PLAN-08 circuit breaker implementation, extracting `executeHooks` from `runEngine` left a dangling `debug` variable reference.

`bun build --compile` compiled without error, but the binary crashed at runtime with "debug is not defined". Bun's compile step performs bundling and tree-shaking but does not run TypeScript type checking, so undeclared variable references slip through silently. The result is a binary that looks good but fails at runtime — the worst kind of feedback loop.

**Resolution:** Added `tsc --noEmit` before `bun build` in the build script. This is now the project convention — type errors block the build.

### Lint state on master drifting undetected despite Lefthook pre-commit

**Severity:** friction
**Date:** 2026-04-19
**Context:** During PLAN-0016 (GitHub release workflow), running `bun run lint` as part of local pre-commit validation revealed master carries 13 lint errors and 94 warnings.

PLAN-0010 set up Lefthook with pre-commit lint on staged files, yet these errors exist on master. The errors span unused imports, an `Function` type usage, unused fn args, and a `preserve-caught-error` violation across `src/config/index.ts`, `src/config/parse.test.ts`, `src/config/parse.ts:22`, `src/config/validate.ts`, `src/lifecycle.ts`, `src/tui/output.test.ts`, and `src/types/lifecycle.test.ts`. Possible mechanisms: (a) Lefthook isn't catching new errors, (b) errors were introduced via rebases / squash merges / `--no-verify` commits, or (c) the hook only lints staged files so errors in untouched files persist invisibly. Whatever the cause, master's lint state is drifting and no safety net catches it.

**Resolution:** Fixed the 13 errors as a separate commit immediately before PLAN-0016's work. The systemic gap — no PR-triggered CI lint gate — remains. PLAN-0016 has a deferred item to "stand up a separate PR-triggered CI workflow (Next)" which would address this; until then drift will recur.

### `package.json` prepare script fails on CI (Lefthook not installed)

**Severity:** friction
**Date:** 2026-04-19
**Context:** First tag-triggered run of PLAN-0016's GitHub release workflow.

`bun install --frozen-lockfile` failed on the GitHub-hosted runner because `package.json` declares `"prepare": "lefthook install"`. Lefthook is installed locally via mise (per PLAN-0010) but is not present on CI runners. The npm `prepare` lifecycle script ran automatically post-install, couldn't find `lefthook` on PATH, and exited 127 — breaking the entire install step.

**Resolution:** Release workflow now runs `bun install --frozen-lockfile --ignore-scripts`. CI doesn't need git hooks installed, so skipping lifecycle scripts is safe. The underlying `package.json` coupling remains — any future CI setup (PR-triggered workflow, Docker image build, new contributor running `bun install` without mise) will hit the same failure unless they remember the `--ignore-scripts` flag.

**Durable fix candidates:** (a) move the `lefthook install` call out of the npm `prepare` lifecycle into a dedicated `bun run install-hooks` target that local devs invoke explicitly; (b) gate the `prepare` script on `CI` env var so it no-ops on CI (`"prepare": "[ \"$CI\" = \"true\" ] || lefthook install"`). Option (b) is the least-invasive durable fix.

### Disposable Codex live hook spikes need explicit binaries and auth state

**Severity:** friction
**Date:** 2026-05-24
**Context:** During EPIC-0044 Plan A, running a disposable Codex live hook spike under `/tmp` with temporary `HOME` and `CODEX_HOME`.

The asdf shim failed because the temp project had no configured node/codex version. The workaround was to resolve the real `codex` and `node` binaries with `asdf which` and put the node bin dir on `PATH` in the spike script. A later live spike was blocked first by sandbox networking, then by `401 Unauthorized` with disposable `CODEX_HOME`, so live hook firing could not be verified without carrying usable auth state into the disposable environment.

### Exact-release source acquisition required the remaining git route

**Severity:** friction
**Date:** 2026-09-07
**Context:** Bounded Codex `0.153.4` source acquisition for the runtime contract audit.

The initial GitHub `commits/rust-v0.153.4` lookup was ambiguous between a branch and tag with that name, and the downloaded archive was discarded with its container. Its commit and checksum therefore did not establish exact-tag provenance with retained bytes. The second and final permitted route fetched `refs/tags/rust-v0.153.4` explicitly and retained a git-generated archive. Tag object `042fb41b7c813ac7999105e886b2b7aa715b5081` peeled to the already inspected commit `3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`; matching 4,177-file manifests bound the inspection to the exact release. The retained archive SHA-256 is `45375e73d04b57a0e36520f88c8ebfd22f0eb400410b5ce40ad9b3b2dcbf07a0`. It is a different archive representation from codeload, so the historical hashes are not interchangeable.

**Resolution:** Acquisition is resolved within the two-route allowance; both routes are consumed and no third source fetch is authorized. Preserve both attempt records and distinguish exact refs, peeled commits, retained bytes and hashes in future bounded acquisitions. Docker socket permission denial was resolved through sandbox escalation with the daemon already running; this was an access issue, not evidence that Docker was unavailable. This acquisition resolution does not report the separate bounded toolchain retry's outcome or imply upstream tests ran.

### Bounded upstream execution retry stopped at locked dependency preparation

**Severity:** friction
**Date:** 2026-09-07
**Context:** Attempting original upstream parser/executor validation after exact-release source acquisition.

The initial cached-container feasibility attempt found no cargo/rustc and executed zero tests. The parent reports that the one permitted retry stopped during dependency preparation: `cargo fetch --locked` refused the required update to upstream `Cargo.lock`. The retry exited 101 after 49 seconds. No tests ran in either attempt, and no parser/executor `P` evidence was produced. The reason the lockfile needed updating is not established by this report.

**Disposition:** The bounded retry allowance is exhausted; execution remains unverified. Cleanup is confirmed: the owned container was removed and the label-filtered container listing was empty. Detailed evidence recording remains with the runner. Source acquisition remains resolved, and this dependency-preparation failure does not invalidate the pinned-source inspection or establish general toolchain unavailability.
