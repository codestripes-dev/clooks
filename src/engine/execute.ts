import type { EventName, HookName } from '../types/branded.js'
import type { ClooksConfig, ErrorMode } from '../config/schema.js'
import type { LoadedHook, HookLoadError } from '../loader.js'
import { INJECTABLE_EVENTS, NOTIFY_ONLY_EVENTS } from '../config/constants.js'
import {
  readFailures,
  writeFailures,
  recordFailure,
  clearFailure,
  getFailureCount,
  LOAD_ERROR_EVENT,
} from '../failures.js'
import { orderHooksForEvent, partitionIntoGroups } from '../ordering.js'
import type { ExecutionGroup } from '../ordering.js'
import { runHookLifecycle, LifecycleMetaCache } from '../lifecycle.js'
import type { LifecycleResult } from '../lifecycle.js'
import type {
  AcceptedPreToolUseVote,
  EngineResult,
  ExecutionResult,
  PreToolUseVote,
} from './types.js'
import type { InvocationResultPolicy, ResultOrigin, RuntimePolicyFailure } from '../agents/types.js'
import { checkDetachedResult, legacyResultPolicy } from './result-policy.js'
import { applyHandoff } from './handoff.js'
import { decisionForResult, emptyTurn, warnTurnStateOnce } from './turn-state.js'
import type { TurnTracker } from './turn-state.js'
import type { FailureLocation } from '../failures.js'
import type { TurnContext, TurnDecision } from '../types/turn.js'
import { cloneDeep, omitBy, isNull } from 'lodash-es'

// --- PreToolUse vote collector types and helpers ---

export function rankPreToolUseResult(r: EngineResult): number {
  switch (r.result) {
    case 'block':
      return 3
    case 'defer':
      return 2
    case 'ask':
      return 1
    case 'allow':
      return 0
    case 'skip':
      return -1
    default:
      return -1 // defensive; shouldn't happen given type narrowing
  }
}

export function reducePreToolUseVotes(
  votes: PreToolUseVote[],
  mergedToolInput?: Record<string, unknown>,
): {
  result?: EngineResult
  warnings: string[]
} {
  if (votes.length === 0) return { warnings: [] }

  // Pick the max-rank winner. For equal ranks, the last-seen wins
  // (execution order), matching today's last-non-skip semantics for
  // rank ties — ask/ask, allow/allow, etc.
  let winner = votes[0]!
  for (const v of votes.slice(1)) {
    if (v.rank >= winner.rank) winner = v
  }

  const warnings: string[] = []
  const losers = votes.filter((v) => v !== winner)

  // Accumulate from losers per the per-winner context-accumulation rules.
  const accumulatedContext: string[] = []
  const hasLoserUpdatedInput = losers.some((l) => l.engineResult.updatedInput !== undefined)
  const hasLoserContext = losers.some(
    (l) =>
      typeof l.engineResult.injectContext === 'string' && l.engineResult.injectContext.length > 0,
  )

  if (winner.engineResult.result === 'block') {
    // Deny: keep accumulated context from the winner itself + allow/ask losers only.
    // Block-result losers must NOT contribute context.
    // Iterate in vote (execution) order to preserve context ordering.
    for (const v of votes) {
      const isWinner = v === winner
      const isAllowOrAskLoser =
        !isWinner && (v.engineResult.result === 'allow' || v.engineResult.result === 'ask')
      if (isWinner || isAllowOrAskLoser) {
        if (
          typeof v.engineResult.injectContext === 'string' &&
          v.engineResult.injectContext.length > 0
        ) {
          accumulatedContext.push(v.engineResult.injectContext)
        }
      }
    }
    const merged: EngineResult = { ...winner.engineResult }
    if (accumulatedContext.length > 0) merged.injectContext = accumulatedContext.join('\n')
    delete merged.updatedInput
    return { result: merged, warnings }
  }

  if (winner.engineResult.result === 'defer') {
    // Defer: drop updatedInput / additionalContext / reason entirely.
    // The returned object is a fresh minimal {result: 'defer'} so any
    // fields the winner carried via `as any` cast (the type system
    // forbids them on DeferResult but a cast escape hatch is possible
    // at runtime) are silently stripped here. This is intentional —
    // upstream ignores all such fields and emitting them would be
    // wire-noise. No systemMessage is emitted for winner-side drops
    // since the type system is the primary guard.
    //
    // Loser-side drops DO emit systemMessage warnings — those are
    // legitimate author-returned fields on allow/ask hooks that lose
    // to the defer vote. Making the drop visible prevents silent
    // misconfiguration (e.g. "my audit context never reaches Claude").
    if (hasLoserUpdatedInput) {
      warnings.push(
        'clooks: defer wins but one or more PreToolUse hooks returned updatedInput — upstream Claude Code ignores updatedInput for defer; dropping.',
      )
    }
    if (hasLoserContext) {
      warnings.push(
        'clooks: defer wins but one or more PreToolUse hooks returned additionalContext / injectContext — upstream Claude Code ignores additionalContext for defer; dropping.',
      )
    }
    return { result: { result: 'defer' }, warnings }
  }

  if (winner.engineResult.result === 'ask') {
    // Ask: keep context from winner + allow losers. The `mergedToolInput`
    // argument carries the authoritative full-shape merged input; the raw
    // `updatedInput` fields on votes are partial patches and must not be
    // emitted directly.
    const hasAnyUpdatedInput =
      winner.engineResult.updatedInput !== undefined ||
      losers.some(
        (l) => l.engineResult.result === 'allow' && l.engineResult.updatedInput !== undefined,
      )
    // Iterate in vote (execution) order: collect context from winner and allow losers only.
    // Ask-loser context must NOT contribute.
    for (const v of votes) {
      const isWinner = v === winner
      const isAllowLoser = !isWinner && v.engineResult.result === 'allow'
      if (isWinner || isAllowLoser) {
        if (
          typeof v.engineResult.injectContext === 'string' &&
          v.engineResult.injectContext.length > 0
        ) {
          accumulatedContext.push(v.engineResult.injectContext)
        }
      }
    }
    const merged: EngineResult = { ...winner.engineResult }
    if (accumulatedContext.length > 0) merged.injectContext = accumulatedContext.join('\n')
    // The spread above carries the winner's raw partial patch onto `merged`;
    // overwrite or strip so only the full-shape merged input reaches the wire.
    if (hasAnyUpdatedInput && mergedToolInput) {
      merged.updatedInput = mergedToolInput
    } else {
      delete merged.updatedInput
    }
    return { result: merged, warnings }
  }

  if (winner.engineResult.result === 'allow') {
    // Allow: accumulate context from all allow hooks in vote (execution) order.
    // Iterate votes in order to preserve execution-order context sequencing.
    for (const v of votes) {
      if (v.engineResult.result === 'allow') {
        if (
          typeof v.engineResult.injectContext === 'string' &&
          v.engineResult.injectContext.length > 0
        ) {
          accumulatedContext.push(v.engineResult.injectContext)
        }
      }
    }
    const merged: EngineResult = { ...winner.engineResult }
    if (accumulatedContext.length > 0) merged.injectContext = accumulatedContext.join('\n')
    // Same spread-carries-partial-patch concern as the ask branch above.
    const hasAnyUpdatedInput =
      winner.engineResult.updatedInput !== undefined ||
      votes.some(
        (v) =>
          v !== winner &&
          v.engineResult.result === 'allow' &&
          v.engineResult.updatedInput !== undefined,
      )
    if (hasAnyUpdatedInput && mergedToolInput) {
      merged.updatedInput = mergedToolInput
    } else {
      delete merged.updatedInput
    }
    return { result: merged, warnings }
  }

  // skip — only reached when every hook skipped
  return { result: winner.engineResult, warnings }
}

