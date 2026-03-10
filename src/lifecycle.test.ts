import { describe, test, expect } from "bun:test"
import {
  createRespondCallback,
  buildBeforeHookEvent,
  buildAfterHookEvent,
  LifecycleMetaCache,
} from "./lifecycle.js"
import type { HookEventMeta } from "./types/lifecycle.js"
import type { HookName } from "./types/branded.js"
import type { LoadedHook } from "./loader.js"
import { VERSION } from "./version.js"

const dummyMeta: HookEventMeta = {
  gitRoot: "/repo",
  gitBranch: "main",
  platform: "linux",
  hookName: "test-hook",
  hookPath: "/repo/.clooks/hooks/test-hook.ts",
  timestamp: "2026-01-01T00:00:00.000Z",
  clooksVersion: "0.0.1",
  configPath: "/repo/.clooks/clooks.yml",
}

function makeDummyLoadedHook(name: string): LoadedHook {
  return {
    name: name as HookName,
    hook: { meta: { name } } as any,
    config: {},
    hookPath: `/repo/.clooks/hooks/${name}.ts`,
    configPath: "/repo/.clooks/clooks.yml",
  }
}

describe("createRespondCallback", () => {
  test("stores result on first call", () => {
    const { respond, getResponse } = createRespondCallback<{ result: string }>()
    respond({ result: "block" })
    expect(getResponse()).toEqual({ result: "block" })
  })

  test("returns undefined if never called", () => {
    const { getResponse } = createRespondCallback()
    expect(getResponse()).toBeUndefined()
  })

  test("throws on second call", () => {
    const { respond } = createRespondCallback<{ result: string }>()
    respond({ result: "block" })
    expect(() => respond({ result: "allow" })).toThrow("can only be called once")
  })

  test("throws on undefined result", () => {
    const { respond } = createRespondCallback()
    expect(() => respond(undefined as any)).toThrow("non-null result")
  })

  test("throws on null result", () => {
    const { respond } = createRespondCallback()
    expect(() => respond(null as any)).toThrow("non-null result")
  })
})

describe("buildBeforeHookEvent", () => {
  test("returns event with correct fields", () => {
    const respond = () => {}
    const event = buildBeforeHookEvent(
      "PreToolUse",
      { toolName: "Bash" },
      dummyMeta,
      respond,
    )
    expect(event.type).toBe("PreToolUse")
    expect((event as any).input).toEqual({ toolName: "Bash" })
    expect(event.meta).toBe(dummyMeta)
    expect(event.respond).toBe(respond)
  })
})

describe("buildAfterHookEvent", () => {
  test("returns event with correct fields", () => {
    const respond = () => {}
    const event = buildAfterHookEvent(
      "PreToolUse",
      { toolName: "Bash" },
      { result: "allow" },
      dummyMeta,
      respond,
    )
    expect(event.type).toBe("PreToolUse")
    expect((event as any).input).toEqual({ toolName: "Bash" })
    expect((event as any).handlerResult).toEqual({ result: "allow" })
    expect(event.meta).toBe(dummyMeta)
    expect((event as any).respond).toBe(respond)
  })
})

describe("LifecycleMetaCache", () => {
  test("buildMeta returns correct HookEventMeta", async () => {
    const cache = new LifecycleMetaCache("2026-03-10T00:00:00.000Z")
    const hook = makeDummyLoadedHook("test-hook")
    const meta = await cache.buildMeta(hook)

    expect(meta.hookName).toBe("test-hook")
    expect(meta.hookPath).toBe("/repo/.clooks/hooks/test-hook.ts")
    expect(meta.configPath).toBe("/repo/.clooks/clooks.yml")
    expect(meta.timestamp).toBe("2026-03-10T00:00:00.000Z")
    expect(meta.clooksVersion).toBe(VERSION)
    expect(["darwin", "linux"]).toContain(meta.platform)
    // gitRoot and gitBranch are strings in a git repo
    expect(meta.gitRoot).toBeTypeOf("string")
    expect(meta.gitBranch).toBeTypeOf("string")
  })

  test("caches git values across multiple buildMeta calls", async () => {
    const cache = new LifecycleMetaCache()
    const hook1 = makeDummyLoadedHook("hook-1")
    const hook2 = makeDummyLoadedHook("hook-2")
    const meta1 = await cache.buildMeta(hook1)
    const meta2 = await cache.buildMeta(hook2)

    expect(meta1.gitRoot).toBe(meta2.gitRoot)
    expect(meta1.gitBranch).toBe(meta2.gitBranch)
    // But hook-specific fields differ
    expect(meta1.hookName).toBe("hook-1")
    expect(meta2.hookName).toBe("hook-2")
  })
})
