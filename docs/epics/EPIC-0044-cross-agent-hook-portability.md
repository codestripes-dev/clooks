# EPIC-0044: Cross-Agent Hook Portability — Codex Adapter

**Status:** draft

## Summary

Make Clooks usable as a general-purpose hook framework across Claude Code and Codex without changing the existing `ClooksHook` authoring surface. The first concrete cross-agent target is Codex: register Clooks as one Codex command hook per supported Codex lifecycle event, normalize Codex hook payloads into Clooks' current event/context model, run the existing Clooks config/loading/execution pipeline, and translate Clooks results back to Codex JSON. The work is adapter-first, not a rewrite: Claude Code remains the primary mature target, while Codex support starts with a conservative supported subset and explicit capability checks.

## Features

- [`FEAT-0044-cross-agent-hooks.md`](../planned/FEAT-0044-cross-agent-hooks.md) -- primary feature. Cross-agent hook portability via `clooks init --agent <name>`.

### Spawned Features

- None yet.

### External Dependencies

- **FEAT-0018** (Cross-Agent Event Normalization) -- prior concept for mapping agent-specific events. This epic should either consume it or supersede its broad shape with a narrower adapter-first design.
- **FEAT-0041** (Plugin Distribution) -- establishes that Claude plugin-delivered hooks are Claude-only; portable hooks are custom or vendored Clooks hooks.
- **Codex hook trust/review model** -- project-local `.codex/` hook registration only runs after the project layer and hook commands are trusted/reviewed by Codex. This is an external product constraint.

## Research

### Strategic Research

| Doc | Status | What it covers |
|-----|--------|---------------|
| [`cross-agent-hooks.md`](../domain/cross-agent-hooks.md) | living | Current cross-agent hook landscape. Updated with Codex-specific mapping and adapter recommendation. |
| [`codex-hooks-integration.md`](../research/codex-hooks-integration.md) | exploratory | Codex hook locations, events, result mapping, adapter design. Note: new `docs/research/` files are currently gitignored in this repo. |

### Implementation Research

| Doc | Status | What it covers |
|-----|--------|---------------|
| Official Codex hooks docs | current source | Release-documented Codex hook events, config locations, trust model, command hook behavior, output contract. Refreshed 2026-05-23 UTC for Plan A. |
| Official Codex plugin docs | current source | Plugin hook packaging and plugin hook feature flag constraints. |
| Local verifier subagent report | concluded | Independent check of proposed flow. Confirmed adapter approach, corrected Codex result capability assumptions, identified Clooks code split points. |

### Empirical Spikes

| Doc | Status | What it verified |
|-----|--------|-----------------|
| Codex CLI runtime hook smoke spike | attempted | Disposable `HOME`, `CODEX_HOME`, and project directories were used with `codex-cli 0.133.0`. Network sandboxing first blocked the WebSocket; escalated rerun reached the OpenAI API but failed with `401 Unauthorized`, so no hook payloads were captured. |
| Codex registration/trust spike | partially attempted | The disposable project-local `.codex/hooks.json` shape could be created and passed to `codex exec --dangerously-bypass-hook-trust`, but model/auth access blocked confirming hook execution. Full registration/trust behavior remains Plan C. |

## User Journey

### Phase 1: Install Clooks

The user installs the Clooks binary as they do today. Nothing about hook authoring changes. They still write TypeScript hooks in `.clooks/hooks/` and register them in `.clooks/clooks.yml`.

### Phase 2: Initialize Codex Integration

The user runs:

```bash
clooks init --agent codex
```

Clooks creates or updates:

- `.clooks/` runtime files if missing
- `.codex/hooks.json` for project-scoped Codex registration

For global setup:

```bash
clooks init --global --agent codex
```

Clooks creates or updates:

- `~/.clooks/` runtime files
- `~/.codex/hooks.json`

The user sees a clear note that Codex may require hook review/trust before project hooks run.

### Phase 3: Codex Fires a Hook

Codex runs a configured command hook for a supported event, for example `PreToolUse`. The registered command points at the Clooks entrypoint and sets an agent marker:

```bash
CLOOKS_AGENT=codex CLOOKS_PROJECT_ROOT=/path/to/project /path/to/project/.clooks/bin/entrypoint.sh
```

