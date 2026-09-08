# EPIC-0044: Cross-Agent Hook Portability — Codex Adapter

**Status:** active

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
| [Continuation review](../plans/feat-0044-cross-agent-portability/continuation-review.md) | reviewed 2026-09-07 | Reassesses registration authority, recovery, adapter policy, handoff/turn state, and proposed next deliverables against HEAD `74eda9b`. No new live runtime verification. |

### Empirical Spikes

| Doc | Status | What it verified |
|-----|--------|-----------------|
| Codex CLI runtime hook smoke spike | attempted | Disposable `HOME`, `CODEX_HOME`, and project directories were used with `codex-cli 0.133.0`. Network sandboxing first blocked the WebSocket; escalated rerun reached the OpenAI API but failed with `401 Unauthorized`, so no hook payloads were captured. |
| Codex registration/trust spike | partially attempted | The disposable project-local `.codex/hooks.json` shape could be created and passed to `codex exec --dangerously-bypass-hook-trust`, but model/auth access blocked confirming hook execution. Plan C implemented generated registration and file-level E2E without live Codex hook firing. |

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

The Codex adapter translates the reduced Clooks result into Codex JSON. It only emits fields Codex is known to honor. The proposed runtime design checks unsupported capabilities before individual results affect the pipeline; unsupported safety decisions must not become allow merely because a warning was emitted. Observational events and failures with no identifiable event need their own documented output policy.

### Phase 7: Steady State

The same hook can run under Claude Code and Codex when it uses shared lifecycle semantics. Claude-only or Codex-unsupported capabilities are visible in docs and diagnostics. Users can keep one `.clooks/clooks.yml` as the portable hook source of truth.

## Implementer Gotchas

| Gotcha | Why it matters | Source |
|--------|---------------|--------|
| Codex project registration cannot use `$CLAUDE_PROJECT_DIR`. | Current Clooks Claude registration command is Claude-specific. Codex registration needs an absolute path or must set `CLOOKS_PROJECT_ROOT`. | verifier report, `src/settings.ts` |
| `CLOOKS_AGENT=codex` does not mean runtime support yet. | The placeholder refuses runtime execution with stderr and exit 2. Whether that prevents an upstream operation is event-specific and unverified. | Plan B, September continuation review, `src/agents/codex/adapter.ts` |
| `runEngine()` now has an adapter boundary, but Claude is still the only runtime adapter. | Plan B split selection from `runEngineCore(adapter, deps)` and moved Claude wire parsing/output/advisories behind the Claude adapter. Downstream plans must preserve that boundary instead of adding Codex conditionals to the shared core. | Plan B, `src/engine/run.ts`, `src/agents/*` |
| Codex's documented API surface is narrower than Clooks' Claude surface. | `PermissionRequest` rewrites and interrupts are reserved/fail-closed. `PreToolUse` support for `ask`, `updatedInput`, and other parsed fields must be empirically verified before exposing. | verifier report, Codex docs |
| Codex command hooks require trust/review. | A successful `clooks init --agent codex` does not guarantee hooks run immediately in every project. CLI output and docs must explain review/trust. | Codex docs |
| Codex launches multiple matching command hooks concurrently. | Clooks must register one entrypoint per event and preserve multi-hook ordering internally. Do not register individual Clooks hooks directly with Codex. | Codex docs, design discussion |
| Plugin distribution is a separate integration. | Keep command-hook JSON distribution first because it matches Clooks' existing runtime and ownership model. Do not rely on the historical claim that plugin hooks are disabled by default. | September continuation review |
| `transcript_path` can be nullable in Codex schemas. | Clooks `BaseContext.transcriptPath` is currently a string. The adapter needs a compatibility policy before types are widened. | research |
| A global installation flag is not proof that a global hook will execute. | Registration failure, disabled/untrusted commands, and alternate Codex homes can invalidate project-entrypoint suppression. Correct these activation/dedup defects without changing the repository trust model. | September continuation review, user clarification |
| Final-output translation cannot police every hook result. | Reduction can discard an unsupported result after it already affected the pipeline. Validate per-hook capabilities before input mutation, handoff, and reduction. | September continuation review |
| Handoff and turn state were added after the adapter boundary. | Runtime work must include delivery audience, private invocation identity, turn boundaries, and provider isolation. | `74eda9b`, September continuation review |

