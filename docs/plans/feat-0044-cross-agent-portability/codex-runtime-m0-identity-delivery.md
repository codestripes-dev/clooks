# M0 Source Sidecar: Identity and Delivery

Audit date: 2026-09-07. Scope: Plan D M0 identity, user-turn boundaries, continuation, compact/resume, and context delivery. This report owns no production or test changes.

**Release-bound SOURCE evidence: Codex 0.153.4.** Exact ref `refs/tags/rust-v0.153.4`, tag object `042fb41b7c813ac7999105e886b2b7aa715b5081`, peels to commit `3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`. The inspected export at `tmp/codex-runtime-m0/output/source/codex-rs/` matches the exact-tag export across all 4,177 manifest files. Acquisition provenance and the retained archive are recorded in [M0 evidence](codex-runtime-m0-evidence.md). Every upstream citation below names that immutable commit. This establishes selected-release source semantics, not executed parser/executor behavior, captured runtime payloads, or native enforcement.

Read-only shell file inspection only; no upstream code execution, test execution, network access, Docker use, or Codex execution. Tests below were read, never run. Consulted Plan D M0, `codex-runtime-contract-refresh.md`, `docs/domain/turn-state.md`, `docs/domain/config/handoff.md`, and current Clooks turn boundary/scope code.

## Gate Conclusions

| Question | Release-bound SOURCE conclusion |
| --- | --- |
| Does Stop/SubagentStop continuation create UserPromptSubmit or allocate another native turn? | No. Both use the same `run_turn` loop, append a hook-generated user-role response item, set `stop_hook_active`, and continue with the existing turn context. |
| Can the ordinary root + ThreadSpawn child once-per-user-prompt sequence be represented without fabricated upstream IDs or transcript parsing? | Yes, as a bounded source-derived mapping: share root `session_id`, scope by native `agent_id`, advance all scopes on root UserPromptSubmit only, preserve on child UserPromptSubmit and continuation. Native turn changes must not reset history. This is not executed parity evidence. |
| Is that enough to claim existing Clooks parity for every supported runtime path? | No. Synthetic non-ThreadSpawn delegates can submit UserInput without `agent_id`; the command payload lacks an origin/session-source discriminator. The concrete review path below prevents treating absent `agent_id` as universal proof of a real root-user boundary. The subsequent user decision accepts normal best-effort tracking with this documented nonblocking limitation, without a special workaround; full parity remains unsupported. |
| Which discriminator identifies a native-generated continuation? | Internally, the Stop branch directly records a `ResponseItem` instead of passing `TurnInput::UserInput` to `inspect_pending_input`. There is no continuation-origin field on UserPromptSubmit because this branch does not emit that event. `stop_hook_active` exists on Stop/SubagentStop only and is not a human-prompt identifier. |
| Stable repeated-delivery identifier? | None established for command UserPromptSubmit/Stop deliveries. `turn_id` repeats for distinct prompts and Stop passes. Internal `run_id` identifies a configured handler, not a unique invocation. |
| Can file-pointer readability be assumed for root or child? | No. Source proves text/pointer insertion and file writing, not recipient access or a subsequent read. Keep recipient-aware inline fallback; no generic Clooks handoff-readability gate passes here. |
| Overall M0/release gate? | Exact-release source binding is established. The subsequent user decision accepts best-effort history with Review nonblocking. M0 source/probe/review work is complete and M1 is authorized/in progress; this is planned mapping approval, not implemented tracking or P/L evidence. |

## Identity and Turn Allocation

