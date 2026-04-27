// Clooks v0.1.3 — generated type declarations
// Do not edit. Regenerate with: clooks types
type EventName = "PreToolUse" | "PostToolUse" | "UserPromptSubmit" | "SessionStart" | "SessionEnd" | "Stop" | "StopFailure" | "SubagentStop" | "SubagentStart" | "InstructionsLoaded" | "PostToolUseFailure" | "Notification" | "PermissionRequest" | "PermissionDenied" | "ConfigChange" | "WorktreeCreate" | "WorktreeRemove" | "PreCompact" | "PostCompact" | "TeammateIdle" | "TaskCreated" | "TaskCompleted";
/** Permission mode reported on `ctx.permissionMode`. Read-only — never construct. */
export type PermissionMode = "default" | "plan" | "acceptEdits" | "dontAsk" | "bypassPermissions" | (string & {});
/** Why the session started. Available on `SessionStartContext.source`. */
export type SessionStartSource = "startup" | "resume" | "clear" | "compact" | (string & {});
/** Why the session ended. Available on `SessionEndContext.reason`. */
export type SessionEndReason = "clear" | "resume" | "logout" | "prompt_input_exit" | "bypass_permissions_disabled" | "other" | (string & {});
/** Kind of notification Claude Code is about to display. */
export type NotificationType = "permission_prompt" | "idle_prompt" | "auth_success" | "elicitation_dialog" | (string & {});
/** Which CLAUDE.md tier loaded. `User` = global, `Project` / `Local` = repo, `Managed` = MDM. */
export type InstructionsMemoryType = "User" | "Project" | "Local" | "Managed" | (string & {});
/** Why an instructions file was loaded into context. */
export type InstructionsLoadReason = "session_start" | "nested_traversal" | "path_glob_match" | "include" | (string & {});
/** Whether a compact was triggered manually (`/compact`) or automatically (context full). */
export type PreCompactTrigger = "manual" | "auto" | (string & {});
/** Which settings file changed. `policy_settings` changes cannot be blocked. */
export type ConfigChangeSource = "user_settings" | "project_settings" | "local_settings" | "policy_settings" | "skills" | (string & {});
/** Where a permission rule is written. `session` = ephemeral; the others persist. */
export type PermissionDestination = "session" | "localSettings" | "projectSettings" | "userSettings" | (string & {});
/** What the rule does when matched. */
export type PermissionRuleBehavior = "allow" | "deny" | "ask" | (string & {});
/** A single permission rule. Omit `ruleContent` to match every invocation of `toolName`. */
export interface PermissionRule {
	toolName: string;
	ruleContent?: string;
}
/**
 * One permission change. Discriminated by `type` — narrow before reading
 * shape-specific fields (e.g. `rules` vs `directories` vs `mode`).
 */
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
 * Categories of API failure surfaced on `StopFailureContext.error`. Branch
 * alerting on this — e.g. page on `rate_limit`, ignore `max_output_tokens`.
 */
export type StopFailureErrorType = "rate_limit" | "authentication_failed" | "billing_error" | "invalid_request" | "server_error" | "max_output_tokens" | "unknown" | (string & {});
/** `debugMessage` is shown only when the user runs in debug mode. Safe to log internals. */
export type DebugMessage = {
	debugMessage?: string;
};
/**
 * Appended to the agent's conversation as extra context. Only honored on
 * events whose decision arms accept it.
 */