For global registration, the command points at `~/.clooks/bin/entrypoint.sh`.

### Phase 4: Clooks Entrypoint Delegates

The existing bash entrypoint behavior remains useful:

- honors `SKIP_CLOOKS=true`
- locates the `clooks` binary on `PATH`
- captures stdin for debug replay
- pipes the original Codex JSON into the binary
- fail-closes unexpected binary failures

The key difference is that `CLOOKS_AGENT=codex` reaches the binary, where it selects the Codex adapter.

### Phase 5: Clooks Normalizes and Runs Hooks

The Codex adapter converts Codex wire JSON into the current Clooks internal event/context shape. Then the existing Clooks core runs:

- config discovery and loading
- home/project/local merge
- hook loading
- event matching
- ordering and parallel/sequential group execution
- lifecycle wrappers
- timeout handling
- fail-closed error handling
- circuit breaker degradation
- multi-hook result reduction

### Phase 6: Clooks Translates Back to Codex

The Codex adapter translates the reduced Clooks result into Codex JSON. It only emits fields Codex is known to honor. If a hook returns a capability Codex does not support, Clooks surfaces a clear warning or fail-closed diagnostic instead of silently pretending it worked.

### Phase 7: Steady State

The same hook can run under Claude Code and Codex when it uses shared lifecycle semantics. Claude-only or Codex-unsupported capabilities are visible in docs and diagnostics. Users can keep one `.clooks/clooks.yml` as the portable hook source of truth.

## Implementer Gotchas

| Gotcha | Why it matters | Source |
|--------|---------------|--------|
| Codex project registration cannot use `$CLAUDE_PROJECT_DIR`. | Current Clooks Claude registration command is Claude-specific. Codex registration needs an absolute path or must set `CLOOKS_PROJECT_ROOT`. | verifier report, `src/settings.ts` |
| `CLOOKS_AGENT=codex` does not mean runtime support yet. | Plan B now recognizes the selector, but the Codex adapter is a fail-closed placeholder until Plan D implements normalization and translation. | Plan B, `src/agents/codex/adapter.ts` |
| `runEngine()` now has an adapter boundary, but Claude is still the only runtime adapter. | Plan B split selection from `runEngineCore(adapter, deps)` and moved Claude wire parsing/output/advisories behind the Claude adapter. Downstream plans must preserve that boundary instead of adding Codex conditionals to the shared core. | Plan B, `src/engine/run.ts`, `src/agents/*` |
| Codex's documented API surface is narrower than Clooks' Claude surface. | `PermissionRequest` rewrites and interrupts are reserved/fail-closed. `PreToolUse` support for `ask`, `updatedInput`, and other parsed fields must be empirically verified before exposing. | verifier report, Codex docs |
| Codex command hooks require trust/review. | A successful `clooks init --agent codex` does not guarantee hooks run immediately in every project. CLI output and docs must explain review/trust. | Codex docs |
| Codex launches multiple matching command hooks concurrently. | Clooks must register one entrypoint per event and preserve multi-hook ordering internally. Do not register individual Clooks hooks directly with Codex. | Codex docs, design discussion |
| Codex plugin hooks are opt-in. | Plugin-only distribution will not reliably run hooks by default because `[features].plugin_hooks = true` is required. Use `.codex/hooks.json` first. | verifier report, Codex plugin docs |
| `transcript_path` can be nullable in Codex schemas. | Clooks `BaseContext.transcriptPath` is currently a string. The adapter needs a compatibility policy before types are widened. | research |

## Plans

### Dependency Graph

```text
Plan A: Codex Runtime Contract Verification
  |
  +--> Plan B: Agent Adapter Boundary
  |      |
  |      +--> Plan D: Codex Normalize/Translate MVP
  |              |
  |              +--> Plan E: Codex Test Harness + E2E
  |
  +--> Plan C: Codex Registration + Entrypoint
         |
         +--> Plan E: Codex Test Harness + E2E

Plan F: Docs + Distribution Guidance follows Plans C-E.
```

Plan B and Plan C can proceed in parallel after Plan A resolves the supported Codex surface. Plan D depends on the adapter boundary. Plan E validates the whole path. Plan F packages the user-facing story.

### Plan A: Codex Runtime Contract Verification

