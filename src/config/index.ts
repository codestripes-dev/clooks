import { parseYamlFile } from "./parse.js"
import { validateConfig } from "./validate.js"
import { mergeConfigFiles } from "./merge.js"
import { join } from "path"

export type {
  ClooksConfig,
  HookEntry,
  EventEntry,
  GlobalConfig,
  ErrorMode,
} from "./types.js"

/**
 * Load, parse, validate, and merge the Clooks config.
 *
 * Reads .clooks/clooks.yml (required) and .clooks/clooks.local.yml (optional).
 * Returns a fully typed, validated ClooksConfig object.
 *
 * Throws on: missing config file, malformed YAML, invalid config shape.
 */
export async function loadConfig(
  projectRoot: string,
): Promise<import("./types.js").ClooksConfig> {
  const configPath = join(projectRoot, ".clooks", "clooks.yml")
  const localPath = join(projectRoot, ".clooks", "clooks.local.yml")

  // Parse base config (required — throws if missing)
  const base = await parseYamlFile(configPath)

  // Parse local overrides (optional — silently skip if missing)
  let local: Record<string, unknown> | undefined
  if (await Bun.file(localPath).exists()) {
    local = await parseYamlFile(localPath)
  }

  // Merge base + local
  const merged = mergeConfigFiles(base, local)

  // Validate and return
  return validateConfig(merged)
}
