// Clooks v0.1.2 — generated type declarations
// Do not edit. Regenerate with: clooks types
type EventName =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'UserPromptSubmit'
  | 'SessionStart'
  | 'SessionEnd'
  | 'Stop'
  | 'StopFailure'
  | 'SubagentStop'
  | 'SubagentStart'
  | 'InstructionsLoaded'
  | 'PostToolUseFailure'
  | 'Notification'
  | 'PermissionRequest'
  | 'PermissionDenied'
  | 'ConfigChange'
  | 'WorktreeCreate'
  | 'WorktreeRemove'
  | 'PreCompact'
  | 'PostCompact'
  | 'TeammateIdle'
  | 'TaskCreated'
  | 'TaskCompleted'
export type PermissionMode =
  | 'default'
  | 'plan'
  | 'acceptEdits'
  | 'dontAsk'
  | 'bypassPermissions'
  | (string & {})
export type SessionStartSource = 'startup' | 'resume' | 'clear' | 'compact' | (string & {})
export type SessionEndReason =
  | 'clear'
  | 'resume'
  | 'logout'
  | 'prompt_input_exit'
  | 'bypass_permissions_disabled'
  | 'other'
  | (string & {})
export type NotificationType =
  | 'permission_prompt'
  | 'idle_prompt'
  | 'auth_success'
  | 'elicitation_dialog'
  | (string & {})
export type InstructionsMemoryType = 'User' | 'Project' | 'Local' | 'Managed' | (string & {})
export type InstructionsLoadReason =
  | 'session_start'
  | 'nested_traversal'
  | 'path_glob_match'
  | 'include'
  | (string & {})
export type PreCompactTrigger = 'manual' | 'auto' | (string & {})
export type ConfigChangeSource =
  | 'user_settings'
  | 'project_settings'
  | 'local_settings'
  | 'policy_settings'
  | 'skills'
  | (string & {})
export type PermissionDestination =
  | 'session'
  | 'localSettings'
  | 'projectSettings'
  | 'userSettings'
  | (string & {})
export type PermissionRuleBehavior = 'allow' | 'deny' | 'ask' | (string & {})
/** A single permission rule entry. `ruleContent` omitted = match the whole tool. */
export interface PermissionRule {
  toolName: string
  ruleContent?: string
}
/** Discriminated by the `type` field. Used for both PermissionRequest's
 *  `permission_suggestions` input and the `updatedPermissions` allow output. */
export type PermissionUpdateEntry =
  | {
      type: 'addRules'
      rules: PermissionRule[]
      behavior: PermissionRuleBehavior
      destination: PermissionDestination
    }
  | {
      type: 'replaceRules'
      rules: PermissionRule[]
      behavior: PermissionRuleBehavior
      destination: PermissionDestination
    }
  | {
      type: 'removeRules'
      rules: PermissionRule[]
      behavior: PermissionRuleBehavior
      destination: PermissionDestination
    }
  | {
      type: 'setMode'
      mode: PermissionMode
      destination: PermissionDestination
    }
  | {
      type: 'addDirectories'
      directories: string[]
      destination: PermissionDestination
    }
  | {
      type: 'removeDirectories'
      directories: string[]
      destination: PermissionDestination
    }
/**
 * Error type for StopFailure. The seven documented upstream literals are
 * enumerated; `(string & {})` keeps the union forward-compatible with
 * any new error categories Claude Code introduces without requiring a
 * Clooks release.
 */
export type StopFailureErrorType =
  | 'rate_limit'
  | 'authentication_failed'
  | 'billing_error'
  | 'invalid_request'
  | 'server_error'
  | 'max_output_tokens'
  | 'unknown'
  | (string & {})
/** Optional debug info, only visible in debug mode. */
export interface DebugFields {
  debugMessage?: string
}
/**
 * Text injected into the agent's conversation.
 * Maps to Claude Code's `additionalContext` output field.
 * Only available on events whose Claude Code contract supports it.
 */
