// Synthetic mailbox/helper tests only. No native concurrency claim comes from this file.
import { afterEach, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  checkpointInputSchema,
  journal,
  identity,
  log,
  mailbox,
  put,
  read,
  sharedHomeRoot,
  wait,
  type Identity,
} from '../fixtures/interactive-approvals/channel'
import {
  completeOverlapTurn,
  loadOverlap,
  pendingCall,
  respondOverlap,
  type OverlapManifest,
} from '../fixtures/interactive-approvals/overlap-responder'
import { advertisedTool, checkArguments, claudeHello, claudeSpawnId } from './overlap-model'
import { assertOverlap } from './overlap'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'overlap-helper-'))
  directories.push(directory)
  const home = join(directory, 'home')
  mkdirSync(home)
  mkdirSync(join(directory, 'project'))
  const manifest: OverlapManifest = {
    provider: 'codex',
    owner: 'test-only',
    home,
    topology: 'same-session',
    calls: {},
  }
  for (const label of ['A', 'B'] as const)
    manifest.calls[label] = {
      label,
      effect: join(directory, 'project', `overlap-${label}.txt`),
      operation: { toolName: 'Bash', input: { command: `synthetic-helper-${label}` } },
    }
  put(join(directory, 'overlap-manifest.json'), manifest)
  const start = (id: string, turn = 'synthetic-turn', agent?: string) => {
    const key: Identity = identity({
      provider: 'codex',
      owner: 'test-only',
      session_id: 'synthetic-session',
      turn_id: turn,
      tool_use_id: id,
    })
    const file = mailbox(key, sharedHomeRoot(home))
    const start = {
      version: 1,
      key,
      nonce: randomUUID(),
      pid: process.pid,
      deadline: Date.now() + 30000,
    }
    put(file('start'), start)
    const operation = manifest.calls[id]!.operation
    log(
      'command-start',
      {
        key,
        start,
        input: {
          session_id: key.session_id,
          turn_id: key.turn_id,
          ...(agent ? { agent_id: agent } : {}),
          tool_name: operation.toolName,
          tool_input: operation.input,
        },
        ipcRoot: sharedHomeRoot(home),
        environment: { HOME: home },
      },
      directory,
    )
    const ask = (ordinal: number) => {
      put(file(`ask-${ordinal}`), { ...start, ordinal, operation })
      log(`${ordinal * 2}-ask`, { key }, directory)
      return JSON.stringify({ key, ordinal, operation })
    }
    return { key, start, file, ask }
  }
  return { directory, home, manifest, start }
}

test('synthetic barrier holds A until both checkpoint-one questions exist, then holds B through A twice', async () => {
  const f = fixture()
  const a = f.start('A'),
    b = f.start('B')
  const aQuestion = a.ask(1),
    bQuestion = b.ask(1)
  const cancel = new AbortController()
  const tasks: Promise<unknown>[] = []
  try {
    const first = respondOverlap(aQuestion, { directory: f.directory, signal: cancel.signal })
    tasks.push(first)
    await wait(
      () =>
        journal(f.directory).some((row) => row.event === 'overlap-question') ? true : undefined,
      Date.now() + 1000,
    )
    expect(journal(f.directory).filter((row) => row.event === 'ui-response')).toHaveLength(0)
    const declined = respondOverlap(bQuestion, { directory: f.directory, signal: cancel.signal })
    tasks.push(declined)
    expect(await first).toEqual({ action: 'accept', content: { confirmed: true } })
    expect(
      journal(f.directory)
        .filter((row) => row.event === 'ui-response')
        .map((row) => row.key.tool_use_id),
    ).toEqual(['A'])
    put(a.file('reply-1'), {
      version: 1,
      key: a.key,
      nonce: a.start.nonce,
      ordinal: 1,
      confirmed: true,
    })
    log('3', { key: a.key }, f.directory)
    const second = respondOverlap(a.ask(2), { directory: f.directory, signal: cancel.signal })
    tasks.push(second)
    expect(await second).toEqual({ action: 'accept', content: { confirmed: true } })
    expect(
      journal(f.directory)
        .filter((row) => row.event === 'ui-response')
        .map((row) => [row.key.tool_use_id, row.ordinal]),
    ).toEqual([
      ['A', 1],
      ['A', 2],
    ])
    writeFileSync(f.manifest.calls.A!.effect, 'synthetic effect\n')
    log('overlap-native-effect', { key: a.key }, f.directory)
    expect(await declined).toEqual({ action: 'decline', content: null })
    expect(
      journal(f.directory)
        .filter((row) => row.event === 'ui-response')
        .map((row) => row.action),
    ).toEqual(['accept', 'accept', 'decline'])
  } finally {
    cancel.abort()
    await Promise.allSettled(tasks)
  }
})

