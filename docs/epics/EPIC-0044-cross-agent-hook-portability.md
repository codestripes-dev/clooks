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
- `${CODEX_HOME:-$HOME/.codex}/hooks.json`

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
- reports unexpected binary failures through exit 2; native Codex effects remain event-specific

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
| `CLOOKS_AGENT=codex` handles the ten-event target in current source. | M2 validated PreToolUse; M3 adds the other events with restricted result capabilities and root/child boundaries. Generated-error accounting correction is implemented via `deferRuntimeErrorAudit`; expanded Docker validation has passed; emitted controls do not prove native enforcement. | `src/agents/codex/{adapter,normalize,policy,translate}.ts` |
| `runEngine()` has an adapter boundary with Claude handling and validated Codex PreToolUse handling. | Plan B separated selection from `runEngineCore(adapter, deps)`; completed M2 adds concrete Codex normalization, policy and translation. Preserve that boundary while validating M3's implemented remaining events; this is not a full-support or native-enforcement claim. | Plans B/D, `src/engine/run.ts`, `src/agents/*` |
| Codex's source capabilities differ from Clooks' Claude surface. | Reserved `PermissionRequest` fields fail the handler with no decision, leaving normal review absent another decision. Bare PreToolUse allow without replacement and ask are unsupported. Pinned source resolves these constraints; execution remains unverified. | M0 wire audit, Codex 0.153.4 source |
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
Completed: A (runtime-unverified), B, C, C1, D (M0-M4; no P/L)
  |
  +--> C1: Registration Correctness --------+
  |                                       |
  +--> Bounded runtime contract refresh ---+
                                          |
                                          +--> D: Codex Runtime + Capability Policy (complete)
                                                  |
                                                  +--> E: Native Conformance (not started)
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

**Status:** completed
**Plan file:** [Registration Correctness](../plans/done/feat-0044-cross-agent-portability/PLAN-FEAT-0044C1-registration-correctness.md)
**Depends on:** Plans B and C. Deterministic registration fixes do not depend on a live Codex run or the full runtime contract refresh; that refresh remains a prerequisite for Plan D.

**Goal:** Make registration recoverable while preserving trusted-repository assumptions and the existing merged global/project pipeline.

**Milestone 1 result:** Strict registration-file validation, precise generated-command ownership, unrelated-data preservation and atomic replacement are implemented for both registrars. Independent code and QA reviews approved; 266 focused unit tests and 477 compiled-binary Docker E2E tests passed at that gate. CLI architecture, bash entrypoint, cross-agent hooks and testing knowledge were updated. Interactive deletion followed in Milestone 2 below; active-home/receipt corrections remain pending and Codex runtime remains unsupported.

**Milestone 2 result:** Final deletion intent now controls all-agent cleanup, with explicit consent, preflight, remaining-reference checks and recoverable partial failure. Independent code and QA approved; 231 focused units and 510 full E2E tests passed inside Docker, including real PTY journeys. CLI/testing knowledge documents were updated. Active-home/receipt corrections remain Milestone 3; no Codex runtime activation or host installation changes were made.

**Milestone 3 result:** Global registration and cleanup honor the effective physical Codex home. Separate recovery identity and byte-fresh receipts support failed setup, explicit home switching and selected-plus-recorded cleanup. New project launchers validate home/file/checksum eligibility; selected Codex/all retries retire old receipts before launcher repair. Claude-only setup remains independent, with its documented shared-launcher exception. Five domain documents were updated. Independent code review and QA approved; final Docker units passed 1,957 tests and full E2E passed 600 tests, including generated-command probes, failure/retry and real PTY consent. No host installation was changed.

**Next:** Plan D and M0-M4 are complete with final code/QA GO. Selective archival is authorized: Plan D and runtime ATTENTION move to `docs/plans/done/feat-0044-codex-runtime/`; the active ATTENTION becomes a pointer and shared research/evidence sidecars remain in place. Plan E native conformance is next and has not started. Final Docker gates passed 2,192 units and 787 E2E, plus static checks; M4 made no production changes. P/L remain absent, Review remains an accepted nonblocking best-effort limitation. No README or release-confidence upgrade follows.