export interface InjectableContext {
  injectContext?: string
}
export type AllowResult = DebugFields & {
  result: 'allow'
}
export type BlockResult = DebugFields & {
  result: 'block'
  /** Required. Shown to the agent (guard events) or user (continuation events). */
  reason: string
}
export type SkipResult = DebugFields & {
  result: 'skip'
}
export type SuccessResult = DebugFields & {
  result: 'success'
  /** Absolute path to the created worktree. */
  path: string
}
export type FailureResult = DebugFields & {
  result: 'failure'
  reason: string
}
export type ContinueResult = DebugFields & {
  result: 'continue'
  /** Required. Tells the teammate what to do next. */
  feedback: string
}
export type StopResult = DebugFields & {
  result: 'stop'
  reason: string
}
export type RetryResult = DebugFields & {
  result: 'retry'
}
/**
 * PreToolUse `ask` decision. Upstream displays the permission prompt
 * to the user with permissionDecisionReason as the prompt text.
 * The source label ([Project]/[User]/[Plugin]/[Local]) is added by
 * Claude Code — reason should disambiguate which hook asked.
 */
export type AskResult = DebugFields & {
  result: 'ask'
  /** Required. Shown to the user in the confirmation prompt. */
  reason: string
}
/**
 * PreToolUse `defer` decision. Pauses the tool call so a headless
 * `claude -p` caller can resume via `claude -p --resume`. Only honored
 * in -p mode AND only when the turn contains a single tool call.
 * Otherwise Claude Code ignores this result.
 *
 * Upstream ignores reason / updatedInput / additionalContext for
 * defer. This type forbids all three at compile time.
 */
export type DeferResult = DebugFields & {
  result: 'defer'
}
export type PreToolUseResult =
  | (AllowResult &
      InjectableContext & {
        /**
         * Partial patch applied to the running tool input. The engine merges
         * this object onto the current `toolInput` via shallow spread, then
         * strips keys whose value is the literal `null`.
         *
         * - `null` = explicit unset; the key is removed post-merge.
         * - `undefined` / absent = no change on that key.
         *
         * With multiple sequential hooks, each hook's patch composes onto the
         * merge-so-far: hook B's `ctx.toolInput` reflects the running state
         * after every prior patch. Upstream Claude Code still receives a full
         * replacement object on the wire — the engine merges the patches
         * internally before translation.
         *
         * ```ts
         * // ✗ Wrong — undefined is treated as "no patch," the field is left unchanged.
         * return ctx.allow({ updatedInput: { timeout: undefined } })
         *
         * // ✓ Right — null explicitly unsets.
         * return ctx.allow({ updatedInput: { timeout: null } })
         * ```
         */
        updatedInput?: Record<string, unknown>
        /**
         * Optional. When present, surfaced as
         * hookSpecificOutput.permissionDecisionReason on allow.
         * Shown to the user per upstream's decision-control contract.
         */
        reason?: string
      })
  | (AskResult &
      InjectableContext & {
        /**
         * Partial patch applied to the running tool input. The engine merges
         * this object onto the current `toolInput` via shallow spread, then
         * strips keys whose value is the literal `null`.
         *
         * - `null` = explicit unset; the key is removed post-merge.
         * - `undefined` / absent = no change on that key.
         *
         * With multiple sequential hooks, each hook's patch composes onto the
         * merge-so-far: hook B's `ctx.toolInput` reflects the running state
         * after every prior patch. Upstream Claude Code still receives a full
         * replacement object on the wire — the engine merges the patches
         * internally before translation.
         *
         * ```ts
         * // ✗ Wrong — undefined is treated as "no patch," the field is left unchanged.
         * return ctx.allow({ updatedInput: { timeout: undefined } })
         *
         * // ✓ Right — null explicitly unsets.
         * return ctx.allow({ updatedInput: { timeout: null } })
         * ```
         */
        updatedInput?: Record<string, unknown>
      })
  | (BlockResult & InjectableContext)
  | DeferResult
  | (SkipResult & InjectableContext)
