import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { realpath } from 'fs/promises'
import { discoverProjectRoot, findProjectRoot } from './discovery.js'

// Stub that always returns null (no git) — used unless a test needs a specific git root.
const noGit = async () => null

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'clooks-discovery-test-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

function writeConfig(dir: string) {
  mkdirSync(join(dir, '.clooks'), { recursive: true })
  writeFileSync(join(dir, '.clooks', 'clooks.yml'), 'version: "1.0.0"\n')
}

// Resolve a tmpdir path to its canonical form (macOS prepends /private/).
async function canon(p: string): Promise<string> {
  try {
    return await realpath(p)
  } catch {
    return p
  }
}

// ────────────────────────────────────────────────────────────────
// No $CLAUDE_PROJECT_DIR — manual CLI / non-Claude agents
// ────────────────────────────────────────────────────────────────

describe('no $CLAUDE_PROJECT_DIR', () => {
  test('cwd is project root — signal walk-up, checked:[cwd]', async () => {
    writeConfig(tempDir)
    const cwd = await canon(tempDir)
    const result = await discoverProjectRoot({
      cwd,
      env: {},
      homeRoot: '/nonexistent-home',
      getGitRoot: noGit,
    })
    expect(result.signal).toBe('walk-up')
    expect(result.projectRoot).toBe(cwd)
    expect(result.checked).toEqual([cwd])
  })

  test('cwd is one level below project root — walks up one', async () => {
    writeConfig(tempDir)
    const sub = join(tempDir, 'sub')
    mkdirSync(sub)
    const cwdCanon = await canon(sub)
    const rootCanon = await canon(tempDir)
    const result = await discoverProjectRoot({
      cwd: cwdCanon,
      env: {},
      homeRoot: '/nonexistent-home',
      getGitRoot: noGit,
    })
    expect(result.signal).toBe('walk-up')
    expect(result.projectRoot).toBe(rootCanon)
    expect(result.checked).toContain(cwdCanon)
    expect(result.checked).toContain(rootCanon)
  })

  test('cwd is several levels below project root — walks up multiple', async () => {
    writeConfig(tempDir)
    const deep = join(tempDir, 'a', 'b', 'c')
    mkdirSync(deep, { recursive: true })
    const cwdCanon = await canon(deep)
    const rootCanon = await canon(tempDir)
    const result = await discoverProjectRoot({
      cwd: cwdCanon,
      env: {},
      homeRoot: '/nonexistent-home',
      getGitRoot: noGit,
    })
    expect(result.signal).toBe('walk-up')
    expect(result.projectRoot).toBe(rootCanon)
    expect(result.checked!.length).toBeGreaterThan(1)
  })

  test('cwd outside any project — signal cwd-fallback', async () => {
    // No .clooks/clooks.yml anywhere in tempDir tree
    const cwdCanon = await canon(tempDir)
    const result = await discoverProjectRoot({
      cwd: cwdCanon,
      env: {},
      homeRoot: '/nonexistent-home',
      getGitRoot: noGit,
    })
    expect(result.signal).toBe('cwd-fallback')
    expect(result.projectRoot).toBe(cwdCanon)
  })

  test('cwd equals homeRoot and homeRoot/.clooks/clooks.yml exists — returns homeRoot (boundary inclusive)', async () => {
    writeConfig(tempDir)
    const homeCanon = await canon(tempDir)
    const result = await discoverProjectRoot({
      cwd: homeCanon,
      env: {},
      homeRoot: homeCanon,
      getGitRoot: noGit,
    })
    expect(result.signal).toBe('walk-up')
    expect(result.projectRoot).toBe(homeCanon)
    expect(result.boundary).toBe('home')
  })
})

// ────────────────────────────────────────────────────────────────
// CLOOKS_PROJECT_ROOT — explicit override always wins
// ────────────────────────────────────────────────────────────────