export type InjectContext = {
	injectContext?: string;
};
/** Shown to the agent (guard events) or to the user (continuation events). */
export type Reason = {
	reason: string;
};
/** Sent back to the teammate as next-step instruction. */
export type Feedback = {
	feedback: string;
};
/** Absolute path to a resource the hook produced (e.g. a worktree). */
export type Path = {
	path: string;
};
/** Renames the IDE session — equivalent to `/rename`. */
export type SessionTitle = {
	sessionTitle?: string;
};
/** Rewrites permission rules on `PermissionRequest.allow`. */
export type UpdatedPermissions = {
	updatedPermissions?: PermissionUpdateEntry[];
};
/** MCP tools only. Built-in tools (Bash, Edit, Write, …) silently ignore this field. */
export type UpdatedMcpToolOutput = {
	updatedMCPToolOutput?: unknown;
};
/** `interrupt: true` on `PermissionRequest.block` halts the agent's current turn. */
export type Interrupt = {
	interrupt?: boolean;
};
/**
 * Patches the tool's input before it runs. See `Patch<T>` for the shape.
 * Patches compose across sequential hooks — later hooks see prior hooks' edits
 * on `ctx.toolInput`.
 */
export type UpdatedInput<T> = {
	updatedInput?: T;
};
/** Permission update suggestions Claude Code attached to this request. Read-only. */
export type PermissionSuggestions = {
	permissionSuggestions?: PermissionUpdateEntry[];
};
export type Result<T extends ResultTag> = {
	result: T;
} & DebugMessage;
export type ToolVariant<N extends string, I> = {
	toolName: N;
	toolInput: I;
};
/**
 * `originalToolInput` is a read-only snapshot of the input as Claude Code
 * first sent it. Use it to detect whether earlier hooks have patched
 * `ctx.toolInput`.
 */
export type ToolVariantWithOriginal<N extends string, I> = ToolVariant<N, I> & {
	originalToolInput: I;
};
/** Opts for `event.block(...)` inside `beforeHook`. */
export interface BlockOpts extends DebugMessage, InjectContext, Interrupt, UpdatedMcpToolOutput, SessionTitle {
	reason: string;
}
/** Opts for `event.skip(...)` inside `beforeHook`. */
export interface SkipOpts extends DebugMessage, InjectContext, UpdatedMcpToolOutput {
}
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
export type Prettify<T> = {
	[K in keyof T]: T[K];
} & {};
/** Every possible value of a result's `result` discriminant. */
export type ResultTag = "allow" | "ask" | "block" | "defer" | "skip" | "success" | "failure" | "continue" | "stop" | "retry";
/** `{ result: 'allow' }` — proceed with the action. */
export type AllowResult = Result<"allow">;
/** `{ result: 'skip' }` — opt out of deciding; let other hooks (or Claude Code's defaults) handle it. */
export type SkipResult = Result<"skip">;
/**
 * `{ result: 'defer' }` — pause the tool call so a headless `claude -p`
 * caller can resume later. Honored only in `claude -p` mode AND only when
 * the turn contains a single tool call. Otherwise Claude Code ignores it.
 */
export type DeferResult = Result<"defer">;
/** `{ result: 'retry' }` — only valid on `PermissionDenied`. Hint that the model may retry. */
export type RetryResult = Result<"retry">;
/**
 * `{ result: 'ask', reason }` — surface a permission prompt to the user.
 * `reason` is the prompt text. Claude Code prefixes a source label
 * ([Project] / [User] / [Plugin] / [Local]); make `reason` clearly identify
 * which hook asked.
 */
