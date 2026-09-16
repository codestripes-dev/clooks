import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { ElicitRequestFormParams } from '@modelcontextprotocol/sdk/types.js'
import { record, rows, type Row } from './records'

export type Mode =
  | 'approve'
  | 'decline-first'
  | 'decline-second'
  | 'cancel-first'
  | 'cancel-second'
  | 'noask'
export interface Case {
  root: string
  home: string
  provider: 'claude' | 'codex'
  mode: Mode
  callId: string
  owner: string
  suppressedOwner?: string
  operation: { toolName: string; input: unknown }
}
export type Packets = Record<string, any>

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`
  return JSON.stringify(value)
}

export function packetDigest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex')
}

export function expectedRefusalFailure(decision: 'declined' | 'cancelled', hookName: string) {
  return {
    kind: decision,
    message: `[${hookName}] Approval ${decision === 'declined' ? 'declined' : 'cancelled'}. Operation not run.`,
  }
}

export function expectedNativeDenial(message: string) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: message,
    },
  }
}

const expectedClaudeApprovalSchema = {
  type: 'object',
  properties: {},
} satisfies ElicitRequestFormParams['requestedSchema']

const expectedCodexApprovalSchema = {
  type: 'object',
  properties: {
    decision: {
      type: 'string',
      title: 'Decision',
      enum: ['Decline', 'Approve'],
    },
  },
  required: ['decision'],
} satisfies ElicitRequestFormParams['requestedSchema']

export function acceptedElicitationResult(provider: Case['provider']) {
  return provider === 'claude'
    ? { action: 'accept' as const, content: {} }
    : { action: 'accept' as const, content: { decision: 'Approve' } }
}

function expectedApprovalMessage(question: any): string {
  const { toolName, input } = question.operation
  const compactCommand =
    toolName === 'Bash' &&
    input !== null &&
    typeof input === 'object' &&
    !Array.isArray(input) &&
    Object.keys(input).length === 1 &&
    Object.hasOwn(input, 'command') &&
    typeof input.command === 'string' &&
    !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(input.command)
  const operation = compactCommand
    ? `Command:\n${input.command}`
    : `Tool: ${toolName}\nInput:\n${JSON.stringify(input, null, 2)}`
  return [
    question.question ?? question.reason,
    operation,
    ...(question.question === undefined ? [] : [question.reason]),
    `Requested by ${question.hookName}`,
  ].join('\n\n')
}

export function assertApprovalPrompt(
  message: string,
  schema: unknown,
  question: any,
  provider: Case['provider'],
) {
  assert.equal(message, expectedApprovalMessage(question), 'Human approval message mismatch')
  assert.deepEqual(
    schema,
    provider === 'claude' ? expectedClaudeApprovalSchema : expectedCodexApprovalSchema,
    'Approval response schema mismatch',
  )
}

export function packets(home: string): Packets[] {
  const root = join(home, '.clooks/.cache/approvals-live/v1')
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const directory = join(root, entry.name)
      return Object.fromEntries(
        readdirSync(directory)
          .filter((name) => name.endsWith('.json'))
          .map((name) => [
            name.slice(0, -5),
            JSON.parse(readFileSync(join(directory, name), 'utf8')),
          ]),
      )
    })
}

export function claimPids(home: string, report: (message: string) => void): number[] {
  const root = join(home, '.clooks/.cache/approvals-live/v1')
  const pids: number[] = []
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      for (const role of ['command', 'check']) {
        const path = join(root, entry.name, `${role}.json`)
        try {
          const { pid } = JSON.parse(readFileSync(path, 'utf8'))
          assert.ok(Number.isSafeInteger(pid) && pid > 0, 'Invalid claimed PID')
          pids.push(pid)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
            report(`${path}: ${String(error)}`)
        }
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') report(`${root}: ${String(error)}`)
  }
  return pids
}

function nativeInput(journal: Row[]) {
  const pre = journal.filter((row) => row.event === 'native-pre')
  assert.equal(pre.length, 1, 'Expected one original native tool invocation')
  return pre[0]!.input as Record<string, any>
}

function substantive(value: unknown) {
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (value && typeof value === 'object') return Object.keys(value).length > 0
  return false
}

function boxOwner(box: Packets): string | undefined {
  const owners = Object.values(box)
    .map((packet) => packet?.key?.owner)
    .filter((owner): owner is string => typeof owner === 'string')
  if (!owners.length) return undefined
  assert.equal(new Set(owners).size, 1, 'Production mailbox mixes owners')
  return owners[0]!
}

function assertPacketKey(packet: any, key: any, label: string) {
  if (packet) assert.deepEqual(packet.key, key, `${label} key mismatch`)
}

function assertSuppressedBox(box: Packets, key: any, complete: boolean) {
  for (const name of Object.keys(box)) {
    assert.ok(!/^question-\d+$/.test(name), 'Question from suppressed invocation')
    assert.ok(!/^reply-\d+$/.test(name), 'Reply from suppressed invocation')
  }
  for (const name of ['command', 'start', 'check', 'done', 'check-done'])
    assertPacketKey(box[name], key, `Suppressed ${name}`)
  if (box.start) assert.equal(box.start.disposition, 'suppressed')
  if (box.command && box.start) {
    assert.equal(box.command.id, box.start.nonce, 'Suppressed command nonce mismatch')
    assert.equal(box.command.pid, box.start.pid, 'Suppressed command process mismatch')
  }
  if (box.done) {
    assert.equal(box.done.failure, undefined, 'Suppressed command must complete neutrally')
    if (box.start) assert.equal(box.done.nonce, box.start.nonce, 'Suppressed done nonce mismatch')
  }
  if (box['check-done']) {
    assert.equal(box['check-done'].failure, undefined, 'Suppressed check must complete neutrally')
    if (box.start)
      assert.equal(
        box['check-done'].nonce,
        box.start.nonce,
        'Suppressed check completion nonce mismatch',
      )
    if (box.check)
      assert.equal(
        box['check-done'].checkId,
        box.check.id,
        'Suppressed check completion claim mismatch',
      )
  }
  if (!complete) return
  for (const name of ['command', 'start', 'check', 'done', 'check-done'])
    assert.ok(box[name], `Missing suppressed ${name} packet`)
}

function selectBoxes(c: Case, boxes: Packets[], pending: boolean) {
  if (!c.suppressedOwner)
    assert.equal(boxes.length, 1, 'Expected exactly one production invocation')
  const expected = new Set([c.owner, ...(c.suppressedOwner ? [c.suppressedOwner] : [])])
  const byOwner = new Map<string, Packets>()
  let unidentified = 0
  for (const box of boxes) {
    const owner = boxOwner(box)
    if (!owner) {
      assert.equal(
        Object.keys(box).length,
        0,
        'Ownerless production mailbox contains packet evidence',
      )
      unidentified++
      continue
    }
    assert.ok(expected.has(owner), `Unknown production owner ${owner}`)
    assert.ok(!byOwner.has(owner), `Duplicate production mailbox for owner ${owner}`)
    byOwner.set(owner, box)
  }
  const active = byOwner.get(c.owner)
  assert.ok(active, `Missing active production mailbox for ${c.owner}`)
  if (!c.suppressedOwner) {
    assert.equal(unidentified, 0, 'Production mailbox has no owner evidence')
    return { active }
  }
  assert.ok(boxes.length <= 2, 'Expected at most two combined production invocations')
  assert.ok(
    unidentified === 0 || (pending && unidentified === 1),
    'Production mailbox has no owner evidence',
  )
  const suppressed = byOwner.get(c.suppressedOwner)
  const activeKey = active.start?.key ?? active.command?.key
  assert.ok(activeKey, 'Active production mailbox has no invocation key')
  const suppressedKey = { ...activeKey, owner: c.suppressedOwner }
  if (suppressed) assertSuppressedBox(suppressed, suppressedKey, !pending)
  if (!pending) {
    assert.equal(boxes.length, 2, 'Expected exactly two combined production invocations')
    assert.ok(suppressed, `Missing suppressed production mailbox for ${c.suppressedOwner}`)
  }
  return { active, suppressed }
}

function assertCompletion(box: Packets, label: string) {
  for (const name of ['command', 'start', 'check', 'done', 'check-done'])
    assert.ok(box[name], `Missing ${label} ${name} packet`)
  const key = box.start.key
  for (const name of ['command', 'check', 'done', 'check-done'])
    assert.deepEqual(box[name].key, key, `${label} ${name} key mismatch`)
  assert.equal(box.command.id, box.start.nonce, `${label} command nonce mismatch`)
  assert.equal(box.command.pid, box.start.pid, `${label} command process mismatch`)
  assert.equal(box.done.nonce, box.start.nonce, `${label} done nonce mismatch`)
  assert.equal(box['check-done'].nonce, box.start.nonce, `${label} check nonce mismatch`)
  assert.equal(box['check-done'].checkId, box.check.id, `${label} check claim mismatch`)
}

export function assertProductionSettled(c: Case, boxes: Packets[]) {
  const selected = selectBoxes(c, boxes, false)
  assertCompletion(selected.active, 'Active')
  if (selected.suppressed) assertCompletion(selected.suppressed, 'Suppressed')
  return selected
}

function assertHookSources(c: Case, journal: Row[]) {
  if (!c.suppressedOwner) return
  for (const row of journal.filter((candidate) => /^[1-5](?:-ask)?$/.test(candidate.event))) {
    const number = Number.parseInt(row.event, 10)
    const root = number <= 2 ? c.home : join(c.root, 'project')
    assert.equal(
      row.source,
      join(root, '.clooks/hooks/hooks.ts'),
      `Hook ${number} executed from the wrong scope`,
    )
  }
}

export function assertIdentity(
  c: Case,
  box: Packets,
  journal: Row[],
  anchor?: Record<string, any>,
) {
  const input = nativeInput(journal)
  assert.equal(input.tool_use_id, c.callId)
  assert.equal(input.tool_name, c.operation.toolName)
  assert.deepEqual(
    input.tool_input,
    c.operation.input,
    'Native input differs from scripted original operation',
  )
  const key = {
    protocol: 1,
    provider: c.provider === 'claude' ? 'claude-code' : 'codex',
    owner: c.owner,
    session_id: input.session_id,
    tool_use_id: c.callId,
    ...(c.provider === 'codex' ? { turn_id: input.turn_id } : {}),
  }
  assert.ok(typeof key.session_id === 'string' && key.session_id.length)
  if (c.provider === 'codex') assert.ok(typeof key.turn_id === 'string' && key.turn_id.length)
  assert.deepEqual(box.start?.key, key)
  assert.deepEqual(box.command?.key, key)
  assert.equal(box.command.id, box.start.nonce)
  assert.equal(box.command.pid, box.start.pid)
  assert.equal(box.start.disposition, 'run')
  if (anchor) {
    for (const field of [
      'session_id',
      'tool_use_id',
      ...(c.provider === 'codex' ? ['turn_id'] : []),
    ])
      assert.equal(
        key[field as keyof typeof key],
        anchor[field],
        `Independent native ${field} mismatch`,
      )
  }
  return key
}

export function assertPending(
  c: Case,
  boxes: Packets[],
  journal: Row[],
  question: any,
  effectExists: boolean,
) {
  const { active: box } = selectBoxes(c, boxes, true)
  const key = assertIdentity(c, box, journal)
  assert.ok(question.ordinal === 1 || question.ordinal === 2)
  const number = question.ordinal === 1 ? 2 : 4
  assert.deepEqual(question, {
    hookName: `hook-${number}`,
    ordinal: question.ordinal,
    ...(number === 2 ? { question: 'Approve checkpoint 2?' } : {}),
    reason: `Checkpoint ${number}`,
    operation: c.operation,
  })
  assert.deepEqual(box[`question-${question.ordinal}`]?.question, question)
  assert.equal(box[`question-${question.ordinal}`].version, 1)
  assert.equal(box[`question-${question.ordinal}`].digest, packetDigest(question))
  assert.deepEqual(box[`question-${question.ordinal}`].key, key)
  assert.equal(box[`question-${question.ordinal}`].nonce, box.start.nonce)
  assert.deepEqual(
    journal.filter((row) => /^[1-5](?:-ask)?$/.test(row.event)).map((row) => row.event),
    question.ordinal === 1 ? ['1', '2-ask'] : ['1', '2-ask', '3', '4-ask'],
  )
  const replies = journal.filter((row) => row.event === 'ui-response')
  assert.equal(replies.length, question.ordinal - 1, 'Duplicate or out-of-order elicitation')
  assert.ok(replies.every((row) => row.action === 'accept'))
  assert.equal(box.done, undefined, 'Command completed while awaiting approval')
  assert.equal(effectExists, false, 'Native effect before consent')
  assert.equal(journal.filter((row) => row.event === 'native-effect').length, 0)
  assertHookSources(c, journal)
}

export async function respond(message: string, schema: unknown, c: Case, signal?: AbortSignal) {
  const boxes = packets(c.home)
  const { active } = selectBoxes(c, boxes, true)
  const unanswered = [1, 2]
    .filter((ordinal) => active[`question-${ordinal}`] && !active[`reply-${ordinal}`])
    .map((ordinal) => active[`question-${ordinal}`].question)
  assert.equal(unanswered.length, 1, 'Expected exactly one live unanswered production question')
  const question = unanswered[0]!
  assertApprovalPrompt(message, schema, question, c.provider)
  record(c.root, 'ui-request', { message, schema })
  const observationDeadline = Date.now() + 3000
  while (!rows(c.root).some((row) => row.event === 'native-pre')) {
    assert.ok(Date.now() < observationDeadline, 'Missing independent native input observation')
    await delay(10, undefined, { signal })
  }
  for (let observation = 0; observation < 2; observation++) {
    signal?.throwIfAborted()
    const boxes = packets(c.home)
    assertPending(c, boxes, rows(c.root), question, existsSync(join(c.root, 'project/effect.txt')))
    process.kill(selectBoxes(c, boxes, true).active.start.pid, 0)
    if (observation === 0) await delay(150, undefined, { signal })
  }
  const cancel =
    (c.mode === 'cancel-first' && question.ordinal === 1) ||
    (c.mode === 'cancel-second' && question.ordinal === 2)
  const decline =
    (c.mode === 'decline-first' && question.ordinal === 1) ||
    (c.mode === 'decline-second' && question.ordinal === 2)
  const action = cancel ? 'cancel' : decline ? 'decline' : 'accept'
  record(c.root, 'ui-response', { question, action })
  return action === 'accept' ? acceptedElicitationResult(c.provider) : { action }
}

export function assertOutcome(
  c: Case,
  boxes: Packets[],
  journal: Row[],
  anchor: Record<string, any>,
  effect: string | undefined,
  native: any,
) {
  const { active: box } = assertProductionSettled(c, boxes)
  const key = assertIdentity(c, box, journal, anchor)
  const stopOrdinal =
    c.mode === 'decline-first' || c.mode === 'cancel-first'
      ? 1
      : c.mode === 'decline-second' || c.mode === 'cancel-second'
        ? 2
        : 0
  const refusedAction = c.mode.startsWith('cancel') ? 'cancel' : 'decline'
  const failureKind = refusedAction === 'cancel' ? 'cancelled' : 'declined'
  const expected =
    c.mode === 'noask'
      ? ['1', '2', '3', '4', '5']
      : ['1', '2-ask', '3', '4-ask', '5'].slice(
          0,
          stopOrdinal === 1 ? 2 : stopOrdinal === 2 ? 4 : 5,
        )
  assert.deepEqual(
    journal.filter((row) => /^[1-5](?:-ask)?$/.test(row.event)).map((row) => row.event),
    expected,
  )
  assertHookSources(c, journal)
  const replies = journal.filter((row) => row.event === 'ui-response')
  const requests = journal.filter((row) => row.event === 'ui-request')
  const promptCount = c.mode === 'noask' ? 0 : stopOrdinal || 2
  assert.equal(replies.length, promptCount, 'Missing or duplicate approval prompt')
  assert.equal(requests.length, promptCount, 'Unexpected native elicitation request')
  assert.equal(Object.keys(box).filter((name) => /^question-\d+$/.test(name)).length, promptCount)
  assert.equal(Object.keys(box).filter((name) => /^reply-\d+$/.test(name)).length, promptCount)
  for (let i = 0; i < replies.length; i++) {
    assert.deepEqual(replies[i]!.question, box[`question-${i + 1}`].question)
    assert.deepEqual((replies[i]!.question as any).operation, c.operation)
    assert.equal(replies[i]!.action, stopOrdinal === i + 1 ? refusedAction : 'accept')
    assert.equal((replies[i]!.question as any).ordinal, i + 1)
    const askIndex = journal.findIndex((row) => row.event === `${(i + 1) * 2}-ask`)
    assert.ok(journal.indexOf(requests[i]!) > askIndex, 'Elicitation preceded its ask hook')
    assert.ok(
      journal.indexOf(replies[i]!) > journal.indexOf(requests[i]!),
      'Response preceded elicitation',
    )
    if (stopOrdinal !== i + 1) {
      assert.equal(box[`reply-${i + 1}`]?.confirmed, true)
      assert.equal(box[`reply-${i + 1}`]?.nonce, box.start.nonce)
      assert.equal(box[`reply-${i + 1}`]?.checkId, box.check.id)
      assert.equal(box[`reply-${i + 1}`]?.ordinal, i + 1)
      assert.equal(box[`reply-${i + 1}`]?.digest, box[`question-${i + 1}`].digest)
      assert.ok(
        journal.findIndex((row) => row.event === String((i + 1) * 2 + 1)) >
          journal.indexOf(replies[i]!),
        `Hook ${(i + 1) * 2 + 1} ran before its approval response`,
      )
    } else {
      const refusal = expectedRefusalFailure(failureKind, `hook-${(i + 1) * 2}`)
      assert.deepEqual(box[`reply-${i + 1}`], {
        version: 1,
        key,
        nonce: box.start.nonce,
        checkId: box.check.id,
        ordinal: i + 1,
        digest: box[`question-${i + 1}`].digest,
        confirmed: false,
        failure: refusal,
      })
    }
  }
  for (const name of ['check', 'done', 'check-done']) assert.deepEqual(box[name]?.key, key)
  assert.equal(box.done.nonce, box.start.nonce)
  assert.equal(box['check-done'].checkId, box.check.id)
  assert.equal(box['check-done'].nonce, box.start.nonce)
  assert.equal(native.requests, 2, 'Model replay or missing native result')
  const effects = journal.filter((row) => row.event === 'native-effect')
  const posts = journal.filter((row) => row.event === 'native-post')
  const shell = c.operation.toolName === 'Bash'
  if (stopOrdinal) {
    const expectedFailure = expectedRefusalFailure(failureKind, `hook-${stopOrdinal * 2}`)
    assert.deepEqual(box.done.failure, expectedFailure)
    assert.equal(box['check-done'].failure, undefined, 'Companion duplicated command denial')
    const acknowledgement = box['denial-ack']
    assert.ok(acknowledgement, 'Missing emitted command denial acknowledgement')
    assert.equal(acknowledgement.version, 1)
    assert.deepEqual(acknowledgement.key, key)
    assert.equal(acknowledgement.nonce, box.start.nonce)
    assert.equal(acknowledgement.checkId, box.check.id)
    assert.equal(acknowledgement.ordinal, stopOrdinal)
    assert.equal(
      box[`question-${stopOrdinal}`].digest,
      packetDigest(box[`question-${stopOrdinal}`].question),
    )
    assert.equal(acknowledgement.digest, box[`question-${stopOrdinal}`].digest)
    assert.equal(acknowledgement.decision, failureKind)
    assert.equal(
      acknowledgement.denialDigest,
      packetDigest(expectedNativeDenial(expectedFailure.message)),
    )
    assert.ok(acknowledgement.at >= box.done.at, 'Denial acknowledged before command completion')
    assert.ok(
      box['check-done'].at >= acknowledgement.at,
      'Companion completed before command denial acknowledgement',
    )
    assert.ok(
      JSON.stringify(native.output).includes(expectedFailure.message),
      'Native refusal does not contain the emitted command denial reason',
    )
    assert.equal(effect, undefined)
    assert.equal(effects.length, 0)
    assert.equal(posts.length, 0)
    if (c.provider === 'claude') assert.equal(native.output.is_error, true)
    else if (shell)
      assert.ok(String(native.output.output).includes('Command blocked by PreToolUse hook'))
    else {
      const output = String(native.output.output)
      assert.ok(
        output.includes('Command blocked by PreToolUse hook') ||
          output.includes('Tool call blocked by PreToolUse hook'),
      )
    }
  } else {
    assert.equal(box.done.failure, undefined)
    assert.equal(box['check-done'].failure, undefined)
    assert.equal(box['denial-ack'], undefined, 'Non-refusal published a denial acknowledgement')
    assert.equal(effect, 'native-effect\n')
    assert.equal(effects.length, shell ? 1 : 0)
    assert.equal(posts.length, 1)
    const post = posts[0]!.input as Record<string, any>
    assert.equal(post.tool_use_id, c.callId)
    assert.equal(post.session_id, key.session_id)
    if (c.provider === 'codex') assert.equal(post.turn_id, key.turn_id)
    assert.equal(post.tool_name, c.operation.toolName)
    assert.deepEqual(post.tool_input, c.operation.input)
    const lastHook = journal.findIndex((row) => row.event === '5')
    assert.ok(lastHook >= 0 && journal.indexOf(posts[0]!) > lastHook)
    assert.ok(posts[0]!.at >= box.done.at, 'PostToolUse before command completion')
    for (const reply of replies)
      assert.ok(
        journal.indexOf(posts[0]!) > journal.indexOf(reply),
        'PostToolUse preceded an approval response',
      )
    if (shell) {
      assert.ok(journal.indexOf(effects[0]!) > lastHook)
      assert.ok(effects[0]!.at >= box.done.at, 'Native effect before command completion')
      if (c.mode !== 'noask') assert.ok(journal.indexOf(effects[0]!) > journal.indexOf(replies[1]!))
      assert.ok(journal.indexOf(posts[0]!) > journal.indexOf(effects[0]!))
    } else
      assert.ok(
        substantive(post.tool_response),
        'Native non-shell completion response must be substantive',
      )
    if (c.provider === 'claude') {
      assert.notEqual(native.output.is_error, true)
      if (!shell)
        assert.ok(
          substantive(native.output.content),
          'Native Claude non-shell result must have substantive content',
        )
    } else if (shell) assert.ok(String(native.output.output).includes('Process exited with code 0'))
    else {
      assert.ok(substantive(native.output.output), 'Native non-shell result must be substantive')
      assert.ok(
        !JSON.stringify(native.output).includes('blocked by PreToolUse hook'),
        'Native non-shell result was a refusal',
      )
    }
  }
}