1. `Session::session_id()` is explicitly shared by the root and all descendants; `thread_id()` is concrete per thread ([session/session.rs:595-603][identity]). Initialization uses the root thread ID as session ID, restores persisted session ID on resume, and falls back to the agent controller's shared session ID for non-root agents; a legacy-child compatibility branch filters old self-derived session IDs ([session/session.rs:760-796][resume-identity]). Thus nested lifecycle `session_id` is the root's, not necessarily the immediate parent's thread ID.
2. `thread_spawn_subagent_hook_context()` returns identity only for `SessionSource::SubAgent(SubAgentSource::ThreadSpawn { .. })`; `subagent_hook_context()` supplies `sess.thread_id()` as `agent_id` and role/default role as `agent_type` ([hook_runtime.rs:1013-1033][child-helper]). Request constructors use it for PreToolUse, PermissionRequest, PostToolUse, PreCompact, PostCompact and UserPromptSubmit. Their wire schemas expose optional, omitted-when-absent `agent_id`/`agent_type` ([schema.rs:277-383][ordinary-schema], [schema.rs:567-584][prompt-schema]). These fields are missing from the earlier documentation-only research tables.
3. `run_pending_session_start_hooks()` maps ThreadSpawn startup to SubagentStart using the **child's active** `sub_id`, child identity, shared session ID, and that child's transcript path. Other child start sources are skipped; root receives SessionStart ([hook_runtime.rs:124-178][start]). `run_turn_stop_hooks()` substitutes SubagentStop for ThreadSpawn Stop; it looks up the immediate parent's transcript separately, supplies the child's transcript as `agent_transcript_path`, uses the shared root session ID, and keeps the child's active turn ID ([hook_runtime.rs:375-451][stop-runtime]). Parent transcript lookup failure yields null; it is not missing identity recovery.
4. `new_submission_id()` allocates a UUIDv7 submission ID ([session/mod.rs:959-966][allocation]); `PreparedTurnInputSettings::apply_started()` passes the submission ID into new turn construction ([turn_input.rs:118-170][started]); the resulting `TurnContext.sub_id` becomes hook `turn_id`. `start_or_steer()` reuses the active turn for steering ([turn_input.rs:237-324][steer]). Multiple distinct user prompts can therefore share one hook `turn_id`. Default internal contexts can instead use `auto-compact-{counter}` ([session/mod.rs:1282-1287][internal-id], [turn_context.rs:1082-1097][default-turn]). Treat all native IDs as opaque, not as timestamps or user-origin markers.

## Continuation and Real User Boundaries

`run_hooks_and_record_inputs()` calls `inspect_pending_input()` for each queued input. The latter runs UserPromptSubmit for `TurnInput::UserInput`; ResponseItem, FunctionCallOutput and InterAgentCommunication return without a prompt hook ([turn.rs:638-664][input-loop], [hook_runtime.rs:661-701][inspect]). It builds the prompt from actual submitted content. No generated/real flag, client input ID, parent turn ID or root turn ID is serialized in `UserPromptSubmitCommandInput` ([prompt-schema]).

At completion, `run_turn` calls `run_turn_stop_hooks()`. A block with fragments calls `build_hook_prompt_message()`, records it directly through `record_response_item_and_emit_turn_item()`, sets `stop_hook_active = true`, and executes `continue` in the same loop ([turn.rs:510-565][continuation]). `build_hook_prompt_message()` constructs a user-role Message from hook fragments ([protocol/items.rs:634-655][hook-message]); model-visible user role does **not** mean another UserPromptSubmit boundary. The Stop aggregator makes `continue:false` take precedence by suppressing `should_block` if any handler asks to stop ([events/stop.rs:413-446][stop-aggregate]). This corrects the research wording that continuation acts as a new user prompt: it does so in model history, not through native prompt-hook dispatch or turn allocation in this tree.

The candidate ordinary-path Clooks policy follows from those callers:

