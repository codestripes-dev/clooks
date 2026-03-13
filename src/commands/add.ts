import { Command } from 'commander'
import { mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { getCtx } from '../tui/context.js'
import { jsonSuccess } from '../tui/json-envelope.js'
import { printIntro, printSuccess, printError, printOutro } from '../tui/output.js'
import { withSpinner } from '../tui/spinner.js'
import { parseGitHubBlobUrl, toRawUrl } from '../github-url.js'
import { loadConfig } from '../config/index.js'
import { validateHookExport } from '../loader.js'
import type { HookName } from '../types/branded.js'

export function createAddCommand(): Command {
  return new Command('add')
    .description('Download and install a hook from a GitHub URL')
    .argument('<url>', 'GitHub blob URL of the hook file')
    .action(async (url: string, _opts: Record<string, unknown>, cmd: Command) => {
      const ctx = getCtx(cmd)

      printIntro(ctx, 'clooks add')

      try {
        // Step 1 — Parse the URL
        const info = parseGitHubBlobUrl(url)

        // Step 2 — Load config
        const configResult = await loadConfig(process.cwd())

        if (configResult === null || !configResult.hasProjectConfig) {
          printError(ctx, 'add', 'No clooks project found. Run `clooks init` first.')
          process.exit(1)
        }

        const { config } = configResult

        // Step 3 — Check conflicts
        const hookKey = info.filenameStem
        if (config.hooks[hookKey as HookName] !== undefined) {
          printError(
            ctx,
            'add',
            `Hook "${hookKey}" already exists in clooks.yml. Remove it first or choose a different hook.`,
          )
          process.exit(1)
        }

        // Step 4 — Download
        const rawUrl = toRawUrl(info)
        const content = await withSpinner(ctx, { start: 'Downloading hook...' }, async () => {
          const res = await fetch(rawUrl)
          if (!res.ok) {
            if (res.status === 404) {
              throw new Error(
                `Hook file not found — check the URL and ensure the repo is public (${rawUrl})`,
              )
            }
            throw new Error(
              `Failed to download hook: HTTP ${res.status} ${res.statusText} (${rawUrl})`,
            )
          }
          return res.text()
        })

        // Step 5 — Write to vendor directory
        const vendorDir = join(
          process.cwd(),
          '.clooks',
          'vendor',
          'github.com',
          info.owner,
          info.repo,
        )
        mkdirSync(vendorDir, { recursive: true })
        const absolutePath = join(vendorDir, info.filename)
        writeFileSync(absolutePath, content)

        // Step 6 — Validate the hook
        try {
          const mod = (await import(absolutePath)) as Record<string, unknown>
          validateHookExport(mod, absolutePath)
        } catch (e) {
          // Clean up the downloaded file
          try {
            unlinkSync(absolutePath)
          } catch {
            // Ignore cleanup errors
          }
          throw e
        }

        // Step 7 — Register in clooks.yml
        const configPath = join(process.cwd(), '.clooks', 'clooks.yml')
        const vendorRelativePath = `./.clooks/vendor/github.com/${info.owner}/${info.repo}/${info.filename}`
        const existingConfig = readFileSync(configPath, 'utf-8')
        const appendContent = `\n${hookKey}:\n  uses: ${vendorRelativePath}\n`
        writeFileSync(configPath, existingConfig + appendContent)

        // Step 8 — Report success
        if (ctx.json) {
          process.stdout.write(
            jsonSuccess('add', { name: hookKey, path: vendorRelativePath, url }) + '\n',
          )
          return
        }

        printSuccess(ctx, `Installed "${hookKey}" from ${url}`)
        printSuccess(ctx, `Written to ${vendorRelativePath}`)
        printSuccess(ctx, `Registered in clooks.yml`)

        printOutro(ctx, 'Done.')
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        printError(ctx, 'add', message)
        process.exit(1)
      }
    })
}