// --- Turn-state bookkeeping, isolated from control flow ---
//
// Turn state must never change what a hook decided or whether the next hook
// runs. The production tracker already swallows its own failures, but this is
// the engine's hook-execution choke point and the guarantee belongs here too:
// relying on a callee's internal discipline makes it depend on a property of
// another function that a future edit could remove with no signal at this end.

function turnTrackerFailed(e: unknown): void {
  warnTurnStateOnce(`turn state bookkeeping failed (${e instanceof Error ? e.message : String(e)})`)
}

function safeMaterializeTurn(
  tracker: TurnTracker | undefined,
  hookName: HookName,
  eventName: EventName,
): TurnContext {
  if (!tracker) return emptyTurn()
  try {
    return tracker.materialize(hookName, eventName)
  } catch (e) {
    turnTrackerFailed(e)
    return emptyTurn()
  }
}

function safeRecordTurn(
  tracker: TurnTracker | undefined,
  hookName: HookName,
  eventName: EventName,
  decision: TurnDecision,
): void {
  if (!tracker) return
  try {
    tracker.record(hookName, eventName, decision)
  } catch (e) {
    turnTrackerFailed(e)
  }
}

async function safeCommitTurn(tracker: TurnTracker | undefined): Promise<void> {
  if (!tracker) return
  try {
    await tracker.commit()
  } catch (e) {
    turnTrackerFailed(e)
  }
}

function resolveMaxFailures(
  hookName: HookName,
  config: ClooksConfig,
): { maxFailures: number; maxFailuresMessage: string } {
  const hookEntry = config.hooks[hookName]
  return {
    maxFailures: hookEntry?.maxFailures ?? config.global.maxFailures,
    maxFailuresMessage: hookEntry?.maxFailuresMessage ?? config.global.maxFailuresMessage,
  }
}

export function interpolateMessage(
  template: string,
  vars: { hook: HookName; event: EventName; count: number; error: string },
): string {
  return template
    .replace(/\{hook\}/g, () => vars.hook)
    .replace(/\{event\}/g, () => vars.event)
    .replace(/\{count\}/g, () => String(vars.count))
    .replace(/\{error\}/g, () => vars.error)
}

/**
 * Resolves the effective onError mode for a hook+event pair via cascade:
 * hook+event → hook → global → "block" (default).
 */
export function resolveOnError(
  hookName: HookName,
  eventName: EventName,
  config: ClooksConfig,
): ErrorMode {
  const hookEntry = config.hooks[hookName]
  const hookEventOverride = hookEntry?.events?.[eventName]?.onError
  if (hookEventOverride !== undefined) return hookEventOverride

  const hookLevel = hookEntry?.onError
  if (hookLevel !== undefined) return hookLevel

  return config.global.onError
}

export function formatDiagnostic(
  hookName: HookName,
  eventName: EventName,
  error: unknown,
  mode: ErrorMode,
  usesTarget?: string,
  resolvedPath?: string,
): string {
  const errorType = error instanceof Error ? error.constructor.name : 'Error'
  const firstLine =
    error instanceof Error
      ? (error.message.split('\n')[0] ?? error.message)
      : (String(error).split('\n')[0] ?? String(error))
  const action = mode === 'block' ? 'Action blocked' : 'Continuing'
  const usesInfo =
    usesTarget !== undefined ? ` (uses: ${usesTarget}, ${resolvedPath ?? 'unknown'})` : ''
  return `[clooks] Hook "${hookName}"${usesInfo} failed on ${eventName} (${errorType}: ${firstLine}). ${action} (onError: ${mode}).`
}

export function formatTraceMessage(
  hookName: HookName,
  error: unknown,
  usesTarget?: string,
  resolvedPath?: string,
): string {
  const errorType = error instanceof Error ? error.constructor.name : 'Error'
  const firstLine =
    error instanceof Error
      ? (error.message.split('\n')[0] ?? error.message)
      : (String(error).split('\n')[0] ?? String(error))
  const usesInfo =
    usesTarget !== undefined ? ` (uses: ${usesTarget}, ${resolvedPath ?? 'unknown'})` : ''
  return `Hook "${hookName}"${usesInfo} errored: ${errorType}: ${firstLine}. Configured as onError: trace — action not affected.`
}

function resolveTimeout(hookName: HookName, config: ClooksConfig): number {
  return config.hooks[hookName]?.timeout ?? config.global.timeout
}

/**
 * Runs matched hooks with circuit breaker logic.
 * Also processes load errors through the circuit breaker — a hook that
 * fails to import is treated as a failure for the current event.
 * Extracted from runEngine() for testability.
 */