test('synthetic cancellation never releases a missing overlap peer', async () => {
  const f = fixture(),
    a = f.start('A')
  const cancel = new AbortController()
  const response = respondOverlap(a.ask(1), { directory: f.directory, signal: cancel.signal })
  cancel.abort(new Error('test cancellation'))
  await expect(response).rejects.toThrow('test cancellation')
  expect(journal(f.directory).filter((row) => row.event === 'ui-response')).toHaveLength(0)
})

test('explicit serial diagnostic releases A without B but cannot pass the overlap oracle', async () => {
  const f = fixture()
  f.manifest.serialChildControl = true
  f.manifest.topology = 'parent-child'
  put(join(f.directory, 'overlap-manifest.json'), f.manifest)
  const a = f.start('A')
  expect(await respondOverlap(a.ask(1), { directory: f.directory })).toEqual({
    action: 'accept',
    content: { confirmed: true },
  })
  expect(journal(f.directory).find((row) => row.event === 'ui-response').pendingOther).toBeNull()
  const complete = completedFixture('parent-child')
  complete.manifest.serialChildControl = true
  expect(complete.verify).toThrow('A serialized diagnostic cannot prove overlap')
})

test('manifest uses per-call operations and rejects a crossed displayed operation', async () => {
  const f = fixture(),
    a = f.start('A')
  const question = JSON.parse(a.ask(1))
  question.operation = f.manifest.calls.B!.operation
  await expect(
    respondOverlap(JSON.stringify(question), { directory: f.directory }),
  ).rejects.toThrow()
  expect(journal(f.directory).filter((row) => row.event === 'ui-response')).toHaveLength(0)
})

for (const mutation of ['nonce', 'ordinal', 'key', 'version', 'operation'] as const)
  test(`pending helper rejects crossed ${mutation}`, () => {
    const f = fixture(),
      a = f.start('A')
    a.ask(1)
    const ask = { ...a.start, ordinal: 1, operation: f.manifest.calls.A!.operation } as any
    ask[mutation] =
      mutation === 'key'
        ? { ...a.key, tool_use_id: 'B' }
        : mutation === 'operation'
          ? f.manifest.calls.B!.operation
          : mutation === 'nonce'
            ? 'wrong'
            : 2
    put(a.file('ask-1'), ask)
    expect(() => pendingCall(f.directory, f.manifest, 'A', 1)).toThrow()
  })

test('manifest rejects aliased effect files', () => {
  const f = fixture()
  f.manifest.calls.B!.effect = f.manifest.calls.A!.effect
  put(join(f.directory, 'overlap-manifest.json'), f.manifest)
  expect(() => loadOverlap(f.directory)).toThrow()
})

test('pending helper rejects later hooks, premature effects, and terminal replies', () => {
  for (const violation of ['hook', 'effect', 'reply', 'done']) {
    const f = fixture(),
      a = f.start('A')
    a.ask(1)
    if (violation === 'hook') log('3', { key: a.key }, f.directory)
    else if (violation === 'effect') writeFileSync(f.manifest.calls.A!.effect, 'premature')
    else put(a.file(violation === 'reply' ? 'reply-1' : 'done'), {})
    expect(() => pendingCall(f.directory, f.manifest, 'A', 1)).toThrow()
  }
})

