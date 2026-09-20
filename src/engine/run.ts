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
import { matchHooksForEvent, buildShadowWarnings, buildUnknownAgentWarnings } from './match.js'
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
import { createApprovalInteraction } from '../interaction/channel.js'
import type { ApprovalInteraction } from '../interaction/types.js'
import { canonical, checkSignal, nativePreToolUseDenialSchema } from '../interaction/protocol.js'
import { ApprovalFailure, confirmFinalApprovals, approvalSetupMessage } from './live-approvals.js'
import { legacyResultPolicy } from './result-policy.js'
import { createContextHelpers } from '../plugin-file-helper.js'

interface InvocationState {
  eventName: EventName | null
  invocation?: NormalizedInvocation
  rawReadAttempted: boolean
  rawInput?: unknown
  rawReadError?: unknown
  interaction?: ApprovalInteraction
  interactionError?: unknown
  output?: TranslatedAgentOutput
  /**
   * Warnings collected so far, in the order the success path emits them. Kept
   * on the state so the failure exits outside the invocation can still reach
   * them.
   */
  systemMessages: string[]
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
  createContextHelpers,
  discoverPluginPacks: claudeCodePluginDeps.discoverPluginPacks,
  discoverCodexPluginPacks,
  vendorAndRegisterPack: claudeCodePluginDeps.vendorAndRegisterPack,
  discoverProjectRoot,
}

function writeOutput(stream: NodeJS.WriteStream, text: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    stream.write(text, (error) => (error ? reject(error) : resolve()))
  })
}

