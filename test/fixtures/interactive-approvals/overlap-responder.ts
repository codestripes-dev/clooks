// Scripted fixture acknowledgements, never production or human-consent evidence.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  alive,
  identity,
  journal,
  log,
  mailbox,
  read,
  root,
  sharedHomeRoot,
  wait,
  type Identity,
  type Provider,
} from './channel'

export interface OverlapOperation {
  label: 'A' | 'B'
  operation: { toolName: string; input: { command: string } }
  effect: string
}
export interface OverlapManifest {
  provider: Provider
  owner: string
  home: string
  topology: 'same-session' | 'parent-child'
  serialChildControl?: true
  primedChildControl?: { callId: string }
  calls: Record<string, OverlapOperation>
}

export function loadOverlap(directory: string): OverlapManifest {
  const manifest = read(join(directory, 'overlap-manifest.json')) as OverlapManifest
  assert.ok(manifest && ['claude', 'codex'].includes(manifest.provider))
  assert.equal(Object.keys(manifest.calls).length, 2)
  assert.deepEqual(
    Object.values(manifest.calls)
      .map((call) => call.label)
      .sort(),
    ['A', 'B'],
  )
  assert.notEqual(...(Object.values(manifest.calls).map((call) => call.effect) as [string, string]))
  for (const call of Object.values(manifest.calls))
    assert.equal(call.effect, join(directory, 'project', `overlap-${call.label}.txt`))
  return manifest
}

export function callRows(directory: string, callId: string) {
  return journal(directory).filter((row) => row.key?.tool_use_id === callId)
}

export function completeOverlapTurn(
  turns: Map<string, AbortController>,
  ended: Set<string>,
  threadId: string,
  turnId: string,
) {
  assert.ok(typeof threadId === 'string' && threadId.length > 0)
  assert.ok(typeof turnId === 'string' && turnId.length > 0)
  const key = JSON.stringify([threadId, turnId])
  ended.add(key)
  turns.get(key)?.abort(new Error('This native turn completed'))
}

export function pendingCall(
  directory: string,
  manifest: OverlapManifest,
  callId: string,
  ordinal: number,
) {
  const rows = callRows(directory, callId)
  const commands = rows.filter((row) => row.event === 'command-start')
  assert.equal(commands.length, 1, 'Exactly one original native command required')
  const command = commands[0]
  const key = identity(command.key)
  assert.equal(key.provider, manifest.provider)
  assert.equal(key.owner, manifest.owner)
  assert.equal(command.environment.HOME, manifest.home)
  const ipc = sharedHomeRoot(manifest.home)
  assert.equal(command.ipcRoot, ipc)
  assert.ok(alive(command.pid), 'Pending native command exited')
  const file = mailbox(key, ipc)
  assert.deepEqual(read(file('start')), command.start)
  assert.equal(command.start.version, 1)
  assert.ok(command.start.deadline > Date.now())
  assert.equal(typeof command.start.nonce, 'string')
  assert.ok(command.start.nonce.length > 0)
  const ask = read(file(`ask-${ordinal}`))
  assert.ok(ask, 'Missing exact checkpoint packet')
  assert.equal(ask.version, 1)
  assert.deepEqual(ask.key, key)
  assert.equal(ask.nonce, command.start.nonce)
  assert.equal(ask.ordinal, ordinal)
  assert.deepEqual(ask.operation, manifest.calls[callId]!.operation)
  assert.deepEqual(ask.operation, {
    toolName: command.input.tool_name,
    input: command.input.tool_input,
  })
  assert.ok(!read(file(`reply-${ordinal}`)), 'Reply already published while pending')
  assert.ok(!read(file('done')) && !read(file('failed')), 'Pending call already terminal')
  assert.ok(
    !rows.some((row) => ['command-finished', ordinal === 1 ? '3' : '5'].includes(row.event)),
  )
  assert.ok(!existsSync(manifest.calls[callId]!.effect), 'Native effect before consent')
  return { key, nonce: ask.nonce, ordinal, operation: ask.operation }
}

export async function respondOverlap(
  message: string,
  options: { directory?: string; signal?: AbortSignal } = {},
) {
  const directory = options.directory ?? root()
  const signal = options.signal
  signal?.throwIfAborted()
  const manifest = loadOverlap(directory)
  const question = JSON.parse(message)
  const key: Identity = identity(question.key)
  const call = manifest.calls[key.tool_use_id]
  assert.ok(call, 'Question call ID absent from overlap manifest')
  assert.ok(question.ordinal === 1 || (call.label === 'A' && question.ordinal === 2))
  const exact = pendingCall(directory, manifest, key.tool_use_id, question.ordinal)
  assert.deepEqual(question, { key: exact.key, ordinal: exact.ordinal, operation: exact.operation })
  log('overlap-question', { ...exact, label: call.label }, directory)
  const ids = Object.keys(manifest.calls)
  const a = ids.find((id) => manifest.calls[id]!.label === 'A')!
  const b = ids.find((id) => manifest.calls[id]!.label === 'B')!
  // Poll observed native checkpoints, not a timing guess or sequential release.
  await wait(
    () => {
      const rows = journal(directory)
      if (
        !manifest.serialChildControl &&
        !ids.every((id) =>
          rows.some(
            (row) =>
              row.event === 'overlap-question' && row.key.tool_use_id === id && row.ordinal === 1,
          ),
        )
      )
        return undefined
      if (call.label === 'B') {
        pendingCall(directory, manifest, b, 1)
        if (
          !rows.some((row) => row.event === 'overlap-native-effect' && row.key?.tool_use_id === a)
        )
          return undefined
        assert.ok(
          existsSync(manifest.calls[a]!.effect),
          'A effect event arrived without its operation file',
        )
      } else {
        if (!manifest.serialChildControl) pendingCall(directory, manifest, b, 1)
        pendingCall(directory, manifest, a, question.ordinal)
        if (question.ordinal === 1) assert.ok(!rows.some((row) => row.event === 'ui-response'))
      }
      return true
    },
    Date.now() + 15000,
    signal,
  )
  signal?.throwIfAborted()
  const action = call.label === 'A' ? 'accept' : 'decline'
  log(
    'ui-response',
    {
      ...exact,
      label: call.label,
      action,
      pendingOther: call.label === 'A' && !manifest.serialChildControl ? b : null,
    },
    directory,
  )
  return { action, content: action === 'accept' ? { confirmed: true } : null }
}

if (import.meta.main) {
  const input = await Bun.stdin.json()
  const reply = await respondOverlap(input.message)
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'Elicitation',
        action: reply.action,
        ...(reply.content === null ? {} : { content: reply.content }),
      },
    }),
  )
}
