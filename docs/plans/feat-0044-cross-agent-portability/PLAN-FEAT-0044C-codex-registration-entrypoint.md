# Add Codex Registration and Entrypoint Commands

This ExecPlan is a living document. The sections `Product Context`, `Progress`, `Surprises & Discoveries`, `Decision Log`, `Outcomes & Retrospective`, and `Related Domain Knowledge Documents` must be kept up to date as work proceeds.

This plan must be maintained according to `docs/plans/PLANS.md`. The reader should assume no prior context beyond this repository and this plan.

**Originating Feature:** [`FEAT-0044: Cross-Agent Hook Portability`](../../planned/FEAT-0044-cross-agent-hooks.md)

**Coordinating Epic:** [`EPIC-0044: Cross-Agent Hook Portability -- Codex Adapter`](../../epics/EPIC-0044-cross-agent-hook-portability.md)

**Previous Plans:** [`PLAN-FEAT-0044A: Verify the Codex Hook Runtime Contract`](./PLAN-FEAT-0044A-codex-runtime-contract-verification.md), [`PLAN-FEAT-0044B: Introduce the Agent Adapter Boundary`](./PLAN-FEAT-0044B-agent-adapter-boundary.md)

## Purpose / Big Picture

After this change, Clooks can generate Codex hook registration files in addition to the existing Claude Code settings registration. A user will be able to run `clooks init --agent codex` in a project and see `.codex/hooks.json` updated with one Clooks command hook for each Codex-supported event. The generated project Codex commands will call the existing `.clooks/bin/entrypoint.sh` with an explicit `CLOOKS_AGENT=codex` marker and, if the final command-shape verification supports it, `CLOOKS_PROJECT_ROOT=/absolute/project/path` so the binary does not guess the upstream agent from the input payload.

This plan does not make Codex hook execution successful end to end by itself. Plan B deliberately left `CLOOKS_AGENT=codex` as a fail-closed runtime placeholder, and Plan D owns Codex payload normalization and Codex JSON output translation. The demonstrable result of this plan is correct, idempotent registration and unregistration behavior. Because the feature will be shipped as one functioning cross-agent feature, Plan C must not add user-facing CLI warnings that say Codex runtime execution is not implemented yet.

## Product Context

**Problem we are solving:** FEAT-0044 wants Clooks to become a general-purpose hook framework across Claude Code and Codex. Plan B made the runtime capable of selecting an agent adapter, but there is still no way for `clooks init` to register Clooks with Codex. Without registration, the future Codex adapter cannot be exercised from Codex's hook system.

**Metrics this may affect:** This is a delivery-enablement change. It should reduce implementation risk for the Codex adapter, make local verification easier, and preserve Claude Code onboarding behavior. It should not claim user-ready Codex support yet.

**Feature alignment:** The feature's intended user journey is `clooks init --agent <name>` registering the same custom or vendored Clooks hooks for multiple agents. This plan implements the registration half of that journey for Codex while explicitly preserving the existing `clooks init` default for Claude Code. The plan intentionally does not change hook author APIs, plugin distribution, or Codex translation semantics.

## Progress

- [x] (2026-05-25, Joe Degler) Read `docs/plans/PLANS.md`, the coordinating epic, Plan A, Plan B, the Codex capability matrix, relevant domain docs, relevant findings, and current init/uninstall/settings code before writing this plan.
- [x] (2026-05-25, Joe Degler) Attempted `gh api user --jq '.login'`; it failed because the sandbox cannot reach GitHub. Used local git identity `Joe Degler`, matching prior EPIC-0044 plan authorship, and recorded the process deviation in this plan.
- [x] (2026-05-25, Joe Degler) Created this Plan C ExecPlan as planning-only work. No production `src/` code has been changed.
- [x] (2026-05-26, Joe Degler) Incorporated plan review feedback: removed global `CLOOKS_PROJECT_ROOT`, added a command-shape verification milestone, recorded absolute-path portability tradeoffs, made Codex Clooks-hook detection explicitly substring-based, and removed planned CLI runtime-warning output.
- [x] (2026-05-26, Codex) Implemented Milestone 1: verified local command-shape evidence from Plan A artifacts, added isolated Codex registration helpers under `src/agents/codex/settings.ts`, added focused unit tests, and validated the new registrar alongside existing Claude settings tests.
- [x] (2026-05-26, Codex) Fixed Milestone 1 review blocker: `registerCodexClooks()` now converges stale, duplicate, and mixed Clooks-owned Codex registrations to exactly one canonical managed matcher group per event while preserving unrelated user hooks.
- [x] (2026-05-26, Codex) Implemented Milestone 2: extended `clooks init` with `--agent claude-code|codex|all`, preserved the omitted-agent Claude default, wired project/global Codex registration through the Milestone 1 command builders, added additive JSON `agent`/`agents` fields, and covered the new behavior in `src/commands/init.test.ts`.
- [x] (2026-05-26, Codex) Fixed Milestone 2 review blocker: made global entrypoint dedup agent-aware so Codex-only global init does not suppress project Claude hooks, kept the legacy Claude global flag for default behavior, and added targeted regression and human-output tests.
- [x] (2026-05-26, Codex) Implemented Milestone 3: extended `clooks uninstall` with `--agent claude-code|codex|all`, preserved omitted-agent Claude behavior, removed Clooks-owned Codex hook entries while preserving unrelated Codex hooks, reported separate Claude/Codex JSON counts, and removed selected global agent dedup flags during global unhook/full flows.
- [x] (2026-05-26, Codex) Fixed Milestone 3 review blockers: `--full` now unhooks all known agent registrations before deleting shared `.clooks/`, selected-agent `--unhook` no-ops print a clear unchanged message, and regression coverage now covers default/explicit Claude isolation, all-agent JSON counts, and human separate-count output.
- [x] (2026-05-26, Codex) Implemented Milestone 4: added focused compiled-binary Docker E2E coverage for project/global Codex registration, idempotency, all-agent init, and Codex-only unhook preservation behavior.
- [x] (2026-05-26, Codex) Implemented Milestone 5: updated affected domain docs, reviewed findings, updated the coordinating epic, recorded final outcomes/validation, and closed the plan.
- [x] (2026-05-26, Codex) Implemented review follow-up fixes: human `--full` output now explains agent-scope widening when deleting a shared entrypoint removes another agent registration, uninstall success lines no longer claim `0 events` removed for unregistered agents, and Plan C/domain docs explicitly record the legacy Claude JSON alias behavior.

## Surprises & Discoveries

