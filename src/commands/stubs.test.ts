import { describe, test, expect, mock, spyOn, beforeEach, afterEach } from 'bun:test'
import { Command } from 'commander'
import { registerStubs } from './stubs.js'

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
}))

function createTestProgram() {
  const program = new Command()
  program.exitOverride()
  program.option('--json', 'JSON output')
  registerStubs(program)
  return program
}

describe('stub commands', () => {
  let exitSpy: ReturnType<typeof spyOn>
  let stdoutSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    exitSpy = spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called')
    }) as () => never)
    stdoutSpy = spyOn(process.stdout, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    exitSpy.mockRestore()
    stdoutSpy.mockRestore()
  })

  for (const name of ['init', 'register', 'test']) {
    test(`"${name}" prints "not yet implemented" and exits 1`, async () => {
      const program = createTestProgram()
      await program.parseAsync([name], { from: 'user' }).catch(() => {})

      expect(exitSpy).toHaveBeenCalledWith(1)
    })

    test(`"${name}" with --json outputs JSON envelope with ok:false`, async () => {
      const program = createTestProgram()
      await program.parseAsync(['--json', name], { from: 'user' }).catch(() => {})

      expect(exitSpy).toHaveBeenCalledWith(1)

      const output = stdoutSpy.mock.calls
        .map((c: unknown[]) => String(c[0]))
        .join('')
      const parsed = JSON.parse(output.trim())

      expect(parsed.ok).toBe(false)
      expect(parsed.command).toBe(name)
      expect(parsed.error).toContain('not yet implemented')
    })

    test(`"${name}" accepts unknown flags without error`, async () => {
      const program = createTestProgram()
      await program.parseAsync([name, '--unknown-flag', '--another'], { from: 'user' }).catch(() => {})

      // Should exit 1 for "not implemented", not for unknown flag parsing error
      expect(exitSpy).toHaveBeenCalledWith(1)
    })
  }
})
