import { dirname, isAbsolute, resolve } from 'path'
import { homedir } from 'os'
import { realpath } from 'fs/promises'
import { getGitRoot as defaultGetGitRoot } from '../git.js'
import { CLOOKS_DIR, CLOOKS_CONFIG_FILENAME } from './constants.js'

export interface FindProjectRootOptions {
  cwd?: string
  env?: Record<string, string | undefined>
  homeRoot?: string
  getGitRoot?: () => Promise<string | null>
}

export interface DiscoveryResult {
  projectRoot: string
  signal: 'explicit-env' | 'walk-up' | 'claude-project-dir' | 'cwd-fallback'
  from: string
  checked?: string[]
  boundary?: 'git-root' | 'home' | 'fs-root'
  boundaryPath?: string
}

async function configExists(dir: string): Promise<boolean> {
  return Bun.file(`${dir}/${CLOOKS_DIR}/${CLOOKS_CONFIG_FILENAME}`).exists()
}

function isAncestorOrEqual(ancestor: string, descendant: string): boolean {
  if (ancestor === descendant) return true
  const prefix = ancestor.endsWith('/') ? ancestor : ancestor + '/'
  return descendant.startsWith(prefix)
}

function fsRoot(): string {
  return '/'
}

interface BoundaryResult {
  boundary: 'git-root' | 'home' | 'fs-root'
  boundaryPath: string
}

function computeBoundary(
  startDir: string,
  gitRoot: string | null,
  homeRoot: string,
): BoundaryResult {
  if (gitRoot !== null && isAncestorOrEqual(gitRoot, startDir)) {
    return { boundary: 'git-root', boundaryPath: gitRoot }
  }
  if (isAncestorOrEqual(homeRoot, startDir)) {
    return { boundary: 'home', boundaryPath: homeRoot }
  }
  return { boundary: 'fs-root', boundaryPath: fsRoot() }
}

async function walkUp(
  startDir: string,
  boundaryPath: string,
): Promise<{ found: string; checked: string[] } | { found: null; checked: string[] }> {
  const checked: string[] = []
  let current = startDir

  while (true) {
    checked.push(current)
    if (await configExists(current)) {
      return { found: current, checked }
    }
    if (current === boundaryPath) {
      return { found: null, checked }
    }
    const parent = dirname(current)
    if (parent === current) {
      return { found: null, checked }
    }
    current = parent
  }
}

export async function discoverProjectRoot(
  options?: FindProjectRootOptions,
): Promise<DiscoveryResult> {
  const rawCwd = options?.cwd ?? process.cwd()
  const env = options?.env ?? (process.env as Record<string, string | undefined>)
  const homeRoot = options?.homeRoot ?? homedir()
  const resolveGitRoot = options?.getGitRoot ?? defaultGetGitRoot

  // Canonicalize cwd up front so it is available to all code paths, including explicit-env.
  let canonCwd: string
  try {
    canonCwd = await realpath(rawCwd)
  } catch {
    canonCwd = rawCwd
  }

  // Step 1: Explicit env override wins unconditionally.
  const explicitRoot = env['CLOOKS_PROJECT_ROOT']
  if (explicitRoot && explicitRoot.length > 0) {
    const absRoot = isAbsolute(explicitRoot) ? explicitRoot : resolve(rawCwd, explicitRoot)
    let canonRoot: string
    try {
      canonRoot = await realpath(absRoot)
    } catch {
      canonRoot = absRoot
    }
    return {
      projectRoot: canonRoot,
      signal: 'explicit-env',
      from: canonCwd,
    }
  }

  // Resolve git root once for this invocation.
  const gitRoot = await resolveGitRoot()

  // Step 2: Walk up from $CLAUDE_PROJECT_DIR if set.
  const anchorRaw = env['CLAUDE_PROJECT_DIR']
  if (anchorRaw && anchorRaw.length > 0) {
    let anchor: string | null
    try {
      anchor = await realpath(anchorRaw)
    } catch {
      anchor = null
    }

    if (anchor !== null) {
      const { boundary, boundaryPath } = computeBoundary(anchor, gitRoot, homeRoot)
      const result = await walkUp(anchor, boundaryPath)
      if (result.found !== null) {
        return {
          projectRoot: result.found,
          signal: 'claude-project-dir',
          from: anchor,
          checked: result.checked,
          boundary,
          boundaryPath,
        }
      }
    }
  }

  // Step 3: Walk up from cwd.
  const { boundary, boundaryPath } = computeBoundary(canonCwd, gitRoot, homeRoot)
  const result = await walkUp(canonCwd, boundaryPath)
  if (result.found !== null) {
    return {
      projectRoot: result.found,
      signal: 'walk-up',
      from: canonCwd,
      checked: result.checked,
      boundary,
      boundaryPath,
    }
  }

  // Step 5: Final fallback — return canonicalized cwd.
  return {
    projectRoot: canonCwd,
    signal: 'cwd-fallback',
    from: canonCwd,
    checked: result.checked,
    boundary,
    boundaryPath,
  }
}

export async function findProjectRoot(options?: FindProjectRootOptions): Promise<string> {
  return discoverProjectRoot(options).then((r) => r.projectRoot)
}
