import type { EventName, HookName, Milliseconds } from "../types/branded.js"
import type {
  ClooksConfig,
  ErrorMode,
  GlobalConfig,
  HookEntry,
  HookOrigin,
  EventEntry,
} from "./types.js"
import {
  CLAUDE_CODE_EVENTS,
  INJECTABLE_EVENTS,
  isEventName,
  DEFAULT_TIMEOUT,
  DEFAULT_ON_ERROR,
  DEFAULT_MAX_FAILURES,
  DEFAULT_MAX_FAILURES_MESSAGE,
} from "./constants.js"
import { resolveHookPath, isPathLike } from "./resolve.js"
import { classifyConfigKeys } from "./classify.js"

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === "object" && !Array.isArray(val)
}

function validateErrorMode(value: unknown, label: string): ErrorMode {
  if (value !== "block" && value !== "continue" && value !== "trace") {
    throw new Error(
      `clooks: ${label} "onError" must be "block", "continue", or "trace", got "${String(value)}"`,
    )
  }
  return value
}

function validatePositiveNumber(value: unknown, label: string, field: string): number {
  if (typeof value !== "number" || value <= 0) {
    throw new Error(`clooks: ${label} "${field}" must be a positive number`)
  }
  return value
}

function rejectUnknownKeys(
  obj: Record<string, unknown>,
  knownKeys: ReadonlySet<string>,
  label: string,
): void {
  for (const key of Object.keys(obj)) {
    if (!knownKeys.has(key)) {
      const known = [...knownKeys].sort().join(", ")
      throw new Error(
        `clooks: ${label} has unknown key "${key}". Known keys: ${known}`
      )
    }
  }
}

const KNOWN_GLOBAL_CONFIG_KEYS = new Set<string>([
  "timeout",
  "onError",
  "maxFailures",
  "maxFailuresMessage",
])

const KNOWN_EVENT_ENTRY_KEYS = new Set<string>([
  "order",
  "onError",
  "timeout",
])

const KNOWN_HOOK_ENTRY_KEYS = new Set<string>([
  "config",
  "uses",
  "timeout",
  "onError",
  "parallel",
  "maxFailures",
  "maxFailuresMessage",
  "events",
])

const KNOWN_HOOK_EVENT_OVERRIDE_KEYS = new Set<string>([
  "onError",
])