## Plans

### Dependency Graph

```text
Completed: A (runtime-unverified), B (adapter boundary), C (registration)
  |
  +--> C1: Registration Correctness --------+
  |                                       |
  +--> Bounded runtime contract refresh ---+
                                          |
                                          +--> D: Codex Runtime + Capability Policy
                                                  |
                                                  +--> E: Upstream Conformance + Full Workflow
                                                          |
                                                          +--> F: Docs + Distribution Guidance
```

Plan B and Plan C remain historically complete. The September reassessment proposes corrective registration work before runtime activation; it does not undo those results or claim release readiness. The detailed continuation rationale lives in the linked review. Every future production milestone includes unit and compiled-binary Docker E2E; Plan E adds upstream confidence rather than deferring ordinary E2E until the end. Repository trust is settled: preserve the current merged-global model and scope dedup work to demonstrated correctness defects.

### Plan A: Codex Runtime Contract Verification

**Status:** completed, docs-backed but runtime-unverified
**Plan file:** [`docs/plans/feat-0044-cross-agent-portability/PLAN-FEAT-0044A-codex-runtime-contract-verification.md`](../plans/feat-0044-cross-agent-portability/PLAN-FEAT-0044A-codex-runtime-contract-verification.md)
**Capability matrix:** [`docs/plans/feat-0044-cross-agent-portability/codex-capability-matrix.md`](../plans/feat-0044-cross-agent-portability/codex-capability-matrix.md)
**Depends on:** Nothing.

**Goal:** Establish the exact Codex release-supported hook contract Clooks will implement first.

**Result:**
- The May 2026 official documentation snapshot listed ten release events: `SessionStart`, `SubagentStart`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `UserPromptSubmit`, `SubagentStop`, and `Stop`. This is historical evidence, not the full September catalog.
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
- `CLOOKS_AGENT` selects the adapter explicitly. Unset and `CLOOKS_AGENT=claude-code` preserve the Claude Code path. Unknown values and `CLOOKS_AGENT=codex` refuse runtime execution with stderr and exit 2; the latter reports a not-implemented diagnostic. Whether the upstream agent blocks an operation is event-specific and remains unverified for Codex.
- Split engine mode into `runEngine()` selector handling plus `runEngineCore(adapter, deps)` for the shared config/load/match/execute/reduce pipeline.
- Moved Claude wire event recognition, normalization, final-output translation, notify-only routing, `ConfigChange policy_settings` downgrade behavior, and Claude plugin/settings advisories behind the Claude adapter.
- Added unit and compiled-binary E2E coverage for adapter selection, Claude preservation, no payload sniffing, Claude-only advisory isolation, and the Codex placeholder.

**Remaining downstream scope:** Plan D still owns Codex normalization and Codex JSON output translation. Plan E still owns Codex fixture replay through the runtime path and any live Codex confidence decision. Plan F still owns user-facing Codex support docs and README claims.

---

### Plan C: Codex Registration + Entrypoint

**Status:** completed
**Plan file:** [`docs/plans/feat-0044-cross-agent-portability/PLAN-FEAT-0044C-codex-registration-entrypoint.md`](../plans/feat-0044-cross-agent-portability/PLAN-FEAT-0044C-codex-registration-entrypoint.md)
**Depends on:** Plan A, Plan B.

**Goal:** Add `clooks init --agent codex` registration that writes Codex hook config and invokes the existing Clooks entrypoint with explicit agent/project context.

