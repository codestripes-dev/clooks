import { homedir } from 'os'
import type { EventName, HookName } from '../types/branded.js'
import type { ClaudeCodeOutput } from '../types/claude-code.js'
import { normalizeKeys } from '../normalize.js'
import { loadConfig } from '../config/index.js'
import type { LoadConfigResult } from '../config/index.js'
import { loadAllHooks } from '../loader.js'
import { INJECTABLE_EVENTS, isEventName } from '../config/constants.js'
import { getFailurePath } from '../failures.js'
import type { RunEngineDeps } from './types.js'
import { EXIT_OK, EXIT_STDERR } from './types.js'
import { matchHooksForEvent, buildShadowWarnings } from './match.js'
import { executeHooks } from './execute.js'
import { translateResult } from './translate.js'

export const defaultDeps: RunEngineDeps = {
  loadConfig,
  loadAllHooks,
  readStdin: () => Bun.stdin.json(),
}

/**
 * Main engine entry point. Reads stdin, loads hooks from config, runs matching
 * hooks, and writes output. Called by src/cli.ts when no CLI flags are present.
 */
export async function runEngine(deps: RunEngineDeps = defaultDeps): Promise<void> {
  try {
    const projectRoot = process.cwd()
    const homeRoot = process.env.CLOOKS_HOME_ROOT ?? homedir()

    // --- Load config (optional — no config = no hooks) ---
    let result: LoadConfigResult | null
    try {
      result = await deps.loadConfig(projectRoot, { homeRoot })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      process.stderr.write(`clooks: ${message}\n`)
      process.exit(EXIT_STDERR)
    }

    if (result === null) {
      process.exit(EXIT_OK)
    }

    const config = result!.config
    const shadows = result!.shadows
    const hasProjectConfig = result!.hasProjectConfig

    // --- Compute failure path once ---
    const failurePath = getFailurePath(projectRoot, homeRoot, hasProjectConfig)

    // --- Load all hooks (fault-tolerant — load errors go through circuit breaker) ---
    const debug = process.env.CLOOKS_DEBUG === 'true'
    const engineDebugLines: string[] = []
    const { loaded: hooks, loadErrors } = await deps.loadAllHooks(config, projectRoot, homeRoot)

    if (debug) {
      engineDebugLines.push(
        `loaded ${hooks.length} hook(s): ${hooks.map((h) => h.name).join(', ') || '(none)'}`,
      )
      for (const err of loadErrors) {
        engineDebugLines.push(`load error: ${err.name} — ${err.error}`)
      }
    }

    if (hooks.length === 0 && loadErrors.length === 0) {
      if (debug) {
        for (const line of engineDebugLines) {
          process.stderr.write(`[clooks:debug] ${line}\n`)
        }
      }
      process.exit(EXIT_OK)
    }

    // --- Read and parse stdin ---
    let input: unknown
    try {
      input = await deps.readStdin()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      process.stderr.write(`clooks: failed to parse stdin JSON: ${message}\n`)
      process.exit(EXIT_STDERR)
    }

    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      process.stderr.write('clooks: stdin payload is not a JSON object\n')
      process.exit(EXIT_STDERR)
    }

    const payload = input as Record<string, unknown>
    const rawEventName = payload.hook_event_name

    if (typeof rawEventName !== 'string' || !isEventName(rawEventName)) {
      process.stderr.write('clooks: stdin payload missing or unrecognized hook_event_name field\n')
      process.exit(EXIT_STDERR)
    }
    const eventName: EventName = rawEventName

    // --- Match hooks for this event ---
    const { matched, disabledSkips } = matchHooksForEvent(hooks, eventName, config)

    if (debug) {
      for (const skip of disabledSkips) {
        engineDebugLines.push(skip.reason)
      }
      engineDebugLines.push(
        `event="${eventName}" matched ${matched.length} hook(s): ${matched.map((h) => h.name).join(', ') || '(none)'}`,
      )
    }

    // --- Shadow warnings (SessionStart only) ---
    // Computed before the early exit so warnings are emitted even when
    // no hooks match the current event.
    const startupWarnings: string[] = buildShadowWarnings(eventName, shadows)

    // --- Startup validation: warn about disabled hooks in order lists ---
    for (const [eventKey, eventEntry] of Object.entries(config.events)) {
      if (eventEntry?.order) {
        for (const hookName of eventEntry.order) {
          const hookEntry = config.hooks[hookName]
          if (!hookEntry) continue
          if (hookEntry.enabled === false) {
            startupWarnings.push(
              `clooks: event "${eventKey}" order references hook "${hookName}" which is disabled (enabled: false)`,
            )
          } else if (hookEntry.events?.[eventKey as EventName]?.enabled === false) {
            startupWarnings.push(
              `clooks: event "${eventKey}" order references hook "${hookName}" which has enabled: false for ${eventKey}`,
            )
          }
        }
      }
    }

    // --- Startup validation: warn about enabled: false on events the hook doesn't handle ---
    for (const loaded of hooks) {
      const hookEntry = config.hooks[loaded.name]
      if (!hookEntry?.events) continue
      for (const [evKey, evOverride] of Object.entries(hookEntry.events)) {
        if (evOverride?.enabled === false) {
          const handlesEvent =
            typeof (loaded.hook as unknown as Record<string, unknown>)[evKey] === 'function'
          if (!handlesEvent) {
            startupWarnings.push(
              `clooks: hook "${loaded.name}" events.${evKey} has enabled: false, but hook does not handle event "${evKey}"`,
            )
          }
        }
      }
    }

    if (matched.length === 0 && loadErrors.length === 0) {
      if (startupWarnings.length > 0) {
        const output: ClaudeCodeOutput = { systemMessage: startupWarnings.join('\n') }
        process.stdout.write(JSON.stringify(output) + '\n')
      }
      if (debug) {
        for (const line of engineDebugLines) {
          process.stderr.write(`[clooks:debug] ${line}\n`)
        }
      }
      process.exit(EXIT_OK)
    }

    // --- Normalize payload ---
    const normalized = normalizeKeys(payload)
    normalized.event = normalized.hookEventName
    delete normalized.hookEventName

    // --- Startup validation: warn about hook-level trace on non-injectable events ---
    for (const loaded of hooks) {
      const hookEntry = config.hooks[loaded.name]
      if (hookEntry?.onError === 'trace' && !INJECTABLE_EVENTS.has(eventName)) {
        const handlesEvent =
          typeof (loaded.hook as unknown as Record<string, unknown>)[eventName] === 'function'
        if (handlesEvent) {
          startupWarnings.push(
            `Hook "${loaded.name}" has onError: "trace" but ${eventName} ` +
              `does not support additionalContext. Trace will fall back to "continue" for ${eventName}.`,
          )
        }
      }
    }

    // --- Execute hooks with circuit breaker ---
    const disabledNames = new Set<HookName>()
    for (const s of disabledSkips) disabledNames.add(s.hook)
    // lastResult is separated from the const destructuring because it's reassigned
    // below when injecting trace/degraded/debug context into additionalContext.
    const {
      lastResult: initialResult,
      degradedMessages,
      debugMessages,
      traceMessages,
      systemMessages,
    } = await executeHooks(
      matched,
      eventName,
      normalized,
      config,
      failurePath,
      loadErrors,
      disabledNames,
    )
    let lastResult = initialResult

    // --- Handle trace messages (from onError: "trace" hooks) ---
    // Injected first so additionalContext order is: trace → degraded → debug
    if (traceMessages.length > 0 && INJECTABLE_EVENTS.has(eventName)) {
      const traceBlock = traceMessages.join('\n')
      if (lastResult === undefined) {
        lastResult = { result: 'allow', injectContext: traceBlock }
      } else {
        const existing =
          typeof lastResult.injectContext === 'string' ? lastResult.injectContext + '\n' : ''
        lastResult.injectContext = existing + traceBlock
      }
    }

    // --- Handle degraded hook messages ---
    if (degradedMessages.length > 0) {
      if (INJECTABLE_EVENTS.has(eventName)) {
        if (lastResult === undefined) {
          lastResult = { result: 'allow', injectContext: degradedMessages.join('\n') }
        } else {
          const existing =
            typeof lastResult.injectContext === 'string' ? lastResult.injectContext + '\n' : ''
          lastResult.injectContext = existing + degradedMessages.join('\n')
        }
      } else {
        for (const msg of degradedMessages) {
          process.stderr.write(`clooks: warning: ${msg}\n`)
        }
      }
    }

    // --- Merge engine-level and hook-level debug lines ---
    if (debug) {
      const allDebug = [...engineDebugLines, ...debugMessages]
      // Always write to stderr for external visibility
      for (const line of allDebug) {
        process.stderr.write(`[clooks:debug] ${line}\n`)
      }

      // Inject into additionalContext so Claude can read it
      if (allDebug.length > 0) {
        const debugBlock = allDebug.map((l) => `[clooks:debug] ${l}`).join('\n')
        if (lastResult === undefined) {
          lastResult = { result: 'allow', injectContext: debugBlock }
        } else {
          const existing =
            typeof lastResult.injectContext === 'string' ? lastResult.injectContext + '\n' : ''
          lastResult.injectContext = existing + debugBlock
        }
      }
    }

    // --- Translate and output ---
    if (lastResult === undefined) {
      // Even with no hook results, we may have system messages to deliver
      const allSystemMessages = [...startupWarnings, ...systemMessages]
      if (allSystemMessages.length > 0) {
        const output: ClaudeCodeOutput = { systemMessage: allSystemMessages.join('\n') }
        process.stdout.write(JSON.stringify(output) + '\n')
      }
      process.exit(EXIT_OK)
    }

    const translated = translateResult(eventName, lastResult)

    // --- Inject systemMessage into translated output ---
    const allSystemMessages = [...startupWarnings, ...systemMessages]
    if (allSystemMessages.length > 0) {
      const systemMessage = allSystemMessages.join('\n')
      if (translated.output) {
        const parsed = JSON.parse(translated.output) as ClaudeCodeOutput
        parsed.systemMessage = systemMessage
        translated.output = JSON.stringify(parsed)
      } else {
        translated.output = JSON.stringify({ systemMessage } as ClaudeCodeOutput)
      }
    }

    if (translated.stderr) {
      process.stderr.write(`${translated.stderr}\n`)
    }

    if (translated.output) {
      process.stdout.write(translated.output + '\n')
    }

    if (translated.exitCode !== EXIT_OK) {
      process.exit(translated.exitCode)
    }

    process.exitCode = EXIT_OK
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    process.stderr.write(`clooks: fatal error: ${message}\n`)
    process.exit(EXIT_STDERR)
  }
}
