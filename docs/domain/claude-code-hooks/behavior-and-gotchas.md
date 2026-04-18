# Claude Code Hooks — Behavior & Gotchas

Execution model, async hooks, session snapshot, debugging, and all known pitfalls.

**Source:** Official Anthropic docs at `code.claude.com/docs/en/hooks`, verified 2026-03-08.

## Execution Model

- **All matching hooks run in parallel.** No sequential execution option. Sequential was explicitly closed as NOT_PLANNED.
- **Identical handlers are deduplicated.** Command hooks by command string. HTTP hooks by URL.
- **Default timeout:** 600 seconds (10 minutes) for command hooks. Configurable per hook.
- **Hook type support varies:** Only 9 of 20 events support all four types. The rest are command-only. See [events.md](./events.md) for the full table.

**Clooks implication:** Sequential execution with defined merge semantics is a key differentiator.

## Session Snapshot

Hooks are captured at session startup and used throughout. This prevents modifications from taking effect mid-session.

- Hooks added through `/hooks` menu take effect immediately
- Manual file edits require restart or `/hooks` review
- External modifications trigger a warning requiring review

**Clooks implication:** Since Clooks registers a single bash entrypoint that reads `clooks.yml` at runtime, adding/removing Clooks hooks takes effect without restarting Claude Code.

## Async Hooks

Set `"async": true` on a command hook to run in background:

- Only `type: "command"` supports async
- Claude continues immediately — cannot block or return decisions
- `decision`, `permissionDecision`, `continue` fields have no effect
- Output (`systemMessage` or `additionalContext`) delivered on next conversation turn
- If session is idle, waits until next user interaction
- Same default timeout as sync hooks (600s)
- No deduplication across multiple firings of same async hook

## `/hooks` Interactive Manager

- Shows hooks with source labels: `[User]`, `[Project]`, `[Local]`, `[Plugin]`
- Only supports adding **command** hooks
- HTTP, prompt, and agent hooks require manual JSON editing
- Cannot control execution order

## Debugging

Run `claude --debug` for detailed hook execution logs:

```
[DEBUG] Executing hooks for PostToolUse:Write
[DEBUG] Found 1 hook matchers in settings
[DEBUG] Matched 1 hooks for query "Write"
[DEBUG] Executing hook command: <command> with timeout 600000ms
[DEBUG] Hook command completed with status 0: <stdout>
```

Toggle verbose mode with `Ctrl+O` to see hook output in transcript.

## Gotchas

### Exit Code Semantics

**Exit 1 does NOT block.** Only exit 2 blocks. This is the most common mistake and the most dangerous for security hooks. A crashing hook silently allows the action to proceed.

**Stderr is hidden by default.** Non-blocking errors (exit != 0, exit != 2) only show in verbose mode (`Ctrl+O`). Users won't know their hook is failing.

### Parallel Execution Race Condition

When multiple PreToolUse hooks match the same event, `updatedInput` from one hook is silently ignored — the original input runs instead. No fix planned since parallel is the only model.

**Clooks implication:** Clooks solves this with configurable sequential execution and merge semantics.

### Stop Hook Infinite Loop

If a Stop hook always blocks, Claude runs indefinitely. Always check `stop_hook_active`:

```bash
INPUT=$(cat)
if [ "$(echo "$INPUT" | jq -r '.stop_hook_active')" = "true" ]; then
  exit 0  # Allow Claude to stop
fi
```

### PermissionRequest in Non-Interactive Mode

PermissionRequest hooks do **not** fire in headless mode (`-p`). Use PreToolUse for automated permission decisions.

### JSON Parsing from Shell Profiles

Shell profiles that unconditionally `echo` text corrupt hook JSON output. Guard with:

```bash
if [[ $- == *i* ]]; then
  echo "Shell ready"
fi
```

### PostToolUse Cannot Prevent Execution

PostToolUse hooks fire after a tool completes — they cannot prevent the tool from running. They can:
- Return `{result: "block", reason: "..."}` to surface post-hoc feedback to Claude (shown as `decision: "block"` with a reason). Claude sees the block after the fact and decides how to respond.
- Return `{result: "skip", injectContext: "..."}` to add context without a block signal.
- For MCP tools only: return `updatedMCPToolOutput` to replace the tool's output before the model processes it.

### ConfigChange and Policy Settings

`policy_settings` changes **cannot be blocked**. ConfigChange hooks fire for audit purposes but blocking decisions are ignored for enterprise policy.

### No Individual Hook Disable

It's all-or-nothing via `disableAllHooks`. You can't toggle individual hooks on/off.

### Working Directory Not Guaranteed

Hook commands run in the "current directory" which is not guaranteed to be the project root for all events. Stop/SessionEnd hooks in particular may run from a different cwd. Use `$CLAUDE_PROJECT_DIR` (set by Claude Code for all hook commands) when referencing project-relative paths in `settings.json`.

### Full User Privileges

Hooks run with the user's full system permissions. No sandboxing. A malicious hook has the same access as the user.

### tool_response Not Documented

The `tool_response` field in PostToolUse varies by tool but Anthropic does not publish per-tool schemas. See the research doc for community-sourced schemas.

## Related

- [overview.md](./overview.md) — Configuration, handler types, locations
- [events.md](./events.md) — All 20 events with input/output
- [io-contract.md](./io-contract.md) — Exit codes, JSON output, decision patterns, tool_input schemas
- [claude-code-hooks-api-deep-dive.md](../../research/claude-code-hooks-api-deep-dive.md) — Exhaustive research with unverified community details
