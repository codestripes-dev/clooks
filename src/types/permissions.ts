// Permission update types for PermissionRequest events.
// Used both for the suggestions Claude Code attaches to a permission request
// (`ctx.permissionSuggestions`) and for the rule changes a hook can return on
// allow (`updatedPermissions`).

import type { PermissionMode } from './branded.js'

/** Where a permission rule is written. `session` = ephemeral; the others persist. */
export type PermissionDestination =
  | 'session'
  | 'localSettings'
  | 'projectSettings'
  | 'userSettings'
  | (string & {})

/** What the rule does when matched. */
export type PermissionRuleBehavior = 'allow' | 'deny' | 'ask' | (string & {})

/** A single permission rule. Omit `ruleContent` to match every invocation of `toolName`. */
export interface PermissionRule {
  toolName: string
  ruleContent?: string
}

/**
 * One permission change. Discriminated by `type` — narrow before reading
 * shape-specific fields (e.g. `rules` vs `directories` vs `mode`).
 */
export type PermissionUpdateEntry =
  | {
      type: 'addRules'
      rules: PermissionRule[]
      behavior: PermissionRuleBehavior
      destination: PermissionDestination
    }
  | {
      type: 'replaceRules'
      rules: PermissionRule[]
      behavior: PermissionRuleBehavior
      destination: PermissionDestination
    }
  | {
      type: 'removeRules'
      rules: PermissionRule[]
      behavior: PermissionRuleBehavior
      destination: PermissionDestination
    }
  | {
      type: 'setMode'
      mode: PermissionMode
      destination: PermissionDestination
    }
  | {
      type: 'addDirectories'
      directories: string[]
      destination: PermissionDestination
    }
  | {
      type: 'removeDirectories'
      directories: string[]
      destination: PermissionDestination
    }
