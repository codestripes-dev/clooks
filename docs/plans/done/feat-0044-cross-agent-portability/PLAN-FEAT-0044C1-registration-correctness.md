# Plan C1: Recoverable Registration Correctness


Status: complete and archived. Author: Joe-Degler (verified by `gh api user` in the parent session). Date: 2026-09-07.

This ExecPlan is maintained under `docs/plans/PLANS.md`. All three milestones passed independent code review, QA and validation. Codex runtime activation remains downstream work, not an unfinished implementation milestone here.

## Purpose / Big Picture


After this work, init and uninstall preserve user registration data on invalid input and failed writes, use the selected Codex home consistently, and never delete the shared launcher while known registrations still require it. A user can repair a failed setup and rerun the same command without accumulated duplicates or misleading new global suppression state. Observe these outcomes in disposable projects using the compiled CLI and generated launcher tests.

This is corrective work on existing registration, not Codex runtime activation. The current Codex adapter still refuses engine execution. Deterministic registrar fixes do not depend on model authentication, live Codex sessions, or a refresh of the full ten-event output contract.

## Product Context


**Originating Feature:** `docs/planned/FEAT-0044-cross-agent-hooks.md`.

**Coordinating Epic:** `docs/epics/EPIC-0044-cross-agent-hook-portability.md` (EPIC-0044).

**Problem we are solving:** Registration can currently destroy structurally unexpected JSON, mistake unrelated shell text for an owned command, truncate files during writes, and publish global suppression flags before registration succeeds. Interactive uninstall can delete a launcher still referenced by another agent or by registrations the user declined to remove. Alternate Codex homes can direct setup to the wrong location. Inherited Claude environment is a separate runtime-boundary issue deferred to D.

**Metrics this may affect:** Fewer destructive setup failures, reliable retries, fewer missing hook invocations caused by mismatched registration state, and preserved Claude onboarding. No numerical performance or adoption target is claimed.

**Feature alignment:** FEAT-0044 promises explicit agent registration of shared custom/vendored hooks. This plan repairs that registration prerequisite. Claude-only plugin delivery stays unchanged. Existing global invocations intentionally execute merged home, project, and local configuration, including trusted repository hooks. Preserve ordering, shadowing, and local overrides. There is no new repository trust database, authorization UI, home-only global execution, or universal exactly-once invocation system.

Keep `--agent claude-code|codex|all`, omitted-agent Claude behavior, the existing JSON envelope and legacy Claude count aliases, the hook-author surface, and the ten Codex registration events. Do not add README support claims or a CLI warning about implementation staging. Native hook review remains external activation behavior; documented registration success never means that native commands are enabled, reviewed, or actually firing.

## Progress


- [x] (2026-09-07, Joe-Degler) Executed Milestone 1 through implementation subagents, independent code review, QA, required validation and same-milestone domain updates. Preserved existing worktree changes and left later milestones untouched during this gate.

- [x] (2026-09-07, Joe-Degler) Read `docs/plans/PLANS.md` and created the required skeleton before research.
- [x] (2026-09-07, Joe-Degler) Read required context, source, test coverage and harnesses; completed the corrective draft using source evidence.
- [x] (2026-09-07, Joe-Degler) Recorded the continuation prompt before resuming after drafting/review agents hit their usage limit. A replacement independent reviewer found no blockers in Milestones 1 and 2; no implementation approval is implied for unreviewed portions.
- [x] (2026-09-07, Joe-Degler) Independent product, code-plan and QA reviews completed. Corrected the two recovery blockers and received code/QA re-review with no remaining blockers; synchronized the deterministic checksum-failure smoke instruction.
- [x] (2026-09-07, Joe-Degler) Milestone 1: data-preserving registrar validation, ownership, and atomic writes; 266 focused unit tests and 477 Docker E2E tests pass. Code reviewer and QA approved, including the final pre-write permission correction. Four domain documents updated.
- [x] (2026-09-07, Joe-Degler) Milestone 1 closure: removed resolved registrar findings while retaining downstream issues; a separate documentation-summary subagent used only the supplied inventory and no lookup. Tracked and ignored-plan whitespace checks passed. Nothing staged or committed.
- [x] (2026-09-07, Joe-Degler) Milestone 2: final deletion decisions, all-agent consent/preflight/cleanup and remaining-reference guards; 231 focused unit tests, 44 uninstall journey tests and 510 full Docker E2E tests passed. Independent code reviewer and QA approved; CLI/testing domain updates complete.
- [x] (2026-09-07, Joe-Degler) Milestone 2 implementation delegated to separate uninstall/unit/CLI-doc and Docker-PTY/E2E/testing-doc workers. All uninstall test execution, including units, stayed inside disposable Docker containers; no host uninstall or global binary replacement.
- [x] (2026-09-07, Joe-Degler) Milestone 2 closure: findings subagent removed the resolved deletion issue, preserving downstream gaps. Final documentation-summary subagent used only the supplied inventory, without lookup, to summarize CLI/testing, plan/epic/ATTENTION and findings updates; README unchanged. Validation evidence is recorded here, not as frozen counts in the testing domain guide. Final whitespace and unrelated-scope checks passed; nothing staged or committed.
- [x] (2026-09-07, Joe-Degler) Milestone 3: effective Codex home and recoverable registration receipts implemented; independent code and QA GO. Final Docker units: 1,957 pass; full E2E: 600 pass. Five domain docs updated, with Claude behavior and runtime limitations retained.
- [x] (2026-09-07, Joe-Degler) Candidate focused Docker run exposed the physical-parent defect (433/434 pass); corrected it and all QA findings: external assertions for caught fault callbacks, distinct multi-home event sets, same-size/restored-mtime checksum evidence, directory/FIFO state rejection and bounded subprocesses.
- [x] (2026-09-07, Joe-Degler) Corrected the resolver and initial QA findings. Focused Docker rerun passed 443 tests with 2,347 assertions; targeted six-file compiled smoke passed 238 tests with 3,852 assertions in 36.63 seconds. Code reviewer approved. Full gates and final QA remain pending the bounded CLI checksum subprocess and explicit timestamp-only probe.
- [x] (2026-09-07, Joe-Degler) Continued Milestone 3 from committed `0e5ac55` through disjoint state/resolver, CLI integration, and launcher/E2E workers. Parent coordinated review, QA, findings and Docker-only validation. Unrelated `TODO.md` preserved; no Codex runtime activation, host init/uninstall or global deployment.
- [x] (2026-09-07, Joe-Degler) Final closure: removed resolved home/receipt and engine-isolation findings, retained native/runtime/quoting/coverage limits, archived C1 with adjacent focused ATTENTION, and updated the epic. A fresh documentation-summary subagent used only the supplied inventory, with no tools or lookup. Whitespace and ignore checks passed; archive files and untracked findings need deliberate force-add. No staging or commit performed.
- [x] (2026-09-07, Joe-Degler) Draft inventory: this C1 plan is authored here; parent owns epic and ATTENTION alignment, and delegates continuation-review alignment. Parent reports planned C1 ATTENTION section added without implementation claims.
- [x] (2026-09-07, Joe-Degler) Reconciled epic, ATTENTION and continuation review. Findings audit retains the source defects because drafting has not resolved them; no new unresolved finding arose from the final plan review.
- [x] (2026-09-07, Joe-Degler) Documentation-summary subagent completed from supplied inventory without lookup. Required sections, three ordered milestones and domain paths validated; tracked diff whitespace check passed, and ignored plan/review checks emitted no whitespace errors. No implementation tests ran.

## Surprises & Discoveries


The first Milestone 3 Docker unit run caught a physical-path defect: `alias/../missing` returned the lexical parent instead of the symlink target's physical parent. Resolve existing prefixes before applying parent components and retain a missing-tail representation without preflight writes; preserve file and dangling-symlink rejection. QA also found that assertions inside an init failure callback can be caught by the CLI and mistaken for the expected exit. Capture callback observations and assert outside the caught path, including proof that the intended fault was reached.

Physical identity agrees with Bash for traversable original paths. A spelling such as `missing/../alias` may resolve to an accepted canonical destination without making the original spelling traversable; the missing directory is not created as a side effect. In that case the launcher deliberately falls through. Independent review accepted this bounded behavior and required an explicit unit and positive shell probe.

Milestone 3 review found that repairing a missing or nonexecutable shared launcher can reactivate an old matching Codex receipt before a later init failure. Selected Codex/all init now persists recovery identity and retires the old receipt before shared setup, then publishes only after successful registration. Read-only identity rejection preserves bytes and modes. This refines the original publication order without adding a state API. Claude-only init remains independent: its shared-launcher repair can restore an existing Codex receipt's eligibility, even if the subsequent Claude registrar fails; this explicitly bounded behavior is documented and tested rather than silently inspecting or mutating unselected Codex state.

Milestone 3 shell review also found that executable directories satisfy `-x`, and `-f` follows file symlinks. Require a regular executable global launcher; reject symlink receipts and hooks files consistently with CLI readers. Directory aliases remain supported through physical-path resolution, and a symlink to a regular executable launcher remains supported.

Milestone 2 review found that preserved-group counters were conditional on actual removals, so an unrelated-only registration could report zero and stale global flags could change the count. Counts now follow validated action agents. The existing `both` dispatcher is sequential, not cross-scope transactional; documentation and regression tests distinguish completed project cleanup from later global cancellation.

