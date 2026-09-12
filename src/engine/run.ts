import { homedir } from 'os'
import { join } from 'path'
import type { EventName, HookName } from '../types/branded.js'
import { loadConfig } from '../config/index.js'
import type { LoadConfigResult } from '../config/index.js'
import { loadAllHooks } from '../loader.js'
import { INJECTABLE_EVENTS } from '../config/constants.js'
import { DEFAULT_MAX_FAILURES } from '../config/constants.js'
import {
  getFailureLocation,
  readFailures,
  writeFailures,
  recordFailure,
  clearFailure,
  getFailureCount,
  LOAD_ERROR_EVENT,
} from '../failures.js'
import { discoverProjectRoot } from '../config/discovery.js'
import type { RunEngineDeps, ExitCode } from './types.js'
import { EXIT_OK, EXIT_STDERR } from './types.js'
import { formatStdinError, readStdinJson } from './stdin.js'
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
  InvocationPolicyError,
  selectAgentAdapter,
} from '../agents/index.js'
import type {
  AgentAdapter,
  TranslatedAgentOutput,
  NormalizedInvocation,
  InvocationTurnPolicy,
} from '../agents/index.js'
import { claudeCodePluginDeps } from '../agents/claude-code/adapter.js'
import { discoverCodexPluginPacks } from '../agents/codex/plugin-discovery.js'
import { ApprovalStore } from '../agents/codex/approval-store.js'
import {
  prepareApprovalAttempt,
  captureApprovalPipeline,
  resolveApprovals,
  validateApprovalOutput,
  type ApprovalAttempt,
  type ApprovalPermit,
} from '../agents/codex/approvals.js'

interface InvocationState {
  eventName: EventName | null
  invocation?: NormalizedInvocation
  rawReadAttempted: boolean
  rawInput?: unknown
  rawReadError?: unknown
  approvalAttempt?: ApprovalAttempt
}

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
  readStdin: readStdinJson,
  discoverPluginPacks: claudeCodePluginDeps.discoverPluginPacks,
  discoverCodexPluginPacks,
  vendorAndRegisterPack: claudeCodePluginDeps.vendorAndRegisterPack,
  discoverProjectRoot,
}

function emitTranslatedOutput(translated: TranslatedAgentOutput): ExitCode {
  if (translated.stderr) {
    process.stderr.write(`${translated.stderr}\n`)
  }

  if (translated.output) {
    process.stdout.write(translated.output + '\n')
  }
  return translated.exitCode
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
  const state: InvocationState = {
    eventName: null,
    rawReadAttempted: false,
  }
  let exitCode: ExitCode | undefined
  try {
    await runEngineInvocation(adapter, deps, state)
  } catch (error) {
    if (error instanceof EngineCompletion) {
      exitCode = error.code
    } else if (adapter.inputStage === 'before-hooks') {
      const failure =
        error instanceof InvocationPolicyError
          ? error.failure
          : {
              eventName: state.eventName,
              capability: 'runtime',
              message: `clooks: runtime failure: ${error instanceof Error ? error.message : String(error)}`,
            }
      exitCode = emitTranslatedOutput(
        adapter.translateFailure({
          eventName: state.eventName,
          invocation: state.invocation,
          failure,
        }),
      )
    } else {
      throw error
    }
  }
  if (exitCode !== undefined) process.exit(exitCode)
}

class EngineCompletion {
  constructor(readonly code: ExitCode) {}
}

function finishEngine(code: ExitCode): never {
  throw new EngineCompletion(code)
}

