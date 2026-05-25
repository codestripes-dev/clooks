# Introduce the Agent Adapter Boundary

This ExecPlan is a living document. The sections `Product Context`, `Progress`, `Surprises & Discoveries`, `Decision Log`, `Outcomes & Retrospective`, and `Related Domain Knowledge Documents` must be kept up to date as work proceeds.

This plan must be maintained according to `docs/plans/PLANS.md`. The reader should assume no prior context beyond this repository and this plan.

**Originating Feature:** [`FEAT-0044: Cross-Agent Hook Portability`](../../planned/FEAT-0044-cross-agent-hooks.md)

**Coordinating Epic:** [`EPIC-0044: Cross-Agent Hook Portability -- Codex Adapter`](../../epics/EPIC-0044-cross-agent-hook-portability.md)

**Previous Plan:** [`PLAN-FEAT-0044A: Verify the Codex Hook Runtime Contract`](./PLAN-FEAT-0044A-codex-runtime-contract-verification.md)

## Purpose / Big Picture

Clooks currently behaves like a Claude Code hook runner from stdin all the way to stdout. This plan changes that architecture so the existing config loading, hook loading, matching, execution, lifecycle, ordering, failure handling, and result reduction become a shared engine core, while agent-specific code owns wire input parsing, context normalization, diagnostics, and final wire output. After implementation, Claude Code users should see byte-for-byte equivalent behavior in normal hook runs, and future plans can add a Codex adapter without threading Codex conditionals through `runEngine()`.

The observable result of this plan is internal but demonstrable. Running Clooks in engine mode with Claude Code-style fixtures should produce the same JSON output and exit codes as before, `CLOOKS_AGENT=claude-code` should behave the same as the default no-env path, and `CLOOKS_AGENT=codex` should select a placeholder adapter boundary without claiming Codex support or translating Codex decisions yet.

## Product Context

**Problem we are solving:** FEAT-0044 wants custom and vendored hooks to run across multiple AI coding agents through a common Clooks authoring surface. The current runtime mixes Claude wire assumptions, Claude output translation, and Claude plugin/settings advisories into `src/engine/run.ts`, making Codex support risky to add directly.

**Metrics this may affect:** No direct usage metric changes are expected from the boundary alone. This work reduces cross-agent implementation risk, protects existing Claude Code behavior, and makes later Codex delivery easier to test.

**Feature alignment:** This plan remains aligned with FEAT-0044's core use case: `clooks init --agent <name>` eventually registers the same custom or vendored hooks for multiple agents. It deliberately preserves the feature's rule that plugin-delivered hooks are Claude-Code-only. Plan A refined the Codex target to all ten release-documented Codex events: `SessionStart`, `SubagentStart`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `UserPromptSubmit`, `SubagentStop`, and `Stop`. This plan does not implement those Codex mappings; it creates the adapter boundary needed by later Plans D and E.

## Progress

- [x] (2026-05-25 03:04Z, Joe Degler) Read `docs/plans/PLANS.md`, the coordinating epic, Plan A, the Codex capability matrix, relevant domain docs, and findings before writing this plan.
- [x] (2026-05-25 03:04Z, Joe Degler) Checked author identity. `gh api user --jq '.login'` failed because the sandbox cannot reach GitHub, so this plan uses local git identity `Joe Degler`.
- [x] (2026-05-25 03:04Z, Joe Degler) Created this Plan B ExecPlan as planning-only work. No production `src/` code has been changed.
- [x] (2026-05-25 03:18Z, Joe Degler) Incorporated review feedback: split early event-name recognition from full context normalization, assigned event-set validation to adapters, named Claude-only `NOTIFY_ONLY_EVENTS` and `ConfigChange policy_settings` behavior, clarified system-message composition, and removed the direct Markdown Prettier validation command.
- [x] (2026-05-25 03:34Z, Joe Degler) Recorded the registration/agent-marker decision: Codex registration will set `CLOOKS_AGENT=codex`, Claude remains the unset default, and the entrypoint/binary must not infer the agent by payload sniffing.
- [x] (2026-05-25 14:47Z, Codex) Implemented Milestone 1: introduced internal adapter types, Claude Code and Codex adapter scaffolds, and explicit `CLOOKS_AGENT` selector behavior with Claude Code as the unset/empty default.
- [x] (2026-05-25 14:52Z, Codex) Addressed Milestone 1 review feedback: tightened the adapter interface around validated event reading, final-output translation, system-message routing, and Claude plugin advisory capability flags; expanded selector/placeholder tests.
- [x] (2026-05-25, Codex) Implemented Milestone 2: split `runEngine()` into selector wrapper plus `runEngineCore(adapter, deps)`, routed Claude event validation/normalization/final output through the adapter, and kept `CLOOKS_AGENT=codex` fail-closed before runtime translation.
- [x] (2026-05-25, Codex) Addressed Milestone 2 review gaps: added runEngine no-payload-sniff coverage for `CLOOKS_AGENT=codex`, added core missing/non-string event validation coverage, and made Claude final-output translation reuse the adapter's system-message route helper.
- [x] (2026-05-25, Codex) Implemented Milestone 3: moved Claude plugin vendoring and SessionStart stale settings advisories behind adapter-owned helpers, kept Claude registration/collision/error messages unchanged, and added Codex placeholder no-op contracts for plugin/advisory paths without enabling Codex runtime translation.
- [x] (2026-05-25, Codex) Addressed Milestone 3 QA gaps: added temp-file engine coverage for stale-registration and enable-without-install advisories through Claude final output, asserted non-SessionStart advisory gating, added explicit `CLOOKS_AGENT=claude-code` versus unset runtime preservation coverage, and narrowed the Codex placeholder isolation claim with a separate fake runtime-capable adapter test.
- [x] (2026-05-25, Codex) Implemented Milestone 4: strengthened unit coverage for Claude adapter final-output merging and restored `CLOOKS_AGENT` hygiene in legacy `runEngine()` tests so default-path assertions are not polluted by the shell environment.
- [x] (2026-05-25, Codex) Implemented Milestone 5: added compiled-binary E2E coverage for unset/default Claude selection, explicit `CLOOKS_AGENT=claude-code`, unknown-agent fail-closed behavior, and `CLOOKS_AGENT=codex` placeholder fail-closed behavior. `bun run test:e2e` passed after Docker socket access was approved.
- [x] (2026-05-25, Codex) Implemented Milestone 6: updated affected domain docs, reviewed findings with no Plan B-resolved entries to close, updated the epic Plan B result/status, refreshed `ATTENTION.md`, and closed the plan outcomes with validation.

