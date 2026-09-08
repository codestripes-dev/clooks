# Codex Runtime M0 Wire Contract Sidecar

Date: 2026-09-07 (America/Los_Angeles). Scope: Plan D M0, offline source inspection only, ten agreed events, synchronous command handlers.

## Evidence Boundary

Inspected archive extraction: `tmp/codex-runtime-m0/output/source/codex-rs/`, commit `3d2ee51ca2d5db578f328aa75e20aa22c0197c9a` in `openai/codex`. Confirmed acquisition provenance supplied for this update: exact `refs/tags/rust-v0.153.4` tag object `042fb41b7c813ac7999105e886b2b7aa715b5081` peels to that commit, and the manifests identify 4,177 identical files. This binds the previously inspected immutable commit archive to **release 0.153.4 source**. Findings are release-source-backed, not runtime-tested or live-verified. Acquisition evidence is in [M0 evidence](codex-runtime-m0-evidence.md); this audit did not independently repeat acquisition or manifest verification.

All upstream links below identify that exact commit and inspected source lines; they were constructed from the local files, not fetched. `S` means supported by the inspected producer/parser/consumer path; `U` means a concrete unsupported/rejected/ignored capability; `?` means evidence remains unknown. None means tested or live-verified. Hook status (`Completed`, `Failed`, `Blocked`, `Stopped`) and native action are separate facts. Failure rows describe one synchronous handler, with no other handler contributing a control decision.

Confirmed source provenance does not establish executable conformance, close the live-confidence gate, or by itself establish completion of all Plan D M0 requirements.

## Input Producers and Requiredness

Every event emits an object with required string `session_id`, `cwd`, `hook_event_name`, `model`, and required **nullable** `transcript_path` (string or null). `NullableString` deliberately serializes null instead of omitting the key. No source constructor fabricates an empty transcript path. Required here describes generated schemas and actual producer fields, not an upstream stdin validator: input structs derive `Serialize` and `JsonSchema`, not `Deserialize`. [NullableString, schema.rs:42-85][nullable]

In this table, `P` = required string `permission_mode`; `T` = required string `turn_id`; `A` = optional string `agent_id` and `agent_type`, emitted together for a thread-spawned child and omitted for root input. These optional identity fields are not produced as null. All extra fields are strings unless annotated; common fields above apply to every row.

| Event | Additional required fields | Optional fields | Exact source input symbol and lines |
| --- | --- | --- | --- |
| SessionStart | P, `source` | None | `SessionStartCommandInput`, [schema.rs:496-543][start-input] |
| SubagentStart | P, T, `agent_id`, `agent_type` | None | `SubagentStartCommandInput`, [schema.rs:546-563][life-input] |
| PreToolUse | P, T, `tool_name`, `tool_use_id`, `tool_input` (any JSON, including null) | A | `PreToolUseCommandInput`, [schema.rs:275-296][tool-input] |
| PermissionRequest | P, T, `tool_name`, `tool_input` (any JSON) | A | `PermissionRequestCommandInput`, [schema.rs:298-318][tool-input] |
| PostToolUse | P, T, `tool_name`, `tool_use_id`, `tool_input`, `tool_response` (both any JSON) | A | `PostToolUseCommandInput`, [schema.rs:320-342][tool-input] |
| PreCompact | T, `trigger` | A | `PreCompactCommandInput`, [schema.rs:344-362][compact-input] |
| PostCompact | T, `trigger` | A | `PostCompactCommandInput`, [schema.rs:364-382][compact-input] |
| UserPromptSubmit | P, T, `prompt` | A | `UserPromptSubmitCommandInput`, [schema.rs:564-583][life-input] |
| SubagentStop | P, T, `agent_id`, `agent_type`, `agent_transcript_path` (string/null), `stop_hook_active` (bool), `last_assistant_message` (string/null) | None | `SubagentStopCommandInput`, [schema.rs:603-622][life-input] |
| Stop | P, T, `stop_hook_active` (bool), `last_assistant_message` (string/null) | None | `StopCommandInput`, [schema.rs:585-600][life-input] |

