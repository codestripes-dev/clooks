// Clooks v0.1.2 — generated type declarations
// Do not edit. Regenerate with: clooks types
type EventName = "PreToolUse" | "PostToolUse" | "UserPromptSubmit" | "SessionStart" | "SessionEnd" | "Stop" | "StopFailure" | "SubagentStop" | "SubagentStart" | "InstructionsLoaded" | "PostToolUseFailure" | "Notification" | "PermissionRequest" | "PermissionDenied" | "ConfigChange" | "WorktreeCreate" | "WorktreeRemove" | "PreCompact" | "PostCompact" | "TeammateIdle" | "TaskCreated" | "TaskCompleted";
export type PermissionMode = "default" | "plan" | "acceptEdits" | "dontAsk" | "bypassPermissions" | (string & {});
export type SessionStartSource = "startup" | "resume" | "clear" | "compact" | (string & {});
export type SessionEndReason = "clear" | "resume" | "logout" | "prompt_input_exit" | "bypass_permissions_disabled" | "other" | (string & {});
export type NotificationType = "permission_prompt" | "idle_prompt" | "auth_success" | "elicitation_dialog" | (string & {});
export type InstructionsMemoryType = "User" | "Project" | "Local" | "Managed" | (string & {});
export type InstructionsLoadReason = "session_start" | "nested_traversal" | "path_glob_match" | "include" | (string & {});
export type PreCompactTrigger = "manual" | "auto" | (string & {});
export type ConfigChangeSource = "user_settings" | "project_settings" | "local_settings" | "policy_settings" | "skills" | (string & {});
export type PermissionDestination = "session" | "localSettings" | "projectSettings" | "userSettings" | (string & {});
export type PermissionRuleBehavior = "allow" | "deny" | "ask" | (string & {});
/** A single permission rule entry. `ruleContent` omitted = match the whole tool. */
export interface PermissionRule {
	toolName: string;
	ruleContent?: string;
}
/** Discriminated by the `type` field. Used for both PermissionRequest's
 *  `permission_suggestions` input and the `updatedPermissions` allow output. */
export type PermissionUpdateEntry = {
	type: "addRules";
	rules: PermissionRule[];
	behavior: PermissionRuleBehavior;
	destination: PermissionDestination;
} | {
	type: "replaceRules";
	rules: PermissionRule[];
	behavior: PermissionRuleBehavior;
	destination: PermissionDestination;
} | {
	type: "removeRules";
	rules: PermissionRule[];
	behavior: PermissionRuleBehavior;
	destination: PermissionDestination;
} | {
	type: "setMode";
	mode: PermissionMode;
	destination: PermissionDestination;
} | {
	type: "addDirectories";
	directories: string[];
	destination: PermissionDestination;
} | {
	type: "removeDirectories";
	directories: string[];
	destination: PermissionDestination;
};
/**
 * Error type for StopFailure. The seven documented upstream literals are
 * enumerated; `(string & {})` keeps the union forward-compatible with
 * any new error categories Claude Code introduces without requiring a
 * Clooks release.
 */
export type StopFailureErrorType = "rate_limit" | "authentication_failed" | "billing_error" | "invalid_request" | "server_error" | "max_output_tokens" | "unknown" | (string & {});
/** Optional debug info, only visible in debug mode. */
export type DebugMessage = {
	debugMessage?: string;
};
/**
 * Text injected into the agent's conversation. Maps to Claude Code's
 * `additionalContext` output field. Only available on events whose Claude
 * Code contract supports it.
 */
export type InjectContext = {
	injectContext?: string;
};
/** Required. Shown to the agent (guard events) or user (continuation events). */
export type Reason = {
	reason: string;
};
/** Required. Tells the teammate what to do next. */
export type Feedback = {
	feedback: string;
};
/** Required. Absolute path to the resource (e.g. created worktree). */
export type Path = {
	path: string;
};
/**
 * Set the session title — equivalent to running `/rename`. Available on every
 * result arm per upstream's hookSpecificOutput shape; whether upstream honors
 * it on a `block` arm is unverified — the result type matches the upstream
 * output schema.
 */
