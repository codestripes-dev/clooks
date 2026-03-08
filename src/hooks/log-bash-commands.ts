// log-bash-commands — Logs every Bash command Claude executes to .clooks/hook.log
//
// This is a demo hook proving the Clooks pipeline works end-to-end.
// It handles PreToolUse events where toolName is "Bash", logs the command
// to a file, and returns "allow" so the command proceeds.

import { appendFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import type { ClooksHook } from "../types/hook.js";

type Config = {
  logDir: string;
};

export const hook: ClooksHook<Config> = {
  meta: {
    name: "log-bash-commands",
    description: "Logs every Bash command to .clooks/hook.log and allows it",
    config: {
      logDir: ".clooks",
    },
  },

  /**
   * Handler for PreToolUse events.
   *
   * Note on appendFileSync: adds ~1-3ms of synchronous I/O, which matters
   * against the 15ms startup budget. Production hooks should prefer async I/O
   * (e.g., Bun.write or fs.promises.appendFile). For this demo hook,
   * synchronous I/O is acceptable because it simplifies the code.
   */
  PreToolUse(ctx, config) {
    if (ctx.toolName !== "Bash") {
      return { result: "skip" };
    }

    const command =
      typeof ctx.toolInput.command === "string"
        ? ctx.toolInput.command
        : "<unknown command>";

    const logDir = join(process.cwd(), config.logDir);
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
    }

    return { result: "allow" };
  },
};
