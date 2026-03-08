# Claude Code Hook System

Reference document for Claude Code's native hook system as of March 2026. This is the foundation Clooks builds on — understanding the native system's capabilities and limitations is essential for Clooks development.

## Overview

Claude Code hooks are shell commands (or HTTP/prompt/agent handlers) that fire on lifecycle events during a Claude Code session. They are configured in `.claude/settings.json` (user, project, or local scope) or bundled in plugins via `hooks/hooks.json`.

Hooks can inspect context, modify tool inputs, or block actions. They are the primary extensibility mechanism for Claude Code.

## Lifecycle Events (18)

| Event | Description | Can block? | All hook types? |
|-------|-------------|-----------|-----------------|
| `SessionStart` | Session begins or resumes | No | Command only |
| `InstructionsLoaded` | CLAUDE.md or rules file loaded into context | No | Command only |
| `UserPromptSubmit` | User submits a prompt, before processing | Yes | All four |
| `PreToolUse` | Before a tool call executes | Yes | All four |
| `PermissionRequest` | When a permission dialog appears | Yes | All four |
| `PostToolUse` | After a tool call succeeds | No | All four |
| `PostToolUseFailure` | After a tool call fails | No | All four |
| `Notification` | When Claude Code sends a notification | No | Command only |
| `SubagentStart` | When a subagent is spawned | No | Command only |
| `SubagentStop` | When a subagent finishes | Yes | All four |
| `Stop` | When Claude finishes responding | Yes | All four |
| `TeammateIdle` | When a teammate is about to go idle | Yes | Command only |
| `TaskCompleted` | When a task is marked completed | Yes | All four |
| `ConfigChange` | When a config file changes mid-session | Yes | Command only |
| `WorktreeCreate` | When a worktree is being created | Yes | Command only |
| `WorktreeRemove` | When a worktree is being removed | Yes | Command only |
| `PreCompact` | Before context compaction | No | Command only |
| `SessionEnd` | When a session terminates | No | Command only |

## Hook Types

### 1. Command (`type: "command"`)

Runs a shell command. Receives JSON on stdin. Exit codes control behavior.

```json
{
  "type": "command",
  "command": "/path/to/script.sh",
  "timeout": 30
}
```

### 2. HTTP (`type: "http"`)

POSTs JSON to a URL. Response body parsed as JSON output. Non-2xx is a non-blocking error (cannot block via status code alone — must return JSON with blocking decision fields).

```json
{
  "type": "http",
  "url": "https://example.com/hook",
  "timeout": 10
}
```

### 3. Prompt (`type: "prompt"`)

Single-turn LLM evaluation. Sends the event context to a model (Haiku by default). Returns `{ok: true/false}`. Default timeout: 30 seconds.

### 4. Agent (`type: "agent"`)

Spawns a multi-turn subagent with Read/Grep/Glob tool access (up to 50 turns). Returns `{ok: true/false}`. Default timeout: 60 seconds.

## I/O Contract (Command Hooks)

### Input (stdin)

JSON object. Common fields present on all events:

- `session_id` — Unique session identifier
- `transcript_path` — Path to the session JSONL transcript
- `cwd` — Current working directory
- `permission_mode` — Current permission mode
- `hook_event_name` — The event name (e.g., "PreToolUse")

Event-specific fields (examples):

- **PreToolUse / PostToolUse:** `tool_name`, `tool_input`
- **UserPromptSubmit:** `prompt`
- **SessionStart:** `source`

Subagent context (when applicable): `agent_id`, `agent_type`

### Output (exit codes)

| Exit Code | Meaning | Behavior |
|-----------|---------|----------|
| **0** | Success | Stdout parsed for JSON output fields |
| **2** | Blocking error | Stderr fed back to Claude. Action is blocked (for events that support blocking). |
| **Any other** | Non-blocking error | Stderr shown in verbose mode only. Action proceeds as if hook wasn't there. |

This is a critical design flaw for security use cases: a crashing hook (exit 1, segfault, killed process) does NOT block execution. This is the primary motivation for Clooks' fail-closed default.

### Output (stdout JSON on exit 0)

Universal fields (available on all events):

