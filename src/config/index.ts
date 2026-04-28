import { parseYamlFile } from './parse.js'
import { validateConfig } from './validate.js'
import { mergeThreeLayerConfig } from './merge.js'
import { resolveHookPath } from './resolve.js'
import { join } from 'path'
import { homedir } from 'os'
import type { HookName } from '../types/branded.js'

export type {
  ClooksConfig,
  HookEntry,
  EventEntry,
  GlobalConfig,
  ErrorMode,
  HookOrigin,
} from './schema.js'

export interface LoadConfigOptions {
  homeRoot?: string // defaults to os.homedir()
}

export interface LoadConfigResult {
  config: import('./schema.js').ClooksConfig
  shadows: HookName[]
  hasProjectConfig: boolean
}

/**
 * Try to parse a YAML file, returning undefined if the file does not exist.
 * Throws on malformed YAML or non-object content.
 */
async function tryParseYaml(filePath: string): Promise<Record<string, unknown> | undefined> {
  if (!(await Bun.file(filePath).exists())) {
    return undefined
  }
  return parseYamlFile(filePath)
}

/**
 * Load, parse, validate, and merge the Clooks config from up to three layers:
 * - home: ~/.clooks/clooks.yml (global hooks)
 * - project: .clooks/clooks.yml (project hooks)
 * - local: .clooks/clooks.local.yml (local overrides)
 *
 * Returns null if neither home nor project config exists.
 * Local config alone is meaningless without at least one of the other two.
 */
export async function loadConfig(
  projectRoot: string,
  options?: LoadConfigOptions,
): Promise<LoadConfigResult | null> {
  const homeRoot = options?.homeRoot ?? homedir()
  const homePath = join(homeRoot, '.clooks', 'clooks.yml')
  const projectPath = join(projectRoot, '.clooks', 'clooks.yml')
  const localPath = join(projectRoot, '.clooks', 'clooks.local.yml')

  // When cwd is the home directory, home and project resolve to the same file.
  // Treat it as home-only to avoid false shadow warnings.
  const isSameConfig = homePath === projectPath

  // Parse each file (all optional)
  const homeRaw = await tryParseYaml(homePath)
  const projectRaw = isSameConfig ? undefined : await tryParseYaml(projectPath)
  const localRaw = await tryParseYaml(localPath)

  // If neither home nor project exists, return null
  if (homeRaw === undefined && projectRaw === undefined) {
    return null
  }

  // Merge the three layers
  const { merged, originMap, shadows, homeHookUses } = mergeThreeLayerConfig(
    homeRaw,
    projectRaw,
    localRaw,
  )

  // Validate the merged config
  const config = validateConfig(merged)

  // Annotate HookEntry.origin from the origin map
  for (const [hookName, origin] of originMap) {
    const entry = config.hooks[hookName as HookName]
    if (entry) {
      entry.origin = origin
    }
  }

  // For home hooks, re-resolve paths with homeRoot base using the original
  // home hook uses (before any local override could have changed it)
  for (const [hookName, entry] of Object.entries(config.hooks)) {
    if (entry.origin === 'home') {
      const rawUses = homeHookUses.get(hookName)
      entry.resolvedPath = resolveHookPath(hookName as HookName, { uses: rawUses }, homeRoot)
    }
  }

  // Suppress no-op shadows: if the project hook source file is byte-identical
  // to the home hook source file, drop it from the shadows list.
  const filteredShadows: HookName[] = []
  for (const name of shadows) {
    const projectEntry = config.hooks[name as HookName]
    const projectPath = resolveHookPath(name as HookName, { uses: projectEntry?.uses }, projectRoot)
    const rawHomeUses = homeHookUses.get(name)
    const homePath = resolveHookPath(name as HookName, { uses: rawHomeUses }, homeRoot)
    if (await sourcesEqual(projectPath, homePath)) continue
    filteredShadows.push(name as HookName)
  }

  return {
    config,
    shadows: filteredShadows,
    hasProjectConfig: projectRaw !== undefined,
  }
}

// Returns true iff both files exist and have byte-identical contents.
// On any I/O error (missing, permission denied), returns false so the
// shadow warning is preserved — "preserve the warning on uncertainty."
async function sourcesEqual(a: string, b: string): Promise<boolean> {
  try {
    const fileA = Bun.file(a)
    const fileB = Bun.file(b)
    if (!(await fileA.exists()) || !(await fileB.exists())) return false
    const [bytesA, bytesB] = await Promise.all([fileA.bytes(), fileB.bytes()])
    if (bytesA.length !== bytesB.length) return false
    for (let i = 0; i < bytesA.length; i++) {
      if (bytesA[i] !== bytesB[i]) return false
    }
    return true
  } catch {
    return false
  }
}