export type SessionTitle = {
	sessionTitle?: string;
};
export type UpdatedPermissions = {
	updatedPermissions?: PermissionUpdateEntry[];
};
/** MCP tools only. Built-in tools (Bash, Edit, Write, …) silently ignore this field. */
export type UpdatedMcpToolOutput = {
	updatedMCPToolOutput?: unknown;
};
export type Interrupt = {
	interrupt?: boolean;
};
/**
 * Partial patch object applied to the running tool input. The engine merges
 * this object onto the current `toolInput` via shallow spread, then strips
 * keys whose value is the literal `null`.
 *
 * - `null` = explicit unset; the key is removed post-merge.
 * - `undefined` / absent = no change on that key.
 *
 * With multiple sequential hooks, each hook's patch composes onto the
 * merge-so-far: hook B's `ctx.toolInput` reflects the running state after
 * every prior patch. Upstream Claude Code still receives a full replacement
 * object on the wire — the engine merges the patches internally before
 * translation.
 *
 * Generic over the inner value type so the same primitive composes at
 * result-type level (`UpdatedInput<Record<string, unknown>>`) and at
 * decision-method level with per-tool typed patches
 * (`UpdatedInput<Patch<BashToolInput>>`, etc.).
 *
 * Setting a field to `undefined` does NOT strip it — `JSON.stringify` drops
 * `undefined`-valued keys at serialization, but the engine's merge pass
 * sees the key as present. Use `null` to unset.
 */
export type UpdatedInput<T> = {
	updatedInput?: T;
};
/**
 * Permission update suggestions surfaced by Claude Code. Stays at the outer
 * context level (not per-variant) — Claude Code attaches it to every
 * permission request regardless of tool.
 */
export type PermissionSuggestions = {
	permissionSuggestions?: PermissionUpdateEntry[];
};
/**
 * Generic result-tag primitive. Composes the discriminant literal with the
 * universal `DebugMessage` field. Every base result type intersects
 * `Result<'<tag>'>` with the per-tag required field bag (`Reason`, `Feedback`,
 * `Path`) or with nothing for tag-only results (`AllowResult`, `SkipResult`,
 * `DeferResult`, `RetryResult`).
 */
export type Result<T extends ResultTag> = {
	result: T;
} & DebugMessage;
/**
 * Per-tool DU arm shape for tool-keyed events that lack a Clooks-internal
 * `originalToolInput` field. Used by `PermissionRequestVariant`,
 * `PostToolUseVariant`, and `PostToolUseFailureVariant`.
 */
export type ToolVariant<N extends string, I> = {
	toolName: N;
	toolInput: I;
};
/**
 * Per-tool DU arm shape for `PreToolUseVariant` only. Adds the
 * Clooks-internal `originalToolInput` field, which mirrors `toolInput`
 * shape exactly (the engine synthesizes it pre-normalization). Not used
 * by other tool-keyed events — Claude Code's wire payload does not carry
 * this field on PostToolUse / PostToolUseFailure / PermissionRequest.
 */
export type ToolVariantWithOriginal<N extends string, I> = ToolVariant<N, I> & {
	originalToolInput: I;
};
type Allow<O, R> = {
	allow: (opts?: O & DebugMessage) => R;
};
type Block<O, R> = {
	block: (opts: O & DebugMessage) => R;
};
type Skip<O, R> = {
	skip: (opts?: O & DebugMessage) => R;
};
type Ask<O, R> = {
	ask: (opts: O & DebugMessage) => R;
};
type Defer<O, R> = {
	defer: (opts?: O & DebugMessage) => R;
};
type Continue<O, R> = {
	continue: (opts: O & DebugMessage) => R;
};
type Stop<O, R> = {
	stop: (opts: O & DebugMessage) => R;
};
type Retry<O, R> = {
	retry: (opts?: O & DebugMessage) => R;
};
type Success<O, R> = {
	success: (opts: O & DebugMessage) => R;
};
type Failure<O, R> = {
	failure: (opts: O & DebugMessage) => R;
};
/** Union of all result discriminant values across all base result types. */
export type ResultTag = "allow" | "ask" | "block" | "defer" | "skip" | "success" | "failure" | "continue" | "stop" | "retry";
export type AllowResult = Result<"allow">;
export type SkipResult = Result<"skip">;
/**
 * PreToolUse `defer` decision. Pauses the tool call so a headless
 * `claude -p` caller can resume via `claude -p --resume`. Only honored
 * in -p mode AND only when the turn contains a single tool call.
 * Otherwise Claude Code ignores this result.
 *
 * Upstream ignores reason / updatedInput / additionalContext for
 * defer. This type forbids all three at compile time.
 */
