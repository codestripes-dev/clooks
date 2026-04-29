// `clooks test` — one-shot hook harness.
//
// Reads a cleaned-up Context JSON from stdin (or `--input <file>`), dispatches
// the matching per-event handler from a single hook file, prints the returned
// decision JSON to stdout, and exits with a code that reflects the decision.

import { Command } from 'commander'
import { dirname, isAbsolute, resolve } from 'path'
import { readFileSync } from 'fs'
import { isEventName } from '../config/constants.js'
import { parseYamlFile } from '../config/parse.js'
import { isPathLike } from '../config/resolve.js'
import { validateConfig } from '../config/validate.js'
import { validateHookExport } from '../loader.js'
import { createHarnessContext } from '../testing/create-context.js'
import { buildBeforeHookEvent, buildAfterHookEvent } from '../lifecycle.js'
import { VERSION } from '../version.js'
import { renderExample } from './test/render-example.js'
import type { ClooksConfig, HookEntry } from '../config/schema.js'
import type { EventName, HookName } from '../types/branded.js'
import type { CreateContextPayload } from '../testing/create-context.js'
import type { HookEventMeta } from '../types/lifecycle.js'

const HARNESS_USAGE_EXIT = 2
const HOOK_THREW_EXIT = 2

/**
 * Map a decision-result tag to a process exit code.
 *
 * - allow / skip / success / continue / retry / ask / defer → 0
 * - block / failure / stop → 1
 * - anything else → 0 (forward-compatibility — we don't pretend to know
 *   how a future tag should be mapped).
 */
function exitCodeForResult(tag: unknown): number {
  if (typeof tag !== 'string') return 0
  switch (tag) {
    case 'block':
    case 'failure':
    case 'stop':
      return 1
    case 'allow':
    case 'skip':
    case 'success':
    case 'continue':
    case 'retry':
    case 'ask':
    case 'defer':
    default:
      return 0
  }
}

async function readInputJson(inputPath: string | undefined): Promise<unknown> {
  if (inputPath !== undefined) {
    const raw = readFileSync(resolve(process.cwd(), inputPath), 'utf-8')
    return JSON.parse(raw)
  }
  // Mirrors src/engine/run.ts:80's default-deps `Bun.stdin.json()` pattern.
  return Bun.stdin.json()
}

