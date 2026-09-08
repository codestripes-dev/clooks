# Cross-Agent Hook Systems

Reference document for hook systems across AI coding agents. Clooks aims to provide a unified hook runtime across these agents, so understanding their differences and commonalities is essential.

## Overview

Five major AI coding agents have hook systems with similar enough patterns to support a unified runtime. Two agents have no hook system, and one has nascent/underdocumented hooks.

| Agent | Hook System | Maturity | Viable for Clooks? |
|-------|------------|----------|-------------------|
| **Claude Code** | 22 events, 4 hook types | Mature | Yes (primary target) |
| **Codex** | 12 documented events at September review; 10 targeted by Clooks | Active | Registration implemented; runtime placeholder today |
| **Cursor** | ~6 events | Beta (since 1.7, improved 2026) | Yes |
| **Windsurf** | ~8 events | Active | Yes |
| **VS Code Copilot** | ~8 events | Preview | Yes |
| **Cline** | Directory-based hooks | Nascent/underdocumented | Not yet |
| **Aider** | Git hooks only | None | No |
| **Continue** | None | None | No |

## Common Patterns

The viable agents share these hook patterns:

1. **Pre/post tool execution events** — Block or observe tool calls
2. **Session start/stop events** — Setup and teardown
3. **JSON context on stdin** — Structured event data
4. **Shell command handlers** — Execute arbitrary scripts
5. **Exit code signaling** — 0 = allow, non-zero = block (details vary)

These commonalities make a normalization layer feasible.

## Agent Details

### Claude Code

The most mature hook system. See [claude-code-hooks/overview.md](./claude-code-hooks/overview.md) for full details.

- **22 lifecycle events**
- **4 hook types:** command, HTTP, prompt, agent
- **Config:** `.claude/settings.json` or plugin `hooks/hooks.json`
- **Execution:** Parallel, no sequential option
- **Blocking:** Exit code 2 only
- **Special features:** Async hooks, `updatedInput` for modifying tool inputs, `additionalContext` for injecting context

### Codex

The adapter architecture is intended to preserve Clooks hook authoring for the shared semantic subset. Matching event names do not establish compatible tool input, output, permission, or turn semantics.

