# Claude Code Hooks — I/O Contract

Exit codes, JSON output format, decision control patterns, and tool_input schemas for all built-in tools.

**Source:** Official Anthropic docs at `code.claude.com/docs/en/hooks`, verified 2026-03-08.

## Exit Codes

| Exit Code | Meaning | Behavior |
|-----------|---------|----------|
| **0** | Success | Stdout parsed for JSON. JSON only processed on exit 0 |
| **2** | Blocking error | Stdout ignored. Stderr fed to Claude/user. Action blocked (for blocking-capable events) |
| **Any other** | Non-blocking error | Stderr shown in verbose mode only. Action proceeds normally |

**Critical for Clooks:** A crashing hook (exit 1, segfault, OOM kill) does NOT block. Only exit 2 blocks. This is the fundamental motivation for fail-closed.

### Clooks Exit Code Strategy

Clooks is a JSON-producing intermediary — it aggregates results from multiple hooks into structured JSON output. **Because Claude Code only processes JSON on exit 0, clooks must use exit 0 for all normal operation, including blocking decisions.** Exit 2 discards all JSON, so using it for routine blocking would throw away aggregated hook results, decision fields, and diagnostic information.

| Scenario | Exit | Output |
|----------|------|--------|
| Hooks succeed | 0 | JSON with decisions/output |
| Hook errors, blocking configured | 0 | JSON with event-appropriate blocking decision (`decision: "block"`, `permissionDecision: "deny"`, etc.) |
| Hook errors, continue configured | 0 | JSON from remaining hooks, error silently logged |
| Catastrophic engine failure (signal, OOM, uncaught exception in engine itself) | 2 | Stderr only — last-resort fail-closed when JSON cannot be produced |

**Exit 2 is the fallback of last resort**, not the normal blocking path. Only global process handlers (`SIGTERM`, `uncaughtException`, `unhandledRejection`) should use it — situations where the engine cannot trust itself to produce valid JSON.

### Exit 2 Per-Event

| Event | Exit 2 effect |
|-------|---------------|
| `PreToolUse` | Blocks tool call |
| `PermissionRequest` | Denies permission |
| `PermissionDenied` | **Blocking errors are ignored.** Retry hint delivered via JSON on exit 0, not via exit 2 |
| `UserPromptSubmit` | Blocks and erases prompt |
| `Stop` / `SubagentStop` | Prevents stopping, continues |
| `TeammateIdle` | Teammate continues with stderr feedback |
| `TaskCompleted` | Task not completed, stderr fed back |
| `ConfigChange` | Blocks change (except `policy_settings`) |
| `WorktreeCreate` | Any non-zero exit fails creation |
| `PostToolUse` / `PostToolUseFailure` | Shows stderr to Claude |
| `Notification` / `SubagentStart` / `SessionStart` / `SessionEnd` | **Blocking errors are ignored.** Stderr shown to user only |
| `WorktreeRemove` | Logged in debug mode only |
| `InstructionsLoaded` | Exit code ignored |
| `StopFailure` | Exit code and stdout both ignored (notify-only — see events.md § NOTIFY_ONLY events) |

## JSON Output (stdout on exit 0)

Must choose one approach per hook: exit codes alone, OR exit 0 with JSON. Claude Code only processes JSON on exit 0.

### Universal Fields

| Field | Default | Description |
|-------|---------|-------------|
| `continue` | `true` | If `false`, Claude stops entirely. Takes precedence over event-specific decisions |
| `stopReason` | — | Message shown to user when `continue: false`. Not shown to Claude |
| `suppressOutput` | `false` | Hides stdout from verbose mode |
| `systemMessage` | — | Warning message shown to user |

### Decision Control Patterns

Clooks hook handlers use the `ctx.<verb>(...)` decision-method idiom. The table
below lists the legal verbs per event; the runtime translates these to the
upstream wire shapes (`hookSpecificOutput.permissionDecision`, top-level
`decision`, exit codes, etc.) inside `src/engine/translate.ts`. See
[events.md](./events.md) for per-event opts-bag fields.

