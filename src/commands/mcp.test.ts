import { describe, expect, test, spyOn } from 'bun:test'
import { PassThrough } from 'node:stream'
import { createMcpCommand } from './mcp.js'

describe('mcp command', () => {
  test('default server action accepts prior cancellation without output or leaked signal listeners', async () => {
    const signals = [process.listeners('SIGINT'), process.listeners('SIGTERM')]
    const stdout = spyOn(process.stdout, 'write').mockImplementation(() => true)
    try {
      await createMcpCommand({ signal: AbortSignal.abort() }).parseAsync([], { from: 'user' })
      expect(stdout).not.toHaveBeenCalled()
      expect([process.listeners('SIGINT'), process.listeners('SIGTERM')]).toEqual(signals)
    } finally {
      stdout.mockRestore()
    }
  })

  test('default server initializes over stdio and awaits cancellation cleanup', async () => {
    const input = new PassThrough()
    const stdin = Object.getOwnPropertyDescriptor(process, 'stdin')!
    const signals = [process.listeners('SIGINT'), process.listeners('SIGTERM')]
    const controller = new AbortController()
    const answered = Promise.withResolvers<void>()
    const chunks: string[] = []
    const stdout = spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      chunks.push(String(chunk))
      answered.resolve()
      return true
    })
    Object.defineProperty(process, 'stdin', { ...stdin, value: input })
    const running = createMcpCommand({
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(2000)]),
    }).parseAsync([], { from: 'user' })
    try {
      input.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: { name: 'command-unit', version: '1' },
          },
        }) + '\n',
      )
      await Promise.race([
        answered.promise,
        running.then(() => {
          throw new Error('Server closed before initialization response')
        }),
      ])
      expect(chunks).toHaveLength(1)
      expect(JSON.parse(chunks[0]!)).toMatchObject({
        jsonrpc: '2.0',
        id: 1,
        result: { serverInfo: { name: 'clooks-approvals' } },
      })
      controller.abort()
      await running
      expect(input.listenerCount('data')).toBe(0)
      expect(input.listenerCount('end')).toBe(0)
      expect(input.listenerCount('error')).toBe(0)
      expect([process.listeners('SIGINT'), process.listeners('SIGTERM')]).toEqual(signals)
    } finally {
      controller.abort()
      await running.catch(() => {})
      Object.defineProperty(process, 'stdin', stdin)
      stdout.mockRestore()
      input.destroy()
    }
  })

  test('default server startup failure propagates without a CLI envelope or signal leaks', async () => {
    const stdin = Object.getOwnPropertyDescriptor(process, 'stdin')!
    const signals = [process.listeners('SIGINT'), process.listeners('SIGTERM')]
    const stdout = spyOn(process.stdout, 'write').mockImplementation(() => true)
    Object.defineProperty(process, 'stdin', {
      configurable: true,
      get() {
        throw new Error('stdin unavailable')
      },
    })
    try {
      await expect(createMcpCommand().parseAsync([], { from: 'user' })).rejects.toThrow(
        'stdin unavailable',
      )
      expect(stdout).not.toHaveBeenCalled()
      expect([process.listeners('SIGINT'), process.listeners('SIGTERM')]).toEqual(signals)
    } finally {
      Object.defineProperty(process, 'stdin', stdin)
      stdout.mockRestore()
    }
  })

  test('awaits server shutdown and passes the exact abort signal', async () => {
    const controller = new AbortController()
    const started = Promise.withResolvers<void>()
    const stopped = Promise.withResolvers<void>()
    let finished = false
    const command = createMcpCommand({ signal: controller.signal }, async (options) => {
      expect(options.signal).toBe(controller.signal)
      started.resolve()
      await stopped.promise
    })
    const running = command.parseAsync([], { from: 'user' }).then(() => {
      finished = true
    })
    await started.promise
    controller.abort()
    await Promise.resolve()
    expect(finished).toBe(false)
    stopped.resolve()
    await running
    expect(finished).toBe(true)
  })

  test('preserves startup failures without emitting a CLI JSON envelope', async () => {
    const stdout = spyOn(process.stdout, 'write').mockImplementation(() => true)
    try {
      const command = createMcpCommand({}, async () => {
        throw new Error('startup failed')
      })
      await expect(command.parseAsync([], { from: 'user' })).rejects.toThrow('startup failed')
      expect(stdout).not.toHaveBeenCalled()
    } finally {
      stdout.mockRestore()
    }
  })

  test('help writes only to stderr and does not start the server', async () => {
    const stdout = spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderr = spyOn(process.stderr, 'write').mockImplementation(() => true)
    let started = false
    try {
      const command = createMcpCommand({}, async () => {
        started = true
      }).exitOverride()
      await expect(command.parseAsync(['--help'], { from: 'user' })).rejects.toThrow()
      expect(started).toBe(false)
      expect(stdout).not.toHaveBeenCalled()
      expect(stderr.mock.calls.map(([text]) => text).join('')).toContain('MCP stdio')
    } finally {
      stdout.mockRestore()
      stderr.mockRestore()
    }
  })
})