export type UserPromptSubmitResult = (AllowResult | BlockResult | SkipResult) &
  InjectableContext & {
    sessionTitle?: string
  }
export type PermissionRequestResult =
  | (AllowResult & {
      /**
       * Partial patch applied to the running tool input. The engine merges
       * this object onto the current `toolInput` via shallow spread, then
       * strips keys whose value is the literal `null`.
       *
       * - `null` = explicit unset; the key is removed post-merge.
       * - `undefined` / absent = no change on that key.
       *
       * With multiple sequential hooks, each hook's patch composes onto the
       * merge-so-far: hook B's `ctx.toolInput` reflects the running state
       * after every prior patch. Upstream Claude Code still receives a full
       * replacement object on the wire — the engine merges the patches
       * internally before translation.
       *
       * ```ts
       * // ✗ Wrong — undefined is treated as "no patch," the field is left unchanged.
       * return { result: 'allow', updatedInput: { timeout: undefined } }
       *
       * // ✓ Right — null explicitly unsets.
       * return { result: 'allow', updatedInput: { timeout: null } }
       * ```
       */
      updatedInput?: Record<string, unknown>
      updatedPermissions?: PermissionUpdateEntry[]
    })
  | (BlockResult & {
      interrupt?: boolean
    })
  | SkipResult
export type StopEventResult = AllowResult | BlockResult | SkipResult
export type SubagentStopResult = AllowResult | BlockResult | SkipResult
export type ConfigChangeResult = AllowResult | BlockResult | SkipResult
export type PreCompactResult = AllowResult | BlockResult | SkipResult
export type StopFailureResult = SkipResult
export type SessionStartResult = SkipResult & InjectableContext
export type SessionEndResult = SkipResult
export type InstructionsLoadedResult = SkipResult
export type PostToolUseResult =
  | (SkipResult &
      InjectableContext & {
        updatedMCPToolOutput?: unknown
      })
  | (BlockResult &
      InjectableContext & {
        updatedMCPToolOutput?: unknown
      })
export type PostToolUseFailureResult = SkipResult & InjectableContext
export type NotificationResult = SkipResult & InjectableContext
export type SubagentStartResult = SkipResult & InjectableContext
export type WorktreeRemoveResult = SkipResult
export type PostCompactResult = SkipResult
export type PermissionDeniedResult = RetryResult | SkipResult
export type WorktreeCreateResult = SuccessResult | FailureResult
export type TeammateIdleResult = ContinueResult | StopResult | SkipResult
export type TaskCreatedResult = ContinueResult | StopResult | SkipResult
export type TaskCompletedResult = ContinueResult | StopResult | SkipResult
type OptionalKeys<T> = {
  [K in keyof T]-?: object extends Pick<T, K> ? K : never
}[keyof T]
/**
 * Patch shape for FEAT-0061 patch-merge.
 *
 * Semantics:
 * - `null` = explicit unset. The engine's `omitBy(..., isNull)` strips the key
 *   from the merged tool input before translation, so the upstream tool sees the
 *   key as absent.
 * - `null` is forbidden on required keys of `T` — required keys accept `T[K]`
 *   only, not `T[K] | null`. Stripping a required key would send the upstream
 *   tool a call missing that field (e.g. `Bash` without `command`), failing at
 *   the tool layer with no clooks-side guard. This is enforced at compile time
 *   by `OptionalKeys<T>` — assigning `null` to a required key (e.g.
 *   `{ command: null }` on `Patch<BashToolInput>`) is a TypeScript error.
 * - `undefined` / absent = no engine change. After spread, `{ key: undefined }`
 *   is **present on the merged object** with value `undefined` — the engine does
 *   NOT strip it. Wire-level absence happens because `JSON.stringify` drops
 *   `undefined`-valued keys during serialization, not because of any engine
 *   logic. Authors debugging "where did my undefined go?" should look at the
 *   serializer, not at the merge step.
 *
 * See `docs/domain/hook-type-system.md` for the broader hook type-system context
 * and FEAT-0061 for the originating engine semantics.
 */
