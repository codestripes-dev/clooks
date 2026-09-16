import { afterEach, expect, spyOn, test } from 'bun:test'
import { getEventListeners } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HookName } from '../types/branded.js'
import { createApprovalInteraction } from './channel.js'
import { handleApprovalCheck } from './server.js'
import { approvalRoot, Mailbox, runtime } from './storage.js'
import {
  attachedSchema,
  checkDoneSchema,
  checkInputSchema,
  digest,
  doneSchema,
  limits,
  startSchema,
  type CheckInput,
} from './protocol.js'

const homes: string[] = []
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'clooks-interaction-'))
  homes.push(home)
  const key: CheckInput = {
    protocol: 1,
    provider: 'codex',
    owner: 'project:test',
    session_id: 'session',
    turn_id: 'turn',
    tool_use_id: crypto.randomUUID(),
  }
  return { home, key, clock: runtime({ home }), box: () => new Mailbox(approvalRoot(home), key) }
}
function question(ordinal = 1) {
  return {
    hookName: 'guard' as HookName,
    ordinal,
    reason: 'Confirm exact operation',
    operation: { toolName: 'Write', input: { path: 'target', content: 'original' } },
  }
}
const signal = () => new AbortController().signal
const yes = async () => ({ action: 'accept', content: { decision: 'Approve' } })
function output(result: Awaited<ReturnType<typeof handleApprovalCheck>>) {
  const content = result.content[0]
  if (content?.type !== 'text') throw new Error('Missing text result')
  expect(result.isError).not.toBe(true)
  return JSON.parse(content.text)
}
async function until<T>(get: () => T | undefined): Promise<T> {
  const deadline = Date.now() + 1000
  while (Date.now() < deadline) {
    const value = get()
    if (value !== undefined) return value
    await Bun.sleep(1)
  }
  throw new Error('Test barrier timed out')
}

for (const reversed of [false, true])
  test(`two exact approvals and neutral completion, reversed=${reversed}`, async () => {
    const f = fixture()
    let checks = 0
    const runCheck = () =>
      handleApprovalCheck(
        f.key,
        async (params) => {
          const q = question(++checks)
          expect(params.message).toBe(
            `Hook: ${q.hookName}\n\nReason:\n${q.reason}\n\nTool: ${q.operation.toolName}\n\nInput:\n${JSON.stringify(q.operation.input, null, 2)}`,
          )
          return yes()
        },
        { runtime: f.clock },
      )
    const early = reversed ? runCheck() : undefined
    const command = await createApprovalInteraction({ identity: f.key }, f.clock)
    const check = early ?? runCheck()
    expect(await command.request(question(), signal())).toEqual({ kind: 'approved' })
    expect(await command.request(question(2), signal())).toEqual({ kind: 'approved' })
    await command.close()
    expect(output(await check)).toEqual({})
    expect(checks).toBe(2)
  })

test('elicitation presents readable exact arbitrary JSON without internal envelope fields', async () => {
  const f = fixture()
  const q = {
    hookName: 'policy-review' as HookName,
    ordinal: 1,
    reason: 'First reason line\nSecond reason line',
    operation: {
      toolName: 'mcp__arbitrary__operation',
      input: JSON.parse(
        '{"text":"value","count":0,"enabled":false,"empty":null,"nested":{"items":[1,"two",{"three":true}]}}',
      ),
    },
  }
  const command = await createApprovalInteraction({ identity: f.key }, f.clock)
  const check = handleApprovalCheck(
    f.key,
    async (params) => {
      expect(params.message).toBe(
        `Hook: policy-review\n\nReason:\nFirst reason line\nSecond reason line\n\nTool: mcp__arbitrary__operation\n\nInput:\n${JSON.stringify(q.operation.input, null, 2)}`,
      )
      expect(params.message).not.toContain('"ordinal"')
      expect(params.requestedSchema).toEqual({
        type: 'object',
        properties: {
          decision: {
            type: 'string',
            title: 'Approve this operation?',
            enum: ['Decline', 'Approve'],
          },
        },
        required: ['decision'],
      })
      return yes()
    },
    { runtime: f.clock },
  )
  expect(await command.request(q, signal())).toEqual({ kind: 'approved' })
  await command.close()
  expect(output(await check)).toEqual({})
})

