# Claude Code Hooks — Events

All 21 lifecycle events: when they fire, what they match on, what input they receive, and how to control their behavior.

**Source:** Official Anthropic docs at `code.claude.com/docs/en/hooks`, verified 2026-03-08.

## Event Summary

| Event | Can block? | Hook types | Matcher filters |
|-------|-----------|------------|-----------------|
| `SessionStart` | No | Command only | how started: `startup`, `resume`, `clear`, `compact` |
| `InstructionsLoaded` | No | Command only | `load_reason`: `session_start`, `nested_traversal`, `path_glob_match`, `include`, `compact` (regex/alternation) |
| `UserPromptSubmit` | Yes | All four | not supported |
| `PreToolUse` | Yes | All four | tool name: `Bash`, `Edit\|Write`, `mcp__.*` |
| `PermissionRequest` | Yes | All four | tool name (same as PreToolUse) |
| `PostToolUse` | Yes | All four | tool name |
| `PostToolUseFailure` | No | All four | tool name |
| `Notification` | No | Command only | type: `permission_prompt`, `idle_prompt`, `auth_success`, `elicitation_dialog` |
| `SubagentStart` | No | Command only | agent type: `Bash`, `Explore`, `Plan`, custom names |
| `SubagentStop` | Yes | All four | agent type |
| `Stop` | Yes | All four | not supported |
| `TeammateIdle` | Yes | Command only | not supported |
| `TaskCreated` | Yes | All four | not supported |
| `TaskCompleted` | Yes | All four | not supported |
| `ConfigChange` | Yes | Command only | source: `user_settings`, `project_settings`, `local_settings`, `policy_settings`, `skills` |
| `WorktreeCreate` | Yes | Command only | not supported |
| `WorktreeRemove` | No | Command only | not supported |
| `StopFailure` | No (output ignored upstream) | Command only | author-side via `ctx.error`: `rate_limit`, `authentication_failed`, `billing_error`, `invalid_request`, `server_error`, `max_output_tokens`, `unknown` |
| `PreCompact` | Yes | Command only | trigger: `manual`, `auto` |
| `PostCompact` | No | Command only | trigger: `manual`, `auto` |
| `SessionEnd` | No | Command only | reason: `clear`, `resume`, `logout`, `prompt_input_exit`, `bypass_permissions_disabled`, `other` |

## Common Input Fields (All Events)

| Field | Description |
|-------|-------------|
| `session_id` | Current session identifier |
| `transcript_path` | Path to conversation JSONL |
| `cwd` | Current working directory |
| `permission_mode` | `"default"`, `"plan"`, `"acceptEdits"`, `"dontAsk"`, or `"bypassPermissions"` |
| `hook_event_name` | Name of event that fired |
| `agent_id` | Subagent identifier (inside subagent calls only) |
| `agent_type` | Agent name (with `--agent` or inside subagent) |

## Per-Event Input & Output

### SessionStart

**Input:** `source` (startup/resume/clear/compact), `model` (e.g. `"claude-sonnet-4-6"`), optional `agent_type`.
**Output:** Plain text stdout or JSON `additionalContext` added as context. `$CLAUDE_ENV_FILE` available for persisting env vars.

### InstructionsLoaded

**Input:** `file_path`, `memory_type` (User/Project/Local/Managed), `load_reason` (session_start/nested_traversal/path_glob_match/include/compact), optional `globs`, `trigger_file_path`, `parent_file_path`.
**Output:** None. Audit/observability only. Exit code ignored.

### UserPromptSubmit

**Input:** `prompt` (the submitted text).
**Output:** `decision: "block"` + `reason` (shown to user, erases prompt). `additionalContext` added to context. Plain text stdout also added as context. JSON `hookSpecificOutput.sessionTitle` sets the session title (equivalent to /rename); may be combined with `decision: "block"` or allow/skip results.

### PreToolUse

**Input:** `tool_name`, `tool_input` (see [io-contract.md](./io-contract.md) for per-tool schemas), `tool_use_id`.
**Output via `hookSpecificOutput`:**
- `permissionDecision`: `"allow"` (bypass), `"deny"` (block), `"ask"` (prompt user)
- `permissionDecisionReason`: for allow/ask → shown to user; for deny → shown to Claude
- `updatedInput`: modified tool input before execution
- `additionalContext`: added to Claude's context

Deprecated: top-level `decision`/`reason`. Legacy `"approve"` → `"allow"`, `"block"` → `"deny"`.

### PermissionRequest

