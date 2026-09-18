import { lstatSync, readFileSync, readdirSync, realpathSync } from 'fs'
import { isAbsolute, join, relative, sep } from 'path'
import type { ContextHelpers, Provider } from './types/contexts.js'

export interface PluginFileSystem {
  readText(path: string): string
  readDirectory(path: string): string[]
  realpath(path: string): string
  lstat(path: string): { isDirectory(): boolean; isFile(): boolean }
}

export interface CreateContextHelpersOptions {
  provider: Provider
  homeRoot: string
  codexHome?: string
  cwd: string
}

const defaultFileSystem: PluginFileSystem = {
  readText: (path) => readFileSync(path, 'utf8'),
  readDirectory: (path) => readdirSync(path),
  realpath: realpathSync,
  lstat: lstatSync,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasDotDot(path: string): boolean {
  return path.split(sep).includes('..')
}

function validAbsolutePath(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    path.length > 0 &&
    !path.includes('\0') &&
    isAbsolute(path) &&
    !hasDotDot(path)
  )
}

function directoryNames(path: string, fs: PluginFileSystem): string[] {
  try {
    return fs.readDirectory(path)
  } catch {
    return []
  }
}

function isDirectory(path: string, fs: PluginFileSystem): boolean {
  try {
    return fs.lstat(path).isDirectory()
  } catch {
    return false
  }
}

function hasOrphanMarker(root: string, fs: PluginFileSystem): boolean | undefined {
  try {
    fs.lstat(join(root, '.orphaned_at'))
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? false : undefined
  }
}

function discoverClaudeRoots(homeRoot: string, fs: PluginFileSystem): string[] {
  if (!validAbsolutePath(homeRoot)) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readText(join(homeRoot, '.claude', 'plugins', 'installed_plugins.json')))
  } catch {
    return []
  }
  if (!isRecord(parsed) || !isRecord(parsed.plugins)) return []

  const roots: string[] = []
  for (const entries of Object.values(parsed.plugins)) {
    if (!Array.isArray(entries)) continue
    for (const entry of entries) {
      if (!isRecord(entry) || !validAbsolutePath(entry.installPath)) continue
      const orphaned = hasOrphanMarker(entry.installPath, fs)
      if (orphaned !== false) continue
      roots.push(entry.installPath)
    }
  }
  return roots
}

function discoverCodexRoots(
  homeRoot: string,
  codexHome: string | undefined,
  fs: PluginFileSystem,
): string[] {
  if (!codexHome && !validAbsolutePath(homeRoot)) return []
  const effectiveHome = codexHome || join(homeRoot, '.codex')
  if (!validAbsolutePath(effectiveHome)) return []
  const cache = join(effectiveHome, 'plugins', 'cache')
  const roots: string[] = []

  for (const marketplace of directoryNames(cache, fs)) {
    const marketplacePath = join(cache, marketplace)
    if (!isDirectory(marketplacePath, fs)) continue
    for (const plugin of directoryNames(marketplacePath, fs)) {
      const pluginPath = join(marketplacePath, plugin)
      if (!isDirectory(pluginPath, fs)) continue
      for (const version of directoryNames(pluginPath, fs)) {
        const installPath = join(pluginPath, version)
        if (!isDirectory(installPath, fs)) continue
        let manifest: unknown
        try {
          manifest = JSON.parse(fs.readText(join(installPath, '.codex-plugin', 'plugin.json')))
        } catch {
          continue
        }
        if (isRecord(manifest) && manifest.name === plugin) roots.push(installPath)
      }
    }
  }
  return roots
}

function canonicalRoots(rawRoots: readonly string[], fs: PluginFileSystem): readonly string[] {
  const roots: string[] = []
  const seen = new Set<string>()
  for (const rawRoot of rawRoots) {
    if (!validAbsolutePath(rawRoot)) continue
    try {
      const physical = fs.realpath(rawRoot)
      if (!validAbsolutePath(physical) || !fs.lstat(physical).isDirectory()) continue
      if (seen.has(physical)) continue
      seen.add(physical)
      roots.push(physical)
    } catch {
      // Installed state is advisory; uncertain roots are not members.
    }
  }
  return Object.freeze(roots)
}

function isContainedFile(path: string, roots: readonly string[], fs: PluginFileSystem): boolean {
  try {
    const physical = fs.realpath(path)
    if (!fs.lstat(physical).isFile()) return false
    return roots.some((root) => {
      const child = relative(root, physical)
      return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)
    })
  } catch {
    return false
  }
}

/**
 * Builds immutable helpers for one engine invocation. Installed roots are read
 * on first use and reused; candidate filesystem state is checked on every call.
 */
export function createContextHelpers(
  options: CreateContextHelpersOptions,
  fs: PluginFileSystem = defaultFileSystem,
): Readonly<ContextHelpers> {
  let roots: readonly string[] | undefined
  const installedRoots = (): readonly string[] => {
    if (roots !== undefined) return roots
    const discovered =
      options.provider === 'claude-code'
        ? discoverClaudeRoots(options.homeRoot, fs)
        : discoverCodexRoots(options.homeRoot, options.codexHome, fs)
    roots = canonicalRoots(discovered, fs)
    return roots
  }

  return Object.freeze({
    belongsToPlugin(path: string): boolean {
      if (typeof path !== 'string' || path.length === 0 || path.includes('\0')) return false
      let candidate = path
      if (!isAbsolute(candidate)) {
        if (!validAbsolutePath(options.cwd)) return false
        candidate = `${options.cwd.endsWith(sep) ? options.cwd : `${options.cwd}${sep}`}${candidate}`
      }
      if (!validAbsolutePath(candidate)) return false
      return isContainedFile(candidate, installedRoots(), fs)
    },
  })
}
