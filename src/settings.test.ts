import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import {
  registerClooks,
  unregisterClooks,
  isClooksRegistered,
  CLOOKS_ENTRYPOINT_PATH,
} from "./settings.js"

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "clooks-settings-test-"))
})

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

function settingsPath(): string {
  return join(tempDir, ".claude", "settings.json")
}

function writeSettings(obj: unknown): void {
  mkdirSync(join(tempDir, ".claude"), { recursive: true })
  writeFileSync(settingsPath(), JSON.stringify(obj, null, 2) + "\n")
}

function readSettings(): Record<string, unknown> {
  return JSON.parse(readFileSync(settingsPath(), "utf-8"))
}

describe("settings", () => {
  test("fresh registration into non-existent file creates file with 18 events", () => {
    const result = registerClooks(tempDir)

    expect(result.added).toHaveLength(18)
    expect(result.skipped).toHaveLength(0)
    expect(result.updated).toHaveLength(0)
    expect(result.created).toBe(true)

    const settings = readSettings()
    const hooks = settings.hooks as Record<string, unknown[]>
    expect(Object.keys(hooks)).toHaveLength(18)

    // Every event should have exactly one matcher group with the canonical path
    for (const matchers of Object.values(hooks)) {
      expect(matchers).toHaveLength(1)
      const mg = matchers[0] as Record<string, unknown>
      const hookEntries = mg.hooks as Record<string, string>[]
      expect(hookEntries).toHaveLength(1)
      expect(hookEntries[0].type).toBe("command")
      expect(hookEntries[0].command).toBe(CLOOKS_ENTRYPOINT_PATH)
    }
  })

  test("registration preserves existing settings", () => {
    writeSettings({
      permissions: { allow: ["Bash(git:*)"], deny: [] },
      env: { FOO: "bar" },
      someOtherKey: "preserved",
    })

    registerClooks(tempDir)
    const settings = readSettings()

    expect(settings.permissions).toEqual({ allow: ["Bash(git:*)"], deny: [] })
    expect(settings.env).toEqual({ FOO: "bar" })
    expect(settings.someOtherKey).toBe("preserved")
    expect(settings.hooks).toBeDefined()
  })

  test("merging with existing hooks appends without clobbering", () => {
    writeSettings({
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "existing-hook.sh" }],
          },
        ],
      },
    })

    registerClooks(tempDir)
    const settings = readSettings()
    const hooks = settings.hooks as Record<string, unknown[]>

    // PreToolUse should have 2 matcher groups: existing + clooks
    expect(hooks.PreToolUse).toHaveLength(2)

    // First should be the existing one, untouched
    const existing = hooks.PreToolUse[0] as Record<string, unknown>
    expect(existing.matcher).toBe("Bash")
    const existingHooks = existing.hooks as Record<string, string>[]
    expect(existingHooks[0].command).toBe("existing-hook.sh")

    // Second should be Clooks
    const clooks = hooks.PreToolUse[1] as Record<string, unknown>
    const clooksHooks = clooks.hooks as Record<string, string>[]
    expect(clooksHooks[0].command).toBe(CLOOKS_ENTRYPOINT_PATH)
  })

  test("idempotent — second run adds 0, skips 18, file unchanged", () => {
    registerClooks(tempDir)
    const firstContent = readFileSync(settingsPath(), "utf-8")

    const result = registerClooks(tempDir)

    expect(result.added).toHaveLength(0)
    expect(result.skipped).toHaveLength(18)
    expect(result.updated).toHaveLength(0)
    expect(result.created).toBe(false)

    // File should be byte-identical (not rewritten)
    const secondContent = readFileSync(settingsPath(), "utf-8")
    expect(secondContent).toBe(firstContent)
  })

  test("unregister removes only Clooks hooks, preserves others", () => {
    writeSettings({
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "existing-hook.sh" }],
          },
          {
            hooks: [{ type: "command", command: CLOOKS_ENTRYPOINT_PATH }],
          },
        ],
        SessionStart: [
          {
            hooks: [{ type: "command", command: CLOOKS_ENTRYPOINT_PATH }],
          },
        ],
      },
      permissions: { allow: [] },
    })

    const result = unregisterClooks(tempDir)

    expect(result.removed).toHaveLength(2)
    expect(result.removed).toContain("PreToolUse")
    expect(result.removed).toContain("SessionStart")

    const settings = readSettings()
    const hooks = settings.hooks as Record<string, unknown[]>

    // PreToolUse should still have the existing hook
    expect(hooks.PreToolUse).toHaveLength(1)
    const remaining = hooks.PreToolUse[0] as Record<string, unknown>
    expect(remaining.matcher).toBe("Bash")

    // SessionStart should be removed (was empty after filtering)
    expect(hooks.SessionStart).toBeUndefined()

    // Permissions preserved
    expect(settings.permissions).toEqual({ allow: [] })
  })

  test("unregister cleans up empty event arrays and empty hooks object", () => {
    // All events only have Clooks hooks
    registerClooks(tempDir)
    const result = unregisterClooks(tempDir)

    expect(result.removed).toHaveLength(18)

    const settings = readSettings()
    // hooks object should be entirely removed
    expect(settings.hooks).toBeUndefined()
  })

  test("isClooksRegistered returns true after register, false after unregister", () => {
    expect(isClooksRegistered(tempDir)).toBe(false)

    registerClooks(tempDir)
    expect(isClooksRegistered(tempDir)).toBe(true)

    unregisterClooks(tempDir)
    expect(isClooksRegistered(tempDir)).toBe(false)
  })

  test("empty file handled gracefully", () => {
    mkdirSync(join(tempDir, ".claude"), { recursive: true })
    writeFileSync(settingsPath(), "")

    const result = registerClooks(tempDir)

    expect(result.added).toHaveLength(18)
    expect(result.created).toBe(false) // file existed, even if empty
    expect(existsSync(settingsPath())).toBe(true)
  })

  test("malformed JSON throws descriptive error", () => {
    mkdirSync(join(tempDir, ".claude"), { recursive: true })
    writeFileSync(settingsPath(), "{ not valid json !!!")

    expect(() => registerClooks(tempDir)).toThrow(
      "`.claude/settings.json` contains invalid JSON. Fix or delete the file, then re-run `clooks init`.",
    )
  })

  test("creates .claude/ directory if missing", () => {
    // tempDir has no .claude/ subdirectory
    expect(existsSync(join(tempDir, ".claude"))).toBe(false)

    registerClooks(tempDir)

    expect(existsSync(join(tempDir, ".claude"))).toBe(true)
    expect(existsSync(settingsPath())).toBe(true)
  })

  test("detects legacy entrypoint paths as Clooks registrations", () => {
    writeSettings({
      hooks: {
        PreToolUse: [
          {
            hooks: [{ type: "command", command: ".clooks/bin/clooks-entrypoint.sh" }],
          },
        ],
        PostToolUse: [
          {
            hooks: [{ type: "command", command: ".clooks/clooks-entrypoint.sh" }],
          },
        ],
      },
    })

    // Both legacy paths should be detected as Clooks registrations
    expect(isClooksRegistered(tempDir)).toBe(true)

    // Register should NOT add new entries (they already exist, just with legacy paths)
    const result = registerClooks(tempDir)
    expect(result.added).toHaveLength(16) // 18 - 2 legacy = 16 new
    expect(result.updated).toHaveLength(2) // 2 legacy migrated
    expect(result.skipped).toHaveLength(0)
  })

  test("migrates legacy command paths to canonical path when re-running register", () => {
    writeSettings({
      hooks: {
        PreToolUse: [
          {
            hooks: [{ type: "command", command: ".clooks/bin/clooks-entrypoint.sh" }],
          },
        ],
        PostToolUse: [
          {
            hooks: [{ type: "command", command: ".clooks/clooks-entrypoint.sh" }],
          },
        ],
      },
    })

    const result = registerClooks(tempDir)

    expect(result.updated).toHaveLength(2)
    expect(result.updated).toContain("PreToolUse")
    expect(result.updated).toContain("PostToolUse")

    const settings = readSettings()
    const hooks = settings.hooks as Record<string, unknown[]>

    // Both should now use the canonical path
    const preMG = hooks.PreToolUse[0] as Record<string, unknown>
    const preHooks = preMG.hooks as Record<string, string>[]
    expect(preHooks[0].command).toBe(CLOOKS_ENTRYPOINT_PATH)

    const postMG = hooks.PostToolUse[0] as Record<string, unknown>
    const postHooks = postMG.hooks as Record<string, string>[]
    expect(postHooks[0].command).toBe(CLOOKS_ENTRYPOINT_PATH)

    // Running again should skip everything
    const result2 = registerClooks(tempDir)
    expect(result2.added).toHaveLength(0)
    expect(result2.updated).toHaveLength(0)
    expect(result2.skipped).toHaveLength(18)
  })
})
