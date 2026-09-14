import { Command, Option } from 'commander'
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, realpathSync } from 'fs'
import { join, extname, dirname, basename } from 'path'
import { isDeepStrictEqual } from 'util'
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
import { findProjectRoot } from '../config/discovery.js'
import { discoverPluginPacks } from '../plugin-discovery.js'
import { discoverCodexPluginPacks } from '../agents/codex/plugin-discovery.js'
import { resolveCodexHome } from '../agents/codex/settings.js'
import { classifyConfigKeys } from '../config/classify.js'
import { isPathLike, resolveHookPath } from '../config/resolve.js'
import type { HookName } from '../types/branded.js'
import type { AgentId } from '../agents/types.js'
import { validateHookExport } from '../loader.js'
import type { DiscoveredPack, DiscoverOptions } from '../plugin-discovery.js'

const SAFE_NAME_PATTERN = /^[a-z][a-z0-9._-]*$/

export interface UpdateResult {
  updated: string[] // hooks whose vendor files were overwritten or restored
  registered: string[] // new hooks that were registered in config
  skipped: string[] // new hooks skipped due to collision
  errors: string[] // copy/validation failures
}

export interface UpdatePluginOptions {
  agent?: AgentId
  codexHome?: string
  discoverPluginPacks?: typeof discoverPluginPacks
  discoverCodexPluginPacks?: typeof discoverCodexPluginPacks
}

function defaultDiscovery(): UpdatePluginOptions {
  return { discoverPluginPacks, discoverCodexPluginPacks, codexHome: process.env.CODEX_HOME }
}

interface UpdateCandidate {
  agent: AgentId
  pack: DiscoveredPack
  sources: Map<string, Buffer>
}

interface UpdateDestination {
  vendorDir: string
  candidate: UpdateCandidate
  configPaths: Map<string, string> // physical config path -> scope root for uses resolution
}

function sourceLabel(candidate: UpdateCandidate): string {
  return `${candidate.agent}:${candidate.pack.pluginName}`
}

