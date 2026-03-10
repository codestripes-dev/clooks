// Clooks Engine — Hook execution pipeline
//
// Reads a Claude Code hook event from stdin, loads hooks from .clooks/clooks.yml,
// runs all matching hooks, and writes the response to stdout.
//
// Exit codes:
//   0 — Success. Stdout contains JSON (or nothing if no hooks matched).
//   2 — Fail-closed. Stderr contains a diagnostic message. Action is blocked.
//
// This module is imported by src/cli.ts (the compiled binary entry point).

import type { EventName, HookName } from "./types/branded.js";
import type { ResultTag } from "./types/results.js";
import type { ClaudeCodeOutput, PreToolUseOutput, HookSpecificOutputBase } from "./types/claude-code.js";
import { homedir } from "os";

/** Typed result object used within the engine after the hook return boundary. */
export interface EngineResult {
  result: ResultTag
  reason?: string
  path?: string
  feedback?: string
  injectContext?: string
  debugMessage?: string
  updatedInput?: Record<string, unknown>
}
import type { ClooksConfig, ErrorMode } from "./config/types.js";
import { normalizeKeys } from "./normalize.js";
import { loadConfig } from "./config/index.js";
import type { LoadConfigResult } from "./config/index.js";
import { loadAllHooks } from "./loader.js";
import type { LoadedHook, HookLoadError } from "./loader.js";
import { INJECTABLE_EVENTS, isEventName } from "./config/constants.js";
import { readFailures, writeFailures, recordFailure, clearFailure, getFailureCount, getFailurePath, LOAD_ERROR_EVENT } from "./failures.js";
import { orderHooksForEvent, partitionIntoGroups } from "./ordering.js";
import type { OrderedHook, ExecutionGroup } from "./ordering.js";

/** Exit 0: success. Stdout may contain JSON output. */
export const EXIT_OK = 0 as const;
/** Exit 1: hook-level failure (e.g., WorktreeCreate failure). */
export const EXIT_HOOK_FAILURE = 1 as const;
/**
 * Exit 2: non-zero stderr channel.
 * Used for two distinct purposes in Claude Code's hook contract:
 *   - Fail-closed errors (bad config, unknown event, fatal exception)
 *   - Continuation event "continue" results (feedback delivered via stderr)
 * Both use exit 2 because Claude Code treats any non-zero exit as "hook
 * produced stderr output to process." The semantic difference is in the
 * context (continuation event vs. error), not the exit code itself.
 */
export const EXIT_STDERR = 2 as const;

export type ExitCode = typeof EXIT_OK | typeof EXIT_HOOK_FAILURE | typeof EXIT_STDERR;

// Event categories for result translation.
// Note: The complete set of all 18 event names lives in src/config/constants.ts
// (CLAUDE_CODE_EVENTS), used for config key discrimination. These categorized
// subsets are used for result translation. Both must stay in sync.
const GUARD_EVENTS: Set<EventName> = new Set<EventName>([
  "PreToolUse",
  "UserPromptSubmit",
  "PermissionRequest",
  "Stop",
  "SubagentStop",
  "ConfigChange",
]);

const OBSERVE_EVENTS: Set<EventName> = new Set<EventName>([
  "SessionStart",
  "SessionEnd",
  "InstructionsLoaded",
  "PostToolUse",
  "PostToolUseFailure",
  "Notification",
  "SubagentStart",
  "WorktreeRemove",
  "PreCompact",
]);

const CONTINUATION_EVENTS: Set<EventName> = new Set<EventName>(["TeammateIdle", "TaskCompleted"]);

// INJECTABLE_EVENTS imported from ./config/constants.js

/**
 * Translates a hook result into engine output (stdout string, exit code, stderr).
 *
 * The translation is event-aware: different event categories use different
 * Claude Code output formats.
 *
 * Exported for unit testing.
 */