describe('CLOOKS_PROJECT_ROOT override', () => {
  test('set — returns it with signal explicit-env, skips all walks', async () => {
    // No clooks.yml anywhere — override wins regardless
    const overrideDir = join(tempDir, 'override')
    mkdirSync(overrideDir)
    const overrideCanon = await canon(overrideDir)
    const result = await discoverProjectRoot({
      cwd: await canon(tempDir),
      env: { CLOOKS_PROJECT_ROOT: overrideCanon },
      homeRoot: '/nonexistent-home',
      getGitRoot: noGit,
    })
    expect(result.signal).toBe('explicit-env')
    expect(result.projectRoot).toBe(overrideCanon)
  })

  test('wins even when $CLAUDE_PROJECT_DIR is also set', async () => {
    writeConfig(tempDir)
    const anchorDir = join(tempDir, 'anchor')
    mkdirSync(anchorDir)
    writeConfig(anchorDir)
    const overrideDir = join(tempDir, 'override')
    mkdirSync(overrideDir)
    const overrideCanon = await canon(overrideDir)
    const result = await discoverProjectRoot({
      cwd: await canon(tempDir),
      env: {
        CLOOKS_PROJECT_ROOT: overrideCanon,
        CLAUDE_PROJECT_DIR: await canon(anchorDir),
      },
      homeRoot: '/nonexistent-home',
      getGitRoot: noGit,
    })
    expect(result.signal).toBe('explicit-env')
    expect(result.projectRoot).toBe(overrideCanon)
  })

  test('relative path — returned as absolute', async () => {
    const cwdCanon = await canon(tempDir)
    const result = await discoverProjectRoot({
      cwd: cwdCanon,
      env: { CLOOKS_PROJECT_ROOT: 'some/relative/path' },
      homeRoot: '/nonexistent-home',
      getGitRoot: noGit,
    })
    expect(result.signal).toBe('explicit-env')
    expect(result.projectRoot).toBe(join(cwdCanon, 'some/relative/path'))
  })
})

// ────────────────────────────────────────────────────────────────
// $CLAUDE_PROJECT_DIR — primary anchor cases
// ────────────────────────────────────────────────────────────────

describe('$CLAUDE_PROJECT_DIR anchor', () => {
  test('anchor dir has clooks.yml — signal claude-project-dir', async () => {
    writeConfig(tempDir)
    const projCanon = await canon(tempDir)
    // cwd is irrelevant — use a directory without clooks
    const otherDir = join(tempDir, 'other')
    mkdirSync(otherDir)
    const result = await discoverProjectRoot({
      cwd: await canon(otherDir),
      env: { CLAUDE_PROJECT_DIR: projCanon },
      homeRoot: '/nonexistent-home',
      getGitRoot: noGit,
    })
    expect(result.signal).toBe('claude-project-dir')
    expect(result.projectRoot).toBe(projCanon)
  })

  test('anchor is subdir of project root — walks up from anchor', async () => {
    writeConfig(tempDir)
    const sub = join(tempDir, 'packages', 'sub')
    mkdirSync(sub, { recursive: true })
    const subCanon = await canon(sub)
    const rootCanon = await canon(tempDir)
    const result = await discoverProjectRoot({
      cwd: await canon(sub),
      env: { CLAUDE_PROJECT_DIR: subCanon },
      homeRoot: '/nonexistent-home',
      getGitRoot: noGit,
    })
    expect(result.signal).toBe('claude-project-dir')
    expect(result.projectRoot).toBe(rootCanon)
    expect(result.checked).toContain(subCanon)
    expect(result.checked).toContain(rootCanon)
  })

  test('escape-resistance: cwd=/tmp but anchor has clooks.yml — returns anchor project', async () => {
    writeConfig(tempDir)
    const projCanon = await canon(tempDir)
    // cwd is /tmp — simulates agent running cd /tmp
    const tmpdirCanon = await canon(tmpdir())
    const result = await discoverProjectRoot({
      cwd: tmpdirCanon,
      env: { CLAUDE_PROJECT_DIR: projCanon },
      homeRoot: '/nonexistent-home',
      getGitRoot: noGit,
    })
    expect(result.signal).toBe('claude-project-dir')
    expect(result.projectRoot).toBe(projCanon)
  })

  test('anchor walk fails, falls through to cwd walk — signal walk-up', async () => {
    // scratch dir has no clooks; work/proj does
    const scratch = join(tempDir, 'scratch')
    mkdirSync(scratch)
    const workProj = join(tempDir, 'work', 'proj')
    mkdirSync(workProj, { recursive: true })
    writeConfig(workProj)
    const scratchCanon = await canon(scratch)
    const workProjCanon = await canon(workProj)
    const result = await discoverProjectRoot({
      cwd: workProjCanon,
      env: { CLAUDE_PROJECT_DIR: scratchCanon },
      homeRoot: '/nonexistent-home',
      getGitRoot: noGit,
    })
    expect(result.signal).toBe('walk-up')
    expect(result.projectRoot).toBe(workProjCanon)
    expect(result.from).toBe(workProjCanon)
  })

  test('anchor walk fails, cwd also outside project — signal cwd-fallback', async () => {
    const scratch = join(tempDir, 'scratch')
    mkdirSync(scratch)
    const noProject = join(tempDir, 'noproj')
    mkdirSync(noProject)
    const scratchCanon = await canon(scratch)
    const noProjectCanon = await canon(noProject)
    const result = await discoverProjectRoot({
      cwd: noProjectCanon,
      env: { CLAUDE_PROJECT_DIR: scratchCanon },
      homeRoot: '/nonexistent-home',
      getGitRoot: noGit,
    })
    expect(result.signal).toBe('cwd-fallback')
    expect(result.projectRoot).toBe(noProjectCanon)
    expect(result.from).toBe(noProjectCanon)
  })

  test('monorepo: anchor=/mono with both /mono and /mono/packages/A having clooks.yml — returns /mono (anchor wins)', async () => {
    writeConfig(tempDir)
    const packageA = join(tempDir, 'packages', 'A')
    mkdirSync(packageA, { recursive: true })
    writeConfig(packageA)
    const monoCanon = await canon(tempDir)
    const packageACanon = await canon(packageA)
    const result = await discoverProjectRoot({
      cwd: packageACanon,
      env: { CLAUDE_PROJECT_DIR: monoCanon },
      homeRoot: '/nonexistent-home',
      getGitRoot: noGit,
    })
    expect(result.signal).toBe('claude-project-dir')
    expect(result.projectRoot).toBe(monoCanon)
  })
})

