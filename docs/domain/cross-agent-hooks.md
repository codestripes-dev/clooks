# Cross-Agent Hook Systems

Reference document for hook systems across AI coding agents. Clooks aims to provide a unified hook runtime across these agents, so understanding their differences and commonalities is essential.

## Overview

Five major AI coding agents have hook systems with similar enough patterns to support a unified runtime. Two agents have no hook system, and one has nascent/underdocumented hooks.

| Agent | Hook System | Maturity | Viable for Clooks? |
|-------|------------|----------|-------------------|
| **Claude Code** | 22 events, 4 hook types | Mature | Yes (primary target) |
| **Codex** | 12 documented events at September review; 10 targeted by Clooks | Active | Ten-event runtime implemented; expanded Docker validation passed; scoped native baseline/deny/rewrite/refusal/context/Stop proof |
| **Cursor** | ~6 events | Beta (since 1.7, improved 2026) | Yes |
| **Windsurf** | ~8 events | Active | Yes |
| **VS Code Copilot** | ~8 events | Preview | Yes |
| **Cline** | Directory-based hooks | Nascent/underdocumented | Not yet |
| **Aider** | Git hooks only | None | No |
| **Continue** | None | None | No |

## Common Patterns

The viable agents share these hook patterns:

1. **Pre/post tool execution events** — Block or observe tool calls
2. **Session start/stop events** — Setup and teardown
3. **JSON context on stdin** — Structured event data
4. **Shell command handlers** — Execute arbitrary scripts
5. **Exit code signaling** — 0 = allow, non-zero = block (details vary)

These commonalities make a normalization layer feasible.

## Agent Details

### Claude Code

The most mature hook system. See [claude-code-hooks/overview.md](./claude-code-hooks/overview.md) for full details.

- **22 lifecycle events**
- **4 hook types:** command, HTTP, prompt, agent
- **Config:** `.claude/settings.json` or plugin `hooks/hooks.json`
- **Execution:** Parallel, no sequential option
- **Blocking:** Exit code 2 only
- **Special features:** Async hooks, `updatedInput` for modifying tool inputs, `additionalContext` for injecting context

### Codex

The adapter architecture is intended to preserve Clooks hook authoring for the shared semantic subset. Matching event names do not establish compatible tool input, output, permission, or turn semantics.

