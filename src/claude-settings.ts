import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { classifyConfigKeys } from './config/classify.js'
import type { DiscoveredPack } from './plugin-discovery.js'
import { resolveCodexHome } from './agents/codex/settings.js'

export type ClaudeSettingsScope = 'managed' | 'user' | 'project' | 'local'

export interface SettingsLayerPaths {
  managed?: string
  user: string
  project?: string
  local?: string
}

export interface EnabledPluginsByLayer {
  managed: Record<string, boolean>
  user: Record<string, boolean>
  project: Record<string, boolean>
  local: Record<string, boolean>
}

export interface InstalledPluginEntry {
  scope: 'user' | 'project' | 'local' | 'managed'
  installPath: string
  projectPath?: string
  version?: string
  installedAt?: string
  lastUpdated?: string
  gitCommitSha?: string
}

export interface InstalledPluginsFile {
  version: number
  plugins: Record<string, InstalledPluginEntry[]>
}

interface SettingsFileShape {
  enabledPlugins?: unknown
}

export function defaultSettingsPaths(homeRoot: string, projectRoot: string): SettingsLayerPaths {
  return {
    user: join(homeRoot, '.claude', 'settings.json'),
    project: join(projectRoot, '.claude', 'settings.json'),
    local: join(projectRoot, '.claude', 'settings.local.json'),
  }
}

function readEnabledLayer(path: string | undefined): Record<string, boolean> {
  if (!path || !existsSync(path)) return {}
  let parsed: SettingsFileShape
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8')) as SettingsFileShape
  } catch (err) {
    console.warn(`[clooks] Failed to parse Claude settings at ${path}: ${err}`)
    return {}
  }
  const raw = parsed?.enabledPlugins
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {}
  }
  const out: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'boolean') {
      console.warn(`[clooks] Ignoring non-boolean enabledPlugins value for "${key}" in ${path}`)
      continue
    }
    out[key] = value
  }
  return out
}

export function readEnabledPlugins(paths: SettingsLayerPaths): EnabledPluginsByLayer {
  return {
    managed: readEnabledLayer(paths.managed),
    user: readEnabledLayer(paths.user),
    project: readEnabledLayer(paths.project),
    local: readEnabledLayer(paths.local),
  }
}

export function activationsByLayer(
  layers: EnabledPluginsByLayer,
): Record<ClaudeSettingsScope, string[]> {
  const pick = (layer: Record<string, boolean>): string[] =>
    Object.entries(layer)
      .filter(([, v]) => v === true)
      .map(([k]) => k)
  return {
    managed: pick(layers.managed),
    user: pick(layers.user),
    project: pick(layers.project),
    local: pick(layers.local),
  }
}

export function readInstalledPlugins(path: string): InstalledPluginsFile | null {
  if (!existsSync(path)) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8'))
  } catch (err) {
    console.warn(`[clooks] Failed to parse installed_plugins.json at ${path}: ${err}`)
    return null
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('plugins' in parsed) ||
    typeof (parsed as { plugins: unknown }).plugins !== 'object' ||
    (parsed as { plugins: unknown }).plugins === null
  ) {
    console.warn(
      `[clooks] installed_plugins.json at ${path} has unexpected structure (missing "plugins" key)`,
    )
    return null
  }
  return parsed as InstalledPluginsFile
}

export function lookupInstallPath(
  file: InstalledPluginsFile,
  pluginKey: string,
): { installPath: string; entry: InstalledPluginEntry } | undefined {
  const entries = file.plugins?.[pluginKey]
  if (!Array.isArray(entries)) return undefined
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue
    if (entry.scope === 'managed') continue
    if (!entry.installPath || !existsSync(entry.installPath)) continue
    if (existsSync(join(entry.installPath, '.orphaned_at'))) continue
    // No projectPath filter: activation is governed by Claude settings layer, not by
    // which project the install record happens to reference (Decision Log entries 1 & 8).
    return { installPath: entry.installPath, entry }
  }
  return undefined
}

