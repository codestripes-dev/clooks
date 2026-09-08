# Codex Hook Capability Matrix

**2026-09-07 reassessment:** The tables below preserve the May evidence snapshot, not a current version-pinned implementation contract. Read [continuation-review.md](continuation-review.md) before consuming them. Current upstream documentation has changed; runtime behavior remains unverified. The next contract pass must revalidate tool coverage, input codecs, output handling, trust, and identity against a selected release. Synthetic fixtures are examples, not independent confirmation.

This matrix is the historical Plan A contract artifact for EPIC-0044. The agreed MVP targets these ten Codex lifecycle events: `SessionStart`, `SubagentStart`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `UserPromptSubmit`, `SubagentStop`, and `Stop`. This is the product target, not an assertion that the current upstream catalog contains only ten events or that their semantics are identical to Claude's.

## Evidence Metadata

- Checked date: 2026-05-23 UTC.
- Local CLI: `codex-cli 0.133.0`.
- Official release reference: `https://developers.openai.com/codex/hooks`.
- Plugin reference: `https://developers.openai.com/codex/plugins/build`.
- Schema reference: `https://github.com/openai/codex/tree/main/codex-rs/hooks/schema/generated`.
- Source policy: the official hooks page is the release contract. Generated `main` schemas are advisory when they include fields not described on the release page.
- Runtime status: docs refreshed and local CLI inspected. Live hook execution was attempted with disposable `HOME`, `CODEX_HOME`, and project directories; model/auth access blocked empirical hook firing, so safety-critical behavior remains docs-backed rather than runtime-verified.

Status terms:

- Supported: documented release behavior Clooks may emit for Codex.
- Unsupported/fail-open: Codex reports the hook failure or ignores the field and continues the underlying action; Clooks must not use this for safety decisions.
- Unsupported/fail-closed: Codex rejects the hook output or treats the hook run as failed in a way that can stop the hook path; Clooks must avoid emitting this unless deliberately failing.
- Unverified: not empirically verified in this environment.
- Needs careful translation: documented by Codex and in MVP, but event-specific semantics differ enough that implementation must test the mapping explicitly.

## Release Events

| Codex event | Release docs status | First Clooks adapter status | Matcher | Notes |
| --- | --- | --- | --- | --- |
| `SessionStart` | Supported | MVP | `source` (`startup`, `resume`, `clear`, `compact`) | Adds context at thread start. Plain text stdout becomes developer context. |
| `SubagentStart` | Supported | MVP | `agent_type` | Clooks already exposes `SubagentStart`. Codex context injection targets the spawned subagent, matching the key Claude caveat. |
| `PreToolUse` | Supported | MVP | `tool_name`; `apply_patch` also matches `Edit` and `Write` | Intercepts Bash, `apply_patch`, and MCP calls, but not all shell/non-shell tools. |
| `PermissionRequest` | Supported | MVP | `tool_name`; `apply_patch` also matches `Edit` and `Write` | Runs only when Codex is about to ask for approval. |
| `PostToolUse` | Supported | MVP | `tool_name`; `apply_patch` also matches `Edit` and `Write` | Runs after supported tools, including nonzero Bash exits. Cannot undo side effects. |
| `PreCompact` | Supported | MVP | `trigger` (`manual`, `auto`) | Clooks already has a Claude `PreCompact` concept. Include in the first Codex MVP, with safety-critical `continue: false` behavior remaining runtime-unverified. |
| `PostCompact` | Supported | MVP | `trigger` (`manual`, `auto`) | Clooks already has a Claude `PostCompact` concept. Include in the first Codex MVP, with output behavior remaining runtime-unverified. |
| `UserPromptSubmit` | Supported | MVP | ignored | Can block prompt submission or add developer context. |
| `SubagentStop` | Supported | MVP | `agent_type` | Clooks already exposes `SubagentStop`. Like `Stop`, `block` means continue rather than reject. |
| `Stop` | Supported | MVP | ignored | `decision: "block"` means continue the turn, not reject it. |