export type DeferResult = Result<"defer">;
export type RetryResult = Result<"retry">;
/**
 * PreToolUse `ask` decision. Upstream displays the permission prompt
 * to the user with permissionDecisionReason as the prompt text.
 * The source label ([Project]/[User]/[Plugin]/[Local]) is added by
 * Claude Code — reason should disambiguate which hook asked.
 */
export type AskResult = Result<"ask"> & Reason;
export type BlockResult = Result<"block"> & Reason;
export type StopResult = Result<"stop"> & Reason;
export type FailureResult = Result<"failure"> & Reason;
export type ContinueResult = Result<"continue"> & Feedback;
export type SuccessResult = Result<"success"> & Path;
export type PreToolUseResult = (AllowResult & InjectContext & UpdatedInput<Record<string, unknown>> & Partial<Reason>) | (AskResult & InjectContext & UpdatedInput<Record<string, unknown>>) | (BlockResult & InjectContext) | DeferResult | (SkipResult & InjectContext);
export type UserPromptSubmitResult = (AllowResult | BlockResult | SkipResult) & InjectContext & SessionTitle;
export type PermissionRequestResult = (AllowResult & UpdatedInput<Record<string, unknown>> & UpdatedPermissions) | (BlockResult & Interrupt) | SkipResult;
export type StopEventResult = AllowResult | BlockResult | SkipResult;
export type SubagentStopResult = AllowResult | BlockResult | SkipResult;
export type ConfigChangeResult = AllowResult | BlockResult | SkipResult;
export type PreCompactResult = AllowResult | BlockResult | SkipResult;
export type StopFailureResult = SkipResult;
export type SessionStartResult = SkipResult & InjectContext;
export type SessionEndResult = SkipResult;
export type InstructionsLoadedResult = SkipResult;
export type PostToolUseResult = (SkipResult & InjectContext & UpdatedMcpToolOutput) | (BlockResult & InjectContext & UpdatedMcpToolOutput);
export type PostToolUseFailureResult = SkipResult & InjectContext;
export type NotificationResult = SkipResult & InjectContext;
export type SubagentStartResult = SkipResult & InjectContext;
export type WorktreeRemoveResult = SkipResult;
export type PostCompactResult = SkipResult;
export type PermissionDeniedResult = RetryResult | SkipResult;
export type WorktreeCreateResult = SuccessResult | FailureResult;
export type TeammateIdleResult = ContinueResult | StopResult | SkipResult;
export type TaskCreatedResult = ContinueResult | StopResult | SkipResult;
export type TaskCompletedResult = ContinueResult | StopResult | SkipResult;
type OptionalKeys<T> = {
	[K in keyof T]-?: object extends Pick<T, K> ? K : never;
}[keyof T];
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
	[K in keyof T]?: K extends OptionalKeys<T> ? T[K] | null : T[K];
};
type UserPromptSubmitDecisionMethods = Allow<InjectContext & SessionTitle, UserPromptSubmitResult> & Block<Reason & InjectContext & SessionTitle, UserPromptSubmitResult> & Skip<InjectContext & SessionTitle, UserPromptSubmitResult>;
type StopDecisionMethods = Allow<DebugMessage, StopEventResult> & Block<Reason, StopEventResult> & Skip<DebugMessage, StopEventResult>;
type SubagentStopDecisionMethods = Allow<DebugMessage, SubagentStopResult> & Block<Reason, SubagentStopResult> & Skip<DebugMessage, SubagentStopResult>;
type ConfigChangeDecisionMethods = Allow<DebugMessage, ConfigChangeResult> & Block<Reason, ConfigChangeResult> & Skip<DebugMessage, ConfigChangeResult>;
type PreCompactDecisionMethods = Allow<DebugMessage, PreCompactResult> & Block<Reason, PreCompactResult> & Skip<DebugMessage, PreCompactResult>;
type PermissionDeniedDecisionMethods = Retry<DebugMessage, PermissionDeniedResult> & Skip<DebugMessage, PermissionDeniedResult>;
type SessionStartDecisionMethods = Skip<InjectContext, SessionStartResult>;
type SessionEndDecisionMethods = Skip<DebugMessage, SessionEndResult>;
type InstructionsLoadedDecisionMethods = Skip<DebugMessage, InstructionsLoadedResult>;
type NotificationDecisionMethods = Skip<InjectContext, NotificationResult>;
type SubagentStartDecisionMethods = Skip<InjectContext, SubagentStartResult>;
type WorktreeRemoveDecisionMethods = Skip<DebugMessage, WorktreeRemoveResult>;
type PostCompactDecisionMethods = Skip<DebugMessage, PostCompactResult>;
/**
 * Decision methods for `StopFailureContext`.
 *
 * Output is dropped upstream by Claude Code. `skip` exists for API
 * uniformity. Side-effects (logging, alerts) inside the handler still run;
 * the method only constructs the engine-side telemetry result.
 */
