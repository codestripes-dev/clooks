# Cross-Agent Hook Systems

Reference document for hook systems across AI coding agents. Clooks aims to provide a unified hook runtime across these agents, so understanding their differences and commonalities is essential.

## Overview

Five major AI coding agents have hook systems with similar enough patterns to support a unified runtime. Two agents have no hook system, and one has nascent/underdocumented hooks.

| Agent | Hook System | Maturity | Viable for Clooks? |
|-------|------------|----------|-------------------|
| **Claude Code** | 22 events, 4 hook types | Mature | Yes (primary target) |
| **Codex** | 12 events targeted by Clooks | Active | Twelve-event runtime includes observational SessionEnd and Interrupt; native evidence remains capability-specific |
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

**Documentation snapshot, 2026-09-07:** The mapping table below preserves the review of [official hooks documentation](https://learn.chatgpt.com/docs/hooks). The [official changelog](https://learn.chatgpt.com/docs/changelog) announces Codex CLI `0.153.4` on 2026-09-04. The website also lists `SessionEnd` and `Interrupt`; the target at that review was ten events. The current implementation supports twelve events, including observation-only SessionEnd and Interrupt. Website claims are separate from the pinned-source corrections below, especially where PermissionRequest failure behavior contradicts them. Earlier expanded Docker validation covered ten events. Native proof is capability-specific; see [native handoff, Interrupt and MCP tests](testing/codex-native.md#native-handoff-interrupt-and-mcp) and the separately tested [orderly SessionEnd shutdown path](testing/codex-native.md#native-sessionend-shutdown).

- **Clooks target events:** `SessionStart`, `SubagentStart`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `UserPromptSubmit`, `SubagentStop`, `Stop`, `SessionEnd`, `Interrupt`. Shared Claude-side event names establish scope, not capability parity; Interrupt is Codex-only.
- **Config:** `~/.codex/hooks.json`, `~/.codex/config.toml`, `<repo>/.codex/hooks.json`, or `<repo>/.codex/config.toml`
- **Trust:** project-local `.codex/` layers load only when the project is trusted; non-managed hooks must be reviewed/trusted before running
- **Handlers:** upstream supports command and [`mcp_tool` handlers](https://learn.chatgpt.com/docs/hooks#mcp-tool-hooks); `prompt` and `agent` handlers are parsed but skipped. Clooks registration pairs PreToolUse with an MCP companion while other events stay command-only. Compiled registration validation does not prove native activation. An MCP handler is distinct from observing model-issued MCP tool calls.
- **Execution:** multiple matching command hooks for one event are launched concurrently
- **Feature flag:** current docs describe hooks as enabled by default; `[features].hooks = false` disables them. Enabled configuration alone does not establish native review or activation.
- **Timeout:** seconds, defaulting to 600 for most events. Native SessionEnd and Interrupt default to 1 second with a 3-second maximum; Clooks registers 3 seconds for each entire event pipeline, not per hook.
- **Coverage:** [PreToolUse/PostToolUse coverage](https://learn.chatgpt.com/docs/hooks#tool-coverage) includes shell, unified exec, patch, MCP, and most local function tools. Hosted tools such as WebSearch bypass this path, and specialized paths may opt out. This is not a universal enforcement boundary. A later `write_stdin` completion poll can deliver the original command's PostToolUse; polling or sending input does not repeat its PreToolUse.
- **Verification status:** exact tag `rust-v0.153.4` is verified to commit `3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`; the pinned-source audit below supersedes conflicting website claims for that release. Source inspection is not executed parser/executor or live evidence. The historical `0.133.0` live attempt failed with `401 Unauthorized` and captured no hook payloads. Synthetic fixtures and registration probes do not establish native enforcement.
- **Implementation status:** `supportsRuntime: true` exposes twelve targeted events through normalization, policy and translation. The earlier ten-event implementation and `deferRuntimeErrorAudit` correction passed Docker unit, E2E and static gates; that historical evidence does not establish SessionEnd native behavior or full capability parity. SessionEnd has focused adapter/registration tests, synthetic compiled replay and separate real pinned Codex orderly-shutdown smoke: native emission reaches generated registration/current Clooks and actual tmux cleanup commands through a fake executable. This is not proof of all closure paths, failures or live tmux rendering. Registration includes SessionEnd and Interrupt with three-second total pipeline timeouts; existing installations need init refresh. Interrupt is a root-turn observer, not a cancellation veto.

The historical native CLI smoke verified real Codex 0.153.4 invoking generated registration for SessionStart, UserPromptSubmit, PreToolUse, PostToolUse and ordinary Stop. Measured effects include shell denial with exact actual-request feedback and no denied-call PostToolUse, command rewrite with original-marker absence and rewritten-marker presence, unsupported-ask refusal with no tool effect, context delivery into actual request text, and one same-turn Stop continuation whose next hook sees intervention history and skips. Context uses PreToolUse ALLOW and SessionStart/UserPromptSubmit/PostToolUse SKIP; it does not establish PreToolUse skip-context support. The boundary is a synthetic local model in network-disabled Docker, synthetic project trust, hook-trust bypass and danger-full-access, without real home/auth mounts. PermissionRequest, PreCompact, PostCompact, SubagentStart/SubagentStop, other result arms/codecs, normal trust/approvals, layered activation and recipient readability were unverified by that smoke. Current handoff behavior and capability-specific native tests are described below. See [native smoke commands and prerequisites](./testing/codex-native.md#opt-in-native-cli-smoke). No upstream Rust-test, full-ten-event or release-conformance claim follows.

Separate authorized real-session probes on 2026-09-08 extend that historical smoke boundary on installed Codex 0.153.4, without changing real auth/trust: PermissionRequest allow/default skip executed with Pre/Permission/Post observations, while deny produced a native rejected-process error with the fixture reason and no PostToolUse. Exact commands establish attribution; PermissionRequest has no native tool-use ID. Two actual children reported distinct injected SubagentStart tokens before parent token-log inspection. One explicitly targeted resumed child's SubagentStop requested an executed continuation, followed by a skipped stop with intervention history 0 to 1 and prior runs 1 to 2, without an intervening UserPromptSubmit. The observer establishes matching child/session and preserved hook history, not matching native turn IDs, which it did not capture.

Live shell allow/deny/rewrite, unsupported-ask refusal, controlled-throw failure blocking, and direct pre/post developer-context receipt were also demonstrated. Matched-only post-tool response capture proved completed stdout despite post-block feedback hiding it in the wrapper: no rollback occurred. See [real-session evidence boundaries](./testing/codex-native.md#authorized-real-session-evidence). A separate forced zero-threshold NEW-session local compaction probe passed in synthetic-loopback offline Docker: raw and configured PreCompact/PostCompact handlers fired in order (auto) with the same raw turn ID, the summary reached user-message content in the second request, and final stdout followed. Only the compact handlers were configured; other raw lifecycle captures do not establish their handler invocation. This mid-turn interactive fixture did not newly test root startup, root prompt or root Stop. Across historical smoke, interactive probes and compaction, all ten target events have some native invocation evidence. That historical evidence did not cover other result/failure variants, patch/MCP mutation, rich-history compaction and block variants, layered activation, root reset, broader trust/approval configurations, exactly-once delivery or recipient readability. Current handoff behavior and capability-specific native tests are described below. Invocation evidence does not validate every arm of an observed event.

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

The following facts come from inspected producers, parsers and consumers at [commit `3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`](https://github.com/openai/codex/tree/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks), bound to exact tag `rust-v0.153.4`. They are upstream source facts, not executed or live evidence. This audit covered the original ten target event handlers; current twelve-event capabilities, including the separate SessionEnd and Interrupt contracts, are described below. Implementation and separately measured native cases do not turn this source audit into executed upstream-test evidence or full conformance.

- **PreToolUse:** native plain allow without non-null `updatedInput` is invalid and fails the handler without vetoing the tool. The implemented Clooks allow-without-rewrite mapping emits no permission decision, with optional supported `additionalContext`; absent context/diagnostic means empty stdout and exit 0. This preserves ordinary native approval and sandbox policy. An allow reason without rewrite must not appear as a reason control field without its decision. Even with a valid rewrite-allow decision, upstream discards `permissionDecisionReason`; it is not a delivery channel. The implemented mapping uses human-facing `systemMessage` for both plain-allow and rewrite-allow explanations, with an explicit recipient-loss annotation for the unavailable native reason channel. A local-only diagnostic is insufficient, and successful stderr is discarded. Only a validated complete replacement accompanies native allow. See the [parser and unsupported checks](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/engine/output_parser.rs#L121-L517) and [warning/rewrite consumer](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/events/pre_tool_use.rs#L193-L260).
- **PermissionRequest:** non-null `updatedInput`/`updatedPermissions`, `interrupt:true`, `continue:false`, non-null `stopReason`, or `suppressOutput:true` produce a failed handler with **no decision**, leaving normal review when no other handler decides. This contradicts the website snapshot's fail-closed description. Null optional reserved values and false boolean flags do not trigger those semantic checks; unknown fields or wrong types still fail parsing. A failed handler cannot cancel a separate valid allow, and any valid deny takes precedence. See the [event consumer and aggregation](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/events/permission_request.rs#L149-L294) and [normal approval fallback](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/tools/approvals.rs#L521-L542).
- **Failure channels:** exit 2 plus nonblank stderr denies PermissionRequest; blank stderr instead fails without a decision. Exit 2 is event-specific: it can prevent tool dispatch, reject a prompt, supply post-tool feedback, or request Stop/SubagentStop continuation. It is not universal denial. Successful stderr is ignored by all ten event consumers and omitted from the [completed summary](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/engine/dispatcher.rs#L228-L255). Human diagnostics need the supported stdout `systemMessage` warning channel; event-stream delivery does not prove visibility in every UI.
- **Schemas versus runtime:** generated JSON Schemas describe producers and outputs; they are not runtime validation. Input structs serialize rather than deserialize. Output parsing uses Serde, accepts null as absence for optional values, rejects unknown record fields, and does not enforce the schema's event-specific discriminator constant against the executing event. Always emit the correct discriminator. See [schema definitions](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/schema.rs#L42-L318) and the [actual parser](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/engine/output_parser.rs#L93-L363).

Tool translation requires reversible codecs matching the native handler contract. Bash/unified exec and `apply_patch` consume only the string `command` from a replacement object; extra replacement keys are ignored and do not mutate other native arguments. The implemented Clooks command-only codec rejects unsupported edits explicitly rather than implying those fields take effect. See the [command decoder](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/tools/handlers/mod.rs#L105-L144), [unified exec codec](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/tools/handlers/unified_exec/exec_command.rs#L499-L544), and [patch codec](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/tools/handlers/apply_patch.rs#L438-L505). `Edit`/`Write` are patch matcher aliases, not Claude structured-edit input. MCP producers expose parsed JSON of any shape, or the raw argument string when parsing fails. Ordinary local function tools use the registry default: parsed JSON arguments are exposed and updated input is serialized back as the complete argument value. Clooks partial updates and null-as-unset semantics must become validated full replacements without losing untouched nulls or renaming opaque nested keys. Clooks provides command-only, opaque MCP record and generic local function object codecs. Local tool names (including namespaced names and `spawn_agent`) and opaque keys remain unchanged; no Claude aliases are synthesized. `write_stdin` opts out of native PreToolUse and has no replacement codec. Existing required/optional field promises for known public discriminators are validated initially and on each materialized candidate before later hooks observe it. This validation does not invent a native tool schema. MCP non-record inputs are observable without a rewrite codec; other non-record tool inputs remain refused. See [bounded native `update_plan` rewrite and denial evidence](testing/codex-native.md#native-local-function-tool-rewrites).

The pinned generic contract is in `codex-rs/core/src/tools/registry.rs:129-164` (`CoreToolRuntime` default PreToolUse and replacement serialization) and `registry.rs:810` (function argument parsing); `handlers/plan.rs:102` uses that default for `update_plan`. Generic object rewrites are sequential PreToolUse only, accepted on allow and ask. Parallel, PermissionRequest and PostToolUse mutations remain refused. Non-record local inputs remain unsupported.

Pinned [input producers](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/schema.rs#L275-L622) emit required nullable `transcript_path`; SubagentStop also emits required nullable child transcript and last-message fields. The normalizer implements empty-string sentinels for absent/null `transcriptPath`, `agentTranscriptPath`, `customInstructions`, `compactSummary`, and `lastAssistantMessage` on their relevant events. Accepting absence for required nullable fields is broader Clooks compatibility, not strict native validation; compact summary/custom instructions are absent from these producers. Supplied strings remain unchanged, making unavailable and genuinely empty values indistinguishable publicly while preserving raw absence/null privately. Operational IDs and required event data must not be fabricated. Source now establishes ordinary root/child identity and continuation constraints, but internal Review prompts prevent a full genuine-user-turn parity claim; normal best-effort native-prompt history is the approved planned mapping, with Review accepted as a nonblocking limitation and no special workaround. Provider-isolated history and prompt-boundary handling are now connected; expanded Docker validation has passed. See [Turn State](./turn-state.md#codex-source-constraints-and-proposed-mapping).

Failure and delivery are event-specific. Source inspection resolves the ten-event process-failure paths; actual parser/executor and native execution evidence remain separate requirements. The [tool feedback consumer](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/tools/registry.rs#L673-L750) distinguishes post block/exit 2 from post `continue:false`, including rejection after tool execution. [Context recording](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/hook_runtime.rs#L825-L849) and [native output spilling](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/output_spill.rs#L12-L130) establish text/pointer insertion and file writing, not recipient access to Clooks handoff files. UI warnings, main-agent context, child context, and tool feedback require separate delivery treatment.

<a id="current-pretooluse-implementation"></a>

#### Current Runtime Capabilities

Hook portability also depends on author tool assumptions. A historical fake-vendor probe showed the earlier `no-edit-protected` hook skipped native `apply_patch` because it expected Claude file-tool fields. The repository pack now inspects supported patch headers; separate [actual-pack native evidence](./testing/codex-native.md#actual-pack-native-evidence) establishes bounded unprotected-patch success and protected-patch denial. Event registration and matcher aliases alone do not make arbitrary hooks portable; broader patch variants and MCP mutation remain outside that proof.

The following describes the current twelve-event implementation. Historical Docker/native receipts retain their tested scope.

| Event | Accepted author results and emitted controls |
|---|---|
| SessionStart / SubagentStart | Skip only, with optional context/debug; observer block is a policy failure. |
| PreToolUse | Allow/block/skip with optional context and handler ask through Clooks confirmations; sequential allow/ask can rewrite through an approved codec. Plain allow retains native policy. |
| PermissionRequest | Allow/block/skip; nested allow or deny/message only. Block accepts `interrupt:false` as the native default and omits it on output; `interrupt:true`, rewrites, permission updates, context and reason on allow remain refused. |
| PostToolUse | Block/skip with optional context; block is feedback after execution, not rollback. No output rewrite. |
| UserPromptSubmit | Allow/block/skip with optional context; block emits decision/reason. No session title. |
| PreCompact | Allow/block/skip; block emits `continue:false` and `stopReason`. No context. |
| PostCompact | Skip/debug only; no context or rollback. |
| SessionEnd | Skip/debug only (including void/null no-op); no context, rewrite or decision. Success has empty stdout; diagnostics are local stderr, discarded natively on success. Failure cannot veto closure. |
| Interrupt | Codex-only root-turn observer; skip/debug or void/null no-op. Diagnostics use stdout `systemMessage`; no decision, context, continuation or cancellation veto. Total pipeline timeout is 3 seconds. |
| Stop / SubagentStop | Allow/block/skip; author block emits decision/reason, requesting continuation. Failure instead requests termination. No context. |

All blocks require nonblank reasons. Except for PermissionRequest block's accepted `interrupt:false`, unsupported fields are refused even when false, null or empty; undefined object fields remain no-ops. Shared public methods can construct fields that Codex rejects. PermissionRequest has no fabricated tool-use ID; tool description stays inside opaque input. PostToolUse preserves any JSON response, including null/scalars/arrays. `exec_command` canonicalizes to Bash on all three tool events, with canonical required/optional field checks; only PreToolUse has the stricter command-only rewrite codec. Tool input keys are not recursively renamed.

SessionEnd normalizes only nonempty `session_id`/`cwd`, nullable or absent `transcript_path` using the existing empty-string sentinel, and `reason` exactly `other`. Model, permission mode and turn identity are neither required nor exposed. Even an injected `turn_id` leaves private `nativeTurnId` null. Its explicit null turn policy avoids history loading, pruning, deletion and creation; hook-visible history is empty. Skip-only observer policy rejects decisions and invented controls at the result-policy boundary, including before-hook inputs. Diagnostics/system messages route only to local stderr because native SessionEnd ignores stdout and discards successful stderr; exit-2 failure reports no closure veto. Existing continue/trace fallback and circuit accounting remain intact. Source contract is pinned to `rust-v0.153.4` / `3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`; the synthetic fixture and registered compiled subprocess smoke in [testing](./testing.md#codex-sessionend-coverage) are not native captures or proof of native delivery.

`src/agents/codex/normalize.ts` normalizes all twelve target events before hook imports when configuration is present. No-config bypasses full normalization; the paired PreToolUse path separately reads native identity before discovery/configuration. The new run path does not retire historical token-store acknowledgements. Every fully normalized event requires nonempty session ID and cwd; all except SessionEnd require model. SessionStart and SessionEnd need no native turn ID; other events require one. Compact events and SessionEnd omit public permission mode; others require it. SessionStart preserves model and validates startup/resume/clear/compact source. SubagentStart/Stop require both child ID and type; supplied child identity on other events except SessionEnd and Interrupt must also be paired. Interrupt retains required model, permission mode and private native turn identity without starting or closing a turn; child identity is not exposed. Stop variants require boolean `stop_hook_active`; prompts require a string, including empty. Compact triggers are manual/auto. Nullable descriptive strings use empty sentinels while raw absence/null remains private.

Command codecs cover `Bash`, `exec_command` (public canonical name `Bash`) and `apply_patch`, requiring string `command` with no extra keys. MCP names beginning `mcp__` preserve any JSON input for PreToolUse/PostToolUse observation, including null, scalars, arrays and raw argument strings. Public unknown-tool input is `unknown` and requires shape narrowing; known-tool discriminators stay typed. Only record MCP inputs receive the existing partial-patch codec. Non-record inputs can be blocked, skipped or bound to approvals without a fabricated `{}` or arbitrary replacement API. Partial updates skip undefined values, remove keys explicitly set to null and preserve untouched nulls/nested spelling; validated full candidates reach later hooks and native serialization. Ordinary local function tools use the generic object codec for sequential PreToolUse allow/ask rewrites; `write_stdin` remains excluded and local non-record inputs remain refused. Known Claude tool discriminators require compatible public fields both initially and after each patch; matcher aliases do not synthesize Edit/Write payloads.

On both agents, typed PreToolUse `ctx.skip({ injectContext })` and lifecycle skip can supply standalone context without a permission decision. Accepted nonempty skip contexts accumulate in configured order with eligible decision contexts, including all-skip runs and later empty winners. Skip remains abstention; decision ranks, losing block/ask exclusions and Claude defer's context dropping are unchanged. This matches [Claude's independent additionalContext contract](https://code.claude.com/docs/en/hooks#pretooluse-decision-control); it does not extend the historical native smoke evidence above.

For PreToolUse, `policy.ts` accepts allow/block/skip and handler-only ask with supported string context/debug fields. Block requires a nonblank reason; ask permits any string reason, including empty or whitespace, and an optional verbatim nonblank question of at most 512 JavaScript UTF-16 code units. Both provider paths reject an invalid question before interaction or effects. Sequential allow/ask rewrites use the same codec checks; parallel rewrites remain rejected. A dynamically returned `beforeHook` ask (like allow) is unsupported: the shared lifecycle warns, treats it as a no-op and continues the handler, with no confirmation or independent denial. The policy rejects a supplied before-hook-origin ask, but production lifecycle handling does not forward that return. Other-event handler asks and defer remain unsupported. Unsupported arms/fields reaching policy are failures before effects. Raw-result preflight runs before cloning and refuses lossy shapes such as accessors, symbol keys, cycles, sparse/extended arrays and non-JSON values; undefined object fields remain permitted no-ops. Plain allow emits no native decision, optional context, and empty stdout when there is nothing to deliver. Rewrite allow emits the encoded full replacement. Both allow-reason forms become human `systemMessage` annotations naming recipient loss; neither a native allow-reason field nor successful stderr is counted as delivery.

The engine routes handler PreToolUse asks through [shared live checkpoints](./interactive-approvals.md#engine-checkpoints) on both agents, not token retries or native Codex ask. Sequential asks wait before later hooks; parallel asks follow audited configured order. Missing live interaction refuses an ask, and final serialized-operation changes require reconfirmation. Public constructors remain synchronous. Compiled engine tests and [generated-registration native cases](./testing/interactive-approvals.md#generated-registration) have separate evidence boundaries. The [former token fallback](./codex-approvals.md) and its [15-case native suite](./testing/codex-native.md#hybrid-approval-case-evidence) remain historical evidence for shell/direct-patch retries, rewrite permission controls and actual-pack `rm -r` replay refusal, not proof of the new checkpoint flow. The token controller, store and CLI are removed; old databases remain inert and untouched.

The shared checkpoint chooses confirmation presentation from its validated
mailbox provider. Claude Code uses a fieldless object form and approves only the
native `accept` response with exact empty content. Codex keeps the required
decline-first `Decline`/`Approve` field because its client may auto-accept an
empty form, and only exact `accept` plus `Approve` approves. The displayed
operation and reason are otherwise identical; response shape is never used to
infer the provider.

An explicit valid form refusal/cancellation is a typed PreToolUse failure with the
exact native reason `[hook-name] Approval declined. Operation not run.` or
`[hook-name] Approval cancelled. Operation not run.` Both providers emit their
normal exit-0 PreToolUse deny JSON. Codex omits `systemMessage` only for these
typed outcomes, avoiding a duplicate diagnostic. Malformed responses, transport
failures, shared-signal cancellation and unrelated policy failures retain their
existing fallback behavior.

Known-event failures request controls through exit-0 JSON plus `systemMessage`: PreToolUse deny; PermissionRequest nested deny; UserPromptSubmit/PostToolUse block (post-tool feedback cannot undo execution); SessionStart/PreCompact/Stop/SubagentStop `continue:false` (Stop ends continuation). SubagentStart, PostCompact and SessionEnd return stderr/exit 2 with no startup veto, rollback or session-closure veto claim. Interrupt reports local observer failure through exit-0 stdout `systemMessage`, without cancellation veto. Unidentified events also return local stderr/exit 2 without a prevention guarantee. These failure dispositions remain separate from ordinary author-result translation. Generated-error policy timing uses `deferRuntimeErrorAudit` to preserve onError/counter accounting. Historical unsupported-ask and token-runtime native probes do not validate the current live-checkpoint integration. The bounded live controlled-throw shell probe establishes that failure case, not every generated-failure variant.

Private turn policy now resets startup/clear, preserves resume/compact, advances every root UserPromptSubmit even with a repeated native turn ID, and preserves child prompts and Stop continuations. SessionStart prunes only the selected provider store. Configured Codex handoff is enabled for eligible model-facing context and block reasons through the shared file/pointer path. Thresholds, safe writes and inline fallback on write failure remain unchanged. [Full native receipt `smoke-3h0FR9X0`](./testing/codex-native.md#native-handoff-interrupt-and-mcp) passed 26 cases with 28 launches, including seven parent handoff cases, child reads in three sandbox modes, Interrupt observation, six non-record MCP denials and record rewrite/PostToolUse. This is bounded synthetic-model native evidence for that snapshot, not universal server acceptance or full release conformance. See [Turn State](./turn-state.md), [Execution](./config/execution.md) and [Handoff](./config/handoff.md).

Agent selection is explicit: registration sets `CLOOKS_AGENT`, and runtime does not infer the provider from payload shape. The shared engine owns discovery/config/loading, matching, lifecycle, execution and reduction; adapters own invocation normalization, policy, state-boundary choices, diagnostics and wire output.

Hook-pack discovery is implemented for both adapters: Claude uses independent settings activations, while Codex uses the bounded persisted-file contract described in [Plugin Vendoring](vendoring/plugin-vendoring.md). Both vendor into shared Clooks paths and use the existing scope merge, so alternating agents does not duplicate hook execution. Native disable/removal never deletes user-owned hook copies or overrides. Explicit `clooks update plugin:<pack>` discovers both providers independently of `CLOOKS_AGENT`, rejects conflicting sources before writes, and permits `--agent claude-code|codex` source filtering. Claude stale-registration advisories require known Claude identity and are suppressed by an enabled Codex pack at the same physical destination. Pack discovery and compiled integration tests do not extend native event or permission guarantees.

Claude remains the complete implemented adapter and retains its recursive key normalization, output translation, notify-only routing, ConfigChange downgrade and plugin/settings advisories. Codex's twelve-event implementation reuses the shared ordering/reduction boundary; registration emits one entrypoint per targeted event. SessionEnd and Interrupt register `timeout: 3` seconds for each entire pipeline, not per hook. Init refresh adds missing events and repairs owned observer entries without the timeout, retaining idempotent repeat and unrelated uninstall preservation. Native capability descriptions must distinguish emitted requests, inspected upstream consumers and actual execution evidence.

The runtime implementation carries an invocation-bound result policy as well as normalization and final output. In `src/agents/types.ts`, `normalizeInvocation()` returns `eventName`, public `context`, and separate `private` metadata: provider, raw payload, session/native-turn/child identity and an optional tool codec. `createResultPolicy(invocation)` binds checking to that invocation. The engine passes only `context` into hook execution; the private envelope is retained for policy construction and translation, not spread into author or lifecycle inputs. Claude retains its existing normalized public shape and uses the permissive `legacyResultPolicy`. The boundary has passed full Docker unit, compiled Claude E2E and static validation, including public-shape preservation, observer mutation, detached results and parallel failure accounting. Those completed shared-boundary gates predate the concrete Codex integration and do not establish its acceptance.

`executeHooks()` accepts an optional tenth `InvocationResultPolicy` argument, defaulting to the legacy Claude policy for existing callers. `src/engine/result-policy.ts::checkDetachedResult()` deep-clones policy input and output and turns a thrown checker into a structured rejection without exposing its exception text. The executor checks author/lifecycle results after observer mutation and parallel-contract failures before result effects and capability-driven cancellation. Codex defers ordinary generated-error audits until after capture, onError selection and counter accounting, then audits selected blocking errors; do not conflate this with immediate author-capability refusal. Accepted `nextToolInput` is a complete candidate, not another partial patch. A latched rejection closes further result effects and remains separate from ordinary hook failure/degradation; raw turn-history recording is distinct from accepted output. This boundary does not constrain trusted hook code's own I/O.

The live-checkpoint integration adds optional arguments 11/12 for interaction
and invocation signal. Adapter `approvalIdentity`, `approvalOperation` and
`serializedApprovalOperation` keep native identity, candidate encoding and actual
output inspection separate. `RunEngineDeps` injects interaction creation,
cancellation and approval-lifetime ownership. These compiled-test-validated
internal interfaces are not new hook-author methods or proof of native registration.

Diagnostic composition is adapter-owned and structured: `composeDiagnostics()` receives the result plus trace, degraded and debug messages, and returns a result, stderr lines and system messages. The engine explicitly selects `translateFailure()` when execution returns `policyFailure`, even if diagnostic composition or final adjustment supplies allow. Codex places trace text in context for SessionStart, SubagentStart, PreToolUse, PostToolUse and UserPromptSubmit; other events use human system messages for trace. Degraded notices use system messages and debug lines remain local stderr. Its event-bound policy supplies raw preflight; shared configured handoff is enabled, and private turn policy and provider storage are connected. Claude sends debug lines to stderr and appends them to context only for injectable events; non-injectable events retain an empty or skip aggregate without a synthetic allow decision. Its default turn policy is unchanged. The expansion and its `deferRuntimeErrorAudit` correction have their own passing Docker unit, E2E and static gates, separate from the earlier PreToolUse gate.

Clooks assumes the repository is trusted. Global invocations intentionally load the merged home/project/local configuration and repository hook code; no separate repository authorization layer is required. Tighter permission models are deferred. Native agent hook activation still applies. Codex project suppression checks registration freshness and home identity, but cannot establish that the native global hook is enabled, reviewed or firing. Claude retains its existing flag-based suppression behavior.

Global Codex init/uninstall resolve the effective state home physically, following directory symlink aliases and resolving the nearest existing ancestor when directories are missing. Resolution performs no writes. Nonempty `CODEX_HOME` must be absolute and contain no CR/LF or NUL; this is a Clooks registration constraint. Project registration remains `<project>/.codex/hooks.json`, while shared Clooks files remain under the installation home. `CLOOKS_HOME_ROOT` keeps its runtime config/state meaning and does not relocate installation.

Before changing selected-Codex/all global runtime files, init validates existing state, atomically records the selected Codex home in `.clooks/.codex-registration-home`, and retires any old matching Codex receipt. Recording must succeed before retirement. Retiring before launcher repair prevents a later failed registration from making an old receipt newly eligible. Only successful registration and an executable launcher permit publishing `.clooks/.global-entrypoint-active.codex`. This receipt records canonical installation/Codex homes and the POSIX `cksum` of committed `hooks.json`; the recovery record never suppresses project execution. A failed receipt publication retains cleanup identity and blocks switching homes until matching cleanup succeeds.

Current init preflights selected hook/server destinations, project identities and
shared outputs before writes. Claude-only init remains independent of Codex
state, but malformed Claude registration now fails before launcher repair and
cannot revive receipt eligibility through that preflight failure. Subsequent
file commits remain nontransactional. This is not a broader Codex cleanup policy.

New project launchers reject absent, empty legacy, malformed, stale or mismatched receipts and fall through to project execution when checksum checks fail. A set `CLOOKS_HOME_ROOT` must resolve to the installation home for suppression eligibility; empty, relative or different overrides disable that eligibility. Any registration-byte change invalidates freshness, including changes to unrelated hooks. Rerun both project and global init to upgrade older existence-only scripts and legacy state; unrelated checkouts are not rewritten.

Only one Codex home is recorded per installation home. Conflicting or malformed records require repair. Empty legacy flags identify the default Codex home. Unhooking a different selected home preserves the recorded home's state; full global deletion considers the selected and recorded homes. State clears only after all-event inspection finds no owned references, including on unknown events. Missing hooks allow cleanup, while ambiguous containers and surviving unknown-event references retain identity and block a home switch. Receipt removal precedes recovery-record removal so partial cleanup can be retried. Older unrecorded homes require explicit `CODEX_HOME` cleanup; no many-home registry or home scan is introduced. See [Global Hooks](./global-hooks.md#codex-home-and-registration-state) for exact record formats and recovery ordering.

Codex behavior notes are summarized here because planning and research artifacts are not part of the committed domain documentation.

Registration data is validated before transformation. Invalid managed containers or JSON produce actionable errors without rewriting the original registration file; detection inspects all events and refuses ambiguous structures. Unknown metadata and untraversed event values are retained. Both agents use atomic file replacement with mode preservation and reject registration-file symlinks, including dangling links. This is per-file recoverability, not a multi-agent transaction.

Paired registration has passed compiled validation and review. Each PreToolUse
command and `clooks.check` companion gets the shared 2,147,483-second native
fallback (about 24.85 days) and explicit provider, owner and protocol metadata.
Codex MCP tool timeout uses the same seconds; Claude server `timeout` uses
2,147,483,000 ms, overriding its wall timer and raising the default 30-minute idle
floor. This finite fallback leaves Clooks' cancellation-only human wait and
hook/startup/attachment budgets unchanged. Project Claude has a separate persisted owner
marker; Codex reuses its locator marker. Claude server files are project
`.mcp.json` and global `HOME/.claude.json`; Codex uses `config.toml` beside its
hooks file. Claude-selected operations reject any defined `CLAUDE_CONFIG_DIR`
or existing `HOME/.claude/.config.json` before mutation; Codex-only/custom-home
behavior remains independent. Paired suppression publishes a neutral terminal
disposition through the binary, not an MCP-side dedup predicate. Uninstall handles
owned server/companion remnants and preserves live approval IPC during full
cleanup. No migration advisories or automatic configuration writes are added.

Codex ownership recognizes the exact generated project locator with its canonical ID argument and the supported quoted global command, including exact paired metadata prefixes. There is no compatibility parser for unreleased absolute project commands. Echo mentions, extra arguments, and additional shell operations stay user-owned. Init converges owned PreToolUse entries into a command/companion pair and other events into one canonical command; surviving mixed groups retain unrelated hooks and metadata. Claude likewise preserves unrelated hooks during unhook and recognizes its established generated and legacy command forms plus exact owned companions.

Codex project registration is portable: Codex/all project init creates one committed `.clooks/bin/codex-project-id`, retained on re-init and cloned with the checkout. Its launcher searches bounded ancestors for that declaration's exact ID, refuses repeated matches, and executes the owning Bash entrypoint without changing cwd or consuming stdin. It dynamically anchors `CLOOKS_PROJECT_ROOT` only when no explicit override exists. Distinct nested declarations retain ownership; a copied registration cannot target a still-existing old checkout outside the search boundary. See [Bash Entrypoint](bash-entrypoint.md#hook-registration) for Git/home boundaries, missing-artifact diagnostics and marker lifecycle. Global commands still forward deliberate `CLOOKS_PROJECT_ROOT` and inherited `CLAUDE_PROJECT_DIR`; the Codex `discoveryEnvironment()` helper removes the inherited Claude key from an invocation-local copy while retaining explicit overrides. Compiled tests assert actual hook decisions and execution receipts across clones, moves, nested roots and linked worktrees; these do not by themselves establish native hook review/activation.

#### Explicit Plugin Onboarding

The sibling marketplace's existing `clooks/` package serves both agents with
separate skill trees: Claude uses `skills/setup/`, Codex uses `codex-skills/setup/`.
Both use the canonical `skills/setup/scripts/install.sh`. Codex's manifest points
to `./codex-skills/` and `./codex-hooks/hooks.json`; its catalog is
`.agents/plugins/marketplace.json` in the marketplace repository.

```bash
codex plugin marketplace add codestripes-dev/clooks-marketplace
codex plugin add clooks@clooks-marketplace
```

Users explicitly invoke `$clooks:setup` in Codex or `/clooks:setup` in Claude.
Plugin installation/startup never installs, updates or initializes the runtime.
The only plugin hook is a read-only SessionStart reminder; `clooks init` remains
the owner of runtime registrations. Codex setup defaults to project
`init --agent codex`; global or both-agent setup requires an explicit request.
Claude retains its project init flow and optional global offer.

Installer selection is executable PATH first, managed home binary second. Reuse
validates `--version` without download/profile writes; broken or mismatched
binaries fail. Explicit update cannot overwrite or shadow an external selection.
Absolute-path init does not establish agent PATH readiness or native trust. See
[installer behavior](cli-architecture.md#plugin-installer) and
[pack-discovery boundaries](vendoring/plugin-vendoring.md#onboarding-is-not-pack-discovery).

Native onboarding is tested with Codex CLI `0.154.0` across three scenarios and
nine real Codex sessions; this is a tested version, not an established minimum.
Coverage includes actual TUI hook trust, first-message reminders, ordinary versus
explicit skill inclusion, installer download/init/runtime dispatch, declined
trust, PATH reuse without downloads, and plugin removal preserving the runtime.
The network-disabled Docker tests use synthetic repository trust, a disabled
sandbox and a scripted local provider, not live-model obedience. See
[native onboarding evidence](testing/codex-native.md#native-plugin-onboarding).

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

Codex maps similarly to Claude Code for the shared event-name subset: `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `SessionStart`, `PreCompact`, `PostCompact`, `SubagentStart`, `SubagentStop`, and `Stop` use the same event names. The result capabilities are not identical. `PermissionRequest` also exists, but its current output capabilities are narrower than Claude Code's. `SessionEnd` is observational; `Interrupt` is a Codex-only root-turn observer, not a Claude event.

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

The repository's vendored core hooks use that identity for bounded provider differences. `prefer-builtin-tools` omits built-in read/search/listing restrictions for Codex while retaining configured additional rules and per-rule disables; applicable write restrictions recommend `apply_patch` when available, and sleep guidance refers to available process-wait tools. Claude keeps its existing guidance. `no-compound-commands` changes Codex wording, not classification or escape behavior. `no-pasted-placeholder` checks both `[Pasted text #N +N lines]` (including singular `line`) and `[Pasted Content N chars]` on Claude, Codex and legacy undefined-provider contexts; an outside suffix such as ` #2` does not prevent detection. This is a heuristic for potentially unexpanded pastes, not proof of missing content; literal examples also match. Prompts starting exactly with `<task-notification>` still skip. Provider-specific hook guidance does not imply new adapter capabilities. Patch, move and confirmation inspection limits are described in [Hook Inspection Boundaries](./vendoring/overview.md#hook-inspection-boundaries).

### Agent-Specific Features

The project `js-package-manager-guard` checks normalized shell commands on both providers with the same configured allowlist, automatic runner/runtime extensions and `additionalBlocked` rules. It recognizes quoted executable names and newline-separated command heads, including environment-assignment prefixes. Quoted arguments/comments remain inert, escaped newlines continue a command, and pipe targets remain excluded even across continuation newlines. Executable paths and unknown tools are not resolved or autodetected; explicit additional rules retain exact-name matching. Inspection is bounded lexical parsing, not shell evaluation; nested execution and heredocs stop inspection of the remaining input. Its SessionStart announcement refers to shell tools without implying extra adapter capabilities.

For both providers, `no-compound-commands` permits a leading `cd <path> && <one-command>` only with `&&`, not `;`. Quoted paths and a piped remainder remain supported; `ALLOW_COMPOUND=true` still bypasses the check, including semicolon cd commands.

The repository's core `no-rm-rf` hook returns `ctx.ask` for aggregate confirmation classifications on both providers. The engine's live-checkpoint integration replaces native-ask/token-fallback routing. Classification, deny precedence, strict mode, allowlist and escape behavior are unchanged. Strict mode promotes project-root and non-allowlisted project asks to blocks; `ALLOW_DESTRUCTIVE_RM=true` does not discharge these asks or strict-mode blocks. The former Codex-only block branch was removed locally, not in a global or marketplace installation. The historical token-runtime native case passed for `rm -r`, with two confirmations, exact target effects and replay refusal; it is neither new live-checkpoint evidence nor native `rm -rf` allow proof. Quoted-target parsing remains an unresolved, separate limitation.

Native `apply_patch` is not a member of the ten-tool Claude `PreToolUseContext` union. Use the existing [unknown-tool context pattern](./hook-type-system/patterns.md#tool-event-pipeline-fields): `ctx as unknown as UnknownPreToolUseContext`, then check the provider, exact tool name, non-null object input shape and `typeof toolInput.command === 'string'` at runtime. This authoring pattern neither widens the known-tool union nor proves that a session exposes the tool; it is not evidence of implemented or validated patch protection.

Some features only work with specific agents:
- `updatedInput` — supported by Claude Code for `PreToolUse` / `PermissionRequest`; pinned Codex PreToolUse requires allow plus a valid tool-specific full replacement. PermissionRequest rewrites are reserved and fail the handler with no decision, as detailed above.
- `additionalContext` — supported by Claude Code and by several Codex events, but exact event support must be checked per event.
- `ask` / `defer` — distinct `PreToolUse` decisions. The current shared engine integration resolves asks through live checkpoints; missing interaction refuses rather than emitting native ask or issuing retry tokens. Claude defer retains its mode-dependent semantics and is not a universal native veto; Codex defer remains refused. The retained Codex source snapshot marks native ask unsupported/fail-open. Live checkpoint integration and generated-registration conformance have separate validation gates.
- `updatedPermissions` / `interrupt` on `PermissionRequest` — Claude Code capability; pinned Codex rejects non-null permission updates or `interrupt:true` with no decision, leaving normal review absent another handler decision. Clooks accepts PermissionRequest block's `interrupt:false` and emits an ordinary denial without that field.
- Handler types — Claude Code supports additional hook types. Codex documents command and [MCP tool handlers](https://learn.chatgpt.com/docs/hooks#mcp-tool-hooks), while parsing and skipping `prompt` and `agent`. Clooks uses command handlers plus a generated PreToolUse MCP companion, with compiled validation distinct from native conformance.

Clooks should expose these as agent-specific capabilities, not core contract features. Authors can branch on `ctx.provider`, but identity alone is not a capability negotiation API.

## Related

- [claude-code-hooks/overview.md](./claude-code-hooks/overview.md) — Detailed Claude Code hook reference
- [PRODUCT_EXPLORATION.md](../../PRODUCT_EXPLORATION.md) — Clooks product design
