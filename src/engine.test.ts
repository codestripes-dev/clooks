import { describe, expect, it } from "bun:test";
import { translateResult } from "./engine.js";

describe("translateResult", () => {
  // --- PreToolUse ---

  it("PreToolUse allow → hookSpecificOutput with permissionDecision", () => {
    const out = translateResult("PreToolUse", { result: "allow" });
    expect(out.exitCode).toBe(0);
    expect(JSON.parse(out.output!)).toEqual({
      hookSpecificOutput: { permissionDecision: "allow" },
    });
    expect(out.stderr).toBeUndefined();
  });

  it("PreToolUse block → exit 2 + stderr", () => {
    const out = translateResult("PreToolUse", {
      result: "block",
      reason: "dangerous command",
    });
    expect(out.exitCode).toBe(2);
    expect(out.stderr).toBe("dangerous command");
    expect(out.output).toBeUndefined();
  });

  it("PreToolUse skip → exit 0, no output", () => {
    const out = translateResult("PreToolUse", { result: "skip" });
    expect(out.exitCode).toBe(0);
    expect(out.output).toBeUndefined();
    expect(out.stderr).toBeUndefined();
  });

  it("PreToolUse allow with injectContext → additionalContext in output", () => {
    const out = translateResult("PreToolUse", {
      result: "allow",
      injectContext: "extra info for the agent",
    });
    expect(out.exitCode).toBe(0);
    expect(JSON.parse(out.output!)).toEqual({
      hookSpecificOutput: {
        permissionDecision: "allow",
        additionalContext: "extra info for the agent",
      },
    });
  });

  // --- Other guard events ---

  it("UserPromptSubmit block → exit 2 + stderr", () => {
    const out = translateResult("UserPromptSubmit", {
      result: "block",
      reason: "prompt blocked",
    });
    expect(out.exitCode).toBe(2);
    expect(out.stderr).toBe("prompt blocked");
  });

  it("UserPromptSubmit allow → exit 0", () => {
    const out = translateResult("UserPromptSubmit", { result: "allow" });
    expect(out.exitCode).toBe(0);
    expect(out.output).toBeUndefined();
  });

  it("UserPromptSubmit allow with injectContext → additionalContext", () => {
    const out = translateResult("UserPromptSubmit", {
      result: "allow",
      injectContext: "context for agent",
    });
    expect(out.exitCode).toBe(0);
    expect(JSON.parse(out.output!)).toEqual({
      additionalContext: "context for agent",
    });
  });

  it("Stop skip → exit 0", () => {
    const out = translateResult("Stop", { result: "skip" });
    expect(out.exitCode).toBe(0);
  });

  // --- Observe events ---

  it("PostToolUse skip → exit 0, no output", () => {
    const out = translateResult("PostToolUse", { result: "skip" });
    expect(out.exitCode).toBe(0);
    expect(out.output).toBeUndefined();
  });

  it("SessionStart skip with injectContext → additionalContext", () => {
    const out = translateResult("SessionStart", {
      result: "skip",
      injectContext: "welcome message",
    });
    expect(out.exitCode).toBe(0);
    expect(JSON.parse(out.output!)).toEqual({
      additionalContext: "welcome message",
    });
  });

  // --- WorktreeCreate ---

  it("WorktreeCreate success → stdout path, exit 0", () => {
    const out = translateResult("WorktreeCreate", {
      result: "success",
      path: "/tmp/worktree-123",
    });
    expect(out.exitCode).toBe(0);
    expect(out.output).toBe("/tmp/worktree-123");
  });

  it("WorktreeCreate failure → exit 1 + stderr", () => {
    const out = translateResult("WorktreeCreate", {
      result: "failure",
      reason: "disk full",
    });
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toBe("disk full");
  });

  // --- Continuation events ---

  it("TeammateIdle continue → exit 2 + stderr feedback", () => {
    const out = translateResult("TeammateIdle", {
      result: "continue",
      feedback: "keep working on task X",
    });
    expect(out.exitCode).toBe(2);
    expect(out.stderr).toBe("keep working on task X");
  });

  it("TaskCompleted stop → JSON with continue:false + stopReason", () => {
    const out = translateResult("TaskCompleted", {
      result: "stop",
      reason: "all tasks done",
    });
    expect(out.exitCode).toBe(0);
    expect(JSON.parse(out.output!)).toEqual({
      continue: false,
      stopReason: "all tasks done",
    });
  });

  it("TeammateIdle skip → exit 0, no output", () => {
    const out = translateResult("TeammateIdle", { result: "skip" });
    expect(out.exitCode).toBe(0);
    expect(out.output).toBeUndefined();
  });

  // --- Unknown result ---

  it("unknown result type → exit 2 + stderr", () => {
    const out = translateResult("PreToolUse", { result: "bogus" });
    expect(out.exitCode).toBe(2);
    expect(out.stderr).toContain("unknown result type");
  });
});
