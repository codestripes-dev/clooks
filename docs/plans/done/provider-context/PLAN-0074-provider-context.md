# Expose the Selected Provider to Hook Authors

This ExecPlan is maintained under `docs/plans/PLANS.md`. Its living sections must be updated before changing scope and at each stopping point.

**Originating Feature:** User-approved additive follow-up to `docs/epics/EPIC-0044-cross-agent-hook-portability.md`, not a hook-pack migration or new Codex capability claim.

## Purpose / Big Picture

Hook authors can branch on `ctx.provider` without interpreting environment variables or confusing provider identity with subagent identity. Every context reports `claude-code` or `codex`, selected by the engine's adapter. Lifecycle observers read the same value at `event.input.provider`. Authors can deliberately exercise either branch with synthetic fixtures in `clooks test`.

## Product Context

The problem is that portable hooks currently have to read `CLOOKS_AGENT`, which is an implementation detail and can disagree with an explicitly supplied adapter in embedded engine calls. This change improves hook portability and test clarity without changing decisions, tool codecs, registration, permissions, or upstream support. It is aligned with the epic's adapter-first groundwork. The user explicitly approved an additive public field; there is no raw payload or capability API.

## Progress

- [x] (2026-09-08, Joe-Degler) Read process, epic, type/lifecycle/testing domains and findings; traced shared context and synthetic helper construction. Author identity supplied as already verified by parent.
- [x] (2026-09-08, Joe-Degler) Plan and danger-zone companion written before implementation.
- [x] (2026-09-08, Joe-Degler) Implemented the public field, authoritative population, synthetic validation, permanent unit/type/E2E coverage, and concise domain updates; subsequent generation and validation are recorded below.
- [x] (2026-09-08, Joe-Degler) Parent confirmed clean generation at `tmp/provider-context/generate-Pq2rDd` (exit 0/capture 0); worker copied only the three mirrors and both byte comparisons passed. Independent code/QA source GO received. Parent focused validation passed 181 tests and full units passed 2,214 tests.
- [x] (2026-09-08, Joe-Degler) Corrected 14 stale public/private assertions in the two existing Codex E2E files: provider is explicitly observed/asserted as Codex, and all actual private-name absence checks remain. Initial full E2E `tmp/provider-context/e2e-FajAnp` exited 1: 795 pass, 14 fail, 9,410 assertions, 809 tests across 50 files in 115.52 seconds. All failures concerned newly public provider still listed as private; no production defect was observed. Clean reruns are recorded below.
- [x] (2026-09-08, Joe-Degler) Parent completed static checks, full compiled E2E and existing native smoke; independent source and amended code/QA GO confirmed. All required gates passed.
- [x] (2026-09-08, Joe-Degler) Recorded evidence, audited interface deviations and findings, and archived this folder after successful parent closure. No commit, stage or installation performed.

## Surprises & Discoveries

Lifecycle wrappers already hold context at `event.input`; no duplicate provider field belongs on `HookEventMeta`. The generated author bundle has three mirrors, including `.clooks/hooks/types.d.ts`. `generate:types` invokes npx internally; use an offline cached container shim, not dependency fetching or production tooling changes. Historical domains still describe a wholly unchanged authoring surface; update those statements narrowly for this approved field.

Parent-reported generation attempt (session 89371) produced three 46,615-byte declaration outputs, but the wrapper exited 2 with a shell syntax error near `tsconfig...; do`. A requested wrapper edit overlapped execution. This is a failed attempt, not a successful generation gate; its outputs are not promoted. Freeze the entire wrapper before a clean parent rerun, then copy only the three mirrors after parent confirms success. No production defect or test failure is inferred from this scratch-script race.

Parent-reported static attempt exited 125 before checks because the standard E2E image rebuild replaced the old pinned image, which Docker no longer found. Update the inactive scratch wrapper to the successfully built image `sha256:b3a7782eff9678581bffccad4b8c5afe73a706ac9a0efd87a5f7e0f25a039e91` before retry. This is zero-check infrastructure evidence, not a production failure.

## Decision Log

- Decision: Export `Provider = 'claude-code' | 'codex'` from the public types, and alias internal `AgentId` to it with a type-only import.
  Rationale: One identity union without pulling engine or adapter runtime modules into the author declaration bundle.
  Date/Author: 2026-09-08, Joe-Degler.
- Decision: Populate the field after adapter normalization with `adapter.id`, overriding any normalized raw `provider`; keep lifecycle access exclusively at `event.input.provider`.
  Rationale: Selected adapter is authoritative, independent of environment once explicitly selected. Existing context copies serve sequential and parallel hooks and lifecycle calls.
  Date/Author: 2026-09-08, Joe-Degler.