// ────────────────────────────────────────────────────────────────
// Boundary cases
// ────────────────────────────────────────────────────────────────

describe('boundary cases', () => {
  test('.git boundary respected — walk stops at git root, does not cross it', async () => {
    // Layout: gitRoot/proj/.clooks/clooks.yml does NOT exist
    //         gitRoot/ is the boundary (via injected getGitRoot)
    // cwd = gitRoot/sub → should NOT find anything, returns cwd-fallback
    const gitRootDir = join(tempDir, 'gitroot')
    mkdirSync(gitRootDir)
    const sub = join(gitRootDir, 'sub')
    mkdirSync(sub)
    // No clooks.yml anywhere in gitRootDir tree
    const gitRootCanon = await canon(gitRootDir)
    const subCanon = await canon(sub)
    const result = await discoverProjectRoot({
      cwd: subCanon,
      env: {},
      homeRoot: '/nonexistent-home',
      getGitRoot: async () => gitRootCanon,
    })
    expect(result.signal).toBe('cwd-fallback')
    expect(result.boundary).toBe('git-root')
    expect(result.boundaryPath).toBe(gitRootCanon)
    // Walk must have stopped at gitRootDir — did not go higher
    expect(result.checked).toContain(gitRootCanon)
  })

  test('.git boundary: clooks.yml at git root is found (inclusive check)', async () => {
    const gitRootDir = join(tempDir, 'gitroot')
    mkdirSync(gitRootDir)
    writeConfig(gitRootDir)
    const sub = join(gitRootDir, 'sub')
    mkdirSync(sub)
    const gitRootCanon = await canon(gitRootDir)
    const subCanon = await canon(sub)
    const result = await discoverProjectRoot({
      cwd: subCanon,
      env: {},
      homeRoot: '/nonexistent-home',
      getGitRoot: async () => gitRootCanon,
    })
    expect(result.signal).toBe('walk-up')
    expect(result.projectRoot).toBe(gitRootCanon)
    expect(result.boundary).toBe('git-root')
  })

  test('$HOME boundary respected when no git — walk stops at homeRoot', async () => {
    // Layout: homeRoot/proj/.clooks/clooks.yml does NOT exist
    // cwd = homeRoot/sub → cwd-fallback (clooks.yml absent)
    const homeDir = join(tempDir, 'home')
    mkdirSync(homeDir)
    const sub = join(homeDir, 'sub')
    mkdirSync(sub)
    const homeCanon = await canon(homeDir)
    const subCanon = await canon(sub)
    const result = await discoverProjectRoot({
      cwd: subCanon,
      env: {},
      homeRoot: homeCanon,
      getGitRoot: noGit,
    })
    expect(result.signal).toBe('cwd-fallback')
    expect(result.boundary).toBe('home')
    expect(result.boundaryPath).toBe(homeCanon)
    expect(result.checked).toContain(homeCanon)
  })

  test('$HOME boundary: clooks.yml at homeRoot is found (inclusive check)', async () => {
    const homeDir = join(tempDir, 'home')
    mkdirSync(homeDir)
    writeConfig(homeDir)
    const sub = join(homeDir, 'sub')
    mkdirSync(sub)
    const homeCanon = await canon(homeDir)
    const subCanon = await canon(sub)
    const result = await discoverProjectRoot({
      cwd: subCanon,
      env: {},
      homeRoot: homeCanon,
      getGitRoot: noGit,
    })
    expect(result.signal).toBe('walk-up')
    expect(result.projectRoot).toBe(homeCanon)
    expect(result.boundary).toBe('home')
  })

  test('symlink cwd — canonicalization picks up real path, walk succeeds', async () => {
    writeConfig(tempDir)
    const sub = join(tempDir, 'real-sub')
    mkdirSync(sub)
    const symlinkPath = join(tempDir, 'link-sub')
    symlinkSync(sub, symlinkPath)
    const realSubCanon = await canon(sub)
    const rootCanon = await canon(tempDir)
    // Pass the symlink as cwd — should resolve to real path and walk finds rootCanon
    const result = await discoverProjectRoot({
      cwd: symlinkPath,
      env: {},
      homeRoot: '/nonexistent-home',
      getGitRoot: noGit,
    })
    expect(result.signal).toBe('walk-up')
    expect(result.projectRoot).toBe(rootCanon)
    expect(result.from).toBe(realSubCanon)
  })

  test('filesystem root: cwd outside $HOME and no git — walk stops at /, signal cwd-fallback', async () => {
    // Use tempDir itself as cwd — it's outside a nonexistent home and git returns null
    // The boundary will be fs-root because tempDir is not under /nonexistent-home
    const cwdCanon = await canon(tempDir)
    const result = await discoverProjectRoot({
      cwd: cwdCanon,
      env: {},
      homeRoot: '/nonexistent-home-xyz-12345',
      getGitRoot: noGit,
    })
    // No clooks.yml exists → cwd-fallback
    expect(result.signal).toBe('cwd-fallback')
    expect(result.boundary).toBe('fs-root')
    expect(result.boundaryPath).toBe('/')
  })
})

