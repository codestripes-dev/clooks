// Clooks Engine — Hook execution pipeline
//
// Reads a Claude Code hook event from stdin, runs the hard-coded
// log-bash-commands hook, and writes the response to stdout.
//
// Exit codes:
//   0 — Success. Stdout contains JSON (or nothing if no hooks matched).
//   2 — Fail-closed. Stderr contains a diagnostic message. Action is blocked.
//
// This module is imported by src/cli.ts (the compiled binary entry point).

import type { ClaudeCodeOutput, PreToolUseOutput } from "./types/claude-code.js";
import { normalizeKeys } from "./normalize.js";
import { hook } from "./hooks/log-bash-commands.js";

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
        const output: ClaudeCodeOutput = {
          additionalContext: result.injectContext as string,
        };
        return { output: JSON.stringify(output), exitCode: 0 };
      }
      return { exitCode: 0 };
    }
  }

  // --- Observe events: only skip is valid → exit 0 ---
  if (OBSERVE_EVENTS.has(eventName)) {
    if (result.injectContext && INJECTABLE_EVENTS.has(eventName)) {
      const output: ClaudeCodeOutput = {
        additionalContext: result.injectContext as string,
      };
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
 * Main engine entry point. Reads stdin, matches events, runs hooks, writes output.
 * Called by src/cli.ts when no CLI flags are present.
 */
export async function runEngine(): Promise<void> {
  try {
    // --- Read and parse stdin ---
    let input: unknown;
    try {
      input = await Bun.stdin.json();
    } catch (e) {
      const message =
        e instanceof Error ? e.message : String(e);
      process.stderr.write(
        `clooks: failed to parse stdin JSON: ${message}\n`
      );
      process.exit(2);
    }

    // --- Validate payload shape ---
    if (
      input === null ||
      typeof input !== "object" ||
      Array.isArray(input)
    ) {
      process.stderr.write(
        "clooks: stdin payload is not a JSON object\n"
      );
      process.exit(2);
    }

    const payload = input as Record<string, unknown>;
    const eventName = payload.hook_event_name;

    if (typeof eventName !== "string" || eventName.length === 0) {
      process.stderr.write(
        "clooks: stdin payload missing or empty hook_event_name field\n"
      );
      process.exit(2);
    }

    // --- Discover handler on hook object ---
    const handler = hook[eventName as keyof typeof hook];
    if (typeof handler !== "function") {
      // No handler for this event. Exit cleanly — Claude Code proceeds normally.
      process.exit(0);
    }

    // --- Normalize payload: snake_case → camelCase ---
    const normalized = normalizeKeys(payload);
    // Domain-specific rename: hookEventName → event
    normalized.event = normalized.hookEventName;
    delete normalized.hookEventName;

    // --- Execute the hook ---
    const config = hook.meta.config ?? ({} as Record<string, unknown>);
    const result = await (handler as Function)(normalized, config);

    // --- Translate result to Claude Code output ---
    if (result === undefined || result === null) {
      process.exit(0);
    }

    const translated = translateResult(
      eventName,
      result as Record<string, unknown>
    );

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
    const message =
      e instanceof Error ? e.message : String(e);
    process.stderr.write(`clooks: fatal error: ${message}\n`);
    process.exit(2);
  }
}
