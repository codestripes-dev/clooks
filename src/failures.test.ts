import { describe, expect, test, afterEach, spyOn } from "bun:test"
import { mkdtempSync, rmSync, mkdirSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { createHash } from "crypto"
import {
  readFailures,
  writeFailures,
  recordFailure,
  clearFailure,
  getFailureCount,
  getFailurePath,
} from "./failures.js"
import { hn } from "./test-utils.js"

let tempDir: string

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

function makeTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), "clooks-failures-test-"))
  mkdirSync(join(tempDir, ".clooks"), { recursive: true })
  return tempDir
}

/** Compute the project failure path (.clooks/.failures) for a temp dir. */
function projectFailurePath(dir: string): string {
  return join(dir, ".clooks/.failures")
}

describe("getFailurePath", () => {
  test("returns project path when project config exists", () => {
    const projectRoot = "/home/user/my-project"
    const homeRoot = "/home/user"
    const result = getFailurePath(projectRoot, homeRoot, true)
    expect(result).toBe(join(projectRoot, ".clooks/.failures"))
  })

  test("returns home path with hash when home-only", () => {
    const projectRoot = "/home/user/my-project"
    const homeRoot = "/home/user"
    const result = getFailurePath(projectRoot, homeRoot, false)
    const expectedHash = createHash("sha256")
      .update(projectRoot)
      .digest("hex")
      .slice(0, 12)
    expect(result).toBe(join(homeRoot, ".clooks/failures", `${expectedHash}.json`))
  })

  test("different project roots produce different hashes", () => {
    const homeRoot = "/home/user"
    const path1 = getFailurePath("/home/user/project-a", homeRoot, false)
    const path2 = getFailurePath("/home/user/project-b", homeRoot, false)
    expect(path1).not.toBe(path2)
  })
})