- Observation: The epic listed Plan C as depending only on Plan A, but the intended generated command depends on Plan B's `CLOOKS_AGENT` selector.
  Evidence: Plan B implemented `CLOOKS_AGENT=codex` as an explicit adapter selection marker and documented that Codex registration must set it. This plan therefore depends on both Plan A and Plan B.

- Observation: Current `clooks init` has no agent option and always registers Claude Code hooks.
  Evidence: `src/commands/init.ts` calls `registerClooks(join(projectRoot, '.claude'), CLOOKS_ENTRYPOINT_PATH)` for projects and `registerClooks(join(homeRoot, '.claude'), globalEntrypointCommand)` for global init. `createInitCommand()` only exposes `--global`.

- Observation: Current `clooks uninstall` only knows whether Clooks is registered in `.claude/settings.json`.
  Evidence: `src/commands/uninstall.ts` imports `unregisterClooks` and `isClooksRegistered` from `src/settings.ts`, checks `.claude`, and never checks `.codex/hooks.json`.

- Observation: `CLOOKS_PROJECT_ROOT` already exists and has tests.
  Evidence: `src/config/discovery.ts` reads `env['CLOOKS_PROJECT_ROOT']`, `docs/domain/bash-entrypoint.md` documents it, and `test/e2e/config-discovery-from-subdir.e2e.test.ts` covers explicit-root behavior.

- Observation: There is an unrelated dirty file in the working tree.
  Evidence: `git status --short` reports ` M schemas/clooks.schema.json`. This plan must not revert or include that change.

- Observation: `CLOOKS_PROJECT_ROOT` is an unconditional project-root override and is wrong for global Codex registration.
  Evidence: `src/config/discovery.ts` returns `CLOOKS_PROJECT_ROOT` before cwd walk-up. If a global Codex hook command sets `CLOOKS_PROJECT_ROOT=$HOME`, every global hook invocation resolves the project root to the home directory and cannot discover the current repository's `.clooks/clooks.yml`.

- Observation: The planned inline environment-variable command form is a shell feature and must be verified for Codex registration before implementation locks it in.
  Evidence: The command `CLOOKS_AGENT=codex CLOOKS_PROJECT_ROOT='/abs/repo' '/abs/repo/.clooks/bin/entrypoint.sh'` only works if Codex executes hook commands through a shell, such as `/bin/sh -c <command>`. If Codex directly execs argv without a shell, `CLOOKS_AGENT=codex` would be interpreted as the executable name.

- Observation: Local Plan A artifacts support the `hooks.json` command-hook shape but do not runtime-verify command execution because live Codex hook firing was blocked by authentication.
  Evidence: `docs/plans/feat-0044-cross-agent-portability/codex-capability-matrix.md` says Codex discovers hooks from `hooks.json`, every command hook receives JSON on stdin, and multiple matching command hooks launch concurrently. It also records that the live spike used a disposable project `.codex/hooks.json` with inline command strings but captured no hook payloads because the disposable Codex run could not authenticate.

- Observation: No local evidence showed a Codex project-directory environment variable equivalent to Claude's `$CLAUDE_PROJECT_DIR`.
  Evidence: Plan A's matrix records `cwd` as an input payload field and plugin-specific `PLUGIN_ROOT` / `PLUGIN_DATA` variables, but it does not identify a command-time Codex project root variable. The project command therefore uses an absolute entrypoint path plus `CLOOKS_PROJECT_ROOT=<absolute project root>`.

- Observation: `statusMessage` appeared in the disposable Plan A spike shape but was not verified as supported release behavior.
  Evidence: `tmp/feat-0044-codex-contract/run-live-codex-spike.sh` included `statusMessage` fields in generated sample hooks, but the spike did not fire hooks. Milestone 1 therefore omits `statusMessage` from generated Clooks-owned Codex hooks.

- Observation: The current workspace still contains dirty files not owned by Milestone 1.
  Evidence: `git status --short` showed `M docs/epics/EPIC-0044-cross-agent-hook-portability.md` and `M schemas/clooks.schema.json` before implementation. Milestone 1 did not edit those files.

- Observation: The first Milestone 1 implementation updated only the first Clooks-owned matcher group and first Clooks hook for an event, so stale duplicate groups could still fire.
  Evidence: Code review found that narrower matchers, duplicate Clooks hooks in a group, or multiple Clooks-owned groups for one event were not converged to the intended one-managed-registration invariant. `src/agents/codex/settings.test.ts` now covers duplicate hooks/groups and mixed Clooks-plus-unrelated groups.

- Observation: Existing Claude settings behavior treats empty files as empty settings, but Codex needed an explicit policy for syntactically valid JSON with invalid shape.
  Evidence: New tests pin that root `null` or root array are treated as an empty Codex hooks file on registration, and an object with `hooks` as an array preserves other top-level fields while replacing `hooks` with the generated object.

- Observation: The local test sandbox has a synthetic `/tmp/.git`, so no-git guard tests that create temporary directories under `os.tmpdir()` do not exercise the no-git path.
  Evidence: `bun test src/commands/init.test.ts` initially showed the no-git interactive-decline test creating `.clooks/` instead of prompting, and `ls -ld /tmp/.git` confirmed the parent `.git` directory. The test now uses `/dev/shm` for that specific no-git fixture.

- Observation: The existing `.global-entrypoint-active` dedup flag was global to Clooks, not scoped to an upstream agent.
  Evidence: The generated project entrypoint exited when `$HOME/.clooks/.global-entrypoint-active` existed, regardless of `CLOOKS_AGENT`. A Codex-only global init created that flag before the review fix, but did not register `~/.claude/settings.json`, so project Claude hooks could exit before invoking the binary with no global Claude hook to replace them.

- Observation: `clooks uninstall` JSON callers historically read `eventsRemoved` and `nonClooksPreserved` as Claude Code settings values.
  Evidence: Existing `src/commands/uninstall.test.ts` assertions expected `eventsRemoved` to contain the 22 Claude Code events for default project/global uninstalls. Milestone 3 kept those keys Claude-compatible and added `claudeEventsRemoved`, `codexEventsRemoved`, `claudeNonClooksPreserved`, and `codexNonClooksPreserved` for agent-aware output.

- Observation: Agent-scoped `--full` cannot safely preserve other agent registrations because `.clooks/` is shared.
  Evidence: A project `clooks uninstall --project --agent codex --full --force` that removed only `.codex/hooks.json` but preserved `.claude/settings.json` would leave Claude Code pointing at a deleted `.clooks/bin/entrypoint.sh`. The same dangling-reference risk exists globally for `~/.clooks/bin/entrypoint.sh`.

