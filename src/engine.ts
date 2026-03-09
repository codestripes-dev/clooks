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

import type { ClaudeCodeOutput, PreToolUseOutput, HookSpecificOutputBase } from "./types/claude-code.js";
import type { ClooksConfig, ErrorMode } from "./config/types.js";
import { normalizeKeys } from "./normalize.js";
import { loadConfig } from "./config/index.js";
import { ConfigNotFoundError } from "./config/parse.js";
import { loadAllHooks } from "./loader.js";
import type { LoadedHook, HookLoadError } from "./loader.js";
import { INJECTABLE_EVENTS } from "./config/constants.js";
import { readFailures, writeFailures, recordFailure, clearFailure, getFailureCount } from "./failures.js";

// Event categories for result translation.
// Note: The complete set of all 18 event names lives in src/config/constants.ts
// (CLAUDE_CODE_EVENTS), used for config key discrimination. These categorized
// subsets are used for result translation. Both must stay in sync.
const GUARD_EVENTS = new Set([
  "PreToolUse",
  "UserPromptSubmit",
  "PermissionRequest",
  "Stop",
  "SubagentStop",
  "ConfigChange",
]);

const OBSERVE_EVENTS = new Set([
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

const CONTINUATION_EVENTS = new Set(["TeammateIdle", "TaskCompleted"]);

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
  eventName: string,
  result: Record<string, unknown>
): { output?: string; exitCode: number; stderr?: string } {
  const resultType = result.result as string;

  // --- PreToolUse: uses hookSpecificOutput ---
  if (eventName === "PreToolUse") {
    if (resultType === "block") {
      const reason = (result.reason as string) ?? "clooks: action blocked by hook";
      const hookOutput: PreToolUseOutput = {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      };
      const output: ClaudeCodeOutput = { hookSpecificOutput: hookOutput };
      return { output: JSON.stringify(output), exitCode: 0 };
    }
    if (resultType === "skip") {
      return { exitCode: 0 };
    }
    if (resultType === "allow") {
      const hookOutput: PreToolUseOutput = {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
      };
      if (result.injectContext) {
        hookOutput.additionalContext = result.injectContext as string;
      }
      const output: ClaudeCodeOutput = { hookSpecificOutput: hookOutput };
      return { output: JSON.stringify(output), exitCode: 0 };
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
      return { output: JSON.stringify(output), exitCode: 0 };
    }
    if (resultType === "skip") {
      return { exitCode: 0 };
    }
    if (resultType === "allow") {
      return { exitCode: 0 };
    }
  }

  // --- Other guard events: block → exit 0 + JSON, allow/skip → exit 0 ---
  if (GUARD_EVENTS.has(eventName)) {
    if (resultType === "block") {
      const reason = (result.reason as string) ?? "clooks: action blocked by hook";
      const output: ClaudeCodeOutput = { decision: "block", reason };
      return { output: JSON.stringify(output), exitCode: 0 };
    }
    if (resultType === "allow" || resultType === "skip") {
      if (result.injectContext && INJECTABLE_EVENTS.has(eventName)) {
        const hookOutput: HookSpecificOutputBase = {
          hookEventName: eventName,
          additionalContext: result.injectContext as string,
        };
        const output: ClaudeCodeOutput = { hookSpecificOutput: hookOutput };
        return { output: JSON.stringify(output), exitCode: 0 };
      }
      return { exitCode: 0 };
    }
  }

  // --- Observe events ---
  if (OBSERVE_EVENTS.has(eventName)) {
    // Handle block results from onError: "block" hook errors.
    // Observe events can't actually block (action already completed),
    // so surface the error via additionalContext or systemMessage instead.
    if (resultType === "block") {
      const reason = (result.reason as string) ?? "clooks: hook error on observe event";
      if (INJECTABLE_EVENTS.has(eventName)) {
        const hookOutput: HookSpecificOutputBase = {
          hookEventName: eventName,
          additionalContext: reason,
        };
        const output: ClaudeCodeOutput = { hookSpecificOutput: hookOutput };
        return { output: JSON.stringify(output), exitCode: 0 };
      }
      const output: ClaudeCodeOutput = { systemMessage: reason };
      return { output: JSON.stringify(output), exitCode: 0 };
    }
    if (result.injectContext && INJECTABLE_EVENTS.has(eventName)) {
      const hookOutput: HookSpecificOutputBase = {
        hookEventName: eventName,
        additionalContext: result.injectContext as string,
      };
      const output: ClaudeCodeOutput = { hookSpecificOutput: hookOutput };
      return { output: JSON.stringify(output), exitCode: 0 };
    }
    return { exitCode: 0 };
  }

  // --- WorktreeCreate: success → stdout path, failure → exit 1, block → exit 1 ---
  if (eventName === "WorktreeCreate") {
    if (resultType === "block") {
      return {
        exitCode: 1,
        stderr: (result.reason as string) ?? "clooks: hook error during worktree creation",
      };
    }
    if (resultType === "success") {
      return { output: result.path as string, exitCode: 0 };
    }
    if (resultType === "failure") {
      return {
        exitCode: 1,
        stderr: (result.reason as string) ?? "clooks: worktree creation failed",
      };
    }
  }

  // --- Continuation events ---
  if (CONTINUATION_EVENTS.has(eventName)) {
    // Handle block results from onError: "block" hook errors.
    // Fail-closed for continuation events = stop the agent/teammate.
    if (resultType === "block") {
      const reason = (result.reason as string) ?? "clooks: hook error on continuation event";
      const output: ClaudeCodeOutput = {
        continue: false,
        stopReason: reason,
      };
      return { output: JSON.stringify(output), exitCode: 0 };
    }
    if (resultType === "continue") {
      return {
        exitCode: 2,
        stderr: (result.feedback as string) ?? "",
      };
    }
    if (resultType === "stop") {
      const output: ClaudeCodeOutput = {
        continue: false,
        stopReason: result.reason as string,
      };
      return { output: JSON.stringify(output), exitCode: 0 };
    }
    if (resultType === "skip") {
      return { exitCode: 0 };
    }
  }

  // Unknown result — fail-closed
  return {
    exitCode: 2,
    stderr: `clooks: hook returned unknown result type: ${String(resultType)}`,
  };
}

/**
 * Filters loaded hooks to those with a handler for the given event name.
 * Exported for unit testing.
 */
export function matchHooksForEvent(
  hooks: LoadedHook[],
  eventName: string,
): LoadedHook[] {
  return hooks.filter(
    (h) => typeof (h.hook as unknown as Record<string, unknown>)[eventName] === "function",
  );
}

function resolveMaxFailures(
  hookName: string,
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
  vars: { hook: string; event: string; count: number; error: string },
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
  hookName: string,
  eventName: string,
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
  hookName: string,
  eventName: string,
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
  hookName: string,
  error: unknown,
): string {
  const errorType = error instanceof Error ? error.constructor.name : "Error";
  const firstLine = error instanceof Error
    ? error.message.split("\n")[0] ?? error.message
    : String(error).split("\n")[0] ?? String(error);
  return `Hook "${hookName}" errored: ${errorType}: ${firstLine}. Configured as onError: trace — action not affected.`;
}

/**
 * Runs matched hooks with circuit breaker logic.
 * Also processes load errors through the circuit breaker — a hook that
 * fails to import is treated as a failure for the current event.
 * Extracted from runEngine() for testability.
 */
export async function executeHooks(
  matched: LoadedHook[],
  eventName: string,
  normalized: Record<string, unknown>,
  config: ClooksConfig,
  projectRoot: string,
  loadErrors: HookLoadError[] = [],
): Promise<{
  lastResult?: Record<string, unknown>;
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
  let lastResult: Record<string, unknown> | undefined;

  let failureState = await readFailures(projectRoot);
  let failuresDirty = false;

  // Process load errors through the circuit breaker.
  // Import failures always block regardless of onError config.
  for (const loadError of loadErrors) {
    const { maxFailures, maxFailuresMessage } = resolveMaxFailures(loadError.name, config);
    failureState = recordFailure(failureState, loadError.name, eventName, loadError.error);
    failuresDirty = true;
    const newCount = getFailureCount(failureState, loadError.name, eventName);

    if (maxFailures === 0 || newCount < maxFailures) {
      // Under threshold or circuit breaker disabled — fail-closed
      await writeFailures(projectRoot, failureState);
      lastResult = { result: "block", reason: formatDiagnostic(loadError.name, eventName, new Error(loadError.error), "block") };
      return { lastResult, degradedMessages, debugMessages, traceMessages, systemMessages };
    }

    // Threshold reached or already degraded — skip
    const msg = interpolateMessage(maxFailuresMessage, {
      hook: loadError.name,
      event: eventName,
      count: newCount,
      error: loadError.error,
    });
    degradedMessages.push(msg);
  }

  for (const loaded of matched) {
    const handler = (loaded.hook as unknown as Record<string, unknown>)[
      eventName
    ] as Function;
    const { maxFailures, maxFailuresMessage } = resolveMaxFailures(loaded.name, config);

    let result: unknown;
    try {
      result = await handler(normalized, loaded.config);
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
          // Under threshold — block
          await writeFailures(projectRoot, failureState);
          lastResult = { result: "block", reason: formatDiagnostic(loaded.name, eventName, e, "block") };
          break;
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

    const resultObj = result as Record<string, unknown>;
    const resultType = resultObj.result as string;

    if (debug) {
      debugMessages.push(`hook="${loaded.name}" event="${eventName}" returned: ${JSON.stringify(resultObj)}`);
    }

    // Collect debug messages from every hook result
    if (debug && typeof resultObj.debugMessage === "string") {
      debugMessages.push(resultObj.debugMessage);
    }

    // Block bails out immediately
    if (resultType === "block") {
      lastResult = resultObj;
      break;
    }

    // Non-skip results are kept
    if (resultType !== "skip") {
      lastResult = resultObj;
    }
  }

  if (failuresDirty) {
    await writeFailures(projectRoot, failureState);
  }

  return { lastResult, degradedMessages, debugMessages, traceMessages, systemMessages };
}

/**
 * Main engine entry point. Reads stdin, loads hooks from config, runs matching
 * hooks, and writes output. Called by src/cli.ts when no CLI flags are present.
 */
export async function runEngine(): Promise<void> {
  try {
    const projectRoot = process.cwd();

    // --- Load config (optional — no config = no hooks) ---
    let config: ClooksConfig;
    try {
      config = await loadConfig(projectRoot);
    } catch (e) {
      if (e instanceof ConfigNotFoundError) {
        process.exit(0);
      }
      const message = e instanceof Error ? e.message : String(e);
      process.stderr.write(`clooks: ${message}\n`);
      process.exit(2);
    }

    // --- Load all hooks (fault-tolerant — load errors go through circuit breaker) ---
    const debug = process.env.CLOOKS_DEBUG === "true";
    const engineDebugLines: string[] = [];
    const { loaded: hooks, loadErrors } = await loadAllHooks(config, projectRoot);

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
      process.exit(0);
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
      process.exit(2);
    }

    if (
      input === null ||
      typeof input !== "object" ||
      Array.isArray(input)
    ) {
      process.stderr.write("clooks: stdin payload is not a JSON object\n");
      process.exit(2);
    }

    const payload = input as Record<string, unknown>;
    const eventName = payload.hook_event_name;

    if (typeof eventName !== "string" || eventName.length === 0) {
      process.stderr.write(
        "clooks: stdin payload missing or empty hook_event_name field\n",
      );
      process.exit(2);
    }

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
      process.exit(0);
    }

    // --- Normalize payload ---
    const normalized = normalizeKeys(payload);
    normalized.event = normalized.hookEventName;
    delete normalized.hookEventName;

    // --- Startup validation: warn about hook-level trace on non-injectable events ---
    const startupWarnings: string[] = [];
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
      projectRoot,
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
      process.exit(0);
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

    if (translated.exitCode !== 0) {
      process.exit(translated.exitCode);
    }

    process.exitCode = 0;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    process.stderr.write(`clooks: fatal error: ${message}\n`);
    process.exit(2);
  }
}
