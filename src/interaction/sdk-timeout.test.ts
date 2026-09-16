import { expect, spyOn, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { PingRequestSchema } from '@modelcontextprotocol/sdk/types.js'

async function pair() {
  const client = new Client({ name: 'timeout-test-client', version: '1' })
  const server = new Server({ name: 'timeout-test-server', version: '1' }, { capabilities: {} })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  return { client, server }
}

test('SDK null timeout installs no timer while omitted and numeric options retain timers', async () => {
  const { client, server } = await pair()
  const timer = spyOn(globalThis, 'setTimeout')
  try {
    timer.mockClear()
    await client.ping({ timeout: null })
    expect(timer).not.toHaveBeenCalled()

    await client.ping({ timeout: 12_345 })
    expect(timer.mock.calls.map((call) => call[1])).toEqual([12_345])

    timer.mockClear()
    await client.ping()
    expect(timer.mock.calls.map((call) => call[1])).toEqual([60_000])
  } finally {
    timer.mockRestore()
    await Promise.allSettled([client.close(), server.close()])
  }
})

test('SDK null timeout retains AbortSignal cancellation and handler cleanup', async () => {
  const { client, server } = await pair()
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })
  let handlerAborted = false
  server.setRequestHandler(PingRequestSchema, async (_request, extra) => {
    started()
    await new Promise<void>((resolve) =>
      extra.signal.addEventListener(
        'abort',
        () => {
          handlerAborted = true
          resolve()
        },
        { once: true },
      ),
    )
    return {}
  })
  const controller = new AbortController()
  const timer = spyOn(globalThis, 'setTimeout')
  try {
    const request = client.ping({ timeout: null, signal: controller.signal })
    await ready
    expect(timer).not.toHaveBeenCalled()
    controller.abort('cancelled by test')
    await expect(request).rejects.toThrow('cancelled by test')
    await Promise.resolve()
    expect(handlerAborted).toBe(true)
  } finally {
    timer.mockRestore()
    controller.abort()
    await Promise.allSettled([client.close(), server.close()])
  }
})

test('SDK null timeout permits a delayed successful response without installing a timer', async () => {
  const { client, server } = await pair()
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })
  let reply!: () => void
  server.setRequestHandler(PingRequestSchema, async () => {
    started()
    await new Promise<void>((resolve) => {
      reply = resolve
    })
    return {}
  })
  const timer = spyOn(globalThis, 'setTimeout')
  try {
    const request = client.ping({ timeout: null })
    await ready
    expect(timer).not.toHaveBeenCalled()
    await Promise.resolve()
    reply()
    await expect(request).resolves.toEqual({})
  } finally {
    timer.mockRestore()
    reply?.()
    await Promise.allSettled([client.close(), server.close()])
  }
})

test('SDK peer close rejects a pending null-timeout request', async () => {
  const { client, server } = await pair()
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })
  let handlerAborted = false
  server.setRequestHandler(PingRequestSchema, async (_request, extra) => {
    started()
    await new Promise<void>((resolve) =>
      extra.signal.addEventListener(
        'abort',
        () => {
          handlerAborted = true
          resolve()
        },
        { once: true },
      ),
    )
    return {}
  })
  try {
    const request = client.ping({ timeout: null })
    await ready
    await server.close()
    await expect(request).rejects.toThrow('Connection closed')
    expect(handlerAborted).toBe(true)
  } finally {
    await Promise.allSettled([client.close(), server.close()])
  }
})

test('SDK numeric timeout still expires and aborts the pending handler', async () => {
  const { client, server } = await pair()
  let handlerAborted = false
  server.setRequestHandler(PingRequestSchema, async (_request, extra) => {
    await new Promise<void>((resolve) =>
      extra.signal.addEventListener(
        'abort',
        () => {
          handlerAborted = true
          resolve()
        },
        { once: true },
      ),
    )
    return {}
  })
  try {
    await expect(client.ping({ timeout: 20 })).rejects.toThrow('Request timed out')
    await Promise.resolve()
    expect(handlerAborted).toBe(true)
  } finally {
    await Promise.allSettled([client.close(), server.close()])
  }
})
