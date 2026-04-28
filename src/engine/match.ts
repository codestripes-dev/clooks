import type { EventName, HookName } from '../types/branded.js'
import type { ClooksConfig } from '../config/schema.js'
import type { LoadedHook } from '../loader.js'

/**
 * Result of matching hooks for an event: the matched hooks plus any hooks
 * that were skipped due to enabled: false (hook-level or per-event).
 */
export interface MatchResult {
  matched: LoadedHook[]
  disabledSkips: Array<{ hook: HookName; reason: string }>
}

/**
 * Filters loaded hooks to those with a handler for the given event name,
 * excluding hooks disabled via config (hook-level or per-event).
 * Exported for unit testing.
 */
export function matchHooksForEvent(
  hooks: LoadedHook[],
  eventName: EventName,
  config: ClooksConfig,
): MatchResult {
  const matched: LoadedHook[] = []
  const disabledSkips: Array<{ hook: HookName; reason: string }> = []

  for (const h of hooks) {
    const hookEntry = config.hooks[h.name]

    // Hook-level disable
    if (hookEntry?.enabled === false) {
      disabledSkips.push({
        hook: h.name,
        reason: `hook "${h.name}" disabled entirely via config`,
      })
      continue
    }

    // Per-event disable
    if (hookEntry?.events?.[eventName]?.enabled === false) {
      disabledSkips.push({
        hook: h.name,
        reason: `hook "${h.name}" disabled for event "${eventName}" via config`,
      })
      continue
    }

    // Handler presence check (existing logic)
    if (typeof (h.hook as unknown as Record<string, unknown>)[eventName] === 'function') {
      matched.push(h)
    }
  }

  return { matched, disabledSkips }
}

/**
 * Generates shadow warnings when project hooks shadow home (global) hooks.
 * Emits a single collapsed line listing all shadowed names alphabetically,
 * comma-separated. Only emitted during SessionStart events. Currently only
 * the project→home scope is reported (local→{project,home} shadows are
 * structurally always source-identical and excluded upstream).
 */
export function buildShadowWarnings(eventName: string, shadows: HookName[]): string[] {
  if (eventName !== 'SessionStart' || shadows.length === 0) return []
  const names = [...shadows].sort().join(', ')
  return [`clooks: project hooks shadowing home: ${names}`]
}
