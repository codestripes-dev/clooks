import type { HookName } from './types/branded.js'
import type { ClooksHook } from './types/hook.js'
import type { HookEntry, ClooksConfig } from './config/schema.js'
import { CLAUDE_CODE_EVENTS } from './config/constants.js'
import { isPathLike, isShortAddress, shortAddressHookName } from './config/resolve.js'
import { resolve } from 'path'

export interface LoadedHook {
  name: HookName
  hook: ClooksHook
  config: Record<string, unknown>
  /** Absolute path to the hook's .ts file. */
  hookPath: string
  /** Absolute path to the clooks.yml that registered this hook. */
  configPath: string
  /** Raw `uses` value from config, if this hook was loaded via alias. */
  usesTarget?: string
}

export function validateHookExport(mod: Record<string, unknown>, hookPath: string): ClooksHook {
  const hook = mod.hook
  if (hook === undefined || hook === null || typeof hook !== 'object') {
    throw new Error(`clooks: ${hookPath} does not export a "hook" named export`)
  }

  const hookObj = hook as Record<string, unknown>
  const meta = hookObj.meta
  if (meta === undefined || meta === null || typeof meta !== 'object') {
    throw new Error(`clooks: ${hookPath} hook.meta is missing or not an object`)
  }

  const metaObj = meta as Record<string, unknown>
  if (typeof metaObj.name !== 'string' || metaObj.name.length === 0) {
    throw new Error(`clooks: ${hookPath} hook.meta.name is missing or not a string`)
  }

  const ALLOWED_HOOK_KEYS = new Set<string>([
    'meta',
    'beforeHook',
    'afterHook',
    ...CLAUDE_CODE_EVENTS,
  ])

  for (const key of Object.keys(hookObj)) {
    if (key === 'meta') continue
    if (!ALLOWED_HOOK_KEYS.has(key)) {
      throw new Error(
        `clooks: ${hookPath} hook has unknown property "${key}". ` +
          `Allowed: meta, beforeHook, afterHook, and event names (PreToolUse, PostToolUse, ...).`,
      )
    }
    if (typeof hookObj[key] !== 'function') {
      throw new Error(`clooks: ${hookPath} hook.${key} is not a function`)
    }
  }

  return hook as ClooksHook
}

export async function loadHook(
  hookName: HookName,
  entry: HookEntry,
  projectRoot: string,
  homeRoot: string = projectRoot,
): Promise<LoadedHook> {
  const basePath = entry.origin === 'home' ? homeRoot : projectRoot
  const absolutePath = resolve(basePath, entry.resolvedPath)

  let mod: Record<string, unknown>
  try {
    mod = (await import(absolutePath)) as Record<string, unknown>
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const usesContext = entry.uses !== undefined ? ` (uses: "${entry.uses}")` : ''
    // Detect bare npm specifier failures (e.g., `import { z } from "zod"`)
    // and produce a clear error directing users to the project hook pipeline.
    // Distinguish from file-not-found: "Cannot find module '<absolutePath>'"
    // means the hook file itself is missing. Any other "Cannot find module/package"
    // indicates a dependency the hook tried to import.
    const isFileNotFound = message.includes(`Cannot find module '${absolutePath}'`)
    const isModuleError =
      message.includes('Cannot find module') || message.includes('Cannot find package')
    if (isModuleError && !isFileNotFound) {
      throw new Error(
        `clooks: hook "${hookName}"${usesContext} failed to import — it may use npm packages that require pre-bundling. ` +
          `Convert it to a project hook (directory with package.json) and run "clooks build". ` +
          `See docs/research/hook-npm-dependencies.md. Original error: ${message}`,
        { cause: e },
      )
    }
    throw new Error(
      `clooks: failed to import hook "${hookName}"${usesContext} from ${entry.resolvedPath}: ${message}`,
      { cause: e },
    )
  }

  const hook = validateHookExport(mod, entry.resolvedPath)

  // For aliases (entry.uses set), meta.name must match the uses target.
  // For regular hooks, meta.name must match the YAML key.
  const isPathLikeUses = entry.uses !== undefined && isPathLike(entry.uses)
  const isShortAddressUses = entry.uses !== undefined && isShortAddress(entry.uses)

  if (isPathLikeUses) {
    // Path-like uses: meta.name can be anything — no validation.
    // The hook file is a custom path, its meta.name is whatever the author set.
    // (We still require meta.name exists and is a string — validated by validateHookExport.)
  } else if (isShortAddressUses) {
    // Short address (owner/repo:hook-name): meta.name must match the hook-name portion (after ":").
    const hookNamePart = shortAddressHookName(entry.uses!)
    if (hook.meta.name !== hookNamePart) {
      throw new Error(
        `clooks: hook at ${entry.resolvedPath} declares meta.name "${hook.meta.name}" ` +
          `(loaded via uses: "${entry.uses}" for alias "${hookName}") — ` +
          `meta.name must match the hook name in the short address ("${hookNamePart}")`,
      )
    }
  } else if (entry.uses === undefined && isShortAddress(hookName)) {
    // No uses + hookName IS a short address (e.g., "owner/repo:hook-name"):
    // meta.name must match the hook-name portion (after ":").
    const hookNamePart = shortAddressHookName(hookName)
    if (hook.meta.name !== hookNamePart) {
      throw new Error(
        `clooks: hook at ${entry.resolvedPath} declares meta.name "${hook.meta.name}" ` +
          `but is registered as "${hookName}" in clooks.yml — ` +
          `meta.name must match the hook name in the short address ("${hookNamePart}")`,
      )
    }
  } else {
    // Hook-name uses or no uses: meta.name must match
    const expectedName = entry.uses ?? hookName
    if (hook.meta.name !== expectedName) {
      const context =
        entry.uses !== undefined
          ? ` (loaded via uses: "${entry.uses}" for alias "${hookName}")`
          : ` but is registered as "${hookName}" in clooks.yml`
      throw new Error(
        `clooks: hook at ${entry.resolvedPath} declares meta.name "${hook.meta.name}"${context}`,
      )
    }
  }

  // Shallow merge: meta.config defaults ← clooks.yml overrides
  const metaDefaults = hook.meta.config ?? {}
  const merged = { ...metaDefaults, ...entry.config }

  const configDir = entry.origin === 'home' ? homeRoot : projectRoot
  const configPath = resolve(configDir, '.clooks', 'clooks.yml')

  const result: LoadedHook = {
    name: hookName,
    hook,
    config: merged,
    hookPath: absolutePath,
    configPath,
  }
  if (entry.uses !== undefined) result.usesTarget = entry.uses
  return result
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
  homeRoot: string = projectRoot,
): Promise<LoadAllHooksResult> {
  // Object.entries() erases Record key types to string (TypeScript#35101).
  // Safe boundary cast: keys originate from validated config parsing.
  const entries = Object.entries(config.hooks) as [HookName, HookEntry][]
  if (entries.length === 0) return { loaded: [], loadErrors: [] }

  const results = await Promise.allSettled(
    entries.map(([name, entry]) => loadHook(name, entry, projectRoot, homeRoot)),
  )

  const loaded: LoadedHook[] = []
  const loadErrors: HookLoadError[] = []

  for (let i = 0; i < results.length; i++) {
    const result = results[i]!
    if (result.status === 'fulfilled') {
      loaded.push(result.value)
    } else {
      const message = result.reason instanceof Error ? result.reason.message : String(result.reason)
      loadErrors.push({ name: entries[i]![0], error: message })
    }
  }

  return { loaded, loadErrors }
}
