/**
 * Zod v4 schema definitions — single source of truth for clooks.yml config.
 *
 * TypeScript types are derived from these schemas. Runtime validation runs
 * through safeParse(). JSON Schema for editor autocomplete is auto-generated.
 * The three representations can never drift apart.
 */
import { z } from "zod"
import {
  CLAUDE_CODE_EVENTS,
  INJECTABLE_EVENTS,
} from "./constants.js"
import { isPathLike } from "./resolve.js"
import type { EventName, HookName, Milliseconds } from "../types/branded.js"

// ── Primitive schemas ──

const ErrorModeSchema = z.enum(["block", "continue", "trace"])
const ErrorModeGlobalSchema = z.enum(["block", "continue"])

// ── GlobalConfig schema ──

export const GlobalConfigSchema = z.object({
  timeout: z.number().positive({
    error: 'clooks: global config "timeout" must be a positive number',
  }).optional(),
  onError: ErrorModeGlobalSchema.optional(),
  maxFailures: z.number().int().nonnegative({
    error: 'clooks: global config "maxFailures" must be a non-negative integer',
  }).optional(),
  maxFailuresMessage: z.string().optional(),
}).strict()

// ── HookEventOverride schema ──

const HookEventOverrideSchema = z.object({
  onError: ErrorModeSchema.optional(),
  enabled: z.boolean().optional(),
}).strict()

// Build events sub-map with all 18 event names as known properties
const hookEventsMapProps = Object.fromEntries(
  [...CLAUDE_CODE_EVENTS].map((e) => [e, HookEventOverrideSchema.optional()]),
) as Record<EventName, z.ZodOptional<typeof HookEventOverrideSchema>>

const HookEventsMapSchema = z.object(hookEventsMapProps).strict()

// ── HookEntry schema ──

export const HookEntrySchema = z.object({
  config: z.record(z.string(), z.unknown()).optional(),
  uses: z.string().min(1).optional(),
  timeout: z.number().positive().optional(),
  onError: ErrorModeSchema.optional(),
  parallel: z.boolean().optional(),
  maxFailures: z.number().int().nonnegative().optional(),
  maxFailuresMessage: z.string().optional(),
  enabled: z.boolean().optional(),
  events: HookEventsMapSchema.optional(),
}).strict()

// ── EventEntry schema ──
// Uses passthrough() instead of strict() so superRefine() can produce
// specific deprecation messages for onError/timeout before generic
// "unknown key" errors.

export const EventEntrySchema = z.object({
  order: z.array(z.string().min(1)).optional(),
}).passthrough()

// ── Top-level config schema ──

// Known event properties (for JSON Schema autocomplete)
const eventProperties = Object.fromEntries(
  [...CLAUDE_CODE_EVENTS].map((e) => [e, EventEntrySchema.optional()]),
) as Record<EventName, z.ZodOptional<typeof EventEntrySchema>>

/**
 * Structural schema — validates types, shapes, ranges, enums, and
 * rejects unknown keys. Does NOT do cross-field checks.
 * This is what gets exported to JSON Schema.
 */
export const ClooksConfigStructuralSchema = z.object({
  version: z.string(),
  config: GlobalConfigSchema.optional(),
  ...eventProperties,
}).catchall(HookEntrySchema)

/**
 * Full schema with cross-field refinements.
 * Use this for runtime validation.
 */
