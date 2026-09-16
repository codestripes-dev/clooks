import { describe, expect, test, beforeEach, afterEach, spyOn } from 'bun:test'
import { runCLI, program } from './router.js'
import { createMcpCommand } from './commands/mcp.js'
import { KNOWN_COMMANDS } from './known-commands.js'

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

  test('retired approve is absent from command registration, help and dispatch', async () => {
    expect(KNOWN_COMMANDS.has('approve')).toBe(false)
    expect(program.commands.some((command) => command.name() === 'approve')).toBe(false)

    await runCLI(['approve', `ca1_${'a'.repeat(64)}`]).catch(() => {})

    const exitCode = exitSpy.mock.calls[0]?.[0] as number
    expect(exitCode).toBeGreaterThan(0)
    expect(stdoutSpy).not.toHaveBeenCalled()
    expect(stderrSpy.mock.calls.map((call: unknown[]) => String(call[0])).join('')).toContain(
      "unknown command 'approve'",
    )

    stdoutSpy.mockClear()
    stderrSpy.mockClear()
    exitSpy.mockClear()
    await runCLI(['--help']).catch(() => {})
    expect(stdoutSpy.mock.calls.map((call: unknown[]) => String(call[0])).join('')).not.toMatch(
      /^\s+approve(?:\s|$)/m,
    )
  })

  test('mcp help and argument errors leave stdout empty without immediate exit', async () => {
    const previousExitCode = process.exitCode
    try {
      await runCLI(['--json', 'mcp', '--help'])
      expect(process.exitCode).toBe(0)
      expect(stdoutSpy).not.toHaveBeenCalled()
      expect(exitSpy).not.toHaveBeenCalled()
      expect(stderrSpy.mock.calls.map((call: unknown[]) => String(call[0])).join('')).toContain(
        'MCP stdio',
      )

      await runCLI(['mcp', '--not-an-option'])
      expect(process.exitCode).toBe(1)
      expect(stdoutSpy).not.toHaveBeenCalled()
      expect(exitSpy).not.toHaveBeenCalled()
    } finally {
      process.exitCode = previousExitCode ?? 0
    }
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

  test.each([false, true])(
    'MCP root help stays on stderr and stdout is restored (failure=%s)',
    async (failure) => {
      const commands = program.commands as import('commander').Command[]
      const index = commands.findIndex((command) => command.name() === 'mcp')
      const original = commands.splice(index, 1)[0]!
      const command = createMcpCommand({}, async () => {
        program.outputHelp()
        if (failure) throw new Error('server startup failed')
      })
      program.addCommand(command)
      try {
        if (failure) {
          await expect(runCLI(['mcp'])).rejects.toThrow('server startup failed')
        } else {
          await runCLI(['mcp'])
        }
        expect(exitSpy).not.toHaveBeenCalled()
        expect(stdoutSpy).not.toHaveBeenCalled()
        expect(stderrSpy.mock.calls.map((call: unknown[]) => String(call[0])).join('')).toContain(
          'Usage: clooks',
        )

        stdoutSpy.mockClear()
        stderrSpy.mockClear()
        await expect(runCLI(['--help'])).rejects.toThrow('process.exit called')
        expect(exitSpy).toHaveBeenCalledWith(0)
        expect(stderrSpy).not.toHaveBeenCalled()
        expect(stdoutSpy.mock.calls.map((call: unknown[]) => String(call[0])).join('')).toContain(
          'Usage: clooks',
        )
      } finally {
        commands.splice(commands.indexOf(command), 1)
        commands.splice(index, 0, original)
      }
    },
  )

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