function destinationIdentity(
  path: string,
  homeRoot: string,
  kind: 'vendor' | 'config',
  file = false,
): string {
  try {
    if (file) {
      try {
        return realpathSync(path)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    const directory = resolveCodexHome(homeRoot, { CODEX_HOME: file ? dirname(path) : path })
    return file ? join(directory, basename(path)) : directory
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Cannot resolve ${kind} destination ${JSON.stringify(path)}: ${message.replaceAll('CODEX_HOME', 'destination path')}`,
      { cause: error },
    )
  }
}

function readRegistrationConfig(path: string): { content: string; hooks: Record<string, unknown> } {
  const content = existsSync(path) ? readFileSync(path, 'utf8') : 'version: "1.0.0"\n'
  const raw = Bun.YAML.parse(content)
  if (raw !== null && (typeof raw !== 'object' || Array.isArray(raw))) {
    throw new Error(`${path}: expected a YAML mapping`)
  }
  const { hooks } = classifyConfigKeys((raw ?? {}) as Record<string, unknown>)
  return { content, hooks }
}

export async function updatePluginPack(
  packName: string,
  projectRoot: string,
  homeRoot: string,
  discovery:
    | ((opts?: DiscoverOptions) => DiscoveredPack[])
    | UpdatePluginOptions = defaultDiscovery(),
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

  const options: UpdatePluginOptions =
    typeof discovery === 'function' ? { discoverPluginPacks: discovery } : discovery
  const candidates: Array<{ agent: AgentId; pack: DiscoveredPack }> = []
  if (!options.agent || options.agent === 'claude-code') {
    for (const pack of options.discoverPluginPacks?.({ homeRoot, projectRoot }) ?? []) {
      if (pack.manifest.name === packName) candidates.push({ agent: 'claude-code', pack })
    }
  }
  if (!options.agent || options.agent === 'codex') {
    for (const pack of options.discoverCodexPluginPacks?.({
      homeRoot,
      projectRoot,
      codexHome: options.codexHome,
    }) ?? []) {
      if (pack.manifest.name === packName) candidates.push({ agent: 'codex', pack })
    }
  }

  if (candidates.length === 0) {
    result.errors.push(`No installed plugin found with pack name "${packName}"`)
    return result
  }

  const destinations = new Map<string, UpdateDestination>()
  // Snapshot every matching source before creating directories, copying or importing hooks.
  for (const { agent, pack } of candidates) {
    const sources = new Map<string, Buffer>()
    for (const [name, hook] of Object.entries(pack.manifest.hooks)) {
      const sourcePath = join(pack.installPath, hook.path)
      try {
        sources.set(name, readFileSync(sourcePath))
      } catch (error) {
        result.errors.push(
          `${agent}:${pack.pluginName} ${name}: source preflight failed at ${sourcePath}: ${error}`,
        )
      }
    }
    const candidate = { agent, pack, sources }
    const scopeRoot = pack.scope === 'user' ? homeRoot : projectRoot
    let configPath: string
    let vendorDir: string
    try {
      configPath = destinationIdentity(
        join(scopeRoot, '.clooks', pack.scope === 'local' ? 'clooks.local.yml' : 'clooks.yml'),
        homeRoot,
        'config',
        true,
      )
      vendorDir = destinationIdentity(
        join(scopeRoot, '.clooks/vendor/plugin', packName),
        homeRoot,
        'vendor',
      )
    } catch (error) {
      result.errors.push(`${sourceLabel(candidate)}: destination preflight failed: ${error}`)
      continue
    }
    const previous = destinations.get(vendorDir)
    if (previous) {
      const same =
        isDeepStrictEqual(previous.candidate.pack.manifest, pack.manifest) &&
        sources.size === previous.candidate.sources.size &&
        [...sources].every(([name, bytes]) => previous.candidate.sources.get(name)?.equals(bytes))
      if (!same) {
        const help =
          previous.candidate.agent === agent
            ? 'Disable the unwanted plugin source; --agent cannot distinguish these sources.'
            : 'Select a source with --agent claude-code|codex; conflicting sources within that agent must still be disabled.'
        result.errors.push(
          `Ambiguous plugin pack "${packName}" at ${vendorDir}: ${sourceLabel(previous.candidate)} differs from ${sourceLabel(candidate)}. ${help}`,
        )
      }
      previous.configPaths.set(configPath, scopeRoot)
    } else {
      destinations.set(vendorDir, {
        vendorDir,
        candidate,
        configPaths: new Map([[configPath, scopeRoot]]),
      })
    }
  }
  if (result.errors.length > 0) return result

  for (const {
    vendorDir,
    candidate: { pack, sources },
    configPaths,
  } of destinations.values()) {
    for (const [hookName, hookDef] of Object.entries(pack.manifest.hooks)) {
      const ext = extname(hookDef.path)
      const vendorAbsPath = join(vendorDir, `${hookName}${ext}`)
      const fileExisted = existsSync(vendorAbsPath)
      let restoresRegistration = false
      const registrations: Array<{ path: string; content: string }> = []
      if (!fileExisted) {
        for (const [path, scopeRoot] of configPaths) {
          try {
            const config = readRegistrationConfig(path)
            if (Object.hasOwn(config.hooks, hookName)) {
              const entry = config.hooks[hookName]
              const uses = entry && typeof entry === 'object' && 'uses' in entry ? entry.uses : null
              if (
                typeof uses === 'string' &&
                isPathLike(uses) &&
                destinationIdentity(
                  resolveHookPath(hookName as HookName, { uses }, scopeRoot),
                  homeRoot,
                  'vendor',
                  true,
                ) === vendorAbsPath
              ) {
                restoresRegistration = true
              } else result.skipped.push(hookName)
            } else registrations.push({ path, content: config.content })
          } catch (error) {
            result.errors.push(`${hookName}: registration config failed at ${path}: ${error}`)
          }
        }
        if (registrations.length === 0 && !restoresRegistration) continue
      }

      // Copy from cache to vendor path (overwrite if exists)
      try {
        mkdirSync(dirname(vendorAbsPath), { recursive: true })
        writeFileSync(vendorAbsPath, sources.get(hookName)!)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        result.errors.push(`${hookName}: copy failed — ${msg}`)
        continue
      }

      if (fileExisted) {
        // Existing hook — just overwrite the file, no config changes
        result.updated.push(hookName)
      } else {
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
        if (restoresRegistration) result.updated.push(hookName)

        // Append YAML entry
        const vendorRelPath = `./.clooks/vendor/plugin/${packName}/${hookName}${ext}`
        const appendContent =
          hookDef.autoEnable === false
            ? `\n${hookName}:\n  uses: ${vendorRelPath}\n  enabled: false\n`
            : `\n${hookName}:\n  uses: ${vendorRelPath}\n`
        for (const { path, content } of registrations) {
          try {
            mkdirSync(dirname(path), { recursive: true })
            writeFileSync(path, content + appendContent)
            result.registered.push(hookName)
          } catch (error) {
            result.errors.push(`${hookName}: registration failed at ${path}: ${error}`)
          }
        }
      }
    }
  }

  return result
}

export function createUpdateCommand(
  findRoot: () => Promise<string> = findProjectRoot,
  discovery?: Omit<UpdatePluginOptions, 'agent'>,
): Command {
  return new Command('update')
    .description('Update a vendored plugin pack from the plugin cache')
    .argument('<target>', 'Update target (e.g., plugin:<pack-name>)')
    .addOption(
      new Option('--agent <agent>', 'Select the plugin cache source').choices([
        'claude-code',
        'codex',
      ]),
    )
    .action(async (target: string, opts: { agent?: AgentId }, cmd: Command) => {
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
        const projectRoot = await findRoot()

        const result = await updatePluginPack(packName, projectRoot, homeRoot, {
          ...(discovery ?? defaultDiscovery()),
          agent: opts.agent,
        })

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
