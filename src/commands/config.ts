import { Command } from 'commander'
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { loadConfig as defaultLoadConfig } from '../config/index.js'
import type { LoadConfigResult, LoadConfigOptions } from '../config/index.js'
import { parseYamlFile } from '../config/parse.js'
import { classifyConfigKeys } from '../config/classify.js'
import { resolveHookPath } from '../config/resolve.js'
import type { HookOrigin } from '../config/schema.js'
import type { HookName } from '../types/branded.js'
import { getCtx } from '../tui/context.js'
import { jsonSuccess } from '../tui/json-envelope.js'
import { printIntro, printSuccess, printInfo, printError, printOutro } from '../tui/output.js'
import { isPlainObject } from 'lodash-es'

type LoadConfigFn = (
  projectRoot: string,
  options?: LoadConfigOptions,
) => Promise<LoadConfigResult | null>

/** Try to parse a YAML file, returning undefined if it does not exist. */
async function tryParseYaml(filePath: string): Promise<Record<string, unknown> | undefined> {
  if (!(await Bun.file(filePath).exists())) {
    return undefined
  }
  return parseYamlFile(filePath)
}

interface LayerValue {
  layer: string // "home" | "project" | "local"
  value: unknown
  path: string // file path
  active: boolean
}

interface ResolvedField {
  key: string
  effectiveValue: unknown
  layers: LayerValue[]
}

interface ResolvedHook {
  name: string
  origin: HookOrigin | 'local override' | 'local'
  fields: Record<string, unknown>
  sourcePath: string
  localOverride?: Record<string, unknown>
  localPath?: string
  shadowed?: boolean
  /** Raw `uses` value from YAML, if this hook is an alias. */
  usesTarget?: string
  /** True when the hook's source file does not exist on disk. */
  dangling?: boolean
}

interface ResolvedEvent {
  eventName: string
  effectiveOrder: string[]
  layers: LayerValue[]
}

interface ResolvedOutput {
  fields: ResolvedField[]
  hooks: ResolvedHook[]
  events: ResolvedEvent[]
}

/**
 * Build resolved provenance output by independently loading all three config files
 * and comparing values per-field.
 */
