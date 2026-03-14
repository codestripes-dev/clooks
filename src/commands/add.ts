import { Command } from 'commander'
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs'
import { join, extname } from 'path'
import { getHomeDir } from '../platform.js'
import { getCtx } from '../tui/context.js'
import { jsonSuccess } from '../tui/json-envelope.js'
import {
  printIntro,
  printSuccess,
  printError,
  printOutro,
  printWarning,
  printInfo,
} from '../tui/output.js'
import { withSpinner } from '../tui/spinner.js'
import { classifyGitHubInput, toRawUrl } from '../github-url.js'
import type { GitHubBlobInfo, GitHubRepoInfo } from '../github-url.js'
import { loadConfig } from '../config/index.js'
import type { LoadConfigResult } from '../config/index.js'
import { validateHookExport } from '../loader.js'
import { fetchManifest } from '../manifest.js'
import { promptMultiSelect, promptSelect } from '../tui/prompts.js'
import { isNonInteractive } from '../tui/prompts.js'
import type { HookName } from '../types/branded.js'
import type { OutputContext } from '../tui/context.js'

export function createAddCommand(): Command {
  return new Command('add')
    .description('Download and install a hook from a GitHub URL')
    .argument('<url>', 'GitHub URL (blob URL for single file, repo URL for hook pack)')
    .option('--all', 'Install all hooks from a pack without prompting')
    .option('--global', 'Install hooks globally (~/.clooks/)')
    .option('--project', 'Install hooks for this project (.clooks/)')
    .action(async (url: string, opts: Record<string, unknown>, cmd: Command) => {
      const ctx = getCtx(cmd)
      printIntro(ctx, 'clooks add')

      try {
        const input = classifyGitHubInput(url)
        const scopeRoot = await resolveScopeRoot(ctx, opts)

        if (input.type === 'blob') {
          await handleBlobUrl(ctx, input.info, opts, scopeRoot)
        } else {
          await handleRepoUrl(ctx, input.info, opts, scopeRoot)
        }

        printOutro(ctx, 'Done.')
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        printError(ctx, 'add', message)
        process.exit(1)
      }
    })
}

async function resolveScopeRoot(
  ctx: OutputContext,
  opts: Record<string, unknown>,
): Promise<string> {
  if (opts.global && opts.project) {
    throw new Error('Cannot use both --global and --project flags.')
  }
  if (opts.global) {
    return getHomeDir()
  }
  if (opts.project) {
    return process.cwd()
  }

  // No explicit flag — check if project config exists
  const projectConfigPath = join(process.cwd(), '.clooks', 'clooks.yml')
  if (existsSync(projectConfigPath)) {
    // Prompt the user
    const scope = await promptSelect(ctx, {
      message: 'Install scope:',
      options: [
        { value: 'project' as const, label: 'This project (.clooks/)', hint: 'Committed to git' },
        {
          value: 'global' as const,
          label: 'Global (~/.clooks/)',
          hint: 'Available to all projects',
        },
      ],
      defaultValue: 'project' as const,
    })
    return scope === 'global' ? getHomeDir() : process.cwd()
  }

  // No project config — default to global
  return getHomeDir()
}

async function loadOrCreateConfig(
  ctx: OutputContext,
  scopeRoot: string,
): Promise<LoadConfigResult> {
  const homeRoot = getHomeDir()
  let configResult = await loadConfig(scopeRoot, { homeRoot })

  if (configResult === null) {
    const configDir = join(scopeRoot, '.clooks')
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(configDir, 'clooks.yml'), 'version: "1.0.0"\n')
    configResult = await loadConfig(scopeRoot, { homeRoot })
    if (configResult === null) {
      printError(ctx, 'add', 'Failed to initialize config.')
      process.exit(1)
    }
  }

  return configResult
}