- Decision: Synthetic helpers default only undefined to Claude and validate explicit values, rejecting null, empty, unknown and non-string values. The CLI accepts the normalized JSON `provider` field, not a new agent flag.
  Rationale: Stable tests must not inherit CLOOKS_AGENT. Synthetic Codex identity is not Codex normalization, policy or output translation.
  Date/Author: 2026-09-08, Joe-Degler.
- Decision: Semantic audit: provider is invocation metadata, present on all context/event/result-arm combinations, not an output capability. No decision opts or translator fields change. Lifecycle gates and observers share the input field but retain existing return restrictions.
  Rationale: Adding identity must not imply Codex accepts every Claude result arm or exposes the same tools.
  Date/Author: 2026-09-08, Joe-Degler.

## Outcomes & Retrospective

The additive provider field is complete. Hooks and lifecycle input receive selected-adapter identity; synthetic helpers and CLI support deliberate legal identity with stable Claude defaults and invalid-value rejection. Permanent unit/type and compiled E2E coverage includes raw spoof resistance, contradictory environment, both executor modes, all ten existing Codex event paths, and positive lifecycle/output evidence. Seven domain documents were updated without README support claims or hook-pack changes.

Parent executed validation and confirmed independent source and amended code/QA GO. Focused tests passed 181; full units passed 2,214. Static checks at `tmp/provider-context/static-b57FkN` exited 0 (typecheck, lint with 0 errors and 112 existing warnings, format check). Full standard E2E at `tmp/provider-context/e2e-ZmUQs1` exited 0: 809 pass, 0 fail, 9,424 assertions across 50 files in 118.02 seconds. Existing native smoke at `tmp/codex-native-m1/smoke-jCoyUWVx` exited 0: six launches/cases BASE, DENY, REWRITE, ASK, CONTEXT and STOP, one Bun test with six scenarios, 0 failures in 38.35 seconds; passed.json true and testExitCode 0. Cleanup, export permissions and status writing each exited 0. This native rerun adds no provider-specific native assertions or broader capability claim.

Parent confirmed all three generated mirrors equal, no owned provider containers, unchanged installed binary hash `62b93d68dec129d02f9f9c5f516a010c6a9f448e950c0fd06d6ec62f96579278`, and no schema/config diff. No real auth/trust/home changes, host installation, stage or commit occurred. Source coverage thresholds were not revalidated and are not claimed passed.

Deviation audit found no public-interface or production-flow deviation: Provider stays a closed public union, AgentId is type-only, lifecycle identity is on input only, and engine assignment follows normalization. Validation expanded existing Codex envelope assertions to recognize the newly public field. Full E2E uses the standard network-enabled script, while custom generation/unit/static/focused modes remain isolated. The direct-executor policy unit's provider-absent assertion remains a property of its pre-core fixture, not the public runEngine contract.

Findings audit: hook-pack portability gaps, including protected-file tool assumptions, remain unresolved and unchanged. The 14 stale E2E assertions were corrected and are not an ongoing finding. Wrapper edit overlap and image-pin replacement are resolved scratch-run friction retained only in this plan; no stale domain failure notes or new persistent findings were added. Future work should freeze wrappers as well as source and verify cached image availability after standard image rebuilds.

## Context and Orientation

`src/types/contexts.ts` defines BaseContext, inherited by all event-specific and unknown-tool contexts. `src/types/index.ts` is the public barrel. `src/agents/types.ts` aliases AgentId to the public Provider type. `src/engine/run.ts::runEngineCore` obtains a normalized invocation and passes its public context to `executeHooks`; raw metadata remains private. `src/engine/execute.ts` copies that context for sequential and parallel execution, adding signal/turn/input state. `src/lifecycle.ts` attaches decision methods and wraps the resulting context as `event.input` before and after the handler. Provider survives those paths unchanged; it is not added to lifecycle metadata or serialized to upstream output by itself.

`src/testing/create-context.ts` supplies BaseContext defaults and methods for tests and the CLI harness. `src/commands/test.ts` parses normalized JSON and calls that helper, then runs lifecycle and handler with raw decision output. `src/commands/test/render-example.ts` documents optional input defaults. `scripts/generate-types.ts` generates `src/generated/clooks-types.d.ts.txt`, the tooling `.d.ts` mirror, and `.clooks/hooks/types.d.ts`; generation must not touch schema or vendor packs. Source and bundled type assertions catch lost exports and narrowing.

## Related Domain Knowledge Documents

