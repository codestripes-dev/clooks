// Public type surface for clooks. Imported by hook authors and consumed by
// the bundled `.d.ts` shipped to users.

export type {
  PermissionMode,
  SessionStartSource,
  SessionEndReason,
  NotificationType,
  InstructionsMemoryType,
  InstructionsLoadReason,
  PreCompactTrigger,
  ConfigChangeSource,
} from './branded.js'

export type { StopFailureErrorType } from './claude-code.js'

export type {
  ResultTag,
  AllowResult,
  AskResult,
  BlockResult,
  DeferResult,
  SkipResult,
  SuccessResult,
  FailureResult,
  ContinueResult,
  StopResult,
  RetryResult,
  PreToolUseResult,
  UserPromptSubmitResult,
  PermissionRequestResult,
  StopEventResult,
  StopFailureResult,
  SubagentStopResult,
  ConfigChangeResult,
  SessionStartResult,
  SessionEndResult,
  InstructionsLoadedResult,
  PostToolUseResult,
  PostToolUseFailureResult,
  NotificationResult,
  SubagentStartResult,
  WorktreeRemoveResult,
  PreCompactResult,
  PostCompactResult,
  PermissionDeniedResult,
  WorktreeCreateResult,
  TeammateIdleResult,
  TaskCreatedResult,
  TaskCompletedResult,
} from './results.js'

export type {
  DebugMessage,
  InjectContext,
  Reason,
  Feedback,
  Path,
  SessionTitle,
  UpdatedPermissions,
  UpdatedMcpToolOutput,
  Interrupt,
  UpdatedInput,
  PermissionSuggestions,
  Prettify,
  Result,
  ToolVariant,
  ToolVariantWithOriginal,
  BlockOpts,
  SkipOpts,
} from './method-primitives.js'

export type {
  BaseContext,
  PreToolUseContext,
  UnknownPreToolUseContext,
  UserPromptSubmitContext,
  PermissionRequestContext,
  UnknownPermissionRequestContext,
  PermissionDeniedContext,
  StopContext,
  StopFailureContext,
  SubagentStopContext,
  ConfigChangeContext,
  SessionStartContext,
  SessionEndContext,
  InstructionsLoadedContext,
  PostToolUseContext,
  UnknownPostToolUseContext,
  PostToolUseFailureContext,
  UnknownPostToolUseFailureContext,
  NotificationContext,
  SubagentStartContext,
  WorktreeRemoveContext,
  PreCompactContext,
  PostCompactContext,
  WorktreeCreateContext,
  TeammateIdleContext,
  TaskCreatedContext,
  TaskCompletedContext,
  // Tool-input shapes — narrow via `ctx.toolName` to consume.
  BashToolInput,
  WriteToolInput,
  EditToolInput,
  ReadToolInput,
  GlobToolInput,
  GrepToolInput,
  WebFetchToolInput,
  WebSearchToolInput,
  AgentToolInput,
  AskUserQuestionToolInput,
  ToolInputMap,
} from './contexts.js'

export type {
  PermissionDestination,
  PermissionRuleBehavior,
  PermissionRule,
  PermissionUpdateEntry,
} from './permissions.js'

export type { Patch } from './patch.js'

export type { StopFailureDecisionMethods } from './decision-methods.js'

export type { MaybeAsync, HookMeta, ClooksHook } from './hook.js'

export type {
  EventContextMap,
  EventResultMap,
  HookEventMeta,
  BeforeHookEvent,
  AfterHookEvent,
  LifecyclePassthroughResult,
} from './lifecycle.js'