## Common Input Fields

Every command hook receives one JSON object on stdin. Common fields are `session_id`, `transcript_path`, `cwd`, `hook_event_name`, and `model`. `transcript_path` is `string | null`, so the Codex adapter must not assume Clooks' current `transcriptPath: string` can be populated from wire input. `permission_mode` appears on `SessionStart`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `UserPromptSubmit`, `SubagentStart`, `SubagentStop`, and `Stop`. Turn-scoped events include `turn_id`.

The transcript format is not stable API. Clooks may expose the path as metadata, but downstream plans should not parse it for behavior.

## Event-Specific Inputs

| Event | Event-specific fields | Adapter notes |
| --- | --- | --- |
| `SessionStart` | `source` | Map to Clooks `SessionStart.source`. Treat nullable transcript path with an adapter fallback or metadata field. |
| `SubagentStart` | `turn_id`, `agent_id`, `agent_type`, `permission_mode` | MVP. Map to existing Clooks `SubagentStart` context and preserve `turn_id` as adapter metadata. |
| `PreToolUse` | `turn_id`, `tool_name`, `tool_use_id`, `tool_input` | Map `tool_name` and `tool_input` to existing Clooks tool context. Preserve `turn_id`, `tool_use_id`, and raw payload as adapter metadata. |
| `PermissionRequest` | `turn_id`, `tool_name`, `tool_input`, optional `tool_input.description` | Map to existing `PermissionRequest`; do not assume every tool has a description. |
| `PostToolUse` | `turn_id`, `tool_name`, `tool_use_id`, `tool_input`, `tool_response` | Map `tool_response` to Clooks tool response/output context. Preserve raw response for MCP-specific shapes. |
| `PreCompact` | `turn_id`, `trigger` | MVP. Clooks has a Claude event name match; the adapter should preserve `trigger` and treat `continue: false` behavior as docs-backed but runtime-unverified. |
| `PostCompact` | `turn_id`, `trigger` | MVP. Clooks has a Claude event name match; the adapter should preserve `trigger` and treat output behavior as docs-backed but runtime-unverified. |
| `UserPromptSubmit` | `turn_id`, `prompt` | Map to existing prompt context. Matcher is ignored by Codex. |
| `SubagentStop` | `turn_id`, `agent_id`, `agent_type`, `agent_transcript_path`, `stop_hook_active`, `last_assistant_message` | MVP. Map to existing Clooks `SubagentStop` context; treat `agent_transcript_path: null` with the same nullable-path policy as `transcript_path`. |
| `Stop` | `turn_id`, `stop_hook_active`, `last_assistant_message` | Map to existing Stop context where possible. Codex continuation semantics differ from normal blocking. |

## Codex Event -> Clooks Context Policy