async function runEngineInvocation(
  adapter: AgentAdapter,
  deps: RunEngineDeps,
  state: InvocationState,
): Promise<void> {
  const readRawOnce = async (): Promise<unknown> => {
    if (!state.rawReadAttempted) {
      state.rawReadAttempted = true
      try {
        state.rawInput = await deps.readStdin()
      } catch (error) {
        state.rawReadError = error
        throw error
      }
    }
    if (Object.hasOwn(state, 'rawReadError')) throw state.rawReadError
    return state.rawInput
  }
  const approvalStore = adapter.id === 'codex' ? new ApprovalStore() : undefined
  const emitFinalOutput = async (
    translated: TranslatedAgentOutput,
    permit?: ApprovalPermit,
    eligible = true,
  ): Promise<ExitCode> => {
    if (
      approvalStore &&
      eligible &&
      translated.exitCode === EXIT_OK &&
      (state.eventName === null || state.eventName === 'PreToolUse')
    ) {
      const output = translated.output ? JSON.parse(translated.output) : {}
      const denied =
        output.hookSpecificOutput?.permissionDecision === 'deny' ||
        output.continue === false ||
        output.decision === 'block'
      const identifyEvent = async () => {
        if (state.eventName === null) {
          const raw = await readRawOnce()
          if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
            throw new Error('Cannot identify invocation for approval retirement')
          state.eventName = adapter.readEventName(raw as Record<string, unknown>)
          if (state.eventName === null)
            throw new Error('Cannot identify event for approval retirement')
        }
      }
      // Check existence before reading otherwise-unused stdin on early success paths.
      let existing = false
      if (!denied && !permit) {
        try {
          existing = approvalStore.exists()
        } catch (error) {
          await identifyEvent()
          if (state.eventName === 'PreToolUse') throw error
        }
      }
      if (!denied && (permit || existing)) {
        await identifyEvent()
        if (state.eventName === 'PreToolUse') {
          const attempt = state.approvalAttempt ?? prepareApprovalAttempt(await readRawOnce())
          if (permit) validateApprovalOutput(attempt, permit, translated)
          approvalStore.finalizePermit(
            attempt.baseInvocationHash,
            permit?.expectedDecisionHash ?? null,
            permit?.requiredTokens ?? [],
          )
        }
      }
    }
    return emitTranslatedOutput(translated)
  }
  const readInvocation = async (): Promise<NormalizedInvocation> => {
    if (state.invocation) return state.invocation
    let input: unknown
    try {
      input = await readRawOnce()
    } catch (error) {
      throw new InvocationPolicyError({
        eventName: null,
        capability: 'stdin',
        message: formatStdinError(error),
      })
    }
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      throw new InvocationPolicyError({
        eventName: null,
        capability: 'stdin',
        message: 'clooks: stdin payload is not a JSON object',
      })
    }
    const payload = input as Record<string, unknown>
    state.eventName = adapter.readEventName(payload)
    if (state.eventName === null) {
      throw new InvocationPolicyError({
        eventName: null,
        capability: 'event',
        message: 'clooks: stdin payload missing or unrecognized hook_event_name field',
      })
    }
    if (adapter.id === 'codex' && state.eventName === 'PreToolUse') {
      try {
        state.approvalAttempt = prepareApprovalAttempt(payload)
      } catch (error) {
        // Preserve existing envelope diagnostics; only valid envelopes get carrier errors.
        adapter.normalizeInvocation(payload, state.eventName)
        throw new InvocationPolicyError({
          eventName: state.eventName,
          capability: 'approval-input',
          message: `${error instanceof Error ? error.message : String(error)}; hooks were not imported or executed.`,
        })
      }
    }
    // Normalization clones carrier-free raw input; native execution retains its original
    // prefix unless the reducer actually emits a replacement.
    state.invocation = adapter.normalizeInvocation(
      state.approvalAttempt?.payload ?? payload,
      state.eventName,
    )
    return state.invocation
  }
  const discovery = await (deps.discoverProjectRoot ?? discoverProjectRoot)({
    env: adapter.discoveryEnvironment(process.env),
  })
  const projectRoot = discovery.projectRoot
  const homeRoot = process.env.CLOOKS_HOME_ROOT ?? homedir()

  // Config errors use a circuit breaker: block the first N invocations so
  // the agent sees the error, then degrade to warn-only to prevent deadlock.
  // Config errors are stored in the project's .clooks/.failures (if .clooks/ exists)
  // or in the home failures directory. Since a config error means .clooks/clooks.yml
  // exists but is invalid, .clooks/ is guaranteed to exist.
  const hasProjectFile =
    join(projectRoot, '.clooks/clooks.yml') !== join(homeRoot, '.clooks/clooks.yml') &&
    (await Bun.file(join(projectRoot, '.clooks/clooks.yml')).exists())
  const configFailurePath = getFailureLocation(
    projectRoot,
    homeRoot,
    hasProjectFile,
    adapter.id,
    true,
  )
  let result: LoadConfigResult | null
  try {
    result = await deps.loadConfig(projectRoot, { homeRoot })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const earlyInvocation =
      adapter.inputStage === 'before-hooks' ? await readInvocation() : undefined
    let state = await readFailures(configFailurePath)
    state = recordFailure(state, CONFIG_ERROR_HOOK, CONFIG_ERROR_EVENT, message)
    await writeFailures(configFailurePath, state)
    const failCount = getFailureCount(state, CONFIG_ERROR_HOOK, CONFIG_ERROR_EVENT)

    if (earlyInvocation) {
      const invocation = earlyInvocation
      if (failCount < DEFAULT_MAX_FAILURES) {
        throw new InvocationPolicyError({
          eventName: invocation.eventName,
          capability: 'config',
          message: `config validation failed: ${message}; hooks were not imported or executed.`,
        })
      }
      finishEngine(
        await emitFinalOutput(
          adapter.translateFinalOutput({
            eventName: invocation.eventName,
            invocation,
            systemMessages: [
              `[clooks] Config validation failed ${failCount} consecutive times. Hooks are disabled to prevent deadlock. Fix .clooks/clooks.yml: ${message}`,
            ],
            diagnostics: [],
          }),
        ),
      )
    }

    if (failCount < DEFAULT_MAX_FAILURES) {
      process.stderr.write(`clooks: ${message}\n`)
      finishEngine(EXIT_STDERR)
    }

    process.stderr.write(
      `clooks: config error (degraded after ${failCount} consecutive failures): ${message}\n`,
    )
    const exitCode = await emitFinalOutput(
      adapter.translateFinalOutput({
        eventName: CONFIG_ERROR_EVENT,
        systemMessages: [
          `[clooks] Config validation failed ${failCount} consecutive times. ` +
            `Hooks are disabled to prevent deadlock. Fix .clooks/clooks.yml: ${message}`,
        ],
        diagnostics: [],
      }),
    )
    finishEngine(exitCode)
  }

  if (result === null) {
    // Read only enough stdin to decide whether the no-config advisory should
    // be shown; malformed stdin should not turn "no hooks configured" into a failure.
    if (discovery.signal === 'cwd-fallback') {
      let earlyInput: unknown
      try {
        earlyInput = await readRawOnce()
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
    finishEngine(await emitFinalOutput({ exitCode: EXIT_OK }))
  }

  if (adapter.inputStage === 'before-hooks') await readInvocation()

  const configState = await readFailures(configFailurePath)
  if (getFailureCount(configState, CONFIG_ERROR_HOOK, CONFIG_ERROR_EVENT) > 0) {
    const cleared = clearFailure(configState, CONFIG_ERROR_HOOK, CONFIG_ERROR_EVENT)
    await writeFailures(configFailurePath, cleared)
  }

  let config = result!.config
  let shadows = result!.shadows
  let hasProjectConfig = result!.hasProjectConfig

  const pluginSystemMessages: string[] = []
  const danglingWarnings: string[] = []
  const prepared = await adapter.prepareConfigAfterLoad({
    projectRoot,
    homeRoot,
    codexHome: process.env.CODEX_HOME,
    hasProjectConfig,
    config,
    shadows,
    loadConfig: deps.loadConfig,
    discoverPluginPacks: deps.discoverPluginPacks,
    discoverCodexPluginPacks: deps.discoverCodexPluginPacks,
    vendorAndRegisterPack: deps.vendorAndRegisterPack,
  })
  config = prepared.config
  shadows = prepared.shadows
  hasProjectConfig = prepared.hasProjectConfig ?? hasProjectConfig
  const failurePath = getFailureLocation(projectRoot, homeRoot, hasProjectConfig, adapter.id)
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
  let invocation = state.invocation
  if (!invocation) {
    let input: unknown
    try {
      input = await readRawOnce()
    } catch (e) {
      process.stderr.write(`${formatStdinError(e)}\n`)
      finishEngine(EXIT_STDERR)
    }

    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      process.stderr.write('clooks: stdin payload is not a JSON object\n')
      finishEngine(EXIT_STDERR)
    }

    const payload = input as Record<string, unknown>
    const eventName = adapter.readEventName(payload)

    if (eventName === null) {
      process.stderr.write('clooks: stdin payload missing or unrecognized hook_event_name field\n')
      finishEngine(EXIT_STDERR)
    }

    // Normalized here, before the early exits, so the turn boundary below can
    // read a session identity the adapter owns rather than a raw wire key.
    // `normalizeInvocation` is a pure transform, and this same object is reused at
    // the executeHooks call site — the payload is never normalized twice.
    invocation = adapter.normalizeInvocation(payload, eventName)
    state.invocation = invocation
    state.eventName = eventName
  }
  const eventName = invocation.eventName
  const normalized: Record<string, unknown> = { ...invocation.context, provider: adapter.id }
  const policy = adapter.createResultPolicy(invocation)

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
  const legacyTurnPolicy: InvocationTurnPolicy | null =
    sessionId === null
      ? null
      : {
          sessionId,
          scopeKey: turnScopeKey(eventName, normalized),
          boundary:
            eventName === 'SessionStart' &&
            (normalized.source === 'startup' || normalized.source === 'clear')
              ? 'reset'
              : eventName === 'UserPromptSubmit'
                ? 'advance'
                : null,
          prune: eventName === 'SessionStart',
        }
  const turnPolicy = adapter.resolveTurnPolicy
    ? adapter.resolveTurnPolicy(invocation)
    : legacyTurnPolicy
  const turnPath =
    turnPolicy === null ? null : turnStatePath(homeRoot, turnPolicy.sessionId, adapter.id)

  // Post-boundary state, kept so the snapshot step below does not read the
  // file a second time.
  let boundaryState: TurnState | null = null

  // Placed before both early exits for the same reason the handoff prune is: a
  // project with no UserPromptSubmit hooks must still get its turn boundary, or
  // every dedup hook goes permanently silent after its first intervention.
  if (turnPath !== null && turnPolicy !== null) {
    if (turnPolicy.prune) await pruneTurnState(homeRoot, adapter.id).catch(() => {})
    if (turnPolicy.boundary !== null) {
      boundaryState = await applyTurnBoundary(
        turnPath,
        homeRoot,
        turnPolicy.boundary,
        adapter.id,
      ).catch(() => null)
    }
  }

  // Gate the cwd-fallback warning to SessionStart so it appears once per session,
  // not once per tool call.
  if (eventName === 'SessionStart' && discovery.signal === 'cwd-fallback' && !hasProjectConfig) {
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
        codexHome: process.env.CODEX_HOME,
        discoverCodexPluginPacks: deps.discoverCodexPluginPacks,
      }),
    )
  }

  if (hooks.length === 0 && loadErrors.length === 0) {
    const earlyMessages = [...pluginSystemMessages, ...danglingWarnings]
    const exitCode = await emitFinalOutput(
      adapter.translateFinalOutput({
        eventName,
        invocation,
        systemMessages: earlyMessages,
        diagnostics: [],
      }),
    )
    if (debug) {
      for (const line of engineDebugLines) {
        process.stderr.write(`[clooks:debug] ${line}\n`)
      }
    }
    finishEngine(exitCode)
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
    const exitCode = await emitFinalOutput(
      adapter.translateFinalOutput({
        eventName,
        invocation,
        systemMessages: earlyMessages,
        diagnostics: [],
      }),
    )
    if (debug) {
      for (const line of engineDebugLines) {
        process.stderr.write(`[clooks:debug] ${line}\n`)
      }
    }
    finishEngine(exitCode)
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
  if (turnPath !== null && turnPolicy !== null) {
    try {
      turnTracker = createTurnTracker({
        path: turnPath,
        homeRoot,
        provider: adapter.id,
        state: boundaryState ?? (await readTurnState(turnPath, { homeRoot, provider: adapter.id })),
        scopeKey: turnPolicy.scopeKey,
      })
    } catch {
      // Turn state degrades to empty rather than affecting the run.
      turnTracker = undefined
    }
  }

  const execution = await executeHooks(
    matched,
    eventName,
    normalized,
    config,
    failurePath,
    projectRoot,
    loadErrors,
    disabledNames,
    turnTracker,
    policy,
  )
  const { degradedMessages, debugMessages, traceMessages, systemMessages, policyFailure } =
    execution
  let initialResult = execution.lastResult
  let approvalPermit: ApprovalPermit | undefined
  if (
    approvalStore &&
    state.approvalAttempt &&
    !policyFailure &&
    initialResult?.result !== 'block'
  ) {
    const hasAsks =
      execution.preToolUse?.votes.some((vote) => vote.engineResult.result === 'ask') ||
      initialResult?.result === 'ask'
    if (hasAsks || state.approvalAttempt.presentedTokens.length > 0) {
      const pipeline =
        hasAsks && execution.preToolUse?.completed
          ? await captureApprovalPipeline(matched, config, disabledNames)
          : { global: config.global, event: config.events.PreToolUse ?? null, hooks: [] }
      const resolved = resolveApprovals(
        state.approvalAttempt,
        invocation,
        execution,
        pipeline,
        approvalStore,
      )
      initialResult = resolved.result
      approvalPermit = resolved.permit
    }
  }
  const composed = adapter.composeDiagnostics({
    eventName,
    result: initialResult,
    traceMessages,
    degradedMessages,
    debugMessages: debug ? [...engineDebugLines, ...debugMessages] : [],
  })
  for (const line of composed.stderr) process.stderr.write(`${line}\n`)
  systemMessages.push(...composed.systemMessages)
  let lastResult = composed.result

  const adjusted = adapter.adjustResultBeforeFinalOutput({
    eventName,
    context: normalized,
    result: lastResult,
  })
  lastResult = adjusted.result
  systemMessages.push(...adjusted.systemMessages)

  const allSystemMessages = [
    ...pluginSystemMessages,
    ...danglingWarnings,
    ...startupWarnings,
    ...systemMessages,
  ]
  const translated = policyFailure
    ? adapter.translateFailure({ eventName, invocation, failure: policyFailure })
    : adapter.translateFinalOutput({
        eventName,
        invocation,
        policyFailure,
        result: lastResult,
        systemMessages: allSystemMessages,
        diagnostics: [],
      })

  if (
    state.approvalAttempt &&
    initialResult?.result === 'block' &&
    JSON.parse(translated.output ?? '{}').hookSpecificOutput?.permissionDecision !== 'deny'
  ) {
    throw new Error('Final output removed a pending Codex denial')
  }
  await emitFinalOutput(
    translated,
    approvalPermit,
    !policyFailure && initialResult?.result !== 'block',
  )

  if (translated.exitCode !== EXIT_OK || lastResult === undefined) {
    finishEngine(translated.exitCode)
  }

  process.exitCode = EXIT_OK
}
