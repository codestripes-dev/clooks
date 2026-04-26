export type EventName =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'UserPromptSubmit'
  | 'SessionStart'
  | 'SessionEnd'
  | 'Stop'
  | 'StopFailure'
  | 'SubagentStop'
  | 'SubagentStart'
  | 'InstructionsLoaded'
  | 'PostToolUseFailure'
  | 'Notification'
  | 'PermissionRequest'
  | 'PermissionDenied'
  | 'ConfigChange'
  | 'WorktreeCreate'
  | 'WorktreeRemove'
  | 'PreCompact'
  | 'PostCompact'
  | 'TeammateIdle'
  | 'TaskCreated'
  | 'TaskCompleted'

export type HookName = string & { __brand: 'HookName' }

export type Milliseconds = number & { __brand: 'Milliseconds' }

/** Permission mode reported on `ctx.permissionMode`. Read-only — never construct. */
export type PermissionMode =
  | 'default'
  | 'plan'
  | 'acceptEdits'
  | 'dontAsk'
  | 'bypassPermissions'
  | (string & {})

/** Why the session started. Available on `SessionStartContext.source`. */
export type SessionStartSource = 'startup' | 'resume' | 'clear' | 'compact' | (string & {})

/** Why the session ended. Available on `SessionEndContext.reason`. */
export type SessionEndReason =
  | 'clear'
  | 'resume'
  | 'logout'
  | 'prompt_input_exit'
  | 'bypass_permissions_disabled'
  | 'other'
  | (string & {})

/** Kind of notification Claude Code is about to display. */
export type NotificationType =
  | 'permission_prompt'
  | 'idle_prompt'
  | 'auth_success'
  | 'elicitation_dialog'
  | (string & {})

/** Which CLAUDE.md tier loaded. `User` = global, `Project` / `Local` = repo, `Managed` = MDM. */
export type InstructionsMemoryType = 'User' | 'Project' | 'Local' | 'Managed' | (string & {})

/** Why an instructions file was loaded into context. */
export type InstructionsLoadReason =
  | 'session_start'
  | 'nested_traversal'
  | 'path_glob_match'
  | 'include'
  | (string & {})

/** Whether a compact was triggered manually (`/compact`) or automatically (context full). */
export type PreCompactTrigger = 'manual' | 'auto' | (string & {})

/** Which settings file changed. `policy_settings` changes cannot be blocked. */
export type ConfigChangeSource =
  | 'user_settings'
  | 'project_settings'
  | 'local_settings'
  | 'policy_settings'
  | 'skills'
  | (string & {})