Generated input schemas use `additionalProperties:false`, list the required nullable fields in `required`, and represent `tool_input`/`tool_response` as unrestricted JSON. The ten files are `hooks/schema/generated/{session-start,subagent-start,pre-tool-use,permission-request,post-tool-use,pre-compact,post-compact,user-prompt-submit,subagent-stop,stop}.command.input.schema.json`; their source definitions are linked above. The [PreToolUse generated schema:1-71][generated-input] is a concrete example. `source` enumerates startup/resume/clear/compact; `trigger` manual/auto; P default/acceptEdits/plan/dontAsk/bypassPermissions. Input event constants and these enums are schema customizations over producer strings, not general runtime string validation. [schema.rs:791-859][schema-enums]

Absent from these producers: SessionStart `turn_id`; PermissionRequest `tool_use_id`; compact `permission_mode`, `custom_instructions`, and `compact_summary`; top-level PermissionRequest `description`. Bash approval adds `description` **inside `tool_input`**, only when a string exists. [PermissionRequestPayload::bash, sandboxing.rs:127-147][approval-payload] Plan D's empty-string unavailable sentinels are Clooks compatibility policy, not observed upstream values. Accepting absence for a required nullable transcript/message is deliberately broader than this producer contract and must not be called strict native validation.

Private metadata must retain raw absence/null distinctions, P, model, native T, and child identity without recursively exposing/renaming tool data. `Session::session_id()` is shared across root and descendants; `subagent_hook_context` supplies the concrete child thread ID and role. Ordinary child tool/prompt/compact events carry A. SubagentStop uses the parent's transcript path and separately the child's agent transcript path; a parent-path lookup failure supplies null. SessionStart itself has no child A or native T even when completion notifications contain a turn ID. [session.rs:595-603][session-id], [hook_runtime.rs:1013-1033][agent-id], [hook_runtime.rs:376-445][stop-runtime], [session_start.rs:128-181][start-producer]

## Actual Output Parser

`output_parser::parse_json` trims stdout, parses one complete JSON value, requires an object, then uses Serde to deserialize the event-specific wire struct. It does **not** validate stdout against the generated JSON Schema. `schema_loader` loads embedded schema text into `Value`; startup loads that cache, while event parsers call Serde directly. [output_parser.rs:345-363][parse-json], [schema_loader.rs:1-131][schema-loader]

All ten output structs flatten `HookUniversalOutputWire`: optional `continue` defaults true; optional `suppressOutput` defaults false; optional string `stopReason` and `systemMessage` default absent. Bool nulls and wrong types fail deserialization. `Option<String>`, `Option<Value>`, optional decisions and optional wrappers accept null as absence in Serde; strings may be empty. Generated schema construction disables automatic null types for `Option`, so its declaration is narrower than this actual null acceptance. All output structs/nested records declare `deny_unknown_fields`; arbitrary tool-input JSON is not one of those records. Unknown control keys, wrong types/enums, missing nested required fields, and `sessionTitle` fail object parsing. [schema.rs:87-255][output-wires], [schema.rs:384-491][life-output], [schema.rs:763-772][schema-null]

For events with `hookSpecificOutput` (SessionStart, SubagentStart, PreToolUse, PermissionRequest, PostToolUse, UserPromptSubmit), a present non-null wrapper requires `hookEventName`. **The Serde type is the shared `HookEventNameWire` enum, and the parser never compares it to the executing event.** Another member of that enum passes this discriminator check if the rest of the destination event's shape is valid; an unknown enum string fails. The schema-only event `const` does not enforce runtime matching. Stop/SubagentStop/PreCompact/PostCompact have no wrapper at all. Always emit the correct discriminator; do not depend on this permissiveness. [schema.rs:101-125,186-255][output-wires], [output_parser.rs:93-338][parser-events]

`looks_like_json` only detects a leading `{` or `[` after leading whitespace. Consequently malformed object/array-looking output fails; prefix text followed by JSON falls through as plain text on non-Stop events. Scalar JSON such as `null`, `true`, `123`, or a quoted string also falls through as text because it is not an object and does not begin with `{`/`[`. Whitespace-only stdout is the successful empty case for every event. Stop/SubagentStop reject any nonempty unparseable stdout, including ordinary plain text. [parse_json/looks_like_json][parse-json], event consumers below.

### Accepted Syntax Versus Effects