export function validateConfig(raw: Record<string, unknown>): ClooksConfig {
  // 1. Version field
  if (!("version" in raw)) {
    throw new Error(`clooks: clooks.yml missing required "version" field`)
  }
  if (typeof raw.version !== "string") {
    throw new Error(
      `clooks: "version" must be a string, got ${typeof raw.version}`,
    )
  }
  const version = raw.version

  // 2. Global config
  let global: GlobalConfig = {
    timeout: DEFAULT_TIMEOUT,
    onError: DEFAULT_ON_ERROR,
    maxFailures: DEFAULT_MAX_FAILURES,
    maxFailuresMessage: DEFAULT_MAX_FAILURES_MESSAGE,
  }
  if (raw.config !== undefined) {
    if (!isPlainObject(raw.config)) {
      throw new Error(`clooks: "config" must be an object`)
    }
    const cfg = raw.config
    if (cfg.timeout !== undefined) {
      global.timeout = validatePositiveNumber(cfg.timeout, "global config", "timeout") as Milliseconds
    }
    if (cfg.onError !== undefined) {
      global.onError = validateErrorMode(cfg.onError, "global config")
      if (global.onError === "trace") {
        throw new Error(
          'clooks: global config "onError" cannot be "trace" — trace is only allowed at hook or hook+event level'
        )
      }
    }
    if (cfg.maxFailures !== undefined) {
      if (typeof cfg.maxFailures !== "number" || cfg.maxFailures < 0 || !Number.isInteger(cfg.maxFailures)) {
        throw new Error(`clooks: global config "maxFailures" must be a non-negative integer`)
      }
      global.maxFailures = cfg.maxFailures
    }
    if (cfg.maxFailuresMessage !== undefined) {
      if (typeof cfg.maxFailuresMessage !== "string") {
        throw new Error(`clooks: global config "maxFailuresMessage" must be a string`)
      }
      global.maxFailuresMessage = cfg.maxFailuresMessage
    }
    rejectUnknownKeys(cfg, KNOWN_GLOBAL_CONFIG_KEYS, 'global config')
  }

  // 3. Use classifyConfigKeys() to separate hooks from events
  const classified = classifyConfigKeys(raw)

  const hooks: Record<HookName, HookEntry> = {} as Record<HookName, HookEntry>
  const events: Partial<Record<EventName, EventEntry>> = {}

  // Validate event entries
  for (const [key, value] of Object.entries(classified.events)) {
    if (!isPlainObject(value)) {
      throw new Error(
        `clooks: entry "${key}" must be an object`,
      )
    }

    const entry: EventEntry = {}

    if (value.order !== undefined) {
      if (
        !Array.isArray(value.order) ||
        !value.order.every((v: unknown) => typeof v === "string" && (v as string).length > 0)
      ) {
        throw new Error(
          `clooks: event "${key}" has invalid "order": must be an array of non-empty strings`,
        )
      }
      const seenNames = new Set<string>()
      for (const hookName of value.order as string[]) {
        if (seenNames.has(hookName)) {
          throw new Error(
            `clooks: event "${key}" order contains duplicate hook name "${hookName}"`,
          )
        }
        seenNames.add(hookName)
      }
      entry.order = value.order as HookName[]
    }
    if (value.onError !== undefined) {
      throw new Error(
        `clooks: event "${key}" has "onError" — event-level onError has been removed. ` +
        `Use per-hook event overrides instead: hooks.<name>.events.${key}.onError`
      )
    }
    if (value.timeout !== undefined) {
      throw new Error(
        `clooks: event "${key}" has "timeout" — event-level timeout has been removed. ` +
        `Use per-hook timeout instead: hooks.<name>.timeout`
      )
    }
    rejectUnknownKeys(value, KNOWN_EVENT_ENTRY_KEYS, `event "${key}"`)

    events[key as EventName] = entry
  }

  // Validate hook entries
  for (const [key, value] of Object.entries(classified.hooks)) {
    if (!isPlainObject(value)) {
      throw new Error(
        `clooks: entry "${key}" must be an object`,
      )
    }

    let uses: string | undefined
    if (value.uses !== undefined) {
      if (typeof value.uses !== "string" || value.uses.length === 0) {
        throw new Error(
          `clooks: hook "${key}" has invalid "uses": must be a non-empty string`
        )
      }
      uses = value.uses

      // Detect likely bare-path mistakes: value ends in .ts but has no path-like prefix.
      // This catches "scripts/hook.ts" (should be "./scripts/hook.ts").
      if (uses.endsWith(".ts") && !isPathLike(uses)) {
        throw new Error(
          `clooks: hook "${key}" has uses: "${uses}" which looks like a file path but ` +
          `doesn't start with "./" or "../". If this is a file path, use "uses: ./${uses}". ` +
          `If it is a hook name, remove the ".ts" extension.`
        )
      }
    }

    let config: Record<string, unknown> = {}
    let timeout: Milliseconds | undefined
    let onError: ErrorMode | undefined
    let parallel = false
    let maxFailures: number | undefined
    let maxFailuresMessage: string | undefined

    if (value.config !== undefined) {
      if (!isPlainObject(value.config)) {
        throw new Error(
          `clooks: hook "${key}" has invalid "config": must be an object`,
        )
      }
      config = value.config as Record<string, unknown>
    }
    if (value.timeout !== undefined) {
      timeout = validatePositiveNumber(value.timeout, `hook "${key}"`, "timeout") as Milliseconds
    }
    if (value.onError !== undefined) {
      onError = validateErrorMode(value.onError, `hook "${key}"`)
    }
    if (value.parallel !== undefined) {
      if (typeof value.parallel !== "boolean") {
        throw new Error(
          `clooks: hook "${key}" has invalid "parallel": must be a boolean`,
        )
      }
      parallel = value.parallel
    }
    if (value.maxFailures !== undefined) {
      if (typeof value.maxFailures !== "number" || value.maxFailures < 0 || !Number.isInteger(value.maxFailures)) {
        throw new Error(
          `clooks: hook "${key}" has invalid "maxFailures": must be a non-negative integer`,
        )
      }
      maxFailures = value.maxFailures
    }
    if (value.maxFailuresMessage !== undefined) {
      if (typeof value.maxFailuresMessage !== "string") {
        throw new Error(
          `clooks: hook "${key}" has invalid "maxFailuresMessage": must be a string`,
        )
      }
      maxFailuresMessage = value.maxFailuresMessage
    }

    let eventsMap: Partial<Record<EventName, { onError?: ErrorMode }>> | undefined
    if (value.events !== undefined) {
      if (!isPlainObject(value.events)) {
        throw new Error(
          `clooks: hook "${key}" has invalid "events": must be an object`
        )
      }
      eventsMap = {}
      for (const eventKey of Object.keys(value.events)) {
        if (!isEventName(eventKey)) {
          throw new Error(
            `clooks: hook "${key}" has unknown event "${eventKey}" in events sub-map`
          )
        }
        const eventOverride = (value.events as Record<string, unknown>)[eventKey]
        if (!isPlainObject(eventOverride)) {
          throw new Error(
            `clooks: hook "${key}" events.${eventKey} must be an object`
          )
        }
        const overrideEntry: { onError?: ErrorMode } = {}
        if ((eventOverride as Record<string, unknown>).onError !== undefined) {
          overrideEntry.onError = validateErrorMode(
            (eventOverride as Record<string, unknown>).onError,
            `hook "${key}" events.${eventKey}`
          )
          if (overrideEntry.onError === "trace" && !INJECTABLE_EVENTS.has(eventKey)) {
            throw new Error(
              `clooks: hook "${key}" events.${eventKey} onError cannot be "trace" — ` +
              `${eventKey} does not support additionalContext`
            )
          }
        }
        rejectUnknownKeys(
          eventOverride as Record<string, unknown>,
          KNOWN_HOOK_EVENT_OVERRIDE_KEYS,
          `hook "${key}" events.${eventKey}`
        )
        eventsMap[eventKey] = overrideEntry
      }
    }

    rejectUnknownKeys(value, KNOWN_HOOK_ENTRY_KEYS, `hook "${key}"`)

    // Boundary cast: key is a hook name (not an event name or reserved key).
    const hookName = key as HookName
    const resolvedPath = resolveHookPath(hookName, { uses })

    const entry: HookEntry = { resolvedPath, config, parallel, origin: "project" as HookOrigin }
    if (uses !== undefined) entry.uses = uses
    if (timeout !== undefined) entry.timeout = timeout
    if (onError !== undefined) entry.onError = onError
    if (maxFailures !== undefined) entry.maxFailures = maxFailures
    if (maxFailuresMessage !== undefined) entry.maxFailuresMessage = maxFailuresMessage
    if (eventsMap && Object.keys(eventsMap).length > 0) entry.events = eventsMap

    hooks[hookName] = entry
  }

  // Second pass: cross-reference event order entries against hooks map.
  // Both maps must be fully built before this check runs.
  for (const [eventKey, eventEntry] of Object.entries(events)) {
    if (eventEntry?.order) {
      for (const hookName of eventEntry.order) {
        if (!(hookName in hooks)) {
          throw new Error(
            `clooks: event "${eventKey}" order references unknown hook "${hookName}"`,
          )
        }
      }
    }
  }

  // Third pass: detect alias chains.
  // A `uses` value that references another YAML key which itself has `uses` is a chain.
  // Only applies to hook-name references (not path-like values).
  for (const [hookKey, hookEntry] of Object.entries(hooks)) {
    if (hookEntry.uses === undefined) continue
    // Path-like uses values reference files, not other YAML keys — skip
    if (isPathLike(hookEntry.uses)) continue
    // Self-reference is allowed (pointless but not a chain)
    if (hookEntry.uses === hookKey) continue

    // Check if the uses target is a YAML key that also has uses (a chain)
    const targetName = hookEntry.uses as HookName
    const targetEntry = hooks[targetName]
    if (targetEntry?.uses !== undefined) {
      throw new Error(
        `clooks: hook "${hookKey}" uses "${hookEntry.uses}" which itself has a uses field ` +
        `("${targetEntry.uses}"). Alias chains are not allowed — uses must resolve to a ` +
        `concrete hook implementation, not another alias.`
      )
    }
  }

  return { version, global, hooks, events }
}
