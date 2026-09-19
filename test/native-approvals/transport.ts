import assert from 'node:assert/strict'
import type { ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { alive, journal, wait } from '../fixtures/interactive-approvals/channel'
import { fixtures, save, setup } from './native'

export async function checkStdinClosure() {
  const r = setup('/export/transport-eof', 'claude', 'approve', false)
  const input = {
    session_id: 'eof-session',
    tool_use_id: r.callId,
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: r.cmd },
  }
  const command = Bun.spawn(['bun', join(fixtures, 'command.ts'), 'claude', 'project:m1', '1'], {
    cwd: r.project,
    env: r.env,
    stdin: new Blob([JSON.stringify(input)]),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const transport = new StdioClientTransport({
    command: 'bun',
    args: [join(fixtures, 'mcp.ts')],
    env: r.env,
    stderr: 'pipe',
  })
  const client = new Client(
    { name: 'stdin-closure-probe', version: '1.0.0' },
    { capabilities: { elicitation: { form: {} } } },
  )
  let prompted = false
  client.setRequestHandler(ElicitRequestSchema, async () => {
    prompted = true
    return new Promise<never>(() => {})
  })
  let serverPid: number | null = null
  try {
    await client.connect(transport)
    serverPid = transport.pid
    assert.ok(serverPid)
    const call = client.callTool({
      name: 'check',
      arguments: {
        protocol: 1,
        agent: 'claude',
        owner: 'project:m1',
        session_id: input.session_id,
        tool_use_id: input.tool_use_id,
      },
    })
    void call.catch(() => {})
    await wait(() => (prompted ? true : undefined), Date.now() + 5000)
    assert.ok(alive(command.pid) && alive(serverPid))
    // Deliberately close only client->server stdin, not the SDK transport's
    // kill-based close helper. This pinned private handle is test fault injection.
    const child = (transport as unknown as { _process: ChildProcess })._process
    child.stdin!.end()
    await wait(
      () => (!alive(serverPid!) && !alive(command.pid) ? true : undefined),
      Date.now() + 5000,
    )
    assert.equal(await command.exited, 0)
    const output = JSON.parse(await new Response(command.stdout).text())
    assert.equal(output.hookSpecificOutput.permissionDecision, 'deny')
    assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('MCP check ended'))
    const events = journal(r.root)
    assert.ok(events.some((row) => row.event === 'mcp-error'))
    assert.ok(!events.some((row) => row.event === '3' || row.event === 'native-effect'))
    save(join(r.root, 'passed.json'), {
      passed: true,
      stdinClosedWhileEliciting: true,
      serverExitedBeforeTeardown: true,
      commandExitedBeforeTeardown: true,
      output,
    })
  } finally {
    await client.close()
    if (alive(command.pid)) command.kill('SIGKILL')
    await command.exited
    save(join(r.root, 'cleanup.json'), {
      serverAlive: serverPid ? alive(serverPid) : false,
      commandAlive: alive(command.pid),
    })
  }
}