**Scope:**
- Correct failed-init marker publication, active Codex-home resolution, interactive deletion, ownership detection, and malformed-shape preservation.
- C1 specifies tracking one global Codex home in a pre-write recovery record, with a separate post-success suppression receipt and stale-file checks. Explicit unhook must remove all known references before changing that home. Global deletion cleans selected and recorded homes; unrecorded historical homes require explicit cleanup. These are registration constraints, not a new permission model.
- Correct deterministic dedup failures while preserving merged execution; installed markers alone cannot establish native activation or exactly-once execution. Document that limitation; native conformance belongs to Plans D/E. Repository authorization redesign is out of scope.
- Retain absolute project commands and the accepted re-init-after-relocation tradeoff. Test repair with the old checkout still present and preserve nested-root behavior. Agent-aware inherited-environment handling belongs to the runtime boundary in Plan D, not a discovery redesign here.
- Include a regression test for each correction, applicable compiled-binary Docker E2E or smoke coverage, danger-zone review, and domain updates with each implementation milestone.

**Key files:** `src/agents/codex/settings.ts`, `src/registration-state.ts`, `src/commands/init.ts`, `src/commands/uninstall.ts`, `src/commands/init-entrypoint.ts`, and their unit/E2E tests. Existing discovery and loading boundaries are preservation checks, not redesign targets.

**Relevant research:** September continuation review and refreshed version-specific contract evidence.

---

### Plan D: Codex Runtime + Capability Policy

**Status:** M0/M1/M2/M3 complete. M4 and Plan D are complete with final code/QA GO, validated tests and confirmed cleanup. Plan E native conformance is next and has not started. Final M4 Docker gates passed: 2,192 units, 0 failures, 69 files, 8,229 assertions in 3.33 seconds; 787 E2E, 0 failures, 47 files, 9,268 assertions in 104.18 seconds; static checks all exit 0, with 112 lint warnings and 0 errors. Source manifests matched `11f1bc064814471e5c2edc41996eeae742d430ca06472c22717ae222f87e47eb`; the separate wrapper manifest matched `6ed9aa7f7fe33319d8fa656fcb2580d40e064a5f788425d2cc6a15fdfcaa6990` before/after. Final audit confirmed no owned M4 containers. Unit image: `3fe2f24dd9d7a515277d3b3f50cfe42ca935f97c2b7b610ad4ee5ed2f3de33f5`; E2E/static image: `93365cd1bc4b9222702b2bec14a250a83d05ea098132c8f82f5ffde99c318b53`. M4 is test-only with no production changes; final code/QA GO is confirmed. No P/L evidence is added. Artifacts: `tmp/codex-runtime-m4/20260908T093707Z-units-g43QGI`, `tmp/codex-runtime-m4/20260908T093440Z-e2e-4jueMy`, and `tmp/codex-runtime-m4/20260908T093645Z-static-JThIEb`.
**Plan file:** [Codex Runtime + Capability Policy](../plans/done/feat-0044-codex-runtime/PLAN-FEAT-0044D-codex-runtime-capability-policy.md)
**Depends on:** Plan B, corrective Plan C1, and refreshed runtime contract evidence.

**Goal:** Implement the first conservative Codex adapter for the release-documented event subset.

**Scope:**
- Normalize Codex wire JSON into Clooks internal context shape for the supported events.
- Carry private invocation metadata separately from public context; preserve opaque tool data and define round-trip input codecs.
- Validate each completed hook/lifecycle result before parallel cancellation, handoff, input mutation, and reduction, then separately audit generated diagnostics and final output. Policy rejection must survive ordinary crash degradation and later votes.
- Define supported refusal behavior for unsupported safety controls, and honest diagnostics for observational events and unknown-event failures.
- Include event-aware failure routing, turn identity/boundaries, provider-isolated failure counters and history, and recipient-aware handoff delivery eligibility. Preserve existing Claude storage paths and behavior.
- Support all ten agreed MVP events. New upstream events require a separate scope decision. Include unit and compiled-binary E2E with each production milestone.