Milestone 2 interface check: `agentsForAction(agent, shouldDelete)` matches the plan. Internal `confirmCleanup()` performs all relevant registration inspection and any additional consent before mutation, returning the authorized agents or cancellation. `inspectRegistrations()` and `assertNoRemainingRegistrations()` reuse the strict reader and bounded detectors across all events; unsupported owned events fail preflight, and a second inspection guards deletion after cleanup. Public selectors, signatures, discovery, event catalogs and JSON aliases remain unchanged. No runtime or active-home implementation was added.

Final file-mode audit: opening every temporary file with `0o666` before restoring an existing private mode can briefly expose copied registration bytes under a permissive umask. Create replacement temporaries with the existing ordinary permission bits from the start; retain final `fchmod` for exact mode preservation. New files retain ordinary umask-filtered `0o666`. Add a test observing mode before any bytes are written. This is preservation of existing file confidentiality, not a repository authorization change.

Milestone 1 implementation detail: a generic shell-safe Claude command recognizer alone rejects existing raw global commands with spaces/non-ASCII home paths. Preserve exact commands known from the registration scope via optional `expectedCommand`, while keeping generic recognition conservative. This avoids duplicates/missed cleanup without changing the legacy command transport. The shared reader also rejects nonregular destinations during reads, so inspection cannot silently treat a symlink or dangling link as absence.

Observation: Prior Plan C explicitly approved overwriting root `null`/arrays and an invalid `hooks` shape. Its tests assert those destructive outcomes. Evidence: `src/agents/codex/settings.test.ts` contains tests named `valid JSON with root null or array is treated as empty and overwritten on write` and `valid JSON with invalid hooks shape preserves top-level fields and replaces hooks`. Replace those expectations; preserving a historical test is not a reason to retain the bug.

Observation: Codex ownership is currently two `includes()` checks in `isCodexClooksHook()`. Even `echo 'CLOOKS_AGENT=codex .clooks/bin/entrypoint.sh'` qualifies. Register and unregister also discard empty unrelated matcher groups while rewriting an event. Both must preserve structures they do not own.

Observation: `initGlobal()` creates all selected flags before either registrar runs. Init uses `os.homedir()`, uninstall uses `getHomeDir()`, the engine uses `CLOOKS_HOME_ROOT ?? homedir()`, and the shell checks `$HOME`. Codex registration independently hardcodes `join(homeRoot, '.codex')`. These are different concepts, not interchangeable roots.

Observation: Both uninstall scopes compute `actionAgents` from `opts.full` before prompts set `shouldDelete`. Declining unhook and accepting deletion currently reaches `rmSync()` without unregistering. Detection must distinguish malformed state from no registration, including the other agent.

Observation: Claude's registrar removes entire mixed matcher groups, has unchecked JSON shapes, and writes in place too. Its preservation behavior is directly on the all-agent deletion path, so minimal corresponding fixes are included; its event catalog and default selection remain unchanged.

Observation: `discoverProjectRoot()` prefers explicit `CLOOKS_PROJECT_ROOT`, then walks from `CLAUDE_PROJECT_DIR`, then cwd. Omitting an assignment in a global Codex command does not unset an inherited value. The explicit Clooks override is intentional public behavior; the Claude-specific anchor is inappropriate for an explicitly selected Codex invocation.

Observation: Existing compiled-binary Codex E2E inspects files but never runs the generated command. The sandbox already supports `writeStubBinary()` without replacing the real compiled CLI used by `sandbox.run()`. Existing uninstall E2E uses force mode; it does not cover interactive deletion. A pseudo-terminal (a subprocess terminal usable by prompts) is needed for that regression.

Evidence limits: This authoring pass ran source reads and a worktree check, not tests, builds, or live Codex. Parent edits already exist in domain, epic, findings, and Plan A files, plus an unrelated `TODO.md`; leave them intact. The requested draft may be ignored by git, so ordinary status alone is not proof that it exists.

## Decision Log


Decision: After the final acceptance gate, archive only this completed plan under `docs/plans/done/feat-0044-cross-agent-portability/` with a focused completed-registration `ATTENTION.md`, and update the epic link. Preserve the active feature folder, its shared ATTENTION, prior plans and research. Rationale: PLANS.md requires archiving completed plans and adjacent danger-zone documentation, but the surrounding epic still needs its active runtime/research context. Date/Author: 2026-09-07, Joe-Degler.

Decision: Bound the CLI receipt-publication `cksum` subprocess to ten seconds with forced termination, and treat timeout as publication failure retaining recovery identity. Rationale: even a replaced or malfunctioning checksum executable must not leave setup indefinitely waiting. This is a private CLI subprocess bound, not a new hook timeout or shell utility dependency. Unit coverage verifies the bound and failure behavior; compiled smoke covers nonzero checksum failure. Date/Author: 2026-09-07, Joe-Degler.

Decision: For selected Codex/all init, order read-only identity preflight, atomic recovery tracking, old receipt retirement, shared launcher setup, registration, then new receipt publication. Keep `trackCodexHome()` a tracking-only API and compose retirement in the CLI. Rationale: an old receipt must not gain eligibility through a launcher repair followed by failed Codex setup; retaining recovery before retirement preserves cleanup identity on every later failure. Claude-only init does not read or retire Codex state and retains its shared-launcher repair behavior, so its effect on an existing matching receipt is outside this selected-Codex guarantee. Independent reviewer approved this bounded scope; test both paths and restore normal checksum PATH before post-failure probes. Date/Author: 2026-09-07, Joe-Degler.

Decision: Make cancellation and partial-failure guarantees explicitly per scope; the existing interactive `both` dispatcher completes project work before global work. Rationale: collecting both scopes as one transaction would expand this correction; later global cancellation must not claim to roll back completed project work. Use scope-qualified no-change messages, documentation and a regression test. Count preserved groups for every validated action agent even when unregister removed nothing, so unrelated-only data and stale flags do not distort counts. Date/Author: 2026-09-07, Joe-Degler.

Decision: Allow internal `isClooksHook(hook, expectedCommand?)` recognition of the exact scope-derived current command, and share strict reading with explicit known-event versus all-event inspection. Rationale: preserve generated Claude registrations in unusual home paths and ensure uninstall counters use validated structures. This is an internal helper extension, not a hook-author or CLI API change. Date/Author: 2026-09-07, Joe-Degler.

Decision: Preserve established runtime and permission behavior. Rationale: binding user scope. Date/Author: 2026-09-07, Joe-Degler.

Decision: C1 starts with deterministic data integrity fixes; it has no runtime-contract-refresh prerequisite. Rationale: JSON shape rejection, exact ownership, rename-based writes, and cleanup ordering are locally provable. The earlier continuation dependency graph is superseded for this narrow work; parent owns the epic correction. Date/Author: 2026-09-07, Joe-Degler.

Decision: Keep generated command strings and recognize only their bounded grammar, including the actually generated older absolute-path form without a project-root assignment. Rationale: no new command transport or general shell parser is needed. Textual mentions, appended commands, and arbitrary extra arguments are not ownership evidence. Date/Author: 2026-09-07, Joe-Degler.

Decision: Reject nonempty malformed or structurally invalid registration containers without writes; retain the established empty/whitespace-file initialization case. Rationale: missing containers can be added, but present invalid data cannot be silently replaced. Unknown fields and event names are not themselves errors. Date/Author: 2026-09-07, Joe-Degler.

Decision: File updates are individually atomic and multi-agent operations are recoverable, not a cross-file transaction. Rationale: temporary-file replacement prevents partial JSON; preflight avoids predictable partial cleanup, and retaining runtime files permits retry after later I/O failure. Do not introduce a journal or roll back successful files over external edits. Date/Author: 2026-09-07, Joe-Degler.

Decision: Derive cleanup scope from final deletion intent and require consent to every extra cleanup before any mutation. Rationale: deleting shared runtime files implicitly requires all known references to be removed, but a declined unhook is not permission to silently remove it. Date/Author: 2026-09-07, Joe-Degler.

Decision: Retain absolute project command paths and require `clooks init --agent codex` after clone/move before activating that checkout's hooks. Rationale: an old checkout that still exists is a real wrong-project execution risk; re-init is the accepted bounded recovery. Do not substitute git root for Clooks discovery. Date/Author: 2026-09-07, Joe-Degler.

Decision: Defer inherited-provider discovery policy and production `src/config/discovery.ts` changes to D. Preserve intentional `CLOOKS_PROJECT_ROOT`; global command omission does not clear inheritance. Rationale: parent narrowed C1 to registration correctness; source evidence and bounded environment probes suffice here without changing runtime discovery. Date/Author: 2026-09-07, Joe-Degler.

Decision: Use one versioned Codex receipt at the existing Codex flag path, reject relative Codex homes, reject registration-file symlink mutation unchanged, and install test-only Docker `expect` for two interactive smoke cases. Rationale: these resolve implementation choices without a permission system, many-home ledger or production TTY bypass. Date/Author: 2026-09-07, Joe-Degler.

Decision: Track the one selected global Codex home separately before registration writes, and retain that identity until no owned references remain on any event. Rationale: independent review found that failed suppression-receipt publication and partial known-event unhook could otherwise lose the only cleanup reference. A small recovery record never suppresses execution; it is not a many-home registry. Date/Author: 2026-09-07, Joe-Degler.

