// The shape every hook file exports.

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

/** A handler return type that may be sync or async. */
export type MaybeAsync<T> = T | Promise<T>

/** The `meta` export every hook file must produce. */
export interface HookMeta<C extends Record<string, unknown> = Record<string, unknown>> {
  /** Human-readable name. Must be unique within a project. */
  name: string
  /** Optional one-liner describing what the hook does. */
  description?: string
  /** Default config for this hook. Users can override via `clooks.yml`. */
  config?: C
}

/**
 * The full hook contract. One per `.ts` file: export a `meta` plus one or
 * more event handlers, e.g.:
 *
 * @example
 * export const meta: HookMeta = { name: 'guard-rm-rf' }
 * export default {
 *   meta,
 *   PreToolUse(ctx) {
 *     if (ctx.toolName === 'Bash' && ctx.toolInput.command.includes('rm -rf /')) {
 *       return ctx.block({ reason: 'No.' })
 *     }
 *     return ctx.skip()
 *   },
 * } satisfies ClooksHook
 */
export interface ClooksHook<C extends Record<string, unknown> = Record<string, unknown>> {
  meta: HookMeta<C>

  /** Runs before the matched event handler. Call `event.respond()` to short-circuit. */
  beforeHook?: (event: BeforeHookEvent, config: C) => MaybeAsync<void>
  /** Runs after the matched event handler. Call `event.respond()` to override the result. */
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
