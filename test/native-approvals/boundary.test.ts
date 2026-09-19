import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { observeBoundary } from './boundary'
import type { setup } from './native'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function fixture(agent = 'claude', dual = false) {
  const root = mkdtempSync(join(tmpdir(), 'approval-boundary-'))
  directories.push(root)
  const at = Date.parse('2026-09-15T18:00:00Z')
  const key = {
    agent,
    owner: 'project:m1',
    session_id: 'session',
    turn_id: 'turn',
    tool_use_id: 'call',
  }
  const r = {
    agent,
    root,
    project: root,
    callId: 'call',
    cmd: 'fixture-command',
    env: { APPROVAL_CASE: dual ? 'boundary-dual-exit' : 'boundary-timeout' },
    hooks: { hooks: { PreToolUse: [{ hooks: [{ timeout: 2 }, { timeout: 2 }] }] } },
  } as unknown as ReturnType<typeof setup>
  const rows: any[] = [
    { event: 'command-start', at, pid: 101, key, start: { deadline: at + 295000 } },
    { event: 'mcp-call', at, pid: 102, key },
    { event: '1' },
    { event: '2-ask' },
    { event: 'boundary-held', at: at + 100, key, commandPid: 101, checkPid: 102 },
  ]
  if (dual)
    for (const event of ['boundary-peers-stopped', 'boundary-peers-killed'])
      rows.push({ event, at: at + 2000, key, commandPid: 101, checkPid: 102 })
  writeFileSync(
    join(root, 'cleanup.json'),
    JSON.stringify({ preTeardown: { at: at + 8000 }, forcedContainment: [] }),
  )
  const debug =
    '2026-09-15T18:00:02.000Z [DEBUG] "Hook PreToolUse:Bash (PreToolUse) cancelled:\n' +
    '2026-09-15T18:00:02.003Z [INFO] Slow PreToolUse hooks: 2005ms for Bash (1 hooks)\n'
  writeFileSync(join(root, 'debug.log'), debug)
  const native: any = {
    output:
      agent === 'claude'
        ? { is_error: true, content: 'unrelated execution error' }
        : { output: 'Command blocked by PreToolUse hook: peer exited' },
    messages: [
      {
        method: 'hook/completed',
        emittedAtMs: at + 2000,
        params: {
          threadId: 'session',
          turnId: 'turn',
          run: {
            id: 'preToolUse:command:call',
            eventName: 'preToolUse',
            handlerType: 'command',
            status: 'failed',
            durationMs: 2001,
            entries: [{ kind: 'error', text: 'hook timed out after 2s' }],
          },
        },
      },
    ],
  }
  const deny = (reason = 'peer exited') => {
    rows.push({ event: 'mcp-error', pid: 102, key, error: reason })
    rows.push({
      event: 'mcp-finished',
      pid: 102,
      key,
      output: {
        hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: reason },
      },
    })
  }
  const execute = (when = at + 2100) => {
    native.output = agent === 'claude' ? { is_error: false, content: '' } : { output: 'success' }
    writeFileSync(join(root, 'effect.txt'), 'native-effect\n')
    rows.push({ event: 'native-effect', at: when })
    rows.push({
      event: 'native-post',
      input: { tool_use_id: 'call', tool_input: { command: r.cmd } },
    })
  }
  return {
    r,
    rows,
    native,
    at,
    debug,
    deny,
    execute,
    observe: () => observeBoundary(r, native, rows),
  }
}

test('Claude execution error is not affirmative hook refusal', () => {
  const f = fixture()
  expect(f.observe().observedOutcome).toBe('native-execution-error')
  f.deny()
  expect(f.observe().observedOutcome).toBe('native-execution-error')
  f.native.output.content = 'Blocked: peer exited'
  expect(f.observe().observedOutcome).toBe('native-refused')
})

test('hook refusal requires invocation-bound actually emitted denial', () => {
  const f = fixture()
  f.deny()
  f.native.output.content = 'Blocked: peer exited'
  f.rows.at(-1).pid = 999
  expect(f.observe).toThrow()
})

test('Claude execution after native cancellation is characterization, not enforcement', () => {
  const f = fixture()
  f.execute()
  expect(f.observe()).toMatchObject({
    observedOutcome: 'native-executed-without-consent',
    enforcementPassed: false,
    boundaryEvidence: { at: f.at + 2000 },
  })
})

test('teardown drain duration cannot substitute for native timeout evidence', () => {
  const f = fixture()
  f.execute()
  writeFileSync(join(f.r.root, 'debug.log'), '')
  expect(f.observe).toThrow('Missing unambiguous native PreToolUse cancellation')
})

test('Claude cancellation must have matching native timeout-duration evidence', () => {
  const f = fixture()
  writeFileSync(join(f.r.root, 'debug.log'), f.debug.replace('2005ms', '5ms'))
  expect(f.observe).toThrow('Native cancellation lacks matching timeout-duration evidence')
})

test('effect before actual native expiry cannot be attributed to expiry', () => {
  const f = fixture()
  f.execute(f.at + 1999)
  expect(f.observe).toThrow('Native effect preceded the observed boundary')
})

test('Codex command expiry can coexist with surviving MCP denial', () => {
  const f = fixture('codex')
  f.deny()
  expect(f.observe().observedOutcome).toBe('native-refused')
})

test('Codex timeout evidence must bind the actual native turn and call', () => {
  for (const field of ['turn', 'call']) {
    const f = fixture('codex')
    f.deny()
    if (field === 'turn') f.native.messages[0].params.turnId = 'foreign'
    else f.native.messages[0].params.run.id = 'preToolUse:command:foreign'
    expect(f.observe).toThrow('Missing invocation-bound native timeout evidence')
  }
})

test('dual-loss execution must follow the exact peer kill, not teardown', () => {
  const f = fixture('claude', true)
  f.execute()
  expect(f.observe().observedOutcome).toBe('native-executed-without-consent')
  f.rows.find((row) => row.event === 'native-effect').at = f.at + 1999
  expect(f.observe).toThrow('Native effect preceded the observed boundary')
})

test('dual-loss attribution rejects unrelated peer PIDs', () => {
  const f = fixture('claude', true)
  f.execute()
  f.rows.find((row) => row.event === 'boundary-peers-killed').checkPid = 999
  expect(f.observe).toThrow()
})
