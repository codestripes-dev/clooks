import { describe, expect, it, afterEach, spyOn } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { translateResult, matchHooksForEvent, executeHooks, interpolateMessage, resolveOnError } from "./engine.js";
import type { LoadedHook, HookLoadError } from "./loader.js";
import type { ClooksHook } from "./types/hook.js";
import type { ClooksConfig } from "./config/types.js";
import type { HookName } from "./types/branded.js";
import { DEFAULT_MAX_FAILURES_MESSAGE } from "./config/constants.js";
import { readFailures } from "./failures.js";

const hn = (s: string) => s as HookName;

describe("translateResult", () => {
  // --- PreToolUse ---

  it("PreToolUse allow → hookSpecificOutput with hookEventName and permissionDecision", () => {
    const out = translateResult("PreToolUse", { result: "allow" });
    expect(out.exitCode).toBe(0);
    expect(JSON.parse(out.output!)).toEqual({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" },
    });
    expect(out.stderr).toBeUndefined();
  });

  it("PreToolUse block → exit 0 + JSON with permissionDecision deny", () => {
    const out = translateResult("PreToolUse", {
      result: "block",
      reason: "dangerous command",
    });
    expect(out.exitCode).toBe(0);
    const parsed = JSON.parse(out.output!);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toBe("dangerous command");
    expect(out.stderr).toBeUndefined();
  });

  it("PreToolUse skip → exit 0, no output", () => {
    const out = translateResult("PreToolUse", { result: "skip" });
    expect(out.exitCode).toBe(0);
    expect(out.output).toBeUndefined();
    expect(out.stderr).toBeUndefined();
  });

  it("PreToolUse allow with injectContext → additionalContext in hookSpecificOutput", () => {
    const out = translateResult("PreToolUse", {
      result: "allow",
      injectContext: "extra info for the agent",
    });
    expect(out.exitCode).toBe(0);
    expect(JSON.parse(out.output!)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        additionalContext: "extra info for the agent",
      },
    });
  });

  // --- Other guard events ---

  it("UserPromptSubmit block → exit 0 + JSON with decision block", () => {
    const out = translateResult("UserPromptSubmit", {
      result: "block",
      reason: "prompt blocked",
    });
    expect(out.exitCode).toBe(0);
    const parsed = JSON.parse(out.output!);
    expect(parsed.decision).toBe("block");
    expect(parsed.reason).toBe("prompt blocked");
    expect(out.stderr).toBeUndefined();
  });

  it("UserPromptSubmit allow → exit 0", () => {
    const out = translateResult("UserPromptSubmit", { result: "allow" });
    expect(out.exitCode).toBe(0);
    expect(out.output).toBeUndefined();
  });

  it("UserPromptSubmit allow with injectContext → hookSpecificOutput with additionalContext", () => {
    const out = translateResult("UserPromptSubmit", {
      result: "allow",
      injectContext: "context for agent",
    });
    expect(out.exitCode).toBe(0);
    expect(JSON.parse(out.output!)).toEqual({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: "context for agent",
      },
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

  it("SessionStart skip with injectContext → hookSpecificOutput with additionalContext", () => {
    const out = translateResult("SessionStart", {
      result: "skip",
      injectContext: "welcome message",
    });
    expect(out.exitCode).toBe(0);
    expect(JSON.parse(out.output!)).toEqual({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: "welcome message",
      },
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

  // --- FEAT-0017: new translateResult tests ---

  it("PermissionRequest block → exit 0 + JSON with hookSpecificOutput.decision.behavior deny", () => {
    const out = translateResult("PermissionRequest", { result: "block", reason: "denied" });
    expect(out.exitCode).toBe(0);
    const parsed = JSON.parse(out.output!);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("PermissionRequest");
    expect(parsed.hookSpecificOutput.decision.behavior).toBe("deny");
  });

  it("Stop block → exit 0 + JSON with decision block", () => {
    const out = translateResult("Stop", { result: "block", reason: "stop blocked" });
    expect(out.exitCode).toBe(0);
    const parsed = JSON.parse(out.output!);
    expect(parsed.decision).toBe("block");
    expect(parsed.reason).toBe("stop blocked");
  });

  it("PostToolUse block → exit 0 + JSON with additionalContext (injectable observe)", () => {
    const out = translateResult("PostToolUse", { result: "block", reason: "hook error" });
    expect(out.exitCode).toBe(0);
    const parsed = JSON.parse(out.output!);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("PostToolUse");
    expect(parsed.hookSpecificOutput.additionalContext).toBe("hook error");
  });

  it("SessionEnd block → exit 0 + JSON with systemMessage (non-injectable observe)", () => {
    const out = translateResult("SessionEnd", { result: "block", reason: "session error" });
    expect(out.exitCode).toBe(0);
    const parsed = JSON.parse(out.output!);
    expect(parsed.systemMessage).toBe("session error");
  });

  it("TeammateIdle block → exit 0 + JSON with continue false (fail-closed stop)", () => {
    const out = translateResult("TeammateIdle", { result: "block", reason: "hook crash" });
    expect(out.exitCode).toBe(0);
    const parsed = JSON.parse(out.output!);
    expect(parsed.continue).toBe(false);
    expect(parsed.stopReason).toBe("hook crash");
  });

  it("WorktreeCreate block → exit 1 + stderr", () => {
    const out = translateResult("WorktreeCreate", { result: "block", reason: "worktree hook error" });
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toBe("worktree hook error");
  });

  // --- Unknown result ---

  it("unknown result type → exit 2 + stderr", () => {
    const out = translateResult("PreToolUse", { result: "bogus" } as unknown as import("./engine.js").EngineResult);
    expect(out.exitCode).toBe(2);
    expect(out.stderr).toContain("unknown result type");
  });
});

// --- matchHooksForEvent ---

function makeLoadedHook(
  name: string,
  handlers: Record<string, Function>,
): LoadedHook {
  const hookName = hn(name);
  const hook = {
    meta: { name: hookName },
    ...handlers,
  } as unknown as ClooksHook;
  return { name: hookName, hook, config: {} };
}

describe("matchHooksForEvent", () => {
  it("returns hooks that have a handler for the event", () => {
    const hookA = makeLoadedHook("a", {
      PreToolUse: () => ({ result: "skip" }),
    });
    const hookB = makeLoadedHook("b", {
      PreToolUse: () => ({ result: "allow" }),
    });
    const hookC = makeLoadedHook("c", {
      PostToolUse: () => ({ result: "skip" }),
    });
    const matched = matchHooksForEvent([hookA, hookB, hookC], "PreToolUse");
    expect(matched).toHaveLength(2);
    expect(matched.map((h) => h.name)).toEqual([hn("a"), hn("b")]);
  });

  it("returns empty array when no hooks match", () => {
    const hookA = makeLoadedHook("a", {
      PostToolUse: () => ({ result: "skip" }),
    });
    const matched = matchHooksForEvent([hookA], "PreToolUse");
    expect(matched).toEqual([]);
  });

  it("returns empty array for empty hooks list", () => {
    const matched = matchHooksForEvent([], "PreToolUse");
    expect(matched).toEqual([]);
  });
});

// --- interpolateMessage ---

describe("interpolateMessage", () => {
  it("substitutes all four variables correctly", () => {
    const result = interpolateMessage(
      "Hook '{hook}' failed {count} times on {event}. Error: {error}",
      { hook: hn("my-hook"), event: "PreToolUse", count: 3, error: "boom" },
    );
    expect(result).toBe(
      "Hook 'my-hook' failed 3 times on PreToolUse. Error: boom",
    );
  });

  it("handles $ characters in error messages", () => {
    const result = interpolateMessage("Error: {error}", {
      hook: hn("h"),
      event: "e",
      count: 1,
      error: "found $1 in path",
    });
    expect(result).toBe("Error: found $1 in path");
  });
});

// --- executeHooks (circuit breaker) ---

let tempDir: string;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), "clooks-engine-test-"));
  mkdirSync(join(tempDir, ".clooks"), { recursive: true });
  return tempDir;
}

