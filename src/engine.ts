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
import type { HookResult } from "./types/hook.js";
import * as hookModule from "./hooks/log-bash-commands.js";

/**
 * Translates a HookResult into a ClaudeCodeOutput suitable for stdout.
 *
 * This translation is intentionally hardcoded for PreToolUse in this MVP.
 * Other events use different output formats:
 * - UserPromptSubmit, PostToolUse, Stop, SubagentStop, ConfigChange:
 *   top-level { decision: "block", reason: "..." }
 * - TeammateIdle, TaskCompleted:
 *   { continue: false, stopReason: "..." }
 * - PreToolUse:
 *   { hookSpecificOutput: { permissionDecision, permissionDecisionReason, ... } }
 *
 * When hooks for other events are added, this function will need to accept
 * the event name and select the correct output format.
 *
 * Exported for unit testing.
 */
export function translateResult(
  result: HookResult
): ClaudeCodeOutput {
  const hookOutput: PreToolUseOutput = {
    permissionDecision: result.decision,
  };
  if (result.reason) {
    hookOutput.permissionDecisionReason = result.reason;
  }
  if (result.updatedInput) {
    hookOutput.updatedInput = result.updatedInput;
  }
  if (result.additionalContext) {
    hookOutput.additionalContext = result.additionalContext;
  }

  return {
    hookSpecificOutput: hookOutput,
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

    // --- Match event against hook ---
    if (!hookModule.meta.events.includes(eventName)) {
      // No hooks match this event. Exit cleanly — Claude Code proceeds normally.
      process.exit(0);
    }

    // --- Execute the hook ---
    const result: HookResult | undefined = await hookModule.default(
      payload as Parameters<typeof hookModule.default>[0]
    );

    // --- Translate result to Claude Code output ---
    if (result === undefined || result === null) {
      // Hook had no opinion. Exit cleanly.
      process.exit(0);
    }

    if (result.decision === "deny") {
      // Block the action. Write reason to stderr, exit 2.
      const reason = result.reason ?? "clooks: action denied by hook";
      process.stderr.write(`${reason}\n`);
      process.exit(2);
    }

    if (result.decision === "allow" || result.decision === "ask") {
      const output = translateResult(result);
      const json = JSON.stringify(output);
      // Use process.stdout.write + process.exitCode for safe flushing.
      // See docs/research/process-exit-stdout-flushing.md — process.exit()
      // after process.stdout.write() can truncate at 64KB through pipes.
      // Setting process.exitCode and letting the process exit naturally
      // ensures stdout drains fully.
      process.stdout.write(json + "\n");
      process.exitCode = 0;
      return;
    }

    // Unknown decision value — fail-closed
    process.stderr.write(
      `clooks: hook returned unknown decision: ${String(result.decision)}\n`
    );
    process.exit(2);
  } catch (e: unknown) {
    const message =
      e instanceof Error ? e.message : String(e);
    process.stderr.write(`clooks: fatal error: ${message}\n`);
    process.exit(2);
  }
}
