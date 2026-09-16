import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import type { Readable, Writable } from 'node:stream'
import type { CallToolResult, ElicitRequestFormParams } from '@modelcontextprotocol/sdk/types.js'
import type { z } from 'zod'
import type { questionSchema } from './protocol.js'
import {
  checkInputJsonSchema,
  checkInputSchema,
  checkSignal,
  claimSchema,
  confirmationSchema,
  denial,
  digest,
  doneSchema,
  electionSchema,
  failureOf,
  InteractionError,
  limits,
  questionPacketSchema,
  remaining,
  same,
  startSchema,
  unavailable,
  type Failure,
  type StartPacket,
} from './protocol.js'
import {
  closeCleanup,
  openMailbox,
  runtime,
  type InteractionRuntime,
  type Mailbox,
} from './storage.js'

export type ElicitApproval = (
  params: ElicitRequestFormParams,
  options: { signal: AbortSignal; timeout: number },
) => Promise<unknown>

function approvalMessage(question: z.infer<typeof questionSchema>): string {
  return [
    `Hook: ${question.hookName}`,
    `Reason:\n${question.reason}`,
    `Tool: ${question.operation.toolName}`,
    `Input:\n${JSON.stringify(question.operation.input, null, 2)}`,
  ].join('\n\n')
}

function toolResult(output: ReturnType<typeof denial> | Record<string, never>): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(output) }] }
}

export async function handleApprovalCheck(
  input: unknown,
  elicit: ElicitApproval,
  options: { signal?: AbortSignal; runtime?: Partial<InteractionRuntime> } = {},
): Promise<CallToolResult> {
  const clock = runtime(options.runtime)
  let box: Mailbox | undefined
  let claim: ReturnType<Mailbox['claim']> | undefined
  let start: StartPacket | undefined
  let failure: Failure | undefined
  try {
    const key = checkInputSchema.parse(input)
    checkSignal(options.signal)
    box = openMailbox(key, clock)
    claim = box.claim('check', clock.now())
    const discoveryDeadline = clock.now() + limits.discoveryMs
    while (!start) {
      checkSignal(options.signal)
      let election = box.bound('election', electionSchema)
      if (!election && clock.now() >= discoveryDeadline) {
        election = box.elect({
          version: 1,
          key,
          state: 'closed',
          checkId: claim.id,
          closedAt: clock.now(),
        })
      }
      if (election?.state === 'closed') {
        same(election.checkId, claim.id, 'closed check')
        break
      }
      if (election?.state === 'started') {
        start = box.bound('start', startSchema, election.nonce)
        if (!start) unavailable('Missing elected approval start')
        const command = box.bound('command', claimSchema)
        if (!command) unavailable('Missing approval command claim')
        same(start.nonce, command.id, 'command nonce')
        same(start.pid, command.pid, 'command process')
        same(start.startedAt, command.createdAt, 'command start time')
        if (start.startedAt > clock.now()) unavailable('Approval start is in the future')
        break
      }
      await clock.pause(limits.pollMs, options.signal)
    }
    if (start) {
      const completed = () => {
        const done = box!.bound('done', doneSchema, start!.nonce)
        if (done || clock.alive(start!.pid)) return done
        // The command may publish completion between our first read and its exit.
        const final = box!.bound('done', doneSchema, start!.nonce)
        if (final) return final
        unavailable('Approval command exited without completion')
      }
      let ordinal = 1
      let attached = false
      while (true) {
        checkSignal(options.signal)
        const done = completed()
        if (done) {
          if (done.failure) throw new InteractionError(done.failure)
          break
        }
        remaining(start.deadline, clock.now())
        if (!attached) {
          box.publish('attached', { version: 1, key, nonce: start.nonce, checkId: claim.id })
          attached = true
        }
        const question =
          ordinal <= limits.questions
            ? box.bound(`question-${ordinal}`, questionPacketSchema, start.nonce)
            : undefined
        if (!question) {
          await clock.pause(limits.pollMs, options.signal)
          continue
        }
        if (start.disposition !== 'run') unavailable('Question from a suppressed invocation')
        same(question.question.ordinal, ordinal, 'question ordinal')
        same(question.digest, digest(question.question), 'question snapshot')
        const stop = new AbortController()
        const signal = AbortSignal.any([stop.signal, ...(options.signal ? [options.signal] : [])])
        const monitor = (async () => {
          while (true) {
            checkSignal(signal)
            remaining(start!.deadline, clock.now())
            if (completed()) unavailable('Approval command completed during elicitation')
            await clock.pause(limits.pollMs, signal)
          }
        })()
        let response: unknown
        try {
          response = await Promise.race([
            elicit(
              {
                mode: 'form',
                message: approvalMessage(question.question),
                requestedSchema: {
                  type: 'object',
                  properties: {
                    decision: {
                      type: 'string',
                      title: 'Approve this operation?',
                      enum: ['Decline', 'Approve'],
                    },
                  },
                  required: ['decision'],
                },
              },
              { signal, timeout: Math.min(limits.sdkMs, remaining(start.deadline, clock.now())) },
            ),
            monitor,
          ])
        } finally {
          stop.abort()
          await monitor.catch(() => {})
        }
        checkSignal(options.signal)
        remaining(start.deadline, clock.now())
        if (completed()) unavailable('Late approval response after command completion')
        const reply = confirmationSchema.parse(response)
        if (reply.action !== 'accept' || reply.content?.decision !== 'Approve') {
          throw new InteractionError({
            kind:
              reply.action === 'cancel'
                ? 'cancelled'
                : reply.action === 'accept' && !reply.content
                  ? 'unavailable'
                  : 'declined',
            message:
              reply.action === 'cancel'
                ? 'Approval cancelled'
                : 'Approval was not positively confirmed',
          })
        }
        box.publish(`reply-${ordinal}`, {
          version: 1,
          key,
          nonce: start.nonce,
          checkId: claim.id,
          ordinal,
          digest: question.digest,
          confirmed: true,
        })
        ordinal++
      }
    }
  } catch (error) {
    failure = options.signal?.aborted
      ? { kind: 'cancelled', message: 'MCP approval check cancelled or disconnected' }
      : failureOf(error)
  } finally {
    if (box && claim) {
      try {
        box.publish('check-done', {
          version: 1,
          key: box.key,
          checkId: claim.id,
          ...(start ? { nonce: start.nonce } : {}),
          at: clock.now(),
          ...(failure ? { failure } : {}),
        })
      } catch (error) {
        failure ??= failureOf(error)
      }
    }
  }
  return toolResult(failure ? denial(failure.message) : {})
}

