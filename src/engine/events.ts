import type { EventName } from '../types/branded.js'
import { CLAUDE_CODE_EVENTS } from '../config/constants.js'

// Event categories for result translation.
// Completeness is enforced by assertCategoryCompleteness() below — adding
// or removing events without updating these sets causes a module-load error.
export const GUARD_EVENTS: Set<EventName> = new Set<EventName>([
  'PreToolUse',
  'UserPromptSubmit',
  'PermissionRequest',
  'Stop',
  'SubagentStop',
  'ConfigChange',
])

export const OBSERVE_EVENTS: Set<EventName> = new Set<EventName>([
  'SessionStart',
  'SessionEnd',
  'InstructionsLoaded',
  'PostToolUse',
  'PostToolUseFailure',
  'Notification',
  'SubagentStart',
  'WorktreeRemove',
  'PreCompact',
])

export const CONTINUATION_EVENTS: Set<EventName> = new Set<EventName>([
  'TeammateIdle',
  'TaskCompleted',
])

/**
 * Asserts that the category sets are complete and non-overlapping.
 * Every event in `allEvents` must appear in exactly one category.
 * Exported for unit testing; called at module load below.
 */
export function assertCategoryCompleteness(
  allEvents: Set<EventName>,
  categories: Array<[string, Set<EventName>]>,
): void {
  // Check for overlaps — each event must be in at most one category
  const seen = new Map<EventName, string>()
  for (const [categoryName, categorySet] of categories) {
    for (const event of categorySet) {
      const existing = seen.get(event)
      if (existing) {
        throw new Error(
          `clooks: event "${event}" appears in both ${existing} and ${categoryName}. ` +
            `Each event must be in exactly one category.`,
        )
      }
      seen.set(event, categoryName)
    }
  }

  // Check completeness — every event must be categorized
  for (const event of allEvents) {
    if (!seen.has(event)) {
      throw new Error(
        `clooks: event "${event}" is in CLAUDE_CODE_EVENTS but not categorized in ` +
          `GUARD_EVENTS, OBSERVE_EVENTS, CONTINUATION_EVENTS, or WorktreeCreate. ` +
          `Add it to the appropriate category set in src/engine.ts.`,
      )
    }
  }

  // Check reverse — no stale entries in category sets
  for (const event of seen.keys()) {
    if (!allEvents.has(event)) {
      throw new Error(
        `clooks: event "${event}" is categorized in engine.ts but not in CLAUDE_CODE_EVENTS. ` +
          `Either add it to CLAUDE_CODE_EVENTS in src/config/constants.ts or remove it from the category set.`,
      )
    }
  }
}

assertCategoryCompleteness(CLAUDE_CODE_EVENTS, [
  ['GUARD_EVENTS', GUARD_EVENTS],
  ['OBSERVE_EVENTS', OBSERVE_EVENTS],
  ['CONTINUATION_EVENTS', CONTINUATION_EVENTS],
  ['WorktreeCreate', new Set<EventName>(['WorktreeCreate'])],
])