test('scripted arguments require the actual advertised namespace and full input schema', () => {
  const schema = {
    type: 'object',
    properties: {
      agent_type: { type: 'string', enum: ['default'] },
      targets: { type: 'array', items: { type: 'string' }, minItems: 1 },
    },
    required: ['agent_type'],
  }
  const body = {
    tools: [
      {
        type: 'namespace',
        name: 'multi_agent_v1',
        tools: [{ name: 'spawn_agent', parameters: schema }],
      },
    ],
  }
  expect(advertisedTool(body, 'spawn_agent', 'multi_agent_v1')).toEqual(schema)
  expect(() => advertisedTool(body, 'spawn_agent')).toThrow('not advertised')
  expect(() => advertisedTool(body, 'spawn_agent', 'wrong')).toThrow('not advertised')
  expect(() => checkArguments(schema, { agent_type: 'default' })).not.toThrow()
  expect(() => checkArguments(schema, { agent_type: 'invented' })).toThrow()
  expect(() => checkArguments(schema, { targets: ['child'] })).toThrow()
  expect(() => checkArguments(schema, { agent_type: 'default', targets: [5] })).toThrow()
  expect(() => checkArguments(schema, { agent_type: 'default', unadvertised: true })).toThrow()
})

test('checkpoint tool advertises and requires the parser protocol version', () => {
  const key = {
    provider: 'codex' as const,
    owner: 'test-only',
    session_id: 'parent',
    turn_id: 'child-turn',
    tool_use_id: 'priming-call',
  }
  const args = { protocol: 1, ...key }
  expect(() => checkArguments(checkpointInputSchema, args)).not.toThrow()
  expect(identity(args)).toEqual(key)
  expect(() => checkArguments(checkpointInputSchema, key)).toThrow()
  for (const protocol of [0, 2, '1', null])
    expect(() => checkArguments(checkpointInputSchema, { ...args, protocol })).toThrow()
  expect(() => checkArguments(checkpointInputSchema, { ...args, unadvertised: true })).toThrow()
})

test('synthetic child completion cancels only that exact thread/turn, not the parent or later child turn', () => {
  const parent = new AbortController(),
    child = new AbortController(),
    later = new AbortController()
  const turns = new Map([
    [JSON.stringify(['parent', 'turn-1']), parent],
    [JSON.stringify(['child', 'turn-1']), child],
    [JSON.stringify(['child', 'turn-2']), later],
  ])
  const ended = new Set<string>()
  completeOverlapTurn(turns, ended, 'child', 'turn-1')
  expect(child.signal.aborted).toBe(true)
  expect(parent.signal.aborted).toBe(false)
  expect(later.signal.aborted).toBe(false)
  expect([...ended]).toEqual([JSON.stringify(['child', 'turn-1'])])
  expect(() => completeOverlapTurn(turns, ended, '', 'turn-1')).toThrow()
})

