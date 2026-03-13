import { describe, test, expect, mock, spyOn, beforeEach, afterEach } from 'bun:test'
import { Command } from 'commander'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Mock @clack/prompts to avoid TTY issues in tests
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
  confirm: mock(() => true),
  isCancel: mock(() => false),
  cancel: mock(),
}))

// Import after mocking
import { createAddCommand } from './add.js'

const TEST_GITHUB_URL = 'https://github.com/testowner/testrepo/blob/main/my-hook.ts'

const VALID_HOOK_CONTENT = `
export const hook = {
  meta: { name: "test-hook" },
  PreToolUse() { return { result: "allow" } },
}
`

const INVALID_HOOK_CONTENT = `
export const notAHook = "nope"
`

let tempDir: string
let originalCwd: () => string
let exitSpy: ReturnType<typeof spyOn>
let stdoutSpy: ReturnType<typeof spyOn>
let originalFetch: typeof globalThis.fetch

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
    } as Response),
  ) as unknown as typeof fetch
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'clooks-add-test-'))
  originalCwd = process.cwd
  process.cwd = () => tempDir
  exitSpy = spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('process.exit called')
  }) as () => never)
  stdoutSpy = spyOn(process.stdout, 'write').mockImplementation(() => true)
  originalFetch = globalThis.fetch
})

afterEach(() => {
  process.cwd = originalCwd
  exitSpy.mockRestore()
  stdoutSpy.mockRestore()
  globalThis.fetch = originalFetch
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

describe('clooks add', () => {
  test('happy path: downloads and installs hook, updates clooks.yml', async () => {
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

    // clooks.yml should be updated
    const configContent = readFileSync(join(tempDir, '.clooks', 'clooks.yml'), 'utf-8')
    expect(configContent).toContain('my-hook:')
    expect(configContent).toContain(
      'uses: ./.clooks/vendor/github.com/testowner/testrepo/my-hook.ts',
    )
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

  test('no project: missing project clooks.yml causes error (no home config either)', async () => {
    // Don't set up clooks.yml; also ensure process.cwd is an isolated dir with no parent config
    // The tempDir has no .clooks/clooks.yml, so hasProjectConfig will be false
    // We also need to ensure no home config bleeds in — patch homedir via env
    const origHome = process.env.HOME
    process.env.HOME = join(tempDir, 'fakehome')
    mkdirSync(join(tempDir, 'fakehome'), { recursive: true })

    mockFetchOk(VALID_HOOK_CONTENT)

    const program = createTestProgram()
    try {
      await program.parseAsync(['add', TEST_GITHUB_URL], { from: 'user' }).catch(() => {})
      expect(exitSpy).toHaveBeenCalledWith(1)
    } finally {
      if (origHome === undefined) {
        delete process.env.HOME
      } else {
        process.env.HOME = origHome
      }
    }
  })

  test('JSON mode success: correct envelope structure', async () => {
    setupClooksYml()
    mockFetchOk(VALID_HOOK_CONTENT)

    const program = createTestProgram()
    await program.parseAsync(['--json', 'add', TEST_GITHUB_URL], { from: 'user' })

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    const parsed = JSON.parse(output.trim())

    expect(parsed.ok).toBe(true)
    expect(parsed.command).toBe('add')
    expect(parsed.data.name).toBe('my-hook')
    expect(parsed.data.path).toContain('./.clooks/vendor/github.com/testowner/testrepo/my-hook.ts')
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
