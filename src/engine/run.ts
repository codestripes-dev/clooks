import { homedir } from 'os'
import { join } from 'path'
import type { EventName, HookName } from '../types/branded.js'
import { loadConfig } from '../config/index.js'
import type { LoadConfigResult } from '../config/index.js'
import { loadAllHooks } from '../loader.js'
import { INJECTABLE_EVENTS } from '../config/constants.js'
import { DEFAULT_MAX_FAILURES } from '../config/constants.js'
import {
  getFailurePath,
  readFailures,
  writeFailures,
  recordFailure,
  clearFailure,
  getFailureCount,
  LOAD_ERROR_EVENT,
} from '../failures.js'
import { discoverProjectRoot } from '../config/discovery.js'
import type { RunEngineDeps } from './types.js'
import { EXIT_OK, EXIT_STDERR } from './types.js'
import { matchHooksForEvent, buildShadowWarnings } from './match.js'
import { executeHooks } from './execute.js'
import { pruneHandoffFiles } from './handoff.js'
import {
  applyTurnBoundary,
  createTurnTracker,
  pruneTurnState,
  readTurnState,
  turnScopeKey,
  turnStatePath,
} from './turn-state.js'
import type { TurnState, TurnTracker } from './turn-state.js'
import {
  AgentSelectionError,
  UnsupportedAgentAdapterError,
  selectAgentAdapter,
} from '../agents/index.js'
import type { AgentAdapter, TranslatedAgentOutput } from '../agents/index.js'
import { claudeCodePluginDeps } from '../agents/claude-code/adapter.js'

/**
 * Sentinel keys for config-error circuit breaker.
 * Config errors have no hook identity, so we use synthetic keys
 * in the same FailureState structure that hook failures use.
 */
const CONFIG_ERROR_HOOK = '__config__' as HookName
const CONFIG_ERROR_EVENT = '__parse__' as EventName

export const defaultDeps: RunEngineDeps = {
  loadConfig,
  loadAllHooks,
  readStdin: () => Bun.stdin.json(),
  discoverPluginPacks: claudeCodePluginDeps.discoverPluginPacks,
  vendorAndRegisterPack: claudeCodePluginDeps.vendorAndRegisterPack,
  discoverProjectRoot,
}

function emitTranslatedOutput(translated: TranslatedAgentOutput): void {
  if (translated.stderr) {
    process.stderr.write(`${translated.stderr}\n`)
  }

  if (translated.output) {
    process.stdout.write(translated.output + '\n')
  }
}

/**
 * Engine entry point used by src/cli.ts when stdin is piped and no CLI args
 * are present.
 */
export async function runEngine(deps: RunEngineDeps = defaultDeps): Promise<void> {
  try {
    const adapter = selectAgentAdapter()
    if (!adapter.supportsRuntime) {
      throw new UnsupportedAgentAdapterError(adapter.id)
    }
    await runEngineCore(adapter, deps)
  } catch (e: unknown) {
    if (e instanceof AgentSelectionError || e instanceof UnsupportedAgentAdapterError) {
      process.stderr.write(`${e.message}\n`)
      process.exit(EXIT_STDERR)
    }

    const message = e instanceof Error ? e.message : String(e)
    process.stderr.write(`clooks: fatal error: ${message}\n`)
    process.exit(EXIT_STDERR)
  }
}

