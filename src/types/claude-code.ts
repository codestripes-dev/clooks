// Types for the JSON payload Claude Code sends to hooks on stdin.
// These mirror Claude Code's documented hook I/O contract.
// Reference: docs/domain/claude-code-hooks/io-contract.md

import type { PermissionUpdateEntry } from './permissions.js'

/**
 * Fields present in every hook event payload, regardless of event type.
 * Claude Code always sends these when invoking a command hook.
 */
export interface ClaudeCodeCommonInput {
  session_id: string
  hook_event_name: string
  cwd: string
  permission_mode: string
  transcript_path: string
  agent_id?: string
  agent_type?: string
}

/**
 * The tool_input field for a Bash tool call.
 * When tool_name is "Bash", tool_input has these fields.
 */
export interface BashToolInput {
  command: string
  description?: string
  timeout?: number
  run_in_background?: boolean
}

/**
 * PreToolUse event payload. Sent before a tool call executes.
 * This is the most commonly hooked event -- it allows blocking or modifying
 * tool calls before they run.
 */
export interface PreToolUseInput extends ClaudeCodeCommonInput {
  hook_event_name: 'PreToolUse'
  tool_name: string
  tool_input: Record<string, unknown>
  tool_use_id: string
}

/**
 * PostToolUse event payload. Sent after a tool call succeeds.
 */
export interface PostToolUseInput extends ClaudeCodeCommonInput {
  hook_event_name: 'PostToolUse'
  tool_name: string
  tool_input: Record<string, unknown>
  tool_response: unknown
  tool_use_id: string
}

/**
 * UserPromptSubmit event payload. Sent when the user submits a prompt.
 */
export interface UserPromptSubmitInput extends ClaudeCodeCommonInput {
  hook_event_name: 'UserPromptSubmit'
  prompt: string
}

/**
 * SessionStart event payload.
 */
export interface SessionStartInput extends ClaudeCodeCommonInput {
  hook_event_name: 'SessionStart'
  source: string
  model?: string
}

// --- Guard events (can return allow/block/skip) ---

/**
 * PermissionRequest event payload. Sent when a permission dialog is about
 * to be shown to the user. Hooks can allow or deny on the user's behalf.
 */
export interface PermissionRequestInput extends ClaudeCodeCommonInput {
  hook_event_name: 'PermissionRequest'
  tool_name: string
  tool_input: Record<string, unknown>
  permission_suggestions?: PermissionUpdateEntry[]
}

/**
 * PermissionDenied event payload. Fires in auto mode when the
 * permission classifier denies a tool call. Cannot reverse the
 * denial; may return retry: true to hint that the model should
 * retry. See docs/domain/raw-claude-ai/hook-docs/PermissionDenied.md.
 */
export interface PermissionDeniedInput extends ClaudeCodeCommonInput {
  hook_event_name: 'PermissionDenied'
  tool_name: string
  tool_input: Record<string, unknown>
  tool_use_id: string
  reason: string
}

/**
 * Stop event payload. Sent when the main Claude Code agent has finished
 * responding. Hooks can block the stop and force Claude to continue.
 */
export interface StopInput extends ClaudeCodeCommonInput {
  hook_event_name: 'Stop'
  stop_hook_active: boolean
  last_assistant_message: string
}

/**
 * SubagentStop event payload. Sent when a Claude Code subagent has
 * finished responding. Uses the same decision control format as Stop.
 */
export interface SubagentStopInput extends ClaudeCodeCommonInput {
  hook_event_name: 'SubagentStop'
  stop_hook_active: boolean
  last_assistant_message: string
  agent_transcript_path: string
  agent_id: string
  agent_type: string
}

/**
 * ConfigChange event payload. Sent when a configuration file changes
 * during a session. Hooks can block the change from being applied
 * (except for policy_settings, which cannot be blocked).
 */
export interface ConfigChangeInput extends ClaudeCodeCommonInput {
  hook_event_name: 'ConfigChange'
  source:
    | 'user_settings'
    | 'project_settings'
    | 'local_settings'
    | 'policy_settings'
    | 'skills'
    | (string & {})
  file_path?: string
}

// --- Observe events (observation / optional context injection) ---

