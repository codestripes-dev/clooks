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
import type { EngineResult } from './types.js'

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
  failurePath: string,
  loadErrors: HookLoadError[] = [],
  disabledNames?: Set<HookName>,
): Promise<{
  lastResult?: EngineResult
  degradedMessages: string[]
  debugMessages: string[]
  traceMessages: string[]
  systemMessages: string[]
}> {
  const debug = process.env.CLOOKS_DEBUG === 'true'
  const debugMessages: string[] = []
  const degradedMessages: string[] = []
  const traceMessages: string[] = []
  const systemMessages: string[] = []
  let lastResult: EngineResult | undefined

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
      return { lastResult, degradedMessages, debugMessages, traceMessages, systemMessages }
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
  const originalToolInput = normalized.toolInput as Record<string, unknown> | undefined
  let currentToolInput = originalToolInput
  const accumulatedInjectContext: string[] = []
  let pipelineBlocked = false
  let blockResult: EngineResult | undefined
  let lastNonSkipResult: EngineResult | undefined

  // --- Order and partition ---
  const orderedHooks = orderHooksForEvent(
    matched,
    config.events[eventName],
    config.hooks,
    eventName,
    disabledNames,
  )
  const groups = partitionIntoGroups(orderedHooks, eventName)

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
        context.toolInput = currentToolInput
      }
      if (originalToolInput !== undefined) {
        context.originalToolInput = originalToolInput
      }
      context.parallel = false
      context.signal = sharedController.signal

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
        // alerting hook (per FEAT-0057 D3 — circuit-breaker applies normally).
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
            blockResult = {
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

      const result = lifecycleResult.result
      if (result === undefined || result === null) {
        if (debug) {
          debugMessages.push(`hook="${loaded.name}" event="${eventName}" returned: null/undefined`)
        }
        continue
      }

      // Single cast at the boundary where dynamically-imported hook code returns.
      const resultObj = result as EngineResult

      if (debug) {
        debugMessages.push(
          `hook="${loaded.name}" event="${eventName}" returned: ${JSON.stringify(resultObj)}`,
        )
      }

      // Collect debug messages from every hook result
      if (debug && resultObj.debugMessage) {
        debugMessages.push(resultObj.debugMessage)
      }

      // Block bails out immediately — stop the group and signal pipeline
      if (resultObj.result === 'block') {
        if (resultObj.injectContext) {
          accumulatedInjectContext.push(resultObj.injectContext)
        }
        blockResult = resultObj
        pipelineBlocked = true
        return
      }

      // Skip — still collect injectContext and promote if it carries passthrough fields
      if (resultObj.result === 'skip') {
        if (resultObj.injectContext) {
          accumulatedInjectContext.push(resultObj.injectContext)
        }
        if (resultObj.updatedMCPToolOutput !== undefined) {
          lastNonSkipResult = resultObj
        }
        continue
      }

      // Allow or other non-skip result: update pipeline state.
      // PermissionDenied's retry-wins semantic is handled by this "last non-skip"
      // reducer — no short-circuit occurs because retry carries no block/updatedInput.
      if (resultObj.updatedInput) {
        currentToolInput = resultObj.updatedInput
      }
      if (resultObj.injectContext) {
        accumulatedInjectContext.push(resultObj.injectContext)
      }
      lastNonSkipResult = resultObj
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
    }

    function shouldShortCircuit(settled: SettledHookResult): boolean {
      // NOTIFY_ONLY events cannot honor block — never short-circuit a parallel batch
      // on a notify-only hook crash. The post-batch circuit-breaker loop still
      // records failures for quarantine accounting.
      if (NOTIFY_ONLY_EVENTS.has(eventName)) return false
      if (settled.status === 'fulfilled') {
        const lr = settled.value as LifecycleResult
        const val = lr.result as EngineResult | undefined
        if (val?.result === 'block') return true
        if (val?.updatedInput) return true // contract violation
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
        context.toolInput = currentToolInput
      }
      if (originalToolInput !== undefined) {
        context.originalToolInput = originalToolInput
      }
      context.parallel = true
      context.signal = controller.signal

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

      hookTasks.forEach((task, i) => {
        task.promise
          .then(
            (value): SettledHookResult => ({
              status: 'fulfilled' as const,
              value,
              hookName: task.hookName,
            }),
          )
          .catch(
            (reason): SettledHookResult => ({
              status: 'rejected' as const,
              reason,
              hookName: task.hookName,
            }),
          )
          .then((settled) => {
            // Always store the settled result so the circuit breaker
            // update loop can process hooks that settled before or
            // concurrently with the short-circuit trigger.
            results[i] = settled
            settledCount++
            if (resolved) return

            if (shouldShortCircuit(settled)) {
              resolved = true
              controller.abort()
              resolve({ results, shortCircuited: true })
              return
            }

            if (settledCount === hookTasks.length) {
              resolved = true
              resolve({ results, shortCircuited: false })
            }
          })
      })
    })

    // --- Merge results ---
    const batchInjectContext: string[] = []

    for (let i = 0; i < results.length; i++) {
      const settled = results[i]
      if (!settled) continue // unsettled (short-circuited before this hook finished)

      if (settled.status === 'fulfilled') {
        const lr = settled.value as LifecycleResult
        const val = lr.result as EngineResult | undefined

        // Add lifecycle debug logging
        if (debug && lr.blockedByBefore) {
          debugMessages.push(`hook="${settled.hookName}" beforeHook: blocked (parallel)`)
        }
        if (debug && lr.overriddenByAfter) {
          debugMessages.push(`hook="${settled.hookName}" afterHook: overridden result (parallel)`)
        }

        if (!val) continue
        if (val.result === 'skip') {
          if (val.injectContext) {
            batchInjectContext.push(val.injectContext)
          }
          if (val.updatedMCPToolOutput !== undefined) {
            lastNonSkipResult = val
          }
          continue
        }

        // Contract violation: updatedInput in parallel mode
        if (val.updatedInput) {
          const violationMsg = `clooks: hook "${settled.hookName}" returned updatedInput in parallel mode — this is a contract violation. Parallel hooks cannot modify tool input.`
          systemMessages.push(violationMsg)
          blockResult = { result: 'block', reason: violationMsg }
          pipelineBlocked = true
          // Record failure for contract violation — always, regardless of onError
          const errorMessage = violationMsg
          failureState = recordFailure(failureState, settled.hookName, eventName, errorMessage)
          failuresDirty = true
          const { maxFailures, maxFailuresMessage } = resolveMaxFailures(settled.hookName, config)
          const newCount = getFailureCount(failureState, settled.hookName, eventName)
          if (maxFailures !== 0 && newCount >= maxFailures) {
            // Collect degraded message but STILL block (contract violations always block)
            const msg = interpolateMessage(maxFailuresMessage, {
              hook: settled.hookName,
              event: eventName,
              count: newCount,
              error: errorMessage,
            })
            degradedMessages.push(msg)
          }
          continue
        }

        if (val.result === 'block') {
          if (val.injectContext) {
            accumulatedInjectContext.push(val.injectContext)
          }
          blockResult = val
          pipelineBlocked = true
          continue
        }

        // Allow or other non-skip result
        if (val.injectContext) {
          batchInjectContext.push(val.injectContext)
        }

        if (debug && val.debugMessage) {
          debugMessages.push(val.debugMessage)
        }

        lastNonSkipResult = val
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
            const diagnostic = formatDiagnostic(
              settled.hookName,
              eventName,
              settled.reason,
              'block',
              usesTargetMap.get(settled.hookName),
              hookPathMap.get(settled.hookName),
            )
            blockResult = { result: 'block', reason: diagnostic }
            pipelineBlocked = true
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
        const lr = settled.value as LifecycleResult
        const val = lr.result as EngineResult | undefined

        // Contract violations already recorded above
        if (val?.updatedInput) continue

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
  }

  // --- Group dispatch loop ---
  for (const group of groups) {
    if (group.type === 'parallel') {
      await executeParallelGroup(group)
    } else {
      await executeSequentialGroup(group)
    }
    if (pipelineBlocked) break
  }

  // --- Build final result ---
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

  if (failuresDirty) {
    await writeFailures(failurePath, failureState)
  }

  return { lastResult, degradedMessages, debugMessages, traceMessages, systemMessages }
}
