import { describe, expect, it } from "bun:test";
import * as hookModule from "./log-bash-commands.js";

describe("log-bash-commands hook", () => {
  it("exports meta with correct name and events", () => {
    expect(hookModule.meta.name).toBe("log-bash-commands");
    expect(hookModule.meta.events).toEqual(["PreToolUse"]);
  });

  it("returns allow for Bash tool calls", async () => {
    const input = {
      hook_event_name: "PreToolUse" as const,
      tool_name: "Bash",
      tool_input: { command: "echo hello" },
      tool_use_id: "tu-test-1",
      session_id: "test-session",
      cwd: "/tmp",
      permission_mode: "default",
      transcript_path: "/tmp/transcript.jsonl",
    };

    const result = await hookModule.default(input);

    expect(result).toBeDefined();
    expect(result!.decision).toBe("allow");
    expect(result!.reason).toContain("log-bash-commands");
  });

  it("returns undefined for non-Bash tool calls", async () => {
    const input = {
      hook_event_name: "PreToolUse" as const,
      tool_name: "Write",
      tool_input: { file_path: "/tmp/f.txt", content: "hello" },
      tool_use_id: "tu-test-2",
      session_id: "test-session",
      cwd: "/tmp",
      permission_mode: "default",
      transcript_path: "/tmp/transcript.jsonl",
    };

    const result = await hookModule.default(input);

    expect(result).toBeUndefined();
  });
});