export function translateResult(
  eventName: EventName,
  result: EngineResult,
): { output?: string; exitCode: ExitCode; stderr?: string } {
  const resultType = result.result;

  // --- PreToolUse: uses hookSpecificOutput ---
  if (eventName === "PreToolUse") {
    if (resultType === "block") {
      const reason = result.reason ?? "clooks: action blocked by hook";
      const hookOutput: PreToolUseOutput = {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      };
      const output: ClaudeCodeOutput = { hookSpecificOutput: hookOutput };
      return { output: JSON.stringify(output), exitCode: EXIT_OK };
    }
    if (resultType === "skip") {
      return { exitCode: EXIT_OK };
    }
    if (resultType === "allow") {
      const hookOutput: PreToolUseOutput = {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
      };
      if (result.injectContext) {
        hookOutput.additionalContext = result.injectContext;
      }
      if (result.updatedInput) {
        hookOutput.updatedInput = result.updatedInput as Record<string, unknown>;
      }
      const output: ClaudeCodeOutput = { hookSpecificOutput: hookOutput };
      return { output: JSON.stringify(output), exitCode: EXIT_OK };
    }
  }

  // --- PermissionRequest: uses hookSpecificOutput.decision ---
  if (eventName === "PermissionRequest") {
    if (resultType === "block") {
      const hookOutput: HookSpecificOutputBase & { decision: { behavior: string } } = {
        hookEventName: "PermissionRequest",
        decision: { behavior: "deny" },
      };
      const output: ClaudeCodeOutput = { hookSpecificOutput: hookOutput as HookSpecificOutputBase };
      return { output: JSON.stringify(output), exitCode: EXIT_OK };
    }
    if (resultType === "skip") {
      return { exitCode: EXIT_OK };
    }
    if (resultType === "allow") {
      return { exitCode: EXIT_OK };
    }
  }

  // --- Other guard events: block → exit 0 + JSON, allow/skip → exit 0 ---
  if (GUARD_EVENTS.has(eventName)) {
    if (resultType === "block") {
      const reason = result.reason ?? "clooks: action blocked by hook";
      const output: ClaudeCodeOutput = { decision: "block", reason };
      return { output: JSON.stringify(output), exitCode: EXIT_OK };
    }
    if (resultType === "allow" || resultType === "skip") {
      if (result.injectContext && INJECTABLE_EVENTS.has(eventName)) {
        const hookOutput: HookSpecificOutputBase = {
          hookEventName: eventName,
          additionalContext: result.injectContext,
        };
        const output: ClaudeCodeOutput = { hookSpecificOutput: hookOutput };
        return { output: JSON.stringify(output), exitCode: EXIT_OK };
      }
      return { exitCode: EXIT_OK };
    }
  }

  // --- Observe events ---
  if (OBSERVE_EVENTS.has(eventName)) {
    // Handle block results from onError: "block" hook errors.
    // Observe events can't actually block (action already completed),
    // so surface the error via additionalContext or systemMessage instead.
    if (resultType === "block") {
      const reason = result.reason ?? "clooks: hook error on observe event";
      if (INJECTABLE_EVENTS.has(eventName)) {
        const hookOutput: HookSpecificOutputBase = {
          hookEventName: eventName,
          additionalContext: reason,
        };
        const output: ClaudeCodeOutput = { hookSpecificOutput: hookOutput };
        return { output: JSON.stringify(output), exitCode: EXIT_OK };
      }
      const output: ClaudeCodeOutput = { systemMessage: reason };
      return { output: JSON.stringify(output), exitCode: EXIT_OK };
    }
    if (result.injectContext && INJECTABLE_EVENTS.has(eventName)) {
      const hookOutput: HookSpecificOutputBase = {
        hookEventName: eventName,
        additionalContext: result.injectContext,
      };
      const output: ClaudeCodeOutput = { hookSpecificOutput: hookOutput };
      return { output: JSON.stringify(output), exitCode: EXIT_OK };
    }
    return { exitCode: EXIT_OK };
  }

  // --- WorktreeCreate: success → stdout path, failure → exit 1, block → exit 1 ---
  if (eventName === "WorktreeCreate") {
    if (resultType === "block") {
      return {
        exitCode: EXIT_HOOK_FAILURE,
        stderr: result.reason ?? "clooks: hook error during worktree creation",
      };
    }
    if (resultType === "success") {
      return { output: result.path, exitCode: EXIT_OK };
    }
    if (resultType === "failure") {
      return {
        exitCode: EXIT_HOOK_FAILURE,
        stderr: result.reason ?? "clooks: worktree creation failed",
      };
    }
  }

  // --- Continuation events ---
  if (CONTINUATION_EVENTS.has(eventName)) {
    // Handle block results from onError: "block" hook errors.
    // Fail-closed for continuation events = stop the agent/teammate.
    if (resultType === "block") {
      const reason = result.reason ?? "clooks: hook error on continuation event";
      const output: ClaudeCodeOutput = {
        continue: false,
        stopReason: reason,
      };
      return { output: JSON.stringify(output), exitCode: EXIT_OK };
    }
    if (resultType === "continue") {
      return {
        exitCode: EXIT_STDERR,
        stderr: result.feedback ?? "",
      };
    }
    if (resultType === "stop") {
      const output: ClaudeCodeOutput = {
        continue: false,
        stopReason: result.reason,
      };
      return { output: JSON.stringify(output), exitCode: EXIT_OK };
    }
    if (resultType === "skip") {
      return { exitCode: EXIT_OK };
    }
  }

  // Unknown result — fail-closed
  return {
    exitCode: EXIT_STDERR,
    stderr: `clooks: hook returned unknown result type: ${String(resultType)}`,
  };
}

