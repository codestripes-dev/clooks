import { Command } from 'commander'
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'fs'
import { join, extname, dirname } from 'path'
import { getCtx } from '../tui/context.js'
import { jsonSuccess, jsonError } from '../tui/json-envelope.js'
import {
  printIntro,
  printSuccess,
  printWarning,
  printError,
  printOutro,
  printInfo,
} from '../tui/output.js'
import { getHomeDir } from '../platform.js'
import { getGitRoot } from '../git.js'
import { discoverPluginPacks } from '../plugin-discovery.js'
import { validateHookExport } from '../loader.js'
import type { DiscoveredPack, DiscoverOptions } from '../plugin-discovery.js'

const SAFE_NAME_PATTERN = /^[a-z][a-z0-9._-]*$/

export interface UpdateResult {
  updated: string[] // hooks whose vendor files were overwritten
  registered: string[] // new hooks that were registered in config
  skipped: string[] // new hooks skipped due to collision
  errors: string[] // copy/validation failures
}

export async function updatePluginPack(
  packName: string,
  projectRoot: string,
  homeRoot: string,
  discoverFn: (opts?: DiscoverOptions) => DiscoveredPack[] = discoverPluginPacks,
): Promise<UpdateResult> {
  const result: UpdateResult = {
    updated: [],
    registered: [],
    skipped: [],
    errors: [],
  }

  // Validate pack name
  if (!SAFE_NAME_PATTERN.test(packName)) {
    result.errors.push(`pack name "${packName}" contains unsafe characters`)
    return result
  }

  // Discover installed packs matching the name
  const allPacks = discoverFn({ homeRoot, projectRoot })
  const matchingPacks = allPacks.filter((p) => p.manifest.name === packName)

  if (matchingPacks.length === 0) {
    result.errors.push(`No installed plugin found with pack name "${packName}"`)
    return result
  }

  for (const pack of matchingPacks) {
    // Determine scope root and config path
    let scopeRoot: string
    let configPath: string

    switch (pack.scope) {
      case 'user':
        scopeRoot = homeRoot
        configPath = join(homeRoot, '.clooks', 'clooks.yml')
        break
      case 'project':
        scopeRoot = projectRoot
        configPath = join(projectRoot, '.clooks', 'clooks.yml')
        break
      case 'local':
        scopeRoot = projectRoot
        configPath = join(projectRoot, '.clooks', 'clooks.local.yml')
        break
    }

    for (const [hookName, hookDef] of Object.entries(pack.manifest.hooks)) {
      const ext = extname(hookDef.path)
      const vendorAbsPath = join(
        scopeRoot,
        '.clooks',
        'vendor',
        'plugin',
        packName,
        `${hookName}${ext}`,
      )
      const sourcePath = join(pack.installPath, hookDef.path)
      const fileExisted = existsSync(vendorAbsPath)

      // Copy from cache to vendor path (overwrite if exists)
      try {
        mkdirSync(dirname(vendorAbsPath), { recursive: true })
        copyFileSync(sourcePath, vendorAbsPath)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        result.errors.push(`${hookName}: copy failed — ${msg}`)
        continue
      }

      if (fileExisted) {
        // Existing hook — just overwrite the file, no config changes
        result.updated.push(hookName)
      } else {
        // New hook — validate, then register in config
        try {
          const mod = (await import(vendorAbsPath)) as Record<string, unknown>
          validateHookExport(mod, vendorAbsPath)
        } catch (err) {
          // Validation failed — delete vendored file to avoid orphan on next run
          try {
            unlinkSync(vendorAbsPath)
          } catch {
            // Ignore cleanup errors
          }
          const msg = err instanceof Error ? err.message : String(err)
          result.errors.push(`${hookName}: validation failed — ${msg}`)
          continue
        }

        // Check for collision in config
        if (!existsSync(configPath)) {
          mkdirSync(dirname(configPath), { recursive: true })
          writeFileSync(configPath, 'version: "1.0.0"\n')
        }

        const configContent = readFileSync(configPath, 'utf-8')
        // Check if hook name already exists as a YAML key in the config
        const hookKeyPattern = new RegExp(
          `^${hookName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`,
          'm',
        )
        if (hookKeyPattern.test(configContent)) {
          result.skipped.push(hookName)
          continue
        }

        // Append YAML entry
        const vendorRelPath = `./.clooks/vendor/plugin/${packName}/${hookName}${ext}`
        const appendContent =
          hookDef.autoEnable === false
            ? `\n${hookName}:\n  uses: ${vendorRelPath}\n  enabled: false\n`
            : `\n${hookName}:\n  uses: ${vendorRelPath}\n`
        writeFileSync(configPath, configContent + appendContent)
        result.registered.push(hookName)
      }
    }
  }

  return result
}

export function createUpdateCommand(): Command {
  return new Command('update')
    .description('Update a vendored plugin pack from the plugin cache')
    .argument('<target>', 'Update target (e.g., plugin:<pack-name>)')
    .action(async (target: string, _opts: Record<string, unknown>, cmd: Command) => {
      const ctx = getCtx(cmd)
      printIntro(ctx, 'clooks update')

      try {
        // Parse target
        if (!target.startsWith('plugin:')) {
          const message = `Invalid target "${target}". Expected format: plugin:<pack-name>`
          if (ctx.json) {
            process.stdout.write(jsonError('update', message) + '\n')
          } else {
            printError(ctx, 'update', message)
          }
          process.exit(1)
        }

        const packName = target.slice('plugin:'.length)
        if (packName.length === 0) {
          const message = 'Missing pack name after "plugin:"'
          if (ctx.json) {
            process.stdout.write(jsonError('update', message) + '\n')
          } else {
            printError(ctx, 'update', message)
          }
          process.exit(1)
        }

        const homeRoot = getHomeDir()
        const gitRoot = await getGitRoot()
        const projectRoot = gitRoot ?? process.cwd()

        const result = await updatePluginPack(packName, projectRoot, homeRoot)

        // Print summary
        const hasErrors = result.errors.length > 0
        const hasSuccess = result.updated.length > 0 || result.registered.length > 0

        if (ctx.json) {
          if (hasErrors && !hasSuccess) {
            process.stdout.write(jsonError('update', result.errors.join('; ')) + '\n')
            process.exit(1)
          }
          process.stdout.write(jsonSuccess('update', result) + '\n')
          return
        }

        if (hasErrors) {
          for (const err of result.errors) {
            printError(ctx, 'update', err)
          }
        }

        if (result.updated.length > 0) {
          printSuccess(
            ctx,
            `Updated ${result.updated.length} hook(s): ${result.updated.join(', ')}`,
          )
        }

        if (result.registered.length > 0) {
          printSuccess(
            ctx,
            `Registered ${result.registered.length} new hook(s): ${result.registered.join(', ')}`,
          )
        }

        if (result.skipped.length > 0) {
          printWarning(
            ctx,
            `Skipped ${result.skipped.length} hook(s) due to name collision: ${result.skipped.join(', ')}`,
          )
        }

        if (!hasErrors && !hasSuccess && result.skipped.length === 0) {
          printInfo(ctx, 'Nothing to update.')
        }

        if (hasErrors && !hasSuccess) {
          process.exit(1)
        }

        printOutro(ctx, 'Done.')
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        printError(ctx, 'update', message)
        process.exit(1)
      }
    })
}