**Input:** `tool_name`, `tool_input` (no `tool_use_id`), optional `permission_suggestions` (array of `PermissionUpdateEntry` objects representing the "always allow" options the user would see).
**Does NOT fire in non-interactive mode (`-p`).**
**Output via `hookSpecificOutput.decision`:**
- `behavior`: `"allow"` or `"deny"`
- `updatedInput`: for allow — modified tool input
- `updatedPermissions`: array of `PermissionUpdateEntry` (discriminated by `type`: `addRules` / `replaceRules` / `removeRules` each carry `rules: PermissionRule[]` and `behavior: "allow" | "deny" | "ask"`; `setMode` carries `mode: PermissionMode`; `addDirectories` / `removeDirectories` carry `directories: string[]`. Every entry has `destination: "session" | "localSettings" | "projectSettings" | "userSettings"`). A hook may echo a `permission_suggestions` entry into `updatedPermissions` verbatim (the "always allow" pattern).
- `message`: for deny — tells Claude why
- `interrupt`: for deny — if `true`, stops Claude entirely

### PostToolUse

**Input:** `tool_name`, `tool_input`, `tool_response` (schema varies by tool, not officially documented), `tool_use_id`.
**Output:** `decision: "block"` + `reason` (post-hoc feedback to Claude — the action has already run, cannot be undone). Also: `additionalContext` (injected for Claude), `updatedMCPToolOutput` (MCP tools only — replaces output). Hook authors may return `{result: "block", reason: "..."}` to surface a block decision; `onError: block` cascade also produces the same shape.

### PostToolUseFailure

**Input:** `tool_name`, `tool_input`, `tool_use_id`, `error` (string), `is_interrupt` (optional boolean).
**Output:** `additionalContext` only.

### Notification

**Input:** `message`, optional `title`, optional `notification_type` (one of `permission_prompt`, `idle_prompt`, `auth_success`, `elicitation_dialog`; absent in the payload when upstream runs the hook for all notification types).
**Output:** `additionalContext`. Cannot block.

### SubagentStart

**Input:** `agent_id`, `agent_type`.
**Output:** `additionalContext` (injected into the spawned subagent's context — NOT the parent agent's). Cannot block.

### SubagentStop

**Input:** `stop_hook_active`, `agent_id`, `agent_type`, `agent_transcript_path`, `last_assistant_message`.
**Output:** `decision: "block"` + `reason` (same as Stop).

### Stop

**Does NOT fire on user interrupts.**
**Input:** `stop_hook_active` (check this to prevent infinite loops), `last_assistant_message`.
**Output:** `decision: "block"` + `reason` (required — tells Claude why to continue).

### StopFailure

**Fires INSTEAD OF `Stop` when the turn ends due to an upstream API error** (rate limit, authentication failure, billing problem, server error, `max_output_tokens`, etc.).

**Input:** `error` (one of `rate_limit`, `authentication_failed`, `billing_error`, `invalid_request`, `server_error`, `max_output_tokens`, `unknown`), optional `error_details`, optional `last_assistant_message`. **Semantic trap:** unlike `Stop` and `SubagentStop` where `last_assistant_message` carries Claude's final conversational text, for `StopFailure` it carries the rendered API error string (e.g., `"API Error: Rate limit reached"`). A handler copy-pasted from a `Stop` handler that parses this field as natural language will behave wrong.

**Output:** **None.** Output and exit code are ignored upstream. Hooks run purely for side effects: log to a file, ping PagerDuty / Slack / Datadog, increment a Prometheus counter, kick off an automated key-rotation flow on `authentication_failed`, etc.

**Filtering:** Upstream Claude Code exposes a matcher on the `error` field in `settings.json`, but **Clooks does not yet have a config-side matcher primitive** — tracked in FEAT-0055 (file-glob / literal-filename matcher). Until that lands, filter inside the handler: `if (ctx.error !== 'rate_limit') return ctx.skip()`. This is a known parity gap relative to raw `settings.json`, not an intentional design choice.

