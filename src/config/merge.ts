import type { HookOrigin } from './schema.js'
import { classifyConfigKeys } from './classify.js'

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === 'object' && !Array.isArray(val)
}

function assertOrderElementIsString(
  element: unknown,
  index: number,
  eventKey: string,
  layer: 'home' | 'project',
): void {
  if (typeof element !== 'string' || element.length === 0) {
    throw new Error(
      `clooks: ${layer} config event "${eventKey}" order contains invalid element at index ${index}: ` +
        `expected a non-empty string, got ${element === null ? 'null' : element === '' ? 'empty string' : typeof element}`,
    )
  }
}

export function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...base }
  for (const key of Object.keys(override)) {
    const baseVal = result[key]
    const overVal = override[key]
    if (isPlainObject(baseVal) && isPlainObject(overVal)) {
      result[key] = deepMerge(
        baseVal as Record<string, unknown>,
        overVal as Record<string, unknown>,
      )
    } else {
      result[key] = overVal
    }
  }
  return result
}

export function mergeConfigFiles(
  base: Record<string, unknown>,
  local: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (local === undefined) return base
  return deepMerge(base, local)
}

// --- Three-layer merge ---

export interface ThreeLayerMergeResult {
  merged: Record<string, unknown>
  originMap: Map<string, HookOrigin>
  shadows: string[] // hook names where project shadowed home
  homeHookUses: Map<string, string | undefined> // raw uses field from home hooks (before local override)
}

/**
 * Merges three config layers: home (~/.clooks/clooks.yml), project (.clooks/clooks.yml),
 * and local (.clooks/clooks.local.yml) into a single flat YAML-shaped object.
 *
 * Merge rules:
 * - version: last-writer-wins (project > home, local > both)
 * - config: deep merge across all layers (home → project → local)
 * - hooks: ATOMIC replacement — project hooks with same name replace home hooks entirely;
 *   local hooks replace whatever is there (or define new hooks with origin "project")
 * - events: home order + project order concatenated (home first); local replaces entirely
 * - Scoping: home event order lists can only reference home hooks;
 *   project event order lists can only reference project hooks
 */