test('snapshot is immutable across caller mutation while response is pending', async () => {
  const f = fixture()
  const command = await createApprovalInteraction({ identity: f.key }, f.clock)
  const q = question()
  const pending = command.request(q, signal())
  q.operation.input.content = 'changed'
  f.key.owner = 'global'
  const key = f.box().key
  key.owner = 'project:test'
  const check = handleApprovalCheck(
    key,
    async (params) => {
      expect(params.message).toContain('"content": "original"')
      expect(params.message).not.toContain('changed')
      return yes()
    },
    { runtime: f.clock },
  )
  expect(await pending).toEqual({ kind: 'approved' })
  await command.close()
  expect(output(await check)).toEqual({})
})

for (const disposition of ['run', 'suppressed'] as const)
  test(`${disposition} no-ask close does not wait for attachment`, async () => {
    const f = fixture()
    const noWait = {
      ...f.clock,
      pause: async () => {
        throw new Error('No-ask must not wait')
      },
    }
    const command = await createApprovalInteraction({ identity: f.key, disposition }, noWait)
    await command.close()
    await command.close()
    expect(f.box().bound('done', doneSchema)).toBeDefined()
    const check = await handleApprovalCheck(
      f.key,
      async () => {
        throw new Error('Unexpected question')
      },
      { runtime: noWait },
    )
    expect(output(check)).toEqual({})
    expect((await command.request(question(), signal())).kind).toBe('unavailable')
  })

test('unmatched check closes; late no-ask stays neutral and late ask cannot reopen', async () => {
  const f = fixture()
  let now = 10_000
  const clock = {
    ...f.clock,
    now: () => now,
    pause: async (ms: number) => {
      now += ms
    },
  }
  expect(output(await handleApprovalCheck(f.key, yes, { runtime: clock }))).toEqual({})
  expect(f.box().bound('attached', attachedSchema)).toBeUndefined()
  const command = await createApprovalInteraction({ identity: f.key }, clock)
  const reply = await command.request(question(), signal())
  expect(reply.kind).toBe('unavailable')
  expect('message' in reply && reply.message).toContain('already closed')
  await command.close()
  const g = fixture()
  expect(
    output(await handleApprovalCheck(g.key, yes, { runtime: { ...clock, home: g.home } })),
  ).toEqual({})
  await (await createApprovalInteraction({ identity: g.key }, { ...clock, home: g.home })).close()
  expect(g.box().bound('done', doneSchema)?.failure).toBeUndefined()
})

const nonPositiveResponses: Array<{
  response: unknown
  kind: 'declined' | 'cancelled' | 'unavailable'
}> = [
  { response: null, kind: 'unavailable' },
  { response: {}, kind: 'unavailable' },
  { response: { action: 'unknown' }, kind: 'unavailable' },
  { response: { action: 'decline' }, kind: 'declined' },
  {
    response: { action: 'decline', content: { decision: 'Approve' } },
    kind: 'declined',
  },
  { response: { action: 'cancel' }, kind: 'cancelled' },
  {
    response: { action: 'cancel', content: { decision: 'Approve' } },
    kind: 'cancelled',
  },
  { response: { action: 'accept' }, kind: 'unavailable' },
  { response: { action: 'accept', content: null }, kind: 'unavailable' },
  { response: { action: 'accept', content: {} }, kind: 'unavailable' },
  {
    response: { action: 'accept', content: { decision: 'Decline' } },
    kind: 'declined',
  },
  { response: { action: 'accept', content: { confirmed: true } }, kind: 'unavailable' },
  { response: { action: 'accept', content: { confirmed: false } }, kind: 'unavailable' },
  { response: { action: 'accept', content: { decision: true } }, kind: 'unavailable' },
  { response: { action: 'accept', content: { decision: 'approve' } }, kind: 'unavailable' },
  { response: { action: 'accept', content: { decision: ' Approve ' } }, kind: 'unavailable' },
  { response: { action: 'accept', content: { decision: 'Unknown' } }, kind: 'unavailable' },
  {
    response: { action: 'accept', content: { decision: 'Approve', extra: true } },
    kind: 'unavailable',
  },
  {
    response: { action: 'accept', content: { decision: 'Approve' }, extra: true },
    kind: 'unavailable',
  },
]
for (const { response, kind } of nonPositiveResponses)
  test(`non-positive response cannot approve: ${JSON.stringify(response)}`, async () => {
    const f = fixture()
    const command = await createApprovalInteraction({ identity: f.key }, f.clock)
    const check = handleApprovalCheck(f.key, async () => response, { runtime: f.clock })
    expect((await command.request(question(), signal())).kind).toBe(kind)
    await command.close()
    expect(output(await check).hookSpecificOutput.permissionDecision).toBe('deny')
    expect((await command.request(question(2), signal())).kind).not.toBe('approved')
  })