async function emitTranslatedOutput(translated: TranslatedAgentOutput): Promise<ExitCode> {
  if (translated.stderr) {
    await writeOutput(process.stderr, `${translated.stderr}\n`)
  }

  if (translated.output) {
    await writeOutput(process.stdout, translated.output + '\n')
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
  let lifecycleClosed = false
  const closeApprovalLifecycle = () => {
    if (lifecycleClosed) return
    deps.onApprovalLifecycle?.(false)
    lifecycleClosed = true
  }
  try {
    await runEngineCoreOwned(adapter, deps, closeApprovalLifecycle)
  } finally {
    closeApprovalLifecycle()
  }
}

async function runEngineCoreOwned(
  adapter: AgentAdapter,
  deps: RunEngineDeps,
  closeApprovalLifecycle: () => void,
): Promise<void> {
  const state: InvocationState = {
    eventName: null,
    rawReadAttempted: false,
    systemMessages: [],
  }
  let exitCode: ExitCode | undefined
  try {
    checkSignal(deps.signal)
    await runEngineInvocation(adapter, deps, state)
  } catch (error) {
    if (error instanceof EngineCompletion) {
      exitCode = error.code
    } else if (
      deps.signal?.aborted ||
      adapter.inputStage === 'before-hooks' ||
      error instanceof ApprovalFailure
    ) {
      const failure =
        error instanceof InvocationPolicyError
          ? error.failure
          : {
              eventName: state.eventName,
              capability: error instanceof ApprovalFailure ? 'approval' : 'runtime',
              message:
                error instanceof ApprovalFailure && error.decision
                  ? error.message
                  : `clooks: runtime failure: ${error instanceof Error ? error.message : String(error)}`,
              ...(error instanceof ApprovalFailure && error.decision
                ? { approvalDecision: error.decision }
                : {}),
            }
      state.output = adapter.translateFailure({
        eventName: state.eventName,
        invocation: state.invocation,
        failure,
        systemMessages: state.systemMessages,
      })
      exitCode = state.output.exitCode
    } else {
      throw error
    }
  } finally {
    try {
      await state.interaction?.close()
    } catch (error) {
      state.output = adapter.translateFailure({
        eventName: state.eventName,
        invocation: state.invocation,
        failure: {
          eventName: state.eventName,
          capability: 'approval-close',
          message: `clooks: approval completion failed: ${error instanceof Error ? error.message : String(error)}`,
        },
        systemMessages: state.systemMessages,
      })
      exitCode = state.output.exitCode
    }
  }
  if (deps.signal?.aborted) {
    state.output = adapter.translateFailure({
      eventName: state.eventName,
      invocation: state.invocation,
      failure: {
        eventName: state.eventName,
        capability: 'cancelled',
        message: 'clooks: invocation cancelled',
      },
      systemMessages: state.systemMessages,
    })
    exitCode = state.output.exitCode
  }
  closeApprovalLifecycle()
  if (state.output?.approvalDecision && state.output.exitCode === EXIT_OK)
    process.exitCode = EXIT_OK
  if (state.output) {
    await emitTranslatedOutput(state.output)
    if (
      state.output.exitCode === EXIT_OK &&
      state.output.output &&
      state.output.approvalDecision &&
      state.interaction?.acknowledgeDenial
    ) {
      let parsed: unknown
      try {
        parsed = JSON.parse(state.output.output)
      } catch {
        parsed = undefined
      }
      const nativeDenial = nativePreToolUseDenialSchema.safeParse(parsed)
      if (nativeDenial.success) {
        try {
          await state.interaction.acknowledgeDenial(
            state.output.approvalDecision,
            nativeDenial.data,
          )
        } catch {
          // The command denial is already on stdout. Missing ack keeps MCP fail-closed.
        }
      }
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
    checkSignal(deps.signal)
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
    checkSignal(deps.signal)
    return state.rawInput
  }
  const emitFinalOutput = async (translated: TranslatedAgentOutput): Promise<ExitCode> => {
    checkSignal(deps.signal)
    state.output = translated
    return translated.exitCode
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
    state.invocation = adapter.normalizeInvocation(payload, state.eventName)
    return state.invocation
  }
  // Pair before discovery/config/imports so every early exit completes its native check.
  const suppressed = process.env.CLOOKS_APPROVAL_DISPOSITION === 'suppressed'
  if (
    process.env.CLOOKS_APPROVAL_OWNER !== undefined ||
    process.env.CLOOKS_APPROVAL_PROTOCOL !== undefined ||
    process.env.CLOOKS_APPROVAL_DISPOSITION !== undefined
  ) {
    try {
      const raw = await readRawOnce()
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
        throw new Error('Invalid paired input')
      state.eventName = adapter.readEventName(raw as Record<string, unknown>)
      if (state.eventName === 'PreToolUse') {
        const disposition = process.env.CLOOKS_APPROVAL_DISPOSITION ?? 'run'
        if (disposition !== 'run' && disposition !== 'suppressed')
          throw new Error('Invalid approval disposition')
        const identity = adapter.approvalIdentity(
          raw as Record<string, unknown>,
          process.env.CLOOKS_APPROVAL_OWNER ?? '',
          process.env.CLOOKS_APPROVAL_PROTOCOL ?? '',
        )
        deps.onApprovalLifecycle?.(true)
        state.interaction = await (deps.createApprovalInteraction ?? createApprovalInteraction)({
          identity,
          disposition,
          signal: deps.signal,
        })
        checkSignal(deps.signal)
        if (disposition === 'suppressed') finishEngine(await emitFinalOutput({ exitCode: EXIT_OK }))
      }
    } catch (error) {
      if (error instanceof EngineCompletion) throw error
      checkSignal(deps.signal)
      state.interactionError = error
      if (suppressed)
        throw new ApprovalFailure(
          `clooks: suppressed invocation could not publish completion: ${error instanceof Error ? error.message : String(error)}`,
        )
    }
  }
  const discovery = await (deps.discoverProjectRoot ?? discoverProjectRoot)({
    env: adapter.discoveryEnvironment(process.env),
  })
  checkSignal(deps.signal)
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
    checkSignal(deps.signal)
    result = await deps.loadConfig(projectRoot, { homeRoot })
  } catch (e) {
    checkSignal(deps.signal)
    const message = e instanceof Error ? e.message : String(e)
    const earlyInvocation =
      adapter.inputStage === 'before-hooks' ? await readInvocation() : undefined
    let configFailures = await readFailures(configFailurePath)
    configFailures = recordFailure(configFailures, CONFIG_ERROR_HOOK, CONFIG_ERROR_EVENT, message)
    await writeFailures(configFailurePath, configFailures)
    const failCount = getFailureCount(configFailures, CONFIG_ERROR_HOOK, CONFIG_ERROR_EVENT)
    // The only warning this path produces. It predates the accumulators below,
    // so it goes straight onto the state, where a later close failure or
    // cancellation can still deliver it.
    const degradedConfigWarning =
      `[clooks] Config validation failed ${failCount} consecutive times. ` +
      `Hooks are disabled to prevent deadlock. Fix .clooks/clooks.yml: ${message}`

    if (earlyInvocation) {
      const invocation = earlyInvocation
      if (failCount < DEFAULT_MAX_FAILURES) {
        throw new InvocationPolicyError({
          eventName: invocation.eventName,
          capability: 'config',
          message: `config validation failed: ${message}; hooks were not imported or executed.`,
        })
      }
      state.systemMessages = [degradedConfigWarning]
      finishEngine(
        await emitFinalOutput(
          adapter.translateFinalOutput({
            eventName: invocation.eventName,
            invocation,
            systemMessages: state.systemMessages,
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
    state.systemMessages = [degradedConfigWarning]
    const exitCode = await emitFinalOutput(
      adapter.translateFinalOutput({
        eventName: CONFIG_ERROR_EVENT,
        systemMessages: state.systemMessages,
        diagnostics: [],
      }),
    )
    finishEngine(exitCode)
  }
  checkSignal(deps.signal)

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
  checkSignal(deps.signal)
  if (getFailureCount(configState, CONFIG_ERROR_HOOK, CONFIG_ERROR_EVENT) > 0) {
    const cleared = clearFailure(configState, CONFIG_ERROR_HOOK, CONFIG_ERROR_EVENT)
    await writeFailures(configFailurePath, cleared)
  }
  checkSignal(deps.signal)

  let config = result!.config
  let shadows = result!.shadows
  let hasProjectConfig = result!.hasProjectConfig

  // Warnings accumulate in these four lists, in the order the success path
  // emits them. `publishWarnings` copies whatever has been collected onto the
  // invocation state, which is the only place the failure exits outside this
  // function can read them from. It is called whenever a list becomes final
  // and before anything that can end the invocation.
  const pluginSystemMessages: string[] = []
  const danglingWarnings: string[] = []
  const startupWarnings: string[] = []
  let executionMessages: string[] = []
  const publishWarnings = (): string[] => {
    state.systemMessages = [
      ...pluginSystemMessages,
      ...danglingWarnings,
      ...startupWarnings,
      ...executionMessages,
    ]
    return state.systemMessages
  }
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
  // Published before the cancellation check: preparation has already returned
  // these, so a cancellation here must not discard them.
  pluginSystemMessages.push(...prepared.systemMessages)
  publishWarnings()
  checkSignal(deps.signal)
  config = prepared.config
  shadows = prepared.shadows
  hasProjectConfig = prepared.hasProjectConfig ?? hasProjectConfig
  const failurePath = getFailureLocation(projectRoot, homeRoot, hasProjectConfig, adapter.id)

  const debug = process.env.CLOOKS_DEBUG === 'true'
  const engineDebugLines: string[] = []
  const {
    loaded: hooks,
    loadErrors,
    dangling = [],
  } = await deps.loadAllHooks(config, projectRoot, homeRoot)
  checkSignal(deps.signal)

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
  publishWarnings()

  // A clean import proves the file is healthy, whether or not the hook goes on
  // to run, so its load-error counter is cleared here rather than after
  // matching: a hook with no handler for this event, or one excluded for this
  // agent, would otherwise keep a stale count and degrade early on its next
  // real failure. Dangling hooks never execute at all. Runs before load errors
  // are processed, and before both early exits below.
  const importedNames = [...hooks.map((h) => h.name), ...dangling.map((d) => d.name)]
  if (importedNames.length > 0) {
    let failureState = await readFailures(failurePath)
    let cleared = false
    for (const name of importedNames) {
      if (getFailureCount(failureState, name, LOAD_ERROR_EVENT) > 0) {
        failureState = clearFailure(failureState, name, LOAD_ERROR_EVENT)
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
  checkSignal(deps.signal)
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

    // Turn boundaries need normalized session identity even when no hooks match.
    invocation = adapter.normalizeInvocation(payload, eventName)
    state.invocation = invocation
    state.eventName = eventName
  }
  const eventName = invocation.eventName
  const normalized: Record<string, unknown> = {
    ...invocation.context,
    agent: adapter.id,
    helpers: (deps.createContextHelpers ?? createContextHelpers)({
      agent: adapter.id,
      homeRoot,
      codexHome: process.env.CODEX_HOME,
      cwd: typeof invocation.context.cwd === 'string' ? invocation.context.cwd : '',
    }),
  }
  const adapterPolicy = adapter.createResultPolicy(invocation)
  const policy = {
    ...adapterPolicy,
    mutableToolInput: adapterPolicy === legacyResultPolicy || adapterPolicy.mutableToolInput,
    approvalOperation: (input: unknown, changed: boolean) =>
      adapter.approvalOperation(invocation, input, changed),
  }
  const interaction = state.interaction ?? {
    async request() {
      const scope = process.env.CLOOKS_APPROVAL_OWNER === 'global' ? '--global ' : ''
      const repair = process.env.CLOOKS_APPROVAL_OWNER
        ? `Run clooks init ${scope}--agent ${adapter.id} in the registered scope, then restart the client.`
        : approvalSetupMessage
      return {
        kind: 'unavailable' as const,
        message: `${repair}${state.interactionError ? ` (${state.interactionError instanceof Error ? state.interactionError.message : String(state.interactionError)})` : ''}`,
      }
    },
    async close() {},
  }

  // Runs before the hooks-empty/no-match early exits so a project with no
  // SessionStart hooks still prunes. A prune failure never affects the run.
  if (eventName === 'SessionStart') {
    await pruneHandoffFiles(projectRoot).catch(() => {})
  }

  // A fallback identity would merge unrelated sessions; disable turn state instead.
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

  // Advance turn state even without matching hooks, or dedup history never resets.
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
    publishWarnings()
  }

  // Independent of matching, so a config whose only agents list is a future id
  // still warns when no hook is registered or none matches.
  const unknownAgentWarnings = buildUnknownAgentWarnings(eventName, config, hooks)

  if (hooks.length === 0 && loadErrors.length === 0) {
    // Terminal: the shadow warnings below never run, so this is the whole
    // startup list for this path.
    startupWarnings.push(...unknownAgentWarnings)
    const exitCode = await emitFinalOutput(
      adapter.translateFinalOutput({
        eventName,
        invocation,
        systemMessages: publishWarnings(),
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

  const { matched, disabledSkips, agentSkips } = matchHooksForEvent(
    hooks,
    eventName,
    config,
    adapter.id,
  )
  const agentSkippedNames = new Set<HookName>(agentSkips.map((s) => s.hook))

  if (debug) {
    for (const skip of [...disabledSkips, ...agentSkips]) {
      engineDebugLines.push(skip.reason)
    }
    engineDebugLines.push(
      `event="${eventName}" matched ${matched.length} hook(s): ${matched.map((h) => h.name).join(', ') || '(none)'}`,
    )
  }

  // Computed before the early exit so warnings are emitted even when
  // no hooks match the current event.
  startupWarnings.push(...buildShadowWarnings(eventName, shadows), ...unknownAgentWarnings)

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
  // Startup assembly is complete apart from the trace advisories below, which
  // read hook properties and can therefore throw.
  publishWarnings()

  if (matched.length === 0 && loadErrors.length === 0) {
    const exitCode = await emitFinalOutput(
      adapter.translateFinalOutput({
        eventName,
        invocation,
        systemMessages: publishWarnings(),
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
    if (agentSkippedNames.has(loaded.name)) continue
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

  // Ordering treats agent-excluded, disabled, and import-failed names alike:
  // an `order:` list naming any of them stays valid instead of throwing.
  const disabledNames = new Set<HookName>(agentSkippedNames)
  for (const s of disabledSkips) disabledNames.add(s.hook)
  for (const e of loadErrors) disabledNames.add(e.name)

  // Built after the no-match exit, so no snapshot is read when nothing will
  // run. A boundary above already produced the post-boundary state; reuse it
  // rather than reading the file again.
  let turnTracker: TurnTracker | undefined
  if (turnPath !== null && turnPolicy !== null) {
    try {
      turnTracker = createTurnTracker({
        path: turnPath,
        homeRoot,
        agent: adapter.id,
        state: boundaryState ?? (await readTurnState(turnPath, { homeRoot, agent: adapter.id })),
        scopeKey: turnPolicy.scopeKey,
      })
    } catch {
      // Turn state degrades to empty rather than affecting the run.
      turnTracker = undefined
    }
  }

  // Startup warnings are final here; publish them before hooks run so a crash,
  // a refused approval, or a cancellation during execution can still deliver them.
  publishWarnings()

  checkSignal(deps.signal)
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
    interaction,
    deps.signal,
  )
  const { degradedMessages, debugMessages, traceMessages, systemMessages, policyFailure } =
    execution
  // Published before composition, which can throw, and again after it.
  executionMessages = systemMessages
  publishWarnings()
  const initialResult = execution.lastResult
  // Composition runs before the cancellation check because it is a pure
  // translation and it is what turns a degradation notice into a user-facing
  // message: leaving it after the check would discard that notice whenever a
  // later hook cancelled the invocation. Only what the adapter returns as
  // system messages is published; its stderr and context lines are not.
  const composed = adapter.composeDiagnostics({
    eventName,
    result: initialResult,
    traceMessages,
    degradedMessages,
    debugMessages: debug ? [...engineDebugLines, ...debugMessages] : [],
  })
  systemMessages.push(...composed.systemMessages)
  publishWarnings()
  checkSignal(deps.signal)
  for (const line of composed.stderr) process.stderr.write(`${line}\n`)
  let lastResult = composed.result

  const adjusted = adapter.adjustResultBeforeFinalOutput({
    eventName,
    context: normalized,
    result: lastResult,
  })
  lastResult = adjusted.result
  systemMessages.push(...adjusted.systemMessages)

  const allSystemMessages = publishWarnings()
  let translated: TranslatedAgentOutput
  try {
    translated = policyFailure
      ? adapter.translateFailure({
          eventName,
          invocation,
          failure: policyFailure,
          systemMessages: allSystemMessages,
        })
      : adapter.translateFinalOutput({
          eventName,
          invocation,
          policyFailure,
          result: lastResult,
          systemMessages: allSystemMessages,
          diagnostics: [],
        })

    if (
      eventName === 'PreToolUse' &&
      !policyFailure &&
      (initialResult?.result === 'block' || execution.preToolUse?.approvals.length)
    ) {
      const operation = adapter.serializedApprovalOperation(invocation, translated)
      if (initialResult?.result === 'block' && operation !== null)
        throw new Error('Final output removed a denial')
      if (operation !== null && execution.preToolUse?.approvals.length) {
        await confirmFinalApprovals(
          execution,
          state.interaction,
          operation,
          deps.signal ?? new AbortController().signal,
        )
        if (
          canonical(adapter.serializedApprovalOperation(invocation, translated)) !==
          canonical(operation)
        )
          throw new Error('Final approval operation changed')
      }
    }
  } catch (error) {
    if (execution.preToolUse?.approvals.length) {
      if (error instanceof ApprovalFailure) throw error
      throw new ApprovalFailure(error instanceof Error ? error.message : String(error))
    }
    throw error
  }
  await emitFinalOutput(translated)

  if (translated.exitCode !== EXIT_OK || lastResult === undefined) {
    finishEngine(translated.exitCode)
  }

  process.exitCode = EXIT_OK
}
