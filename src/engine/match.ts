import type { EventName, HookName } from '../types/branded.js'
import type { ClooksConfig, GlobalConfig, HookEntry } from '../config/schema.js'
import type { HookMeta } from '../types/hook.js'
import { KNOWN_AGENT_IDS } from '../config/constants.js'
import type { LoadedHook } from '../loader.js'

/** A skipped hook plus the debug line explaining why it was skipped. */
export interface SkipRecord {
  hook: HookName
  reason: string
}

/**
 * Result of matching hooks for an event: the matched hooks, hooks skipped by
 * enabled: false (hook-level or per-event), and hooks skipped because they do
 * not run under the invoking agent.
 */
export interface MatchResult {
  matched: LoadedHook[]
  disabledSkips: SkipRecord[]
  agentSkips: SkipRecord[]
}

/** The agent allowlist that applies to a hook, plus where it came from. */
export interface AgentScope {
  agents: readonly string[]
  /** Human-readable origin, used in debug output. */
  source: string
}

/**
 * Picks the one agent allowlist that governs a hook for an event. Most
 * specific wins and replaces the rest; nothing is intersected. Undefined means
 * no list applies, so the hook runs under every agent.
 */
export function resolveAgentScope(
  hookEntry: HookEntry | undefined,
  meta: HookMeta | undefined,
  global: GlobalConfig,
  eventName: EventName,
): AgentScope | undefined {
  const perEvent = hookEntry?.events?.[eventName]?.agents
  if (perEvent) return { agents: perEvent, source: `clooks.yml events.${eventName}.agents` }
  if (hookEntry?.agents) return { agents: hookEntry.agents, source: 'clooks.yml hook agents' }
  if (meta?.agents) return { agents: meta.agents, source: 'hook meta.agents' }
  if (global.agents) return { agents: global.agents, source: 'clooks.yml config.agents' }
  return undefined
}

/** The allowlist alone, for callers that do not need its origin. */
export function resolveAgents(
  hookEntry: HookEntry | undefined,
  meta: HookMeta | undefined,
  global: GlobalConfig,
  eventName: EventName,
): readonly string[] | undefined {
  return resolveAgentScope(hookEntry, meta, global, eventName)?.agents
}

/**
 * Whether a hook governed by `list` runs under `agentId`. No list means every
 * agent. Ids the runtime does not know are simply never the current agent, so
 * a list of only unknown ids matches nothing.
 */
export function runsUnderAgent(list: readonly string[] | undefined, agentId: string): boolean {
  return list === undefined || list.includes(agentId)
}

/**
 * Filters loaded hooks to those with a handler for the given event name,
 * excluding hooks disabled via config (hook-level or per-event) and hooks that
 * do not run under the invoking agent.
 * Exported for unit testing.
 */
export function matchHooksForEvent(
  hooks: LoadedHook[],
  eventName: EventName,
  config: ClooksConfig,
  agentId: string,
): MatchResult {
  const matched: LoadedHook[] = []
  const disabledSkips: SkipRecord[] = []
  const agentSkips: SkipRecord[] = []

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

    // Agent scope, decided before handler presence so ordering learns the name
    // even when the hook has no handler for this event.
    const scope = resolveAgentScope(hookEntry, h.hook.meta, config.global, eventName)
    if (scope && !runsUnderAgent(scope.agents, agentId)) {
      agentSkips.push({
        hook: h.name,
        reason: `hook "${h.name}" skipped for agent "${agentId}" via ${scope.source}`,
      })
      continue
    }

    // Handler presence check (existing logic)
    if (typeof (h.hook as unknown as Record<string, unknown>)[eventName] === 'function') {
      matched.push(h)
    }
  }

  return { matched, disabledSkips, agentSkips }
}

/**
 * Collects agent ids that appear in any `agents` list but are not known to this
 * runtime, so a config written for a newer clooks keeps working while the user
 * still hears about the ids being ignored. Independent of matching: every
 * layer is scanned whether or not its hook ran. Only emitted at SessionStart,
 * as one collapsed, de-duplicated, alphabetical line.
 */
export function buildUnknownAgentWarnings(
  eventName: string,
  config: ClooksConfig,
  hooks: LoadedHook[],
): string[] {
  if (eventName !== 'SessionStart') return []

  const known = new Set<string>(KNOWN_AGENT_IDS)
  const unknown = new Set<string>()
  const collect = (list: readonly string[] | undefined) => {
    for (const id of list ?? []) {
      if (!known.has(id)) unknown.add(id)
    }
  }

  collect(config.global.agents)
  for (const entry of Object.values(config.hooks)) {
    collect(entry.agents)
    for (const override of Object.values(entry.events ?? {})) collect(override?.agents)
  }
  for (const h of hooks) collect(h.hook.meta.agents)

  if (unknown.size === 0) return []
  return [`clooks: unknown agent ids in agents lists (ignored): ${[...unknown].sort().join(', ')}`]
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
