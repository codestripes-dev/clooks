# Codex Runtime Contract Refresh

Research date: 2026-09-07. Scope: Plan D's existing ten events only. This is a research companion, not an implementation plan or a declaration of runtime support. The historical May capability matrix remains intact.

**M0 follow-up:** The exact `rust-v0.153.4` tag has now been acquired and peeled to `3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`. The documentation observations below remain the original website snapshot, not the authoritative selected-release implementation contract. Read the [source/probe evidence](codex-runtime-m0-evidence.md), [wire-contract audit](codex-runtime-m0-wire-contract.md), and [identity/delivery audit](codex-runtime-m0-identity-delivery.md) before implementing. In particular, source rejects bare PreToolUse allow without a rewrite; reserved PermissionRequest fields fail the handler without producing a denial; successful stderr is discarded; and Stop continuation keeps the existing turn without UserPromptSubmit. Ordinary child prompts carry identity, but internal review prompts expose a genuine-user-boundary ambiguity. Source inspection does not establish executed or live confidence.

## Current M0 Disposition

Exact-source acquisition and the ten-event wire/identity audits are complete. Ref `refs/tags/rust-v0.153.4`, tag object `042fb41b7c813ac7999105e886b2b7aa715b5081`, resolves to [commit `3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`](https://github.com/openai/codex/tree/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks). A retained archive and matching 4,177-file manifests bind the inspected source to that release. Both acquisition routes are consumed; no third source fetch is authorized. The source audits supersede the original snapshot's missing-source questions and conflicting website claims, without rewriting that historical record.

Two bounded execution attempts produced **zero upstream tests and no P evidence**. The original offline feasibility attempt lacked cargo/rustc. The sole retry stopped during dependency preparation because `cargo fetch --locked` refused the required update to upstream `Cargo.lock`. The retry exited 101 after 49 seconds. The retry allowance is exhausted; parser/executor execution remains unverified. Cleanup is confirmed: the owned container was removed and the label-filtered container listing was empty. The runner owns detailed evidence recording. The cause of the lockfile-update requirement is not established here, and no general toolchain-unavailability claim follows. Native L evidence also remains absent.

Source resolves ordinary root/child identity, same-ID root steering and Stop continuation without UserPromptSubmit. Internal Review can still emit synthetic prompts without `agent_id`, so full genuine-user parity is not provable from command payloads. The user's "Then ignore it and move on." selects normal best-effort history and accepts Review as a documented nonblocking limitation, with no special workaround or tracking disablement. Plan/matrix reconciliation and final independent code/QA reviews are complete with GO. M0 source/probe/review work and the history decision are complete; M1 is authorized and in progress under parent coordination. Recipient file readability, implementation work and P/L evidence remain unresolved beyond that entry decision. **M0 is complete and M1 is authorized/in progress; planned history/runtime behavior is not shipped, and P/L evidence remains absent.**

## Evidence and Entry Gate (Original Snapshot)

This section records the original September 7 documentation-only pass. Its missing-source and unattempted statuses are historical; the current disposition above and finalized source sidecars supersede them.

**Current documentation:** the official hooks HTML page was searched and opened on 2026-09-07. Its advertised Markdown endpoint was also successfully fetched through an escalated, read-only `curl` request after sandbox DNS failed. The web reader rejected that endpoint's `text/markdown` content type; this was a reader limitation, not absence of the documentation. No documentation snapshots, credentials, or trust files were written locally.

**Selected target release:** Codex CLI `0.153.4`, announced 2026-09-04 in the official [ChatGPT & Codex changelog, Codex CLI 0.153.4 entry](https://learn.chatgpt.com/docs/changelog). The changelog was opened and that entry located on 2026-09-07. The entry links a `rust-v0.153.3...rust-v0.153.4` comparison. This establishes an announced target version and tag spelling, not a verified tag-to-commit resolution or a hook runtime contract.

**Installed version:** the September repository review historically reports package metadata `0.153.4`. This research did not execute Codex or independently inspect that package. Metadata does not bind today's documentation to installed behavior, and no further host inspection is needed for this research.

**Version-pinned source at the original documentation pass:** not attempted. The subsequent M0 audit is linked above and supersedes that acquisition status. The hooks documentation's link to schemas on `main` is not a version pin, and generated schemas do not necessarily match actual parser checks.

**Captured live:** none. Plan A's recorded May attempt used `0.133.0`, ended with authentication failure, and captured zero hook payloads. Existing fixtures are synthetic. Historical test results, current package metadata, and documentation examples cannot be relabeled as captured runtime evidence.

**Implementation entry gate:** reconcile selected target `0.153.4` parser/executor behavior with each proposed control below before enabling that behavior. The relationship between current hooks docs and `0.153.4` is unresolved; there is no demonstrated version mismatch and no demonstrated match. Record exact source provenance and any differences. A parser schema alone cannot establish execution, delivery, or failure semantics. Shipping decisions that block, rewrite, or continue still require the epic's live evidence or explicit release-confidence decision. This task authorizes neither execution nor bypassing that gate.

## Fetched Official Sources

The source for all current hook-contract observations below is [Hooks](https://learn.chatgpt.com/docs/hooks), also fetched as [Hooks Markdown](https://learn.chatgpt.com/docs/hooks.md). The separately fetched [changelog](https://learn.chatgpt.com/docs/changelog), September 4 entry, establishes the target release announcement only. Relevant hook sections are linked alongside each topic. These URLs are current documentation, not immutable artifacts. Search snippets and unfetched links are not evidence in this report.

Local context read after the initial official fetch: `codex-capability-matrix.md`, Plan A's results, `docs/domain/cross-agent-hooks.md`, `continuation-review.md`, `docs/epics/EPIC-0044-cross-agent-hook-portability.md`, and `docs/domain/config/handoff.md`. Plan D was also consulted. Local context establishes Clooks planning requirements, not upstream runtime behavior.

## Input Envelope and Identity

Current docs describe one JSON object on command-hook stdin. The common fields are `session_id: string`, `transcript_path: string | null`, `cwd: string`, `hook_event_name: string`, and `model: string`. These descriptive tables are not a complete required-field schema. `model` and event-specific `turn_id` are Codex extensions. Within the ten-event scope, `permission_mode` is described for every event except `PreCompact` and `PostCompact`; its documented values are `default`, `acceptEdits`, `plan`, `dontAsk`, and `bypassPermissions`. See [Common input fields](https://learn.chatgpt.com/docs/hooks#common-input-fields).

Subagent lifecycle hooks use the parent's `session_id`; their separate `agent_id` identifies the child. Do not infer an independent child session key from the shared field. `agent_transcript_path` on SubagentStop is independently nullable. The page does not fully specify parent/child identity on every ordinary tool or prompt event occurring inside a child. Transcript content is explicitly unstable: do not parse it to reconstruct missing scope or user-turn identity.

All event-specific fields below are strings unless annotated. Common fields and applicable `permission_mode` are additional to this table. Each event name links to its fetched section.

| Event | Event-specific input | Matcher |
| --- | --- | --- |
| [SessionStart](https://learn.chatgpt.com/docs/hooks#sessionstart) | `source`: startup/resume/clear/compact | Source |
| [SubagentStart](https://learn.chatgpt.com/docs/hooks#subagentstart) | `turn_id`, `agent_id`, `agent_type`, `permission_mode` | Agent type |
| [PreToolUse](https://learn.chatgpt.com/docs/hooks#pretooluse) | `turn_id`, `tool_name`, `tool_use_id`, `tool_input: JSON value` | Tool name and aliases |
| [PermissionRequest](https://learn.chatgpt.com/docs/hooks#permissionrequest) | `turn_id`, `tool_name`, `tool_input: JSON value`; optional input `description: string | null` | Tool name and aliases |
| [PostToolUse](https://learn.chatgpt.com/docs/hooks#posttooluse) | `turn_id`, `tool_name`, `tool_use_id`, `tool_input: JSON value`, `tool_response: JSON value` | Tool name and aliases |
| [PreCompact](https://learn.chatgpt.com/docs/hooks#precompact) | `turn_id`, `trigger`: manual/auto | Trigger |
| [PostCompact](https://learn.chatgpt.com/docs/hooks#postcompact) | `turn_id`, `trigger`: manual/auto | Trigger |
| [UserPromptSubmit](https://learn.chatgpt.com/docs/hooks#userpromptsubmit) | `turn_id`, `prompt` | Ignored |
| [SubagentStop](https://learn.chatgpt.com/docs/hooks#subagentstop) | `turn_id`, `agent_id`, `agent_type`, `agent_transcript_path: string | null`, `stop_hook_active: boolean`, `last_assistant_message: string | null` | Agent type |
| [Stop](https://learn.chatgpt.com/docs/hooks#stop) | `turn_id`, `stop_hook_active: boolean`, `last_assistant_message: string | null` | Ignored |

PermissionRequest has no documented `tool_use_id`. SessionStart has no documented `turn_id`. Do not synthesize either as if supplied upstream. The meaning of a native turn identifier across internal continuation is not settled by the tables.

## Tool Codecs and Coverage

Current [Tool coverage](https://learn.chatgpt.com/docs/hooks#tool-coverage) includes shell, unified exec, patch, MCP, and most other local function tools. Hosted tools such as WebSearch do not traverse that path; specialized paths may opt out. Coverage is not a universal enforcement boundary.

| Tool family | Wire input and replacement | Constraints for Clooks |
| --- | --- | --- |
| Shell and `exec_command` | Canonical hook name `Bash`; `tool_input.command`; replacement requires string `command` | Do not assume the caller's `cmd` or argument-vector shape is the hook wire shape. Additional shell fields and serialization details are not exhaustively specified here. |
| `apply_patch` | Canonical name stays `apply_patch`; patch carried in `command`; replacement requires string `command` | `Edit` and `Write` are matcher aliases, not evidence of Claude structured file-edit input. |
| MCP | Canonical names such as `mcp__server__tool`; arguments supplied as input; replacement is an arguments object | Preserve arbitrary nested argument keys and values. Post response is the MCP call result, not a guaranteed text field. |
| Other local functions | Function name and arguments; replacement arguments object | `spawn_agent` also matches `Agent`. Unknown functions need honest unknown-tool handling. Model-facing output is normally used for post response. |

PreToolUse rewrites require `hookSpecificOutput.permissionDecision: "allow"` with `updatedInput`. The page reports other replacement shapes as errors but does not exhaustively specify each malformed-shape execution outcome. Preserve original JSON separately from normalized public context. Do not recursively rename keys in arguments, MCP results, or arbitrary nested objects.

Clooks' partial updates and null-as-unset behavior, described in the continuation review, are not the upstream replacement contract. Plan D must materialize a complete replacement through a tool-aware codec, preserve untouched data, and distinguish existing opaque nulls from explicit removals. No public-type widening or patch parser is implemented by this report.

Unified exec can deliver the original command's PostToolUse during a later `write_stdin` completion poll. Sending input or polling an already-approved command does not rerun PreToolUse. Completion correlation must retain the original invocation rather than treating the poll as a new approved command.

## Ten-Event Output and Exit Matrix

The following is current-docs behavior for synchronous command hooks. `context` means `hookSpecificOutput.additionalContext` with the matching `hookEventName`. `message` means top-level `systemMessage`, surfaced as a warning. Exit 0 with empty stdout is common success. An unspecified exit-2 result must not be inferred from another event. Sources: [Common output fields](https://learn.chatgpt.com/docs/hooks#common-output-fields) and the ten event sections linked above.

| Event | Effective JSON output | Plain stdout at exit 0 | Exit 2 with stderr |
| --- | --- | --- | --- |
| SessionStart | Context; common `continue`/`stopReason`/message | Developer context | Not specified by event section |
| SubagentStart | Child context; message. `continue:false` is accepted but does not prevent startup | Child developer context | Not specified |
| PreToolUse | `permissionDecision: deny` with `permissionDecisionReason`; legacy top-level `decision:block` with `reason`; context; allow plus valid `updatedInput`; message | Ignored | Blocks pending call with reason |
| PermissionRequest | `hookSpecificOutput.decision.behavior: allow` or `deny`; denial `message`; top-level message. No decision leaves normal approval | Ignored | Not specified |
| PostToolUse | Top-level `decision:block`/`reason`; context; `continue:false`/`stopReason`; message | Ignored | Supplies post-execution feedback |
| PreCompact | Common `continue`/`stopReason`/message; false stops before compaction | Ignored | Not specified |
| PostCompact | Common `continue`/`stopReason`/message; false stops after compaction | Ignored | Not specified |
| UserPromptSubmit | Context; top-level `decision:block`/`reason`; common controls/message | Developer context | Blocks submission with reason |
| SubagentStop | Top-level `decision:block`/`reason` requests child continuation; common controls/message | Nonempty plain text invalid | Requests child continuation |
| Stop | Top-level `decision:block`/`reason` requests continuation; common controls/message | Nonempty plain text invalid | Requests continuation |

PermissionRequest runs only when approval is needed, not for every tool call. Any matching denial wins; otherwise an allow suppresses the approval prompt, and no decision retains normal approval. This is distinct from PreToolUse's permission-decision shape.

PostToolUse runs after side effects, including nonzero Bash completion. Blocking replaces the original result with feedback and continues the model; it cannot reverse the action. `continue:false` also replaces normal result processing with feedback/stop text, rather than establishing a universal turn abort.

In [Tool calls from code mode](https://learn.chatgpt.com/docs/hooks#tool-calls-from-code-mode), PreToolUse blocking rejects the nested promise before execution; rewriting executes the replacement. PostToolUse block or exit 2 rejects the promise after execution. PostToolUse `continue:false` changes model-visible feedback without rejecting that nested promise. These outputs are not interchangeable.

Stop blocking creates a continuation prompt acting as a new user prompt. At Stop and SubagentStop, any matching `continue:false` takes precedence over continuation decisions. This explicitly reverses the intuition that a block always prevents further action. `stop_hook_active` indicates prior continuation; it is not documented as a durable original-user-request identifier.

After root compaction, SessionStart with `source:compact` runs before the next model request, including automatic mid-turn compaction. Its context reaches immediate continuation, and `continue:false` ends that turn before another model request. PreCompact and PostCompact do not have a documented context-injection output; do not invent one for handoff.

## Parsed, Ignored, Rejected, and Unknown

| Output or handler | Current documentation classification | Planning consequence |
| --- | --- | --- |
| PreToolUse `permissionDecision:ask`, legacy `decision:approve`, `continue:false`, `stopReason`, `suppressOutput` | Parsed but unsupported; run fails, error reported, tool continues | Do not emit as a refusal or assume parser acceptance means enforcement |
| PermissionRequest `updatedInput`, `updatedPermissions`, `interrupt` | Reserved; fail closed | Reject unsupported author results before effects; do not deliberately use reserved fields as an enforcement mechanism |
| PermissionRequest `continue`, `stopReason`, `suppressOutput` | Unsupported in common-output section | Exact failure disposition is not specified there; do not borrow PreToolUse behavior |
| PostToolUse `updatedMCPToolOutput`, `suppressOutput` | Parsed but unsupported; failure reported, normal result processing continues | Not a supported response-rewrite channel |
| Common `suppressOutput` | Parsed, not implemented | Never promise output suppression |
| SubagentStart `continue:false` | Parsed for compatibility, startup proceeds | Not a child-start veto |
| `prompt` and `agent` handlers | Parsed but skipped | Clooks remains a command-handler integration |
| Unknown JSON keys, wrong event discriminator, missing required data, malformed JSON, mixed text/JSON | Not exhaustively specified in fetched prose | Exact parser outcomes remain a pinned-source gate |

The docs specify particular intentional exit-2 channels; they do not establish a general per-event contract for unexpected nonzero exits, signals, spawn failures, timeouts, or stderr on successful completion. Mark these unknown rather than labeling every failure fail-open or fail-closed. A bare exit 2 from Clooks' current placeholder or shell cannot be advertised as universal enforcement: on Stop it is explicitly a continuation request. Failures where the event cannot be decoded need their own honest diagnostic policy.

## Delivery and Handoff

Current [Large hook output](https://learn.chatgpt.com/docs/hooks#large-hook-output) documentation describes an approximately 2,500-token default limit per model-visible message. Oversized text is saved to a temporary hook-output file and represented by a preview plus path; failed file writes still produce a truncated preview. Command-handler `additionalContextLimit` changes the additional-context limit, including 0 for full context; feedback and continuation prompts retain the default. Clooks' UTF-16 handoff threshold is a separate mechanism, not the same upstream token budget.

Documented audiences differ: SessionStart/UserPromptSubmit context reaches developer context; SubagentStart context targets the child; PostToolUse feedback replaces the tool result; Stop reason becomes a continuation prompt; `systemMessage` is a UI/event-stream warning. Permission denial text and common stop text are not evidence of an arbitrary model-readable channel.

Plan D should select eligible handoff fields using provider/event delivery semantics before file substitution. Keep human-facing messages and generated diagnostics inline, and require an explicit recipient/readability policy for child pointers. Native spilling does not prove that a child can read a Clooks project handoff file or that the model actually read either file. Inline fallback must preserve the original decision. Recording returned text in turn history is not proof of delivery.

Current [Background hooks](https://learn.chatgpt.com/docs/hooks#run-hooks-in-the-background) deliver informational output at a later safe point, or at the next user turn if idle; completion does not create a new turn. They cannot block, approve, rewrite, reject prompts, or request continuation. Delivery ordering can differ from launch ordering and undelivered output can be discarded at session end. Keep Clooks policy hooks synchronous; background delivery is not a substitute for event-aware enforcement.

[MCP tool hooks](https://learn.chatgpt.com/docs/hooks#mcp-tool-hooks) are a separate handler mechanism from observing model-issued MCP tool calls. Current docs support synchronous handlers using existing connections and the same output contract. Missing servers/tools and handler errors do not block; handlers neither request tool approval nor recursively trigger hooks. This does not change Clooks' command-handler scope.

## Changes Relative to the May Record

These are differences or new clarifications relative to the local 2026-05-23 matrix, not a dated upstream changelog. No exact introduction version is established.

| May record or omission | September fetched documentation | Plan D impact |
| --- | --- | --- |
| Narrow shell/patch/MCP interception; domain says non-shell local tools excluded | Most local functions covered; unified-exec completion and code-mode semantics described | Do not constrain codec dispatch to Claude tool names or assume each exec poll is a new invocation |
| Command-only handler description | `mcp_tool` handlers supported; prompt/agent still skipped | Correct future documentation without changing Clooks distribution scope |
| Broad common-output treatment can imply child startup can stop | SubagentStart explicitly ignores `continue:false` | Remove any child-start-veto capability |
| No precise nested promise distinction | Post block/exit 2 reject; post `continue:false` does not | Separate those controls in capability policy and acceptance |
| No immediate post-compaction delivery detail | Root compact SessionStart precedes immediate model continuation | Do not postpone context delivery to a later user request |
| No background/spill delivery detail in matrix | Async informational delivery and output limits documented | Keep enforcement synchronous and audit pointer delivery |
| Ten-event catalog | Current upstream also lists SessionEnd and Interrupt | Preserve agreed ten; additions require another scope decision |

The May 17-to-May 23 change permitting PreToolUse rewrite is already historical in Plan A. Do not present it as a new September addition. May evidence about ask, permission rewrites, and post MCP replacement remains consistent with the fetched page. Neither a changed document nor installed package metadata establishes which changes shipped in `0.153.4`.

## Remaining Evidence Gates (Original Snapshot)

Historical checklist from the original documentation pass, preserved below. Selected-source provenance, parser/failure source paths, tool codecs and ordinary identity/continuation inspection are now complete. Current reconciliation and final independent code/QA reviews are complete with GO. The accepted best-effort history policy makes Review nonblocking; M0 is complete and M1 is authorized/in progress. Implementation work, recipient readability and P/L execution evidence remain unresolved. The exhausted execution allowance is a completed probe disposition, not an executed conformance pass.

| Gate | Evidence still needed | Concrete consequence while unresolved |
| --- | --- | --- |
| Selected version | Target `0.153.4` announcement verified; exact tag-to-commit resolution and reconciliation with current hooks prose remain unattempted | No `0.153.4`-verified hook contract or tested-support claim |
| Parser and failures | Required fields, unknown keys, malformed outputs, unexpected exits/timeouts per event | No universal failure-to-exit-2 policy; serialize only explicitly supported outputs |
| Tool codec | Exact Bash/patch envelope details, opaque replacement validation, response shapes | Preserve raw input privately; enable rewrites only for validated codecs |
| Turn boundary | Stop-generated prompt event sequence and native ID changes; distinction from genuine user prompt | Do not promise once-per-user-turn parity or reset history on assumed continuation boundaries |
| Parent/child scope | Ordinary child event identity and child delivery/readability | Do not share parent/child state merely because session IDs match; do not promise pointer delivery |
| Enforcement confidence | Pinned executor evidence and epic-required live evidence or explicit release decision | Synthetic replay can validate Clooks behavior but cannot prove upstream denial or continuation |

Validate every individual author/lifecycle/error result before input mutation, handoff, or reduction. Keep provider, raw wire input, codec, identities, and delivery audience in a private invocation envelope, not a singleton adapter or public context spread. Unsupported safety decisions must be mapped deliberately where a supported refusal exists; observational events require diagnostics without pretending to undo completed actions. These are Clooks planning conclusions from the contract and continuation review, not claims about an implemented adapter.

## M0 Research Gate Steps (Original Snapshot)

These were the pending research steps at the original documentation pass, whose status was unattempted rather than infrastructure-blocked. They are preserved as historical instructions, not a request to repeat acquisition or the exhausted execution attempts. The source audits now complete the inspection work and identify the concrete Review limitation; policy reconciliation and final independent code/QA reviews are complete with GO. The best-effort history decision is accepted with Review nonblocking; M0 is complete and M1 is authorized/in progress. Preserve the ten-event scope throughout.

1. Follow the official announcement's release reference for `rust-v0.153.4`, resolve the tag to its exact commit, and record the repository, tag, commit, retrieval date, and immutable source links. Verify the tag's target rather than substituting `main`. A release announcement is already established; no new installed-binary inspection is required.
2. At that commit, locate the generated hook schemas and their source definitions. Extract requiredness, nullability, enums, unknown-field policy, event discriminators, and tool input/output containers for all ten events. Record exact source locations. Keep syntactic acceptance separate from executor support; reconcile every accepted-but-ignored or rejected field in this report.
3. Trace the synchronous command executor and each event consumer at the same commit. Populate an event-by-event matrix for empty/text/JSON stdout, exit 2, other nonzero exits, malformed JSON, timeout, spawn failure, signal, and successful stderr. Record operation outcome separately from hook-run status, diagnostic audience, and continuation. For outcomes not proved by inspection, retain explicit unknown cells.
4. Trace Bash/unified exec, patch, MCP, other local tools, and code-mode boundaries. Establish the exact envelope and replacement validation, original call correlation during polling, and result delivery to script versus model. Record unsupported specialized paths. Do not convert schema permissiveness into a claim that arbitrary replacement objects execute successfully.
5. Trace root and child start/stop, native turn allocation, generated continuation prompts, compaction, and resume. Determine whether Stop continuation emits UserPromptSubmit and how its identifiers change. Establish whether the available wire fields distinguish an internal continuation from a genuine user request. If not, record the concrete once-per-user-turn limitation instead of inventing an identifier or reading unstable transcripts.
6. Trace context/feedback audiences and file visibility assumptions needed for handoff. Produce a provider/event/field eligibility table, including child delivery and inline fallback. Keep UI warnings distinct from model input, and returning a pointer distinct from proving it was read.
7. Reconcile all findings with the current-docs matrix and mark each capability as target-source-backed, current-docs-only, unsupported, or unresolved. Record a concrete enable/defer decision per control in Plan D. Do not claim this closes the epic's live-confidence gate. Any later executable conformance work requires its own authorized Docker-only phase; no tests, probes, model API calls, or live Codex runs are part of this research task.

The original gate required immutable target provenance, the ten-event parser/executor/failure matrix, codec and identity decisions, delivery eligibility, and explicit unresolved capabilities that implementation would not silently treat as supported. The original pass performed no source acquisition. Subsequent acquisition, source audits, bounded probe dispositions and final independent code/QA reviews are complete. The accepted best-effort history policy resolves the Review entry decision without a special workaround. M0 is complete and M1 is authorized/in progress; two attempts without tests do not supply executed conformance.

## Work Performed and Limits (Original Snapshot)

During the original documentation-only pass, only this new research document was written. No production/test/domain edits, test execution, executable spikes, live Codex runs, model API calls, init/uninstall, installed global binaries, or credential/trust copying occurred. Verification was limited to reading the created document and checking its patch formatting.

This later closure-metadata update incorporates the completed source audits and the parent's reported retry outcome. Source acquisition and executable preparation were performed by the runner, not by this documentation update. The update performed read-only inspection and documentation edits only, with no tests, probes, source fetches, production changes or commits. Detailed runner evidence is recorded separately; confirmed cleanup is summarized in the current disposition above. Historical website observations above remain a snapshot, not tested release behavior.