export const ClooksConfigSchema = ClooksConfigStructuralSchema.superRefine((val, ctx) => {
  const reservedKeys = new Set<string>(["version", "config", ...CLAUDE_CODE_EVENTS])

  // Collect hook names (everything that's not a reserved key)
  const hookNames = new Set<string>()
  for (const key of Object.keys(val)) {
    if (!reservedKeys.has(key)) {
      hookNames.add(key)
    }
  }

  // ── 1. Event entry validation ──
  const KNOWN_EVENT_KEYS = new Set(["order"])

  for (const eventName of CLAUDE_CODE_EVENTS) {
    const eventEntry = val[eventName]
    if (!eventEntry) continue

    // Reject deprecated event-level onError/timeout (checked FIRST for specific messages)
    if ("onError" in (eventEntry as object)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `event "${eventName}" has "onError" — event-level onError has been removed. ` +
          `Use per-hook event overrides instead: hooks.<name>.events.${eventName}.onError`,
        path: [eventName, "onError"],
      })
      return // stop on first error (matches current behavior)
    }
    if ("timeout" in (eventEntry as object)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `event "${eventName}" has "timeout" — event-level timeout has been removed. ` +
          `Use per-hook timeout instead: hooks.<name>.timeout`,
        path: [eventName, "timeout"],
      })
      return
    }

    // Reject unknown keys (since EventEntry uses passthrough)
    for (const key of Object.keys(eventEntry as object)) {
      if (!KNOWN_EVENT_KEYS.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `event "${eventName}" has unknown key "${key}". Known keys: ${[...KNOWN_EVENT_KEYS].sort().join(", ")}`,
          path: [eventName],
        })
        return
      }
    }

    if (eventEntry.order) {
      const seen = new Set<string>()
      for (const hookRef of eventEntry.order) {
        // Duplicate check
        if (seen.has(hookRef)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `event "${eventName}" order contains duplicate hook name "${hookRef}"`,
            path: [eventName, "order"],
          })
          return
        }
        seen.add(hookRef)

        // Unknown hook check
        if (!hookNames.has(hookRef)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `event "${eventName}" order references unknown hook "${hookRef}"`,
            path: [eventName, "order"],
          })
          return
        }
      }
    }
  }

  // ── 2. Trace only on injectable events ──
  for (const hookName of hookNames) {
    const hook = val[hookName] as z.infer<typeof HookEntrySchema>
    if (hook?.events) {
      for (const [eventKey, override] of Object.entries(hook.events)) {
        if (
          override?.onError === "trace" &&
          !INJECTABLE_EVENTS.has(eventKey as EventName)
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `hook "${hookName}" events.${eventKey} onError cannot be "trace" — ` +
              `${eventKey} does not support additionalContext`,
            path: [hookName, "events", eventKey, "onError"],
          })
        }
      }
    }
  }

  // ── 3. Bare-path detection ──
  for (const hookName of hookNames) {
    const hook = val[hookName] as z.infer<typeof HookEntrySchema>
    if (hook?.uses && hook.uses.endsWith(".ts") && !isPathLike(hook.uses)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `hook "${hookName}" has uses: "${hook.uses}" which looks like a file path but ` +
          `doesn't start with "./" or "../". If this is a file path, use "uses: ./${hook.uses}". ` +
          `If it is a hook name, remove the ".ts" extension.`,
        path: [hookName, "uses"],
      })
    }
  }

  // ── 4. Alias chain detection ──
  for (const hookName of hookNames) {
    const hook = val[hookName] as z.infer<typeof HookEntrySchema>
    if (hook?.uses === undefined) continue
    if (isPathLike(hook.uses)) continue
    if (hook.uses === hookName) continue // self-reference is allowed

    const target = hook.uses
    if (hookNames.has(target)) {
      const targetHook = val[target] as z.infer<typeof HookEntrySchema>
      if (targetHook?.uses !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `hook "${hookName}" uses "${hook.uses}" which itself has a uses field ` +
            `("${targetHook.uses}"). Alias chains are not allowed — uses must resolve to a ` +
            `concrete hook implementation, not another alias.`,
          path: [hookName, "uses"],
        })
      }
    }
  }
})

// ── Derived TypeScript types ──
// These are hand-written interfaces (not z.infer<>) because the final
// ClooksConfig has additional fields (resolvedPath, origin, branded types)
// that Zod cannot express. They are the authoritative type definitions.

export type ErrorMode = "block" | "continue" | "trace"

export type HookOrigin = "home" | "project"

/**
 * The validated, typed config returned by loadConfig().
 *
 * This is NOT the raw YAML shape. The raw YAML has a flat top-level where
 * hook entries and event entries are mixed with reserved keys (version, config).
 * After validation, they are separated into distinct typed maps.
 */
export interface ClooksConfig {
  /** Semver version string from the config file. */
  version: string

  /** Global settings from the top-level `config:` key. */
  global: GlobalConfig

  /**
   * Hook entries keyed by hook name. Each entry contains config overrides,
   * a resolved file path, and per-hook options (timeout, onError, parallel).
   */
  hooks: Record<HookName, HookEntry>

  /**
   * Per-event configuration keyed by event name (e.g., "PreToolUse").
   * Controls execution order for hooks registered to that event.
   */
  events: Partial<Record<EventName, EventEntry>>
}

export interface GlobalConfig {
  timeout: Milliseconds
  onError: ErrorMode
  maxFailures: number
  maxFailuresMessage: string
}

export interface HookEntry {
  /** Resolved file path. */
  resolvedPath: string
  /** Raw `uses` value from clooks.yml, if this entry is an alias or has a custom path. */
  uses?: string
  /** Config overrides from clooks.yml (shallow-merged with hook's meta.config at load time). */
  config: Record<string, unknown>
  /** Per-hook timeout in ms, if set. */
  timeout?: Milliseconds
  /** Per-hook error handling override, if set. */
  onError?: ErrorMode
  /** If true, runs independently of the sequential pipeline. Default false. */
  parallel: boolean
  /** Per-hook override for consecutive failure threshold. */
  maxFailures?: number
  /** Per-hook override for the reminder message template. */
  maxFailuresMessage?: string
  /** If false, this hook is fully disabled — it loads but never runs. Default true. */
  enabled?: boolean
  /** Per-hook, per-event overrides. Currently only onError and enabled are supported. */
  events?: Partial<Record<EventName, { onError?: ErrorMode; enabled?: boolean }>>
  /** Which config layer this hook originated from. */
  origin: HookOrigin
}

export interface EventEntry {
  /** Explicit execution order for hooks registered to this event. */
  order?: HookName[]
}

/** Raw inferred type from the structural schema */
export type ClooksConfigRaw = z.infer<typeof ClooksConfigStructuralSchema>

// ── JSON Schema export ──

export function generateJsonSchema() {
  return z.toJSONSchema(ClooksConfigStructuralSchema, {
    target: "draft-2020-12",
  })
}
