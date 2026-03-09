import { describe, expect, test, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { validateHookExport, loadHook, loadAllHooks } from "./loader.js"
import type { HookLoadError } from "./loader.js"
import type { HookEntry, ClooksConfig } from "./config/types.js"
import type { HookName, Milliseconds } from "./types/branded.js"
const hn = (s: string) => s as HookName

let tempDir: string

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

function makeTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), "clooks-loader-test-"))
  return tempDir
}

function makeHookEntry(
  resolvedPath: string,
  config: Record<string, unknown> = {},
): HookEntry {
  return {
    resolvedPath,
    config,
    parallel: false,
  }
}

function makeConfig(
  hooks: Record<string, HookEntry>,
): ClooksConfig {
  const typedHooks = {} as Record<HookName, HookEntry>
  for (const [k, v] of Object.entries(hooks)) {
    typedHooks[k as HookName] = v
  }
  return {
    version: "1.0.0",
    global: {
      timeout: 10000 as Milliseconds,
      onError: "block",
      maxFailures: 3,
      maxFailuresMessage: "test message",
    },
    hooks: typedHooks,
    events: {},
  }
}

// --- validateHookExport ---

describe("validateHookExport", () => {
  test("returns the hook object for a valid module", () => {
    const mod = {
      hook: {
        meta: { name: "test-hook" },
        PreToolUse: () => ({ result: "skip" as const }),
      },
    }
    const result = validateHookExport(mod, "test.ts")
    // Identity check: validateHookExport returns the same object reference
    expect(result === (mod.hook as unknown)).toBe(true)
  })

  test("throws when module has no hook export", () => {
    const mod = { default: { meta: { name: "test" } } }
    expect(() => validateHookExport(mod, "test.ts")).toThrow(
      'does not export a "hook" named export',
    )
  })

  test("throws when hook is not an object", () => {
    const mod = { hook: "not-an-object" }
    expect(() => validateHookExport(mod, "test.ts")).toThrow(
      'does not export a "hook" named export',
    )
  })

  test("throws when hook.meta is missing", () => {
    const mod = { hook: { PreToolUse: () => {} } }
    expect(() => validateHookExport(mod, "test.ts")).toThrow(
      "hook.meta is missing or not an object",
    )
  })

  test("throws when hook.meta.name is missing", () => {
    const mod = { hook: { meta: { description: "no name" } } }
    expect(() => validateHookExport(mod, "test.ts")).toThrow(
      "hook.meta.name is missing or not a string",
    )
  })

  test("throws when hook.meta.name is empty string", () => {
    const mod = { hook: { meta: { name: "" } } }
    expect(() => validateHookExport(mod, "test.ts")).toThrow(
      "hook.meta.name is missing or not a string",
    )
  })

  test("throws when a non-meta property is not a function", () => {
    const mod = {
      hook: {
        meta: { name: "test" },
        PreToolUse: "not-a-function",
      },
    }
    expect(() => validateHookExport(mod, "test.ts")).toThrow(
      "hook.PreToolUse is not a function",
    )
  })

  test("accepts a hook with meta only and no handlers", () => {
    const mod = { hook: { meta: { name: "meta-only" } } }
    const result = validateHookExport(mod, "test.ts")
    expect(result.meta.name).toBe(hn("meta-only"))
  })
})

// --- loadHook ---