async function buildResolved(
  projectRoot: string,
  homeRoot: string,
): Promise<ResolvedOutput | null> {
  const homePath = join(homeRoot, '.clooks', 'clooks.yml')
  const projectPath = join(projectRoot, '.clooks', 'clooks.yml')
  const localPath = join(projectRoot, '.clooks', 'clooks.local.yml')

  const homeRaw = await tryParseYaml(homePath)
  const projectRaw = await tryParseYaml(projectPath)
  const localRaw = await tryParseYaml(localPath)

  if (!homeRaw && !projectRaw) return null

  const homeClassified = homeRaw ? classifyConfigKeys(homeRaw) : undefined
  const projectClassified = projectRaw ? classifyConfigKeys(projectRaw) : undefined
  const localClassified = localRaw ? classifyConfigKeys(localRaw) : undefined

  const fields: ResolvedField[] = []

  // --- version ---
  const versionLayers: LayerValue[] = []
  let effectiveVersion: unknown
  if (homeClassified?.version !== undefined) {
    versionLayers.push({
      layer: 'home',
      value: homeClassified.version,
      path: homePath,
      active: false,
    })
    effectiveVersion = homeClassified.version
  }
  if (projectClassified?.version !== undefined) {
    versionLayers.push({
      layer: 'project',
      value: projectClassified.version,
      path: projectPath,
      active: false,
    })
    effectiveVersion = projectClassified.version
  }
  if (localClassified?.version !== undefined) {
    versionLayers.push({
      layer: 'local',
      value: localClassified.version,
      path: localPath,
      active: false,
    })
    effectiveVersion = localClassified.version
  }
  // Mark the last layer as active
  if (versionLayers.length > 0) {
    versionLayers[versionLayers.length - 1]!.active = true
    fields.push({ key: 'version', effectiveValue: effectiveVersion, layers: versionLayers })
  }

  // --- config fields ---
  const homeConfig =
    homeClassified?.config && isPlainObject(homeClassified.config)
      ? (homeClassified.config as Record<string, unknown>)
      : {}
  const projectConfig =
    projectClassified?.config && isPlainObject(projectClassified.config)
      ? (projectClassified.config as Record<string, unknown>)
      : {}
  const localConfig =
    localClassified?.config && isPlainObject(localClassified.config)
      ? (localClassified.config as Record<string, unknown>)
      : {}

  const allConfigKeys = new Set([
    ...Object.keys(homeConfig),
    ...Object.keys(projectConfig),
    ...Object.keys(localConfig),
  ])
  for (const key of allConfigKeys) {
    const layers: LayerValue[] = []
    let effective: unknown
    if (key in homeConfig) {
      layers.push({ layer: 'home', value: homeConfig[key], path: homePath, active: false })
      effective = homeConfig[key]
    }
    if (key in projectConfig) {
      layers.push({ layer: 'project', value: projectConfig[key], path: projectPath, active: false })
      effective = projectConfig[key]
    }
    if (key in localConfig) {
      layers.push({ layer: 'local', value: localConfig[key], path: localPath, active: false })
      effective = localConfig[key]
    }
    if (layers.length > 0) {
      layers[layers.length - 1]!.active = true
      fields.push({ key: `config.${key}`, effectiveValue: effective, layers })
    }
  }

  // --- hooks ---
  const hooks: ResolvedHook[] = []
  const homeHooks = homeClassified?.hooks ?? {}
  const projectHooks = projectClassified?.hooks ?? {}
  const localHooks = localClassified?.hooks ?? {}

  /** Compute the display source path for a hook. */
  function computeSourcePath(hookName: string, hookData: unknown, origin: HookOrigin): string {
    const hookFields = isPlainObject(hookData) ? (hookData as Record<string, unknown>) : {}
    const entry = { uses: typeof hookFields.uses === 'string' ? hookFields.uses : undefined }
    if (origin === 'home') {
      const resolved = resolveHookPath(hookName as HookName, entry, homeRoot)
      // Display as relative to home: ~/.clooks/...
      const relPart = resolved.slice(homeRoot.length + 1)
      return `~/${relPart}`
    }
    const resolved = resolveHookPath(hookName as HookName, entry)
    return resolved
  }

  function extractUsesTarget(hookData: unknown): string | undefined {
    if (!isPlainObject(hookData)) return undefined
    const uses = (hookData as Record<string, unknown>).uses
    return typeof uses === 'string' ? uses : undefined
  }

  function checkFileExists(
    hookName: string,
    hookData: unknown,
    origin: HookOrigin,
    projectRoot: string,
    homeRoot: string,
  ): boolean {
    const hookFields = isPlainObject(hookData) ? (hookData as Record<string, unknown>) : {}
    const entry = { uses: typeof hookFields.uses === 'string' ? hookFields.uses : undefined }
    const basePath = origin === 'home' ? homeRoot : projectRoot
    const resolved = resolveHookPath(hookName as HookName, entry, basePath)
    return existsSync(resolved)
  }

  // Collect all unique hook names preserving order
  const allHookNames = new Set([
    ...Object.keys(homeHooks),
    ...Object.keys(projectHooks),
    ...Object.keys(localHooks),
  ])

  for (const name of allHookNames) {
    const inHome = name in homeHooks
    const inProject = name in projectHooks
    const isShadowed = inHome && inProject

    // If shadowed, emit the home entry first (marked as shadowed)
    if (isShadowed) {
      const homeData = homeHooks[name]
      const homeFields = isPlainObject(homeData) ? (homeData as Record<string, unknown>) : {}
      hooks.push({
        name,
        origin: 'home',
        fields: homeFields,
        sourcePath: computeSourcePath(name, homeData, 'home'),
        shadowed: true,
        usesTarget: extractUsesTarget(homeData),
      })
    }

    // Emit the active entry (project if shadowed, else whichever exists)
    if (inProject) {
      const projectData = projectHooks[name]
      const projectFields = isPlainObject(projectData)
        ? (projectData as Record<string, unknown>)
        : {}
      const hook: ResolvedHook = {
        name,
        origin: 'project',
        fields: projectFields,
        sourcePath: computeSourcePath(name, projectData, 'project'),
        usesTarget: extractUsesTarget(projectData),
      }
      if (!checkFileExists(name, projectData, 'project', projectRoot, homeRoot)) {
        hook.dangling = true
      }
      if (name in localHooks) {
        hook.localOverride = isPlainObject(localHooks[name])
          ? (localHooks[name] as Record<string, unknown>)
          : {}
        hook.localPath = localPath
      }
      hooks.push(hook)
    } else if (inHome) {
      const homeData = homeHooks[name]
      const homeFields = isPlainObject(homeData) ? (homeData as Record<string, unknown>) : {}
      const hook: ResolvedHook = {
        name,
        origin: 'home',
        fields: homeFields,
        sourcePath: computeSourcePath(name, homeData, 'home'),
        usesTarget: extractUsesTarget(homeData),
      }
      if (!checkFileExists(name, homeData, 'home', projectRoot, homeRoot)) {
        hook.dangling = true
      }
      if (name in localHooks) {
        hook.localOverride = isPlainObject(localHooks[name])
          ? (localHooks[name] as Record<string, unknown>)
          : {}
        hook.localPath = localPath
      }
      hooks.push(hook)
    } else if (name in localHooks) {
      // Hook exists only in local config (e.g., local-scoped plugin registration)
      const localData = localHooks[name]
      const localFields = isPlainObject(localData) ? (localData as Record<string, unknown>) : {}
      const hook: ResolvedHook = {
        name,
        origin: 'local',
        fields: localFields,
        sourcePath: computeSourcePath(name, localData, 'project'),
        usesTarget: extractUsesTarget(localData),
      }
      if (!checkFileExists(name, localData, 'project', projectRoot, homeRoot)) {
        hook.dangling = true
      }
      hooks.push(hook)
    }
  }

  // --- events ---
  const events: ResolvedEvent[] = []
  const homeEvents = homeClassified?.events ?? {}
  const projectEvents = projectClassified?.events ?? {}
  const localEvents = localClassified?.events ?? {}

  const allEventKeys = new Set([
    ...Object.keys(homeEvents),
    ...Object.keys(projectEvents),
    ...Object.keys(localEvents),
  ])
  for (const eventName of allEventKeys) {
    const layers: LayerValue[] = []
    const homeEvent = homeEvents[eventName]
    const projectEvent = projectEvents[eventName]
    const localEvent = localEvents[eventName]

    const homeOrder =
      isPlainObject(homeEvent) && Array.isArray((homeEvent as Record<string, unknown>).order)
        ? ((homeEvent as Record<string, unknown>).order as string[])
        : []
    const projectOrder =
      isPlainObject(projectEvent) && Array.isArray((projectEvent as Record<string, unknown>).order)
        ? ((projectEvent as Record<string, unknown>).order as string[])
        : []

    if (homeOrder.length > 0) {
      layers.push({ layer: 'home', value: homeOrder, path: homePath, active: false })
    }
    if (projectOrder.length > 0) {
      layers.push({ layer: 'project', value: projectOrder, path: projectPath, active: false })
    }

    let effectiveOrder: string[]
    if (localEvent !== undefined) {
      const localOrder =
        isPlainObject(localEvent) && Array.isArray((localEvent as Record<string, unknown>).order)
          ? ((localEvent as Record<string, unknown>).order as string[])
          : []
      layers.push({ layer: 'local', value: localOrder, path: localPath, active: true })
      effectiveOrder = localOrder
      // Mark non-local layers as inactive when local override exists
      for (const layer of layers) {
        if (layer.layer !== 'local') layer.active = false
      }
    } else {
      effectiveOrder = [...homeOrder, ...projectOrder]
      // Concatenation: don't mark individual layers as active
      // The merged line will show the combined result
    }

    if (layers.length > 0) {
      events.push({ eventName, effectiveOrder, layers })
    }
  }

  return { fields, hooks, events }
}