**`onError: "block"` is silently coerced to "do not block" + a stderr warning.** The turn has already failed at the API layer; there is nothing left to block. If a `StopFailure` hook crashes and its resolved `onError` is `"block"`, the engine continues normally and writes a one-line warning to stderr (visible in Claude Code's debug log):

    clooks: hook "<name>" onError: "block" cannot apply to StopFailure (notify-only event — output and exit code ignored upstream). Skipping; failure counted toward maxFailures.

The failure still counts toward `maxFailures` so a chronically broken hook gets quarantined. To avoid the warning, set `onError` to anything other than `"block"` somewhere in the cascade — per-event, hook-level, or global. See the `NOTIFY_ONLY_EVENTS` exception below.

### TeammateIdle

**Input:** `teammate_name`, `team_name`.
**Output:** Exit 2 → teammate continues with stderr as feedback. JSON `{"continue": false, "stopReason": "..."}` → stops teammate entirely. Under `onError: "block"`, a hook crash now emits exit-2 + stderr (retry signal — same as a hook returning `continue`), aligned with upstream's documented re-run path. The stop-teammate path is only reachable via an explicit `{result: "stop"}` return.

### TaskCreated

**Input:** `task_id`, `task_subject`, optional `task_description`, optional `teammate_name`, optional `team_name`.
**Output:** Exit 2 → task not created, stderr fed back to model. JSON `{"continue": false, "stopReason": "..."}` → stops teammate. Under `onError: "block"`, a hook crash now emits exit-2 + stderr (retry signal — same as a hook returning `continue`), aligned with upstream's documented re-run path. The stop-teammate path is only reachable via an explicit `{result: "stop"}` return.

### TaskCompleted

**Input:** `task_id`, `task_subject`, optional `task_description`, optional `teammate_name`, optional `team_name`.
**Output:** Exit 2 → task not completed, stderr fed back to model. JSON `{"continue": false, "stopReason": "..."}` → stops teammate. Under `onError: "block"`, a hook crash now emits exit-2 + stderr (retry signal — same as a hook returning `continue`), aligned with upstream's documented re-run path. The stop-teammate path is only reachable via an explicit `{result: "stop"}` return.

### ConfigChange

**Input:** `source`, optional `file_path`.
**Output:** `decision: "block"` + `reason`. **`policy_settings` cannot be blocked** — hooks fire for audit but blocking is ignored upstream. Clooks downgrades a `{result: "block"}` on `policy_settings` to `skip` and emits a `systemMessage` warning so authors aren't confused. Other sources (`user_settings`, `project_settings`, `local_settings`, `skills`) honor block normally.

### WorktreeCreate

**Replaces default git worktree behavior.**
**Input:** `name` (slug identifier for the worktree).
**Output:** Must print absolute path to created worktree on stdout (plain string, not JSON). Any non-zero exit fails creation.

### WorktreeRemove

**Input:** `worktree_path` (absolute path being removed).
**Output:** None. Cleanup only. Failures logged in debug mode only. Clooks divergence: under `onError: "block"`, failures surface via `systemMessage` to the agent (more visible than upstream's debug-only logging). This is intentional per Clooks' fail-closed philosophy.

### PreCompact

**Input:** `trigger` (manual/auto), `custom_instructions` (user input to `/compact`, empty string for auto).
**Output:** `decision: "block"` + `reason` (blocks compaction). Exit 2 with stderr also blocks; for manual `/compact` stderr is shown to the user. PreCompact has no `additionalContext` channel.

### PostCompact

**Input:** `trigger` (manual/auto), `compact_summary` (conversation summary generated by compact).
**Output:** No decision control. Pure observer.

### SessionEnd

**Input:** `reason` (clear/resume/logout/prompt_input_exit/bypass_permissions_disabled/other).
**Output:** None. Cleanup/logging only.

## NOTIFY_ONLY events — exception to the fail-closed rule

Clooks' core principle is **fail-closed**: a crashed hook blocks the action that triggered it, so authors discover bugs in their hooks before those bugs silently degrade safety. `StopFailure` is the documented exception. Output and exit code are ignored upstream because the turn has **already** failed at the API layer; there is nothing left to block. Clooks honors that contract by:

- Always returning `EXIT_OK` from the engine for any `StopFailure` hook result (including author-returned `block`).
- **Soft-coercing `onError: "block"`** at the hook-crash site: the engine writes a one-line warning to stderr and continues normally instead of attempting to block. Visible in Claude Code's debug log.
- Continuing to apply the **circuit breaker** (`maxFailures`) — a repeatedly crashing alerting hook is an operational concern (rate-limited / spammed external endpoints), so quarantining stays uniform across event categories.

Future events upstream may join this category; membership is keyed on the `NOTIFY_ONLY_EVENTS` set declared in `src/config/constants.ts` (alongside `INJECTABLE_EVENTS`) and registered in `src/engine/events.ts` via `assertCategoryCompleteness()`.

## Related

- [overview.md](./overview.md) — Configuration, handler types, locations
- [io-contract.md](./io-contract.md) — Exit codes, JSON output, decision patterns, tool_input schemas
- [behavior-and-gotchas.md](./behavior-and-gotchas.md) — Execution model, async, known issues
