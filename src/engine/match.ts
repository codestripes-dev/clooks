import type { EventName, HookName } from '../types/branded.js'
import type { ClooksConfig, Matcher } from '../config/schema.js'
import type { LoadedHook } from '../loader.js'
import { matchesContext, type MatchContext } from './matcher.js'

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
 * Resolves the effective matcher for a hook+event pair.
 * Per-event matcher overrides per-hook matcher.
 */
function resolveMatcher(
  hookName: HookName,
  eventName: EventName,
  config: ClooksConfig,
): Matcher | undefined {
  const hookEntry = config.hooks[hookName]
  if (!hookEntry) return undefined

  // Per-event matcher takes precedence
  const eventMatcher = hookEntry.events?.[eventName]?.matcher
  if (eventMatcher) return eventMatcher

  // Fall back to hook-level matcher
  return hookEntry.matcher
}

/**
 * Filters matched hooks by their matcher patterns against the event context.
 * Hooks whose matcher does not match are removed from the matched set.
 * If CLOOKS_DEBUG is set, debug messages are emitted for skipped hooks.
 *
 * Returns the filtered match result with matcher-skipped hooks added to disabledSkips.
 */
export function filterByMatcher(
  result: MatchResult,
  eventName: EventName,
  context: MatchContext,
  config: ClooksConfig,
  debug: boolean,
): MatchResult {
  const filtered: LoadedHook[] = []
  const { matched, disabledSkips } = result

  for (const h of matched) {
    const matcher = resolveMatcher(h.name, eventName, config)
    if (!matcher) {
      // No matcher — hook passes through
      filtered.push(h)
      continue
    }

    const didMatch = matchesContext(matcher, context)
    if (didMatch) {
      filtered.push(h)
    } else if (debug) {
      const matchLogic = matcher.matchLogic ?? 'and'
      const conditions = []
      if (matcher.command) conditions.push(`command:/${matcher.command}/`)
      if (matcher.tool) conditions.push(`tool:${matcher.tool}`)
      if (matcher.file) conditions.push(`file:${matcher.file}`)
      if (matcher.prompt) conditions.push(`prompt:/${matcher.prompt}/`)
      disabledSkips.push({
        hook: h.name,
        reason: `hook "${h.name}" did not match (matchLogic: ${matchLogic}, conditions: ${conditions.join(', ')})`,
      })
    }
    // If not debug mode and no match, silently skip (no log entry)
  }

  return { matched: filtered, disabledSkips }
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
