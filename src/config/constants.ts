// The 18 Claude Code event names. These are reserved — they cannot be
// used as hook names in clooks.yml because they have special meaning
// as per-event configuration entries.
//
// Note: The engine (src/engine.ts) defines categorized subsets of these
// events (GUARD_EVENTS, OBSERVE_EVENTS, CONTINUATION_EVENTS) for result
// translation. Both sets must stay in sync.
export const CLAUDE_CODE_EVENTS: Set<string> = new Set([
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "SessionStart",
  "SessionEnd",
  "Stop",
  "SubagentStop",
  "SubagentStart",
  "InstructionsLoaded",
  "PostToolUseFailure",
  "Notification",
  "PermissionRequest",
  "ConfigChange",
  "WorktreeCreate",
  "WorktreeRemove",
  "PreCompact",
  "TeammateIdle",
  "TaskCompleted",
])

// Top-level keys that are not hook entries and not event entries.
export const RESERVED_CONFIG_KEYS = new Set([
  "version",
  "config",
  ...CLAUDE_CODE_EVENTS,
])

// Default values for global config
import type { ErrorMode } from "./types.js"
export const DEFAULT_TIMEOUT = 30_000
export const DEFAULT_ON_ERROR: ErrorMode = "block"
