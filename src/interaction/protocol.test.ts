import { expect, test } from 'bun:test'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv'
import {
  canonical,
  checkInputJsonSchema,
  checkInputSchema,
  confirmationSchema,
  denial,
  denialAckSchema,
  digest,
  failureOf,
  limits,
  operationSchema,
  questionSchema,
  remaining,
  resumeDeadline,
  same,
  startSchema,
  userApprovalFailure,
} from './protocol.js'

const key = {
  protocol: 1,
  provider: 'codex',
  owner: 'project:test',
  session_id: 'session',
  turn_id: 'turn',
  tool_use_id: 'call',
} as const
test('canonical provider and literal native identity are required', () => {
  expect(checkInputSchema.parse(key)).toEqual(key)
  for (const field of Object.keys(key)) {
    expect(checkInputSchema.safeParse({ ...key, [field]: undefined }).success).toBe(false)
    expect(checkInputSchema.safeParse({ ...key, [field]: '${value}' }).success).toBe(false)
  }
  for (const change of [
    { protocol: 2 },
    { provider: 'claude' },
    { owner: 'project:' },
    { owner: '../global' },
    { extra: true },
  ]) {
    expect(checkInputSchema.safeParse({ ...key, ...change }).success).toBe(false)
  }
  expect(
    checkInputSchema.parse({ ...key, provider: 'claude-code', turn_id: undefined }).provider,
  ).toBe('claude-code')
  expect(checkInputJsonSchema.required).toContain('protocol')
})

test('advertised root-object tool schema agrees with parser for both providers', () => {
  expect(checkInputJsonSchema.type).toBe('object')
  expect(checkInputJsonSchema.properties?.turn_id).toBeDefined()
  const validator = new AjvJsonSchemaValidator()
  const validate = validator.getValidator(
    checkInputJsonSchema as unknown as Parameters<typeof validator.getValidator>[0],
  )
  for (const provider of ['claude-code', 'codex', 'claude']) {
    for (const turn_id of [undefined, 'turn', '', '${turn_id}']) {
      for (const protocol of [undefined, 1, 2, '1']) {
        const input = JSON.parse(JSON.stringify({ ...key, provider, turn_id, protocol }))
        expect(validate(input).valid).toBe(checkInputSchema.safeParse(input).success)
      }
    }
  }
})

test('canonical identity is structured, ordered and separated by all native fields', () => {
  expect(digest({ b: 2, a: 1 })).toBe(digest({ a: 1, b: 2 }))
  expect(canonical({ optional: undefined })).toBe('{}')
  expect(() => same({ a: 1 }, { a: 2 }, 'identity')).toThrow('identity mismatch')
  for (const field of ['provider', 'owner', 'session_id', 'turn_id', 'tool_use_id']) {
    expect(digest({ ...key, [field]: 'different' })).not.toBe(digest(key))
  }
})

test('exact operation validation retains opaque keys and non-record JSON', () => {
  const alias = { value: 'shared' }
  expect(
    operationSchema.parse({ toolName: 'tool', input: { first: alias, second: alias } }).input,
  ).toEqual({ first: alias, second: alias })
  for (const input of [null, [1, 'x', false], JSON.parse('{"__proto__":{"safe":true}}')]) {
    expect(operationSchema.parse({ toolName: 'mcp__server__tool', input }).input).toEqual(input)
  }
  const circular: Record<string, unknown> = {}
  circular.self = circular
  const getter = Object.defineProperty({}, 'value', {
    enumerable: true,
    get() {
      throw new Error('not JSON')
    },
  })
  const hidden = Object.defineProperty({}, 'value', { value: 1, enumerable: false })
  const arrayProperty = Object.assign([1], { extra: 2 })
  const hiddenIndex = Object.defineProperty([1], '0', { value: 1, enumerable: false })
  for (const input of [
    undefined,
    NaN,
    Infinity,
    new Date(),
    () => {},
    circular,
    getter,
    hidden,
    arrayProperty,
    hiddenIndex,
    [undefined],
    Array(2),
    { x: Symbol() },
    { [Symbol()]: 1 },
  ]) {
    expect(operationSchema.safeParse({ toolName: 'tool', input }).success).toBe(false)
  }
  let deep: unknown = null
  for (let n = 0; n < 34; n++) deep = [deep]
  expect(operationSchema.safeParse({ toolName: 'tool', input: deep }).success).toBe(false)
  expect(operationSchema.safeParse({ toolName: 'tool', input: Array(4097).fill(1) }).success).toBe(
    false,
  )
})

