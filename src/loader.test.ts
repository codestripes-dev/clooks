import { describe, expect, test, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { validateHookExport, loadHook, loadAllHooks } from "./loader.js"
import type { HookLoadError } from "./loader.js"
import type { HookEntry, ClooksConfig } from "./config/schema.js"
import type { HookName } from "./types/branded.js"
import { hn, ms } from "./test-utils.js"

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
    origin: "project",
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
      timeout: ms(10000),
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

  test("rejects unknown property with helpful error", () => {
    expect(() =>
      validateHookExport(
        { hook: { meta: { name: "x" }, beforHook: () => {} } },
        "test.ts",
      ),
    ).toThrow(/unknown property "beforHook"/)
  })

  test("accepts beforeHook as a function", () => {
    const result = validateHookExport(
      { hook: { meta: { name: "x" }, beforeHook: () => {} } },
      "test.ts",
    )
    expect(result.meta.name).toBe("x")
  })

  test("accepts afterHook as a function", () => {
    const result = validateHookExport(
      { hook: { meta: { name: "x" }, afterHook: () => {} } },
      "test.ts",
    )
    expect(result.meta.name).toBe("x")
  })

  test("rejects beforeHook as non-function", () => {
    expect(() =>
      validateHookExport(
        { hook: { meta: { name: "x" }, beforeHook: "not-a-fn" } },
        "test.ts",
      ),
    ).toThrow("not a function")
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
    expect(result.hookPath).toBe(hookFile)
    expect(result.configPath).toBe(join(dir, ".clooks", "clooks.yml"))
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
    expect(result.hookPath).toBe(hookFile)
    expect(result.configPath).toBe(join(dir, ".clooks", "clooks.yml"))
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

  test("throws when meta.name does not match config key", async () => {
    const dir = makeTempDir()
    const hookFile = join(dir, "mismatch.ts")
    writeFileSync(
      hookFile,
      `export const hook = { meta: { name: "actual-name" }, PreToolUse() { return { result: "skip" } } }`,
    )
    const entry = makeHookEntry(hookFile)
    expect(loadHook(hn("config-key"), entry, dir)).rejects.toThrow(
      'declares meta.name "actual-name" but is registered as "config-key"',
    )
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

// --- Origin-aware loading (M2) ---

describe("loadHook with home origin", () => {
  test("loads a hook from home directory when origin is 'home' using relative path", async () => {
    const homeDir = makeTempDir()
    const projectDir = mkdtempSync(join(tmpdir(), "clooks-loader-project-"))
    mkdirSync(join(homeDir, ".clooks", "hooks"), { recursive: true })
    writeFileSync(
      join(homeDir, ".clooks", "hooks", "security-audit.ts"),
      `export const hook = {
        meta: { name: "security-audit" },
        PreToolUse() { return { result: "allow" } },
      }`,
    )
    // Use RELATIVE resolvedPath — this is what resolveHookPath() actually produces
    const entry: HookEntry = {
      resolvedPath: ".clooks/hooks/security-audit.ts",
      config: {},
      parallel: false,
      origin: "home",
    }
    const result = await loadHook(hn("security-audit"), entry, projectDir, homeDir)
    expect(result.name).toBe(hn("security-audit"))
    expect(result.hook.meta.name).toBe(hn("security-audit"))
    expect(result.hookPath).toBe(join(homeDir, ".clooks", "hooks", "security-audit.ts"))
    expect(result.configPath).toBe(join(homeDir, ".clooks", "clooks.yml"))

    rmSync(projectDir, { recursive: true, force: true })
  })

  test("wrong homeRoot causes home hook load to fail", async () => {
    const homeDir = makeTempDir()
    const projectDir = mkdtempSync(join(tmpdir(), "clooks-loader-project-"))
    const wrongHome = mkdtempSync(join(tmpdir(), "clooks-loader-wrong-home-"))
    mkdirSync(join(homeDir, ".clooks", "hooks"), { recursive: true })
    writeFileSync(
      join(homeDir, ".clooks", "hooks", "security-audit.ts"),
      `export const hook = {
        meta: { name: "security-audit" },
        PreToolUse() { return { result: "allow" } },
      }`,
    )
    // Relative path resolves against wrongHome, which has no such file
    const entry: HookEntry = {
      resolvedPath: ".clooks/hooks/security-audit.ts",
      config: {},
      parallel: false,
      origin: "home",
    }
    await expect(loadHook(hn("security-audit"), entry, projectDir, wrongHome)).rejects.toThrow(
      'failed to import hook "security-audit"',
    )

    rmSync(projectDir, { recursive: true, force: true })
    rmSync(wrongHome, { recursive: true, force: true })
  })

  test("loads project hook from projectRoot when origin is 'project'", async () => {
    const projectDir = makeTempDir()
    const homeDir = mkdtempSync(join(tmpdir(), "clooks-loader-home-"))
    mkdirSync(join(projectDir, ".clooks", "hooks"), { recursive: true })
    writeFileSync(
      join(projectDir, ".clooks", "hooks", "lint-guard.ts"),
      `export const hook = {
        meta: { name: "lint-guard" },
        PreToolUse() { return { result: "allow" } },
      }`,
    )
    const entry: HookEntry = {
      resolvedPath: ".clooks/hooks/lint-guard.ts",
      config: {},
      parallel: false,
      origin: "project",
    }
    const result = await loadHook(hn("lint-guard"), entry, projectDir, homeDir)
    expect(result.name).toBe(hn("lint-guard"))
    expect(result.hook.meta.name).toBe(hn("lint-guard"))
    expect(result.hookPath).toBe(join(projectDir, ".clooks", "hooks", "lint-guard.ts"))
    expect(result.configPath).toBe(join(projectDir, ".clooks", "clooks.yml"))

    rmSync(homeDir, { recursive: true, force: true })
  })
})

describe("loadAllHooks with mixed origins", () => {
  test("loads both home and project hooks with correct base paths using relative paths", async () => {
    const homeDir = makeTempDir()
    const projectDir = mkdtempSync(join(tmpdir(), "clooks-loader-project-"))

    // Create home hook
    mkdirSync(join(homeDir, ".clooks", "hooks"), { recursive: true })
    writeFileSync(
      join(homeDir, ".clooks", "hooks", "security-audit.ts"),
      `export const hook = {
        meta: { name: "security-audit" },
        PreToolUse() { return { result: "allow" } },
      }`,
    )

    // Create project hook
    mkdirSync(join(projectDir, ".clooks", "hooks"), { recursive: true })
    writeFileSync(
      join(projectDir, ".clooks", "hooks", "lint-guard.ts"),
      `export const hook = {
        meta: { name: "lint-guard" },
        PreToolUse() { return { result: "skip" } },
      }`,
    )

    // Both use RELATIVE resolvedPath — loadHook resolves against the correct base per origin
    const config = makeConfig({
      "security-audit": {
        resolvedPath: ".clooks/hooks/security-audit.ts",
        config: {},
        parallel: false,
        origin: "home" as const,
      },
      "lint-guard": {
        resolvedPath: ".clooks/hooks/lint-guard.ts",
        config: {},
        parallel: false,
        origin: "project" as const,
      },
    })

    const { loaded, loadErrors } = await loadAllHooks(config, projectDir, homeDir)
    expect(loaded).toHaveLength(2)
    expect(loaded.map((r) => r.name).sort()).toEqual([hn("lint-guard"), hn("security-audit")])
    expect(loadErrors).toEqual([])

    rmSync(projectDir, { recursive: true, force: true })
  })
})

// --- Alias loading (M3) ---

describe("loadHook with aliases", () => {
  function makeAliasEntry(
    resolvedPath: string,
    uses: string,
    config: Record<string, unknown> = {},
  ): HookEntry {
    return {
      resolvedPath,
      uses,
      config,
      parallel: false,
      origin: "project",
    }
  }

  test("alias with hook-name uses loads successfully when meta.name matches uses target", async () => {
    const dir = makeTempDir()
    const hookFile = join(dir, "real-hook.ts")
    writeFileSync(
      hookFile,
      `export const hook = {
        meta: { name: "real-hook" },
        PreToolUse() { return { result: "allow" } },
      }`,
    )
    const entry = makeAliasEntry(hookFile, "real-hook")
    const result = await loadHook(hn("my-alias"), entry, dir)
    expect(result.name).toBe(hn("my-alias"))
    expect(result.hook.meta.name).toBe(hn("real-hook"))
    expect(result.usesTarget).toBe("real-hook")
  })

  test("alias meta.name mismatch throws with context mentioning alias and uses target", async () => {
    const dir = makeTempDir()
    const hookFile = join(dir, "wrong-name.ts")
    writeFileSync(
      hookFile,
      `export const hook = {
        meta: { name: "wrong-name" },
        PreToolUse() { return { result: "allow" } },
      }`,
    )
    const entry = makeAliasEntry(hookFile, "expected-name")
    await expect(loadHook(hn("my-alias"), entry, dir)).rejects.toThrow(
      /declares meta\.name "wrong-name".*uses: "expected-name".*alias "my-alias"/,
    )
  })

  test("path-like uses skips meta.name check", async () => {
    const dir = makeTempDir()
    mkdirSync(join(dir, "custom"), { recursive: true })
    const hookFile = join(dir, "custom", "path.ts")
    writeFileSync(
      hookFile,
      `export const hook = {
        meta: { name: "anything-goes" },
        PreToolUse() { return { result: "allow" } },
      }`,
    )
    const entry = makeAliasEntry(hookFile, "./custom/path.ts")
    const result = await loadHook(hn("my-alias"), entry, dir)
    expect(result.name).toBe(hn("my-alias"))
    expect(result.hook.meta.name).toBe(hn("anything-goes"))
    expect(result.usesTarget).toBe("./custom/path.ts")
  })

  test("regular hook (no uses) still validates meta.name against YAML key", async () => {
    const dir = makeTempDir()
    const hookFile = join(dir, "mismatch.ts")
    writeFileSync(
      hookFile,
      `export const hook = {
        meta: { name: "actual-name" },
        PreToolUse() { return { result: "skip" } },
      }`,
    )
    const entry = makeHookEntry(hookFile)
    await expect(loadHook(hn("config-key"), entry, dir)).rejects.toThrow(
      'declares meta.name "actual-name" but is registered as "config-key" in clooks.yml',
    )
  })

  test("usesTarget is undefined for non-alias hooks", async () => {
    const dir = makeTempDir()
    const hookFile = join(dir, "regular.ts")
    writeFileSync(
      hookFile,
      `export const hook = {
        meta: { name: "regular" },
        PreToolUse() { return { result: "skip" } },
      }`,
    )
    const entry = makeHookEntry(hookFile)
    const result = await loadHook(hn("regular"), entry, dir)
    expect(result.usesTarget).toBeUndefined()
  })

  test("usesTarget is populated for alias hooks", async () => {
    const dir = makeTempDir()
    const hookFile = join(dir, "target.ts")
    writeFileSync(
      hookFile,
      `export const hook = {
        meta: { name: "target" },
        PreToolUse() { return { result: "skip" } },
      }`,
    )
    const entry = makeAliasEntry(hookFile, "target")
    const result = await loadHook(hn("alias-name"), entry, dir)
    expect(result.usesTarget).toBe("target")
    expect(result.name).toBe(hn("alias-name"))
  })

  test("load error includes uses context when entry has uses", async () => {
    const dir = makeTempDir()
    const entry = makeAliasEntry(join(dir, "nonexistent.ts"), "some-hook")
    await expect(loadHook(hn("my-alias"), entry, dir)).rejects.toThrow(
      /failed to import hook "my-alias" \(uses: "some-hook"\)/,
    )
  })
})