/**
 * Filters loaded hooks to those with a handler for the given event name.
 * Exported for unit testing.
 */
export function matchHooksForEvent(
  hooks: LoadedHook[],
  eventName: EventName,
): LoadedHook[] {
  return hooks.filter(
    (h) => typeof (h.hook as unknown as Record<string, unknown>)[eventName] === "function",
  );
}

function resolveMaxFailures(
  hookName: HookName,
  config: ClooksConfig,
): { maxFailures: number; maxFailuresMessage: string } {
  const hookEntry = config.hooks[hookName];
  return {
    maxFailures: hookEntry?.maxFailures ?? config.global.maxFailures,
    maxFailuresMessage: hookEntry?.maxFailuresMessage ?? config.global.maxFailuresMessage,
  };
}

export function interpolateMessage(
  template: string,
  vars: { hook: HookName; event: EventName; count: number; error: string },
): string {
  return template
    .replace(/\{hook\}/g, () => vars.hook)
    .replace(/\{event\}/g, () => vars.event)
    .replace(/\{count\}/g, () => String(vars.count))
    .replace(/\{error\}/g, () => vars.error);
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
  const hookEntry = config.hooks[hookName];
  const hookEventOverride = hookEntry?.events?.[eventName]?.onError;
  if (hookEventOverride !== undefined) return hookEventOverride;

  const hookLevel = hookEntry?.onError;
  if (hookLevel !== undefined) return hookLevel;

  return config.global.onError;
}

function formatDiagnostic(
  hookName: HookName,
  eventName: EventName,
  error: unknown,
  mode: ErrorMode,
): string {
  const errorType = error instanceof Error ? error.constructor.name : "Error";
  const firstLine = error instanceof Error
    ? error.message.split("\n")[0] ?? error.message
    : String(error).split("\n")[0] ?? String(error);
  const action = mode === "block"
    ? "Action blocked"
    : "Continuing";
  return `[clooks] Hook "${hookName}" failed on ${eventName} (${errorType}: ${firstLine}). ${action} (onError: ${mode}).`;
}

function formatTraceMessage(
  hookName: HookName,
  error: unknown,
): string {
  const errorType = error instanceof Error ? error.constructor.name : "Error";
  const firstLine = error instanceof Error
    ? error.message.split("\n")[0] ?? error.message
    : String(error).split("\n")[0] ?? String(error);
  return `Hook "${hookName}" errored: ${errorType}: ${firstLine}. Configured as onError: trace — action not affected.`;
}

