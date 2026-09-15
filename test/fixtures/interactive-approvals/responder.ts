import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { alive, journal, log as record, mailbox, read, root, sharedHomeRoot } from './channel'

export async function respond(
  message: string,
  options: { directory?: string; mode?: string; signal?: AbortSignal; sharedHome?: string } = {},
) {
  const directory = options.directory ?? root()
  const mode = options.mode ?? process.env.APPROVAL_CASE
  const signal = options.signal
  const ipcDirectory =
    options.sharedHome || process.env.APPROVAL_SHARED_HOME === '1'
      ? sharedHomeRoot(options.sharedHome)
      : directory
  const log = (event: string, data: Record<string, unknown>) => record(event, data, directory)
  signal?.throwIfAborted()
  const { key, ordinal, operation } = JSON.parse(message)
  assert.ok(ordinal === 1 || ordinal === 2)
  const command = journal(directory).find(
    (row) => row.event === 'command-start' && JSON.stringify(row.key) === JSON.stringify(key),
  )
  assert.ok(command, 'Displayed question has no matching native command')
  assert.deepEqual(
    operation,
    { toolName: command.input.tool_name, input: command.input.tool_input },
    'Displayed operation differs from native command input',
  )
  assert.deepEqual(
    operation,
    read(join(directory, 'operation.json')),
    'Displayed operation differs from independently scripted operation',
  )
  const started = Date.now()
  const hold = mode === 'long' && ordinal === 1 ? 65000 : mode === 'deadline' ? 3000 : 150
  do {
    signal?.throwIfAborted()
    const events = journal(directory)
      .filter((row) => JSON.stringify(row.key) === JSON.stringify(key))
      .map((row) => row.event)
    assert.ok(!events.includes(ordinal === 1 ? '3' : '5'), 'Later hook ran while pending')
    if (mode !== 'deadline') assert.ok(!events.includes('command-finished'))
    assert.ok(!existsSync(join(directory, 'project', 'effect.txt')), 'Native effect before consent')
    if (mode !== 'deadline')
      assert.ok(
        alive(read(mailbox(key, ipcDirectory)('start')).pid),
        'Pending command must remain alive',
      )
    log('pending-observation', { key, ordinal })
    await delay(Math.min(1000, hold - (Date.now() - started)), undefined, { signal })
  } while (Date.now() - started < hold)
  signal?.throwIfAborted()
  if (mode === 'native-interrupt') {
    const victim = read(join(directory, 'native-pid.json')).pid
    log('interrupt-injected', { key, ordinal, victim })
    process.kill(victim, 'SIGINT')
    return { action: 'cancel', content: null }
  }
  if (mode === 'command-exit' || mode === 'server-disconnect') {
    const victim = read(mailbox(key, ipcDirectory)(mode === 'command-exit' ? 'command' : 'mcp')).pid
    log('fault-injected', { key, ordinal, mode, victim })
    process.kill(victim, 'SIGKILL')
  }
  const action =
    (((mode?.startsWith('scope-') && mode.endsWith('-decline')) ||
      mode === 'decline-first' ||
      mode === 'defer-decline' ||
      mode === 'defer-interactive-decline') &&
      ordinal === 1) ||
    (mode === 'decline-second' && ordinal === 2)
      ? 'decline'
      : mode === 'cancel'
        ? 'cancel'
        : 'accept'
  log('ui-response', { key, ordinal, action, operation, heldMs: Date.now() - started })
  return {
    action,
    content: action === 'accept' ? (mode === 'empty' ? {} : { confirmed: true }) : null,
  }
}
if (import.meta.main) {
  const input = await Bun.stdin.json()
  const reply = await respond(input.message)
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
