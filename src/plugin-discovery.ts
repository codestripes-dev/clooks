import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { loadManifestFromFile } from './manifest.js'
import type { Manifest } from './manifest.js'

export interface DiscoveredPack {
  pluginName: string
  scope: 'user' | 'project' | 'local'
  installPath: string
  manifest: Manifest
}

interface InstalledPluginEntry {
  scope: string
  installPath: string
  version?: string
  installedAt?: string
  lastUpdated?: string
  gitCommitSha?: string
}

interface InstalledPluginsFile {
  version: number
  plugins: Record<string, InstalledPluginEntry[]>
}

export function discoverPluginPacks(installedPluginsPath?: string): DiscoveredPack[] {
  const resolvedPath =
    installedPluginsPath ?? join(homedir(), '.claude', 'plugins', 'installed_plugins.json')

  if (!existsSync(resolvedPath)) {
    return []
  }

  let parsed: InstalledPluginsFile
  try {
    const raw = JSON.parse(readFileSync(resolvedPath, 'utf-8'))
    parsed = raw as InstalledPluginsFile
  } catch (err) {
    console.warn(`[clooks] Failed to parse installed_plugins.json: ${err}`)
    return []
  }

  if (!parsed.plugins || typeof parsed.plugins !== 'object') {
    console.warn('[clooks] installed_plugins.json has unexpected structure (missing "plugins" key)')
    return []
  }

  const discovered: DiscoveredPack[] = []

  for (const [pluginKey, entries] of Object.entries(parsed.plugins)) {
    if (!Array.isArray(entries)) {
      console.warn(`[clooks] Plugin "${pluginKey}" has non-array entries, skipping`)
      continue
    }

    for (const entry of entries) {
      if (entry.scope === 'managed') {
        continue
      }

      const validScopes = new Set(['user', 'project', 'local'])
      if (!validScopes.has(entry.scope)) {
        console.warn(`[clooks] Plugin "${pluginKey}" has unknown scope "${entry.scope}", skipping`)
        continue
      }

      if (!entry.installPath || !existsSync(entry.installPath)) {
        continue
      }

      if (existsSync(join(entry.installPath, '.orphaned_at'))) {
        continue
      }

      const manifestPath = join(entry.installPath, 'clooks-pack.json')
      if (!existsSync(manifestPath)) {
        continue
      }

      try {
        const manifest = loadManifestFromFile(manifestPath)
        discovered.push({
          pluginName: pluginKey,
          scope: entry.scope as 'user' | 'project' | 'local',
          installPath: entry.installPath,
          manifest,
        })
      } catch (err) {
        console.warn(
          `[clooks] Failed to load manifest for plugin "${pluginKey}" at ${entry.installPath}: ${err}`,
        )
      }
    }
  }

  return discovered
}