- `docs/domain/hook-type-system.md`: update the public compatibility summary for additive identity.
- `docs/domain/hook-type-system/patterns.md`: document required provider, source authority and tool/capability limits.
- `docs/domain/hook-type-system/lifecycle-types.md`: document `event.input.provider`, not `meta.provider`.
- `docs/domain/hook-type-system/dts-bundle.md`: document exported Provider and regenerated mirrors.
- `docs/domain/testing.md`: document permanent provider regression coverage and distinction from native conformance.
- `docs/domain/testing/hook-author-testing.md`: document synthetic defaults/override/rejection and no agent translation.
- `docs/domain/cross-agent-hooks.md`: replace deferred public-marker wording with the approved implemented identity contract.

No new domain file is needed. No README support claim, schema, vendored hook, real home, auth or trust change is permitted.

## Related Findings

Read `docs/findings/index.md` and category files. The protected-path/Claude-tool assumption in `code-quality.md` motivates provider-aware authoring but remains unresolved: this work does not port hooks. `tooling-friction.md` documents that compilation does not typecheck and that coverage is below the configured gate; include typecheck and do not claim coverage success from unit passes. `process-feedback.md` requires downstream test blast-radius review. `test-gaps.md` concerns new event scaffolding; no events are added here. Other stale-doc/knowledge gaps are outside this change. Review findings at closure without deleting unrelated findings.

## Plan of Work

### Milestone 1: Authoritative Provider Context End to End

Add the public Provider alias and required BaseContext field, then type-alias AgentId. In runEngineCore copy normalized public context with provider assigned last from the selected adapter. Leave adapter payload schemas, policy, turn state and output translators unchanged. Trace context copies in both executor modes and lifecycle input wrappers; no extra metadata field is necessary.

Extend synthetic defaulted keys and validate provider before spreading the payload. Preserve existing undefined-default behavior deliberately: explicit undefined still defaults Claude. Reject all invalid explicit values with a stable TypeError; translate this boundary into a clean `clooks test:` usage error before lifecycle/handler execution. Document provider in example optional keys. Do not imply synthetic Codex tests apply native policies.

Add helper unit tests for both constructors, defaults independent of environment, both legal overrides and invalid runtime values. Add engine tests proving explicit adapter beats contradictory process environment and raw spoof fields, with lifecycle receipt. Add source and bundled compile-only tests covering every EventContextMap entry, unknown tool variants, lifecycle input, required/non-null union and helper optional payloads. Update any directly constructed BaseContext test literals that now require the field; do not mass-add provider to raw wire fixtures.

Add permanent `test/e2e/provider-context.e2e.test.ts`: invoke compiled engine with unset/explicit Claude and Codex, malicious opposite raw provider, and sequential plus parallel hook groups. Each hook records before/handler/after receipt and parallel identity to an owned sandbox log. Assert exact records (sort only parallel order), real exit zero/no signal, stderr, and provider-appropriate decision JSON. Use injectable SessionStart skip markers for a common positive output proof and PreToolUse units for tool context. Add compiled `clooks test` cases for default under opposite environment, explicit both providers, rejected invalid JSON values without lifecycle/handler logs, and example documentation. Give all subprocesses isolated homes and explicit deadlines.

After implementation update the listed domain knowledge in this milestone, then generate the bundle in a disposable offline Docker work copy using cached dependencies. Parent owns validation and independent code/QA review. Milestone acceptance requires actual full unit and compiled E2E passes, not only source inspection or new targeted tests.

## Concrete Steps

Working directory is `/opt/development/clooks`. Parent runs validation only after edits freeze. Standard complete suite is `bun run test:e2e`; use existing `clooks-e2e` image with read-only source/test/schema/bunfig/tsconfig mounts when avoiding image/dependency acquisition, matching the repository Docker entrypoint. Container tests run as testuser with disposable HOME, CODEX_HOME and CLOOKS_HOME_ROOT; no host credential mounts or global installation. Do not call deploy:local or host build/test.

Inside that container, focused tests are `bun test src/testing/create-context.test.ts src/engine/run.agent-adapter.test.ts src/types/contexts.test.ts src/types/lifecycle.test.ts ./test/e2e/provider-context.e2e.test.ts`; full units are `bun test src/` and compiled E2E are `bun test ./test/e2e/`. Build only inside container after `bun run typecheck`, with `bun build --compile --outfile dist/clooks src/cli.ts`. Static scripts are `bun run typecheck`, `bun run lint`, `bun run format:check`. Generation is `bun run generate:types` in a disposable writable copy with cached dts-bundle-generator and a container-local npx shim, then copy only the three generated mirrors back. Parent may provide an existing safe wrapper rather than introduce a parallel harness.

## Validation and Acceptance

