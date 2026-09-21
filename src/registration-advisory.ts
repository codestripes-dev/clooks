import { mkdirSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import type { AgentId } from './agents/types.js'
import {
  CODEX_PROJECT_ID_PATTERN,
  CODEX_PROJECT_RUNTIME_ADVISORY_LAUNCHER,
} from './agents/codex/project-launcher.js'
import {
  isRegistrationObject,
  readRegistrationFile,
  writeRegistrationFileAtomic,
} from './registration-file.js'

export const RUNTIME_ADVISORY_RELATIVE_PATH = '.clooks/bin/runtime-advisory.sh'

const GUARDED_GLOBAL_ADVISORY_LAUNCHER = `[ -f "$1" ] && [ -r "$1" ] || exit 0
exec bash "$1"`
const CLAUDE_PROJECT_ADVISORY_LAUNCHER = `advisory="$CLAUDE_PROJECT_DIR/.clooks/bin/runtime-advisory.sh"
[ -f "$advisory" ] && [ -r "$advisory" ] || exit 0
exec bash "$advisory"`

export interface RuntimeAdvisoryRegisterResult {
  added: boolean
  skipped: boolean
  updated: boolean
  created: boolean
}

export interface RuntimeAdvisoryUnregisterResult {
  removed: boolean
}

function quotePosixSingleArg(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export const CLAUDE_PROJECT_RUNTIME_ADVISORY_COMMAND = `CLOOKS_AGENT=claude-code sh -c ${quotePosixSingleArg(CLAUDE_PROJECT_ADVISORY_LAUNCHER)} clooks-advisory-project`

function advisoryPath(root: string): string {
  if (!isAbsolute(root) || /[\r\n\0]/u.test(root)) {
    throw new Error('Advisory root must be an absolute path without CR/LF or NUL.')
  }
  return join(resolve(root), RUNTIME_ADVISORY_RELATIVE_PATH)
}

export function makeClaudeGlobalRuntimeAdvisoryCommand(installationHome: string): string {
  return `CLOOKS_AGENT=claude-code sh -c ${quotePosixSingleArg(GUARDED_GLOBAL_ADVISORY_LAUNCHER)} clooks-advisory-global ${quotePosixSingleArg(advisoryPath(installationHome))}`
}

export function makeCodexProjectRuntimeAdvisoryCommand(projectId: string): string {
  if (!CODEX_PROJECT_ID_PATTERN.test(projectId)) throw new Error('Invalid Codex project ID')
  return `CLOOKS_AGENT=codex sh -c ${quotePosixSingleArg(CODEX_PROJECT_RUNTIME_ADVISORY_LAUNCHER)} clooks-advisory-project ${quotePosixSingleArg(projectId)}`
}

export function makeCodexGlobalRuntimeAdvisoryCommand(installationHome: string): string {
  return `CLOOKS_AGENT=codex sh -c ${quotePosixSingleArg(GUARDED_GLOBAL_ADVISORY_LAUNCHER)} clooks-advisory-global ${quotePosixSingleArg(advisoryPath(installationHome))}`
}

function commandOf(hook: unknown): string | undefined {
  if (!isRegistrationObject(hook) || hook.type !== 'command' || typeof hook.command !== 'string') {
    return undefined
  }
  return hook.command
}

function decodeSingleQuoted(value: string): string | undefined {
  const match = /^'((?:[^']|'\\'')*)'$/u.exec(value)
  return match?.[1]?.replaceAll("'\\''", "'")
}

function decodedGlobalAdvisoryRoot(command: string, agent: AgentId): string | undefined {
  const prefix = `CLOOKS_AGENT=${agent} sh -c ${quotePosixSingleArg(GUARDED_GLOBAL_ADVISORY_LAUNCHER)} clooks-advisory-global `
  if (!command.startsWith(prefix)) return undefined
  const decoded = decodeSingleQuoted(command.slice(prefix.length))
  if (
    decoded === undefined ||
    !decoded.startsWith('/') ||
    !decoded.endsWith(`/${RUNTIME_ADVISORY_RELATIVE_PATH}`) ||
    /[\r\n\0]/u.test(decoded)
  ) {
    return undefined
  }
  return decoded.slice(0, -`/${RUNTIME_ADVISORY_RELATIVE_PATH}`.length) || '/'
}

export function runtimeAdvisoryGlobalRoot(hook: unknown, agent: AgentId): string | undefined {
  const command = commandOf(hook)
  if (command === undefined) return undefined
  const root = decodedGlobalAdvisoryRoot(command, agent)
  if (root === undefined) return undefined
  const expected =
    agent === 'codex'
      ? makeCodexGlobalRuntimeAdvisoryCommand(root)
      : makeClaudeGlobalRuntimeAdvisoryCommand(root)
  return command === expected ? root : undefined
}

export function isClaudeRuntimeAdvisoryHook(hook: unknown): boolean {
  const command = commandOf(hook)
  if (command === CLAUDE_PROJECT_RUNTIME_ADVISORY_COMMAND) return true
  return runtimeAdvisoryGlobalRoot(hook, 'claude-code') !== undefined
}

export function isCodexRuntimeAdvisoryHook(hook: unknown): boolean {
  const command = commandOf(hook)
  if (command === undefined) return false
  const projectId = / clooks-advisory-project '([a-f0-9]{32})'$/u.exec(command)?.[1]
  if (projectId && command === makeCodexProjectRuntimeAdvisoryCommand(projectId)) return true
  return runtimeAdvisoryGlobalRoot(hook, 'codex') !== undefined
}

export function isRuntimeAdvisoryHook(hook: unknown, agent: AgentId): boolean {
  return agent === 'codex' ? isCodexRuntimeAdvisoryHook(hook) : isClaudeRuntimeAdvisoryHook(hook)
}

export function isExpectedRuntimeAdvisoryHook(
  hook: unknown,
  agent: AgentId,
  expectedCommand: string,
): boolean {
  return isRuntimeAdvisoryHook(hook, agent) && commandOf(hook) === expectedCommand
}

function registrationPath(registrationDir: string, agent: AgentId): string {
  return join(registrationDir, agent === 'codex' ? 'hooks.json' : 'settings.json')
}

function canonicalGroup(agent: AgentId, command: string): Record<string, unknown> {
  return {
    ...(agent === 'codex' ? { matcher: '*' } : {}),
    hooks: [{ type: 'command', command }],
  }
}

function isCanonicalGroup(group: unknown, agent: AgentId, command: string): boolean {
  if (!isRegistrationObject(group)) return false
  if (agent === 'codex' ? group.matcher !== '*' : Object.hasOwn(group, 'matcher')) return false
  if (Object.keys(group).length !== (agent === 'codex' ? 2 : 1)) return false
  return (
    Array.isArray(group.hooks) &&
    group.hooks.length === 1 &&
    isRegistrationObject(group.hooks[0]) &&
    Object.keys(group.hooks[0]).length === 2 &&
    isExpectedRuntimeAdvisoryHook(group.hooks[0], agent, command)
  )
}

export function hasRuntimeAdvisoryRegistration(
  registrationDir: string,
  agent: AgentId,
  expectedCommand?: string,
): boolean {
  const path = registrationPath(registrationDir, agent)
  const { hooks } = readRegistrationFile(path, ['SessionStart'])
  const groups = hooks.SessionStart
  if (!Array.isArray(groups)) return false
  return groups.some((group) => {
    if (!isRegistrationObject(group) || !Array.isArray(group.hooks)) return false
    return group.hooks.some((hook) =>
      expectedCommand === undefined
        ? isRuntimeAdvisoryHook(hook, agent)
        : isExpectedRuntimeAdvisoryHook(hook, agent, expectedCommand),
    )
  })
}

export function registerRuntimeAdvisory(
  registrationDir: string,
  agent: AgentId,
  command: string,
): RuntimeAdvisoryRegisterResult {
  const path = registrationPath(registrationDir, agent)
  const { settings, hooks, fileExisted } = readRegistrationFile(path, ['SessionStart'])
  const groups = Array.isArray(hooks.SessionStart) ? hooks.SessionStart : []
  const owned = groups.filter((group) => {
    if (!isRegistrationObject(group) || !Array.isArray(group.hooks)) return false
    return group.hooks.some((hook) => isRuntimeAdvisoryHook(hook, agent))
  })
  if (owned.length === 1 && groups.some((group) => isCanonicalGroup(group, agent, command))) {
    return { added: false, skipped: true, updated: false, created: !fileExisted }
  }

  const nextGroups: unknown[] = []
  for (const group of groups) {
    if (!isRegistrationObject(group) || !Array.isArray(group.hooks)) {
      nextGroups.push(group)
      continue
    }
    const remaining = group.hooks.filter((hook) => !isRuntimeAdvisoryHook(hook, agent))
    if (remaining.length === group.hooks.length) nextGroups.push(group)
    else if (remaining.length > 0) nextGroups.push({ ...group, hooks: remaining })
  }
  nextGroups.push(canonicalGroup(agent, command))
  if (!isRegistrationObject(settings.hooks)) settings.hooks = {}
  ;(settings.hooks as Record<string, unknown>).SessionStart = nextGroups
  mkdirSync(registrationDir, { recursive: true })
  writeRegistrationFileAtomic(path, JSON.stringify(settings, null, 2) + '\n')
  return {
    added: owned.length === 0,
    skipped: false,
    updated: owned.length > 0,
    created: !fileExisted,
  }
}

export function unregisterRuntimeAdvisory(
  registrationDir: string,
  agent: AgentId,
): RuntimeAdvisoryUnregisterResult {
  const path = registrationPath(registrationDir, agent)
  const { settings, hooks } = readRegistrationFile(path, ['SessionStart'])
  const groups = hooks.SessionStart
  if (!Array.isArray(groups)) return { removed: false }

  let removed = false
  const nextGroups = groups.flatMap((group) => {
    if (!isRegistrationObject(group) || !Array.isArray(group.hooks)) return [group]
    const remaining = group.hooks.filter((hook) => !isRuntimeAdvisoryHook(hook, agent))
    if (remaining.length === group.hooks.length) return [group]
    removed = true
    return remaining.length > 0 ? [{ ...group, hooks: remaining }] : []
  })
  if (!removed) return { removed: false }
  if (nextGroups.length > 0) hooks.SessionStart = nextGroups
  else delete hooks.SessionStart
  if (Object.keys(hooks).length === 0) delete settings.hooks
  writeRegistrationFileAtomic(path, JSON.stringify(settings, null, 2) + '\n')
  return { removed: true }
}