| Event | S: effective synchronous outputs | U: rejected or ignored outputs; semantic qualifications |
| --- | --- | --- |
| SessionStart | Context; `continue:false` stops pending turn work; `systemMessage` warning | `suppressOutput` ignored; `stopReason` alone does not stop; no decision/mutation keys |
| SubagentStart | Child context; warning | `continue:false`, stop reason and suppression have no startup veto; no decision/mutation keys |
| PreToolUse | Context alone; nested deny with nonblank `permissionDecisionReason`; legacy `decision:block` with nonblank `reason`; nested allow **with non-null `updatedInput`** | Bare allow, ask, legacy approve, false continue, non-null stopReason, true suppressOutput fail with no veto/rewrite. Replacement without allow, reason without decision, or blank denial reason also fail. A nested decision/reason/replacement takes precedence over the legacy decision, rather than merging it |
| PermissionRequest | Nested `decision:{behavior:"allow"}` or `behavior:"deny"`; deny message trims and defaults to `PermissionRequest hook denied approval`; warning | Non-null nested updatedInput/updatedPermissions, interrupt true, false continue, non-null stopReason, true suppressOutput cause `Failed` **with no decision**. No context channel |
| PostToolUse | Context; `decision:block` with nonblank reason produces rejected-result feedback; false continue produces feedback without `should_block`; warning | Non-null updatedMCPToolOutput and true suppressOutput are unsupported. **False continue takes precedence over these semantic-invalid flags** in the consumer, so it can still produce Stopped feedback while dropping context. Wrong wire types/unknown keys fail earlier |
| PreCompact | False continue stops before compact; warning | No block/reason decision or context wrapper; suppression ignored |
| PostCompact | False continue stops further turn work after successful compact; warning | No rollback, block/reason decision or context wrapper; suppression ignored |
| UserPromptSubmit | Context; block with nonblank reason or false continue rejects the inspected input; warning | No title mutation; suppression ignored. False continue precedes invalid-block reason handling; it can stop while invalid-block context is omitted |
| SubagentStop | Block/nonblank reason creates child continuation; false continue ends that path; warning | No context wrapper; suppression ignored; false continue precedes malformed block-reason semantics |
| Stop | Block/nonblank reason creates continuation; false continue ends that path; warning | Same restrictions as SubagentStop |

Evidence: parser functions `parse_pre_tool_use`, `parse_permission_request`, `parse_post_tool_use`, `parse_user_prompt_submit`, `stop_output` at [output_parser.rs:121-338][parser-events]; unsupported checks at [output_parser.rs:369-517][unsupported]; effects in each linked event consumer below. A null reserved `Option<Value>` becomes absent and does not trigger its unsupported check; `interrupt:false`, `continue:true`, and `suppressOutput:false` do not trigger value-based rejection. The similarly named `updatedInputPermissions` is **not** a recognized field: it is an unknown-key parse failure, not an alternative reserved permission capability. These distinctions do not authorize Clooks to emit unsupported author fields.

String fidelity is channel-specific. JSON additionalContext/systemMessage and common stopReason are retained as supplied, including empty strings; stopReason fallback is for absence, not whitespace. PreToolUse denial reasons, PermissionRequest denial messages, Stop/SubagentStop continuation reasons, and all exit-2 reason channels trim whitespace. PostToolUse and UserPromptSubmit JSON block reasons are validated for nonblank content but retained untrimmed. PostToolUse false-continue feedback prefers a trimmed nonblank top-level reason over stopReason. Thus Plan D's serializer preserving strings does not imply every native recipient receives byte-identical text. [parser-events][parser-events], [unsupported checks][unsupported], event consumers below.

### PreToolUse Allow Without Rewrite

The intended Clooks mapping is **allow without updatedInput -> no native permission decision, plus optional supported additionalContext**, exit 0. With neither context nor diagnostic, emit empty stdout. With context, emit `{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"..."}}`. This permits ordinary native policy processing; it does not approve a permission request or override native approval/sandbox policy. Only allow with a validated complete replacement emits `permissionDecision:"allow"` and `updatedInput`. Bare native allow is rejected by `unsupported_pre_tool_use_hook_specific_output`; no-decision is accepted by `parse_pre_tool_use` and reaches Continue in `run_pre_tool_use_hooks`. [unsupported checks][unsupported], [parser-events][parser-events], [pre-runtime][pre-runtime]