**Status:** completed, docs-backed but runtime-unverified
**Plan file:** [`docs/plans/feat-0044-cross-agent-portability/PLAN-FEAT-0044A-codex-runtime-contract-verification.md`](../plans/feat-0044-cross-agent-portability/PLAN-FEAT-0044A-codex-runtime-contract-verification.md)
**Capability matrix:** [`docs/plans/feat-0044-cross-agent-portability/codex-capability-matrix.md`](../plans/feat-0044-cross-agent-portability/codex-capability-matrix.md)
**Depends on:** Nothing.

**Goal:** Establish the exact Codex release-supported hook contract Clooks will implement first.

**Result:**
- Official Codex docs now list ten release events: `SessionStart`, `SubagentStart`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `UserPromptSubmit`, `SubagentStop`, and `Stop`.
- The first Clooks Codex adapter should start with all ten release-documented Codex events because Clooks already exposes matching Claude-side event names, including `SubagentStart` and `SubagentStop`.
- `PreToolUse.updatedInput` is docs-backed as supported only with `permissionDecision: "allow"` for Bash, `apply_patch`, and MCP tools. `PreToolUse.ask`, `suppressOutput`, `PostToolUse.updatedMCPToolOutput`, and `PermissionRequest` rewrites remain unsupported or hazardous.
- Durable Codex input fixtures now live under `test/fixtures/codex/events/` and are validated by `src/codex-fixtures.test.ts`.
- Runtime hook firing was not empirically verified because disposable Codex execution could not authenticate. Later implementation plans may proceed with adapter-boundary scaffolding and fixture-based tests, but shipping behavior that blocks, rewrites, or continues Codex turns still needs live verification or a documented release-confidence decision.

**Key files:**
- `docs/domain/cross-agent-hooks.md`
- `docs/research/codex-hooks-integration.md`
- `tmp/` spike artifacts
- future Codex fixture files under `test/fixtures/` if retained

**Relevant research:** Codex hooks docs, verifier report, `codex-hooks-integration.md`.

---

### Plan B: Agent Adapter Boundary

**Status:** completed
**Plan file:** [`docs/plans/feat-0044-cross-agent-portability/PLAN-FEAT-0044B-agent-adapter-boundary.md`](../plans/feat-0044-cross-agent-portability/PLAN-FEAT-0044B-agent-adapter-boundary.md)
**Depends on:** Plan A.

**Goal:** Split the current Claude-shaped engine flow into reusable core execution plus agent-specific wire adapters, with no behavior change for Claude Code.

**Scope:**
- Introduce an internal `AgentAdapter` concept for `claude-code` and `codex`.
- Move Claude-specific output translation behind a Claude adapter.
- Separate engine core from stdin wire parsing and final wire output.
- Keep config loading, hook loading, matching, execution, lifecycle, ordering, failures, and reduction shared.
- Preserve existing Claude tests and add adapter-boundary tests. Use Plan A Codex fixtures for contract tests, but keep live Codex CLI tests out of the default unit suite.
- Ensure Claude plugin/settings advisories remain Claude-only and do not leak into Codex sessions.

**Key files:**
- `src/cli.ts`
- `src/engine/run.ts`
- `src/engine/translate.ts`
- `src/engine/types.ts`
- new `src/agents/claude-code/*`
- new `src/agents/codex/*`

**Relevant research:** verifier report, `docs/domain/cli-architecture.md`, `docs/domain/config.md`.

**Result:**
- Added internal `AgentAdapter` scaffolding for `claude-code` and `codex`.
- `CLOOKS_AGENT` now selects the adapter explicitly. Unset and `CLOOKS_AGENT=claude-code` preserve the Claude Code path. Unknown values fail closed. `CLOOKS_AGENT=codex` fails closed with a not-implemented diagnostic and does not claim Codex support.
- Split engine mode into `runEngine()` selector handling plus `runEngineCore(adapter, deps)` for the shared config/load/match/execute/reduce pipeline.
- Moved Claude wire event recognition, normalization, final-output translation, notify-only routing, `ConfigChange policy_settings` downgrade behavior, and Claude plugin/settings advisories behind the Claude adapter.
- Added unit and compiled-binary E2E coverage for adapter selection, Claude preservation, no payload sniffing, Claude-only advisory isolation, and the Codex placeholder.