| Codex event | Clooks event/context target | Existing `ClooksHook` surface unchanged? | Matcher policy | `transcript_path` policy | `turn_id` / ID policy | Raw payload policy |
| --- | --- | --- | --- | --- | --- | --- |
| `SessionStart` | Existing `SessionStart` context, with Codex `source` mapped to the closest existing source value. | Mostly. The adapter must fill or metadata-store nullable transcript paths without widening public types in the first MVP. | Register matcher by Codex `source` only if Clooks later exposes source filtering; otherwise let Clooks config matching own selection. | If `null`, provide an adapter fallback only if existing internals require a string, and retain the real null in metadata. | No `turn_id`. Preserve `session_id` internally. | Retain internally for diagnostics and later `ctx.raw`/`ctx.agent` decisions. |
| `SubagentStart` | Existing `SubagentStart` context. | Yes for observe/context-injection paths. Injection audience must remain the spawned subagent, not the parent. | Codex matcher is `agent_type`; Clooks should register one Codex command for the event and do per-hook matching internally. | Same nullable policy as other events. | Preserve `turn_id` and `agent_id` as adapter metadata. | Retain internally for subagent diagnostics. |
| `PreToolUse` | Existing `PreToolUse` context with `tool_name` and `tool_input` normalized to Clooks tool fields. | Yes for observe/block/context-injection paths. `updatedInput` needs Codex-specific translation rules. | Codex matches `tool_name`; `apply_patch` also matches `Edit` and `Write`. Clooks should register one Codex command per event and do per-hook matching internally. | Same nullable policy as other events. | Preserve `turn_id` and `tool_use_id` as adapter metadata, not public first-MVP fields. | Retain internally so unsupported Codex tool input shapes can still be diagnosed. |
| `PermissionRequest` | Existing `PermissionRequest` context. | Yes for allow/deny only. No for rewrites, permission updates, or interrupts. | Codex matches `tool_name`; `apply_patch` also matches `Edit` and `Write`. | Same nullable policy as other events. | Preserve `turn_id`; there is no documented `tool_use_id` on this event. | Retain internally for permission diagnostics. |
| `PostToolUse` | Existing `PostToolUse` context with raw `tool_response` preserved. | Mostly. Block/context paths map, but MCP output rewrite does not. | Codex matches `tool_name`; `apply_patch` also matches `Edit` and `Write`. | Same nullable policy as other events. | Preserve `turn_id` and `tool_use_id` as adapter metadata. | Retain internally because `tool_response` shapes vary by tool. |
| `PreCompact` | Existing Clooks `PreCompact` context. | Yes for the first MVP, subject to Codex-specific output translation for `continue: false`. | Codex matcher is `trigger`. Clooks should register one Codex command for the event and do per-hook matching internally. | Same nullable policy as other events. | Preserve `turn_id` as adapter metadata. | Retain internally for compaction diagnostics. |
| `PostCompact` | Existing Clooks `PostCompact` context. | Yes for the first MVP, subject to Codex-specific output translation. | Codex matcher is `trigger`. Clooks should register one Codex command for the event and do per-hook matching internally. | Same nullable policy as other events. | Preserve `turn_id` as adapter metadata. | Retain internally for compaction diagnostics. |
| `UserPromptSubmit` | Existing `UserPromptSubmit` context. | Yes for block and context injection. | Codex ignores matcher values for this event. Clooks matching should be internal. | Same nullable policy as other events. | Preserve `turn_id` as adapter metadata. | Retain internally so exact prompt payload is available for diagnostics. |
| `SubagentStop` | Existing `SubagentStop` context. | Yes, with Stop-like continuation semantics. | Codex matcher is `agent_type`; Clooks should register one Codex command for the event and do per-hook matching internally. | Same nullable policy as other events; `agent_transcript_path` is independently nullable. | Preserve `turn_id` and `agent_id` as adapter metadata. | Retain internally for continuation diagnostics. |
| `Stop` | Existing `Stop` context where `last_assistant_message` and active-stop state map cleanly. | Partially. Clooks Stop must not treat Codex `decision: "block"` as rejection; it means continue. | Codex ignores matcher values for this event. | Same nullable policy as other events. | Preserve `turn_id` as adapter metadata. | Retain internally for continuation diagnostics. |

## Output Fields And Exit Behavior

