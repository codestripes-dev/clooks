# Verify the Codex Hook Runtime Contract

This ExecPlan is a living document. The sections `Product Context`, `Progress`, `Surprises & Discoveries`, `Decision Log`, `Outcomes & Retrospective`, and `Related Domain Knowledge Documents` must be kept up to date as work proceeds.

This plan must be maintained according to `docs/plans/PLANS.md`. The reader should assume no prior context beyond this repository and this plan.

**Originating Feature:** [`FEAT-0044: Cross-Agent Hook Portability`](../../planned/FEAT-0044-cross-agent-hooks.md)

**Coordinating Epic:** [`EPIC-0044: Cross-Agent Hook Portability — Codex Adapter`](../../epics/EPIC-0044-cross-agent-hook-portability.md)

## Purpose / Big Picture

This plan verifies exactly what Codex hooks support before Clooks implements a Codex adapter. After this plan is complete, a contributor can open a single capability matrix and know which Codex events Clooks should initially support, which input fields are reliable, which output fields Codex honors, and which Clooks result capabilities must be rejected or downgraded under Codex. The observable result is not a new production feature yet; it is a repeatable evidence-backed contract that downstream implementation plans can use without guessing.

The key user benefit is risk reduction. Users eventually want their existing Clooks TypeScript hooks to run under both Claude Code and Codex. That is only safe if Clooks maps to Codex behavior that actually exists in the installed Codex CLI and the current official docs. This plan prevents Clooks from shipping a "portable" surface that silently drops safety decisions such as `ask`, `updatedInput`, or permission rewrites.

## Product Context

**Problem we are solving:** Clooks is currently Claude-Code-shaped. The roadmap goal is to become a general-purpose hook framework across Claude Code and Codex. Codex has a similar hook system, but its documented support is narrower than Claude Code's and some parsed fields fail open or fail closed. We need a verified contract before implementing adapters, registration, or public docs.

**Metrics this may affect:** This plan has no direct product metric impact because it does not ship runtime behavior. It reduces implementation rework, prevents unsafe cross-agent claims, and improves future onboarding clarity for teams using both Claude Code and Codex.

**Feature alignment:** FEAT-0044 says custom and vendored hooks should share a common config and directory structure across agents. This plan aligns with that use case by verifying Codex as the first concrete target. It narrows the feature's older broad list of target agents to Codex-first sequencing, which the epic records as an explicit design decision. Cursor, Windsurf, and VS Code Copilot remain future targets.

## Progress

- [x] (2026-09-07, Joe-Degler) Recorded user clarification: Clooks assumes repository trust. Preserve global/home/project/local merging; remove separate repository authorization and permission-model redesign from continuation scope. Retain registration correctness and regression/E2E/smoke coverage.
- [x] (2026-09-07, Joe-Degler) Completed bounded continuation reassessment: reviewed current source and intervening handoff/turn-state changes, refreshed official Codex documentation, obtained independent architecture and registration reviews, and recorded findings and proposed milestone order in `continuation-review.md` and the coordinating epic. Marked the matrix as historical and corrected domain evidence/normalization/dedup descriptions. No production implementation or live runtime verification occurred.
- [x] (2026-09-07, Joe-Degler) Validation: typecheck passed; focused existing tests had 186 passes and one turn-state test-isolation failure. The failing test passed alone with a disposable state root. Logged the isolation defect and registration/runtime readiness findings; no test or production fix was made in this research pass.
- [x] (2026-05-17, Joe Degler) Created EPIC-0044 with Codex as the first cross-agent target and identified Plan A as runtime contract verification.
- [x] (2026-05-17, Joe Degler) Read `docs/plans/PLANS.md`, `docs/epics/EPIC-0044-cross-agent-hook-portability.md`, `docs/planned/FEAT-0044-cross-agent-hooks.md`, `docs/domain/cross-agent-hooks.md`, and related findings before drafting this plan.
- [x] (2026-05-17, Joe Degler) Re-checked the official Codex hooks documentation. Current docs state that the release reference is the hooks page, and generated `main` schemas may include fields not in the current release.
- [x] (2026-05-17, Joe Degler) Confirmed local Codex CLI is present as `codex-cli 0.130.0`.
- [x] (2026-05-17, Joe Degler) Ran code/process, feature/epic, and product review subagents against the initial draft and incorporated their required gates into this plan.
- [x] (2026-05-23 23:46Z, Joe Degler) Re-read this plan, the coordinating epic, `docs/plans/PLANS.md`, relevant domain docs, and related findings before executing Plan A.
- [x] (2026-05-23 23:46Z, Joe Degler) Refreshed the official Codex hooks docs, plugin build docs, generated schema directory, local `codex exec --help`, and `codex features list`; current installed CLI is `codex-cli 0.133.0`.
- [x] (2026-05-23 23:55Z, Joe Degler) Wrote `docs/plans/feat-0044-cross-agent-portability/codex-capability-matrix.md` covering the current ten release-documented Codex events and the output capabilities Clooks may emit.
- [x] (2026-05-23 23:55Z, Joe Degler) Included a Codex-event-to-Clooks-event/context mapping policy in the matrix, covering matcher fields, nullable `transcript_path`, `turn_id`, raw payload retention, and first-MVP surface fit.
- [x] (2026-05-23 23:55Z, Joe Degler) Created durable Codex hook input fixtures under `test/fixtures/codex/events/` and a fixture parser test in `src/codex-fixtures.test.ts`.
- [x] (2026-05-23 23:55Z, Joe Degler) Built and ran `tmp/feat-0044-codex-contract/run-live-codex-spike.sh`, which uses disposable `HOME`, `CODEX_HOME`, and project directories.
- [x] (2026-05-24 00:37Z, Joe Degler) Documented Codex trust/review constraints and verified enough registration behavior to know the disposable live spike can pass a project `.codex/hooks.json` and `--dangerously-bypass-hook-trust`, but model/auth access blocks actual hook firing.
- [x] (2026-05-24 00:37Z, Joe Degler) Made the capability decision: `docs-backed but runtime-unverified`.
- [x] (2026-05-24 00:40Z, Joe Degler) Updated EPIC-0044 with the Plan A result, the matrix link, the expanded Codex event count, and downstream scope gates.
- [x] (2026-05-24 00:40Z, Joe Degler) Updated `docs/domain/cross-agent-hooks.md` and `docs/domain/testing.md`. Did not add user-facing README Codex support claims.
- [x] (2026-05-24 00:50Z, Joe Degler) Reviewed relevant findings at completion. Plan A does not resolve the existing new-event harness, stale Claude docs, README event table, or global type import findings. New tooling friction from live Codex spikes is recorded in `docs/findings/tooling-friction.md`.
- [x] (2026-05-24 00:55Z, Joe Degler) Ran validation: Prettier checks passed for plan/domain docs, matrix, Codex fixtures, and fixture test; `bun run typecheck` passed; `bun test src/codex-fixtures.test.ts` passed; full `bun run test` had only the documented pre-existing `src/commands/init.test.ts` no-git decline failure.
- [x] (2026-05-25 02:25Z, Joe Degler) Promoted Codex `PreCompact` and `PostCompact` into the first Codex adapter MVP per user direction because they mirror existing Clooks events. This was superseded by the later all-ten-event MVP decision below.
- [x] (2026-05-25 02:35Z, Joe Degler) Checked README and confirmed Clooks already documents `SubagentStart` and `SubagentStop` as supported Claude-side events. Promoted both Codex subagent events into the first MVP and corrected the matrix/domain rationale.

