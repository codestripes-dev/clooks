import { mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { CLAUDE_CODE_EVENTS } from './config/constants.js'
import type { EventName } from './types/branded.js'
import { readRegistrationFile, writeRegistrationFileAtomic } from './registration-file.js'
import type { RegistrationGroup } from './registration-file.js'
import {
  isApprovalCompanion,
  registerApprovalPair,
  unpairedCommand,
  type ApprovalRegistration,
} from './registration-approvals.js'

/** Canonical path to the Clooks bash entrypoint. Uses $CLAUDE_PROJECT_DIR so it resolves correctly regardless of cwd. */
export const CLOOKS_ENTRYPOINT_PATH = '"$CLAUDE_PROJECT_DIR"/.clooks/bin/entrypoint.sh'

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
 * Recognizes generated commands and the original single-word legacy paths.
 * This handles project paths (`"$CLAUDE_PROJECT_DIR"/.clooks/bin/entrypoint.sh`),
 * legacy relative paths (`.clooks/bin/entrypoint.sh`), and
 * absolute global paths (`/home/joe/.clooks/bin/entrypoint.sh`).
 */
export function isClooksHook(hook: unknown, expectedCommand?: string): boolean {
  if (isApprovalCompanion(hook, 'claude-code')) return true
  if (
    typeof hook !== 'object' ||
    hook === null ||
    Array.isArray(hook) ||
    (hook as Record<string, unknown>).type !== 'command' ||
    typeof (hook as Record<string, unknown>).command !== 'string'
  ) {
    return false
  }
  const cmd = unpairedCommand((hook as Record<string, string>).command!, 'claude-code')
  const quoted = /^'((?:[^']|'\\'')*)'$/.exec(cmd)
  const decoded = quoted?.[1]?.replaceAll("'\\''", "'")
  if (decoded?.startsWith('/') && decoded.endsWith('/.clooks/bin/entrypoint.sh')) return true
  return (
    cmd === expectedCommand ||
    cmd === CLOOKS_ENTRYPOINT_PATH ||
    cmd === '.clooks/bin/entrypoint.sh' ||
    (cmd.startsWith('/') &&
      cmd.endsWith('/.clooks/bin/entrypoint.sh') &&
      !/[\s'"\\`$;&|<>()*?[\]{}!#~]/u.test(cmd))
  )
}

/** Checks if a matcher group contains any Clooks hook. */
function isClooksMatcherGroup(mg: unknown, expectedCommand?: string): boolean {
  if (typeof mg !== 'object' || mg === null) return false
  const hooks = (mg as Record<string, unknown>).hooks
  if (!Array.isArray(hooks)) return false
  return hooks.some((hook) => isClooksHook(hook, expectedCommand))
}

function readSettings(settingsPath: string): {
  settings: Record<string, unknown>
  fileExisted: boolean
} {
  return readRegistrationFile(settingsPath, [...CLAUDE_CODE_EVENTS])
}

function makeClooksMatcherGroup(entrypointCommand: string): Record<string, unknown> {
  return {
    hooks: [{ type: 'command', command: entrypointCommand }],
  }
}

/**
 * Register Clooks in settings.json for supported Claude Code events.
 * Creates the settings directory and file if missing.
 *
 * @param settingsDir - Directory containing settings.json (e.g., `join(projectRoot, ".claude")` or `join(homeRoot, ".claude")`)
 * @param entrypointCommand - The command to register (e.g., `"$CLAUDE_PROJECT_DIR"/.clooks/bin/entrypoint.sh` for project, `/home/joe/.clooks/bin/entrypoint.sh` for global)
 */
export function registerClooks(
  settingsDir: string,
  entrypointCommand: string,
  approval?: ApprovalRegistration,
): RegisterResult {
  const settingsPath = join(settingsDir, 'settings.json')

  const { settings, fileExisted } = readSettings(settingsPath)

  const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>
  settings.hooks = hooks

  const added: EventName[] = []
  const skipped: EventName[] = []
  const updated: EventName[] = []

  for (const event of CLAUDE_CODE_EVENTS) {
    if (event === 'PreToolUse' && approval) {
      const pair = registerApprovalPair(
        (hooks[event] ?? []) as RegistrationGroup[],
        'claude-code',
        entrypointCommand,
        approval,
        (hook) => isClooksHook(hook, entrypointCommand),
      )
      hooks[event] = pair.groups
      ;(pair.changed ? (pair.existed ? updated : added) : skipped).push(event)
      continue
    }
    if (!Array.isArray(hooks[event])) {
      hooks[event] = []
    }

    const arr = hooks[event] as unknown[]
    const existingIdx = arr.findIndex((group) => isClooksMatcherGroup(group, entrypointCommand))

    if (existingIdx === -1) {
      // No Clooks matcher group — append one
      arr.push(makeClooksMatcherGroup(entrypointCommand))
      added.push(event)
    } else {
      // Clooks matcher group exists — check if command needs migration
      const mg = arr[existingIdx] as Record<string, unknown>
      const mgHooks = mg.hooks as Record<string, unknown>[]
      const clooksHook = mgHooks.find((hook) => isClooksHook(hook, entrypointCommand)) as
        | Record<string, string>
        | undefined

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
    writeRegistrationFileAtomic(settingsPath, JSON.stringify(settings, null, 2) + '\n')
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
 * hooks. Preserves non-Clooks hooks, mixed-group metadata and other settings.
 *
 * @param settingsDir - Directory containing settings.json
 */
export function unregisterClooks(settingsDir: string): UnregisterResult {
  const settingsPath = join(settingsDir, 'settings.json')

  const { settings } = readSettings(settingsPath)
  const hooks = settings.hooks as Record<string, unknown[]> | undefined
  if (!hooks) {
    return { removed: [] }
  }

  const removed: EventName[] = []

  for (const event of CLAUDE_CODE_EVENTS) {
    const matchers = hooks[event]
    if (!Array.isArray(matchers)) continue

    let changed = false
    const filtered = matchers.flatMap((value) => {
      const group = value as Record<string, unknown>
      const entries = group.hooks as unknown[]
      const remaining = entries.filter(
        (hook) => !isClooksHook(hook, join(dirname(settingsDir), '.clooks/bin/entrypoint.sh')),
      )
      if (remaining.length === entries.length) return [group]
      changed = true
      return remaining.length ? [{ ...group, hooks: remaining }] : []
    })
    if (!changed) continue
    removed.push(event)
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
    writeRegistrationFileAtomic(settingsPath, JSON.stringify(settings, null, 2) + '\n')
  }

  return { removed }
}

/**
 * Returns true if at least one event has a Clooks matcher group.
 *
 * @param settingsDir - Directory containing settings.json
 */
export function isClooksRegistered(settingsDir: string): boolean {
  const settingsPath = join(settingsDir, 'settings.json')

  const { settings } = readRegistrationFile(settingsPath)
  const hooks = settings.hooks as Record<string, unknown[]> | undefined
  if (!hooks) return false

  for (const matchers of Object.values(hooks)) {
    if (!Array.isArray(matchers)) continue
    if (
      matchers.some((group) =>
        isClooksMatcherGroup(group, join(dirname(settingsDir), '.clooks/bin/entrypoint.sh')),
      )
    )
      return true
  }

  return false
}