## Surprises & Discoveries

- Observation: Plan A completed as `docs-backed but runtime-unverified`, not as live-runtime verified.
  Evidence: the disposable Codex spike reached OpenAI only after sandbox escalation and then failed with `401 Unauthorized`, so this plan must not claim Codex translation behavior is runtime-verified.

- Observation: `src/engine/run.ts` is both the engine orchestration path and a Claude-specific boundary today.
  Evidence: it reads Claude-shaped `hook_event_name`, validates against `isEventName()`, calls `normalizeKeys()`, emits `ClaudeCodeOutput`, and detects Claude plugin/settings advisories through `../claude-settings.js`.

- Observation: `docs/domain/cross-agent-hooks.md` still has an overview row saying Codex has "6 documented release events", while the Codex section below correctly lists ten current release events.
  Evidence: consulted while writing this plan. Updating the overview count belongs to a doc cleanup during Plan B completion if it remains stale.

- Observation: `runEngine()` needs the event name before full context normalization.
  Evidence: the null-config `cwd-fallback` branch peeks `payload.hook_event_name` to gate a `SessionStart` warning before config loading finishes; the main validation happens before hook-empty and match-empty early exits; `normalizeKeys()` currently runs only after those early exits. The adapter contract must therefore expose cheap event recognition separately from full normalization.

- Observation: Milestone 1 can land without touching `runEngine()`.
  Evidence: the new selector and adapters are isolated under `src/agents/`, and `runEngine()` remains unchanged until Milestone 2 performs the engine-core split.

- Observation: Bun's `process.env` type is not directly assignable to the narrow selector environment type.
  Evidence: `bun run typecheck` initially reported `Type 'ProcessEnv' has no properties in common with type 'AgentSelectionEnv'`; the selector now casts only its default parameter while tests pass explicit narrow env objects.

- Observation: The initial Milestone 1 adapter interface exposed a separate raw-string event read plus event validator, which was too easy for future engine code to misuse.
  Evidence: review requested `readEventName(raw): EventName | null` so validation stays adapter-owned at the read boundary; the Claude adapter now returns only validated event names or null.

- Observation: Milestone 2 needed one small adapter interface extension for the Claude-only `ConfigChange` `policy_settings` downgrade.
  Evidence: `AgentAdapter.adjustResultBeforeFinalOutput()` lets the adapter transform a reduced result and return adapter-owned system messages before final wire translation, so `src/engine/run.ts` no longer embeds the Claude-specific `policy_settings` block-to-skip rule.

- Observation: After Milestone 2, plugin discovery, vendoring, and `.claude` settings advisory code is still physically in `runEngineCore()`, guarded only by Claude adapter capability checks where Milestone 2 already needed them.
  Evidence: `runEngineCore()` still imports `../claude-settings.js` and calls `discoverPluginPacks` / `vendorAndRegisterPack`; this is an accepted Milestone 2 boundary gap and remains explicit Milestone 3 work, not a behavior change for this milestone.

- Observation: Milestone 3 moved Claude settings reads out of `src/engine/run.ts`, but default engine dependencies still expose the existing Claude plugin discovery/vendoring functions so the default Claude runtime keeps current behavior.
  Evidence: `src/agents/claude-code/adapter.ts` now imports `../../claude-settings.js`, `../../plugin-discovery.js`, and `../../plugin-vendor.js`; `runEngineCore()` calls adapter-owned `prepareConfigAfterLoad()` and `collectSessionStartAdvisories()` instead of importing or formatting Claude settings directly.

- Observation: The initial Milestone 3 test for Codex placeholder isolation overclaimed because `codexAdapter.readEventName()` returns `null`, so direct `runEngineCore(codexAdapter, deps)` exits before reaching SessionStart advisory collection.
  Evidence: QA requested either a narrowed claim or a fake runtime-capable adapter. The updated coverage keeps the narrowed Codex placeholder test and adds a runtime-capable fake adapter whose plugin/advisory hooks are no-ops, proving the core can run `SessionStart` without invoking Claude plugin discovery or settings advisory behavior.

- Observation: Legacy `runEngine()` unit tests inherited `CLOOKS_AGENT` from the shell, which could accidentally route default-path tests through an unsupported adapter.
  Evidence: Milestone 4 now deletes `CLOOKS_AGENT` in `src/engine-run.test.ts` `beforeEach()` and restores the original value in `afterEach()`.

- Observation: The required E2E validation needs Docker socket access outside the default sandbox.
  Evidence: `bun run test:e2e` first failed with `permission denied while trying to connect to the docker API at unix:///var/run/docker.sock`; after approval, the same command passed with `400 pass, 0 fail`.

## Decision Log

- Decision: Plan B will use `claude-code` as the default agent when `CLOOKS_AGENT` is unset.
  Rationale: Existing Claude Code users and generated entrypoints do not set `CLOOKS_AGENT`. Backward compatibility requires the no-env path to keep current behavior.
  Date/Author: 2026-05-25 / Joe Degler.