function makeTestConfig(
  hookOverrides: Record<string, {
    maxFailures?: number;
    maxFailuresMessage?: string;
    onError?: import("./config/types.js").ErrorMode;
    events?: Record<string, { onError?: import("./config/types.js").ErrorMode }>;
  }> = {},
  globalMaxFailures = 3,
  globalOnError: import("./config/types.js").ErrorMode = "block",
): ClooksConfig {
  const hooks = {} as Record<HookName, import("./config/types.js").HookEntry>;
  for (const [name, overrides] of Object.entries(hookOverrides)) {
    hooks[hn(name)] = {
      resolvedPath: `.clooks/hooks/${name}.ts`,
      config: {},
      parallel: false,
      ...overrides,
    };
  }
  return {
    version: "1.0.0",
    global: {
      timeout: 30000,
      onError: globalOnError,
      maxFailures: globalMaxFailures,
      maxFailuresMessage: DEFAULT_MAX_FAILURES_MESSAGE,
    },
    hooks,
    events: {},
  };
}

describe("executeHooks", () => {
  it("hook fails under threshold → fail-closed (block result)", async () => {
    const dir = makeTempDir();
    const hook = makeLoadedHook("fail-hook", {
      PreToolUse: () => { throw new Error("boom"); },
    });
    const config = makeTestConfig({ "fail-hook": {} });

    const result = await executeHooks([hook], "PreToolUse", {}, config, dir);
    expect(result.lastResult?.result).toBe("block");
    expect(result.lastResult?.reason).toContain("fail-hook");
    expect(result.lastResult?.reason).toContain("boom");
    expect(result.traceMessages).toEqual([]);
    expect(result.systemMessages).toEqual([]);

    // Failure state should be written
    const state = await readFailures(dir);
    expect(state[hn("fail-hook")]?.["PreToolUse"]?.consecutiveFailures).toBe(1);
  });

  it("hook reaches threshold → skipped (degraded, no block result)", async () => {
    const dir = makeTempDir();
    const hook = makeLoadedHook("fail-hook", {
      PreToolUse: () => { throw new Error("boom"); },
    });
    const config = makeTestConfig({ "fail-hook": {} }, 3);

    // Fail twice (under threshold — produces block results)
    for (let i = 0; i < 2; i++) {
      const r = await executeHooks([hook], "PreToolUse", {}, config, dir);
      expect(r.lastResult?.result).toBe("block");
    }

    // Third failure should NOT block — hook is degraded
    const result = await executeHooks([hook], "PreToolUse", {}, config, dir);
    expect(result.lastResult).toBeUndefined();
    expect(result.degradedMessages).toHaveLength(1);
    expect(result.degradedMessages[0]).toContain("fail-hook");
  });

  it("hook already degraded → skipped and reminder message collected", async () => {
    const dir = makeTempDir();
    const hook = makeLoadedHook("fail-hook", {
      PreToolUse: () => { throw new Error("still broken"); },
    });
    const config = makeTestConfig({ "fail-hook": {} }, 3);

    // Fail 3 times to enter degraded state (first 2 produce block, 3rd degrades)
    for (let i = 0; i < 2; i++) {
      await executeHooks([hook], "PreToolUse", {}, config, dir);
    }
    await executeHooks([hook], "PreToolUse", {}, config, dir);

    // Fourth invocation — still degraded
    const result = await executeHooks([hook], "PreToolUse", {}, config, dir);
    expect(result.degradedMessages).toHaveLength(1);
    expect(result.degradedMessages[0]).toContain("still broken");
  });

  it("hook recovers after being degraded → failure state cleared, result used", async () => {
    const dir = makeTempDir();
    let shouldThrow = true;
    const hook = makeLoadedHook("recover-hook", {
      PreToolUse: () => {
        if (shouldThrow) throw new Error("broken");
        return { result: "allow" };
      },
    });
    const config = makeTestConfig({ "recover-hook": {} }, 3);

    // Fail 3 times (first 2 produce block, 3rd degrades)
    for (let i = 0; i < 2; i++) {
      await executeHooks([hook], "PreToolUse", {}, config, dir);
    }
    await executeHooks([hook], "PreToolUse", {}, config, dir);

    // Fix the hook
    shouldThrow = false;
    const result = await executeHooks([hook], "PreToolUse", {}, config, dir);
    expect(result.lastResult).toEqual({ result: "allow" });
    expect(result.degradedMessages).toHaveLength(0);

    // Failure state should be cleared
    const state = await readFailures(dir);
    expect(state[hn("recover-hook")]).toBeUndefined();
  });

  it("maxFailures: 0 → always fail-closed (block result), never degrades", async () => {
    const dir = makeTempDir();
    const hook = makeLoadedHook("strict-hook", {
      PreToolUse: () => { throw new Error("boom"); },
    });
    const config = makeTestConfig({ "strict-hook": { maxFailures: 0 } });

    // Should always produce block result, even after many failures
    for (let i = 0; i < 5; i++) {
      const result = await executeHooks([hook], "PreToolUse", {}, config, dir);
      expect(result.lastResult?.result).toBe("block");
      expect(result.lastResult?.reason).toContain("boom");
    }
  });

  it("degraded message uses injectContext for injectable events (PreToolUse)", async () => {
    const dir = makeTempDir();
    // A hook that succeeds + a hook that fails
    const goodHook = makeLoadedHook("good-hook", {
      PreToolUse: () => ({ result: "allow" }),
    });
    const badHook = makeLoadedHook("bad-hook", {
      PreToolUse: () => { throw new Error("boom"); },
    });
    const config = makeTestConfig({ "good-hook": {}, "bad-hook": {} }, 3);

    // Fail the bad hook 3 times (first 2 produce block after good-hook runs, 3rd degrades)
    for (let i = 0; i < 2; i++) {
      await executeHooks([goodHook, badHook], "PreToolUse", {}, config, dir);
    }

    const result = await executeHooks([goodHook, badHook], "PreToolUse", {}, config, dir);
    // Good hook's result should be used
    expect(result.lastResult).toEqual({ result: "allow" });
    // Degraded message should be present
    expect(result.degradedMessages).toHaveLength(1);
    expect(result.degradedMessages[0]).toContain("bad-hook");
  });

  it("multiple degraded hooks → messages collected separately", async () => {
    const dir = makeTempDir();
    const badHook1 = makeLoadedHook("bad-1", {
      PreToolUse: () => { throw new Error("err1"); },
    });
    const badHook2 = makeLoadedHook("bad-2", {
      PreToolUse: () => { throw new Error("err2"); },
    });
    const config = makeTestConfig({ "bad-1": {}, "bad-2": {} }, 1);

    // With maxFailures=1, the first failure triggers degradation
    const result = await executeHooks([badHook1, badHook2], "PreToolUse", {}, config, dir);
    expect(result.degradedMessages).toHaveLength(2);
    expect(result.degradedMessages[0]).toContain("bad-1");
    expect(result.degradedMessages[1]).toContain("bad-2");
  });

  it("resolveMaxFailures cascade: hook-level overrides global", async () => {
    const dir = makeTempDir();
    const hook = makeLoadedHook("custom-hook", {
      PreToolUse: () => { throw new Error("boom"); },
    });
    // Global maxFailures=3, but hook override maxFailures=1
    const config = makeTestConfig({ "custom-hook": { maxFailures: 1 } }, 3);

    // First failure should trigger degradation (maxFailures=1)
    const result = await executeHooks([hook], "PreToolUse", {}, config, dir);
    expect(result.degradedMessages).toHaveLength(1);
  });

  it("degraded message written to stderr for non-injectable events", async () => {
    const dir = makeTempDir();
    const hook = makeLoadedHook("fail-hook", {
      // SessionEnd is not injectable
      SessionEnd: () => { throw new Error("boom"); },
    });
    const config = makeTestConfig({ "fail-hook": {} }, 1);

    // executeHooks just collects messages — stderr handling is in runEngine
    const result = await executeHooks([hook], "SessionEnd", {}, config, dir);
    expect(result.degradedMessages).toHaveLength(1);
  });

  // --- Load error circuit breaker ---

  it("load error under threshold → fail-closed (block result)", async () => {
    const dir = makeTempDir();
    const loadErrors: HookLoadError[] = [
      { name: hn("broken-hook"), error: "Cannot find module '/path/to/broken-hook.ts'" },
    ];
    const config = makeTestConfig({ "broken-hook": {} }, 3);

    const result = await executeHooks([], "PreToolUse", {}, config, dir, loadErrors);
    expect(result.lastResult?.result).toBe("block");
    expect(result.lastResult?.reason).toContain("broken-hook");

    const state = await readFailures(dir);
    expect(state[hn("broken-hook")]?.["PreToolUse"]?.consecutiveFailures).toBe(1);
  });

  it("load error reaches threshold → skipped with degraded message", async () => {
    const dir = makeTempDir();
    const loadErrors: HookLoadError[] = [
      { name: hn("broken-hook"), error: "Cannot find module '/path/to/broken-hook.ts'" },
    ];
    const config = makeTestConfig({ "broken-hook": {} }, 3);

    // Fail twice (under threshold — produces block results)
    for (let i = 0; i < 2; i++) {
      const r = await executeHooks([], "PreToolUse", {}, config, dir, loadErrors);
      expect(r.lastResult?.result).toBe("block");
    }

    // Third failure — should skip (degraded), not block
    const result = await executeHooks([], "PreToolUse", {}, config, dir, loadErrors);
    expect(result.degradedMessages).toHaveLength(1);
    expect(result.degradedMessages[0]).toContain("broken-hook");
  });

  it("load error does not block successfully loaded hooks", async () => {
    const dir = makeTempDir();
    const goodHook = makeLoadedHook("good-hook", {
      PreToolUse: () => ({ result: "allow" }),
    });
    const loadErrors: HookLoadError[] = [
      { name: hn("broken-hook"), error: "Cannot find module" },
    ];
    // maxFailures=1 so load error degrades immediately
    const config = makeTestConfig({ "good-hook": {}, "broken-hook": {} }, 1);

    const result = await executeHooks([goodHook], "PreToolUse", {}, config, dir, loadErrors);
    expect(result.lastResult).toEqual({ result: "allow" });
    expect(result.degradedMessages).toHaveLength(1);
    expect(result.degradedMessages[0]).toContain("broken-hook");
  });

  // --- FEAT-0017: onError cascade tests ---

  it("onError 'continue' — no block, systemMessage collected", async () => {
    const dir = makeTempDir();
    const hook = makeLoadedHook("notify-hook", {
      PreToolUse: () => { throw new Error("notify failed"); },
    });
    const config = makeTestConfig({ "notify-hook": { onError: "continue" } });

    const result = await executeHooks([hook], "PreToolUse", {}, config, dir);
    expect(result.lastResult).toBeUndefined();
    expect(result.systemMessages).toHaveLength(1);
    expect(result.systemMessages[0]).toContain("notify-hook");
    expect(result.systemMessages[0]).toContain("Continuing");
    expect(result.traceMessages).toEqual([]);
  });

  it("onError 'trace' — no block, trace message collected", async () => {
    const dir = makeTempDir();
    const hook = makeLoadedHook("trace-hook", {
      PreToolUse: () => { throw new Error("trace failed"); },
    });
    const config = makeTestConfig({ "trace-hook": { onError: "trace" } });

    const result = await executeHooks([hook], "PreToolUse", {}, config, dir);
    expect(result.lastResult).toBeUndefined();
    expect(result.traceMessages).toHaveLength(1);
    expect(result.traceMessages[0]).toContain("trace-hook");
    expect(result.traceMessages[0]).toContain("onError: trace");
    expect(result.systemMessages).toEqual([]);
  });

  it("onError 'block' — produces block result, stops pipeline", async () => {
    const dir = makeTempDir();
    const hook1 = makeLoadedHook("block-hook", {
      PreToolUse: () => { throw new Error("blocked"); },
    });
    const hook2 = makeLoadedHook("after-hook", {
      PreToolUse: () => ({ result: "allow" }),
    });
    const config = makeTestConfig({ "block-hook": {}, "after-hook": {} });

    const result = await executeHooks([hook1, hook2], "PreToolUse", {}, config, dir);
    expect(result.lastResult?.result).toBe("block");
    expect(result.lastResult?.reason).toContain("blocked");
  });

  it("onError 'continue' skips recordFailure", async () => {
    const dir = makeTempDir();
    const hook = makeLoadedHook("continue-hook", {
      PreToolUse: () => { throw new Error("err"); },
    });
    const config = makeTestConfig({ "continue-hook": { onError: "continue" } });

    await executeHooks([hook], "PreToolUse", {}, config, dir);
    const state = await readFailures(dir);
    expect(state[hn("continue-hook")]).toBeUndefined();
  });

  it("onError 'trace' skips recordFailure", async () => {
    const dir = makeTempDir();
    const hook = makeLoadedHook("trace-hook", {
      PreToolUse: () => { throw new Error("err"); },
    });
    const config = makeTestConfig({ "trace-hook": { onError: "trace" } });

    await executeHooks([hook], "PreToolUse", {}, config, dir);
    const state = await readFailures(dir);
    expect(state[hn("trace-hook")]).toBeUndefined();
  });

  it("import failure always blocks regardless of hook onError", async () => {
    const dir = makeTempDir();
    const loadErrors: HookLoadError[] = [
      { name: hn("broken-hook"), error: "Cannot find module" },
    ];
    const config = makeTestConfig({ "broken-hook": { onError: "continue" } });

    const result = await executeHooks([], "PreToolUse", {}, config, dir, loadErrors);
    expect(result.lastResult?.result).toBe("block");
  });

  it("trace falls back to continue for non-injectable events", async () => {
    const dir = makeTempDir();
    const hook = makeLoadedHook("trace-hook", {
      SessionEnd: () => { throw new Error("err"); },
    });
    const config = makeTestConfig({ "trace-hook": { onError: "trace" } });

    const result = await executeHooks([hook], "SessionEnd", {}, config, dir);
    expect(result.traceMessages).toEqual([]);
    expect(result.systemMessages.length).toBeGreaterThanOrEqual(1);
    expect(result.systemMessages[0]).toContain("Falling back");
  });
});