function formatValue(val: unknown): string {
  if (typeof val === 'string') return `"${val}"`
  if (Array.isArray(val))
    return `[${val.map((v) => (typeof v === 'string' ? v : String(v))).join(', ')}]`
  return String(val)
}

function formatHumanResolved(resolved: ResolvedOutput): string {
  const lines: string[] = []

  for (const field of resolved.fields) {
    lines.push(`${field.key}: ${formatValue(field.effectiveValue)}`)
    for (const layer of field.layers) {
      const activeTag = layer.active ? '  (active)' : ''
      lines.push(`  [${layer.layer}]    ${formatValue(layer.value)}${activeTag}    ${layer.path}`)
    }
    lines.push('')
  }

  for (const hook of resolved.hooks) {
    const shadowTag = hook.shadowed ? '  (shadowed by project)' : ''
    const danglingTag = hook.dangling ? '  (dangling)' : ''
    lines.push(`hook: ${hook.name}  [${hook.origin}]${shadowTag}${danglingTag}`)

    // Show alias info if this is an aliased hook
    if (hook.usesTarget) {
      lines.push(`  uses: ${hook.usesTarget}`)
      const fileNotFound = hook.dangling ? '  (file not found)' : ''
      lines.push(`  resolved: ${hook.sourcePath}${fileNotFound}`)
    }

    const fields = hook.fields as Record<string, unknown>
    for (const [key, val] of Object.entries(fields)) {
      // Skip 'uses' in fields — already shown above
      if (key === 'uses') continue
      if (key === 'config' && isPlainObject(val)) {
        for (const [ck, cv] of Object.entries(val as Record<string, unknown>)) {
          lines.push(`  config.${ck}: ${formatValue(cv)}`)
        }
      } else {
        lines.push(`  ${key}: ${formatValue(val)}`)
      }
    }
    // Suppress source: line for aliases (resolved: already shows the same path)
    if (!hook.usesTarget) {
      const fileNotFound = hook.dangling ? '  (file not found)' : ''
      lines.push(`  source: ${hook.sourcePath}${fileNotFound}`)
    }

    if (hook.localOverride) {
      lines.push('')
      lines.push(`hook: ${hook.name}  [local override]`)
      for (const [key, val] of Object.entries(hook.localOverride)) {
        if (key === 'config' && isPlainObject(val)) {
          for (const [ck, cv] of Object.entries(val as Record<string, unknown>)) {
            lines.push(`  config.${ck}: ${formatValue(cv)}    ${hook.localPath}`)
          }
        } else {
          lines.push(`  ${key}: ${formatValue(val)}    ${hook.localPath}`)
        }
      }
    }
    lines.push('')
  }

  for (const event of resolved.events) {
    lines.push(`${event.eventName}.order: ${formatValue(event.effectiveOrder)}`)
    const hasLocalOverride = event.layers.some((l) => l.layer === 'local')
    for (const layer of event.layers) {
      let tag = ''
      if (hasLocalOverride) {
        tag = layer.active ? '  (active)' : ''
      }
      lines.push(`  [${layer.layer}]    ${formatValue(layer.value)}${tag}    ${layer.path}`)
    }
    if (!hasLocalOverride && event.layers.length > 1) {
      lines.push(`  merged: ${formatValue(event.effectiveOrder)}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

function buildJsonResolved(resolved: ResolvedOutput): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  // Fields (version, config.*)
  const fieldEntries: Record<string, unknown> = {}
  for (const field of resolved.fields) {
    fieldEntries[field.key] = {
      value: field.effectiveValue,
      layers: field.layers.map((l) => ({
        layer: l.layer,
        value: l.value,
        path: l.path,
        active: l.active,
      })),
    }
  }

  // Split into version and config
  if (fieldEntries.version) {
    result.version = fieldEntries.version
    delete fieldEntries.version
  }

  const configEntries: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(fieldEntries)) {
    if (key.startsWith('config.')) {
      configEntries[key.slice('config.'.length)] = val
    }
  }
  if (Object.keys(configEntries).length > 0) {
    result.config = configEntries
  }

  // Hooks — use an array to support multiple entries for the same name (shadow case)
  const hooksArr: Record<string, unknown>[] = []
  for (const hook of resolved.hooks) {
    const hookData: Record<string, unknown> = {
      name: hook.name,
      origin: hook.origin,
      fields: hook.fields,
      source: hook.sourcePath,
    }
    if (hook.usesTarget) {
      hookData.uses = hook.usesTarget
      hookData.resolved = hook.sourcePath
    }
    if (hook.shadowed) {
      hookData.shadowed = true
    }
    if (hook.localOverride) {
      hookData.localOverride = hook.localOverride
      hookData.localPath = hook.localPath
    }
    if (hook.dangling) {
      hookData.dangling = true
      hookData.status = 'dangling'
    }
    hooksArr.push(hookData)
  }
  // Also build a keyed object for backward compat (active entries only)
  const hooksObj: Record<string, unknown> = {}
  for (const hook of resolved.hooks) {
    if (hook.shadowed) continue
    const hookData: Record<string, unknown> = {
      origin: hook.origin,
      fields: hook.fields,
      source: hook.sourcePath,
    }
    if (hook.usesTarget) {
      hookData.uses = hook.usesTarget
      hookData.resolved = hook.sourcePath
    }
    if (hook.localOverride) {
      hookData.localOverride = hook.localOverride
      hookData.localPath = hook.localPath
    }
    if (hook.dangling) {
      hookData.dangling = true
      hookData.status = 'dangling'
    }
    hooksObj[hook.name] = hookData
  }
  result.hooks = hooksObj
  result.hookDetails = hooksArr

  // Events
  const eventsObj: Record<string, unknown> = {}
  for (const event of resolved.events) {
    eventsObj[event.eventName] = {
      order: event.effectiveOrder,
      layers: event.layers.map((l) => ({
        layer: l.layer,
        value: l.value,
        path: l.path,
        active: l.active,
      })),
    }
  }
  result.events = eventsObj

  return result
}

export function createConfigCommand(loadConfig: LoadConfigFn = defaultLoadConfig): Command {
  return new Command('config')
    .description('Show resolved clooks configuration')
    .option('--resolved', 'Show fully merged config with provenance annotations')
    .action(async (opts: { resolved?: boolean }, cmd: Command) => {
      const ctx = getCtx(cmd)
      const projectRoot = process.cwd()
      const homeRoot = process.env.CLOOKS_HOME_ROOT ?? homedir()

      try {
        // --- Resolved mode ---
        if (opts.resolved) {
          const resolved = await buildResolved(projectRoot, homeRoot)

          if (resolved === null) {
            printError(ctx, 'config', 'No clooks.yml found. Run `clooks init` to get started.')
            process.exit(1)
            return
          }

          if (ctx.json) {
            process.stdout.write(jsonSuccess('config', buildJsonResolved(resolved)) + '\n')
            return
          }

          printIntro(ctx, 'clooks config --resolved')
          const output = formatHumanResolved(resolved)
          process.stdout.write(output + '\n')
          printOutro(ctx, 'Done')
          return
        }

        // --- Default mode ---
        const result = await loadConfig(projectRoot, { homeRoot })

        if (result === null) {
          printError(ctx, 'config', 'No clooks.yml found. Run `clooks init` to get started.')
          process.exit(1)
          return // unreachable in production, but needed when process.exit is mocked in tests
        }

        const config = result.config
        const hookCount = Object.keys(config.hooks).length

        if (ctx.json) {
          process.stdout.write(
            jsonSuccess('config', {
              version: config.version,
              hooks: hookCount,
              timeout: config.global.timeout,
              onError: config.global.onError,
              maxFailures: config.global.maxFailures,
            }) + '\n',
          )
          return
        }

        printIntro(ctx, 'clooks config')
        printSuccess(ctx, `Config loaded from .clooks/clooks.yml`)
        printInfo(ctx, `Hooks: ${hookCount} registered`)
        printInfo(ctx, `Timeout: ${config.global.timeout}ms`)
        printInfo(ctx, `onError: ${config.global.onError}`)
        printInfo(ctx, `maxFailures: ${config.global.maxFailures}`)
        printOutro(ctx, 'Done')
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        printError(ctx, 'config', message)
        process.exit(1)
      }
    })
}