export type StopFailureDecisionMethods = Skip<DebugMessage, StopFailureResult>;
type WorktreeCreateDecisionMethods = Success<Path, WorktreeCreateResult> & Failure<Reason, WorktreeCreateResult>;
type TeammateIdleDecisionMethods = Continue<Feedback, TeammateIdleResult> & Stop<Reason, TeammateIdleResult> & Skip<DebugMessage, TeammateIdleResult>;
type TaskCreatedDecisionMethods = Continue<Feedback, TaskCreatedResult> & Stop<Reason, TaskCreatedResult> & Skip<DebugMessage, TaskCreatedResult>;
type TaskCompletedDecisionMethods = Continue<Feedback, TaskCompletedResult> & Stop<Reason, TaskCompletedResult> & Skip<DebugMessage, TaskCompletedResult>;
export interface BaseContext {
	event: EventName;
	sessionId: string;
	cwd: string;
	permissionMode?: PermissionMode;
	transcriptPath: string;
	agentId?: string;
	agentType?: string;
	/** True when this hook is running in a parallel batch. */
	parallel: boolean;
	/** AbortSignal scoped to the current batch. Aborted when a parallel batch short-circuits. */
	signal: AbortSignal;
}
export interface BashToolInput {
	command: string;
	description?: string;
	timeout?: number;
	runInBackground?: boolean;
}
export interface WriteToolInput {
	filePath: string;
	content: string;
}
export interface EditToolInput {
	filePath: string;
	oldString: string;
	newString: string;
	replaceAll?: boolean;
}
export interface ReadToolInput {
	filePath: string;
	offset?: number;
	limit?: number;
}
export interface GlobToolInput {
	pattern: string;
	path?: string;
}
export interface GrepToolInput {
	pattern: string;
	path?: string;
	glob?: string;
	outputMode?: "content" | "files_with_matches" | "count" | (string & {});
	"-i"?: boolean;
	multiline?: boolean;
}
export interface WebFetchToolInput {
	url: string;
	prompt: string;
}
export interface WebSearchToolInput {
	query: string;
	allowedDomains?: string[];
	blockedDomains?: string[];
}
export interface AgentToolInput {
	prompt: string;
	description: string;
	subagentType: string;
	model?: string;
}
export interface AskUserQuestionToolInput {
	questions: Array<{
		question: string;
		header: string;
		options: Array<{
			label: string;
		}>;
		multiSelect?: boolean;
	}>;
	answers?: Record<string, string>;
}
type PreToolUseDecisionMethods<Input> = Allow<UpdatedInput<Patch<Input>> & Partial<Reason> & InjectContext, PreToolUseResult> & Ask<Reason & UpdatedInput<Patch<Input>> & InjectContext, PreToolUseResult> & Block<Reason & InjectContext, PreToolUseResult> & Defer<DebugMessage, PreToolUseResult> & Skip<InjectContext, PreToolUseResult>;
type WithPreToolUseMethods<V> = V extends {
	toolInput: infer Input;
} ? V & PreToolUseDecisionMethods<Input> : never;
type PreToolUseVariant = BaseContext & {
	event: "PreToolUse";
	toolUseId: string;
} & (ToolVariantWithOriginal<"Bash", BashToolInput> | ToolVariantWithOriginal<"Write", WriteToolInput> | ToolVariantWithOriginal<"Edit", EditToolInput> | ToolVariantWithOriginal<"Read", ReadToolInput> | ToolVariantWithOriginal<"Glob", GlobToolInput> | ToolVariantWithOriginal<"Grep", GrepToolInput> | ToolVariantWithOriginal<"WebFetch", WebFetchToolInput> | ToolVariantWithOriginal<"WebSearch", WebSearchToolInput> | ToolVariantWithOriginal<"Agent", AgentToolInput> | ToolVariantWithOriginal<"AskUserQuestion", AskUserQuestionToolInput>);
export type PreToolUseContext = WithPreToolUseMethods<PreToolUseVariant>;
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
	event: "PreToolUse";
	toolUseId: string;
} & ToolVariantWithOriginal<string, Record<string, unknown>> & PreToolUseDecisionMethods<Record<string, unknown>>;
export type UserPromptSubmitContext = BaseContext & {
	event: "UserPromptSubmit";
	prompt: string;
} & UserPromptSubmitDecisionMethods;
type PermissionRequestDecisionMethods<Input> = Allow<UpdatedInput<Patch<Input>> & UpdatedPermissions, PermissionRequestResult> & Block<Reason & Interrupt, PermissionRequestResult> & Skip<DebugMessage, PermissionRequestResult>;
type WithPermissionRequestMethods<V> = V extends {
	toolInput: infer Input;
} ? V & PermissionRequestDecisionMethods<Input> : never;
type PermissionRequestVariant = BaseContext & PermissionSuggestions & {
	event: "PermissionRequest";
} & (ToolVariant<"Bash", BashToolInput> | ToolVariant<"Write", WriteToolInput> | ToolVariant<"Edit", EditToolInput> | ToolVariant<"Read", ReadToolInput> | ToolVariant<"Glob", GlobToolInput> | ToolVariant<"Grep", GrepToolInput> | ToolVariant<"WebFetch", WebFetchToolInput> | ToolVariant<"WebSearch", WebSearchToolInput> | ToolVariant<"Agent", AgentToolInput> | ToolVariant<"AskUserQuestion", AskUserQuestionToolInput>);
export type PermissionRequestContext = WithPermissionRequestMethods<PermissionRequestVariant>;
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
export type UnknownPermissionRequestContext = BaseContext & PermissionSuggestions & {
	event: "PermissionRequest";
} & ToolVariant<string, Record<string, unknown>> & PermissionRequestDecisionMethods<Record<string, unknown>>;
export type StopContext = BaseContext & {
	event: "Stop";
	stopHookActive: boolean;
	lastAssistantMessage: string;
} & StopDecisionMethods;
export type SubagentStopContext = BaseContext & {
	event: "SubagentStop";
	stopHookActive: boolean;
	agentId: string;
	agentType: string;
	agentTranscriptPath: string;
	lastAssistantMessage: string;
} & SubagentStopDecisionMethods;
export type ConfigChangeContext = BaseContext & {
	event: "ConfigChange";
	source: ConfigChangeSource;
	filePath?: string;
} & ConfigChangeDecisionMethods;
export type StopFailureContext = BaseContext & {
	event: "StopFailure";
	error: StopFailureErrorType;
	errorDetails?: string;
	/**
	 * For StopFailure, this is the rendered API error string
	 * (e.g., "API Error: Rate limit reached") — NOT Claude's
	 * conversational text as in Stop / SubagentStop. See `errorDetails`
	 * for additional structured detail.
	 */
	lastAssistantMessage?: string;
} & StopFailureDecisionMethods;
export type SessionStartContext = BaseContext & {
	event: "SessionStart";
	source: SessionStartSource;
	model?: string;
} & SessionStartDecisionMethods;
export type SessionEndContext = BaseContext & {
	event: "SessionEnd";
	reason: SessionEndReason;
} & SessionEndDecisionMethods;
export type InstructionsLoadedContext = BaseContext & {
	event: "InstructionsLoaded";
	filePath: string;
	memoryType: InstructionsMemoryType;
	loadReason: InstructionsLoadReason;
	globs?: string[];
	triggerFilePath?: string;
	parentFilePath?: string;
} & InstructionsLoadedDecisionMethods;
type PostToolUseDecisionMethods<_Input> = Block<Reason & InjectContext & UpdatedMcpToolOutput, PostToolUseResult> & Skip<InjectContext & UpdatedMcpToolOutput, PostToolUseResult>;
type PostToolUseVariant = BaseContext & {
	event: "PostToolUse";
	toolUseId: string;
	toolResponse: unknown;
} & (ToolVariant<"Bash", BashToolInput> | ToolVariant<"Write", WriteToolInput> | ToolVariant<"Edit", EditToolInput> | ToolVariant<"Read", ReadToolInput> | ToolVariant<"Glob", GlobToolInput> | ToolVariant<"Grep", GrepToolInput> | ToolVariant<"WebFetch", WebFetchToolInput> | ToolVariant<"WebSearch", WebSearchToolInput> | ToolVariant<"Agent", AgentToolInput> | ToolVariant<"AskUserQuestion", AskUserQuestionToolInput>);
type WithPostToolUseMethods<V> = V extends {
	toolInput: infer Input;
} ? V & PostToolUseDecisionMethods<Input> : never;
export type PostToolUseContext = WithPostToolUseMethods<PostToolUseVariant>;
/**
 * Context for a PostToolUse event where the tool name is not one of the 10
 * known variants (e.g. MCP tools, ExitPlanMode, future upstream tools).
 * Cast from raw ctx when handling unknown tool names. Mirrors the
 * `UnknownPreToolUseContext` pattern.
 *
 * @example
 * const ctx = rawCtx as unknown as UnknownPostToolUseContext
 * if (ctx.toolName.startsWith('mcp__')) { ... }
 */