export interface ApprovalServerOptions {
  signal?: AbortSignal
  runtime?: Partial<InteractionRuntime>
}

/** Testable with the SDK's in-memory transport; no SDK code loads on the command path. */
export async function createApprovalServer(options: ApprovalServerOptions = {}): Promise<{
  server: Server
  close(): Promise<void>
}> {
  const { Server } = await import('@modelcontextprotocol/sdk/server/index.js')
  const { CallToolRequestSchema, ListToolsRequestSchema } =
    await import('@modelcontextprotocol/sdk/types.js')
  const server = new Server(
    { name: 'clooks-approvals', version: '1.0.0' },
    { capabilities: { tools: {} } },
  )
  const stopped = new AbortController()
  const signal = AbortSignal.any([stopped.signal, ...(options.signal ? [options.signal] : [])])
  const pending = new Set<Promise<CallToolResult>>()
  let closing: Promise<void> | undefined
  const close = () => {
    closing ??= (async () => {
      stopped.abort()
      await Promise.allSettled([...pending])
      try {
        await server.close()
      } finally {
        try {
          closeCleanup()
        } finally {
          options.signal?.removeEventListener('abort', abort)
        }
      }
    })()
    return closing
  }
  const abort = () => {
    void close().catch(() => {})
  }
  server.onclose = abort
  // SDK protocol errors include late cancelled replies, not just transport failure.
  options.signal?.addEventListener('abort', abort, { once: true })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'check',
        description: 'Confirm live Clooks hook approval checkpoints',
        inputSchema: { ...checkInputJsonSchema, type: 'object' as const },
      },
    ],
  }))
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    if (request.params.name !== 'check') return toolResult(denial('Unknown approval tool'))
    if (pending.size >= limits.concurrentChecks)
      return toolResult(denial('Too many active approval checks'))
    const task = handleApprovalCheck(
      request.params.arguments,
      (params, opts) => server.elicitInput(params, opts),
      {
        signal: AbortSignal.any([signal, extra.signal]),
        runtime: options.runtime,
      },
    )
    pending.add(task)
    try {
      return await task
    } finally {
      pending.delete(task)
    }
  })
  if (signal.aborted) await close()
  return { server, close }
}

export async function serveApprovalStreams(
  input: Readable,
  output: Writable,
  options: ApprovalServerOptions = {},
): Promise<void> {
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js')
  const stopped = new AbortController()
  const signal = AbortSignal.any([stopped.signal, ...(options.signal ? [options.signal] : [])])
  const instance = await createApprovalServer({ signal, runtime: options.runtime })
  const stop = () => {
    stopped.abort()
  }
  const finished = new Promise<void>((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true })
    if (signal.aborted) resolve()
  })
  instance.server.onclose = stop
  input.once('end', stop)
  input.once('error', stop)
  try {
    if (!signal.aborted) {
      const transport = new StdioServerTransport(input, output)
      // SDK connect preserves this callback separately from recoverable protocol reports.
      transport.onerror = stop
      await instance.server.connect(transport)
      if (input.readableEnded) stop()
      await finished
    }
  } finally {
    stop()
    try {
      await instance.close()
    } finally {
      input.removeListener('end', stop)
      input.removeListener('error', stop)
    }
  }
}

export async function runApprovalServer(options: { signal?: AbortSignal } = {}): Promise<void> {
  const stopped = new AbortController()
  const stop = () => {
    stopped.abort()
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  try {
    await serveApprovalStreams(process.stdin, process.stdout, {
      signal: AbortSignal.any([stopped.signal, ...(options.signal ? [options.signal] : [])]),
    })
  } finally {
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
  }
}
