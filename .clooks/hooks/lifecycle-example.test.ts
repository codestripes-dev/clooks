import { describe, test, expect } from "bun:test"
import { hook } from "./lifecycle-example.js"
import type { BeforeHookEvent, AfterHookEvent, HookEventMeta } from "../../src/types/lifecycle.js"
import type { BlockResult } from "../../src/types/results.js"

function makeMeta(overrides?: Partial<HookEventMeta>): HookEventMeta {
  return {
    gitRoot: "/repo",
    gitBranch: "main",
    platform: "linux",
    hookName: "lifecycle-example",
    hookPath: "/repo/.clooks/hooks/lifecycle-example.ts",
    timestamp: new Date().toISOString(),
    clooksVersion: "0.0.1",
    configPath: "/repo/.clooks/clooks.yml",
    ...overrides,
  }
}

describe("lifecycle-example", () => {
  test("beforeHook blocks Bash on production branch", () => {
    let blocked: BlockResult | undefined

    const event = {
      type: "PreToolUse" as const,
      input: { toolName: "Bash", toolInput: {}, event: "PreToolUse" },
      meta: makeMeta({ gitBranch: "production" }),
      respond(result: BlockResult) { blocked = result },
    } as BeforeHookEvent

    hook.beforeHook!(event, {})
    expect(blocked).toBeDefined()
    expect(blocked!.result).toBe("block")
    expect(blocked!.reason).toContain("production")
  })

  test("beforeHook allows Bash on non-production branches", () => {
    let blocked: BlockResult | undefined

    const event = {
      type: "PreToolUse" as const,
      input: { toolName: "Bash", toolInput: {}, event: "PreToolUse" },
      meta: makeMeta({ gitBranch: "main" }),
      respond(result: BlockResult) { blocked = result },
    } as BeforeHookEvent

    hook.beforeHook!(event, {})
    expect(blocked).toBeUndefined()
  })

  test("beforeHook allows non-Bash tools on production branch", () => {
    let blocked: BlockResult | undefined

    const event = {
      type: "PreToolUse" as const,
      input: { toolName: "Read", toolInput: {}, event: "PreToolUse" },
      meta: makeMeta({ gitBranch: "production" }),
      respond(result: BlockResult) { blocked = result },
    } as BeforeHookEvent

    hook.beforeHook!(event, {})
    expect(blocked).toBeUndefined()
  })

  test("afterHook computes positive duration", () => {
    // Simulate beforeHook setting start time
    const beforeEvent = {
      type: "PreToolUse" as const,
      input: { toolName: "Bash", toolInput: {}, event: "PreToolUse" },
      meta: makeMeta(),
      respond() {},
    } as BeforeHookEvent

    hook.beforeHook!(beforeEvent, {})

    // Small delay to ensure measurable duration
    const afterEvent = {
      type: "PreToolUse" as const,
      input: { toolName: "Bash", toolInput: {}, event: "PreToolUse" },
      handlerResult: { result: "allow" },
      meta: makeMeta(),
      respond() {},
    } as AfterHookEvent

    // Capture console.log output
    const logs: string[] = []
    const origLog = console.log
    console.log = (...args: unknown[]) => { logs.push(args.join(" ")) }
    try {
      hook.afterHook!(afterEvent, {})
    } finally {
      console.log = origLog
    }

    expect(logs.length).toBe(1)
    expect(logs[0]).toContain("[lifecycle-example]")
    expect(logs[0]).toContain("ms")
  })

  test("handler returns allow", () => {
    const result = hook.PreToolUse!({ toolName: "Bash", toolInput: {} } as any, {})
    expect(result).toEqual({ result: "allow" })
  })
})