test('one check cannot respond for overlapping tool calls or owners', async () => {
  const f = fixture()
  const other = { ...f.key, owner: 'global' }
  const first = await createApprovalInteraction({ identity: f.key }, f.clock)
  const second = await createApprovalInteraction({ identity: other }, f.clock)
  const a = handleApprovalCheck(f.key, yes, { runtime: f.clock })
  const b = handleApprovalCheck(other, async () => ({ action: 'decline' }), { runtime: f.clock })
  const [approved, declined] = await Promise.all([
    first.request(question(), signal()),
    second.request(question(), signal()),
  ])
  expect(approved.kind).toBe('approved')
  expect(declined.kind).toBe('declined')
  await first.close()
  await second.close()
  expect(output(await a)).toEqual({})
  expect(output(await b).hookSpecificOutput.permissionDecision).toBe('deny')
})

test('duplicate commands and checks do not replace the original exclusive roles', async () => {
  const f = fixture()
  const command = await createApprovalInteraction({ identity: f.key }, f.clock)
  await expect(createApprovalInteraction({ identity: f.key }, f.clock)).rejects.toThrow()
  const check = handleApprovalCheck(f.key, yes, { runtime: f.clock })
  const duplicate = await handleApprovalCheck(f.key, yes, { runtime: f.clock })
  expect(output(duplicate).hookSpecificOutput.permissionDecision).toBe('deny')
  expect(await command.request(question(), signal())).toEqual({ kind: 'approved' })
  await command.close()
  expect(output(await check)).toEqual({})
})

test('missing attachment and deadline refusal are bounded without real sleeps', async () => {
  const f = fixture()
  let now = 10_000
  const clock = {
    ...f.clock,
    now: () => now,
    pause: async (ms: number) => {
      now += ms
    },
  }
  const command = await createApprovalInteraction({ identity: f.key }, clock)
  expect((await command.request(question(), signal())).kind).toBe('unavailable')
  expect(now).toBe(10_000 + limits.attachmentMs)
  await command.close()
  const g = fixture()
  const expired = await createApprovalInteraction({ identity: g.key }, { ...clock, home: g.home })
  now += limits.invocationMs - limits.reserveMs
  expect((await expired.request(question(), signal())).kind).toBe('timed-out')
  await expired.close()
})

for (const change of ['nonce', 'ordinal', 'digest', 'checkId', 'key', 'version'] as const)
  test(`rejects a crossed reply ${change}`, async () => {
    const f = fixture()
    const command = await createApprovalInteraction({ identity: f.key }, f.clock)
    const box = f.box()
    const start = box.bound('start', startSchema)!
    const peer = box.claim('check', Date.now())
    box.publish('attached', { version: 1, key: f.key, nonce: start.nonce, checkId: peer.id })
    const reply = {
      version: 1,
      key: f.key,
      nonce: start.nonce,
      checkId: peer.id,
      ordinal: 1,
      digest: digest(question()),
      confirmed: true,
    }
    box.publish('reply-1', {
      ...reply,
      [change]:
        change === 'key'
          ? { ...f.key, owner: 'global' }
          : change === 'ordinal' || change === 'version'
            ? 2
            : change === 'digest'
              ? digest({ ...question(), operation: { toolName: 'Read', input: { path: 'other' } } })
              : crypto.randomUUID(),
    })
    const result = await command.request(question(), signal())
    expect(result.kind).toBe('unavailable')
    if (change === 'digest')
      expect('message' in result && result.message).toContain('displayed operation mismatch')
    await command.close()
  })