## Decision Log

- Decision: Plan C depends on both Plan A and Plan B.
  Rationale: Plan A established the ten-event Codex hook registration target and the docs-backed/runtime-unverified status. Plan B introduced the `CLOOKS_AGENT` adapter selector that generated Codex commands must set. Implementing Plan C without Plan B would force payload sniffing or a different marker mechanism.
  Date/Author: 2026-05-25 / Joe Degler.

- Decision: Keep `clooks init` default behavior as Claude Code registration only.
  Rationale: Existing users run `clooks init` expecting `.clooks/` setup plus `.claude/settings.json` registration. Changing the default to Codex or all agents would create non-working Codex hooks before Plan D and would be a backward-compatibility break.
  Date/Author: 2026-05-25 / Joe Degler.

- Decision: Add explicit agent selection with `--agent claude-code`, `--agent codex`, and `--agent all`, with the default equivalent to `--agent claude-code`.
  Rationale: Plan B already uses `claude-code` and `codex` as internal agent ids. `--agent all` is useful for users who intentionally want both registrations. The default remains conservative.
  Date/Author: 2026-05-25 / Joe Degler.

- Decision: Generate Codex `hooks.json` files, not inline `config.toml` tables.
  Rationale: Plan A and Plan B recorded that Codex supports `hooks.json` and inline TOML, but generated JSON is easier to own idempotently without parsing and merging unrelated TOML config.
  Date/Author: 2026-05-25 / Joe Degler.

- Decision: Register one Clooks command matcher per Codex event, not one Codex command per Clooks hook.
  Rationale: Codex launches multiple matching command hooks concurrently. Clooks must preserve its own ordering, lifecycle, matching, timeout, circuit-breaker, and multi-hook reduction semantics internally.
  Date/Author: 2026-05-25 / Joe Degler.

- Decision: Use `"*"` as the Codex matcher for every generated event in the first implementation.
  Rationale: Clooks already performs per-hook matching and ordering after it receives an event. Using broad Codex matchers avoids scattering Clooks config semantics into Codex registration. If Plan D later proves an event needs narrower Codex matchers for safety or performance, that deviation must be recorded before implementation.
  Date/Author: 2026-05-25 / Joe Degler.

- Decision: Generated project Codex commands should set `CLOOKS_AGENT=codex` and may set `CLOOKS_PROJECT_ROOT=<absolute project root>` inline before the entrypoint path after command-shape verification.
  Rationale: Plan B forbids payload sniffing. For project-local `.codex/hooks.json`, an explicit project root can prevent Codex cwd changes from detaching Clooks from the intended repository. The exact use of inline env vars depends on verifying that Codex treats hook `command` strings as shell commands. If verification cannot establish shell handling, implementation must choose a command shape that Codex definitely supports and record the deviation here before proceeding.
  Date/Author: 2026-05-25 / Joe Degler.

- Decision: Project Codex registration should use an absolute project entrypoint path, not `$CLAUDE_PROJECT_DIR`.
  Rationale: `$CLAUDE_PROJECT_DIR` is Claude-specific and will not be present under Codex. An absolute entrypoint path plus a project-local root marker is deterministic if Milestone 1 cannot find a portable Codex project path mechanism.
  Date/Author: 2026-05-25 / Joe Degler.

- Decision: Global Codex registration must not set `CLOOKS_PROJECT_ROOT`.
  Rationale: Global hooks should merge global Clooks config with the current project config when a project has `.clooks/clooks.yml`. Setting `CLOOKS_PROJECT_ROOT` to the home directory would short-circuit discovery and make global hooks ignore the repository where Codex is running. The global command should set only `CLOOKS_AGENT=codex` and call the absolute `~/.clooks/bin/entrypoint.sh`, letting existing root discovery walk from Codex's cwd.
  Date/Author: 2026-05-26 / Joe Degler.

- Decision: Plan C may add registration CLI without a user-facing "Codex runtime not implemented" warning.
  Rationale: The user confirmed the feature will ship as one functioning cross-agent feature, so intermediate plan output should not warn end users about implementation staging. Internal plan and domain docs may continue to describe the staging boundary, but CLI output should focus on registration results and Codex trust/review requirements.
  Date/Author: 2026-05-26 / Joe Degler.

- Decision: Treat absolute project paths in `.codex/hooks.json` as an explicit first-MVP tradeoff unless command-shape verification finds a portable Codex project-root variable or reliable relative command form.
  Rationale: `.codex/hooks.json` can be committed, and an absolute project entrypoint path will be wrong after cloning to a different directory. Claude avoids this with `$CLAUDE_PROJECT_DIR`, but that variable is not portable to Codex. Plan C must verify whether Codex runs hooks from the repository root or exposes a Codex project-directory variable that would allow portable commands. If not, CLI output or docs should state that re-running `clooks init --agent codex` refreshes machine-local paths.
  Date/Author: 2026-05-26 / Joe Degler.

- Decision: `clooks uninstall --unhook` and `--full` should remove registrations for the selected agent scope, and default uninstall behavior should continue to cover Claude Code unless an explicit agent selector is passed.
  Rationale: Users need a safe way to undo generated Codex hook files. Preserving the existing default avoids surprising current Claude Code users. Codex unhooking should preserve unrelated user Codex hooks.
  Date/Author: 2026-05-25 / Joe Degler.

- Decision: `clooks uninstall --full` unhooks all known Clooks agent registrations in the selected project/global scope before deleting the shared `.clooks/` directory, regardless of `--agent`.
  Rationale: `.clooks/` contains the entrypoint used by every agent registration in that scope. Deleting it while preserving another Clooks-owned registration creates a broken hook command. Selected-agent behavior remains scoped for `--unhook`, where `.clooks/` is preserved and no dangling entrypoint is created.
  Date/Author: 2026-05-26 / Codex.

- Decision: Keep the Milestone 1 Codex command representation as inline POSIX shell assignments plus a quoted absolute entrypoint path.
  Rationale: Local release-contract artifacts describe Codex command hooks as command strings and the Plan A spike used inline environment assignments in `.codex/hooks.json`; no local evidence contradicted shell command handling. This remains docs-backed and runtime-unverified, so the implementation uses a small single-quote helper and focused tests for paths with spaces and single quotes.
  Date/Author: 2026-05-26 / Codex.

- Decision: Omit `statusMessage` from Milestone 1 generated Codex hook entries.
  Rationale: The plan only allowed `statusMessage` if support was verified. Local evidence showed it in an attempted spike file, but not in captured runtime behavior or the local release-contract matrix.
  Date/Author: 2026-05-26 / Codex.