An allow-without-rewrite reason must not be emitted as top-level `reason` or nested `permissionDecisionReason`: either non-null reason without its decision is invalid. Keep that explanation as a Clooks local diagnostic; when native human delivery is required, use top-level `systemMessage` alongside any context, with no decision/reason control fields. Successful stderr alone is not native-delivered. Do not invent a denial, synthesize a no-op replacement, or convert the reason into model context to accommodate the parser. This is the intended translation policy, not an implemented or tested adapter change. [unsupported checks][unsupported], [pre-consumer][pre-consumer]

## Executor and Failure Matrix

`run_command` spawns the configured shell with piped stdin/stdout/stderr, writes JSON bytes without an added newline, then waits for output. Successful collection uses lossy UTF-8 decoding. Spawn, non-BrokenPipe stdin-write error, wait error and timeout produce `error:Some`, empty captured streams and no exit code. A completed signal termination on Unix yields `status.code()==None` and follows the event's no-code failure branch. Timeout applies to `wait_with_output` **after** stdin writing; it is not a whole spawn-plus-write deadline. Timeout cleanup drops the child and process-tree guard; this audit makes no live process-cleanup guarantee. Configured event timeout defaults to 600 seconds and is clamped to at least 1. [run_command, command_runner.rs:205-359][runner], [discovery.rs:754-764][timeout]

`can_apply_control_effects` permits only synchronous handlers. Dispatcher executes matching synchronous handlers concurrently on identical input, waits for their results, and sorts reporting by configuration order. PreToolUse selects the **last completed** valid rewrite, unless any deny wins; it does not merge replacements or sequentially feed them into native hooks. Failed runs do not globally veto other hooks. PermissionRequest aggregates any deny ahead of any allow; a failed reserved-field handler cannot cancel a separate allow. Stop aggregates false continue ahead of all continuation requests. [engine/mod.rs:140-156][control-mode], [dispatcher.rs:112-186][dispatch], [pre_tool_use.rs:105-166][pre-aggregate], [permission_request.rs:149-168][permission-aggregate], [stop.rs:413-447][stop-aggregate]

In this matrix `F/default` means hook `Failed`, generated Error entry, and no control/context from this handler: start/prompt/tool/compact processing follows its ordinary path; PermissionRequest goes to the normal reviewer; Stop finishes normally without an added continuation. This is no veto, not permission to bypass other native policy. `B` = Blocked; `C` = Completed. Empty stdout at exit 0 is C/default for **all ten**. Successful valid JSON follows the preceding table.

| Event / authoritative event consumer | Plain nonempty stdout, exit 0 | Exit 2 + nonblank stderr | Exit 2 + blank stderr | Other nonzero / signal / spawn / wait / timeout | Malformed object/array-looking stdout, exit 0 |
| --- | --- | --- | --- | --- | --- |
| SessionStart, [parse_completed:222-343][start-consumer] | C; trimmed context | F/default; generic exit-code error, stderr text discarded | F/default | F/default | F/default |
| SubagentStart, [same consumer][start-consumer] | C; trimmed child context | F/default; generic exit-code error, stderr text discarded | F/default | F/default | F/default |
| PreToolUse, [parse_completed:193-326][pre-consumer] | C/default, ignored | B; trimmed reason prevents pending tool dispatch | F/default; missing-block-reason Error | F/default | F/default |
| PermissionRequest, [parse_completed:188-294][permission-consumer] | C/default, ignored | B; trimmed message denies approval | F/default; missing-denial-reason Error | F/default | F/default |
| PostToolUse, [parse_completed:169-307][post-consumer] | C/default, ignored | B; trimmed feedback rejects completed result | F/default; missing-feedback Error | F/default | F/default |
| PreCompact, [parse_pre_completed/parse_completed:226-342][compact-consumer] | C/default, ignored | F/default; trimmed stderr is Error text | F/default; generic exit-code Error | F/default; other numeric exits prefer stderr Error text | F/default |
| PostCompact, [parse_post_completed/parse_completed:240-342][compact-consumer] | C/default, ignored | F/default; trimmed stderr is Error text | F/default; generic exit-code Error | F/default; other numeric exits prefer stderr Error text | F/default |
| UserPromptSubmit, [parse_completed:138-275][prompt-consumer] | C; trimmed context | B; trimmed reason rejects inspected prompt | F/default; missing-block-reason Error | F/default | F/default |
| SubagentStop, [parse_completed:250-411][stop-consumer] | F/default, including scalar/mixed text | B; trimmed stderr becomes child continuation prompt | F/default; missing-continuation Error | F/default | F/default |
| Stop, [same consumer][stop-consumer] | F/default, including scalar/mixed text | B; trimmed stderr becomes continuation prompt | F/default; missing-continuation Error | F/default | F/default |

