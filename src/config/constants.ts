import type { EventName, Milliseconds } from '../types/branded.js'

// The 20 Claude Code event names. These are reserved — they cannot be
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
  'SubagentStop',
  'SubagentStart',
  'InstructionsLoaded',
  'PostToolUseFailure',
  'Notification',
  'PermissionRequest',
  'ConfigChange',
  'WorktreeCreate',
  'WorktreeRemove',
  'PreCompact',
  'PostCompact',
  'TeammateIdle',
  'TaskCreated',
  'TaskCompleted',
])

/** Type guard: narrows a runtime string to EventName. */
export function isEventName(s: string): s is EventName {
  return CLAUDE_CODE_EVENTS.has(s as EventName)
}

// Top-level keys that are not hook entries and not event entries.
export const RESERVED_CONFIG_KEYS = new Set(['version', 'config', ...CLAUDE_CODE_EVENTS])

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

// Default values for global config
import type { ErrorMode } from './schema.js'
export const DEFAULT_TIMEOUT = 30_000 as Milliseconds
export const DEFAULT_ON_ERROR: ErrorMode = 'block'
export const DEFAULT_MAX_FAILURES = 3
export const DEFAULT_MAX_FAILURES_MESSAGE =
  "Hook '{hook}' has failed {count} consecutive times on {event} and will be skipped. " +
  'Last error: {error}. Fix the issue or comment out the hook in clooks.yml. ' +
  'If this is unrelated to your current work, ask the User for guidance.'
