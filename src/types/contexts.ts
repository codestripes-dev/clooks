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
import type { Patch } from './patch.js'
import type { PreToolUseResult, PermissionRequestResult } from './results.js'
import type {
  DebugMessage,
  Inject,
  Reason,
  Interrupt,
  UpdatedPermissions,
  Allow,
  Ask,
  Block,
  Defer,
  Skip,
  UpdatedInput,
  OptionalReason,
  PermissionSuggestions,
  OriginalToolInput,
  OriginalToolInputOptional,
} from './method-primitives.js'
import type {
  UserPromptSubmitDecisionMethods,
  StopDecisionMethods,
  SubagentStopDecisionMethods,
  ConfigChangeDecisionMethods,
  PreCompactDecisionMethods,
  PostToolUseDecisionMethods,
  PermissionDeniedDecisionMethods,
  SessionStartDecisionMethods,
  SessionEndDecisionMethods,
  InstructionsLoadedDecisionMethods,
  PostToolUseFailureDecisionMethods,
  NotificationDecisionMethods,
  SubagentStartDecisionMethods,
  WorktreeRemoveDecisionMethods,
  PostCompactDecisionMethods,
  StopFailureDecisionMethods,
  WorktreeCreateDecisionMethods,
  TeammateIdleDecisionMethods,
  TaskCreatedDecisionMethods,
  TaskCompletedDecisionMethods,
} from './decision-methods.js'

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

/**
 * Per-variant decision-method set for `PreToolUseContext`. Intersected onto each
 * tool-arm of the DU so that `ctx.allow({ updatedInput })` receives a typed
 * `Patch<NarrowedToolInput>` after a `ctx.toolName` discriminant check.
 *
 * The methods are pure value constructors — see `src/engine/context-methods.ts`.
 *
 * `defer` is honored only in `claude -p` mode AND only when the turn contains
 * a single tool call. Otherwise upstream Claude Code logs a warning and
 * ignores it. Requires Claude Code v2.1.89+. Upstream ignores `reason`,
 * `updatedInput`, and `additionalContext` for `defer` — the opts bag carries
 * only `debugMessage`.
 */
export type PreToolUseDecisionMethods<Input> = Allow<
  UpdatedInput<Patch<Input>> & OptionalReason & DebugMessage & Inject,
  PreToolUseResult
> &
  Ask<Reason & UpdatedInput<Patch<Input>> & Inject, PreToolUseResult> &
  Block<Reason & Inject, PreToolUseResult> &
  Defer<DebugMessage, PreToolUseResult> &
  Skip<DebugMessage & Inject, PreToolUseResult>

/**
 * Distributes `PreToolUseDecisionMethods<V['toolInput']>` over each variant of
 * the input DU `V`. Required because TS does not narrow method-parameter types
 * unless the methods are declared per-variant of the discriminated union.
 */
type WithPreToolUseMethods<V> = V extends { toolInput: infer Input }
  ? V & PreToolUseDecisionMethods<Input>
  : never

