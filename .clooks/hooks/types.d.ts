// Clooks v0.0.1 — generated type declarations
// Do not edit. Regenerate with: clooks types
type EventName =
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
/** Optional debug info, only visible in debug mode. */
export interface DebugFields {
  debugMessage?: string
}
/**
 * Text injected into the agent's conversation.
 * Maps to Claude Code's `additionalContext` output field.
 * Only available on events whose Claude Code contract supports it.
 */
export interface InjectableContext {
  injectContext?: string
}
export type AllowResult = DebugFields & {
  result: 'allow'
}
export type BlockResult = DebugFields & {
  result: 'block'
  /** Required. Shown to the agent (guard events) or user (continuation events). */
  reason: string
}
export type SkipResult = DebugFields & {
  result: 'skip'
}
export type SuccessResult = DebugFields & {
  result: 'success'
  /** Absolute path to the created worktree. */
  path: string
}
export type FailureResult = DebugFields & {
  result: 'failure'
  reason: string
}
export type ContinueResult = DebugFields & {
  result: 'continue'
  /** Required. Tells the teammate what to do next. */
  feedback: string
}
export type StopResult = DebugFields & {
  result: 'stop'
  reason: string
}
export type PreToolUseResult =
  | (AllowResult &
      InjectableContext & {
        /** Modified tool input to pass to subsequent hooks and/or Claude Code. */
        updatedInput?: Record<string, unknown>
      })
  | (BlockResult & InjectableContext)
  | (SkipResult & InjectableContext)
export type UserPromptSubmitResult = (AllowResult | BlockResult | SkipResult) & InjectableContext
export type PermissionRequestResult =
  | (AllowResult & {
      updatedInput?: Record<string, unknown>
      updatedPermissions?: unknown[]
    })
  | (BlockResult & {
      interrupt?: boolean
    })
  | SkipResult
export type StopEventResult = AllowResult | BlockResult | SkipResult
export type SubagentStopResult = AllowResult | BlockResult | SkipResult
export type ConfigChangeResult = AllowResult | BlockResult | SkipResult
export type PreCompactResult = AllowResult | BlockResult | SkipResult
export type SessionStartResult = SkipResult & InjectableContext
export type SessionEndResult = SkipResult
export type InstructionsLoadedResult = SkipResult
export type PostToolUseResult =
  | (SkipResult &
      InjectableContext & {
        updatedMCPToolOutput?: unknown
      })
  | (BlockResult &
      InjectableContext & {
        updatedMCPToolOutput?: unknown
      })
