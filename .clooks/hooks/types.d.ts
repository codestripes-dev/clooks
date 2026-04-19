// Clooks v0.0.1 — generated type declarations
// Do not edit. Regenerate with: clooks types
type EventName =
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
export type PermissionDestination =
  | 'session'
  | 'localSettings'
  | 'projectSettings'
  | 'userSettings'
  | (string & {})
export type PermissionRuleBehavior = 'allow' | 'deny' | 'ask' | (string & {})
/** A single permission rule entry. `ruleContent` omitted = match the whole tool. */
export interface PermissionRule {
  toolName: string
  ruleContent?: string
}
/** Discriminated by the `type` field. Used for both PermissionRequest's
 *  `permission_suggestions` input and the `updatedPermissions` allow output. */
export type PermissionUpdateEntry =
  | {
      type: 'addRules'
      rules: PermissionRule[]
      behavior: PermissionRuleBehavior
      destination: PermissionDestination
    }
  | {
      type: 'replaceRules'
      rules: PermissionRule[]
      behavior: PermissionRuleBehavior
      destination: PermissionDestination
    }
  | {
      type: 'removeRules'
      rules: PermissionRule[]
      behavior: PermissionRuleBehavior
      destination: PermissionDestination
    }
  | {
      type: 'setMode'
      mode: PermissionMode
      destination: PermissionDestination
    }
  | {
      type: 'addDirectories'
      directories: string[]
      destination: PermissionDestination
    }
  | {
      type: 'removeDirectories'
      directories: string[]
      destination: PermissionDestination
    }
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
export type RetryResult = DebugFields & {
  result: 'retry'
}
/**
 * PreToolUse `ask` decision. Upstream displays the permission prompt
 * to the user with permissionDecisionReason as the prompt text.
 * The source label ([Project]/[User]/[Plugin]/[Local]) is added by
 * Claude Code — reason should disambiguate which hook asked.
 */
export type AskResult = DebugFields & {
  result: 'ask'
  /** Required. Shown to the user in the confirmation prompt. */
  reason: string
}
/**
 * PreToolUse `defer` decision. Pauses the tool call so a headless
 * `claude -p` caller can resume via `claude -p --resume`. Only honored
 * in -p mode AND only when the turn contains a single tool call.
 * Otherwise Claude Code ignores this result.
 *
 * Upstream ignores reason / updatedInput / additionalContext for
 * defer. This type forbids all three at compile time.
 */
export type DeferResult = DebugFields & {
  result: 'defer'
}
export type PreToolUseResult =
  | (AllowResult &
      InjectableContext & {
        /** Modified tool input to pass to subsequent hooks and/or Claude Code. */
        updatedInput?: Record<string, unknown>
        /**
         * Optional. When present, surfaced as
         * hookSpecificOutput.permissionDecisionReason on allow.
         * Shown to the user per upstream's decision-control contract.
         */
        reason?: string
      })
  | (AskResult &
      InjectableContext & {
        updatedInput?: Record<string, unknown>
      })
  | (BlockResult & InjectableContext)
  | DeferResult
  | (SkipResult & InjectableContext)
export type UserPromptSubmitResult = (AllowResult | BlockResult | SkipResult) &
  InjectableContext & {
    sessionTitle?: string
  }
export type PermissionRequestResult =
  | (AllowResult & {
      updatedInput?: Record<string, unknown>
      updatedPermissions?: PermissionUpdateEntry[]
    })
  | (BlockResult & {
      interrupt?: boolean
    })
  | SkipResult
export type StopEventResult = AllowResult | BlockResult | SkipResult
export type SubagentStopResult = AllowResult | BlockResult | SkipResult
export type ConfigChangeResult = AllowResult | BlockResult | SkipResult
export type PreCompactResult = AllowResult | BlockResult | SkipResult
type StopFailureResult = SkipResult
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
export type PermissionDeniedResult = RetryResult | SkipResult
export type WorktreeCreateResult = SuccessResult | FailureResult
export type TeammateIdleResult = ContinueResult | StopResult | SkipResult
export type TaskCreatedResult = ContinueResult | StopResult | SkipResult
export type TaskCompletedResult = ContinueResult | StopResult | SkipResult
type StopFailureErrorType =
  | 'rate_limit'
  | 'authentication_failed'
  | 'billing_error'
  | 'invalid_request'
  | 'server_error'
  | 'max_output_tokens'
  | 'unknown'
  | (string & {})
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
    options: Array<{
      label: string
    }>
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
    | {
        toolName: 'Bash'
        toolInput: BashToolInput
      }
    | {
        toolName: 'Write'
        toolInput: WriteToolInput
      }
    | {
        toolName: 'Edit'
        toolInput: EditToolInput
      }
    | {
        toolName: 'Read'
        toolInput: ReadToolInput
      }
    | {
        toolName: 'Glob'
        toolInput: GlobToolInput
      }
    | {
        toolName: 'Grep'
        toolInput: GrepToolInput
      }
    | {
        toolName: 'WebFetch'
        toolInput: WebFetchToolInput
      }
    | {
        toolName: 'WebSearch'
        toolInput: WebSearchToolInput
      }
    | {
        toolName: 'Agent'
        toolInput: AgentToolInput
      }
    | {
        toolName: 'AskUserQuestion'
        toolInput: AskUserQuestionToolInput
      }
    | {
        toolName: string
        toolInput: Record<string, unknown>
      }
  )
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
interface StopFailureContext extends BaseContext {
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
  StopFailure: StopFailureContext
  SubagentStop: SubagentStopContext
  SubagentStart: SubagentStartContext
  InstructionsLoaded: InstructionsLoadedContext
  PostToolUseFailure: PostToolUseFailureContext
  Notification: NotificationContext
  PermissionRequest: PermissionRequestContext
  PermissionDenied: PermissionDeniedContext
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
  StopFailure: StopFailureResult
  SubagentStop: SubagentStopResult
  SubagentStart: SubagentStartResult
  InstructionsLoaded: InstructionsLoadedResult
  PostToolUseFailure: PostToolUseFailureResult
  Notification: NotificationResult
  PermissionRequest: PermissionRequestResult
  PermissionDenied: PermissionDeniedResult
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
  PermissionDenied?: (ctx: PermissionDeniedContext, config: C) => MaybeAsync<PermissionDeniedResult>
  StopFailure?: (ctx: StopFailureContext, config: C) => MaybeAsync<StopFailureResult>
  WorktreeCreate?: (ctx: WorktreeCreateContext, config: C) => MaybeAsync<WorktreeCreateResult>
  TeammateIdle?: (ctx: TeammateIdleContext, config: C) => MaybeAsync<TeammateIdleResult>
  TaskCreated?: (ctx: TaskCreatedContext, config: C) => MaybeAsync<TaskCreatedResult>
  TaskCompleted?: (ctx: TaskCompletedContext, config: C) => MaybeAsync<TaskCompletedResult>
}

export {}