| Input/event sequence | Required Clooks interpretation |
| --- | --- |
| Root UserPromptSubmit, first Stop blocks, continuation, second Stop | Advance at the prompt; first Stop sees no prior intervention; preserve on native continuation; second Stop sees the hook's raw prior block and can skip. |
| Another root prompt, including a queued steer with the same native turn ID | Advance again and clear every scope. Do not deduplicate on `turn_id`, compare prompt strings, or use `stop_hook_active` to suppress this boundary. |
| Root spawns child; SubagentStart; child UserPromptSubmit with `agent_id`; child SubagentStop blocks then runs again | File child records under its native identity. Do not clear root or child history on the child prompt. The child continuation stays in its own existing turn loop. |
| Parent sends more work to an existing ThreadSpawn child in the same root user turn | Child UserPromptSubmit is still not a global user boundary. Child native turn changes do not erase prior SubagentStop intervention history. |
| Next root UserPromptSubmit while children exist | Clear all scopes, matching current Clooks session-wide generation behavior; storage race/loss limitations remain those documented in `turn-state.md`. |

Current Clooks advances unconditionally on UserPromptSubmit (`src/engine/run.ts:281-295`) and uses `agentId`/`main` scopes (`src/engine/turn-state.ts:197-202`). Direct reuse would incorrectly clear all history at child submission. The bounded mapping needs a provider-private boundary policy; it does not require inventing an upstream ID or a public API field. Existing Clooks epoch/generation storage is local bookkeeping, not evidence of native delivery.

### Concrete Limit: Synthetic Review Input

Absent `agent_id` does not universally mean a root human prompt:

- `spawn_review_thread()` clones parent features and disables WebSearchRequest, WebSearchCached and Goals, then copies those features into the review config ([session/review.rs:31-55][review-features]). It synthesizes the review prompt as UserInput ([session/review.rs:183-200][review-seed]); `ReviewTask::run()` extracts it and `start_review_conversation()` clones config, disables web search, Collab and MultiAgentV2, sets review instructions/model and approval policy Never, then calls `run_codex_thread_one_shot(..., SubAgentSource::Review, ...)` ([tasks/review.rs:54-144][review-task]). **Neither stage disables CodexHooks or removes the inherited hook configuration.** Feature disable changes the requested feature only, with no dependency cascade to CodexHooks ([managed_features.rs:113-125][managed-disable], [features/src/lib.rs:500-511][feature-disable]).
- The delegate adjusts approval policy and WebSocket support, then spawns a SubAgent session with the parent agent controller and inherited environments ([codex_delegate.rs:50-139][delegate-spawn]); the one-shot caller submits `TurnInputRequest::user_input(input)` with internal parent/root turn metadata ([codex_delegate.rs:180-237][delegate-input]). Session creation builds hooks from the config without a session-source filter ([session/session.rs:1326-1339][hooks-init], [session/mod.rs:4661-4689][hooks-config]). `Hooks::from_config()` forwards `feature_enabled` and the same config layers to `ClaudeHooksEngine::new()`; that engine suppresses ordinary hooks when disabled, but receives no Review/session-source discriminator ([hooks/registry.rs:107-136][hook-registry], [engine/mod.rs:228-269][hook-engine]). Thus ordinary enabled, trusted/discovered hooks remain available on this path; the counterexample does not assume that disabled or untrusted hooks run.
- The ordinary UserInput hook caller has no non-ThreadSpawn exclusion; the identity helper returns `None` for Review. Consequently this enabled-hooks source path can emit UserPromptSubmit with shared root `session_id` but no `agent_id`, despite being generated child work. It can also leave ordinary tool events unscoped. Lifecycle exclusions for non-ThreadSpawn children ([start], [stop-runtime]) do not exclude their ordinary prompt/tool dispatch.

The final UserPromptSubmit handler selection uses event name with no matcher input, then serializes exactly `UserPromptSubmitCommandInput`; there is no late Review filter ([events/user_prompt_submit.rs:64-111][prompt-dispatch]). The complete native command payload cannot reliably distinguish the two origins:

