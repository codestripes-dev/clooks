import type {
  ClooksConfig,
  ErrorMode,
  GlobalConfig,
  HookEntry,
  EventEntry,
} from "./types.js"
import {
  CLAUDE_CODE_EVENTS,
  INJECTABLE_EVENTS,
  DEFAULT_TIMEOUT,
  DEFAULT_ON_ERROR,
  DEFAULT_MAX_FAILURES,
  DEFAULT_MAX_FAILURES_MESSAGE,
} from "./constants.js"
import { resolveHookPath } from "./resolve.js"

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

function validatePositiveNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || value <= 0) {
    throw new Error(`clooks: ${label} "timeout" must be a positive number`)
  }
  return value
}

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
      global.timeout = validatePositiveNumber(cfg.timeout, "global config")
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
  }

  // 3. Discriminate remaining keys
  const hooks: Record<string, HookEntry> = {}
  const events: Record<string, EventEntry> = {}

  for (const key of Object.keys(raw)) {
    if (key === "version" || key === "config") continue

    const value = raw[key]
    if (!isPlainObject(value)) {
      throw new Error(
        `clooks: entry "${key}" must be an object`,
      )
    }

    if (CLAUDE_CODE_EVENTS.has(key)) {
      // Validate as event entry
      const entry: EventEntry = {}

      if (value.order !== undefined) {
        if (
          !Array.isArray(value.order) ||
          !value.order.every((v: unknown) => typeof v === "string")
        ) {
          throw new Error(
            `clooks: event "${key}" has invalid "order": must be an array of strings`,
          )
        }
        entry.order = value.order as string[]
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

      events[key] = entry
    } else {
      // Validate as hook entry
      let config: Record<string, unknown> = {}
      let path: string | undefined
      let timeout: number | undefined
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
      if (value.path !== undefined) {
        if (typeof value.path !== "string") {
          throw new Error(
            `clooks: hook "${key}" has invalid "path": must be a string`,
          )
        }
        path = value.path
      }
      if (value.timeout !== undefined) {
        timeout = validatePositiveNumber(value.timeout, `hook "${key}"`)
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

      let eventsMap: Record<string, { onError?: ErrorMode }> | undefined
      if (value.events !== undefined) {
        if (!isPlainObject(value.events)) {
          throw new Error(
            `clooks: hook "${key}" has invalid "events": must be an object`
          )
        }
        eventsMap = {}
        for (const eventKey of Object.keys(value.events)) {
          if (!CLAUDE_CODE_EVENTS.has(eventKey)) {
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
          eventsMap[eventKey] = overrideEntry
        }
      }

      const resolvedPath = resolveHookPath(key, { path })

      const entry: HookEntry = { resolvedPath, config, parallel }
      if (timeout !== undefined) entry.timeout = timeout
      if (onError !== undefined) entry.onError = onError
      if (maxFailures !== undefined) entry.maxFailures = maxFailures
      if (maxFailuresMessage !== undefined) entry.maxFailuresMessage = maxFailuresMessage
      if (eventsMap && Object.keys(eventsMap).length > 0) entry.events = eventsMap

      hooks[key] = entry
    }
  }

  return { version, global, hooks, events }
}
