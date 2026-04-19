// The ClooksHook contract. A hook file exports a single typed object.
// Reference: docs/plans/2026-03-08-hook-type-system-design.md

import type {
  PreToolUseContext,
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
  StopFailureContext,
  WorktreeCreateContext,
  TeammateIdleContext,
  TaskCreatedContext,
  TaskCompletedContext,
} from './contexts.js'

import type {
  PreToolUseResult,
  UserPromptSubmitResult,
  PermissionRequestResult,
  PermissionDeniedResult,
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
  StopFailureResult,
  WorktreeCreateResult,
  TeammateIdleResult,
  TaskCreatedResult,
  TaskCompletedResult,
} from './results.js'

import type { BeforeHookEvent, AfterHookEvent } from './lifecycle.js'

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

  // Guard events
  PreToolUse?: (ctx: PreToolUseContext, config: C) => MaybeAsync<PreToolUseResult>
  UserPromptSubmit?: (ctx: UserPromptSubmitContext, config: C) => MaybeAsync<UserPromptSubmitResult>
  PermissionRequest?: (
    ctx: PermissionRequestContext,
    config: C,
  ) => MaybeAsync<PermissionRequestResult>
  Stop?: (ctx: StopContext, config: C) => MaybeAsync<StopEventResult>
  SubagentStop?: (ctx: SubagentStopContext, config: C) => MaybeAsync<SubagentStopResult>
  ConfigChange?: (ctx: ConfigChangeContext, config: C) => MaybeAsync<ConfigChangeResult>

  // Observe events
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

  // Notify-only events
  StopFailure?: (ctx: StopFailureContext, config: C) => MaybeAsync<StopFailureResult>

  // Implementation events
  WorktreeCreate?: (ctx: WorktreeCreateContext, config: C) => MaybeAsync<WorktreeCreateResult>

  // Continuation events
  TeammateIdle?: (ctx: TeammateIdleContext, config: C) => MaybeAsync<TeammateIdleResult>
  TaskCreated?: (ctx: TaskCreatedContext, config: C) => MaybeAsync<TaskCreatedResult>
  TaskCompleted?: (ctx: TaskCompletedContext, config: C) => MaybeAsync<TaskCompletedResult>
}