**Documentation snapshot, 2026-09-07:** The list and mapping table below preserve the review of [official hooks documentation](https://learn.chatgpt.com/docs/hooks). The [official changelog](https://learn.chatgpt.com/docs/changelog) announces Codex CLI `0.153.4` on 2026-09-04. The website also lists `SessionEnd` and `Interrupt`; Clooks' ten-event target is unchanged. Website claims are separate from the pinned-source corrections below, especially where PermissionRequest failure behavior contradicts them. The current implementation handles the ten-event target with restricted per-event capabilities; expanded Docker validation has passed. Native proof is limited to the measured smoke capabilities below.

- **Clooks target events:** `SessionStart`, `SubagentStart`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `UserPromptSubmit`, `SubagentStop`, `Stop`. Matching Claude-side event names establish scope, not capability parity.
- **Config:** `~/.codex/hooks.json`, `~/.codex/config.toml`, `<repo>/.codex/hooks.json`, or `<repo>/.codex/config.toml`
- **Trust:** project-local `.codex/` layers load only when the project is trusted; non-managed hooks must be reviewed/trusted before running
- **Handlers:** upstream supports command and [`mcp_tool` handlers](https://learn.chatgpt.com/docs/hooks#mcp-tool-hooks); `prompt` and `agent` handlers are parsed but skipped. Clooks remains a synchronous command-handler integration. An MCP handler is distinct from observing model-issued MCP tool calls.
- **Execution:** multiple matching command hooks for one event are launched concurrently
- **Feature flag:** current docs describe hooks as enabled by default; `[features].hooks = false` disables them. Enabled configuration alone does not establish native review or activation.
- **Timeout:** seconds, defaulting to 600
- **Coverage:** [PreToolUse/PostToolUse coverage](https://learn.chatgpt.com/docs/hooks#tool-coverage) includes shell, unified exec, patch, MCP, and most local function tools. Hosted tools such as WebSearch bypass this path, and specialized paths may opt out. This is not a universal enforcement boundary. A later `write_stdin` completion poll can deliver the original command's PostToolUse; polling or sending input does not repeat its PreToolUse.
- **Verification status:** exact tag `rust-v0.153.4` is verified to commit `3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`; the pinned-source audit below supersedes conflicting website claims for that release. Source inspection is not executed parser/executor or live evidence. The historical `0.133.0` live attempt failed with `401 Unauthorized` and captured no hook payloads. Synthetic fixtures and registration probes do not establish native enforcement.
- **Implementation status:** `supportsRuntime: true` now exposes the ten targeted events through normalization, policy and translation. The ten-event implementation and `deferRuntimeErrorAudit` correction have passed final Docker unit, E2E and static gates. Those local gates do not establish full native capability parity or P/L evidence. Registration remains the same ten-event set; `SessionEnd` and `Interrupt` are not added.

The native CLI smoke verified real Codex 0.153.4 invoking generated registration for SessionStart, UserPromptSubmit, PreToolUse, PostToolUse and ordinary Stop. Measured effects include shell denial with exact actual-request feedback and no denied-call PostToolUse, command rewrite with original-marker absence and rewritten-marker presence, unsupported-ask refusal with no tool effect, context delivery into actual request text, and one same-turn Stop continuation whose next hook sees intervention history and skips. Context uses PreToolUse ALLOW and SessionStart/UserPromptSubmit/PostToolUse SKIP; it does not establish PreToolUse skip-context support. The boundary is a synthetic local model in network-disabled Docker, synthetic project trust, hook-trust bypass and danger-full-access, without real home/auth mounts. PermissionRequest, PreCompact, PostCompact, SubagentStart/SubagentStop, other result arms/codecs, normal trust/approvals, layered activation and recipient readability were unverified by that smoke; handoff stays inline. See [native smoke commands and prerequisites](./testing/codex-native.md#opt-in-native-cli-smoke). No upstream Rust-test, full-ten-event or release-conformance claim follows.

Separate authorized real-session probes on 2026-09-08 extend that historical smoke boundary on installed Codex 0.153.4, without changing real auth/trust: PermissionRequest allow/default skip executed with Pre/Permission/Post observations, while deny produced a native rejected-process error with the fixture reason and no PostToolUse. Exact commands establish attribution; PermissionRequest has no native tool-use ID. Two actual children reported distinct injected SubagentStart tokens before parent token-log inspection. One explicitly targeted resumed child's SubagentStop requested an executed continuation, followed by a skipped stop with intervention history 0 to 1 and prior runs 1 to 2, without an intervening UserPromptSubmit. The observer establishes matching child/session and preserved hook history, not matching native turn IDs, which it did not capture.

Live shell allow/deny/rewrite, unsupported-ask refusal, controlled-throw failure blocking, and direct pre/post developer-context receipt were also demonstrated. Matched-only post-tool response capture proved completed stdout despite post-block feedback hiding it in the wrapper: no rollback occurred. See [real-session evidence boundaries](./testing/codex-native.md#authorized-real-session-evidence). A separate forced zero-threshold NEW-session local compaction probe passed in synthetic-loopback offline Docker: raw and configured PreCompact/PostCompact handlers fired in order (auto) with the same raw turn ID, the summary reached user-message content in the second request, and final stdout followed. Only the compact handlers were configured; other raw lifecycle captures do not establish their handler invocation. This mid-turn interactive fixture did not newly test root startup, root prompt or root Stop. Across historical smoke, interactive probes and compaction, all ten target events have some native invocation evidence. Other result/failure variants, patch/MCP mutation, real-conversation/rich-history compaction and block variants, layered activation, root reset, broader trust/approval configurations, exactly-once delivery and recipient readability remain unverified; handoff stays inline. Invocation evidence does not validate every arm of an observed event.

Mapping fit (September 7 website snapshot only, including its conflicting reserved-field claim; current implementation scope is described separately below):

| Codex event | Clooks mapping | Caveat |
|---|---|---|
| [SessionStart](https://learn.chatgpt.com/docs/hooks#sessionstart) | `SessionStart` | Context reaches the main agent. Root `source:compact` context reaches immediate continuation; native `continue:false` stops before the next model request. |
| [SubagentStart](https://learn.chatgpt.com/docs/hooks#subagentstart) | `SubagentStart` | Context targets the child. Native `continue:false` is accepted but does not veto startup. |
| [PreToolUse](https://learn.chatgpt.com/docs/hooks#pretooluse) | `PreToolUse` | Denial, context, and allow plus valid full `updatedInput` replacement are documented. `ask`, legacy `approve`, `continue:false`, `stopReason`, and `suppressOutput` fail the hook run but let the tool continue. `defer` has no documented equivalent. |
| [PermissionRequest](https://learn.chatgpt.com/docs/hooks#permissionrequest) | `PermissionRequest` | Approval-only event with nested allow/deny decision; no decision retains normal approval. Reserved `updatedInput`, `updatedPermissions`, and `interrupt` fail closed. Unsupported common controls have no fully specified failure disposition. |
| [PostToolUse](https://learn.chatgpt.com/docs/hooks#posttooluse) | `PostToolUse` | Block replaces completed output with feedback; side effects remain. `continue:false` changes feedback processing. Unsupported `updatedMCPToolOutput` and `suppressOutput` report failure and retain normal result processing. |
| [PreCompact](https://learn.chatgpt.com/docs/hooks#precompact) | `PreCompact` | Native `continue:false` stops before compaction; no documented context-injection channel. |
| [PostCompact](https://learn.chatgpt.com/docs/hooks#postcompact) | `PostCompact` | Native `continue:false` acts after compaction; it neither undoes compaction nor expands Clooks' observation-only handler surface. |
| [UserPromptSubmit](https://learn.chatgpt.com/docs/hooks#userpromptsubmit) | `UserPromptSubmit` | Prompt blocking and developer context are documented; no evidenced mapping for Clooks `sessionTitle`. |
| [SubagentStop](https://learn.chatgpt.com/docs/hooks#subagentstop) | `SubagentStop` | Block requests child continuation; native `continue:false` takes precedence. |
| [Stop](https://learn.chatgpt.com/docs/hooks#stop) | `Stop` | Block requests continuation through a new prompt; native `continue:false` takes precedence. These native controls do not add Clooks decision methods. |

#### Pinned Release Source Corrections

The following facts come from inspected producers, parsers and consumers at [commit `3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`](https://github.com/openai/codex/tree/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks), bound to exact tag `rust-v0.153.4`. They are upstream source facts, not executed or live evidence. Clooks implements the ten target event handlers with the bounded capabilities described below. Their implementation and separately measured native cases do not turn this source audit into executed upstream-test evidence or full conformance.

- **PreToolUse:** native plain allow without non-null `updatedInput` is invalid and fails the handler without vetoing the tool. The implemented Clooks allow-without-rewrite mapping emits no permission decision, with optional supported `additionalContext`; absent context/diagnostic means empty stdout and exit 0. This preserves ordinary native approval and sandbox policy. An allow reason without rewrite must not appear as a reason control field without its decision. Even with a valid rewrite-allow decision, upstream discards `permissionDecisionReason`; it is not a delivery channel. The implemented mapping uses human-facing `systemMessage` for both plain-allow and rewrite-allow explanations, with an explicit recipient-loss annotation for the unavailable native reason channel. A local-only diagnostic is insufficient, and successful stderr is discarded. Only a validated complete replacement accompanies native allow. See the [parser and unsupported checks](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/engine/output_parser.rs#L121-L517) and [warning/rewrite consumer](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/events/pre_tool_use.rs#L193-L260).
- **PermissionRequest:** non-null `updatedInput`/`updatedPermissions`, `interrupt:true`, `continue:false`, non-null `stopReason`, or `suppressOutput:true` produce a failed handler with **no decision**, leaving normal review when no other handler decides. This contradicts the website snapshot's fail-closed description. Null optional reserved values and false boolean flags do not trigger those semantic checks; unknown fields or wrong types still fail parsing. A failed handler cannot cancel a separate valid allow, and any valid deny takes precedence. See the [event consumer and aggregation](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/events/permission_request.rs#L149-L294) and [normal approval fallback](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/tools/approvals.rs#L521-L542).
- **Failure channels:** exit 2 plus nonblank stderr denies PermissionRequest; blank stderr instead fails without a decision. Exit 2 is event-specific: it can prevent tool dispatch, reject a prompt, supply post-tool feedback, or request Stop/SubagentStop continuation. It is not universal denial. Successful stderr is ignored by all ten event consumers and omitted from the [completed summary](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/engine/dispatcher.rs#L228-L255). Human diagnostics need the supported stdout `systemMessage` warning channel; event-stream delivery does not prove visibility in every UI.
- **Schemas versus runtime:** generated JSON Schemas describe producers and outputs; they are not runtime validation. Input structs serialize rather than deserialize. Output parsing uses Serde, accepts null as absence for optional values, rejects unknown record fields, and does not enforce the schema's event-specific discriminator constant against the executing event. Always emit the correct discriminator. See [schema definitions](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/schema.rs#L42-L318) and the [actual parser](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/engine/output_parser.rs#L93-L363).

Tool translation requires reversible, tool-specific codecs. Bash/unified exec and `apply_patch` consume only the string `command` from a replacement object; extra replacement keys are ignored and do not mutate other native arguments. The implemented Clooks command-only codec rejects unsupported edits explicitly rather than implying those fields take effect. See the [command decoder](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/tools/handlers/mod.rs#L105-L144), [unified exec codec](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/tools/handlers/unified_exec/exec_command.rs#L499-L544), and [patch codec](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/tools/handlers/apply_patch.rs#L438-L505). `Edit`/`Write` are patch matcher aliases, not Claude structured-edit input. MCP and other local functions have their own argument-object codecs. Clooks partial updates and null-as-unset semantics must become validated full replacements without losing untouched nulls or renaming opaque nested keys. The current implementation provides command-only and opaque MCP record codecs; other record tools are observable but have no rewrite codec. Non-record inputs without an honest codec are refused. Implementation is distinct from native execution evidence.

Pinned [input producers](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/schema.rs#L275-L622) emit required nullable `transcript_path`; SubagentStop also emits required nullable child transcript and last-message fields. The normalizer implements empty-string sentinels for absent/null `transcriptPath`, `agentTranscriptPath`, `customInstructions`, `compactSummary`, and `lastAssistantMessage` on their relevant events. Accepting absence for required nullable fields is broader Clooks compatibility, not strict native validation; compact summary/custom instructions are absent from these producers. Supplied strings remain unchanged, making unavailable and genuinely empty values indistinguishable publicly while preserving raw absence/null privately. Operational IDs and required event data must not be fabricated. Source now establishes ordinary root/child identity and continuation constraints, but internal Review prompts prevent a full genuine-user-turn parity claim; normal best-effort native-prompt history is the approved planned mapping, with Review accepted as a nonblocking limitation and no special workaround. Provider-isolated history and prompt-boundary handling are now connected; expanded Docker validation has passed. See [Turn State](./turn-state.md#codex-source-constraints-and-proposed-mapping).

Failure and delivery are event-specific. Source inspection resolves the ten-event process-failure paths; actual parser/executor and native execution evidence remain separate requirements. The [tool feedback consumer](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/tools/registry.rs#L673-L750) distinguishes post block/exit 2 from post `continue:false`, including rejection after tool execution. [Context recording](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/hook_runtime.rs#L825-L849) and [native output spilling](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/output_spill.rs#L12-L130) establish text/pointer insertion and file writing, not recipient access to Clooks handoff files. UI warnings, main-agent context, child context, and tool feedback require separate delivery treatment.

#### Current PreToolUse Implementation

Hook portability also depends on author tool assumptions. A historical fake-vendor probe showed the earlier `no-edit-protected` hook skipped native `apply_patch` because it expected Claude file-tool fields. The repository pack now inspects supported patch headers; separate [actual-pack native evidence](./testing/codex-native.md#actual-pack-native-evidence) establishes bounded unprotected-patch success and protected-patch denial. Event registration and matcher aliases alone do not make arbitrary hooks portable; broader patch variants and MCP mutation remain outside that proof.

The following includes the expanded ten-event source implementation. PreToolUse has completed Docker validation; the expansion and implemented generated-error accounting correction have passed Docker validation.

| Event | Accepted author results and emitted controls |
|---|---|
| SessionStart / SubagentStart | Skip only, with optional context/debug; observer block is a policy failure. |
| PreToolUse | Allow/block/skip and handler ask through Clooks confirmations; sequential allow/ask can rewrite through an approved codec. Plain allow retains native policy. |
| PermissionRequest | Allow/block/skip; nested allow or deny/message only. No reason on allow, rewrite, permission update, interrupt or context. |
| PostToolUse | Block/skip with optional context; block is feedback after execution, not rollback. No output rewrite. |
| UserPromptSubmit | Allow/block/skip with optional context; block emits decision/reason. No session title. |
| PreCompact | Allow/block/skip; block emits `continue:false` and `stopReason`. No context. |
| PostCompact | Skip/debug only; no context or rollback. |
| Stop / SubagentStop | Allow/block/skip; author block emits decision/reason, requesting continuation. Failure instead requests termination. No context. |

All blocks require nonblank reasons. Unsupported fields are refused even when false, null or empty; undefined object fields remain no-ops. Public decision methods are unchanged and can construct fields that Codex rejects. PermissionRequest has no fabricated tool-use ID; tool description stays inside opaque input. PostToolUse preserves any JSON response, including null/scalars/arrays. `exec_command` canonicalizes to Bash on all three tool events, with canonical required/optional field checks; only PreToolUse has the stricter command-only rewrite codec. Tool input keys are not recursively renamed.

`src/agents/codex/normalize.ts` now normalizes all ten target events before hook imports when configuration is present. No-config bypasses full normalization, but existing approval storage requires identifying PreToolUse invocations for base-key retirement. Every fully normalized event requires nonempty session ID, cwd and model. SessionStart needs no native turn ID; all other events require one. Compact events omit public permission mode; others require it. SessionStart preserves model and validates startup/resume/clear/compact source. SubagentStart/Stop require both child ID and type; supplied child identity on other events must also be paired. Stop variants require boolean `stop_hook_active`; prompts require a string, including empty. Compact triggers are manual/auto. Nullable descriptive strings use empty sentinels while raw absence/null remains private.

Command codecs cover `Bash`, `exec_command` (public canonical name `Bash`) and `apply_patch`, requiring string `command` with no extra keys. MCP names beginning `mcp__` have an opaque-record codec. Partial updates skip undefined values, remove keys explicitly set to null and preserve untouched nulls/nested spelling; validated full candidates reach later hooks and native serialization. Other record-valued tools can be observed, but rewrites without an approved codec are rejected. Known Claude tool discriminators require compatible public fields; matcher aliases do not synthesize Edit/Write payloads.

For PreToolUse, `policy.ts` accepts allow/block/skip and handler-only ask with supported string context/debug fields. Block requires a nonblank reason; ask permits any string, including empty or whitespace. Sequential allow/ask rewrites use the same codec checks; parallel rewrites remain rejected. A dynamically returned `beforeHook` ask (like allow) is unsupported: the shared lifecycle warns, treats it as a no-op and continues the handler, with no confirmation or independent denial. The policy rejects a supplied before-hook-origin ask, but production lifecycle handling does not forward that return. Other-event handler asks and defer remain unsupported. Unsupported arms/fields reaching policy are failures before effects. Raw-result preflight runs before cloning and refuses lossy shapes such as accessors, symbol keys, cycles, sparse/extended arrays and non-JSON values; undefined object fields remain permitted no-ops. Plain allow emits no native decision, optional context, and empty stdout when there is nothing to deliver. Rewrite allow emits the encoded full replacement. Both allow-reason forms become human `systemMessage` annotations naming recipient loss; neither a native allow-reason field nor successful stderr is counted as delivery.

The [Codex approval fallback](./codex-approvals.md) is implemented in the Clooks runtime, not native Codex ask. It denies pending confirmations and issues fixed five-minute tokens; after explicit user approval, eligible direct shell calls can carry an inline token prefix, while other calls use `clooks approve` before an unchanged retry. Binding includes session/child/tool/cwd/original input, current pipeline/configuration, emitted input and individual ask observations, excluding changing turn/tool-use IDs. Hooks retain their scheduling and reduction: blocks win, incomplete execution cannot discharge asks, and acknowledgement changes only the final reduced ask tag. Serialized output is checked before atomic token consumption; every successful PreToolUse exit retires existing base acknowledgements. Claude's native path, public methods and registration are unchanged. The repository's vendored no-rm-rf confirmation branch now returns ask on Codex as on Claude; other explicit blocks remain blocks. The runtime baseline passed full frozen-source Docker validation; historical unsupported-ask refusal probes remain evidence of the earlier runtime. The passing [15-case native suite](./testing/codex-native.md#hybrid-approval-case-evidence) covers two-ask inline shell rewrites with execution and forbidden exec-policy denial, direct-patch CLI registration, and patch rewrites with execution and read-only denial. The read-only case registers through a separate compiled CLI process simulating the user, not a native shell call. The same suite proves actual-pack `rm -r` denial until two inline acknowledgements, then removal and consumed-token replay refusal. These synthetic-model cases do not establish human consent, new PermissionRequest coverage, native forced-removal permission or full conformance.

Known-event failures request controls through exit-0 JSON plus `systemMessage`: PreToolUse deny; PermissionRequest nested deny; UserPromptSubmit/PostToolUse block (post-tool feedback cannot undo execution); SessionStart/PreCompact/Stop/SubagentStop `continue:false` (Stop ends continuation). SubagentStart and PostCompact return stderr/exit 2 with no startup veto or rollback claim. Unidentified events also return local stderr/exit 2 without a prevention guarantee. These failure dispositions remain separate from ordinary author-result translation. Generated-error policy timing now uses `deferRuntimeErrorAudit` to preserve onError/counter accounting; that correction has passed Docker validation. Native refusal is measured for unsupported PreToolUse ask and the bounded live controlled-throw shell probe; other generated-failure variants remain unverified.

Private turn policy now resets startup/clear, preserves resume/compact, advances every root UserPromptSubmit even with a repeated native turn ID, and preserves child prompts and Stop continuations. SessionStart prunes only the selected provider store. All qualifying Codex handoff remains inline with a warning; reader access is unverified. See [Turn State](./turn-state.md), [Execution](./config/execution.md) and [Handoff](./config/handoff.md). Expanded Docker runtime validation has passed.

Agent selection is explicit: registration sets `CLOOKS_AGENT`, and runtime does not infer the provider from payload shape. The shared engine owns discovery/config/loading, matching, lifecycle, execution and reduction; adapters own invocation normalization, policy, state-boundary choices, diagnostics and wire output.

Claude remains the complete implemented adapter and retains its recursive key normalization, output translation, notify-only routing, ConfigChange downgrade and plugin/settings advisories. Codex's ten-event implementation reuses the shared ordering/reduction boundary; registration still emits one entrypoint per targeted event. Native capability descriptions must distinguish emitted requests, inspected upstream consumers and actual execution evidence.

The runtime implementation carries an invocation-bound result policy as well as normalization and final output. In `src/agents/types.ts`, `normalizeInvocation()` returns `eventName`, public `context`, and separate `private` metadata: provider, raw payload, session/native-turn/child identity and an optional tool codec. `createResultPolicy(invocation)` binds checking to that invocation. The engine passes only `context` into hook execution; the private envelope is retained for policy construction and translation, not spread into author or lifecycle inputs. Claude retains its existing normalized public shape and uses the permissive `legacyResultPolicy`. The boundary has passed full Docker unit, compiled Claude E2E and static validation, including public-shape preservation, observer mutation, detached results and parallel failure accounting. Those completed shared-boundary gates predate the concrete Codex integration and do not establish its acceptance.

`executeHooks()` accepts an optional tenth `InvocationResultPolicy` argument, defaulting to the legacy Claude policy for existing callers. `src/engine/result-policy.ts::checkDetachedResult()` deep-clones policy input and output and turns a thrown checker into a structured rejection without exposing its exception text. The executor checks author/lifecycle results after observer mutation and parallel-contract failures before result effects and capability-driven cancellation. Codex defers ordinary generated-error audits until after capture, onError selection and counter accounting, then audits selected blocking errors; do not conflate this with immediate author-capability refusal. Accepted `nextToolInput` is a complete candidate, not another partial patch. A latched rejection closes further result effects and remains separate from ordinary hook failure/degradation; raw turn-history recording is distinct from accepted output. This boundary does not constrain trusted hook code's own I/O.

Diagnostic composition is adapter-owned and structured: `composeDiagnostics()` receives the result plus trace, degraded and debug messages, and returns a result, stderr lines and system messages. The engine explicitly selects `translateFailure()` when execution returns `policyFailure`, even if diagnostic composition or final adjustment supplies allow. Codex places trace text in context for SessionStart, SubagentStart, PreToolUse, PostToolUse and UserPromptSubmit; other events use human system messages for trace. Degraded notices use system messages and debug lines remain local stderr. Its event-bound policy supplies raw preflight and inline-only handoff eligibility; private turn policy and provider storage are connected. Claude retains its existing routing and default turn policy. The expansion and its `deferRuntimeErrorAudit` correction have their own passing Docker unit, E2E and static gates, separate from the earlier PreToolUse gate.

Clooks assumes the repository is trusted. Global invocations intentionally load the merged home/project/local configuration and repository hook code; no separate repository authorization layer is required. Tighter permission models are deferred. Native agent hook activation still applies. Codex project suppression checks registration freshness and home identity, but cannot establish that the native global hook is enabled, reviewed or firing. Claude retains its existing flag-based suppression behavior.

Global Codex init/uninstall resolve the effective state home physically, following directory symlink aliases and resolving the nearest existing ancestor when directories are missing. Resolution performs no writes. Nonempty `CODEX_HOME` must be absolute and contain no CR/LF or NUL; this is a Clooks registration constraint. Project registration remains `<project>/.codex/hooks.json`, while shared Clooks files remain under the installation home. `CLOOKS_HOME_ROOT` keeps its runtime config/state meaning and does not relocate installation.

Before changing selected-Codex/all global runtime files, init validates existing state, atomically records the selected Codex home in `.clooks/.codex-registration-home`, and retires any old matching Codex receipt. Recording must succeed before retirement. Retiring before launcher repair prevents a later failed registration from making an old receipt newly eligible. Only successful registration and an executable launcher permit publishing `.clooks/.global-entrypoint-active.codex`. This receipt records canonical installation/Codex homes and the POSIX `cksum` of committed `hooks.json`; the recovery record never suppresses project execution. A failed receipt publication retains cleanup identity and blocks switching homes until matching cleanup succeeds.

That failed-init guarantee applies to selected-Codex/all setup. Claude-only init stays independent and may repair the shared launcher, restoring eligibility of an existing matching Codex receipt even if the later Claude registrar fails. This is an explicit bounded exception, not a change to repository permissions or a broader Codex-state cleanup policy.

New project launchers reject absent, empty legacy, malformed, stale or mismatched receipts and fall through to project execution when checksum checks fail. A set `CLOOKS_HOME_ROOT` must resolve to the installation home for suppression eligibility; empty, relative or different overrides disable that eligibility. Any registration-byte change invalidates freshness, including changes to unrelated hooks. Rerun both project and global init to upgrade older existence-only scripts and legacy state; unrelated checkouts are not rewritten.

Only one Codex home is recorded per installation home. Conflicting or malformed records require repair. Empty legacy flags identify the default Codex home. Unhooking a different selected home preserves the recorded home's state; full global deletion considers the selected and recorded homes. State clears only after all-event inspection finds no owned references, including on unknown events. Missing hooks allow cleanup, while ambiguous containers and surviving unknown-event references retain identity and block a home switch. Receipt removal precedes recovery-record removal so partial cleanup can be retried. Older unrecorded homes require explicit `CODEX_HOME` cleanup; no many-home registry or home scan is introduced. See [Global Hooks](./global-hooks.md#codex-home-and-registration-state) for exact record formats and recovery ordering.

Codex behavior notes are summarized here because planning and research artifacts are not part of the committed domain documentation.

Registration data is validated before transformation. Invalid managed containers or JSON produce actionable errors without rewriting the original registration file; detection inspects all events and refuses ambiguous structures. Unknown metadata and untraversed event values are retained. Both agents use atomic file replacement with mode preservation and reject registration-file symlinks, including dangling links. This is per-file recoverability, not a multi-agent transaction.

Codex ownership recognizes whole generated commands with the explicit agent assignment, the emitted POSIX quoting, and a matching root/executable pair where a project root is present. The older global-shaped absolute command remains recognized for migration. Echo mentions, extra arguments, and additional shell operations stay user-owned. Init converges owned duplicates to one canonical command per registered event; surviving mixed groups retain unrelated hooks and metadata, while options on removed owned entries are not promised preservation. Claude likewise preserves unrelated hooks during unhook and recognizes its established generated and legacy forms, including exact scope-derived unquoted global commands.

Absolute Codex project registrations require re-init after clone, move, or worktree creation before hook activation. An old checkout may still receive the copied command until repair. Shell probes cover relocation, nested roots, and inherited environment. Global commands still forward deliberate `CLOOKS_PROJECT_ROOT` and inherited `CLAUDE_PROJECT_DIR`; the saved Codex `discoveryEnvironment()` helper removes the inherited Claude key from an invocation-local copy while retaining explicit overrides. Codex runtime now uses this filtered environment for discovery. Docker integration validation has passed; registration and probe success do not establish native hook review/activation.

### Cursor

Hook system added in beta (v1.7), improved through 2026.

- **~6 events:**
  - `beforeShellExecution` — Before running a shell command
  - `beforeMCPExecution` — Before MCP tool calls
  - `beforeReadFile` — Before reading a file
  - `afterFileEdit` — After editing a file
  - `beforeSubmitPrompt` — Before processing a user prompt
  - `stop` — When the agent stops

- **Config:** `.cursor/hooks.json`
- **Handler:** Shell commands, JSON on stdin
- **Blocking:** Non-zero exit blocks the action

### Windsurf

Hooks tied to the "Cascade" AI system.

- **~8 events:**
  - `pre_user_prompt` — Before processing prompt
  - `pre_read_code` — Before reading files
  - `pre_write_code` — Before writing files
  - `pre_run_command` — Before running shell commands
  - `pre_mcp_tool_use` — Before MCP tool calls
  - `post_cascade_response` — After AI response
  - `post_cascade_response_with_transcript` — After response, with full transcript
  - `post_setup_worktree` — After worktree setup

- **Config:** JSON in Windsurf settings
- **Handler:** Shell commands
- **Notable:** Separates read vs write file events (more granular than Claude Code's single PreToolUse with matcher)

### VS Code Copilot

Hook system in preview as of March 2026.

- **~8 events:**
  - `sessionStart` — Session begins
  - `sessionEnd` — Session ends
  - `userPromptSubmitted` — User submits prompt
  - `preToolUse` — Before tool execution
  - `postToolUse` — After tool execution
  - `agentStop` — Agent finishes
  - `subagentStop` — Subagent finishes
  - `errorOccurred` — On error

- **Config:** `.github/hooks/*.json`
- **Handler:** Shell commands, JSON on stdin
- **Notable:** Event names are the closest to Claude Code's naming convention

## Event Name Mapping

This table maps equivalent lifecycle concepts across agents. A Clooks normalization layer would use canonical event names (left column) and translate to/from agent-specific names.

| Clooks Canonical | Claude Code | Cursor | Windsurf | VS Code Copilot |
|-----------------|-------------|--------|----------|-----------------|
| `pre-tool-use` | `PreToolUse` | `beforeShellExecution` / `beforeMCPExecution` | `pre_run_command` / `pre_mcp_tool_use` | `preToolUse` |
| `post-tool-use` | `PostToolUse` | `afterFileEdit` | (post hooks) | `postToolUse` |
| `pre-prompt` | `UserPromptSubmit` | `beforeSubmitPrompt` | `pre_user_prompt` | `userPromptSubmitted` |
| `session-start` | `SessionStart` | (none documented) | (none documented) | `sessionStart` |
| `session-end` | `SessionEnd` | (none documented) | (none documented) | `sessionEnd` |
| `agent-stop` | `Stop` | `stop` | (none) | `agentStop` |
| `pre-file-read` | `PreToolUse` (matcher: `Read`) | `beforeReadFile` | `pre_read_code` | `preToolUse` (matcher) |
| `pre-file-write` | `PreToolUse` (matcher: `Write\|Edit`) | (none) | `pre_write_code` | `preToolUse` (matcher) |
| `pre-command` | `PreToolUse` (matcher: `Bash`) | `beforeShellExecution` | `pre_run_command` | `preToolUse` (matcher) |

Codex maps similarly to Claude Code for the shared event-name subset: `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `SessionStart`, `PreCompact`, `PostCompact`, `SubagentStart`, `SubagentStop`, and `Stop` use the same event names. The result capabilities are not identical. `PermissionRequest` also exists, but its current output capabilities are narrower than Claude Code's.

### Mapping Challenges

- **Granularity differs.** Claude Code uses a single `PreToolUse` event with matchers to filter by tool. Cursor and Windsurf have separate events per tool type (file read, file write, command). Clooks may need both approaches — granular canonical events that map to Claude Code's matcher system.

- **Not all events map.** Claude Code has 22 events; the others usually have smaller surfaces. Events like `ConfigChange`, `TeammateIdle`, `TaskCreated`, `TaskCompleted`, `InstructionsLoaded`, and `StopFailure` are Claude Code-specific. These would be available only when running under Claude Code unless another agent adds an equivalent event.

- **Blocking semantics differ.** Claude Code requires exit code 2 specifically. Others use any non-zero exit. Clooks needs to normalize this.

- **Context fields differ.** The JSON structure passed to hooks varies. A Clooks normalization layer should provide a consistent schema with agent-specific extensions.

## Key Gaps Across All Agents

These limitations are present across the viable agents, representing opportunities for Clooks:

1. **No sequential execution.** All agents run hooks in parallel. No ordering control. Claude Code explicitly closed this as NOT_PLANNED.
2. **No inter-hook communication.** Hooks can't see each other's output or pass data between them.
3. **No unified runtime.** No tool provides cross-agent hook portability.
4. **No hook testing.** No built-in way to test hooks in isolation or simulate events.
5. **Silent failure.** Crashing hooks fail silently in all agents (details vary, but none are fail-closed).

## Architectural Implications for Clooks

### Registration

`clooks init` should detect which agents are present (check for `.claude/`, `.cursor/`, Windsurf config, `.github/hooks/`) and register the Clooks entrypoint with each. The entrypoint script receives the agent-specific JSON, and Clooks normalizes it before passing to hooks.

### Hook Contract

The adapter boundary keeps the existing `ClooksHook` handler and decision structure, with an additive `ctx.provider: 'claude-code' | 'codex'` on every event context. Lifecycle slots read it at `event.input.provider`, not `event.meta`. There is no `{ agent, event, context, raw }` wrapper.

The selected adapter recognizes the upstream event name, normalizes wire input and translates reduced results. The shared core assigns provider after normalization, overriding any payload field; explicit adapter selection remains authoritative even under a contradictory process environment. Synthetic helpers default to Claude and accept a validated explicit Codex provider without simulating its wire policy. Provider identity does not promise particular tools or result capabilities. Raw payload access remains private.

The repository's vendored core hooks use that identity for bounded provider differences. `prefer-builtin-tools` omits built-in read/search/listing restrictions for Codex while retaining configured additional rules and per-rule disables; applicable write restrictions recommend `apply_patch` when available, and sleep guidance refers to available process-wait tools. Claude keeps its existing guidance. `no-compound-commands` changes Codex wording, not classification or escape behavior. `no-pasted-placeholder` skips Codex; Claude and legacy undefined-provider contexts retain placeholder blocking, with an early skip for prompts starting with `<task-notification>`. Provider-specific hook guidance does not imply new adapter capabilities. Patch, move and confirmation inspection limits are described in [Hook Inspection Boundaries](./vendoring/overview.md#hook-inspection-boundaries).

### Agent-Specific Features

The repository's core `no-rm-rf` hook returns `ctx.ask` for aggregate confirmation classifications on both providers. Claude retains native confirmation; Codex uses the Clooks denial/token fallback. Classification, deny precedence, strict mode, allowlist and escape behavior are unchanged. Strict mode promotes project-root and non-allowlisted project asks to blocks; `ALLOW_DESTRUCTIVE_RM=true` does not discharge these asks or strict-mode blocks. The former Codex-only block branch has been removed locally, not in a global or marketplace installation. The actual-pack native case passed for `rm -r`, with two confirmations, exact target effects and replay refusal; it is not native `rm -rf` allow proof. Quoted-target parsing remains an unresolved, separate limitation.

Native `apply_patch` is not a member of the ten-tool Claude `PreToolUseContext` union. Use the existing [unknown-tool context pattern](./hook-type-system/patterns.md#tool-event-pipeline-fields): `ctx as unknown as UnknownPreToolUseContext`, then check the provider, exact tool name and `typeof toolInput.command === 'string'` at runtime. This authoring pattern neither widens the known-tool union nor proves that a session exposes the tool; it is not evidence of implemented or validated patch protection.

Some features only work with specific agents:
- `updatedInput` — supported by Claude Code for `PreToolUse` / `PermissionRequest`; pinned Codex PreToolUse requires allow plus a valid tool-specific full replacement. PermissionRequest rewrites are reserved and fail the handler with no decision, as detailed above.
- `additionalContext` — supported by Claude Code and by several Codex events, but exact event support must be checked per event.
- `ask` / `defer` — Claude Code `PreToolUse` capabilities. The retained Codex documentation snapshot marks native `ask` as parsed but unsupported/fail-open and does not document `defer`. Clooks now handles handler PreToolUse ask through its own denial/token fallback, without emitting native ask; defer remains refused.
- `updatedPermissions` / `interrupt` on `PermissionRequest` — Claude Code capability; pinned Codex rejects non-null permission updates or `interrupt:true` with no decision, leaving normal review absent another handler decision.
- Handler types — Claude Code supports additional hook types. Codex documents command and [MCP tool handlers](https://learn.chatgpt.com/docs/hooks#mcp-tool-hooks), while parsing and skipping `prompt` and `agent`. Clooks' Codex integration scope remains command handlers.

Clooks should expose these as agent-specific capabilities, not core contract features. Authors can branch on `ctx.provider`, but identity alone is not a capability negotiation API.

## Related

- [claude-code-hooks/overview.md](./claude-code-hooks/overview.md) — Detailed Claude Code hook reference
- [PRODUCT_EXPLORATION.md](../../PRODUCT_EXPLORATION.md) — Clooks product design