## Outcomes & Retrospective


Closure is complete. The final no-lookup documentation-summary subagent confirmed the five domain guides, epic, archived plan, active/new archived ATTENTION and selective findings maintenance from the supplied inventory alone. README and native Codex support claims remain unchanged. All implementation and review gates are complete, the plan is archived, and only separately scoped runtime/release work remains in the epic. M3 changes are available in the worktree, not committed.

Milestone 3 completes this plan. Global registration now honors the selected physical Codex home, retains cleanup identity across partial failures, and publishes a byte-fresh suppression receipt only after successful selected-Codex/all setup. Full cleanup inspects selected and recorded homes, with explicit pathful consent and remaining-reference checks. New launchers validate receipt format, homes, file types, executable launcher and POSIX checksum before yielding. Claude-only setup retains its documented shared-launcher exception, and native activation remains unprovable from stored state.

The final gate passed 1,957 full Docker unit tests and 600 full Docker E2E tests, plus typecheck, formatting, lint and ShellCheck. Independent code review and QA approved after correcting physical-parent resolution, receipt reactivation, file-type mismatches and assertion placement. The five affected domain documents were updated in this milestone. No README, schema, production engine/discovery, Codex runtime adapter or host installation changes were made. M1/M2 remain committed in `0e5ac55`; M3 is not staged or committed. Next work is refreshed version-specific runtime evidence and a separate runtime-adapter plan.

The paragraphs below retain earlier milestone history; pending M3 descriptions there describe those earlier gates, not current status.

Milestones 1 and 2 are complete and committed in `0e5ac55`: implementation, independent code review, QA, focused units, full Docker E2E and same-milestone domain updates passed. Milestone 2 adds consent before all-agent deletion, preflight and remaining-reference checks, partial-failure recovery, correct preserved counts and real PTY coverage. Milestone 3 is implementing home identity, recovery state and launcher eligibility, with its review and validation gates pending. The final permission correction in Milestone 1 prevents replacement temporaries from gaining broader ordinary access than an existing destination before bytes are written; both reviewers approved it and validation was rerun.

The reviewed plan identifies three incremental implementation milestones and their own evidence gates. Milestone 1 provides strict data-preserving registration, bounded ownership recognition, atomic file replacement and relocation probes. Milestone 2 adds safe deletion decisions with PTY evidence; receipt and home-switching behavior remain unimplemented. No native Codex runtime verification was performed. Independent reviews resolved cleanup-identity gaps during planning, test-coverage gaps during implementation and ambiguous per-scope/count behavior during deletion review.

The earlier planning task created the C1 plan and adjusted the epic, ATTENTION and continuation review without editing domain documents or README. Milestone 1 subsequently updated CLI architecture, bash entrypoint, cross-agent hooks and testing. Global hooks awaits the later milestone; discovery documentation and README remain unchanged. Pre-existing research/domain edits in the worktree remain intact.

The earlier no-lookup documentation-summary subagents confirmed the planning and Milestone 1 inventories. Milestone 2 updated CLI/testing knowledge, plan/epic/ATTENTION progress and findings maintenance, with README unchanged. Resolved registrar and deletion findings were removed; home/dedup, runtime and Claude global quoting issues remain open. Whitespace validation found no errors, including in the ignored plan. Git's no-index comparison against `/dev/null` returned the expected differences status for that new file. The C1 plan, continuation review and standalone portability finding need `git add -f` when deliberately committed; the epic and ATTENTION are already tracked. No files were staged or committed by this task.

## Context and Orientation


All paths below are relative to `/opt/development/clooks`. `CLAUDE.md` supplies repository workflow and Docker requirements. `docs/plans/PLANS.md` governs this document. Prior completed Plan C is `docs/plans/feat-0044-cross-agent-portability/PLAN-FEAT-0044C-codex-registration-entrypoint.md`; its historical results stand, but C1 replaces the destructive shape and substring-detection decisions. The follow-up rationale remains at `docs/plans/feat-0044-cross-agent-portability/continuation-review.md`. The active feature folder and shared ATTENTION remain available for downstream work. This completed plan archives separately under `docs/plans/done/feat-0044-cross-agent-portability/` with an adjacent focused ATTENTION snapshot.

A registrar is the module that merges Clooks command entries into an agent's JSON file. `src/agents/codex/settings.ts` owns Codex builders, detection, register/unregister, and the ten-event constant. `src/settings.ts` is its Claude counterpart. `src/commands/init.ts` creates shared `.clooks` files and calls registrars; `src/commands/uninstall.ts` gathers decisions, removes registrations and flags, then may delete `.clooks`. A matcher group is one event's object containing a `hooks` array, possibly alongside matcher or unknown metadata; unrelated commands can share it with Clooks.

`src/commands/init-entrypoint.ts` embeds project/global bash scripts. The project variant checks global flags before invoking the PATH-resolved binary; the global variant always invokes it. Dedup here means project invocation yielding to a configured global invocation for the same agent. It is not an event identity service. The global engine still loads home/project/local layers.

`src/cli.ts` sends no-argument stdin invocations to the engine. `src/agents/select.ts` selects solely from `CLOOKS_AGENT`, with empty/unset defaulting to Claude. `src/agents/codex/adapter.ts` remains a placeholder. `src/config/discovery.ts` returns a `DiscoveryResult`; `findProjectRoot()` extracts its path. The engine consumes that path for config, hooks and failure storage; config CLI and uninstall also consume discovery. This shared blast radius is why production discovery and provider policy are deferred to D.

Existing unit targets are `src/agents/codex/settings.test.ts`, `src/settings.test.ts`, `src/commands/init.test.ts`, `src/commands/uninstall.test.ts`, `src/config/discovery.test.ts`, and `src/agents/select.test.ts`. CLI tests mock prompts and homes. E2E targets are `test/e2e/codex-registration.e2e.test.ts`, `init-journey.e2e.test.ts`, `uninstall-journey.e2e.test.ts`, `entrypoint.e2e.test.ts`, `fresh-clone.e2e.test.ts`, `config-discovery-from-subdir.e2e.test.ts`, `home-dir.e2e.test.ts`, `config-layering.e2e.test.ts`, and `agent-adapter.e2e.test.ts`. Extend the domain-appropriate existing files before adding a new suite.

`test/e2e/helpers/sandbox.ts` creates temporary project/home directories, a local PATH symlink and subprocess helpers. `test/Dockerfile` uses a non-root test user so permission failure tests are meaningful. `test/docker-entrypoint.sh` typechecks and compiles the binary from mounted source. Only `bun run test:e2e` is authorized as the E2E entry command for this plan, even where older docs show shortcuts.

## Related Domain Knowledge Documents


`docs/domain/bash-entrypoint.md` was consulted; update in Milestones 1 and 3 for relocation, receipt semantics and recovery. Document inherited environment as a retained limitation, not a C1 fix.

`docs/domain/cli-architecture.md` was consulted; update with each relevant milestone for preservation/error behavior, final-decision uninstall, effective Codex home and accurate output paths. Keep default selection and JSON aliases documented.

`docs/domain/global-hooks.md` was consulted; update in Milestone 3 for home identity, receipt lifecycle and the external activation limitation. Reaffirm merged global execution without changing layer rules.

`docs/domain/config/discovery.md` was consulted; no behavior update in C1. Provider-specific anchor policy remains D work. Preserve explicit override precedence and existing discovery.

`docs/domain/testing.md` was consulted; update within each milestone for its actual failure/probe/interactive coverage and evidence limits. Remove contradictory E2E shortcuts in the touched instructions if needed to make the prescribed invocation unambiguous.

`docs/domain/cross-agent-hooks.md` was consulted; update in Milestones 1 and 3 for conservative registration, effective Codex home, relocation and registration-versus-runtime evidence. Keep Codex runtime status unchanged and avoid unrelated catalog refresh. No new domain subsystem or document is necessary.

## Related Findings


Read `docs/findings/index.md` and all six category files: `knowledge-gaps.md`, `code-quality.md`, `test-gaps.md`, `stale-docs.md`, `tooling-friction.md`, and `process-feedback.md`. Also read `docs/findings/codex-portability-readiness.md`.

The standalone readiness finding is addressed only for registrar shape/ownership/writes, global state/home identity and deletion. Runtime result policy, turn state and handoff remain unresolved for later runtime work; do not remove the entire compound finding when registration closes.

The test-gaps finding `Agent adapter tests do not isolate turn-state storage per test` constrains default-Claude regression verification. When that suite is used, assign a fresh `CLOOKS_HOME_ROOT` per test and restore previous values after each test; include that narrow harness correction with Milestone 3 if still necessary. Do not hide its stderr assertion or infer a production bug.

Knowledge-gaps' permission-failure fixture guidance requires failures on the relevant parent directory and restoration of modes in `finally`. Tooling-friction's compile-without-typecheck finding requires `bun run typecheck`; its disposable live-Codex auth finding is outside this plan's prerequisites. Process-feedback's full test blast-radius finding requires both unit and compiled-binary journeys per milestone. Unrelated marketplace types, Claude catalog counts and README findings are deferred.

During future implementation, dispatch findings logging to a background subagent under the index procedure, with a narrow write scope. During this plan-only task, report findings to the parent instead of writing other files. Review and remove only resolved portions after evidence is accepted.

