import { describe, test, expect, beforeEach } from "bun:test"
import { getGitRoot, getGitBranch, resetGitCache } from "./git.js"

describe("git utilities", () => {
  beforeEach(() => {
    resetGitCache()
  })

  test("getGitRoot returns a non-null string in a git repo", async () => {
    const root = await getGitRoot()
    expect(root).toBeTypeOf("string")
    expect(root!.length).toBeGreaterThan(0)
  })

  test("getGitBranch returns a non-null string", async () => {
    const branch = await getGitBranch()
    expect(branch).toBeTypeOf("string")
    expect(branch!.length).toBeGreaterThan(0)
  })

  test("results are cached on second call", async () => {
    const root1 = await getGitRoot()
    const root2 = await getGitRoot()
    expect(root1).toBe(root2)
  })

  test("resetGitCache allows recomputation", async () => {
    const root1 = await getGitRoot()
    resetGitCache()
    const root2 = await getGitRoot()
    expect(root1).toBe(root2) // Same repo, same result
  })
})