function completedFixture(topology: OverlapManifest['topology'] = 'same-session') {
  const f = fixture(),
    a = f.start('A'),
    b =
      topology === 'parent-child'
        ? f.start('B', 'synthetic-child-turn', 'synthetic-child')
        : f.start('B')
  f.manifest.topology = topology
  const commands = journal(f.directory)
  for (const [id, state] of [
    ['A', a],
    ['B', b],
  ] as const) {
    for (const ordinal of id === 'A' ? [1, 2] : [1]) {
      state.ask(ordinal)
      put(state.file(`reply-${ordinal}`), {
        version: 1,
        key: state.key,
        nonce: state.start.nonce,
        ordinal,
        confirmed: id === 'A',
      })
    }
  }
  const row = (event: string, state: typeof a, extra: Record<string, unknown> = {}) => ({
    event,
    key: state.key,
    ...extra,
  })
  const question = (state: typeof a, ordinal: number, action?: string) =>
    row(action ? 'ui-response' : 'overlap-question', state, {
      nonce: state.start.nonce,
      ordinal,
      operation: f.manifest.calls[state.key.tool_use_id]!.operation,
      ...(action ? { action } : {}),
    })
  const response = (state: typeof a, ordinal: number, action: string) =>
    row('mcp-response', state, {
      ordinal,
      reply: { action, content: action === 'accept' ? { confirmed: true } : null },
    })
  const denied = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: 'Error: Checkpoint 1 declined',
    },
  }
  const rows: any[] = [
    ...commands,
    ...[a, b].flatMap((state) => [
      row('mcp-call', state),
      row('mcp-attached', state, { nonce: state.start.nonce, ipcRoot: sharedHomeRoot(f.home) }),
      row('1', state),
      row('2-ask', state),
      question(state, 1),
    ]),
    question(a, 1, 'accept'),
    response(a, 1, 'accept'),
    row('approve-2', a),
    row('3', a),
    row('4-ask', a),
    question(a, 2),
    question(a, 2, 'accept'),
    response(a, 2, 'accept'),
    row('approve-4', a),
    row('5', a),
    row('command-finished', a, { output: { hookSpecificOutput: { permissionDecision: 'allow' } } }),
    row('mcp-finished', a, { output: {} }),
    row('overlap-native-effect', a),
    {
      event: 'native-post',
      input: {
        hook_event_name: 'PostToolUse',
        tool_use_id: 'A',
        tool_name: 'Bash',
        tool_input: f.manifest.calls.A!.operation.input,
        tool_response: 'overlap-native-effect:A',
      },
    },
    question(b, 1, 'decline'),
    response(b, 1, 'decline'),
    row('command-finished', b, { output: denied }),
    row('mcp-finished', b, { output: structuredClone(denied) }),
    { event: 'overlap-native-result', callId: 'A' },
    { event: 'overlap-native-result', callId: 'B' },
  ]
  put(join(f.directory, 'thread-start.json'), { thread: { id: 'synthetic-session' } })
  put(join(f.directory, 'turn-start.json'), { turn: { id: 'synthetic-turn' } })
  put(join(f.directory, 'cleanup.json'), {
    forcedContainment: [],
    preTeardown: { commands: [{ alive: false }, { alive: false }] },
  })
  writeFileSync(f.manifest.calls.A!.effect, 'overlap-native-effect:A\n')
  const native = {
    parent: 'synthetic-session',
    child: topology === 'parent-child' ? 'synthetic-child' : '',
    spawned: topology === 'parent-child' ? 'synthetic-child' : '',
    task: '',
  }
  const routing = [1, 2].map((request) => ({
    request,
    recipient: 'child',
    headers: {
      'x-client-request-id': native.child,
      'x-codex-parent-thread-id': native.parent,
      'x-codex-turn-metadata': JSON.stringify({
        session_id: native.parent,
        thread_id: native.child,
        turn_id: b.key.turn_id,
        parent_thread_id: native.parent,
        parent_turn_id: a.key.turn_id,
      }),
    },
  }))
  put(join(f.directory, 'appserver.jsonl'), {
    method: 'turn/completed',
    params: { threadId: native.child, turn: { id: b.key.turn_id, status: 'completed' } },
  })
  const verify = () => {
    writeFileSync(
      join(f.directory, 'journal.jsonl'),
      rows.map((row) => JSON.stringify(row)).join('\n') + '\n',
    )
    writeFileSync(
      join(f.directory, 'overlap-routing.jsonl'),
      routing.map((row) => JSON.stringify(row)).join('\n') + '\n',
    )
    return assertOverlap(f.directory, f.manifest, native)
  }
  return { ...f, rows, native, routing, verify }
}