async function handleBlobUrl(
  ctx: OutputContext,
  info: GitHubBlobInfo,
  _opts: Record<string, unknown>,
  scopeRoot: string,
): Promise<void> {
  // Step 1 — Load config
  const { config } = await loadOrCreateConfig(ctx, scopeRoot)

  // Step 2 — Check conflicts
  const hookKey = info.filenameStem
  if (config.hooks[hookKey as HookName] !== undefined) {
    printError(
      ctx,
      'add',
      `Hook "${hookKey}" already exists in clooks.yml. Remove it first or choose a different hook.`,
    )
    process.exit(1)
  }

  // Step 3 — Download
  const rawUrl = toRawUrl(info)
  const content = await withSpinner(ctx, { start: 'Downloading hook...' }, async () => {
    const res = await fetch(rawUrl)
    if (!res.ok) {
      if (res.status === 404) {
        throw new Error(
          `Hook file not found — check the URL and ensure the repo is public (${rawUrl})`,
        )
      }
      throw new Error(`Failed to download hook: HTTP ${res.status} ${res.statusText} (${rawUrl})`)
    }
    return res.text()
  })

  // Step 4 — Write to vendor directory
  const vendorDir = join(scopeRoot, '.clooks', 'vendor', 'github.com', info.owner, info.repo)
  mkdirSync(vendorDir, { recursive: true })
  const absolutePath = join(vendorDir, info.filename)
  writeFileSync(absolutePath, content)

  // Step 5 — Validate the hook
  try {
    const mod = (await import(absolutePath)) as Record<string, unknown>
    validateHookExport(mod, absolutePath)
  } catch (e) {
    try {
      unlinkSync(absolutePath)
    } catch {
      // Ignore cleanup errors
    }
    throw e
  }

  // Step 6 — Register in clooks.yml with SHORT ADDRESS
  const configPath = join(scopeRoot, '.clooks', 'clooks.yml')
  const shortAddress = `${info.owner}/${info.repo}:${info.filenameStem}`
  const existingConfig = readFileSync(configPath, 'utf-8')
  const appendContent = `\n${hookKey}:\n  uses: ${shortAddress}\n`
  writeFileSync(configPath, existingConfig + appendContent)

  // Step 7 — Report success
  if (ctx.json) {
    process.stdout.write(
      jsonSuccess('add', {
        name: hookKey,
        address: shortAddress,
        url: `https://github.com/${info.owner}/${info.repo}/blob/${info.ref}/${info.path}`,
      }) + '\n',
    )
    return
  }

  printSuccess(ctx, `Installed "${hookKey}" from ${info.owner}/${info.repo}`)
  printSuccess(ctx, `Registered with address: ${shortAddress}`)
}