test('request cancellation closes the peer and cannot accept a late response', async () => {
  const f = fixture()
  const command = await createApprovalInteraction({ identity: f.key }, f.clock)
  const cancel = new AbortController()
  let release!: () => void
  const started = new Promise<void>((resolve) => {
    release = resolve
  })
  const check = handleApprovalCheck(
    f.key,
    async (_params, { signal }) => {
      release()
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      )
      return yes()
    },
    { runtime: f.clock },
  )
  const request = command.request(question(), cancel.signal)
  await started
  cancel.abort()
  expect((await request).kind).toBe('cancelled')
  await command.close()
  expect(output(await check).hookSpecificOutput.permissionDecision).toBe('deny')
  expect(f.box().bound('check-done', checkDoneSchema)?.failure).toBeDefined()
})

test('MCP cancellation notifies the command even while the server PID remains alive', async () => {
  const f = fixture()
  const command = await createApprovalInteraction({ identity: f.key }, f.clock)
  const controller = new AbortController()
  const check = handleApprovalCheck(f.key, yes, { signal: controller.signal, runtime: f.clock })
  controller.abort()
  expect(output(await check).hookSpecificOutput.permissionDecision).toBe('deny')
  expect((await command.request(question(), signal())).kind).toBe('cancelled')
  await command.close()
})

test('closing or issuing simultaneous questions aborts the first pending request', async () => {
  for (const close of [true, false]) {
    const f = fixture()
    const command = await createApprovalInteraction({ identity: f.key }, f.clock)
    const first = command.request(question(), signal())
    if (close) await command.close()
    else expect((await command.request(question(2), signal())).kind).toBe('unavailable')
    expect((await first).kind).not.toBe('approved')
    await command.close()
  }
})

test('public close resolves only after its pending request has settled', async () => {
  const f = fixture()
  const command = await createApprovalInteraction({ identity: f.key }, f.clock)
  let settled = false
  const request = command.request(question(), signal()).then((reply) => {
    settled = true
    return reply
  })
  await command.close()
  expect(settled).toBe(true)
  expect((await request).kind).toBe('cancelled')
})

test('failed done publication still cancels and drains a request with a queued valid accept', async () => {
  const f = fixture()
  const controller = new AbortController()
  let resume!: () => void
  let pausedSignal: AbortSignal | undefined
  const command = await createApprovalInteraction(
    { identity: f.key, signal: controller.signal },
    {
      ...f.clock,
      pause: (_ms, signal) => {
        pausedSignal = signal
        return new Promise<void>((resolve) => {
          resume = resolve
        })
      },
    },
  )
  const box = f.box()
  const start = box.bound('start', startSchema)!
  const peer = box.claim('check', Date.now())
  box.publish('attached', { version: 1, key: f.key, nonce: start.nonce, checkId: peer.id })
  let requestSettled = false
  const request = command.request(question(), signal()).then((reply) => {
    requestSettled = true
    return reply
  })
  box.publish('reply-1', {
    version: 1,
    key: f.key,
    nonce: start.nonce,
    checkId: peer.id,
    ordinal: 1,
    digest: digest(question()),
    confirmed: true,
  })
  const error = new Error('Injected done publication failure')
  const originalPublish = Mailbox.prototype.publish
  const publish = spyOn(Mailbox.prototype, 'publish').mockImplementation(function (
    this: Mailbox,
    name,
    packet,
  ) {
    if (name === 'done') throw error
    originalPublish.call(this, name, packet)
  })
  let closeSettled = false
  const closing = command.close().catch((cause: unknown) => {
    closeSettled = true
    return cause
  })
  try {
    expect(pausedSignal?.aborted).toBe(true)
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
    await Promise.resolve()
    expect(closeSettled).toBe(false)
    resume()
    expect(await closing).toBe(error)
    expect(requestSettled).toBe(true)
    expect((await request).kind).toBe('cancelled')
    expect((await command.request(question(2), signal())).kind).toBe('cancelled')
    await expect(command.close()).rejects.toBe(error)
    expect(publish.mock.calls.filter(([name]) => name === 'done')).toHaveLength(1)
  } finally {
    resume()
    await Promise.allSettled([request, closing])
    publish.mockRestore()
  }
})

