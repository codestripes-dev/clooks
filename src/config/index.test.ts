import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { loadConfig } from "./index.js"
import { DEFAULT_MAX_FAILURES, DEFAULT_MAX_FAILURES_MESSAGE } from "./constants.js"
import type { HookName } from "../types/branded.js"
const hn = (s: string) => s as HookName

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

    const config = await loadConfig(tempDir)
    expect(config.version).toBe("1.0.0")
    expect(config.global).toEqual({
      timeout: 30000,
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

    const config = await loadConfig(tempDir)
    expect(config.hooks[hn("lint-guard")]!.config).toEqual({
      strict: false,
      blocked_tools: ["Bash"],
    })
  })

  test("throws when config file is missing", async () => {
    expect(loadConfig(tempDir)).rejects.toThrow("config file not found")
  })

  test("ignores missing local file", async () => {
    writeConfig(tempDir, "clooks.yml", `version: "1.0.0"\n`)
    const config = await loadConfig(tempDir)
    expect(config.version).toBe("1.0.0")
  })
})