**Key files:**
- new `src/agents/codex/normalize.ts`
- new `src/agents/codex/translate.ts`
- `src/types/contexts.ts`
- `src/types/results.ts`
- `src/engine/context-methods.ts`
- `src/engine/execute.ts`

**Entry gate:** Target Codex CLI 0.153.4, announced September 4, 2026. Exact-source provenance and inspection now establish parser/executor source paths, failure channels, tool replacements and native continuation constraints. Reconciliation and final independent code/QA reviews are complete with GO. The accepted best-effort history policy resolves the remaining entry decision: M0/M1/M2/M3 are complete with final milestone GO; M4 is complete with final code/QA GO. Source inspection and accepted probe dispositions do not establish executed behavior. Empty-string unavailable values preserve existing public string types without invented paths; accepting absent required nullable fields is broader compatibility than the producer contract. Native turn IDs are not equivalent to genuine user turns. Live confidence remains a separate release gate.

**M0 source result:** Exact ref `refs/tags/rust-v0.153.4`, tag object `042fb41b7c813ac7999105e886b2b7aa715b5081`, peels to [commit `3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`](https://github.com/openai/codex/tree/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks). Source rejects bare PreToolUse allow without rewriting; reserved PermissionRequest fields yield a failed handler with no decision, not guaranteed denial; successful stderr is discarded. Stop continuation preserves the native turn and bypasses UserPromptSubmit. Ordinary child prompts expose identity, but internal Review prompts can omit it, preventing a universal once-per-human-turn guarantee. The user's "Then ignore it and move on." selects normal best-effort history and accepts Review as a documented nonblocking limitation. No special workaround or tracking disablement is required. The first offline feasibility attempt found no Rust tools. The sole retry stopped at dependency preparation when `cargo fetch --locked` refused the required upstream `Cargo.lock` update. The retry exited 101 after 49 seconds. Both attempts ran zero tests; the allowance is exhausted with no P evidence, and native L evidence remains absent. The runner owns detailed evidence recording; cleanup is confirmed, with the owned container removed and the label-filtered container listing empty. See [M0 evidence](../plans/feat-0044-cross-agent-portability/codex-runtime-m0-evidence.md), [wire audit](../plans/feat-0044-cross-agent-portability/codex-runtime-m0-wire-contract.md), and [identity audit](../plans/feat-0044-cross-agent-portability/codex-runtime-m0-identity-delivery.md). Together with completed probe dispositions, final code/QA GO and the accepted history policy, M0/M1/M2/M3 are complete with final milestone GO; M4 is complete with final code/QA GO. P/L and shipped-runtime claims do not follow.

**Relevant research:** [September contract refresh](../plans/feat-0044-cross-agent-portability/codex-runtime-contract-refresh.md), [consolidated acceptance matrix](../plans/feat-0044-cross-agent-portability/codex-runtime-acceptance-matrix.md), historical Plan A capability matrix and verifier report.

**M1 implementation result:** Added public context/private invocation separation, invocation-bound result policies, detached result checking before engine-controlled effects, structured diagnostic composition and explicit policy-failure translation. Claude keeps its public authoring shape and behavior; Codex remained an unsupported placeholder at that gate. Throwing-getter batch hangs and lost pre-abort sibling failure counters are resolved with bounded regressions. The policy boundary provided the foundation for M2's now-completed concrete Codex implementation; provider state and recipient-readable handoff were downstream work at that snapshot.

**M1 final gate evidence:** All runs used the same frozen source hash and exited 0: 2,000 units, 0 failures, 64 files, 7,207 assertions; 603 compiled-binary Docker E2E, 0 failures, 44 files, 5,369 assertions; typecheck/lint/format checks passed with 112 existing warnings and 0 errors. Logs: `tmp/codex-runtime-m1/20260908T065006Z-units-EYbymd/output.log`, `tmp/codex-runtime-m1/20260908T065029Z-e2e-gtCAyf/output.log`, and `tmp/codex-runtime-m1/20260908T065232Z-static-k02BdQ/output.log`. No owned containers remain; no host tests or mutations occurred. M1 final milestone GO remains confirmed. M2/M3 have since completed with final GO; M4 is complete with final code/QA GO. These U/D gates establish Claude preservation and the shared boundary, not upstream P/L or release confidence.

---

### Plan E: Native Conformance

**Status:** Scoped M1 complete with Banach code/runtime-evidence GO, Raman QA/evidence GO and parent closure GO. Native attempt 1 passed all six cases (baseline, deny, shell rewrite, unsupported-ask refusal, context and Stop continuation/history-skip); helpers, ordinary E2E and static/build gates passed. PreToolUse context uses ALLOW; other measured context arms use SKIP. [Evidence](../plans/done/feat-0044-native-conformance/native-conformance-evidence.md) and [matrix](../plans/done/feat-0044-native-conformance/native-execution-matrix.md) retain exact boundaries. Other five events/options remain unverified; no full-ten-event/release or README claim.
**Plan file:** [Native Conformance](../plans/done/feat-0044-native-conformance/PLAN-FEAT-0044E-native-conformance.md)
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

Current live follow-up (2026-09-08): [real-session evidence](../research/codex-live-dogfood.md) records bounded permission, child context/continuation, shell failure/context/post-feedback results and byte-exact configuration restoration after cleanup; the consumed arm was archived. Plan E's historical six cases are unchanged. Live-phase code closure GO and QA closure GO are confirmed after independent log verification and scope-qualified review with no contradictions reported. Compaction attempt 1 failed pre-native (missing node, exit 127); after one PATH correction, attempt 2 passed (1 test, 0 failures, 8.72s; native exit 0, no signal/timeout, reaped; exactly two requests). Raw and configured compact handlers show PreCompact then PostCompact (auto), same raw turn ID, summary in user-message content in the second request and final stdout. This forced zero-threshold NEW-session local compaction used synthetic-loopback offline Docker, not the real conversation, rich history or block variants. Only compact handlers were configured; other raw lifecycle captures do not add handler coverage. Both cleanup exits were zero and the parent-filtered container listing was empty. Final compaction code closure GO and QA closure GO are confirmed; parent testing closure is complete. The separate owned fake-vendor apply_patch probe confirmed an existing Claude-file-tool-specific [protected-path hook gap](../findings/code-quality.md#protected-path-hook-assumes-claude-file-tools); cleanup was verified, no actual vendor/source files were touched, and no fix is authorized. The interactive mid-turn fixture did not newly test root SessionStart, root UserPromptSubmit or root Stop. Combining historical smoke, interactive probes and compaction now gives all ten target events some native invocation evidence, not all result/failure variants, all tools or full release conformance. Remaining gaps include patch/MCP mutation, file-handoff readability, layered activation, root reset, broader trust/approval modes and the hook-specific compatibility finding.

| Question | Relevant Plan | Notes |
|----------|--------------|-------|
| Do implemented rewrite and permission mappings conform under upstream/native execution? | Plan E / live follow-up | Historical smoke proves command-only Bash rewrite. Authorized real-session probes add exact-command PermissionRequest allow/deny/default skip in the existing configuration; attribution uses commands, not absent tool-use IDs. Patch/MCP rewrites, other permission arms and broader approval configurations remain unverified. Upstream P evidence remains absent; both bounded attempts ran zero tests. |
| Do verified local refusal and process-failure channels have the expected native effects? | Plan E / live follow-up | Historical smoke proves Bash denial and unsupported-ask refusal. Real-session probes add controlled-throw blocking, actual permission denial with no PostToolUse, direct pre/post context and completed stdout plus post-block feedback without rollback. Other generated/process-failure variants remain unverified; invocation alone does not prove all result arms. Upstream P evidence remains absent. |
| Does implemented unavailable-string compatibility conform to native payloads? | Plan E | Empty-string compatibility is implemented and U/D-verified: supplied strings are preserved, malformed types rejected and operational data not fabricated. Accepting absent required nullable fields is deliberately broader than producers. No implementation gap remains; native P/L conformance is unverified. |
| Should provider identity become public? | [Provider context follow-up](../plans/done/provider-context/PLAN-0074-provider-context.md), completed | User-approved additive `ctx.provider` is implemented with selected-adapter authority and deliberate synthetic defaults. Unit, type/static, compiled E2E and existing native smoke gates passed with independent code/QA approval; no raw payload or subagent field redesign. |
| Should `clooks test` gain `--agent codex`? | Plan E or separate feature | Useful for hook authors once adapter exists. |
| How does native activation affect layered invocation beyond stored registration freshness? | D/E | C1 corrected deterministic failed-setup, active-home and stale-receipt defects while preserving merged execution. Stored state still cannot establish native activity or exactly-once execution; upstream conformance remains open. |
| Does implemented best-effort history conform under native invocation? | Plan E / live follow-up | Historical smoke proves one same-turn root Stop continuation/history-skip. A targeted resumed live child additionally executed one SubagentStop continuation, then skipped with intervention history 0 to 1 and prior runs 1 to 2, no intervening UserPromptSubmit and exactly one consumed arm. Same child/session and preserved hook history are proven; native turn IDs were not observed. Root reset/advancement, same-ID steering, broader child history, session reset/pruning and provider isolation remain unverified. Review remains an accepted nonblocking limitation; full genuine-user parity and retry deduplication are not promised. |
| Should the MVP include newly documented SessionEnd/Interrupt? | Separate scope decision | Recommendation: retain the agreed ten; assess additions after the first working adapter. |

## Revision Log

- 2026-09-08: M1 final milestone GO confirmed; M1 done and M2 in progress. Zeno owns production/units and Plan D/ATTENTION, Lagrange owns E2E/matrix, and the documentation owner owns affected domains, epic and findings. Domain behavior updates follow implemented evidence. No full Codex support or P/L claim; Review remains an accepted nonblocking limitation.
- 2026-09-07: Final M1 implementation gates passed on the same frozen source: 2,000 units, 603 E2E, typecheck/lint/format checks with 112 existing warnings and zero errors. Getter/counter regressions are resolved. Policy boundary implemented/tested for Claude preservation and ready for M2; final docs review pending. Codex remains a placeholder, P/L absent, and C1/coverage/native activation distinctions are preserved.
- 2026-09-07: User instructed "Then ignore it and move on." Accepted normal best-effort history with Review as a documented nonblocking limitation, no special workaround and no tracking disablement. M0 source/probe/review work is complete; M1 is authorized/in progress under parent coordination. P/L remain absent; no shipped-runtime or full genuine-user-parity claim.
- 2026-09-07: Reconciled closure metadata with exact-tag acquisition and completed wire/identity source audits. Recorded two bounded execution attempts with zero tests: missing Rust tools, then locked dependency preparation rejection. Retry allowance exhausted; P/L absent, reconciliation and final independent code/QA GO complete, history decision pending. Preserved historical research and C1 completion; no M0 completion or production approval.
- 2026-09-07: Completed Plan D drafting with current official documentation research, target release 0.153.4 and a consolidated behavior/evidence matrix. Independent code/product/QA review approved starting bounded M0. QA clarified existing context reduction, reachable milestone tests and pre-abort diagnostic precedence. Pinned-source M0 precedes production work; Claude compatibility and trusted merged execution remain unchanged. No runtime implementation or new execution evidence in this drafting pass.
- 2026-09-07: Completed all C1 milestones and archived its plan with focused ATTENTION while preserving active shared research and prior plans. Effective Codex-home registration, recoverable receipt ordering and conservative shell eligibility passed independent code/QA review, 1,957 full Docker units and 600 full Docker E2E tests. Runtime evidence refresh and Plan D remain next; repository trust and merged execution are unchanged.
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

  > Okay. You can conitinue.

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
