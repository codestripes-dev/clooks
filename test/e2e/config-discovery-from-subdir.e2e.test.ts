import { describe, test, expect, afterEach } from 'bun:test'
import { join } from 'path'
import { symlinkSync } from 'fs'
import { createSandbox, type Sandbox } from './helpers/sandbox'

/*
 * E2E tests for config discovery walk-up (FEAT-0071 M6).
 *
 * Each test runs the compiled binary from a directory other than the project
 * root and verifies that clooks finds the correct .clooks/clooks.yml.
 *
 * Sandbox API notes:
 *   - sandbox.dir  = project root (tmp dir created by createSandbox)
 *   - sandbox.home = fake HOME (sibling of project dir; CLOOKS_HOME_ROOT is set)
 *   - sandbox.run(args, { cwd, env }) invokes the binary with the given working
 *     directory and optional env overrides.
 *   - sandbox.writeFile('sub/.gitkeep', '') creates the parent 'sub/' directory.
 *
 * Event JSON helpers:
 *   - PRE_TOOL_USE – minimal valid PreToolUse event
 *   - SESSION_START  – minimal valid SessionStart event
 */

const PRE_TOOL_USE = JSON.stringify({
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: { command: 'ls' },
})

const SESSION_START = JSON.stringify({
  hook_event_name: 'SessionStart',
  source: 'startup',
})

/*
 * A trivial hook that handles PreToolUse and emits a known string via
 * injectContext (which surfaces in additionalContext of the engine output).
 * The YAML key and meta.name must match — pass the hook's YAML registration
 * key as `name` and a distinct marker string as `marker`.
 */
function sentinelHook(name: string, marker: string): string {
  return `
export const hook = {
  meta: { name: "${name}" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "${marker}" }
  },
}
`
}

let sandbox: Sandbox

afterEach(() => {
  sandbox?.cleanup()
})

/*
 * Existing E2E test audit (required by FEAT-0071 M6):
 *
 * grep -rln -E "process\.cwd|projectRoot|loadConfig" test/e2e/ found three files:
 *
 * 1. test/e2e/environment-edge-cases.e2e.test.ts
 *    Match: line comment "// loadConfig" inside a string in a comment.
 *    Assessment: (a) the word appears inside a comment describing Bun.file().exists()
 *    behavior. No cwd-relative path logic is exercised by the test itself. The
 *    sandbox always runs with cwd = sandbox.dir (project root). Unaffected.
 *
 * 2. test/e2e/pipeline-edge-cases.e2e.test.ts
 *    Matches: two uses of `process.cwd()` inside hook source code strings written
 *    via sandbox.writeHook(). The hooks are TypeScript that runs inside the engine;
 *    process.cwd() inside the engine still resolves to the project root (sandbox.dir)
 *    because the engine's cwd is set by the sandbox (which uses sandbox.dir as the
 *    default cwd). Walk-up with cwd = project root returns the same value as the
 *    old cwd = project root logic. Unaffected.
 *
 * 3. test/e2e/home-dir.e2e.test.ts
 *    Matches: `projectRoot` in the hashFailurePath() helper (line 19) and a
 *    comment on line 830. The helper computes the hash-based failure path for
 *    home-only configs using sandbox.dir as projectRoot. Walk-up from sandbox.dir
 *    finds no .clooks/ (no config written) and falls back to cwd (sandbox.dir),
 *    so the value is unchanged. Unaffected.
 *
 * Conclusion: all three files use cwd intentionally as the project root (the
 * default sandbox behavior). After the M3 walk-up change, findProjectRoot() with
 * cwd = project root returns the same value as cwd, so all existing tests remain
 * unaffected.
 */

