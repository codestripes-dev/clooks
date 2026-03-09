import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { loadConfig } from "./index.js"
import { DEFAULT_MAX_FAILURES, DEFAULT_MAX_FAILURES_MESSAGE } from "./constants.js"
import { hn, ms } from "../test-utils.js"

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "clooks-config-test-"))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

function writeConfig(dir: string, filename: string, content: string) {
  const clooksDir = join(dir, ".clooks")
  mkdirSync(clooksDir, { recursive: true })
  writeFileSync(join(clooksDir, filename), content)
}

describe("loadConfig", () => {
  test("loads a valid config from a temp directory", async () => {
    writeConfig(
      tempDir,
      "clooks.yml",
      `
version: "1.0.0"
config:
  timeout: 30000
  onError: block
log-bash-commands:
  config:
    logDir: ".clooks/logs"
no-production-writes: {}
PreToolUse:
  order: [no-production-writes, log-bash-commands]
`,
    )

    const result = await loadConfig(tempDir)
    expect(result).not.toBeNull()
    const config = result!.config
    expect(config.version).toBe("1.0.0")
    expect(config.global).toEqual({
      timeout: ms(30000),
      onError: "block",
      maxFailures: DEFAULT_MAX_FAILURES,
      maxFailuresMessage: DEFAULT_MAX_FAILURES_MESSAGE,
    })
    expect(Object.keys(config.hooks)).toEqual([
      "log-bash-commands",
      "no-production-writes",
    ])
    expect(config.hooks[hn("log-bash-commands")]!.resolvedPath).toBe(
      ".clooks/hooks/log-bash-commands.ts",
    )
    expect(config.hooks[hn("log-bash-commands")]!.config).toEqual({
      logDir: ".clooks/logs",
    })
    expect(config.hooks[hn("no-production-writes")]!.resolvedPath).toBe(
      ".clooks/hooks/no-production-writes.ts",
    )
    expect(config.events["PreToolUse"]!.order).toEqual([
      hn("no-production-writes"),
      hn("log-bash-commands"),
    ])
  })

  test("merges with local overrides", async () => {
    writeConfig(
      tempDir,
      "clooks.yml",
      `
version: "1.0.0"
lint-guard:
  config:
    strict: true
    blocked_tools: [Bash]
`,
    )
    writeConfig(
      tempDir,
      "clooks.local.yml",
      `
lint-guard:
  config:
    strict: false
`,
    )

    const result = await loadConfig(tempDir)
    expect(result).not.toBeNull()
    // Local overrides replace atomically — so we get just { strict: false }
    // because hook entries are ATOMIC across layers
    expect(result!.config.hooks[hn("lint-guard")]!.config).toEqual({
      strict: false,
    })
  })

  test("returns null when no config files exist", async () => {
    const result = await loadConfig(tempDir)
    expect(result).toBeNull()
  })

  test("ignores missing local file", async () => {
    writeConfig(tempDir, "clooks.yml", `version: "1.0.0"\n`)
    const result = await loadConfig(tempDir)
    expect(result).not.toBeNull()
    expect(result!.config.version).toBe("1.0.0")
  })

  test("all hooks from project config have origin 'project'", async () => {
    writeConfig(
      tempDir,
      "clooks.yml",
      `
version: "1.0.0"
my-hook: {}
`,
    )
    const result = await loadConfig(tempDir)
    expect(result).not.toBeNull()
    expect(result!.config.hooks[hn("my-hook")]!.origin).toBe("project")
  })

  test("hasProjectConfig is true when project config exists", async () => {
    writeConfig(tempDir, "clooks.yml", `version: "1.0.0"\n`)
    const result = await loadConfig(tempDir)
    expect(result).not.toBeNull()
    expect(result!.hasProjectConfig).toBe(true)
  })

  test("shadows is empty when no overlapping hooks", async () => {
    writeConfig(tempDir, "clooks.yml", `version: "1.0.0"\nmy-hook: {}\n`)
    const result = await loadConfig(tempDir)
    expect(result).not.toBeNull()
    expect(result!.shadows).toEqual([])
  })

  // --- Three-layer loading tests ---

  test("home config only loads hooks with origin 'home'", async () => {
    // Create a fake home directory
    const fakeHome = mkdtempSync(join(tmpdir(), "clooks-home-test-"))
    writeConfig(
      fakeHome,
      "clooks.yml",
      `
version: "1.0.0"
security-scanner: {}
`,
    )

    // tempDir has no project config
    const result = await loadConfig(tempDir, { homeRoot: fakeHome })
    expect(result).not.toBeNull()
    expect(result!.config.hooks[hn("security-scanner")]!.origin).toBe("home")
    expect(result!.hasProjectConfig).toBe(false)
    // Home hook path should be resolved relative to homeRoot
    expect(result!.config.hooks[hn("security-scanner")]!.resolvedPath).toBe(
      join(fakeHome, ".clooks/hooks/security-scanner.ts"),
    )

    rmSync(fakeHome, { recursive: true, force: true })
  })

  test("home + project with no overlap merges all hooks", async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "clooks-home-test-"))
    writeConfig(fakeHome, "clooks.yml", `version: "1.0.0"\nhome-hook: {}\n`)
    writeConfig(tempDir, "clooks.yml", `version: "1.0.0"\nproject-hook: {}\n`)

    const result = await loadConfig(tempDir, { homeRoot: fakeHome })
    expect(result).not.toBeNull()
    expect(result!.config.hooks[hn("home-hook")]!.origin).toBe("home")
    expect(result!.config.hooks[hn("project-hook")]!.origin).toBe("project")
    expect(result!.shadows).toEqual([])

    rmSync(fakeHome, { recursive: true, force: true })
  })

  test("project hook shadows home hook", async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "clooks-home-test-"))
    writeConfig(
      fakeHome,
      "clooks.yml",
      `
version: "1.0.0"
shared-hook:
  config:
    fromHome: true
`,
    )
    writeConfig(
      tempDir,
      "clooks.yml",
      `
version: "1.0.0"
shared-hook:
  config:
    fromProject: true
`,
    )

    const result = await loadConfig(tempDir, { homeRoot: fakeHome })
    expect(result).not.toBeNull()
    expect(result!.config.hooks[hn("shared-hook")]!.origin).toBe("project")
    expect(result!.config.hooks[hn("shared-hook")]!.config).toEqual({ fromProject: true })
    expect(result!.shadows).toEqual([hn("shared-hook")])

    rmSync(fakeHome, { recursive: true, force: true })
  })

  test("returns null when neither home nor project config exists", async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "clooks-home-test-"))
    const result = await loadConfig(tempDir, { homeRoot: fakeHome })
    expect(result).toBeNull()
    rmSync(fakeHome, { recursive: true, force: true })
  })

  test("returns null when only local config exists", async () => {
    // Only create clooks.local.yml, not clooks.yml
    writeConfig(tempDir, "clooks.local.yml", `version: "1.0.0"\nmy-hook: {}\n`)

    // Use a nonexistent dir as home so no home config is found either
    const nonexistentHome = join(tmpdir(), "clooks-nonexistent-home-" + Date.now())
    const result = await loadConfig(tempDir, { homeRoot: nonexistentHome })
    expect(result).toBeNull()
  })

  test("home config missing version → validation error", async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "clooks-home-test-"))
    writeConfig(
      fakeHome,
      "clooks.yml",
      `
security-scanner: {}
`,
    )

    await expect(loadConfig(tempDir, { homeRoot: fakeHome })).rejects.toThrow(
      'missing required "version"',
    )

    rmSync(fakeHome, { recursive: true, force: true })
  })
})
