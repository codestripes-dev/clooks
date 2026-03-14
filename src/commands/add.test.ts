import { describe, test, expect, mock, spyOn, beforeEach, afterEach } from 'bun:test'
import { Command } from 'commander'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Mock @clack/prompts to avoid TTY issues in tests
// Note: multiselect starts returning [] so interactive promptMultiSelect returns []
const mockMultiselect = mock(() => Promise.resolve([]))

mock.module('@clack/prompts', () => ({
  intro: mock(),
  outro: mock(),
  spinner: mock(() => ({
    start: mock(),
    stop: mock(),
  })),
  log: {
    success: mock(),
    info: mock(),
    warning: mock(),
    error: mock(),
  },
  text: mock(() => ''),
  select: mock(() => ''),
  multiselect: mockMultiselect,
  confirm: mock(() => true),
  isCancel: mock(() => false),
  cancel: mock(),
}))

// Mock platform.js so tests can control what getHomeDir() returns
// without touching the real home directory.
let _mockHomeDirValue: string | null = null
mock.module('../platform.js', () => ({
  getHomeDir: () => {
    if (_mockHomeDirValue === null) {
      throw new Error('Test error: _mockHomeDirValue not set. Call setMockHomeDir() first.')
    }
    return _mockHomeDirValue
  },
}))

// Import after mocking
import { createAddCommand } from './add.js'

const TEST_GITHUB_URL = 'https://github.com/testowner/testrepo/blob/main/my-hook.ts'
const TEST_REPO_URL = 'https://github.com/testowner/test-pack'

const VALID_HOOK_CONTENT = `
export const hook = {
  meta: { name: "test-hook" },
  PreToolUse() { return { result: "allow" } },
}
`

const INVALID_HOOK_CONTENT = `
export const notAHook = "nope"
`

const VALID_MANIFEST = {
  version: 1,
  name: 'test-pack',
  hooks: {
    'hook-a': { path: 'hooks/hook-a.ts', description: 'Hook A' },
    'hook-b': { path: 'hooks/hook-b.ts', description: 'Hook B' },
  },
}

let tempDir: string
let fakeHomeDir: string
let originalCwd: () => string
let exitSpy: ReturnType<typeof spyOn>
let stdoutSpy: ReturnType<typeof spyOn>
let originalFetch: typeof globalThis.fetch
let originalIsTTY: boolean | undefined

function setMockHomeDir(dir: string) {
  _mockHomeDirValue = dir
}

function createTestProgram() {
  const program = new Command()
  program.exitOverride()
  program.option('--json', 'JSON output')
  program.addCommand(createAddCommand())
  return program
}

function setupClooksYml(content = 'version: "1.0.0"\n') {
  const clooksDir = join(tempDir, '.clooks')
  mkdirSync(clooksDir, { recursive: true })
  writeFileSync(join(clooksDir, 'clooks.yml'), content)
}

function mockFetchOk(content: string) {
  globalThis.fetch = mock(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: () => Promise.resolve(content),
      json: () => Promise.resolve(JSON.parse(content)),
    } as Response),
  ) as unknown as typeof fetch
}

function mockFetchStatus(status: number, statusText: string) {
  globalThis.fetch = mock(() =>
    Promise.resolve({
      ok: false,
      status,
      statusText,
      text: () => Promise.resolve(''),
      json: () => Promise.reject(new Error('not JSON')),
    } as Response),
  ) as unknown as typeof fetch
}

/**
 * Create a fetch mock that returns different responses per URL.
 * urlResponseMap: maps URL substrings to response objects.
 * defaultResponse: fallback if no URL matches.
 */
