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
import type {
  PreToolUseResult,
  PermissionRequestResult,
  PostToolUseResult,
  PostToolUseFailureResult,
} from './results.js'
import type {
  DebugMessage,
  InjectContext,
  Reason,
  Interrupt,
  UpdatedPermissions,
  UpdatedMcpToolOutput,
  Allow,
  Ask,
  Block,
  Defer,
  Skip,
  UpdatedInput,
  PermissionSuggestions,
  Prettify,
  ToolVariant,
  ToolVariantWithOriginal,
} from './method-primitives.js'
import type {
  UserPromptSubmitDecisionMethods,
  StopDecisionMethods,
  SubagentStopDecisionMethods,
  ConfigChangeDecisionMethods,
  PreCompactDecisionMethods,
  PermissionDeniedDecisionMethods,
  SessionStartDecisionMethods,
  SessionEndDecisionMethods,
  InstructionsLoadedDecisionMethods,
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

/** Fields present on every context, regardless of event. */
export interface BaseContext {
  /** Event name. Narrow on this first inside multi-event hooks. */
  event: EventName
  sessionId: string
  cwd: string
  permissionMode?: PermissionMode
  transcriptPath: string
  agentId?: string
  agentType?: string
  /** True when this hook is one of several running in parallel for the same event. */
  parallel: boolean
  /** Aborted when a parallel batch short-circuits. Pass to long-running async work. */
  signal: AbortSignal
}

// Tool input shapes mirror Claude Code's `tool_input`, normalized to camelCase.

/** Input for the `Bash` tool. */
export interface BashToolInput {
  command: string
  description?: string
  timeout?: number
  runInBackground?: boolean
}

/** Input for the `Write` tool. */
export interface WriteToolInput {
  filePath: string
  content: string
}

/** Input for the `Edit` tool. */
export interface EditToolInput {
  filePath: string
  oldString: string
  newString: string
  replaceAll?: boolean
}

/** Input for the `Read` tool. */
export interface ReadToolInput {
  filePath: string
  offset?: number
  limit?: number
}

/** Input for the `Glob` tool. */
export interface GlobToolInput {
  pattern: string
  path?: string
}

/** Input for the `Grep` tool. */
export interface GrepToolInput {
  pattern: string
  path?: string
  glob?: string
  outputMode?: 'content' | 'files_with_matches' | 'count' | (string & {})
  '-i'?: boolean
  multiline?: boolean
}

/** Input for the `WebFetch` tool. */
export interface WebFetchToolInput {
  url: string
  prompt: string
}

/** Input for the `WebSearch` tool. */
export interface WebSearchToolInput {
  query: string
  allowedDomains?: string[]
  blockedDomains?: string[]
}

/** Input for the `Agent` tool (subagent invocation). */
export interface AgentToolInput {
  prompt: string
  description: string
  subagentType: string
  model?: string
}

/** Input for the `AskUserQuestion` tool. */
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
 * Map of every built-in tool name to its input type. Useful for writing
 * generic helpers, e.g.:
 *
 * @example
 * function logBash(input: ToolInputMap['Bash']) { ... }
 */
export interface ToolInputMap {
  Bash: BashToolInput
  Write: WriteToolInput
  Edit: EditToolInput
  Read: ReadToolInput
  Glob: GlobToolInput
  Grep: GrepToolInput
  WebFetch: WebFetchToolInput
  WebSearch: WebSearchToolInput
  Agent: AgentToolInput
  AskUserQuestion: AskUserQuestionToolInput
}

/**
 * Verbs on `PreToolUseContext`:
 * - `allow` — proceed, optionally patching input via `updatedInput`.
 * - `ask` — surface a permission prompt (`reason` becomes the prompt).
 * - `block` — refuse (`reason` is shown to the agent).
 * - `defer` — pause for `claude -p --resume`. Honored only in `-p` mode and
 *   only when the turn has a single tool call; ignored otherwise.
 * - `skip` — let other hooks (or Claude Code's defaults) decide.
 */
export type PreToolUseDecisionMethods<Input> = Allow<
  UpdatedInput<Patch<Input>> & Partial<Reason> & InjectContext,
  PreToolUseResult
> &
  Ask<Reason & UpdatedInput<Patch<Input>> & InjectContext, PreToolUseResult> &
  Block<Reason & InjectContext, PreToolUseResult> &
  Defer<DebugMessage, PreToolUseResult> &
  Skip<InjectContext, PreToolUseResult>

/**
 * Fires before any tool call. Narrow on `ctx.toolName` for a typed
 * `ctx.toolInput` and a typed `Patch<Input>` on `updatedInput`. For tools
 * outside `ToolInputMap` (MCP, `ExitPlanMode`, future upstream additions),
 * use `UnknownPreToolUseContext`.
 *
 * @example
 * if (ctx.event !== 'PreToolUse') return ctx.skip()
 * if (ctx.toolName === 'Bash' && ctx.toolInput.command.includes('rm -rf /')) {
 *   return ctx.block({ reason: 'No.' })
 * }
 */
export type PreToolUseContext = {
  [K in keyof ToolInputMap & string]: Prettify<
    BaseContext & {
      event: 'PreToolUse'
      toolUseId: string
    } & ToolVariantWithOriginal<K, ToolInputMap[K]> &
      PreToolUseDecisionMethods<ToolInputMap[K]>
  >
}[keyof ToolInputMap & string]

/**
 * `PreToolUse` context for tools outside `ToolInputMap` (MCP, `ExitPlanMode`).
 * `toolInput` is `Record<string, unknown>` — not narrowed. Cast from raw ctx.
 *
 * @example
 * const ctx = rawCtx as unknown as UnknownPreToolUseContext
 * if (ctx.toolName.startsWith('mcp__')) { ... }
 */
export type UnknownPreToolUseContext = Prettify<
  BaseContext & {
    event: 'PreToolUse'
    toolUseId: string
  } & ToolVariantWithOriginal<string, Record<string, unknown>> &
    PreToolUseDecisionMethods<Record<string, unknown>>
>

/** Fires when the user submits a prompt. */
export type UserPromptSubmitContext = BaseContext & {
  event: 'UserPromptSubmit'
  prompt: string
} & UserPromptSubmitDecisionMethods

/**
 * Verbs on `PermissionRequestContext`:
 * - `allow` — grant the permission (optionally patching input or rules).
 * - `block` — deny. `interrupt: true` halts the agent's current turn.
 * - `skip` — let Claude Code present the normal prompt to the user.
 *
 * No `ask` or `defer` — this event is the prompt itself.
 */
export type PermissionRequestDecisionMethods<Input> = Allow<
  UpdatedInput<Patch<Input>> & UpdatedPermissions,
  PermissionRequestResult
> &
  Block<Reason & Interrupt, PermissionRequestResult> &
  Skip<DebugMessage, PermissionRequestResult>

/**
 * Fires when Claude Code is about to prompt the user for permission. The hook
 * can answer on the user's behalf. Narrow on `ctx.toolName` for a typed
 * `ctx.toolInput`; use `UnknownPermissionRequestContext` for non-built-in tools.
 *
 * `ctx.permissionSuggestions` carries the rule changes Claude Code is
 * proposing — pass them through on `allow({ updatedPermissions })` to apply.
 */
export type PermissionRequestContext = {
  [K in keyof ToolInputMap & string]: Prettify<
    BaseContext &
      PermissionSuggestions & {
        event: 'PermissionRequest'
      } & ToolVariant<K, ToolInputMap[K]> &
      PermissionRequestDecisionMethods<ToolInputMap[K]>
  >
}[keyof ToolInputMap & string]

/**
 * `PermissionRequest` context for tools outside `ToolInputMap`. Cast from raw ctx.
 *
 * @example
 * const ctx = rawCtx as unknown as UnknownPermissionRequestContext
 * if (ctx.toolName.startsWith('mcp__')) {
 *   return ctx.allow({ updatedInput: { ... } })
 * }
 */
export type UnknownPermissionRequestContext = Prettify<
  BaseContext &
    PermissionSuggestions & {
      event: 'PermissionRequest'
    } & ToolVariant<string, Record<string, unknown>> &
    PermissionRequestDecisionMethods<Record<string, unknown>>
>

/**
 * Fires when the main agent has finished its turn. `block({ reason })` forces
 * the agent to keep going; `reason` becomes the next-turn instruction.
 */
export type StopContext = BaseContext & {
  event: 'Stop'
  stopHookActive: boolean
  lastAssistantMessage: string
} & StopDecisionMethods

/** Same shape as `StopContext` but for a subagent. */
export type SubagentStopContext = BaseContext & {
  event: 'SubagentStop'
  stopHookActive: boolean
  agentId: string
  agentType: string
  agentTranscriptPath: string
  lastAssistantMessage: string
} & SubagentStopDecisionMethods

/**
 * Fires when a settings file changes. `block` is silently downgraded to `skip`
 * for `source: 'policy_settings'` — those can't be blocked upstream.
 */
export type ConfigChangeContext = BaseContext & {
  event: 'ConfigChange'
  source: ConfigChangeSource
  filePath?: string
} & ConfigChangeDecisionMethods

/**
 * Fires INSTEAD of `Stop` when the turn ended with an upstream API error
 * (rate limit, auth, billing, etc.). Output is dropped by Claude Code — use
 * the handler for logging or alerting only.
 */
export type StopFailureContext = BaseContext & {
  event: 'StopFailure'
  /** Error category. Branch your alerting on this. */
  error: StopFailureErrorType
  errorDetails?: string
  /**
   * Rendered API error string (e.g. `"API Error: Rate limit reached"`) — NOT
   * Claude's conversational text as in `Stop` / `SubagentStop`.
   */
  lastAssistantMessage?: string
} & StopFailureDecisionMethods

/**
 * Fires at session startup. Use `skip({ injectContext })` to seed the agent
 * with extra context (e.g. recent commits, open PRs, project notes).
 */
export type SessionStartContext = BaseContext & {
  event: 'SessionStart'
  source: SessionStartSource
  model?: string
} & SessionStartDecisionMethods

/** Fires at session end. Pure observer — do cleanup in the handler. */
export type SessionEndContext = BaseContext & {
  event: 'SessionEnd'
  reason: SessionEndReason
} & SessionEndDecisionMethods

/** Fires when a CLAUDE.md or rules file is loaded into context. */
export type InstructionsLoadedContext = BaseContext & {
  event: 'InstructionsLoaded'
  filePath: string
  memoryType: InstructionsMemoryType
  loadReason: InstructionsLoadReason
  globs?: string[]
  triggerFilePath?: string
  parentFilePath?: string
} & InstructionsLoadedDecisionMethods

/**
 * Verbs on `PostToolUseContext`: `block` (flag the tool result back to the
 * agent) or `skip`.
 */
export type PostToolUseDecisionMethods<_Input> = Block<
  Reason & InjectContext & UpdatedMcpToolOutput,
  PostToolUseResult
> &
  Skip<InjectContext & UpdatedMcpToolOutput, PostToolUseResult>

/**
 * Fires after a tool call succeeds. Read `ctx.toolResponse` to inspect the
 * result. Narrow on `ctx.toolName` for a typed `ctx.toolInput`; use
 * `UnknownPostToolUseContext` for non-built-in tools.
 */
export type PostToolUseContext = {
  [K in keyof ToolInputMap & string]: Prettify<
    BaseContext & {
      event: 'PostToolUse'
      toolUseId: string
      toolResponse: unknown
    } & ToolVariant<K, ToolInputMap[K]> &
      PostToolUseDecisionMethods<ToolInputMap[K]>
  >
}[keyof ToolInputMap & string]

/**
 * `PostToolUse` context for tools outside `ToolInputMap`. Cast from raw ctx.
 *
 * @example
 * const ctx = rawCtx as unknown as UnknownPostToolUseContext
 * if (ctx.toolName.startsWith('mcp__')) { ... }
 */
export type UnknownPostToolUseContext = Prettify<
  BaseContext & {
    event: 'PostToolUse'
    toolUseId: string
    toolResponse: unknown
  } & ToolVariant<string, Record<string, unknown>> &
    PostToolUseDecisionMethods<Record<string, unknown>>
>

export type PostToolUseFailureDecisionMethods<_Input> = Skip<
  InjectContext,
  PostToolUseFailureResult
>

/**
 * Fires after a tool call errors. `ctx.error` carries the error message;
 * narrow on `ctx.toolName` for typed `ctx.toolInput`. Use
 * `skip({ injectContext })` to feed extra context to the agent's retry.
 */
export type PostToolUseFailureContext = {
  [K in keyof ToolInputMap & string]: Prettify<
    BaseContext & {
      event: 'PostToolUseFailure'
      toolUseId: string
      error: string
      isInterrupt?: boolean
    } & ToolVariant<K, ToolInputMap[K]> &
      PostToolUseFailureDecisionMethods<ToolInputMap[K]>
  >
}[keyof ToolInputMap & string]

/**
 * `PostToolUseFailure` context for tools outside `ToolInputMap`. Cast from raw ctx.
 *
 * @example
 * const ctx = rawCtx as unknown as UnknownPostToolUseFailureContext
 * if (ctx.toolName.startsWith('mcp__')) { ... }
 */
export type UnknownPostToolUseFailureContext = Prettify<
  BaseContext & {
    event: 'PostToolUseFailure'
    toolUseId: string
    error: string
    isInterrupt?: boolean
  } & ToolVariant<string, Record<string, unknown>> &
    PostToolUseFailureDecisionMethods<Record<string, unknown>>
>

/** Fires when Claude Code is about to show a notification. */
export type NotificationContext = BaseContext & {
  event: 'Notification'
  message: string
  title?: string
  notificationType?: NotificationType
} & NotificationDecisionMethods

/**
 * Fires when a subagent is spawned via the `Agent` tool. Use
 * `skip({ injectContext })` to seed the subagent.
 */
export type SubagentStartContext = BaseContext & {
  event: 'SubagentStart'
  agentId: string
  agentType: string
} & SubagentStartDecisionMethods

/** Fires when a worktree is being removed. Pure observer; useful for cleanup. */
export type WorktreeRemoveContext = BaseContext & {
  event: 'WorktreeRemove'
  worktreePath: string
} & WorktreeRemoveDecisionMethods

/** Fires before Claude Code compacts the conversation. `block` cancels it. */
export type PreCompactContext = BaseContext & {
  event: 'PreCompact'
  trigger: PreCompactTrigger
  customInstructions: string
} & PreCompactDecisionMethods

/** Fires after a compaction completes. Pure observer. */
export type PostCompactContext = BaseContext & {
  event: 'PostCompact'
  trigger: PreCompactTrigger
  compactSummary: string
} & PostCompactDecisionMethods

/**
 * Fires in auto mode when the permission classifier denies a tool call. Hooks
 * cannot reverse the denial; `retry` only hints that the model may try again.
 */
export type PermissionDeniedContext = BaseContext & {
  event: 'PermissionDenied'
  toolName: string
  /** Tool input as Claude Code received it. Keys are camelCase. */
  toolInput: Record<string, unknown>
  toolUseId: string
  /** The classifier's explanation for the denial. */
  denialReason: string
} & PermissionDeniedDecisionMethods

/**
 * Fires when Claude Code needs a worktree. Your hook REPLACES the default
 * `git worktree` behavior — return `success({ path })` with the absolute path
 * to the worktree you created, or `failure({ reason })`.
 */
export type WorktreeCreateContext = BaseContext & {
  event: 'WorktreeCreate'
  name: string
} & WorktreeCreateDecisionMethods

/**
 * Fires when an agent-team teammate is about to go idle.
 * `continue({ feedback })` pushes another step; `stop({ reason })` terminates
 * the teammate.
 */
export type TeammateIdleContext = BaseContext & {
  event: 'TeammateIdle'
  teammateName: string
  teamName: string
} & TeammateIdleDecisionMethods

/**
 * Fires when a teammate is creating a task. `continue({ feedback })` refuses
 * creation and feeds `feedback` back to the model; `stop({ reason })`
 * terminates the teammate.
 */
export type TaskCreatedContext = BaseContext & {
  event: 'TaskCreated'
  taskId: string
  taskSubject: string
  taskDescription?: string
  teammateName?: string
  teamName?: string
} & TaskCreatedDecisionMethods

/**
 * Fires when a teammate is marking a task complete. `continue({ feedback })`
 * refuses completion; `stop({ reason })` terminates the teammate.
 */
export type TaskCompletedContext = BaseContext & {
  event: 'TaskCompleted'
  taskId: string
  taskSubject: string
  taskDescription?: string
  teammateName?: string
  teamName?: string
} & TaskCompletedDecisionMethods