## Plan of Work


Implement three milestones sequentially after draft review. Each leaves independently observable working behavior and includes tests and knowledge updates. Milestone 2 uses Milestone 1's non-destructive readers/writers; Milestone 3 extends global cleanup to effective and recorded Codex homes. No runtime-contract refresh gates C1; contract refresh gates D, and actual native activity/exactly-once evidence belongs to D/E.

### Milestone 1: Preserve Registration Data and Commit Complete Files


Change `readHooksFile()`, `getHooksObject()`, `registerCodexClooks()`, `unregisterCodexClooks()` and detection in `src/agents/codex/settings.ts`. Existing nonempty files must parse to non-array objects; a present `hooks` must be an object and a present managed-event value must be an array. Missing containers and empty/whitespace files retain initialization compatibility. Validate the group/hook containers that will be traversed before transforming anything; malformed groups must never be dropped or silently treated as no registration. Errors name the file and invalid field, with repair-and-retry guidance. Unknown event values that are not traversed stay opaque and byte-equivalent as JSON values. For deletion inspection, ambiguous unknown-event registrations prevent deletion rather than justify erasing an event outside the agreed catalog.

Implement exact ownership recognition for the generated POSIX forms. Require a command hook object and a whole command matching the supported assignment order, quoted absolute executable suffix and, for project form, a matching project-root assignment. Decode only the quoting emitted by `quotePosixSingleArg`; never evaluate shell text. Accept the existing generated global/legacy form without a project-root assignment so old-path re-init remains possible. Reject echo/printf mentions, comments, prefix/suffix text, wrong agent values, additional commands, redirects, pipes, arguments, mismatched root/executable pairs and non-command hook types. A quote or shell punctuation inside a properly quoted path is literal data, not an extra command. Preserve unrecognized commands as user-owned; do not broaden ownership to satisfy the old extra-argument test.

Preserve every untouched group, including empty unrelated groups and unknown group fields. Remove individual owned hooks from mixed groups, dropping a group only when removing owned hooks actually made it empty. Codex init still converges duplicates to exactly one managed command per each of the ten events. Apply the minimal equivalent validation, exact recognition of existing Claude generated/legacy command forms, and mixed-group preservation to `src/settings.ts`, because full deletion depends on it. Do not expand either event set or redefine successful Claude registration output.

Replace direct destination `writeFileSync()` for both registrars with `src/registration-file.ts`: serialize fully before touching disk, create an exclusive temporary file in the destination directory, write/close it, preserve existing file mode, and rename over the destination. Clean up this attempt's temporary file on failure. No-op operations do not rewrite bytes. Validate before creating output directories. Reject mutation of a destination symlink using `lstat`, including dangling links, with a path-specific error; leave link and target bytes unchanged. Do not replace the symlink or follow it for writes. Atomic replacement means readers see old or complete new JSON; it does not promise power-loss durability or coordinate simultaneous independent writers.

Unit coverage in both settings suites and new `src/registration-file.test.ts` must include root null/array/scalar, invalid hooks map, invalid event array and traversed group/hook containers, invalid syntax, empty file compatibility, unknown fields/events, mixed and empty unrelated groups, exact legacy migration, duplicate convergence, false positives, symlinks and quoted paths with apostrophes/spaces/metacharacters. The global-shaped old-path fixture around `src/agents/codex/settings.test.ts:190` is actual supported history; the reversed assignment order plus `--extra` around line 428 is a broad old test expectation to correct, not a generated historical form. Assert whole-file bytes unchanged on validation failure and no-op. Inject temporary creation, write, close and rename failures through the internal filesystem dependency; prove destination bytes and mode survive and only this attempt's temporary file is cleaned. Test first-create failure leaves no destination and retry succeeds.

Extend `test/e2e/codex-registration.e2e.test.ts` and appropriate Claude init/uninstall journeys with the same destructive-input and false-positive cases through the compiled CLI, including JSON error envelopes and unrelated data preservation. Use non-root parent permission failures for real write failure, restore modes in `finally`, and retry successfully. A concurrent reader during repeated large CLI updates may see only complete old/new JSON; use positive observations and deterministic completion, not sleep-only race assertions. Unit injection is the precise proof for each write stage; compiled-binary failure/retry is its integration proof. Update CLI, cross-agent and testing domain docs in this milestone. Run its focused unit commands, typecheck and `bun run test:e2e`; code review and QA must accept preservation and retry before Milestone 2.

Include relocation in this milestone's builder units and compiled registration/command smoke. Copy initialized checkout A into B while A still exists. Execute the old registration with a local PATH probe to establish that it targets A, re-init B using the compiled CLI, then execute B's newly read command from B and its subdirectory and observe B only. Preserve A's registration bytes; repeat with old A moved away. Keep absolute command representation and the documented requirement to re-init before activation after clone/move. Cover worktrees, nested Clooks roots, non-git projects, and quoted paths without substituting git-root discovery. Retain default-Claude fresh-clone regression. Probe environment tests must record that project registration sets its explicit root, global registration preserves an intentional inherited `CLOOKS_PROJECT_ROOT`, and currently also inherits `CLAUDE_PROJECT_DIR`; the latter remains a documented D issue. No production discovery or launcher environment clearing is part of C1. Update `docs/domain/bash-entrypoint.md` for this relocation and environment evidence in this milestone, not at closure.

### Milestone 2: Decide Deletion Before Selecting Cleanup


Refactor only the decision/execution portions of `uninstallProject()` and `uninstallGlobal()` in `src/commands/uninstall.ts`. Replace `agentsForAction(agent, opts)` with a helper based on final `shouldDelete`, retaining selected-agent behavior for unhook-only. Collect all decisions before writes. If deletion is requested, inspect both agents' registrations, regardless of the initial selector, and explain/confirm the additional cleanup when it was not already authorized. A previously declined unhook requires explicit consent to that cleanup before deletion. Decline or cancellation of required cleanup prevents deletion and leaves all files unchanged. Force `--full` remains authorization for both agents in the explicit project/global scope.

Preflight every file needed for deletion before unregistering any agent. Malformed other-agent JSON is an error, not absence. Validate again when writing and inspect remaining owned registrations before `rmSync()`. Detection currently scans all events while unregistration only handles known events: if an owned command exists on an unknown event, refuse shared-directory deletion with its path/event rather than leave it dangling or expand event coverage. Keep normal unhook-only limited to selected agents; malformed unselected-agent data must not prevent an otherwise independent selected-agent unhook.

If the first unregister succeeds and the second write fails, return an error, retain `.clooks` and custom hooks, and permit retry. Do not promise multi-file rollback. Global flag removal follows each corresponding successful unhook, including stale selected flags when the registration file is absent; failure to clear required state prevents full deletion. Keep JSON `eventsRemoved` and `nonClooksPreserved` as Claude aliases, requested `agent`/`agents` meanings stable, and actual per-agent counts accurate. When Milestone 3 cleans more than one known Codex home, union removed event names in registration-event order and sum preserved-group counts across distinct files. Human widening explanation must reflect interactive deletion too, not only the literal `--full` flag.

These guarantees apply within one project or global scope. Preserve the existing sequential `both` dispatcher: completed project cleanup survives later global cancellation or failure. Scope-qualified no-change messages and a regression must make this explicit. Count remaining groups for each validated action agent even if no hooks were removed; unselected-agent counts and legacy aliases retain their meaning.

Extend `src/commands/uninstall.test.ts` across project/global, Claude-only/Codex-only/both, either initial selector, force full and interactive deletion. Cover no selected registration but other agent registered; decline unhook then accept delete; accept selected unhook then decline other-agent cleanup; cancel every prompt; malformed other-agent file; unknown-event owned command; failure in the second cleanup; failed flag removal; no-op and retry. Assert bytes, directory existence and custom hook contents, not only mocked calls or output text.

Add test-only `expect` to the existing package install in `test/Dockerfile` (parent verified it currently installs only git). Add a small timed driver `test/e2e/helpers/uninstall-prompts.exp` invoked from `uninstall-journey.e2e.test.ts`; spawn the compiled binary in a real PTY with sandbox environment, match prompts before sending answers, capture transcript, and fail on timeout/unexpected exit. Cover two fixtures: project with both agents, including decline-unhook/approve-delete then explicit all-agent confirmation (accept and cancel variants); global with only the OTHER agent registered, where the selected-agent unhook prompt is absent and deletion requires all-agent confirmation. Cancellation asserts exact registration bytes and runtime contents unchanged. Keep the wider decision matrix in mocked units and compiled `--full` equivalent smoke, including malformed other-agent and second-write failure. Do not claim forced smoke covers interactive input. No production TTY bypass or general test-infrastructure rewrite. Update CLI/testing docs; run focused units, typecheck and `bun run test:e2e`, then review and QA.

### Milestone 3: Associate Suppression With Successful Registration and Its Home


Selected Codex/all setup must retire an existing matching receipt after atomic recovery tracking and before touching the shared launcher. Tracking failure leaves the prior receipt and launcher untouched; retirement failure leaves cleanup identity and aborts before shared setup. Once setup begins, failure favors project execution until successful retry republishes the receipt. Read-only identity rejection must preserve registration/state/launcher bytes and modes. Claude-only setup remains independent of Codex state and may restore an existing matching Codex receipt by repairing the shared launcher, including before a later Claude registration failure; explicitly test and document this bounded exception. Post-failure probes must restore the normal PATH so a failing checksum stub cannot hide an incorrectly eligible old receipt.

