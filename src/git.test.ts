import { describe, test, expect, beforeEach, spyOn } from 'bun:test'
import { getGitRoot, getGitBranch, resetGitCache } from './git.js'

describe('git utilities', () => {
  beforeEach(() => {
    resetGitCache()
  })

  test('getGitRoot returns a non-null string in a git repo', async () => {
    const root = await getGitRoot()
    expect(root).toBeTypeOf('string')
    expect(root!.length).toBeGreaterThan(0)
  })

  test('getGitBranch returns a non-null string', async () => {
    const branch = await getGitBranch()
    expect(branch).toBeTypeOf('string')
    expect(branch!.length).toBeGreaterThan(0)
  })

  test('results are cached on second call', async () => {
    const root1 = await getGitRoot()
    const root2 = await getGitRoot()
    expect(root1).toBe(root2)
  })

  test('resetGitCache allows recomputation', async () => {
    const root1 = await getGitRoot()
    resetGitCache()
    const root2 = await getGitRoot()
    expect(root1).toBe(root2) // Same repo, same result
  })

  test('getGitRoot returns null when git exits non-zero', async () => {
    resetGitCache()
    // We can't run git in an actual non-repo directory because Bun.spawn
    // inherits the real cwd (overriding process.cwd doesn't affect it).
    // Instead we mock Bun.spawn to return exit code 128 (git's "not a
    // repo" exit code) with empty streams.
    const spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
      return {
        stdout: new ReadableStream({
          start(c) {
            c.close()
          },
        }),
        stderr: new ReadableStream({
          start(c) {
            c.close()
          },
        }),
        exited: Promise.resolve(128),
      } as any
    })
    try {
      const root = await getGitRoot()
      expect(root).toBeNull()
    } finally {
      spawnSpy.mockRestore()
      resetGitCache()
    }
  })

  // The next two tests mock Bun.spawn globally to exercise the catch
  // branches.  The extra resetGitCache() in the finally block is critical:
  // without it the cached `null` from the mocked spawn leaks into
  // lifecycle.test.ts (which calls getGitRoot) and causes a cascade failure.
  test('getGitRoot returns null when Bun.spawn throws', async () => {
    resetGitCache()
    const spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
      throw new Error('spawn failed')
    })
    try {
      const root = await getGitRoot()
      expect(root).toBeNull()
    } finally {
      spawnSpy.mockRestore()
      resetGitCache()
    }
  })

  test('getGitBranch returns null when Bun.spawn throws', async () => {
    resetGitCache()
    const spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
      throw new Error('spawn failed')
    })
    try {
      const branch = await getGitBranch()
      expect(branch).toBeNull()
    } finally {
      spawnSpy.mockRestore()
      resetGitCache()
    }
  })
})