export type AskResult = Result<"ask"> & Reason;
/** `{ result: 'block', reason }` — refuse the action. `reason` is shown to the agent. */
export type BlockResult = Result<"block"> & Reason;
/** `{ result: 'stop', reason }` — terminate the teammate. `reason` is the user-facing stop message. */
export type StopResult = Result<"stop"> & Reason;
/** `{ result: 'failure', reason }` — for `WorktreeCreate` only. `reason` is the surfaced error. */
export type FailureResult = Result<"failure"> & Reason;
/** `{ result: 'continue', feedback }` — keep working. `feedback` becomes the next-step instruction. */
export type ContinueResult = Result<"continue"> & Feedback;
/** `{ result: 'success', path }` — for `WorktreeCreate` only. `path` is the absolute worktree path. */
export type SuccessResult = Result<"success"> & Path;
/** Return value of a `PreToolUse` hook. Construct via `ctx.allow / ask / block / defer / skip`. */
export type PreToolUseResult = (AllowResult & InjectContext & UpdatedInput<Record<string, unknown>> & Partial<Reason>) | (AskResult & InjectContext & UpdatedInput<Record<string, unknown>>) | (BlockResult & InjectContext) | DeferResult | (SkipResult & InjectContext);
/** Return value of a `UserPromptSubmit` hook. */
export type UserPromptSubmitResult = (AllowResult | BlockResult | SkipResult) & InjectContext & SessionTitle;
/** Return value of a `PermissionRequest` hook. */
export type PermissionRequestResult = (AllowResult & UpdatedInput<Record<string, unknown>> & UpdatedPermissions) | (BlockResult & Interrupt) | SkipResult;
/** Return value of a `Stop` hook. `block` prevents the agent from stopping. */
export type StopEventResult = AllowResult | BlockResult | SkipResult;
/** Return value of a `SubagentStop` hook. `block` prevents the subagent from stopping. */
export type SubagentStopResult = AllowResult | BlockResult | SkipResult;
/** Return value of a `ConfigChange` hook. `policy_settings` changes cannot be blocked. */
export type ConfigChangeResult = AllowResult | BlockResult | SkipResult;
/** Return value of a `PreCompact` hook. `block` prevents the compaction. */
export type PreCompactResult = AllowResult | BlockResult | SkipResult;
/**
 * Return value of a `StopFailure` hook. Output is dropped by Claude Code —
 * `skip` exists for API uniformity. Side-effects (logging, alerts) still run.
 */
export type StopFailureResult = SkipResult;
/** Return value of a `SessionStart` hook. Use `injectContext` to seed the agent. */
export type SessionStartResult = SkipResult & InjectContext;
/** Return value of a `SessionEnd` hook. Output is ignored upstream; useful for cleanup. */
export type SessionEndResult = SkipResult;
/** Return value of an `InstructionsLoaded` hook. Pure observer. */
export type InstructionsLoadedResult = SkipResult;
/** Return value of a `PostToolUse` hook. `block` flags the tool result back to the agent. */
export type PostToolUseResult = (SkipResult & InjectContext & UpdatedMcpToolOutput) | (BlockResult & InjectContext & UpdatedMcpToolOutput);
/** Return value of a `PostToolUseFailure` hook. */
export type PostToolUseFailureResult = SkipResult & InjectContext;
/** Return value of a `Notification` hook. */
export type NotificationResult = SkipResult & InjectContext;
/** Return value of a `SubagentStart` hook. Use `injectContext` to seed the subagent. */
export type SubagentStartResult = SkipResult & InjectContext;
/** Return value of a `WorktreeRemove` hook. */
export type WorktreeRemoveResult = SkipResult;
/** Return value of a `PostCompact` hook. Pure observer. */
export type PostCompactResult = SkipResult;
/**
 * Return value of a `PermissionDenied` hook. `retry` does NOT reverse the
 * denial — it only hints to the model that it may try again.
 */
export type PermissionDeniedResult = RetryResult | SkipResult;
/**
 * Return value of a `WorktreeCreate` hook. Hooks REPLACE Claude Code's default
 * `git worktree` behavior. Return `success({ path })` with the absolute path
 * to the created directory, or `failure({ reason })` to surface an error.
 */
export type WorktreeCreateResult = SuccessResult | FailureResult;
/** Return value of a `TeammateIdle` hook. */
export type TeammateIdleResult = ContinueResult | StopResult | SkipResult;
/** Return value of a `TaskCreated` hook. */
export type TaskCreatedResult = ContinueResult | StopResult | SkipResult;
/** Return value of a `TaskCompleted` hook. */
export type TaskCompletedResult = ContinueResult | StopResult | SkipResult;
type OptionalKeys<T> = {
	[K in keyof T]-?: object extends Pick<T, K> ? K : never;
}[keyof T];
/**
 * Partial update applied to a tool's input. Pass on `allow({ updatedInput })`
 * or `ask({ updatedInput })` from `PreToolUseContext` / `PermissionRequestContext`.
 *
 * - Set a key to a value to change it.
 * - Set an optional key to `null` to remove it (required keys cannot be `null`).
 * - Omit a key (or set `undefined`) to leave it untouched.
 *
 * @example
 * // Bash: rewrite the command, keep everything else
 * ctx.allow({ updatedInput: { command: 'rg foo' } })
 *
 * @example
 * // Bash: drop the optional timeout
 * ctx.allow({ updatedInput: { timeout: null } })
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
 * Output is dropped upstream. `skip` exists for API uniformity — your handler
 * runs for side-effects (logging, alerting) only.
 */
