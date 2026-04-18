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
  BlockResult,
  SkipResult,
  SuccessResult,
  FailureResult,
  ContinueResult,
  StopResult,
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
  WorktreeCreateResult,
  TeammateIdleResult,
  TaskCreatedResult,
  TaskCompletedResult,
} from './results.js'

export type {
  BaseContext,
  PreToolUseContext,
  UserPromptSubmitContext,
  PermissionRequestContext,
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
} from './contexts.js'

export type { MaybeAsync, HookMeta, ClooksHook } from './hook.js'

export type {
  EventContextMap,
  EventResultMap,
  HookEventMeta,
  BeforeHookEvent,
  AfterHookEvent,
} from './lifecycle.js'