export async function runHarness(
  hookFile: string,
  opts: { input?: string; config?: string; configJson?: string; hookName?: string },
): Promise<void> {
  if (opts.config !== undefined && opts.configJson !== undefined) {
    process.stderr.write(
      'clooks test: --config and --config-json are mutually exclusive — pick one\n',
    )
    process.exit(HARNESS_USAGE_EXIT)
  }
  if (opts.hookName !== undefined && opts.config === undefined) {
    process.stderr.write(
      'clooks test: --hook-name requires --config (it is meaningless on its own or with --config-json)\n',
    )
    process.exit(HARNESS_USAGE_EXIT)
  }

  const absolutePath = resolve(process.cwd(), hookFile)

  let mod: Record<string, unknown>
  try {
    mod = (await import(absolutePath)) as Record<string, unknown>
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    process.stderr.write(`clooks test: failed to import hook file: ${message}\n`)
    process.exit(HARNESS_USAGE_EXIT)
  }

  let hook: ReturnType<typeof validateHookExport>
  try {
    hook = validateHookExport(mod, absolutePath)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    process.stderr.write(`clooks test: ${message}\n`)
    process.exit(HARNESS_USAGE_EXIT)
  }

  let payload: unknown
  try {
    payload = await readInputJson(opts.input)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    process.stderr.write(`clooks test: failed to read JSON input: ${message}\n`)
    process.exit(HARNESS_USAGE_EXIT)
  }

  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    process.stderr.write('clooks test: input JSON must be an object with an "event" field\n')
    process.exit(HARNESS_USAGE_EXIT)
  }

  const payloadObj = payload as Record<string, unknown>
  const eventField = payloadObj.event
  if (typeof eventField !== 'string' || !isEventName(eventField)) {
    process.stderr.write(
      `clooks test: input JSON "event" field is missing or not a known EventName (got: ${JSON.stringify(eventField)})\n`,
    )
    process.exit(HARNESS_USAGE_EXIT)
  }
  const event = eventField as EventName

  const handler = (hook as unknown as Record<string, unknown>)[event]
  if (typeof handler !== 'function') {
    process.stderr.write(`clooks test: hook does not export a handler for event "${event}"\n`)
    process.exit(HARNESS_USAGE_EXIT)
  }

  // Strip `event` from the payload — the harness re-supplies it via
  // `createHarnessContext`'s contract.
  const { event: _stripped, ...rest } = payloadObj
  void _stripped

  const ctx = createHarnessContext(event, rest as CreateContextPayload<typeof event>)

  // Compute hookConfig the same way `src/loader.ts:144-146` does in
  // production: shallow-merge `meta.config` defaults with overrides.
  // Override source depends on which flag was passed:
  //   - --config <yaml>:        load file, find entry, use entry.config
  //   - --config-json '<json>': inline JSON literal as the override
  //   - neither:                no override, defaults only.
  const metaDefaults = (hook.meta.config ?? {}) as Record<string, unknown>
  let config: Record<string, unknown>
  let configPath = '/tmp/clooks-test-no-config.yml'
  if (opts.configJson !== undefined) {
    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(opts.configJson)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      process.stderr.write(`clooks test: --config-json: failed to parse JSON: ${message}\n`)
      process.exit(HARNESS_USAGE_EXIT)
    }
    if (parsedJson === null || typeof parsedJson !== 'object' || Array.isArray(parsedJson)) {
      process.stderr.write(
        'clooks test: --config-json must be a JSON object (got null, array, or scalar)\n',
      )
      process.exit(HARNESS_USAGE_EXIT)
    }
    config = { ...metaDefaults, ...(parsedJson as Record<string, unknown>) }
  } else if (opts.config !== undefined) {
    const yamlAbs = resolve(process.cwd(), opts.config)

    let configRaw: Record<string, unknown>
    try {
      configRaw = await parseYamlFile(yamlAbs)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      process.stderr.write(`clooks test: --config: ${message}\n`)
      process.exit(HARNESS_USAGE_EXIT)
    }

    let validated: ClooksConfig
    try {
      validated = validateConfig(configRaw)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      process.stderr.write(`clooks test: --config: ${message}\n`)
      process.exit(HARNESS_USAGE_EXIT)
    }

    const yamlDir = dirname(yamlAbs)
    const candidates: Array<{ name: HookName; entry: HookEntry; absPath: string }> = []
    for (const [name, entry] of Object.entries(validated.hooks)) {
      let absPath: string
      if (isAbsolute(entry.resolvedPath)) {
        absPath = entry.resolvedPath
      } else if (entry.uses !== undefined && isPathLike(entry.uses)) {
        // Path-like uses: user authored a relative path in this YAML, resolve
        // against YAML's directory.
        absPath = resolve(yamlDir, entry.resolvedPath)
      } else {
        // Hook-name convention or short-address: path is repo-root-relative.
        absPath = resolve(process.cwd(), entry.resolvedPath)
      }
      candidates.push({ name: name as HookName, entry, absPath })
    }

    let chosen: { name: HookName; entry: HookEntry } | undefined
    if (opts.hookName !== undefined) {
      chosen = candidates.find((c) => c.name === opts.hookName)
      if (chosen === undefined) {
        process.stderr.write(
          `clooks test: --config: no entry named "${opts.hookName}" in ${opts.config}\n`,
        )
        process.exit(HARNESS_USAGE_EXIT)
      }
    } else {
      const matches = candidates.filter((c) => c.absPath === absolutePath)
      if (matches.length === 1) {
        chosen = matches[0]
      } else if (matches.length === 0) {
        const names = candidates.map((c) => c.name).join(', ')
        process.stderr.write(
          `clooks test: --config: no entry in ${opts.config} resolves to ${absolutePath}. ` +
            `Available entries: [${names}]. Use --hook-name <alias> to pick one.\n`,
        )
        process.exit(HARNESS_USAGE_EXIT)
      } else {
        const lines = matches
          .map((c) => `  - ${c.name} (resolvedPath: ${c.entry.resolvedPath})`)
          .join('\n')
        process.stderr.write(
          `clooks test: --config: multiple entries in ${opts.config} resolve to ${absolutePath}:\n${lines}\n` +
            `Use --hook-name <alias> to pick one.\n`,
        )
        process.exit(HARNESS_USAGE_EXIT)
      }
    }

    // After the branches above, `chosen` is either set or we've exited.
    const chosenEntry = chosen as { name: HookName; entry: HookEntry }
    config = { ...metaDefaults, ...chosenEntry.entry.config }
    configPath = yamlAbs
  } else {
    config = metaDefaults
  }

  // Per-hook lifecycle metadata. Deterministic stub — same spirit as the
  // `sessionId`/`transcriptPath` defaults in `createHarnessContext`. Hook
  // authors who need real git/timestamp values run a Claude Code invocation.
  const lifecycleMeta: HookEventMeta = {
    gitRoot: null,
    gitBranch: null,
    platform: process.platform === 'darwin' ? 'darwin' : 'linux',
    hookName: hook.meta.name,
    hookPath: absolutePath,
    timestamp: '2026-01-01T00:00:00.000Z',
    clooksVersion: VERSION,
    configPath,
  }

  let result: unknown
  let shortCircuited = false

  if (hook.beforeHook !== undefined) {
    const beforeEvent = buildBeforeHookEvent(
      event,
      ctx as unknown as Record<string, unknown>,
      lifecycleMeta,
    )
    let beforeRet: unknown
    try {
      beforeRet = await hook.beforeHook(beforeEvent, config)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      process.stderr.write(`clooks test: beforeHook threw: ${message}\n`)
      process.exit(HOOK_THREW_EXIT)
    }
    if (
      typeof beforeRet === 'object' &&
      beforeRet !== null &&
      'result' in (beforeRet as Record<string, unknown>)
    ) {
      const tag = (beforeRet as { result: unknown }).result
      if (tag === 'block' || tag === 'skip') {
        result = beforeRet
        shortCircuited = true
      } else if (tag !== 'passthrough') {
        // Mirror src/lifecycle.ts:121-123 — warn but continue.
        process.stderr.write(
          `clooks test: beforeHook returned an unrecognized shape (result=${String(tag)}). Expected event.block / event.skip / event.passthrough or void. Treating as no-op.\n`,
        )
      }
    }
  }

  if (!shortCircuited) {
    try {
      result = await (handler as (ctx: unknown, config: Record<string, unknown>) => unknown)(
        ctx,
        config,
      )
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      process.stderr.write(`clooks test: hook threw: ${message}\n`)
      process.exit(HOOK_THREW_EXIT)
    }

    if (hook.afterHook !== undefined) {
      const afterEvent = buildAfterHookEvent(
        event,
        ctx as unknown as Record<string, unknown>,
        result,
        lifecycleMeta,
      )
      let afterRet: unknown
      try {
        afterRet = await hook.afterHook(afterEvent, config)
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        process.stderr.write(`clooks test: afterHook threw: ${message}\n`)
        process.exit(HOOK_THREW_EXIT)
      }
      if (
        typeof afterRet === 'object' &&
        afterRet !== null &&
        'result' in (afterRet as Record<string, unknown>)
      ) {
        const tag = (afterRet as { result: unknown }).result
        if (tag !== 'passthrough') {
          process.stderr.write(
            `clooks test: afterHook returned an unrecognized shape (result=${String(tag)}). Expected event.passthrough or void. Treating as no-op.\n`,
          )
        }
      }
    }
  }

  if (result === undefined) {
    // Handler returned void — legal for notify-only hooks. Treat as skip-equivalent.
    process.stdout.write('{}\n')
    process.exit(0)
  }

  const tag =
    typeof result === 'object' && result !== null
      ? (result as Record<string, unknown>).result
      : undefined

  process.stdout.write(JSON.stringify(result) + '\n')
  process.exit(exitCodeForResult(tag))
}