export type StopFailureDecisionMethods = Skip<DebugMessage, StopFailureResult>;
type WorktreeCreateDecisionMethods = Success<Path, WorktreeCreateResult> & Failure<Reason, WorktreeCreateResult>;
type TeammateIdleDecisionMethods = Continue<Feedback, TeammateIdleResult> & Stop<Reason, TeammateIdleResult> & Skip<DebugMessage, TeammateIdleResult>;
type TaskCreatedDecisionMethods = Continue<Feedback, TaskCreatedResult> & Stop<Reason, TaskCreatedResult> & Skip<DebugMessage, TaskCreatedResult>;
type TaskCompletedDecisionMethods = Continue<Feedback, TaskCompletedResult> & Stop<Reason, TaskCompletedResult> & Skip<DebugMessage, TaskCompletedResult>;
/** Fields present on every context, regardless of event. */
export interface BaseContext {
	/** Event name. Narrow on this first inside multi-event hooks. */
	event: EventName;
	sessionId: string;
	cwd: string;
	permissionMode?: PermissionMode;
	transcriptPath: string;
	agentId?: string;
	agentType?: string;
	/** True when this hook is one of several running in parallel for the same event. */
	parallel: boolean;
	/** Aborted when a parallel batch short-circuits. Pass to long-running async work. */
	signal: AbortSignal;
}
/** Input for the `Bash` tool. */
export interface BashToolInput {
	command: string;
	description?: string;
	timeout?: number;
	runInBackground?: boolean;
}
/** Input for the `Write` tool. */
export interface WriteToolInput {
	filePath: string;
	content: string;
}
/** Input for the `Edit` tool. */
export interface EditToolInput {
	filePath: string;
	oldString: string;
	newString: string;
	replaceAll?: boolean;
}
/** Input for the `Read` tool. */
export interface ReadToolInput {
	filePath: string;
	offset?: number;
	limit?: number;
}
/** Input for the `Glob` tool. */
export interface GlobToolInput {
	pattern: string;
	path?: string;
}
/** Input for the `Grep` tool. */
export interface GrepToolInput {
	pattern: string;
	path?: string;
	glob?: string;
	outputMode?: "content" | "files_with_matches" | "count" | (string & {});
	"-i"?: boolean;
	multiline?: boolean;
}
/** Input for the `WebFetch` tool. */
export interface WebFetchToolInput {
	url: string;
	prompt: string;
}
/** Input for the `WebSearch` tool. */
export interface WebSearchToolInput {
	query: string;
	allowedDomains?: string[];
	blockedDomains?: string[];
}
/** Input for the `Agent` tool (subagent invocation). */
export interface AgentToolInput {
	prompt: string;
	description: string;
	subagentType: string;
	model?: string;
}
/** Input for the `AskUserQuestion` tool. */
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
/**
 * Map of every built-in tool name to its input type. Useful for writing
 * generic helpers, e.g.:
 *
 * @example
 * function logBash(input: ToolInputMap['Bash']) { ... }
 */
