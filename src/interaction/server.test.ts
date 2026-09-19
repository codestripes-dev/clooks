import { afterEach, expect, spyOn, test } from 'bun:test'
import { Dir, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { getEventListeners } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import {
  CallToolResultSchema,
  ElicitRequestSchema,
  type ElicitResult,
} from '@modelcontextprotocol/sdk/types.js'
import type { HookName } from '../types/branded.js'
import { createApprovalInteraction } from './channel.js'
import { createApprovalServer, runApprovalServer, serveApprovalStreams } from './server.js'
import {
  canonical,
  checkInputJsonSchema,
  claimSchema,
  limits,
  type CheckInput,
} from './protocol.js'
import {
  approvalRoot,
  cleanup,
  closeCleanup,
  Mailbox,
  runtime,
  type InteractionRuntime,
} from './storage.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
async function fixture(
  reply: () => Promise<ElicitResult> = async () => ({
    action: 'accept',
    content: { decision: 'Approve' },
  }),
  agent: CheckInput['agent'] = 'codex',
  runtimeOverrides: Partial<InteractionRuntime> = {},
) {
  const home = mkdtempSync(join(tmpdir(), 'clooks-sdk-'))
  cleanups.push(async () => {
    rmSync(home, { recursive: true, force: true })
  })
  const instance = await createApprovalServer({ runtime: { home, ...runtimeOverrides } })
  cleanups.push(() => instance.close())
  const client = new Client(
    { name: 'unit-test', version: '1' },
    { capabilities: { elicitation: { form: {} } } },
  )
  cleanups.push(() => client.close())
  client.setRequestHandler(ElicitRequestSchema, reply)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await instance.server.connect(serverTransport)
  await client.connect(clientTransport)
  const key: CheckInput =
    agent === 'codex'
      ? {
          protocol: 1,
          agent,
          owner: 'project:test',
          session_id: 'session',
          turn_id: 'turn',
          tool_use_id: 'call',
        }
      : {
          protocol: 1,
          agent,
          owner: 'project:test',
          session_id: 'session',
          tool_use_id: 'call',
        }
  return { home, key, client, instance, clientTransport }
}
const question = {
  hookName: 'test-guard' as HookName,
  ordinal: 1,
  reason: 'Confirm',
  operation: { toolName: 'Bash', input: { command: 'never executed by transport' } },
}
const signal = () => new AbortController().signal

test('official SDK initialization, advertised schema, elicitation and neutral completion', async () => {
  const f = await fixture()
  expect(canonical((await f.client.listTools()).tools[0]?.inputSchema)).toBe(
    canonical(checkInputJsonSchema),
  )
  const command = await createApprovalInteraction({ identity: f.key }, { home: f.home })
  const check = f.client.callTool({ name: 'check', arguments: f.key })
  expect(await command.request(question, signal())).toEqual({ kind: 'approved' })
  await command.close()
  expect(await check).toEqual({ content: [{ type: 'text', text: '{}' }] })
})

test('official SDK accepts Claude fieldless confirmation', async () => {
  const f = await fixture(async () => ({ action: 'accept', content: {} }), 'claude-code')
  const command = await createApprovalInteraction({ identity: f.key }, { home: f.home })
  const check = f.client.callTool({ name: 'check', arguments: f.key })
  expect(await command.request(question, signal())).toEqual({ kind: 'approved' })
  await command.close()
  expect(await check).toEqual({ content: [{ type: 'text', text: '{}' }] })
})

for (const agent of ['claude-code', 'codex'] as const)
  test(`official SDK pairs a ${agent} command starting 1226ms after its check`, async () => {
    let now = 10_000
    let pauses = 0
    const firstEntered = Promise.withResolvers<void>()
    const firstRelease = Promise.withResolvers<void>()
    const secondEntered = Promise.withResolvers<void>()
    const secondRelease = Promise.withResolvers<void>()
    const pause = async () => {
      pauses++
      if (pauses === 1) {
        firstEntered.resolve()
        await firstRelease.promise
        return
      }
      if (pauses === 2) {
        secondEntered.resolve()
        await secondRelease.promise
        return
      }
      await Bun.sleep(0)
    }
    const f = await fixture(
      async (): Promise<ElicitResult> =>
        agent === 'claude-code'
          ? { action: 'accept', content: {} }
          : { action: 'accept', content: { decision: 'Approve' } },
      agent,
      { now: () => now, pause },
    )
    const check = f.client.callTool({ name: 'check', arguments: f.key })
    let command: Awaited<ReturnType<typeof createApprovalInteraction>> | undefined
    try {
      await firstEntered.promise
      expect(new Mailbox(approvalRoot(f.home), f.key).bound('check', claimSchema)).toBeDefined()
      now += 1_226
      firstRelease.resolve()
      expect(
        await Promise.race([
          secondEntered.promise.then(() => 'waiting' as const),
          check.then(() => 'closed' as const),
        ]),
      ).toBe('waiting')
      command = await createApprovalInteraction(
        { identity: f.key },
        { home: f.home, now: () => now, pause },
      )
      secondRelease.resolve()
      expect(await command.request(question, signal())).toEqual({ kind: 'approved' })
      await command.close()
      expect(await check).toEqual({ content: [{ type: 'text', text: '{}' }] })
    } finally {
      firstRelease.resolve()
      secondRelease.resolve()
      await command?.close()
    }
  })

test('invalid check and unknown tool return successful denial JSON, not isError', async () => {
  const f = await fixture()
  for (const params of [
    { name: 'check', arguments: { ...f.key, protocol: 2 } },
    { name: 'check', arguments: { ...f.key, turn_id: undefined } },
    { name: 'other', arguments: {} },
  ]) {
    const result = await f.client.callTool(params)
    expect(result.isError).not.toBe(true)
    expect(JSON.stringify(result)).toContain('permissionDecision')
    expect(JSON.stringify(result)).toContain('deny')
  }
})

test('SDK missing-confirmation rejection closes the live check and command', async () => {
  const f = await fixture(async () => ({ action: 'accept', content: {} }))
  const command = await createApprovalInteraction({ identity: f.key }, { home: f.home })
  const check = f.client.callTool({ name: 'check', arguments: f.key })
  expect((await command.request(question, signal())).kind).toBe('unavailable')
  await command.close()
  const result = await check
  expect(result.isError).not.toBe(true)
  expect(JSON.stringify(result)).toContain('deny')
})

test('SDK disconnect notifies an attached command and drains the active check', async () => {
  let prompted!: () => void
  const prompt = new Promise<void>((resolve) => {
    prompted = resolve
  })
  const f = await fixture(async () => {
    prompted()
    return new Promise(() => {})
  })
  const command = await createApprovalInteraction({ identity: f.key }, { home: f.home })
  const check = f.client.callTool({ name: 'check', arguments: f.key }).catch(() => undefined)
  const request = command.request(question, signal())
  await prompt
  await f.client.close()
  await f.instance.close()
  expect((await request).kind).toBe('cancelled')
  await command.close()
  await check
})

test('late SDK response for cancelled A cannot cancel pending check B', async () => {
  const f = await fixture()
  const answers = new Map<string, (answer: ElicitResult) => void>()
  const ids = new Map<string, string | number>()
  let prompted!: () => void
  const bothPrompted = new Promise<void>((resolve) => {
    prompted = resolve
  })
  let cancelled!: () => void
  const aCancelled = new Promise<void>((resolve) => {
    cancelled = resolve
  })
  f.client.setRequestHandler(ElicitRequestSchema, (request) => {
    const reason = request.params.message.startsWith('A\n\n') ? 'A' : 'B'
    return new Promise<ElicitResult>((resolve) => {
      answers.set(reason, resolve)
      if (answers.size === 2) prompted()
    })
  })
  const originalMessage = f.clientTransport.onmessage
  f.clientTransport.onmessage = (message, extra) => {
    if ('method' in message && message.method === 'elicitation/create' && 'id' in message)
      ids.set(String(message.params?.message).startsWith('A\n\n') ? 'A' : 'B', message.id)
    if (
      'method' in message &&
      message.method === 'notifications/cancelled' &&
      message.params?.requestId === ids.get('A')
    )
      cancelled()
    originalMessage?.(message, extra)
  }
  const reports: Error[] = []
  const originalError = f.instance.server.onerror
  f.instance.server.onerror = (error) => {
    reports.push(error)
    originalError?.(error)
  }
  const keyB = { ...f.key, tool_use_id: 'call-B' }
  const commandA = await createApprovalInteraction({ identity: f.key }, { home: f.home })
  const commandB = await createApprovalInteraction({ identity: keyB }, { home: f.home })
  const cancelA = new AbortController()
  const checkA = f.client.callTool({ name: 'check', arguments: f.key }).catch(() => undefined)
  const checkB = f.client.callTool({ name: 'check', arguments: keyB }).catch(() => undefined)
  const requestA = commandA.request({ ...question, reason: 'A' }, cancelA.signal)
  const requestB = commandB.request({ ...question, reason: 'B' }, signal())
  try {
    await bothPrompted
    cancelA.abort()
    expect((await requestA).kind).toBe('cancelled')
    await aCancelled
    await checkA
    await f.clientTransport.send({
      jsonrpc: '2.0',
      id: ids.get('A')!,
      result: { action: 'accept', content: { decision: 'Approve' } },
    })
    expect(reports).toHaveLength(1)
    expect(reports[0]?.message).toContain('unknown message ID')
    answers.get('B')!({ action: 'accept', content: { decision: 'Approve' } })
    expect(await requestB).toEqual({ kind: 'approved' })
    await commandB.close()
    expect(await checkB).toEqual({ content: [{ type: 'text', text: '{}' }] })
    expect(await f.client.ping()).toEqual({})
  } finally {
    for (const answer of answers.values()) answer({ action: 'cancel' })
    await commandA.close()
    await commandB.close()
    await Promise.allSettled([requestA, requestB, checkA, checkB])
  }
})

test('server bounds simultaneous active checks and drains all on close', async () => {
  const f = await fixture()
  const pending = Array.from({ length: limits.concurrentChecks }, (_, n) =>
    f.client
      .callTool({ name: 'check', arguments: { ...f.key, tool_use_id: `call-${n}` } })
      .catch(() => undefined),
  )
  const overflow = await f.client.callTool({
    name: 'check',
    arguments: { ...f.key, tool_use_id: 'overflow' },
  })
  expect(JSON.stringify(overflow)).toContain('Too many active approval checks')
  await f.instance.close()
  await Promise.all(pending)
})

test('stdio writes only protocol JSON and closes on EOF without client process death', async () => {
  const input = new PassThrough(),
    output = new PassThrough()
  let text = ''
  output.on('data', (chunk: Buffer) => {
    text += chunk.toString()
  })
  let answered!: () => void
  const answer = new Promise<void>((resolve) => {
    answered = resolve
  })
  output.once('data', () => answered())
  const running = serveApprovalStreams(input, output)
  input.write(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'unit', version: '1' },
      },
    }) + '\n',
  )
  await answer
  input.end()
  await running
  const lines = text
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  expect(lines).toHaveLength(1)
  expect(lines[0].jsonrpc).toBe('2.0')
  expect(lines[0].result.serverInfo.name).toBe('clooks-approvals')
  expect(input.listenerCount('data')).toBe(0)
  expect(input.listenerCount('end')).toBe(0)
})

