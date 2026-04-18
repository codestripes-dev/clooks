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

PermissionRequest hooks do **not** fire in headless mode (`-p`). A hook registered for PermissionRequest has **zero invocations** across an entire `claude -p` session. Use PreToolUse for automated permission decisions.

### SubagentStart additionalContext Audience

`SubagentStart` hooks that return `additionalContext` inject that context into the **spawned subagent's** context — not the parent agent's. Every other injectable event injects into the active agent's context, so it's easy to assume parent-agent injection and miss the audience switch. Under `onError: "block"`, the `systemMessage` diagnostic is also routed into the subagent (since `SubagentStart` is in `INJECTABLE_EVENTS`).

### WorktreeRemove Visibility Delta

Upstream Claude Code logs `WorktreeRemove` hook failures in debug mode only — they are effectively invisible to the agent during normal operation. Clooks diverges: under `onError: "block"`, the failure surfaces via `systemMessage` to the agent (because `WorktreeRemove` is NOT in `INJECTABLE_EVENTS`, the OBSERVE translator falls to the `systemMessage` branch). This is intentional per Clooks' fail-closed philosophy — a hook author who wires a `WorktreeRemove` hook gets visible feedback instead of a silent failure.

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

**Clooks auto-downgrade (PLAN-0015 M5).** When a ConfigChange hook returns `{result: "block"}` for a payload with `source: "policy_settings"`, Clooks downgrades the result to `skip` and emits a `systemMessage` warning before `translateResult` runs. The emitted JSON contains no top-level `decision`/`reason` — only the `systemMessage`. The other four sources (`user_settings`, `project_settings`, `local_settings`, `skills`) honor block normally. Placement rationale: the downgrade lives in `src/engine/run.ts` (not the translator) so the warning joins the existing `systemMessages` aggregation array and cannot be clobbered by other in-flight system messages. This mirrors the engine-layer `trace → continue` runtime fallback in `src/engine/execute.ts` — both are configuration-vs-event-capability mismatches that Clooks detects at runtime, downgrades to a safe default, and surfaces via `systemMessage` so the hook author sees the discrepancy.

### CONTINUATION `onError: "block"` Semantic

For the three CONTINUATION events (`TaskCompleted`, `TaskCreated`, `TeammateIdle`), an `onError: "block"` cascade triggered by a crashed hook emits **exit-2 + stderr** — upstream's documented retry/feedback path — not `{continue: false, stopReason}` (upstream's stop-teammate path). The agent receives the stderr as feedback and retries the transition (task completion, task creation, or idle check). The stop-teammate path is still reachable, but only via an explicit `{result: "stop", reason: "..."}` return from a hook.

**Why it matters (PLAN-0015 M6).** Clooks previously picked the more aggressive stop-teammate path for `onError: "block"` hook crashes; M6 aligns with upstream's retry semantic, matching what a hook author who configures `onError: "block"` reasonably expects ("block this completion and retry" rather than "halt the entire teammate"). The upstream raw docs for all three events document exit-2 as the re-run path and frame `{continue: false, stopReason}` as "stop the teammate entirely instead of re-running it." Hook authors who relied on the old stop-teammate behavior must switch to an explicit `{result: "stop"}` return (the `stop` branch in `src/engine/translate.ts` is intentionally unchanged and still emits `{continue: false, stopReason}` at exit-0). The BLOCK-path and STOP-path are now semantically distinct surfaces.

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