export type PostToolUseFailureResult = SkipResult & InjectableContext
export type NotificationResult = SkipResult & InjectableContext
export type SubagentStartResult = SkipResult & InjectableContext
export type WorktreeRemoveResult = SkipResult
export type PostCompactResult = SkipResult
export type WorktreeCreateResult = SuccessResult | FailureResult
export type TeammateIdleResult = ContinueResult | StopResult | SkipResult
export type TaskCreatedResult = ContinueResult | StopResult | SkipResult
export type TaskCompletedResult = ContinueResult | StopResult | SkipResult
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
  permissionSuggestions?: unknown[]
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
  notificationType: NotificationType
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
export interface WorktreeCreateContext extends BaseContext {
  event: 'WorktreeCreate'
  name: string
}
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
export interface EventContextMap extends Record<EventName, unknown> {
  PreToolUse: PreToolUseContext
  PostToolUse: PostToolUseContext
  UserPromptSubmit: UserPromptSubmitContext
  SessionStart: SessionStartContext
  SessionEnd: SessionEndContext
  Stop: StopContext
  SubagentStop: SubagentStopContext
  SubagentStart: SubagentStartContext
  InstructionsLoaded: InstructionsLoadedContext
  PostToolUseFailure: PostToolUseFailureContext
  Notification: NotificationContext
  PermissionRequest: PermissionRequestContext
  ConfigChange: ConfigChangeContext
  WorktreeCreate: WorktreeCreateContext
  WorktreeRemove: WorktreeRemoveContext
  PreCompact: PreCompactContext
  PostCompact: PostCompactContext
  TeammateIdle: TeammateIdleContext
  TaskCreated: TaskCreatedContext
  TaskCompleted: TaskCompletedContext
}
export interface EventResultMap extends Record<EventName, unknown> {
  PreToolUse: PreToolUseResult
  PostToolUse: PostToolUseResult
  UserPromptSubmit: UserPromptSubmitResult
  SessionStart: SessionStartResult
  SessionEnd: SessionEndResult
  Stop: StopEventResult
  SubagentStop: SubagentStopResult
  SubagentStart: SubagentStartResult
  InstructionsLoaded: InstructionsLoadedResult
  PostToolUseFailure: PostToolUseFailureResult
  Notification: NotificationResult
  PermissionRequest: PermissionRequestResult
  ConfigChange: ConfigChangeResult
  WorktreeCreate: WorktreeCreateResult
  WorktreeRemove: WorktreeRemoveResult
  PreCompact: PreCompactResult
  PostCompact: PostCompactResult
  TeammateIdle: TeammateIdleResult
  TaskCreated: TaskCreatedResult
  TaskCompleted: TaskCompletedResult
}
export interface HookEventMeta {
  /** Repo root via `git rev-parse --show-toplevel`. Null if not in a git repo. */
  gitRoot: string | null
  /** Current branch. Null if detached HEAD or not in a git repo. */
  gitBranch: string | null
  /** OS platform. */
  platform: 'darwin' | 'linux'
  /** This hook's name (same as meta.name). */
  hookName: string
  /** Absolute path to the hook's .ts file. */
  hookPath: string
  /** ISO 8601 timestamp of engine invocation start. */
  timestamp: string
  /** Runtime version string. */
  clooksVersion: string
  /** Path to the clooks.yml that registered this hook. */
  configPath: string
}
type BeforeHookEventVariants = {
  [K in EventName]: {
    type: K
    input: EventContextMap[K]
  }
}[EventName]
export type BeforeHookEvent = {
  meta: HookEventMeta
  respond(result: BlockResult | SkipResult): void
} & BeforeHookEventVariants
type AfterHookEventVariants = {
  [K in EventName]: {
    type: K
    input: EventContextMap[K]
    handlerResult: EventResultMap[K]
    respond(result: EventResultMap[K]): void
  }
}[EventName]
export type AfterHookEvent = {
  meta: HookEventMeta
} & AfterHookEventVariants
export type MaybeAsync<T> = T | Promise<T>
export interface HookMeta<C extends Record<string, unknown> = Record<string, unknown>> {
  /** Human-readable name. Must be unique within a project. */
  name: string
  /** Optional description. */
  description?: string
  /** Config defaults. Must satisfy the Config interface. */
  config?: C
}
export interface ClooksHook<C extends Record<string, unknown> = Record<string, unknown>> {
  meta: HookMeta<C>
  /** Runs before the matched event handler. Call event.respond() to block. */
  beforeHook?: (event: BeforeHookEvent, config: C) => MaybeAsync<void>
  /** Runs after the matched event handler completes normally. Call event.respond() to override. */
  afterHook?: (event: AfterHookEvent, config: C) => MaybeAsync<void>
  PreToolUse?: (ctx: PreToolUseContext, config: C) => MaybeAsync<PreToolUseResult>
  UserPromptSubmit?: (ctx: UserPromptSubmitContext, config: C) => MaybeAsync<UserPromptSubmitResult>
  PermissionRequest?: (
    ctx: PermissionRequestContext,
    config: C,
  ) => MaybeAsync<PermissionRequestResult>
  Stop?: (ctx: StopContext, config: C) => MaybeAsync<StopEventResult>
  SubagentStop?: (ctx: SubagentStopContext, config: C) => MaybeAsync<SubagentStopResult>
  ConfigChange?: (ctx: ConfigChangeContext, config: C) => MaybeAsync<ConfigChangeResult>
  SessionStart?: (ctx: SessionStartContext, config: C) => MaybeAsync<SessionStartResult>
  SessionEnd?: (ctx: SessionEndContext, config: C) => MaybeAsync<SessionEndResult>
  InstructionsLoaded?: (
    ctx: InstructionsLoadedContext,
    config: C,
  ) => MaybeAsync<InstructionsLoadedResult>
  PostToolUse?: (ctx: PostToolUseContext, config: C) => MaybeAsync<PostToolUseResult>
  PostToolUseFailure?: (
    ctx: PostToolUseFailureContext,
    config: C,
  ) => MaybeAsync<PostToolUseFailureResult>
  Notification?: (ctx: NotificationContext, config: C) => MaybeAsync<NotificationResult>
  SubagentStart?: (ctx: SubagentStartContext, config: C) => MaybeAsync<SubagentStartResult>
  WorktreeRemove?: (ctx: WorktreeRemoveContext, config: C) => MaybeAsync<WorktreeRemoveResult>
  PreCompact?: (ctx: PreCompactContext, config: C) => MaybeAsync<PreCompactResult>
  PostCompact?: (ctx: PostCompactContext, config: C) => MaybeAsync<PostCompactResult>
  WorktreeCreate?: (ctx: WorktreeCreateContext, config: C) => MaybeAsync<WorktreeCreateResult>
  TeammateIdle?: (ctx: TeammateIdleContext, config: C) => MaybeAsync<TeammateIdleResult>
  TaskCreated?: (ctx: TaskCreatedContext, config: C) => MaybeAsync<TaskCreatedResult>
  TaskCompleted?: (ctx: TaskCompletedContext, config: C) => MaybeAsync<TaskCompletedResult>
}

export {}