| Event(s) | Decision methods on `ctx` |
|----------|---------------------------|
| `PreToolUse` | `ctx.allow({ updatedInput?, reason?, injectContext?, debugMessage? })`, `ctx.ask({ reason, updatedInput?, injectContext?, debugMessage? })`, `ctx.block({ reason, injectContext?, debugMessage? })`, `ctx.defer({ debugMessage? })` (`-p` + single-tool-call only), `ctx.skip({ injectContext?, debugMessage? })`. Multi-hook reduction: all hooks run to completion (no short-circuit on deny) — results are reduced via `deny > defer > ask > allow` precedence. Crashed hooks under `onError: "block"` still short-circuit. **Clooks divergence:** `updatedInput` is a partial patch (`Patch<ToolInput>`); the engine merges onto the pipeline's running `toolInput` and strips `null`-valued keys post-merge. The wire payload upstream is always the full merged object. |
| `PermissionRequest` | `ctx.allow({ updatedInput?, updatedPermissions?, debugMessage? })`, `ctx.block({ reason, interrupt?, debugMessage? })`, `ctx.skip({ debugMessage? })`. **Clooks divergence:** same partial-patch semantics for `updatedInput` — engine merges, strips `null`, and emits full replacement on the wire. `updatedPermissions` is `PermissionUpdateEntry[]` (six variants per `src/types/permissions.ts`). |
| `UserPromptSubmit` | `ctx.allow({ sessionTitle?, injectContext?, debugMessage? })`, `ctx.block({ reason, sessionTitle?, injectContext?, debugMessage? })`, `ctx.skip({ sessionTitle?, injectContext?, debugMessage? })`. `sessionTitle` is equivalent to running `/rename`; available on every arm per upstream's `hookSpecificOutput` shape. |
| `Stop`, `SubagentStop` | `ctx.allow({ debugMessage? })`, `ctx.block({ reason, debugMessage? })` (`reason` tells Claude *why to continue* — prevents the stop), `ctx.skip({ debugMessage? })`. The `stop` verb does NOT exist here — it belongs to continuation events. |
| `ConfigChange`, `PreCompact` | `ctx.allow({ debugMessage? })`, `ctx.block({ reason, debugMessage? })`, `ctx.skip({ debugMessage? })`. ConfigChange caveat: `policy_settings` blocks are downgraded to `skip` upstream — Clooks emits a `systemMessage` warning. |
| `PostToolUse` | `ctx.block({ reason, injectContext?, updatedMCPToolOutput?, debugMessage? })` (post-hoc feedback — the action already ran, cannot be undone), `ctx.skip({ injectContext?, updatedMCPToolOutput?, debugMessage? })`. `updatedMCPToolOutput` is MCP-only; built-in tools silently ignore it. |
| `PermissionDenied` | `ctx.retry({ debugMessage? })` (adds a retry hint — does NOT reverse the denial), `ctx.skip({ debugMessage? })`. Auto-mode only. |
| `WorktreeCreate` | `ctx.success({ path, debugMessage? })`, `ctx.failure({ reason, debugMessage? })`. `path` must be the absolute path to the created worktree. |
| `TeammateIdle`, `TaskCreated`, `TaskCompleted` | `ctx.continue({ feedback, debugMessage? })`, `ctx.stop({ reason, debugMessage? })`, `ctx.skip({ debugMessage? })`. Same `continue` verb, three semantics: TeammateIdle → "keep working past idle"; TaskCreated → "don't create the task; feed feedback to model"; TaskCompleted → "don't mark complete; feed feedback to model". |
| `SessionStart`, `SubagentStart`, `Notification`, `PostToolUseFailure` | `ctx.skip({ injectContext?, debugMessage? })`. Observe-only with context injection. |
| `SessionEnd`, `InstructionsLoaded`, `PostCompact`, `WorktreeRemove` | `ctx.skip({ debugMessage? })`. Observe-only without `additionalContext` upstream. |
| `StopFailure` | `ctx.skip({ debugMessage? })`. Notify-only — output is dropped upstream by Claude Code; the method exists for API uniformity. Side-effects (logging, alerts) inside the handler still run. |

### HTTP Response Handling

- **2xx empty body**: success, no output
- **2xx plain text**: success, text added as context
- **2xx JSON body**: parsed using same JSON output schema
- **Non-2xx / connection failure / timeout**: non-blocking error, proceeds

Cannot block via HTTP status codes alone — must return 2xx with JSON decision fields.

## tool_input Schemas

These are the `tool_input` fields received in PreToolUse/PostToolUse/PermissionRequest for each built-in tool.

### Bash

| Field | Type | Description |
|-------|------|-------------|
| `command` | string | Shell command |
| `description` | string | Optional description |
| `timeout` | number | Optional timeout (ms) |
| `run_in_background` | boolean | Background execution |

### Write

| Field | Type | Description |
|-------|------|-------------|
| `file_path` | string | Absolute path |
| `content` | string | Content to write |

### Edit

| Field | Type | Description |
|-------|------|-------------|
| `file_path` | string | Absolute path |
| `old_string` | string | Text to find |
| `new_string` | string | Replacement |
| `replace_all` | boolean | Replace all occurrences |

### Read

| Field | Type | Description |
|-------|------|-------------|
| `file_path` | string | Absolute path |
| `offset` | number | Optional start line |
| `limit` | number | Optional line count |

### Glob

| Field | Type | Description |
|-------|------|-------------|
| `pattern` | string | Glob pattern |
| `path` | string | Optional search directory |

### Grep

| Field | Type | Description |
|-------|------|-------------|
| `pattern` | string | Regex pattern |
| `path` | string | Optional search path |
| `glob` | string | Optional file filter |
| `output_mode` | string | `"content"`, `"files_with_matches"`, or `"count"` |
| `-i` | boolean | Case insensitive |
| `multiline` | boolean | Multiline matching |

### WebFetch

| Field | Type | Description |
|-------|------|-------------|
| `url` | string | URL to fetch |
| `prompt` | string | Processing prompt |

### WebSearch

| Field | Type | Description |
|-------|------|-------------|
| `query` | string | Search query |
| `allowed_domains` | string[] | Optional include list |
| `blocked_domains` | string[] | Optional exclude list |

### Agent

| Field | Type | Description |
|-------|------|-------------|
| `prompt` | string | Task prompt |
| `description` | string | Short description |
| `subagent_type` | string | Agent type |
| `model` | string | Optional model override |

### MCP Tools

MCP tools follow naming pattern `mcp__<server>__<tool>`. Their `tool_input` schemas are defined by the MCP server, not by Claude Code.

### tool_response (PostToolUse)

The `tool_response` field in PostToolUse contains the tool's return value. **Per-tool response schemas are not officially documented.** See [claude-code-hooks-api-deep-dive.md](../../research/claude-code-hooks-api-deep-dive.md) for community-sourced schemas (unverified).

## Related

- [overview.md](./overview.md) — Configuration, handler types, locations
- [events.md](./events.md) — All 22 events with input/output
- [behavior-and-gotchas.md](./behavior-and-gotchas.md) — Execution model, async, known issues
