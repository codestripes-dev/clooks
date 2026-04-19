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

// --- PreToolUse per-tool input types (camelCase, post-normalize) ---
// These mirror the tool_input fields Claude Code sends upstream
// (docs/domain/raw-claude-ai/hook-docs/PreToolUse.md:11-112), transformed
// through src/normalize.ts: snake_case keys become camelCase. Authors
// narrow on ctx.toolName to get a typed ctx.toolInput.

export interface BashToolInput {
  command: string
  description?: string
  timeout?: number
  runInBackground?: boolean
}
export interface WriteToolInput {
  filePath: string
  content: string
}
export interface EditToolInput {
  filePath: string
  oldString: string
  newString: string
  replaceAll?: boolean
}
export interface ReadToolInput {
  filePath: string
  offset?: number
  limit?: number
}
export interface GlobToolInput {
  pattern: string
  path?: string
}
export interface GrepToolInput {
  pattern: string
  path?: string
  glob?: string
  outputMode?: 'content' | 'files_with_matches' | 'count' | (string & {})
  '-i'?: boolean
  multiline?: boolean
}
export interface WebFetchToolInput {
  url: string
  prompt: string
}
export interface WebSearchToolInput {
  query: string
  allowedDomains?: string[]
  blockedDomains?: string[]
}
export interface AgentToolInput {
  prompt: string
  description: string
  subagentType: string
  model?: string
}
export interface AskUserQuestionToolInput {
  questions: Array<{
    question: string
    header: string
    options: Array<{ label: string }>
    multiSelect?: boolean
  }>
  answers?: Record<string, string>
}

export type PreToolUseContext = BaseContext & {
  event: 'PreToolUse'
  toolUseId: string
  /** The original tool input from Claude Code, before any hook modifications. */
  originalToolInput: Record<string, unknown>
} & (
    | { toolName: 'Bash'; toolInput: BashToolInput }
    | { toolName: 'Write'; toolInput: WriteToolInput }
    | { toolName: 'Edit'; toolInput: EditToolInput }
    | { toolName: 'Read'; toolInput: ReadToolInput }
    | { toolName: 'Glob'; toolInput: GlobToolInput }
    | { toolName: 'Grep'; toolInput: GrepToolInput }
    | { toolName: 'WebFetch'; toolInput: WebFetchToolInput }
    | { toolName: 'WebSearch'; toolInput: WebSearchToolInput }
    | { toolName: 'Agent'; toolInput: AgentToolInput }
    | { toolName: 'AskUserQuestion'; toolInput: AskUserQuestionToolInput }
  )

/**
 * Context for a PreToolUse event where the tool name is not one of the 10
 * known variants (e.g. MCP tools, ExitPlanMode, future upstream tools).
 * Cast from `PreToolUseContext` when handling unknown tool names.
 *
 * @example
 * const ctx = rawCtx as unknown as UnknownPreToolUseContext
 * if (ctx.toolName.startsWith('mcp__')) { ... }
 */
export type UnknownPreToolUseContext = BaseContext & {
  event: 'PreToolUse'
  toolUseId: string
  originalToolInput: Record<string, unknown>
  toolName: string
  toolInput: Record<string, unknown>
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