Add `resolveCodexHome(homeRoot, env)` in `src/agents/codex/settings.ts`. For global registration/unregistration use nonempty `CODEX_HOME`, otherwise `join(homeRoot, '.codex')`. A nonempty override must be absolute and contain no CR/LF; reject invalid overrides before any init/uninstall writes, with an error requesting an absolute path. This is a Clooks registration constraint, not a claim about Codex's treatment of relative paths. Canonicalize existing paths with filesystem `realpath`; for a not-yet-created directory, canonicalize its nearest existing ancestor and append the missing path components, without creating directories during resolution. This handles directory symlink aliases consistently. Project files remain `<project>/.codex/hooks.json` regardless of `CODEX_HOME`. Keep the shared launcher at `<user-home>/.clooks/bin/entrypoint.sh`; `CODEX_HOME` selects Codex state, not Clooks config storage. Render actual custom paths in both human output and existing created/updated/skipped strings. Never write literal `~/.codex` when the custom path was used.

Move global suppression publication in `initGlobal()` to after the respective registrar's successful commit and executable launcher creation. `--agent all` may leave a successful Claude registration if Codex fails, but must not publish Codex success state. Before any Codex registration mutation, atomically record its canonical home in `<HOME>/.clooks/.codex-registration-home`, exactly two LF-terminated lines: `clooks-codex-home-v1` and the absolute canonical Codex home. This recovery record is never consulted for project suppression; it safely retains cleanup identity even if registration or subsequent receipt publication fails. Failure to persist it aborts before changing Codex hooks. A receipt, in contrast, means the small persisted record of completed registration described next. Neither is an authorization record. In `DEDUP_CHECK`, an absent, malformed, legacy-unverifiable, mismatched-home, missing-launcher or detectably stale receipt must not suppress the project. Leave legacy Claude default behavior intact except the demonstrated early-publication defect; any stronger Claude receipt migration needs a separate scope decision.

Use one receipt at `<HOME>/.clooks/.global-entrypoint-active.codex`. Its exact four LF-terminated lines are the literal `clooks-codex-registration-v1`, canonical installation home, canonical Codex home, and `<crc>:<byteCount>`. The last line comes from POSIX `cksum` over the complete committed `hooks.json` bytes using stdin, so filenames never enter checksum output. Require exactly four lines, absolute home paths with no CR/LF, and decimal checksum/count fields. Never source or evaluate this file. This checksum detects incidental stale file contents; it is not a cryptographic integrity check or an authorization mechanism. The expected launcher is derived from the recorded installation home, not stored as an arbitrary command.

Implement receipt parsing/publication in `src/registration-state.ts`. Use Bun subprocess APIs to execute `cksum` without a shell when publishing, validate its numeric output and status, and publish with the atomic file helper only after the registrar and executable launcher succeed. A checksum or receipt-write failure returns an init error, leaves committed registration recoverable, and publishes no new eligible receipt. In generated bash, use guarded subshell `cd -P`/`pwd -P` to canonicalize existing HOME/Codex directories, four `IFS= read -r` calls plus an EOF check to parse the receipt, and `cksum < hooks.json` with numeric-output checks. Verify home identity, executable launcher, readable regular hooks file, and checksum equality before yielding. Every failed check or missing utility falls through to project execution rather than exits successfully as a dedup no-op. Guard failures explicitly against `set -euo pipefail`. POSIX `cksum`, bash and physical directory resolution are the only added launcher requirements; test the checksum shape against fixed bytes and shell/TypeScript agreement. A changed unrelated hook also invalidates the receipt: this deliberately favors extra execution until re-init over suppression based on stale state.

Support one recorded global Codex home per installation HOME. Before any global Codex/all init writes, inspect both the recovery record and receipt. Either identifying a different home causes an actionable error: unhook that recorded home before initializing another. Conflicting identities or malformed nonempty records require repair without writes. Do not overwrite identity and lose the only cleanup reference. An empty legacy Codex flag identifies the historically hard-coded default `HOME/.codex`; it never suppresses a newly generated project script, and default-home re-init writes the recovery record before upgrading it. Switching from that legacy default to a custom home first requires default-home unhook. Same-home re-init may replace a stale checksum receipt after validating and committing registration. Failed registration/publication leaves its recovery record so a switch cannot bypass cleanup; explicit same-home unhook clears it even if hooks were never created, once inspection proves no references. Older project scripts still check only receipt-file existence: users must re-run project init as well as global init to obtain corrected dedup behavior. The new recovery filename cannot accidentally trigger those legacy checks. Do not claim to migrate every checkout automatically.

Keep `CLOOKS_HOME_ROOT` as the existing runtime config/state override, not a replacement for `$HOME` in install/uninstall. For receipt eligibility, an unset override is allowed; a set override must be a nonempty absolute existing directory that canonicalizes to the installation home. Any other value conservatively disables project suppression without changing engine interpretation. Test unset, empty, relative, same-home symlink and differing values. Invalid/relative `CODEX_HOME` during project launcher execution likewise makes suppression ineligible; global CLI registration reports the path error described above. Do not clear inherited environment or redesign runtime discovery.

Global full deletion uses the effective Codex home and the home named by the recovery record/receipt, because each is a known reference to the shared launcher. An empty legacy flag adds the default Codex home to this bounded set. Preflight and deduplicate these paths; malformed/unreadable records, conflicting recorded identities or referenced state block deletion. The all-agent cleanup confirmation names these paths before mutation. Unhook-only in home B neither mutates home A nor erases A's state. After unregistration, inspect all event entries for remaining owned commands before clearing the matching recovery record or receipt. Unknown-event references are not automatically removed: return a path/event-specific error and retain identity until the user removes them, so a switch cannot bypass cleanup. A missing hooks file has no remaining references and allows matching state cleanup. A legacy empty flag is removed only with default-home unhook and the same remaining-reference check. If state removal partly fails, retained state must still identify the home and retry must work. Do not scan arbitrary directories or claim discovery of every historical home: older unrecorded homes require explicit `CODEX_HOME=<old-home>` unhook before deleting the shared runtime. This bounded policy adds no many-home registry.

No receipt can establish that Codex will fire a command: external disable/review settings or a non-running host remain unknowable from the record. A smoke scenario with valid persisted state and a simulated inactive global launcher must explicitly record this limitation; it is not a passing exactly-once/activation assertion. Recovery is to enable/review the native global hook externally or unhook the global registration with the matching environment so project registration can run. Do not copy trust state or change Clooks permission policy.

Unit coverage belongs in Codex settings, init, uninstall and `src/registration-state.test.ts`, with generated-script checks in existing entrypoint E2E. Cover no receipt, stale existing receipt after failed init, failed recovery-record write before registration, failed publication after registration commit, per-agent partial `all`, failed unregister, missing global script, changed registration, custom/default homes, A/B mismatches, rejected cross-home re-init without writes, explicit unhook then home switch, active-plus-recorded full cleanup, malformed/conflicting/legacy records, path aliases and invalid path values, missing/failing checksum utility, mismatched `CLOOKS_HOME_ROOT`, and rerun recovery. Require the compound regression sequences: registration in A commits but receipt publication fails, attempted init B is rejected, full cleanup from B inspects A; and unknown-event reference in A survives unhook, A's identity remains, switch to B is rejected until explicit cleanup. Repeat both sequences through compiled CLI smoke. To fail publication deterministically after registration commit, prepend an isolated test `cksum` executable that exits nonzero to that subprocess's PATH; restore the normal PATH for cleanup/retry. Precise receipt-write/rename failures remain unit fault-injection cases; do not race a chmod against running init or add a production test flag. Failure before registration commit preserves existing JSON bytes and creates no newly eligible suppression state; an old matching receipt may remain eligible only while its original committed hooks file and launcher still satisfy every check.

Docker E2E must run compiled init/uninstall for each home and failure case, then actually invoke the generated project/global shell commands with a sandbox PATH probe that counts calls and reports agent, roots, cwd and stdin. Establish a positive invocation baseline, demonstrate same-agent matching suppression, and demonstrate no suppression across agents/homes or failed new setup. With the real compiled binary and Claude fixtures, retain the global home/project/local merge, ordering, shadow and local-override regression in `home-dir`/`config-layering` suites. Probe counts establish shell behavior only, not real Codex execution. Update global-hooks, entrypoint, CLI, cross-agent and testing domain docs; run focused units, typecheck and `bun run test:e2e`, review and QA.

## Delegation and Review Process


The parent delegates one implementation milestone at a time to a subagent with this plan, exact owned paths, constraints and acceptance commands. That implementer updates Progress before code, adds tests with the fix, updates domain knowledge afterward in the same milestone, and reports changes, actual command results, residual risks and deviations. No next milestone starts while the current one has unresolved code-review or QA findings.

After implementation, delegate independent code review of the diff and interfaces, then QA verification of the regression scenarios and actual compiled-binary evidence. Route requested corrections back to the same milestone, rerun affected checks, and repeat the gate as needed. Review includes failure preservation, default Claude regression, unknown data, public surface and mismatch cases, not just a green unit suite. Record reviewer disposition and actual commands in this file. Parent updates the epic and ATTENTION, including danger-zone changes before implementation. Do not assign those files to a worker whose scope excludes them.

