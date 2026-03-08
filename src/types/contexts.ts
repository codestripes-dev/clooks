// Base context and 18 per-event context interfaces.
// The `event` field is the discriminant literal for each context type.

import type {
  PermissionMode,
  SessionStartSource,
  SessionEndReason,
  NotificationType,
  InstructionsMemoryType,
  InstructionsLoadReason,
  PreCompactTrigger,
  ConfigChangeSource,
} from "./branded.js"

export interface BaseContext {
  event: string
  sessionId: string
  cwd: string
  permissionMode: PermissionMode
  transcriptPath: string
  agentId?: string
  agentType?: string
}

// --- Guard events ---

export interface PreToolUseContext extends BaseContext {
  event: "PreToolUse"
  toolName: string
  toolInput: Record<string, unknown>
  toolUseId: string
}

export interface UserPromptSubmitContext extends BaseContext {
  event: "UserPromptSubmit"
  prompt: string
}

export interface PermissionRequestContext extends BaseContext {
  event: "PermissionRequest"
  toolName: string
  toolInput: Record<string, unknown>
  permissionSuggestions: unknown[]
}

export interface StopContext extends BaseContext {
  event: "Stop"
  stopHookActive: boolean
  lastAssistantMessage: string
}

export interface SubagentStopContext extends BaseContext {
  event: "SubagentStop"
  stopHookActive: boolean
  agentId: string
  agentType: string
  agentTranscriptPath: string
  lastAssistantMessage: string
}

export interface ConfigChangeContext extends BaseContext {
  event: "ConfigChange"
  source: ConfigChangeSource
  filePath?: string
}

// --- Observe events ---

export interface SessionStartContext extends BaseContext {
  event: "SessionStart"
  source: SessionStartSource
  model?: string
}

export interface SessionEndContext extends BaseContext {
  event: "SessionEnd"
  reason: SessionEndReason
}

export interface InstructionsLoadedContext extends BaseContext {
  event: "InstructionsLoaded"
  filePath: string
  memoryType: InstructionsMemoryType
  loadReason: InstructionsLoadReason
  globs?: string[]
  triggerFilePath?: string
  parentFilePath?: string
}

export interface PostToolUseContext extends BaseContext {
  event: "PostToolUse"
  toolName: string
  toolInput: Record<string, unknown>
  toolResponse: unknown
  toolUseId: string
}

export interface PostToolUseFailureContext extends BaseContext {
  event: "PostToolUseFailure"
  toolName: string
  toolInput: Record<string, unknown>
  toolUseId: string
  error: string
  isInterrupt: boolean
}

export interface NotificationContext extends BaseContext {
  event: "Notification"
  message: string
  title?: string
  notificationType: NotificationType
}

export interface SubagentStartContext extends BaseContext {
  event: "SubagentStart"
  agentId: string
  agentType: string
}

export interface WorktreeRemoveContext extends BaseContext {
  event: "WorktreeRemove"
  worktreePath: string
}

export interface PreCompactContext extends BaseContext {
  event: "PreCompact"
  trigger: PreCompactTrigger
  customInstructions: string
}

// --- Implementation events ---

export interface WorktreeCreateContext extends BaseContext {
  event: "WorktreeCreate"
  name: string
}

// --- Continuation events ---

export interface TeammateIdleContext extends BaseContext {
  event: "TeammateIdle"
  teammateName: string
  teamName: string
}

export interface TaskCompletedContext extends BaseContext {
  event: "TaskCompleted"
  taskId: string
  taskSubject: string
  taskDescription?: string
  teammateName: string
  teamName: string
}