test('stdio stops on malformed input and explicit cancellation without stdout diagnostics', async () => {
  for (const malformed of [true, false]) {
    const input = new PassThrough(),
      output = new PassThrough()
    const controller = new AbortController()
    let text = ''
    output.on('data', (chunk: Buffer) => {
      text += chunk.toString()
    })
    const running = serveApprovalStreams(input, output, { signal: controller.signal })
    if (malformed) input.write('not-json\n')
    else controller.abort()
    await running
    expect(text).toBe('')
  }
})

test('already-cancelled public server mode returns without touching stdout or leaking signals', async () => {
  const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]
  await runApprovalServer({ signal: AbortSignal.abort() })
  expect([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]).toEqual(before)
})

test('public server signal callback stops without leaking process listeners', async () => {
  const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]
  const previous = new Set(process.rawListeners('SIGTERM'))
  const running = runApprovalServer()
  const stop = process.rawListeners('SIGTERM').find((listener) => !previous.has(listener))
  expect(stop).toBeDefined()
  // Invoke only this server's once-handler, not unrelated process signal handlers.
  stop!.call(process, 'SIGTERM')
  await running
  expect([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]).toEqual(before)
})

test('check completion publication failure returns denial instead of neutral success', async () => {
  const f = await fixture()
  const command = await createApprovalInteraction({ identity: f.key }, { home: f.home })
  await command.close()
  const box = new Mailbox(approvalRoot(f.home), f.key)
  mkdirSync(join(box.directory, 'check-done.json'))
  const result = CallToolResultSchema.parse(
    await f.client.callTool({ name: 'check', arguments: f.key }),
  )
  expect(result.isError).not.toBe(true)
  const content = result.content[0]
  expect(content?.type).toBe('text')
  if (content?.type !== 'text') throw new Error('Missing denial text')
  const output = JSON.parse(content.text)
  expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
  expect(output.hookSpecificOutput.permissionDecisionReason).toContain('EEXIST')
})

