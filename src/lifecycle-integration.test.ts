import { describe, test, expect, afterEach } from "bun:test"
import { mkdtempSync, rmSync, mkdirSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { executeHooks } from "./engine.js"
import type { LoadedHook } from "./loader.js"
import type { ClooksHook } from "./types/hook.js"
import type { ClooksConfig, HookEntry } from "./config/types.js"
import type { HookName } from "./types/branded.js"
import { hn, ms } from "./test-utils.js"
import { DEFAULT_MAX_FAILURES_MESSAGE } from "./config/constants.js"

function makeLoadedHook(
  name: string,
  handlers: Record<string, Function>,
): LoadedHook {
  const hookName = hn(name)
  const hook = {
    meta: { name: hookName },
    ...handlers,
  } as unknown as ClooksHook
  return {
    name: hookName,
    hook,
    config: {},
    hookPath: `/test/hooks/${name}.ts`,
    configPath: "/test/.clooks/clooks.yml",
  }
}

function makeTestConfig(
  hookOverrides: Record<string, {
    parallel?: boolean
    maxFailures?: number
    onError?: import("./config/types.js").ErrorMode
  }> = {},
  globalMaxFailures = 3,
  globalOnError: import("./config/types.js").ErrorMode = "block",
): ClooksConfig {
  const hooks = {} as Record<HookName, HookEntry>
  for (const [name, overrides] of Object.entries(hookOverrides)) {
    hooks[hn(name)] = {
      resolvedPath: `.clooks/hooks/${name}.ts`,
      config: {},
      parallel: false,
      origin: "project",
      ...overrides,
    }
  }
  return {
    version: "1.0.0",
    global: {
      timeout: ms(5000),
      onError: globalOnError,
      maxFailures: globalMaxFailures,
      maxFailuresMessage: DEFAULT_MAX_FAILURES_MESSAGE,
    },
    hooks,
    events: {},
  }
}

let tempDir: string

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

function makeTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), "clooks-lifecycle-int-"))
  mkdirSync(join(tempDir, ".clooks"), { recursive: true })
  return tempDir
}

function fp(dir: string): string {
  return join(dir, ".clooks/.failures")
}