export async function runEngineCore(
  adapter: AgentAdapter,
  deps: RunEngineDeps = defaultDeps,
): Promise<void> {
  const discovery = await (deps.discoverProjectRoot ?? discoverProjectRoot)()
  const projectRoot = discovery.projectRoot
  const homeRoot = process.env.CLOOKS_HOME_ROOT ?? homedir()

  // Config errors use a circuit breaker: block the first N invocations so
  // the agent sees the error, then degrade to warn-only to prevent deadlock.
  // Config errors are stored in the project's .clooks/.failures (if .clooks/ exists)
  // or in the home failures directory. Since a config error means .clooks/clooks.yml
  // exists but is invalid, .clooks/ is guaranteed to exist.
  const configFailurePath = join(projectRoot, '.clooks/.failures')
  let result: LoadConfigResult | null
  try {
    result = await deps.loadConfig(projectRoot, { homeRoot })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    let state = await readFailures(configFailurePath)
    state = recordFailure(state, CONFIG_ERROR_HOOK, CONFIG_ERROR_EVENT, message)
    await writeFailures(configFailurePath, state)
    const failCount = getFailureCount(state, CONFIG_ERROR_HOOK, CONFIG_ERROR_EVENT)

    if (failCount < DEFAULT_MAX_FAILURES) {
      process.stderr.write(`clooks: ${message}\n`)
      process.exit(EXIT_STDERR)
    }

    process.stderr.write(
      `clooks: config error (degraded after ${failCount} consecutive failures): ${message}\n`,
    )
    emitTranslatedOutput(
      adapter.translateFinalOutput({
        eventName: CONFIG_ERROR_EVENT,
        systemMessages: [
          `[clooks] Config validation failed ${failCount} consecutive times. ` +
            `Hooks are disabled to prevent deadlock. Fix .clooks/clooks.yml: ${message}`,
        ],
        diagnostics: [],
      }),
    )
    process.exit(EXIT_OK)
  }

  if (result === null) {
    // Read only enough stdin to decide whether the no-config advisory should
    // be shown; malformed stdin should not turn "no hooks configured" into a failure.
    if (discovery.signal === 'cwd-fallback') {
      let earlyInput: unknown
      try {
        earlyInput = await deps.readStdin()
      } catch {
        earlyInput = null
      }
      if (earlyInput !== null && typeof earlyInput === 'object' && !Array.isArray(earlyInput)) {
        const earlyPayload = earlyInput as Record<string, unknown>
        if (adapter.readEventName(earlyPayload) === 'SessionStart') {
          const boundary = discovery.boundary ?? 'fs-root'
          const boundaryPath = discovery.boundaryPath ?? '/'
          process.stderr.write(
            `clooks: no .clooks/clooks.yml found walking up from ${discovery.from} (bounded by ${boundary} at ${boundaryPath})\n`,
          )
        }
      }
    }
    process.exit(EXIT_OK)
  }

  const configState = await readFailures(configFailurePath)
  if (getFailureCount(configState, CONFIG_ERROR_HOOK, CONFIG_ERROR_EVENT) > 0) {
    const cleared = clearFailure(configState, CONFIG_ERROR_HOOK, CONFIG_ERROR_EVENT)
    await writeFailures(configFailurePath, cleared)
  }

  let config = result!.config
  let shadows = result!.shadows
  const hasProjectConfig = result!.hasProjectConfig

  const failurePath = getFailurePath(projectRoot, homeRoot, hasProjectConfig)

  const pluginSystemMessages: string[] = []
  const danglingWarnings: string[] = []
  const prepared = await adapter.prepareConfigAfterLoad({
    projectRoot,
    homeRoot,
    config,
    shadows,
    loadConfig: deps.loadConfig,
    discoverPluginPacks: deps.discoverPluginPacks,
    vendorAndRegisterPack: deps.vendorAndRegisterPack,
  })
  config = prepared.config
  shadows = prepared.shadows
  pluginSystemMessages.push(...prepared.systemMessages)

  const debug = process.env.CLOOKS_DEBUG === 'true'
  const engineDebugLines: string[] = []
  const {
    loaded: hooks,
    loadErrors,
    dangling = [],
  } = await deps.loadAllHooks(config, projectRoot, homeRoot)

  if (debug) {
    engineDebugLines.push(
      `loaded ${hooks.length} hook(s): ${hooks.map((h) => h.name).join(', ') || '(none)'}`,
    )
    for (const err of loadErrors) {
      engineDebugLines.push(`load error: ${err.name} — ${err.error}`)
    }
    for (const d of dangling) {
      engineDebugLines.push(`dangling: ${d.name} — ${d.resolvedPath}`)
    }
  }

  for (const d of dangling) {
    const configFile = d.origin === 'home' ? '~/.clooks/clooks.yml' : '.clooks/clooks.yml'
    danglingWarnings.push(
      `[clooks] Hook "${d.name}" skipped — file not found: ${d.resolvedPath}. ` +
        `Remove from ${configFile} or reinstall. Run \`clooks config --resolved\` for details.`,
    )
  }

  // Dangling hooks never execute, so stale load-error failures should not keep them quarantined.
  if (dangling.length > 0) {
    let failureState = await readFailures(failurePath)
    let cleared = false
    for (const d of dangling) {
      if (getFailureCount(failureState, d.name, LOAD_ERROR_EVENT) > 0) {
        failureState = clearFailure(failureState, d.name, LOAD_ERROR_EVENT)
        cleared = true
      }
    }
    if (cleared) {
      await writeFailures(failurePath, failureState)
    }
  }

  // Parsed here (before the hooks-empty early-exit) so that eventName is
  // available for SessionStart-gated advisory emission below, even in the
  // "no hooks configured at all" case (e.g. pure enable-without-install drift).
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
  const eventName = adapter.readEventName(payload)

  if (eventName === null) {
    process.stderr.write('clooks: stdin payload missing or unrecognized hook_event_name field\n')
    process.exit(EXIT_STDERR)
  }

  // Normalized here, before the early exits, so the turn boundary below can
  // read a session identity the adapter owns rather than a raw wire key.
  // `normalizeContext` is a pure transform, and this same object is reused at
  // the executeHooks call site — the payload is never normalized twice.
  const normalized = adapter.normalizeContext(payload, eventName)

  // Runs before the hooks-empty/no-match early exits so a project with no
  // SessionStart hooks still prunes. A prune failure never affects the run.
  if (eventName === 'SessionStart') {
    await pruneHandoffFiles(projectRoot).catch(() => {})
  }

  // Turn state is meaningless without a session identity, and inventing a
  // fallback would silently merge unrelated sessions into one history. No
  // identity means no boundary, no snapshot, no recording, and an empty
  // ctx.turn for every hook in this invocation.
  const sessionId =
    typeof normalized.sessionId === 'string' && normalized.sessionId.length > 0
      ? normalized.sessionId
      : null
  const turnPath = sessionId === null ? null : turnStatePath(homeRoot, sessionId)

  // Post-boundary state, kept so the snapshot step below does not read the
  // file a second time.
  let boundaryState: TurnState | null = null

  // Placed before both early exits for the same reason the handoff prune is: a
  // project with no UserPromptSubmit hooks must still get its turn boundary, or
  // every dedup hook goes permanently silent after its first intervention.
  if (turnPath !== null) {
    if (eventName === 'SessionStart') {
      await pruneTurnState(homeRoot).catch(() => {})
      // Unrecognized sources take the non-destructive branch, so a future
      // upstream source value cannot start clearing turns by accident.
      const source = normalized.source
      if (source === 'startup' || source === 'clear') {
        boundaryState = await applyTurnBoundary(turnPath, homeRoot, 'reset').catch(() => null)
      }
    } else if (eventName === 'UserPromptSubmit') {
      boundaryState = await applyTurnBoundary(turnPath, homeRoot, 'advance').catch(() => null)
    }
  }

  // Gate the cwd-fallback warning to SessionStart so it appears once per session,
  // not once per tool call.
  if (
    eventName === 'SessionStart' &&
    discovery.signal === 'cwd-fallback' &&
    !result.hasProjectConfig
  ) {
    const boundary = discovery.boundary ?? 'fs-root'
    const boundaryPath = discovery.boundaryPath ?? '/'
    process.stderr.write(
      `clooks: no .clooks/clooks.yml found walking up from ${discovery.from} (bounded by ${boundary} at ${boundaryPath})\n`,
    )
  }

  if (eventName === 'SessionStart') {
    pluginSystemMessages.push(
      ...adapter.collectSessionStartAdvisories({
        homeRoot,
        projectRoot,
      }),
    )
  }

  if (hooks.length === 0 && loadErrors.length === 0) {
    const earlyMessages = [...pluginSystemMessages, ...danglingWarnings]
    if (earlyMessages.length > 0) {
      emitTranslatedOutput(
        adapter.translateFinalOutput({
          eventName,
          systemMessages: earlyMessages,
          diagnostics: [],
        }),
      )
    }
    if (debug) {
      for (const line of engineDebugLines) {
        process.stderr.write(`[clooks:debug] ${line}\n`)
      }
    }
    process.exit(EXIT_OK)
  }

  const { matched, disabledSkips } = matchHooksForEvent(hooks, eventName, config)

  if (debug) {
    for (const skip of disabledSkips) {
      engineDebugLines.push(skip.reason)
    }
    engineDebugLines.push(
      `event="${eventName}" matched ${matched.length} hook(s): ${matched.map((h) => h.name).join(', ') || '(none)'}`,
    )
  }

  // Computed before the early exit so warnings are emitted even when
  // no hooks match the current event.
  const startupWarnings: string[] = buildShadowWarnings(eventName, shadows)

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
    const earlyMessages = [...pluginSystemMessages, ...danglingWarnings, ...startupWarnings]
    if (earlyMessages.length > 0) {
      emitTranslatedOutput(
        adapter.translateFinalOutput({
          eventName,
          systemMessages: earlyMessages,
          diagnostics: [],
        }),
      )
    }
    if (debug) {
      for (const line of engineDebugLines) {
        process.stderr.write(`[clooks:debug] ${line}\n`)
      }
    }
    process.exit(EXIT_OK)
  }

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

  const disabledNames = new Set<HookName>()
  for (const s of disabledSkips) disabledNames.add(s.hook)

  // Built after the no-match exit, so no snapshot is read when nothing will
  // run. A boundary above already produced the post-boundary state; reuse it
  // rather than reading the file again.
  let turnTracker: TurnTracker | undefined
  if (turnPath !== null) {
    try {
      turnTracker = createTurnTracker({
        path: turnPath,
        homeRoot,
        state: boundaryState ?? (await readTurnState(turnPath)),
        scopeKey: turnScopeKey(eventName, normalized),
      })
    } catch {
      // Turn state degrades to empty rather than affecting the run.
      turnTracker = undefined
    }
  }

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
    projectRoot,
    loadErrors,
    disabledNames,
    turnTracker,
  )
  let lastResult = initialResult

  // Preserve injection order when multiple engine-level diagnostics are added.
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

  if (debug) {
    const allDebug = [...engineDebugLines, ...debugMessages]
    for (const line of allDebug) {
      process.stderr.write(`[clooks:debug] ${line}\n`)
    }

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

  const adjusted = adapter.adjustResultBeforeFinalOutput({
    eventName,
    context: normalized,
    result: lastResult,
  })
  lastResult = adjusted.result
  systemMessages.push(...adjusted.systemMessages)

  if (lastResult === undefined) {
    const allSystemMessages = [
      ...pluginSystemMessages,
      ...danglingWarnings,
      ...startupWarnings,
      ...systemMessages,
    ]
    if (allSystemMessages.length > 0) {
      emitTranslatedOutput(
        adapter.translateFinalOutput({
          eventName,
          systemMessages: allSystemMessages,
          diagnostics: [],
        }),
      )
    }
    process.exit(EXIT_OK)
  }

  const allSystemMessages = [
    ...pluginSystemMessages,
    ...danglingWarnings,
    ...startupWarnings,
    ...systemMessages,
  ]
  const translated = adapter.translateFinalOutput({
    eventName,
    result: lastResult,
    systemMessages: allSystemMessages,
    diagnostics: [],
  })

  emitTranslatedOutput(translated)

  if (translated.exitCode !== EXIT_OK) {
    process.exit(translated.exitCode)
  }

  process.exitCode = EXIT_OK
}
