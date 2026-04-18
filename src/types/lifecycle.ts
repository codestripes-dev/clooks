// Lifecycle types for beforeHook / afterHook.
// Reference: docs/plans/hook-lifecycle/M1-type-foundation.md

import type { EventName } from './branded.js'

import type {
  PreToolUseContext,
  PostToolUseContext,
  UserPromptSubmitContext,
  SessionStartContext,
  SessionEndContext,
  StopContext,
  SubagentStopContext,
  SubagentStartContext,
  InstructionsLoadedContext,
  PostToolUseFailureContext,
  NotificationContext,
  PermissionRequestContext,
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
  SubagentStopResult,
  SubagentStartResult,
  InstructionsLoadedResult,
  PostToolUseFailureResult,
  NotificationResult,
  PermissionRequestResult,
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
