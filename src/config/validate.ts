import type {
  ClooksConfig,
  ErrorMode,
  GlobalConfig,
  HookEntry,
  EventEntry,
} from "./types.js"
import {
  CLAUDE_CODE_EVENTS,
  DEFAULT_TIMEOUT,
  DEFAULT_ON_ERROR,
} from "./constants.js"
import { resolveHookPath } from "./resolve.js"

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === "object" && !Array.isArray(val)
}

function validateErrorMode(value: unknown, label: string): ErrorMode {
  if (value !== "block" && value !== "continue") {
    throw new Error(
      `clooks: ${label} "onError" must be "block" or "continue", got "${String(value)}"`,
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
      if (value.timeout !== undefined) {
        entry.timeout = validatePositiveNumber(value.timeout, `event "${key}"`)
      }
      if (value.onError !== undefined) {
        entry.onError = validateErrorMode(value.onError, `event "${key}"`)
      }

      events[key] = entry
    } else {
      // Validate as hook entry
      let config: Record<string, unknown> = {}
      let path: string | undefined
      let timeout: number | undefined
      let onError: ErrorMode | undefined
      let parallel = false

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

      const resolvedPath = resolveHookPath(key, { path })

      const entry: HookEntry = { resolvedPath, config, parallel }
      if (timeout !== undefined) entry.timeout = timeout
      if (onError !== undefined) entry.onError = onError

      hooks[key] = entry
    }
  }

  return { version, global, hooks, events }
}