// --- resolveOnError ---

describe("resolveOnError", () => {
  it("hook+event overrides hook-level", () => {
    const config = makeTestConfig({
      scanner: {
        onError: "block",
        events: { PreToolUse: { onError: "trace" } },
      },
    });
    expect(resolveOnError(hn("scanner"), "PreToolUse", config)).toBe("trace");
  });

  it("hook-level overrides global", () => {
    const config = makeTestConfig({ scanner: { onError: "continue" } });
    expect(resolveOnError(hn("scanner"), "PreToolUse", config)).toBe("continue");
  });

  it("defaults to global when no hook overrides", () => {
    const config = makeTestConfig({}, 3, "continue");
    expect(resolveOnError(hn("unknown"), "PreToolUse", config)).toBe("continue");
  });

  it("full cascade: hook+event → hook → global", () => {
    const config = makeTestConfig({
      scanner: {
        onError: "continue",
        events: { PreToolUse: { onError: "trace" } },
      },
    }, 3, "block");
    expect(resolveOnError(hn("scanner"), "PreToolUse", config)).toBe("trace");
    expect(resolveOnError(hn("scanner"), "PostToolUse", config)).toBe("continue");
    expect(resolveOnError(hn("unknown"), "PreToolUse", config)).toBe("block");
  });
});