async function runHookWithTimeout(
  handler: Function,
  args: [Record<string, unknown>, Record<string, unknown>],
  timeoutMs: number,
  hookName: string,
): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`hook "${hookName}" timed out after ${timeoutMs}ms`)),
      timeoutMs,
    )
  })
  try {
    return await Promise.race([handler(...args), timeout])
  } finally {
    clearTimeout(timer!)
  }
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
): Promise<{
  lastResult?: EngineResult;
  degradedMessages: string[];
  debugMessages: string[];
  traceMessages: string[];
  systemMessages: string[];
}> {
  const debug = process.env.CLOOKS_DEBUG === "true";
  const debugMessages: string[] = [];
  const degradedMessages: string[] = [];
  const traceMessages: string[] = [];
  const systemMessages: string[] = [];
  let lastResult: EngineResult | undefined;

  let failureState = await readFailures(failurePath);
  let failuresDirty = false;

  // Process load errors through the circuit breaker.
  // Import failures always block regardless of onError config.
  // Load errors use LOAD_ERROR_EVENT so failures accumulate in a single
  // counter regardless of which event triggered the invocation.
  for (const loadError of loadErrors) {
    const { maxFailures, maxFailuresMessage } = resolveMaxFailures(loadError.name, config);
    failureState = recordFailure(failureState, loadError.name, LOAD_ERROR_EVENT, loadError.error);
    failuresDirty = true;
    const newCount = getFailureCount(failureState, loadError.name, LOAD_ERROR_EVENT);

    if (maxFailures === 0 || newCount < maxFailures) {
      // Under threshold or circuit breaker disabled — fail-closed
      await writeFailures(failurePath, failureState);
      systemMessages.push(
        `[clooks] Hook "${loadError.name}" failed to load: ${loadError.error}\n` +
        `Fix: Remove "${loadError.name}" from your clooks.yml, or restore the hook file.\n` +
        `This hook will be disabled after ${maxFailures} consecutive load failures.`
      );
      lastResult = { result: "block", reason: formatDiagnostic(loadError.name, eventName, new Error(loadError.error), "block") };
      return { lastResult, degradedMessages, debugMessages, traceMessages, systemMessages };
    }

    // Threshold reached or already degraded — degrade (don't block)
    systemMessages.push(
      `[clooks] Hook "${loadError.name}" has been disabled after ${maxFailures} consecutive load failures.\n` +
      `Fix: Remove "${loadError.name}" from your clooks.yml, or restore the hook file.`
    );
    const msg = interpolateMessage(maxFailuresMessage, {
      hook: loadError.name,
      event: LOAD_ERROR_EVENT,
      count: newCount,
      error: loadError.error,
    });
    degradedMessages.push(msg);
  }

  // --- Pipeline state ---
  const originalToolInput = normalized.toolInput as Record<string, unknown> | undefined;
  let currentToolInput = originalToolInput;
  const accumulatedInjectContext: string[] = [];
  let pipelineBlocked = false;
  let blockResult: EngineResult | undefined;
  let lastNonSkipResult: EngineResult | undefined;

  // --- Order and partition ---
  const orderedHooks = orderHooksForEvent(matched, config.events[eventName], config.hooks, eventName);
  const groups = partitionIntoGroups(orderedHooks, eventName);

  // --- Sequential group runner ---
  async function executeSequentialGroup(group: ExecutionGroup): Promise<void> {
    // Per-group AbortController — never aborted for sequential groups
    const sharedController = new AbortController();
    for (const hook of group.hooks) {
      const loaded = hook.loaded;
      const handler = (loaded.hook as unknown as Record<string, unknown>)[
        eventName
      ] as Function;
      const { maxFailures, maxFailuresMessage } = resolveMaxFailures(loaded.name, config);

      // Build context: clone normalized, set pipeline fields
      const context: Record<string, unknown> = { ...normalized };
      if (currentToolInput !== undefined) {
        context.toolInput = currentToolInput;
      }
      if (originalToolInput !== undefined) {
        context.originalToolInput = originalToolInput;
      }
      context.parallel = false;
      context.signal = sharedController.signal;

      const timeout = resolveTimeout(loaded.name, config);

      let result: unknown;
      try {
        result = await runHookWithTimeout(handler, [context, loaded.config], timeout, loaded.name);
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        const onErrorMode = resolveOnError(loaded.name, eventName, config);

        // Runtime fallback: hook-level "trace" on a non-injectable event → "continue"
        let effectiveMode = onErrorMode;
        if (effectiveMode === "trace" && !INJECTABLE_EVENTS.has(eventName)) {
          systemMessages.push(
            `Hook "${loaded.name}" has onError: "trace" but ${eventName} does not support additionalContext. Falling back to "continue".`
          );
          effectiveMode = "continue";
        }

        if (effectiveMode === "block") {
          failureState = recordFailure(failureState, loaded.name, eventName, errorMessage);
          failuresDirty = true;
          const newCount = getFailureCount(failureState, loaded.name, eventName);

          if (maxFailures === 0 || newCount < maxFailures) {
            // Under threshold — block. Write failures and stop pipeline.
            await writeFailures(failurePath, failureState);
            failuresDirty = false;
            blockResult = { result: "block", reason: formatDiagnostic(loaded.name, eventName, e, "block") };
            pipelineBlocked = true;
            return;
          }

          // At/above threshold — degraded
          const msg = interpolateMessage(maxFailuresMessage, {
            hook: loaded.name,
            event: eventName,
            count: newCount,
            error: errorMessage,
          });
          degradedMessages.push(msg);
          continue;
        }

        if (effectiveMode === "continue") {
          systemMessages.push(formatDiagnostic(loaded.name, eventName, e, "continue"));
          if (debug) {
            debugMessages.push(formatDiagnostic(loaded.name, eventName, e, "continue"));
          }
          continue;
        }

        if (effectiveMode === "trace") {
          traceMessages.push(formatTraceMessage(loaded.name, e));
          continue;
        }

        continue;
      }

      // Success — clear any failure state for this hook+event
      if (getFailureCount(failureState, loaded.name, eventName) > 0) {
        failureState = clearFailure(failureState, loaded.name, eventName);
        failuresDirty = true;
      }

      if (result === undefined || result === null) {
        if (debug) {
          debugMessages.push(`hook="${loaded.name}" event="${eventName}" returned: null/undefined`);
        }
        continue;
      }

      // Single cast at the boundary where dynamically-imported hook code returns.
      const resultObj = result as EngineResult;

      if (debug) {
        debugMessages.push(`hook="${loaded.name}" event="${eventName}" returned: ${JSON.stringify(resultObj)}`);
      }

      // Collect debug messages from every hook result
      if (debug && resultObj.debugMessage) {
        debugMessages.push(resultObj.debugMessage);
      }

      // Block bails out immediately — stop the group and signal pipeline
      if (resultObj.result === "block") {
        if (resultObj.injectContext) {
          accumulatedInjectContext.push(resultObj.injectContext);
        }
        blockResult = resultObj;
        pipelineBlocked = true;
        return;
      }

      // Skip does not affect pipeline state
      if (resultObj.result === "skip") {
        continue;
      }

      // Allow or other non-skip result: update pipeline state
      if (resultObj.updatedInput) {
        currentToolInput = resultObj.updatedInput;
      }
      if (resultObj.injectContext) {
        accumulatedInjectContext.push(resultObj.injectContext);
      }
      lastNonSkipResult = resultObj;
    }
  }

  // --- Parallel group runner ---
  async function executeParallelGroup(group: ExecutionGroup): Promise<void> {
    const controller = new AbortController();

    interface SettledHookResult {
      status: "fulfilled" | "rejected"
      value?: unknown
      reason?: unknown
      hookName: HookName
    }

    function shouldShortCircuit(settled: SettledHookResult): boolean {
      if (settled.status === "fulfilled") {
        const val = settled.value as EngineResult | undefined;
        if (val?.result === "block") return true;
        if (val?.updatedInput) return true; // contract violation
      }
      if (settled.status === "rejected") {
        const onErrorMode = resolveOnError(settled.hookName, eventName, config);
        if (onErrorMode === "block") {
          const { maxFailures } = resolveMaxFailures(settled.hookName, config);
          const currentCount = getFailureCount(failureState, settled.hookName, eventName);
          const projectedCount = currentCount + 1;
          // Only short-circuit if under threshold (same as sequential runner)
          if (maxFailures === 0 || projectedCount < maxFailures) {
            return true;
          }
          // At/above threshold — will degrade, don't short-circuit
          return false;
        }
      }
      return false;
    }

    // Build tasks — start all hooks concurrently
    const hookTasks = group.hooks.map((hook) => {
      const loaded = hook.loaded;
      const handler = (loaded.hook as unknown as Record<string, unknown>)[
        eventName
      ] as Function;

      // Build context: all parallel hooks see the same toolInput
      const context: Record<string, unknown> = { ...normalized };
      if (currentToolInput !== undefined) {
        context.toolInput = currentToolInput;
      }
      if (originalToolInput !== undefined) {
        context.originalToolInput = originalToolInput;
      }
      context.parallel = true;
      context.signal = controller.signal;

      const timeout = resolveTimeout(loaded.name, config);
      const promise = runHookWithTimeout(handler, [context, loaded.config], timeout, loaded.name);

      return { promise, hookName: loaded.name };
    });

    // Custom short-circuit batch runner
    const { results, shortCircuited } = await new Promise<{
      results: (SettledHookResult | undefined)[]
      shortCircuited: boolean
    }>((resolve) => {
      if (hookTasks.length === 0) {
        resolve({ results: [], shortCircuited: false });
        return;
      }

      let resolved = false;
      let settledCount = 0;
      const results: (SettledHookResult | undefined)[] = new Array(hookTasks.length);

      hookTasks.forEach((task, i) => {
        task.promise
          .then((value): SettledHookResult => ({ status: "fulfilled" as const, value, hookName: task.hookName }))
          .catch((reason): SettledHookResult => ({ status: "rejected" as const, reason, hookName: task.hookName }))
          .then((settled) => {
            // Always store the settled result so the circuit breaker
            // update loop can process hooks that settled before or
            // concurrently with the short-circuit trigger.
            results[i] = settled;
            settledCount++;
            if (resolved) return;

            if (shouldShortCircuit(settled)) {
              resolved = true;
              controller.abort();
              resolve({ results, shortCircuited: true });
              return;
            }

            if (settledCount === hookTasks.length) {
              resolved = true;
              resolve({ results, shortCircuited: false });
            }
          });
      });
    });

    // --- Merge results ---
    const batchInjectContext: string[] = [];

    for (let i = 0; i < results.length; i++) {
      const settled = results[i];
      if (!settled) continue; // unsettled (short-circuited before this hook finished)

      if (settled.status === "fulfilled") {
        const val = settled.value as EngineResult | undefined;
        if (!val || val.result === "skip") continue;

        // Contract violation: updatedInput in parallel mode
        if (val.updatedInput) {
          const violationMsg = `clooks: hook "${settled.hookName}" returned updatedInput in parallel mode — this is a contract violation. Parallel hooks cannot modify tool input.`;
          systemMessages.push(violationMsg);
          blockResult = { result: "block", reason: violationMsg };
          pipelineBlocked = true;
          // Record failure for contract violation — always, regardless of onError
          const errorMessage = violationMsg;
          failureState = recordFailure(failureState, settled.hookName, eventName, errorMessage);
          failuresDirty = true;
          const { maxFailures, maxFailuresMessage } = resolveMaxFailures(settled.hookName, config);
          const newCount = getFailureCount(failureState, settled.hookName, eventName);
          if (maxFailures !== 0 && newCount >= maxFailures) {
            // Collect degraded message but STILL block (contract violations always block)
            const msg = interpolateMessage(maxFailuresMessage, {
              hook: settled.hookName,
              event: eventName,
              count: newCount,
              error: errorMessage,
            });
            degradedMessages.push(msg);
          }
          continue;
        }

        if (val.result === "block") {
          if (val.injectContext) {
            accumulatedInjectContext.push(val.injectContext);
          }
          blockResult = val;
          pipelineBlocked = true;
          continue;
        }

        // Allow or other non-skip result
        if (val.injectContext) {
          batchInjectContext.push(val.injectContext);
        }

        if (debug && val.debugMessage) {
          debugMessages.push(val.debugMessage);
        }

        lastNonSkipResult = val;
      }

      if (settled.status === "rejected") {
        const onErrorMode = resolveOnError(settled.hookName, eventName, config);

        // Runtime fallback: hook-level "trace" on a non-injectable event → "continue"
        let effectiveMode = onErrorMode;
        if (effectiveMode === "trace" && !INJECTABLE_EVENTS.has(eventName)) {
          systemMessages.push(
            `Hook "${settled.hookName}" has onError: "trace" but ${eventName} does not support additionalContext. Falling back to "continue".`
          );
          effectiveMode = "continue";
        }

        if (effectiveMode === "block") {
          const { maxFailures } = resolveMaxFailures(settled.hookName, config);
          const currentCount = getFailureCount(failureState, settled.hookName, eventName);
          const projectedCount = currentCount + 1;
          if (maxFailures === 0 || projectedCount < maxFailures) {
            // Under threshold — block
            const diagnostic = formatDiagnostic(settled.hookName, eventName, settled.reason, "block");
            blockResult = { result: "block", reason: diagnostic };
            pipelineBlocked = true;
          }
          // At/above threshold case handled in circuit breaker loop below
        } else if (effectiveMode === "continue") {
          systemMessages.push(formatDiagnostic(settled.hookName, eventName, settled.reason, "continue"));
          if (debug) {
            debugMessages.push(formatDiagnostic(settled.hookName, eventName, settled.reason, "continue"));
          }
        } else if (effectiveMode === "trace") {
          traceMessages.push(formatTraceMessage(settled.hookName, settled.reason));
        }
      }
    }

    // Merge batch injectContext into pipeline accumulator
    if (batchInjectContext.length > 0) {
      accumulatedInjectContext.push(...batchInjectContext);
    }

    // --- Update circuit breaker state SEQUENTIALLY after all hooks settle ---
    for (let i = 0; i < results.length; i++) {
      const settled = results[i];
      if (!settled) continue;

      if (settled.status === "fulfilled") {
        const val = settled.value as EngineResult | undefined;

        // Contract violations already recorded above
        if (val?.updatedInput) continue;

        // Success — clear any failure state (any successful invocation, matching sequential runner)
        if (getFailureCount(failureState, settled.hookName, eventName) > 0) {
          failureState = clearFailure(failureState, settled.hookName, eventName);
          failuresDirty = true;
        }
      }

      if (settled.status === "rejected") {
        const onErrorMode = resolveOnError(settled.hookName, eventName, config);
        if (onErrorMode === "block") {
          const errorMessage = settled.reason instanceof Error ? settled.reason.message : String(settled.reason);
          failureState = recordFailure(failureState, settled.hookName, eventName, errorMessage);
          failuresDirty = true;

          // Check threshold for degraded mode
          const { maxFailures, maxFailuresMessage } = resolveMaxFailures(settled.hookName, config);
          const newCount = getFailureCount(failureState, settled.hookName, eventName);
          if (maxFailures !== 0 && newCount >= maxFailures) {
            const msg = interpolateMessage(maxFailuresMessage, {
              hook: settled.hookName,
              event: eventName,
              count: newCount,
              error: errorMessage,
            });
            degradedMessages.push(msg);
          }
        }
        // onError: "continue" and "trace" do NOT call recordFailure
      }
    }

    // Write failures once at end of batch
    if (failuresDirty) {
      await writeFailures(failurePath, failureState);
      failuresDirty = false;
    }
  }

  // --- Group dispatch loop ---
  for (const group of groups) {
    if (group.type === "parallel") {
      await executeParallelGroup(group);
    } else {
      await executeSequentialGroup(group);
    }
    if (pipelineBlocked) break;
  }

  // --- Build final result ---
  if (pipelineBlocked && blockResult) {
    // For injectable events, merge accumulated injectContext from prior groups into block result
    if (INJECTABLE_EVENTS.has(eventName) && accumulatedInjectContext.length > 0) {
      // Block result's own injectContext was already added to accumulator; replace with full accumulation
      const accumulated = accumulatedInjectContext.join("\n");
      blockResult = { ...blockResult, injectContext: accumulated };
    }
    lastResult = blockResult;
  } else if (lastNonSkipResult) {
    lastResult = { ...lastNonSkipResult };
    if (accumulatedInjectContext.length > 0) {
      lastResult.injectContext = accumulatedInjectContext.join("\n");
    }
    // If any hook returned updatedInput (reference comparison)
    if (currentToolInput !== originalToolInput) {
      lastResult.updatedInput = currentToolInput;
    }
  } else if (accumulatedInjectContext.length > 0) {
    // All hooks skipped but accumulated injectContext exists (e.g., from trace errors)
    lastResult = { result: "allow", injectContext: accumulatedInjectContext.join("\n") };
  }

  if (failuresDirty) {
    await writeFailures(failurePath, failureState);
  }

  return { lastResult, degradedMessages, debugMessages, traceMessages, systemMessages };
}

