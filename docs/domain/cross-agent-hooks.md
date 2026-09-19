# Cross-Agent Hook Systems

Reference document for hook systems across AI coding agents. Clooks aims to provide a unified hook runtime across these agents, so understanding their differences and commonalities is essential.

## Overview

Five major AI coding agents have hook systems with similar enough patterns to support a unified runtime. Two agents have no hook system, and one has nascent/underdocumented hooks.

| Agent | Hook System | Maturity | Viable for Clooks? |
|-------|------------|----------|-------------------|
| **Claude Code** | 22 events, 4 hook types | Mature | Yes (primary target) |
| **Codex** | 12 events targeted by Clooks | Active | Twelve-event runtime includes observational SessionEnd and Interrupt; native evidence remains capability-specific |
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

Codex coverage is split into focused sub-docs:

| Document | Path | Topics |
|----------|------|--------|
| Codex — Event Mapping | `cross-agent-hooks/codex.md` | Target events, config/trust/handlers/execution/coverage, event mapping table, pinned release source corrections |
| Codex — Runtime Capabilities | `cross-agent-hooks/codex-capabilities.md` | Current per-event result surface, live-checkpoint approvals, diagnostics, turn policy, hook-pack discovery, global init/uninstall/registration |
| Codex — Plugin Onboarding | `cross-agent-hooks/codex-onboarding.md` | `$clooks:setup` flow, installer selection, native onboarding evidence |

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

