# Cross-Agent Portability: Continuation Review

Date: 2026-09-07. Author: Joe-Degler, with Codex architecture and registration reviewers. Reviewed repository HEAD: `74eda9b`. This is a research assessment and proposed continuation order, not an implementation-ready ExecPlan or authorization to change production behavior. The bounded research task is recorded in Plan A's Progress section.

## Recommendation

Keep the shared engine, explicit `CLOOKS_AGENT` selection, Claude default, and command-hook distribution. Do not restart the architecture. Before enabling Codex, repair registration lifecycle problems and expand the adapter boundary to cover decisions made before final serialization. Preserve hook authoring syntax where semantics actually match; do not promise that every existing Claude hook is automatically portable.

The agreed target remains the original ten events. New upstream events are a separate scope decision. Ship registration, working runtime, validation, and user documentation as one functioning feature, as requested earlier. There is no proposal for an intermediate CLI warning about unfinished implementation.

## Evidence and Limits

Plan A's May result remains docs-backed but runtime-unverified. Its fixtures are synthetic examples, not captured Codex input. Plans B and C are implemented in `2e732c1` and `5bf8826`; the current Codex adapter still has `supportsRuntime: false`. Commit `74eda9b` subsequently added handoff delivery and per-hook turn state. The installed npm package reports Codex `0.153.4`, compared with the old spike's `0.133.0`; package metadata does not prove any runtime behavior.