export function createTestCommand(): Command {
  const cmd = new Command('test')
    .description('Run a single hook handler against a synthetic event payload')
    .argument('[hook-file]', 'Path to a hook .ts file')
    .option('--input <file>', 'Read JSON payload from a file instead of stdin')
    .option(
      '--config <path>',
      'Apply config from a clooks.yml-shaped file (mutually exclusive with --config-json)',
    )
    .option(
      '--config-json <json>',
      'Apply config from a JSON literal (mutually exclusive with --config)',
    )
    .option(
      '--hook-name <alias>',
      'Pick the clooks.yml entry by name when --config matches more than one',
    )
    // Without this, Commander's greedy positional binding would swallow the
    // literal "example" before the subcommand router gets a chance to fire.

    .action(
      async (
        hookFile: string | undefined,
        opts: { input?: string; config?: string; configJson?: string; hookName?: string },
      ) => {
        if (hookFile === undefined) {
          process.stderr.write(
            'clooks test: missing required argument <hook-file>. ' +
              'Run `clooks test example <Event>` to see an example payload, ' +
              'or `clooks test --help` for usage.\n',
          )
          process.exit(HARNESS_USAGE_EXIT)
        }
        await runHarness(hookFile, opts)
      },
    )

  // `clooks test example <Event>` — prints prose-and-JSON documentation for
  // the named event. The 4 tool-keyed events additionally inline all 10
  // built-in tools' `toolInput` shapes.
  //
  // Commander rejects unknown options on its own — no defensive `--tool`
  // handling needed here.
  const exampleCmd = new Command('example')
    .description('Print example payload + documentation for an event')
    .argument('[event]', 'Event name (e.g., PreToolUse)')
    .action((event: string | undefined) => {
      if (event === undefined) {
        process.stderr.write(
          'clooks test example: missing required argument <event>. ' +
            'Run `clooks test example --help` for usage.\n',
        )
        process.exit(HARNESS_USAGE_EXIT)
      }
      if (!isEventName(event)) {
        process.stderr.write(
          `clooks test example: unknown event "${event}". ` +
            'See `clooks types` for the full list of EventName values.\n',
        )
        process.exit(HARNESS_USAGE_EXIT)
      }
      process.stdout.write(renderExample(event as EventName))
      process.exit(0)
    })

  cmd.addCommand(exampleCmd)
  return cmd
}
