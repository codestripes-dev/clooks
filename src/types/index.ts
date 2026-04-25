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

// Re-export StopFailureErrorType so the bundled `.d.ts` emits it as `export type`
// rather than dropping the `export` keyword (dts-bundle-generator default for
// types only referenced internally). Required for hook authors who import the
// type directly. See PLAN-FEAT-0063 Surprises "M3 finding ... StopFailure*".
export type { StopFailureErrorType } from './claude-code.js'

export type {
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
  Inject,
  Reason,
  Feedback,
  Path,
  SessionTitle,
  UpdatedPermissions,
  UpdatedMcpToolOutput,
  Interrupt,
  UpdatedInput,
  OptionalReason,
  PermissionSuggestions,
  OriginalToolInput,
  OriginalToolInputOptional,
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

export type { Patch } from './patch.js'

// Re-export StopFailureDecisionMethods so the bundled `.d.ts` emits it as
// `export type`. The other per-event DecisionMethods types stay internal —
// they're intersected into contexts and rarely imported by name. StopFailure
// is called out explicitly per the plan's M3 surprise + M4 verification gate.
export type { StopFailureDecisionMethods } from './decision-methods.js'

export type { MaybeAsync, HookMeta, ClooksHook } from './hook.js'

export type {
  EventContextMap,
  EventResultMap,
  HookEventMeta,
  BeforeHookEvent,
  AfterHookEvent,
} from './lifecycle.js'