test('request preserves its protocol failure when terminal publication also fails', async () => {
  const f = fixture()
  const command = await createApprovalInteraction({ identity: f.key }, f.clock)
  const error = new Error('Injected done publication failure')
  const originalPublish = Mailbox.prototype.publish
  const publish = spyOn(Mailbox.prototype, 'publish').mockImplementation(function (
    this: Mailbox,
    name,
    packet,
  ) {
    if (name === 'done') throw error
    originalPublish.call(this, name, packet)
  })
  try {
    const reply = await command.request(question(2), signal())
    expect(reply.kind).toBe('unavailable')
    expect('message' in reply && reply.message).toContain('question ordinal mismatch')
    await expect(command.close()).rejects.toBe(error)
    expect(await command.request(question(), signal())).toEqual(reply)
  } finally {
    publish.mockRestore()
  }
})

test('check observes command death, but rereads racing terminal completion', async () => {
  for (const terminal of [false, true]) {
    const f = fixture()
    const command = await createApprovalInteraction({ identity: f.key }, f.clock)
    const clock = {
      ...f.clock,
      alive: () => {
        if (terminal) void command.close()
        return false
      },
    }
    const result = output(await handleApprovalCheck(f.key, yes, { runtime: clock }))
    if (terminal) expect(result).toEqual({})
    else expect(result.hookSpecificOutput.permissionDecision).toBe('deny')
    await command.close()
  }
})

test('oversized question, wrong ordinal and suppressed requests cannot reach a prompt', async () => {
  for (const q of [
    question(2),
    {
      ...question(),
      operation: {
        toolName: 'Write',
        input: { path: 'x', content: 'x'.repeat(limits.packetBytes) },
      },
    },
  ]) {
    const f = fixture()
    const command = await createApprovalInteraction({ identity: f.key }, f.clock)
    expect((await command.request(q, signal())).kind).toBe('unavailable')
    await command.close()
  }
})

test('invalid check version or unexpanded identity returns denial as a successful MCP result', async () => {
  const f = fixture()
  for (const identity of [
    { ...f.key, protocol: 2 },
    { ...f.key, tool_use_id: '${tool_use_id}' },
  ]) {
    expect(
      output(await handleApprovalCheck(identity, yes, { runtime: f.clock })).hookSpecificOutput
        .permissionDecision,
    ).toBe('deny')
  }
  expect(checkInputSchema.parse(f.key)).toEqual(f.key)
})

test('peer disappearance during elicitation aborts the active request', async () => {
  const f = fixture()
  const command = await createApprovalInteraction({ identity: f.key }, f.clock)
  let alive = true
  const check = handleApprovalCheck(
    f.key,
    async (_params, { signal }) => {
      alive = false
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      )
      return yes()
    },
    { runtime: { ...f.clock, alive: () => alive } },
  )
  const reply = await command.request(question(), signal())
  expect(reply.kind).toBe('unavailable')
  await command.close()
  expect(output(await check).hookSpecificOutput.permissionDecision).toBe('deny')
})

test('invocation signal publishes cancellation even when no request is pending', async () => {
  const f = fixture()
  const controller = new AbortController()
  const command = await createApprovalInteraction(
    { identity: f.key, signal: controller.signal },
    f.clock,
  )
  controller.abort()
  expect(f.box().bound('done', doneSchema)?.failure?.kind).toBe('cancelled')
  expect((await command.request(question(), signal())).kind).toBe('cancelled')
  await command.close()
  await expect(
    createApprovalInteraction({ identity: fixture().key, signal: AbortSignal.abort() }, f.clock),
  ).rejects.toThrow('cancelled')
})

test('deadline while eliciting aborts SDK work and latches timed-out refusal', async () => {
  const f = fixture()
  let now = Date.now()
  const clock = { ...f.clock, now: () => now }
  const command = await createApprovalInteraction({ identity: f.key }, clock)
  let emitted = false
  const check = handleApprovalCheck(
    f.key,
    async (_params, { signal }) => {
      emitted = true
      now += limits.invocationMs
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      )
      return yes()
    },
    { runtime: clock },
  )
  const request = command.request(question(), signal())
  await until(() => emitted || undefined)
  expect((await request).kind).toBe('timed-out')
  await command.close()
  expect(output(await check).hookSpecificOutput.permissionDecision).toBe('deny')
})