export type UnknownPostToolUseContext = BaseContext & {
	event: "PostToolUse";
	toolUseId: string;
	toolResponse: unknown;
} & ToolVariant<string, Record<string, unknown>> & PostToolUseDecisionMethods<Record<string, unknown>>;
type PostToolUseFailureDecisionMethods<_Input> = Skip<InjectContext, PostToolUseFailureResult>;
type PostToolUseFailureVariant = BaseContext & {
	event: "PostToolUseFailure";
	toolUseId: string;
	error: string;
	isInterrupt?: boolean;
} & (ToolVariant<"Bash", BashToolInput> | ToolVariant<"Write", WriteToolInput> | ToolVariant<"Edit", EditToolInput> | ToolVariant<"Read", ReadToolInput> | ToolVariant<"Glob", GlobToolInput> | ToolVariant<"Grep", GrepToolInput> | ToolVariant<"WebFetch", WebFetchToolInput> | ToolVariant<"WebSearch", WebSearchToolInput> | ToolVariant<"Agent", AgentToolInput> | ToolVariant<"AskUserQuestion", AskUserQuestionToolInput>);
type WithPostToolUseFailureMethods<V> = V extends {
	toolInput: infer Input;
} ? V & PostToolUseFailureDecisionMethods<Input> : never;
export type PostToolUseFailureContext = WithPostToolUseFailureMethods<PostToolUseFailureVariant>;
/**
 * Context for a PostToolUseFailure event where the tool name is not one of the
 * 10 known variants. Cast from raw ctx when handling unknown tool names.
 *
 * @example
 * const ctx = rawCtx as unknown as UnknownPostToolUseFailureContext
 * if (ctx.toolName.startsWith('mcp__')) { ... }
 */
