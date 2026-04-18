// Typed discriminated union for PermissionRequest's `permission_suggestions`
// (input wire), `permissionSuggestions` (normalized context), and
// `updatedPermissions` (allow-result output). Shape mirrors upstream wire
// format per docs/domain/raw-claude-ai/hook-docs/PermissionRequest.md.

import type { PermissionMode } from './branded.js'

export type PermissionDestination =
  | 'session'
  | 'localSettings'
  | 'projectSettings'
  | 'userSettings'
  | (string & {})

export type PermissionRuleBehavior = 'allow' | 'deny' | 'ask' | (string & {})

/** A single permission rule entry. `ruleContent` omitted = match the whole tool. */
export interface PermissionRule {
  toolName: string
  ruleContent?: string
}

/** Discriminated by the `type` field. Used for both PermissionRequest's
 *  `permission_suggestions` input and the `updatedPermissions` allow output. */
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