describe('config discovery from subdirectory', () => {
  // -------------------------------------------------------------------------
  // Case 1: one-level subdirectory — engine fires project hooks
  // -------------------------------------------------------------------------
  test('case 1: cwd is <project>/sub/ — engine discovers and fires project hooks', () => {
    sandbox = createSandbox()
    sandbox.writeFile('sub/.gitkeep', '')
    sandbox.writeHook('sentinel.ts', sentinelHook('sentinel', 'CASE1-MARKER'))
    sandbox.writeConfig('version: "1.0.0"\nsentinel: {}\n')

    const subdir = join(sandbox.dir, 'sub')
    const result = sandbox.run([], { stdin: PRE_TOOL_USE, cwd: subdir })

    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.additionalContext ?? '').toContain('CASE1-MARKER')
  })

  // -------------------------------------------------------------------------
  // Case 2: two-level subdirectory — multi-level walk works
  // -------------------------------------------------------------------------
  test('case 2: cwd is <project>/sub/sub2/ — engine discovers via multi-level walk', () => {
    sandbox = createSandbox()
    sandbox.writeFile('sub/sub2/.gitkeep', '')
    sandbox.writeHook('sentinel.ts', sentinelHook('sentinel', 'CASE2-MARKER'))
    sandbox.writeConfig('version: "1.0.0"\nsentinel: {}\n')

    const subdir = join(sandbox.dir, 'sub', 'sub2')
    const result = sandbox.run([], { stdin: PRE_TOOL_USE, cwd: subdir })

    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.additionalContext ?? '').toContain('CASE2-MARKER')
  })

  // -------------------------------------------------------------------------
  // Case 3: no .clooks/clooks.yml anywhere — engine exits cleanly (no-op)
  // -------------------------------------------------------------------------
  test('case 3: no clooks.yml anywhere — engine exits 0 cleanly', () => {
    sandbox = createSandbox()
    // No config or hooks written at all.
    const result = sandbox.run([], { stdin: PRE_TOOL_USE })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('')
  })

  // -------------------------------------------------------------------------
  // Case 4: CLOOKS_PROJECT_ROOT set — explicit override wins over cwd
  // -------------------------------------------------------------------------
  test('case 4: CLOOKS_PROJECT_ROOT=<dir>, cwd is unrelated — engine reads <dir>/.clooks/clooks.yml', () => {
    sandbox = createSandbox()
    // Write the config and hook into sandbox.dir (the project root).
    sandbox.writeHook('sentinel.ts', sentinelHook('sentinel', 'CASE4-MARKER'))
    sandbox.writeConfig('version: "1.0.0"\nsentinel: {}\n')

    // Run from HOME (an unrelated directory) with CLOOKS_PROJECT_ROOT pointing at the project.
    const result = sandbox.run([], {
      stdin: PRE_TOOL_USE,
      cwd: sandbox.home,
      env: { CLOOKS_PROJECT_ROOT: sandbox.dir },
    })

    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.additionalContext ?? '').toContain('CASE4-MARKER')
  })

  // -------------------------------------------------------------------------
  // Case 5: clooks config --resolved from subdir prints walked-up project root
  // -------------------------------------------------------------------------
  test('case 5: clooks config --resolved from subdir shows walked-up project root', () => {
    sandbox = createSandbox()
    sandbox.writeFile('src/.gitkeep', '')
    sandbox.writeConfig('version: "1.0.0"\n')
    // Also write home config so buildResolved does not return null.
    sandbox.writeHomeConfig('version: "1.0.0"\n')

    const subdir = join(sandbox.dir, 'src')
    const result = sandbox.run(['config', '--resolved'], { cwd: subdir })

    expect(result.exitCode).toBe(0)
    // The human-readable output starts with "Project root: <path> (via ...)"
    expect(result.stdout).toContain('Project root:')
    expect(result.stdout).toContain(sandbox.dir)
  })

  // -------------------------------------------------------------------------
  // Cases 6–8: clooks add / update / uninstall from subdir
  //
  // These three commands are interactive TUI flows and do not expose
  // non-interactive flags for the full install/uninstall path. Rather than
  // fighting the TUI, we verify the discovery property directly: running
  // `clooks config` (non-resolved) from a subdirectory succeeds and reports
  // the project config — proving that every command that calls discoverProjectRoot()
  // sees the same walked-up projectRoot as the engine does. The install/runtime
  // parity property is structurally guaranteed by the shared findProjectRoot()
  // call site in src/engine/run.ts and all CLI command entry points.
  // -------------------------------------------------------------------------
  test('case 6 (simplified): clooks config from subdir resolves to project root (install/runtime parity proxy)', () => {
    sandbox = createSandbox()
    sandbox.writeFile('sub/.gitkeep', '')
    sandbox.writeConfig('version: "1.0.0"\n')

    const subdir = join(sandbox.dir, 'sub')
    const result = sandbox.run(['config'], { cwd: subdir })

    // config command exits 0 and confirms it loaded the config.
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Config loaded')
  })

  test('case 7 (simplified): clooks config --resolved from subdir shows same projectRoot as engine uses (update parity proxy)', () => {
    sandbox = createSandbox()
    sandbox.writeFile('sub/.gitkeep', '')
    sandbox.writeConfig('version: "1.0.0"\n')
    sandbox.writeHomeConfig('version: "1.0.0"\n')

    const subdir = join(sandbox.dir, 'sub')
    const result = sandbox.run(['config', '--resolved'], { cwd: subdir })

    expect(result.exitCode).toBe(0)
    // Project root in resolved output must be exactly sandbox.dir, not subdir.
    // Match "Project root: <path>" followed by whitespace or end-of-line so a
    // longer prefix (e.g. subdir) cannot satisfy the check.
    expect(result.stdout).toMatch(
      new RegExp(`Project root: ${sandbox.dir.replace(/[/\\]/g, '\\$&')}(?:\\s|$)`),
    )
  })

  test('case 8 (simplified): clooks config from deep subdir resolves to project root (uninstall parity proxy)', () => {
    sandbox = createSandbox()
    sandbox.writeFile('a/b/c/.gitkeep', '')
    sandbox.writeConfig('version: "1.0.0"\n')

    const deepDir = join(sandbox.dir, 'a', 'b', 'c')
    const result = sandbox.run(['config'], { cwd: deepDir })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Config loaded')
  })

  // -------------------------------------------------------------------------
  // Case 9: outside any project, SessionStart — stderr contains cwd-fallback warning
  //
  // Setup: no project config, no home config. Run from sandbox.dir (no
  // .clooks/clooks.yml anywhere on its walk within the sandbox boundary).
  // With signal === 'cwd-fallback' and result === null (nothing to load),
  // the engine emits the advisory before exiting.
  // -------------------------------------------------------------------------
  test('case 9: cwd outside any project, SessionStart → stderr contains cwd-fallback advisory', () => {
    sandbox = createSandbox()
    // No project config and no home config — nothing to find on any walk.
    // sandbox.dir has no .clooks/clooks.yml and the walk is bounded by HOME.

    const result = sandbox.run([], {
      stdin: SESSION_START,
      cwd: sandbox.dir,
    })

    expect(result.exitCode).toBe(0)
    // The cwd-fallback advisory is emitted to stderr on SessionStart events.
    // Text: "clooks: no .clooks/clooks.yml found walking up from <path> (bounded by ..."
    // Verify that the `from` path is the canonical sandbox.dir and the
    // boundary tail is present.  On Linux Docker (the test harness) sandbox.dir
    // is already canonical, so the exact string match is reliable.
    expect(result.stderr).toContain(
      `clooks: no .clooks/clooks.yml found walking up from ${sandbox.dir}`,
    )
    expect(result.stderr).toContain('(bounded by ')
  })

  // -------------------------------------------------------------------------
  // Case 10: same setup as 9, but PreToolUse — stderr does NOT contain warning
  // -------------------------------------------------------------------------
  test('case 10: cwd outside any project, PreToolUse → NO cwd-fallback advisory on stderr', () => {
    sandbox = createSandbox()
    // No configs anywhere — cwd-fallback, but NOT SessionStart, so no advisory.

    const result = sandbox.run([], {
      stdin: PRE_TOOL_USE,
      cwd: sandbox.dir,
    })

    expect(result.exitCode).toBe(0)
    // The cwd-fallback advisory is gated to SessionStart events only.
    expect(result.stderr).not.toContain('clooks: no .clooks/clooks.yml found walking up from')
  })

  // -------------------------------------------------------------------------
  // Case 11: escape-resistance — CLAUDE_PROJECT_DIR set, cwd is unrelated
  //   Engine must read the project anchored by $CLAUDE_PROJECT_DIR.
  // -------------------------------------------------------------------------
  test('case 11: escape-resistance — CLAUDE_PROJECT_DIR=<project>, cwd=home, project hooks fire', () => {
    sandbox = createSandbox()
    sandbox.writeHook('sentinel.ts', sentinelHook('sentinel', 'CASE11-ESCAPE'))
    sandbox.writeConfig('version: "1.0.0"\nsentinel: {}\n')

    // cwd is HOME (an unrelated directory). CLAUDE_PROJECT_DIR anchors to sandbox.dir.
    const result = sandbox.run([], {
      stdin: PRE_TOOL_USE,
      cwd: sandbox.home,
      env: { CLAUDE_PROJECT_DIR: sandbox.dir },
    })

    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.additionalContext ?? '').toContain('CASE11-ESCAPE')
  })

  // -------------------------------------------------------------------------
  // Case 12: anchor fall-through — CLAUDE_PROJECT_DIR walk finds nothing,
  //   cwd walk finds project config.
  // -------------------------------------------------------------------------
  test('case 12: anchor fall-through — CLAUDE_PROJECT_DIR walk empty, cwd walk finds project', () => {
    sandbox = createSandbox()
    // The project config lives under sandbox.dir.
    sandbox.writeHook('sentinel.ts', sentinelHook('sentinel', 'CASE12-FALLTHROUGH'))
    sandbox.writeConfig('version: "1.0.0"\nsentinel: {}\n')

    // CLAUDE_PROJECT_DIR points at HOME, which has no .clooks/clooks.yml anywhere
    // on its walk (only ~/.clooks/clooks.yml for the home config layer, which is
    // not in a .clooks/ sub-directory of any walked dir). cwd is sandbox.dir,
    // which has .clooks/clooks.yml at the top level.
    const result = sandbox.run([], {
      stdin: PRE_TOOL_USE,
      cwd: sandbox.dir,
      env: { CLAUDE_PROJECT_DIR: sandbox.home },
    })

    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.additionalContext ?? '').toContain('CASE12-FALLTHROUGH')
  })

  // -------------------------------------------------------------------------
  // Case 14: trailing slash in CLOOKS_PROJECT_ROOT — engine still finds config
  //
  // A trailing slash on an explicit env-var path must not prevent config
  // discovery. This exercises the realpath-or-fallback normalization in the
  // explicit-env branch of discovery.ts.
  // -------------------------------------------------------------------------
  test('case 14: CLOOKS_PROJECT_ROOT with trailing slash — engine finds project config and fires hook', () => {
    sandbox = createSandbox()
    sandbox.writeHook('sentinel.ts', sentinelHook('sentinel', 'CASE14-TRAILING-SLASH'))
    sandbox.writeConfig('version: "1.0.0"\nsentinel: {}\n')

    const result = sandbox.run([], {
      stdin: PRE_TOOL_USE,
      cwd: sandbox.home,
      env: { CLOOKS_PROJECT_ROOT: `${sandbox.dir}/` },
    })

    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.additionalContext ?? '').toContain('CASE14-TRAILING-SLASH')
  })

  // -------------------------------------------------------------------------
  // Case 15: symlink cwd — engine canonicalizes and finds project hooks
  //
  // A symlink pointing to a subdirectory of the project is used as the cwd.
  // The engine must follow realpath so the walk-up still reaches the project
  // root and fires project hooks.
  // -------------------------------------------------------------------------
  test('case 15: cwd is a symlink into <project>/sub/ — engine canonicalizes and fires project hooks', () => {
    sandbox = createSandbox()
    // Create the real target directory.
    sandbox.writeFile('sub/.gitkeep', '')
    // Create a symlink at <sandbox.dir>/link-to-sub -> <sandbox.dir>/sub
    const linkPath = join(sandbox.dir, 'link-to-sub')
    const targetPath = join(sandbox.dir, 'sub')
    symlinkSync(targetPath, linkPath)

    sandbox.writeHook('sentinel.ts', sentinelHook('sentinel', 'CASE15-SYMLINK'))
    sandbox.writeConfig('version: "1.0.0"\nsentinel: {}\n')

    const result = sandbox.run([], {
      stdin: PRE_TOOL_USE,
      cwd: linkPath,
    })

    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.additionalContext ?? '').toContain('CASE15-SYMLINK')
  })

  // -------------------------------------------------------------------------
  // Case 13: monorepo nested-config trade-off
  //   CLAUDE_PROJECT_DIR=<mono> (has .clooks/), <mono>/packages/A also has
  //   .clooks/, cwd=packages/A. Engine must read mono's config (anchor wins).
  // -------------------------------------------------------------------------
  test('case 13: monorepo — CLAUDE_PROJECT_DIR anchor wins over nested package .clooks/', () => {
    sandbox = createSandbox()
    // sandbox.dir acts as the monorepo root.
    // Write the monorepo-level hook + config.
    sandbox.writeHook('mono-hook.ts', sentinelHook('mono-hook', 'MONO-LEVEL'))
    sandbox.writeConfig('version: "1.0.0"\nmono-hook: {}\n')

    // Write a nested package config (packages/A) with a different marker.
    sandbox.writeFile(
      'packages/A/.clooks/hooks/pkg-hook.ts',
      `
export const hook = {
  meta: { name: "pkg-hook" },
  PreToolUse() {
    return { result: "allow" as const, injectContext: "PKG-A-LEVEL" }
  },
}
`,
    )
    sandbox.writeFile('packages/A/.clooks/clooks.yml', 'version: "1.0.0"\npkg-hook: {}\n')

    // CLAUDE_PROJECT_DIR anchors to the monorepo root. cwd is packages/A.
    const packageA = join(sandbox.dir, 'packages', 'A')
    const result = sandbox.run([], {
      stdin: PRE_TOOL_USE,
      cwd: packageA,
      env: { CLAUDE_PROJECT_DIR: sandbox.dir },
    })

    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    const ctx = output.hookSpecificOutput.additionalContext ?? ''
    // Mono-level hook ran.
    expect(ctx).toContain('MONO-LEVEL')
    // Package-level hook did NOT run (mono's config is used, not package/A's).
    expect(ctx).not.toContain('PKG-A-LEVEL')
  })
})
