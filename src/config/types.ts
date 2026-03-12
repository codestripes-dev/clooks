import type { EventName, HookName, Milliseconds } from "../types/branded.js"

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
