import { z } from "zod"
import {
  ClooksConfigSchema,
  HookEntrySchema,
  type ClooksConfig,
  type ErrorMode,
  type GlobalConfig,
  type HookEntry,
  type EventEntry,
  type HookOrigin,
} from "./schema.js"
import type { EventName, HookName, Milliseconds } from "../types/branded.js"
import { resolveHookPath, isPathLike } from "./resolve.js"
import {
  CLAUDE_CODE_EVENTS,
  DEFAULT_TIMEOUT,
  DEFAULT_ON_ERROR,
  DEFAULT_MAX_FAILURES,
  DEFAULT_MAX_FAILURES_MESSAGE,
} from "./constants.js"

export function validateConfig(raw: Record<string, unknown>): ClooksConfig {
  const result = ClooksConfigSchema.safeParse(raw, { reportInput: true })

  if (!result.success) {
    const msg = formatZodError(result.error.issues, raw)
    throw new Error(msg)
  }

  return transformToConfig(result.data)
}

function transformToConfig(validated: z.output<typeof ClooksConfigSchema>): ClooksConfig {
  const reservedKeys = new Set<string>(["version", "config", ...CLAUDE_CODE_EVENTS])

  // Global config with defaults
  const rawGlobal = validated.config
  const global: GlobalConfig = {
    timeout: (rawGlobal?.timeout ?? DEFAULT_TIMEOUT) as Milliseconds,
    onError: (rawGlobal?.onError ?? DEFAULT_ON_ERROR) as ErrorMode,
    maxFailures: rawGlobal?.maxFailures ?? DEFAULT_MAX_FAILURES,
    maxFailuresMessage: rawGlobal?.maxFailuresMessage ?? DEFAULT_MAX_FAILURES_MESSAGE,
  }

  // Separate hooks and events
  const hooks: Record<HookName, HookEntry> = {} as Record<HookName, HookEntry>
  const events: Partial<Record<EventName, EventEntry>> = {}

  for (const [key, value] of Object.entries(validated)) {
    if (reservedKeys.has(key)) continue

    // This is a hook entry
    const hookName = key as HookName
    const raw = value as z.infer<typeof HookEntrySchema>
    const resolvedPath = resolveHookPath(hookName, { uses: raw.uses })

    const entry: HookEntry = {
      resolvedPath,
      config: (raw.config ?? {}) as Record<string, unknown>,
      parallel: raw.parallel ?? false,
      origin: "project" as HookOrigin,
    }

    if (raw.uses !== undefined) entry.uses = raw.uses
    if (raw.timeout !== undefined) entry.timeout = raw.timeout as Milliseconds
    if (raw.onError !== undefined) entry.onError = raw.onError as ErrorMode
    if (raw.maxFailures !== undefined) entry.maxFailures = raw.maxFailures
    if (raw.maxFailuresMessage !== undefined) entry.maxFailuresMessage = raw.maxFailuresMessage
    if (raw.enabled !== undefined) entry.enabled = raw.enabled
    if (raw.events) {
      const eventsMap: Partial<Record<EventName, { onError?: ErrorMode; enabled?: boolean }>> = {}
      for (const [ek, ev] of Object.entries(raw.events)) {
        if (ev) eventsMap[ek as EventName] = ev as { onError?: ErrorMode; enabled?: boolean }
      }
      if (Object.keys(eventsMap).length > 0) entry.events = eventsMap
    }

    hooks[hookName] = entry
  }

  // Event entries
  for (const eventName of CLAUDE_CODE_EVENTS) {
    const eventVal = validated[eventName]
    if (eventVal) {
      const entry: EventEntry = {}
      if (eventVal.order) {
        entry.order = eventVal.order as HookName[]
      }
      events[eventName] = entry
    }
  }

  return { version: validated.version, global, hooks, events }
}

// ── Error message translation ──

function formatZodError(issues: z.ZodIssue[], raw: Record<string, unknown>): string {
  const issue = issues[0]!
  const path = issue.path

  if (path.length === 0) {
    return `clooks: ${issue.message}`
  }

  const topKey = String(path[0])
  const eventNames = new Set<string>([...CLAUDE_CODE_EVENTS])

  // Version field errors
  if (topKey === "version") {
    return formatVersionError(issue)
  }

  // Global config errors
  if (topKey === "config") {
    return formatGlobalConfigError(issue, raw)
  }

  // Event entry errors
  if (eventNames.has(topKey)) {
    return formatEventError(issue, topKey)
  }

  // Hook entry errors
  return formatHookError(issue, topKey, raw)
}

function formatVersionError(issue: z.ZodIssue): string {
  if (issue.code === "invalid_type" && issue.message.includes("undefined")) {
    return `clooks: clooks.yml missing required "version" field`
  }
  if (issue.code === "invalid_type") {
    const match = issue.message.match(/received (\w+)/)
    return `clooks: "version" must be a string, got ${match?.[1] ?? "unknown"}`
  }
  return `clooks: "version" error: ${issue.message}`
}

