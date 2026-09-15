import assert from 'node:assert/strict'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import {
  alive,
  budgets,
  checkpointInputSchema,
  claim,
  coordinationRoot,
  completionOrPeerExit,
  deny,
  identity,
  log,
  mailbox,
  put,
  read,
  rendezvous,
  publishExclusive,
  remaining,
  wait,
} from './channel'

const server = new Server(
  { name: 'm1-checkpoints', version: '1.0.0' },
  { capabilities: { tools: {} } },
)
log('mcp-start', {
  ipcRoot: coordinationRoot(),
  environment: {
    HOME: process.env.HOME,
    CLOOKS_HOME_ROOT: process.env.CLOOKS_HOME_ROOT,
    XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
  },
})
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'check',
      description: 'Illustrative paired native hook',
      inputSchema: checkpointInputSchema,
    },
  ],
}))
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  let output: unknown = {}
  let failed: string | undefined
  let active: any
  let key: ReturnType<typeof identity> | undefined
  let phase: 'start' | 'elicitation' | 'completion' = 'start'
  try {
    assert.equal(request.params.name, 'check')
    assert.equal(request.params.arguments?.protocol, 1)
    key = identity(request.params.arguments)
    log('mcp-call', { key, params: request.params })
    const file = mailbox(key)
    claim(file('mcp'))
    const discoveryStartedAt = Date.now()
    const election = await wait(
      () => {
        const current = rendezvous(file('rendezvous'), key!)
        if (current) return current
        if (Date.now() - discoveryStartedAt < budgets.discovery) return undefined
        return rendezvous(file('rendezvous'), key!, {
          version: 1,
          key: key!,
          state: 'closed',
          pid: process.pid,
          closedAt: Date.now(),
        })
      },
      discoveryStartedAt + budgets.discovery + 2000,
      extra.signal,
    )
    if (election.state === 'closed') {
      log('mcp-unmatched', {
        key,
        closed: election,
        discoveryStartedAt,
        waitedMs: Date.now() - discoveryStartedAt,
      })
      log('mcp-finished', { key, output })
      return { content: [{ type: 'text', text: JSON.stringify(output) }] }
    }
    const start = read(file('start'))
    assert.equal(start.version, 1)
    assert.deepEqual(start.key, key)
    assert.equal(start.nonce, election.nonce)
    assert.ok(Number.isInteger(start.pid) && start.pid > 0)
    assert.ok(Number.isFinite(start.deadline))
    assert.ok(start.disposition === 'run' || start.disposition === 'suppressed')
    failed = file('failed')
    active = start
    publishExclusive(file('attached'), { version: 1, key, nonce: start.nonce, pid: process.pid })
    log('mcp-attached', {
      key,
      nonce: start.nonce,
      disposition: start.disposition,
      ipcRoot: coordinationRoot(),
    })
    for (let ordinal = 1; start.disposition === 'run' && ordinal <= 2; ordinal++) {
      const item = await wait(
        () => {
          const done = completionOrPeerExit(
            () => read(file('done')),
            () => alive(start.pid),
            'Command exited before completion',
          )
          if (done !== undefined) return { done: true }
          return read(file(`ask-${ordinal}`))
        },
        start.deadline,
        extra.signal,
      )
      if (item.done) break
      assert.equal(item.ordinal, ordinal)
      assert.equal(item.nonce, start.nonce)
      log('mcp-prompt', { key, ordinal })
      const peer = new AbortController()
      const watch = setInterval(() => {
        if (!alive(start.pid) && !peer.signal.aborted) {
          log('elicitation-peer-exited', { key, ordinal })
          peer.abort(new Error('Command exited during elicitation'))
        }
      }, budgets.poll)
      let reply
      try {
        phase = 'elicitation'
        const timeout = Math.min(budgets.sdk, remaining(start.deadline))
        log('elicitation-start', { key, ordinal, timeout, deadline: start.deadline })
        reply = await server.elicitInput(
          {
            mode: 'form',
            message: JSON.stringify({ key, ordinal, operation: item.operation }),
            requestedSchema: {
              type: 'object',
              properties: { confirmed: { type: 'boolean' } },
              required: ['confirmed'],
            },
          },
          {
            timeout,
            signal: AbortSignal.any([extra.signal, peer.signal]),
          },
        )
      } finally {
        clearInterval(watch)
      }
      log('mcp-response', { key, ordinal, reply })
      const packet = {
        version: 1,
        key,
        nonce: start.nonce,
        ordinal,
        confirmed: reply.action === 'accept' && reply.content?.confirmed === true,
      }
      if (process.env.APPROVAL_CASE === 'stale') packet.nonce = 'stale-nonce'
      if (process.env.APPROVAL_CASE === 'duplicate' && ordinal === 2) {
        log('duplicate-response-injected', { key, ordinal, original: 1 })
        put(file(`reply-${ordinal}`), read(file('reply-1')))
      } else put(file(`reply-${ordinal}`), packet)
      if (!packet.confirmed) break
    }
    phase = 'completion'
    const done = await wait(
      () =>
        completionOrPeerExit(
          () => read(file('done')),
          () => alive(start.pid),
          'Command exited without output',
        ),
      start.deadline,
      extra.signal,
    )
    if (done.hookSpecificOutput?.permissionDecision === 'deny') output = done
  } catch (error) {
    output = deny(String(error))
    if (failed)
      put(failed, { version: 1, key: active.key, nonce: active.nonce, reason: String(error) })
    log('mcp-error', { key, error: String(error), phase, code: (error as any)?.code })
  }
  log('mcp-finished', { key, output })
  return { content: [{ type: 'text', text: JSON.stringify(output) }] }
})
await server.connect(new StdioServerTransport())
process.stdin.once('end', () => {
  void server.close()
})