function mockFetchByUrl(
  urlResponseMap: Record<string, { ok: boolean; status: number; statusText: string; body: string }>,
  defaultResponse?: { ok: boolean; status: number; statusText: string; body: string },
) {
  globalThis.fetch = mock((url: string | URL | Request) => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
    for (const [key, resp] of Object.entries(urlResponseMap)) {
      if (urlStr.includes(key)) {
        return Promise.resolve({
          ok: resp.ok,
          status: resp.status,
          statusText: resp.statusText,
          text: () => Promise.resolve(resp.body),
          json: () =>
            resp.ok
              ? Promise.resolve(JSON.parse(resp.body))
              : Promise.reject(new Error('not JSON')),
        } as Response)
      }
    }
    if (defaultResponse) {
      return Promise.resolve({
        ok: defaultResponse.ok,
        status: defaultResponse.status,
        statusText: defaultResponse.statusText,
        text: () => Promise.resolve(defaultResponse.body),
        json: () =>
          defaultResponse.ok
            ? Promise.resolve(JSON.parse(defaultResponse.body))
            : Promise.reject(new Error('not JSON')),
      } as Response)
    }
    return Promise.reject(new Error(`No mock for URL: ${urlStr}`))
  }) as unknown as typeof fetch
}

/**
 * Build a URL map entry for the pack manifest plus individual hook files.
 * Automatically adds a manifest entry returning VALID_MANIFEST JSON.
 */
function buildPackFetchMap(
  hookFiles: Record<string, { ok: boolean; status: number; statusText: string; body: string }>,
): Record<string, { ok: boolean; status: number; statusText: string; body: string }> {
  return {
    'clooks-pack.json': {
      ok: true,
      status: 200,
      statusText: 'OK',
      body: JSON.stringify(VALID_MANIFEST),
    },
    ...hookFiles,
  }
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'clooks-add-test-'))
  // Set up a fake home dir inside the isolated tempDir so getHomeDir() never
  // touches the real ~/.clooks directory.
  fakeHomeDir = join(tempDir, 'home')
  mkdirSync(fakeHomeDir, { recursive: true })
  setMockHomeDir(fakeHomeDir)

  originalCwd = process.cwd
  process.cwd = () => tempDir
  exitSpy = spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('process.exit called')
  }) as () => never)
  stdoutSpy = spyOn(process.stdout, 'write').mockImplementation(() => true)
  originalFetch = globalThis.fetch
  originalIsTTY = process.stdin.isTTY
  // Default: non-interactive (no TTY in test env)
  Object.defineProperty(process.stdin, 'isTTY', { value: false, writable: true })
  // Reset multiselect mock to return empty array by default
  mockMultiselect.mockImplementation(() => Promise.resolve([]))
})

afterEach(() => {
  _mockHomeDirValue = null
  process.cwd = originalCwd
  exitSpy.mockRestore()
  stdoutSpy.mockRestore()
  globalThis.fetch = originalFetch
  Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, writable: true })
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