export type Patch<T> = {
  [K in keyof T]?: K extends OptionalKeys<T> ? T[K] | null : T[K]
}
type UserPromptSubmitDecisionMethods = {
  allow(opts?: {
    /**
     * Equivalent to running `/rename`. Available on every result arm per
     * upstream's hookSpecificOutput shape; whether upstream honors it on a
     * `block` arm is unverified — the result type matches the upstream output
     * schema.
     */
    sessionTitle?: string
    injectContext?: string
    debugMessage?: string
  }): UserPromptSubmitResult
  block(opts: {
    reason: string
    sessionTitle?: string
    injectContext?: string
    debugMessage?: string
  }): UserPromptSubmitResult
  skip(opts?: {
    sessionTitle?: string
    injectContext?: string
    debugMessage?: string
  }): UserPromptSubmitResult
}
type StopDecisionMethods = {
  allow(opts?: { debugMessage?: string }): StopEventResult
  /**
   * Use this to *prevent* the stop. The verb `stop` belongs to continuation
   * events (`TeammateIdle`, `TaskCreated`, `TaskCompleted`); it does NOT exist
   * on `StopContext` because `Stop` is the *event* whose default behavior is
   * to stop. `reason` is required and tells Claude *why to continue* — it's
   * effectively the next-turn instruction.
   */
  block(opts: { reason: string; debugMessage?: string }): StopEventResult
  skip(opts?: { debugMessage?: string }): StopEventResult
}
type SubagentStopDecisionMethods = {
  allow(opts?: { debugMessage?: string }): SubagentStopResult
  /**
   * Use this to *prevent* the subagent's stop. The verb `stop` belongs to
   * continuation events (`TeammateIdle`, `TaskCreated`, `TaskCompleted`); it
   * does NOT exist on `SubagentStopContext` because `SubagentStop` is the
   * *event* whose default behavior is for the subagent to stop. `reason` is
   * required and is surfaced back to the subagent as next-step instruction.
   */
  block(opts: { reason: string; debugMessage?: string }): SubagentStopResult
  skip(opts?: { debugMessage?: string }): SubagentStopResult
}
type ConfigChangeDecisionMethods = {
  allow(opts?: { debugMessage?: string }): ConfigChangeResult
  block(opts: { reason: string; debugMessage?: string }): ConfigChangeResult
  skip(opts?: { debugMessage?: string }): ConfigChangeResult
}
type PreCompactDecisionMethods = {
  allow(opts?: { debugMessage?: string }): PreCompactResult
  block(opts: { reason: string; debugMessage?: string }): PreCompactResult
  skip(opts?: { debugMessage?: string }): PreCompactResult
}
type PostToolUseDecisionMethods = {
  block(opts: {
    reason: string
    injectContext?: string
    /**
     * MCP tools only. Built-in tools (Bash, Edit, Write, …) silently ignore
     * this field. `toolName` is `string` here so this caveat is not enforced
     * at the type level.
     */
    updatedMCPToolOutput?: unknown
    debugMessage?: string
  }): PostToolUseResult
  skip(opts?: {
    injectContext?: string
    /**
     * MCP tools only. Built-in tools (Bash, Edit, Write, …) silently ignore
     * this field. `toolName` is `string` here so this caveat is not enforced
     * at the type level.
     */
    updatedMCPToolOutput?: unknown
    debugMessage?: string
  }): PostToolUseResult
}
type PermissionDeniedDecisionMethods = {
  retry(opts?: { debugMessage?: string }): PermissionDeniedResult
  skip(opts?: { debugMessage?: string }): PermissionDeniedResult
}
type SessionStartDecisionMethods = {
  skip(opts?: { injectContext?: string; debugMessage?: string }): SessionStartResult
}
type SessionEndDecisionMethods = {
  skip(opts?: { debugMessage?: string }): SessionEndResult
}
type InstructionsLoadedDecisionMethods = {
  skip(opts?: { debugMessage?: string }): InstructionsLoadedResult
}
type PostToolUseFailureDecisionMethods = {
  skip(opts?: { injectContext?: string; debugMessage?: string }): PostToolUseFailureResult
}
type NotificationDecisionMethods = {
  skip(opts?: { injectContext?: string; debugMessage?: string }): NotificationResult
}
type SubagentStartDecisionMethods = {
  skip(opts?: { injectContext?: string; debugMessage?: string }): SubagentStartResult
}
type WorktreeRemoveDecisionMethods = {
  skip(opts?: { debugMessage?: string }): WorktreeRemoveResult
}
type PostCompactDecisionMethods = {
  skip(opts?: { debugMessage?: string }): PostCompactResult
}
/**
 * Decision methods for `StopFailureContext`.
 */