/**
 * SessionEnd event payload. Sent when a Claude Code session ends.
 * Hooks cannot block session termination but can perform cleanup.
 */
export interface SessionEndInput extends ClaudeCodeCommonInput {
  hook_event_name: 'SessionEnd'
  reason:
    | 'clear'
    | 'resume'
    | 'logout'
    | 'prompt_input_exit'
    | 'bypass_permissions_disabled'
    | 'other'
    | (string & {})
}

/**
 * InstructionsLoaded event payload. Fires when a CLAUDE.md or
 * .claude/rules/*.md file is loaded into context. No decision control.
 */
export interface InstructionsLoadedInput extends ClaudeCodeCommonInput {
  hook_event_name: 'InstructionsLoaded'
  file_path: string
  memory_type: 'User' | 'Project' | 'Local' | 'Managed' | (string & {})
  load_reason:
    | 'session_start'
    | 'nested_traversal'
    | 'path_glob_match'
    | 'include'
    | 'compact'
    | (string & {})
  globs?: string[]
  trigger_file_path?: string
  parent_file_path?: string
}

/**
 * PostToolUseFailure event payload. Sent when a tool execution fails.
 * Hooks can provide additional context to Claude after the failure.
 */
export interface PostToolUseFailureInput extends ClaudeCodeCommonInput {
  hook_event_name: 'PostToolUseFailure'
  tool_name: string
  tool_input: Record<string, unknown>
  tool_use_id: string
  error: string
  is_interrupt?: boolean
}

/**
 * Notification event payload. Sent when Claude Code shows a notification
 * (permission prompts, idle prompts, auth success, elicitation dialogs).
 */
export interface NotificationInput extends ClaudeCodeCommonInput {
  hook_event_name: 'Notification'
  message: string
  title?: string
  notification_type?:
    | 'permission_prompt'
    | 'idle_prompt'
    | 'auth_success'
    | 'elicitation_dialog'
    | (string & {})
}

/**
 * SubagentStart event payload. Sent when a Claude Code subagent is
 * spawned via the Agent tool. Hooks can inject context into the subagent.
 */
export interface SubagentStartInput extends ClaudeCodeCommonInput {
  hook_event_name: 'SubagentStart'
  agent_id: string
  agent_type: string
}

/**
 * WorktreeRemove event payload. Sent when a worktree is being removed.
 * Hooks cannot block worktree removal but can perform cleanup.
 */
export interface WorktreeRemoveInput extends ClaudeCodeCommonInput {
  hook_event_name: 'WorktreeRemove'
  worktree_path: string
}

/**
 * PreCompact event payload. Sent before Claude Code runs a compact
 * operation. Can be triggered manually via /compact or automatically
 * when the context window is full.
 */
export interface PreCompactInput extends ClaudeCodeCommonInput {
  hook_event_name: 'PreCompact'
  trigger: 'manual' | 'auto' | (string & {})
  custom_instructions: string
}

/**
 * PostCompact event payload. Sent after Claude Code completes a compact
 * operation. Pure observer — cannot affect the compaction result, but
 * can perform follow-up tasks (e.g. logging the generated summary).
 */
export interface PostCompactInput extends ClaudeCodeCommonInput {
  hook_event_name: 'PostCompact'
  trigger: 'manual' | 'auto' | (string & {})
  compact_summary: string
}

// --- Notify-only events (output ignored upstream) ---

/**
 * Categories of API failure surfaced on `StopFailureContext.error`. Branch
 * alerting on this — e.g. page on `rate_limit`, ignore `max_output_tokens`.
 */
export type StopFailureErrorType =
  | 'rate_limit'
  | 'authentication_failed'
  | 'billing_error'
  | 'invalid_request'
  | 'server_error'
  | 'max_output_tokens'
  | 'unknown'
  | (string & {})

/**
 * StopFailure event payload. Fires INSTEAD OF Stop when the turn ends
 * due to an upstream API error (rate limit, auth, billing, server, etc.).
 * Output and exit code are ignored upstream — hooks run purely for side
 * effects (logging, alerting, recovery).
 */
