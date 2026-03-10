// Lazy-cached git utilities for lifecycle metadata.

let cachedGitRoot: string | null | undefined
let cachedGitBranch: string | null | undefined

export async function getGitRoot(): Promise<string | null> {
  if (cachedGitRoot !== undefined) return cachedGitRoot
  try {
    const proc = Bun.spawn(["git", "rev-parse", "--show-toplevel"], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const text = await new Response(proc.stdout).text()
    const exitCode = await proc.exited
    cachedGitRoot = exitCode === 0 ? text.trim() : null
  } catch {
    cachedGitRoot = null
  }
  return cachedGitRoot
}

export async function getGitBranch(): Promise<string | null> {
  if (cachedGitBranch !== undefined) return cachedGitBranch
  try {
    const proc = Bun.spawn(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const text = await new Response(proc.stdout).text()
    const exitCode = await proc.exited
    cachedGitBranch = exitCode === 0 ? text.trim() : null
  } catch {
    cachedGitBranch = null
  }
  return cachedGitBranch
}

/** Reset cache — only used in tests. */
export function resetGitCache(): void {
  cachedGitRoot = undefined
  cachedGitBranch = undefined
}