export interface VendoredHookEntry {
  hookName: string
  packName: string
  usesPath: string
}

export interface StaleAdvisory {
  kind: 'stale-registration' | 'enable-without-install'
  scope: 'user' | 'project' | 'local'
  pluginKey: string
  hookName?: string
  vendorPackDir?: string
}

const VENDOR_USES_PATTERN =
  /^\.\/\.clooks\/vendor\/plugin\/([a-z][a-z0-9._-]*)\/([a-z][a-z0-9._-]*)\.[a-z0-9]+$/

/**
 * Read the plugin-vendored hook entries from a single clooks yml file.
 *
 * Non-vendored entries (hand-written hooks, custom uses paths) are skipped.
 * Malformed yml / missing files return an empty list.
 */
export function readVendoredPluginEntries(ymlPath: string): VendoredHookEntry[] {
  if (!existsSync(ymlPath)) return []
  let raw: unknown
  try {
    const text = readFileSync(ymlPath, 'utf-8')
    raw = Bun.YAML.parse(text)
  } catch (err) {
    console.warn(`[clooks] Failed to parse clooks.yml at ${ymlPath} for stale detection: ${err}`)
    return []
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return []
  const { hooks } = classifyConfigKeys(raw as Record<string, unknown>)
  const out: VendoredHookEntry[] = []
  for (const [hookName, entry] of Object.entries(hooks)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const uses = (entry as Record<string, unknown>).uses
    if (typeof uses !== 'string') continue
    const match = VENDOR_USES_PATTERN.exec(uses)
    if (!match) continue
    const packName = match[1]!
    out.push({ hookName, packName, usesPath: uses })
  }
  return out
}

/**
 * True if any install entry for `pluginKey` has a reachable `clooks-pack.json`.
 * Used to gate the `enable-without-install` advisory so it only fires for
 * plugins clooks can identify as its own.
 */
function hasClooksPackJson(file: InstalledPluginsFile, pluginKey: string): boolean {
  const entries = file.plugins?.[pluginKey]
  if (!Array.isArray(entries)) return false
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue
    if (!entry.installPath) continue
    if (!existsSync(entry.installPath)) continue
    if (existsSync(join(entry.installPath, 'clooks-pack.json'))) return true
  }
  return false
}

/**
 * Build a map of manifest.name → pluginKey by reading clooks-pack.json
 * for each installed plugin entry. Plugins whose install records lack a
 * clooks-pack.json are omitted (they cannot produce vendored entries).
 */
function buildPackNameToPluginKeys(
  file: InstalledPluginsFile | null,
  layers: EnabledPluginsByLayer,
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  const add = (name: string, key: string) => {
    const keys = out.get(name) ?? new Set<string>()
    keys.add(key)
    out.set(name, keys)
  }
  const identified = new Set<string>()
  for (const [pluginKey, entries] of Object.entries(file?.plugins ?? {})) {
    if (!Array.isArray(entries)) continue
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue
      if (!entry.installPath) continue
      const manifestPath = join(entry.installPath, 'clooks-pack.json')
      if (!existsSync(manifestPath)) continue
      let manifest: unknown
      try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
      } catch {
        continue
      }
      if (!manifest || typeof manifest !== 'object') continue
      const name = (manifest as { name?: unknown }).name
      if (typeof name !== 'string') continue
      add(name, pluginKey)
      identified.add(pluginKey)
      break
    }
  }
  // When the manifest is gone, a matching persisted plugin identity still identifies a pack.
  // A vendor directory alone never establishes Claude ownership.
  const keys = new Set([
    ...Object.keys(file?.plugins ?? {}),
    ...Object.keys(layers.user),
    ...Object.keys(layers.project),
    ...Object.keys(layers.local),
  ])
  for (const key of keys) {
    if (identified.has(key)) continue
    const parts = key.split('@')
    if (parts.length === 2 && parts[0] && parts[1]) add(parts[0], key)
  }
  return out
}

