// Closed union — the engine must know every event to translate results.
// Unknown events are fail-closed errors, not forward-compatible pass-throughs.
export type EventName =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'UserPromptSubmit'
  | 'SessionStart'
  | 'SessionEnd'
  | 'Stop'
  | 'SubagentStop'
  | 'SubagentStart'
  | 'InstructionsLoaded'
  | 'PostToolUseFailure'
  | 'Notification'
  | 'PermissionRequest'
  | 'ConfigChange'
  | 'WorktreeCreate'
  | 'WorktreeRemove'
  | 'PreCompact'
  | 'PostCompact'
  | 'TeammateIdle'
  | 'TaskCreated'
  | 'TaskCompleted'

/** Branded type for hook names — distinguishes hook names from event names and other strings. */
export type HookName = string & { __brand: 'HookName' }

/** Branded type for timeout values — distinguishes milliseconds from plain numbers (failure counts, etc.). */
export type Milliseconds = number & { __brand: 'Milliseconds' }

// Branded string types for enum-like fields.
// Pattern: known values + (string & {}) for forward-compatibility.

export type PermissionMode =
  | 'default'
  | 'plan'
  | 'acceptEdits'
  | 'dontAsk'
  | 'bypassPermissions'
  | (string & {})

export type SessionStartSource = 'startup' | 'resume' | 'clear' | 'compact' | (string & {})

export type SessionEndReason =
  | 'clear'
  | 'resume'
  | 'logout'
  | 'prompt_input_exit'
  | 'bypass_permissions_disabled'
  | 'other'
  | (string & {})

export type NotificationType =
  | 'permission_prompt'
  | 'idle_prompt'
  | 'auth_success'
  | 'elicitation_dialog'
  | (string & {})

export type InstructionsMemoryType = 'User' | 'Project' | 'Local' | 'Managed' | (string & {})

export type InstructionsLoadReason =
  | 'session_start'
  | 'nested_traversal'
  | 'path_glob_match'
  | 'include'
  | (string & {})

export type PreCompactTrigger = 'manual' | 'auto' | (string & {})

export type ConfigChangeSource =
  | 'user_settings'
  | 'project_settings'
  | 'local_settings'
  | 'policy_settings'
  | 'skills'
  | (string & {})