## Surprises & Discoveries

- Observation: The September reassessment found that current upstream documentation and the shared engine have both moved beyond the May snapshot. Registration activity/trust, per-hook capability validation, and handoff/turn identity now require explicit work before runtime activation.
  Evidence: `continuation-review.md` records source references, fetched official documentation, independent reviews, and the focused-test transcript at HEAD `74eda9b`.

- Observation: `gh api user --jq '.login'` failed in the sandbox with `error connecting to api.github.com`, so this plan uses local git identity `Joe Degler` for author/date annotations.
  Evidence: command failed before this plan was written; `git config user.name` returned `Joe Degler`.

- Observation: The official Codex hooks docs already settle part of the earlier uncertainty. For `PreToolUse`, `permissionDecision: "ask"`, legacy `decision: "approve"`, `updatedInput`, `continue: false`, `stopReason`, and `suppressOutput` are parsed but not supported yet and fail open.
  Evidence: official Codex hooks page, checked 2026-05-17.

- Observation: The local Codex CLI exposes `codex exec`, `codex features`, `codex plugin`, and non-interactive flags, but there is no obvious direct command in `codex --help` for "run this hook fixture now." Plan A must therefore include both direct fixture validation and an empirical spike that uses real Codex invocation only where safe and feasible.
  Evidence: `codex --help` and `codex exec --help` output checked before this plan was drafted.

- Observation: The first review pass found the original draft allowed Plan A to complete even if safety-critical runtime behavior could not be empirically verified.
  Evidence: Product review subagent reported that `PreToolUse` block/ask/updatedInput behavior, `PermissionRequest` allow/deny/rewrite behavior, and Stop continuation semantics must gate whether later adapter work is unblocked.

- Observation: The official Codex hooks page changed between the initial Plan A draft and execution. On 2026-05-23 UTC, the release docs list `PreCompact`, `PostCompact`, `SubagentStart`, and `SubagentStop` alongside the six earlier events. The docs also now describe `PreToolUse.updatedInput` with `permissionDecision: "allow"` as supported for Bash, `apply_patch`, and MCP tools, while `permissionDecision: "ask"` remains unsupported and failed-open.
  Evidence: `https://developers.openai.com/codex/hooks` checked 2026-05-23 UTC; local CLI is `codex-cli 0.133.0`.

- Observation: `codex features list` in `codex-cli 0.133.0` reports `hooks` and `plugin_hooks` as stable and effectively enabled.
  Evidence: local command output checked 2026-05-23 UTC.

## Decision Log

- Decision: Using Clooks assumes the repository is trusted. Global execution continues to load the merged home/project/local pipeline without a new repository authorization layer. Tighter permission models are deferred and are not a release gate for this epic.
  Rationale: Explicit user direction supersedes the reassessment's proposed global trust-policy gate. Native agent hook activation remains an integration requirement; it does not justify redesigning Clooks permissions.
  Date/Author: 2026-09-07 / Joe-Degler.

- Decision: Preserve the historical Plan A result, retain the agreed ten-event product scope, and propose corrective registration work before enabling the Codex adapter. The version-specific matrix refresh remains a gate; the originally proposed global trust-policy gate was withdrawn after explicit user clarification that Clooks assumes repository trust.
  Rationale: A broad current website reference and synthetic fixtures are not runtime proof. Source review identified lifecycle defects in completed registration work and policy needs introduced after the adapter boundary. The continuation review records proposals separately from approved behavior changes.
  Date/Author: 2026-09-07 / Joe-Degler.

- Decision: Treat the official Codex hooks page as the release contract and generated `main` branch schemas as advisory until runtime verified.
  Rationale: The Codex docs explicitly state that linked `main` schemas may include fields that are not in the current release. Building against undocumented schema-visible fields would create adapter churn and user-visible false promises.
  Date/Author: 2026-05-17 / Joe Degler.

- Decision: Plan A produces research artifacts, fixture inputs, and documentation updates, but no production adapter code.
  Rationale: The later epic plans depend on this plan's capability matrix. Shipping adapter code before settling the contract would couple Clooks to assumptions about unsupported Codex fields.
  Date/Author: 2026-05-17 / Joe Degler.

- Decision: The initial capability matrix must include "unsupported but parsed" as a distinct state from "unsupported and rejected."
  Rationale: Codex has both fail-open behavior (`PreToolUse.updatedInput` per docs) and fail-closed behavior (`PermissionRequest.updatedInput` per docs). Clooks must react differently: fail-open fields are safety hazards if silently emitted; fail-closed fields can brick the invocation if passed through.
  Date/Author: 2026-05-17 / Joe Degler.