For all ten, **stderr at exit 0 is not read by the event consumer or retained by `completed_summary`**. Nonzero stdout is not parsed for decisions. Generic unexpected-exit diagnostics use the exit number, not the child stderr, except compact's numeric-exit branch. Actual command execution errors use their generated error text. `systemMessage` becomes a Warning entry only when the stdout object deserializes; ordinary local synchronous runs are emitted through `HookCompleted`. This proves an event-stream channel, not visibility in every UI client. [completed_summary, dispatcher.rs:228-255][summary], [emit_hook_completed_events, hook_runtime.rs:871-903][notifications]

## Consumers Beyond the Hooks Crate

| Events | Authoritative downstream consumer and actual boundary |
| --- | --- |
| SessionStart / SubagentStart | `run_pending_session_start_hooks` chooses child startup only for thread-spawn subagents, records context in that session, and returns should-stop. The turn loop returns before sampling on a true result. Child start's consumer never sets that result from false continue. [hook_runtime.rs:124-176][start-runtime], [session/turn.rs:264-270][turn-start] |
| PreToolUse | `run_pre_tool_use_hooks` returns Continue unless there is a block and reason; registry returns `RespondToModel` before `handle_any_tool` on denial. A rewrite-conversion error also returns before execution; valid replacement changes the invocation. [hook_runtime.rs:184-240][pre-runtime], [tools/registry.rs:567-618][registry-pre] |
| PermissionRequest | `request` approval path maps Allow to Approved, Deny to denied(message), **None to request_reviewer_approval**. Reserved fields therefore fail the hook, not the approval action. [tools/approvals.rs:521-542][approval-consumer] |
| PostToolUse | Registry only runs post hooks when the tool reports `success_for_logging`; a block returns `RespondToModel` after side effects. Feedback without block wraps model-visible output; `PostToolUseFeedbackOutput::code_mode_result` preserves the original script result. [registry.rs:673-750][registry-post], [registry.rs:220-245][feedback-wrapper] |
| PreCompact / PostCompact | Both local and remote compact paths convert pre-stop to TurnAborted before compact; post-stop to TurnAborted after a successful compact. Ordinary hook failures do not set stop. [compact.rs:194-232][local-compact], [compact_remote.rs:141-176][remote-compact] |
| UserPromptSubmit | `inspect_pending_input` applies hooks to UserInput, not response items or inter-agent communication. `run_hooks_and_record_inputs` skips a rejected item but can still accept other items in that batch; it returns blocked only if there was a rejection and no accepted nonempty user input. [hook_runtime.rs:661-698][prompt-runtime], [session/turn.rs:637-665][prompt-batch] |
| Stop / SubagentStop | Root and thread-spawn child choose the matching target. The turn loop records generated continuation directly as a response item, sets stop_hook_active, and continues the existing loop; false continue breaks it. No direct UserPromptSubmit call or new turn allocation occurs in that continuation branch. [hook_runtime.rs:376-445][stop-runtime], [session/turn.rs:512-559][turn-stop] |

Context delivery is developer-role conversation content: `record_additional_contexts` constructs `HookAdditionalContext`, whose `role()` explicitly returns `developer`, despite implementing a generically named `ContextualUserFragment` trait. This supports main or current-child delivery, not file readability or model compliance. Stop-generated context is a separate continuation mechanism; detailed persistence/reset policy is outside this bounded wire audit. [hook_runtime.rs:825-845][context-record], [HookAdditionalContext:15-34][context-role]

## Tool Codecs and Replacement Boundaries

