# Claude Code Hooks — Overview

How Claude Code's native hook system works: configuration, handler types, locations, and environment. This is the foundation Clooks builds on.

**Source:** Official Anthropic docs at `code.claude.com/docs/en/hooks`, verified 2026-03-08.

## Overview

Hooks are user-defined shell commands, HTTP endpoints, or LLM prompts that fire at specific lifecycle points in a Claude Code session. They can inspect context, modify tool inputs, block actions, or inject context. They are configured in JSON settings files or bundled in plugins/skills.

## Configuration Schema

Three nesting levels:

```json
{
  "hooks": {
    "<EventName>": [
      {
        "matcher": "<regex_pattern>",
        "hooks": [
          { "type": "command", "command": "script.sh", "timeout": 60 }
        ]
      }
    ]
  }
}
```

1. **Hook event** — lifecycle point (e.g., `PreToolUse`)
2. **Matcher group** — regex filter for when it fires (e.g., `"Bash"`, `"Edit|Write"`)
3. **Hook handler** — the command/http/prompt/agent that runs

The `matcher` field is a regex string. Use `"*"`, `""`, or omit to match all. Events without matcher support silently ignore it.

## Hook Handler Types

### Common Fields (All Types)

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `type` | yes | string | `"command"`, `"http"`, `"prompt"`, or `"agent"` |
| `timeout` | no | number | Seconds. Defaults: command=600, prompt=30, agent=60 |
| `statusMessage` | no | string | Custom spinner message while running |
| `once` | no | boolean | Run once per session then removed. Skills only |

### Command (`type: "command"`)

| Field | Required | Description |
|-------|----------|-------------|
| `command` | yes | Shell command to execute. Receives JSON on stdin |
| `async` | no | If `true`, runs in background without blocking |

### HTTP (`type: "http"`)

| Field | Required | Description |
|-------|----------|-------------|
| `url` | yes | URL to POST to. Receives JSON as request body |
| `headers` | no | Key-value pairs. Values support `$VAR_NAME` interpolation |
| `allowedEnvVars` | no | Env var names allowed in header interpolation. Unlisted vars → empty |

Non-2xx, connection failures, and timeouts are non-blocking. To block, return 2xx with JSON decision fields.

### Prompt (`type: "prompt"`)

| Field | Required | Description |
|-------|----------|-------------|
| `prompt` | yes | Prompt text. `$ARGUMENTS` = placeholder for hook input JSON |
| `model` | no | Model for evaluation. Defaults to a fast model |

Returns `{ "ok": true }` or `{ "ok": false, "reason": "..." }`.

### Agent (`type: "agent"`)

Same fields as prompt. Spawns subagent with Read/Grep/Glob/Bash access, up to 50 turns. Default timeout: 60s. Same response schema as prompt hooks.

## Hook Locations

| Location | Scope | Shareable |
|----------|-------|-----------|
| `~/.claude/settings.json` | All your projects | No |
| `.claude/settings.json` | Single project | Yes, committable |
| `.claude/settings.local.json` | Single project | No, gitignored |
| Managed policy settings | Organization-wide | Yes, admin-controlled |
| Plugin `hooks/hooks.json` | When plugin enabled | Yes, bundled |
| Skill/agent frontmatter | While component active | Yes, in component file |

Plugin format wraps with optional `"description"` field. Skill/agent frontmatter uses YAML. For subagents, `Stop` hooks auto-convert to `SubagentStop`.

Enterprise: `allowManagedHooksOnly` blocks user/project/plugin hooks.

## Environment Variables

| Variable | Scope | Description |
|----------|-------|-------------|
| `$CLAUDE_PROJECT_DIR` | All hooks | Project root absolute path |
| `${CLAUDE_PLUGIN_ROOT}` | Plugin hooks | Plugin's root directory |
| `$CLAUDE_ENV_FILE` | SessionStart only | Write `export` statements to persist env vars for session |
| `$CLAUDE_CODE_REMOTE` | All hooks | `"true"` in remote web environments, unset locally |

## Disabling Hooks

- `"disableAllHooks": true` or toggle in `/hooks` menu
- No individual hook disable — all-or-nothing
- Respects managed settings hierarchy: non-managed cannot disable managed hooks

## Related

- [events.md](./events.md) — All 18 lifecycle events with input/output schemas
- [io-contract.md](./io-contract.md) — Exit codes, JSON output, decision control, tool_input schemas
- [behavior-and-gotchas.md](./behavior-and-gotchas.md) — Execution model, async, session snapshot, known issues
- [cross-agent-hooks.md](../cross-agent-hooks.md) — How other agents' hook systems compare