**Review status, 2026-09-07:** [Official hooks documentation](https://learn.chatgpt.com/docs/hooks) now also lists `SessionEnd` and `Interrupt`. Clooks still registers the ten-event target below and has no Codex runtime implementation. The installed package reports `0.153.4`; neither package metadata nor synthetic fixtures verify behavior. The following detailed capability notes are the **2026-05-23 documentation snapshot** and require a version-specific refresh before implementation, especially tool coverage and output handling.

- **Documented events:** `SessionStart`, `SubagentStart`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `UserPromptSubmit`, `SubagentStop`, `Stop`
- **Initial Clooks adapter MVP:** include all ten release-documented Codex events because Clooks already exposes matching Claude-side events, including `SubagentStart` and `SubagentStop`
- **Config:** `~/.codex/hooks.json`, `~/.codex/config.toml`, `<repo>/.codex/hooks.json`, or `<repo>/.codex/config.toml`
- **Trust:** project-local `.codex/` layers load only when the project is trusted; non-managed hooks must be reviewed/trusted before running
- **Handler:** command hooks only; `prompt` and `agent` handlers are parsed but skipped
- **Execution:** multiple matching command hooks for one event are launched concurrently
- **Feature flag:** hooks are enabled by default; `[features].hooks = false` disables them. Local `codex-cli 0.133.0` reports both `hooks` and `plugin_hooks` as stable and effectively enabled.
- **Timeout:** seconds, defaulting to 600
- **Coverage caveat:** `PostToolUse` covers Bash, `apply_patch`, and MCP tool calls, but shell interception is incomplete and WebSearch/non-shell/non-MCP tools are not intercepted yet
- **Verification status:** docs-backed but runtime-unverified. A disposable live spike reached the OpenAI API only after sandbox escalation and then failed with `401 Unauthorized`, so no hook payloads were captured.
- **Implementation status:** Clooks has Codex registration support plus an internal agent adapter boundary selected by `CLOOKS_AGENT`. `clooks init --agent codex` writes `.codex/hooks.json`, and `clooks init --global --agent codex` writes `~/.codex/hooks.json`. The unset/default path and `CLOOKS_AGENT=claude-code` both select the Claude Code adapter. `CLOOKS_AGENT=codex` refuses runtime execution with a not-implemented stderr diagnostic and exit 2; it does not normalize Codex payloads, run hooks for Codex, or emit Codex decision JSON yet. This refusal is not live evidence that Codex blocks every affected operation.

Mapping fit:

| Codex event | Clooks mapping | Caveat |
|---|---|---|
| `SessionStart` | `SessionStart` | Codex may include nullable `transcript_path`; Clooks currently expects a string. |
| `SubagentStart` | `SubagentStart` | Codex release docs support it and Clooks already has this event. Context injection should target the spawned subagent, matching the key Claude-side caveat. |
| `PreToolUse` | `PreToolUse` | Docs-backed support is narrower than Clooks: deny/block and `additionalContext` are supported; `updatedInput` is supported only with `permissionDecision: "allow"` for Bash, `apply_patch`, and MCP tools; `permissionDecision: "ask"`, `continue: false`, `stopReason`, and `suppressOutput` are parsed but unsupported and fail open. `defer` has no documented Codex equivalent. |
| `PermissionRequest` | `PermissionRequest` | Allow/deny are supported. Codex currently reserves `updatedInput`, `updatedPermissions`, and `interrupt`; passing them fails closed. |
| `PostToolUse` | `PostToolUse` | `block` means replace/annotate the completed tool result, not undo side effects. `updatedMCPToolOutput` is parsed but unsupported. |
| `PreCompact` | `PreCompact` | Codex release docs support it and Clooks already has a Claude event with this name. Include in the first Codex MVP, while treating Codex `continue: false` behavior as docs-backed but runtime-unverified. |
| `PostCompact` | `PostCompact` | Codex release docs support it and Clooks already has a Claude event with this name. Include in the first Codex MVP, while treating output behavior as docs-backed but runtime-unverified. |
| `UserPromptSubmit` | `UserPromptSubmit` | Blocks and additional context map cleanly. |
| `SubagentStop` | `SubagentStop` | Codex release docs support it and Clooks already has this event. Like `Stop`, `block` means continue rather than reject; map carefully. |
| `Stop` | `Stop` | Codex `decision: "block"` means continue the turn. Raw Codex `continue: false` is not exposed by the current Clooks Stop result. |

Recommended integration shape: use the agent adapter boundary around the existing Clooks engine. Agent selection is explicit: the registration command is responsible for setting `CLOOKS_AGENT`, and the runtime must not infer Claude versus Codex from payload shape because many event names overlap. The shared engine core owns project discovery, config loading, hook loading, matching, execution, lifecycle handling, ordering, circuit-breaker behavior, and result reduction. Adapters own wire event recognition, context normalization, agent-specific advisories, output routing, and final wire output.

The Claude Code adapter is the only implemented runtime adapter today. It preserves the existing Claude behavior, including snake_case-to-camelCase normalization, Claude output translation, notify-only stderr routing, `ConfigChange` `policy_settings` downgrade behavior, and Claude plugin/settings advisories. The Codex adapter is reserved for future runtime support. Codex registration already registers one Clooks entrypoint per supported Codex event so Clooks can preserve its own internal ordering even though Codex launches matching command hooks concurrently. The capability classification for Codex mappings uses these statuses: supported, docs-backed, unsupported/fail-open, unsupported/fail-closed, needs careful translation, or unverified.

The current boundary covers normalization and final output, not every policy decision in the engine. Per-hook results can affect input chaining and handoff before reduction; unsupported capabilities must be checked before those effects. Turn-state maintenance also runs before no-hook/no-match exits and currently uses shared event-based boundary rules. Future runtime work must account for provider identity, delivery audience, and turn semantics without leaking private wire metadata into hook contexts.

Clooks assumes the repository is trusted. Global invocations intentionally load the merged home/project/local configuration and repository hook code; no separate repository authorization layer is required. Tighter permission models are deferred. Native agent hook activation still applies. Separate registration correctness limits remain: installation flags can suppress project execution without a working global replacement, and global registration currently hardcodes `~/.codex`.

Codex behavior notes are summarized here because planning and research artifacts are not part of the committed domain documentation.

Registration data is validated before transformation. Invalid managed containers or JSON produce actionable errors without rewriting the original registration file; detection inspects all events and refuses ambiguous structures. Unknown metadata and untraversed event values are retained. Both agents use atomic file replacement with mode preservation and reject registration-file symlinks, including dangling links. This is per-file recoverability, not a multi-agent transaction.

Codex ownership recognizes whole generated commands with the explicit agent assignment, the emitted POSIX quoting, and a matching root/executable pair where a project root is present. The older global-shaped absolute command remains recognized for migration. Echo mentions, extra arguments, and additional shell operations stay user-owned. Init converges owned duplicates to one canonical command per registered event; surviving mixed groups retain unrelated hooks and metadata, while options on removed owned entries are not promised preservation. Claude likewise preserves unrelated hooks during unhook and recognizes its established generated and legacy forms, including exact scope-derived unquoted global commands.

Absolute Codex project registrations require re-init after clone, move, or worktree creation before hook activation. An old checkout may still receive the copied command until repair. Shell probes cover relocation, nested roots, and inherited environment without changing discovery. Global commands still forward deliberate `CLOOKS_PROJECT_ROOT` and inherited `CLAUDE_PROJECT_DIR`; provider-specific discovery remains future runtime work. Registration and probe success do not enable the Codex runtime placeholder or establish native hook review/activation.

### Cursor

Hook system added in beta (v1.7), improved through 2026.

- **~6 events:**
  - `beforeShellExecution` — Before running a shell command
  - `beforeMCPExecution` — Before MCP tool calls
  - `beforeReadFile` — Before reading a file
  - `afterFileEdit` — After editing a file
  - `beforeSubmitPrompt` — Before processing a user prompt
  - `stop` — When the agent stops

- **Config:** `.cursor/hooks.json`
- **Handler:** Shell commands, JSON on stdin
- **Blocking:** Non-zero exit blocks the action

### Windsurf

Hooks tied to the "Cascade" AI system.

- **~8 events:**
  - `pre_user_prompt` — Before processing prompt
  - `pre_read_code` — Before reading files
  - `pre_write_code` — Before writing files
  - `pre_run_command` — Before running shell commands
  - `pre_mcp_tool_use` — Before MCP tool calls
  - `post_cascade_response` — After AI response
  - `post_cascade_response_with_transcript` — After response, with full transcript
  - `post_setup_worktree` — After worktree setup

- **Config:** JSON in Windsurf settings
- **Handler:** Shell commands
- **Notable:** Separates read vs write file events (more granular than Claude Code's single PreToolUse with matcher)

### VS Code Copilot

Hook system in preview as of March 2026.

- **~8 events:**
  - `sessionStart` — Session begins
  - `sessionEnd` — Session ends
  - `userPromptSubmitted` — User submits prompt
  - `preToolUse` — Before tool execution
  - `postToolUse` — After tool execution
  - `agentStop` — Agent finishes
  - `subagentStop` — Subagent finishes
  - `errorOccurred` — On error

- **Config:** `.github/hooks/*.json`
- **Handler:** Shell commands, JSON on stdin
- **Notable:** Event names are the closest to Claude Code's naming convention

## Event Name Mapping

This table maps equivalent lifecycle concepts across agents. A Clooks normalization layer would use canonical event names (left column) and translate to/from agent-specific names.

| Clooks Canonical | Claude Code | Cursor | Windsurf | VS Code Copilot |
|-----------------|-------------|--------|----------|-----------------|
| `pre-tool-use` | `PreToolUse` | `beforeShellExecution` / `beforeMCPExecution` | `pre_run_command` / `pre_mcp_tool_use` | `preToolUse` |
| `post-tool-use` | `PostToolUse` | `afterFileEdit` | (post hooks) | `postToolUse` |
| `pre-prompt` | `UserPromptSubmit` | `beforeSubmitPrompt` | `pre_user_prompt` | `userPromptSubmitted` |
| `session-start` | `SessionStart` | (none documented) | (none documented) | `sessionStart` |
| `session-end` | `SessionEnd` | (none documented) | (none documented) | `sessionEnd` |
| `agent-stop` | `Stop` | `stop` | (none) | `agentStop` |
| `pre-file-read` | `PreToolUse` (matcher: `Read`) | `beforeReadFile` | `pre_read_code` | `preToolUse` (matcher) |
| `pre-file-write` | `PreToolUse` (matcher: `Write\|Edit`) | (none) | `pre_write_code` | `preToolUse` (matcher) |
| `pre-command` | `PreToolUse` (matcher: `Bash`) | `beforeShellExecution` | `pre_run_command` | `preToolUse` (matcher) |

Codex maps similarly to Claude Code for the shared event-name subset: `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `SessionStart`, `PreCompact`, `PostCompact`, `SubagentStart`, `SubagentStop`, and `Stop` use the same event names. The result capabilities are not identical. `PermissionRequest` also exists, but its current output capabilities are narrower than Claude Code's.

### Mapping Challenges

- **Granularity differs.** Claude Code uses a single `PreToolUse` event with matchers to filter by tool. Cursor and Windsurf have separate events per tool type (file read, file write, command). Clooks may need both approaches — granular canonical events that map to Claude Code's matcher system.

- **Not all events map.** Claude Code has 22 events; the others usually have smaller surfaces. Events like `ConfigChange`, `TeammateIdle`, `TaskCreated`, `TaskCompleted`, `InstructionsLoaded`, and `StopFailure` are Claude Code-specific. These would be available only when running under Claude Code unless another agent adds an equivalent event.

- **Blocking semantics differ.** Claude Code requires exit code 2 specifically. Others use any non-zero exit. Clooks needs to normalize this.

- **Context fields differ.** The JSON structure passed to hooks varies. A Clooks normalization layer should provide a consistent schema with agent-specific extensions.

## Key Gaps Across All Agents

These limitations are present across the viable agents, representing opportunities for Clooks:

1. **No sequential execution.** All agents run hooks in parallel. No ordering control. Claude Code explicitly closed this as NOT_PLANNED.
2. **No inter-hook communication.** Hooks can't see each other's output or pass data between them.
3. **No unified runtime.** No tool provides cross-agent hook portability.
4. **No hook testing.** No built-in way to test hooks in isolation or simulate events.
5. **Silent failure.** Crashing hooks fail silently in all agents (details vary, but none are fail-closed).

## Architectural Implications for Clooks

### Registration

`clooks init` should detect which agents are present (check for `.claude/`, `.cursor/`, Windsurf config, `.github/hooks/`) and register the Clooks entrypoint with each. The entrypoint script receives the agent-specific JSON, and Clooks normalizes it before passing to hooks.

### Hook Contract

The current adapter boundary deliberately keeps the existing `ClooksHook` authoring surface unchanged. Hooks still receive the same per-event context objects they receive under Claude Code today; there is no `{ agent, event, context, raw }` wrapper in the implemented runtime.

Cross-agent portability is handled below the hook-author surface. The selected adapter recognizes the upstream event name, normalizes that agent's wire payload into the existing Clooks context shape, and translates the reduced Clooks result back to that agent's wire output. If future runtime support needs an explicit agent marker or raw-payload escape hatch in hook contexts, that should be introduced as a separate compatibility decision rather than assumed as part of the adapter boundary.

### Agent-Specific Features

Some features only work with specific agents:
- `updatedInput` — supported by Claude Code for `PreToolUse` / `PermissionRequest`; in current Codex docs, `PreToolUse.updatedInput` is supported only with `permissionDecision: "allow"` for Bash, `apply_patch`, and MCP tools, while `PermissionRequest.updatedInput` is reserved/fail-closed.
- `additionalContext` — supported by Claude Code and by several Codex events, but exact event support must be checked per event.
- `ask` / `defer` — Claude Code `PreToolUse` capabilities. Current Codex docs mark `ask` as parsed but unsupported/fail-open and do not document `defer`.
- `updatedPermissions` / `interrupt` on `PermissionRequest` — Claude Code capability; current Codex docs reserve these fields and fail closed.
- `prompt` hooks and `agent` hooks — Claude Code supports additional hook types. Current Codex docs parse `prompt` and `agent` handlers but skip them.

Clooks should expose these as agent-specific capabilities, not core contract features. The current hook context does not include an `event.agent` field; future capability checks need an explicit context-extension decision.

## Related

- [claude-code-hooks/overview.md](./claude-code-hooks/overview.md) — Detailed Claude Code hook reference
- [PRODUCT_EXPLORATION.md](../../PRODUCT_EXPLORATION.md) — Clooks product design