export type UnknownPostToolUseFailureContext = BaseContext & {
	event: "PostToolUseFailure";
	toolUseId: string;
	error: string;
	isInterrupt?: boolean;
} & ToolVariant<string, Record<string, unknown>> & PostToolUseFailureDecisionMethods<Record<string, unknown>>;
export type NotificationContext = BaseContext & {
	event: "Notification";
	message: string;
	title?: string;
	notificationType?: NotificationType;
} & NotificationDecisionMethods;
export type SubagentStartContext = BaseContext & {
	event: "SubagentStart";
	agentId: string;
	agentType: string;
} & SubagentStartDecisionMethods;
export type WorktreeRemoveContext = BaseContext & {
	event: "WorktreeRemove";
	worktreePath: string;
} & WorktreeRemoveDecisionMethods;
export type PreCompactContext = BaseContext & {
	event: "PreCompact";
	trigger: PreCompactTrigger;
	customInstructions: string;
} & PreCompactDecisionMethods;
export type PostCompactContext = BaseContext & {
	event: "PostCompact";
	trigger: PreCompactTrigger;
	compactSummary: string;
} & PostCompactDecisionMethods;
export type PermissionDeniedContext = BaseContext & {
	event: "PermissionDenied";
	toolName: string;
	/** Tool input as provided to Claude Code. Keys are camelCase. */
	toolInput: Record<string, unknown>;
	toolUseId: string;
	/** The classifier's explanation for why the tool call was denied. */
	denialReason: string;
} & PermissionDeniedDecisionMethods;
export type WorktreeCreateContext = BaseContext & {
	event: "WorktreeCreate";
	name: string;
} & WorktreeCreateDecisionMethods;
export type TeammateIdleContext = BaseContext & {
	event: "TeammateIdle";
	teammateName: string;
	teamName: string;
} & TeammateIdleDecisionMethods;
export type TaskCreatedContext = BaseContext & {
	event: "TaskCreated";
	taskId: string;
	taskSubject: string;
	taskDescription?: string;
	teammateName?: string;
	teamName?: string;
} & TaskCreatedDecisionMethods;
export type TaskCompletedContext = BaseContext & {
	event: "TaskCompleted";
	taskId: string;
	taskSubject: string;
	taskDescription?: string;
	teammateName?: string;
	teamName?: string;
} & TaskCompletedDecisionMethods;
export interface EventContextMap extends Record<EventName, unknown> {
	PreToolUse: PreToolUseContext;
	PostToolUse: PostToolUseContext;
	UserPromptSubmit: UserPromptSubmitContext;
	SessionStart: SessionStartContext;
	SessionEnd: SessionEndContext;
	Stop: StopContext;
	StopFailure: StopFailureContext;
	SubagentStop: SubagentStopContext;
	SubagentStart: SubagentStartContext;
	InstructionsLoaded: InstructionsLoadedContext;
	PostToolUseFailure: PostToolUseFailureContext;
	Notification: NotificationContext;
	PermissionRequest: PermissionRequestContext;
	PermissionDenied: PermissionDeniedContext;
	ConfigChange: ConfigChangeContext;
	WorktreeCreate: WorktreeCreateContext;
	WorktreeRemove: WorktreeRemoveContext;
	PreCompact: PreCompactContext;
	PostCompact: PostCompactContext;
	TeammateIdle: TeammateIdleContext;
	TaskCreated: TaskCreatedContext;
	TaskCompleted: TaskCompletedContext;
}
export interface EventResultMap extends Record<EventName, unknown> {
	PreToolUse: PreToolUseResult;
	PostToolUse: PostToolUseResult;
	UserPromptSubmit: UserPromptSubmitResult;
	SessionStart: SessionStartResult;
	SessionEnd: SessionEndResult;
	Stop: StopEventResult;
	StopFailure: StopFailureResult;
	SubagentStop: SubagentStopResult;
	SubagentStart: SubagentStartResult;
	InstructionsLoaded: InstructionsLoadedResult;
	PostToolUseFailure: PostToolUseFailureResult;
	Notification: NotificationResult;
	PermissionRequest: PermissionRequestResult;
	PermissionDenied: PermissionDeniedResult;
	ConfigChange: ConfigChangeResult;
	WorktreeCreate: WorktreeCreateResult;
	WorktreeRemove: WorktreeRemoveResult;
	PreCompact: PreCompactResult;
	PostCompact: PostCompactResult;
	TeammateIdle: TeammateIdleResult;
	TaskCreated: TaskCreatedResult;
	TaskCompleted: TaskCompletedResult;
}
export interface HookEventMeta {
	/** Repo root via `git rev-parse --show-toplevel`. Null if not in a git repo. */
	gitRoot: string | null;
	/** Current branch. Null if detached HEAD or not in a git repo. */
	gitBranch: string | null;
	/** OS platform. */
	platform: "darwin" | "linux";
	/** This hook's name (same as meta.name). */
	hookName: string;
	/** Absolute path to the hook's .ts file. */
	hookPath: string;
	/** ISO 8601 timestamp of engine invocation start. */
	timestamp: string;
	/** Runtime version string. */
	clooksVersion: string;
	/** Path to the clooks.yml that registered this hook. */
	configPath: string;
}
type BeforeHookEventVariants = {
	[K in EventName]: {
		type: K;
		input: EventContextMap[K];
	};
}[EventName];
export type BeforeHookEvent = {
	meta: HookEventMeta;
	respond(result: BlockResult | SkipResult): void;
} & BeforeHookEventVariants;
type AfterHookEventVariants = {
	[K in EventName]: {
		type: K;
		input: EventContextMap[K];
		handlerResult: EventResultMap[K];
		respond(result: EventResultMap[K]): void;
	};
}[EventName];
export type AfterHookEvent = {
	meta: HookEventMeta;
} & AfterHookEventVariants;
export type MaybeAsync<T> = T | Promise<T>;
export interface HookMeta<C extends Record<string, unknown> = Record<string, unknown>> {
	/** Human-readable name. Must be unique within a project. */
	name: string;
	/** Optional description. */
	description?: string;
	/** Config defaults. Must satisfy the Config interface. */
	config?: C;
}
export interface ClooksHook<C extends Record<string, unknown> = Record<string, unknown>> {
	meta: HookMeta<C>;
	/** Runs before the matched event handler. Call event.respond() to block. */
	beforeHook?: (event: BeforeHookEvent, config: C) => MaybeAsync<void>;
	/** Runs after the matched event handler completes normally. Call event.respond() to override. */
	afterHook?: (event: AfterHookEvent, config: C) => MaybeAsync<void>;
	PreToolUse?: (ctx: PreToolUseContext, config: C) => MaybeAsync<PreToolUseResult>;
	UserPromptSubmit?: (ctx: UserPromptSubmitContext, config: C) => MaybeAsync<UserPromptSubmitResult>;
	PermissionRequest?: (ctx: PermissionRequestContext, config: C) => MaybeAsync<PermissionRequestResult>;
	Stop?: (ctx: StopContext, config: C) => MaybeAsync<StopEventResult>;
	SubagentStop?: (ctx: SubagentStopContext, config: C) => MaybeAsync<SubagentStopResult>;
	ConfigChange?: (ctx: ConfigChangeContext, config: C) => MaybeAsync<ConfigChangeResult>;
	SessionStart?: (ctx: SessionStartContext, config: C) => MaybeAsync<SessionStartResult>;
	SessionEnd?: (ctx: SessionEndContext, config: C) => MaybeAsync<SessionEndResult>;
	InstructionsLoaded?: (ctx: InstructionsLoadedContext, config: C) => MaybeAsync<InstructionsLoadedResult>;
	PostToolUse?: (ctx: PostToolUseContext, config: C) => MaybeAsync<PostToolUseResult>;
	PostToolUseFailure?: (ctx: PostToolUseFailureContext, config: C) => MaybeAsync<PostToolUseFailureResult>;
	Notification?: (ctx: NotificationContext, config: C) => MaybeAsync<NotificationResult>;
	SubagentStart?: (ctx: SubagentStartContext, config: C) => MaybeAsync<SubagentStartResult>;
	WorktreeRemove?: (ctx: WorktreeRemoveContext, config: C) => MaybeAsync<WorktreeRemoveResult>;
	PreCompact?: (ctx: PreCompactContext, config: C) => MaybeAsync<PreCompactResult>;
	PostCompact?: (ctx: PostCompactContext, config: C) => MaybeAsync<PostCompactResult>;
	PermissionDenied?: (ctx: PermissionDeniedContext, config: C) => MaybeAsync<PermissionDeniedResult>;
	StopFailure?: (ctx: StopFailureContext, config: C) => MaybeAsync<StopFailureResult>;
	WorktreeCreate?: (ctx: WorktreeCreateContext, config: C) => MaybeAsync<WorktreeCreateResult>;
	TeammateIdle?: (ctx: TeammateIdleContext, config: C) => MaybeAsync<TeammateIdleResult>;
	TaskCreated?: (ctx: TaskCreatedContext, config: C) => MaybeAsync<TaskCreatedResult>;
	TaskCompleted?: (ctx: TaskCompletedContext, config: C) => MaybeAsync<TaskCompletedResult>;
}

export {};