**Remaining downstream scope:** Plan C still owns `.codex/hooks.json` registration and entrypoint command generation. Plan D still owns Codex normalization and Codex JSON output translation. Plan E still owns Codex fixture/E2E and any live Codex confidence decision. Plan F still owns user-facing Codex support docs and README claims.

---

### Plan C: Codex Registration + Entrypoint

**Status:** not started
**Plan file:** not yet written
**Depends on:** Plan A.

**Goal:** Add `clooks init --agent codex` registration that writes Codex hook config and invokes the existing Clooks entrypoint with explicit agent/project context.

**Scope:**
- Add Codex-specific registrar for `.codex/hooks.json` and `~/.codex/hooks.json`.
- Register one Clooks command hook per MVP-supported Codex event. Start with all ten release-documented Codex events: `SessionStart`, `SubagentStart`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `UserPromptSubmit`, `SubagentStop`, and `Stop`.
- Use absolute entrypoint paths or set `CLOOKS_PROJECT_ROOT`; do not depend on Claude-specific environment variables.
- Preserve existing `clooks init` behavior for Claude Code.
- Decide CLI shape: `--agent codex`, `--agent claude-code`, `--agent all`, and defaults.
- Make init output explain Codex trust/review requirements.
- Add unregister/update behavior to `clooks uninstall` if needed.

**Key files:**
- `src/commands/init.ts`
- `src/commands/init-entrypoint.ts`
- `src/settings.ts`
- new Codex registration module, likely `src/codex-settings.ts` or `src/agents/codex/settings.ts`
- `src/commands/uninstall.ts`

**Relevant research:** Codex hooks docs, verifier report.

---

### Plan D: Codex Normalize/Translate MVP

**Status:** not started
**Plan file:** not yet written
**Depends on:** Plan B.

**Goal:** Implement the first conservative Codex adapter for the release-documented event subset.

**Scope:**
- Normalize Codex wire JSON into Clooks internal context shape for the supported events.
- Carry Codex-specific metadata (`turn_id`, raw payload, nullable transcript path) without changing public hook author types unless a later decision requires it.
- Translate Clooks results into Codex JSON only for capability-matrix-supported fields.
- Add explicit diagnostics for unsupported capabilities, such as Codex-incompatible `PermissionRequest` rewrites.
- Preserve Clooks fail-closed behavior in a Codex-appropriate way.
- Support all ten release-documented Codex events in the first MVP. `SubagentStart` and `SubagentStop` mirror existing Clooks/Claude events, but their context-injection and continuation semantics must be tested explicitly.

**Key files:**
- new `src/agents/codex/normalize.ts`
- new `src/agents/codex/translate.ts`
- `src/types/contexts.ts`
- `src/types/results.ts`
- `src/engine/context-methods.ts`
- `src/engine/execute.ts`

**Relevant research:** Plan A capability matrix, verifier report.

---

### Plan E: Codex Test Harness + E2E

**Status:** not started
**Plan file:** not yet written
**Depends on:** Plan C, Plan D.

**Goal:** Prove the Codex path works from registered hook invocation through Clooks execution and Codex-compatible output.

**Scope:**
- Add unit tests for Codex normalization and translation.
- Add integration tests around `clooks init --agent codex` generated config.
- Add fixture-based end-to-end tests that replay Codex event payloads into the entrypoint/binary.
- Decide whether live Codex CLI tests belong in normal e2e, an opt-in suite, or a documented manual smoke test.
- Test unsupported capability diagnostics.
- Test project/global registration and `CLOOKS_PROJECT_ROOT` behavior.

**Key files:**
- `src/agents/codex/*.test.ts`
- `src/commands/init.test.ts`
- `test/e2e/`
- `test/fixtures/events/` or new `test/fixtures/codex/`

**Relevant research:** Plan A spikes, existing e2e patterns.

---

### Plan F: Docs + Distribution Guidance

**Status:** not started
**Plan file:** not yet written
**Depends on:** Plan C, Plan D, Plan E.

**Goal:** Document Codex support clearly, including what is portable, what is Claude-only, and what Codex cannot honor yet.

**Scope:**
- Update README install/init instructions for Codex.
- Update domain docs with final capability matrix.
- Document trust/review requirements and plugin-hook limitations.
- Document supported events and unsupported return capabilities.
- Add migration guidance for hook authors who want portable hooks.
- Decide whether `clooks config --resolved` should show agent portability warnings.

