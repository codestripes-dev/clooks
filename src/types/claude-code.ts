// Types for the JSON payload Claude Code sends to hooks on stdin.
// These mirror Claude Code's documented hook I/O contract.
// Reference: docs/domain/claude-code-hooks/io-contract.md

/**
 * Fields present in every hook event payload, regardless of event type.
 * Claude Code always sends these when invoking a command hook.
 */
export interface ClaudeCodeCommonInput {
  session_id: string;
  hook_event_name: string;
  cwd: string;
  permission_mode: string;
  transcript_path: string;
  agent_id?: string;
  agent_type?: string;
}

/**
 * The tool_input field for a Bash tool call.
 * When tool_name is "Bash", tool_input has these fields.
 */
export interface BashToolInput {
  command: string;
  description?: string;
  timeout?: number;
  run_in_background?: boolean;
}

/**
 * PreToolUse event payload. Sent before a tool call executes.
 * This is the most commonly hooked event -- it allows blocking or modifying
 * tool calls before they run.
 */
export interface PreToolUseInput extends ClaudeCodeCommonInput {
  hook_event_name: "PreToolUse";
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_use_id: string;
}

/**
 * PostToolUse event payload. Sent after a tool call succeeds.
 */
export interface PostToolUseInput extends ClaudeCodeCommonInput {
  hook_event_name: "PostToolUse";
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_response: unknown;
  tool_use_id: string;
}

/**
 * UserPromptSubmit event payload. Sent when the user submits a prompt.
 */
export interface UserPromptSubmitInput extends ClaudeCodeCommonInput {
  hook_event_name: "UserPromptSubmit";
  prompt: string;
}

/**
 * SessionStart event payload.
 */
export interface SessionStartInput extends ClaudeCodeCommonInput {
  hook_event_name: "SessionStart";
  source: string;
  model?: string;
}

/**
 * Union of all known event input types. Hooks receive one of these
 * depending on which event fired.
 */
export type ClaudeCodeInput =
  | PreToolUseInput
  | PostToolUseInput
  | UserPromptSubmitInput
  | SessionStartInput
  | (ClaudeCodeCommonInput & Record<string, unknown>);

// --- Output types (what Clooks writes to stdout) ---

/**
 * Base fields required by all hookSpecificOutput objects.
 * Claude Code requires hookEventName to identify the event.
 */
export interface HookSpecificOutputBase {
  hookEventName: string;
  additionalContext?: string;
}

/**
 * The hookSpecificOutput field for PreToolUse responses.
 * This is the primary way to control whether a tool call proceeds.
 */
export interface PreToolUseOutput extends HookSpecificOutputBase {
  hookEventName: "PreToolUse";
  permissionDecision?: "allow" | "deny" | "ask";
  permissionDecisionReason?: string;
  updatedInput?: Record<string, unknown>;
}

/**
 * The top-level JSON output Clooks writes to stdout on exit 0.
 * Claude Code parses this to determine the hook's decision.
 */
export interface ClaudeCodeOutput {
  hookSpecificOutput?: HookSpecificOutputBase;
  decision?: "block";
  reason?: string;
  additionalContext?: string;
  continue?: boolean;
  stopReason?: string;
  suppressOutput?: boolean;
  systemMessage?: string;
  updatedMCPToolOutput?: unknown;
}
