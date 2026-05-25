# Attention Required

EPIC-0044 Plan B introduced an agent adapter boundary around the Clooks hook engine while preserving Claude Code behavior.

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
