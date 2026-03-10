import { describe, test, expect, spyOn, beforeEach, afterEach, mock } from 'bun:test'
import { Command } from 'commander'
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Mock @clack/prompts to avoid TTY issues in tests
mock.module('@clack/prompts', () => ({
  intro: mock(),
  outro: mock(),
  log: {
    success: mock(),
    info: mock(),
    warning: mock(),
    error: mock(),
  },
  confirm: mock(() => true),
  isCancel: mock(() => false),
  cancel: mock(),
}))

// Import after mocking
import { createTypesCommand } from './types.js'
import os from 'os'

let tempDir: string
let originalCwd: () => string
let exitSpy: ReturnType<typeof spyOn>
let stdoutSpy: ReturnType<typeof spyOn>

function createTestProgram() {
  const program = new Command()
  program.exitOverride()
  program.option('--json', 'JSON output')
  program.addCommand(createTypesCommand())
  return program
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'clooks-types-test-'))
  originalCwd = process.cwd
  process.cwd = () => tempDir
  exitSpy = spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('process.exit called')
  }) as () => never)
  stdoutSpy = spyOn(process.stdout, 'write').mockImplementation(() => true)
})

afterEach(() => {
  process.cwd = originalCwd
  exitSpy.mockRestore()
  stdoutSpy.mockRestore()
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

describe('clooks types', () => {
  test('writes types.d.ts in project hooks directory', async () => {
    const program = createTestProgram()
    await program.parseAsync(['types'], { from: 'user' })

    const typesPath = join(tempDir, '.clooks', 'hooks', 'types.d.ts')
    expect(existsSync(typesPath)).toBe(true)

    const content = readFileSync(typesPath, 'utf-8')
    expect(content).toContain('ClooksHook')
  })

  test('creates hooks directory if missing', async () => {
    // tempDir starts empty — no .clooks/ directory
    expect(existsSync(join(tempDir, '.clooks'))).toBe(false)

    const program = createTestProgram()
    await program.parseAsync(['types'], { from: 'user' })

    expect(existsSync(join(tempDir, '.clooks', 'hooks'))).toBe(true)
    expect(existsSync(join(tempDir, '.clooks', 'hooks', 'types.d.ts'))).toBe(true)
  })

  test('overwrites existing file', async () => {
    // Pre-create a dummy types.d.ts
    mkdirSync(join(tempDir, '.clooks', 'hooks'), { recursive: true })
    writeFileSync(join(tempDir, '.clooks', 'hooks', 'types.d.ts'), 'dummy content')

    const program = createTestProgram()
    await program.parseAsync(['types'], { from: 'user' })

    const content = readFileSync(join(tempDir, '.clooks', 'hooks', 'types.d.ts'), 'utf-8')
    expect(content).not.toBe('dummy content')
    expect(content).toContain('ClooksHook')
  })

  test('JSON output produces correct envelope', async () => {
    const program = createTestProgram()
    await program.parseAsync(['--json', 'types'], { from: 'user' })

    const output = stdoutSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join('')
    const parsed = JSON.parse(output.trim())

    expect(parsed.ok).toBe(true)
    expect(parsed.command).toBe('types')
    expect(parsed.data.path).toBe('.clooks/hooks/types.d.ts')
  })

  test('version header present in written file', async () => {
    const program = createTestProgram()
    await program.parseAsync(['types'], { from: 'user' })

    const content = readFileSync(join(tempDir, '.clooks', 'hooks', 'types.d.ts'), 'utf-8')
    const firstLine = content.split('\n')[0]
    expect(firstLine!.startsWith('// Clooks v')).toBe(true)
  })
})

describe('clooks types --global', () => {
  let originalHomedir: typeof os.homedir
  let fakeHome: string

  beforeEach(() => {
    fakeHome = join(tempDir, 'fakehome')
    mkdirSync(fakeHome, { recursive: true })
    originalHomedir = os.homedir
    os.homedir = () => fakeHome
  })

  afterEach(() => {
    os.homedir = originalHomedir
  })

  test('writes types.d.ts under home directory', async () => {
    const program = createTestProgram()
    await program.parseAsync(['types', '--global'], { from: 'user' })

    const typesPath = join(fakeHome, '.clooks', 'hooks', 'types.d.ts')
    expect(existsSync(typesPath)).toBe(true)

    const content = readFileSync(typesPath, 'utf-8')
    expect(content).toContain('ClooksHook')
  })

  test('JSON output uses ~ prefix for global path', async () => {
    const program = createTestProgram()
    await program.parseAsync(['--json', 'types', '--global'], { from: 'user' })

    const output = stdoutSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join('')
    const parsed = JSON.parse(output.trim())

    expect(parsed.ok).toBe(true)
    expect(parsed.command).toBe('types')
    expect(parsed.data.path).toBe('~/.clooks/hooks/types.d.ts')
  })
})
