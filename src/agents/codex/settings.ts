import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'

export const CODEX_REGISTRATION_EVENTS = [
  'SessionStart',
  'SubagentStart',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PreCompact',
  'PostCompact',
  'UserPromptSubmit',
  'SubagentStop',
  'Stop',
] as const

export type CodexRegistrationEvent = (typeof CODEX_REGISTRATION_EVENTS)[number]

export interface CodexRegisterResult {
  added: CodexRegistrationEvent[]
  skipped: CodexRegistrationEvent[]
  updated: CodexRegistrationEvent[]
  created: boolean
}

export interface CodexUnregisterResult {
  removed: CodexRegistrationEvent[]
}

export function quotePosixSingleArg(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export function makeCodexProjectEntrypointCommand(projectRoot: string): string {
  const absoluteProjectRoot = resolve(projectRoot)
  const entrypointPath = join(absoluteProjectRoot, '.clooks/bin/entrypoint.sh')
  return [
    'CLOOKS_AGENT=codex',
    `CLOOKS_PROJECT_ROOT=${quotePosixSingleArg(absoluteProjectRoot)}`,
    quotePosixSingleArg(entrypointPath),
  ].join(' ')
}

export function makeCodexGlobalEntrypointCommand(homeRoot: string): string {
  const entrypointPath = join(resolve(homeRoot), '.clooks/bin/entrypoint.sh')
  return ['CLOOKS_AGENT=codex', quotePosixSingleArg(entrypointPath)].join(' ')
}

export function isCodexClooksHook(hook: unknown): boolean {
  if (
    typeof hook !== 'object' ||
    hook === null ||
    typeof (hook as Record<string, unknown>).command !== 'string'
  ) {
    return false
  }

  const command = (hook as { command: string }).command
  return command.includes('CLOOKS_AGENT=codex') && command.includes('.clooks/bin/entrypoint.sh')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCodexClooksMatcherGroup(matcherGroup: unknown): boolean {
  if (!isRecord(matcherGroup)) return false
  const hooks = matcherGroup.hooks
  if (!Array.isArray(hooks)) return false
  return hooks.some(isCodexClooksHook)
}

function readHooksFile(hooksPath: string): {
  hooksFile: Record<string, unknown>
  fileExisted: boolean
} {
  if (!existsSync(hooksPath)) {
    return { hooksFile: {}, fileExisted: false }
  }

  const text = readFileSync(hooksPath, 'utf-8')
  if (text.trim() === '') {
    return { hooksFile: {}, fileExisted: true }
  }

  try {
    const parsed = JSON.parse(text)
    return { hooksFile: isRecord(parsed) ? parsed : {}, fileExisted: true }
  } catch {
    throw new Error(
      `\`${hooksPath}\` contains invalid JSON. Fix or delete the file, then re-run \`clooks init --agent codex\`.`,
    )
  }
}

function makeCodexClooksMatcherGroup(entrypointCommand: string): Record<string, unknown> {
  return {
    matcher: '*',
    hooks: [{ type: 'command', command: entrypointCommand }],
  }
}

function isCanonicalCodexClooksMatcherGroup(
  matcherGroup: unknown,
  entrypointCommand: string,
): boolean {
  if (!isRecord(matcherGroup)) return false
  if (matcherGroup.matcher !== '*') return false
  if (!Array.isArray(matcherGroup.hooks) || matcherGroup.hooks.length !== 1) return false

  const [hook] = matcherGroup.hooks
  return (
    isRecord(hook) &&
    hook.type === 'command' &&
    hook.command === entrypointCommand &&
    Object.keys(hook).length === 2 &&
    Object.keys(matcherGroup).length === 2
  )
}

function getHooksObject(hooksFile: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(hooksFile.hooks)) {
    hooksFile.hooks = {}
  }
  return hooksFile.hooks as Record<string, unknown>
}

export function registerCodexClooks(
  codexDir: string,
  entrypointCommand: string,
): CodexRegisterResult {
  const hooksPath = join(codexDir, 'hooks.json')
  const { hooksFile, fileExisted } = readHooksFile(hooksPath)
  const hooks = getHooksObject(hooksFile)

  const added: CodexRegistrationEvent[] = []
  const skipped: CodexRegistrationEvent[] = []
  const updated: CodexRegistrationEvent[] = []

  for (const event of CODEX_REGISTRATION_EVENTS) {
    if (!Array.isArray(hooks[event])) {
      hooks[event] = []
    }

    const matcherGroups = hooks[event] as unknown[]
    const clooksGroupCount = matcherGroups.filter(isCodexClooksMatcherGroup).length
    const hasAnyClooksHook = clooksGroupCount > 0
    const isAlreadyCanonical =
      clooksGroupCount === 1 &&
      matcherGroups.some((matcherGroup) =>
        isCanonicalCodexClooksMatcherGroup(matcherGroup, entrypointCommand),
      )

    if (isAlreadyCanonical) {
      skipped.push(event)
      continue
    }

    const nextMatcherGroups: unknown[] = []

    for (const matcherGroup of matcherGroups) {
      if (!isRecord(matcherGroup) || !Array.isArray(matcherGroup.hooks)) {
        nextMatcherGroups.push(matcherGroup)
        continue
      }

      const unrelatedHooks = matcherGroup.hooks.filter((hook) => !isCodexClooksHook(hook))
      if (unrelatedHooks.length > 0) {
        nextMatcherGroups.push({ ...matcherGroup, hooks: unrelatedHooks })
      }
    }

    nextMatcherGroups.push(makeCodexClooksMatcherGroup(entrypointCommand))
    hooks[event] = nextMatcherGroups

    if (hasAnyClooksHook) {
      updated.push(event)
    } else {
      added.push(event)
    }
  }

  if (added.length > 0 || updated.length > 0) {
    mkdirSync(codexDir, { recursive: true })
    writeFileSync(hooksPath, JSON.stringify(hooksFile, null, 2) + '\n')
  }

  return { added, skipped, updated, created: !fileExisted }
}

export function unregisterCodexClooks(codexDir: string): CodexUnregisterResult {
  const hooksPath = join(codexDir, 'hooks.json')
  if (!existsSync(hooksPath)) {
    return { removed: [] }
  }

  const { hooksFile } = readHooksFile(hooksPath)
  if (!isRecord(hooksFile.hooks)) {
    return { removed: [] }
  }

  const hooks = hooksFile.hooks
  const removed: CodexRegistrationEvent[] = []

  for (const event of CODEX_REGISTRATION_EVENTS) {
    const matcherGroups = hooks[event]
    if (!Array.isArray(matcherGroups)) continue

    const nextMatcherGroups: unknown[] = []
    let eventRemoved = false

    for (const matcherGroup of matcherGroups) {
      if (!isRecord(matcherGroup) || !Array.isArray(matcherGroup.hooks)) {
        nextMatcherGroups.push(matcherGroup)
        continue
      }

      const nextHooks = matcherGroup.hooks.filter((hook) => !isCodexClooksHook(hook))
      if (nextHooks.length !== matcherGroup.hooks.length) {
        eventRemoved = true
      }

      if (nextHooks.length > 0) {
        nextMatcherGroups.push({ ...matcherGroup, hooks: nextHooks })
      }
    }

    if (eventRemoved) {
      removed.push(event)
    }

    if (nextMatcherGroups.length === 0) {
      delete hooks[event]
    } else {
      hooks[event] = nextMatcherGroups
    }
  }

  if (removed.length > 0) {
    if (Object.keys(hooks).length === 0) {
      delete hooksFile.hooks
    }
    writeFileSync(hooksPath, JSON.stringify(hooksFile, null, 2) + '\n')
  }

  return { removed }
}

export function isCodexClooksRegistered(codexDir: string): boolean {
  const hooksPath = join(codexDir, 'hooks.json')
  if (!existsSync(hooksPath)) return false

  const { hooksFile } = readHooksFile(hooksPath)
  if (!isRecord(hooksFile.hooks)) return false

  for (const matcherGroups of Object.values(hooksFile.hooks)) {
    if (!Array.isArray(matcherGroups)) continue
    if (matcherGroups.some(isCodexClooksMatcherGroup)) return true
  }

  return false
}