export type StopFailureDecisionMethods = {
  /**
   * Output is dropped upstream by Claude Code. This method exists for API
   * uniformity. Side-effects (logging, alerts) inside the handler still run;
   * the method only constructs the engine-side telemetry result.
   */
  skip(opts?: { debugMessage?: string }): StopFailureResult
}
type WorktreeCreateDecisionMethods = {
  success(opts: { path: string; debugMessage?: string }): WorktreeCreateResult
  failure(opts: { reason: string; debugMessage?: string }): WorktreeCreateResult
}
type TeammateIdleDecisionMethods = {
  /**
   * Keep working past idle. The teammate's loop continues; `feedback` is sent
   * back as a stderr-equivalent retry signal.
   */
  continue(opts: { feedback: string; debugMessage?: string }): TeammateIdleResult
  stop(opts: { reason: string; debugMessage?: string }): TeammateIdleResult
  skip(opts?: { debugMessage?: string }): TeammateIdleResult
}
type TaskCreatedDecisionMethods = {
  /**
   * Don't create the task; feed feedback to the model. The task creation is
   * blocked; `feedback` is sent back to the model as stderr-equivalent.
   */
  continue(opts: { feedback: string; debugMessage?: string }): TaskCreatedResult
  stop(opts: { reason: string; debugMessage?: string }): TaskCreatedResult
  skip(opts?: { debugMessage?: string }): TaskCreatedResult
}
type TaskCompletedDecisionMethods = {
  /**
   * Don't mark complete; feed feedback to the model. The completion is
   * blocked; `feedback` is sent back to the model as stderr-equivalent.
   */
  continue(opts: { feedback: string; debugMessage?: string }): TaskCompletedResult
  stop(opts: { reason: string; debugMessage?: string }): TaskCompletedResult
  skip(opts?: { debugMessage?: string }): TaskCompletedResult
}
export interface BaseContext {
  event: EventName
  sessionId: string
  cwd: string
  permissionMode?: PermissionMode
  transcriptPath: string
  agentId?: string
  agentType?: string
  /** True when this hook is running in a parallel batch. */
  parallel: boolean
  /** AbortSignal scoped to the current batch. Aborted when a parallel batch short-circuits. */
  signal: AbortSignal
}
export interface BashToolInput {
  command: string
  description?: string
  timeout?: number
  runInBackground?: boolean
}
export interface WriteToolInput {
  filePath: string
  content: string
}
export interface EditToolInput {
  filePath: string
  oldString: string
  newString: string
  replaceAll?: boolean
}
export interface ReadToolInput {
  filePath: string
  offset?: number
  limit?: number
}
export interface GlobToolInput {
  pattern: string
  path?: string
}
export interface GrepToolInput {
  pattern: string
  path?: string
  glob?: string
  outputMode?: 'content' | 'files_with_matches' | 'count' | (string & {})
  '-i'?: boolean
  multiline?: boolean
}
export interface WebFetchToolInput {
  url: string
  prompt: string
}
export interface WebSearchToolInput {
  query: string
  allowedDomains?: string[]
  blockedDomains?: string[]
}
export interface AgentToolInput {
  prompt: string
  description: string
  subagentType: string
  model?: string
}
export interface AskUserQuestionToolInput {
  questions: Array<{
    question: string
    header: string
    options: Array<{
      label: string
    }>
    multiSelect?: boolean
  }>
  answers?: Record<string, string>
}
type PreToolUseDecisionMethods<Input> = {
  allow(opts?: {
    updatedInput?: Patch<Input>
    reason?: string
    injectContext?: string
    debugMessage?: string
  }): PreToolUseResult
  ask(opts: {
    reason: string
    updatedInput?: Patch<Input>
    injectContext?: string
    debugMessage?: string
  }): PreToolUseResult
  block(opts: { reason: string; injectContext?: string; debugMessage?: string }): PreToolUseResult
  /**
   * Only honored in `claude -p` mode AND only when the turn contains a single
   * tool call. Otherwise upstream Claude Code logs a warning and ignores this.
   * Requires Claude Code v2.1.89+.
   *
   * Upstream ignores `reason`, `updatedInput`, and `additionalContext` for
   * `defer` — the opts bag carries only `debugMessage`.
   */
  defer(opts?: { debugMessage?: string }): PreToolUseResult
  skip(opts?: { injectContext?: string; debugMessage?: string }): PreToolUseResult
}
type WithPreToolUseMethods<V> = V extends {
  toolInput: infer Input
}
  ? V & PreToolUseDecisionMethods<Input>
  : never
