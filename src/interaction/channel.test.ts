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
  denial,
  digest,
  doneSchema,
  electionSchema,
  limits,
  questionPacketSchema,
  startSchema,
  userApprovalFailure,
  type CheckInput,
  type UserApprovalDecision,
} from './protocol.js'

const homes: string[] = []
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})
function fixture(provider: CheckInput['provider'] = 'codex') {
  const home = mkdtempSync(join(tmpdir(), 'clooks-interaction-'))
  homes.push(home)
  const key: CheckInput =
    provider === 'codex'
      ? {
          protocol: 1,
          provider,
          owner: 'project:test',
          session_id: 'session',
          turn_id: 'turn',
          tool_use_id: crypto.randomUUID(),
        }
      : {
          protocol: 1,
          provider,
          owner: 'project:test',
          session_id: 'session',
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
const claudeYes = async () => ({ action: 'accept', content: {} })
function output(result: Awaited<ReturnType<typeof handleApprovalCheck>>) {
  const content = result.content[0]
  if (content?.type !== 'text') throw new Error('Missing text result')
  expect(result.isError).not.toBe(true)
  return JSON.parse(content.text)
}
async function acknowledge(
  command: Awaited<ReturnType<typeof createApprovalInteraction>>,
  decision: UserApprovalDecision,
  hookName = 'guard',
) {
  await command.acknowledgeDenial?.(
    decision,
    denial(userApprovalFailure(decision, hookName).message),
  )
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
            `${q.reason}\n\nTool: ${q.operation.toolName}\nInput:\n${JSON.stringify(q.operation.input, null, 2)}\n\nRequested by ${q.hookName}`,
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
    question: '  Approve this exact operation?\nCheck every field.  ',
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
        `  Approve this exact operation?\nCheck every field.  \n\nTool: mcp__arbitrary__operation\nInput:\n${JSON.stringify(q.operation.input, null, 2)}\n\nFirst reason line\nSecond reason line\n\nRequested by policy-review`,
      )
      expect(params.message).not.toContain('"ordinal"')
      expect(params.requestedSchema).toEqual({
        type: 'object',
        properties: {
          decision: {
            type: 'string',
            title: 'Decision',
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

test('Claude elicitation preserves the message and uses the exact fieldless schema', async () => {
  const f = fixture('claude-code')
  const q = question()
  const command = await createApprovalInteraction({ identity: f.key }, f.clock)
  const check = handleApprovalCheck(
    f.key,
    async (params) => {
      expect(params.message).toBe(
        `Confirm exact operation\n\nTool: Write\nInput:\n${JSON.stringify(q.operation.input, null, 2)}\n\nRequested by guard`,
      )
      expect(params.requestedSchema).toEqual({ type: 'object', properties: {} })
      return claudeYes()
    },
    { runtime: f.clock },
  )
  expect(await command.request(q, signal())).toEqual({ kind: 'approved' })
  await command.close()
  expect(output(await check)).toEqual({})
})

test('Codex preserves the exact compact single-line Bash message', async () => {
  const f = fixture()
  const q = {
    ...question(),
    question: 'Delete this directory and its contents?',
    reason: 'This directory is not on the cleanup allowlist.',
    operation: { toolName: 'Bash', input: { command: 'rm -r -- ./build' } },
  }
  const command = await createApprovalInteraction({ identity: f.key }, f.clock)
  const check = handleApprovalCheck(
    f.key,
    async (params) => {
      expect(params.message).toBe(
        'Delete this directory and its contents?\n\nCommand:\nrm -r -- ./build\n\nThis directory is not on the cleanup allowlist.\n\nRequested by guard',
      )
      return yes()
    },
    { runtime: f.clock },
  )
  expect(await command.request(q, signal())).toEqual({ kind: 'approved' })
  await command.close()
  expect(output(await check)).toEqual({})
})

test('Claude puts a safe Bash command and requesting hook in the first block', async () => {
  const f = fixture('claude-code')
  const q = {
    ...question(),
    operation: { toolName: 'Bash', input: { command: 'printf ok' } },
  }
  const command = await createApprovalInteraction({ identity: f.key }, f.clock)
  const check = handleApprovalCheck(
    f.key,
    async (params) => {
      expect(params.message).toBe('Confirm exact operation\nprintf ok\nRequested by guard')
      return claudeYes()
    },
    { runtime: f.clock },
  )
  expect(await command.request(q, signal())).toEqual({ kind: 'approved' })
  await command.close()
  expect(output(await check)).toEqual({})
})

test('Claude retains the full reason and complete input when safe Bash has extra fields', async () => {
  const f = fixture('claude-code')
  const q = {
    ...question(),
    question: 'Run this exact command?',
    reason: 'The timeout and environment must also be reviewed.',
    operation: {
      toolName: 'Bash',
      input: { command: 'printf ok', timeout: 10, env: { MODE: 'check' } },
    },
  }
  const command = await createApprovalInteraction({ identity: f.key }, f.clock)
  const check = handleApprovalCheck(
    f.key,
    async (params) => {
      expect(params.message).toBe(
        `Run this exact command?\nprintf ok\nRequested by guard\n\nThe timeout and environment must also be reviewed.\n\nTool: Bash\nInput:\n${JSON.stringify(q.operation.input, null, 2)}`,
      )
      return claudeYes()
    },
    { runtime: f.clock },
  )
  expect(await command.request(q, signal())).toEqual({ kind: 'approved' })
  await command.close()
  expect(output(await check)).toEqual({})
})

test.each([
  {
    name: 'with a separate question',
    question: 'Run this exact command?',
    expected:
      'Run this exact command?\nprintf ok\nRequested by guard\n\nFirst reason line\nSecond reason line',
  },
  {
    name: 'without a separate question',
    question: undefined,
    expected: 'First reason line\nSecond reason line\nprintf ok\nRequested by guard',
  },
])(
  'Claude retains a multiline reason $name for safe Bash',
  async ({ question: headline, expected }) => {
    const f = fixture('claude-code')
    const q = {
      ...question(),
      ...(headline === undefined ? {} : { question: headline }),
      reason: 'First reason line\nSecond reason line',
      operation: { toolName: 'Bash', input: { command: 'printf ok' } },
    }
    const command = await createApprovalInteraction({ identity: f.key }, f.clock)
    const check = handleApprovalCheck(
      f.key,
      async (params) => {
        expect(params.message).toBe(expected)
        return claudeYes()
      },
      { runtime: f.clock },
    )
    expect(await command.request(q, signal())).toEqual({ kind: 'approved' })
    await command.close()
    expect(output(await check)).toEqual({})
  },
)

test('Claude preserves the legacy complete layout for non-Bash headline messages', async () => {
  const f = fixture('claude-code')
  const q = {
    ...question(),
    question: 'Write this file?',
    reason: 'The complete file contents must remain visible.',
  }
  const command = await createApprovalInteraction({ identity: f.key }, f.clock)
  const check = handleApprovalCheck(
    f.key,
    async (params) => {
      expect(params.message).toBe(
        `Write this file?\n\nTool: Write\nInput:\n${JSON.stringify(q.operation.input, null, 2)}\n\nThe complete file contents must remain visible.\n\nRequested by guard`,
      )
      return claudeYes()
    },
    { runtime: f.clock },
  )
  expect(await command.request(q, signal())).toEqual({ kind: 'approved' })
  await command.close()
  expect(output(await check)).toEqual({})
})

test.each([
  ['line feed', 'printf one\nprintf two'],
  ['U+2028', 'printf one\u2028printf two'],
  ['U+2029', 'printf one\u2029printf two'],
] as const)(
  'Claude preserves the legacy complete layout for Bash commands with %s',
  async (_, script) => {
    const f = fixture('claude-code')
    const q = {
      ...question(),
      operation: { toolName: 'Bash', input: { command: script } },
    }
    const command = await createApprovalInteraction({ identity: f.key }, f.clock)
    const check = handleApprovalCheck(
      f.key,
      async (params) => {
        expect(params.message).toBe(
          `Confirm exact operation\n\nTool: Bash\nInput:\n${JSON.stringify(q.operation.input, null, 2)}\n\nRequested by guard`,
        )
        return claudeYes()
      },
      { runtime: f.clock },
    )
    expect(await command.request(q, signal())).toEqual({ kind: 'approved' })
    await command.close()
    expect(output(await check)).toEqual({})
  },
)

test.each([
  ['extra Bash field', 'Bash', { command: 'printf ok', timeout: 10 }],
  ['multiline Bash command', 'Bash', { command: 'printf one\nprintf two' }],
  ['control-character Bash command', 'Bash', { command: 'printf \u0007' }],
  ['non-Bash command object', 'exec_command', { command: 'printf ok' }],
  ['null input', 'mcp__opaque__tool', null],
  ['boolean input', 'mcp__opaque__tool', false],
  ['number input', 'mcp__opaque__tool', 0],
  ['string input', 'mcp__opaque__tool', 'raw input'],
] as const)('%s uses complete JSON presentation', async (_name, toolName, input) => {
  const f = fixture()
  const q = { ...question(), operation: { toolName, input } }
  const command = await createApprovalInteraction({ identity: f.key }, f.clock)
  const check = handleApprovalCheck(
    f.key,
    async (params) => {
      expect(params.message).toBe(
        `Confirm exact operation\n\nTool: ${toolName}\nInput:\n${JSON.stringify(input, null, 2)}\n\nRequested by guard`,
      )
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
  const q = { ...question(), question: 'Original headline?' }
  const pending = command.request(q, signal())
  q.question = 'Changed headline?'
  q.operation.input.content = 'changed'
  f.key.owner = 'global'
  const key = f.box().key
  key.owner = 'project:test'
  const check = handleApprovalCheck(
    key,
    async (params) => {
      expect(params.message).toStartWith('Original headline?')
      expect(params.message).not.toContain('Changed headline?')
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

for (const provider of ['claude-code', 'codex'] as const)
  for (const disposition of ['run', 'suppressed'] as const)
    test(`${provider} ${disposition} no-ask close does not wait for attachment`, async () => {
      const f = fixture(provider)
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
  expect(now).toBe(10_000 + limits.discoveryMs)
  expect(f.box().bound('attached', attachedSchema)).toBeUndefined()
  expect(f.box().bound('election', electionSchema)).toMatchObject({
    state: 'closed',
    checkId: expect.any(String),
    closedAt: now,
  })
  const command = await createApprovalInteraction({ identity: f.key }, clock)
  const reply = await command.request(question(), signal())
  expect(reply.kind).toBe('unavailable')
  expect('message' in reply && reply.message).toBe(
    'MCP check already closed before this command connected; operation was not run',
  )
  await command.close()
  const g = fixture()
  expect(
    output(await handleApprovalCheck(g.key, yes, { runtime: { ...clock, home: g.home } })),
  ).toEqual({})
  await (await createApprovalInteraction({ identity: g.key }, { ...clock, home: g.home })).close()
  expect(g.box().bound('done', doneSchema)?.failure).toBeUndefined()
})

const codexNonPositiveResponses: Array<{
  response: unknown
  kind: 'declined' | 'cancelled' | 'unavailable'
  expectedUserDecision: boolean
}> = [
  { response: null, kind: 'unavailable', expectedUserDecision: false },
  { response: {}, kind: 'unavailable', expectedUserDecision: false },
  { response: { action: 'unknown' }, kind: 'unavailable', expectedUserDecision: false },
  { response: { action: 'decline' }, kind: 'declined', expectedUserDecision: true },
  {
    response: { action: 'decline', content: { decision: 'Approve' } },
    kind: 'declined',
    expectedUserDecision: true,
  },
  { response: { action: 'cancel' }, kind: 'cancelled', expectedUserDecision: true },
  {
    response: { action: 'cancel', content: { decision: 'Approve' } },
    kind: 'cancelled',
    expectedUserDecision: true,
  },
  { response: { action: 'accept' }, kind: 'unavailable', expectedUserDecision: false },
  {
    response: { action: 'accept', content: null },
    kind: 'unavailable',
    expectedUserDecision: false,
  },
  {
    response: { action: 'accept', content: {} },
    kind: 'unavailable',
    expectedUserDecision: false,
  },
  {
    response: { action: 'accept', content: { decision: 'Decline' } },
    kind: 'declined',
    expectedUserDecision: true,
  },
  {
    response: { action: 'accept', content: { confirmed: true } },
    kind: 'unavailable',
    expectedUserDecision: false,
  },
  {
    response: { action: 'accept', content: { confirmed: false } },
    kind: 'unavailable',
    expectedUserDecision: false,
  },
  {
    response: { action: 'accept', content: { decision: true } },
    kind: 'unavailable',
    expectedUserDecision: false,
  },
  {
    response: { action: 'accept', content: { decision: 'approve' } },
    kind: 'unavailable',
    expectedUserDecision: false,
  },
  {
    response: { action: 'accept', content: { decision: ' Approve ' } },
    kind: 'unavailable',
    expectedUserDecision: false,
  },
  {
    response: { action: 'accept', content: { decision: 'Unknown' } },
    kind: 'unavailable',
    expectedUserDecision: false,
  },
  {
    response: { action: 'accept', content: { decision: 'Approve', extra: true } },
    kind: 'unavailable',
    expectedUserDecision: false,
  },
  {
    response: { action: 'accept', content: { decision: 'Approve' }, extra: true },
    kind: 'unavailable',
    expectedUserDecision: false,
  },
]
for (const { response, kind, expectedUserDecision } of codexNonPositiveResponses)
  test(`Codex non-positive response cannot approve: ${JSON.stringify(response)}`, async () => {
    const f = fixture()
    const command = await createApprovalInteraction({ identity: f.key }, f.clock)
    const check = handleApprovalCheck(f.key, async () => response, { runtime: f.clock })
    const reply = await command.request(question(), signal())
    expect(reply.kind).toBe(kind)
    expect(reply.kind !== 'approved' && reply.userDecision === true).toBe(expectedUserDecision)
    if (expectedUserDecision) {
      expect(kind === 'declined' || kind === 'cancelled').toBe(true)
      await acknowledge(command, kind as UserApprovalDecision)
    }
    await command.close()
    const result = output(await check)
    if (expectedUserDecision) expect(result).toEqual({})
    else expect(result.hookSpecificOutput.permissionDecision).toBe('deny')
    expect((await command.request(question(2), signal())).kind).not.toBe('approved')
  })

const claudeResponses: Array<{
  name: string
  response: unknown
  kind: 'approved' | 'declined' | 'cancelled' | 'unavailable'
  expectedUserDecision: boolean
}> = [
  {
    name: 'null response envelope',
    response: null,
    kind: 'unavailable',
    expectedUserDecision: false,
  },
  {
    name: 'response without action',
    response: {},
    kind: 'unavailable',
    expectedUserDecision: false,
  },
  {
    name: 'response with unknown action',
    response: { action: 'unknown', content: {} },
    kind: 'unavailable',
    expectedUserDecision: false,
  },
  {
    name: 'exact empty acceptance',
    response: { action: 'accept', content: {} },
    kind: 'approved',
    expectedUserDecision: false,
  },
  {
    name: 'acceptance without content',
    response: { action: 'accept' },
    kind: 'unavailable',
    expectedUserDecision: false,
  },
  {
    name: 'acceptance with null content',
    response: { action: 'accept', content: null },
    kind: 'unavailable',
    expectedUserDecision: false,
  },
  {
    name: 'acceptance with non-object content',
    response: { action: 'accept', content: 'Approve' },
    kind: 'unavailable',
    expectedUserDecision: false,
  },
  {
    name: 'acceptance with array content',
    response: { action: 'accept', content: [] },
    kind: 'unavailable',
    expectedUserDecision: false,
  },
  {
    name: 'acceptance with extra content field',
    response: { action: 'accept', content: { decision: 'Approve' } },
    kind: 'unavailable',
    expectedUserDecision: false,
  },
  {
    name: 'acceptance with extra top-level field',
    response: { action: 'accept', content: {}, extra: true },
    kind: 'unavailable',
    expectedUserDecision: false,
  },
  {
    name: 'decline without content',
    response: { action: 'decline' },
    kind: 'declined',
    expectedUserDecision: true,
  },
  {
    name: 'decline with empty content',
    response: { action: 'decline', content: {} },
    kind: 'declined',
    expectedUserDecision: true,
  },
  {
    name: 'decline with malformed content',
    response: { action: 'decline', content: { decision: 'Approve' } },
    kind: 'unavailable',
    expectedUserDecision: false,
  },
  {
    name: 'decline with null content',
    response: { action: 'decline', content: null },
    kind: 'unavailable',
    expectedUserDecision: false,
  },
  {
    name: 'decline with non-object content',
    response: { action: 'decline', content: false },
    kind: 'unavailable',
    expectedUserDecision: false,
  },
  {
    name: 'cancel without content',
    response: { action: 'cancel' },
    kind: 'cancelled',
    expectedUserDecision: true,
  },
  {
    name: 'cancel with empty content',
    response: { action: 'cancel', content: {} },
    kind: 'cancelled',
    expectedUserDecision: true,
  },
  {
    name: 'cancel with malformed content',
    response: { action: 'cancel', content: { decision: 'Approve' } },
    kind: 'unavailable',
    expectedUserDecision: false,
  },
  {
    name: 'cancel with array content',
    response: { action: 'cancel', content: [] },
    kind: 'unavailable',
    expectedUserDecision: false,
  },
]

for (const { name, response, kind, expectedUserDecision } of claudeResponses)
  test(`Claude response contract: ${name}`, async () => {
    const f = fixture('claude-code')
    const command = await createApprovalInteraction({ identity: f.key }, f.clock)
    const check = handleApprovalCheck(f.key, async () => response, { runtime: f.clock })
    const reply = await command.request(question(), signal())
    expect(reply.kind).toBe(kind)
    expect(reply.kind !== 'approved' && reply.userDecision === true).toBe(expectedUserDecision)
    if (kind === 'declined' || kind === 'cancelled') await acknowledge(command, kind)
    await command.close()
    const result = output(await check)
    if (kind === 'approved' || expectedUserDecision) expect(result).toEqual({})
    else expect(result.hookSpecificOutput.permissionDecision).toBe('deny')
    if (kind !== 'approved')
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
  await acknowledge(second, 'declined')
  await first.close()
  await second.close()
  expect(output(await a)).toEqual({})
  expect(output(await b)).toEqual({})
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
  expect(limits.attachmentMs).toBe(3_000)
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

test.each([
  ['approve', { action: 'accept', content: { decision: 'Approve' } }, 'approved'],
  ['decline', { action: 'decline' }, 'declined'],
  ['cancel', { action: 'cancel' }, 'cancelled'],
] as const)(
  'human wait beyond old limits can %s without timing out',
  async (_name, response, kind) => {
    const f = fixture()
    let now = Date.now()
    const clock = { ...f.clock, now: () => now }
    const command = await createApprovalInteraction({ identity: f.key }, clock)
    const check = handleApprovalCheck(
      f.key,
      async (_params, options) => {
        expect(options.timeout).toBeNull()
        now += 331_000
        return response
      },
      { runtime: clock },
    )
    expect((await command.request(question(), signal())).kind).toBe(kind)
    if (kind === 'declined' || kind === 'cancelled') await acknowledge(command, kind)
    await command.close()
    const result = output(await check)
    expect(result).toEqual({})
  },
)

test('explicit refusal denies when the command dies before acknowledgement', async () => {
  const f = fixture()
  let commandAlive = true
  const command = await createApprovalInteraction({ identity: f.key }, f.clock)
  let checkSettled = false
  const check = handleApprovalCheck(f.key, async () => ({ action: 'decline' }), {
    runtime: { ...f.clock, alive: () => commandAlive },
  }).finally(() => {
    checkSettled = true
  })
  const reply = await command.request(question(), signal())
  expect(reply).toEqual({
    ...userApprovalFailure('declined', 'guard'),
    userDecision: true,
  })
  expect(f.box().bound('done', doneSchema)?.failure?.kind).toBe('declined')
  await new Promise((resolve) => setImmediate(resolve))
  expect(checkSettled).toBe(false)
  commandAlive = false
  const result = output(await check)
  expect(result.hookSpecificOutput.permissionDecision).toBe('deny')
  expect(result.hookSpecificOutput.permissionDecisionReason).toContain(
    'exited before denial acknowledgement',
  )
  await command.close()
})

test('denial acknowledgement published during command-death reread stays neutral', async () => {
  const f = fixture()
  const box = f.box()
  let armed = false
  let published = false
  const command = await createApprovalInteraction({ identity: f.key }, f.clock)
  const check = handleApprovalCheck(f.key, async () => ({ action: 'decline' }), {
    runtime: {
      ...f.clock,
      alive: () => {
        if (!armed) return true
        if (!published) {
          published = true
          const start = box.bound('start', startSchema)!
          const attached = box.bound('attached', attachedSchema)!
          const packet = box.bound('question-1', questionPacketSchema, start.nonce)!
          box.publish('denial-ack', {
            version: 1,
            key: f.key,
            nonce: start.nonce,
            checkId: attached.checkId,
            ordinal: 1,
            digest: packet.digest,
            decision: 'declined',
            denialDigest: digest(denial(userApprovalFailure('declined', 'guard').message)),
            at: Date.now(),
          })
        }
        return false
      },
    },
  })
  const reply = await command.request(question(), signal())
  expect(reply.kind !== 'approved' && reply.userDecision === true).toBe(true)
  armed = true
  expect(output(await check)).toEqual({})
  expect(published).toBe(true)
  await command.close()
})

test.each(['key', 'nonce', 'checkId', 'ordinal', 'digest', 'decision', 'denialDigest'] as const)(
  'corrupt or crossed denial acknowledgement %s remains denied',
  async (field) => {
    const f = fixture()
    const command = await createApprovalInteraction({ identity: f.key }, f.clock)
    const box = f.box()
    const check = handleApprovalCheck(f.key, async () => ({ action: 'cancel' }), {
      runtime: f.clock,
    })
    const reply = await command.request(question(), signal())
    expect(reply.kind).toBe('cancelled')
    const start = box.bound('start', startSchema)!
    const attached = box.bound('attached', attachedSchema)!
    const packet = box.bound('question-1', questionPacketSchema, start.nonce)!
    const expected = denial(userApprovalFailure('cancelled', 'guard').message)
    box.publish('denial-ack', {
      version: 1,
      key: field === 'key' ? { ...f.key, owner: 'global' } : f.key,
      nonce: field === 'nonce' ? crypto.randomUUID() : start.nonce,
      checkId: field === 'checkId' ? crypto.randomUUID() : attached.checkId,
      ordinal: field === 'ordinal' ? 2 : 1,
      digest: field === 'digest' ? digest({ wrong: true }) : packet.digest,
      decision: field === 'decision' ? 'declined' : 'cancelled',
      denialDigest: field === 'denialDigest' ? digest({ wrong: true }) : digest(expected),
      at: Date.now(),
    })
    const result = output(await check)
    expect(result.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(result.hookSpecificOutput.permissionDecisionReason).toContain('mismatch')
    await command.close()
  },
)

test('denial acknowledgement publication failure leaves the MCP companion denying', async () => {
  const f = fixture()
  let commandAlive = true
  const command = await createApprovalInteraction({ identity: f.key }, f.clock)
  const check = handleApprovalCheck(f.key, async () => ({ action: 'decline' }), {
    runtime: { ...f.clock, alive: () => commandAlive },
  })
  expect((await command.request(question(), signal())).kind).toBe('declined')
  const error = new Error('denial acknowledgement publication failed')
  const originalPublish = Mailbox.prototype.publish
  const publish = spyOn(Mailbox.prototype, 'publish').mockImplementation(function (
    this: Mailbox,
    name,
    packet,
  ) {
    if (name === 'denial-ack') throw error
    originalPublish.call(this, name, packet)
  })
  try {
    await expect(acknowledge(command, 'declined')).rejects.toBe(error)
    commandAlive = false
    const result = output(await check)
    expect(result.hookSpecificOutput.permissionDecision).toBe('deny')
  } finally {
    publish.mockRestore()
    await command.close()
  }
})

test('a second approval succeeds after the first human wait exceeds old limits', async () => {
  const f = fixture()
  let now = Date.now()
  let prompts = 0
  const clock = { ...f.clock, now: () => now }
  const command = await createApprovalInteraction({ identity: f.key }, clock)
  const check = handleApprovalCheck(
    f.key,
    async (_params, { timeout }) => {
      expect(timeout).toBeNull()
      if (++prompts === 1) now += 331_000
      return yes()
    },
    { runtime: clock },
  )
  expect(await command.request(question(), signal())).toEqual({ kind: 'approved' })
  expect(await command.request(question(2), signal())).toEqual({ kind: 'approved' })
  await command.close()
  expect(output(await check)).toEqual({})
  expect(prompts).toBe(2)
})

test('non-human budget resumes and can expire after a successful long approval', async () => {
  const f = fixture()
  let now = Date.now()
  const clock = { ...f.clock, now: () => now }
  const command = await createApprovalInteraction({ identity: f.key }, clock)
  const check = handleApprovalCheck(
    f.key,
    async () => {
      now += 331_000
      return yes()
    },
    { runtime: clock },
  )
  expect(await command.request(question(), signal())).toEqual({ kind: 'approved' })
  now += limits.invocationMs - limits.reserveMs
  const expired = await command.request(question(2), signal())
  expect(expired.kind).toBe('timed-out')
  await command.close()
  const result = output(await check)
  expect(result.hookSpecificOutput.permissionDecision).toBe('deny')
  expect(result.hookSpecificOutput.permissionDecisionReason).toContain('deadline')
})

test('external cancellation after a long human wait still refuses and drains both peers', async () => {
  const f = fixture()
  let now = Date.now()
  const clock = { ...f.clock, now: () => now }
  const controller = new AbortController()
  const command = await createApprovalInteraction({ identity: f.key }, clock)
  let prompted!: () => void
  const prompt = new Promise<void>((resolve) => {
    prompted = resolve
  })
  const check = handleApprovalCheck(
    f.key,
    async (_params, { signal, timeout }) => {
      expect(timeout).toBeNull()
      now += 331_000
      prompted()
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      )
      return yes()
    },
    { signal: controller.signal, runtime: clock },
  )
  const request = command.request(question(), signal())
  await prompt
  controller.abort()
  expect((await request).kind).toBe('cancelled')
  await command.close()
  expect(output(await check).hookSpecificOutput.permissionDecision).toBe('deny')
})

test('command death after a long human wait aborts elicitation without a timeout refusal', async () => {
  const f = fixture()
  let now = Date.now()
  let alive = true
  const clock = { ...f.clock, now: () => now, alive: () => alive }
  const command = await createApprovalInteraction({ identity: f.key }, clock)
  const check = handleApprovalCheck(
    f.key,
    async (_params, { signal, timeout }) => {
      expect(timeout).toBeNull()
      now += 331_000
      alive = false
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      )
      return yes()
    },
    { runtime: clock },
  )
  const reply = await command.request(question(), signal())
  expect(reply.kind).toBe('unavailable')
  if ('message' in reply) expect(reply.message).not.toContain('deadline')
  await command.close()
  const result = output(await check)
  expect(result.hookSpecificOutput.permissionDecision).toBe('deny')
  expect(result.hookSpecificOutput.permissionDecisionReason).not.toContain('deadline')
})

test('check death after a long human wait refuses and drains without a timeout', async () => {
  const f = fixture()
  let now = Date.now()
  let checkAlive = true
  const commandClock = { ...f.clock, now: () => now, alive: () => checkAlive }
  const serverClock = { ...f.clock, now: () => now }
  const command = await createApprovalInteraction({ identity: f.key }, commandClock)
  let prompted!: () => void
  const prompt = new Promise<void>((resolve) => {
    prompted = resolve
  })
  const check = handleApprovalCheck(
    f.key,
    async (_params, { signal, timeout }) => {
      expect(timeout).toBeNull()
      now += 331_000
      checkAlive = false
      prompted()
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      )
      return yes()
    },
    { runtime: serverClock },
  )
  const request = command.request(question(), signal())
  await prompt
  const reply = await request
  expect(reply.kind).toBe('unavailable')
  if ('message' in reply) expect(reply.message).not.toContain('deadline')
  await command.close()
  const result = output(await check)
  expect(result.hookSpecificOutput.permissionDecision).toBe('deny')
  expect(result.hookSpecificOutput.permissionDecisionReason).not.toContain('deadline')
})