export interface ToolInputMap {
	Bash: BashToolInput;
	Write: WriteToolInput;
	Edit: EditToolInput;
	Read: ReadToolInput;
	Glob: GlobToolInput;
	Grep: GrepToolInput;
	WebFetch: WebFetchToolInput;
	WebSearch: WebSearchToolInput;
	Agent: AgentToolInput;
	AskUserQuestion: AskUserQuestionToolInput;
}
type PreToolUseDecisionMethods<Input> = Allow<UpdatedInput<Patch<Input>> & Partial<Reason> & InjectContext, PreToolUseResult> & Ask<Reason & UpdatedInput<Patch<Input>> & InjectContext, PreToolUseResult> & Block<Reason & InjectContext, PreToolUseResult> & Defer<DebugMessage, PreToolUseResult> & Skip<InjectContext, PreToolUseResult>;
/**
 * Fires before any tool call. Narrow on `ctx.toolName` for a typed
 * `ctx.toolInput` and a typed `Patch<Input>` on `updatedInput`. For tools
 * outside `ToolInputMap` (MCP, `ExitPlanMode`, future upstream additions),
 * use `UnknownPreToolUseContext`.
 *
 * @example
 * if (ctx.event !== 'PreToolUse') return ctx.skip()
 * if (ctx.toolName === 'Bash' && ctx.toolInput.command.includes('rm -rf /')) {
 *   return ctx.block({ reason: 'No.' })
 * }
 */
export type PreToolUseContext = {
	[K in keyof ToolInputMap & string]: Prettify<BaseContext & {
		event: "PreToolUse";
		toolUseId: string;
	} & ToolVariantWithOriginal<K, ToolInputMap[K]> & PreToolUseDecisionMethods<ToolInputMap[K]>>;
}[keyof ToolInputMap & string];
/**
 * `PreToolUse` context for tools outside `ToolInputMap` (MCP, `ExitPlanMode`).
 * `toolInput` is `Record<string, unknown>` — not narrowed. Cast from raw ctx.
 *
 * @example
 * const ctx = rawCtx as unknown as UnknownPreToolUseContext
 * if (ctx.toolName.startsWith('mcp__')) { ... }
 */
export type UnknownPreToolUseContext = Prettify<BaseContext & {
	event: "PreToolUse";
	toolUseId: string;
} & ToolVariantWithOriginal<string, Record<string, unknown>> & PreToolUseDecisionMethods<Record<string, unknown>>>;
/** Fires when the user submits a prompt. */
export type UserPromptSubmitContext = BaseContext & {
	event: "UserPromptSubmit";
	prompt: string;
} & UserPromptSubmitDecisionMethods;
type PermissionRequestDecisionMethods<Input> = Allow<UpdatedInput<Patch<Input>> & UpdatedPermissions, PermissionRequestResult> & Block<Reason & Interrupt, PermissionRequestResult> & Skip<DebugMessage, PermissionRequestResult>;
/**
 * Fires when Claude Code is about to prompt the user for permission. The hook
 * can answer on the user's behalf. Narrow on `ctx.toolName` for a typed
 * `ctx.toolInput`; use `UnknownPermissionRequestContext` for non-built-in tools.
 *
 * `ctx.permissionSuggestions` carries the rule changes Claude Code is
 * proposing — pass them through on `allow({ updatedPermissions })` to apply.
 */
export type PermissionRequestContext = {
	[K in keyof ToolInputMap & string]: Prettify<BaseContext & PermissionSuggestions & {
		event: "PermissionRequest";
	} & ToolVariant<K, ToolInputMap[K]> & PermissionRequestDecisionMethods<ToolInputMap[K]>>;
}[keyof ToolInputMap & string];
/**
 * `PermissionRequest` context for tools outside `ToolInputMap`. Cast from raw ctx.
 *
 * @example
 * const ctx = rawCtx as unknown as UnknownPermissionRequestContext
 * if (ctx.toolName.startsWith('mcp__')) {
 *   return ctx.allow({ updatedInput: { ... } })
 * }
 */
export type UnknownPermissionRequestContext = Prettify<BaseContext & PermissionSuggestions & {
	event: "PermissionRequest";
} & ToolVariant<string, Record<string, unknown>> & PermissionRequestDecisionMethods<Record<string, unknown>>>;
/**
 * Fires when the main agent has finished its turn. `block({ reason })` forces
 * the agent to keep going; `reason` becomes the next-turn instruction.
 */