function formatGlobalConfigError(issue: z.ZodIssue, raw: Record<string, unknown>): string {
  const field = issue.path[1] as string | undefined

  if (issue.code === "unrecognized_keys") {
    const keys = (issue as any).keys as string[]
    return `clooks: global config has unknown key "${keys[0]}". Known keys: maxFailures, maxFailuresMessage, onError, timeout`
  }

  // Non-object config
  if (issue.code === "invalid_type" && field === undefined) {
    return `clooks: "config" must be an object`
  }

  if (field === "timeout") {
    return `clooks: global config "timeout" must be a positive number`
  }
  if (field === "onError") {
    const rawVal = (raw?.config as Record<string, unknown> | undefined)?.onError
    if (rawVal === "trace") {
      return `clooks: global config "onError" cannot be "trace" — trace is only allowed at hook or hook+event level`
    }
    return `clooks: global config "onError" must be "block" or "continue", got "${String(rawVal)}"`
  }
  if (field === "maxFailures") {
    return `clooks: global config "maxFailures" must be a non-negative integer`
  }
  if (field === "maxFailuresMessage") {
    return `clooks: global config "maxFailuresMessage" must be a string`
  }

  return `clooks: global config error: ${issue.message}`
}

function formatEventError(issue: z.ZodIssue, eventName: string): string {
  // Non-object event entry
  if (issue.code === "invalid_type" && issue.path.length === 1) {
    return `clooks: entry "${eventName}" must be an object`
  }

  if (issue.code === "custom") {
    return `clooks: ${issue.message}`
  }

  const field = issue.path[1]
  if (field === "order") {
    return `clooks: event "${eventName}" has invalid "order": must be an array of non-empty strings`
  }

  return `clooks: entry "${eventName}" error: ${issue.message}`
}

function formatHookError(issue: z.ZodIssue, hookName: string, raw: Record<string, unknown>): string {
  // Non-object hook entry
  if (issue.code === "invalid_type" && issue.path.length === 1) {
    return `clooks: entry "${hookName}" must be an object`
  }

  if (issue.code === "unrecognized_keys") {
    const keys = (issue as any).keys as string[]
    const depth = issue.path.length

    // Root of hook entry
    if (depth <= 1) {
      return `clooks: hook "${hookName}" has unknown key "${keys[0]}". Known keys: config, enabled, events, maxFailures, maxFailuresMessage, onError, parallel, timeout, uses`
    }

    // Inside hook.events.EventName
    if (issue.path[1] === "events" && issue.path.length >= 3) {
      const eventKey = String(issue.path[2])
      return `clooks: hook "${hookName}" events.${eventKey} has unknown key "${keys[0]}". Known keys: enabled, onError`
    }
  }

  if (issue.code === "custom") {
    return `clooks: ${issue.message}`
  }

  const field = issue.path[1] as string | undefined

  if (field === "uses") {
    return `clooks: hook "${hookName}" has invalid "uses": must be a non-empty string`
  }
  if (field === "timeout") {
    return `clooks: hook "${hookName}" "timeout" must be a positive number`
  }
  if (field === "onError") {
    const rawVal = (raw[hookName] as Record<string, unknown> | undefined)?.onError
    return `clooks: hook "${hookName}" "onError" must be "block", "continue", or "trace", got "${String(rawVal)}"`
  }
  if (field === "parallel") {
    return `clooks: hook "${hookName}" has invalid "parallel": must be a boolean`
  }
  if (field === "maxFailures") {
    return `clooks: hook "${hookName}" has invalid "maxFailures": must be a non-negative integer`
  }
  if (field === "maxFailuresMessage") {
    return `clooks: hook "${hookName}" has invalid "maxFailuresMessage": must be a string`
  }
  if (field === "enabled") {
    return `clooks: hook "${hookName}" has invalid "enabled": must be a boolean`
  }
  if (field === "config") {
    return `clooks: hook "${hookName}" has invalid "config": must be an object`
  }
  if (field === "events") {
    // Unknown event name in the events sub-map (path depth 2: [hookName, "events"])
    if (issue.code === "unrecognized_keys") {
      const keys = (issue as any).keys as string[]
      return `clooks: hook "${hookName}" has unknown event "${keys[0]}" in events sub-map`
    }
    // Sub-map field errors
    if (issue.path.length >= 3) {
      const eventKey = String(issue.path[2])
      const subField = issue.path[3]
      if (subField === "onError") {
        return `clooks: hook "${hookName}" events.${eventKey} "onError" must be "block", "continue", or "trace"`
      }
      if (subField === "enabled") {
        return `clooks: hook "${hookName}" events.${eventKey} "enabled" must be a boolean`
      }
      return `clooks: hook "${hookName}" events.${eventKey} error: ${issue.message}`
    }
    return `clooks: hook "${hookName}" has invalid "events": must be an object`
  }

  return `clooks: hook "${hookName}" error: ${issue.message}`
}