**Result:**
- Added Codex-specific registrar support for `.codex/hooks.json` and `~/.codex/hooks.json`.
- Registered one Clooks command hook per MVP-supported Codex event: `SessionStart`, `SubagentStart`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `UserPromptSubmit`, `SubagentStop`, and `Stop`.
- Project Codex commands set `CLOOKS_AGENT=codex`, set `CLOOKS_PROJECT_ROOT` to the absolute project root, and call the absolute project `.clooks/bin/entrypoint.sh`. Global Codex commands set `CLOOKS_AGENT=codex`, call the absolute `~/.clooks/bin/entrypoint.sh`, and intentionally omit `CLOOKS_PROJECT_ROOT`.
- `clooks init` now accepts `--agent claude-code`, `--agent codex`, and `--agent all`; omitted `--agent` remains Claude Code-only for compatibility. Codex init output explains Codex hook review/trust requirements without claiming runtime Codex support.
- `clooks uninstall` now accepts the same agent selector. `--unhook` removes selected-agent registrations while preserving unrelated hooks. `--full` unhooks all known Clooks agent registrations before deleting the shared `.clooks/` entrypoint directory to avoid dangling registrations.
- Global entrypoint dedup is agent-aware: Claude Code keeps `~/.clooks/.global-entrypoint-active`, and Codex uses `~/.clooks/.global-entrypoint-active.codex`.
- Added focused unit coverage and compiled-binary E2E coverage for Codex registration, idempotency, all-agent init, global flags, and Codex-only unhook preservation.

**Remaining downstream scope:** Plan D still owns Codex runtime normalization and Codex JSON output translation. Plan E still owns fixture replay through the Codex runtime path and any live Codex confidence decision. Plan F still owns user-facing Codex support docs and README claims.

**Key files:**
- `src/commands/init.ts`
- `src/commands/init-entrypoint.ts`
- `src/settings.ts`
- `src/agents/codex/settings.ts`
- `src/commands/uninstall.ts`

**Relevant research:** Codex hooks docs, verifier report.

---

### Plan C1: Registration Correctness

**Status:** in progress; Milestones 1 and 2 complete, Milestone 3 not started
**Plan file:** [Registration Correctness](../plans/feat-0044-cross-agent-portability/PLAN-FEAT-0044C1-registration-correctness.md)
**Depends on:** Plans B and C. Deterministic registration fixes do not depend on a live Codex run or the full runtime contract refresh; that refresh remains a prerequisite for Plan D.

**Goal:** Make registration recoverable while preserving trusted-repository assumptions and the existing merged global/project pipeline.

**Milestone 1 result:** Strict registration-file validation, precise generated-command ownership, unrelated-data preservation and atomic replacement are implemented for both registrars. Independent code and QA reviews approved; 266 focused unit tests and 477 compiled-binary Docker E2E tests passed at that gate. CLI architecture, bash entrypoint, cross-agent hooks and testing knowledge were updated. Interactive deletion followed in Milestone 2 below; active-home/receipt corrections remain pending and Codex runtime remains unsupported.

**Milestone 2 result:** Final deletion intent now controls all-agent cleanup, with explicit consent, preflight, remaining-reference checks and recoverable partial failure. Independent code and QA approved; 231 focused units and 510 full E2E tests passed inside Docker, including real PTY journeys. CLI/testing knowledge documents were updated. Active-home/receipt corrections remain Milestone 3; no Codex runtime activation or host installation changes were made.

**Scope:**
- Correct failed-init marker publication, active Codex-home resolution, interactive deletion, ownership detection, and malformed-shape preservation.
- C1 specifies tracking one global Codex home in a pre-write recovery record, with a separate post-success suppression receipt and stale-file checks. Explicit unhook must remove all known references before changing that home. Global deletion cleans selected and recorded homes; unrecorded historical homes require explicit cleanup. These are registration constraints, not a new permission model.
- Correct deterministic dedup failures while preserving merged execution; installed markers alone cannot establish native activation or exactly-once execution. Document that limitation; native conformance belongs to Plans D/E. Repository authorization redesign is out of scope.
- Retain absolute project commands and the accepted re-init-after-relocation tradeoff. Test repair with the old checkout still present and preserve nested-root behavior. Agent-aware inherited-environment handling belongs to the runtime boundary in Plan D, not a discovery redesign here.
- Include a regression test for each correction, applicable compiled-binary Docker E2E or smoke coverage, danger-zone review, and domain updates with each implementation milestone.