export type StopContext = BaseContext & {
	event: "Stop";
	stopHookActive: boolean;
	lastAssistantMessage: string;
} & StopDecisionMethods;
/** Same shape as `StopContext` but for a subagent. */
export type SubagentStopContext = BaseContext & {
	event: "SubagentStop";
	stopHookActive: boolean;
	agentId: string;
	agentType: string;
	agentTranscriptPath: string;
	lastAssistantMessage: string;
} & SubagentStopDecisionMethods;
/**
 * Fires when a settings file changes. `block` is silently downgraded to `skip`
 * for `source: 'policy_settings'` — those can't be blocked upstream.
 */
export type ConfigChangeContext = BaseContext & {
	event: "ConfigChange";
	source: ConfigChangeSource;
	filePath?: string;
} & ConfigChangeDecisionMethods;
/**
 * Fires INSTEAD of `Stop` when the turn ended with an upstream API error
 * (rate limit, auth, billing, etc.). Output is dropped by Claude Code — use
 * the handler for logging or alerting only.
 */
export type StopFailureContext = BaseContext & {
	event: "StopFailure";
	/** Error category. Branch your alerting on this. */
	error: StopFailureErrorType;
	errorDetails?: string;
	/**
	 * Rendered API error string (e.g. `"API Error: Rate limit reached"`) — NOT
	 * Claude's conversational text as in `Stop` / `SubagentStop`.
	 */
	lastAssistantMessage?: string;
} & StopFailureDecisionMethods;
/**
 * Fires at session startup. Use `skip({ injectContext })` to seed the agent
 * with extra context (e.g. recent commits, open PRs, project notes).
 */
export type SessionStartContext = BaseContext & {
	event: "SessionStart";
	source: SessionStartSource;
	model?: string;
} & SessionStartDecisionMethods;
/** Fires at session end. Pure observer — do cleanup in the handler. */
export type SessionEndContext = BaseContext & {
	event: "SessionEnd";
	reason: SessionEndReason;
} & SessionEndDecisionMethods;
/** Fires when a CLAUDE.md or rules file is loaded into context. */
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
/**
 * Fires after a tool call succeeds. Read `ctx.toolResponse` to inspect the
 * result. Narrow on `ctx.toolName` for a typed `ctx.toolInput`; use
 * `UnknownPostToolUseContext` for non-built-in tools.
 */
export type PostToolUseContext = {
	[K in keyof ToolInputMap & string]: Prettify<BaseContext & {
		event: "PostToolUse";
		toolUseId: string;
		toolResponse: unknown;
	} & ToolVariant<K, ToolInputMap[K]> & PostToolUseDecisionMethods<ToolInputMap[K]>>;
}[keyof ToolInputMap & string];
/**
 * `PostToolUse` context for tools outside `ToolInputMap`. Cast from raw ctx.
 *
 * @example
 * const ctx = rawCtx as unknown as UnknownPostToolUseContext
 * if (ctx.toolName.startsWith('mcp__')) { ... }
 */
export type UnknownPostToolUseContext = Prettify<BaseContext & {
	event: "PostToolUse";
	toolUseId: string;
	toolResponse: unknown;
} & ToolVariant<string, Record<string, unknown>> & PostToolUseDecisionMethods<Record<string, unknown>>>;
type PostToolUseFailureDecisionMethods<_Input> = Skip<InjectContext, PostToolUseFailureResult>;
/**
 * Fires after a tool call errors. `ctx.error` carries the error message;
 * narrow on `ctx.toolName` for typed `ctx.toolInput`. Use
 * `skip({ injectContext })` to feed extra context to the agent's retry.
 */
