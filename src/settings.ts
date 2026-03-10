import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { join } from "path"
import { CLAUDE_CODE_EVENTS } from "./config/constants.js"
import type { EventName } from "./types/branded.js"

/** Canonical relative path to the Clooks bash entrypoint. */
export const CLOOKS_ENTRYPOINT_PATH = ".clooks/bin/entrypoint.sh"

export interface RegisterResult {
  added: EventName[]
  skipped: EventName[]
  updated: EventName[]
  created: boolean
}

export interface UnregisterResult {
  removed: EventName[]
}

/**
 * Checks if a hook entry's command field ends with `.clooks/bin/entrypoint.sh`.
 * This handles both relative project paths (`.clooks/bin/entrypoint.sh`) and
 * absolute global paths (`/home/joe/.clooks/bin/entrypoint.sh`).
 */
export function isClooksHook(hook: unknown): boolean {
  if (
    typeof hook !== "object" ||
    hook === null ||
    typeof (hook as Record<string, unknown>).command !== "string"
  ) {
    return false
  }
  const cmd = (hook as Record<string, string>).command!
  return cmd.endsWith(".clooks/bin/entrypoint.sh")
}

/** Checks if a matcher group contains any Clooks hook. */
function isClooksMatcherGroup(mg: unknown): boolean {
  if (typeof mg !== "object" || mg === null) return false
  const hooks = (mg as Record<string, unknown>).hooks
  if (!Array.isArray(hooks)) return false
  return hooks.some(isClooksHook)
}

function readSettings(settingsPath: string): { settings: Record<string, unknown>; fileExisted: boolean } {
  if (!existsSync(settingsPath)) {
    return { settings: {}, fileExisted: false }
  }
  const text = readFileSync(settingsPath, "utf-8")
  if (text.trim() === "") {
    return { settings: {}, fileExisted: true }
  }
  try {
    return { settings: JSON.parse(text), fileExisted: true }
  } catch {
    throw new Error(
      `\`${settingsPath}\` contains invalid JSON. Fix or delete the file, then re-run \`clooks init\`.`,
    )
  }
}

function makeClooksMatcherGroup(entrypointCommand: string): Record<string, unknown> {
  return {
    hooks: [{ type: "command", command: entrypointCommand }],
  }
}

/**
 * Register Clooks in settings.json for all 18 Claude Code events.
 * Creates the settings directory and file if missing.
 *
 * @param settingsDir - Directory containing settings.json (e.g., `join(projectRoot, ".claude")` or `join(homeRoot, ".claude")`)
 * @param entrypointCommand - The command to register (e.g., `.clooks/bin/entrypoint.sh` for project, `/home/joe/.clooks/bin/entrypoint.sh` for global)
 */
export function registerClooks(settingsDir: string, entrypointCommand: string): RegisterResult {
  const settingsPath = join(settingsDir, "settings.json")

  const { settings, fileExisted } = readSettings(settingsPath)

  const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>
  settings.hooks = hooks

  const added: EventName[] = []
  const skipped: EventName[] = []
  const updated: EventName[] = []

  for (const event of CLAUDE_CODE_EVENTS) {
    if (!Array.isArray(hooks[event])) {
      hooks[event] = []
    }

    const arr = hooks[event] as unknown[]
    const existingIdx = arr.findIndex(isClooksMatcherGroup)

    if (existingIdx === -1) {
      // No Clooks matcher group — append one
      arr.push(makeClooksMatcherGroup(entrypointCommand))
      added.push(event)
    } else {
      // Clooks matcher group exists — check if command needs migration
      const mg = arr[existingIdx] as Record<string, unknown>
      const mgHooks = mg.hooks as Record<string, unknown>[]
      const clooksHook = mgHooks.find(isClooksHook) as Record<string, string> | undefined

      if (clooksHook && clooksHook.command !== entrypointCommand) {
        clooksHook.command = entrypointCommand
        updated.push(event)
      } else {
        skipped.push(event)
      }
    }
  }

  // Only write if something changed
  if (added.length > 0 || updated.length > 0) {
    mkdirSync(settingsDir, { recursive: true })
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n")
  }

  return {
    added,
    skipped,
    updated,
    created: !fileExisted,
  }
}

/**
 * Unregister Clooks from settings.json by removing all Clooks
 * matcher groups. Preserves non-Clooks hooks and other settings.
 *
 * @param settingsDir - Directory containing settings.json
 */
export function unregisterClooks(settingsDir: string): UnregisterResult {
  const settingsPath = join(settingsDir, "settings.json")

  if (!existsSync(settingsPath)) {
    return { removed: [] }
  }

  const { settings } = readSettings(settingsPath)
  const hooks = settings.hooks as Record<string, unknown[]> | undefined
  if (!hooks) {
    return { removed: [] }
  }

  const removed: EventName[] = []

  for (const event of CLAUDE_CODE_EVENTS) {
    const matchers = hooks[event]
    if (!Array.isArray(matchers)) continue

    const filtered = matchers.filter((mg) => !isClooksMatcherGroup(mg))
    if (filtered.length < matchers.length) {
      removed.push(event)
    }
    if (filtered.length === 0) {
      delete hooks[event]
    } else {
      hooks[event] = filtered
    }
  }

  // Only write if something changed
  if (removed.length > 0) {
    // Remove empty hooks object
    if (Object.keys(hooks).length === 0) {
      delete settings.hooks
    }
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n")
  }

  return { removed }
}

/**
 * Returns true if at least one event has a Clooks matcher group.
 *
 * @param settingsDir - Directory containing settings.json
 */
export function isClooksRegistered(settingsDir: string): boolean {
  const settingsPath = join(settingsDir, "settings.json")

  if (!existsSync(settingsPath)) return false

  const { settings } = readSettings(settingsPath)
  const hooks = settings.hooks as Record<string, unknown[]> | undefined
  if (!hooks) return false

  for (const matchers of Object.values(hooks)) {
    if (!Array.isArray(matchers)) continue
    if (matchers.some(isClooksMatcherGroup)) return true
  }

  return false
}