/**
 * Builds shadow warning messages for SessionStart events.
 * Extracted for testability — used by runEngine() to inject systemMessage warnings.
 */
export function buildShadowWarnings(eventName: string, shadows: HookName[]): string[] {
  if (eventName !== "SessionStart" || shadows.length === 0) return []
  return shadows.map(name =>
    `clooks: project hook "${name}" is shadowing a global hook with the same name.`
  )
}

/**
 * Main engine entry point. Reads stdin, loads hooks from config, runs matching
 * hooks, and writes output. Called by src/cli.ts when no CLI flags are present.
 */
export async function runEngine(): Promise<void> {
  try {
    const projectRoot = process.cwd();
    const homeRoot = process.env.CLOOKS_HOME_ROOT ?? homedir();

    // --- Load config (optional — no config = no hooks) ---
    let config: ClooksConfig;
    let result: LoadConfigResult | null;
    try {
      result = await loadConfig(projectRoot, { homeRoot });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      process.stderr.write(`clooks: ${message}\n`);
      process.exit(EXIT_STDERR);
    }

    if (result === null) {
      process.exit(EXIT_OK);
    }

    config = result!.config;
    const shadows = result!.shadows;
    const hasProjectConfig = result!.hasProjectConfig;

    // --- Compute failure path once ---
    const failurePath = getFailurePath(projectRoot, homeRoot, hasProjectConfig);

    // --- Load all hooks (fault-tolerant — load errors go through circuit breaker) ---
    const debug = process.env.CLOOKS_DEBUG === "true";
    const engineDebugLines: string[] = [];
    const { loaded: hooks, loadErrors } = await loadAllHooks(config, projectRoot, homeRoot);

    if (debug) {
      engineDebugLines.push(`loaded ${hooks.length} hook(s): ${hooks.map(h => h.name).join(", ") || "(none)"}`);
      for (const err of loadErrors) {
        engineDebugLines.push(`load error: ${err.name} — ${err.error}`);
      }
    }

    if (hooks.length === 0 && loadErrors.length === 0) {
      if (debug) {
        for (const line of engineDebugLines) {
          process.stderr.write(`[clooks:debug] ${line}\n`);
        }
      }
      process.exit(EXIT_OK);
    }

    // --- Read and parse stdin ---
    let input: unknown;
    try {
      input = await Bun.stdin.json();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      process.stderr.write(
        `clooks: failed to parse stdin JSON: ${message}\n`,
      );
      process.exit(EXIT_STDERR);
    }

    if (
      input === null ||
      typeof input !== "object" ||
      Array.isArray(input)
    ) {
      process.stderr.write("clooks: stdin payload is not a JSON object\n");
      process.exit(EXIT_STDERR);
    }

    const payload = input as Record<string, unknown>;
    const rawEventName = payload.hook_event_name;

    if (typeof rawEventName !== "string" || !isEventName(rawEventName)) {
      process.stderr.write(
        "clooks: stdin payload missing or unrecognized hook_event_name field\n",
      );
      process.exit(EXIT_STDERR);
    }
    const eventName: EventName = rawEventName;

    // --- Match hooks for this event ---
    const matched = matchHooksForEvent(hooks, eventName);

    if (debug) {
      engineDebugLines.push(`event="${eventName}" matched ${matched.length} hook(s): ${matched.map(h => h.name).join(", ") || "(none)"}`);
    }

    if (matched.length === 0 && loadErrors.length === 0) {
      if (debug) {
        for (const line of engineDebugLines) {
          process.stderr.write(`[clooks:debug] ${line}\n`);
        }
      }
      process.exit(EXIT_OK);
    }

    // --- Normalize payload ---
    const normalized = normalizeKeys(payload);
    normalized.event = normalized.hookEventName;
    delete normalized.hookEventName;

    // --- Shadow warnings (SessionStart only) ---
    const startupWarnings: string[] = buildShadowWarnings(eventName, shadows);

    // --- Startup validation: warn about hook-level trace on non-injectable events ---
    for (const loaded of hooks) {
      const hookEntry = config.hooks[loaded.name];
      if (hookEntry?.onError === "trace" && !INJECTABLE_EVENTS.has(eventName)) {
        const handlesEvent = typeof (loaded.hook as unknown as Record<string, unknown>)[eventName] === "function";
        if (handlesEvent) {
          startupWarnings.push(
            `Hook "${loaded.name}" has onError: "trace" but ${eventName} ` +
            `does not support additionalContext. Trace will fall back to "continue" for ${eventName}.`
          );
        }
      }
    }

    // --- Execute hooks with circuit breaker ---
    let { lastResult, degradedMessages, debugMessages, traceMessages, systemMessages } = await executeHooks(
      matched,
      eventName,
      normalized,
      config,
      failurePath,
      loadErrors,
    );

    // --- Handle trace messages (from onError: "trace" hooks) ---
    // Injected first so additionalContext order is: trace → degraded → debug
    if (traceMessages.length > 0 && INJECTABLE_EVENTS.has(eventName)) {
      const traceBlock = traceMessages.join("\n");
      if (lastResult === undefined) {
        lastResult = { result: "allow", injectContext: traceBlock };
      } else {
        const existing = typeof lastResult.injectContext === "string"
          ? lastResult.injectContext + "\n"
          : "";
        lastResult.injectContext = existing + traceBlock;
      }
    }

    // --- Handle degraded hook messages ---
    if (degradedMessages.length > 0) {
      if (INJECTABLE_EVENTS.has(eventName)) {
        if (lastResult === undefined) {
          lastResult = { result: "allow", injectContext: degradedMessages.join("\n") };
        } else {
          const existing = typeof lastResult.injectContext === "string"
            ? lastResult.injectContext + "\n"
            : "";
          lastResult.injectContext = existing + degradedMessages.join("\n");
        }
      } else {
        for (const msg of degradedMessages) {
          process.stderr.write(`clooks: warning: ${msg}\n`);
        }
      }
    }

    // --- Merge engine-level and hook-level debug lines ---
    if (debug) {
      const allDebug = [...engineDebugLines, ...debugMessages];
      // Always write to stderr for external visibility
      for (const line of allDebug) {
        process.stderr.write(`[clooks:debug] ${line}\n`);
      }

      // Inject into additionalContext so Claude can read it
      if (allDebug.length > 0) {
        const debugBlock = allDebug.map(l => `[clooks:debug] ${l}`).join("\n");
        if (lastResult === undefined) {
          lastResult = { result: "allow", injectContext: debugBlock };
        } else {
          const existing = typeof lastResult.injectContext === "string"
            ? lastResult.injectContext + "\n"
            : "";
          lastResult.injectContext = existing + debugBlock;
        }
      }
    }

    // --- Translate and output ---
    if (lastResult === undefined) {
      // Even with no hook results, we may have system messages to deliver
      const allSystemMessages = [...startupWarnings, ...systemMessages];
      if (allSystemMessages.length > 0) {
        const output: ClaudeCodeOutput = { systemMessage: allSystemMessages.join("\n") };
        process.stdout.write(JSON.stringify(output) + "\n");
      }
      process.exit(EXIT_OK);
    }

    const translated = translateResult(eventName, lastResult);

    // --- Inject systemMessage into translated output ---
    const allSystemMessages = [...startupWarnings, ...systemMessages];
    if (allSystemMessages.length > 0) {
      const systemMessage = allSystemMessages.join("\n");
      if (translated.output) {
        const parsed = JSON.parse(translated.output) as ClaudeCodeOutput;
        parsed.systemMessage = systemMessage;
        translated.output = JSON.stringify(parsed);
      } else {
        translated.output = JSON.stringify({ systemMessage } as ClaudeCodeOutput);
      }
    }

    if (translated.stderr) {
      process.stderr.write(`${translated.stderr}\n`);
    }

    if (translated.output) {
      process.stdout.write(translated.output + "\n");
    }

    if (translated.exitCode !== EXIT_OK) {
      process.exit(translated.exitCode);
    }

    process.exitCode = EXIT_OK;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    process.stderr.write(`clooks: fatal error: ${message}\n`);
    process.exit(EXIT_STDERR);
  }
}