| Field or channel | Codex support | Clooks policy |
| --- | --- | --- |
| Exit `0` with empty stdout | Supported success | Emit no-op success when a Clooks event produces no Codex-visible result. |
| Exit `0` with stderr | Docs-backed as non-decision feedback where event docs mention stderr handling; runtime-unverified in this plan | Do not rely on stderr for behavior. Use `systemMessage` for diagnostics where possible. |
| Plain text stdout on `SessionStart` | Supported as developer context | Can map `injectContext` to plain text or JSON `additionalContext`; JSON is preferable. |
| Plain text stdout on `UserPromptSubmit` | Supported as developer context | JSON `additionalContext` is preferable for structure. |
| Plain text stdout on `SubagentStart` | Supported as subagent developer context | Prefer JSON `additionalContext` for adapter determinism. |
| Plain text stdout on `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact` | Ignored | Do not use for Clooks results. |
| Plain text stdout on `SubagentStop` or `Stop` | Invalid | Always emit JSON for these events when stdout is non-empty. |
| Non-JSON stdout | Event-specific: context text on `SessionStart`, `UserPromptSubmit`, and `SubagentStart`; ignored or invalid elsewhere | Adapter should always emit JSON for deterministic behavior except if a later plan intentionally uses plain text context. |
| `systemMessage` | Supported on all documented events, with event-specific caveats | Use for diagnostics/warnings, not behavior. |
| `continue: false` | Supported on common-output events, `PostToolUse`, `PreCompact`, `PostCompact`, `SubagentStop`, `Stop`; not supported on `PreToolUse` or `PermissionRequest` | Do not map generic Clooks blocking to `continue: false` on `PreToolUse` or `PermissionRequest`. |
| `stopReason` | Supported where `continue: false` is supported; unsupported on `PreToolUse` and `PermissionRequest` | Only emit with supported `continue: false` paths. |
| `suppressOutput` | Parsed but not implemented | Unsupported/fail-open. Do not emit. |
| Exit code `2` with stderr | Supported block/feedback/continuation channel on `PreToolUse`, `UserPromptSubmit`, `PostToolUse`, `SubagentStop`, `Stop`; docs do not present it as the primary path for all common-output events | Prefer JSON stdout for adapter determinism. Use exit code behavior only if a later plan intentionally models process-level failure. |
| Other nonzero exit with stderr | Unverified by runtime in this plan | Treat as hook failure. Clooks should avoid relying on this as a decision channel. |
| Malformed JSON stdout | Unverified by runtime in this plan | Treat as hazardous; adapter should emit well-formed JSON only. |
| Unknown top-level JSON fields | Unverified by runtime in this plan | Do not emit unknown fields. |
| Event-specific unsupported fields | Docs-backed as mixed fail-open/fail-closed depending on event | Never pass through unsupported Clooks capabilities. `PreToolUse.ask` and `PostToolUse.updatedMCPToolOutput` are fail-open hazards; `PermissionRequest.updatedInput`, `updatedPermissions`, and `interrupt` are fail-closed hazards. |

## Clooks Result Mapping Implications

