import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { loadConfig } from './index.js'
import { DEFAULT_MAX_FAILURES, DEFAULT_MAX_FAILURES_MESSAGE } from './constants.js'
import { hn, ms } from '../test-utils.js'

let tempDir: string
let fakeHome: string | undefined
// Isolate from real ~/.clooks/ config on this machine
const fakeHomeRoot = join(tmpdir(), 'clooks-no-home-' + process.pid)

function makeFakeHome(): string {
  fakeHome = mkdtempSync(join(tmpdir(), 'clooks-home-test-'))
  return fakeHome
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'clooks-config-test-'))
  fakeHome = undefined
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
  if (fakeHome) rmSync(fakeHome, { recursive: true, force: true })
})

function writeConfig(dir: string, filename: string, content: string) {
  const clooksDir = join(dir, '.clooks')
  mkdirSync(clooksDir, { recursive: true })
  writeFileSync(join(clooksDir, filename), content)
}

function writeHookFile(dir: string, hookName: string, source: string) {
  const hooksDir = join(dir, '.clooks', 'hooks')
  mkdirSync(hooksDir, { recursive: true })
  writeFileSync(join(hooksDir, `${hookName}.ts`), source)
}

describe('loadConfig', () => {
  test('loads a valid config from a temp directory', async () => {
    writeConfig(
      tempDir,
      'clooks.yml',
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

    const result = await loadConfig(tempDir, { homeRoot: fakeHomeRoot })
    expect(result).not.toBeNull()
    const config = result!.config
    expect(config.version).toBe('1.0.0')
    expect(config.global).toEqual({
      timeout: ms(30000),
      onError: 'block',
      maxFailures: DEFAULT_MAX_FAILURES,
      maxFailuresMessage: DEFAULT_MAX_FAILURES_MESSAGE,
    })
    expect(Object.keys(config.hooks)).toEqual(['log-bash-commands', 'no-production-writes'])
    expect(config.hooks[hn('log-bash-commands')]!.resolvedPath).toBe(
      '.clooks/hooks/log-bash-commands.ts',
    )
    expect(config.hooks[hn('log-bash-commands')]!.config).toEqual({
      logDir: '.clooks/logs',
    })
    expect(config.hooks[hn('no-production-writes')]!.resolvedPath).toBe(
      '.clooks/hooks/no-production-writes.ts',
    )
    expect(config.events['PreToolUse']!.order).toEqual([
      hn('no-production-writes'),
      hn('log-bash-commands'),
    ])
  })

  test('merges with local overrides', async () => {
    writeConfig(
      tempDir,
      'clooks.yml',
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
      'clooks.local.yml',
      `
lint-guard:
  config:
    strict: false
`,
    )

    const result = await loadConfig(tempDir, { homeRoot: fakeHomeRoot })
    expect(result).not.toBeNull()
    // Local overrides replace atomically — so we get just { strict: false }
    // because hook entries are ATOMIC across layers
    expect(result!.config.hooks[hn('lint-guard')]!.config).toEqual({
      strict: false,
    })
  })

  test('returns null when no config files exist', async () => {
    const result = await loadConfig(tempDir, { homeRoot: fakeHomeRoot })
    expect(result).toBeNull()
  })

  test('ignores missing local file', async () => {
    writeConfig(tempDir, 'clooks.yml', `version: "1.0.0"\n`)
    const result = await loadConfig(tempDir, { homeRoot: fakeHomeRoot })
    expect(result).not.toBeNull()
    expect(result!.config.version).toBe('1.0.0')
  })

  test("all hooks from project config have origin 'project'", async () => {
    writeConfig(
      tempDir,
      'clooks.yml',
      `
version: "1.0.0"
my-hook: {}
`,
    )
    const result = await loadConfig(tempDir, { homeRoot: fakeHomeRoot })
    expect(result).not.toBeNull()
    expect(result!.config.hooks[hn('my-hook')]!.origin).toBe('project')
  })

  test('hasProjectConfig is true when project config exists', async () => {
    writeConfig(tempDir, 'clooks.yml', `version: "1.0.0"\n`)
    const result = await loadConfig(tempDir, { homeRoot: fakeHomeRoot })
    expect(result).not.toBeNull()
    expect(result!.hasProjectConfig).toBe(true)
  })

  test('shadows is empty when no overlapping hooks', async () => {
    writeConfig(tempDir, 'clooks.yml', `version: "1.0.0"\nmy-hook: {}\n`)
    const result = await loadConfig(tempDir, { homeRoot: fakeHomeRoot })
    expect(result).not.toBeNull()
    expect(result!.shadows).toEqual([])
  })

  // --- Three-layer loading tests ---

  test("home config only loads hooks with origin 'home'", async () => {
    // Create a fake home directory
    const fakeHome = mkdtempSync(join(tmpdir(), 'clooks-home-test-'))
    writeConfig(
      fakeHome,
      'clooks.yml',
      `
version: "1.0.0"
security-scanner: {}
`,
    )

    // tempDir has no project config
    const result = await loadConfig(tempDir, { homeRoot: fakeHome })
    expect(result).not.toBeNull()
    expect(result!.config.hooks[hn('security-scanner')]!.origin).toBe('home')
    expect(result!.hasProjectConfig).toBe(false)
    // Home hook path should be resolved relative to homeRoot
    expect(result!.config.hooks[hn('security-scanner')]!.resolvedPath).toBe(
      join(fakeHome, '.clooks/hooks/security-scanner.ts'),
    )

    rmSync(fakeHome, { recursive: true, force: true })
  })

  test('home + project with no overlap merges all hooks', async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'clooks-home-test-'))
    writeConfig(fakeHome, 'clooks.yml', `version: "1.0.0"\nhome-hook: {}\n`)
    writeConfig(tempDir, 'clooks.yml', `version: "1.0.0"\nproject-hook: {}\n`)

    const result = await loadConfig(tempDir, { homeRoot: fakeHome })
    expect(result).not.toBeNull()
    expect(result!.config.hooks[hn('home-hook')]!.origin).toBe('home')
    expect(result!.config.hooks[hn('project-hook')]!.origin).toBe('project')
    expect(result!.shadows).toEqual([])

    rmSync(fakeHome, { recursive: true, force: true })
  })

  test('project hook shadows home hook', async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'clooks-home-test-'))
    writeConfig(
      fakeHome,
      'clooks.yml',
      `
version: "1.0.0"
shared-hook:
  config:
    fromHome: true
`,
    )
    writeConfig(
      tempDir,
      'clooks.yml',
      `
version: "1.0.0"
shared-hook:
  config:
    fromProject: true
`,
    )

    const result = await loadConfig(tempDir, { homeRoot: fakeHome })
    expect(result).not.toBeNull()
    expect(result!.config.hooks[hn('shared-hook')]!.origin).toBe('project')
    expect(result!.config.hooks[hn('shared-hook')]!.config).toEqual({ fromProject: true })
    expect(result!.shadows).toEqual([hn('shared-hook')])

    rmSync(fakeHome, { recursive: true, force: true })
  })

  test('returns null when neither home nor project config exists', async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'clooks-home-test-'))
    const result = await loadConfig(tempDir, { homeRoot: fakeHome })
    expect(result).toBeNull()
    rmSync(fakeHome, { recursive: true, force: true })
  })

  test('returns null when only local config exists', async () => {
    // Only create clooks.local.yml, not clooks.yml
    writeConfig(tempDir, 'clooks.local.yml', `version: "1.0.0"\nmy-hook: {}\n`)

    // Use a nonexistent dir as home so no home config is found either
    const nonexistentHome = join(tmpdir(), 'clooks-nonexistent-home-' + Date.now())
    const result = await loadConfig(tempDir, { homeRoot: nonexistentHome })
    expect(result).toBeNull()
  })

  test('home config missing version → validation error', async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'clooks-home-test-'))
    writeConfig(
      fakeHome,
      'clooks.yml',
      `
security-scanner: {}
`,
    )

    await expect(loadConfig(tempDir, { homeRoot: fakeHome })).rejects.toThrow(
      'missing required "version"',
    )

    rmSync(fakeHome, { recursive: true, force: true })
  })

  test('local override of home hook uses does not affect resolvedPath resolution', async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'clooks-home-test-'))
    // Home hook with explicit uses
    writeConfig(
      fakeHome,
      'clooks.yml',
      `
version: "1.0.0"
security-scanner:
  uses: "./custom/security-scanner.ts"
`,
    )

    // Local override changes the uses field — but resolvedPath should still use the ORIGINAL home uses
    writeConfig(
      tempDir,
      'clooks.local.yml',
      `
security-scanner:
  uses: "./overridden/path.ts"
`,
    )

    const result = await loadConfig(tempDir, { homeRoot: fakeHome })
    expect(result).not.toBeNull()
    expect(result!.config.hooks[hn('security-scanner')]!.origin).toBe('home')
    // resolvedPath should use the ORIGINAL home uses resolved against homeRoot
    expect(result!.config.hooks[hn('security-scanner')]!.resolvedPath).toBe(
      join(fakeHome, 'custom/security-scanner.ts'),
    )

    rmSync(fakeHome, { recursive: true, force: true })
  })

  test('no false shadows when projectRoot equals homeRoot (cwd is ~)', async () => {
    // When the user runs clooks from their home directory, project and home
    // resolve to the same .clooks/clooks.yml. The project layer should be
    // skipped entirely to avoid every hook shadowing itself.
    const fakeHome = mkdtempSync(join(tmpdir(), 'clooks-home-test-'))
    writeConfig(
      fakeHome,
      'clooks.yml',
      `
version: "1.0.0"
my-hook-a: {}
my-hook-b: {}
`,
    )

    // projectRoot === homeRoot — same directory
    const result = await loadConfig(fakeHome, { homeRoot: fakeHome })
    expect(result).not.toBeNull()
    expect(result!.shadows).toEqual([])
    expect(result!.hasProjectConfig).toBe(false)
    // All hooks should be origin "home"
    expect(result!.config.hooks[hn('my-hook-a')]!.origin).toBe('home')
    expect(result!.config.hooks[hn('my-hook-b')]!.origin).toBe('home')

    rmSync(fakeHome, { recursive: true, force: true })
  })

  test('loadConfig: shadow with byte-identical project and home source is suppressed', async () => {
    const homeRoot = makeFakeHome()
    const source = `export const hook = { meta: { name: "shared" } }\n`
    writeConfig(homeRoot, 'clooks.yml', `version: "1.0.0"\nshared: {}\n`)
    writeHookFile(homeRoot, 'shared', source)
    writeConfig(tempDir, 'clooks.yml', `version: "1.0.0"\nshared: {}\n`)
    writeHookFile(tempDir, 'shared', source)

    const result = await loadConfig(tempDir, { homeRoot })
    expect(result).not.toBeNull()
    expect(result!.shadows).toEqual([])
  })

  test('loadConfig: shadow with divergent project source is preserved', async () => {
    const homeRoot = makeFakeHome()
    const homeSource = `export const hook = { meta: { name: "shared" } }\n`
    const projectSource = `export const hook = { meta: { name: "shared" } } // diverged\n`
    writeConfig(homeRoot, 'clooks.yml', `version: "1.0.0"\nshared: {}\n`)
    writeHookFile(homeRoot, 'shared', homeSource)
    writeConfig(tempDir, 'clooks.yml', `version: "1.0.0"\nshared: {}\n`)
    writeHookFile(tempDir, 'shared', projectSource)

    const result = await loadConfig(tempDir, { homeRoot })
    expect(result).not.toBeNull()
    expect(result!.shadows).toContain(hn('shared'))
  })

  test('loadConfig: shadow is preserved when project source file is missing', async () => {
    const homeRoot = makeFakeHome()
    const homeSource = `export const hook = { meta: { name: "shared" } }\n`
    writeConfig(homeRoot, 'clooks.yml', `version: "1.0.0"\nshared: {}\n`)
    writeHookFile(homeRoot, 'shared', homeSource)
    // Register the project hook in YAML but DO NOT write the .ts file
    writeConfig(tempDir, 'clooks.yml', `version: "1.0.0"\nshared: {}\n`)

    const result = await loadConfig(tempDir, { homeRoot })
    expect(result).not.toBeNull()
    expect(result!.shadows).toContain(hn('shared'))
  })

  test('loadConfig: shadow is preserved when home source file is missing', async () => {
    const homeRoot = makeFakeHome()
    const projectSource = `export const hook = { meta: { name: "shared" } }\n`
    writeConfig(homeRoot, 'clooks.yml', `version: "1.0.0"\nshared: {}\n`)
    // Register the home hook but DO NOT write its .ts file
    writeConfig(tempDir, 'clooks.yml', `version: "1.0.0"\nshared: {}\n`)
    writeHookFile(tempDir, 'shared', projectSource)

    const result = await loadConfig(tempDir, { homeRoot })
    expect(result).not.toBeNull()
    expect(result!.shadows).toContain(hn('shared'))
  })

  test('loadConfig: shadow is preserved when sizes match but bytes differ at the last byte', async () => {
    const homeRoot = makeFakeHome()
    // Two equal-length strings differing only at the final character
    const homeSource = `export const hook = { meta: { name: "shared" } } //A`
    const projectSource = `export const hook = { meta: { name: "shared" } } //B`
    expect(homeSource.length).toBe(projectSource.length)
    writeConfig(homeRoot, 'clooks.yml', `version: "1.0.0"\nshared: {}\n`)
    writeHookFile(homeRoot, 'shared', homeSource)
    writeConfig(tempDir, 'clooks.yml', `version: "1.0.0"\nshared: {}\n`)
    writeHookFile(tempDir, 'shared', projectSource)

    const result = await loadConfig(tempDir, { homeRoot })
    expect(result).not.toBeNull()
    expect(result!.shadows).toContain(hn('shared'))
  })

  test('loadConfig: shadow comparison resolves project path against projectRoot, not cwd', async () => {
    // Decision Log entry 4: validateConfig populates resolvedPath as cwd-relative.
    // The filter must re-derive the project path with an explicit projectRoot.
    // This test would fail if the filter ever reverted to using projectEntry.resolvedPath:
    // the project hook is registered via `uses:` pointing into a custom subdir of the
    // project, with no `.clooks/hooks/<name>.ts` file anywhere near cwd. If the filter
    // resolved against cwd (or against the wrong base), the file-not-found path would
    // preserve the shadow even though the bytes are identical.
    const homeRoot = makeFakeHome()
    const source = `export const hook = { meta: { name: "vendored" } }\n`
    writeConfig(
      homeRoot,
      'clooks.yml',
      `version: "1.0.0"\nvendored:\n  uses: ./custom/vendored.ts\n`,
    )
    mkdirSync(join(homeRoot, 'custom'), { recursive: true })
    writeFileSync(join(homeRoot, 'custom', 'vendored.ts'), source)

    writeConfig(
      tempDir,
      'clooks.yml',
      `version: "1.0.0"\nvendored:\n  uses: ./custom/vendored.ts\n`,
    )
    mkdirSync(join(tempDir, 'custom'), { recursive: true })
    writeFileSync(join(tempDir, 'custom', 'vendored.ts'), source)

    const result = await loadConfig(tempDir, { homeRoot })
    expect(result).not.toBeNull()
    expect(result!.shadows).toEqual([])
  })

  test('home-first ordering preserved through full loadConfig pipeline', async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'clooks-home-test-'))
    writeConfig(
      fakeHome,
      'clooks.yml',
      `
version: "1.0.0"
home-hook-a: {}
home-hook-b: {}
`,
    )
    writeConfig(
      tempDir,
      'clooks.yml',
      `
version: "1.0.0"
project-hook-a: {}
project-hook-b: {}
`,
    )

    const result = await loadConfig(tempDir, { homeRoot: fakeHome })
    expect(result).not.toBeNull()
    // Object.entries should preserve insertion order: home hooks first, then project hooks
    const hookNames = Object.keys(result!.config.hooks)
    expect(hookNames).toEqual(['home-hook-a', 'home-hook-b', 'project-hook-a', 'project-hook-b'])
    // Verify origins
    expect(result!.config.hooks[hn('home-hook-a')]!.origin).toBe('home')
    expect(result!.config.hooks[hn('home-hook-b')]!.origin).toBe('home')
    expect(result!.config.hooks[hn('project-hook-a')]!.origin).toBe('project')
    expect(result!.config.hooks[hn('project-hook-b')]!.origin).toBe('project')

    rmSync(fakeHome, { recursive: true, force: true })
  })
})
