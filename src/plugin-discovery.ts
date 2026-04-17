import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { loadManifestFromFile } from './manifest.js'
import type { Manifest } from './manifest.js'
import {
  activationsByLayer,
  defaultSettingsPaths,
  lookupInstallPath,
  readEnabledPlugins,
  readInstalledPlugins,
} from './claude-settings.js'
import type { SettingsLayerPaths } from './claude-settings.js'

export interface DiscoveredPack {
  pluginName: string
  scope: 'user' | 'project' | 'local'
  installPath: string
  manifest: Manifest
}

export interface DiscoverOptions {
  installedPluginsPath?: string
  settingsPaths?: SettingsLayerPaths
  homeRoot?: string
  projectRoot?: string
}

// Settings-driven discovery: iterate Claude settings layers, not install records.
// Install-record scope is metadata only; the activation layer determines the clooks scope.
export function discoverPluginPacks(opts?: DiscoverOptions): DiscoveredPack[] {
  const homeRoot = opts?.homeRoot ?? homedir()
  const projectRoot = opts?.projectRoot ?? process.cwd()
  const installedPluginsPath =
    opts?.installedPluginsPath ?? join(homeRoot, '.claude', 'plugins', 'installed_plugins.json')
  const settingsPaths = opts?.settingsPaths ?? defaultSettingsPaths(homeRoot, projectRoot)

  const installed = readInstalledPlugins(installedPluginsPath)
  if (!installed) {
    return []
  }

  const layers = readEnabledPlugins(settingsPaths)
  const activations = activationsByLayer(layers)

  const discovered: DiscoveredPack[] = []
  // Deterministic order: user → project → local. Managed is skipped entirely.
  const scopes: Array<'user' | 'project' | 'local'> = ['user', 'project', 'local']

  for (const scope of scopes) {
    for (const pluginKey of activations[scope]) {
      const lookup = lookupInstallPath(installed, pluginKey)
      if (!lookup) continue

      const manifestPath = join(lookup.installPath, 'clooks-pack.json')
      if (!existsSync(manifestPath)) continue

      try {
        const manifest = loadManifestFromFile(manifestPath)
        discovered.push({
          pluginName: pluginKey,
          scope,
          installPath: lookup.installPath,
          manifest,
        })
      } catch (err) {
        console.warn(
          `[clooks] Failed to load manifest for plugin "${pluginKey}" at ${lookup.installPath}: ${err}`,
        )
      }
    }
  }

  return discovered
}
