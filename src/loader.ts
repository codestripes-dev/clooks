import type { HookName } from "./types/branded.js"
import type { ClooksHook } from "./types/hook.js"
import type { HookEntry, ClooksConfig } from "./config/types.js"
import { resolve } from "path"

export interface LoadedHook {
  name: HookName
  hook: ClooksHook
  config: Record<string, unknown>
}

export function validateHookExport(
  mod: Record<string, unknown>,
  hookPath: string,
): ClooksHook {
  const hook = mod.hook
  if (hook === undefined || hook === null || typeof hook !== "object") {
    throw new Error(
      `clooks: ${hookPath} does not export a "hook" named export`,
    )
  }

  const hookObj = hook as Record<string, unknown>
  const meta = hookObj.meta
  if (meta === undefined || meta === null || typeof meta !== "object") {
    throw new Error(
      `clooks: ${hookPath} hook.meta is missing or not an object`,
    )
  }

  const metaObj = meta as Record<string, unknown>
  if (typeof metaObj.name !== "string" || metaObj.name.length === 0) {
    throw new Error(
      `clooks: ${hookPath} hook.meta.name is missing or not a string`,
    )
  }

  // Validate that any event-named properties are functions
  for (const key of Object.keys(hookObj)) {
    if (key === "meta") continue
    if (typeof hookObj[key] !== "function") {
      throw new Error(
        `clooks: ${hookPath} hook.${key} is not a function`,
      )
    }
  }

  return hook as ClooksHook
}

export async function loadHook(
  hookName: HookName,
  entry: HookEntry,
  projectRoot: string,
): Promise<LoadedHook> {
  const absolutePath = resolve(projectRoot, entry.resolvedPath)

  let mod: Record<string, unknown>
  try {
    mod = (await import(absolutePath)) as Record<string, unknown>
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    // Detect bare npm specifier failures (e.g., `import { z } from "zod"`)
    // and produce a clear error directing users to the project hook pipeline.
    // Distinguish from file-not-found: "Cannot find module '<absolutePath>'"
    // means the hook file itself is missing. Any other "Cannot find module/package"
    // indicates a dependency the hook tried to import.
    const isFileNotFound = message.includes(
      `Cannot find module '${absolutePath}'`,
    )
    const isModuleError =
      message.includes("Cannot find module") ||
      message.includes("Cannot find package")
    if (isModuleError && !isFileNotFound) {
      throw new Error(
        `clooks: hook "${hookName}" failed to import — it may use npm packages that require pre-bundling. ` +
          `Convert it to a project hook (directory with package.json) and run "clooks build". ` +
          `See docs/research/hook-npm-dependencies.md. Original error: ${message}`,
      )
    }
    throw new Error(
      `clooks: failed to import hook "${hookName}" from ${entry.resolvedPath}: ${message}`,
    )
  }

  const hook = validateHookExport(mod, entry.resolvedPath)

  // Verify the hook's self-declared name matches the config key
  if (hook.meta.name !== hookName) {
    throw new Error(
      `clooks: hook at ${entry.resolvedPath} declares meta.name "${hook.meta.name}" ` +
        `but is registered as "${hookName}" in clooks.yml`,
    )
  }

  // Shallow merge: meta.config defaults ← clooks.yml overrides
  const metaDefaults = hook.meta.config ?? {}
  const merged = { ...metaDefaults, ...entry.config }

  return { name: hookName, hook, config: merged }
}

export interface HookLoadError {
  name: HookName
  error: string
}

export interface LoadAllHooksResult {
  loaded: LoadedHook[]
  loadErrors: HookLoadError[]
}

export async function loadAllHooks(
  config: ClooksConfig,
  projectRoot: string,
): Promise<LoadAllHooksResult> {
  // Object.entries() erases Record key types to string (TypeScript#35101).
  // Safe boundary cast: keys originate from validated config parsing.
  const entries = Object.entries(config.hooks) as [HookName, HookEntry][]
  if (entries.length === 0) return { loaded: [], loadErrors: [] }

  const results = await Promise.allSettled(
    entries.map(([name, entry]) => loadHook(name, entry, projectRoot)),
  )

  const loaded: LoadedHook[] = []
  const loadErrors: HookLoadError[] = []

  for (let i = 0; i < results.length; i++) {
    const result = results[i]!
    if (result.status === "fulfilled") {
      loaded.push(result.value)
    } else {
      const message = result.reason instanceof Error
        ? result.reason.message
        : String(result.reason)
      loadErrors.push({ name: entries[i]![0], error: message })
    }
  }

  return { loaded, loadErrors }
}
