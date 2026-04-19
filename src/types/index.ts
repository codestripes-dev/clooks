// Public API for @clooks/types.
// Re-exports everything consumers need.

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

export type {
  DebugFields,
  InjectableContext,
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
  BaseContext,
  PreToolUseContext,
  UnknownPreToolUseContext,
  UserPromptSubmitContext,
  PermissionRequestContext,
  PermissionDeniedContext,
  StopContext,
  SubagentStopContext,
  ConfigChangeContext,
  SessionStartContext,
  SessionEndContext,
  InstructionsLoadedContext,
  PostToolUseContext,
  PostToolUseFailureContext,
  NotificationContext,
  SubagentStartContext,
  WorktreeRemoveContext,
  PreCompactContext,
  PostCompactContext,
  WorktreeCreateContext,
  TeammateIdleContext,
  TaskCreatedContext,
  TaskCompletedContext,
  // PreToolUse tool input types — narrow via ctx.toolName discriminant
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
} from './contexts.js'

export type {
  PermissionDestination,
  PermissionRuleBehavior,
  PermissionRule,
  PermissionUpdateEntry,
} from './permissions.js'

export type { MaybeAsync, HookMeta, ClooksHook } from './hook.js'

export type {
  EventContextMap,
  EventResultMap,
  HookEventMeta,
  BeforeHookEvent,
  AfterHookEvent,
} from './lifecycle.js'