| Native field(s) | Real root input versus synthetic Review input |
| --- | --- |
| `session_id` | Same root session identity. |
| `turn_id` | Active submission ID in both paths; no origin encoding contract. Different IDs do not prove different human turns, and queued human prompts can share an ID. |
| `agent_id`, `agent_type` | Both omitted for root and Review; only ThreadSpawn receives these optional fields. |
| `hook_event_name` | `UserPromptSubmit` in both paths. |
| `cwd` | Review inherits the parent's environments; the working directory can be the same. |
| `model` | Review may use the same model as the root. |
| `permission_mode` | Review's Never maps to `bypassPermissions`; a root using Never has the same value. It is not an origin discriminator. |
| `transcript_path` | Nullable descriptive path, not a root/child identity field. Paths can be unavailable; deriving identity from filenames or transcript contents is not an approved contract. |
| `prompt` | Text supplied to UserInput in either path. Content comparison/parsing cannot establish human origin. |
| Origin, concrete thread ID, session source, parent/root turn metadata, client input ID | Not serialized as command-payload fields. |

This is a release-source counterexample, not an executed capture. The protocol also has host content annotations (`is_user_authorization_message`, [contextual_user_message.rs:34-64][authorization]); those are internal message metadata, not an available command-hook input field. `stop_hook_active` is absent from UserPromptSubmit and cannot repair the ambiguity.

**Historical decision blocker, now resolved by acceptance:** existing once-per-real-user-turn parity cannot be claimed from these native payloads across the full runtime scope. Advancing on every no-`agent_id` prompt clears root and child intervention history during synthetic Review work; suppressing such prompts also risks missing a real user boundary. At the original audit, persistent Codex tracking was gated on an evidence-backed discriminator or explicit acceptance of a bounded compatibility promise. Restricting the claim to ordinary root/ThreadSpawn paths must disclose that Review can still produce indistinguishable inputs; it is not an enforceable automatic exclusion. The subsequent user instruction, "Then ignore it and move on.", accepts normal best-effort history with this Review limitation as nonblocking. No special workaround or tracking disablement is required; these source observations remain unchanged.

## Compact, Resume, and Delivery Identity

`InitialHistory::Resumed` queues SessionStart resume; New/Forked queues startup; Cleared queues clear ([session/session.rs:1600-1624][session-sources]). Compaction queues compact ([session/mod.rs:3797-3813][compact-queue]), and the active turn runs pending start hooks before the next sampling continuation ([turn.rs:504-508][compact-next]). Resume/compact alone provide no reason to clear Clooks history. Child compact/resume does not emit root SessionStart because `run_pending_session_start_hooks()` returns for non-startup child cases. Native resume restores conversation identity/history, not a persisted Clooks intervention counter; `stop_hook_active` is initialized to false inside each `run_turn` ([turn.rs:296-299][stop-init]).

`ConfiguredHandler::run_id()` is `event label:display order:source path` ([engine/mod.rs:158-165][handler-id]). It is reused across executions. The command input schemas have no delivery UUID, and the command runner writes the serialized input to stdin ([command_runner.rs:210-268][command-input]). Thus neither that internal handler ID nor `(session_id, turn_id, event)` is a unique delivery key. Do not claim exactly-once delivery or retry deduplication; Clooks parity itself remains best-effort raw history rather than enforcement.

## Context Audiences and File Pointers