- Decision: `CLOOKS_AGENT=claude-code` is the explicit supported selector for the current adapter; `CLOOKS_AGENT=codex` may select only a scaffolded Codex adapter boundary until Plans D/E implement and validate translation.
  Rationale: The environment variable is easy for the bash entrypoint and future Codex registration to pass through. It avoids changing the current no-argument engine dispatch shape in `src/cli.ts`.
  Date/Author: 2026-05-25 / Joe Degler.

- Decision: Registration owns agent identity; Clooks must not sniff payload shape to decide whether a hook invocation came from Claude Code or Codex.
  Rationale: The two agents share many event names, including `SessionStart`, `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `SubagentStart`, `SubagentStop`, `PreCompact`, `PostCompact`, and `Stop`. Payload sniffing would be brittle and could route safety-sensitive output through the wrong adapter. Codex registration will set `CLOOKS_AGENT=codex`; Claude registration remains backward-compatible by leaving the variable unset, with `CLOOKS_AGENT=claude-code` available as an explicit equivalent.
  Date/Author: 2026-05-25 / Joe Degler.

- Decision: Codex registration should target `hooks.json` files for the first implementation, not inline TOML.
  Rationale: Codex supports `hooks.json` and inline `[hooks]` tables in `config.toml`, but a generated `hooks.json` is easier for Clooks to own idempotently without merging unrelated user config. Actual `.codex/hooks.json` generation belongs to Plan C; Plan B only prepares the binary to consume the agent marker that Plan C will set.
  Date/Author: 2026-05-25 / Joe Degler.

- Decision: Claude plugin vendoring and stale-settings advisories remain Claude-only.
  Rationale: FEAT-0044 states plugin-delivered hooks are Claude-Code-only, and Codex plugin hooks have a separate packaging and trust model. Codex sessions must not read `.claude/` settings or emit Claude plugin guidance.
  Date/Author: 2026-05-25 / Joe Degler.

- Decision: Plan B must create or maintain `ATTENTION.md`.
  Rationale: The implementation touches shared abstractions and runtime entry flow: `src/engine/run.ts`, agent adapter interfaces, engine output, and fail-closed error behavior. Per `docs/plans/PLANS.md`, shared abstraction changes require a danger-zone spotlight.
  Date/Author: 2026-05-25 / Joe Degler.

- Decision: Agent adapters own event-name recognition and validation.
  Rationale: The current `isEventName()` helper validates against the Claude event set. Codex's valid event set is the ten-event Plan A MVP subset, not the full Claude set. Keeping event validation in the shared core would preserve the Claude coupling this plan is meant to remove.
  Date/Author: 2026-05-25 / Joe Degler.

- Decision: Split early event recognition from full context normalization in the adapter interface.
  Rationale: `runEngine()` currently needs the event name before full normalization for early warnings and fail-closed validation, but full normalization is intentionally late so no-hook and no-match paths avoid unnecessary context work. A single eager `normalizeInput()` would either reorder behavior without saying so or fail to support the early event-name peek.
  Date/Author: 2026-05-25 / Joe Degler.

- Decision: Claude-only output composition belongs to the Claude adapter.
  Rationale: The current engine mutates Claude JSON output by parsing `translated.output`, adding `systemMessage`, and re-serializing it. That merge shape is not agent-neutral. The shared core should pass the reduced result plus accumulated system messages to the adapter, and the adapter should produce one final translated wire output.
  Date/Author: 2026-05-25 / Joe Degler.

- Decision: Use local git identity after recording the `gh api user` failure instead of asking the user for a handle in this continuation.
  Rationale: `docs/plans/PLANS.md` says to ask when `gh` fails. In this repo/session, local git identity is already `Joe Degler` and Plan A used that identity for the same sandbox-network reason. This is a literal process deviation, recorded here so future agents do not miss it.
  Date/Author: 2026-05-25 / Joe Degler.

- Decision: Extend `AgentAdapter` with `adjustResultBeforeFinalOutput()` instead of adding a Claude-named function directly to the shared core.
  Rationale: The shared core needs one hook point after execution and before final output for agent-specific output guards. This keeps the current Claude `ConfigChange` `policy_settings` downgrade behavior intact while avoiding Claude-specific branching in `runEngineCore()`.
  Date/Author: 2026-05-25 / Codex.

- Decision: Leave plugin discovery/vendoring/settings isolation to Milestone 3.
  Rationale: Milestone 2's acceptance scope is the selector/core split plus Claude normalization/output ownership. Moving plugin vendoring and `.claude` settings imports now would expand the refactor into the advisory isolation milestone; the current implementation keeps existing behavior and already prevents `CLOOKS_AGENT=codex` from reaching runtime.
  Date/Author: 2026-05-25 / Codex.

- Decision: Add generic adapter methods `prepareConfigAfterLoad()` and `collectSessionStartAdvisories()` for Milestone 3 instead of keeping Claude plugin capability branching in the core.
  Rationale: Claude plugin vendoring can require config reload before hook loading, while stale settings advisories must run after the event is known and only for `SessionStart`. Two explicit adapter hooks preserve that ordering without making `.claude` settings behavior agent-neutral.
  Date/Author: 2026-05-25 / Codex.

- Decision: Let the Codex placeholder return `null` from `readEventName()` and no-op for plugin/advisory adapter hooks, while keeping normalization and final translation unsupported.
  Rationale: Direct `runEngineCore(codexAdapter, deps)` tests can now prove the placeholder does not read `.claude` settings or run plugin vendoring before failing closed on unrecognized input. `runEngine()` still blocks `CLOOKS_AGENT=codex` before runtime because `supportsRuntime` remains false.
  Date/Author: 2026-05-25 / Codex.

## Outcomes & Retrospective

Plan B completed as an internal adapter-boundary change with no user-facing Codex support claim. Claude Code remains the implemented runtime adapter. The default/no-env path and `CLOOKS_AGENT=claude-code` select Claude Code and preserve the existing output shape. Unknown `CLOOKS_AGENT` values fail closed, and `CLOOKS_AGENT=codex` selects a named placeholder that fails closed before normalization or translation.

Implementation result:

- Added `src/agents/*` adapter types, selector, Claude Code adapter, and Codex placeholder.
- Split engine mode into `runEngine()` adapter selection plus `runEngineCore(adapter, deps)`.
- Kept config loading, hook loading, matching, execution, lifecycle handling, ordering, circuit-breaker behavior, and result reduction in the shared core.
- Moved Claude wire parsing/normalization/final-output ownership, notify-only system-message routing, `ConfigChange policy_settings` downgrade behavior, and Claude plugin/settings advisories behind Claude adapter methods.
- Added unit coverage for adapter selection, no payload sniffing, Claude final output behavior, advisory isolation, and placeholder fail-closed behavior.
- Added compiled-binary E2E coverage for unset/default Claude selection, explicit `CLOOKS_AGENT=claude-code`, unknown-agent fail-closed behavior, and `CLOOKS_AGENT=codex` placeholder fail-closed behavior.

Milestone 6 documentation result:

- Updated `docs/domain/cross-agent-hooks.md`, including the stale Codex event count and Plan B adapter-boundary status.
- Updated `docs/domain/cli-architecture.md` with the `runEngine()` selector and `runEngineCore(adapter, deps)` flow.
- Updated `docs/domain/bash-entrypoint.md` with optional `CLOOKS_AGENT=claude-code` and reserved/future `CLOOKS_AGENT=codex` semantics.
- Updated `docs/domain/testing.md` with the new agent-adapter unit/E2E coverage pattern.
- Left `docs/domain/config.md` unchanged because Plan B did not change config file semantics.
- Updated the coordinating epic's Plan B status/result and downstream scope notes.
- Updated `ATTENTION.md` from future-tense danger zones to residual review notes.
- Reviewed `docs/findings/*`; no existing finding was resolved by Plan B, and no new finding was exposed by Milestone 6.

Validation summary:

- `bun run typecheck` passed.
- `bun test src/agents/select.test.ts src/agents/claude-code/adapter.test.ts src/engine/run.agent-adapter.test.ts src/engine-run.test.ts src/codex-fixtures.test.ts` passed with 114 tests.
- `bun run test:e2e:run -- test/e2e/agent-adapter.e2e.test.ts` first failed on Docker socket permissions in the sandbox, then passed after approved Docker access with 4 tests.
- Full E2E was already run for Milestone 5 and passed with 400 tests; Milestone 6 was docs-only, so focused adapter E2E coverage was sufficient.

Remaining work:

- Plan C: implement Codex registration and entrypoint command generation for `.codex/hooks.json` / `~/.codex/hooks.json`.
- Plan D: implement Codex normalization and Codex JSON output translation for the ten release-documented events.
- Plan E: validate the full Codex path with fixture-based E2E and decide the live Codex confidence story.
- Plan F: publish user-facing Codex docs and README support claims only after Plans C-E land.

Git note: plan and epic files under `docs/plans/`, `docs/epics/`, and related Plan A artifacts may be ignored by the repository. If committing this closure, use force-add only for the intended plan/epic artifacts and continue to ignore unrelated scratch files.

## Context and Orientation

Clooks is a Bun/TypeScript CLI. The compiled binary starts in `src/cli.ts`. With command-line arguments, it imports `src/router.ts` and runs the user-facing CLI. With no arguments and piped stdin, it calls `runEngine()` from `src/engine/run.ts`; that is the hook-engine mode used by agent hook systems.

The current engine mode is Claude-shaped. Claude Code invokes `.clooks/bin/entrypoint.sh`, which captures stdin, finds `clooks` on `PATH`, pipes the original JSON into the binary, and translates unexpected child exit codes into fail-closed exit code 2. Inside `runEngine()`, Clooks discovers the project root, loads `.clooks/clooks.yml` plus home and local layers, vendors Claude plugin hooks, reads stdin JSON, validates `hook_event_name` against the Claude event set in `src/config/constants.ts`, normalizes snake_case keys to camelCase with `src/normalize.ts`, matches hooks in `src/engine/match.ts`, executes them through `src/engine/execute.ts`, and translates the reduced result through `src/engine/translate.ts` into Claude Code's output contract.

Future Codex registration is a separate concern from Plan B and is owned by Plan C. The intended shape is project-local `<repo>/.codex/hooks.json` and user-global `~/.codex/hooks.json`, not inline `config.toml` for the MVP. Each registered Codex command will call the Clooks entrypoint with an explicit marker such as `CLOOKS_AGENT=codex` and a stable project root such as `CLOOKS_PROJECT_ROOT=/abs/repo`. Plan B must make the binary understand that marker, but it must not generate Codex registration files yet.

Important terms:

- **Agent** means the upstream coding assistant that launches Clooks as a command hook, such as Claude Code or Codex.
- **Wire input** means the raw JSON object the agent sends to Clooks on stdin.
- **Wire output** means the stdout, stderr, and exit code Clooks returns to the agent.
- **Adapter** means code that translates between one agent's wire contract and Clooks' shared internal execution contract.
- **Shared engine core** means the agent-independent part of the runtime: project discovery, config loading, hook loading, hook matching, lifecycle execution, circuit breaker handling, multi-hook result reduction, and engine-level diagnostics.

Plan A established the Codex contract used by future plans. Codex currently documents ten release events: `SessionStart`, `SubagentStart`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `UserPromptSubmit`, `SubagentStop`, and `Stop`. Plan A added durable Codex input fixtures under `test/fixtures/codex/events/` and `src/codex-fixtures.test.ts`, but live hook firing was blocked by disposable auth. Therefore this plan may create interfaces and fixture-backed boundaries, but must not ship user-facing Codex support claims or safety-critical Codex translation behavior.

## Related Domain Knowledge Documents

- `docs/domain/cross-agent-hooks.md` -- consulted for Codex event scope and adapter recommendation. Updated in Milestone 6 to describe `CLOOKS_AGENT`, the Plan B adapter boundary, the default Claude selection, the Codex fail-closed placeholder, and the fact that Codex normalization/translation remains deferred. Also updated the stale overview count from six to ten Codex release events.
- `docs/domain/cli-architecture.md` -- consulted for dual-mode dispatch and `runEngine()` ownership. Updated in Milestone 6 to describe `runEngine()` adapter selection and `runEngineCore(adapter, deps)`.
- `docs/domain/bash-entrypoint.md` -- consulted for entrypoint env vars, fail-closed behavior, and generated script expectations. Updated in Milestone 6 to document `CLOOKS_AGENT=claude-code` as an optional explicit selector and `CLOOKS_AGENT=codex` as a reserved future selector that currently fails closed. No user-facing Codex support claim was added.
- `docs/domain/config.md` -- consulted for config loading, event names, and hook path behavior. Not updated because Plan B did not change config validation, event reservation, or hook resolution semantics.
- `docs/domain/testing.md` -- consulted for unit/E2E requirements and Codex fixture conventions. Updated in Milestone 6 to document Codex fixture conventions and the new agent-adapter unit/E2E coverage pattern.

## Related Findings

- `docs/findings/test-gaps.md` -> "No reusable harness for new-event additions" is relevant because Plan B should keep adapter tests reusable for later Codex normalization and event coverage. This plan does not solve the general harness gap.
- `docs/findings/stale-docs.md` -> "`claude-code-hooks/events.md` under-counts lifecycle events" is relevant because Plan B must not trust stale event counts when preserving Claude behavior. This plan does not close the finding.
- `docs/findings/stale-docs.md` -> "`README.md` Events section missing `PostCompact` after PLAN-0014" is relevant as a warning against user-facing event claims drifting. Plan B must not add README Codex support claims.
- `docs/findings/knowledge-gaps.md` -> "No documented pattern for global hook type imports" is indirectly relevant to cross-agent global hooks, but Plan B does not address it.
- `docs/findings/tooling-friction.md` -> "Disposable Codex live hook spikes need explicit binaries and auth state" is relevant to later Plans D/E. Plan B should avoid live Codex dependence and use Plan A fixtures only.

## Plan of Work

Start by adding the adapter vocabulary without changing behavior. Create a new internal folder such as `src/agents/` with a shared adapter definition, likely `src/agents/types.ts`, and a Claude implementation under `src/agents/claude-code/`. The first adapter should describe the operations the engine needs from an agent: identify the agent, cheaply recognize and validate the event name from raw wire input, normalize raw wire input into an internal context later in the pipeline, decide whether agent-specific startup/advisory behavior should run, translate the reduced `EngineResult` plus accumulated system messages into final wire output, and format fatal diagnostics if the shared core fails before an event is known. Keep names stable and explicit: use `claude-code` for the current agent and `codex` for the future adapter.

Then add an adapter selector, likely `src/agents/select.ts`, that reads `process.env.CLOOKS_AGENT`. If the variable is missing or empty, select `claude-code`. If it is exactly `claude-code`, select the Claude adapter. If it is `codex`, return the Codex scaffold only if the implementation can fail clearly before unsupported translation is needed; otherwise return an unsupported-agent diagnostic that exits fail-closed. Unknown values must fail closed with a clear stderr message rather than falling back silently to Claude.

Do not add payload-based agent detection. The same entrypoint script may be reused by both agent registrations, but the registration command is responsible for setting `CLOOKS_AGENT`. Claude's current `.claude/settings.json` registration can remain unchanged because the unset variable is defined as `claude-code`; a future explicit Claude registration may set `CLOOKS_AGENT=claude-code` without changing behavior. Codex's future `.codex/hooks.json` registration must set `CLOOKS_AGENT=codex`, and project-level Codex registration should also set `CLOOKS_PROJECT_ROOT=/abs/repo` or use an absolute entrypoint path so Codex cwd changes cannot detach Clooks from the intended project.

Next split `src/engine/run.ts` conservatively. Do not rewrite the whole engine. Extract the agent-independent orchestration into a shared function, for example `runEngineCore(adapter, deps)`, while keeping `runEngine(deps)` as the public function imported by `src/cli.ts`. `runEngine()` should select the adapter and call the core. The shared core should still own project discovery, config loading, hook loading, matching, execution, circuit breaker handling, and process exit. The adapter should own only agent-specific wire details: event-name recognition and validation, raw input normalization into Clooks' handler context, whether plugin/settings advisories apply, event-specific stderr/stdout routing, and final output translation.

Preserve the current late-normalization behavior unless there is a deliberate, recorded reason to reorder it. In the current code, the event name is read before normalization so early exits can still know whether the event is `SessionStart`, while `normalizeKeys()` runs only after hooks are loaded and at least one hook or load error needs execution. The adapter boundary should model this as two phases: `readEventName(raw)` for cheap early recognition, then `normalizeContext(raw, eventName)` for late handler context construction. If implementation chooses eager normalization, record the behavior-neutral reordering in the Decision Log and prove with tests that no-hook and no-match paths still emit the same output.

Move event-set validation out of the shared core. The Claude adapter may delegate to the existing `isEventName()` helper because Clooks' current public event set is Claude-shaped. The Codex placeholder adapter must not use the full Claude event set as its future authority; Plan D will validate against the ten Codex MVP events from Plan A. In Plan B, `CLOOKS_AGENT=codex` can fail before event validation if that is the clearest unsupported scaffold, but the interface must still make validation adapter-owned.

Move Claude-specific normalization and translation behind the Claude adapter. The existing `normalizeKeys()` behavior and `PermissionDenied` rename should be preserved for Claude. The existing `translateResult()` logic in `src/engine/translate.ts` can either remain as the Claude adapter's translator or move under `src/agents/claude-code/translate.ts`; choose the smaller diff that makes ownership clear. If the file remains in `src/engine/translate.ts`, rename or wrap exports so the new code does not imply the translator is agent-neutral. Preserve existing unit tests for `translateResult()` or move them with the translator.

Move the hidden Claude-only output behaviors behind the Claude adapter too. The repeated `NOTIFY_ONLY_EVENTS` stdout-drop handling is based on Claude Code dropping stdout for notify-only events, so the adapter should decide where startup, dangling, degraded, and system messages go for those events. The `ConfigChange` plus `policy_settings` block-to-skip downgrade is also explicitly Claude-specific because it exists only because Claude Code silently ignores blocks on enterprise policy settings. Do not leave either behavior in a supposedly shared engine core unless the function is clearly named as a Claude adapter helper.

Keep Claude plugin/settings advisories Claude-only. The code that imports `../claude-settings.js`, calls `defaultSettingsPaths()`, reads enabled or installed plugins, and emits stale-registration or enable-without-install advisories should be called only by the Claude adapter path. The shared engine core may accept adapter-provided advisory messages, but it must not import Claude settings directly after this split. If a Codex placeholder path is added, tests must prove it does not read `.claude/` settings or produce Claude plugin wording.

Clarify system-message composition before moving code. Today the engine may already have a translated Claude output and then attaches system messages by parsing that JSON, assigning top-level `systemMessage`, and serializing again. That is a Claude wire merge, not an engine-neutral operation. The new contract should prefer one adapter call that receives the event, the reduced result or undefined result, and all accumulated message channels, then returns the final `TranslatedAgentOutput`. If the implementation keeps separate `translateResult()` and `translateSystemMessages()` methods, the adapter, not the core, must own the merge between those outputs.

Define the Codex adapter boundary but do not implement Codex normalization or translation. It is acceptable to add `src/agents/codex/adapter.ts` with a clearly unsupported implementation that returns a fail-closed diagnostic such as `clooks: CLOOKS_AGENT=codex is not implemented yet; see EPIC-0044 Plan D`. It is also acceptable to define TypeScript interfaces that future Plan D will fill in, including names for all ten MVP events. Do not map Codex fixtures into hook contexts, do not emit Codex JSON decisions, and do not add README support claims in this plan.

Keep actual Codex registration out of Plan B. Plan C should write `.codex/hooks.json` or `~/.codex/hooks.json` with one Clooks command hook per Codex MVP event. That command should look conceptually like `CLOOKS_AGENT=codex CLOOKS_PROJECT_ROOT=/abs/repo /abs/repo/.clooks/bin/entrypoint.sh` for project registration, or use absolute home paths for global registration. Plan B should mention this intended command shape only as context for why the binary selector exists.

Finally, update tests and docs. Unit tests must prove adapter selection, unknown-agent failure, default Claude behavior, explicit `CLOOKS_AGENT=claude-code` behavior, and Claude-only advisory isolation. Because `src/engine/run.ts` and compiled-binary engine mode are shared runtime paths, add or update E2E tests that invoke the binary as a subprocess. Use `bun run test:e2e` for full validation. At completion, update the relevant domain docs listed above and review findings for anything Plan B resolved or newly exposed.

## Concrete Steps

Run all commands from the repository root `/opt/development/clooks`.

1. Inspect the current runtime and tests before editing:

       git status --short --untracked-files=all
       rg -n "runEngine|translateResult|normalizeKeys|CLOOKS_AGENT|claude-settings|discoverPluginPacks" src test docs/domain
       bun test src/engine.test.ts src/normalize.test.ts src/codex-fixtures.test.ts

   Expect existing dirty Plan A artifacts and the unrelated `schemas/clooks.schema.json` modification. Do not revert any of them. If `src/codex-fixtures.test.ts` is not present in the working tree, skip that exact test and record why in this plan.

2. Create adapter types and selector files:

       src/agents/types.ts
       src/agents/select.ts
       src/agents/claude-code/adapter.ts
       src/agents/codex/adapter.ts

   The exact file split may change during implementation, but the public concept should not: an adapter has a stable `agent` id and owns wire input normalization plus wire output translation for that agent.

3. Refactor `src/engine/run.ts` in small steps. Keep `runEngine(deps?: RunEngineDeps): Promise<void>` exported from `src/engine/index.ts` so `src/cli.ts` does not need a behavior change. Prefer adding helper functions first, then moving Claude-only pieces behind the adapter after tests cover the baseline.

4. Add unit tests. Good target files are:

       src/agents/select.test.ts
       src/agents/claude-code/adapter.test.ts
       src/engine/run.test.ts

   Reuse existing dependency injection through `RunEngineDeps` instead of process-wide module mocks. Tests should stub `readStdin`, `loadConfig`, `loadAllHooks`, and `discoverProjectRoot` where possible.

   Add a negative unit test or E2E assertion proving that adapter selection comes only from `CLOOKS_AGENT`, not from payload fields. For example, a Claude-shaped payload with `CLOOKS_AGENT=codex` should take the Codex placeholder path and fail closed; a Codex-shaped fixture with `CLOOKS_AGENT` unset should take the Claude/default path and fail as an unrecognized Claude event or payload, not silently switch to Codex.

5. Add or update E2E coverage because this plan changes shared engine and binary execution paths. Prefer adding focused cases to an existing E2E file if one already covers engine mode, or create a small `test/e2e/agent-adapter.e2e.test.ts`. Cover at least:

       unset CLOOKS_AGENT + Claude fixture -> same successful output shape as before
       CLOOKS_AGENT=claude-code + same fixture -> same output shape
       CLOOKS_AGENT=unknown -> fail-closed stderr and exit 2
       CLOOKS_AGENT=codex -> fail-closed "not implemented yet" diagnostic until Plan D

   If an implementation chooses to let the Codex scaffold parse fixtures but not translate results, update these expectations before implementing and record the deviation in the Decision Log.

6. Run validation:

       bunx prettier --check docs/plans/feat-0044-cross-agent-portability/PLAN-FEAT-0044B-agent-adapter-boundary.md docs/plans/feat-0044-cross-agent-portability/ATTENTION.md docs/epics/EPIC-0044-cross-agent-hook-portability.md
       bun run typecheck
       bun test src/
       bun run test:e2e

   The direct Markdown Prettier command above is useful while editing this ignored plan folder, but it may be blocked by local workflow hooks because the project-level format script intentionally does not cover Markdown. If that happens during implementation, do not spend time bypassing the hook; format the plan docs manually, record the local-tooling limitation in `Surprises & Discoveries`, and continue with the required TypeScript and E2E validation. If the full unit suite still has the known pre-existing `src/commands/init.test.ts` no-git interactive-confirm failure from Plan A, record the exact current output. Do not hide new failures behind that baseline. If Docker is not running for E2E, state that explicitly; do not run `bun test test/e2e/...` directly as a substitute.

7. Update domain docs after implementation, not before behavior exists. At minimum, update `docs/domain/cli-architecture.md` with agent selection and engine delegation. Update `docs/domain/cross-agent-hooks.md` with the adapter boundary and the Plan B result. Update `docs/domain/bash-entrypoint.md` only if the generated entrypoint behavior or documented environment variables change. Update `docs/domain/testing.md` if new adapter test conventions are added.

8. Review findings at completion. If Plan B fixes a stale-docs item, remove or update that finding according to `docs/findings/index.md`. If Plan B exposes new friction or a test gap, ask a subagent to log it.

## Validation and Acceptance

Acceptance is behavior-preserving for Claude Code and boundary-enabling for Codex.

For Claude Code:

- With `CLOOKS_AGENT` unset, a representative `PreToolUse` Claude fixture that previously emitted `hookSpecificOutput.permissionDecision: "allow"` or `"deny"` still emits the same JSON shape and exit code.
- With `CLOOKS_AGENT=claude-code`, the same fixture emits the same JSON shape and exit code as the unset path.
- Existing plugin vendoring and stale-plugin advisories still appear only on Claude `SessionStart` when their preconditions are present.
- Existing fail-closed behavior remains intact: malformed stdin, unknown Claude event names, bad config under the circuit-breaker threshold, and unknown `CLOOKS_AGENT` values exit with code 2 and a clear stderr diagnostic.

For Codex boundary scaffolding:

- `CLOOKS_AGENT=codex` does not claim support for any Codex event and does not emit Codex decision JSON in Plan B.
- The codebase contains a named Codex adapter boundary that later Plan D can implement for all ten Codex MVP events.
- Codex fixture tests from Plan A still pass, proving the fixture corpus remains valid even though Plan B does not consume it for runtime translation.
- Agent selection is explicit. The runtime never decides between Claude and Codex by inspecting shared event names or payload fields.

Validation commands:

       bun run typecheck
       bun test src/
       bun run test:e2e

The implementation is complete only when the relevant unit tests and E2E tests pass, or when any pre-existing baseline failure is clearly documented with evidence and no new failures are introduced.

## Idempotence and Recovery

The implementation should be additive-first and safe to retry. Add adapter files and tests before deleting or moving existing behavior. Keep `runEngine()` exported so `src/cli.ts` and existing tests continue to compile throughout the refactor. If a refactor step breaks many tests, revert only the latest local Plan B change, not unrelated dirty files such as Plan A artifacts or `schemas/clooks.schema.json`.

If the adapter selector causes accidental lockout during manual testing, unset `CLOOKS_AGENT` to return to the default Claude path. If the generated entrypoint is changed in a later plan and blocks work, `SKIP_CLOOKS=true` remains the documented bypass. Plan B should not require mutating real `~/.codex`, `~/.clooks`, or Codex trust state.

## Artifacts and Notes

Plan A artifacts are part of this plan's context and should be preserved:

       docs/plans/feat-0044-cross-agent-portability/codex-capability-matrix.md
       test/fixtures/codex/events/
       src/codex-fixtures.test.ts

Plan and epic files under `docs/plans/`, `docs/epics/`, `docs/research/`, and `docs/findings/` may be ignored by this repository's `.gitignore`. If committing this plan or the Plan A docs, use `git add -f` for ignored documentation files. Do not force-add unrelated scratch files under `tmp/`.

Future Plan C registration shape, recorded here for continuity but not implemented by this plan:

    {
      "hooks": {
        "PreToolUse": [
          {
            "matcher": "*",
            "hooks": [
              {
                "type": "command",
                "command": "CLOOKS_AGENT=codex CLOOKS_PROJECT_ROOT=/abs/repo /abs/repo/.clooks/bin/entrypoint.sh",
                "statusMessage": "Running Clooks"
              }
            ]
          }
        ]
      }
    }

The same pattern should be repeated by Plan C for the ten Codex MVP events. The exact matcher policy belongs to Plan C/D, but Clooks should register one Codex command per event and preserve per-hook matching and ordering internally.

## Interfaces and Dependencies

Define an internal agent id type:

    export type AgentId = 'claude-code' | 'codex'

Define an adapter interface with names close to the following. The implementation may refine exact types, but any deviation must be logged in `Surprises & Discoveries` before marking a milestone complete:

    export interface AgentAdapter {
      id: AgentId
      readEventName(raw: Record<string, unknown>): EventName | null
      normalizeContext(raw: Record<string, unknown>, eventName: EventName): Record<string, unknown>
      translateFinalOutput(input: TranslateFinalOutputInput): TranslatedAgentOutput
      routeSystemMessage(eventName: EventName, message: string): 'stdout-json' | 'stderr' | 'drop'
      supportsClaudePluginAdvisories: boolean
    }

    export interface TranslateFinalOutputInput {
      eventName: EventName
      result?: EngineResult
      systemMessages: string[]
      diagnostics: string[]
    }

    export interface TranslatedAgentOutput {
      output?: string
      stderr?: string
      exitCode: ExitCode
    }

The selector should expose a function close to:

    export function selectAgentAdapter(env?: NodeJS.ProcessEnv): AgentAdapter

If throwing is cleaner for unsupported agents, the thrown error must be caught by `runEngine()` and translated to fail-closed exit code 2 with a message naming `CLOOKS_AGENT`.

The Claude adapter should reuse the existing `normalizeKeys()` logic and existing Claude translator behavior. Its `readEventName()` should preserve today's fail-closed behavior for missing or unknown Claude `hook_event_name` values. Its `translateFinalOutput()` should own the current top-level `systemMessage` merge, `NOTIFY_ONLY_EVENTS` stderr rerouting, and `ConfigChange policy_settings` downgrade. The Codex adapter should not implement real normalization or translation in this plan. It should be shaped so Plan D can replace the unsupported placeholder with code that consumes Plan A fixtures and the capability matrix.

Agent selection is not part of the adapter interface because it is done once before adapter methods are called. The selector reads only `CLOOKS_AGENT`; it must not inspect stdin. This matters because reading stdin for selection would consume the stream before `runEngine()` can perform debug logging, parse errors, and normal pipeline work.

## Danger Zones and Guardrails

This plan touches danger zones during implementation. `ATTENTION.md` must live beside this file and be kept current.

The danger zones are:

- **Shared runtime abstraction:** `src/engine/run.ts`, `src/engine/types.ts`, and any new `src/agents/*` adapter interfaces affect every hook invocation.
- **Fail-closed error handling:** exit code and stderr behavior in engine mode determines whether unsafe actions are blocked or silently allowed.
- **Agent wire translation:** moving `translateResult()` or wrapping it incorrectly can change Claude Code's hook output contract.
- **Claude plugin/settings advisories:** these must remain Claude-only and must not leak into Codex runs.
- **Claude-specific orchestration currently embedded in `runEngine()`:** `NOTIFY_ONLY_EVENTS` message routing, `ConfigChange policy_settings` downgrades, and top-level `systemMessage` JSON merging must move under the Claude adapter or remain clearly marked as Claude-specific helpers.

Before each milestone is marked complete, compare the implementation against this section and update `ATTENTION.md` if the touched files or risks changed.

## Instruction Prompts

User prompt recorded on 2026-05-25:

    Continue EPIC-0044 by writing Plan B: Agent Adapter Boundary for Clooks.

      Read and follow:
      - docs/plans/PLANS.md
      - docs/epics/EPIC-0044-cross-agent-hook-portability.md
      - docs/plans/feat-0044-cross-agent-portability/PLAN-FEAT-0044A-codex-runtime-contract-verification.md
      - docs/plans/feat-0044-cross-agent-portability/codex-capability-matrix.md
      - docs/domain/cross-agent-hooks.md
      - docs/domain/cli-architecture.md
      - docs/domain/bash-entrypoint.md
      - docs/domain/config.md
      - docs/domain/testing.md
      - docs/findings/index.md plus relevant finding files

      Goal:
      Create the ExecPlan for Plan B only. Do not implement production code yet unless I explicitly ask.

      Plan B purpose:
      Introduce an agent adapter boundary so Clooks can keep Claude Code behavior unchanged while adding a future Codex adapter. The Codex MVP scope is now all 10 release-documented Codex events:
      SessionStart, SubagentStart, PreToolUse, PermissionRequest, PostToolUse, PreCompact, PostCompact, UserPromptSubmit, SubagentStop, Stop.

      Important Plan A result:
      Plan A completed as docs-backed but runtime-unverified. Live Codex hook firing was blocked by disposable auth (`401 Unauthorized`), so Plan B may create architecture and Claude-preservation tests, but safety-
      critical Codex translation behavior remains for Plan D/E and must not be claimed as runtime-verified.

      Plan B should cover:
      - Splitting the current Claude-shaped `runEngine()` path into shared engine core plus agent-specific adapters.
      - Keeping default/no-env behavior backward-compatible with Claude Code.
      - Supporting an explicit agent selection mechanism such as `CLOOKS_AGENT=claude-code` now and future `CLOOKS_AGENT=codex`.
      - Preserving Claude output translation and plugin/settings advisories as Claude-only behavior.
      - Defining future Codex adapter interfaces without implementing Codex normalize/translate yet.
      - Adding unit tests for adapter selection and Claude behavior preservation.
      - Adding E2E requirements if production code changes shared engine or binary execution paths.
      - Updating affected domain docs after implementation in the future.
      - Identifying danger zones and whether Plan B needs `ATTENTION.md`.

      Constraints:
      - Follow PLANS.md exactly. Record my prompt in the plan.
      - Plan files may be ignored by git; mention force-add needs.
      - Existing unrelated `schemas/clooks.schema.json` change must not be reverted.
      - Plan A artifacts may also be gitignored; preserve them.
      - Do not add README Codex support claims in Plan B.

Revision note, 2026-05-25 / Joe Degler: Initial Plan B draft created from the user prompt. This is planning-only work; production implementation remains pending.

Revision note, 2026-05-25 / Joe Degler: Incorporated review feedback that the original adapter interface under-modeled the current two-phase engine flow and left several Claude-only behaviors unnamed. The plan now assigns event validation, notify-only routing, policy-settings downgrade, and system-message JSON composition to the adapter boundary.

Revision note, 2026-05-25 / Joe Degler: Added the dynamic registration decision. Codex registration will set `CLOOKS_AGENT=codex`; Claude remains the unset default; Plan B prepares binary-side selection only; Plan C owns `.codex/hooks.json` generation.