export function mergeThreeLayerConfig(
  home: Record<string, unknown> | undefined,
  project: Record<string, unknown> | undefined,
  local: Record<string, unknown> | undefined,
): ThreeLayerMergeResult {
  const originMap = new Map<string, HookOrigin>()
  const shadows: string[] = []
  const homeHookUses = new Map<string, string | undefined>()

  // Classify each layer
  const homeClassified = home ? classifyConfigKeys(home) : undefined
  const projectClassified = project ? classifyConfigKeys(project) : undefined
  const localClassified = local ? classifyConfigKeys(local) : undefined

  // Collect hook names per layer for scoping validation
  const homeHookNames = new Set(homeClassified ? Object.keys(homeClassified.hooks) : [])
  const projectHookNames = new Set(projectClassified ? Object.keys(projectClassified.hooks) : [])

  // --- Scoping validation ---
  // Home event order lists can only reference home hooks
  if (homeClassified) {
    for (const [eventKey, eventVal] of Object.entries(homeClassified.events)) {
      if (isPlainObject(eventVal) && Array.isArray((eventVal as Record<string, unknown>).order)) {
        const rawOrder = (eventVal as Record<string, unknown>).order as unknown[]
        for (let i = 0; i < rawOrder.length; i++) {
          assertOrderElementIsString(rawOrder[i], i, eventKey, 'home')
          const hookRef = rawOrder[i] as string
          if (!homeHookNames.has(hookRef)) {
            throw new Error(
              `clooks: home config event "${eventKey}" order references hook "${hookRef}" which is not defined in the home config. ` +
                `Home event order lists can only reference hooks defined in ~/.clooks/clooks.yml.`,
            )
          }
        }
      }
    }
  }

  // Project event order lists can only reference project hooks
  if (projectClassified) {
    for (const [eventKey, eventVal] of Object.entries(projectClassified.events)) {
      if (isPlainObject(eventVal) && Array.isArray((eventVal as Record<string, unknown>).order)) {
        const rawOrder = (eventVal as Record<string, unknown>).order as unknown[]
        for (let i = 0; i < rawOrder.length; i++) {
          assertOrderElementIsString(rawOrder[i], i, eventKey, 'project')
          const hookRef = rawOrder[i] as string
          if (!projectHookNames.has(hookRef)) {
            throw new Error(
              `clooks: project config event "${eventKey}" order references hook "${hookRef}" which is not defined in the project config. ` +
                `Project event order lists can only reference hooks defined in .clooks/clooks.yml.`,
            )
          }
        }
      }
    }
  }

  // --- Merge version: last-writer-wins ---
  let version: unknown
  if (homeClassified?.version !== undefined) version = homeClassified.version
  if (projectClassified?.version !== undefined) version = projectClassified.version
  if (localClassified?.version !== undefined) version = localClassified.version

  // --- Merge config: deep merge across layers ---
  let config: Record<string, unknown> | undefined
  if (homeClassified?.config !== undefined && isPlainObject(homeClassified.config)) {
    config = { ...(homeClassified.config as Record<string, unknown>) }
  }
  if (projectClassified?.config !== undefined && isPlainObject(projectClassified.config)) {
    config = config
      ? deepMerge(config, projectClassified.config as Record<string, unknown>)
      : { ...(projectClassified.config as Record<string, unknown>) }
  }
  if (localClassified?.config !== undefined && isPlainObject(localClassified.config)) {
    config = config
      ? deepMerge(config, localClassified.config as Record<string, unknown>)
      : { ...(localClassified.config as Record<string, unknown>) }
  }

  // --- Merge hooks: ATOMIC replacement ---
  const mergedHooks: Record<string, unknown> = {}

  // Start with home hooks
  if (homeClassified) {
    for (const [name, value] of Object.entries(homeClassified.hooks)) {
      mergedHooks[name] = value
      originMap.set(name, 'home')
      // Track the raw uses field from the home hook entry before any local override
      const rawUses = isPlainObject(value)
        ? ((value as Record<string, unknown>).uses as string | undefined)
        : undefined
      homeHookUses.set(name, rawUses)
    }
  }

  // Project hooks replace home hooks atomically
  if (projectClassified) {
    for (const [name, value] of Object.entries(projectClassified.hooks)) {
      if (originMap.has(name)) {
        shadows.push(name)
      }
      mergedHooks[name] = value
      originMap.set(name, 'project')
    }
  }

  // Local hooks replace whatever is there; new hooks get origin "project"
  if (localClassified) {
    for (const [name, value] of Object.entries(localClassified.hooks)) {
      if (!originMap.has(name)) {
        // New hook from local config (e.g., local-scoped plugin registration).
        // Origin is "project" because the hook lives in the project directory.
        originMap.set(name, 'project')
      }
      mergedHooks[name] = value
    }
  }

  // --- Merge events: concatenate home + project orders, local replaces entirely ---
  const mergedEvents: Record<string, unknown> = {}

  // Collect all event keys across layers
  const allEventKeys = new Set<string>()
  if (homeClassified) for (const key of Object.keys(homeClassified.events)) allEventKeys.add(key)
  if (projectClassified)
    for (const key of Object.keys(projectClassified.events)) allEventKeys.add(key)
  if (localClassified) for (const key of Object.keys(localClassified.events)) allEventKeys.add(key)

  for (const eventKey of allEventKeys) {
    const homeEvent = homeClassified?.events[eventKey]
    const projectEvent = projectClassified?.events[eventKey]
    const localEvent = localClassified?.events[eventKey]

    if (localEvent !== undefined) {
      // Local replaces entirely
      mergedEvents[eventKey] = localEvent
    } else {
      // Concatenate home order + project order
      const rawHomeOrder =
        isPlainObject(homeEvent) && Array.isArray((homeEvent as Record<string, unknown>).order)
          ? ((homeEvent as Record<string, unknown>).order as unknown[])
          : []
      for (let i = 0; i < rawHomeOrder.length; i++) {
        assertOrderElementIsString(rawHomeOrder[i], i, eventKey, 'home')
      }
      const homeOrder = rawHomeOrder as string[]
      const rawProjectOrder =
        isPlainObject(projectEvent) &&
        Array.isArray((projectEvent as Record<string, unknown>).order)
          ? ((projectEvent as Record<string, unknown>).order as unknown[])
          : []
      for (let i = 0; i < rawProjectOrder.length; i++) {
        assertOrderElementIsString(rawProjectOrder[i], i, eventKey, 'project')
      }
      const projectOrder = rawProjectOrder as string[]

      if (homeOrder.length > 0 || projectOrder.length > 0) {
        mergedEvents[eventKey] = { order: [...homeOrder, ...projectOrder] }
      } else {
        // Both have event entries but neither has order — merge the event entry
        // Use last-writer-wins for the event object itself
        if (projectEvent !== undefined) {
          mergedEvents[eventKey] = projectEvent
        } else if (homeEvent !== undefined) {
          mergedEvents[eventKey] = homeEvent
        }
      }
    }
  }

  // --- Reassemble in flat YAML format ---
  const merged: Record<string, unknown> = {}
  if (version !== undefined) merged.version = version
  if (config !== undefined) merged.config = config
  for (const [name, value] of Object.entries(mergedHooks)) {
    merged[name] = value
  }
  for (const [name, value] of Object.entries(mergedEvents)) {
    merged[name] = value
  }

  return { merged, originMap, shadows, homeHookUses }
}