export type PostToolUseFailureContext = {
	[K in keyof ToolInputMap & string]: Prettify<BaseContext & {
		event: "PostToolUseFailure";
		toolUseId: string;
		error: string;
		isInterrupt?: boolean;
	} & ToolVariant<K, ToolInputMap[K]> & PostToolUseFailureDecisionMethods<ToolInputMap[K]>>;
}[keyof ToolInputMap & string];
/**
 * `PostToolUseFailure` context for tools outside `ToolInputMap`. Cast from raw ctx.
 *
 * @example
 * const ctx = rawCtx as unknown as UnknownPostToolUseFailureContext
 * if (ctx.toolName.startsWith('mcp__')) { ... }
 */
export type UnknownPostToolUseFailureContext = Prettify<BaseContext & {
	event: "PostToolUseFailure";
	toolUseId: string;
	error: string;
	isInterrupt?: boolean;
} & ToolVariant<string, Record<string, unknown>> & PostToolUseFailureDecisionMethods<Record<string, unknown>>>;
/** Fires when Claude Code is about to show a notification. */
export type NotificationContext = BaseContext & {
	event: "Notification";
	message: string;
	title?: string;
	notificationType?: NotificationType;
} & NotificationDecisionMethods;
/**
 * Fires when a subagent is spawned via the `Agent` tool. Use
 * `skip({ injectContext })` to seed the subagent.
 */
export type SubagentStartContext = BaseContext & {
	event: "SubagentStart";
	agentId: string;
	agentType: string;
} & SubagentStartDecisionMethods;
/** Fires when a worktree is being removed. Pure observer; useful for cleanup. */
export type WorktreeRemoveContext = BaseContext & {
	event: "WorktreeRemove";
	worktreePath: string;
} & WorktreeRemoveDecisionMethods;
/** Fires before Claude Code compacts the conversation. `block` cancels it. */
export type PreCompactContext = BaseContext & {
	event: "PreCompact";
	trigger: PreCompactTrigger;
	customInstructions: string;
} & PreCompactDecisionMethods;
/** Fires after a compaction completes. Pure observer. */
export type PostCompactContext = BaseContext & {
	event: "PostCompact";
	trigger: PreCompactTrigger;
	compactSummary: string;
} & PostCompactDecisionMethods;
/**
 * Fires in auto mode when the permission classifier denies a tool call. Hooks
 * cannot reverse the denial; `retry` only hints that the model may try again.
 */
export type PermissionDeniedContext = BaseContext & {
	event: "PermissionDenied";
	toolName: string;
	/** Tool input as Claude Code received it. Keys are camelCase. */
	toolInput: Record<string, unknown>;
	toolUseId: string;
	/** The classifier's explanation for the denial. */
	denialReason: string;
} & PermissionDeniedDecisionMethods;
/**
 * Fires when Claude Code needs a worktree. Your hook REPLACES the default
 * `git worktree` behavior — return `success({ path })` with the absolute path
 * to the worktree you created, or `failure({ reason })`.
 */
export type WorktreeCreateContext = BaseContext & {
	event: "WorktreeCreate";
	name: string;
} & WorktreeCreateDecisionMethods;
/**
 * Fires when an agent-team teammate is about to go idle.
 * `continue({ feedback })` pushes another step; `stop({ reason })` terminates
 * the teammate.
 */
export type TeammateIdleContext = BaseContext & {
	event: "TeammateIdle";
	teammateName: string;
	teamName: string;
} & TeammateIdleDecisionMethods;
/**
 * Fires when a teammate is creating a task. `continue({ feedback })` refuses
 * creation and feeds `feedback` back to the model; `stop({ reason })`
 * terminates the teammate.
 */
export type TaskCreatedContext = BaseContext & {
	event: "TaskCreated";
	taskId: string;
	taskSubject: string;
	taskDescription?: string;
	teammateName?: string;
	teamName?: string;
} & TaskCreatedDecisionMethods;
/**
 * Fires when a teammate is marking a task complete. `continue({ feedback })`
 * refuses completion; `stop({ reason })` terminates the teammate.
 */