| Clooks capability | Codex status | Adapter implication |
| --- | --- | --- |
| `allow` | Supported for `PermissionRequest`; supported with `updatedInput` on `PreToolUse` when expressed as `permissionDecision: "allow"` | Map only where Codex has an explicit allow shape. |
| `ask` | Unsupported/fail-open on `PreToolUse` | Treat as unsupported under Codex. Warn or fail clearly rather than emitting `permissionDecision: "ask"`. |
| `block` | Supported on `PreToolUse`, `UserPromptSubmit`, `PostToolUse`, `SubagentStop`, and `Stop` with event-specific meaning | Map carefully. On `Stop` and `SubagentStop`, "block" means continue, not reject. |
| `defer` | No documented Codex equivalent | Unsupported for Codex MVP. |
| `skip` | Clooks-internal no-op | Do not emit Codex output beyond optional diagnostics. |
| `injectContext` | Supported as `additionalContext` on `SessionStart`, `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, and `SubagentStart`; plain text also works for some events | Map to hook-specific JSON `additionalContext` where available. |
| `updatedInput` | Supported for `PreToolUse` only with `permissionDecision: "allow"`; reserved/fail-closed on `PermissionRequest` | Codex MVP can support `PreToolUse` rewrites for Bash, `apply_patch`, and MCP after implementation tests. Must reject PermissionRequest rewrites. |
| `updatedPermissions` | Reserved/fail-closed on `PermissionRequest` | Unsupported under Codex. |
| `interrupt` | Reserved/fail-closed on `PermissionRequest` | Unsupported under Codex. |
| `updatedMCPToolOutput` | Parsed but unsupported/fail-open on `PostToolUse` | Unsupported under Codex MVP. |
| Stop continuation | Supported via `decision: "block"` and via `continue: false` precedence | Existing Clooks Stop result needs an explicit Codex translation policy because "block" is not a rejection. |

## Portable Hook Author Guidance

Portable across Claude Code and Codex MVP:

- Observe lifecycle data for all ten Codex MVP events: `SessionStart`, `SubagentStart`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `UserPromptSubmit`, `SubagentStop`, and `Stop`.
- Block/deny `PreToolUse` and `UserPromptSubmit`.
- Add model-visible context on shared events where both agents support context injection.
- Allow or deny `PermissionRequest` without rewrites.
- Rewrite `PreToolUse` tool input only if the hook is prepared for Codex's narrower shape and a later implementation test proves the adapter mapping.

Claude-only or not portable today:

- Claude plugin-delivered hooks; Codex plugin hooks use a separate packaging/trust model.
- `ask`, `defer`, `updatedPermissions`, `interrupt`, and PermissionRequest `updatedInput`.
- Claude-only lifecycle events that Codex does not document.

Codex-specific details to test carefully:

- `SubagentStart` context injection must target the spawned subagent.
- `SubagentStop.block` must continue the subagent turn rather than reject the completed response.
- Codex plugin hook environment variables such as `PLUGIN_ROOT` and `PLUGIN_DATA`.
- Codex matcher aliases for `apply_patch` as `Edit` or `Write`.

Unsupported or hazardous:

- `PreToolUse.permissionDecision: "ask"`.
- Legacy `decision: "approve"`.
- `suppressOutput`.
- `PostToolUse.updatedMCPToolOutput`.
- `PermissionRequest.updatedInput`, `PermissionRequest.updatedPermissions`, and `PermissionRequest.interrupt`.

## Distribution And Trust Notes

Codex discovers hooks from `hooks.json` or inline `[hooks]` tables next to active config layers, commonly `~/.codex/` and `<repo>/.codex/`. Matching hooks from multiple files all run, and multiple matching command hooks for the same event launch concurrently. Clooks should therefore register one Clooks command hook per Codex event, not one Codex hook per Clooks hook.

Project-local `.codex` layers load only after the project layer is trusted. Non-managed command hooks are skipped until the exact hook definition is reviewed and trusted. Codex also offers `--dangerously-bypass-hook-trust` for one-off automation that already vets hook sources. Clooks distribution docs must not imply that writing `.codex/hooks.json` alone makes hooks run immediately.

Plugin-bundled hooks use the same event schema and trust review flow. Codex plugin packaging can load hooks from `hooks/hooks.json` or manifest entries. The local CLI currently reports `plugin_hooks` as stable and enabled, but plugin distribution remains a later option because Clooks' existing plugin story is Claude-oriented and Codex plugins have their own installation and trust flow.

## Runtime Verification Result

The live spike used `tmp/feat-0044-codex-contract/run-live-codex-spike.sh`, which creates a temporary home, temporary Codex home, temporary project, project-local `.codex/hooks.json`, and a capture hook. It then invokes:

    HOME="$workdir/home" CODEX_HOME="$workdir/codex-home" codex exec --cd "$workdir/project" --skip-git-repo-check --dangerously-bypass-hook-trust --sandbox workspace-write --json "Run pwd with Bash, then stop."

Because `CODEX_HOME` is disposable and does not contain the user's real authentication state, the installed CLI could not start a real agent run in this environment. No hook payloads were captured. This means Plan A's final classification is `docs-backed but runtime-unverified`: the docs are current enough to proceed with adapter-boundary design and fixture-based tests, but safety-critical runtime claims must be verified before shipping behavioral support for decisions that block, rewrite, or continue a Codex turn.

## Fixture Corpus

Durable input fixtures live under `test/fixtures/codex/events/` and cover all ten current release-documented events. They intentionally use Codex snake_case wire fields rather than Clooks camelCase fields. `src/codex-fixtures.test.ts` validates that every fixture parses as a JSON object and uses a documented `hook_event_name`.