describe("readFailures", () => {
  test("returns {} when file does not exist", async () => {
    const dir = makeTempDir()
    const result = await readFailures(projectFailurePath(dir))
    expect(result).toEqual({})
  })

  test("returns {} and warns to stderr when file contains invalid JSON", async () => {
    const dir = makeTempDir()
    const fPath = projectFailurePath(dir)
    await Bun.write(fPath, "not json{{{")
    const spy = spyOn(process.stderr, "write").mockImplementation(() => true)
    const result = await readFailures(fPath)
    expect(result).toEqual({})
    expect(spy).toHaveBeenCalledWith(
      `clooks: warning: failure state at ${fPath} is malformed, resetting\n`,
    )
    spy.mockRestore()
  })

  test("returns {} and warns to stderr when file contains a non-object", async () => {
    const dir = makeTempDir()
    const fPath = projectFailurePath(dir)
    await Bun.write(fPath, JSON.stringify([1, 2, 3]))
    const spy = spyOn(process.stderr, "write").mockImplementation(() => true)
    const result = await readFailures(fPath)
    expect(result).toEqual({})
    expect(spy).toHaveBeenCalledWith(
      `clooks: warning: failure state at ${fPath} is malformed, resetting\n`,
    )
    spy.mockRestore()
  })

  test("parses a valid failures file correctly", async () => {
    const dir = makeTempDir()
    const state = {
      "my-hook": {
        PreToolUse: {
          consecutiveFailures: 3,
          lastError: "boom",
          lastFailedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    }
    await Bun.write(
      join(dir, ".clooks/.failures"),
      JSON.stringify(state, null, 2),
    )
    const result = await readFailures(projectFailurePath(dir))
    expect(result).toEqual(state)
  })

  test("reads from home-only failure path", async () => {
    const dir = makeTempDir()
    const failuresDir = join(dir, ".clooks/failures")
    mkdirSync(failuresDir, { recursive: true })
    const failurePath = join(failuresDir, "abc123.json")
    const state = {
      "my-hook": {
        PreToolUse: {
          consecutiveFailures: 1,
          lastError: "error",
          lastFailedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    }
    await Bun.write(failurePath, JSON.stringify(state, null, 2))
    const result = await readFailures(failurePath)
    expect(result).toEqual(state)
  })
})

describe("writeFailures", () => {
  test("writes formatted JSON to the correct path", async () => {
    const dir = makeTempDir()
    const state = {
      "my-hook": {
        PreToolUse: {
          consecutiveFailures: 1,
          lastError: "error",
          lastFailedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    }
    await writeFailures(projectFailurePath(dir), state)
    const content = await Bun.file(join(dir, ".clooks/.failures")).text()
    expect(JSON.parse(content)).toEqual(state)
    // Verify it's formatted (has newlines)
    expect(content).toContain("\n")
  })

  test("deletes the file when state is empty", async () => {
    const dir = makeTempDir()
    const filePath = join(dir, ".clooks/.failures")
    // Create the file first
    await Bun.write(filePath, "{}")
    expect(await Bun.file(filePath).exists()).toBe(true)
    // Write empty state
    await writeFailures(filePath, {})
    expect(await Bun.file(filePath).exists()).toBe(false)
  })

  test("creates parent directory if needed (home-only path)", async () => {
    const dir = makeTempDir()
    const failurePath = join(dir, ".clooks/failures/abc123.json")
    // The failures/ directory does not exist yet
    const state = {
      "my-hook": {
        PreToolUse: {
          consecutiveFailures: 1,
          lastError: "error",
          lastFailedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    }
    await writeFailures(failurePath, state)
    const content = await Bun.file(failurePath).text()
    expect(JSON.parse(content)).toEqual(state)
  })

  test("works with both project and home failure paths", async () => {
    const dir = makeTempDir()
    const state = {
      "test-hook": {
        SessionStart: {
          consecutiveFailures: 2,
          lastError: "test error",
          lastFailedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    }

    // Project path
    const projPath = projectFailurePath(dir)
    await writeFailures(projPath, state)
    expect(await readFailures(projPath)).toEqual(state)

    // Home-only path
    const homePath = join(dir, ".clooks/failures/hash123.json")
    await writeFailures(homePath, state)
    expect(await readFailures(homePath)).toEqual(state)
  })
})

describe("recordFailure", () => {
  test("creates a new entry for a previously unseen hook+event", () => {
    const state = recordFailure({}, hn("my-hook"), "PreToolUse", "boom")
    expect(state[hn("my-hook")]!["PreToolUse"]!.consecutiveFailures).toBe(1)
    expect(state[hn("my-hook")]!["PreToolUse"]!.lastError).toBe("boom")
    expect(state[hn("my-hook")]!["PreToolUse"]!.lastFailedAt).toBeTruthy()
  })

  test("increments an existing entry", () => {
    const initial = recordFailure({}, hn("my-hook"), "PreToolUse", "first error")
    const updated = recordFailure(initial, hn("my-hook"), "PreToolUse", "second error")
    expect(updated[hn("my-hook")]!["PreToolUse"]!.consecutiveFailures).toBe(2)
    expect(updated[hn("my-hook")]!["PreToolUse"]!.lastError).toBe("second error")
  })
})

describe("clearFailure", () => {
  test("removes a hook+event entry", () => {
    const initial = recordFailure({}, hn("my-hook"), "PreToolUse", "boom")
    const cleared = clearFailure(initial, hn("my-hook"), "PreToolUse")
    expect(cleared[hn("my-hook")]).toBeUndefined()
  })

  test("removes the hook-level key when its last event entry is cleared", () => {
    let state = recordFailure({}, hn("my-hook"), "PreToolUse", "boom")
    state = recordFailure(state, hn("my-hook"), "PostToolUse", "boom2")
    const cleared = clearFailure(state, hn("my-hook"), "PreToolUse")
    expect(cleared[hn("my-hook")]).toBeDefined()
    expect(cleared[hn("my-hook")]!["PreToolUse"]).toBeUndefined()
    expect(cleared[hn("my-hook")]!["PostToolUse"]).toBeDefined()

    const cleared2 = clearFailure(cleared, hn("my-hook"), "PostToolUse")
    expect(cleared2[hn("my-hook")]).toBeUndefined()
  })

  test("is a no-op when the entry does not exist", () => {
    const state = recordFailure({}, hn("my-hook"), "PreToolUse", "boom")
    const result = clearFailure(state, hn("other-hook"), "PreToolUse")
    expect(result).toBe(state) // same reference
  })
})

describe("getFailureCount", () => {
  test("returns 0 for unknown hook+event", () => {
    expect(getFailureCount({}, hn("unknown"), "PreToolUse")).toBe(0)
  })

  test("returns the count for a known entry", () => {
    let state = recordFailure({}, hn("my-hook"), "PreToolUse", "boom")
    state = recordFailure(state, hn("my-hook"), "PreToolUse", "boom2")
    expect(getFailureCount(state, hn("my-hook"), "PreToolUse")).toBe(2)
  })
})
