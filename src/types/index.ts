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
} from "./branded.js"

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
  WorktreeCreateResult,
  TeammateIdleResult,
  TaskCompletedResult,
} from "./results.js"

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
  WorktreeCreateContext,
  TeammateIdleContext,
  TaskCompletedContext,
} from "./contexts.js"

export type {
  MaybeAsync,
  HookMeta,
  ClooksHook,
} from "./hook.js"