- Decision: The plan will use local disposable `CODEX_HOME`, `HOME`, and project directories for all live Codex spikes.
  Rationale: Codex hook trust and config are user-affecting. This plan must not mutate the user's real `~/.codex` state or trust database.
  Date/Author: 2026-05-17 / Joe Degler.

- Decision: Plan A may finish as `partial/blocking` instead of `done` if safety-critical runtime behavior cannot be empirically verified.
  Rationale: Docs-backed claims are useful, but they are not enough to unblock adapter implementation for behavior that determines whether Clooks blocks, allows, or silently fails open. If live verification is blocked by auth, trust UI, network, or CLI limitations, Plan A must say which later plans may proceed only with docs-only scaffolding and which must wait.
  Date/Author: 2026-05-17 / Joe Degler.

- Decision: Plan A must not add production `src/` modules.
  Rationale: Production code changes to adapter boundaries, permission translation, hook registration, or trust handling are danger-zone-adjacent and require the later implementation plans, unit tests, E2E tests, and likely an `ATTENTION.md`. Plan A is contract verification only.
  Date/Author: 2026-05-17 / Joe Degler.

- Decision: README updates are out of scope for Plan A except an explicitly requested roadmap note.
  Rationale: README is user-facing. Adding Codex install/init claims before registration, adapter implementation, and E2E validation would overstate support. User-facing Codex docs belong to Plan F.
  Date/Author: 2026-05-17 / Joe Degler.

- Decision: Initially keep the Clooks adapter MVP scoped to the original six shared lifecycle events unless a downstream implementation plan explicitly promotes more events. This decision was superseded on 2026-05-25 by the later decision to include `PreCompact` and `PostCompact` in the first MVP.
  Rationale: At the time, Plan A was verification work for a Codex adapter that preserves the current Clooks authoring surface. `PreCompact` and `PostCompact` were plausible near-term additions because Clooks already has Claude events with those names; `SubagentStart` and `SubagentStop` need separate mapping policy because the current Clooks public surface does not have equivalent Codex subagent contexts.
  Date/Author: 2026-05-23 / Joe Degler.

- Decision: Promote Codex `PreCompact` and `PostCompact` into the first Codex adapter MVP.
  Rationale: The user confirmed these should be added, and both events mirror existing Clooks/Claude event names closely enough to include in the initial adapter scope. Their safety-critical Codex output behavior remains docs-backed but runtime-unverified, so implementation must still test translation carefully. This decision was later superseded by the all-ten-event MVP decision that also includes `SubagentStart` and `SubagentStop`.
  Date/Author: 2026-05-25 / Joe Degler.

- Decision: Promote Codex `SubagentStart` and `SubagentStop` into the first Codex adapter MVP.
  Rationale: The README parity map already lists both as supported Clooks events for Claude Code. The earlier Plan A rationale that Clooks had no equivalent public subagent context was incorrect. Codex subagent events still need careful translation tests because `SubagentStart` context injection targets the spawned subagent and `SubagentStop.block` has Stop-like continuation semantics.
  Date/Author: 2026-05-25 / Joe Degler.

## Outcomes & Retrospective

2026-09-07: The bounded reassessment is complete, with the continuation review and epic recording a runtime contract refresh, corrective registration plan, expanded runtime policy work, upstream conformance, and final distribution docs. User clarification subsequently withdrew the proposed separate repository authorization gate: preserve the trusted-repository and merged-global model. The old matrix remains a historical snapshot pending targeted version-specific refresh. Typecheck passed; the focused suite exposed one test that fails because turn-state I/O is not isolated from home storage. The same test passes alone under a disposable root. Concrete code/test findings remain unresolved because this pass makes no production or test changes. No live Codex run was attempted and the runtime-unverified classification is unchanged. Existing Plan A/B/C artifacts remain in the active feature folder while downstream work uses them.

2026-05-24 UTC: Plan A completed as `docs-backed but runtime-unverified` and therefore partially blocking for behavior that depends on Codex honoring safety-critical hook outputs. The capability matrix now records ten current release-documented Codex events and, after user direction on 2026-05-25 plus a README check, recommends the first adapter MVP cover all ten. Durable fixtures exist for all ten documented events and are covered by a parser test. The live Codex spike used disposable home/config/project directories and did not mutate real Codex state, but it could not capture hook payloads because the disposable run failed with `401 Unauthorized` after network access was allowed. Downstream Plans B and C may proceed on adapter boundaries, registration shape, and fixture-backed tests; Plans D/E must still treat safety-critical runtime decisions as blocked on live verification or an explicit release-confidence decision before user-facing support is claimed.

Validation on 2026-05-24 UTC: `bunx prettier --check` passed for the touched plan/domain docs, matrix, Codex fixture JSON, and `src/codex-fixtures.test.ts`; `bun run typecheck` passed; `bun test src/codex-fixtures.test.ts` passed. Full `bun run test` still fails at the known pre-existing baseline test `src/commands/init.test.ts` / `clooks init > guardrail: no-git with interactive confirm decline aborts`, with 1312 passing and 1 failing.

## Context and Orientation

Clooks is a Bun/TypeScript CLI. The compiled binary has two modes. When it receives command-line arguments, `src/cli.ts` routes to the interactive CLI via `src/router.ts`. When it receives no arguments and stdin is not a TTY, it runs the hook engine. The current engine is in `src/engine/run.ts`; it assumes Claude Code wire input and Claude Code output translation.

The existing Clooks hook pipeline works like this. Claude Code calls `.clooks/bin/entrypoint.sh`. The entrypoint captures stdin, finds the `clooks` binary on `PATH`, and pipes the original JSON to the binary. The binary reads `hook_event_name`, validates the event against the Claude event set in `src/config/constants.ts`, loads `.clooks/clooks.yml` plus home/local layers through `src/config/index.ts`, imports TypeScript hook files through `src/loader.ts`, runs matching handlers through `src/engine/execute.ts`, and serializes Claude output through `src/engine/translate.ts`.