| Family | Actual wire codec and replacement consumer | Supported boundary and remaining limit |
| --- | --- | --- |
| Bash / exec_command | `ExecCommandHandler::pre_tool_use_payload` parses ExecCommandArgs and exposes only `{command: args.cmd}` under canonical Bash. `with_updated_hook_input` requires string command and replaces original internal `cmd` through `rewrite_function_string_argument`, preserving other original exec arguments. [exec_command.rs:499-544][exec-codec], [handlers/mod.rs:105-144][command-codec] | S command replacement, including empty string as a type-valid value. Extra replacement keys are ignored, not forwarded as shell options. Missing/non-string command fails conversion before execution. This does not prove a separate historical shell handler or every shell path has this codec |
| apply_patch | Canonical apply_patch, matcher aliases Write/Edit; `{command: raw patch}`. Replacement extracts command into the custom payload; the actual handler verifies the patch before execution. Post response is a JSON string of patch result text. [hook_names.rs:28-38][hook-names], [apply_patch.rs:438-505][patch-codec], [context.rs:273-310][patch-output] | S patch-text replacement; U conversion to Claude file_path/old_string/new_string. Added opaque keys do not mutate files independently of command. Valid string is not evidence of valid patch syntax |
| MCP function calls | Hook name uses `ensure_mcp_prefix(join_tool_name(...))`, not a Bash/patch alias for similarly named MCP tools. Input is parsed JSON, empty arguments become `{}`, invalid raw JSON becomes a string for pre-hook inspection. Replacement serializes the **entire** Value as new arguments, preserving key spelling and nested values. Post input/result come from McpToolOutput, with result serialized as JSON. [mcp.rs:95-112,412-504][mcp-codec], [context.rs:101-147][mcp-output] | S full replacement at the codec boundary, no shallow merge. Downstream `handle_mcp_tool_call` reparses JSON into Value; that alone does not prove each server accepts scalar/array/object input. Server-specific acceptance remains ?; Clooks' record-only subset is narrower policy. [mcp_tool_call.rs:132-158][mcp-parse] |
| Other local functions | Default `CoreToolRuntime` hook payload uses function arguments, parsed JSON or raw-string fallback, empty input `{}`. Replacement serializes the entire Value. Name is flattened, with spawn_agent/Agent matching special case. Default post response uses an explicit handler response or serialized model-facing body. [registry.rs:95-163][default-codec], [registry.rs:799-816][function-input] | S opaque full replacement for this dispatch path; not proof every handler accepts every JSON shape or shares a response shape. Typed handler validation still applies. Non-Function payloads return no default hook payload |
| Unified exec completion / write_stdin | Exec output tracks original event_call_id and hook_command. Post input uses original command; post response is output text and is absent while process_id exists or command metadata is unavailable. `write_stdin` explicitly skips PreToolUse and can expose original Bash completion. Exec `success_for_logging()` is true even for a nonzero process exit. [context.rs:350-412][exec-output], [write_stdin.rs:119-140][stdin-codec], [unified_exec.rs:80-97][exec-post] | S nonzero completed commands receive post hooks when metadata/result is available. U treating every poll/input write as new PreToolUse. Exactly-once completion across all manager/cancellation paths remains ? in this bounded audit |

PermissionRequest uses its own approval-action payload, not necessarily PreToolUse's input. Bash approval may add nested description; write_stdin approval has canonical write_stdin and session_id/chars/parent_call_id/approval_id/environment_id/cwd/tty/sandbox_permissions/additional_permissions inside opaque input; patch uses command; MCP uses arguments or `{}`. [ApprovalAction::permission_request_payload, approvals.rs:161-218][approval-codecs] A codec chosen only from a Claude-looking tool name must not reinterpret this approval metadata.

For Clooks partial updates, materialize a complete replacement against the original supported hook input before serialization. A native replacement is not a patch: omitted MCP/local-function keys disappear, existing nested nulls are ordinary data, and Clooks' null-as-unset operation must not be confused with an upstream null value. `hookSpecificOutput.updatedInput:null` is absent in this output parser, so it cannot request replacement with JSON null. Native simultaneous rewrites use completion order, whereas Clooks' internal ordering remains its own contract. Shell/patch expose only command and cannot honestly support mutation of hidden native options through arbitrary added keys.

## Reconciliation With Current Refresh and Plan D

Compared documents: [contract refresh](codex-runtime-contract-refresh.md), particularly Input Envelope, Parsed/Ignored, Failure and Remaining Gates; [Plan D](../done/feat-0044-codex-runtime/PLAN-FEAT-0044D-codex-runtime-capability-policy.md), particularly unavailable-string policy and failure tuples (lines 374-391 at inspection). These are concrete source deltas or qualifications, not requests to expand public methods.

