import {
  attachedSchema,
  checkDoneSchema,
  checkInputSchema,
  checkSignal,
  claimSchema,
  digest,
  denial,
  failureOf,
  InteractionError,
  limits,
  questionSchema,
  remaining,
  resumeDeadline,
  replySchema,
  same,
  unavailable,
  userApprovalFailure,
  type Failure,
  type NativePreToolUseDenial,
  type StartPacket,
  type UserApprovalDecision,
} from './protocol.js'
import { openMailbox, runtime, type InteractionRuntime } from './storage.js'
import type {
  ApprovalInteraction,
  ApprovalInteractionOptions,
  ApprovalQuestion,
  ApprovalReply,
} from './types.js'
export type {
  ApprovalInteraction,
  ApprovalInteractionOptions,
  ApprovalQuestion,
  ApprovalReply,
} from './types.js'

export async function createApprovalInteraction(
  options: ApprovalInteractionOptions,
  testing: Partial<InteractionRuntime> = {},
): Promise<ApprovalInteraction> {
  const key = Object.freeze(checkInputSchema.parse(options.identity))
  const clock = runtime(testing)
  checkSignal(options.signal)
  const box = openMailbox(key, clock)
  const claim = box.claim('command', clock.now())
  const start: StartPacket = {
    version: 1,
    key,
    nonce: claim.id,
    pid: claim.pid,
    startedAt: claim.createdAt,
    deadline: claim.createdAt + limits.invocationMs - limits.reserveMs,
    disposition: options.disposition ?? 'run',
  }
  let localDeadline = start.deadline
  let failure: Failure | undefined
  let publicationFailure: { error: unknown } | undefined
  let closed = false
  let pending = false
  let ordinal = 0
  let userRefusal:
    | {
        checkId: string
        ordinal: number
        digest: string
        decision: UserApprovalDecision
        failure: Failure
      }
    | undefined
  let pendingDone: Promise<void> | undefined
  let settlePending: (() => void) | undefined
  const stopped = new AbortController()
  const finish = () => {
    if (closed) return
    closed = true
    try {
      box.publish('done', {
        version: 1,
        key,
        nonce: start.nonce,
        at: clock.now(),
        ...(failure ? { failure } : {}),
      })
    } catch (error) {
      publicationFailure = { error }
      failure ??= failureOf(error)
    } finally {
      stopped.abort()
      options.signal?.removeEventListener('abort', cancel)
    }
  }
  const cancel = () => {
    failure ??= { kind: 'cancelled', message: 'Approval invocation cancelled' }
    finish()
  }
  let election
  try {
    box.publish('start', start)
    election = box.elect({ version: 1, key, nonce: start.nonce, state: 'started' })
    if (election.state === 'started') same(election.nonce, start.nonce, 'start election')
    options.signal?.addEventListener('abort', cancel, { once: true })
    checkSignal(options.signal)
  } catch (error) {
    failure = failureOf(error)
    finish()
    throw error
  }

  const interaction: ApprovalInteraction = {
    async request(question: ApprovalQuestion, signal: AbortSignal): Promise<ApprovalReply> {
      if (failure) return failure
      if (closed) return { kind: 'unavailable', message: 'Approval invocation is closed' }
      if (pending) {
        failure = { kind: 'unavailable', message: 'Concurrent approval requests are not supported' }
        finish()
        return failure
      }
      pending = true
      pendingDone = new Promise<void>((resolve) => {
        settlePending = resolve
      })
      const combined = AbortSignal.any([
        signal,
        stopped.signal,
        ...(options.signal ? [options.signal] : []),
      ])
      try {
        checkSignal(combined)
        remaining(localDeadline, clock.now())
        if (start.disposition !== 'run')
          unavailable('Suppressed invocation cannot request approval')
        if (election.state === 'closed')
          unavailable(
            'MCP check already closed before this command connected; operation was not run',
          )
        const parsed = questionSchema.parse(question)
        if (parsed.ordinal !== ordinal + 1) unavailable('Approval question ordinal mismatch')
        // Snapshot before yielding. No caller mutation can change displayed or accepted input.
        const snapshot = questionSchema.parse(JSON.parse(JSON.stringify(parsed)))
        const questionDigest = digest(snapshot)
        ordinal++
        box.publish(`question-${ordinal}`, {
          version: 1,
          key,
          nonce: start.nonce,
          question: snapshot,
          digest: questionDigest,
        })
        const humanWaitStartedAt = clock.now()
        const attachmentDeadline = Math.min(localDeadline, clock.now() + limits.attachmentMs)
        while (true) {
          checkSignal(combined)
          const attached = box.bound('attached', attachedSchema, start.nonce)
          if (!attached) remaining(localDeadline, clock.now())
          const ended = box.bound('check-done', checkDoneSchema, start.nonce)
          if (ended) {
            const peer = box.bound('check', claimSchema)
            same(ended.checkId, peer?.id, 'check completion')
            throw new InteractionError(
              ended.failure ?? { kind: 'unavailable', message: 'MCP check ended before approval' },
            )
          }
          if (attached) {
            const peer = box.bound('check', claimSchema)
            if (!peer) unavailable('Missing MCP check claim')
            same(attached.checkId, peer.id, 'attachment')
            if (!clock.alive(peer.pid)) unavailable('MCP peer disconnected')
            const reply = box.bound(`reply-${ordinal}`, replySchema, start.nonce)
            if (reply) {
              same(reply.checkId, peer.id, 'reply check')
              same(reply.ordinal, ordinal, 'reply ordinal')
              same(reply.digest, questionDigest, 'displayed operation')
              localDeadline = resumeDeadline(localDeadline, humanWaitStartedAt, clock.now())
              remaining(localDeadline, clock.now())
              checkSignal(combined)
              if (!reply.confirmed) {
                const expected = userApprovalFailure(reply.failure.kind, snapshot.hookName)
                same(reply.failure, expected, 'user refusal')
                failure = expected
                userRefusal = {
                  checkId: peer.id,
                  ordinal,
                  digest: questionDigest,
                  decision: expected.kind,
                  failure: expected,
                }
                finish()
                return { ...expected, userDecision: true }
              }
              return { kind: 'approved' }
            }
          } else if (clock.now() >= attachmentDeadline) {
            unavailable('MCP peer unavailable; run clooks init and restart the client')
          }
          await clock.pause(limits.pollMs, combined)
        }
      } catch (error) {
        failure ??= combined.aborted
          ? { kind: 'cancelled', message: 'Approval interaction cancelled' }
          : failureOf(error)
        finish()
        return failure
      } finally {
        pending = false
        settlePending?.()
      }
    },
    async acknowledgeDenial(decision: UserApprovalDecision, nativeDenial: NativePreToolUseDenial) {
      if (!userRefusal) unavailable('No user approval refusal is awaiting acknowledgement')
      same(decision, userRefusal.decision, 'denial decision')
      same(nativeDenial, denial(userRefusal.failure.message), 'native denial')
      box.publish('denial-ack', {
        version: 1,
        key,
        nonce: start.nonce,
        checkId: userRefusal.checkId,
        ordinal: userRefusal.ordinal,
        digest: userRefusal.digest,
        decision,
        denialDigest: digest(nativeDenial),
        at: clock.now(),
      })
    },
    async close() {
      if (pending)
        failure ??= { kind: 'cancelled', message: 'Approval closed while awaiting consent' }
      try {
        finish()
        if (publicationFailure) throw publicationFailure.error
      } finally {
        await pendingDone
      }
    },
  }
  if (start.disposition === 'suppressed') await interaction.close()
  return interaction
}