type PreToolUseVariant = BaseContext & {
  event: 'PreToolUse'
  toolUseId: string
  /** The original tool input from Claude Code, before any hook modifications. */
  originalToolInput: Record<string, unknown>
} & (
    | {
        toolName: 'Bash'
        toolInput: BashToolInput
      }
    | {
        toolName: 'Write'
        toolInput: WriteToolInput
      }
    | {
        toolName: 'Edit'
        toolInput: EditToolInput
      }
    | {
        toolName: 'Read'
        toolInput: ReadToolInput
      }
    | {
        toolName: 'Glob'
        toolInput: GlobToolInput
      }
    | {
        toolName: 'Grep'
        toolInput: GrepToolInput
      }
    | {
        toolName: 'WebFetch'
        toolInput: WebFetchToolInput
      }
    | {
        toolName: 'WebSearch'
        toolInput: WebSearchToolInput
      }
    | {
        toolName: 'Agent'
        toolInput: AgentToolInput
      }
    | {
        toolName: 'AskUserQuestion'
        toolInput: AskUserQuestionToolInput
      }
  )
export type PreToolUseContext = WithPreToolUseMethods<PreToolUseVariant>
/**
 * Context for a PreToolUse event where the tool name is not one of the 10
 * known variants (e.g. MCP tools, ExitPlanMode, future upstream tools).
 * Cast from `PreToolUseContext` when handling unknown tool names.
 *
 * @example
 * const ctx = rawCtx as unknown as UnknownPreToolUseContext
 * if (ctx.toolName.startsWith('mcp__')) { ... }
 */
export type UnknownPreToolUseContext = BaseContext & {
  event: 'PreToolUse'
  toolUseId: string
  originalToolInput: Record<string, unknown>
  toolName: string
  toolInput: Record<string, unknown>
} & PreToolUseDecisionMethods<Record<string, unknown>>
export type UserPromptSubmitContext = BaseContext & {
  event: 'UserPromptSubmit'
  prompt: string
} & UserPromptSubmitDecisionMethods
type PermissionRequestDecisionMethods<Input> = {
  allow(opts?: {
    /**
     * Per-tool patch type via `Patch<ToolInput>`. Engine merges onto the
     * running input; `null` = explicit unset. Upstream Claude Code receives a
     * full replacement object on the wire; merging happens engine-side. See
     * `docs/domain/hook-type-system.md` and FEAT-0061 for patch-merge
     * semantics.
     */
    updatedInput?: Patch<Input>
    updatedPermissions?: PermissionUpdateEntry[]
    debugMessage?: string
  }): PermissionRequestResult
  block(opts: {
    reason: string
    interrupt?: boolean
    debugMessage?: string
  }): PermissionRequestResult
  skip(opts?: { debugMessage?: string }): PermissionRequestResult
}
type WithPermissionRequestMethods<V> = V extends {
  toolInput: infer Input
}
  ? V & PermissionRequestDecisionMethods<Input>
  : never
