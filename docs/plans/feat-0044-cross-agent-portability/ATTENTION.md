# Attention Required

EPIC-0044 Plan B introduced an agent adapter boundary around the Clooks hook engine while preserving Claude Code behavior. Plan C1 registration-data and shared-deletion corrections are complete and independently reviewed. Active-home changes remain planned for the next milestone.

## Registration Corrections

### Registration Ownership and Writes -- `src/agents/codex/settings.ts`, `src/settings.ts`, `src/registration-file.ts`

**What changed:** Recognize Clooks-generated commands precisely and reject malformed registration structures without overwriting them. Publish valid edits atomically, with replacement temporaries no more permissive than the destination before writing bytes. Shared strict reading also covers uninstall inspection counters; deletion control flow is unchanged.
**Why:** Substring ownership matching can remove unrelated commands; shape coercion and direct writes can lose user configuration.
**Review focus:** Preserve unrelated hooks and metadata, recognize existing generated commands including quoted paths, and leave original bytes intact on validation or write failure. This does not introduce a new permission model.

**Validation:** Independent code review and QA approved; 266 focused unit tests and 477 compiled-binary Docker E2E tests pass. Typecheck, formatting, lint and ShellCheck pass, with only existing lint warnings in untouched files. Native Codex execution and Claude raw-global-path quoting are not established by these checks.

### Active Codex Home and Shared Entrypoint -- init, uninstall, and launcher generation

**What will change:** Resolve the active Codex configuration home consistently, retain its cleanup identity in a separate record before registration, publish suppression state only after successful registration, and prevent one Codex home's state from suppressing project execution in another.
**Why:** Hard-coded home paths and prematurely written markers can point registration at the wrong configuration or suppress execution after failed setup.
**Review focus:** Preserve Claude defaults and the merged global/project pipeline; test marker migration and failure recovery. The proposed recovery record tracks one physical configuration home, while a separate suppression receipt uses POSIX `cksum` only for stale-file detection. Failed publication or remaining unknown-event references must retain the home identity and prevent a switch. Review absolute-path constraints, symlink aliases, missing utility fallback, legacy project scripts, and cleanup of both selected and recorded homes before shared deletion. Installation state cannot establish that native Codex hooks actually execute. Do not add trust authorization, runtime translation, or a universal exactly-once claim.

### Shared Runtime Deletion -- `src/commands/uninstall.ts` (complete)

**What changed:** All-agent cleanup follows the final deletion decision, including interactive decisions. Additional consent precedes writes, strict preflight rejects ambiguous or unsupported references, and a final inspection precedes shared-directory deletion. Each global flag clears after its corresponding successful unregister. Failures retain runtime for retry; completed files or prior scopes are not rolled back.
**Why:** A retained registration must not point at the runtime being deleted.
**Review focus:** Explicit deletion confirmation, cancellation without premature writes, selected-agent-only unhook behavior, and cleanup failure preventing shared-directory deletion. Cover both project and global scopes and document the boundary of active-home cleanup.

**Execution boundary:** All uninstall tests, including mocked units and real PTY smoke, run inside disposable Docker containers. No host uninstall command, global binary replacement, or real home/configuration mutation is permitted. Active Codex-home tracking remains the next milestone, not part of this deletion correction.

**Validation:** Independent code and QA approved; 231 focused unit tests, 44 uninstall journey tests and 510 full E2E tests passed in Docker. Typecheck, formatting, lint and ShellCheck passed. CLI and testing documentation describe per-scope cancellation and partial-failure limits.

Each implementation milestone requires unit tests, compiled-binary Docker E2E or smoke coverage through `bun run test:e2e`, independent code review, QA review, and same-milestone domain updates. Do not overwrite the working user's global binary or real configuration while validating.

## Danger Zone Changes

### Shared Runtime Abstraction -- `src/engine/run.ts`, `src/engine/types.ts`, `src/agents/*`

**What changed:** Plan B split the current Claude-shaped `runEngine()` path into a selector wrapper and `runEngineCore(adapter, deps)`, with agent-specific adapters under `src/agents/*`.
**Why it changed:** Codex support needs a clean translation boundary without scattering Codex conditionals through the existing Claude runtime.
**Why it matters:** `runEngine()` is on every hook invocation. A small mistake can break config loading, hook execution, circuit breaker behavior, or all engine-mode output.

### Fail-Closed Error Handling -- engine-mode exits and stderr

**What changed:** Plan B routes adapter selection and unsupported-agent failures through engine-mode diagnostics.
**Why it changed:** Unknown `CLOOKS_AGENT` values and unimplemented Codex support must fail clearly instead of silently falling back to Claude or allowing actions.
**Why it matters:** Clooks' core safety invariant is fail-closed behavior. Incorrect exit-code mapping can silently allow unsafe tool calls.

### Agent Wire Translation -- Claude output translator ownership

**What changed:** Plan B moved Claude Code output translation ownership behind the Claude adapter while keeping the existing translator behavior.
**Why it changed:** The shared engine core must not pretend Claude's wire JSON is agent-neutral.
**Why it matters:** Claude Code relies on exact output shapes such as `hookSpecificOutput.permissionDecision`, `decision: "block"`, and continuation stderr. Regressions here are user-visible and safety-sensitive.

### Event Recognition and Early Routing -- `hook_event_name`, `NOTIFY_ONLY_EVENTS`, and `ConfigChange`

**What changed:** Plan B made adapters own event-name validation and Claude-specific early/late routing behavior, including notify-only stderr routing and `ConfigChange` `policy_settings` downgrade semantics.
**Why it changed:** Codex has a different valid event set and different wire-output rules, while the current engine validates against Claude's event set and contains Claude-only behavior in the shared path.
**Why it matters:** Leaving these checks in the shared core would keep the runtime Claude-coupled. Moving them incorrectly can change when warnings appear, whether stdout is dropped, or whether policy-setting blocks are downgraded.

### Claude Plugin/Settings Advisories -- Claude-only behavior

**What changed:** Plan B keeps Claude plugin vendoring and stale-plugin / enable-without-install advisories on Claude adapter-owned helper paths only.
**Why it changed:** FEAT-0044 defines plugin-delivered hooks as Claude-Code-only, and Codex has a separate plugin/trust model.
**Why it matters:** Leaking `.claude/` settings reads or Claude plugin advice into Codex runs would confuse users and couple the future Codex adapter to the wrong distribution model. Direct `runEngineCore()` tests may pass the Codex placeholder; its plugin/advisory methods are no-ops while normalization and final translation remain unsupported.

## Residual Review Notes

- Codex remains runtime-unimplemented. `CLOOKS_AGENT=codex` must keep failing closed until Plan D adds and validates Codex normalization and translation.
- Do not add Codex registration or README support claims from Plan B alone. Plan C owns registration; Plan F owns user-facing support docs.
- Plan and epic files under this directory may be ignored by git. If committing Plan B closure docs, use `git add -f` for the plan/epic files that need it, but do not force-add unrelated scratch files.