Before closure of every milestone, compare final signatures, defaults, precedence and control flow against Interfaces and these milestone instructions. Record structural deviations and reasons in Surprises & Discoveries and Decision Log, and revise all affected sections before claiming completion. Documentation is part of each milestone's acceptance. An unavailable Docker engine or unimplemented PTY test is an unresolved QA gate, not permission to skip it.

At final closure the parent supplies a final-summary subagent with accepted milestone reports, reviewer/QA outcomes, exact verification results, scope and limitations. That subagent performs no lookup, browsing, code reads or new verification; it summarizes supplied evidence only. It must not infer live Codex support from probes. The parent incorporates the report in Outcomes & Retrospective and sends the final user report.

## Concrete Steps


All commands run from `/opt/development/clooks`. Implementers first read this file, `CLAUDE.md`, `docs/plans/PLANS.md`, the affected domain docs and current diff, then update this plan before editing. Do not reset parent changes, regenerate unrelated artifacts, commit unrelated files or deploy the binary.

Milestone 1 unit command:

    bun test src/registration-file.test.ts src/agents/codex/settings.test.ts src/settings.test.ts

Milestone 2 unit command:

    bun run test:e2e src/commands/uninstall.test.ts src/settings.test.ts src/agents/codex/settings.test.ts

This script forwards the paths to the existing Docker entrypoint, so these remain unit tests but execute inside the disposable container. This honors the user's uninstall-testing boundary without adding a harness bypass or changing the installed binary. Still run the unfiltered command separately for actual E2E coverage.

Milestone 3 unit command (give the existing engine suite fresh per-test state roots before running it, as specified in Related Findings):

    bun run test:e2e src/registration-state.test.ts src/commands/init.test.ts src/commands/uninstall.test.ts src/agents/codex/settings.test.ts src/settings.test.ts src/engine/run.agent-adapter.test.ts

Each milestone also runs:

    bun run typecheck
    bun run test:e2e

The Docker command builds and executes the compiled binary tests. Do not call E2E via `bun test`, `test:e2e:run`, or an environment-guard bypass, even if older plan examples do so. If needed diagnose the engine with `docker ps`, then start the engine or report the specific operational block; do not declare Docker unsupported. At final gate run the full units via `bun run test:e2e src/` rather than host `bun run test`, plus `bun run typecheck`, `bun run lint:all`, and unfiltered `bun run test:e2e`; record actual results and resolve failures attributable to this work. This preserves the user's Docker-only init/uninstall-testing boundary. Never predict a final test count. Avoid repeating unchanged successful checks without a new reason.

Within Docker tests use the compiled `sandbox.run()` interface with these representative argument sequences, appending `--json` for envelope assertions:

    init --agent codex
    init --agent all
    init --global --agent codex
    uninstall --project --agent codex --unhook --force
    uninstall --project --agent codex --full --force
    uninstall --global --agent codex --unhook --force
    config --resolved --json

These are subprocess argument examples, not instructions to invoke a user's installed `clooks`. Use per-invocation sandbox environment objects with isolated `HOME`, `CODEX_HOME` and `CLOOKS_HOME_ROOT`, plus explicit provider/root settings for the case. For units, allocate temporary homes per test and restore inherited environment and mocks in `afterEach`; avoid suite-only overrides. A mismatch test uses separate disposable installation, Codex state and runtime state homes. Never use or replace the real global binary, never run `deploy:local`, and never read/copy real auth or trust state.

## Validation and Acceptance


Every fix requires unit and compiled-binary Docker E2E or smoke coverage through `bun run test:e2e`, using isolated temporary homes. Never run `deploy:local` or replace a global binary.

An invalid registration input produces exit 1 with a path-specific CLI error (`ok:false` in JSON mode), while its exact original bytes survive. A failed atomic write leaves old valid bytes or no newly created destination, removes its own temporary file, and succeeds on retry once the fault is removed. Successful re-init produces one managed Codex command per event, preserving unrelated values; subsequent no-op preserves the whole file bytes. Successful changes may reformat JSON, so semantic preservation of unknown values and byte preservation on rejection/no-op are distinct assertions.

Deletion acceptance requires inspection and successful cleanup of all known references to the shared launcher. Cancellation, refused required cleanup, invalid other-agent data, unresolved unknown-event references or write failure must leave `.clooks` intact. Cancellation before execution leaves all registrations byte-identical. A late multi-file failure may leave an earlier successful unhook committed; the error and retained runtime must make retry possible. Selected unhook retains the other agent and shared directory.

Registration-state acceptance requires no newly eligible receipt after failed selected-Codex/all registration, consistent effective Codex home through init/uninstall/shell for traversable original paths, and positive probe evidence that stale or mismatched state cannot silently suppress project launch. Claude-only shared-launcher repair retains the bounded exception recorded above. Successful controlled global/project coexistence yields the expected single probe invocation only in the exercised same-home setup. It proves neither upstream scheduling nor native activity. A simulated disabled/unreviewed native global hook may still not run with persisted state; report the limit and recovery, not an invented guarantee.

Relocation acceptance requires re-init in B to remove the old A paths while A still exists, and default Claude to retain generated registration, discovery and real hook output. Environment probes assert existing forwarding behavior, including deliberate Clooks overrides; C1 does not fix inherited Claude anchors. No test may pass solely because stdout is empty: assert an earlier positive baseline, a marker count, a parsed envelope or a captured execution.

The ten Codex events remain `SessionStart`, `SubagentStart`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `UserPromptSubmit`, `SubagentStop`, and `Stop`. Registration of ten names is not validation of ten output contracts. Live model/auth checks and output-contract refresh remain later runtime/release work.

## Idempotence and Recovery


Rerun init after repairing the named malformed file or restoring write access; never advise automatically deleting user JSON. Preserve a user backup before manual repair. Missing registration files initialize normally; unchanged valid registrations do not rewrite. Temporary files use unique names in the destination directory and are never shared between attempts. Clean only this attempt's file, not other writers' files. Power-loss durability, concurrent writer conflict merging, and arbitrary stale temporary cleanup are outside the atomic-visibility guarantee and must not be claimed.

On multi-agent partial failure, retain `.clooks`; rerun the same explicit scope/agent command after repair. Each successful unregister is idempotent. On a native activation issue, review/enable the native hook externally or unhook the matching global registration to restore project eligibility. No receipt grants permission or proves active runtime.

For relocation, run compiled or installed Clooks init intentionally in the new checkout before enabling its Codex project hooks. Tests must use only the compiled sandbox CLI. Known alternate Codex homes require cleanup with their explicit environment before shared global runtime deletion; do not recursively search the user's home. Preserve the established `SKIP_CLOOKS=true` bypass and missing-binary bootstrap behavior.

Tests restore permissions in `finally`, restore environment, close subprocesses, and clean all temporary project/home/probe/PTY artifacts. A cancelled test subprocess must be terminated and awaited. Do not touch real homes, global hooks, credentials, system binaries, or parent-owned files.

## Artifacts and Notes


Milestone 3 final E2E validation: unfiltered `bun run test:e2e` passed 600 tests, zero failures and 5,285 assertions across 44 files in 73.62 seconds. This includes the final timestamp-only eligibility assertion, generated launcher probes, recovery sequences, pathful PTY cleanup and real Claude merged execution. Independent code review approved the complete source including the checksum deadline; independent QA gave unconditional GO on the final evidence. All init/uninstall and test execution stayed in disposable Docker; no global deployment or real-home modification occurred.

Milestone 3 deviation check: public registrar/CLI surfaces and the planned state API are unchanged. The CLI explicitly composes tracking then receipt retirement before launcher repair; the resolver walks physical prefixes to preserve symlink-parent semantics; the checksum subprocess has a ten-second bound. The registration test wrapper adds bounded isolated subprocesses without changing the general sandbox or Docker harness. These refinements are recorded in Decisions and Surprises. Claude default behavior, configuration merging, event catalogs and runtime placeholder are preserved.

Milestone 3 documentation inventory: global-hooks records exact state formats, physical homes and cleanup ordering; bash-entrypoint records receipt eligibility, migration, file checks and fallback; cli-architecture records setup/cleanup ordering, selected/recorded paths and scope/count compatibility; cross-agent-hooks records implemented registration versus unsupported runtime and native-activation limits; testing records unit fault coverage, isolated state, positive probes, checksum metadata independence, PTY journeys and Docker-only execution. The plan, epic, active and archived ATTENTION, and findings record closure. README remains unchanged. Newly archived planning files and any untracked findings need deliberate `git add -f`; tracked edits do not need force-add merely because their directory is ignored.

Milestone 3 final full-unit validation: `bun run test:e2e src/` passed 1,957 tests with zero failures and 6,926 assertions across 63 files in 3.05 seconds. The final checksum timeout/error tests and Docker FIFO cases are included. Final typecheck, format check, lint and ShellCheck passed, with 112 existing lint warnings and no errors. This is test evidence, not a new coverage-threshold result; the previously logged unchanged-fixture threshold issue remains open.