Codex has a similar command-hook model. Codex reads hooks from `hooks.json` or inline `[hooks]` tables in `config.toml` next to active config layers. Useful locations are `~/.codex/hooks.json`, `~/.codex/config.toml`, `<repo>/.codex/hooks.json`, and `<repo>/.codex/config.toml`. Hooks are organized by event, matcher group, and command handler. Codex launches multiple matching command handlers concurrently, so Clooks must eventually register a single Clooks entrypoint per Codex event and run Clooks' own ordering internally.

The official Codex docs checked during Plan A execution document ten release events: `SessionStart`, `SubagentStart`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `UserPromptSubmit`, `SubagentStop`, and `Stop`. The first Clooks adapter MVP should start with all ten events because Clooks already documents matching Claude-side event names, including `SubagentStart` and `SubagentStop`.

Definitions used in this plan:

- **Wire input** means the raw JSON object an agent sends to a command hook on stdin.
- **Wire output** means what the command hook writes to stdout or stderr, plus its process exit code.
- **Capability matrix** means a table that says whether each event/input/output combination is supported, ignored, fail-open, fail-closed, or unverified.
- **Fail open** means an unsupported output does not stop the action and may silently do nothing. This is dangerous for safety decisions.
- **Fail closed** means an unsupported output causes Codex to reject the hook output or block/error. This is noisy but safer.
- **Adapter** means future code that will convert between Codex wire JSON and Clooks' internal context/result shapes. This plan verifies the adapter contract but does not implement it.

## Related Domain Knowledge Documents

- `docs/domain/cross-agent-hooks.md` — consulted for current cross-agent landscape and Codex notes. Updated by Plan A with the current ten Codex events, the all-ten first-MVP subset, `PreToolUse.updatedInput` support constraints, runtime-unverified status, and the capability matrix link.
- `docs/domain/cross-agent-hooks.md` previously contained premature Codex mapping language from the exploratory pass. Plan A rewrote the Codex table into docs-backed, unsupported/fail-open, unsupported/fail-closed, out-of-MVP, and unverified classifications.
- `docs/domain/cli-architecture.md` — consulted for how `src/cli.ts` dispatches between engine and CLI modes. No direct update is required by this research-only plan unless the final Plan A findings change the proposed adapter boundary.
- `docs/domain/config.md` — consulted for Clooks config loading, layering, and hook path resolution. No direct update is required by this plan unless Codex verification discovers config-layer constraints that change the planned adapter design.
- `docs/domain/testing.md` — consulted for E2E and fixture conventions. Updated by Plan A with the durable `test/fixtures/codex/events/` convention, fixture validation scope, and disposable live-Codex spike guidance.
- `docs/domain/bash-entrypoint.md` — relevant because later Codex registration will reuse the current bash entrypoint. No direct update is required by this verification plan unless the spike discovers entrypoint environment behavior that must be documented before implementation.
- `docs/domain/claude-code-hooks/events.md` — consulted only as a contrast for Claude's event surface. No update is required by Plan A unless the final docs explain Codex-vs-Claude event differences there, which is probably better kept in `cross-agent-hooks.md`.
- `README.md` — not a domain doc, but the final cross-agent user documentation will eventually need Codex support notes. Plan A should not update README with user-facing Codex support claims. README work belongs to Plan F after adapter implementation and E2E validation.

## Related Findings

- `docs/findings/test-gaps.md` → "No reusable harness for new-event additions" is relevant because Codex support will need fixture-driven event verification. Plan A does not solve the general Claude new-event harness, but it should avoid repeating the anti-pattern by making Codex fixtures reusable for later adapter tests.
- `docs/findings/stale-docs.md` → "claude-code-hooks/events.md under-counts lifecycle events" is relevant as a warning against trusting stale internal docs for upstream event counts. Plan A explicitly uses current official Codex docs plus runtime verification before updating Clooks docs.
- `docs/findings/stale-docs.md` → "README.md Events section missing PostCompact after PLAN-0014" is not addressed by this plan, but it is a reminder that README event claims drift easily. Plan A must not add README Codex event tables until the capability matrix is complete.
- `docs/findings/knowledge-gaps.md` → "No documented pattern for global hook type imports" is indirectly relevant to global cross-agent hooks. Plan A does not address type imports, but downstream Codex global-hook docs should avoid promising more than existing global Clooks typing supports.

## Plan of Work

First, create a self-contained capability matrix artifact under `docs/plans/feat-0044-cross-agent-portability/`. The artifact should capture the release-documented Codex events, the common fields Codex sends, event-specific fields, matcher behavior, stdout/stderr/exit behavior, supported JSON fields, unsupported-but-parsed fields, adapter-facing context mapping, and the matching Clooks result capabilities. The matrix must embed the relevant Codex behavior in prose so later agents do not need to re-open external docs to understand the contract. It must also include source metadata: official docs URLs, docs checked date, installed `codex --version`, whether generated schemas were consulted, and whether each claim is docs-backed, runtime-verified, or unverified.

The matrix must include a section named "Codex event -> Clooks context policy." For each event, say which existing Clooks event it maps to, whether the current public `ClooksHook` handler surface can be used unchanged, how `transcript_path: null` should be represented for now, whether `turn_id` is discarded, stored as adapter metadata, or exposed later, and whether the raw Codex payload must be retained internally. This section is required because Plan B and Plan D cannot safely split the engine or implement normalization without it.

The matrix must also include a "Portable hook author guidance" section. Classify each result capability as portable, Claude-only, Codex-only, unsupported, or unverified. Explicitly state that Claude plugin-delivered hooks remain Claude-only per FEAT-0044; portable hooks are custom or vendored Clooks hooks.

Second, build a durable fixture corpus under `test/fixtures/codex/events/` if the fixtures are stable enough for reuse. If the team decides fixtures are research artifacts rather than test fixtures, put them under `docs/plans/feat-0044-cross-agent-portability/fixtures/codex/events/`. Do not put lasting fixtures under `tmp/`; `tmp/` is only for disposable spike scratch files. Each fixture should be a minimal JSON payload for one Codex event and one representative scenario. Include at least one `PreToolUse` Bash payload, one `PermissionRequest` Bash payload, one `PostToolUse` Bash payload, one `UserPromptSubmit` payload, one `Stop` payload, and one `SessionStart` payload. If a field is nullable in the docs, include a case with `transcript_path: null`.

