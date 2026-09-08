import { lstatSync, mkdirSync, realpathSync, statSync } from 'fs'
import { dirname, isAbsolute, join, resolve } from 'path'
import { readRegistrationFile, writeRegistrationFileAtomic } from '../../registration-file.js'

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

export function resolveCodexHome(
  homeRoot: string,
  env: Record<string, string | undefined>,
): string {
  const selected = env.CODEX_HOME || `${homeRoot}/.codex`
  if (!isAbsolute(homeRoot) || /[\r\n\0]/.test(homeRoot)) {
    throw new Error('Installation home must be an absolute path without CR/LF or NUL.')
  }
  if (!isAbsolute(selected) || /[\r\n\0]/.test(selected)) {
    throw new Error(
      'CODEX_HOME must be an absolute path without CR/LF or NUL. Repair the path, then retry.',
    )
  }

  let physical = '/'
  const missing: string[] = []
  // Resolve each existing prefix before processing '..'; lexical normalization
  // of an unresolved symlink's parent can select a different directory.
  for (const component of selected.split('/')) {
    if (component === '' || component === '.') continue
    if (component === '..') {
      if (missing.length > 0) missing.pop()
      else physical = dirname(physical)
      continue
    }
    if (missing.length > 0) {
      missing.push(component)
      continue
    }
    const candidate = join(physical, component)
    try {
      const resolved = realpathSync(candidate)
      if (!statSync(resolved).isDirectory()) {
        throw new Error(`\`${candidate}\` must be a directory. Repair the path, then retry.`)
      }
      physical = resolved
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      // A dangling symlink is not a missing directory we may invent beneath its parent.
      if (lstatSync(candidate, { throwIfNoEntry: false })) throw error
      missing.push(component)
    }
  }
  const selectedHome = join(physical, ...missing)
  if (/[\r\n\0]/.test(selectedHome)) {
    throw new Error(
      'CODEX_HOME must resolve to an absolute path without CR/LF or NUL. Repair the path, then retry.',
    )
  }
  return selectedHome
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
    Array.isArray(hook) ||
    (hook as Record<string, unknown>).type !== 'command' ||
    typeof (hook as Record<string, unknown>).command !== 'string'
  ) {
    return false
  }

  const command = (hook as { command: string }).command
  // Only decode the single-argument quoting emitted by our builders, never shell syntax.
  const quoted = "'((?:[^']|'\\\\'')*)'"
  const match = new RegExp(
    `^CLOOKS_AGENT=codex (?:CLOOKS_PROJECT_ROOT=${quoted} )?${quoted}$`,
  ).exec(command)
  if (!match || match[0] !== command) return false
  const decode = (value: string) => value.replaceAll("'\\''", "'")
  const executable = decode(match[2]!)
  if (!executable.startsWith('/') || !executable.endsWith('/.clooks/bin/entrypoint.sh'))
    return false
  return (
    match[1] === undefined ||
    (executable === join(decode(match[1]), '.clooks/bin/entrypoint.sh') &&
      decode(match[1]).startsWith('/'))
  )
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
  const { settings, fileExisted } = readRegistrationFile(hooksPath, CODEX_REGISTRATION_EVENTS)
  return { hooksFile: settings, fileExisted }
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
      if (unrelatedHooks.length === matcherGroup.hooks.length) {
        nextMatcherGroups.push(matcherGroup)
      } else if (unrelatedHooks.length > 0) {
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
    writeRegistrationFileAtomic(hooksPath, JSON.stringify(hooksFile, null, 2) + '\n')
  }

  return { added, skipped, updated, created: !fileExisted }
}

export function unregisterCodexClooks(codexDir: string): CodexUnregisterResult {
  const hooksPath = join(codexDir, 'hooks.json')
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

      if (nextHooks.length === matcherGroup.hooks.length) {
        nextMatcherGroups.push(matcherGroup)
      } else if (nextHooks.length > 0) {
        nextMatcherGroups.push({ ...matcherGroup, hooks: nextHooks })
      }
    }

    if (eventRemoved) {
      removed.push(event)
    }

    if (!eventRemoved) continue
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
    writeRegistrationFileAtomic(hooksPath, JSON.stringify(hooksFile, null, 2) + '\n')
  }

  return { removed }
}

export function isCodexClooksRegistered(codexDir: string): boolean {
  const hooksPath = join(codexDir, 'hooks.json')
  const { settings: hooksFile } = readRegistrationFile(hooksPath)
  if (!isRecord(hooksFile.hooks)) return false

  for (const matcherGroups of Object.values(hooksFile.hooks)) {
    if (!Array.isArray(matcherGroups)) continue
    if (matcherGroups.some(isCodexClooksMatcherGroup)) return true
  }

  return false
}