export async function executeHooks(
  matched: LoadedHook[],
  eventName: EventName,
  normalized: Record<string, unknown>,
  config: ClooksConfig,
  failurePath: FailureLocation,
  handoffRoot: string,
  loadErrors: HookLoadError[] = [],
  disabledNames?: Set<HookName>,
  turnTracker?: TurnTracker,
  policy: InvocationResultPolicy = legacyResultPolicy,
): Promise<ExecutionResult> {
  const debug = process.env.CLOOKS_DEBUG === 'true'
  const debugMessages: string[] = []
  const degradedMessages: string[] = []
  const traceMessages: string[] = []
  const systemMessages: string[] = []
  let inlineHandoffReported = false
  const reportInlineHandoff = (message: string) => {
    if (inlineHandoffReported) return
    inlineHandoffReported = true
    systemMessages.push(message)
  }
  let lastResult: EngineResult | undefined
  let policyFailure: RuntimePolicyFailure | undefined
  let effectsOpen = true
  const collectPreToolUseVotes =
    eventName === 'PreToolUse' && policy.collectPreToolUseVotes === true
  const acceptedVotes: AcceptedPreToolUseVote[] = []
  let executionFailed = loadErrors.length > 0
  const rejectUnreadableResult = (hookName: HookName) => {
    policyFailure ??= {
      eventName,
      hookName,
      capability: 'result-policy',
      message: `clooks: result policy failed for hook "${hookName}" on ${eventName}; result effects refused.`,
    }
    effectsOpen = false
  }
  const recorded = new Set<HookName>()
  const recordRaw = (name: HookName, value: unknown, failed = false) => {
    if (failed) executionFailed = true
    if (recorded.has(name)) return
    recorded.add(name)
    let decision: TurnDecision = 'error'
    try {
      const malformed =
        value != null && (typeof value !== 'object' || Array.isArray(value) || !('result' in value))
      if (!failed && !malformed) decision = decisionForResult(value)
    } catch {
      // Dynamic hook values can throw while their raw outcome is inspected.
      rejectUnreadableResult(name)
    }
    safeRecordTurn(turnTracker, name, eventName, decision)
  }
  const originalToolInput = normalized.toolInput as Record<string, unknown> | undefined
  let currentToolInput = originalToolInput
  const observationMetadata = (): Pick<ExecutionResult, 'preToolUse'> =>
    collectPreToolUseVotes
      ? {
          preToolUse: {
            votes: acceptedVotes,
            finalToolInput: cloneDeep(currentToolInput),
            inputChanged: currentToolInput !== originalToolInput,
            completed: !executionFailed && !policyFailure,
          },
        }
      : {}
  const audit = (value: unknown, origin: ResultOrigin, hookName: HookName, parallel: boolean) => {
    if (!effectsOpen) return undefined
    const checked = checkDetachedResult(
      policy,
      { value, origin, hookName, parallel, currentToolInput },
      eventName,
    )
    if (checked.kind === 'rejected') {
      policyFailure ??= checked.failure
      effectsOpen = false
      return undefined
    }
    systemMessages.push(...checked.diagnostics)
    return checked
  }

  let failureState = await readFailures(failurePath)
  let failuresDirty = false
  const lifecycleMetaCache = new LifecycleMetaCache()

  // Process load errors through the circuit breaker.
  // Import failures always block regardless of onError config.
  // Load errors use LOAD_ERROR_EVENT so failures accumulate in a single
  // counter regardless of which event triggered the invocation.
  for (const loadError of loadErrors) {
    const { maxFailures, maxFailuresMessage } = resolveMaxFailures(loadError.name, config)
    failureState = recordFailure(failureState, loadError.name, LOAD_ERROR_EVENT, loadError.error)
    failuresDirty = true
    const newCount = getFailureCount(failureState, loadError.name, LOAD_ERROR_EVENT)

    if (maxFailures === 0 || newCount < maxFailures) {
      // Under threshold or circuit breaker disabled — fail-closed
      await writeFailures(failurePath, failureState)
      systemMessages.push(
        `[clooks] Hook "${loadError.name}" failed to load: ${loadError.error}\n` +
          `Fix: Remove "${loadError.name}" from your clooks.yml, or restore the hook file.\n` +
          `This hook will be disabled after ${maxFailures} consecutive load failures.`,
      )
      lastResult = {
        result: 'block',
        reason: formatDiagnostic(loadError.name, eventName, new Error(loadError.error), 'block'),
      }
      lastResult = audit(lastResult, 'load-error', loadError.name, false)?.result
      effectsOpen = false
      return {
        ...observationMetadata(),
        lastResult,
        policyFailure,
        degradedMessages,
        debugMessages,
        traceMessages,
        systemMessages,
      }
    }

    // Threshold reached or already degraded — degrade (don't block)
    systemMessages.push(
      `[clooks] Hook "${loadError.name}" has been disabled after ${maxFailures} consecutive load failures.\n` +
        `Fix: Remove "${loadError.name}" from your clooks.yml, or restore the hook file.`,
    )
    const msg = interpolateMessage(maxFailuresMessage, {
      hook: loadError.name,
      event: LOAD_ERROR_EVENT,
      count: newCount,
      error: loadError.error,
    })
    degradedMessages.push(msg)
    audit(undefined, 'load-error', loadError.name, false)
    if (policyFailure)
      return {
        ...observationMetadata(),
        policyFailure,
        degradedMessages,
        debugMessages,
        traceMessages,
        systemMessages,
      }
  }

  // Clear LOAD_ERROR_EVENT counters for hooks that loaded successfully.
  // This handles recovery after a hook file is restored — without this,
  // a hook that was degraded due to load errors would remain permanently
  // degraded even after the file is fixed because the __load__ counter
  // is never cleared by the per-event success path.
  for (const loaded of matched) {
    if (getFailureCount(failureState, loaded.name, LOAD_ERROR_EVENT) > 0) {
      failureState = clearFailure(failureState, loaded.name, LOAD_ERROR_EVENT)
      failuresDirty = true
    }
  }

  // --- Pipeline state ---
  const accumulatedInjectContext: string[] = []
  let pipelineBlocked = false
  let blockResult: EngineResult | undefined
  let lastNonSkipResult: EngineResult | undefined

  // --- PreToolUse-specific state (populated by runners when eventName === 'PreToolUse') ---
  const preToolUseVotes: PreToolUseVote[] = []

  // --- Order and partition ---
  const orderedHooks = orderHooksForEvent(
    matched,
    config.events[eventName],
    config.hooks,
    eventName,
    disabledNames,
  )
  const groups = partitionIntoGroups(orderedHooks, eventName)
  const ordinals = collectPreToolUseVotes
    ? new Map(orderedHooks.map((hook, ordinal) => [hook.loaded.name, ordinal]))
    : undefined

  // Capture before handoff can replace author text; insert only at existing vote sites.
  function voteRecorder(result: EngineResult, hookName: HookName, origin: ResultOrigin) {
    const acceptedResult = collectPreToolUseVotes ? cloneDeep(result) : undefined
    const inputBefore = collectPreToolUseVotes ? cloneDeep(currentToolInput ?? {}) : undefined
    return (engineResult: EngineResult) => {
      preToolUseVotes.push({ engineResult, rank: rankPreToolUseResult(engineResult) })
      if (acceptedResult && inputBefore) {
        acceptedVotes.push({
          engineResult: acceptedResult,
          rank: rankPreToolUseResult(acceptedResult),
          hookName,
          origin,
          ordinal: ordinals!.get(hookName)!,
          inputBefore,
          inputAfter: cloneDeep(currentToolInput ?? {}),
        })
      }
    }
  }

  // --- Sequential group runner ---
  async function executeSequentialGroup(group: ExecutionGroup): Promise<void> {
    // Per-group AbortController — never aborted for sequential groups
    const sharedController = new AbortController()
    for (const hook of group.hooks) {
      const loaded = hook.loaded
      const { maxFailures, maxFailuresMessage } = resolveMaxFailures(loaded.name, config)

      // Build context: clone normalized, set pipeline fields
      const context: Record<string, unknown> = { ...normalized }
      if (currentToolInput !== undefined) {
        context.toolInput =
          policy === legacyResultPolicy ? currentToolInput : cloneDeep(currentToolInput)
      }
      if (originalToolInput !== undefined) {
        context.originalToolInput =
          policy === legacyResultPolicy ? originalToolInput : cloneDeep(originalToolInput)
      }
      context.parallel = false
      context.signal = sharedController.signal
      // Freshly allocated per hook: a shared object would let one hook's push
      // onto `prior` rewrite what a later hook sees.
      context.turn = safeMaterializeTurn(turnTracker, loaded.name, eventName)

      const timeout = resolveTimeout(loaded.name, config)

      let lifecycleResult: LifecycleResult
      try {
        lifecycleResult = await runHookLifecycle(
          loaded,
          eventName,
          context,
          timeout,
          lifecycleMetaCache,
        )
      } catch (e) {
        // Recorded before any mode resolution: the record describes what the
        // hook did, not what the engine decided to do about it.
        recordRaw(loaded.name, undefined, true)
        const rawGeneratedError: EngineResult = {
          result: 'block',
          reason: formatDiagnostic(
            loaded.name,
            eventName,
            e,
            'block',
            loaded.usesTarget,
            loaded.hookPath,
          ),
        }
        const generatedError = policy.deferRuntimeErrorAudit
          ? undefined
          : audit(rawGeneratedError, 'engine-error', loaded.name, false)
        if (!effectsOpen) {
          sharedController.abort()
          return
        }
        const errorMessage = e instanceof Error ? e.message : String(e)
        const onErrorMode = resolveOnError(loaded.name, eventName, config)

        // Runtime fallback: hook-level "trace" on a non-injectable event → "continue"
        let effectiveMode = onErrorMode
        if (effectiveMode === 'trace' && !INJECTABLE_EVENTS.has(eventName)) {
          systemMessages.push(
            `Hook "${loaded.name}" has onError: "trace" but ${eventName} does not support additionalContext. Falling back to "continue".`,
          )
          effectiveMode = 'continue'
        }

        // Runtime fallback: NOTIFY_ONLY events cannot honor "block" — output is ignored
        // upstream, so blocking is impossible. Coerce to "no-block" but still record
        // the failure so the circuit breaker can quarantine a repeatedly crashing
        // alerting hook (the circuit-breaker applies normally).
        if (effectiveMode === 'block' && NOTIFY_ONLY_EVENTS.has(eventName)) {
          process.stderr.write(
            `clooks: hook "${loaded.name}" onError: "block" cannot apply to ${eventName} ` +
              `(notify-only event — output and exit code ignored upstream). ` +
              `Skipping; failure counted toward maxFailures.\n`,
          )
          failureState = recordFailure(failureState, loaded.name, eventName, errorMessage)
          failuresDirty = true
          const newCount = getFailureCount(failureState, loaded.name, eventName)
          if (maxFailures !== 0 && newCount >= maxFailures) {
            const msg = interpolateMessage(maxFailuresMessage, {
              hook: loaded.name,
              event: eventName,
              count: newCount,
              error: errorMessage,
            })
            degradedMessages.push(msg)
          }
          continue
        }

        if (effectiveMode === 'block') {
          failureState = recordFailure(failureState, loaded.name, eventName, errorMessage)
          failuresDirty = true
          const newCount = getFailureCount(failureState, loaded.name, eventName)

          if (maxFailures === 0 || newCount < maxFailures) {
            // Under threshold — block. Write failures and stop pipeline.
            await writeFailures(failurePath, failureState)
            failuresDirty = false
            blockResult = policy.deferRuntimeErrorAudit
              ? audit(rawGeneratedError, 'engine-error', loaded.name, false)?.result
              : generatedError?.result
            pipelineBlocked = true
            return
          }

          // At/above threshold — degraded
          const msg = interpolateMessage(maxFailuresMessage, {
            hook: loaded.name,
            event: eventName,
            count: newCount,
            error: errorMessage,
          })
          degradedMessages.push(msg)
          continue
        }

        if (effectiveMode === 'continue') {
          systemMessages.push(
            formatDiagnostic(
              loaded.name,
              eventName,
              e,
              'continue',
              loaded.usesTarget,
              loaded.hookPath,
            ),
          )
          if (debug) {
            debugMessages.push(
              formatDiagnostic(
                loaded.name,
                eventName,
                e,
                'continue',
                loaded.usesTarget,
                loaded.hookPath,
              ),
            )
          }
          continue
        }

        if (effectiveMode === 'trace') {
          traceMessages.push(formatTraceMessage(loaded.name, e, loaded.usesTarget, loaded.hookPath))
          continue
        }

        continue
      }

      recordRaw(loaded.name, lifecycleResult.result)
      const checked = audit(lifecycleResult.result, lifecycleResult.origin, loaded.name, false)
      if (!effectsOpen) {
        sharedController.abort()
        return
      }

      // Success — clear any failure state for this hook+event
      if (getFailureCount(failureState, loaded.name, eventName) > 0) {
        failureState = clearFailure(failureState, loaded.name, eventName)
        failuresDirty = true
      }

      // Debug logging for lifecycle phases
      if (debug && lifecycleResult.blockedByBefore) {
        debugMessages.push(`hook="${loaded.name}" beforeHook: blocked`)
      }
      if (debug && lifecycleResult.overriddenByAfter) {
        debugMessages.push(`hook="${loaded.name}" afterHook: overridden result`)
      }
      if (debug && lifecycleResult.beforeDebug) {
        debugMessages.push(`hook="${loaded.name}" beforeHook: ${lifecycleResult.beforeDebug}`)
      }
      if (debug && lifecycleResult.afterDebug) {
        debugMessages.push(`hook="${loaded.name}" afterHook: ${lifecycleResult.afterDebug}`)
      }

      const result = checked?.result
      if (result === undefined || result === null) {
        if (debug) {
          debugMessages.push(`hook="${loaded.name}" event="${eventName}" returned: null/undefined`)
        }
        continue
      }

      // Single cast at the boundary where dynamically-imported hook code returns.
      const resultObj = result as EngineResult
      const addVote = voteRecorder(resultObj, loaded.name, lifecycleResult.origin)

      // From the raw result, before handoff. Handoff replaces payload text and
      // never the tag, so either side records the same value today — reading
      // the raw object keeps the record independent of a transform that could
      // grow new behavior later.

      // Handoff runs before the debug serialization below so debug output shows
      // the pointer, not the payload handoff was meant to keep out of the transcript.
      const hookResult = await applyHandoff(
        resultObj,
        loaded.name,
        eventName,
        config,
        handoffRoot,
        policy.handoff,
        reportInlineHandoff,
      )
      if (!effectsOpen) return

      if (debug) {
        debugMessages.push(
          `hook="${loaded.name}" event="${eventName}" returned: ${JSON.stringify(hookResult)}`,
        )
      }

      // Collect debug messages from every hook result
      if (debug && hookResult.debugMessage) {
        debugMessages.push(hookResult.debugMessage)
      }

      // Block bails out immediately — stop the group and signal pipeline.
      // For PreToolUse: outer accumulatedInjectContext.push stays unconditional (authoritative
      // on crash path per Decision D-2026-04-19-10); blockResult/pipelineBlocked/return are
      // gated to non-PreToolUse so the collect-all pipeline continues.
      if (hookResult.result === 'block') {
        if (hookResult.injectContext) {
          accumulatedInjectContext.push(hookResult.injectContext)
        }
        if (eventName === 'PreToolUse') {
          addVote(hookResult)
          continue
        }
        blockResult = hookResult
        pipelineBlocked = true
        return
      }

      // Skip — still collect injectContext and promote if it carries passthrough fields
      if (hookResult.result === 'skip') {
        if (hookResult.injectContext) {
          accumulatedInjectContext.push(hookResult.injectContext)
        }
        if (hookResult.updatedMCPToolOutput !== undefined) {
          lastNonSkipResult = hookResult
        }
        if (eventName === 'PreToolUse') {
          addVote(hookResult)
        }
        continue
      }

      // Ask — PreToolUse: push vote and continue; non-PreToolUse: fall through to allow path.
      if (hookResult.result === 'ask') {
        if (eventName === 'PreToolUse') {
          // Ask hooks can carry updatedInput. Merge it into pipeline state
          // so subsequent sequential hooks and the reducer see the accumulated input.
          if (checked?.nextToolInput !== undefined) {
            currentToolInput = checked.nextToolInput
          } else if (hookResult.updatedInput) {
            const base = (currentToolInput ?? {}) as Record<string, unknown>
            currentToolInput = omitBy({ ...base, ...hookResult.updatedInput }, isNull) as Record<
              string,
              unknown
            >
          }
          addVote(hookResult)
          continue
        }
        // Non-PreToolUse: treat as non-skip (updates lastNonSkipResult below)
        lastNonSkipResult = hookResult
        continue
      }

      // Defer — PreToolUse: push vote and continue; non-PreToolUse: fall through to allow path.
      // No updatedInput merge: DeferResult forbids the field at the type level.
      if (hookResult.result === 'defer') {
        if (eventName === 'PreToolUse') {
          addVote(hookResult)
          continue
        }
        // Non-PreToolUse: treat as non-skip (updates lastNonSkipResult below)
        lastNonSkipResult = hookResult
        continue
      }

      // Allow or other non-skip result: update pipeline state.
      // PermissionDenied's retry-wins semantic is handled by this "last non-skip"
      // reducer — no short-circuit occurs because retry carries no block/updatedInput.
      //
      // Patch-merge: hooks return a partial patch. Spread it onto the running tool
      // input and strip `null` values (explicit-unset sentinel). `undefined` is
      // already absent after spread, which is the "no patch on this key" case.
      if (checked?.nextToolInput !== undefined) {
        currentToolInput = checked.nextToolInput
      } else if (hookResult.updatedInput) {
        const base = (currentToolInput ?? {}) as Record<string, unknown>
        currentToolInput = omitBy({ ...base, ...hookResult.updatedInput }, isNull) as Record<
          string,
          unknown
        >
      }
      if (hookResult.injectContext) {
        accumulatedInjectContext.push(hookResult.injectContext)
      }
      lastNonSkipResult = hookResult
      if (eventName === 'PreToolUse') {
        addVote(hookResult)
      }
    }
  }

  // --- Parallel group runner ---
  async function executeParallelGroup(group: ExecutionGroup): Promise<void> {
    const controller = new AbortController()

    interface SettledHookResult {
      status: 'fulfilled' | 'rejected'
      value?: unknown
      reason?: unknown
      hookName: HookName
      contractViolation?: string
      generatedError?: EngineResult
    }

    function shouldShortCircuit(settled: SettledHookResult): boolean {
      if (policyFailure || settled.contractViolation) return true
      // NOTIFY_ONLY events cannot honor block — never short-circuit a parallel batch
      // on a notify-only hook crash. The post-batch circuit-breaker loop still
      // records failures for quarantine accounting.
      if (NOTIFY_ONLY_EVENTS.has(eventName)) return false
      if (settled.status === 'fulfilled') {
        const lr = settled.value as LifecycleResult
        const val = lr.result as EngineResult | undefined
        // PreToolUse specifically: block is a deny-vote, not a pipeline terminator.
        if (eventName !== 'PreToolUse' && val?.result === 'block') return true
      }
      if (settled.status === 'rejected') {
        const onErrorMode = resolveOnError(settled.hookName, eventName, config)
        if (onErrorMode === 'block') {
          const { maxFailures } = resolveMaxFailures(settled.hookName, config)
          const currentCount = getFailureCount(failureState, settled.hookName, eventName)
          const projectedCount = currentCount + 1
          // Only short-circuit if under threshold (same as sequential runner)
          if (maxFailures === 0 || projectedCount < maxFailures) {
            return true
          }
          // At/above threshold — will degrade, don't short-circuit
          return false
        }
      }
      return false
    }

    // Build pre-lookup maps for usesTarget and hookPath (needed in results loop)
    const usesTargetMap = new Map<HookName, string | undefined>()
    const hookPathMap = new Map<HookName, string | undefined>()
    for (const hook of group.hooks) {
      usesTargetMap.set(hook.loaded.name, hook.loaded.usesTarget)
      hookPathMap.set(hook.loaded.name, hook.loaded.hookPath)
    }

    // Build tasks — start all hooks concurrently
    const hookTasks = group.hooks.map((hook) => {
      const loaded = hook.loaded

      // Build context: all parallel hooks see the same toolInput
      const context: Record<string, unknown> = { ...normalized }
      if (currentToolInput !== undefined) {
        context.toolInput =
          policy === legacyResultPolicy ? currentToolInput : cloneDeep(currentToolInput)
      }
      if (originalToolInput !== undefined) {
        context.originalToolInput =
          policy === legacyResultPolicy ? originalToolInput : cloneDeep(originalToolInput)
      }
      context.parallel = true
      context.signal = controller.signal
      context.turn = safeMaterializeTurn(turnTracker, loaded.name, eventName)

      const timeout = resolveTimeout(loaded.name, config)
      const promise = runHookLifecycle(loaded, eventName, context, timeout, lifecycleMetaCache)

      return { promise, hookName: loaded.name }
    })

    // Custom short-circuit batch runner
    const { results } = await new Promise<{
      results: (SettledHookResult | undefined)[]
      shortCircuited: boolean
    }>((resolve) => {
      if (hookTasks.length === 0) {
        resolve({ results: [], shortCircuited: false })
        return
      }

      let resolved = false
      let settledCount = 0
      const results: (SettledHookResult | undefined)[] = new Array(hookTasks.length)

      const abortBatch = () => {
        executionFailed = true
        resolved = true
        for (let j = 0; j < hookTasks.length; j++) {
          if (!results[j]) recordRaw(hookTasks[j]!.hookName, undefined, true)
        }
        controller.abort()
        resolve({ results, shortCircuited: true })
      }

      const captureSettlement = (settled: SettledHookResult, i: number) => {
        // Capture available outcomes before ordinary abort selection, without
        // admitting any result after the batch closes. Policy rejection closes immediately.
        if (resolved) return undefined
        try {
          if (settled.status === 'fulfilled') {
            const lr = settled.value as LifecycleResult
            recordRaw(settled.hookName, lr.result)
            const checked = audit(lr.result, lr.origin, settled.hookName, true)
            settled.value = { ...lr, result: checked?.result }
            const raw = lr.result as EngineResult | null | undefined
            if (
              effectsOpen &&
              (raw?.updatedInput !== undefined ||
                checked?.result?.updatedInput !== undefined ||
                checked?.nextToolInput !== undefined)
            ) {
              const message = `clooks: hook "${settled.hookName}" returned updatedInput in parallel mode — this is a contract violation. Parallel hooks cannot modify tool input.`
              settled.contractViolation = message
              executionFailed = true
              settled.generatedError = audit(
                { result: 'block', reason: message },
                'parallel-contract',
                settled.hookName,
                true,
              )?.result
            }
          } else {
            recordRaw(settled.hookName, undefined, true)
            const rawGeneratedError: EngineResult = {
              result: 'block',
              reason: formatDiagnostic(
                settled.hookName,
                eventName,
                settled.reason,
                'block',
                usesTargetMap.get(settled.hookName),
                hookPathMap.get(settled.hookName),
              ),
            }
            settled.generatedError = policy.deferRuntimeErrorAudit
              ? rawGeneratedError
              : audit(rawGeneratedError, 'engine-error', settled.hookName, true)?.result
          }
          results[i] = settled
          settledCount++

          if (policyFailure) abortBatch()
          return settled
        } catch {
          rejectUnreadableResult(settled.hookName)
          recordRaw(settled.hookName, undefined, true)
          results[i] = settled
          abortBatch()
          return undefined
        }
      }

      hookTasks.forEach((task, i) => {
        task.promise
          .then(
            (value) =>
              captureSettlement({ status: 'fulfilled', value, hookName: task.hookName }, i),
            (reason) =>
              captureSettlement({ status: 'rejected', reason, hookName: task.hookName }, i),
          )
          .then((settled) => {
            if (resolved || !settled) return
            try {
              if (shouldShortCircuit(settled)) {
                abortBatch()
              } else if (settledCount === hookTasks.length) {
                resolved = true
                resolve({ results, shortCircuited: false })
              }
            } catch {
              rejectUnreadableResult(settled.hookName)
              abortBatch()
            }
          })
      })
    })

    // --- Merge results ---
    if (!effectsOpen) return
    const batchInjectContext: string[] = []
    const deferredRuntimeBlocks: SettledHookResult[] = []

    for (let i = 0; i < results.length; i++) {
      const settled = results[i]
      if (!settled) {
        // Abandoned by a short circuit. The lifecycle started, so it is
        // recorded; its outcome is simply unknown.
        const abandoned = hookTasks[i]
        if (abandoned) recordRaw(abandoned.hookName, undefined, true)
        continue
      }

      if (settled.status === 'fulfilled') {
        const lr = settled.value as LifecycleResult
        const val = lr.result as EngineResult | undefined

        if (settled.contractViolation) {
          const violationMsg = settled.contractViolation
          systemMessages.push(violationMsg)
          blockResult = settled.generatedError
          pipelineBlocked = true
          failureState = recordFailure(failureState, settled.hookName, eventName, violationMsg)
          failuresDirty = true
          const { maxFailures, maxFailuresMessage } = resolveMaxFailures(settled.hookName, config)
          const newCount = getFailureCount(failureState, settled.hookName, eventName)
          if (maxFailures !== 0 && newCount >= maxFailures) {
            degradedMessages.push(
              interpolateMessage(maxFailuresMessage, {
                hook: settled.hookName,
                event: eventName,
                count: newCount,
                error: violationMsg,
              }),
            )
          }
          continue
        }

        // Add lifecycle debug logging
        if (debug && lr.blockedByBefore) {
          debugMessages.push(`hook="${settled.hookName}" beforeHook: blocked (parallel)`)
        }
        if (debug && lr.overriddenByAfter) {
          debugMessages.push(`hook="${settled.hookName}" afterHook: overridden result (parallel)`)
        }
        if (debug && lr.beforeDebug) {
          debugMessages.push(`hook="${settled.hookName}" beforeHook: ${lr.beforeDebug} (parallel)`)
        }
        if (debug && lr.afterDebug) {
          debugMessages.push(`hook="${settled.hookName}" afterHook: ${lr.afterDebug} (parallel)`)
        }

        if (!val) {
          continue
        }
        const addVote = voteRecorder(val, settled.hookName, lr.origin)

        // Handoff applies per hook, before reduction merges text and discards
        // hook identity. The loop is sequential, so writes do not race.
        const hookResult = await applyHandoff(
          val,
          settled.hookName,
          eventName,
          config,
          handoffRoot,
          policy.handoff,
          reportInlineHandoff,
        )
        if (!effectsOpen) return

        if (hookResult.result === 'skip') {
          if (hookResult.injectContext) {
            batchInjectContext.push(hookResult.injectContext)
          }
          if (hookResult.updatedMCPToolOutput !== undefined) {
            lastNonSkipResult = hookResult
          }
          if (eventName === 'PreToolUse') {
            addVote(hookResult)
          }
          continue
        }

        // Block branch: outer accumulatedInjectContext.push stays unconditional (authoritative
        // on crash path per Decision D-2026-04-19-10); blockResult/pipelineBlocked are gated
        // to non-PreToolUse so the collect-all pipeline continues for PreToolUse.
        if (hookResult.result === 'block') {
          if (hookResult.injectContext) {
            accumulatedInjectContext.push(hookResult.injectContext)
          }
          if (eventName === 'PreToolUse') {
            addVote(hookResult)
            continue
          }
          blockResult = hookResult
          pipelineBlocked = true
          continue
        }

        // Ask — PreToolUse: push vote and continue; non-PreToolUse: fall through to allow path.
        if (hookResult.result === 'ask') {
          if (eventName === 'PreToolUse') {
            addVote(hookResult)
            continue
          }
          // Non-PreToolUse: treat as non-skip (updates lastNonSkipResult below)
          lastNonSkipResult = hookResult
          continue
        }

        // Defer — PreToolUse: push vote and continue; non-PreToolUse: fall through to allow path.
        if (hookResult.result === 'defer') {
          if (eventName === 'PreToolUse') {
            addVote(hookResult)
            continue
          }
          // Non-PreToolUse: treat as non-skip (updates lastNonSkipResult below)
          lastNonSkipResult = hookResult
          continue
        }

        // Allow or other non-skip result
        if (hookResult.injectContext) {
          batchInjectContext.push(hookResult.injectContext)
        }

        if (debug && hookResult.debugMessage) {
          debugMessages.push(hookResult.debugMessage)
        }

        lastNonSkipResult = hookResult
        if (eventName === 'PreToolUse') {
          addVote(hookResult)
        }
      }

      if (settled.status === 'rejected') {
        const onErrorMode = resolveOnError(settled.hookName, eventName, config)

        // Runtime fallback: hook-level "trace" on a non-injectable event → "continue"
        let effectiveMode = onErrorMode
        if (effectiveMode === 'trace' && !INJECTABLE_EVENTS.has(eventName)) {
          systemMessages.push(
            `Hook "${settled.hookName}" has onError: "trace" but ${eventName} does not support additionalContext. Falling back to "continue".`,
          )
          effectiveMode = 'continue'
        }

        // Runtime fallback: NOTIFY_ONLY events cannot honor "block" — emit the stderr
        // warning and skip the block assignment. The post-batch circuit-breaker loop
        // at 663-686 records the failure naturally.
        if (effectiveMode === 'block' && NOTIFY_ONLY_EVENTS.has(eventName)) {
          process.stderr.write(
            `clooks: hook "${settled.hookName}" onError: "block" cannot apply to ${eventName} ` +
              `(notify-only event — output and exit code ignored upstream). ` +
              `Skipping; failure counted toward maxFailures.\n`,
          )
        } else if (effectiveMode === 'block') {
          const { maxFailures } = resolveMaxFailures(settled.hookName, config)
          const currentCount = getFailureCount(failureState, settled.hookName, eventName)
          const projectedCount = currentCount + 1
          if (maxFailures === 0 || projectedCount < maxFailures) {
            // Under threshold — block
            blockResult = settled.generatedError
            pipelineBlocked = true
            if (policy.deferRuntimeErrorAudit) deferredRuntimeBlocks.push(settled)
          }
          // At/above threshold case handled in circuit breaker loop below
        } else if (effectiveMode === 'continue') {
          systemMessages.push(
            formatDiagnostic(
              settled.hookName,
              eventName,
              settled.reason,
              'continue',
              usesTargetMap.get(settled.hookName),
              hookPathMap.get(settled.hookName),
            ),
          )
          if (debug) {
            debugMessages.push(
              formatDiagnostic(
                settled.hookName,
                eventName,
                settled.reason,
                'continue',
                usesTargetMap.get(settled.hookName),
                hookPathMap.get(settled.hookName),
              ),
            )
          }
        } else if (effectiveMode === 'trace') {
          traceMessages.push(
            formatTraceMessage(
              settled.hookName,
              settled.reason,
              usesTargetMap.get(settled.hookName),
              hookPathMap.get(settled.hookName),
            ),
          )
        }
      }
    }

    // Merge batch injectContext into pipeline accumulator
    if (batchInjectContext.length > 0) {
      accumulatedInjectContext.push(...batchInjectContext)
    }

    // --- Update circuit breaker state SEQUENTIALLY after all hooks settle ---
    for (let i = 0; i < results.length; i++) {
      const settled = results[i]
      if (!settled) continue

      if (settled.status === 'fulfilled') {
        // Contract violations already recorded above
        if (settled.contractViolation) continue

        // Success — clear any failure state (any successful invocation, matching sequential runner)
        if (getFailureCount(failureState, settled.hookName, eventName) > 0) {
          failureState = clearFailure(failureState, settled.hookName, eventName)
          failuresDirty = true
        }
      }

      if (settled.status === 'rejected') {
        const onErrorMode = resolveOnError(settled.hookName, eventName, config)
        if (onErrorMode === 'block') {
          const errorMessage =
            settled.reason instanceof Error ? settled.reason.message : String(settled.reason)
          failureState = recordFailure(failureState, settled.hookName, eventName, errorMessage)
          failuresDirty = true

          // Check threshold for degraded mode
          const { maxFailures, maxFailuresMessage } = resolveMaxFailures(settled.hookName, config)
          const newCount = getFailureCount(failureState, settled.hookName, eventName)
          if (maxFailures !== 0 && newCount >= maxFailures) {
            const msg = interpolateMessage(maxFailuresMessage, {
              hook: settled.hookName,
              event: eventName,
              count: newCount,
              error: errorMessage,
            })
            degradedMessages.push(msg)
          }
        }
        // onError: "continue" and "trace" do NOT call recordFailure
      }
    }

    // Write failures once at end of batch
    if (failuresDirty) {
      await writeFailures(failurePath, failureState)
      failuresDirty = false
    }
    // Preserve all captured failure accounting before a selected runtime refusal closes effects.
    for (const settled of deferredRuntimeBlocks) {
      const checked = audit(settled.generatedError, 'engine-error', settled.hookName, true)
      if (!effectsOpen) break
      if (blockResult === settled.generatedError) blockResult = checked?.result
    }
  }

  // --- Group dispatch loop ---
  for (const group of groups) {
    if (group.type === 'parallel') {
      await executeParallelGroup(group)
    } else {
      await executeSequentialGroup(group)
    }
    if (pipelineBlocked || policyFailure) break
  }

  // --- Build final result ---
  if (policyFailure) {
    lastResult = undefined
  } else if (eventName === 'PreToolUse') {
    // Crash-block path still short-circuits (Decision Log D-2026-04-19-05):
    // if pipelineBlocked is true, a crashed hook under onError:"block"
    // already set blockResult — use that without running reduction.
    // This path DOES read accumulatedInjectContext (preserves prior allow-hook
    // contexts that ran before the crash, matching today's injectable-event
    // semantics). It does NOT call the reducer.
    if (pipelineBlocked && blockResult) {
      if (INJECTABLE_EVENTS.has(eventName) && accumulatedInjectContext.length > 0) {
        const accumulated = accumulatedInjectContext.join('\n')
        lastResult = { ...blockResult, injectContext: accumulated }
      } else {
        lastResult = blockResult
      }
    } else {
      // Non-crash path: reducer is AUTHORITATIVE. Do NOT read from
      // accumulatedInjectContext, lastNonSkipResult, or currentToolInput
      // here. The reducer's per-winner accumulation rules (D2) walk the
      // votes array and emit the canonical merged result. Joining the
      // outer accumulator here would double-count context — see the
      // runner-integration explanation above.
      // Identity check is "did any hook touch updatedInput," not value-equality.
      // Reliable because each patch-merge allocates a fresh object — even a
      // content-equal merge produces a reference-distinct result.
      const { result: reduced, warnings } = reducePreToolUseVotes(
        preToolUseVotes,
        currentToolInput !== originalToolInput ? currentToolInput : undefined,
      )
      if (warnings.length > 0) systemMessages.push(...warnings)
      if (reduced) {
        lastResult = reduced
      }
    }
  } else {
    // --- Non-PreToolUse events: today's behavior unchanged ---
    if (pipelineBlocked && blockResult) {
      // For injectable events, merge accumulated injectContext from prior groups into block result
      if (INJECTABLE_EVENTS.has(eventName) && accumulatedInjectContext.length > 0) {
        // Block result's own injectContext was already added to accumulator; replace with full accumulation
        const accumulated = accumulatedInjectContext.join('\n')
        blockResult = { ...blockResult, injectContext: accumulated }
      }
      lastResult = blockResult
    } else if (lastNonSkipResult) {
      lastResult = { ...lastNonSkipResult }
      if (accumulatedInjectContext.length > 0) {
        lastResult.injectContext = accumulatedInjectContext.join('\n')
      }
      // If any hook returned updatedInput (reference comparison)
      if (currentToolInput !== originalToolInput) {
        lastResult.updatedInput = currentToolInput
      }
    } else if (accumulatedInjectContext.length > 0) {
      // All hooks skipped but accumulated injectContext exists (e.g., from trace errors)
      lastResult = { result: 'allow', injectContext: accumulatedInjectContext.join('\n') }
    }
  }

  if (failuresDirty) {
    await writeFailures(failurePath, failureState)
  }

  // Every return path that follows a started lifecycle passes through here.
  // The only exception is the load-error early return above, which fires
  // before any runner is entered.
  effectsOpen = false
  await safeCommitTurn(turnTracker)

  return {
    ...observationMetadata(),
    lastResult,
    policyFailure,
    degradedMessages,
    debugMessages,
    traceMessages,
    systemMessages,
  }
}