// ────────────────────────────────────────────────────────────────
// Stability: same projectRoot from any subdirectory of the same project
// ────────────────────────────────────────────────────────────────

describe('cwd stability', () => {
  test('discoverProjectRoot returns the same projectRoot from two different subdirectories', async () => {
    writeConfig(tempDir)
    const sub1 = join(tempDir, 'sub1')
    const sub2 = join(tempDir, 'sub2')
    mkdirSync(sub1)
    mkdirSync(sub2)
    const sub1Canon = await canon(sub1)
    const sub2Canon = await canon(sub2)
    const opts = { env: {}, homeRoot: '/nonexistent-home', getGitRoot: noGit }
    const result1 = await discoverProjectRoot({ ...opts, cwd: sub1Canon })
    const result2 = await discoverProjectRoot({ ...opts, cwd: sub2Canon })
    expect(result1.projectRoot).toBe(result2.projectRoot)
    expect(result1.signal).toBe('walk-up')
    expect(result2.signal).toBe('walk-up')
  })
})

// ────────────────────────────────────────────────────────────────
// findProjectRoot — thin wrapper
// ────────────────────────────────────────────────────────────────

describe('findProjectRoot', () => {
  test('returns projectRoot string', async () => {
    writeConfig(tempDir)
    const cwdCanon = await canon(tempDir)
    const result = await findProjectRoot({
      cwd: cwdCanon,
      env: {},
      homeRoot: '/nonexistent-home',
      getGitRoot: noGit,
    })
    expect(result).toBe(cwdCanon)
    expect(typeof result).toBe('string')
  })
})

// ────────────────────────────────────────────────────────────────
// Empty-string env vars — fall through, do not short-circuit
// ────────────────────────────────────────────────────────────────

