import { lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'fs'
import { dirname, join } from 'path'
import { parse } from 'semver'
import { loadManifestFromFile } from '../../manifest.js'
import type { DiscoveredPack } from '../../plugin-discovery.js'
import { resolveCodexHome } from './settings.js'

export interface DiscoverCodexOptions {
  homeRoot: string
  projectRoot: string
  codexHome?: string
}

type Table = Record<string, unknown>
type Scope = 'user' | 'project'

function table(value: unknown): value is Table {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function absent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

function readConfig(path: string): Table {
  let content: string
  try {
    content = readFileSync(path, 'utf8')
  } catch (error) {
    if (absent(error)) return {}
    throw new Error(`${path}: ${error}`, { cause: error })
  }
  try {
    const config = Bun.TOML.parse(content) as Table
    for (const key of ['plugins', 'features']) {
      if (key in config && !table(config[key])) throw new Error(`${key} must be a table`)
    }
    const plugins = (config.plugins ?? {}) as Table
    for (const [name, value] of Object.entries(plugins)) {
      if (!table(value)) throw new Error(`plugins.${name} must be a table`)
      if ('enabled' in value && typeof value.enabled !== 'boolean') {
        throw new Error(`plugins.${name}.enabled must be a boolean`)
      }
    }
    const features = (config.features ?? {}) as Table
    if ('plugins' in features && typeof features.plugins !== 'boolean') {
      throw new Error('features.plugins must be a boolean')
    }
    if (
      'project_root_markers' in config &&
      (!Array.isArray(config.project_root_markers) ||
        !config.project_root_markers.every((marker) => typeof marker === 'string'))
    ) {
      throw new Error('project_root_markers must be a string array')
    }
    return config
  } catch (error) {
    throw new Error(`${path}: ${error}`, { cause: error })
  }
}

function hasMarker(root: string, marker: string): boolean {
  const path = join(root, marker)
  try {
    const entry = statSync(path)
    return (
      marker !== '.git' ||
      entry.isFile() ||
      (entry.isDirectory() && statSync(join(path, 'HEAD')).isFile())
    )
  } catch (error) {
    if (absent(error)) return false
    throw new Error(`${path}: ${error}`, { cause: error })
  }
}

function projectLayers(anchor: string, markers: string[]): string[] {
  const roots: string[] = []
  let current = anchor
  while (true) {
    roots.push(current)
    if (markers.some((marker) => hasMarker(current, marker))) return roots.reverse()
    const parent = dirname(current)
    if (parent === current || markers.length === 0) return [anchor]
    current = parent
  }
}

function safeIdentity(segments: string[]): segments is [string, string] {
  if (segments.length !== 2) return false
  const [plugin, marketplace] = segments as [string, string]
  return (
    /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(plugin) && /^[A-Za-z0-9_-]+$/.test(marketplace)
  )
}

function order<T extends string | number | bigint>(left: T, right: T): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function nativeVersion(value: string) {
  // Delegate suffix grammar to semver; adapt only Rust's u64 core and exact numeric ordering.
  // Cache segments fit the filesystem's 255-byte limit, below npm's 256-character limit.
  const core = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(.*)$/.exec(value)
  if (!core) return null
  const numbers = core.slice(1, 4).map((part) => BigInt(part))
  if (numbers.some((part) => part > 18446744073709551615n)) return null
  const suffix = parse(`0.0.0${core[4]}`)
  return suffix ? { numbers, pre: suffix.prerelease.map(String), build: suffix.build } : null
}

function compareIdentifiers(left: readonly string[], right: readonly string[]): number {
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const a = left[i]!
    const b = right[i]!
    const aNumeric = /^[0-9]+$/.test(a)
    const bNumeric = /^[0-9]+$/.test(b)
    let comparison: number
    if (aNumeric && bNumeric) {
      // Rust orders equal numeric build values by original width: 1 < 01 < 001 < 2.
      const significantA = a.replace(/^0+/, '')
      const significantB = b.replace(/^0+/, '')
      comparison =
        order(significantA.length, significantB.length) ||
        order(significantA, significantB) ||
        order(a.length, b.length)
    } else {
      comparison = aNumeric !== bNumeric ? (aNumeric ? -1 : 1) : order(a, b)
    }
    if (comparison) return comparison
  }
  return order(left.length, right.length)
}

function compareVersions(left: string, right: string): number {
  const a = nativeVersion(left)
  const b = nativeVersion(right)
  if (!a || !b) return order(left, right)
  for (let i = 0; i < 3; i++) {
    const comparison = order(a.numbers[i]!, b.numbers[i]!)
    if (comparison) return comparison
  }
  const pre =
    a.pre.length === 0 || b.pre.length === 0
      ? order(Number(b.pre.length > 0), Number(a.pre.length > 0))
      : compareIdentifiers(a.pre, b.pre)
  return pre || compareIdentifiers(a.build, b.build)
}

function physicalConfig(path: string): string {
  try {
    return realpathSync(path)
  } catch (error) {
    if (absent(error)) return path
    throw new Error(`${path}: ${error}`, { cause: error })
  }
}

function selectedVersion(base: string): string | undefined {
  try {
    if (!lstatSync(dirname(base)).isDirectory() || !lstatSync(base).isDirectory()) return undefined
    const versions = readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^[A-Za-z0-9.+_-]+$/.test(entry.name))
      .map((entry) => entry.name)
      .sort()
    if (versions.includes('local')) return 'local'
    return versions.sort(compareVersions).at(-1)
  } catch (error) {
    if (!absent(error)) console.warn(`[clooks] Failed to read Codex plugin cache ${base}: ${error}`)
    return undefined
  }
}