type PermissionRequestVariant = BaseContext & {
  event: 'PermissionRequest'
  /**
   * Permission update suggestions surfaced by Claude Code. Stays at the outer
   * context level (not per-variant) — Claude Code attaches it to every
   * permission request regardless of tool. See PLAN-FEAT-0063 Decision Log
   * "permissionSuggestions stays at the outer PermissionRequestContext level."
   */
  permissionSuggestions?: PermissionUpdateEntry[]
} & (
    | {
        toolName: 'Bash'
        toolInput: BashToolInput
      }
    | {
        toolName: 'Write'
        toolInput: WriteToolInput
      }
    | {
        toolName: 'Edit'
        toolInput: EditToolInput
      }
    | {
        toolName: 'Read'
        toolInput: ReadToolInput
      }
    | {
        toolName: 'Glob'
        toolInput: GlobToolInput
      }
    | {
        toolName: 'Grep'
        toolInput: GrepToolInput
      }
    | {
        toolName: 'WebFetch'
        toolInput: WebFetchToolInput
      }
    | {
        toolName: 'WebSearch'
        toolInput: WebSearchToolInput
      }
    | {
        toolName: 'Agent'
        toolInput: AgentToolInput
      }
    | {
        toolName: 'AskUserQuestion'
        toolInput: AskUserQuestionToolInput
      }
  )
export type PermissionRequestContext = WithPermissionRequestMethods<PermissionRequestVariant>
/**
 * Context for a PermissionRequest event where the tool name is not one of the
 * 10 known variants (e.g. MCP tools, future upstream tools). Sibling to
 * `UnknownPreToolUseContext`. Cast from raw ctx when handling unknown tool
 * names.
 *
 * @example
 * const ctx = rawCtx as unknown as UnknownPermissionRequestContext
 * if (ctx.toolName.startsWith('mcp__')) {
 *   return ctx.allow({ updatedInput: { ... } })
 * }
 */
