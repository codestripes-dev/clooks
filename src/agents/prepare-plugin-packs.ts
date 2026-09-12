import type { DiscoveredPack } from '../plugin-discovery.js'
import type { vendorAndRegisterPack } from '../plugin-vendor.js'
import type { PrepareConfigAfterLoadInput, PrepareConfigAfterLoadResult } from './types.js'

export async function preparePluginPacks(
  input: Pick<
    PrepareConfigAfterLoadInput,
    'config' | 'shadows' | 'hasProjectConfig' | 'projectRoot' | 'homeRoot' | 'loadConfig'
  >,
  packs: DiscoveredPack[],
  vendor: typeof vendorAndRegisterPack,
): Promise<PrepareConfigAfterLoadResult> {
  let config = input.config
  let shadows = input.shadows
  let hasProjectConfig = input.hasProjectConfig
  const systemMessages: string[] = []

  if (packs.length === 0) {
    return { config, shadows, hasProjectConfig, systemMessages }
  }

  let needsReload = false
  for (const pack of packs) {
    const vendorResult = await vendor(pack, input.projectRoot, input.homeRoot)

    if (vendorResult.registered.length > 0) {
      needsReload = true
      const enabledHooks = vendorResult.registered.filter(
        (h) => !vendorResult.disabledHooks.includes(h),
      )
      const disabledHooks = vendorResult.disabledHooks
      let msg = `clooks: Registered ${vendorResult.registered.length} hook(s) from ${pack.manifest.name} (plugin)`
      if (disabledHooks.length > 0 && enabledHooks.length > 0) {
        msg += `: ${enabledHooks.join(', ')} (enabled); ${disabledHooks.join(', ')} (disabled -- enable in clooks.yml)`
      } else if (disabledHooks.length > 0) {
        msg += `: ${disabledHooks.join(', ')} (disabled -- enable in clooks.yml)`
      }
      systemMessages.push(msg)
    }

    for (const collision of vendorResult.collisions) {
      systemMessages.push(`clooks: ${collision}`)
    }

    for (const error of vendorResult.errors) {
      systemMessages.push(`clooks: ${error}`)
    }
  }

  if (needsReload) {
    try {
      const reloaded = await input.loadConfig(input.projectRoot, { homeRoot: input.homeRoot })
      if (reloaded !== null) {
        config = reloaded.config
        shadows = reloaded.shadows
        hasProjectConfig = reloaded.hasProjectConfig
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      systemMessages.push(`clooks: Config reload after plugin registration failed: ${msg}`)
    }
  }

  return { config, shadows, hasProjectConfig, systemMessages }
}