- Decision: Codex unregistration removes Clooks-owned command hook entries inside a matcher group and preserves unrelated hooks even when they share the same matcher group.
  Rationale: This is more conservative than deleting an entire matcher group whenever it contains a Clooks hook. It satisfies the plan's preservation requirement and prevents accidental deletion of user hooks in mixed groups.
  Date/Author: 2026-05-26 / Codex.

- Decision: Codex registration convergence operates at the managed-event level.
  Rationale: For each managed event, registration first strips all Clooks-owned hooks from every matcher group, preserves unrelated hooks/groups, drops emptied Clooks-only groups, and appends one canonical `{ matcher: "*", hooks: [{ type: "command", command }] }` Clooks group. This prevents duplicate execution after stale or partial registrations while keeping user hooks intact.
  Date/Author: 2026-05-26 / Codex.

- Decision: For valid JSON with an invalid Codex hooks-file shape, registration treats non-object roots and non-object `hooks` values as empty generated state instead of throwing.
  Rationale: The file is syntactically valid and recoverable by regeneration. Throwing remains reserved for malformed JSON, where overwriting could destroy user intent. Top-level fields are preserved when the root is an object.
  Date/Author: 2026-05-26 / Codex.

- Decision: Milestone 2 JSON output adds `agent` for the requested selector and `agents` for the expanded concrete registrations while leaving the existing `created`, `skipped`, `updated`, and `global` fields intact.
  Rationale: Existing callers can continue reading the original fields, while new callers can distinguish omitted/default Claude registration, explicit `codex`, and expanded `all` behavior without parsing human-readable item strings.
  Date/Author: 2026-05-26 / Codex.

- Decision: Milestone 3 JSON output keeps legacy `eventsRemoved` and `nonClooksPreserved` mapped to Claude Code results and adds separate Claude/Codex fields.
  Rationale: This preserves existing default uninstall consumers while making explicit `--agent codex` and `--agent all` output unambiguous. For Codex-only uninstall, `eventsRemoved` remains an empty Claude-compatible array and `codexEventsRemoved` carries the ten Codex events.
  Date/Author: 2026-05-26 / Codex.

- Decision: Keep `eventsRemoved` and `nonClooksPreserved` as Claude Code compatibility aliases after review follow-up instead of changing them to active-agent aliases.
  Rationale: Existing JSON callers that omit `--agent` or expect Claude Code uninstall counts can keep reading the legacy fields without branching on Plan C's new agent selector. New agent-aware callers have explicit `claudeEventsRemoved`, `codexEventsRemoved`, `claudeNonClooksPreserved`, and `codexNonClooksPreserved` fields. Changing the legacy keys to mean "selected active agent" would make `--agent codex` easier to read in isolation but would create selector-dependent semantics for fields that were historically Claude-shaped.
  Date/Author: 2026-05-26 / Codex.

- Decision: Human uninstall output should only print per-agent "Removed ..." success lines when that agent actually removed Clooks event registrations.
  Rationale: Full uninstall can act on all known agents even when only one agent is registered, and global unhook can remove only an agent-specific dedup flag. Printing `Removed ... (0 events)` in those paths is technically explainable but misleading, so human output now reports only non-zero per-agent removals while still reporting flag removal and directory deletion separately.
  Date/Author: 2026-05-26 / Codex.

- Decision: Global `--unhook` removes only the dedup flag files for the selected agents, while global `--full` removes all known agent dedup flags before deleting shared `~/.clooks/`.
  Rationale: Milestone 2 made global dedup agent-scoped. Removing a Codex global registration with `--unhook` should remove `~/.clooks/.global-entrypoint-active.codex` without deleting the legacy Claude flag, and `--agent all` should remove both selected flags. Full uninstall deletes the shared directory, so it must first clear every known registration and flag that points at that entrypoint.
  Date/Author: 2026-05-26 / Codex.

- Decision: Keep the legacy Claude global flag path as `~/.clooks/.global-entrypoint-active` and use `~/.clooks/.global-entrypoint-active.codex` for Codex global registration.
  Rationale: Omitted and explicit Claude global init must preserve existing project-entrypoint dedup behavior. Codex project commands already set `CLOOKS_AGENT=codex`, so the project entrypoint can check an agent-specific Codex flag without letting Codex-only global init suppress Claude project registrations.
  Date/Author: 2026-05-26 / Codex.

- Decision: Leave the existing findings in place after Plan C completion.
  Rationale: Plan C added focused Codex registration coverage and avoided live Codex CLI dependence, but it did not solve the general reusable new-event harness gap, the README event-table gap, or disposable Codex live-spike auth/tooling friction. No finding was fully resolved by Milestone 5.
  Date/Author: 2026-05-26 / Codex.

- Decision: Use local git identity after recording the `gh api user` failure instead of pausing this plan draft for a handle.
  Rationale: `docs/plans/PLANS.md` says to ask when `gh` fails. In this continuation, prior EPIC-0044 plans already used local identity `Joe Degler` after the same network failure, and `git config user.name` returns `Joe Degler`. This is a literal process deviation, recorded here so future contributors can audit it.
  Date/Author: 2026-05-25 / Joe Degler.

## Outcomes & Retrospective

Milestone 1 completed on 2026-05-26. The implemented registrar writes `.codex/hooks.json` with a top-level `hooks` object, exactly ten managed Codex event keys, a `matcher: "*"` group per event, and one command hook per managed event. Project commands set `CLOOKS_AGENT=codex`, `CLOOKS_PROJECT_ROOT=<absolute project root>`, and an absolute project `.clooks/bin/entrypoint.sh`. Global commands set only `CLOOKS_AGENT=codex` and an absolute `~/.clooks/bin/entrypoint.sh`.

Validation for Milestone 1: `bun test src/agents/codex/settings.test.ts src/settings.test.ts` passed with 42 tests and 327 assertions after the convergence fix. `bun run typecheck` passed after tightening strict TypeScript types in the new files.

Milestone 4 completed on 2026-05-26. The new E2E coverage invokes the compiled binary through the Docker sandbox and inspects generated `.clooks/bin/entrypoint.sh`, `.codex/hooks.json`, `.claude/settings.json`, and global entrypoint flag files without invoking live Codex.

Validation for Milestone 4: `bun run test:e2e:run -- test/e2e/codex-registration.e2e.test.ts` passed with 5 tests and 145 assertions.

