import type { EventName, Milliseconds } from '../types/branded.js'
import type { AgentId } from '../types/contexts.js'

// Agent ids this version recognizes. Config and hook metadata accept any
// string so a future id keeps validating; anything outside this list matches
// no agent and is reported once at SessionStart.
const AGENT_IDS = ['claude-code', 'codex'] as const satisfies readonly AgentId[]

// Compile-time guard: adding an AgentId without listing it above is an error.
type AssertTrue<T extends true> = T
type _AllAgentIdsKnown = AssertTrue<
  Exclude<AgentId, (typeof AGENT_IDS)[number]> extends never ? true : false
>

export const KNOWN_AGENT_IDS: readonly string[] = AGENT_IDS

// The 22 Claude Code event names. These are reserved — they cannot be
// used as hook names in clooks.yml because they have special meaning
// as per-event configuration entries.
//
// The engine (src/engine.ts) defines categorized subsets of these events
// for result translation. Completeness is enforced by assertCategoryCompleteness()
// in engine.ts — adding events here without categorizing them throws immediately.
export const CLAUDE_CODE_EVENTS: Set<EventName> = new Set<EventName>([
  'PreToolUse',
  'PostToolUse',
  'UserPromptSubmit',
  'SessionStart',
  'SessionEnd',
  'Stop',
  'StopFailure',
  'SubagentStop',
  'SubagentStart',
  'InstructionsLoaded',
  'PostToolUseFailure',
  'Notification',
  'PermissionRequest',
  'PermissionDenied',
  'ConfigChange',
  'WorktreeCreate',
  'WorktreeRemove',
  'PreCompact',
  'PostCompact',
  'TeammateIdle',
  'TaskCreated',
  'TaskCompleted',
])

/** Claude-only recognition must not use the shared configuration catalog. */
export function isClaudeCodeEventName(s: string): s is EventName {
  return CLAUDE_CODE_EVENTS.has(s as EventName)
}

export const ALL_SUPPORTED_EVENTS: Set<EventName> = new Set([...CLAUDE_CODE_EVENTS, 'Interrupt'])

/** Type guard for shared configuration and hook exports. */
export function isEventName(s: string): s is EventName {
  return ALL_SUPPORTED_EVENTS.has(s as EventName)
}

// Top-level keys that are not hook entries and not event entries.
export const RESERVED_CONFIG_KEYS = new Set(['version', 'config', ...ALL_SUPPORTED_EVENTS])

// Events that support injectContext → additionalContext
export const INJECTABLE_EVENTS: Set<EventName> = new Set<EventName>([
  'PreToolUse',
  'UserPromptSubmit',
  'SessionStart',
  'PostToolUse',
  'PostToolUseFailure',
  'Notification',
  'SubagentStart',
])

// Events whose stdout and exit code are dropped by Claude Code.
// Hooks on these events run purely for side effects (logging, alerting).
// The engine short-circuits translateResult() to EXIT_OK with no output.
export const NOTIFY_ONLY_EVENTS: Set<EventName> = new Set<EventName>(['StopFailure'])

/**
 * Handoff delivery setting: false = never, true = always,
 * positive integer N = hand off only when the payload exceeds N characters.
 */
export type HandoffSetting = boolean | number

// Events that carry at least one model-facing payload handoff can replace:
// injectContext (injectable events), block reasons delivered to the model
// (Stop, SubagentStop), and continuation feedback (TeammateIdle, TaskCreated,
// TaskCompleted). Event-level handoff on anything else can never fire.
export const HANDOFF_ELIGIBLE_EVENTS: Set<EventName> = new Set<EventName>([
  ...INJECTABLE_EVENTS,
  'Stop',
  'SubagentStop',
  'TeammateIdle',
  'TaskCreated',
  'TaskCompleted',
])

// Default values for global config
import type { ErrorMode } from './schema.js'
export const CLOOKS_DIR = '.clooks'
export const CLOOKS_CONFIG_FILENAME = 'clooks.yml'
export const DEFAULT_TIMEOUT = 30_000 as Milliseconds
export const DEFAULT_ON_ERROR: ErrorMode = 'block'
export const DEFAULT_MAX_FAILURES = 3
export const DEFAULT_HANDOFF: HandoffSetting = false
export const DEFAULT_MAX_FAILURES_MESSAGE =
  "Hook '{hook}' has failed {count} consecutive times on {event} and will be skipped. " +
  'Last error: {error}. Fix the issue or comment out the hook in clooks.yml. ' +
  'If this is unrelated to your current work, ask the User for guidance.'
