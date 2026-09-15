import assert from 'node:assert/strict'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import type { setup } from './native'

export function assertScope(r: ReturnType<typeof setup>, native: any, rows: any[]) {
  const declined = r.env.APPROVAL_CASE!.endsWith('-decline')
  const activeOwner = r.globalScope ? 'global' : r.projectOwner
  const owners = r.globalScope ? [r.projectOwner, 'global'] : [r.projectOwner]
  const ipc = join(realpathSync(r.home), '.clooks', '.cache', 'approvals-live', 'v1')
  assert.equal(r.env.APPROVAL_ROOT, undefined)
  assert.notEqual(r.env.CLOOKS_HOME_ROOT, r.home)
  const servers = rows.filter((row) => row.event === 'mcp-start')
  assert.equal(servers.length, 1)
  assert.equal(servers[0].ipcRoot, ipc)
  assert.equal(realpathSync(servers[0].environment.HOME), realpathSync(r.home))
  if (r.provider === 'codex') assert.equal(servers[0].environment.CLOOKS_HOME_ROOT, undefined)
  const commandRows = rows.filter((row) => row.event === 'command-start')
  assert.equal(commandRows.length, owners.length)
  assert.equal(rows.filter((row) => row.event === 'mcp-call').length, owners.length)
  assert.equal(rows.filter((row) => row.event === 'mcp-finished').length, owners.length)
  assert.equal(rows.filter((row) => row.event === 'mcp-error').length, 0)
  for (const owner of owners) {
    const owned = rows.filter((row) => row.key?.owner === owner)
    const only = (event: string) => {
      const entries = owned.filter((row) => row.event === event)
      assert.equal(entries.length, 1, `${owner}: ${event}`)
      return entries[0]!
    }
    const command = only('command-start')
    const call = only('mcp-call')
    const attached = only('mcp-attached')
    const done = only('command-finished')
    const finished = only('mcp-finished')
    assert.deepEqual(call.key, command.key)
    assert.equal(attached.nonce, command.start.nonce)
    assert.equal(command.ipcRoot, ipc)
    assert.equal(attached.ipcRoot, ipc)
    assert.equal(command.environment.CLOOKS_HOME_ROOT, r.env.CLOOKS_HOME_ROOT)
    assert.equal(command.key.tool_use_id, r.callId)
    const active = owner === activeOwner
    assert.equal(command.start.disposition, active ? 'run' : 'suppressed')
    assert.deepEqual(
      owned
        .filter((row) => /^(?:[1-5](?:-ask)?|approve-[24])$/.test(row.event))
        .map((row) => row.event),
      !active
        ? []
        : declined
          ? ['1', '2-ask']
          : ['1', '2-ask', 'approve-2', '3', '4-ask', 'approve-4', '5'],
    )
    const responses = owned.filter((row) => row.event === 'mcp-response')
    assert.deepEqual(
      responses.map((row) => row.reply.action),
      !active ? [] : declined ? ['decline'] : ['accept', 'accept'],
    )
    for (const event of ['mcp-prompt', 'ui-response'])
      assert.equal(owned.filter((row) => row.event === event).length, responses.length)
    if (!active) {
      only('command-suppressed')
      assert.deepEqual(done.output, {})
      assert.deepEqual(finished.output, {})
    } else if (declined) {
      assert.equal(only('command-denied').error, 'Error: Checkpoint 1 declined')
      assert.equal(done.output.hookSpecificOutput.permissionDecision, 'deny')
      assert.deepEqual(finished.output, done.output)
    } else {
      assert.equal(done.output.hookSpecificOutput.permissionDecision, 'allow')
      assert.deepEqual(finished.output, {})
    }
  }
  assert.equal(existsSync(join(r.project, 'effect.txt')), !declined)
  assert.equal(rows.filter((row) => row.event === 'native-effect').length, declined ? 0 : 1)
  const posts = rows.filter((row) => row.event === 'native-post')
  assert.equal(posts.length, declined ? 0 : 1)
  if (!declined) {
    assert.equal(readFileSync(join(r.project, 'effect.txt'), 'utf8'), 'native-effect\n')
    assert.equal(posts[0].input.tool_use_id, r.callId)
    assert.deepEqual(posts[0].input.tool_input, { command: r.cmd })
    const hook5 = rows.findIndex((row) => row.event === '5' && row.key?.owner === activeOwner)
    const completion = rows.findIndex(
      (row) => row.event === 'command-finished' && row.key?.owner === activeOwner,
    )
    const effect = rows.findIndex((row) => row.event === 'native-effect')
    const post = rows.findIndex((row) => row.event === 'native-post')
    assert.ok(
      hook5 >= 0 && hook5 < completion && completion < effect && effect < post,
      'Active hook 5, command completion, native effect and PostToolUse must occur in order',
    )
  }
  if (native.output.is_error !== undefined) assert.equal(native.output.is_error, declined)
  else
    assert.equal(
      String(native.output.output).includes('Command blocked by PreToolUse hook'),
      declined,
    )
  if (declined) assert.ok(JSON.stringify(native.output).includes('Checkpoint 1 declined'))
  const cleanup = JSON.parse(readFileSync(join(r.root, 'cleanup.json'), 'utf8'))
  assert.ok(
    rows
      .filter((row) => row.event === 'mcp-finished')
      .every((row) => row.at <= cleanup.preTeardown.at),
  )
}