Milestone 5 completed on 2026-05-26. Domain docs now describe `clooks init --agent ...` and `clooks uninstall --agent ...`, Codex command shapes, `CLOOKS_AGENT`/`CLOOKS_PROJECT_ROOT` behavior, agent-aware global dedup flags, implemented Codex registration with runtime-placeholder status, and the registration E2E pattern. The coordinating epic now marks Plan C complete and keeps Plan D/E runtime responsibilities explicit.

Review follow-up completed on 2026-05-26. Human `clooks uninstall --full --agent <non-all>` output now prints a concise info note when deleting the shared `.clooks/` or `~/.clooks/` entrypoint directory requires removing another agent's Clooks registration too. The note is suppressed for `--agent all` and for cases where no other agent registration is being widened into the action. Human success lines now avoid misleading `Removed ... (0 events)` messages for unregistered agents or flag-only global cleanup paths.

The review follow-up also re-evaluated the JSON alias behavior. The final outcome keeps `eventsRemoved` and `nonClooksPreserved` as Claude Code compatibility aliases; callers that need Codex counts must use `codexEventsRemoved` and `codexNonClooksPreserved`. This behavior is now recorded in `docs/domain/cli-architecture.md`.

Findings review for Milestone 5: no findings were removed. `docs/findings/test-gaps.md` still tracks the broader reusable new-event harness gap, `docs/findings/stale-docs.md` still tracks README event-table drift unrelated to Plan C, and `docs/findings/tooling-friction.md` still tracks live Codex spike friction that Plan C avoided but did not fix.

Validation for Milestone 5:
- `bun run typecheck` passed.
- `bun test src/commands/uninstall.test.ts src/commands/init.test.ts src/agents/codex/settings.test.ts src/settings.test.ts` passed with 170 tests and 842 assertions.
- `bun run test:e2e:run -- test/e2e/codex-registration.e2e.test.ts` passed with 5 tests and 145 assertions.
- `bun run test:e2e` passed with 405 tests and 1625 assertions.

Forced-add note: plan and epic files under `docs/plans/` and `docs/epics/` may be ignored in this repository. If committing this completed plan, force-add this plan file and any intended ignored epic/finding docs, but do not force-add scratch files under `tmp/` and do not stage the unrelated `schemas/clooks.schema.json` modification.

## Context and Orientation

Clooks is a Bun and TypeScript CLI. The compiled binary starts in `src/cli.ts`. If the binary receives command-line arguments, it loads `src/router.ts` and runs user-facing commands such as `clooks init` and `clooks uninstall`. If the binary receives no arguments and stdin is piped, it runs hook-engine mode through `src/engine/run.ts`.

`src/commands/init.ts` currently creates `.clooks/` files, writes `.clooks/bin/entrypoint.sh`, writes generated types and schema files, and registers Clooks with Claude Code by calling `registerClooks()` from `src/settings.ts`. For project init, the Claude registration goes to `.claude/settings.json` and uses `CLOOKS_ENTRYPOINT_PATH`, which is the Claude-specific command `"$CLAUDE_PROJECT_DIR"/.clooks/bin/entrypoint.sh`. For global init, the registration goes to `~/.claude/settings.json` and uses an absolute `~/.clooks/bin/entrypoint.sh` command.

`src/settings.ts` is the Claude Code registrar. A registrar is code that reads an agent's hook configuration file, inserts or updates Clooks-owned hook entries, preserves unrelated user entries, and writes the file back only when something changed. The current Claude registrar registers all events from `CLAUDE_CODE_EVENTS`, detects Clooks hooks by commands ending in `.clooks/bin/entrypoint.sh`, and unregisters only Clooks-owned matcher groups.

Plan B added `src/agents/*` and made engine mode select an agent adapter with `CLOOKS_AGENT`. The unset default and `CLOOKS_AGENT=claude-code` run the Claude Code adapter. `CLOOKS_AGENT=codex` currently selects a named placeholder that fails closed before runtime hook execution. This plan uses that marker in generated Codex commands but does not implement Codex runtime normalization or translation.

Codex hook registration is JSON-shaped. The plan target is a generated file at `.codex/hooks.json` for project init or `~/.codex/hooks.json` for global init. The generated file should have a top-level `hooks` object. Each Codex event key should contain one matcher group with `matcher: "*"` and one command hook. The command hook should have `type: "command"` and a `command` string. Add `statusMessage` only if the implementation verifies that Codex `hooks.json` supports that field; otherwise omit it.

The ten Codex events in this plan are the release-documented Plan A MVP set: `SessionStart`, `SubagentStart`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `UserPromptSubmit`, `SubagentStop`, and `Stop`.

Terms used in this plan:

- **Agent** means the upstream coding assistant that launches Clooks as a hook command, such as Claude Code or Codex.
- **Registration** means writing the upstream agent's hook configuration so it invokes Clooks.
- **Entrypoint** means `.clooks/bin/entrypoint.sh` or `~/.clooks/bin/entrypoint.sh`, the shell script Codex or Claude Code invokes before the Clooks binary runs.
- **Project registration** means writing files inside the current repository, such as `.codex/hooks.json`.
- **Global registration** means writing files under the user's home directory, such as `~/.codex/hooks.json`.
- **Unhooking** means removing generated agent hook registrations while preserving `.clooks/` hook source files.
- **Full uninstall** means unhooking and deleting the `.clooks/` directory for the selected project or global scope.

## Related Domain Knowledge Documents

- `docs/domain/cross-agent-hooks.md` -- consulted for the Codex event set, capability status, and adapter recommendation. Will need updating after implementation to describe the actual Codex registration file shape, command marker, and the fact that registration can exist before runtime translation is implemented.
- `docs/domain/cli-architecture.md` -- consulted for CLI dispatch, engine mode, and Plan B's adapter boundary. Will need updating after implementation to document `clooks init --agent ...` and `clooks uninstall --agent ...` routing.
- `docs/domain/bash-entrypoint.md` -- consulted for entrypoint behavior and environment variables. Will need updating after implementation if the generated command shape or entrypoint expectations change. At minimum it should mention that Codex registration uses absolute entrypoint paths plus `CLOOKS_AGENT=codex`, with `CLOOKS_PROJECT_ROOT` only where project-local registration requires an explicit root.
- `docs/domain/config.md` -- consulted for config semantics. No update is expected unless implementation changes config file discovery, validation, or `.clooks/clooks.yml` semantics.
- `docs/domain/config/discovery.md` -- consulted because generated project Codex commands may rely on `CLOOKS_PROJECT_ROOT`. No update is expected unless implementation changes explicit-root precedence.
- `docs/domain/testing.md` -- consulted for required unit and E2E patterns. Will need updating after implementation to describe Codex registration fixture conventions and the E2E coverage pattern for generated `.codex/hooks.json`.
- `docs/domain/vendoring/plugin-vendoring.md` -- consulted because FEAT-0044 keeps plugin-delivered hooks Claude-Code-only. No update is expected unless implementation changes plugin registration behavior.