describe('empty-string env vars fall through', () => {
  test('CLOOKS_PROJECT_ROOT="" — does not return explicit-env, cwd walk runs', async () => {
    writeConfig(tempDir)
    const cwdCanon = await canon(tempDir)
    const result = await discoverProjectRoot({
      cwd: cwdCanon,
      env: { CLOOKS_PROJECT_ROOT: '' },
      homeRoot: '/nonexistent-home',
      getGitRoot: noGit,
    })
    expect(result.signal).not.toBe('explicit-env')
    expect(result.signal).toBe('walk-up')
    expect(result.projectRoot).toBe(cwdCanon)
  })

  test('CLAUDE_PROJECT_DIR="" — does not return claude-project-dir, cwd walk runs', async () => {
    writeConfig(tempDir)
    const cwdCanon = await canon(tempDir)
    const result = await discoverProjectRoot({
      cwd: cwdCanon,
      env: { CLAUDE_PROJECT_DIR: '' },
      homeRoot: '/nonexistent-home',
      getGitRoot: noGit,
    })
    expect(result.signal).not.toBe('claude-project-dir')
    expect(result.signal).toBe('walk-up')
    expect(result.projectRoot).toBe(cwdCanon)
  })
})

// ────────────────────────────────────────────────────────────────
// $CLAUDE_PROJECT_DIR edge cases — non-existent path and regular file
// ────────────────────────────────────────────────────────────────

describe('$CLAUDE_PROJECT_DIR pointing to invalid paths', () => {
  test('non-existent path — realpath throws, falls through to cwd walk', async () => {
    writeConfig(tempDir)
    const cwdCanon = await canon(tempDir)
    const result = await discoverProjectRoot({
      cwd: cwdCanon,
      env: { CLAUDE_PROJECT_DIR: '/nonexistent/path/xyz-12345' },
      homeRoot: '/nonexistent-home',
      getGitRoot: noGit,
    })
    // anchor is treated as absent; cwd walk finds the config
    expect(result.signal).toBe('walk-up')
    expect(result.projectRoot).toBe(cwdCanon)
    expect(result.from).toBe(cwdCanon)
  })

  test('regular file (not a directory) — walkUp resolves to file parent, no crash', async () => {
    // Place the file inside a dedicated subdirectory with no config.
    // The cwd is a separate subdirectory also with no config.
    // walkUp starts at the file path, climbs to its parent (no config there either),
    // then hits the boundary — falls through to the cwd walk which also finds nothing.
    const fileDir = join(tempDir, 'filedir')
    mkdirSync(fileDir)
    const filePath = join(fileDir, 'foo.txt')
    writeFileSync(filePath, 'not a directory\n')
    const noProjDir = join(tempDir, 'noproj')
    mkdirSync(noProjDir)
    const noProjCanon = await canon(noProjDir)
    const result = await discoverProjectRoot({
      cwd: noProjCanon,
      env: { CLAUDE_PROJECT_DIR: filePath },
      homeRoot: '/nonexistent-home',
      getGitRoot: noGit,
    })
    // No crash. Anchor walk finds nothing; cwd walk finds nothing — cwd-fallback.
    expect(result.signal).toBe('cwd-fallback')
    expect(result.projectRoot).toBe(noProjCanon)
  })
})

// ────────────────────────────────────────────────────────────────
// First-match semantics — nearer config wins over ancestor config
// ────────────────────────────────────────────────────────────────

describe('first-match semantics (no aggregation)', () => {
  test('nearer config wins — packages/A/.clooks/clooks.yml beats tempDir/.clooks/clooks.yml', async () => {
    // Both tempDir and tempDir/packages/A have configs.
    // When cwd is packages/A, the walk should return packages/A, not tempDir.
    writeConfig(tempDir)
    const packageA = join(tempDir, 'packages', 'A')
    mkdirSync(packageA, { recursive: true })
    writeConfig(packageA)
    const packageACanon = await canon(packageA)
    const result = await discoverProjectRoot({
      cwd: packageACanon,
      env: {},
      homeRoot: '/nonexistent-home',
      getGitRoot: noGit,
    })
    expect(result.signal).toBe('walk-up')
    expect(result.projectRoot).toBe(packageACanon)
    // Must NOT have walked all the way up to tempDir
    expect(result.projectRoot).not.toBe(await canon(tempDir))
  })
})