| Output | Actual source recipient/path | Handoff conclusion |
| --- | --- | --- |
| SessionStart and UserPromptSubmit additional context | `record_additional_contexts()` appends to the current session conversation; `HookAdditionalContext::role()` is developer ([hook_runtime.rs:825-849][context-record], [hook_additional_context.rs:15-22][context-role]). Accepted or blocked prompt paths can record returned context ([input-loop]). | Model-facing, but a pointer still needs recipient access evidence. |
| SubagentStart additional context | Same recorder called inside child's session by `run_pending_session_start_hooks()` ([start]). | Targets child, not parent. Shared session ID is not shared filesystem proof. |
| PreToolUse/PostToolUse additional context | Recorded in the invoking session ([hook_runtime.rs:190-221][pre-context], [tools/registry.rs:698-705][post-delivery]). | Same recipient constraint. |
| Stop/SubagentStop block reason | Hook fragments become user-role continuation in the stopping root/child, respectively ([continuation], [hook-message]). | Eligible communication channel; child readability remains unproven. |
| PostToolUse blocking feedback | `ToolRegistry` returns `RespondToModel` or substitutes feedback output after execution ([tools/registry.rs:721-740][post-delivery]). | Reaches invoking model; does not undo the tool action. |
| `systemMessage`, prompt rejection and common stop text | Event parsers produce warning/status entries; completion is surfaced through HookCompleted events ([events/user_prompt_submit.rs:142-268][prompt-output], [hook_runtime.rs:871-899][completed]). Stop reason is discarded by the context-only runtime conversion ([hook_runtime.rs:105-120][prompt-conversion]). | Keep human/status channels inline. Do not treat them as arbitrary context injection. |
| PreCompact/PostCompact | Dedicated request/control paths, no additional-context recorder ([hook_runtime.rs:510-590][compact-runtime]). | No context pointer channel established. |

Native `HookOutputSpiller` writes under OS temp `hook_outputs/<thread_id>/<uuid>.txt`; default limit is 2,500 approximate tokens. It returns a preview/path after writing, or truncates without the file on write failure ([output_spill.rs:12-130][spill]). Neither that function nor the context/continuation callers verify access from the model's selected tool environment or read the file on its behalf. A Clooks file under `<projectRoot>/.clooks/tmp/` has a separate location and permission policy. Its existence in the hook process does not prove root/child tool access, especially across selected environments. Inline-first delivery and decision-preserving fallback remain necessary.

Transcript paths are also not readability certificates: `Session::hook_transcript_path()` returns None for unavailable/local-path errors and attempts materialization before returning a path ([session/mod.rs:4593-4606][transcript]). SubagentStop separately resolves the immediate parent's path and its own. Null-to-empty compatibility is honest for these unavailable descriptive strings; it cannot recover identity or justify transcript parsing. No summary/custom-instructions field is manufactured by the inspected input schemas.

## Located Upstream Tests (Not Executed)

| Test symbol and immutable location | What the inspected assertions establish / leave open |
| --- | --- |
| `stop_hook_can_block_multiple_times_in_same_turn`, [hooks.rs:1310-1414][test-stop] | Three model requests; three identical nonempty Stop turn IDs; active flags false/true/true; retained hook fragments. Does not itself assert UserPromptSubmit count. Caller inspection supplies that distinction. |
| `blocked_queued_prompt_does_not_strand_earlier_accepted_prompt`, [hooks.rs:2654-2796][test-queued] | Three prompt deliveries including accepted/blocked queued prompts, with identical native turn IDs. |
| `subagent_start_replaces_session_start_and_injects_context`, [subagent_notifications.rs:608-729][test-child-start] | Child context delivery, child prompt `agent_id`/type present and parent prompt identity absent. |
| `subagent_stop_replaces_stop_and_skips_internal_subagents`, [subagent_notifications.rs:733-925][test-child-stop] | Child continuation, false/true flags, distinct parent/child transcript paths, non-ThreadSpawn lifecycle suppression. Does not assert suppression of internal UserPromptSubmit; cannot close the review counterexample. |
| `resumed_thread_keeps_stop_continuation_prompt_in_history`, [hooks.rs:2460-2516][test-resume] | Retained hook fragment in a later request after restart; no proof of intervention-history persistence. |
| `mid_turn_auto_compact_session_start_hooks_run_before_each_continuation`, `mid_turn_auto_compact_session_start_hook_stop_blocks_continuation`, `resumed_thread_runs_resume_then_compact_session_start_hooks`, [hooks.rs:2113-2407][test-compact] | Context insertion/stop behavior and resume/compact ordering; not a Clooks boundary test. |
| `large_hook_output_spills_to_file`, [output_spill_tests.rs:35-50][test-spill]; `stop_hook_spills_large_continuation_prompt`, [hooks.rs:2410-2457][test-stop-spill] | Test process reads the emitted file and checks retained text. No model tool read or child-environment access assertion. |