## Related Findings

- `docs/findings/test-gaps.md` -> "No reusable harness for new-event additions" is relevant because Plan C registers ten Codex events. This plan should avoid bespoke weak checks by testing exact event coverage in the Codex registrar, but it does not solve the general new-event harness gap.
- `docs/findings/stale-docs.md` -> "`README.md` Events section missing `PostCompact` after PLAN-0014" is relevant as a warning against adding broad README support claims during Plan C. This plan must not add README Codex support claims; Plan F owns user-facing Codex documentation after runtime support and validation exist.
- `docs/findings/tooling-friction.md` -> "Disposable Codex live hook spikes need explicit binaries and auth state" is relevant because Plan C should not require live Codex authentication or trust state. Registration should be tested with generated files and compiled-binary E2E, not by invoking live Codex.

## Plan of Work

Begin by adding a Codex-specific registration module instead of extending `src/settings.ts` directly. `src/settings.ts` is Claude-shaped and uses `CLAUDE_CODE_EVENTS`, `.claude/settings.json`, and `$CLAUDE_PROJECT_DIR`. Create a new module such as `src/agents/codex/settings.ts` or `src/codex-settings.ts` that owns Codex hook file reads, writes, Clooks-hook detection, registration, and unregistration. Prefer `src/agents/codex/settings.ts` because Plan B already placed Codex adapter scaffolding under `src/agents/codex/`.

The Codex registration module should export a constant list named close to `CODEX_REGISTRATION_EVENTS` containing exactly the ten Plan A events. It should not reuse `CLAUDE_CODE_EVENTS`, because Claude Code has a larger event set and Codex's valid hook set differs. If the implementation imports `EventName` for type compatibility, it must still validate the exact Codex registration event list in tests.

Implement a JSON reader similar to `readSettings()` in `src/settings.ts`, but tune the error message for `hooks.json`. Empty files should be treated as an empty object only if that matches the existing Claude registrar behavior and tests cover it. Invalid JSON should fail with a message that names the file and tells the user to fix or delete it before rerunning `clooks init`.

Before writing the production registrar, verify the Codex command shape from repository evidence. Plan A and the domain docs say Codex handlers are shell commands that receive JSON on stdin, but Plan C owns the exact generated command shape. Check the local Codex hook docs cached in this repository and any Plan A research artifacts for whether `command` is executed through a shell, whether inline environment variable assignment is valid, whether `statusMessage` is a supported field, whether Codex sets cwd to the project root, and whether Codex exposes a project-directory environment variable. If the evidence is insufficient, add a tiny disposable non-network spike only if it can run without live Codex auth; otherwise record the uncertainty and choose the most conservative docs-backed command shape. Do not mutate real `~/.codex`, `~/.clooks`, or trust state.

Implement `registerCodexClooks(hooksPathOrDir, entrypointCommand)` with a result shape similar to the Claude `RegisterResult`: arrays for `added`, `updated`, `skipped`, and a `created` boolean. The function should create the parent `.codex` directory when a write is needed. It should preserve top-level unknown fields, preserve non-Clooks hooks, and only modify the Clooks-owned matcher group for each managed event. A Clooks-owned Codex hook must be detected with substring checks: the command string must include `.clooks/bin/entrypoint.sh` and must include `CLOOKS_AGENT=codex`. Do not copy Claude's `endsWith('.clooks/bin/entrypoint.sh')` detector, because the Codex command quotes the entrypoint path and therefore may end with `entrypoint.sh'`.

The generated project command should be conceptually:

    CLOOKS_AGENT=codex CLOOKS_PROJECT_ROOT=/absolute/project/path /absolute/project/path/.clooks/bin/entrypoint.sh

The generated global command should be conceptually:

    CLOOKS_AGENT=codex /absolute/home/path/.clooks/bin/entrypoint.sh

The global command intentionally omits `CLOOKS_PROJECT_ROOT` so the existing discovery flow can walk from Codex's cwd and find a project `.clooks/clooks.yml` when one exists.

Use a small shell-argument quoting helper rather than hand-building unescaped paths. The helper must safely single-quote paths with spaces and single quotes. For example, `/tmp/a b` should become `'/tmp/a b'`, and `/tmp/joe's repo` should become `'/tmp/joe'\''s repo'`. Apply the helper to `CLOOKS_PROJECT_ROOT` values and entrypoint paths. Environment variable names and literal agent ids do not need quoting.

After the registrar exists, extend `src/commands/init.ts` with an `--agent <agent>` option. The accepted values should be `claude-code`, `codex`, and `all`. When omitted, it must behave exactly like today's `clooks init`: project init writes `.clooks/`, `.claude/settings.json`, and `.gitignore`; global init writes `~/.clooks/` and `~/.claude/settings.json`. `--agent claude-code` should be an explicit spelling of that same behavior. `--agent codex` should still create or update `.clooks/` runtime files because Codex registration points at the Clooks entrypoint, but it should write `.codex/hooks.json` or `~/.codex/hooks.json` instead of `.claude/settings.json`. `--agent all` should perform both Claude Code and Codex registration after the shared `.clooks/` setup.

CLI output must be precise. For `--agent codex` and `--agent all`, print created/updated/skipped entries for `.codex/hooks.json` and print a warning that Codex may require hook review/trust before project hooks run. Do not print a warning that the Codex runtime adapter is not implemented yet. Do not add README Codex support claims in this plan.

JSON output should remain an envelope from `jsonSuccess('init', ...)`. Add enough fields for tests to distinguish agent selection, such as `agent` or `agents`, while preserving existing `created`, `skipped`, `updated`, and `global` behavior for existing callers. If adding fields to the existing envelope could surprise consumers, make the fields additive only and keep existing keys unchanged.

Then extend `src/commands/uninstall.ts` with a matching `--agent <agent>` option. The accepted values should mirror init. Omitted agent selection should preserve today's Claude Code behavior. `--agent codex --unhook --force` should remove Clooks-owned entries from `.codex/hooks.json` or `~/.codex/hooks.json` and preserve unrelated Codex hooks. `--agent all --unhook --force` should remove both Claude and Codex registrations. `--full` should delete `.clooks/` as it does today after unhooking the selected registrations. If both Claude and Codex unhooking are selected, output should report both counts separately enough that users can tell what changed.