type PreToolUseVariant = BaseContext &
  OriginalToolInput & {
    event: 'PreToolUse'
    toolUseId: string
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

export type PreToolUseContext = WithPreToolUseMethods<PreToolUseVariant>

/**
 * Context for a PreToolUse event where the tool name is not one of the 10
 * known variants (e.g. MCP tools, ExitPlanMode, future upstream tools).
 * Cast from `PreToolUseContext` when handling unknown tool names.
 *
 * @example
 * const ctx = rawCtx as unknown as UnknownPreToolUseContext
 * if (ctx.toolName.startsWith('mcp__')) { ... }
 */
export type UnknownPreToolUseContext = BaseContext &
  OriginalToolInput & {
    event: 'PreToolUse'
    toolUseId: string
    toolName: string
    toolInput: Record<string, unknown>
  } & PreToolUseDecisionMethods<Record<string, unknown>>

export type UserPromptSubmitContext = BaseContext & {
  event: 'UserPromptSubmit'
  prompt: string
} & UserPromptSubmitDecisionMethods

/**
 * Per-variant decision-method set for `PermissionRequestContext`. Intersected
 * onto each tool-arm of the DU so that `permCtx.allow({ updatedInput })`
 * receives a typed `Patch<NarrowedToolInput>` after a `permCtx.toolName`
 * discriminant check. Mirrors the `PreToolUseDecisionMethods` pattern.
 *
 * `PermissionRequestResult` only models three result tags (allow / block /
 * skip) — there is no `ask` / `defer` here.
 */
export type PermissionRequestDecisionMethods<Input> = Allow<
  UpdatedInput<Patch<Input>> & UpdatedPermissions & DebugMessage,
  PermissionRequestResult
> &
  Block<Reason & Interrupt, PermissionRequestResult> &
  Skip<DebugMessage, PermissionRequestResult>

/**
 * Distributes `PermissionRequestDecisionMethods<V['toolInput']>` over each
 * variant of the input DU `V`. See the comment on `WithPreToolUseMethods` for
 * the rationale.
 */
type WithPermissionRequestMethods<V> = V extends { toolInput: infer Input }
  ? V & PermissionRequestDecisionMethods<Input>
  : never

type PermissionRequestVariant = BaseContext &
  PermissionSuggestions & {
    event: 'PermissionRequest'
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

export type PermissionRequestContext = WithPermissionRequestMethods<PermissionRequestVariant>

/**
 * Context for a PermissionRequest event where the tool name is not one of the
 * 10 known variants (e.g. MCP tools, future upstream tools). Sibling to
 * `UnknownPreToolUseContext`. Cast from raw ctx when handling unknown tool
 * names.
 *
 * @example
 * const ctx = rawCtx as unknown as UnknownPermissionRequestContext
 * if (ctx.toolName.startsWith('mcp__')) {
 *   return ctx.allow({ updatedInput: { ... } })
 * }
 */
export type UnknownPermissionRequestContext = BaseContext &
  PermissionSuggestions & {
    event: 'PermissionRequest'
    toolName: string
    toolInput: Record<string, unknown>
  } & PermissionRequestDecisionMethods<Record<string, unknown>>

export type StopContext = BaseContext & {
  event: 'Stop'
  stopHookActive: boolean
  lastAssistantMessage: string
} & StopDecisionMethods

export type SubagentStopContext = BaseContext & {
  event: 'SubagentStop'
  stopHookActive: boolean
  agentId: string
  agentType: string
  agentTranscriptPath: string
  lastAssistantMessage: string
} & SubagentStopDecisionMethods

export type ConfigChangeContext = BaseContext & {
  event: 'ConfigChange'
  source: ConfigChangeSource
  filePath?: string
} & ConfigChangeDecisionMethods

// --- Notify-only events ---

export type StopFailureContext = BaseContext & {
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
} & StopFailureDecisionMethods

// --- Observe events ---

export type SessionStartContext = BaseContext & {
  event: 'SessionStart'
  source: SessionStartSource
  model?: string
} & SessionStartDecisionMethods

export type SessionEndContext = BaseContext & {
  event: 'SessionEnd'
  reason: SessionEndReason
} & SessionEndDecisionMethods

export type InstructionsLoadedContext = BaseContext & {
  event: 'InstructionsLoaded'
  filePath: string
  memoryType: InstructionsMemoryType
  loadReason: InstructionsLoadReason
  globs?: string[]
  triggerFilePath?: string
  parentFilePath?: string
} & InstructionsLoadedDecisionMethods

export type PostToolUseContext = BaseContext &
  OriginalToolInputOptional & {
    event: 'PostToolUse'
    toolName: string
    toolInput: Record<string, unknown>
    toolResponse: unknown
    toolUseId: string
  } & PostToolUseDecisionMethods

export type PostToolUseFailureContext = BaseContext &
  OriginalToolInputOptional & {
    event: 'PostToolUseFailure'
    toolName: string
    toolInput: Record<string, unknown>
    toolUseId: string
    error: string
    isInterrupt?: boolean
  } & PostToolUseFailureDecisionMethods

export type NotificationContext = BaseContext & {
  event: 'Notification'
  message: string
  title?: string
  notificationType?: NotificationType
} & NotificationDecisionMethods

export type SubagentStartContext = BaseContext & {
  event: 'SubagentStart'
  agentId: string
  agentType: string
} & SubagentStartDecisionMethods

export type WorktreeRemoveContext = BaseContext & {
  event: 'WorktreeRemove'
  worktreePath: string
} & WorktreeRemoveDecisionMethods

export type PreCompactContext = BaseContext & {
  event: 'PreCompact'
  trigger: PreCompactTrigger
  customInstructions: string
} & PreCompactDecisionMethods

export type PostCompactContext = BaseContext & {
  event: 'PostCompact'
  trigger: PreCompactTrigger
  compactSummary: string
} & PostCompactDecisionMethods

export type PermissionDeniedContext = BaseContext & {
  event: 'PermissionDenied'
  toolName: string
  /** Tool input as provided to Claude Code. Keys are camelCase. */
  toolInput: Record<string, unknown>
  toolUseId: string
  /** The classifier's explanation for why the tool call was denied. */
  denialReason: string
} & PermissionDeniedDecisionMethods

// --- Implementation events ---

export type WorktreeCreateContext = BaseContext & {
  event: 'WorktreeCreate'
  name: string
} & WorktreeCreateDecisionMethods

// --- Continuation events ---

export type TeammateIdleContext = BaseContext & {
  event: 'TeammateIdle'
  teammateName: string
  teamName: string
} & TeammateIdleDecisionMethods

export type TaskCreatedContext = BaseContext & {
  event: 'TaskCreated'
  taskId: string
  taskSubject: string
  taskDescription?: string
  teammateName?: string
  teamName?: string
} & TaskCreatedDecisionMethods

export type TaskCompletedContext = BaseContext & {
  event: 'TaskCompleted'
  taskId: string
  taskSubject: string
  taskDescription?: string
  teammateName?: string
  teamName?: string
} & TaskCompletedDecisionMethods