| Existing statement / tuple | Release-source disposition | Required policy qualification |
| --- | --- | --- |
| PreToolUse allow without rewrite | Bare native permissionDecision:allow is rejected; no-decision follows ordinary native policy | Translate to no decision plus optional context, exit 0. Keep any reason in a local diagnostic/systemMessage, not reason/permissionDecisionReason or an invented denial |
| PermissionRequest reserved fields "fail closed" | Contradicted as an action claim: semantic failure returns None, falling through to reviewer; another handler's allow can still win | Replace with Failed/no-decision, retain explicit nested deny for Clooks policy failures |
| PermissionRequest exit 2 unspecified; D says exit 2 is not denial evidence | Source establishes denial **when stderr is nonblank**, no decision when blank | Keep deterministic exit-0 JSON denial as planned; distinguish bare exit 2 from the proven tuple |
| D diagnostic D = systemMessage plus stderr at exit 0 | Warning JSON is consumed; stderr line is discarded by native completion summary | Preserve JSON human diagnostic; do not count stderr debug/errors as native-delivered text |
| D SubagentStart/PostCompact failure = empty stdout, detailed stderr, exit 2 | Both are Failed/no control. SubagentStart loses detailed stderr and shows only generic exit code; PostCompact includes stderr Error text | Record lost detailed SubagentStart diagnostic. PostCompact false continue could stop further work but would require a Plan D policy revision, not rollback or a new public method |
| D JSON refusal tuples: PreToolUse deny, PermissionRequest deny, UserPromptSubmit block, PostToolUse block, PreCompact/SessionStart/Stop/SubagentStop false continue | S through source consumers with required nonblank reasons where applicable; false continue is correct for ending Stop continuation | Release-source-backed; runtime/live verification remains open. Prompt rejection is per inspected item, post block is after execution |
| Unknown-key/discriminator/nullable-output behavior unresolved | Unknown fields are rejected; a different recognized event discriminator is not checked; Serde Option null acceptance differs from generated schemas | Enforce Clooks' own exact event and author-field rules; do not cite schema const/null declarations as executed checks |
| PermissionRequest optional description | Only nested Bash approval input is produced here, conditionally as a string | Do not add or require a top-level description metadata field |
| Nullable/unavailable fields in D | transcript_path and last_assistant_message are required nullable producer fields; custom_instructions/compact_summary are absent | Document sentinels as Clooks compatibility, preserve raw provenance; absent required metadata is not a native captured fixture |
| Stop continuation "acts as a new user prompt"; native IDs unresolved | Continuation response item is appended within current loop and sub_id; no direct UserPromptSubmit dispatch in that branch | Do not reset turn state on an invented UserPromptSubmit/turn-id change. Genuine queued input can still arrive separately; broader state policy remains outside this audit |
| PostToolUse unsupported fields always fail and normal result continues | Usually true, but false continue wins over semantic unsupported flags after parsing | Serializer should avoid combined illegal fields; record precedence rather than inferring behavior from invalid_reason alone |
| MCP/local replacement described as arguments object | Codec accepts/serializes arbitrary JSON Value; downstream success is separate | Record full-replacement facts; retain approved honest record-only public subset and preserve opaque nested keys |

## Unsupported Versus Unknown and Completion

Unsupported is evidenced for each event above: no SessionStart mutation, no SubagentStart veto, no bare PreToolUse allow/ask, no PermissionRequest rewrite/context, no PostToolUse MCP-output rewrite, no compact context/decision:block, no UserPromptSubmit title, no Stop/SubagentStop context wrapper. Opaque extra **tool data** is distinct from these unknown **control fields**. No schema, hook status, or local diagnostic proves actual tool prevention in a running release.

Unknown across all ten: live native outcomes/UI rendering. Exact target-tag binding is confirmed. Tool-specific unknowns: acceptance by every MCP server/local handler; exhaustive interception of hosted/specialized paths; exactly-once unified-exec completion under cancellation. Metadata/delivery unknowns: Clooks handoff-file readability by child/model and durable once-per-original-user-turn guarantees. These are not classified as unsupported. The concrete source consumers above resolve malformed-output, common exit, timeout, signal/no-code, and ordinary sync stderr behavior in release 0.153.4 source without executing it.