Finally update domain docs in the same milestone that changes their described behavior. `docs/domain/cli-architecture.md` should describe the new init/uninstall agent selection. `docs/domain/bash-entrypoint.md` should describe the generated Codex command shape and the explicit environment markers. `docs/domain/cross-agent-hooks.md` should move Codex registration from future-tense to implemented-registration/runtime-unimplemented status. `docs/domain/testing.md` should record the registration test pattern. Update the coordinating epic's Plan C status and result at completion.

## Milestones

Milestone 1 verifies the Codex command shape and adds the Codex registrar in isolation. Start by checking repository-local Codex hook documentation and Plan A artifacts for shell execution, inline environment variable support, `statusMessage`, cwd behavior, and any Codex project-directory variable. Record the evidence in `Surprises & Discoveries` and update decisions if the command shape changes. Then add the registrar. At the end of this milestone, unit tests should prove that registering Codex creates a valid `hooks.json` with exactly ten Clooks-managed event entries, preserves unrelated entries, migrates older Clooks-managed command strings, quotes paths safely where shell quoting is used, omits `CLOOKS_PROJECT_ROOT` for global commands, and unregisters only Clooks-managed Codex entries. No CLI command should change yet. Run focused tests for the new registrar and existing Claude `src/settings.test.ts` to prove the new module did not disturb Claude registration.

Milestone 2 wires registration into `clooks init`. At the end of this milestone, `clooks init` with no `--agent` and with `--agent claude-code` should preserve current Claude behavior, `clooks init --agent codex` should write `.codex/hooks.json`, and `clooks init --agent all` should write both Claude and Codex registrations. Unit tests in `src/commands/init.test.ts` should cover project and global paths, JSON output, invalid agent values, idempotent reruns, and the Codex trust/review warning. Tests should also assert that no user-facing runtime-placeholder warning is printed. Focused init tests should pass before moving on.

Milestone 3 wires unregistration into `clooks uninstall`. At the end of this milestone, `clooks uninstall --project --agent codex --unhook --force` and the global equivalent should remove Clooks-owned Codex hook entries while preserving unrelated Codex hooks and `.clooks/`. `--agent all` should remove both Claude and Codex registrations. Existing uninstall defaults must remain Claude-compatible. Unit tests in `src/commands/uninstall.test.ts` should cover no-op, unhook-only, full uninstall, JSON output, invalid agent values, and preservation of unrelated hooks.

Milestone 4 adds compiled-binary E2E coverage. Add or extend E2E tests so the compiled binary proves the full CLI path: `clooks init --agent codex` creates `.clooks/bin/entrypoint.sh` and `.codex/hooks.json`; a second run is idempotent; `clooks init --agent all` preserves existing Claude behavior while adding Codex registration; `clooks uninstall --agent codex --unhook --force` removes only Codex registration. The E2E should inspect generated files and command strings but should not invoke live Codex.

Milestone 5 updates docs and closes the plan. Update the domain docs named in this plan, update the epic Plan C status/result, review findings, and update `ATTENTION.md` if implementation touched danger-zone behavior beyond what is already documented. Run validation, record results in `Outcomes & Retrospective`, and note any forced-add requirements because plan files under `docs/plans/` and epic files under `docs/epics/` may be gitignored.

## Concrete Steps

From the repository root `/opt/development/clooks`, start by confirming the worktree:

    git status --short

Expect to see the unrelated `schemas/clooks.schema.json` modification unless the user has handled it separately. Do not revert it and do not include it in this plan's changes.

First verify command-shape evidence from local docs and Plan A artifacts. Suggested searches:

    rg -n "hooks.json|statusMessage|command|shell|cwd|CWD|project" docs/domain docs/plans/feat-0044-cross-agent-portability docs/research test/fixtures/codex

Record what you find in this plan before implementing the registrar. If evidence contradicts the conceptual command shape, revise this plan first.

Create `src/agents/codex/settings.ts` with the Codex registration constants, types, JSON read/write helpers, shell quoting helper if shell commands are confirmed, registration function, unregistration function, and registration detection helper. Add `src/agents/codex/settings.test.ts` with focused unit tests.

Run:

    bun test src/agents/codex/settings.test.ts src/settings.test.ts

Then update `src/commands/init.ts` with `--agent <agent>`, agent option parsing, Codex registration calls, output text, and JSON envelope fields. Add or extend tests in `src/commands/init.test.ts`.

Run:

    bun test src/commands/init.test.ts src/agents/codex/settings.test.ts src/settings.test.ts

Then update `src/commands/uninstall.ts` with `--agent <agent>`, Codex registration checks, Codex unhook behavior, output text, and JSON envelope fields. Add or extend tests in `src/commands/uninstall.test.ts`.

Run:

    bun test src/commands/uninstall.test.ts src/commands/init.test.ts src/agents/codex/settings.test.ts src/settings.test.ts

Then add E2E coverage under `test/e2e/`, either in `test/e2e/init-journey.e2e.test.ts`, `test/e2e/uninstall-journey.e2e.test.ts`, or a new focused file such as `test/e2e/codex-registration.e2e.test.ts`.

Run the focused E2E:

    bun run test:e2e:run -- test/e2e/codex-registration.e2e.test.ts

If the E2E is added to existing files instead, run the affected files explicitly with `bun run test:e2e:run -- <file>`.

Before completion, run:

    bun run typecheck
    bun test src/agents/codex/settings.test.ts src/commands/init.test.ts src/commands/uninstall.test.ts src/settings.test.ts
    bun run test:e2e

If `bun run test:e2e` fails because Docker socket access is blocked by the sandbox, rerun it with approved Docker access per the environment's escalation process. If the failure is not sandbox-related, fix it before closing the plan.

## Validation and Acceptance

Acceptance requires behavior a human can inspect. In a disposable project after implementation, running:

    clooks init --agent codex --json

should exit 0 and produce a JSON success envelope whose data includes `.clooks/` setup entries and `.codex/hooks.json`. The generated `.codex/hooks.json` should contain exactly the ten Codex MVP event keys, each with one Clooks command hook that sets `CLOOKS_AGENT=codex`, uses the command shape verified in Milestone 1, and calls the `.clooks/bin/entrypoint.sh` path. If project registration uses absolute paths, rerunning `clooks init --agent codex` in a clone at a different location should refresh the Clooks-owned command paths without duplicating entries.

Running the same command a second time should exit 0 and report the Codex hook file as skipped, or otherwise show no duplicate Clooks hook entries. The file should remain semantically unchanged.

