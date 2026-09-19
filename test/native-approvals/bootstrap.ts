import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { budgets, mailbox, rendezvous } from '../fixtures/interactive-approvals/channel'
import type { setup } from './native'

export function assertBootstrap(r: ReturnType<typeof setup>, native: any, rows: any[]) {
  const mode = r.env.APPROVAL_CASE!
  const noStart = mode === 'bootstrap-no-start'
  const late = mode.startsWith('bootstrap-late-')
  const permits = noStart || mode === 'bootstrap-late-noask'
  const entries = (event: string) => rows.filter((row) => row.event === event)
  const only = (event: string) => {
    const found = entries(event)
    assert.equal(found.length, 1, event)
    return found[0]!
  }
  const call = only('mcp-call')
  const unmatched = only('mcp-unmatched')
  const finished = only('mcp-finished')
  const server = only('mcp-start')
  assert.equal(call.pid, server.pid)
  for (const row of [unmatched, finished]) {
    assert.deepEqual(row.key, call.key)
    assert.equal(row.pid, call.pid)
  }
  assert.deepEqual(finished.output, {})
  assert.equal(unmatched.closed.state, 'closed')
  assert.equal(unmatched.closed.pid, call.pid)
  assert.deepEqual(unmatched.closed.key, call.key)
  assert.ok(unmatched.discoveryStartedAt >= call.at)
  assert.ok(unmatched.waitedMs >= budgets.discovery && unmatched.waitedMs < 3000)
  assert.ok(unmatched.closed.closedAt <= unmatched.at && unmatched.at <= finished.at)
  const packet = mailbox(call.key, r.root)
  assert.deepEqual(rendezvous(packet('rendezvous'), call.key), unmatched.closed)
  assert.equal(existsSync(packet('attached')), false)
  for (const event of ['mcp-error', 'mcp-attached', 'mcp-prompt', 'mcp-response', 'ui-response'])
    assert.equal(entries(event).length, 0, event)
  const command = noStart ? only('bootstrap-no-start') : only('command-start')
  assert.equal(command.key.tool_use_id, r.callId)
  assert.deepEqual(call.key, {
    ...command.key,
    owner: mode === 'wrong-owner' ? 'foreign:m1' : command.key.owner,
  })
  assert.equal(command.key.owner, 'project:m1')
  assert.notEqual(command.pid, call.pid)
  assert.equal(entries('command-start').length, noStart ? 0 : 1)
  assert.deepEqual(
    rows
      .filter((row) => /^(?:[1-5](?:-ask)?|approve-[24])$/.test(row.event))
      .map((row) => row.event),
    noStart ? [] : permits ? ['1', '2', '3', '4', '5'] : ['1', '2-ask'],
  )
  const done = only('command-finished')
  assert.equal(done.pid, command.pid)
  assert.deepEqual(done.key, command.key)
  if (late) {
    const barrier = only('bootstrap-late-ready')
    assert.deepEqual(barrier.key, command.key)
    assert.deepEqual(barrier.closed, unmatched.closed)
    assert.equal(barrier.serverAlive, true, 'Late command must see a closed check in a live server')
    assert.equal(barrier.pid, command.pid)
    assert.ok(barrier.at >= unmatched.closed.closedAt && command.at >= barrier.at)
    assert.ok(done.at - command.at < 1000, 'Closed check must not impose another discovery wait')
  }
  if (permits) {
    assert.equal(entries('command-denied').length, 0)
    if (noStart) {
      assert.deepEqual(done.output, {})
      assert.equal(existsSync(packet('start')), false)
      assert.equal(existsSync(packet('command')), false)
    } else assert.equal(done.output.hookSpecificOutput.permissionDecision, 'allow')
  } else {
    const denied = only('command-denied')
    assert.equal(denied.pid, command.pid)
    assert.deepEqual(denied.key, command.key)
    assert.equal(
      denied.error,
      late ? 'Error: MCP peer unavailable: check already closed' : 'Error: MCP peer unavailable',
    )
    assert.deepEqual(done.output, {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: denied.error,
      },
    })
    assert.ok(command.at <= denied.at && denied.at <= done.at)
    assert.ok(JSON.stringify(native.output).includes(denied.error))
  }
  assert.equal(existsSync(join(r.project, 'effect.txt')), permits)
  for (const event of ['native-effect', 'native-post'])
    assert.equal(entries(event).length, permits ? 1 : 0)
  if (permits) {
    assert.equal(readFileSync(join(r.project, 'effect.txt'), 'utf8'), 'native-effect\n')
    const post = only('native-post')
    assert.equal(post.input.tool_use_id, r.callId)
    assert.equal(post.input.session_id, command.key.session_id)
    assert.equal(post.input.tool_name, 'Bash')
    assert.deepEqual(post.input.tool_input, { command: r.cmd })
    assert.ok(rows.indexOf(done) < rows.indexOf(only('native-effect')))
    assert.ok(rows.indexOf(finished) < rows.indexOf(only('native-effect')))
    assert.ok(rows.indexOf(only('native-effect')) < rows.indexOf(post))
    if (!noStart) assert.ok(rows.indexOf(only('5')) < rows.indexOf(done))
  }
  if (r.agent === 'claude') assert.equal(Boolean(native.output.is_error), !permits)
  else
    assert.equal(
      String(native.output.output).includes('Command blocked by PreToolUse hook'),
      !permits,
    )
  const cleanup = JSON.parse(readFileSync(join(r.root, 'cleanup.json'), 'utf8'))
  for (const row of [done, finished]) assert.ok(row.at <= cleanup.preTeardown.at)
}
