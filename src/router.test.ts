import { describe, expect, test, beforeEach, afterEach, spyOn } from 'bun:test'
import { runCLI, program } from './router.js'

describe('runCLI', () => {
  let exitSpy: ReturnType<typeof spyOn>
  let stdoutSpy: ReturnType<typeof spyOn>
  let stderrSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    exitSpy = spyOn(process, 'exit').mockImplementation((() => {
      throw new Error(`process.exit called`)
    }) as () => never)
    stdoutSpy = spyOn(process.stdout, 'write').mockImplementation(() => true)
    stderrSpy = spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    exitSpy.mockRestore()
    stdoutSpy.mockRestore()
    stderrSpy.mockRestore()
  })

  test('--help exits with 0 and output contains clooks', async () => {
    await runCLI(['--help']).catch(() => {})

    expect(exitSpy).toHaveBeenCalledWith(0)

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    expect(output).toContain('clooks')
    expect(output).toContain('A hook runtime for AI coding agents.')
  })

  test('unknown command exits with non-zero and stderr includes error', async () => {
    await runCLI(['unknown-command']).catch(() => {})

    const exitCode = exitSpy.mock.calls[0]?.[0] as number
    expect(exitCode).toBeGreaterThan(0)

    const errOutput = stderrSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    expect(errOutput).toContain('error')
  })

  test('CancelError results in clean exit(0)', async () => {
    const { CancelError } = await import('./tui/prompts.js')

    const testCmd = program.command('_test-cancel-error').action(() => {
      throw new CancelError()
    })

    try {
      await runCLI(['_test-cancel-error']).catch(() => {})
      expect(exitSpy).toHaveBeenCalledWith(0)
    } finally {
      const cmds = program.commands as import('commander').Command[]
      const idx = cmds.indexOf(testCmd)
      if (idx !== -1) cmds.splice(idx, 1)
    }
  })

  test('unknown errors are re-thrown', async () => {
    const testCmd = program.command('_test-unknown-error').action(() => {
      throw new Error('unexpected boom')
    })

    try {
      await expect(runCLI(['_test-unknown-error'])).rejects.toThrow('unexpected boom')
    } finally {
      const cmds = program.commands as import('commander').Command[]
      const idx = cmds.indexOf(testCmd)
      if (idx !== -1) cmds.splice(idx, 1)
    }
  })

  test('--json global flag is accessible in command action', async () => {
    let jsonFlag: boolean | undefined

    const testCmd = program.command('_test-json-flag').action((_opts, cmd) => {
      jsonFlag = cmd.optsWithGlobals().json === true
    })

    try {
      await runCLI(['--json', '_test-json-flag'])
      expect(jsonFlag).toBe(true)

      jsonFlag = undefined
      await runCLI(['_test-json-flag'])
      expect(jsonFlag).toBeFalse()
    } finally {
      // Clean up: remove the test command
      const cmds = program.commands as import('commander').Command[]
      const idx = cmds.indexOf(testCmd)
      if (idx !== -1) cmds.splice(idx, 1)
    }
  })
})