test('questions, non-human invocation budget and confirmation are bounded', () => {
  const question = {
    hookName: 'guard',
    reason: 'Confirm',
    ordinal: 1,
    operation: { toolName: 'tool', input: {} },
  }
  expect(questionSchema.parse(question)).toEqual(question)
  expect(questionSchema.parse({ ...question, question: '  Exact headline?  ' }).question).toBe(
    '  Exact headline?  ',
  )
  const exactly512CodeUnits = '\u{1f642}'.repeat(256)
  expect(questionSchema.parse({ ...question, question: exactly512CodeUnits }).question).toBe(
    exactly512CodeUnits,
  )
  expect(
    questionSchema.safeParse({ ...question, question: `${exactly512CodeUnits}x` }).success,
  ).toBe(false)
  expect(questionSchema.parse({ ...question, question: undefined })).toEqual({
    ...question,
    question: undefined,
  })
  for (const invalid of ['', ' \t\n ', 'x'.repeat(513), 42, null]) {
    expect(questionSchema.safeParse({ ...question, question: invalid }).success).toBe(false)
  }
  expect(questionSchema.safeParse({ ...question, ordinal: limits.questions + 1 }).success).toBe(
    false,
  )
  expect(questionSchema.safeParse({ ...question, reason: 'x'.repeat(8193) }).success).toBe(false)
  expect(() => remaining(100, 100)).toThrow('deadline')
  expect(remaining(100, 99)).toBe(1)
  expect(resumeDeadline(100, 20, 55)).toBe(135)
  expect(resumeDeadline(100, 55, 20)).toBe(100)
  expect(resumeDeadline(Number.MAX_SAFE_INTEGER - 5, 0, 10)).toBe(Number.MAX_SAFE_INTEGER)
  expect(
    startSchema.safeParse({
      version: 1,
      key,
      nonce: crypto.randomUUID(),
      pid: 1,
      startedAt: 0,
      deadline: limits.invocationMs,
      disposition: 'run',
    }).success,
  ).toBe(false)
  expect(
    confirmationSchema.parse({ action: 'accept', content: { decision: 'Approve' } }).content
      ?.decision,
  ).toBe('Approve')
  expect(
    confirmationSchema.safeParse({ action: 'accept', content: { decision: 'approve' } }).success,
  ).toBe(false)
  expect(
    confirmationSchema.safeParse({
      action: 'accept',
      content: { decision: 'Approve', unexpected: true },
    }).success,
  ).toBe(false)
  expect(
    confirmationSchema.safeParse({
      action: 'accept',
      content: { decision: 'Approve' },
      unexpected: true,
    }).success,
  ).toBe(false)
  expect(failureOf(new Error('bad packet')).kind).toBe('unavailable')
})

test('terminal denial acknowledgement is strict and binds the exact normalized refusal', () => {
  const commandNonce = crypto.randomUUID()
  const refusal = userApprovalFailure('declined', 'guard')
  expect(refusal.message).toBe('[guard] Approval declined. Operation not run.')
  expect(userApprovalFailure('cancelled', 'guard').message).toBe(
    '[guard] Approval cancelled. Operation not run.',
  )
  const nativeDenial = denial(refusal.message)
  const packet = {
    version: 1,
    key,
    nonce: commandNonce,
    checkId: crypto.randomUUID(),
    ordinal: 1,
    digest: digest({ question: 1 }),
    decision: 'declined',
    denialDigest: digest(nativeDenial),
    at: 1,
  } as const
  expect(denialAckSchema.parse(packet)).toEqual(packet)
  expect(denialAckSchema.safeParse({ ...packet, extra: true }).success).toBe(false)
  expect(denialAckSchema.safeParse({ ...packet, nonce: crypto.randomUUID() }).success).toBe(true)
  expect(denialAckSchema.safeParse({ ...packet, decision: 'unavailable' }).success).toBe(false)
})