test('server close rejection still releases the cleanup cursor and abort listener', async () => {
  const home = mkdtempSync(join(tmpdir(), 'clooks-close-fault-'))
  const controller = new AbortController()
  const instance = await createApprovalServer({ signal: controller.signal })
  const error = new Error('Injected SDK close failure')
  const closing = spyOn(instance.server, 'close').mockRejectedValue(error)
  const closedDirectory = spyOn(Dir.prototype, 'closeSync')
  try {
    closeCleanup()
    closedDirectory.mockClear()
    for (let n = 0; n <= limits.cleanupEntries; n++) mkdirSync(join(home, `entry-${n}`))
    cleanup(home, runtime({ home }))
    expect(closedDirectory).not.toHaveBeenCalled()
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(1)
    controller.abort()
    await expect(instance.close()).rejects.toBe(error)
    expect(closedDirectory).toHaveBeenCalledTimes(1)
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
  } finally {
    closing.mockRestore()
    closedDirectory.mockRestore()
    await instance.server.close()
    closeCleanup()
    rmSync(home, { recursive: true, force: true })
  }
})

test('stdio close rejection still removes EOF and error listeners', async () => {
  const input = new PassThrough(),
    output = new PassThrough()
  const controller = new AbortController()
  const error = new Error('Injected transport close failure')
  const originalClose = Server.prototype.close
  const closing = spyOn(Server.prototype, 'close').mockImplementation(async function (
    this: Server,
  ) {
    await originalClose.call(this)
    throw error
  })
  try {
    const listening = new Promise<void>((resolve) => input.once('newListener', () => resolve()))
    const running = serveApprovalStreams(input, output, { signal: controller.signal })
    await listening
    controller.abort()
    await expect(running).rejects.toBe(error)
    expect(input.listenerCount('end')).toBe(0)
    expect(input.listenerCount('error')).toBe(0)
    expect(input.listenerCount('data')).toBe(0)
  } finally {
    closing.mockRestore()
    input.destroy()
    output.destroy()
  }
})