describe('clooks add (blob URL)', () => {
  test('happy path: downloads and installs hook, updates clooks.yml with short address', async () => {
    setupClooksYml()
    mockFetchOk(VALID_HOOK_CONTENT)

    const program = createTestProgram()
    await program.parseAsync(['add', TEST_GITHUB_URL], { from: 'user' })

    // File should be written to vendor path
    const vendorPath = join(
      tempDir,
      '.clooks',
      'vendor',
      'github.com',
      'testowner',
      'testrepo',
      'my-hook.ts',
    )
    expect(existsSync(vendorPath)).toBe(true)

    const written = readFileSync(vendorPath, 'utf-8')
    expect(written).toContain('export const hook')

    // clooks.yml should be updated with short address
    const configContent = readFileSync(join(tempDir, '.clooks', 'clooks.yml'), 'utf-8')
    expect(configContent).toContain('my-hook:')
    expect(configContent).toContain('uses: testowner/testrepo:my-hook')
  })

  test('conflict detection: existing hook key in config causes error, no file written', async () => {
    setupClooksYml('version: "1.0.0"\nmy-hook:\n  uses: ./some-hook.ts\n')
    mockFetchOk(VALID_HOOK_CONTENT)

    const program = createTestProgram()
    await program.parseAsync(['add', TEST_GITHUB_URL], { from: 'user' }).catch(() => {})

    expect(exitSpy).toHaveBeenCalledWith(1)

    const vendorPath = join(
      tempDir,
      '.clooks',
      'vendor',
      'github.com',
      'testowner',
      'testrepo',
      'my-hook.ts',
    )
    expect(existsSync(vendorPath)).toBe(false)
  })

  test('fetch 404: descriptive error, no file written, config unchanged', async () => {
    setupClooksYml()
    mockFetchStatus(404, 'Not Found')

    const program = createTestProgram()
    await program.parseAsync(['add', TEST_GITHUB_URL], { from: 'user' }).catch(() => {})

    expect(exitSpy).toHaveBeenCalledWith(1)

    const vendorPath = join(
      tempDir,
      '.clooks',
      'vendor',
      'github.com',
      'testowner',
      'testrepo',
      'my-hook.ts',
    )
    expect(existsSync(vendorPath)).toBe(false)

    // Config should be unchanged
    const configContent = readFileSync(join(tempDir, '.clooks', 'clooks.yml'), 'utf-8')
    expect(configContent).toBe('version: "1.0.0"\n')
  })

  test('fetch 500: descriptive error', async () => {
    setupClooksYml()
    mockFetchStatus(500, 'Internal Server Error')

    const program = createTestProgram()
    await program.parseAsync(['add', TEST_GITHUB_URL], { from: 'user' }).catch(() => {})

    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  test('validation failure: downloaded file cleaned up, config unchanged', async () => {
    setupClooksYml()
    mockFetchOk(INVALID_HOOK_CONTENT)

    const program = createTestProgram()
    await program.parseAsync(['add', TEST_GITHUB_URL], { from: 'user' }).catch(() => {})

    expect(exitSpy).toHaveBeenCalledWith(1)

    // File should be cleaned up
    const vendorPath = join(
      tempDir,
      '.clooks',
      'vendor',
      'github.com',
      'testowner',
      'testrepo',
      'my-hook.ts',
    )
    expect(existsSync(vendorPath)).toBe(false)

    // Config should be unchanged
    const configContent = readFileSync(join(tempDir, '.clooks', 'clooks.yml'), 'utf-8')
    expect(configContent).toBe('version: "1.0.0"\n')
  })

  test('no project config: defaults to global, creates config and installs hook', async () => {
    // Don't set up project clooks.yml — no project config means default to global.
    // getHomeDir() is mocked to return fakeHomeDir (set in beforeEach).
    mockFetchOk(VALID_HOOK_CONTENT)

    const program = createTestProgram()
    await program.parseAsync(['add', TEST_GITHUB_URL], { from: 'user' })

    // Config should have been auto-created at global (fakeHomeDir) location
    const globalConfigPath = join(fakeHomeDir, '.clooks', 'clooks.yml')
    expect(existsSync(globalConfigPath)).toBe(true)
    const configContent = readFileSync(globalConfigPath, 'utf-8')
    expect(configContent).toContain('my-hook:')
    expect(configContent).toContain('uses: testowner/testrepo:my-hook')

    // Vendor file should be at global location
    const vendorPath = join(
      fakeHomeDir,
      '.clooks',
      'vendor',
      'github.com',
      'testowner',
      'testrepo',
      'my-hook.ts',
    )
    expect(existsSync(vendorPath)).toBe(true)
  })

  test('--global flag: vendor file written to ~/.clooks/vendor/, config updated at ~/.clooks/clooks.yml', async () => {
    // Pre-create a global config so we can verify --global targets it
    mkdirSync(join(fakeHomeDir, '.clooks'), { recursive: true })
    writeFileSync(join(fakeHomeDir, '.clooks', 'clooks.yml'), 'version: "1.0.0"\n')

    // Also set up a project config to confirm --global overrides it
    setupClooksYml()
    mockFetchOk(VALID_HOOK_CONTENT)

    const program = createTestProgram()
    await program.parseAsync(['add', '--global', TEST_GITHUB_URL], { from: 'user' })

    // Vendor file should be at global location (fakeHomeDir)
    const vendorPath = join(
      fakeHomeDir,
      '.clooks',
      'vendor',
      'github.com',
      'testowner',
      'testrepo',
      'my-hook.ts',
    )
    expect(existsSync(vendorPath)).toBe(true)

    // Config at global location should have the hook
    const globalConfigContent = readFileSync(join(fakeHomeDir, '.clooks', 'clooks.yml'), 'utf-8')
    expect(globalConfigContent).toContain('my-hook:')
    expect(globalConfigContent).toContain('uses: testowner/testrepo:my-hook')

    // Project config should be unchanged
    const projectConfigContent = readFileSync(join(tempDir, '.clooks', 'clooks.yml'), 'utf-8')
    expect(projectConfigContent).toBe('version: "1.0.0"\n')
  })

  test('--global creates config if it does not exist', async () => {
    // No ~/.clooks/clooks.yml created — getHomeDir() mocked to fakeHomeDir
    mockFetchOk(VALID_HOOK_CONTENT)

    const program = createTestProgram()
    await program.parseAsync(['add', '--global', TEST_GITHUB_URL], { from: 'user' })

    const globalConfigPath = join(fakeHomeDir, '.clooks', 'clooks.yml')
    expect(existsSync(globalConfigPath)).toBe(true)
    const configContent = readFileSync(globalConfigPath, 'utf-8')
    expect(configContent).toContain('my-hook:')
    expect(configContent).toContain('uses: testowner/testrepo:my-hook')
  })

  test('--project flag: vendor file written to .clooks/vendor/, config updated at .clooks/clooks.yml', async () => {
    setupClooksYml()
    mockFetchOk(VALID_HOOK_CONTENT)

    const program = createTestProgram()
    await program.parseAsync(['add', '--project', TEST_GITHUB_URL], { from: 'user' })

    const vendorPath = join(
      tempDir,
      '.clooks',
      'vendor',
      'github.com',
      'testowner',
      'testrepo',
      'my-hook.ts',
    )
    expect(existsSync(vendorPath)).toBe(true)

    const configContent = readFileSync(join(tempDir, '.clooks', 'clooks.yml'), 'utf-8')
    expect(configContent).toContain('my-hook:')
    expect(configContent).toContain('uses: testowner/testrepo:my-hook')
  })

  test('--global and --project together: error (mutually exclusive)', async () => {
    setupClooksYml()
    mockFetchOk(VALID_HOOK_CONTENT)

    // Use JSON mode so the error message is captured via stdout
    const program = createTestProgram()
    await program
      .parseAsync(['--json', 'add', '--global', '--project', TEST_GITHUB_URL], { from: 'user' })
      .catch(() => {})

    expect(exitSpy).toHaveBeenCalledWith(1)
    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    expect(output).toContain('Cannot use both')
  })

  test('neither flag with existing project config: non-interactive defaults to project', async () => {
    // isTTY=false from beforeEach — non-interactive mode
    // promptSelect will use defaultValue='project' and return 'project'
    setupClooksYml()
    mockFetchOk(VALID_HOOK_CONTENT)

    const program = createTestProgram()
    await program.parseAsync(['add', TEST_GITHUB_URL], { from: 'user' })

    // Should install to project (tempDir), not global (fakeHomeDir)
    const vendorPath = join(
      tempDir,
      '.clooks',
      'vendor',
      'github.com',
      'testowner',
      'testrepo',
      'my-hook.ts',
    )
    expect(existsSync(vendorPath)).toBe(true)

    const configContent = readFileSync(join(tempDir, '.clooks', 'clooks.yml'), 'utf-8')
    expect(configContent).toContain('my-hook:')
    expect(configContent).toContain('uses: testowner/testrepo:my-hook')

    // Global config should NOT have the hook
    const globalConfigPath = join(fakeHomeDir, '.clooks', 'clooks.yml')
    expect(existsSync(globalConfigPath)).toBe(false)
  })

  test('JSON mode success: correct envelope structure with address field', async () => {
    setupClooksYml()
    mockFetchOk(VALID_HOOK_CONTENT)

    const program = createTestProgram()
    await program.parseAsync(['--json', 'add', TEST_GITHUB_URL], { from: 'user' })

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    const parsed = JSON.parse(output.trim())

    expect(parsed.ok).toBe(true)
    expect(parsed.command).toBe('add')
    expect(parsed.data.name).toBe('my-hook')
    expect(parsed.data.address).toBe('testowner/testrepo:my-hook')
    expect(parsed.data.url).toBe(TEST_GITHUB_URL)
  })

  test('JSON mode error: correct envelope structure on conflict', async () => {
    // Hook already exists — triggers conflict error
    setupClooksYml('version: "1.0.0"\nmy-hook:\n  uses: ./some-hook.ts\n')
    mockFetchOk(VALID_HOOK_CONTENT)

    const program = createTestProgram()
    await program.parseAsync(['--json', 'add', TEST_GITHUB_URL], { from: 'user' }).catch(() => {})

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    const firstLine = output.trim().split('\n')[0]!
    const parsed = JSON.parse(firstLine)

    expect(parsed.ok).toBe(false)
    expect(parsed.command).toBe('add')
    expect(typeof parsed.error).toBe('string')
    expect(parsed.error.length).toBeGreaterThan(0)
    expect(parsed.error).toContain('already exists')
  })

  test('invalid URL: parse error causes exit 1', async () => {
    setupClooksYml()

    const program = createTestProgram()
    await program.parseAsync(['add', 'not-a-valid-url'], { from: 'user' }).catch(() => {})

    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  test('JSON mode error on 404: envelope has descriptive error', async () => {
    setupClooksYml()
    mockFetchStatus(404, 'Not Found')

    const program = createTestProgram()
    await program.parseAsync(['--json', 'add', TEST_GITHUB_URL], { from: 'user' }).catch(() => {})

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    const firstLine = output.trim().split('\n')[0]!
    const parsed = JSON.parse(firstLine)

    expect(parsed.ok).toBe(false)
    expect(parsed.command).toBe('add')
    expect(parsed.error).toContain('not found')
  })
})

describe('clooks add (pack/repo URL)', () => {
  test('pack happy path: installs all hooks with short addresses using --all', async () => {
    setupClooksYml()
    mockFetchByUrl(
      buildPackFetchMap({
        'hook-a.ts': { ok: true, status: 200, statusText: 'OK', body: VALID_HOOK_CONTENT },
        'hook-b.ts': { ok: true, status: 200, statusText: 'OK', body: VALID_HOOK_CONTENT },
      }),
    )

    const program = createTestProgram()
    await program.parseAsync(['add', '--all', TEST_REPO_URL], { from: 'user' })

    const configContent = readFileSync(join(tempDir, '.clooks', 'clooks.yml'), 'utf-8')
    expect(configContent).toContain('hook-a:')
    expect(configContent).toContain('uses: testowner/test-pack:hook-a')
    expect(configContent).toContain('hook-b:')
    expect(configContent).toContain('uses: testowner/test-pack:hook-b')
  })

  test('--all flag: installs all hooks without prompting', async () => {
    setupClooksYml()
    // Make it interactive to ensure --all skips prompt
    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true })
    mockFetchByUrl(
      buildPackFetchMap({
        'hook-a.ts': { ok: true, status: 200, statusText: 'OK', body: VALID_HOOK_CONTENT },
        'hook-b.ts': { ok: true, status: 200, statusText: 'OK', body: VALID_HOOK_CONTENT },
      }),
    )

    const program = createTestProgram()
    await program.parseAsync(['add', '--all', TEST_REPO_URL], { from: 'user' })

    const configContent = readFileSync(join(tempDir, '.clooks', 'clooks.yml'), 'utf-8')
    expect(configContent).toContain('uses: testowner/test-pack:hook-a')
    expect(configContent).toContain('uses: testowner/test-pack:hook-b')
  })

  test('manifest 404: throws error and exits 1', async () => {
    setupClooksYml()
    mockFetchByUrl({}, { ok: false, status: 404, statusText: 'Not Found', body: '' })

    const program = createTestProgram()
    await program.parseAsync(['add', TEST_REPO_URL], { from: 'user' }).catch(() => {})

    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  test('partial download failure: successful hook registered, failed hook warned', async () => {
    setupClooksYml()
    mockFetchByUrl(
      buildPackFetchMap({
        'hook-a.ts': { ok: true, status: 200, statusText: 'OK', body: VALID_HOOK_CONTENT },
        'hook-b.ts': { ok: false, status: 404, statusText: 'Not Found', body: '' },
      }),
    )

    const program = createTestProgram()
    await program.parseAsync(['add', '--all', TEST_REPO_URL], { from: 'user' })

    const configContent = readFileSync(join(tempDir, '.clooks', 'clooks.yml'), 'utf-8')
    expect(configContent).toContain('uses: testowner/test-pack:hook-a')
    expect(configContent).not.toContain('hook-b:')
  })

  test('all downloads fail: throws error and exits 1', async () => {
    setupClooksYml()
    mockFetchByUrl(
      buildPackFetchMap({
        'hook-a.ts': { ok: false, status: 503, statusText: 'Service Unavailable', body: '' },
        'hook-b.ts': { ok: false, status: 503, statusText: 'Service Unavailable', body: '' },
      }),
    )

    const program = createTestProgram()
    await program.parseAsync(['add', '--all', TEST_REPO_URL], { from: 'user' }).catch(() => {})

    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  test('name conflict auto-adapt: existing hook-a gets full address key, hook-b gets short name', async () => {
    // Pre-populate clooks.yml with hook-a already registered under short name
    setupClooksYml('version: "1.0.0"\nhook-a:\n  uses: some/other:hook-a\n')
    mockFetchByUrl(
      buildPackFetchMap({
        'hook-a.ts': { ok: true, status: 200, statusText: 'OK', body: VALID_HOOK_CONTENT },
        'hook-b.ts': { ok: true, status: 200, statusText: 'OK', body: VALID_HOOK_CONTENT },
      }),
    )

    const program = createTestProgram()
    await program.parseAsync(['add', '--all', TEST_REPO_URL], { from: 'user' })

    const configContent = readFileSync(join(tempDir, '.clooks', 'clooks.yml'), 'utf-8')
    // hook-a's short name conflicts, so it uses full address as key
    expect(configContent).toContain('"testowner/test-pack:hook-a":')
    // hook-b has no conflict, uses short name
    expect(configContent).toContain('hook-b:')
    expect(configContent).toContain('uses: testowner/test-pack:hook-b')
  })

  test('shorthand URL: owner/repo treated as repo URL, pack flow executes', async () => {
    setupClooksYml()
    mockFetchByUrl(
      buildPackFetchMap({
        'hook-a.ts': { ok: true, status: 200, statusText: 'OK', body: VALID_HOOK_CONTENT },
        'hook-b.ts': { ok: true, status: 200, statusText: 'OK', body: VALID_HOOK_CONTENT },
      }),
    )

    const program = createTestProgram()
    await program.parseAsync(['add', '--all', 'testowner/test-pack'], { from: 'user' })

    const configContent = readFileSync(join(tempDir, '.clooks', 'clooks.yml'), 'utf-8')
    expect(configContent).toContain('uses: testowner/test-pack:hook-a')
    expect(configContent).toContain('uses: testowner/test-pack:hook-b')
  })

  test('empty selection: prints message, nothing installed (interactive mode, multiselect returns [])', async () => {
    setupClooksYml()
    // Make it interactive so promptMultiSelect is called
    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true })
    // mockMultiselect is already set to return [] in beforeEach
    mockFetchByUrl(
      buildPackFetchMap({
        'hook-a.ts': { ok: true, status: 200, statusText: 'OK', body: VALID_HOOK_CONTENT },
        'hook-b.ts': { ok: true, status: 200, statusText: 'OK', body: VALID_HOOK_CONTENT },
      }),
    )

    const program = createTestProgram()
    await program.parseAsync(['add', TEST_REPO_URL], { from: 'user' })

    const configContent = readFileSync(join(tempDir, '.clooks', 'clooks.yml'), 'utf-8')
    // No hooks should be registered (only the initial version line)
    expect(configContent).toBe('version: "1.0.0"\n')
  })

  test('non-interactive without --all: lists hooks and returns without installing', async () => {
    setupClooksYml()
    // isTTY=false is set in beforeEach — non-interactive mode
    // But promptMultiSelect in non-interactive mode returns all options (from real prompts.ts)
    // To get "list and exit" behavior, we need isNonInteractive to return true
    // and opts.all to be false. But the real prompts.ts isNonInteractive checks ctx.json || !isTTY.
    // Since isTTY=false, isNonInteractive returns true. But then handleRepoUrl calls
    // promptMultiSelect which auto-selects all (that's the real behavior in non-interactive mode).
    // The "list and exit" branch only fires when isNonInteractive(ctx) && !opts.all.
    // This is covered: isTTY=false, no --all, so it lists hooks and returns.
    mockFetchByUrl(buildPackFetchMap({}))

    const program = createTestProgram()
    await program.parseAsync(['add', TEST_REPO_URL], { from: 'user' })

    // Nothing should be installed — the non-interactive/no-all path lists and exits
    const configContent = readFileSync(join(tempDir, '.clooks', 'clooks.yml'), 'utf-8')
    expect(configContent).toBe('version: "1.0.0"\n')
  })

  test('non-interactive with --all: installs all hooks without prompting', async () => {
    setupClooksYml()
    // isTTY=false from beforeEach — non-interactive
    mockFetchByUrl(
      buildPackFetchMap({
        'hook-a.ts': { ok: true, status: 200, statusText: 'OK', body: VALID_HOOK_CONTENT },
        'hook-b.ts': { ok: true, status: 200, statusText: 'OK', body: VALID_HOOK_CONTENT },
      }),
    )

    const program = createTestProgram()
    await program.parseAsync(['add', '--all', TEST_REPO_URL], { from: 'user' })

    const configContent = readFileSync(join(tempDir, '.clooks', 'clooks.yml'), 'utf-8')
    expect(configContent).toContain('uses: testowner/test-pack:hook-a')
    expect(configContent).toContain('uses: testowner/test-pack:hook-b')
  })

  test('validation warning: hook still registered even if validation fails', async () => {
    setupClooksYml()
    mockFetchByUrl(
      buildPackFetchMap({
        'hook-a.ts': { ok: true, status: 200, statusText: 'OK', body: VALID_HOOK_CONTENT },
        'hook-b.ts': { ok: true, status: 200, statusText: 'OK', body: INVALID_HOOK_CONTENT },
      }),
    )

    const program = createTestProgram()
    await program.parseAsync(['add', '--all', TEST_REPO_URL], { from: 'user' })

    const configContent = readFileSync(join(tempDir, '.clooks', 'clooks.yml'), 'utf-8')
    // Both hooks should be registered despite validation warning on hook-b
    expect(configContent).toContain('uses: testowner/test-pack:hook-a')
    expect(configContent).toContain('uses: testowner/test-pack:hook-b')
  })

  test('JSON mode pack success: correct envelope with hooks array', async () => {
    setupClooksYml()
    mockFetchByUrl(
      buildPackFetchMap({
        'hook-a.ts': { ok: true, status: 200, statusText: 'OK', body: VALID_HOOK_CONTENT },
        'hook-b.ts': { ok: true, status: 200, statusText: 'OK', body: VALID_HOOK_CONTENT },
      }),
    )

    const program = createTestProgram()
    await program.parseAsync(['--json', 'add', '--all', TEST_REPO_URL], { from: 'user' })

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    const parsed = JSON.parse(output.trim())

    expect(parsed.ok).toBe(true)
    expect(parsed.command).toBe('add')
    expect(Array.isArray(parsed.data.hooks)).toBe(true)
    expect(parsed.data.hooks).toHaveLength(2)
    expect(parsed.data.skipped).toHaveLength(0)
  })
})
