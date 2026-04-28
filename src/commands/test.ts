// `clooks test` — one-shot hook harness.
//
// Reads a cleaned-up Context JSON from stdin (or `--input <file>`), dispatches
// the matching per-event handler from a single hook file, prints the returned
// decision JSON to stdout, and exits with a code that reflects the decision.
//
// See docs/plans/PLAN-FEAT-0067-clooks-test-harness.md (Decision Log) for the
// exit-code mapping rationale and the Commander grammar choice.

import { Command } from 'commander'
import { resolve } from 'path'
import { readFileSync } from 'fs'
import { isEventName } from '../config/constants.js'
import { validateHookExport } from '../loader.js'
import { createHarnessContext } from '../testing/create-context.js'
import { buildBeforeHookEvent, buildAfterHookEvent } from '../lifecycle.js'
import { VERSION } from '../version.js'
import { renderExample } from './test/render-example.js'
import type { EventName } from '../types/branded.js'
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

export async function runHarness(hookFile: string, opts: { input?: string }): Promise<void> {
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

  // Mirror `src/loader.ts:144-146`: production loadHook merges
  // `meta.config` defaults with clooks.yml overrides. The harness has no
  // overrides (no `--config` flag in v1), so just forward the defaults.
  const config = (hook.meta.config ?? {}) as Record<string, unknown>

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
    configPath: '/tmp/clooks-test-no-config.yml',
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
    // Without this, Commander's greedy positional binding would swallow the
    // literal "example" before the subcommand router gets a chance to fire.
    // See PLAN-FEAT-0067 Decision Log.

    .action(async (hookFile: string | undefined, opts: { input?: string }) => {
      if (hookFile === undefined) {
        process.stderr.write(
          'clooks test: missing required argument <hook-file>. ' +
            'Run `clooks test example <Event>` to see an example payload, ' +
            'or `clooks test --help` for usage.\n',
        )
        process.exit(HARNESS_USAGE_EXIT)
      }
      await runHarness(hookFile, opts)
    })

  // `clooks test example <Event>` — prints prose-and-JSON documentation for
  // the named event. The 4 tool-keyed events additionally inline all 10
  // built-in tools' `toolInput` shapes.
  //
  // Commander rejects unknown options on its own — no defensive `--tool`
  // handling needed here. See PLAN-FEAT-0067 Decision Log.
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
