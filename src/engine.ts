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
import type { ClooksConfig } from "./config/types.js";
import { normalizeKeys } from "./normalize.js";
import { loadConfig } from "./config/index.js";
import { ConfigNotFoundError } from "./config/parse.js";
import { loadAllHooks } from "./loader.js";
import type { LoadedHook, HookLoadError } from "./loader.js";
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

// Events that support injectContext → additionalContext
const INJECTABLE_EVENTS = new Set([
  "PreToolUse",
  "UserPromptSubmit",
  "SessionStart",
  "PostToolUse",
  "PostToolUseFailure",
  "Notification",
  "SubagentStart",
]);

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
      return {
        exitCode: 2,
        stderr: (result.reason as string) ?? "clooks: action blocked by hook",
      };
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

  // --- Other guard events: block → exit 2, allow/skip → exit 0 ---
  if (GUARD_EVENTS.has(eventName)) {
    if (resultType === "block") {
      return {
        exitCode: 2,
        stderr: (result.reason as string) ?? "clooks: action blocked by hook",
      };
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

  // --- Observe events: only skip is valid → exit 0 ---
  if (OBSERVE_EVENTS.has(eventName)) {
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

  // --- WorktreeCreate: success → stdout path, failure → exit 1 ---
  if (eventName === "WorktreeCreate") {
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

  // --- Continuation events: continue → exit 2 + stderr, stop → JSON, skip → exit 0 ---
  if (CONTINUATION_EVENTS.has(eventName)) {
    if (resultType === "continue") {
      return {
        exitCode: 2,
        stderr: result.feedback as string,
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
}> {
  const debug = process.env.CLOOKS_DEBUG === "true";
  const debugMessages: string[] = [];
  const degradedMessages: string[] = [];
  let lastResult: Record<string, unknown> | undefined;

  let failureState = await readFailures(projectRoot);
  let failuresDirty = false;

  // Process load errors through the circuit breaker
  for (const loadError of loadErrors) {
    const { maxFailures, maxFailuresMessage } = resolveMaxFailures(loadError.name, config);
    failureState = recordFailure(failureState, loadError.name, eventName, loadError.error);
    failuresDirty = true;
    const newCount = getFailureCount(failureState, loadError.name, eventName);

    if (maxFailures === 0 || newCount < maxFailures) {
      // Under threshold or circuit breaker disabled — fail-closed
      await writeFailures(projectRoot, failureState);
      throw new Error(loadError.error);
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
      failureState = recordFailure(failureState, loaded.name, eventName, errorMessage);
      failuresDirty = true;
      const newCount = getFailureCount(failureState, loaded.name, eventName);

      if (maxFailures === 0 || newCount < maxFailures) {
        // Under threshold or circuit breaker disabled — fail-closed
        await writeFailures(projectRoot, failureState);
        throw new Error(`hook "${loaded.name}" threw during ${eventName}: ${errorMessage}`);
      }

      // Threshold reached or already degraded — skip this hook
      const msg = interpolateMessage(maxFailuresMessage, {
        hook: loaded.name,
        event: eventName,
        count: newCount,
        error: errorMessage,
      });
      degradedMessages.push(msg);
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

  return { lastResult, degradedMessages, debugMessages };
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

    // --- Execute hooks with circuit breaker ---
    let { lastResult, degradedMessages, debugMessages } = await executeHooks(
      matched,
      eventName,
      normalized,
      config,
      projectRoot,
      loadErrors,
    );

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
      process.exit(0);
    }

    const translated = translateResult(eventName, lastResult);

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