- `continue` (bool) — Whether Claude should continue
- `stopReason` (string) — Reason to stop
- `suppressOutput` (bool) — Suppress tool output from context
- `systemMessage` (string) — Injected as system message

Event-specific decision fields (examples):

- **PreToolUse:** `updatedInput` (modified tool input), `permissionDecision`
- **PermissionRequest:** `permissionDecision` ("allow" / "deny")
- **UserPromptSubmit:** `additionalContext` (added to prompt context)
- **SessionStart:** `additionalContext`

### Environment Variables

Available to command hooks:

- `$CLAUDE_PROJECT_DIR` — Project root directory
- `${CLAUDE_PLUGIN_ROOT}` — Plugin root (for plugin-bundled hooks)
- `$CLAUDE_ENV_FILE` — Path to env file (SessionStart only)
- `$CLAUDE_CODE_REMOTE` — Whether running in remote mode

## Key Behaviors

### Execution Model

- **All matching hooks run in parallel.** No sequential option. A feature request for sequential execution was closed as NOT_PLANNED (issue #21533).
- **Identical handlers are deduplicated.** Command hooks deduplicated by command string. HTTP hooks by URL.
- **Default timeout:** 600 seconds (10 minutes) for command hooks. Configurable per hook.

### `updatedInput` Bug

Open issue #15897: When multiple PreToolUse hooks match the same event and run in parallel, `updatedInput` from one hook is silently ignored. The original command runs instead. This is a fundamental limitation of the parallel execution model.

Since sequential execution is NOT_PLANNED, the only native workaround is ensuring only one hook matches a given tool call. Clooks solves this by offering configurable sequential execution with defined merge semantics.

### Session Snapshot

Hooks are captured at session startup and used throughout the session. This prevents malicious or accidental modifications from taking effect mid-session.

- Hooks added through the `/hooks` menu take effect immediately
- Manual file edits require restart or `/hooks` review before changes apply
- If hooks are modified externally, Claude Code warns and requires review

Clooks bypasses this limitation: since it registers a single bash entrypoint that reads `clooks.yml` at runtime, adding/removing Clooks hooks takes effect without restarting Claude Code.

### Async Hooks

Command hooks can set `"async": true` to run in the background:

- Only `type: "command"` supports async
- Cannot block or return decisions
- Output delivered on next conversation turn via `systemMessage` or `additionalContext`
- Same default timeout as sync hooks

### `/hooks` Interactive Manager

Accessed via `/hooks` in Claude Code. Shows hooks with source labels (`[User]`, `[Project]`, `[Local]`, `[Plugin]`).

**Limitations:**
- Only supports adding **command** hooks
- HTTP, prompt, and agent hooks must be configured by editing JSON directly
- Cannot control execution order

### Settings Scopes

| Scope | File | Visibility |
|-------|------|-----------|
| User | `~/.claude/settings.json` | You, all projects |
| Project | `.claude/settings.json` | Everyone who clones repo |
| Local | `.claude/settings.local.json` | You, this repo only |
| Managed | Managed policy settings | Organization-wide, read-only |

## Gotchas

- **Exit code 1 does NOT block.** Only exit code 2 blocks. This is the most common mistake and the most dangerous one for security hooks.
- **Stderr is hidden by default.** Non-blocking errors (exit != 0, exit != 2) only show stderr in verbose mode (`Ctrl+O`). Users won't know their hook is failing.
- **No hook-level enable/disable.** It's all-or-nothing via `disableAllHooks`. You can't toggle individual hooks.
- **Hooks run with full user privileges.** No sandboxing. A malicious hook has the same access as the user.
- **Session snapshot means no hot-reload.** Editing hooks in settings files doesn't take effect until next session or `/hooks` review.
- **Binary size of plugin hooks is limited by caching.** Plugin hooks are copied to `~/.claude/plugins/cache/`. They cannot reference files outside the plugin directory.

## Related

- [PRODUCT_EXPLORATION.md](../../PRODUCT_EXPLORATION.md) — Clooks product design, which builds on this system
- [cross-agent-hooks.md](./cross-agent-hooks.md) — How other agents' hook systems compare