export type UnknownPermissionRequestContext = BaseContext & {
  event: 'PermissionRequest'
  permissionSuggestions?: PermissionUpdateEntry[]
  toolName: string
  toolInput: Record<string, unknown>
} & PermissionRequestDecisionMethods<Record<string, unknown>>
export type StopContext = BaseContext & {
  event: 'Stop'
  stopHookActive: boolean
  lastAssistantMessage: string
} & StopDecisionMethods
export type SubagentStopContext = BaseContext & {
  event: 'SubagentStop'
  stopHookActive: boolean
  agentId: string
  agentType: string
  agentTranscriptPath: string
  lastAssistantMessage: string
} & SubagentStopDecisionMethods
export type ConfigChangeContext = BaseContext & {
  event: 'ConfigChange'
  source: ConfigChangeSource
  filePath?: string
} & ConfigChangeDecisionMethods
export type StopFailureContext = BaseContext & {
  event: 'StopFailure'
  error: StopFailureErrorType
  errorDetails?: string
  /**
   * For StopFailure, this is the rendered API error string
   * (e.g., "API Error: Rate limit reached") — NOT Claude's
   * conversational text as in Stop / SubagentStop. See `errorDetails`
   * for additional structured detail.
   */
  lastAssistantMessage?: string
} & StopFailureDecisionMethods
export type SessionStartContext = BaseContext & {
  event: 'SessionStart'
  source: SessionStartSource
  model?: string
} & SessionStartDecisionMethods
export type SessionEndContext = BaseContext & {
  event: 'SessionEnd'
  reason: SessionEndReason
} & SessionEndDecisionMethods
export type InstructionsLoadedContext = BaseContext & {
  event: 'InstructionsLoaded'
  filePath: string
  memoryType: InstructionsMemoryType
  loadReason: InstructionsLoadReason
  globs?: string[]
  triggerFilePath?: string
  parentFilePath?: string
} & InstructionsLoadedDecisionMethods
export type PostToolUseContext = BaseContext & {
  event: 'PostToolUse'
  toolName: string
  toolInput: Record<string, unknown>
  toolResponse: unknown
  toolUseId: string
  originalToolInput?: Record<string, unknown>
} & PostToolUseDecisionMethods
export type PostToolUseFailureContext = BaseContext & {
  event: 'PostToolUseFailure'
  toolName: string
  toolInput: Record<string, unknown>
  toolUseId: string
  error: string
  isInterrupt?: boolean
  originalToolInput?: Record<string, unknown>
} & PostToolUseFailureDecisionMethods
export type NotificationContext = BaseContext & {
  event: 'Notification'
  message: string
  title?: string
  notificationType?: NotificationType
} & NotificationDecisionMethods
export type SubagentStartContext = BaseContext & {
  event: 'SubagentStart'
  agentId: string
  agentType: string
} & SubagentStartDecisionMethods
export type WorktreeRemoveContext = BaseContext & {
  event: 'WorktreeRemove'
  worktreePath: string
} & WorktreeRemoveDecisionMethods
export type PreCompactContext = BaseContext & {
  event: 'PreCompact'
  trigger: PreCompactTrigger
  customInstructions: string
} & PreCompactDecisionMethods
export type PostCompactContext = BaseContext & {
  event: 'PostCompact'
  trigger: PreCompactTrigger
  compactSummary: string
} & PostCompactDecisionMethods
export type PermissionDeniedContext = BaseContext & {
  event: 'PermissionDenied'
  toolName: string
  /** Tool input as provided to Claude Code. Keys are camelCase. */
  toolInput: Record<string, unknown>
  toolUseId: string
  /** The classifier's explanation for why the tool call was denied. */
  denialReason: string
} & PermissionDeniedDecisionMethods
export type WorktreeCreateContext = BaseContext & {
  event: 'WorktreeCreate'
  name: string
} & WorktreeCreateDecisionMethods
export type TeammateIdleContext = BaseContext & {
  event: 'TeammateIdle'
  teammateName: string
  teamName: string
} & TeammateIdleDecisionMethods
export type TaskCreatedContext = BaseContext & {
  event: 'TaskCreated'
  taskId: string
  taskSubject: string
  taskDescription?: string
  teammateName?: string
  teamName?: string
} & TaskCreatedDecisionMethods
export type TaskCompletedContext = BaseContext & {
  event: 'TaskCompleted'
  taskId: string
  taskSubject: string
  taskDescription?: string
  teammateName?: string
  teamName?: string
} & TaskCompletedDecisionMethods
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
  PreToolUse?: (ctx: PreToolUseContext, config: C) => MaybeAsync<PreToolUseResult>
  UserPromptSubmit?: (ctx: UserPromptSubmitContext, config: C) => MaybeAsync<UserPromptSubmitResult>
  PermissionRequest?: (
    ctx: PermissionRequestContext,
    config: C,
  ) => MaybeAsync<PermissionRequestResult>
  Stop?: (ctx: StopContext, config: C) => MaybeAsync<StopEventResult>
  SubagentStop?: (ctx: SubagentStopContext, config: C) => MaybeAsync<SubagentStopResult>
  ConfigChange?: (ctx: ConfigChangeContext, config: C) => MaybeAsync<ConfigChangeResult>
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
  StopFailure?: (ctx: StopFailureContext, config: C) => MaybeAsync<StopFailureResult>
  WorktreeCreate?: (ctx: WorktreeCreateContext, config: C) => MaybeAsync<WorktreeCreateResult>
  TeammateIdle?: (ctx: TeammateIdleContext, config: C) => MaybeAsync<TeammateIdleResult>
  TaskCreated?: (ctx: TaskCreatedContext, config: C) => MaybeAsync<TaskCreatedResult>
  TaskCompleted?: (ctx: TaskCompletedContext, config: C) => MaybeAsync<TaskCompletedResult>
}

export {}