**Key files:** `src/agents/codex/settings.ts`, `src/commands/init.ts`, `src/commands/uninstall.ts`, `src/commands/init-entrypoint.ts`, and their unit/E2E tests. Existing discovery and loading boundaries are preservation checks, not redesign targets.

**Relevant research:** September continuation review and refreshed version-specific contract evidence.

---

### Plan D: Codex Runtime + Capability Policy

**Status:** not started
**Plan file:** not yet written
**Depends on:** Plan B, corrective Plan C1, and refreshed runtime contract evidence.

**Goal:** Implement the first conservative Codex adapter for the release-documented event subset.

**Scope:**
- Normalize Codex wire JSON into Clooks internal context shape for the supported events.
- Carry private invocation metadata separately from public context; preserve opaque tool data and define round-trip input codecs.
- Validate each hook's capabilities before handoff, input mutation, and reduction, then translate only supported final fields.
- Define supported refusal behavior for unsupported safety controls, and honest diagnostics for observational events and unknown-event failures.
- Include event-aware failure routing, turn identity/boundaries, provider isolation, and handoff delivery eligibility.
- Support all ten agreed MVP events. New upstream events require a separate scope decision. Include unit and compiled-binary E2E with each production milestone.

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
- Extend the unit and fixture-based compiled-binary E2E already required in Plan D into upstream conformance and complete registered workflows.
- Distinguish docs-shaped fixtures, pinned upstream executor evidence, and live captured payloads with provenance.
- Decide whether live Codex CLI tests belong in normal e2e, an opt-in suite, or a documented manual smoke test.
- Test unsupported capability diagnostics.
- Test `CLOOKS_PROJECT_ROOT` behavior in the runtime path using generated Codex-style commands.

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
| Distribution default | Keep command-hook JSON distribution and existing merged home/project/local execution. Correct concrete registration/dedup defects; plugin distribution remains separate scope. | September continuation review and user clarification |
| Repository trust | Using Clooks assumes the repository is trusted. No separate project authorization layer, home-only global mode, or permission-model redesign is required. Tighter permissions are deferred. | Explicit user direction, 2026-09-07 |
| Supported event subset | Retain the agreed ten-event MVP. The current upstream catalog is broader; event-name parity alone does not establish payload/result parity. | User direction 2026-05-25, September continuation review |
| Capability policy | Proposed tightening: validate each result before pipeline effects, not only at serialization. Unsupported safety controls cannot silently become allow through a warning or reduction. | September continuation review |
| Public compatibility | Preserve authoring syntax where semantics match; do not fabricate tool shapes or transcript paths to claim universal portability. Private metadata does not require a public raw-payload API. | September continuation review |
| Release sequencing | Ship functioning registration/runtime/testing/docs together. No intermediate CLI staging warnings. Each production milestone carries its own unit and Docker E2E coverage. | User direction 2026-05-26, September continuation review |

## Open Questions

| Question | Relevant Plan | Notes |
|----------|--------------|-------|
| Which input rewrites and permission controls does the selected release honor? | Contract refresh, Plan D | Revalidate the historical matrix against the selected version, including newer local-tool paths. The previous live attempt was blocked by disposable auth; this review did not retry it. |
| What is the exact Codex-compatible fail-closed channel? | Plan A, Plan D | Docs describe JSON stdout and selected exit-code behavior, but live verification remains blocked by disposable auth. |
| Should `transcriptPath` stay a string with an adapter fallback, or become nullable in public types? | Plan D | Prefer adapter fallback for first pass. |
| Should `ctx.raw` / `ctx.agent` become public? | Plan D or later feature | Useful for cross-agent hooks, but it is a public API decision. |
| Should `clooks test` gain `--agent codex`? | Plan E or separate feature | Useful for hook authors once adapter exists. |
| How should demonstrated dedup failures be corrected? | C1 | Preserve merged execution and the trusted-repository model; test failed registration, active Codex home, and controlled layered launcher execution. Static markers cannot establish native activation; D/E retain upstream conformance coverage. |
| How do native turns and Stop continuation map to `ctx.turn`? | Plan D | Audit parent/child scope, duplicate prompts, provider isolation, compaction/resume, and the meaning of one user turn. |
| Should the MVP include newly documented SessionEnd/Interrupt? | Separate scope decision | Recommendation: retain the agreed ten; assess additions after the first working adapter. |