export type TaskCompletedContext = BaseContext & {
	event: "TaskCompleted";
	taskId: string;
	taskSubject: string;
	taskDescription?: string;
	teammateName?: string;
	teamName?: string;
} & TaskCompletedDecisionMethods;
/** Maps each event name to its context type. Useful for generic helpers. */
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
/** Maps each event name to its result type. Useful for generic helpers. */
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
/** Environment metadata passed to `beforeHook` / `afterHook` on every invocation. */
export interface HookEventMeta {
	/** Repo root from `git rev-parse --show-toplevel`. Null outside a git repo. */
	gitRoot: string | null;
	/** Current branch. Null on detached HEAD or outside a git repo. */
	gitBranch: string | null;
	platform: "darwin" | "linux";
	/** This hook's name (matches `meta.name`). */
	hookName: string;
	/** Absolute path to the hook's `.ts` file. */
	hookPath: string;
	/** ISO 8601 timestamp of engine invocation start. */
	timestamp: string;
	/** clooks runtime version. */
	clooksVersion: string;
	/** Path to the `clooks.yml` that registered this hook. */
	configPath: string;
}
/**
 * @internal
 * Sentinel returned by `event.passthrough()` from `beforeHook` / `afterHook`.
 * Don't construct directly — call `event.passthrough()`.
 */
export interface LifecyclePassthroughResult {
	result: "passthrough";
	debugMessage?: string;
}
type LifecyclePassthroughOpts = {
	debugMessage?: string;
};
type BeforeHookEventVariants = {
	[K in EventName]: {
		type: K;
		input: EventContextMap[K];
		block(opts: BlockOpts): BlockResult;
		skip(opts?: SkipOpts): SkipResult;
		passthrough(opts?: LifecyclePassthroughOpts): LifecyclePassthroughResult;
	};
}[EventName];
/**
 * Event passed to `beforeHook`. Narrow on `event.type` for typed `event.input`.
 * Return `event.block({ reason })` or `event.skip()` to short-circuit the
 * matched event handler; `event.passthrough()` (or void) is a no-op.
 */
export type BeforeHookEvent = {
	meta: HookEventMeta;
} & BeforeHookEventVariants;
type AfterHookEventVariants = {
	[K in EventName]: {
		type: K;
		input: EventContextMap[K];
		handlerResult: EventResultMap[K];
		passthrough(opts?: LifecyclePassthroughOpts): LifecyclePassthroughResult;
	};
}[EventName];
/**
 * Event passed to `afterHook`. Narrow on `event.type` for typed `event.input`
 * and `event.handlerResult`. Pure observer — the result cannot be mutated.
 * Return `event.passthrough()` (or void) when done.
 */
export type AfterHookEvent = {
	meta: HookEventMeta;
} & AfterHookEventVariants;
/** A handler return type that may be sync or async. */
export type MaybeAsync<T> = T | Promise<T>;
/** The `meta` export every hook file must produce. */
export interface HookMeta<C extends Record<string, unknown> = Record<string, unknown>> {
	/** Human-readable name. Must be unique within a project. */
	name: string;
	/** Optional one-liner describing what the hook does. */
	description?: string;
	/** Default config for this hook. Users can override via `clooks.yml`. */
	config?: C;
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
	meta: HookMeta<C>;
	/**
	 * Runs before the matched event handler. Return `event.block({ reason })` or
	 * `event.skip()` to short-circuit, `event.passthrough()` for a debug
	 * breadcrumb, or void for a silent no-op.
	 */
	beforeHook?: (event: BeforeHookEvent, config: C) => MaybeAsync<BlockResult | SkipResult | LifecyclePassthroughResult | void>;
	/**
	 * Runs after the matched event handler. Observer-only: read
	 * `event.handlerResult` (narrow on `event.type` first) and emit side effects.
	 * The result cannot be mutated. Return `event.passthrough()` for a debug
	 * breadcrumb or void for a silent no-op.
	 */
	afterHook?: (event: AfterHookEvent, config: C) => MaybeAsync<LifecyclePassthroughResult | void>;
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