export interface StopFailureInput extends ClaudeCodeCommonInput {
  hook_event_name: 'StopFailure'
  error: StopFailureErrorType
  error_details?: string
  /**
   * For StopFailure, this is the rendered API error string
   * (e.g., "API Error: Rate limit reached") — NOT Claude's
   * conversational text as in Stop / SubagentStop. See `error_details`
   * for additional structured detail.
   */
  last_assistant_message?: string
}

// --- Implementation events (author determines behavior) ---

/**
 * WorktreeCreate event payload. Sent when Claude Code needs to create
 * an isolated working copy. Hooks must return the absolute path to the
 * created worktree directory on stdout.
 */
export interface WorktreeCreateInput extends ClaudeCodeCommonInput {
  hook_event_name: 'WorktreeCreate'
  name: string
}

// --- Continuation events (teammate/task control) ---

/**
 * TeammateIdle event payload. Sent when an agent team teammate is about
 * to go idle after finishing its turn. Hooks can force the teammate to
 * continue working or stop it entirely.
 */
export interface TeammateIdleInput extends ClaudeCodeCommonInput {
  hook_event_name: 'TeammateIdle'
  teammate_name: string
  team_name: string
}

/**
 * TaskCreated event payload. Sent when a task is being created via the
 * `TaskCreate` tool. Hooks can block task creation or stop the teammate
 * entirely.
 */
export interface TaskCreatedInput extends ClaudeCodeCommonInput {
  hook_event_name: 'TaskCreated'
  task_id: string
  task_subject: string
  task_description?: string
  teammate_name?: string
  team_name?: string
}

/**
 * TaskCompleted event payload. Sent when a task is being marked as
 * completed (via TaskUpdate tool or teammate turn-end). Hooks can block
 * completion or stop the teammate entirely.
 */
export interface TaskCompletedInput extends ClaudeCodeCommonInput {
  hook_event_name: 'TaskCompleted'
  task_id: string
  task_subject: string
  task_description?: string
  teammate_name?: string
  team_name?: string
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
  | PermissionRequestInput
  | PermissionDeniedInput
  | StopInput
  | StopFailureInput
  | SubagentStopInput
  | ConfigChangeInput
  | SessionEndInput
  | InstructionsLoadedInput
  | PostToolUseFailureInput
  | NotificationInput
  | SubagentStartInput
  | WorktreeRemoveInput
  | PreCompactInput
  | PostCompactInput
  | WorktreeCreateInput
  | TeammateIdleInput
  | TaskCreatedInput
  | TaskCompletedInput
  | (ClaudeCodeCommonInput & Record<string, unknown>)

// --- Output types (what Clooks writes to stdout) ---

/**
 * Base fields required by all hookSpecificOutput objects.
 * Claude Code requires hookEventName to identify the event.
 */
export interface HookSpecificOutputBase {
  hookEventName: string
  additionalContext?: string
}

/**
 * The hookSpecificOutput field for PreToolUse responses.
 * This is the primary way to control whether a tool call proceeds.
 */
export interface PreToolUseOutput extends HookSpecificOutputBase {
  hookEventName: 'PreToolUse'
  permissionDecision?: 'allow' | 'deny' | 'ask' | 'defer'
  permissionDecisionReason?: string
  updatedInput?: Record<string, unknown>
}

/**
 * The hookSpecificOutput field for UserPromptSubmit responses.
 * sessionTitle updates the IDE session title (equivalent to /rename).
 */
export interface UserPromptSubmitOutput extends HookSpecificOutputBase {
  hookEventName: 'UserPromptSubmit'
  sessionTitle?: string
}

/**
 * The hookSpecificOutput field for PermissionDenied responses.
 * retry: true signals the model may retry the tool call. Any
 * other value (or absence) means the denial stands without a
 * retry hint.
 */
export interface PermissionDeniedOutput extends HookSpecificOutputBase {
  hookEventName: 'PermissionDenied'
  retry?: boolean
}

/**
 * The top-level JSON output Clooks writes to stdout on exit 0.
 * Claude Code parses this to determine the hook's decision.
 */
export interface ClaudeCodeOutput {
  hookSpecificOutput?: HookSpecificOutputBase
  decision?: 'block'
  reason?: string
  additionalContext?: string
  continue?: boolean
  stopReason?: string
  suppressOutput?: boolean
  systemMessage?: string
  updatedMCPToolOutput?: unknown
}