describe("loadHook", () => {
  test("loads a valid hook file and returns LoadedHook", async () => {
    const dir = makeTempDir()
    const hookFile = join(dir, "my-hook.ts")
    writeFileSync(
      hookFile,
      `export const hook = {
        meta: { name: "my-hook", config: { foo: "bar" } },
        PreToolUse(ctx, config) { return { result: "allow" } },
      }`,
    )
    const entry = makeHookEntry(hookFile)
    const result = await loadHook(hn("my-hook"), entry, dir)
    expect(result.name).toBe(hn("my-hook"))
    expect(result.hook.meta.name).toBe(hn("my-hook"))
    expect(result.config).toEqual({ foo: "bar" })
  })

  test("resolves relative resolvedPath against projectRoot", async () => {
    const dir = makeTempDir()
    mkdirSync(join(dir, "hooks"))
    const hookFile = join(dir, "hooks", "relative-hook.ts")
    writeFileSync(
      hookFile,
      `export const hook = {
        meta: { name: "relative-hook" },
        PreToolUse() { return { result: "skip" } },
      }`,
    )
    // Use relative path (as production config resolution produces)
    const entry = makeHookEntry("hooks/relative-hook.ts")
    const result = await loadHook(hn("relative-hook"), entry, dir)
    expect(result.name).toBe(hn("relative-hook"))
    expect(result.hook.meta.name).toBe(hn("relative-hook"))
  })

  test("shallow-merges meta.config defaults with entry config overrides", async () => {
    const dir = makeTempDir()
    const hookFile = join(dir, "merge-hook.ts")
    writeFileSync(
      hookFile,
      `export const hook = {
        meta: { name: "merge-hook", config: { keepMe: "default", overrideMe: "original" } },
        PreToolUse() { return { result: "skip" } },
      }`,
    )
    const entry = makeHookEntry(hookFile, { overrideMe: "overridden" })
    const result = await loadHook(hn("merge-hook"), entry, dir)
    expect(result.config).toEqual({
      keepMe: "default",
      overrideMe: "overridden",
    })
  })

  test("uses empty config when hook has no meta.config and entry has no overrides", async () => {
    const dir = makeTempDir()
    const hookFile = join(dir, "no-config-hook.ts")
    writeFileSync(
      hookFile,
      `export const hook = {
        meta: { name: "no-config" },
        PreToolUse() { return { result: "skip" } },
      }`,
    )
    const entry = makeHookEntry(hookFile)
    const result = await loadHook(hn("no-config"), entry, dir)
    expect(result.config).toEqual({})
  })

  test("throws when hook file does not exist", async () => {
    const dir = makeTempDir()
    const entry = makeHookEntry(join(dir, "nonexistent.ts"))
    expect(loadHook(hn("missing"), entry, dir)).rejects.toThrow(
      'failed to import hook "missing"',
    )
  })

  test("throws with npm bare specifier hint when hook uses bare import", async () => {
    const dir = makeTempDir()
    const hookFile = join(dir, "npm-hook.ts")
    // Use the imported value so Bun cannot tree-shake the import
    writeFileSync(
      hookFile,
      `import { z } from "zod-nonexistent-package-xyz"\nexport const hook = { meta: { name: "npm-hook", config: { schema: z } } }`,
    )
    const entry = makeHookEntry(hookFile)
    expect(loadHook(hn("npm-hook"), entry, dir)).rejects.toThrow("pre-bundling")
  })

  test("throws when hook file has invalid export", async () => {
    const dir = makeTempDir()
    const hookFile = join(dir, "bad-hook.ts")
    writeFileSync(hookFile, `export const hook = "not-an-object"`)
    const entry = makeHookEntry(hookFile)
    expect(loadHook(hn("bad-hook"), entry, dir)).rejects.toThrow(
      'does not export a "hook" named export',
    )
  })
})

// --- loadAllHooks ---

describe("loadAllHooks", () => {
  test("loads multiple hooks in parallel and returns all of them", async () => {
    const dir = makeTempDir()
    const hookA = join(dir, "hook-a.ts")
    const hookB = join(dir, "hook-b.ts")
    writeFileSync(
      hookA,
      `export const hook = { meta: { name: "hook-a" }, PreToolUse() { return { result: "skip" } } }`,
    )
    writeFileSync(
      hookB,
      `export const hook = { meta: { name: "hook-b" }, PostToolUse() { return { result: "skip" } } }`,
    )
    const config = makeConfig({
      "hook-a": makeHookEntry(hookA),
      "hook-b": makeHookEntry(hookB),
    })
    const { loaded, loadErrors } = await loadAllHooks(config, dir)
    expect(loaded).toHaveLength(2)
    expect(loaded.map((r) => r.name).sort()).toEqual([hn("hook-a"), hn("hook-b")])
    expect(loadErrors).toEqual([])
  })

  test("returns empty arrays when no hooks in config", async () => {
    const dir = makeTempDir()
    const config = makeConfig({})
    const { loaded, loadErrors } = await loadAllHooks(config, dir)
    expect(loaded).toEqual([])
    expect(loadErrors).toEqual([])
  })

  test("collects load errors without failing other hooks", async () => {
    const dir = makeTempDir()
    const hookA = join(dir, "hook-a.ts")
    writeFileSync(
      hookA,
      `export const hook = { meta: { name: "hook-a" }, PreToolUse() { return { result: "skip" } } }`,
    )
    const config = makeConfig({
      "hook-a": makeHookEntry(hookA),
      "hook-b": makeHookEntry(join(dir, "nonexistent.ts")),
    })
    const { loaded, loadErrors } = await loadAllHooks(config, dir)
    expect(loaded).toHaveLength(1)
    expect(loaded[0]!.name).toBe(hn("hook-a"))
    expect(loadErrors).toHaveLength(1)
    expect(loadErrors[0]!.name).toBe(hn("hook-b"))
    expect(loadErrors[0]!.error).toContain("failed to import")
  })
})