async function handleRepoUrl(
  ctx: OutputContext,
  info: GitHubRepoInfo,
  opts: Record<string, unknown>,
  scopeRoot: string,
): Promise<void> {
  // Step 1 — Load config
  const { config } = await loadOrCreateConfig(ctx, scopeRoot)

  // Step 2 — Fetch manifest
  const manifest = await withSpinner(ctx, { start: 'Fetching pack manifest...' }, async () => {
    return fetchManifest(info.owner, info.repo)
  })

  // Step 3 — Select hooks (TUI picker or --all)
  const hookNames = Object.keys(manifest.hooks)
  let selectedNames: string[]

  if (opts.all) {
    selectedNames = hookNames
  } else if (isNonInteractive(ctx)) {
    // Non-interactive without --all: list hooks and exit
    if (ctx.json) {
      const available = Object.entries(manifest.hooks).map(([name, hook]) => ({
        name,
        description: hook.description,
      }))
      process.stdout.write(
        jsonSuccess('add', {
          available,
          message: 'Use --all to install all hooks in non-interactive mode.',
        }) + '\n',
      )
    } else {
      printInfo(ctx, `Pack "${manifest.name}" contains ${hookNames.length} hook(s):`)
      for (const [name, hook] of Object.entries(manifest.hooks)) {
        printInfo(ctx, `  ${name} — ${hook.description}`)
      }
      printInfo(ctx, 'Use --all to install all hooks in non-interactive mode.')
    }
    return
  } else {
    const options = Object.entries(manifest.hooks).map(([name, hook]) => ({
      value: name,
      label: name,
      hint: hook.description,
    }))
    selectedNames = await promptMultiSelect(ctx, {
      message: 'Select hooks to install:',
      options,
    })
  }

  if (selectedNames.length === 0) {
    printInfo(ctx, 'No hooks selected.')
    return
  }

  // Step 4 — Download selected hooks
  type DownloadSuccess = { ok: true; name: string; content: string; ext: string }
  type DownloadFailure = { ok: false; name: string; error: string }
  type DownloadResult = DownloadSuccess | DownloadFailure

  const downloaded: DownloadSuccess[] = []
  const downloadErrors: DownloadFailure[] = []

  await withSpinner(ctx, { start: `Downloading ${selectedNames.length} hook(s)...` }, async () => {
    const results: DownloadResult[] = await Promise.all(
      selectedNames.map(async (name): Promise<DownloadResult> => {
        const hook = manifest.hooks[name]
        if (!hook) return { ok: false, name, error: 'Hook not found in manifest' }
        const rawUrl = `https://raw.githubusercontent.com/${info.owner}/${info.repo}/HEAD/${hook.path}`
        try {
          const res = await fetch(rawUrl)
          if (!res.ok) {
            return { ok: false, name, error: `HTTP ${res.status} ${res.statusText}` }
          }
          const content = await res.text()
          const ext = extname(hook.path)
          return { ok: true, name, content, ext }
        } catch (e) {
          return { ok: false, name, error: e instanceof Error ? e.message : String(e) }
        }
      }),
    )

    for (const result of results) {
      if (result.ok) {
        downloaded.push(result)
      } else {
        downloadErrors.push(result)
      }
    }
  })

  // Report download errors
  for (const err of downloadErrors) {
    printWarning(ctx, `Failed to download "${err.name}": ${err.error}`)
  }

  if (downloaded.length === 0) {
    throw new Error('All hook downloads failed. Nothing was installed.')
  }

  // Step 5 — Write vendor files
  const vendorDir = join(scopeRoot, '.clooks', 'vendor', 'github.com', info.owner, info.repo)
  mkdirSync(vendorDir, { recursive: true })

  for (const d of downloaded) {
    const filename = `${d.name}${d.ext}`
    writeFileSync(join(vendorDir, filename), d.content)
  }

  // Step 6 — Validate hooks (soft)
  const validationWarnings: string[] = []
  for (const d of downloaded) {
    const filename = `${d.name}${d.ext}`
    const absolutePath = join(vendorDir, filename)
    try {
      const mod = (await import(absolutePath)) as Record<string, unknown>
      validateHookExport(mod, absolutePath)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      validationWarnings.push(`"${d.name}": ${msg}`)
      printWarning(ctx, `Validation warning for "${d.name}": ${msg}`)
    }
  }

  // Step 7 — Resolve name conflicts and register
  const configPath = join(scopeRoot, '.clooks', 'clooks.yml')
  let configContent = readFileSync(configPath, 'utf-8')
  const installed: { name: string; address: string }[] = []
  const skipped: string[] = []
  const registeredKeys = new Set<string>()

  for (const d of downloaded) {
    const shortAddress = `${info.owner}/${info.repo}:${d.name}`
    let hookKey = d.name

    // Check for conflict with short name
    if (config.hooks[hookKey as HookName] !== undefined || registeredKeys.has(hookKey)) {
      // Try full address as key
      hookKey = shortAddress
      if (config.hooks[hookKey as HookName] !== undefined || registeredKeys.has(hookKey)) {
        // Both taken — skip
        printWarning(ctx, `Skipping "${d.name}" — name conflicts with existing hook.`)
        skipped.push(d.name)
        continue
      }
    }

    // Quote YAML keys containing special characters (: or /)
    const yamlKey = hookKey.includes(':') || hookKey.includes('/') ? `"${hookKey}"` : hookKey
    const appendContent = `\n${yamlKey}:\n  uses: ${shortAddress}\n`
    configContent += appendContent
    installed.push({ name: hookKey, address: shortAddress })
    registeredKeys.add(hookKey)
  }

  writeFileSync(configPath, configContent)

  // Step 8 — Report results
  if (ctx.json) {
    process.stdout.write(
      jsonSuccess('add', {
        hooks: installed,
        skipped,
        warnings: validationWarnings,
      }) + '\n',
    )
    return
  }

  printSuccess(ctx, `Installed ${installed.length} hook(s) from ${info.owner}/${info.repo}`)
  for (const h of installed) {
    printSuccess(ctx, `  ${h.name} → ${h.address}`)
  }
  if (skipped.length > 0) {
    printWarning(ctx, `Skipped ${skipped.length} hook(s) due to name conflicts`)
  }
}