Final disposition: selected-release SOURCE binding is complete. Normal best-effort history is the approved planned mapping, with synthetic Review input accepted as a documented nonblocking limitation and no special workaround. M0 source/probe/review work is complete; M1 is authorized and in progress under parent coordination. Recipient-readable file handoff remains unproven. No shipped persistent tracking, parser/executor pass, captured runtime behavior or full-feature release confidence is established here.

[identity]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/session/session.rs#L595-L603
[resume-identity]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/session/session.rs#L760-L796
[child-helper]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/hook_runtime.rs#L1013-L1033
[ordinary-schema]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/schema.rs#L277-L383
[prompt-schema]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/schema.rs#L567-L584
[start]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/hook_runtime.rs#L124-L178
[stop-runtime]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/hook_runtime.rs#L375-L451
[allocation]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/session/mod.rs#L959-L966
[started]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/session/turn_input.rs#L118-L170
[steer]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/session/turn_input.rs#L237-L324
[internal-id]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/session/mod.rs#L1282-L1287
[default-turn]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/session/turn_context.rs#L1082-L1097
[input-loop]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/session/turn.rs#L638-L664
[inspect]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/hook_runtime.rs#L661-L701
[continuation]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/session/turn.rs#L510-L565
[hook-message]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/protocol/src/items.rs#L634-L655
[stop-aggregate]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/events/stop.rs#L413-L446
[review-seed]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/session/review.rs#L183-L200
[review-task]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/tasks/review.rs#L54-L144
[delegate-spawn]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/codex_delegate.rs#L50-L139
[delegate-input]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/codex_delegate.rs#L180-L237
[hooks-init]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/session/session.rs#L1326-L1339
[hooks-config]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/session/mod.rs#L4661-L4689
[authorization]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/context/contextual_user_message.rs#L34-L64
[session-sources]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/session/session.rs#L1600-L1624
[compact-queue]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/session/mod.rs#L3797-L3813
[compact-next]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/session/turn.rs#L504-L508
[stop-init]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/session/turn.rs#L296-L299
[handler-id]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/engine/mod.rs#L158-L165
[command-input]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/engine/command_runner.rs#L210-L268
[context-record]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/hook_runtime.rs#L825-L849
[context-role]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/context/hook_additional_context.rs#L15-L22
[pre-context]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/hook_runtime.rs#L190-L221
[post-delivery]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/tools/registry.rs#L680-L740
[prompt-output]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/events/user_prompt_submit.rs#L142-L268
[completed]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/hook_runtime.rs#L871-L899
[prompt-conversion]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/hook_runtime.rs#L105-L120
[compact-runtime]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/hook_runtime.rs#L510-L590
[spill]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/output_spill.rs#L12-L130
[transcript]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/session/mod.rs#L4593-L4606
[test-stop]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/tests/suite/hooks.rs#L1310-L1414
[test-queued]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/tests/suite/hooks.rs#L2654-L2796
[test-child-start]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/tests/suite/subagent_notifications.rs#L608-L729
[test-child-stop]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/tests/suite/subagent_notifications.rs#L733-L925
[test-resume]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/tests/suite/hooks.rs#L2460-L2516
[test-compact]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/tests/suite/hooks.rs#L2113-L2407
[test-spill]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/output_spill_tests.rs#L35-L50
[test-stop-spill]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/tests/suite/hooks.rs#L2410-L2457
[review-features]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/session/review.rs#L31-L55
[managed-disable]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/config/managed_features.rs#L113-L125
[feature-disable]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/features/src/lib.rs#L500-L511
[hook-registry]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/registry.rs#L107-L136
[hook-engine]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/engine/mod.rs#L228-L269
[prompt-dispatch]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/events/user_prompt_submit.rs#L64-L111
