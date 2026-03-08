# Claude Code Hooks — Events

All 18 lifecycle events: when they fire, what they match on, what input they receive, and how to control their behavior.

**Source:** Official Anthropic docs at `code.claude.com/docs/en/hooks`, verified 2026-03-08.

## Event Summary

| Event | Can block? | Hook types | Matcher filters |
|-------|-----------|------------|-----------------|
| `SessionStart` | No | Command only | how started: `startup`, `resume`, `clear`, `compact` |
| `InstructionsLoaded` | No | Command only | not supported |
| `UserPromptSubmit` | Yes | All four | not supported |
| `PreToolUse` | Yes | All four | tool name: `Bash`, `Edit\|Write`, `mcp__.*` |
| `PermissionRequest` | Yes | All four | tool name (same as PreToolUse) |
| `PostToolUse` | No | All four | tool name |
| `PostToolUseFailure` | No | All four | tool name |
| `Notification` | No | Command only | type: `permission_prompt`, `idle_prompt`, `auth_success`, `elicitation_dialog` |
| `SubagentStart` | No | Command only | agent type: `Bash`, `Explore`, `Plan`, custom names |
| `SubagentStop` | Yes | All four | agent type |
| `Stop` | Yes | All four | not supported |
| `TeammateIdle` | Yes | Command only | not supported |
| `TaskCompleted` | Yes | All four | not supported |
| `ConfigChange` | Yes | Command only | source: `user_settings`, `project_settings`, `local_settings`, `policy_settings`, `skills` |
| `WorktreeCreate` | Yes | Command only | not supported |
| `WorktreeRemove` | No | Command only | not supported |
| `PreCompact` | No | Command only | trigger: `manual`, `auto` |
| `SessionEnd` | No | Command only | reason: `clear`, `logout`, `prompt_input_exit`, `bypass_permissions_disabled`, `other` |

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

**Input:** `file_path`, `memory_type` (User/Project/Local/Managed), `load_reason` (session_start/nested_traversal/path_glob_match/include), optional `globs`, `trigger_file_path`, `parent_file_path`.
**Output:** None. Audit/observability only. Exit code ignored.

### UserPromptSubmit

**Input:** `prompt` (the submitted text).
**Output:** `decision: "block"` + `reason` (shown to user, erases prompt). `additionalContext` added to context. Plain text stdout also added as context.

### PreToolUse

**Input:** `tool_name`, `tool_input` (see [io-contract.md](./io-contract.md) for per-tool schemas), `tool_use_id`.
**Output via `hookSpecificOutput`:**
- `permissionDecision`: `"allow"` (bypass), `"deny"` (block), `"ask"` (prompt user)
- `permissionDecisionReason`: for allow/ask → shown to user; for deny → shown to Claude
- `updatedInput`: modified tool input before execution
- `additionalContext`: added to Claude's context

Deprecated: top-level `decision`/`reason`. Legacy `"approve"` → `"allow"`, `"block"` → `"deny"`.

### PermissionRequest

**Input:** `tool_name`, `tool_input` (no `tool_use_id`), `permission_suggestions` (array of "always allow" options).
**Does NOT fire in non-interactive mode (`-p`).**
**Output via `hookSpecificOutput.decision`:**
- `behavior`: `"allow"` or `"deny"`
- `updatedInput`: for allow — modified tool input
- `updatedPermissions`: for allow — applies permission rules (equivalent to "always allow")
- `message`: for deny — tells Claude why
- `interrupt`: for deny — if `true`, stops Claude entirely

### PostToolUse

**Input:** `tool_name`, `tool_input`, `tool_response` (schema varies by tool, not officially documented), `tool_use_id`.
**Output:** `decision: "block"` + `reason` (shown to Claude). `additionalContext`. `updatedMCPToolOutput` (MCP tools only — replaces output).

### PostToolUseFailure

**Input:** `tool_name`, `tool_input`, `tool_use_id`, `error` (string), `is_interrupt` (boolean).
**Output:** `additionalContext` only.

### Notification

**Input:** `message`, optional `title`, `notification_type`.
**Output:** `additionalContext`. Cannot block.

### SubagentStart

**Input:** `agent_id`, `agent_type`.
**Output:** `additionalContext` (injected into subagent's context). Cannot block.

### SubagentStop

**Input:** `stop_hook_active`, `agent_id`, `agent_type`, `agent_transcript_path`, `last_assistant_message`.
**Output:** `decision: "block"` + `reason` (same as Stop).

### Stop

**Does NOT fire on user interrupts.**
**Input:** `stop_hook_active` (check this to prevent infinite loops), `last_assistant_message`.
**Output:** `decision: "block"` + `reason` (required — tells Claude why to continue).

### TeammateIdle

**Input:** `teammate_name`, `team_name`.
**Output:** Exit 2 → teammate continues with stderr as feedback. JSON `{"continue": false, "stopReason": "..."}` → stops teammate entirely.

### TaskCompleted

**Input:** `task_id`, `task_subject`, optional `task_description`, `teammate_name`, `team_name`.
**Output:** Exit 2 → task not completed, stderr fed back to model. JSON `{"continue": false, "stopReason": "..."}` → stops teammate.

### ConfigChange

**Input:** `source`, optional `file_path`.
**Output:** `decision: "block"` + `reason`. **`policy_settings` cannot be blocked** — hooks fire for audit but blocking is ignored.

### WorktreeCreate

**Replaces default git worktree behavior.**
**Input:** `name` (slug identifier for the worktree).
**Output:** Must print absolute path to created worktree on stdout (plain string, not JSON). Any non-zero exit fails creation.

### WorktreeRemove

**Input:** `worktree_path` (absolute path being removed).
**Output:** None. Cleanup only. Failures logged in debug mode only.

### PreCompact

**Input:** `trigger` (manual/auto), `custom_instructions` (user input to `/compact`, empty for auto).
**Output:** No decision control.

### SessionEnd

**Input:** `reason` (clear/logout/prompt_input_exit/bypass_permissions_disabled/other).
**Output:** None. Cleanup/logging only.

## Related

- [overview.md](./overview.md) — Configuration, handler types, locations
- [io-contract.md](./io-contract.md) — Exit codes, JSON output, decision patterns, tool_input schemas
- [behavior-and-gotchas.md](./behavior-and-gotchas.md) — Execution model, async, known issues