Third, write a disposable spike harness in `tmp/feat-0044-codex-contract/`. The harness should never write to real `~/.codex` or real project `.codex` unless the user explicitly asks. It should create a temporary project directory, a temporary `CODEX_HOME`, and hook command scripts that record stdin and emit controlled outputs. The harness should try to exercise Codex through `codex exec` or another documented CLI path. If Codex requires credentials, model access, trust UI, or an interactive `/hooks` flow that cannot run safely in CI, record that as a verified limitation and keep the fixture replay path as the main evidence.

Plan A's trust/review work is intentionally bounded. It should document Codex's trust constraints and verify only enough registration behavior to decide whether live hook spikes can run safely. Full `.codex/hooks.json` generation, absolute entrypoint command shape, `CLOOKS_PROJECT_ROOT`, update behavior, and uninstall behavior belong to Plan C.

Fourth, test output behavior by writing small command hooks that emit one output shape at a time. The key event-specific cases are `PreToolUse` deny, `PreToolUse.additionalContext`, `PreToolUse.ask`, `PreToolUse.updatedInput`, `PermissionRequest.allow`, `PermissionRequest.deny`, `PermissionRequest.updatedInput`, `PostToolUse.block`, `PostToolUse.continue:false`, `UserPromptSubmit.additionalContext`, `UserPromptSubmit.block`, `Stop.block`, and `Stop.continue:false`. The key general output-channel cases are valid JSON with `systemMessage`, stderr with exit 0, stderr with exit 2, another nonzero exit, non-JSON stdout, empty stdout, malformed JSON, unknown top-level JSON fields, and event-specific unsupported fields. The plan executor should record for each case whether Codex honors it, ignores it, fails open, fails closed, or cannot be tested.

Fifth, make an explicit capability decision before updating downstream scope. Classify the outcome as `implementable MVP`, `docs-backed but runtime-unverified`, or `blocked`. `implementable MVP` requires empirical verification of the safety-critical cases: `PreToolUse` deny/additionalContext and unsupported fail-open fields, `PermissionRequest` allow/deny and reserved fail-closed fields, `PostToolUse` block/continue behavior, and `Stop` continuation behavior. If those cannot be empirically verified, Plan A may still produce useful docs-backed artifacts, but it must finish as `partial/blocking` and must not mark Plan B, C, or D unblocked beyond docs-only scaffolding.

Sixth, update `docs/domain/cross-agent-hooks.md` with the final verified matrix. If the verification produces reusable test conventions, update `docs/domain/testing.md`. If it produces entrypoint or environment conventions that downstream plans must follow, update `docs/domain/bash-entrypoint.md` or `docs/domain/cli-architecture.md` as appropriate. Do not update README with broad user-facing Codex support claims in Plan A; README changes belong to the final documentation/distribution plan unless the team explicitly wants a roadmap note.

Finally, update `docs/epics/EPIC-0044-cross-agent-hook-portability.md`. Mark Plan A as done or partially done, link the capability matrix artifact, and revise Plan B through Plan F if the verified contract changes their scope. If Plan A shows that a Codex feature is unavailable, record that as a design decision in the epic so future plans do not reopen the same question casually.

At completion, review `docs/findings/index.md` and the related finding files named in this plan. If Plan A resolves a finding, remove it. If Plan A discovers new friction, stale docs, or test gaps, log a finding using the repository process before closing the plan.

## Concrete Steps

Run all commands from the repository root `/opt/development/clooks`.

1. Confirm local tool versions and current state:

       pwd
       codex --version
       bun --version
       git status --short --untracked-files=all

   Expected: `codex-cli 0.130.0` or a newer installed version. If Codex is missing, record that in `Surprises & Discoveries` and skip live Codex spikes; continue with docs and fixture work.

2. Refresh official docs at plan execution time. Use official OpenAI Codex docs only. Capture the date, URL, and any changed event/output behavior in `Surprises & Discoveries`. If docs differ from this plan, update the plan before continuing.

   The required URLs are:

       https://developers.openai.com/codex/hooks
       https://developers.openai.com/codex/plugins/build
       https://github.com/openai/codex/tree/main/codex-rs/hooks/schema/generated

   Compare the hooks page sections titled "Where Codex looks for hooks", "Config shape", "Matcher patterns", "Common input fields", each per-event section from `SessionStart` through `Stop`, and "Schemas". For plugins, compare only the parts that describe bundled hooks, plugin hook feature flags, plugin hook environment variables, and trust. Record in the matrix: URL, checked date, whether the data is release docs or generated schema, and any difference from this plan. If network or browsing is unavailable, use the latest checked facts already embedded in this plan, mark every external-doc claim as "docs snapshot from 2026-05-17, not refreshed", and finish Plan A as at most `docs-backed but runtime-unverified`.

3. Create `docs/plans/feat-0044-cross-agent-portability/codex-capability-matrix.md`. The matrix should have prose sections for:

   - supported release events
   - release-documented events outside the first Clooks adapter MVP
   - common input fields
   - event-specific input fields
   - Codex event -> Clooks event/context policy
   - matcher behavior
   - output fields and exit-code behavior
   - Clooks result mapping implications
   - portable hook author guidance
   - unsupported or hazardous fields
   - evidence metadata: source URLs, checked date, installed Codex CLI version, schema provenance, and docs-backed/runtime-verified/unverified status

4. Create fixture payloads. Preferred paths:

       test/fixtures/codex/events/session-start-startup.json
       test/fixtures/codex/events/pre-tool-use-bash.json
       test/fixtures/codex/events/permission-request-bash.json
       test/fixtures/codex/events/post-tool-use-bash.json
       test/fixtures/codex/events/user-prompt-submit.json
       test/fixtures/codex/events/stop.json

   Each fixture should be valid JSON and should use snake_case field names exactly as Codex sends them. If these fixtures are not suitable for long-term tests, use the durable plan-artifact location instead:

       docs/plans/feat-0044-cross-agent-portability/fixtures/codex/events/

   Do not store the only copy of any fixture under `tmp/`.

