// Lifecycle types: EventContextMap, EventResultMap, and the BeforeHookEvent /
// AfterHookEvent unions used by `beforeHook` / `afterHook`.

import type { EventName } from './branded.js'

import type {
  PreToolUseContext,
  PostToolUseContext,
  UserPromptSubmitContext,
  SessionStartContext,
  SessionEndContext,
  StopContext,
  StopFailureContext,
  SubagentStopContext,
  SubagentStartContext,
  InstructionsLoadedContext,
  PostToolUseFailureContext,
  NotificationContext,
  PermissionRequestContext,
  PermissionDeniedContext,
  ConfigChangeContext,
  WorktreeCreateContext,
  WorktreeRemoveContext,
  PreCompactContext,
  PostCompactContext,
  TeammateIdleContext,
  TaskCreatedContext,
  TaskCompletedContext,
} from './contexts.js'

import type {
  PreToolUseResult,
  PostToolUseResult,
  UserPromptSubmitResult,
  SessionStartResult,
  SessionEndResult,
  StopEventResult,
  StopFailureResult,
  SubagentStopResult,
  SubagentStartResult,
  InstructionsLoadedResult,
  PostToolUseFailureResult,
  NotificationResult,
  PermissionRequestResult,
  PermissionDeniedResult,
  ConfigChangeResult,
  WorktreeCreateResult,
  WorktreeRemoveResult,
  PreCompactResult,
  PostCompactResult,
  TeammateIdleResult,
  TaskCreatedResult,
  TaskCompletedResult,
  BlockResult,
  SkipResult,
} from './results.js'

/** Maps each event name to its context type. Useful for generic helpers. */
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

/** Maps each event name to its result type. Useful for generic helpers. */
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

/** Environment metadata passed to `beforeHook` / `afterHook` on every invocation. */
export interface HookEventMeta {
  /** Repo root from `git rev-parse --show-toplevel`. Null outside a git repo. */
  gitRoot: string | null
  /** Current branch. Null on detached HEAD or outside a git repo. */
  gitBranch: string | null
  platform: 'darwin' | 'linux'
  /** This hook's name (matches `meta.name`). */
  hookName: string
  /** Absolute path to the hook's `.ts` file. */
  hookPath: string
  /** ISO 8601 timestamp of engine invocation start. */
  timestamp: string
  /** clooks runtime version. */
  clooksVersion: string
  /** Path to the `clooks.yml` that registered this hook. */
  configPath: string
}

type BeforeHookEventVariants = {
  [K in EventName]: {
    type: K
    input: EventContextMap[K]
  }
}[EventName]

/**
 * Event passed to `beforeHook`. Narrow on `event.type` to access the typed
 * `event.input` (the matching context). Call `event.respond({ result: 'block' | 'skip' })`
 * to short-circuit before the per-event handler runs.
 */
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

/**
 * Event passed to `afterHook`. Narrow on `event.type` to access the typed
 * `event.input` and `event.handlerResult`. Call `event.respond(...)` to
 * override the result the engine emits.
 */
export type AfterHookEvent = {
  meta: HookEventMeta
} & AfterHookEventVariants