test('full synthetic overlap oracle accepts a valid single-snapshot journal', () => {
  expect(
    completedFixture()
      .verify()
      .replies.map((reply) => reply.action),
  ).toEqual(['accept', 'accept', 'decline'])
})

test('full synthetic overlap oracle permits eventual native PostToolUse after B decline', () => {
  const f = completedFixture()
  const [post] = f.rows.splice(
    f.rows.findIndex((row) => row.event === 'native-post'),
    1,
  )
  f.rows.push(post)
  expect(f.verify).not.toThrow()
})

test('synthetic Codex child oracle binds root session separately from child agent and turn', () => {
  expect(
    completedFixture('parent-child')
      .verify()
      .commands.map((row) => row.key.session_id),
  ).toEqual(['synthetic-session', 'synthetic-session'])
})

test('synthetic primed-child oracle requires a distinct harmless call and the child MCP peer', () => {
  const f = completedFixture('parent-child')
  const callId = 'synthetic-native-primer'
  f.manifest.primedChildControl = { callId }
  const childCommand = f.rows.find(
    (row) => row.event === 'command-start' && row.key.tool_use_id === 'B',
  )
  const key = { ...childCommand.key, tool_use_id: callId }
  const args = { protocol: 1, ...key }
  put(join(f.directory, 'overlap-priming-request.json'), { child: f.native.child, key, args })
  put(join(f.directory, 'overlap-priming-result.json'), { call_id: callId, output: '{}' })
  const primer = { event: 'mcp-call', key, params: { arguments: args }, pid: 20 }
  f.rows.find((row) => row.event === 'mcp-call' && row.key.tool_use_id === 'A').pid = 10
  f.rows.find((row) => row.event === 'mcp-call' && row.key.tool_use_id === 'B').pid = 20
  f.rows.splice(
    f.rows.indexOf(childCommand),
    0,
    primer,
    { event: 'mcp-unmatched', key, closed: { key } },
    { event: 'mcp-finished', key, output: {} },
    {
      event: 'native-post',
      input: {
        hook_event_name: 'PostToolUse',
        tool_use_id: callId,
        tool_name: 'mcp__checkpoints__check',
        tool_input: args,
        tool_response: { content: [{ type: 'text', text: '{}' }] },
        session_id: f.native.parent,
        agent_id: f.native.child,
        turn_id: key.turn_id,
      },
    },
  )
  f.routing.push(structuredClone(f.routing[0]!))
  const completed = read(join(f.directory, 'appserver.jsonl'))
  writeFileSync(
    join(f.directory, 'appserver.jsonl'),
    [
      {
        method: 'mcpServer/startupStatus/updated',
        params: { threadId: f.native.child, name: 'checkpoints', status: 'ready' },
      },
      completed,
    ]
      .map((row) => JSON.stringify(row))
      .join('\n') + '\n',
  )
  expect(f.verify).not.toThrow()
  primer.pid = 10
  expect(f.verify).toThrow()
  primer.pid = 20
  args.session_id = 'another-session'
  expect(f.verify).toThrow()
})

for (const mutation of ['agent', 'spawned', 'header', 'turn', 'parent-turn'])
  test(`synthetic Codex child oracle rejects crossed ${mutation}`, () => {
    const f = completedFixture('parent-child')
    if (mutation === 'agent')
      f.rows.find(
        (row) => row.event === 'command-start' && row.key.tool_use_id === 'B',
      ).input.agent_id = 'another-child'
    else if (mutation === 'spawned') f.native.spawned = 'another-child'
    else if (mutation === 'header') f.routing[0]!.headers['x-client-request-id'] = 'another-child'
    else {
      const metadata = JSON.parse(f.routing[0]!.headers['x-codex-turn-metadata'])
      metadata[mutation === 'turn' ? 'turn_id' : 'parent_turn_id'] = 'another-turn'
      f.routing[0]!.headers['x-codex-turn-metadata'] = JSON.stringify(metadata)
    }
    expect(f.verify).toThrow()
  })