export function discoverCodexPluginPacks(options: DiscoverCodexOptions): DiscoveredPack[] {
  let codexHome: string
  const activations = new Map<string, { enabled: boolean; scope: Scope }>()
  let pluginsEnabled = true
  try {
    codexHome = resolveCodexHome(options.homeRoot, { CODEX_HOME: options.codexHome })
    const projectRoot = resolveCodexHome(options.homeRoot, { CODEX_HOME: options.projectRoot })
    const userPath = physicalConfig(join(codexHome, 'config.toml'))
    const user = readConfig(userPath)
    const layers: Array<{ config: Table; scope: Scope }> = [{ config: user, scope: 'user' }]
    const markers = (user.project_root_markers ?? ['.git']) as string[]
    for (const root of projectLayers(projectRoot, markers)) {
      const path = join(root, '.codex/config.toml')
      if (physicalConfig(path) === userPath) continue
      layers.push({ config: readConfig(path), scope: 'project' })
    }
    for (const { config, scope } of layers) {
      const features = config.features as Table | undefined
      if (features && 'plugins' in features) pluginsEnabled = features.plugins as boolean
      for (const [name, value] of Object.entries((config.plugins ?? {}) as Table)) {
        const plugin = value as Table
        if ('enabled' in plugin || !activations.has(name)) {
          activations.set(name, { enabled: (plugin.enabled ?? true) as boolean, scope })
        }
      }
    }
  } catch (error) {
    console.warn(`[clooks] Codex plugin discovery suppressed: ${error}`)
    return []
  }
  if (!pluginsEnabled) return []

  const discovered: DiscoveredPack[] = []
  for (const [pluginName, activation] of [...activations].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    if (!activation.enabled) continue
    const segments = pluginName.split('@')
    if (!safeIdentity(segments)) continue
    const [plugin, marketplace] = segments
    const base = join(codexHome, 'plugins/cache', marketplace, plugin)
    const version = selectedVersion(base)
    if (!version) continue
    const installPath = join(base, version)
    try {
      const manifest = loadManifestFromFile(join(installPath, 'clooks-pack.json'))
      discovered.push({ pluginName, scope: activation.scope, installPath, manifest })
    } catch (error) {
      if (!absent(error))
        console.warn(`[clooks] Failed to load Codex plugin manifest at ${installPath}: ${error}`)
    }
  }
  return discovered
}