Parent reran the existing six-case native smoke suite using `CLOOKS_CODEX_DIST=/home/joedegler/.asdf/installs/nodejs/24.15.0/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl bun run test:codex-native`. Parent verified the executable path. This uses disposable offline model execution without auth and adds no native fixtures, scenarios or new provider assertions. It is existing native regression coverage alongside the new provider-specific unit/E2E checks, addressing the user's explicit smoke and E2E question. The passing result and scope are recorded in Outcomes.

All real invocations report selected provider in before/handler/after, including sequential and parallel execution. Raw opposite provider cannot spoof it. Explicit adapter remains authoritative under opposite CLOOKS_AGENT. Synthetic undefined provider is Claude irrespective of environment; codex override reaches all lifecycle stages, while null/empty/unknown/scalar/array/object overrides fail before a handler runs. Source and generated bundle permit only the two strings, and every event context carries the field. Existing examples remain valid because helpers default provider. Tests must positively prove execution with exact logs and returned JSON, not empty output alone. Native smoke is not rerun by this worker and this change adds no native capability claim.

## Idempotence and Recovery

Edits are additive and scoped; preserve existing uncommitted native harness, docs, entrypoint, package changes and TODO. Generated mirrors are reproducible. Delete only owned disposable validation artifacts if necessary; never uninstall or replace the global binary or alter real trust/auth. Do not stage or commit. Plan files may be ignored and need force-add at a later explicitly authorized commit. Archive to `docs/plans/done/provider-context/` only after parent validation/review closure.

## Artifacts and Notes

Completed parent validation evidence is recorded in Outcomes. Run outcomes are retained here rather than per-run chatter in living domains. `git diff --check` passed as a whitespace-only check. Both archived plan files are ignored by git and will need force-add for an authorized commit. Read-only inspection confirmed sequential and parallel executor paths each spread the normalized record; no executor changes were needed.

The parent can run `bash tmp/provider-context/run.sh generate`, which uses pinned cached image `sha256:fd92e10d305a6a901671923091cca035a2aa2592f25beb5117290b9e30b5cd5f` as testuser with network disabled and read-only source. It exports the three generated mirrors to the printed attempt's `export/` directory, without changing host source. After parent confirms a clean successful run, the implementation worker copies `clooks-types.d.ts`, `clooks-types.d.ts.txt`, and `local-types.d.ts` only to their respective source/local mirrors. Subsequent `bash tmp/provider-context/run.sh focused`, `units`, and `static` use read-only custom mounts. Mode `e2e` instead invokes bounded standard `bun run test:e2e`, retaining normal Docker networking for GitHub smoke cases. No mode deploys a binary. All calls are bounded and logs retained. Generation is a build artifact step owned by parent while worker edits are frozen; it is not a claimed validation pass.

## Interfaces and Dependencies

Public `Provider` is exactly `'claude-code' | 'codex'`, exported from contexts and public barrel. `BaseContext.provider: Provider` is required. Internal `AgentId` is a type-only alias. `createContext` and `createHarnessContext` keep their signatures and accept optional provider through their existing payload shape; undefined defaults Claude, invalid explicit values throw. Lifecycle reads `event.input.provider`; HookEventMeta is unchanged. The shared core assigns provider after normalization and before executor context copies. No new dependencies or wire fields.

## Instruction Prompts

User: "I think that makes sense to add, though. Where to?"

User: "I agree with provider."

Agreed context: provider field BaseContext union claude-code|codex sourced selected adapter, all hooks/lifecycle, helper defaults Claude overridable Codex. Parent implementation delegation requires one milestone, plan before edits, permanent unit/type/compiled E2E coverage, isolated Docker-only generation/validation, same-milestone domain updates, no host install/auth/trust changes, no commit/stage, and stop awaiting independent review after implementation.

Revision note (2026-09-08): Initial scoped plan records the approved identity API and synthetic validation boundary before implementation.

Revision note (2026-09-08): Source, tests and domains prepared; parent-only generation/validation wrapper added. Full E2E mode invokes bounded standard `bun run test:e2e`, retaining normal Docker networking for GitHub smoke cases; only generation/focused/unit/static custom modes disable network. Live host testing, hook-pack changes and native-scenario promotion remain excluded. No API deviation: lifecycle identity stays solely on input, helper invalid values fail before dispatch, and the core assigns selected adapter identity after normalization.

Revision note (2026-09-08): Closed after parent-confirmed full gates and independent amended code/QA approval. Archived plan and ATTENTION, updated epic linkage/status, and retained resolved test/wrapper friction only as execution history. All seven listed domain updates are complete; no README, hook-pack or deployment change was made.
