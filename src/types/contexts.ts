// Base context and 22 per-event context interfaces.
// The `event` field is the discriminant literal for each context type.

import type {
  EventName,
  PermissionMode,
  SessionStartSource,
  SessionEndReason,
  NotificationType,
  InstructionsMemoryType,
  InstructionsLoadReason,
  PreCompactTrigger,
  ConfigChangeSource,
} from './branded.js'
import type { StopFailureErrorType } from './claude-code.js'
import type { PermissionUpdateEntry } from './permissions.js'

export interface BaseContext {
  event: EventName
  sessionId: string
  cwd: string
  permissionMode?: PermissionMode
  transcriptPath: string
  agentId?: string
  agentType?: string
  /** True when this hook is running in a parallel batch. */
  parallel: boolean
  /** AbortSignal scoped to the current batch. Aborted when a parallel batch short-circuits. */
  signal: AbortSignal
}

// --- Guard events ---

export interface PreToolUseContext extends BaseContext {
  event: 'PreToolUse'
  toolName: string
  /** Current tool input — may differ from originalToolInput if a previous hook returned updatedInput. */
  toolInput: Record<string, unknown>
  /** The original tool input from Claude Code, before any hook modifications. */
  originalToolInput: Record<string, unknown>
  toolUseId: string
}

export interface UserPromptSubmitContext extends BaseContext {
  event: 'UserPromptSubmit'
  prompt: string
}

export interface PermissionRequestContext extends BaseContext {
  event: 'PermissionRequest'
  toolName: string
  toolInput: Record<string, unknown>
  permissionSuggestions?: PermissionUpdateEntry[]
}

export interface StopContext extends BaseContext {
  event: 'Stop'
  stopHookActive: boolean
  lastAssistantMessage: string
}

export interface SubagentStopContext extends BaseContext {
  event: 'SubagentStop'
  stopHookActive: boolean
  agentId: string
  agentType: string
  agentTranscriptPath: string
  lastAssistantMessage: string
}

export interface ConfigChangeContext extends BaseContext {
  event: 'ConfigChange'
  source: ConfigChangeSource
  filePath?: string
}

// --- Notify-only events ---

export interface StopFailureContext extends BaseContext {
  event: 'StopFailure'
  error: StopFailureErrorType
  errorDetails?: string
  /**
   * For StopFailure, this is the rendered API error string
   * (e.g., "API Error: Rate limit reached") — NOT Claude's
   * conversational text as in Stop / SubagentStop. See `errorDetails`
   * for additional structured detail.
   */
  lastAssistantMessage?: string
}

// --- Observe events ---

export interface SessionStartContext extends BaseContext {
  event: 'SessionStart'
  source: SessionStartSource
  model?: string
}

export interface SessionEndContext extends BaseContext {
  event: 'SessionEnd'
  reason: SessionEndReason
}

export interface InstructionsLoadedContext extends BaseContext {
  event: 'InstructionsLoaded'
  filePath: string
  memoryType: InstructionsMemoryType
  loadReason: InstructionsLoadReason
  globs?: string[]
  triggerFilePath?: string
  parentFilePath?: string
}

export interface PostToolUseContext extends BaseContext {
  event: 'PostToolUse'
  toolName: string
  toolInput: Record<string, unknown>
  toolResponse: unknown
  toolUseId: string
  originalToolInput?: Record<string, unknown>
}

export interface PostToolUseFailureContext extends BaseContext {
  event: 'PostToolUseFailure'
  toolName: string
  toolInput: Record<string, unknown>
  toolUseId: string
  error: string
  isInterrupt?: boolean
  originalToolInput?: Record<string, unknown>
}

export interface NotificationContext extends BaseContext {
  event: 'Notification'
  message: string
  title?: string
  notificationType?: NotificationType
}

export interface SubagentStartContext extends BaseContext {
  event: 'SubagentStart'
  agentId: string
  agentType: string
}

export interface WorktreeRemoveContext extends BaseContext {
  event: 'WorktreeRemove'
  worktreePath: string
}

export interface PreCompactContext extends BaseContext {
  event: 'PreCompact'
  trigger: PreCompactTrigger
  customInstructions: string
}

export interface PostCompactContext extends BaseContext {
  event: 'PostCompact'
  trigger: PreCompactTrigger
  compactSummary: string
}

export interface PermissionDeniedContext extends BaseContext {
  event: 'PermissionDenied'
  toolName: string
  /** Tool input as provided to Claude Code. Keys are camelCase. */
  toolInput: Record<string, unknown>
  toolUseId: string
  /** The classifier's explanation for why the tool call was denied. */
  denialReason: string
}

// --- Implementation events ---

export interface WorktreeCreateContext extends BaseContext {
  event: 'WorktreeCreate'
  name: string
}

// --- Continuation events ---

export interface TeammateIdleContext extends BaseContext {
  event: 'TeammateIdle'
  teammateName: string
  teamName: string
}

export interface TaskCreatedContext extends BaseContext {
  event: 'TaskCreated'
  taskId: string
  taskSubject: string
  taskDescription?: string
  teammateName?: string
  teamName?: string
}

export interface TaskCompletedContext extends BaseContext {
  event: 'TaskCompleted'
  taskId: string
  taskSubject: string
  taskDescription?: string
  teammateName?: string
  teamName?: string
}
