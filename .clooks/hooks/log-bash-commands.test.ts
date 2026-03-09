import { describe, expect, it } from "bun:test";
import { hook } from "./log-bash-commands.js";
import type { PreToolUseContext } from "../../src/types/contexts.js";

function makeCtx(
  overrides: Partial<PreToolUseContext> = {}
): PreToolUseContext {
  return {
    event: "PreToolUse",
    sessionId: "test-session",
    cwd: "/tmp",
    permissionMode: "default",
    transcriptPath: "/tmp/transcript.jsonl",
    toolName: "Bash",
    toolInput: { command: "echo hello" },
    toolUseId: "tu-test-1",
    ...overrides,
  };
}

const config = hook.meta.config!;

describe("log-bash-commands hook", () => {
  it("exports meta with correct name", () => {
    expect(hook.meta.name).toBe("log-bash-commands");
  });

  it("has a PreToolUse handler", () => {
    expect(hook.PreToolUse).toBeDefined();
  });

  it("returns allow for Bash tool calls", async () => {
    const result = await hook.PreToolUse!(makeCtx(), config);
    expect(result.result).toBe("allow");
  });

  it("returns skip for non-Bash tool calls", async () => {
    const result = await hook.PreToolUse!(
      makeCtx({ toolName: "Write", toolInput: { filePath: "/tmp/f.txt" } }),
      config
    );
    expect(result.result).toBe("skip");
  });
});