## Revision Log

- 2026-09-07: Completed C1 planning with three ordered milestones and independent product/code/QA review. Corrected recovery-state gaps before implementation; retained domain updates and unit/Docker/interactive-smoke gates in every applicable milestone. No production code or tests changed in this drafting task.
- 2026-09-07: Began the delegated C1 ExecPlan draft and linked it. Deterministic registration corrections can proceed independently of the runtime contract refresh. Retained machine-local absolute commands with re-init after relocation; native activation and provider-aware runtime discovery remain downstream scope.
- 2026-09-07: User confirmed repository trust as a Clooks assumption. Withdrew the proposed separate authorization/release gate; preserve existing global/home/project/local merging and defer tighter permission models. Every correction retains regression and applicable E2E/smoke requirements.
- 2026-09-07: Resumed research at HEAD `74eda9b`; added continuation review and proposed corrective registration prerequisite, expanded runtime policy scope for handoff/turn state and pre-reduction validation, and retained the runtime-unverified release gate. No production changes or new event-scope approval.
- 2026-05-17: Created. Initial Codex-first cross-agent epic with six-plan milestone order.
- 2026-05-23: Updated after Plan A execution. Codex docs now show ten release events, Plan A produced a docs-backed matrix and fixtures, and downstream plans remain gated for safety-critical runtime behavior until live hook firing can be verified.
- 2026-05-25: Promoted Codex `PreCompact` and `PostCompact` into the first adapter MVP because they mirror existing Clooks events. This was later expanded the same day to include subagent events too.
- 2026-05-25: Promoted Codex `SubagentStart` and `SubagentStop` into the first adapter MVP after confirming README documents matching Clooks/Claude events. Subagent semantics remain implementation risks to test, not scope exclusions.
- 2026-05-26: Completed Plan C registration/entrypoint work. Codex hook registration and uninstall are implemented and tested; Codex runtime normalization/translation remains Plan D/E scope.

## Instruction Prompts

- **2026-09-07** (Joe-Degler):

  > Let's go

- **2026-09-07** (Joe-Degler):

  > So, what now? You want to plan the first part? Kick it off with a subagent?

- **2026-09-07** (Joe-Degler):

  > When using clooks, you should assume you can trust the repo. We can tighten permission models down the line. This is not a discussion for now.

- **2026-09-07** (Joe-Degler):

  > Alright. Get yourself a lay of the land. You're a much smarter model now, so you should scrutinize the design decisions we've done so far and we should make a plan to continue the line of work.

- **2026-05-17** (Joe Degler):

  > "One of our roadmap goals is that this actually becomes a general-purpose hook framework, working across Codex and Claude.
  > Your job right now is to scope out, research, what the shape of Codex Hooks is and how we can neatly tie them into Clooks.
  > We either need a translation layer from Codex to Clooks, without changing existing surface, or need to come up with a different solution.
  > This is all just ideating and research work for now."

- **2026-05-17** (Joe Degler):

  > "Start a separte subagent to verify each step independently."

- **2026-05-17** (Joe Degler):

  > "Okay. Create an EPIC according to our workflows (look at CLAUDE.md if needed) that outlines the changes we want to do. You don't have to write every PLAN yet, but we should get started getting deliverable targets and goals and a milestone order ready."
