import { describe, test, expect, mock, spyOn, beforeEach, afterEach } from 'bun:test'
import { Command } from 'commander'
import { createConfigCommand } from './config.js'
import { ConfigNotFoundError } from '../config/parse.js'
import type { ClooksConfig } from '../config/types.js'
import type { HookName, Milliseconds } from '../types/branded.js'

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

function makeConfig(overrides?: Partial<ClooksConfig>): ClooksConfig {
  return {
    version: '1.0.0',
    global: {
      timeout: 30000 as Milliseconds,
      onError: 'block',
      maxFailures: 3,
      maxFailuresMessage: 'Too many failures',
    },
    hooks: {
      ['my-hook' as HookName]: {
        resolvedPath: '.clooks/hooks/my-hook.ts',
        config: {},
        parallel: false,
      },
    },
    events: {},
    ...overrides,
  }
}

function createTestProgram(loadConfig: (root: string) => Promise<ClooksConfig>) {
  const program = new Command()
  program.exitOverride()
  program.option('--json', 'JSON output')
  program.addCommand(createConfigCommand(loadConfig))
  return program
}

describe('config command', () => {
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

  test('valid config in human mode shows hook count and timeout', async () => {
    const { log, intro, outro } = await import('@clack/prompts')
    const config = makeConfig()
    const loadConfig = mock().mockResolvedValue(config)

    const program = createTestProgram(loadConfig)
    await program.parseAsync(['config'], { from: 'user' })

    expect(exitSpy).not.toHaveBeenCalled()
    expect(loadConfig).toHaveBeenCalledTimes(1)
    expect(intro).toHaveBeenCalledWith('clooks config')
    expect(log.info).toHaveBeenCalledWith('Hooks: 1 registered')
    expect(log.info).toHaveBeenCalledWith('Timeout: 30000ms')
    expect(log.info).toHaveBeenCalledWith('onError: block')
    expect(log.info).toHaveBeenCalledWith('maxFailures: 3')
    expect(outro).toHaveBeenCalledWith('Done')
  })

  test('valid config with --json outputs JSON envelope with ok:true', async () => {
    const config = makeConfig()
    const loadConfig = mock().mockResolvedValue(config)

    const program = createTestProgram(loadConfig)
    await program.parseAsync(['--json', 'config'], { from: 'user' })

    const output = stdoutSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join('')
    const parsed = JSON.parse(output.trim())

    expect(parsed.ok).toBe(true)
    expect(parsed.command).toBe('config')
    expect(parsed.data.version).toBe('1.0.0')
    expect(parsed.data.hooks).toBe(1)
    expect(parsed.data.timeout).toBe(30000)
    expect(parsed.data.onError).toBe('block')
    expect(parsed.data.maxFailures).toBe(3)
  })

  test('ConfigNotFoundError shows init suggestion', async () => {
    const loadConfig = mock().mockRejectedValue(new ConfigNotFoundError('/path/to/clooks.yml'))

    const program = createTestProgram(loadConfig)
    await program.parseAsync(['config'], { from: 'user' }).catch(() => {})

    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  test('ConfigNotFoundError with --json outputs JSON envelope with ok:false', async () => {
    const loadConfig = mock().mockRejectedValue(new ConfigNotFoundError('/path/to/clooks.yml'))

    const program = createTestProgram(loadConfig)
    await program.parseAsync(['--json', 'config'], { from: 'user' }).catch(() => {})

    expect(exitSpy).toHaveBeenCalledWith(1)

    const output = stdoutSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join('')
    const parsed = JSON.parse(output.trim())

    expect(parsed.ok).toBe(false)
    expect(parsed.command).toBe('config')
    expect(parsed.error).toContain('clooks init')
  })

  test('generic error in human mode exits 1', async () => {
    const loadConfig = mock().mockRejectedValue(new Error('invalid YAML'))

    const program = createTestProgram(loadConfig)
    await program.parseAsync(['config'], { from: 'user' }).catch(() => {})

    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  test('generic error with --json outputs JSON envelope with ok:false', async () => {
    const loadConfig = mock().mockRejectedValue(new Error('invalid YAML'))

    const program = createTestProgram(loadConfig)
    await program.parseAsync(['--json', 'config'], { from: 'user' }).catch(() => {})

    expect(exitSpy).toHaveBeenCalledWith(1)

    const output = stdoutSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join('')
    const parsed = JSON.parse(output.trim())

    expect(parsed.ok).toBe(false)
    expect(parsed.command).toBe('config')
    expect(parsed.error).toContain('invalid YAML')
  })
})
