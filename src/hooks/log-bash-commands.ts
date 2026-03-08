// log-bash-commands — Logs every Bash command Claude executes to .clooks/hook.log
//
// This is a demo hook proving the Clooks pipeline works end-to-end.
// It handles PreToolUse events where tool_name is "Bash", logs the command
// to a file, and returns "allow" so the command proceeds.

import { appendFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import type { HookMeta, HookResult } from "../types/hook.js";
import type { ClaudeCodeCommonInput } from "../types/claude-code.js";

export const meta: HookMeta = {
  name: "log-bash-commands",
  description: "Logs every Bash command to .clooks/hook.log and allows it",
  events: ["PreToolUse"],
};

/**
 * Handler for PreToolUse events.
 *
 * Note on appendFileSync: adds ~1-3ms of synchronous I/O, which matters
 * against the 15ms startup budget. Production hooks should prefer async I/O
 * (e.g., Bun.write or fs.promises.appendFile). For this demo hook,
 * synchronous I/O is acceptable because it simplifies the code.
 */
export default async function handler(
  input: ClaudeCodeCommonInput & Record<string, unknown>
): Promise<HookResult | undefined> {
  // Only act on Bash tool calls
  const toolName = input.tool_name;
  if (typeof toolName !== "string" || toolName !== "Bash") {
    return undefined;
  }

  // Extract the command from tool_input
  const toolInput = input.tool_input as Record<string, unknown> | undefined;
  const command =
    toolInput && typeof toolInput.command === "string"
      ? toolInput.command
      : "<unknown command>";

  // Log to .clooks/hook.log in the working directory
  const logDir = join(process.cwd(), ".clooks");
  const logFile = join(logDir, "hook.log");

  try {
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] Bash: ${command}\n`;
    appendFileSync(logFile, logLine);
  } catch {
    // Logging failure should not block the command.
    // In a production hook, this might be worth reporting via stderr,
    // but for this demo we silently continue.
  }

  return {
    decision: "allow",
    reason: "clooks: command allowed by log-bash-commands hook",
  };
}