5. Create a disposable spike directory:

       tmp/feat-0044-codex-contract/

   Inside it, place scripts and generated sample projects needed to verify Codex hook execution. Because `tmp/` is gitignored, promote any lasting results into the capability matrix and domain docs rather than relying on `tmp/` files for future context.

6. Attempt a non-destructive live Codex hook run. Use a temporary `CODEX_HOME` and temporary project. Do not write to `~/.codex`. A safe pattern is:

       WORKDIR="$(mktemp -d /tmp/clooks-codex-contract.XXXXXX)"
       chmod 700 "$WORKDIR"
       mkdir -p "$WORKDIR/home" "$WORKDIR/codex-home" "$WORKDIR/project"
       cd "$WORKDIR/project"
       git init
       env HOME="$WORKDIR/home" CODEX_HOME="$WORKDIR/codex-home" codex exec --help

   Then create spike files only under `$WORKDIR` or `tmp/feat-0044-codex-contract/`. The harness should create a `.codex/hooks.json` in the temporary project, a hook command script that appends its stdin to a log file, and a tiny prompt that should trigger the target event. The expected successful evidence is a log file containing one JSON object with the event's `hook_event_name`, plus captured Codex stdout/stderr showing how Codex handled the hook's output. If the CLI requires authentication, network, model access, or interactive trust review, stop that spike, record the exact command and message in `Surprises & Discoveries`, and do not accept prompts or mutate real user state.

7. Run formatting and lightweight validation for any committed JSON or Markdown:

       bunx prettier --check docs/plans/feat-0044-cross-agent-portability/PLAN-FEAT-0044A-codex-runtime-contract-verification.md docs/plans/feat-0044-cross-agent-portability/codex-capability-matrix.md docs/domain/cross-agent-hooks.md
       bunx prettier --check 'test/fixtures/codex/events/*.json'
       bun run typecheck

   If plan fixtures live under `docs/plans/feat-0044-cross-agent-portability/fixtures/codex/events/` instead, point the JSON Prettier command there. If a glob has no matches, skip that exact command and record why. Do not rely on `bun run format:check` for these files; the current package script does not check nested docs or fixture JSON.

8. If stable fixtures are added under `test/fixtures/codex/events/`, add a small unit test that loads them and asserts they parse as JSON objects with `hook_event_name`. This makes the fixtures visible to CI without implementing the Codex adapter yet. A suitable new test file is `src/codex-fixtures.test.ts` or `src/agents/codex/fixtures.test.ts` if that folder is introduced as test-only.

   Plan A must not add production `src/` modules. If implementing the fixture validation test requires helper code, keep it inside the test file. If any production code becomes necessary, stop and move that work to Plan B or Plan D, including unit and E2E acceptance with `bun run test:e2e`.

9. Run the fast unit suite:

       bun run test

   Current known baseline before this plan: `bun run test` has one existing failure in `src/commands/init.test.ts` around the no-git interactive decline guard. If that still fails and no new failures appear, record it as baseline. If new failures appear, fix or document them before completing the plan.

10. Update domain docs and the epic as described in the Plan of Work. Then update `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` in this plan.

11. Review findings. Read `docs/findings/index.md` and the related finding files listed in this plan. If this work resolved a finding, remove it. If it exposed new friction, stale docs, or test gaps, log the finding through the repository's subagent-based process before marking Plan A complete.

## Danger Zone Assessment

Plan A studies permission decisions, trust review, fail-open/fail-closed behavior, and hook output channels. Those areas are dangerous once production code changes because they can affect whether user actions are allowed or blocked. This specific plan is research-only and must not add production adapter, permission, registration, or trust-handling code. Therefore no `ATTENTION.md` is required for Plan A as drafted.

If a future revision of this plan adds production changes under `src/`, changes hook registration behavior, changes permission translation, changes trust handling, or changes fail-closed output behavior, stop immediately, promote or keep the work in this feature subfolder, and create `docs/plans/feat-0044-cross-agent-portability/ATTENTION.md` before continuing. Later implementation plans B, C, and D should assume they may need `ATTENTION.md` because they touch shared engine abstractions and permission/authorization-like behavior.

## Validation and Acceptance

This plan is accepted when a future contributor can answer "what exact Codex hook surface should Clooks implement first?" by reading repository files only.

The concrete acceptance criteria are:

- `docs/plans/feat-0044-cross-agent-portability/codex-capability-matrix.md` exists and covers all ten current release-documented events: `SessionStart`, `SubagentStart`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `UserPromptSubmit`, `SubagentStop`, and `Stop`.
- The matrix explicitly marks all ten current release-documented Codex events as part of the first Clooks adapter MVP, while calling out subagent-specific translation risks.
- The matrix distinguishes supported, ignored, fail-open, fail-closed, and unverified output fields.
- The matrix includes evidence metadata: official docs URL(s), docs checked date, installed `codex --version`, whether generated schemas were consulted, and whether each claim is docs-backed, runtime-verified, or unverified.
- The matrix includes a required `Codex event -> Clooks event/context policy` section that covers matcher fields, nullable `transcript_path`, `turn_id`, raw payload retention, and whether each event can use the existing public `ClooksHook` surface unchanged.
- The matrix includes a `Portable hook author guidance` section that classifies each relevant capability as portable, Claude-only, Codex-only, unsupported, or unverified, and states that Claude plugin-delivered hooks remain Claude-only.
- The matrix states how Clooks should handle at least these Clooks result capabilities under Codex: `allow`, `ask`, `block`, `defer`, `skip`, `injectContext`, `updatedInput`, `updatedPermissions`, `interrupt`, `updatedMCPToolOutput`, and Stop continuation.
- A fixture corpus exists for all ten current release-documented events, either in `test/fixtures/codex/events/` for reuse or in `docs/plans/feat-0044-cross-agent-portability/fixtures/codex/events/` if the team decides fixtures should remain planning artifacts.
- The output-channel cases are covered or explicitly marked untestable: valid JSON with `systemMessage`, stderr with exit 0, stderr with exit 2, another nonzero exit, non-JSON stdout, empty stdout, malformed JSON, unknown top-level JSON fields, and event-specific unsupported fields.
- The safety-critical runtime cases are empirically verified or Plan A ends as `partial/blocking`: `PreToolUse` deny/additionalContext and fail-open unsupported fields, `PermissionRequest` allow/deny and reserved fail-closed fields, `PostToolUse` block/continue behavior, and `Stop` continuation behavior.
- Any live Codex spike results are summarized in the matrix and this plan. Raw temporary files in `tmp/` are not the only record.
- `docs/domain/cross-agent-hooks.md` is updated with the verified Codex capability summary.
- `docs/domain/testing.md` is updated if this plan introduces reusable Codex fixture or live-spike conventions.
- `docs/epics/EPIC-0044-cross-agent-hook-portability.md` is updated so Plan A has a plan file path and downstream plan scopes reflect verified results.
- Relevant findings are reviewed. Any resolved findings are removed, and any new friction discovered by Plan A is logged.
- `bun run typecheck` passes.
- `bun run test` either passes or has only documented pre-existing failures, with the exact failing test named in `Outcomes & Retrospective`.

