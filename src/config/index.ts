import { parseYamlFile } from "./parse.js"
import { validateConfig } from "./validate.js"
import { mergeConfigFiles, mergeThreeLayerConfig } from "./merge.js"
import { resolveHookPath } from "./resolve.js"
import { join } from "path"
import { homedir } from "os"
import type { HookName } from "../types/branded.js"
import type { HookOrigin } from "./types.js"

export type {
  ClooksConfig,
  HookEntry,
  EventEntry,
  GlobalConfig,
  ErrorMode,
  HookOrigin,
} from "./types.js"

export interface LoadConfigOptions {
  homeRoot?: string  // defaults to os.homedir()
}

export interface LoadConfigResult {
  config: import("./types.js").ClooksConfig
  shadows: HookName[]
  hasProjectConfig: boolean
}

/**
 * Try to parse a YAML file, returning undefined if the file does not exist.
 * Throws on malformed YAML or non-object content.
 */
async function tryParseYaml(
  filePath: string,
): Promise<Record<string, unknown> | undefined> {
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
  const homePath = join(homeRoot, ".clooks", "clooks.yml")
  const projectPath = join(projectRoot, ".clooks", "clooks.yml")
  const localPath = join(projectRoot, ".clooks", "clooks.local.yml")

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
  const { merged, originMap, shadows, homeHookPaths } = mergeThreeLayerConfig(
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
  // home hook path (before any local override could have changed it)
  for (const [hookName, entry] of Object.entries(config.hooks)) {
    if (entry.origin === "home") {
      const rawPath = homeHookPaths.get(hookName)
      entry.resolvedPath = resolveHookPath(hookName as HookName, { path: rawPath }, homeRoot)
    }
  }

  return {
    config,
    shadows: shadows as HookName[],
    hasProjectConfig: projectRaw !== undefined,
  }
}