function sameVendorDestination(
  packName: string,
  activationScope: 'user' | 'project' | 'local',
  scope: 'user' | 'project' | 'local',
  roots?: { homeRoot: string; projectRoot: string },
): boolean {
  // Project and local always share storage, independent of their settings layers.
  if ((activationScope === 'user') === (scope === 'user')) return true
  if (!roots) return false
  if (roots.homeRoot === roots.projectRoot) return true
  const destination = (selected: 'user' | 'project' | 'local') =>
    resolveCodexHome(roots.homeRoot, {
      CODEX_HOME: join(
        selected === 'user' ? roots.homeRoot : roots.projectRoot,
        '.clooks/vendor/plugin',
        packName,
      ),
    })
  try {
    return destination(activationScope) === destination(scope)
  } catch {
    return false
  }
}

export function detectStaleAdvisories(opts: {
  installedPluginsFile: InstalledPluginsFile | null
  layers: EnabledPluginsByLayer
  codexPacks?: readonly DiscoveredPack[]
  discoverCodexPacks?: () => readonly DiscoveredPack[]
  roots?: { homeRoot: string; projectRoot: string }
  clooksYmlReaders: {
    user: () => VendoredHookEntry[]
    project: () => VendoredHookEntry[]
    local: () => VendoredHookEntry[]
  }
}): StaleAdvisory[] {
  // Env-var silencer — checked at the top so all drift-detection work is
  // skipped when the user has explicitly opted out. Kept inside the detector
  // (rather than at the caller) so silencer semantics are co-located with the
  // detection logic and the unit tests assert the contract directly.
  if (process.env.CLOOKS_SILENCE_STALE_PLUGIN_ADVISORIES === 'true') {
    return []
  }
  const { installedPluginsFile, layers, clooksYmlReaders } = opts
  const packNameToPluginKeys = buildPackNameToPluginKeys(installedPluginsFile, layers)
  const advisories: StaleAdvisory[] = []
  const scopes: Array<'user' | 'project' | 'local'> = ['user', 'project', 'local']
  let codexPacks = opts.codexPacks

  for (const scope of scopes) {
    // Drift case A: stale-registration.
    const entries = clooksYmlReaders[scope]()
    for (const entry of entries) {
      const pluginKeys = packNameToPluginKeys.get(entry.packName)
      if (!pluginKeys) continue
      const enabledAtScope = [...pluginKeys].some((key) => layers[scope][key] === true)
      if (enabledAtScope) continue
      const enabledAtDestination = scopes.some(
        (activationScope) =>
          [...pluginKeys].some((key) => layers[activationScope][key] === true) &&
          sameVendorDestination(entry.packName, activationScope, scope, opts.roots),
      )
      if (enabledAtDestination) continue
      codexPacks ??= opts.discoverCodexPacks?.() ?? []
      if (
        codexPacks.some(
          (pack) =>
            pack.manifest.name === entry.packName &&
            sameVendorDestination(entry.packName, pack.scope, scope, opts.roots),
        )
      )
        continue
      advisories.push({
        kind: 'stale-registration',
        scope,
        pluginKey: [...pluginKeys].sort()[0]!,
        hookName: entry.hookName,
        vendorPackDir: `./.clooks/vendor/plugin/${entry.packName}/`,
      })
    }

    // Drift case B: enable-without-install. Gated on hasClooksPackJson so
    // non-clooks Claude plugins cannot produce noise.
    for (const [pluginKey, value] of Object.entries(layers[scope])) {
      if (value !== true) continue
      if (!installedPluginsFile) continue
      if (!hasClooksPackJson(installedPluginsFile, pluginKey)) continue
      const lookup = lookupInstallPath(installedPluginsFile, pluginKey)
      if (!lookup) {
        advisories.push({
          kind: 'enable-without-install',
          scope,
          pluginKey,
        })
      }
    }
  }

  return advisories
}