for (const [moving, before] of [
  ['ui-response:A:1', '2-ask:B'],
  ['ui-response:A:1', 'overlap-question:B:1'],
  ['command-finished:A', '5:A'],
  ['overlap-native-effect:A', 'command-finished:A'],
  ['native-post', 'overlap-native-effect:A'],
  ['ui-response:B:1', 'overlap-native-effect:A'],
])
  test(`full synthetic oracle rejects reordered ${moving} before ${before}`, () => {
    const f = completedFixture()
    const find = (selector: string) => {
      const [event, id, ordinal] = selector.split(':')
      return f.rows.findIndex(
        (row) =>
          row.event === event &&
          (!id || row.key?.tool_use_id === id) &&
          (!ordinal || row.ordinal === Number(ordinal)),
      )
    }
    const [row] = f.rows.splice(find(moving!), 1)
    f.rows.splice(find(before!), 0, row)
    expect(f.verify).toThrow()
  })

for (const mutation of [
  'mcp-allow',
  'mcp-reason',
  'post-name',
  'post-input',
  'question-nonce',
  'question-key',
  'question-operation',
  'reply-nonce',
])
  test(`full synthetic oracle rejects ${mutation}`, () => {
    const f = completedFixture()
    if (mutation.startsWith('mcp')) {
      const output = f.rows.find(
        (row) => row.event === 'mcp-finished' && row.key.tool_use_id === 'B',
      ).output.hookSpecificOutput
      if (mutation === 'mcp-allow') output.permissionDecision = 'allow'
      else output.permissionDecisionReason += ' different reason'
    } else if (mutation.startsWith('post')) {
      const post = f.rows.find((row) => row.event === 'native-post').input
      if (mutation === 'post-name') post.tool_name = 'Write'
      else post.tool_input = f.manifest.calls.B!.operation.input
    } else {
      const packet = f.rows.find(
        (row) =>
          row.event === (mutation.startsWith('question') ? 'overlap-question' : 'ui-response'),
      )
      if (mutation.endsWith('nonce')) packet.nonce = 'another-nonce'
      else if (mutation.endsWith('key')) packet.key = { ...packet.key, owner: 'another-owner' }
      else packet.operation = f.manifest.calls.B!.operation
    }
    expect(f.verify).toThrow()
  })

test('only the known Claude HEAD hello probe bypasses model JSON parsing', () => {
  expect(claudeHello('claude', new Request('http://localhost/api/hello', { method: 'HEAD' }))).toBe(
    true,
  )
  expect(claudeHello('claude', new Request('http://localhost/unknown', { method: 'HEAD' }))).toBe(
    false,
  )
  expect(claudeHello('claude', new Request('http://localhost/api/hello'))).toBe(false)
  expect(claudeHello('codex', new Request('http://localhost/api/hello', { method: 'HEAD' }))).toBe(
    false,
  )
})

test('Claude async spawn requires structured native launch success and exact original-result identity', () => {
  const f = fixture()
  const output = {
    tool_use_id: 'synthetic-spawn',
    content: [{ text: 'agentId: synthetic-child (native result)' }],
  }
  log(
    'native-post',
    {
      input: {
        hook_event_name: 'PostToolUse',
        tool_use_id: 'synthetic-spawn',
        tool_name: 'Agent',
        tool_response: { isAsync: true, status: 'async_launched', agentId: 'synthetic-child' },
      },
    },
    f.directory,
  )
  expect(claudeSpawnId(f.directory, 'synthetic-spawn', output)).toBe('synthetic-child')
  expect(() =>
    claudeSpawnId(f.directory, 'synthetic-spawn', { ...output, is_error: true }),
  ).toThrow()
  expect(() => claudeSpawnId(f.directory, 'wrong', output)).toThrow()
  expect(() =>
    claudeSpawnId(f.directory, 'synthetic-spawn', {
      ...output,
      content: 'agentId: another-child (wrong)',
    }),
  ).toThrow()
})