## Idempotence and Recovery

All live Codex experiments must use disposable `CODEX_HOME`, `HOME`, and project directories under `/tmp` or this repo's `tmp/` directory. Re-running the spike should replace or create new timestamped files in `tmp/feat-0044-codex-contract/` without changing real user settings.

Do not run commands that modify `~/.codex`, `~/.clooks`, or the user's real project trust database. If a command unexpectedly tries to open interactive trust review, stop and record the limitation rather than accepting prompts.

The capability matrix and fixture files are additive. If a fixture turns out to be wrong, edit it in place and record the correction in `Surprises & Discoveries`. If the live spike cannot run because the Codex CLI lacks credentials, network access, or interactive trust, the plan can still complete if the limitation is documented and the docs-backed matrix is explicit about which claims are unverified.

## Artifacts and Notes

Baseline observations captured while drafting this plan:

    codex --version
    WARNING: proceeding, even though we could not update PATH: Read-only file system (os error 30)
    codex-cli 0.130.0

    gh api user --jq '.login'
    error connecting to api.github.com
    check your internet connection or https://githubstatus.com

Known pre-plan test baseline from repository orientation:

    bun run test
    1311 pass
    1 fail
    failing test: src/commands/init.test.ts
    test name: clooks init > guardrail: no-git with interactive confirm decline aborts

Historical official Codex docs facts embedded in this plan and verified on 2026-05-17. These were superseded by the 2026-05-23 refresh below where they differ:

- Codex hooks are enabled by default and can be disabled with `[features].hooks = false`.
- Codex looks for `hooks.json` or inline `[hooks]` tables next to active config layers.
- Useful hook locations are `~/.codex/hooks.json`, `~/.codex/config.toml`, `<repo>/.codex/hooks.json`, and `<repo>/.codex/config.toml`.
- Project-local hooks load only when the project `.codex/` layer is trusted.
- Non-managed command hooks must be reviewed/trusted before they run.
- Plugin hooks are off by default unless `[features].plugin_hooks = true`.
- `PreToolUse`, `PermissionRequest`, `PostToolUse`, `UserPromptSubmit`, and `Stop` run at turn scope and include `turn_id`.
- `transcript_path` is `string | null`.
- On 2026-05-17, `PreToolUse` `permissionDecision: "ask"`, legacy `decision: "approve"`, `updatedInput`, `continue: false`, `stopReason`, and `suppressOutput` were documented as parsed but unsupported and fail open. The 2026-05-23 refresh superseded this for `updatedInput`: it is now docs-backed as supported only with `permissionDecision: "allow"` for Bash, `apply_patch`, and MCP tools.
- `PermissionRequest.updatedInput`, `PermissionRequest.updatedPermissions`, and `PermissionRequest.interrupt` are reserved and fail closed today.
- `PostToolUse.updatedMCPToolOutput` and `PostToolUse.suppressOutput` are parsed but unsupported and fail open.
- `Stop.decision: "block"` means continue the turn; `continue: false` takes precedence over continuation decisions from other matching Stop hooks.

Updated Plan A artifacts from execution on 2026-05-23/24 UTC:

    codex --version
    WARNING: proceeding, even though we could not update PATH: Read-only file system (os error 30)
    codex-cli 0.133.0

    bun --version
    1.3.10

    codex features list
    hooks          stable  true
    plugin_hooks   stable  true

    bash tmp/feat-0044-codex-contract/run-live-codex-spike.sh
    exit_status=1
    hook_log_lines=0
    failed to connect to websocket: HTTP error: 401 Unauthorized

    bun test src/codex-fixtures.test.ts
    1 pass
    0 fail

    bun run test
    1312 pass
    1 fail
    failing test: src/commands/init.test.ts
    test name: clooks init > guardrail: no-git with interactive confirm decline aborts

Current official Codex docs facts verified on 2026-05-23 UTC:

- Codex release docs now list ten events: `SessionStart`, `SubagentStart`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `UserPromptSubmit`, `SubagentStop`, and `Stop`.
- `PreToolUse.updatedInput` is supported only with `permissionDecision: "allow"` for Bash, `apply_patch`, and MCP tools.
- `PreToolUse.permissionDecision: "ask"` remains parsed but unsupported and fail-open.
- `PermissionRequest.updatedInput`, `PermissionRequest.updatedPermissions`, and `PermissionRequest.interrupt` remain reserved and fail-closed.
- `PostToolUse.updatedMCPToolOutput` and `PostToolUse.suppressOutput` remain parsed but unsupported and fail-open.
- `SubagentStart` and `SubagentStop` are release-documented Codex events, but they are outside the first Clooks MVP because the current Clooks public event surface does not have equivalent subagent contexts.

## Interfaces and Dependencies

This plan should not introduce production interfaces. It should introduce research and fixture artifacts with stable names that later plans can consume.

The capability matrix artifact should live at:

    docs/plans/feat-0044-cross-agent-portability/codex-capability-matrix.md