Milestone 3 candidate verification: the six focused unit suites passed 443 tests, zero failures and 2,347 assertions after physical-parent resolver correction. The targeted `codex-registration`, `entrypoint`, `uninstall-journey`, `init-journey`, `home-dir`, and `config-layering` E2E suites passed 238 tests, zero failures and 3,852 assertions in 36.63 seconds. Both commands ran through `bun run test:e2e` inside disposable Docker. These precede the final checksum deadline and timestamp-only assertion; final validation is recorded separately below. Typecheck, format check, lint and ShellCheck passed; lint reported the existing 112 warnings and no errors.

Milestone 3 starts from `0e5ac55`; only unrelated `TODO.md` was untracked. Prior committed validation is 1,830 full unit tests passing in Docker and 510 full E2E tests passing. These are baseline records, not new Milestone 3 results. The fixture coverage-threshold issue below remains out of scope.

Commit validation, 2026-09-07: full unit coverage inside Docker passed 1,830 tests with 6,309 assertions. Repeating with repository `bunfig.toml` mounted read-only still passed all tests but exited 1 for per-file function coverage below 50% in unchanged hook fixtures (`allow-all.ts`, `harness-lifecycle-block.ts`, `harness-lifecycle-skip.ts`, each 33.33%). This is not a test failure or a claim that the coverage gate passed. Log the fixture/threshold friction separately; do not change unrelated fixture behavior or lower thresholds. Exclude only the host coverage hook for the requested commit, preserving the Docker-only uninstall boundary and running the remaining commit hooks.

Milestone 2 baseline: `bun run test:e2e src/commands/uninstall.test.ts` built and ran only the existing uninstall unit suite inside Docker, with 63 pass, 0 fail and 149 assertions. Argument forwarding was observed in the emitted Docker command. No host uninstall or global build ran.

Milestone 2 final validation: `bun run test:e2e test/e2e/uninstall-journey.e2e.test.ts` passed 44 tests with 566 assertions in 6.49 seconds, including real PTY consent/refusal/cancellation. `bun run test:e2e src/commands/uninstall.test.ts src/settings.test.ts src/agents/codex/settings.test.ts` passed 231 tests with 1,321 assertions. The unfiltered `bun run test:e2e` passed 510 tests across 44 files with 3,117 assertions in 55.15 seconds. Code reviewer and QA approved the finished implementation and tests. Typecheck and formatting passed after correcting transient mock casts, converting the Claude event Set for catalog comparison, and formatting the two changed source files. Lint and ShellCheck passed with 112 existing warnings and no errors. No uninstall tests ran on the host.

Milestone 2 documentation: CLI architecture now explains final-decision cleanup, explicit additional consent, validated all-agent deletion, selected-agent independence, unknown-event refusal, partial file/state failure, actual counts and sequential scope behavior. Testing documents test-only Docker Expect, fixed-width real PTY prompt matching, deadlines/child reaping, isolated environments, file assertions and evidence limits, plus forwarded Docker unit-test commands. Plan, epic, ATTENTION and findings track completion and the still-pending active-home/runtime work. README and the other domain documents were not newly changed in this milestone; earlier worktree modifications remain intact. No files were staged or committed.

Milestone 1 baseline: `bun test src/agents/codex/settings.test.ts src/settings.test.ts` passed 42 tests with 327 assertions before source edits. Docker socket access required sandbox escalation; `docker ps` then confirmed a running daemon. Baseline `bun run test:e2e` passed 421 tests across 44 files with 1,764 assertions in 46.63 seconds. Source/test diff remained empty at completion. The Docker entrypoint compiles inside the container and does not replace the installed binary.

Milestone 1 final validation, 2026-09-07:

    bun test src/registration-file.test.ts src/agents/codex/settings.test.ts src/settings.test.ts src/commands/init.test.ts src/commands/uninstall.test.ts
    266 pass, 0 fail, 1333 assertions, 5 files

    bun run test:e2e
    477 pass, 0 fail, 2560 assertions, 44 files, 46.22 seconds

    bun run typecheck
    exit 0
    bun run format:check
    all matched files use Prettier code style
    bun run lint:all
    exit 0; 0 errors, 112 existing warnings in untouched files; ShellCheck passed
    git diff --check
    no whitespace errors

The final Docker run includes 56 more tests than the baseline. The concurrent-reader case is stress evidence and its assertion count can vary by scheduling; deterministic failure cases cover writer stages in units. The earlier candidate Docker run also passed 477 tests before the final executable-path assertions were strengthened. Neither run invokes live Codex.

Independent code review accepted the atomic helper and full production diff. QA requested direct mixed-group unregistration, noncanonical no-op bytes/inode checks, command-shaped negatives that reach the matcher, validation beyond an early owned match, descriptor closure/partial writes, and complete executable-path assertions for relocation. All were added. Both reviewers extended approval to the final initial-permission correction and its pre-write test. Formatter and lint initially found six unformatted changed files and one unnecessary regex escape; both were corrected without unrelated changes. A transient test-helper syntax error during parallel edits was corrected before final typecheck/Docker validation.

Milestone 1 documentation inventory: CLI architecture describes shared strict reads, scope-aware ownership, per-file atomic replacement, and preserved JSON aliases; bash entrypoint documents absolute-path relocation and inherited-environment/Claude quoting limits; cross-agent hooks records preservation rules and unchanged runtime limitations; testing documents fault tests, probe provenance, isolated homes and Docker-only execution. The epic, ATTENTION and this plan tracked that gate. Its findings review retained dedup/home/deletion/runtime issues and the existing Claude raw-global-path execution limitation; the deletion subset was subsequently resolved in Milestone 2 as recorded above. README, schemas, engine/adapters and global installations were not changed. No commit or staging was performed.

For each implemented milestone append concise actual evidence here: regression test name and before/after outcome, relevant byte-equality assertion, compiled-binary command result, shell probe count/environment where applicable, code review disposition, QA disposition and affected domain updates. Do not copy full logs or claim commands listed above have already run.

Expected evidence shapes, not observed results:

    malformed hooks container -> exit 1, ok:false, original bytes identical
    injected rename failure -> old bytes intact, own temporary file absent, retry succeeds
    interactive cleanup cancellation -> runtime exists, registration bytes identical
    CODEX_HOME B with receipt for A -> project probe invoked
    new clone B after re-init, old clone A present -> probe root B, A bytes unchanged
    default Claude -> real hook marker and expected Claude JSON

Planning evidence: the QA sidecar verified the existing sandbox cannot exercise terminal prompts with piped input and recommended a bounded Expect driver. Product review identified residual native-activation, relocation and research-gating overpromises; the epic and continuation review were corrected. A replacement code reviewer found no blockers in Milestones 1 and 2 against the actual registrar/uninstall source. The first drafting and code-review agents stopped at a usage limit, so the parent completed the receipt decisions and removed the obsolete discovery milestone. Final whole-plan review remains a separate progress gate; these reports are not implementation test results.

## Interfaces and Dependencies


Keep existing exports and return shapes in `src/agents/codex/settings.ts`:

    quotePosixSingleArg(value: string): string
    makeCodexProjectEntrypointCommand(projectRoot: string): string
    makeCodexGlobalEntrypointCommand(homeRoot: string): string
    isCodexClooksHook(hook: unknown): boolean
    registerCodexClooks(codexDir: string, entrypointCommand: string): CodexRegisterResult
    unregisterCodexClooks(codexDir: string): CodexUnregisterResult
    isCodexClooksRegistered(codexDir: string): boolean

`CodexRegisterResult` retains `added`, `skipped`, `updated` event arrays and `created`; `CodexUnregisterResult` retains `removed`. Detection may throw on invalid file structures so callers cannot equate corruption with absence. `codexDir` always means the directory containing `hooks.json`, not the Clooks home. Retain Claude `RegisterResult`/`UnregisterResult` and registration signatures too. No new package exports, CLI selectors, hook context fields or adapter methods are needed.

Internal Milestone 1 helper in `src/registration-file.ts`:

    type RegistrationFileOps = Pick<typeof import('node:fs'),
      'lstatSync' | 'openSync' | 'writeFileSync' | 'fchmodSync' |
      'closeSync' | 'renameSync' | 'unlinkSync'>
    writeRegistrationFileAtomic(
      path: string, contents: string, ops?: RegistrationFileOps,
    ): void

Default operations use Node filesystem APIs; the optional operations object allows focused fault injection without global module mocks. Registrars create the validated destination parent before calling the writer. Generate a unique same-directory filename, open with `wx`, write by descriptor, preserve the existing permission bits with `fchmodSync`, close, and rename. For new files use ordinary `0o666` filtered by the process umask, matching existing writes. Track descriptor/temp ownership for best-effort cleanup without replacing the original error. Reject symlink/non-regular existing destinations, including dangling symlinks. Callers receive exceptions, not false success. Reuse strict reading for detection and unregister preflight rather than duplicating permissive casts in `countClaudeMatcherGroups()` and `countCodexMatcherGroups()`. Counter output is computed from the validated preserved structure.

For replacement files, the initial `openSync` mode is `previous.mode & 0o777`, so temporary bytes never gain ordinary access permissions absent from the destination. Keep final `fchmodSync(previous.mode & 0o7777)` to restore exact existing bits after the initial umask restriction. The new-file branch still uses `0o666`. Verify the pre-write mode as well as the final mode.