**Key files:**
- `README.md`
- `docs/domain/cross-agent-hooks.md`
- `docs/domain/cli-architecture.md`
- `docs/domain/config.md`
- `docs/domain/testing.md`

**Relevant research:** all prior plans.

## Design Decisions

| Decision | Resolution | Source |
|----------|-----------|--------|
| First cross-agent target | Codex. Cursor/Windsurf/Copilot remain future targets. | User request, 2026-05-17 |
| Authoring surface | Preserve existing `ClooksHook` for the first Codex integration. Add adapter translation at the edge. | Research discussion, 2026-05-17 |
| Registration granularity | Register one Clooks entrypoint per Codex event, not one command per Clooks hook. Clooks owns ordering/reduction internally. | Research discussion, verifier report |
| Distribution default | Use user/project `.codex/hooks.json` registration first. Treat Codex plugin hooks as later/optional because plugin hooks are opt-in. | verifier report |
| Supported event subset | Codex now documents ten events. Start the first Clooks adapter with all ten because Clooks already exposes matching Claude-side event names. Subagent events need careful translation tests, not a new public surface. | User direction 2026-05-25, README parity map, Plan A capability matrix, Codex docs |
| Capability policy | Emit only Codex-supported fields. Unsupported Clooks result capabilities must warn or fail clearly rather than silently degrade. | verifier report |

## Open Questions

| Question | Relevant Plan | Notes |
|----------|--------------|-------|
| Does Codex release behavior honor `PreToolUse` `ask` or `updatedInput`? | Plan A, Plan D | Current docs say `ask` is unsupported/fail-open and `updatedInput` is supported only with `permissionDecision: "allow"` for Bash, `apply_patch`, and MCP tools. Runtime verification remains blocked by disposable auth. |
| What is the exact Codex-compatible fail-closed channel? | Plan A, Plan D | Docs describe JSON stdout and selected exit-code behavior, but live verification remains blocked by disposable auth. |
| Should `transcriptPath` stay a string with an adapter fallback, or become nullable in public types? | Plan D | Prefer adapter fallback for first pass. |
| Should `ctx.raw` / `ctx.agent` become public? | Plan D or later feature | Useful for cross-agent hooks, but it is a public API decision. |
| What should `clooks init` default to when no `--agent` is passed? | Plan C | Current behavior implicitly means Claude Code. |
| Should Codex registration be project-committed by default? | Plan C | Need to reconcile team onboarding with Codex trust/review. |
| Should `clooks uninstall` remove Codex registrations in the same command? | Plan C | Likely yes, but depends on CLI shape. |
| Should `clooks test` gain `--agent codex`? | Plan E or separate feature | Useful for hook authors once adapter exists. |

## Revision Log

- 2026-05-17: Created. Initial Codex-first cross-agent epic with six-plan milestone order.
- 2026-05-23: Updated after Plan A execution. Codex docs now show ten release events, Plan A produced a docs-backed matrix and fixtures, and downstream plans remain gated for safety-critical runtime behavior until live hook firing can be verified.
- 2026-05-25: Promoted Codex `PreCompact` and `PostCompact` into the first adapter MVP because they mirror existing Clooks events. This was later expanded the same day to include subagent events too.
- 2026-05-25: Promoted Codex `SubagentStart` and `SubagentStop` into the first adapter MVP after confirming README documents matching Clooks/Claude events. Subagent semantics remain implementation risks to test, not scope exclusions.

## Instruction Prompts

- **2026-05-17** (Joe Degler):

  > "One of our roadmap goals is that this actually becomes a general-purpose hook framework, working across Codex and Claude.
  > Your job right now is to scope out, research, what the shape of Codex Hooks is and how we can neatly tie them into Clooks.
  > We either need a translation layer from Codex to Clooks, without changing existing surface, or need to come up with a different solution.
  > This is all just ideating and research work for now."

- **2026-05-17** (Joe Degler):

  > "Start a separte subagent to verify each step independently."

- **2026-05-17** (Joe Degler):

  > "Okay. Create an EPIC according to our workflows (look at CLAUDE.md if needed) that outlines the changes we want to do. You don't have to write every PLAN yet, but we should get started getting deliverable targets and goals and a milestone order ready."