Running:

    clooks init --agent all --json

should create or update both `.claude/settings.json` and `.codex/hooks.json` while preserving existing unrelated hooks in both files.

Running:

    clooks uninstall --project --agent codex --unhook --force --json

should remove only the Clooks-owned Codex entries from `.codex/hooks.json`, leave unrelated Codex hooks intact, and leave `.clooks/` intact.

Existing behavior must remain intact. Running `clooks init` with no `--agent` should still register Claude Code only, and existing Claude-focused init/uninstall tests and E2E journeys should continue to pass.

Do not accept live Codex hook firing as a required validation step for this plan. Live Codex execution remains blocked by auth/trust constraints from Plan A and by the runtime placeholder from Plan B. Plan E owns full Codex path validation after Plan D implements runtime translation.

## Idempotence and Recovery

All registration operations must be idempotent. Re-running init should update stale Clooks-owned command entries when the expected command changes, skip already-correct entries, and preserve unrelated user hooks. If `hooks.json` is invalid JSON, Clooks should fail with a clear error and should not overwrite the file. Users recover by fixing or deleting the invalid file and rerunning `clooks init --agent codex`.

Unregistration must be conservative. It should remove only Clooks-owned Codex matcher groups and leave non-Clooks Codex hooks untouched. `--full` may delete `.clooks/` only after the same confirmation or force rules used by existing uninstall behavior.

If generated Codex registration causes local testing lockout after a later runtime implementation, users can remove it with `clooks uninstall --project --agent codex --unhook --force` or manually delete the Clooks-owned entries from `.codex/hooks.json`. The existing `SKIP_CLOOKS=true` entrypoint bypass still applies when a generated entrypoint is invoked.

## Artifacts and Notes

Expected project Codex registration shape:

    {
      "hooks": {
        "PreToolUse": [
          {
            "matcher": "*",
            "hooks": [
              {
                "type": "command",
                "command": "CLOOKS_AGENT=codex CLOOKS_PROJECT_ROOT='/abs/repo' '/abs/repo/.clooks/bin/entrypoint.sh'"
              }
            ]
          }
        ]
      }
    }

The implementation should repeat that matcher group shape for all ten Codex events. Include `statusMessage` only if Milestone 1 verifies it is supported. The order in the JSON file should be stable so diffs are readable and tests do not flap.

Plan and epic files under `docs/plans/`, `docs/epics/`, `docs/research/`, and `docs/findings/` may be ignored by this repository's `.gitignore`. If committing this plan, use `git add -f` for this plan and any intended epic updates. Do not force-add unrelated scratch files under `tmp/`, and do not stage the unrelated `schemas/clooks.schema.json` modification unless the user explicitly asks.

## Interfaces and Dependencies

Create `src/agents/codex/settings.ts` with names close to these. Exact types may be refined, but any structural deviation must be logged in `Surprises & Discoveries` before the relevant milestone is marked complete.

    export const CODEX_REGISTRATION_EVENTS = [
      'SessionStart',
      'SubagentStart',
      'PreToolUse',
      'PermissionRequest',
      'PostToolUse',
      'PreCompact',
      'PostCompact',
      'UserPromptSubmit',
      'SubagentStop',
      'Stop',
    ] as const

    export type CodexRegistrationEvent = (typeof CODEX_REGISTRATION_EVENTS)[number]

    export interface CodexRegisterResult {
      added: CodexRegistrationEvent[]
      skipped: CodexRegistrationEvent[]
      updated: CodexRegistrationEvent[]
      created: boolean
    }

    export interface CodexUnregisterResult {
      removed: CodexRegistrationEvent[]
    }

    export function makeCodexEntrypointCommand(root: string, entrypointPath: string): string

    export function registerCodexClooks(codexDir: string, entrypointCommand: string): CodexRegisterResult

    export function unregisterCodexClooks(codexDir: string): CodexUnregisterResult

    export function isCodexClooksRegistered(codexDir: string): boolean

`codexDir` should mean the directory containing `hooks.json`, such as `join(projectRoot, '.codex')` or `join(homeRoot, '.codex')`, mirroring how the Claude registrar takes the directory containing `settings.json`.

The Codex Clooks-hook detector must use substring checks, not Claude's `endsWith()` helper:

    typeof command === 'string' &&
      command.includes('CLOOKS_AGENT=codex') &&
      command.includes('.clooks/bin/entrypoint.sh')

This is necessary because Codex commands may quote the entrypoint path, leaving a trailing quote after `entrypoint.sh`.
If Milestone 1 verification changes the command representation so `CLOOKS_AGENT=codex` is no longer a literal substring of `command`, the detector contract must be updated in the same milestone to match the verified representation. Command generation and Clooks-owned hook detection are one design decision and must not drift.

In `src/commands/init.ts`, extend `createInitCommand()` so the action receives:

    opts: { global?: boolean; agent?: 'claude-code' | 'codex' | 'all' }

Commander does not enforce TypeScript literal values at runtime, so add explicit validation and a clear error for invalid values.

In `src/commands/uninstall.ts`, extend `createUninstallCommand()` similarly:

    opts: {
      project?: boolean
      global?: boolean
      force?: boolean
      unhook?: boolean
      full?: boolean
      agent?: 'claude-code' | 'codex' | 'all'
    }

Keep existing non-interactive force validation. Agent selection should not weaken the requirement that non-interactive uninstall must pass `--force` plus explicit scope and action flags.

The implementation must not add Codex conditionals to `src/engine/run.ts`. Runtime normalization and translation are Plan D. Registration code should only generate files and commands.

## Instruction Prompts

- **2026-05-25** (Joe Degler):

  > "Then start writing one."

## Revision Notes

- 2026-05-25 / Joe Degler: Created the initial Plan C ExecPlan from the EPIC, Plan A runtime-contract result, Plan B adapter-boundary result, and the current `init` / `uninstall` / `settings` implementation. This is planning-only work.
- 2026-05-26 / Joe Degler: Incorporated pre-implementation review feedback. The plan now omits `CLOOKS_PROJECT_ROOT` from global Codex registration, requires command-shape verification before registrar implementation, records the absolute-path portability tradeoff, explicitly forbids copying Claude's `endsWith()` detector, makes `statusMessage` conditional on verification, and removes planned CLI runtime-placeholder warnings per user direction.
- 2026-05-26 / Joe Degler: Clarified that Codex Clooks-hook detection must be re-derived if Milestone 1 changes the command representation, so generated command shape and ownership detection cannot diverge.