// --- FEAT-0017 M4: Trace and systemMessage output integration ---

describe("trace and systemMessage integration", () => {
  it("trace messages injected into injectContext on injectable event", async () => {
    const dir = makeTempDir();
    const hook = makeLoadedHook("trace-hook", {
      PreToolUse: () => { throw new Error("trace err"); },
    });
    const config = makeTestConfig({ "trace-hook": { onError: "trace" } });

    const result = await executeHooks([hook], "PreToolUse", {}, config, dir);
    expect(result.traceMessages).toHaveLength(1);

    // Simulate runEngine trace injection
    let lastResult = result.lastResult;
    if (result.traceMessages.length > 0) {
      const traceBlock = result.traceMessages.join("\n");
      if (lastResult === undefined) {
        lastResult = { result: "allow", injectContext: traceBlock };
      }
    }
    expect(lastResult?.injectContext).toContain("trace-hook");
    expect(lastResult?.injectContext).toContain("onError: trace");
  });

  it("multiple trace messages concatenated with newlines", async () => {
    const dir = makeTempDir();
    const hook1 = makeLoadedHook("trace-1", {
      PreToolUse: () => { throw new Error("err1"); },
    });
    const hook2 = makeLoadedHook("trace-2", {
      PreToolUse: () => { throw new Error("err2"); },
    });
    const config = makeTestConfig({ "trace-1": { onError: "trace" }, "trace-2": { onError: "trace" } });

    const result = await executeHooks([hook1, hook2], "PreToolUse", {}, config, dir);
    expect(result.traceMessages).toHaveLength(2);

    // Simulate runEngine trace injection
    const traceBlock = result.traceMessages.join("\n");
    expect(traceBlock).toContain("trace-1");
    expect(traceBlock).toContain("trace-2");
  });

  it("systemMessage injected into translated output JSON", () => {
    // Simulate the systemMessage injection logic in runEngine
    const translated: { output?: string; exitCode: number; stderr?: string } = {
      output: JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" } }),
      exitCode: 0,
    };
    const systemMessages = ["Hook error: continue mode"];

    if (systemMessages.length > 0) {
      const systemMessage = systemMessages.join("\n");
      if (translated.output) {
        const parsed = JSON.parse(translated.output);
        parsed.systemMessage = systemMessage;
        translated.output = JSON.stringify(parsed);
      }
    }

    const final = JSON.parse(translated.output!);
    expect(final.systemMessage).toBe("Hook error: continue mode");
    expect(final.hookSpecificOutput.permissionDecision).toBe("allow");
  });

  it("systemMessage created as minimal JSON when no output exists", () => {
    const translated: { output?: string; exitCode: number; stderr?: string } = {
      exitCode: 0,
    };
    const systemMessages = ["Startup warning"];

    if (systemMessages.length > 0) {
      const systemMessage = systemMessages.join("\n");
      if (translated.output) {
        const parsed = JSON.parse(translated.output);
        parsed.systemMessage = systemMessage;
        translated.output = JSON.stringify(parsed);
      } else {
        translated.output = JSON.stringify({ systemMessage });
      }
    }

    const final = JSON.parse(translated.output!);
    expect(final.systemMessage).toBe("Startup warning");
  });
});