Audit coverage: input producers/generated declarations, output parser, synchronous command executor, all ten event consumers and downstream action consumers, tool codecs, and current-plan discrepancies. Changes are limited to this sidecar. No production/test changes, network, Docker, executable probes, tests, installation, commit, or live-support claim. Plan D failure-policy reconciliation and runtime/live verification remain separate from this release-source-backed report.

[nullable]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/schema.rs#L42-L85
[start-input]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/schema.rs#L496-L543
[life-input]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/schema.rs#L546-L622
[tool-input]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/schema.rs#L275-L342
[compact-input]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/schema.rs#L344-L382
[generated-input]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/schema/generated/pre-tool-use.command.input.schema.json#L1-L71
[schema-enums]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/schema.rs#L791-L859
[approval-payload]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/tools/sandboxing.rs#L127-L147
[session-id]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/session/session.rs#L595-L603
[agent-id]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/hook_runtime.rs#L1013-L1033
[stop-runtime]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/hook_runtime.rs#L376-L445
[start-producer]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/events/session_start.rs#L128-L181
[parse-json]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/engine/output_parser.rs#L345-L363
[schema-loader]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/engine/schema_loader.rs#L1-L131
[output-wires]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/schema.rs#L87-L255
[life-output]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/schema.rs#L384-L491
[schema-null]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/schema.rs#L763-L772
[parser-events]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/engine/output_parser.rs#L93-L338
[unsupported]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/engine/output_parser.rs#L369-L517
[runner]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/engine/command_runner.rs#L205-L359
[timeout]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/engine/discovery.rs#L754-L764
[control-mode]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/engine/mod.rs#L140-L156
[dispatch]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/engine/dispatcher.rs#L112-L186
[pre-aggregate]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/events/pre_tool_use.rs#L105-L166
[permission-aggregate]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/events/permission_request.rs#L149-L168
[stop-aggregate]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/events/stop.rs#L413-L447
[start-consumer]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/events/session_start.rs#L222-L343
[pre-consumer]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/events/pre_tool_use.rs#L193-L326
[permission-consumer]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/events/permission_request.rs#L188-L294
[post-consumer]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/events/post_tool_use.rs#L169-L307
[compact-consumer]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/events/compact.rs#L226-L342
[prompt-consumer]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/events/user_prompt_submit.rs#L138-L275
[stop-consumer]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/events/stop.rs#L250-L411
[summary]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/engine/dispatcher.rs#L228-L255
[notifications]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/hook_runtime.rs#L871-L903
[start-runtime]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/hook_runtime.rs#L124-L176
[turn-start]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/session/turn.rs#L264-L270
[pre-runtime]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/hook_runtime.rs#L184-L240
[registry-pre]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/tools/registry.rs#L567-L618
[approval-consumer]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/tools/approvals.rs#L521-L542
[registry-post]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/tools/registry.rs#L673-L750
[feedback-wrapper]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/tools/registry.rs#L220-L245
[local-compact]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/compact.rs#L194-L232
[remote-compact]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/compact_remote.rs#L141-L176
[prompt-runtime]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/hook_runtime.rs#L661-L698
[prompt-batch]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/session/turn.rs#L637-L665
[turn-stop]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/session/turn.rs#L512-L559
[context-record]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/hook_runtime.rs#L825-L845
[context-role]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/context/hook_additional_context.rs#L15-L34
[exec-codec]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/tools/handlers/unified_exec/exec_command.rs#L499-L544
[command-codec]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/tools/handlers/mod.rs#L105-L144
[hook-names]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/tools/hook_names.rs#L28-L38
[patch-codec]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/tools/handlers/apply_patch.rs#L438-L505
[patch-output]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/tools/context.rs#L273-L310
[mcp-codec]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/tools/handlers/mcp.rs#L95-L504
[mcp-output]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/tools/context.rs#L101-L147
[mcp-parse]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/mcp_tool_call.rs#L132-L158
[default-codec]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/tools/registry.rs#L95-L163
[function-input]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/tools/registry.rs#L799-L816
[exec-output]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/tools/context.rs#L350-L412
[stdin-codec]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/tools/handlers/unified_exec/write_stdin.rs#L119-L140
[exec-post]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/tools/handlers/unified_exec.rs#L80-L97
[approval-codecs]: https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/tools/approvals.rs#L161-L218
