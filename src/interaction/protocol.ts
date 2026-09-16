import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { JsonValue } from '../agents/types.js'
import { isJsonValue } from '../agents/codex/tool-codecs.js'
import { MAX_ASK_QUESTION_LENGTH } from '../engine/ask-question.js'

export const limits = Object.freeze({
  invocationMs: 300_000,
  reserveMs: 5_000,
  discoveryMs: 1_000,
  attachmentMs: 3_000,
  pollMs: 20,
  sdkMs: 325_000,
  packetBytes: 65_536,
  questions: 32,
  retentionMs: 600_000,
  cleanupEntries: 128,
  concurrentChecks: 64,
})

const literal = z
  .string()
  .min(1)
  .max(511)
  .regex(/^(?![\s\S]*\$\{)[\s\S]+$/)
const fields = {
  protocol: z.literal(1),
  provider: z.enum(['claude-code', 'codex']),
  owner: literal.regex(/^(global|project:[A-Za-z0-9_-]+)$/),
  session_id: literal,
  tool_use_id: literal,
  turn_id: literal.optional(),
}
export const checkInputSchema = z.discriminatedUnion('provider', [
  z.strictObject({ ...fields, provider: z.literal('claude-code') }),
  z.strictObject({ ...fields, provider: z.literal('codex'), turn_id: literal }),
])
export type CheckInput = z.infer<typeof checkInputSchema>
// Both runtime parsing and the advertised tool contract come from this schema.
export const checkInputJsonSchema = {
  ...z.toJSONSchema(z.strictObject(fields)),
  type: 'object' as const,
  allOf: [z.toJSONSchema(checkInputSchema)],
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function boundedJson(value: unknown): value is JsonValue {
  const pending = [{ value, depth: 0 }]
  let nodes = 0
  while (pending.length) {
    const item = pending.pop()!
    if (++nodes > 4096 || item.depth > 32) return false
    const current = item.value
    if (current === null || typeof current !== 'object') continue
    const descriptors = Object.getOwnPropertyDescriptors(current)
    if (Reflect.ownKeys(descriptors).length > 4097) return false
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!('value' in descriptor)) return false
      if (Array.isArray(current) && key === 'length') continue
      pending.push({ value: descriptor.value, depth: item.depth + 1 })
    }
  }
  return isJsonValue(value)
}

export const operationSchema = z.strictObject({
  toolName: literal,
  input: z.custom<JsonValue>(boundedJson, 'Operation must be bounded, exact JSON'),
})
export const questionSchema = z.strictObject({
  hookName: literal,
  ordinal: z.number().int().min(1).max(limits.questions),
  question: z
    .string()
    .max(MAX_ASK_QUESTION_LENGTH)
    .refine((value) => /\S/u.test(value))
    .optional(),
  reason: z.string().min(1).max(8192),
  operation: operationSchema,
})
export const failureSchema = z.strictObject({
  kind: z.enum(['declined', 'cancelled', 'unavailable', 'timed-out']),
  message: z.string().min(1).max(2048),
})
export type Failure = z.infer<typeof failureSchema>
const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const nonce = z.uuid()
const base = { version: z.literal(1), key: checkInputSchema }
const bound = { ...base, nonce }
export const claimSchema = z.strictObject({
  ...base,
  id: nonce,
  pid: z.number().int().positive(),
  createdAt: timestamp,
})
export const startSchema = z
  .strictObject({
    ...bound,
    pid: z.number().int().positive(),
    startedAt: timestamp,
    deadline: timestamp,
    disposition: z.enum(['run', 'suppressed']),
  })
  .refine(
    (value) =>
      value.deadline > value.startedAt &&
      value.deadline - value.startedAt <= limits.invocationMs - limits.reserveMs,
  )
export type StartPacket = z.infer<typeof startSchema>
export const electionSchema = z.discriminatedUnion('state', [
  z.strictObject({ ...bound, state: z.literal('started') }),
  z.strictObject({ ...base, state: z.literal('closed'), checkId: nonce, closedAt: timestamp }),
])
export const attachedSchema = z.strictObject({ ...bound, checkId: nonce })
export const questionPacketSchema = z.strictObject({
  ...bound,
  question: questionSchema,
  digest: z.string().regex(/^[a-f0-9]{64}$/),
})
export const replySchema = z.strictObject({
  ...bound,
  checkId: nonce,
  ordinal: z.number().int().min(1).max(limits.questions),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  confirmed: z.boolean(),
})
export const doneSchema = z.strictObject({
  ...bound,
  at: timestamp,
  failure: failureSchema.optional(),
})
export const checkDoneSchema = z.strictObject({
  ...base,
  checkId: nonce,
  nonce: nonce.optional(),
  at: timestamp,
  failure: failureSchema.optional(),
})
export const confirmationSchema = z.strictObject({
  action: z.enum(['accept', 'decline', 'cancel']),
  content: z.strictObject({ decision: z.enum(['Decline', 'Approve']) }).optional(),
  _meta: z.unknown().optional(),
})

export class InteractionError extends Error {
  constructor(readonly failure: Failure) {
    super(failure.message)
  }
}
export function unavailable(message: string): never {
  throw new InteractionError({ kind: 'unavailable', message })
}
export function failureOf(error: unknown): Failure {
  if (error instanceof InteractionError) return error.failure
  return {
    kind: 'unavailable',
    message:
      `Approval transport unavailable: ${error instanceof Error ? error.message : String(error)}`.slice(
        0,
        2048,
      ),
  }
}
export function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex')
}
export function same(actual: unknown, expected: unknown, label: string): void {
  if (canonical(actual) !== canonical(expected)) unavailable(`Approval ${label} mismatch`)
}
export function remaining(deadline: number, now: number): number {
  if (now >= deadline)
    throw new InteractionError({ kind: 'timed-out', message: 'Approval deadline exceeded' })
  return deadline - now
}
export function checkSignal(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new InteractionError({ kind: 'cancelled', message: 'Approval interaction cancelled' })
}
export function denial(message: string) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse' as const,
      permissionDecision: 'deny' as const,
      permissionDecisionReason: message,
    },
  }
}
