import { describe, expect, it, afterEach, spyOn } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { translateResult, matchHooksForEvent, executeHooks, interpolateMessage, resolveOnError, buildShadowWarnings } from "./engine.js";
import type { LoadedHook, HookLoadError } from "./loader.js";
import type { ClooksHook } from "./types/hook.js";
import type { ClooksConfig } from "./config/types.js";
import type { HookName } from "./types/branded.js";
import { hn, ms } from "./test-utils.js";
import { DEFAULT_MAX_FAILURES_MESSAGE } from "./config/constants.js";
import { readFailures, getFailurePath, LOAD_ERROR_EVENT } from "./failures.js";

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
      event: "PreToolUse",
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

/** Compute the failure file path for a temp dir (project-local path). */
function fp(dir: string): string {
  return join(dir, ".clooks/.failures");
}

function makeTestConfig(
  hookOverrides: Record<string, {
    parallel?: boolean;
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
      origin: "project",
      ...overrides,
    };
  }
  return {
    version: "1.0.0",
    global: {
      timeout: ms(30000),
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

    const result = await executeHooks([hook], "PreToolUse", {}, config, fp(dir));
    expect(result.lastResult?.result).toBe("block");
    expect(result.lastResult?.reason).toContain("fail-hook");
    expect(result.lastResult?.reason).toContain("boom");
    expect(result.traceMessages).toEqual([]);
    expect(result.systemMessages).toEqual([]);

    // Failure state should be written
    const state = await readFailures(fp(dir));
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
      const r = await executeHooks([hook], "PreToolUse", {}, config, fp(dir));
      expect(r.lastResult?.result).toBe("block");
    }

    // Third failure should NOT block — hook is degraded
    const result = await executeHooks([hook], "PreToolUse", {}, config, fp(dir));
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
      await executeHooks([hook], "PreToolUse", {}, config, fp(dir));
    }
    await executeHooks([hook], "PreToolUse", {}, config, fp(dir));

    // Fourth invocation — still degraded
    const result = await executeHooks([hook], "PreToolUse", {}, config, fp(dir));
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
      await executeHooks([hook], "PreToolUse", {}, config, fp(dir));
    }
    await executeHooks([hook], "PreToolUse", {}, config, fp(dir));

    // Fix the hook
    shouldThrow = false;
    const result = await executeHooks([hook], "PreToolUse", {}, config, fp(dir));
    expect(result.lastResult).toEqual({ result: "allow" });
    expect(result.degradedMessages).toHaveLength(0);

    // Failure state should be cleared
    const state = await readFailures(fp(dir));
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
      const result = await executeHooks([hook], "PreToolUse", {}, config, fp(dir));
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
      await executeHooks([goodHook, badHook], "PreToolUse", {}, config, fp(dir));
    }

    const result = await executeHooks([goodHook, badHook], "PreToolUse", {}, config, fp(dir));
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
    const result = await executeHooks([badHook1, badHook2], "PreToolUse", {}, config, fp(dir));
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
    const result = await executeHooks([hook], "PreToolUse", {}, config, fp(dir));
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
    const result = await executeHooks([hook], "SessionEnd", {}, config, fp(dir));
    expect(result.degradedMessages).toHaveLength(1);
  });

  // --- Load error circuit breaker ---

  it("load error under threshold → fail-closed (block result)", async () => {
    const dir = makeTempDir();
    const loadErrors: HookLoadError[] = [
      { name: hn("broken-hook"), error: "Cannot find module '/path/to/broken-hook.ts'" },
    ];
    const config = makeTestConfig({ "broken-hook": {} }, 3);

    const result = await executeHooks([], "PreToolUse", {}, config, fp(dir), loadErrors);
    expect(result.lastResult?.result).toBe("block");
    expect(result.lastResult?.reason).toContain("broken-hook");

    // Load errors use LOAD_ERROR_EVENT, not the actual event name
    const state = await readFailures(fp(dir));
    expect(state[hn("broken-hook")]?.[LOAD_ERROR_EVENT]?.consecutiveFailures).toBe(1);
    expect(state[hn("broken-hook")]?.["PreToolUse"]).toBeUndefined();
  });

  it("load error reaches threshold → skipped with degraded message", async () => {
    const dir = makeTempDir();
    const loadErrors: HookLoadError[] = [
      { name: hn("broken-hook"), error: "Cannot find module '/path/to/broken-hook.ts'" },
    ];
    const config = makeTestConfig({ "broken-hook": {} }, 3);

    // Fail twice (under threshold — produces block results)
    for (let i = 0; i < 2; i++) {
      const r = await executeHooks([], "PreToolUse", {}, config, fp(dir), loadErrors);
      expect(r.lastResult?.result).toBe("block");
    }

    // Third failure — should skip (degraded), not block
    const result = await executeHooks([], "PreToolUse", {}, config, fp(dir), loadErrors);
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

    const result = await executeHooks([goodHook], "PreToolUse", {}, config, fp(dir), loadErrors);
    expect(result.lastResult).toEqual({ result: "allow" });
    expect(result.degradedMessages).toHaveLength(1);
    expect(result.degradedMessages[0]).toContain("broken-hook");
  });

  it("load errors use event-independent counting across different events", async () => {
    const dir = makeTempDir();
    const loadErrors: HookLoadError[] = [
      { name: hn("broken-hook"), error: "Cannot find module '/path/to/broken-hook.ts'" },
    ];
    const config = makeTestConfig({ "broken-hook": {} }, 3);

    // Fail on PreToolUse (count=1)
    const r1 = await executeHooks([], "PreToolUse", {}, config, fp(dir), loadErrors);
    expect(r1.lastResult?.result).toBe("block");

    // Fail on PostToolUse (count=2, same counter via LOAD_ERROR_EVENT)
    const r2 = await executeHooks([], "PostToolUse", {}, config, fp(dir), loadErrors);
    expect(r2.lastResult?.result).toBe("block");

    // Third failure on SessionStart (count=3) — should degrade, not block
    const r3 = await executeHooks([], "SessionStart", {}, config, fp(dir), loadErrors);
    expect(r3.lastResult).toBeUndefined();
    expect(r3.degradedMessages).toHaveLength(1);
    expect(r3.degradedMessages[0]).toContain("broken-hook");

    // Verify single counter under LOAD_ERROR_EVENT
    const state = await readFailures(fp(dir));
    expect(state[hn("broken-hook")]?.[LOAD_ERROR_EVENT]?.consecutiveFailures).toBe(3);
    expect(state[hn("broken-hook")]?.["PreToolUse"]).toBeUndefined();
    expect(state[hn("broken-hook")]?.["PostToolUse"]).toBeUndefined();
    expect(state[hn("broken-hook")]?.["SessionStart"]).toBeUndefined();
  });

  it("load error under threshold includes actionable system message", async () => {
    const dir = makeTempDir();
    const loadErrors: HookLoadError[] = [
      { name: hn("order-tracer-home"), error: "Cannot find module '/home/joe/.clooks/hooks/order-tracer-home.ts'" },
    ];
    const config = makeTestConfig({ "order-tracer-home": {} }, 3);

    const result = await executeHooks([], "PreToolUse", {}, config, fp(dir), loadErrors);
    expect(result.lastResult?.result).toBe("block");
    expect(result.systemMessages).toHaveLength(1);
    expect(result.systemMessages[0]).toContain('[clooks] Hook "order-tracer-home" failed to load');
    expect(result.systemMessages[0]).toContain("Cannot find module");
    expect(result.systemMessages[0]).toContain("Fix: Remove");
    expect(result.systemMessages[0]).toContain("clooks.yml");
    expect(result.systemMessages[0]).toContain("disabled after 3 consecutive load failures");
  });

  it("load error at threshold includes disabled system message", async () => {
    const dir = makeTempDir();
    const loadErrors: HookLoadError[] = [
      { name: hn("order-tracer-home"), error: "Cannot find module '/home/joe/.clooks/hooks/order-tracer-home.ts'" },
    ];
    const config = makeTestConfig({ "order-tracer-home": {} }, 3);

    // Fail twice to reach threshold
    for (let i = 0; i < 2; i++) {
      await executeHooks([], "PreToolUse", {}, config, fp(dir), loadErrors);
    }

    // Third failure — threshold reached, should degrade
    const result = await executeHooks([], "PostToolUse", {}, config, fp(dir), loadErrors);
    expect(result.lastResult).toBeUndefined();
    expect(result.systemMessages).toHaveLength(1);
    expect(result.systemMessages[0]).toContain('[clooks] Hook "order-tracer-home" has been disabled');
    expect(result.systemMessages[0]).toContain("3 consecutive load failures");
    expect(result.systemMessages[0]).toContain("Fix: Remove");
  });

  // --- FEAT-0017: onError cascade tests ---

  it("onError 'continue' — no block, systemMessage collected", async () => {
    const dir = makeTempDir();
    const hook = makeLoadedHook("notify-hook", {
      PreToolUse: () => { throw new Error("notify failed"); },
    });
    const config = makeTestConfig({ "notify-hook": { onError: "continue" } });

    const result = await executeHooks([hook], "PreToolUse", {}, config, fp(dir));
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

    const result = await executeHooks([hook], "PreToolUse", {}, config, fp(dir));
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

    const result = await executeHooks([hook1, hook2], "PreToolUse", {}, config, fp(dir));
    expect(result.lastResult?.result).toBe("block");
    expect(result.lastResult?.reason).toContain("blocked");
  });

  it("onError 'continue' skips recordFailure", async () => {
    const dir = makeTempDir();
    const hook = makeLoadedHook("continue-hook", {
      PreToolUse: () => { throw new Error("err"); },
    });
    const config = makeTestConfig({ "continue-hook": { onError: "continue" } });

    await executeHooks([hook], "PreToolUse", {}, config, fp(dir));
    const state = await readFailures(fp(dir));
    expect(state[hn("continue-hook")]).toBeUndefined();
  });

  it("onError 'trace' skips recordFailure", async () => {
    const dir = makeTempDir();
    const hook = makeLoadedHook("trace-hook", {
      PreToolUse: () => { throw new Error("err"); },
    });
    const config = makeTestConfig({ "trace-hook": { onError: "trace" } });

    await executeHooks([hook], "PreToolUse", {}, config, fp(dir));
    const state = await readFailures(fp(dir));
    expect(state[hn("trace-hook")]).toBeUndefined();
  });

  it("import failure always blocks regardless of hook onError", async () => {
    const dir = makeTempDir();
    const loadErrors: HookLoadError[] = [
      { name: hn("broken-hook"), error: "Cannot find module" },
    ];
    const config = makeTestConfig({ "broken-hook": { onError: "continue" } });

    const result = await executeHooks([], "PreToolUse", {}, config, fp(dir), loadErrors);
    expect(result.lastResult?.result).toBe("block");
  });

  it("trace falls back to continue for non-injectable events", async () => {
    const dir = makeTempDir();
    const hook = makeLoadedHook("trace-hook", {
      SessionEnd: () => { throw new Error("err"); },
    });
    const config = makeTestConfig({ "trace-hook": { onError: "trace" } });

    const result = await executeHooks([hook], "SessionEnd", {}, config, fp(dir));
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

    const result = await executeHooks([hook], "PreToolUse", {}, config, fp(dir));
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

    const result = await executeHooks([hook1, hook2], "PreToolUse", {}, config, fp(dir));
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

// --- FEAT-0016 M3: Sequential pipeline with updatedInput ---

describe("sequential pipeline: updatedInput", () => {
  it("updatedInput piped from hook A to hook B", async () => {
    const dir = makeTempDir();
    let capturedCtx: Record<string, unknown> | undefined;

    const hookA = makeLoadedHook("hookA", {
      PreToolUse: () => ({ result: "allow", updatedInput: { file_path: "/modified" } }),
    });
    const hookB = makeLoadedHook("hookB", {
      PreToolUse: (ctx: Record<string, unknown>) => {
        capturedCtx = ctx;
        return { result: "allow" };
      },
    });
    const config = makeTestConfig({ hookA: {}, hookB: {} });
    const normalized = { event: "PreToolUse", toolInput: { file_path: "/original" } };

    const result = await executeHooks([hookA, hookB], "PreToolUse", normalized, config, fp(dir));
    expect(result.lastResult?.result).toBe("allow");

    // Hook B should have received the modified toolInput from hook A
    expect(capturedCtx?.toolInput).toEqual({ file_path: "/modified" });
    // Hook B should have received the original toolInput as originalToolInput
    expect(capturedCtx?.originalToolInput).toEqual({ file_path: "/original" });

    // Final result should have updatedInput since currentToolInput changed
    expect(result.lastResult?.updatedInput).toEqual({ file_path: "/modified" });
  });

  it("originalToolInput stays frozen across chain", async () => {
    const dir = makeTempDir();
    let capturedCtxC: Record<string, unknown> | undefined;

    const hookA = makeLoadedHook("hookA", {
      PreToolUse: () => ({ result: "allow", updatedInput: { file_path: "/step1", extra: "a" } }),
    });
    const hookB = makeLoadedHook("hookB", {
      PreToolUse: () => ({ result: "allow", updatedInput: { file_path: "/step2", extra: "b" } }),
    });
    const hookC = makeLoadedHook("hookC", {
      PreToolUse: (ctx: Record<string, unknown>) => {
        capturedCtxC = ctx;
        return { result: "allow" };
      },
    });
    const config = makeTestConfig({ hookA: {}, hookB: {}, hookC: {} });
    const normalized = { event: "PreToolUse", toolInput: { file_path: "/original" } };

    const result = await executeHooks([hookA, hookB, hookC], "PreToolUse", normalized, config, fp(dir));
    expect(result.lastResult?.result).toBe("allow");

    // Hook C receives B's updatedInput as toolInput (cumulative)
    expect(capturedCtxC?.toolInput).toEqual({ file_path: "/step2", extra: "b" });
    // originalToolInput is always the original
    expect(capturedCtxC?.originalToolInput).toEqual({ file_path: "/original" });

    // Final result reflects last updatedInput
    expect(result.lastResult?.updatedInput).toEqual({ file_path: "/step2", extra: "b" });
  });

  it("block in middle stops chain", async () => {
    const dir = makeTempDir();
    let hookCRan = false;

    const hookA = makeLoadedHook("hookA", {
      PreToolUse: () => ({ result: "allow" }),
    });
    const hookB = makeLoadedHook("hookB", {
      PreToolUse: () => ({ result: "block", reason: "blocked by B" }),
    });
    const hookC = makeLoadedHook("hookC", {
      PreToolUse: () => {
        hookCRan = true;
        return { result: "allow" };
      },
    });
    const config = makeTestConfig({ hookA: {}, hookB: {}, hookC: {} });

    const result = await executeHooks([hookA, hookB, hookC], "PreToolUse", {}, config, fp(dir));
    expect(result.lastResult?.result).toBe("block");
    expect(result.lastResult?.reason).toBe("blocked by B");
    expect(hookCRan).toBe(false);
  });

  it("injectContext accumulates across hooks", async () => {
    const dir = makeTempDir();

    const hookA = makeLoadedHook("hookA", {
      PreToolUse: () => ({ result: "allow", injectContext: "context from A" }),
    });
    const hookB = makeLoadedHook("hookB", {
      PreToolUse: () => ({ result: "allow", injectContext: "context from B" }),
    });
    const config = makeTestConfig({ hookA: {}, hookB: {} });

    const result = await executeHooks([hookA, hookB], "PreToolUse", {}, config, fp(dir));
    expect(result.lastResult?.result).toBe("allow");
    expect(result.lastResult?.injectContext).toBe("context from A\ncontext from B");
  });

  it("sequential pipeline: block in later group includes prior group injectContext", async () => {
    const dir = makeTempDir();
    // Hook A is parallel, returns allow with injectContext
    const hookA = makeLoadedHook("hookA", {
      PreToolUse: () => ({ result: "allow", injectContext: "context-from-A" }),
    });
    // Hook B is sequential, returns block with its own injectContext
    const hookB = makeLoadedHook("hookB", {
      PreToolUse: () => ({ result: "block", reason: "blocked", injectContext: "context-from-B" }),
    });
    // Make hookA parallel so they end up in different groups
    const config = makeTestConfig({ hookA: { parallel: true }, hookB: {} });

    const result = await executeHooks([hookA, hookB], "PreToolUse", {}, config, fp(dir));
    expect(result.lastResult?.result).toBe("block");
    // injectContext should include both A's and B's context
    expect(result.lastResult?.injectContext).toContain("context-from-A");
    expect(result.lastResult?.injectContext).toContain("context-from-B");
  });
});

describe("timeout enforcement", () => {
  it("timeout fires and is treated as error", async () => {
    const dir = makeTempDir();

    const hookSlow = makeLoadedHook("slow-hook", {
      PreToolUse: () => new Promise(() => {
        // Never resolves
      }),
    });
    const config = makeTestConfig({ "slow-hook": { } });
    // Override global timeout to be very short
    config.global.timeout = ms(50);

    const result = await executeHooks([hookSlow], "PreToolUse", {}, config, fp(dir));
    expect(result.lastResult?.result).toBe("block");
    expect(result.lastResult?.reason).toContain("slow-hook");
    expect(result.lastResult?.reason).toContain("timed out");
  });
});

describe("translateResult updatedInput", () => {
  it("passes through updatedInput on PreToolUse allow", () => {
    const out = translateResult("PreToolUse", {
      result: "allow",
      updatedInput: { x: 1 },
    });
    expect(out.exitCode).toBe(0);
    const parsed = JSON.parse(out.output!);
    expect(parsed.hookSpecificOutput.updatedInput).toEqual({ x: 1 });
    expect(parsed.hookSpecificOutput.permissionDecision).toBe("allow");
  });

  it("does not include updatedInput when not present", () => {
    const out = translateResult("PreToolUse", { result: "allow" });
    expect(out.exitCode).toBe(0);
    const parsed = JSON.parse(out.output!);
    expect(parsed.hookSpecificOutput.updatedInput).toBeUndefined();
  });
});

// --- FEAT-0016 M4: Parallel batch execution ---

describe("parallel batch", () => {
  it("hooks run concurrently", async () => {
    const dir = makeTempDir();
    const hookA = makeLoadedHook("hookA", {
      PreToolUse: async () => { await Bun.sleep(50); return { result: "allow", injectContext: "A" }; },
    });
    const hookB = makeLoadedHook("hookB", {
      PreToolUse: async () => { await Bun.sleep(50); return { result: "allow", injectContext: "B" }; },
    });
    const config = makeTestConfig({ hookA: { parallel: true }, hookB: { parallel: true } });

    const start = performance.now();
    const result = await executeHooks([hookA, hookB], "PreToolUse", {}, config, fp(dir));
    const elapsed = performance.now() - start;

    expect(result.lastResult?.result).toBe("allow");
    // Both ran — injectContext has both values
    expect(result.lastResult?.injectContext).toContain("A");
    expect(result.lastResult?.injectContext).toContain("B");
    // Concurrent: should be ~50ms, not ~100ms. Allow generous margin.
    expect(elapsed).toBeLessThan(90);
  });

  it("injectContext from multiple hooks merged", async () => {
    const dir = makeTempDir();
    const hookA = makeLoadedHook("hookA", {
      PreToolUse: () => ({ result: "allow", injectContext: "context-A" }),
    });
    const hookB = makeLoadedHook("hookB", {
      PreToolUse: () => ({ result: "allow", injectContext: "context-B" }),
    });
    const config = makeTestConfig({ hookA: { parallel: true }, hookB: { parallel: true } });

    const result = await executeHooks([hookA, hookB], "PreToolUse", {}, config, fp(dir));
    expect(result.lastResult?.result).toBe("allow");
    expect(result.lastResult?.injectContext).toContain("context-A");
    expect(result.lastResult?.injectContext).toContain("context-B");
    // Newline-joined
    expect(result.lastResult?.injectContext).toBe("context-A\ncontext-B");
  });

  it("block short-circuits", async () => {
    const dir = makeTempDir();
    const hookA = makeLoadedHook("hookA", {
      PreToolUse: () => ({ result: "block", reason: "denied" }),
    });
    const hookB = makeLoadedHook("hookB", {
      PreToolUse: async () => { await Bun.sleep(500); return { result: "allow" }; },
    });
    const config = makeTestConfig({ hookA: { parallel: true }, hookB: { parallel: true } });

    const start = performance.now();
    const result = await executeHooks([hookA, hookB], "PreToolUse", {}, config, fp(dir));
    const elapsed = performance.now() - start;

    expect(result.lastResult?.result).toBe("block");
    expect(result.lastResult?.reason).toBe("denied");
    // Short-circuited: should be well under 500ms
    expect(elapsed).toBeLessThan(200);
  });

  it("crash with onError block short-circuits", async () => {
    const dir = makeTempDir();
    const hookA = makeLoadedHook("hookA", {
      PreToolUse: () => { throw new Error("crash"); },
    });
    const hookB = makeLoadedHook("hookB", {
      PreToolUse: async () => { await Bun.sleep(500); return { result: "allow" }; },
    });
    const config = makeTestConfig({
      hookA: { parallel: true, onError: "block" },
      hookB: { parallel: true },
    });

    const start = performance.now();
    const result = await executeHooks([hookA, hookB], "PreToolUse", {}, config, fp(dir));
    const elapsed = performance.now() - start;

    expect(result.lastResult?.result).toBe("block");
    expect(result.lastResult?.reason).toContain("crash");
    expect(elapsed).toBeLessThan(200);
  });

  it("crash with onError continue waits for others", async () => {
    const dir = makeTempDir();
    const hookA = makeLoadedHook("hookA", {
      PreToolUse: () => { throw new Error("non-fatal"); },
    });
    const hookB = makeLoadedHook("hookB", {
      PreToolUse: async () => { await Bun.sleep(50); return { result: "allow", injectContext: "B-ok" }; },
    });
    const config = makeTestConfig({
      hookA: { parallel: true, onError: "continue" },
      hookB: { parallel: true },
    });

    const result = await executeHooks([hookA, hookB], "PreToolUse", {}, config, fp(dir));
    // Hook B's result should be used
    expect(result.lastResult?.result).toBe("allow");
    expect(result.lastResult?.injectContext).toContain("B-ok");
    // Hook A's failure logged as systemMessage
    expect(result.systemMessages.length).toBeGreaterThanOrEqual(1);
    expect(result.systemMessages[0]).toContain("non-fatal");
  });

  it("updatedInput is contract violation", async () => {
    const dir = makeTempDir();
    const hookA = makeLoadedHook("hookA", {
      PreToolUse: () => ({ result: "allow", updatedInput: { x: 1 } }),
    });
    const config = makeTestConfig({ hookA: { parallel: true } });

    const result = await executeHooks([hookA], "PreToolUse", {}, config, fp(dir));
    expect(result.lastResult?.result).toBe("block");
    expect(result.lastResult?.reason).toContain("contract violation");
    expect(result.lastResult?.reason).toContain("hookA");

    // Should count toward maxFailures
    const state = await readFailures(fp(dir));
    expect(state[hn("hookA")]?.["PreToolUse"]?.consecutiveFailures).toBe(1);
  });

  it("all skip is passthrough", async () => {
    const dir = makeTempDir();
    const hookA = makeLoadedHook("hookA", {
      PreToolUse: () => ({ result: "skip" }),
    });
    const hookB = makeLoadedHook("hookB", {
      PreToolUse: () => ({ result: "skip" }),
    });
    const config = makeTestConfig({ hookA: { parallel: true }, hookB: { parallel: true } });

    const result = await executeHooks([hookA, hookB], "PreToolUse", {}, config, fp(dir));
    // No non-skip result, no injectContext
    expect(result.lastResult).toBeUndefined();
    expect(result.degradedMessages).toEqual([]);
    expect(result.traceMessages).toEqual([]);
  });

  it("circuit breaker updated after all settle", async () => {
    const dir = makeTempDir();
    const hookA = makeLoadedHook("hookA", {
      PreToolUse: () => { throw new Error("err-A"); },
    });
    const hookB = makeLoadedHook("hookB", {
      PreToolUse: () => { throw new Error("err-B"); },
    });
    const config = makeTestConfig({
      hookA: { parallel: true, onError: "block" },
      hookB: { parallel: true, onError: "block" },
    });

    await executeHooks([hookA, hookB], "PreToolUse", {}, config, fp(dir));

    // Both failures should be recorded
    const state = await readFailures(fp(dir));
    expect(state[hn("hookA")]?.["PreToolUse"]?.consecutiveFailures).toBe(1);
    expect(state[hn("hookB")]?.["PreToolUse"]?.consecutiveFailures).toBe(1);
  });

  it("degraded hook in parallel group does not block pipeline", async () => {
    const dir = makeTempDir();
    const hookA = makeLoadedHook("hookA", {
      PreToolUse: () => { throw new Error("degraded-err"); },
    });
    const hookB = makeLoadedHook("hookB", {
      PreToolUse: () => ({ result: "allow", injectContext: "B-ok" }),
    });
    // maxFailures=1 so first failure degrades immediately
    const config = makeTestConfig({
      hookA: { parallel: true, onError: "block", maxFailures: 1 },
      hookB: { parallel: true },
    });

    const result = await executeHooks([hookA, hookB], "PreToolUse", {}, config, fp(dir));
    // Hook A is degraded — should NOT block
    expect(result.lastResult?.result).toBe("allow");
    expect(result.lastResult?.injectContext).toContain("B-ok");
    expect(result.degradedMessages).toHaveLength(1);
    expect(result.degradedMessages[0]).toContain("hookA");
  });

  it("skip result clears failure state in parallel (matching sequential runner)", async () => {
    const dir = makeTempDir();
    let callCount = 0;
    const hookA = makeLoadedHook("hookA", {
      PreToolUse: () => {
        callCount++;
        if (callCount <= 1) throw new Error("first-fail");
        return { result: "skip" };
      },
    });
    const config = makeTestConfig({
      hookA: { parallel: true, onError: "block", maxFailures: 0 },
    });

    // First call: failure recorded
    await executeHooks([hookA], "PreToolUse", {}, config, fp(dir));
    const state1 = await readFailures(fp(dir));
    expect(state1[hn("hookA")]?.["PreToolUse"]?.consecutiveFailures).toBe(1);

    // Second call: returns skip — should still clear failure state
    await executeHooks([hookA], "PreToolUse", {}, config, fp(dir));
    const state2 = await readFailures(fp(dir));
    expect(state2[hn("hookA")]).toBeUndefined();
  });

  it("AbortSignal fired on short-circuit", async () => {
    const dir = makeTempDir();
    let signalAborted = false;

    const hookA = makeLoadedHook("hookA", {
      PreToolUse: () => ({ result: "block", reason: "blocked" }),
    });
    const hookB = makeLoadedHook("hookB", {
      PreToolUse: async (ctx: Record<string, unknown>) => {
        const signal = ctx.signal as AbortSignal;
        // Wait a tick to let hookA's result propagate and trigger abort
        await Bun.sleep(20);
        signalAborted = signal.aborted;
        return { result: "allow" };
      },
    });
    const config = makeTestConfig({ hookA: { parallel: true }, hookB: { parallel: true } });

    const result = await executeHooks([hookA, hookB], "PreToolUse", {}, config, fp(dir));
    expect(result.lastResult?.result).toBe("block");
    // Give hookB a moment to check the signal
    await Bun.sleep(30);
    expect(signalAborted).toBe(true);
  });

  it("parallel batch: block result injectContext merged with other hooks", async () => {
    const dir = makeTempDir();
    const hookA = makeLoadedHook("hookA", {
      PreToolUse: () => ({ result: "allow", injectContext: "from-allow" }),
    });
    const hookB = makeLoadedHook("hookB", {
      PreToolUse: () => ({ result: "block", reason: "blocked", injectContext: "from-block" }),
    });
    const config = makeTestConfig({ hookA: { parallel: true }, hookB: { parallel: true } });

    const result = await executeHooks([hookA, hookB], "PreToolUse", {}, config, fp(dir));

    expect(result.lastResult?.result).toBe("block");
    expect(result.lastResult?.injectContext).toContain("from-allow");
    expect(result.lastResult?.injectContext).toContain("from-block");
  });
});

// --- FEAT-0016 M4: Mixed pipeline tests ---

describe("mixed pipeline", () => {
  it("sequential then parallel then sequential", async () => {
    const dir = makeTempDir();
    let capturedParCtx: Record<string, unknown> | undefined;
    let capturedSeqCCtx: Record<string, unknown> | undefined;

    // Sequential group A — pipes updatedInput
    const hookA = makeLoadedHook("hookA", {
      PreToolUse: () => ({
        result: "allow",
        updatedInput: { file_path: "/modified-by-A" },
        injectContext: "from-A",
      }),
    });
    // Parallel group B — receives modified toolInput, returns allow with injectContext
    const hookB = makeLoadedHook("hookB", {
      PreToolUse: (ctx: Record<string, unknown>) => {
        capturedParCtx = ctx;
        return { result: "allow", injectContext: "from-B" };
      },
    });
    // Sequential group C — receives merged state
    const hookC = makeLoadedHook("hookC", {
      PreToolUse: (ctx: Record<string, unknown>) => {
        capturedSeqCCtx = ctx;
        return { result: "allow", injectContext: "from-C" };
      },
    });

    const config = makeTestConfig({
      hookA: { parallel: false },
      hookB: { parallel: true },
      hookC: { parallel: false },
    });
    // Force order: A, B, C via event order
    config.events = {
      PreToolUse: { order: [hn("hookA"), hn("hookB"), hn("hookC")] },
    };

    const normalized = { event: "PreToolUse", toolInput: { file_path: "/original" } };
    const result = await executeHooks([hookA, hookB, hookC], "PreToolUse", normalized, config, fp(dir));

    expect(result.lastResult?.result).toBe("allow");

    // Parallel hook B received the modified toolInput from sequential hook A
    expect(capturedParCtx?.toolInput).toEqual({ file_path: "/modified-by-A" });
    expect(capturedParCtx?.originalToolInput).toEqual({ file_path: "/original" });
    expect(capturedParCtx?.parallel).toBe(true);

    // Sequential hook C also receives the modified toolInput (unchanged by parallel B)
    expect(capturedSeqCCtx?.toolInput).toEqual({ file_path: "/modified-by-A" });
    expect(capturedSeqCCtx?.originalToolInput).toEqual({ file_path: "/original" });
    expect(capturedSeqCCtx?.parallel).toBe(false);

    // All injectContext accumulated
    expect(result.lastResult?.injectContext).toContain("from-A");
    expect(result.lastResult?.injectContext).toContain("from-B");
    expect(result.lastResult?.injectContext).toContain("from-C");
  });

  it("parallel block stops subsequent groups", async () => {
    const dir = makeTempDir();
    let hookCRan = false;

    const hookA = makeLoadedHook("hookA", {
      PreToolUse: () => ({ result: "block", reason: "parallel-block" }),
    });
    const hookB = makeLoadedHook("hookB", {
      PreToolUse: () => ({ result: "allow" }),
    });
    const hookC = makeLoadedHook("hookC", {
      PreToolUse: () => {
        hookCRan = true;
        return { result: "allow" };
      },
    });

    const config = makeTestConfig({
      hookA: { parallel: true },
      hookB: { parallel: true },
      hookC: { parallel: false },
    });
    // Force order: parallel [A, B] then sequential [C]
    config.events = {
      PreToolUse: { order: [hn("hookA"), hn("hookB"), hn("hookC")] },
    };

    const result = await executeHooks([hookA, hookB, hookC], "PreToolUse", {}, config, fp(dir));
    expect(result.lastResult?.result).toBe("block");
    expect(result.lastResult?.reason).toBe("parallel-block");
    expect(hookCRan).toBe(false);
  });

  it("injectContext accumulates across all groups", async () => {
    const dir = makeTempDir();

    // Sequential group
    const hookA = makeLoadedHook("hookA", {
      PreToolUse: () => ({ result: "allow", injectContext: "seq-A" }),
    });
    // Parallel group
    const hookB = makeLoadedHook("hookB", {
      PreToolUse: () => ({ result: "allow", injectContext: "par-B" }),
    });
    const hookC = makeLoadedHook("hookC", {
      PreToolUse: () => ({ result: "allow", injectContext: "par-C" }),
    });
    // Sequential group
    const hookD = makeLoadedHook("hookD", {
      PreToolUse: () => ({ result: "allow", injectContext: "seq-D" }),
    });

    const config = makeTestConfig({
      hookA: { parallel: false },
      hookB: { parallel: true },
      hookC: { parallel: true },
      hookD: { parallel: false },
    });
    config.events = {
      PreToolUse: { order: [hn("hookA"), hn("hookB"), hn("hookC"), hn("hookD")] },
    };

    const result = await executeHooks([hookA, hookB, hookC, hookD], "PreToolUse", {}, config, fp(dir));
    expect(result.lastResult?.result).toBe("allow");
    expect(result.lastResult?.injectContext).toBe("seq-A\npar-B\npar-C\nseq-D");
  });
});

// --- FEAT-0016 M5: Integration tests (full pipeline) ---

describe("integration: full pipeline", () => {
  it("full pipeline with ordering", async () => {
    const dir = makeTempDir();

    // Scanner is sequential, formatter is sequential.
    // Scanner returns updatedInput that formatter observes.
    // Declared in reverse order (formatter first, scanner second) to prove
    // that the order list controls execution, not declaration order.
    const formatter = makeLoadedHook("formatter", {
      PreToolUse: (ctx: Record<string, unknown>) => {
        // Formatter sees the toolInput modified by scanner
        const toolInput = ctx.toolInput as Record<string, unknown>;
        return {
          result: "allow",
          injectContext: `formatted:${toolInput.command}`,
        };
      },
    });
    const scanner = makeLoadedHook("scanner", {
      PreToolUse: () => ({
        result: "allow",
        updatedInput: { command: "scanned-cmd" },
        injectContext: "scanned",
      }),
    });

    const config = makeTestConfig({
      scanner: { parallel: false },
      formatter: { parallel: false },
    });
    config.events = {
      PreToolUse: { order: [hn("scanner"), hn("formatter")] },
    };

    const normalized = { event: "PreToolUse", toolInput: { command: "original-cmd" } };
    // Pass hooks in reverse declaration order — order list should override
    const result = await executeHooks([formatter, scanner], "PreToolUse", normalized, config, fp(dir));

    expect(result.lastResult?.result).toBe("allow");
    // Formatter saw scanner's updatedInput
    expect(result.lastResult?.injectContext).toBe("scanned\nformatted:scanned-cmd");
    // updatedInput flows through to final result
    expect(result.lastResult?.updatedInput).toEqual({ command: "scanned-cmd" });
  });

  it("full pipeline with unordered hooks", async () => {
    const dir = makeTempDir();
    const executionOrder: string[] = [];

    // Ordered hooks (in order list)
    const orderedA = makeLoadedHook("orderedA", {
      PreToolUse: () => {
        executionOrder.push("orderedA");
        return { result: "allow", injectContext: "orderedA" };
      },
    });
    const orderedB = makeLoadedHook("orderedB", {
      PreToolUse: () => {
        executionOrder.push("orderedB");
        return { result: "allow", injectContext: "orderedB" };
      },
    });

    // Unordered parallel hook — should run before ordered hooks
    const unorderedPar = makeLoadedHook("unorderedPar", {
      PreToolUse: () => {
        executionOrder.push("unorderedPar");
        return { result: "allow", injectContext: "unorderedPar" };
      },
    });

    // Unordered sequential hook — should run after ordered hooks
    const unorderedSeq = makeLoadedHook("unorderedSeq", {
      PreToolUse: () => {
        executionOrder.push("unorderedSeq");
        return { result: "allow", injectContext: "unorderedSeq" };
      },
    });

    const config = makeTestConfig({
      orderedA: { parallel: false },
      orderedB: { parallel: false },
      unorderedPar: { parallel: true },
      unorderedSeq: { parallel: false },
    });
    config.events = {
      PreToolUse: { order: [hn("orderedA"), hn("orderedB")] },
    };

    const result = await executeHooks(
      [orderedA, orderedB, unorderedPar, unorderedSeq],
      "PreToolUse", {}, config, fp(dir),
    );

    expect(result.lastResult?.result).toBe("allow");
    // Unordered parallel runs first, then ordered, then unordered sequential
    expect(executionOrder).toEqual(["unorderedPar", "orderedA", "orderedB", "unorderedSeq"]);
    // All injectContext accumulated in execution order
    expect(result.lastResult?.injectContext).toBe(
      "unorderedPar\norderedA\norderedB\nunorderedSeq",
    );
  });

  it("full pipeline: updatedInput flows through to translateResult", async () => {
    const dir = makeTempDir();

    const hook = makeLoadedHook("mutator", {
      PreToolUse: () => ({
        result: "allow",
        updatedInput: { filePath: "/new/path" },
      }),
    });

    const config = makeTestConfig({ mutator: { parallel: false } });

    const normalized = { event: "PreToolUse", toolInput: { filePath: "/old/path" } };
    const result = await executeHooks([hook], "PreToolUse", normalized, config, fp(dir));

    // Pipeline result has updatedInput
    expect(result.lastResult?.result).toBe("allow");
    expect(result.lastResult?.updatedInput).toEqual({ filePath: "/new/path" });

    // Now translate and verify it appears in the PreToolUse JSON output
    const translated = translateResult("PreToolUse", result.lastResult!);
    expect(translated.exitCode).toBe(0);
    const parsed = JSON.parse(translated.output!);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(parsed.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(parsed.hookSpecificOutput.updatedInput).toEqual({ filePath: "/new/path" });
  });

  it("ordering error: order references hook that doesn't handle event", async () => {
    const dir = makeTempDir();

    // hook-a only handles PostToolUse, hook-b handles PreToolUse.
    // Config orders PreToolUse as [hook-a], but hook-a won't match.
    const hookA = makeLoadedHook("hook-a", {
      PostToolUse: () => ({ result: "skip" }),
    });
    const hookB = makeLoadedHook("hook-b", {
      PreToolUse: () => ({ result: "allow" }),
    });

    const config = makeTestConfig({
      "hook-a": { parallel: false },
      "hook-b": { parallel: false },
    });
    config.events = {
      PreToolUse: { order: [hn("hook-a")] },
    };

    // Only hook-b matches PreToolUse; hook-a is excluded by matchHooksForEvent.
    // executeHooks should throw because the order list references hook-a
    // which isn't in the matched set.
    const matched = matchHooksForEvent([hookA, hookB], "PreToolUse" as import("./types/branded.js").EventName);

    await expect(
      executeHooks(matched, "PreToolUse", {}, config, fp(dir)),
    ).rejects.toThrow(/hook-a.*does not handle this event/);
  });
});

// --- Shadow warnings (M2) ---

describe("buildShadowWarnings", () => {
  it("produces correct warning messages for multiple shadows on SessionStart", () => {
    const warnings = buildShadowWarnings("SessionStart", [hn("log-bash-commands"), hn("security-audit")]);

    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toBe(
      'clooks: project hook "log-bash-commands" is shadowing a global hook with the same name.'
    );
    expect(warnings[1]).toBe(
      'clooks: project hook "security-audit" is shadowing a global hook with the same name.'
    );
  });

  it("returns warnings that can be injected as systemMessage", () => {
    const warnings = buildShadowWarnings("SessionStart", [hn("shared-hook")]);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("shared-hook");
    expect(warnings[0]).toContain("shadowing a global hook");
  });

  it("returns empty array on non-SessionStart events", () => {
    const warnings = buildShadowWarnings("PreToolUse", [hn("shared-hook")]);
    expect(warnings).toEqual([]);
  });

  it("returns empty array when shadows array is empty", () => {
    const warnings = buildShadowWarnings("SessionStart", []);
    expect(warnings).toEqual([]);
  });
});

// --- Home-only failure path ---

describe("executeHooks with home-only failure path", () => {
  it("creates failure state at hash-based path under homeRoot", async () => {
    const dir = makeTempDir();
    const homeRoot = dir;
    const projectRoot = join(dir, "some-project");
    mkdirSync(projectRoot, { recursive: true });

    const failurePath = getFailurePath(projectRoot, homeRoot, false);

    const hook = makeLoadedHook("fail-hook", {
      PreToolUse: () => { throw new Error("home-only boom"); },
    });
    const config = makeTestConfig({ "fail-hook": {} });

    const result = await executeHooks([hook], "PreToolUse", {}, config, failurePath);
    expect(result.lastResult?.result).toBe("block");

    // Verify failure state was written to the hash-based path
    const state = await readFailures(failurePath);
    expect(state[hn("fail-hook")]?.["PreToolUse"]?.consecutiveFailures).toBe(1);
    expect(state[hn("fail-hook")]?.["PreToolUse"]?.lastError).toContain("home-only boom");

    // Verify the path is under homeRoot/.clooks/failures/
    expect(failurePath).toContain(join(homeRoot, ".clooks/failures"));
    expect(failurePath).toMatch(/\.json$/);
  });
});