The same module supplies `readRegistrationFile(path: string, events?: readonly string[])`, returning `{ settings: Record<string, unknown>, hooks: Record<string, unknown>, fileExisted: boolean }`. Explicit event lists validate only managed containers for mutation; omitted lists validate all events for inspection/counting. Unknown event values are otherwise preserved. All reads reject existing nonregular destinations, including symlinks. `isClooksHook(hook: unknown, expectedCommand?: string): boolean` additionally recognizes the exact current command supplied by its registrar scope. Register supplies its command argument; unregister/inspection derive the current absolute entrypoint from the settings directory parent. Generic recognition covers the exact Claude project-variable and legacy relative forms, plus a single shell-safe absolute path, without evaluating shell text or treating arbitrary whitespace/extra commands as owned.

Milestone 2 internal decision helper replaces options-based widening:

    agentsForAction(agent: UninstallAgent, shouldDelete: boolean): ConcreteUninstallAgent[]

Its callers collect prompts, establish authorized unhook/delete decisions, preflight all cleanup files, execute unregister, verify no known references, then delete. Counts and widening messages derive from that final action, while existing requested-selector JSON fields retain their meaning. If an internal action object reduces duplicated project/global logic, limit it to these decisions; do not rewrite the entire command framework.

Milestone 3 path interface in `src/agents/codex/settings.ts`:

    resolveCodexHome(
      homeRoot: string,
      env: Record<string, string | undefined>,
    ): string

Use it from global init and uninstall; its absolute physical identity must agree with shell `cd -P`/`pwd -P` for traversable existing directory paths. Resolve existing prefixes before handling parent components. Missing components may cancel lexically without being created, leaving the original spelling untraversable; shell fallback then remains ineligible even if the canonical destination exists. Do not use `CLOOKS_HOME_ROOT` for installation resolution. In `src/registration-state.ts` define:

    interface CodexRegistrationReceipt {
      version: 1
      homeRoot: string
      codexHome: string
      checksum: string // canonical decimal crc:byteCount from POSIX cksum
    }
    type CodexReceiptState =
      | { kind: 'missing' }
      | { kind: 'legacy' }
      | { kind: 'invalid'; reason: string }
      | { kind: 'receipt'; value: CodexRegistrationReceipt }
    readCodexReceipt(homeRoot: string): CodexReceiptState
    publishCodexReceipt(homeRoot: string, codexHome: string): void
    type CodexTrackedHomeState =
      | { kind: 'missing' }
      | { kind: 'invalid'; reason: string }
      | { kind: 'home'; codexHome: string }
    readCodexTrackedHome(homeRoot: string): CodexTrackedHomeState
    trackCodexHome(homeRoot: string, codexHome: string): void
    clearCodexRegistrationState(homeRoot: string, codexHome: string): boolean

The CLI composes `trackCodexHome()` followed by removal of the old, preflighted receipt before shared runtime writes; no additional exported state API is needed. Record old receipt bytes only for created/updated/skipped reporting, never restore suppression after failure. Claude-only init does not perform these Codex operations. Shell file eligibility mirrors CLI readers: receipt and hooks require non-symlink readable regular files; the launcher requires a regular executable file and may itself be a symlink.

Publication uses `Bun.spawnSync` with `timeout: 10_000` and `killSignal: 'SIGKILL'`. Timeout/error/nonzero exit must retain recovery identity and publish no receipt. Test byte freshness independently of timestamp metadata: timestamp-only change remains eligible; same-size changed bytes with restored timestamp do not.

Reading distinguishes absent/empty/malformed receipt states; an empty recovery record is invalid, not legacy. Filesystem errors propagate to CLI callers. Tracking atomically writes the two-line recovery record before hooks mutation. Publication computes the checksum from the successfully committed regular hooks file and atomically writes the four-line receipt. The generated shell ignores the recovery record entirely and treats receipt read/check failures as ineligible suppression. Clearing first validates matching identities and checks the selected hooks file for remaining owned commands across all events; throw with field/path evidence if references or ambiguous malformed event containers remain. Only then remove matching suppression receipt followed by the recovery record, so failure retains cleanup identity. A legacy receipt may clear only for the default home. Invalid state is never silently removed. No new package exports or CLI command are introduced. Keep Claude's legacy flag format; change its publication order only.

Runtime discovery signatures, engine/adapters and public hook types remain unchanged. Dependencies are existing Bun/Node filesystem/path APIs, Commander and prompt wrappers, POSIX `cksum` for receipt freshness, and test-only Docker `expect` for PTY smoke. Never implement a custom checksum algorithm or a general shell parser. `cksum` checks are registration-freshness evidence, not a native-runtime contract.

## Instruction Prompts


Implementation authorization:

> Let's go

Milestone 3 continuation:

> Ok, continue.

Commit instruction:

> ok. Commit. What's next?

Milestone 2 continuation:

> ...start working on it?

User safety concern before continuation:

> Okay. How sure can I be that you wont uninstall clooks on my system lol

Execution constraint: all uninstall test execution stays in disposable Docker containers, using sandbox homes and projects. Do not invoke the host-installed uninstall command, modify real agent/Clooks homes, or deploy a global binary.


Continuation prompt, recorded before completing the interrupted draft:

> Keep going


Exact current user prompt supplied by the parent:

> So, what now? You want to plan the first part? Kick it off with a subagent?

Binding earlier prompts, verbatim:

> When using clooks, you should assume you can trust the repo. We can tighten permission models down the line. This is not a discussion for now.

> Okay. All of those should have sufficient tests, including e2e or smoke tests as well.
>
> What do you mean about the principle decision? I need more context. We should not upheave groundwork we've done on the fly.

Revision note (2026-09-07, Joe-Degler): Created skeleton immediately after reading the plan process, recording the supplied prompts before further research.

Revision note (2026-09-07, Joe-Degler): Completed the interrupted draft with three milestones, explicit receipt/home-switching and atomic-write interfaces, and a bounded PTY test dependency. Removed the obsolete production-discovery milestone to match the epic and trusted-repository scope. No code, tests, or runtime verification was performed.

Revision note (2026-09-07, Joe-Degler): Independent whole-plan review identified lost cleanup identity after receipt-publication failure or unknown-event partial unhook. Added a distinct pre-write single-home recovery record, all-event remaining-reference checks, and compound unit/compiled-smoke regressions. QA found no blockers in the preceding test strategy; these additions require final re-review.

Revision note (2026-09-07, Joe-Degler): Final code-plan re-review accepted both recovery fixes; QA accepted the deterministic checksum-stub smoke strategy. Marked planning complete without claiming implementation/test execution, retained unresolved source findings, and recorded current versus future documentation scope.

Revision note (2026-09-07, Joe-Degler): Recorded implementation authorization and delegated Milestone 1 with baseline validation. Existing worktree changes are preserved; later milestone behavior and runtime support remain outside this implementation gate.

Revision note (2026-09-07, Joe-Degler): Implemented Milestone 1 through separate registrar/unit/docs and E2E workers with disjoint ownership. Recorded internal reader/scoped-detector interfaces, independent review corrections and final validation results. Milestone closure awaits final QA and no-lookup documentation summary; later milestones remain untouched.

Revision note (2026-09-07, Joe-Degler): Closed the Milestone 1 code, QA and validation gate after correcting initial temporary-file permissions and rerunning units, Docker E2E, typecheck, formatting and lint. Recorded actual final evidence and same-milestone documentation. Milestones 2 and 3 remain unimplemented; no runtime activation or global installation changes were made.

Revision note (2026-09-07, Joe-Degler): Started Milestone 2 after explicit continuation. Recorded the Docker-only uninstall boundary, delegated disjoint production/unit/domain and PTY/E2E/domain work, and verified that the existing test script can run unit paths inside Docker. No active-home or runtime work is included in this milestone.

Revision note (2026-09-07, Joe-Degler): Completed Milestone 2 after independent code/QA approval and successful focused Docker units, real PTY journeys and full E2E. Recorded count accuracy and per-scope cancellation clarifications, same-milestone CLI/testing docs, and remaining Milestone 3 scope. The user's working installation was not touched.

Revision note (2026-09-07, Joe-Degler): Began Milestone 3 after explicit continuation from committed registration/deletion groundwork. Delegated disjoint state/resolver, CLI, and launcher/E2E implementations with separate reviewers and findings audit. All init/uninstall and engine test execution remains inside Docker; no runtime activation or permission-policy change is authorized.

Revision note (2026-09-07, Joe-Degler): Independent review exposed old-receipt reactivation during failed launcher repair and shell file-type inconsistencies. Refined selected-Codex retry ordering, preserved the explicit Claude-only independence boundary, and required positive post-failure probes with restored PATH. Updated decisions, milestone instructions, interfaces and ATTENTION before the final implementation gate.

Revision note (2026-09-07, Joe-Degler): Completed Milestone 3 implementation and validation with independent code/QA approval. Recorded physical-path semantics, bounded checksum publication, all final test evidence, domain updates and retained native-runtime limits. Closing only C1 and preserving the active epic's other plans/research; the working installation and unrelated files were untouched.

Revision note (2026-09-07, Joe-Degler): Archived the completed C1 plan with a focused ATTENTION snapshot, updated the epic's current result and next dependency, removed resolved findings, and completed the requested no-lookup documentation summary. Verified ignored archive files explicitly; they require force-add when intentionally committed. No production changes followed final validation.