Codex maps similarly to Claude Code for the shared event-name subset: `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `SessionStart`, `PreCompact`, `PostCompact`, `SubagentStart`, `SubagentStop`, and `Stop` use the same event names. The result capabilities are not identical. `PermissionRequest` also exists, but its current output capabilities are narrower than Claude Code's. `SessionEnd` is observational; `Interrupt` is a Codex-only root-turn observer, not a Claude event.

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

The adapter boundary keeps the existing `ClooksHook` handler and decision structure, with an additive `ctx.agent: 'claude-code' | 'codex'` on every event context. Lifecycle slots read it at `event.input.agent`, not `event.meta`. There is no `{ agent, event, context, raw }` wrapper.

The selected adapter recognizes the upstream event name, normalizes wire input and translates reduced results. The shared core assigns agent after normalization, overriding any payload field; explicit adapter selection remains authoritative even under a contradictory process environment. Synthetic helpers default to Claude and accept a validated explicit Codex agent without simulating its wire policy. Agent identity does not promise particular tools or result capabilities. Raw payload access remains private.

The repository's vendored core hooks use that identity for bounded agent differences. `prefer-builtin-tools` omits built-in read/search/listing restrictions for Codex while retaining configured additional rules and per-rule disables; applicable write restrictions recommend `apply_patch` when available, and sleep guidance refers to available process-wait tools. Claude keeps its existing guidance. `no-compound-commands` changes Codex wording, not classification or escape behavior. `no-pasted-placeholder` checks both `[Pasted text #N +N lines]` (including singular `line`) and `[Pasted Content N chars]` on Claude, Codex and legacy undefined-agent contexts; an outside suffix such as ` #2` does not prevent detection. This is a heuristic for potentially unexpanded pastes, not proof of missing content; literal examples also match. Prompts starting exactly with `<task-notification>` still skip. Agent-specific hook guidance does not imply new adapter capabilities. Patch, move and confirmation inspection limits are described in [Hook Inspection Boundaries](./vendoring/overview.md#hook-inspection-boundaries).

### Agent-Specific Features

The project `js-package-manager-guard` checks normalized shell commands on both agents with the same configured allowlist, automatic runner/runtime extensions and `additionalBlocked` rules. It recognizes quoted executable names and newline-separated command heads, including environment-assignment prefixes. Quoted arguments/comments remain inert, escaped newlines continue a command, and pipe targets remain excluded even across continuation newlines. Executable paths and unknown tools are not resolved or autodetected; explicit additional rules retain exact-name matching. Inspection is bounded lexical parsing, not shell evaluation; nested execution and heredocs stop inspection of the remaining input. A plain direct `node` call to a literal absolute script identified as an installed plugin file bypasses only the default runtime block; assignments, runtime flags, expansions, redirections, explicit additional rules and later command segments remain enforced. Its SessionStart announcement refers to shell tools without implying extra adapter capabilities.

For both agents, `no-compound-commands` permits a leading `cd <path> && <one-command>` only with `&&`, not `;`. Quoted paths and a piped remainder remain supported; `ALLOW_COMPOUND=true` still bypasses the check, including semicolon cd commands.

The repository's core `no-rm-rf` hook returns `ctx.ask` for aggregate confirmation classifications on both agents. The engine's live-checkpoint integration replaces native-ask/token-fallback routing. Classification, deny precedence, strict mode, allowlist and escape behavior are unchanged. Strict mode promotes project-root and non-allowlisted project asks to blocks; `ALLOW_DESTRUCTIVE_RM=true` does not discharge these asks or strict-mode blocks. The former Codex-only block branch was removed locally, not in a global or marketplace installation. The historical token-runtime native case passed for `rm -r`, with two confirmations, exact target effects and replay refusal; it is neither new live-checkpoint evidence nor native `rm -rf` allow proof. Quoted-target parsing remains an unresolved, separate limitation.

Native `apply_patch` is not a member of the ten-tool Claude `PreToolUseContext` union. Use the existing [unknown-tool context pattern](./hook-type-system/patterns.md#tool-event-pipeline-fields): `ctx as unknown as UnknownPreToolUseContext`, then check the agent, exact tool name, non-null object input shape and `typeof toolInput.command === 'string'` at runtime. This authoring pattern neither widens the known-tool union nor proves that a session exposes the tool; it is not evidence of implemented or validated patch protection.

Some features only work with specific agents:
- `updatedInput` — supported by Claude Code for `PreToolUse` / `PermissionRequest`; pinned Codex PreToolUse requires allow plus a valid tool-specific full replacement. PermissionRequest rewrites are reserved and fail the handler with no decision, as detailed above.
- `additionalContext` — supported by Claude Code and by several Codex events, but exact event support must be checked per event.
- `ask` / `defer` — distinct `PreToolUse` decisions. The current shared engine integration resolves asks through live checkpoints; missing interaction refuses rather than emitting native ask or issuing retry tokens. Claude defer retains its mode-dependent semantics and is not a universal native veto; Codex defer remains refused. The retained Codex source snapshot marks native ask unsupported/fail-open. Live checkpoint integration and generated-registration conformance have separate validation gates.
- `updatedPermissions` / `interrupt` on `PermissionRequest` — Claude Code capability; pinned Codex rejects non-null permission updates or `interrupt:true` with no decision, leaving normal review absent another handler decision. Clooks accepts PermissionRequest block's `interrupt:false` and emits an ordinary denial without that field.
- Handler types — Claude Code supports additional hook types. Codex documents command and [MCP tool handlers](https://learn.chatgpt.com/docs/hooks#mcp-tool-hooks), while parsing and skipping `prompt` and `agent`. Clooks uses command handlers plus a generated PreToolUse MCP companion, with compiled validation distinct from native conformance.

Clooks should expose these as agent-specific capabilities, not core contract features. Authors can branch on `ctx.agent`, but identity alone is not a capability negotiation API.

## Scoping Hooks to Agents

A hook can be restricted to run only under specific agents — an author statement via `meta.agents`, a user override via `clooks.yml` `agents` (globally, per hook, or per hook and event), or both, with a fixed precedence between them. See [Cross-Agent Hooks — Scoping Hooks to Agents](cross-agent-hooks/agent-scoping.md) for the worked yaml/meta example, the precedence order, the debug output, and what "excluded" actually means for an already-imported hook.

## Related

- [claude-code-hooks/overview.md](./claude-code-hooks/overview.md) — Detailed Claude Code hook reference
- [PRODUCT_EXPLORATION.md](../../PRODUCT_EXPLORATION.md) — Clooks product design
