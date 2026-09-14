import { ALL_SUPPORTED_EVENTS } from './constants.js'

/**
 * Classifies raw YAML keys into version, config, hooks, and events.
 *
 * Used by both mergeThreeLayerConfig() and validateConfig() to separate
 * event keys (matching ALL_SUPPORTED_EVENTS) from hook keys.
 */
export function classifyConfigKeys(raw: Record<string, unknown>): {
  version: unknown
  config: unknown
  hooks: Record<string, unknown>
  events: Record<string, unknown>
} {
  const hooks: Record<string, unknown> = {}
  const events: Record<string, unknown> = {}

  for (const key of Object.keys(raw)) {
    if (key === 'version' || key === 'config') continue

    if (ALL_SUPPORTED_EVENTS.has(key as import('../types/branded.js').EventName)) {
      events[key] = raw[key]
    } else {
      hooks[key] = raw[key]
    }
  }

  return {
    version: raw.version,
    config: raw.config,
    hooks,
    events,
  }
}