describe("lifecycle integration", () => {
  test("beforeHook blocks — handler and afterHook do not run", async () => {
    let handlerRan = false
    let afterHookRan = false

    const hook = makeLoadedHook("gate-hook", {
      beforeHook(event: any) {
        event.respond({ result: "block", reason: "gated" })
      },
      PreToolUse() {
        handlerRan = true
        return { result: "allow" }
      },
      afterHook() {
        afterHookRan = true
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({ "gate-hook": {} })
    const { lastResult } = await executeHooks(
      [hook], "PreToolUse",
      { event: "PreToolUse", toolName: "Bash", toolInput: {} },
      config, fp(dir),
    )

    expect(lastResult?.result).toBe("block")
    expect(lastResult?.reason).toContain("gated")
    expect(handlerRan).toBe(false)
    expect(afterHookRan).toBe(false)
  })

  test("afterHook overrides result", async () => {
    const hook = makeLoadedHook("override-hook", {
      PreToolUse() {
        return { result: "block", reason: "original" }
      },
      afterHook(event: any) {
        if (event.type === "PreToolUse") {
          event.respond({ result: "allow" })
        }
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({ "override-hook": {} })
    const { lastResult } = await executeHooks(
      [hook], "PreToolUse",
      { event: "PreToolUse", toolName: "Bash", toolInput: {} },
      config, fp(dir),
    )

    expect(lastResult?.result).toBe("allow")
  })

  test("lifecycle timeout shared across phases", async () => {
    const hook = makeLoadedHook("slow-hook", {
      async beforeHook() {
        await new Promise(r => setTimeout(r, 60))
      },
      PreToolUse() {
        return { result: "allow" }
      },
      async afterHook() {
        await new Promise(r => setTimeout(r, 60))
      },
    })

    const dir = makeTempDir()
    // Use a config with hook-level timeout of 50ms
    const config = makeTestConfig({ "slow-hook": {} })
    // Override global timeout to 50ms — beforeHook alone (60ms) exceeds budget
    config.global.timeout = ms(50)

    // The beforeHook (60ms) alone exceeds the 50ms timeout, making this deterministic
    const { lastResult } = await executeHooks(
      [hook], "PreToolUse",
      { event: "PreToolUse", toolName: "Bash", toolInput: {} },
      config, fp(dir),
    )

    // Should block due to timeout error (onError: "block")
    expect(lastResult?.result).toBe("block")
    expect(lastResult?.reason).toContain("timed out")
  })

  test("afterHook throws — handler result is lost, error handled by onError", async () => {
    let handlerRan = false

    const hook = makeLoadedHook("after-throw-hook", {
      PreToolUse() {
        handlerRan = true
        return { result: "allow" }
      },
      afterHook() {
        throw new Error("afterHook exploded")
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({ "after-throw-hook": {} })
    const failurePath = fp(dir)
    const { lastResult } = await executeHooks(
      [hook], "PreToolUse",
      { event: "PreToolUse", toolName: "Bash", toolInput: {} },
      config, failurePath,
    )

    // Handler ran but its result was lost due to afterHook throw
    expect(handlerRan).toBe(true)
    // onError: "block" → block result with error message
    expect(lastResult?.result).toBe("block")
    expect(lastResult?.reason).toContain("afterHook exploded")
  })

  test("handler throws — afterHook does not run", async () => {
    let afterHookRan = false

    const hook = makeLoadedHook("throw-hook", {
      PreToolUse() {
        throw new Error("handler boom")
      },
      afterHook() {
        afterHookRan = true
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({ "throw-hook": {} }, 3, "continue")
    await executeHooks(
      [hook], "PreToolUse",
      { event: "PreToolUse", toolName: "Bash", toolInput: {} },
      config, fp(dir),
    )

    expect(afterHookRan).toBe(false)
  })

  test("no lifecycle methods — same behavior as before", async () => {
    const hook = makeLoadedHook("plain-hook", {
      PreToolUse() {
        return { result: "allow" }
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({ "plain-hook": {} })
    const { lastResult } = await executeHooks(
      [hook], "PreToolUse",
      { event: "PreToolUse", toolName: "Bash", toolInput: {} },
      config, fp(dir),
    )

    expect(lastResult?.result).toBe("allow")
  })

  test("respond() called twice throws — handled by onError", async () => {
    const hook = makeLoadedHook("double-respond", {
      beforeHook(event: any) {
        event.respond({ result: "block", reason: "first" })
        event.respond({ result: "block", reason: "second" })
      },
      PreToolUse() {
        return { result: "allow" }
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({ "double-respond": {} })
    const { lastResult } = await executeHooks(
      [hook], "PreToolUse",
      { event: "PreToolUse", toolName: "Bash", toolInput: {} },
      config, fp(dir),
    )

    // Double respond throws, caught by onError: "block" -> block result
    expect(lastResult?.result).toBe("block")
    expect(lastResult?.reason).toContain("can only be called once")
  })

  test("parallel lifecycle — each hook is an atomic unit", async () => {
    let hookBHandlerRan = false

    const hookA = makeLoadedHook("block-hook", {
      beforeHook(event: any) {
        event.respond({ result: "block", reason: "blocked" })
      },
      PreToolUse() {
        return { result: "allow" }
      },
    })

    const hookB = makeLoadedHook("pass-hook", {
      PreToolUse() {
        hookBHandlerRan = true
        return { result: "skip" }
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({
      "block-hook": { parallel: true },
      "pass-hook": { parallel: true },
    })

    const { lastResult } = await executeHooks(
      [hookA, hookB], "PreToolUse",
      { event: "PreToolUse", toolName: "Bash", toolInput: {} },
      config, fp(dir),
    )

    // hookA's beforeHook blocks, and the pipeline should end up with a block
    expect(lastResult?.result).toBe("block")
    // hookB's handler should have run (parallel hooks run independently)
    expect(hookBHandlerRan).toBe(true)
  })

  test("circuit breaker shared with lifecycle failures", async () => {
    const hook = makeLoadedHook("crashy-hook", {
      beforeHook() {
        throw new Error("beforeHook crash")
      },
      PreToolUse() {
        return { result: "allow" }
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({ "crashy-hook": {} }, 3)

    // Run 3 times to hit the threshold
    // First 2 should block (under threshold)
    for (let i = 0; i < 2; i++) {
      const { lastResult } = await executeHooks(
        [hook], "PreToolUse",
        { event: "PreToolUse", toolName: "Bash", toolInput: {} },
        config, fp(dir),
      )
      expect(lastResult?.result).toBe("block")
      expect(lastResult?.reason).toContain("beforeHook crash")
    }

    // Third invocation — at threshold, should degrade (no block, degraded message)
    const { lastResult, degradedMessages } = await executeHooks(
      [hook], "PreToolUse",
      { event: "PreToolUse", toolName: "Bash", toolInput: {} },
      config, fp(dir),
    )
    expect(lastResult).toBeUndefined()
    expect(degradedMessages.length).toBeGreaterThan(0)
  })

  test("beforeHook blocks with debug logging", async () => {
    const hook = makeLoadedHook("debug-gate", {
      beforeHook(event: any) {
        event.respond({ result: "block", reason: "debug-blocked" })
      },
      PreToolUse() {
        return { result: "allow" }
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({ "debug-gate": {} })

    // Enable debug mode
    const origDebug = process.env.CLOOKS_DEBUG
    process.env.CLOOKS_DEBUG = "true"
    try {
      const { debugMessages } = await executeHooks(
        [hook], "PreToolUse",
        { event: "PreToolUse", toolName: "Bash", toolInput: {} },
        config, fp(dir),
      )
      expect(debugMessages.some(m => m.includes("beforeHook: blocked"))).toBe(true)
    } finally {
      if (origDebug === undefined) {
        delete process.env.CLOOKS_DEBUG
      } else {
        process.env.CLOOKS_DEBUG = origDebug
      }
    }
  })

  test("afterHook override with debug logging", async () => {
    const hook = makeLoadedHook("debug-override", {
      PreToolUse() {
        return { result: "block", reason: "original" }
      },
      afterHook(event: any) {
        event.respond({ result: "allow" })
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({ "debug-override": {} })

    const origDebug = process.env.CLOOKS_DEBUG
    process.env.CLOOKS_DEBUG = "true"
    try {
      const { debugMessages } = await executeHooks(
        [hook], "PreToolUse",
        { event: "PreToolUse", toolName: "Bash", toolInput: {} },
        config, fp(dir),
      )
      expect(debugMessages.some(m => m.includes("afterHook: overridden result"))).toBe(true)
    } finally {
      if (origDebug === undefined) {
        delete process.env.CLOOKS_DEBUG
      } else {
        process.env.CLOOKS_DEBUG = origDebug
      }
    }
  })

  test("beforeHook does not block when respond() is not called", async () => {
    let handlerRan = false

    const hook = makeLoadedHook("noop-before", {
      beforeHook() {
        // Does nothing — does not call respond()
      },
      PreToolUse() {
        handlerRan = true
        return { result: "allow" }
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({ "noop-before": {} })
    const { lastResult } = await executeHooks(
      [hook], "PreToolUse",
      { event: "PreToolUse", toolName: "Bash", toolInput: {} },
      config, fp(dir),
    )

    expect(lastResult?.result).toBe("allow")
    expect(handlerRan).toBe(true)
  })

  test("afterHook does not override when respond() is not called", async () => {
    const hook = makeLoadedHook("noop-after", {
      PreToolUse() {
        return { result: "allow" }
      },
      afterHook() {
        // Does nothing — does not call respond()
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({ "noop-after": {} })
    const { lastResult } = await executeHooks(
      [hook], "PreToolUse",
      { event: "PreToolUse", toolName: "Bash", toolInput: {} },
      config, fp(dir),
    )

    expect(lastResult?.result).toBe("allow")
  })

  test("sequential pipeline: first hook beforeHook blocks, second hook does not run", async () => {
    let secondHandlerRan = false

    const hookA = makeLoadedHook("blocker", {
      beforeHook(event: any) {
        event.respond({ result: "block", reason: "first blocks" })
      },
      PreToolUse() {
        return { result: "allow" }
      },
    })

    const hookB = makeLoadedHook("follower", {
      PreToolUse() {
        secondHandlerRan = true
        return { result: "allow" }
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({ "blocker": {}, "follower": {} })
    const { lastResult } = await executeHooks(
      [hookA, hookB], "PreToolUse",
      { event: "PreToolUse", toolName: "Bash", toolInput: {} },
      config, fp(dir),
    )

    expect(lastResult?.result).toBe("block")
    expect(lastResult?.reason).toContain("first blocks")
    // Second hook should NOT run because pipeline was blocked
    expect(secondHandlerRan).toBe(false)
  })

  test("beforeHook receives correct event context", async () => {
    let receivedEvent: any = null

    const hook = makeLoadedHook("inspect-before", {
      beforeHook(event: any) {
        receivedEvent = event
      },
      PreToolUse() {
        return { result: "allow" }
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({ "inspect-before": {} })
    await executeHooks(
      [hook], "PreToolUse",
      { event: "PreToolUse", toolName: "Bash", toolInput: { command: "ls" } },
      config, fp(dir),
    )

    expect(receivedEvent).not.toBeNull()
    expect(receivedEvent.type).toBe("PreToolUse")
    expect(receivedEvent.meta).toBeDefined()
    expect(receivedEvent.meta.hookName).toBe("inspect-before")
    expect(typeof receivedEvent.respond).toBe("function")
  })

  test("afterHook receives handler result", async () => {
    let receivedEvent: any = null

    const hook = makeLoadedHook("inspect-after", {
      PreToolUse() {
        return { result: "allow" }
      },
      afterHook(event: any) {
        receivedEvent = event
      },
    })

    const dir = makeTempDir()
    const config = makeTestConfig({ "inspect-after": {} })
    await executeHooks(
      [hook], "PreToolUse",
      { event: "PreToolUse", toolName: "Bash", toolInput: {} },
      config, fp(dir),
    )

    expect(receivedEvent).not.toBeNull()
    expect(receivedEvent.type).toBe("PreToolUse")
    expect(receivedEvent.handlerResult).toEqual({ result: "allow" })
    expect(receivedEvent.meta).toBeDefined()
    expect(typeof receivedEvent.respond).toBe("function")
  })
})
