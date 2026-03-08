import { describe, expect, it } from "bun:test";
import { translateResult } from "./engine.js";

describe("translateResult", () => {
  it("translates allow result to PreToolUse output", () => {
    const output = translateResult({
      decision: "allow",
      reason: "test reason",
    });

    expect(output).toEqual({
      hookSpecificOutput: {
        permissionDecision: "allow",
        permissionDecisionReason: "test reason",
      },
    });
  });

  it("translates deny result to PreToolUse output", () => {
    const output = translateResult({
      decision: "deny",
      reason: "blocked for testing",
    });

    expect(output).toEqual({
      hookSpecificOutput: {
        permissionDecision: "deny",
        permissionDecisionReason: "blocked for testing",
      },
    });
  });

  it("translates ask result to PreToolUse output", () => {
    const output = translateResult({
      decision: "ask",
      reason: "needs confirmation",
    });

    expect(output).toEqual({
      hookSpecificOutput: {
        permissionDecision: "ask",
        permissionDecisionReason: "needs confirmation",
      },
    });
  });

  it("includes updatedInput when present", () => {
    const output = translateResult({
      decision: "allow",
      updatedInput: { command: "safe-command" },
    });

    expect(output.hookSpecificOutput?.updatedInput).toEqual({
      command: "safe-command",
    });
  });

  it("includes additionalContext when present", () => {
    const output = translateResult({
      decision: "allow",
      additionalContext: "extra info",
    });

    expect(output.hookSpecificOutput?.additionalContext).toBe("extra info");
  });

  it("omits optional fields when not provided", () => {
    const output = translateResult({
      decision: "allow",
    });

    expect(output).toEqual({
      hookSpecificOutput: {
        permissionDecision: "allow",
      },
    });
    expect(output.hookSpecificOutput?.permissionDecisionReason).toBeUndefined();
    expect(output.hookSpecificOutput?.updatedInput).toBeUndefined();
    expect(output.hookSpecificOutput?.additionalContext).toBeUndefined();
  });
});