Official documentation was fetched on 2026-09-07. The old hooks URL redirects to [Hooks](https://learn.chatgpt.com/docs/hooks). Current docs add `SessionEnd` and `Interrupt`, expand local-tool coverage, and support MCP handlers and background commands. Commands use session cwd; examples resolve repo scripts through git. `statusMessage` is documented. Background handlers cannot enforce decisions. `apply_patch` aliases do not change its payload name. Stop continuation creates a new prompt; subagent identity and output audience need explicit treatment. Output spilling can affect long messages. These are documentation observations, not live verification.

[Advanced Configuration](https://learn.chatgpt.com/docs/config-file/config-advanced) identifies `CODEX_HOME` as the user state/config root and distinguishes project trust from user hooks. The local Clooks registrar does not honor that root today.

No live Codex session, trust change, credential copying, global binary installation, or production edit was performed during this reassessment. No pinned Codex source/schema audit was completed. The next contract pass must bind evidence to a selected release instead of equating current website documentation with the installed binary.

## Decisions That Hold Up

One native Clooks command per event preserves Clooks ordering and result reduction. Registering every TypeScript hook separately would surrender those semantics. Keep generated JSON separate from user TOML and preserve unrelated registrations.

Explicit agent selection is correct. Overlapping event names and payload shapes are unsuitable for provider detection. The Claude default is an existing compatibility contract, not an obstacle to Codex.

Keep the reusable loader, lifecycle execution, timeout machinery, handoff file storage, and result aggregation. Change where provider-specific policy enters those mechanisms, rather than adding a second engine. Claude plugin discovery and settings advisories stay Claude-specific. Do not invent a general plugin platform in this epic.

Keep public `ClooksHook`, decision methods, and `ctx.turn` wherever possible. Internal invocation metadata does not require public `ctx.raw` or `ctx.agent`. A genuinely incompatible public field needs an explicit decision, not a fabricated value hidden behind a cast.

## Registration Findings

### Installed Does Not Mean Active

`src/commands/init.ts:184` writes global dedup markers before `registerCodexClooks` at line 218 can fail. `src/commands/init-entrypoint.ts:35` suppresses project execution based solely on marker existence. A registration parse failure can therefore leave a successful project no-op without a working global replacement. This is a confirmed ordering defect; disabled or untrusted global commands are additional cases the current marker cannot distinguish.

Moving marker creation after registration repairs one failure mode, not the design assumption. C1 corrects deterministic registration/launcher defects, including active Codex-home identity, and documents marker limitations. Static installation state cannot prove native activation or exactly-once execution. Exact hook trust, disabled native registrations, and simultaneous native invocations remain D/E conformance concerns, not C1 guarantees.

`src/commands/init.ts:218` and `src/commands/uninstall.ts:371` hardcode the user Codex directory. Two Codex homes sharing one OS home can target different configurations while sharing the same Clooks marker. Resolve registration and unregistration from the same active Codex-home policy, and account for it in any retained dedup identity.

### Repository Trust Assumption

The user explicitly confirmed on 2026-09-07 that using Clooks assumes the repository is trusted. `src/config/index.ts:62` merging project configuration and `src/engine/run.ts:193` importing its hooks are intended behavior. Preserve global execution of the merged home/project/local pipeline and its ordering, shadowing, and dedup semantics.

The earlier recommendation for separate repository authorization is withdrawn. A new trust database, authorization UI, home-only global execution, and tighter permission models are out of scope, not release gates. Codex's own hook activation requirements remain external integration facts; tests of inactive registrations must not become a redesign of Clooks repository permissions.

### Deletion and Ownership Need Stronger Contracts

`src/commands/uninstall.ts:58` widens removal only for `opts.full`, while interactive deletion is chosen separately at line 230. Deleting shared runtime files must first account for all registrations, including the other agent, regardless of which UI path requested deletion. Declining unhook and accepting deletion must not leave dangling commands.

`src/agents/codex/settings.ts:59` treats any command containing two substrings as owned. For example, an unrelated command that echoes `CLOOKS_AGENT=codex .clooks/bin/entrypoint.sh` matches. Re-init can replace it and uninstall can remove it. Recognize a bounded set of generated command forms, including supported legacy forms, rather than attempting to parse arbitrary shell or treating a textual mention as ownership. Derive ownership recognition together with the final command representation.

`readHooksFile`, `getHooksObject`, and registration at lines 88, 123, and 142 overwrite syntactically valid but structurally unexpected JSON. Syntax validity does not imply permission to discard data. Unexpected structures should fail without changing bytes. Preserve unknown fields and hooks; use atomic replacement for successful updates and test interrupted writes. Existing tests approving destructive repair need changing, not preserving.

### Absolute Paths Are a Real Portability Cost

`makeCodexProjectEntrypointCommand` pins both the launcher and project root. A second clone can run the original checkout if it still exists, which is worse than merely failing to find a file. Retain absolute generated commands as the accepted machine-local registration tradeoff: document re-init after moving or cloning and test that re-init targets the new location. Clooks discovery is not identical to git-root discovery; replacing the command with git-root resolution is outside C1. Cross-agent hook portability does not promise clone-and-run registration portability.

Global commands also inherit `CLOOKS_PROJECT_ROOT` and `CLAUDE_PROJECT_DIR`, which discovery prioritizes over cwd. Separate intentional overrides from stale provider-specific environment. Preserve intentional Clooks overrides; do not blindly clear every variable.

## Runtime Boundary Findings

### Validate Each Result Before It Changes the Pipeline

The adapter currently sees only the reduced result. In `src/engine/execute.ts:605-709`, sequential results are handed off, patches applied, and earlier results replaced before final translation. An unsupported `PermissionRequest` permission update followed by a plain allow can disappear. A rejected input rewrite can already have affected later hooks.

Introduce an invocation-specific result-policy callback, applied to lifecycle-produced results in both sequential and parallel paths before handoff, input mutation, and reduction. Cover `beforeHook`/`afterHook`, generated errors, and degraded execution deliberately. Keep recording raw hook history for `ctx.turn`; a returned decision is not proof of delivery. Unsupported safety control must map to a supported refusal where available, not a warning followed by allow. For observational events, define the honest diagnostic/failure outcome without pretending an already-completed action can be prevented.

### Keep Public Context Separate From Wire Metadata

`src/agents/types.ts:65` exposes normalization as `Record<string, unknown>`, and execution spreads that object into author contexts. Final translation has no tool or invocation context. Use a private invocation envelope for provider, original wire data, tool codec, and session/turn/scope identity, alongside public normalized context. Pass it per invocation; never store it on the singleton adapter.

Map known envelope fields explicitly. `src/normalize.ts:8` recursively changes arbitrary keys; reusing it for opaque Codex tool arguments risks corrupting MCP input. `src/types/contexts.ts:167` names Claude tools and their shapes. Do not rename `apply_patch` to `Edit` or `Write` while presenting patch text as a structured file edit. Keep unknown tools honest and audit the existing `Unknown*Context` author escape hatch before promising automatic type-safe portability.

Clooks input updates are shallow partial patches with null-as-unset semantics (`execute.ts:699`). A wire codec must materialize the full resulting input and encode it correctly. Test untouched fields, nested keys, nulls already present in opaque data, explicit removal, empty/no-op patches, and malformed replacements. Validate tool-specific requirements before execution can use a replacement. Resolve nullable transcript and response fields explicitly; do not invent a real-looking transcript path or parse unstable transcripts to recover missing identity.

### Failures Must Use the Same Output Policy

Config failure, malformed input, and fatal exception paths still exit directly with code 2. The shell does the same for unexpected exits. This is not evidence of universal upstream enforcement. Audit known-event failures separately from failures where no event can be identified. Propagate the exit code returned by every adapter translation, including advisory-only paths. Missing binary is intentionally bootstrap-pass-through today; preserve or explicitly revise that product decision, rather than describing it as guaranteed blocking.

### Turn State and Handoff Are Part of This Adapter

`src/engine/run.ts:275-294` uses session-only storage identity and advances on every prompt; `turn-state.ts:189` derives scopes from the normalized referenced agent. Plan B's late-normalization prose is now stale: normalization runs before no-hook/no-match exits to maintain turn state.

Audit provider/session isolation, native turn identity, parent versus child identity, duplicate prompts, Stop continuation, compaction, resume, and concurrent arrivals. Preserve the meaning of `ctx.turn` as documented, rather than assuming a native turn ID has the same lifetime. Keep Claude storage compatibility; a Codex namespace should not reset existing Claude history. Do not treat this best-effort history as a safety gate.

Concrete Stop acceptance: determine whether a hook-requested continuation emits another `UserPromptSubmit` and changes native `turn_id`. Replay a once-per-turn Stop reminder across that sequence and then a genuine new user prompt. It must not repeatedly remind because an internal continuation cleared its history, and it must become eligible again for the next genuine user request. Settle how the available upstream evidence distinguishes those boundaries before implementing them; if it cannot, record the compatibility limitation instead of claiming once-per-user-turn parity.

Keep shared handoff file storage, but decide eligible fields from the provider's delivery semantics before replacing text with pointers. Prove the intended recipient can read a referenced file. Inline fallback must remain available. This does not justify replacing the handoff subsystem or switching native registration to background execution.

## Proposed Continuation Order

### 1. Bounded Runtime Contract Refresh

Refresh the capability matrix for a selected supported Codex release. Record documented, schema-backed, runtime-observed, and unresolved evidence separately. Check all ten agreed events, not just event names: tool/input/result combinations, error channels, recipient, and identity. Retain the older fixtures as synthetic until each is revalidated; captured fixtures require provenance and sanitization.

The decisive spike is a controlled hook that denies a harmless command which would create a sentinel file. First prove the command runs without the hook, then show hook invocation and absence of the side effect under denial. Capture argv/environment/cwd and input/output/exit evidence. Separately test trusted/untrusted project layers and global/project coexistence. Use disposable homes, Codex config, projects, and explicit resolved binaries. Do not reuse or copy real credentials or trust state automatically. If auth blocks execution, record the block once; investigate a pinned upstream hook executor/test harness that does not need model access. Such a harness is stronger parser evidence, not equivalent to a full live session.

Exit condition: the selected version, shell-command contract, native hook activation behavior, and evidence gaps are concrete enough to finalize Plan D. This refresh gates D, not C1. C1 proceeds with deterministic tests and controlled launcher probes; it requires neither live Codex execution nor authentication. Repository trust is settled by user direction, not an open research question. No open-ended repeat of all earlier research is required.

### 2. Correct Registration Before Enabling Runtime

Write a focused follow-up ExecPlan, proposed as Plan C1. Its deliverable is correct and recoverable init/uninstall while preserving the current trusted-repository and merged-global model. Cover failed global init, active Codex home, stale markers, interactive deletion, ownership false positives, malformed-shape preservation, re-init after relocation, and inherited environment. Document inactive native registrations as a marker limitation, not a C1 activation guarantee. Keep the accepted absolute-command tradeoff separate from inherited-environment corrections. Keep dedup corrections scoped to demonstrated defects rather than introducing a new permission model.

Use temporary-directory unit tests and compiled-binary Docker E2E for every changed production milestone. Assert positive execution counts and preserved bytes. Update entrypoint, CLI, discovery/global-config, testing, and cross-agent domain docs with the implementation. Update `ATTENTION.md` before changing shared launchers, config authority, or registration deletion. Keep Claude behavior stable except individually justified defect fixes.

C1's boundary is registration and launcher correctness: preserve explicit provider selection and correct project-root discovery. Its execution-count assertions use a controlled probe/stub behind the generated command; the compiled Clooks binary exercises init/uninstall, while the Codex runtime remains disabled. Actual TypeScript-hook execution under Codex is D/E acceptance. Every identified correction requires a regression test and the applicable compiled-binary E2E or smoke scenario, including preservation of merged global/project execution. This does not call for a general trust database or a universal exactly-once framework.

### 3. Implement Plan D in Vertical Milestones

Write Plan D after the gates above. Its first milestone introduces the private invocation envelope, provider policy injection, and isolated Claude-preservation tests. Its second delivers a complete Codex PreToolUse path through the compiled binary: decode, execute a real Clooks hook, validate its result, reduce, and emit the chosen deny/no-op/context shapes. Enable rewrite only when the codec and upstream evidence support it.

The third milestone completes all ten agreed events and the result capability audit, including permission decisions, compaction observation, subagent audiences, and Stop continuation. The fourth covers turn state, handoff delivery, early exits, and process failures across the complete path. Prerequisite state/failure support must accompany the earlier milestones wherever necessary for them to work; the fourth milestone is comprehensive coverage, not permission to defer correctness.

Every production milestone includes its own unit and compiled-binary E2E tests, code review, QA review, and affected domain updates. Do not defer ordinary E2E to Plan E. Do not widen public tool or event types casually; any necessary change gets a semantic audit and explicit scope decision first.

### 4. Plan E Proves the Released Workflow; Plan F Publishes It

Use Plan E for upstream conformance and full registration-to-Codex execution, including permission allow/deny, rewritten command side effects, continuation, subagents, and supported failure channels. Distinguish fixture replay, pinned upstream executor tests, and live behavior. Shipping safety-sensitive support still requires live evidence or the explicit release-confidence decision already required by this epic.

Plan F documents the tested version range, portable hook examples, unsupported operations, trust, installation scopes, relocation, and uninstall. README claims land with functioning support. CLI staging warnings, a new plugin distribution system, Windows support, and an automatically expanding event set remain out of scope.

## Scope Decisions

Repository trust is settled: assume the repository is trusted when using Clooks. Preserve existing global/project merging. Tighter permission models are deferred; do not reopen them during this epic's implementation.

Keep the ten-event MVP while separately recording the two newer events. `SessionEnd` already exists in Clooks; `Interrupt` does not appear in its event set. Adding either now would require an explicit scope update rather than silently changing registration coverage.

## Validation Performed

`bun run typecheck` passed. The focused command below produced 186 passes and one failure:

    bun test src/agents/ src/engine/run.agent-adapter.test.ts src/codex-fixtures.test.ts src/commands/init.test.ts src/commands/uninstall.test.ts

The failure is `runEngine agent adapter selection > defaults to Claude Code without inferring Codex from stdin shape`, at `src/engine/run.agent-adapter.test.ts:296`: stderr contains a turn-state lock-write warning instead of being empty. Its mocked dependencies do not isolate home storage, and `afterEach` deletes `CLOOKS_HOME_ROOT`. Running the same test alone with a disposable root passes:

    env CLOOKS_HOME_ROOT=/tmp/clooks-portability-review.XsJERk bun test src/engine/run.agent-adapter.test.ts -t 'defaults to Claude Code without inferring Codex from stdin shape'
    1 pass, 0 fail

This is a test-isolation defect exposed by the new storage path, not proof of a Codex translation failure. Future tests must create a fresh root per test and restore inherited environment. No production fix was made. Docker E2E and live Codex were not rerun for this documentation-only review; historical passes remain historical evidence.

## Documentation Work

This reassessment updates the epic's continuation order, adds this review, records the bounded task and outcome in Plan A, and marks the capability matrix as a dated snapshot needing targeted revalidation. Domain corrections cover current normalization timing, fixture evidence limits, and the distinction between installation markers and runtime activity. Findings preserve unresolved source defects and the test-isolation failure.

Future corrective registration work must update `docs/domain/bash-entrypoint.md`, `docs/domain/cli-architecture.md`, `docs/domain/config/discovery.md`, `docs/domain/global-hooks.md`, `docs/domain/testing.md`, and `docs/domain/cross-agent-hooks.md`. Runtime work must also update `docs/domain/config/execution.md`, `docs/domain/config/handoff.md`, `docs/domain/turn-state.md`, and relevant hook-type-system docs when their contracts change. README support claims belong to the final release documentation. Internal planning identifiers and links to ignored research must not leak into production source, tests, README, or domain docs.

## Revision Note

2026-09-07: Narrowed C1 to deterministic registration and launcher correctness, with no live execution/authentication requirement or native activation guarantee. Retained the accepted absolute-path/re-init tradeoff, trusted-repository and merged execution assumptions, and regression plus applicable compiled-binary E2E/smoke requirements. Original evidence and runtime caveats remain; native conformance belongs to D/E.

## Instruction Prompt

> Alright. Get yourself a lay of the land. You're a much smarter model now, so you should scrutinize the design decisions we've done so far and we should make a plan to continue the line of work.

Clarification, 2026-09-07:

> When using clooks, you should assume you can trust the repo. We can tighten permission models down the line. This is not a discussion for now.