If stable fixtures are committed, they should live at:

    test/fixtures/codex/events/

Each fixture must be one JSON object with a `hook_event_name` string. Use Codex wire names, not Clooks camelCase names. A minimal `PreToolUse` Bash fixture should look like this, adjusted if runtime verification shows different required fields:

    {
      "session_id": "session-123",
      "transcript_path": null,
      "cwd": "/tmp/project",
      "hook_event_name": "PreToolUse",
      "model": "gpt-5.4",
      "permission_mode": "default",
      "turn_id": "turn-123",
      "tool_name": "Bash",
      "tool_use_id": "tool-123",
      "tool_input": {
        "command": "npm test"
      }
    }

If a fixture validation test is added, it should assert only stable properties:

    - the file parses as JSON
    - the parsed value is an object and not an array
    - `hook_event_name` is one of the ten current release-documented Codex events

Do not add production `src/agents/codex/*` modules in this plan unless they are test-only placeholders and the plan is updated first. Production adapter modules belong to Plan B and Plan D.

## Instruction Prompts

- **2026-09-07** (Joe-Degler):

  > When using clooks, you should assume you can trust the repo. We can tighten permission models down the line. This is not a discussion for now.

- **2026-09-07** (Joe-Degler):

  > Alright. Get yourself a lay of the land. You're a much smarter model now, so you should scrutinize the design decisions we've done so far and we should make a plan to continue the line of work.

- **2026-05-17** (Joe Degler):

  > "Start writing the plan for the first PLAN of this EPIC.
  > Adhere to all the best-practices in our process.
  > Remember to check out the spike, research and its results if necessary.
  > Ask me questions if there ambiguities, but try resolving them yourself first.
  > If something needs research, spin off a research subagent.
  > Occasionally fire off an Code-Review, Feature-Review and Product Review Expert subagent to review the current state of the plan vs the feature and epic file and catch issues and spec-drift early.
  > Make sure that any updates regarding domain knowledge etc. are considered.
  > IMPORTANT: At the end, start a subagent who will WITHOUT LOOKING UP ANYTHING ELSE give me a summary of all documentation that will be adjusted in the plan file. That is, all the domain updates and readme  updates."

- **2026-05-24** (Joe Degler):

  > "Continue EPIC-0044 Plan A execution for Clooks.
  >
  > Read and follow:
  > - docs/plans/PLANS.md
  > - docs/epics/EPIC-0044-cross-agent-hook-portability.md
  > - docs/plans/feat-0044-cross-agent-portability/PLAN-FEAT-0044A-codex-runtime-contract-verification.md
  > - docs/domain/cross-agent-hooks.md
  > - docs/domain/testing.md
  > - docs/findings/index.md plus relevant finding files
  >
  > Goal:
  > Execute Plan A, not implementation plans B/C/D. Produce the Codex runtime contract evidence needed to decide whether the Codex adapter MVP is implementable.
  >
  > Scope:
  > - Create/update `docs/plans/feat-0044-cross-agent-portability/codex-capability-matrix.md`.
  > - Create durable Codex event fixtures under either `test/fixtures/codex/events/` or `docs/plans/feat-0044-cross-agent-portability/fixtures/codex/events/`, per the plan.
  > - Use only disposable `HOME`, `CODEX_HOME`, and project dirs for live Codex spikes. Do not mutate real `~/.codex`, `~/.clooks`, or trust state.
  > - Attempt live Codex hook verification where feasible, but stop and document if blocked by auth, trust UI, network, or model access.
  > - Classify the Plan A outcome as `implementable MVP`, `docs-backed but runtime-unverified`, or `blocked`.
  > - Update `docs/domain/cross-agent-hooks.md` with verified/docs-backed/unsupported/unverified Codex capability classifications.
  > - Update `docs/domain/testing.md`, `docs/domain/bash-entrypoint.md`, or `docs/domain/cli-architecture.md` only if Plan A discovers conventions those docs must carry.
  > - Update EPIC-0044 with the Plan A result and downstream scope changes.
  > - Review findings at completion and remove resolved findings or log new ones through the repo process.
  >
  > Important constraints:
  > - Do not add production `src/` modules in Plan A.
  > - If production code becomes necessary, stop and move it to Plan B/D.
  > - Do not add README user-facing Codex support claims in Plan A.
  > - If touching permission/translation/registration production code, stop and create/update ATTENTION.md first, but Plan A should remain research/docs/fixtures only.
  > - New plan/epic files may be gitignored in this repo; check ignore status and mention force-add needs.
  > - There is an unrelated existing modification in `schemas/clooks.schema.json`; do not revert it.
  >
  > Before final response:
  > - Run appropriate validation from the plan.
  > - Start a documentation-summary subagent that does not look anything up and summarizes all documentation updates made/required by Plan A."

- **2026-05-25** (Joe Degler):

  > "No we should add PreCompact annd Postcompact"

- **2026-05-25** (Joe Degler):

  > "I mean the Subagent ones."

## Revision Notes

- 2026-09-07: User resolved the repository trust assumption. Removed the proposed permission-model gate from continuation scope; existing merge semantics and required regression/E2E/smoke coverage remain.
- 2026-09-07: Added a bounded research and continuation-planning pass after the long pause. Historical execution results remain dated evidence, not claims about the current Codex release. No production implementation is authorized by this revision.
- 2026-05-17: Initial Plan A draft created from EPIC-0044, FEAT-0044, Codex research, verifier report, current official Codex docs, local CLI help, relevant domain docs, and findings.
- 2026-05-24: Executed Plan A. Updated the release event model from six to ten Codex events, added a docs-backed capability matrix, durable fixtures, fixture validation, a disposable live spike harness, domain-doc updates, and EPIC-0044 downstream gates.
- 2026-05-25: Revised the downstream MVP scope to include Codex `PreCompact` and `PostCompact` because they mirror existing Clooks events. This was later expanded the same day to include subagent events too.
- 2026-05-25: Revised the downstream MVP scope again to include Codex `SubagentStart` and `SubagentStop` after confirming README already documents matching Clooks events.
