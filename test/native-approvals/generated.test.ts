import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assertOutcome,
  assertPending,
  type Case,
  type Packets,
} from '../fixtures/production-approvals/evidence'
import type { Row } from '../fixtures/production-approvals/records'
import {
  finalizeGeneratedCase,
  generatedCases,
  generatedNames,
  selectGenerated,
  type GeneratedRuntime,
} from './generated'
import { launch } from './native'

function fixture(
  provider: 'claude' | 'codex' = 'codex',
  operation: Case['operation'] = { toolName: 'Bash', input: { command: 'true' } },
) {
  const c: Case = {
    root: '/unused',
    home: '/unused',
    provider,
    mode: 'approve',
    callId: 'native-call',
    owner: 'project:abc',
    operation,
  }
  const key = {
    protocol: 1,
    provider: provider === 'claude' ? 'claude-code' : 'codex',
    owner: c.owner,
    session_id: 'native-session',
    ...(provider === 'codex' ? { turn_id: 'native-turn' } : {}),
    tool_use_id: c.callId,
  }
  const input = {
    tool_name: c.operation.toolName,
    tool_input: c.operation.input,
    session_id: key.session_id,
    ...(provider === 'codex' ? { turn_id: key.turn_id } : {}),
    tool_use_id: key.tool_use_id,
  }
  const question = (ordinal: number) => ({
    ordinal,
    hookName: `hook-${ordinal * 2}`,
    reason: `Checkpoint ${ordinal * 2}`,
    operation: c.operation,
  })
  const box: Packets = {
    command: { key, id: 'nonce', pid: 10 },
    start: { key, nonce: 'nonce', pid: 10, disposition: 'run' },
    check: { key, id: 'check-id', pid: 20 },
    'question-1': { key, nonce: 'nonce', question: question(1) },
  }
  const row = (event: string, fields = {}): Row => ({ event, at: 10, pid: 10, ...fields })
  const journal = [row('native-pre', { input }), row('1'), row('2-ask')]
  const anchor = {
    provider: 'codex',
    session_id: key.session_id,
    tool_use_id: c.callId,
    turn_id: key.turn_id,
  }
  const finish = (nonShell = false) => {
    box['question-2'] = { key, nonce: 'nonce', question: question(2) }
    box['reply-1'] = { confirmed: true, nonce: 'nonce' }
    box['reply-2'] = { confirmed: true, nonce: 'nonce' }
    box.done = { key, nonce: 'nonce', at: 10 }
    box['check-done'] = { key, nonce: 'nonce', checkId: 'check-id' }
    journal.push(
      row('ui-request'),
      row('ui-response', { question: question(1), action: 'accept' }),
      row('3'),
      row('4-ask'),
      row('ui-request'),
      row('ui-response', { question: question(2), action: 'accept' }),
      row('5'),
      ...(nonShell ? [] : [row('native-effect')]),
      row('native-post', {
        input: nonShell ? { ...input, tool_response: { content: 'Applied successfully' } } : input,
      }),
    )
  }
  const native: { requests: number; output: { output: string; content?: unknown } } = {
    requests: 2,
    output: { output: 'Process exited with code 0' },
  }
  return { c, key, box, journal, anchor, question, finish, native }
}

function nonShellFixture(provider: 'claude' | 'codex', toolName: 'Write' | 'apply_patch') {
  return fixture(provider, {
    toolName,
    input:
      toolName === 'Write'
        ? { file_path: '/unused/project/effect.txt', content: 'native-effect\n' }
        : { command: '*** Begin Patch\n*** Add File: effect.txt\n+native-effect\n*** End Patch' },
  })
}

test('generated inventory is exactly twenty cases and cannot mix illustrative flags or duplicates', () => {
  expect(selectGenerated(['--generated'])).toEqual(generatedNames)
  expect(generatedNames).toHaveLength(20)
  expect(generatedNames).toEqual([
    'claude-generated-approve',
    'claude-generated-decline-first',
    'claude-generated-decline-second',
    'claude-generated-cancel-first',
    'claude-generated-cancel-second',
    'claude-generated-noask',
    'claude-generated-global-approve',
    'claude-generated-global-decline-second',
    'claude-generated-project-non-shell-approve',
    'claude-generated-project-non-shell-decline-second',
    'codex-generated-approve',
    'codex-generated-decline-first',
    'codex-generated-decline-second',
    'codex-generated-cancel-first',
    'codex-generated-cancel-second',
    'codex-generated-noask',
    'codex-generated-global-approve',
    'codex-generated-global-decline-second',
    'codex-generated-project-non-shell-approve',
    'codex-generated-project-non-shell-decline-second',
  ])
  expect(generatedCases.filter(({ scope }) => scope === 'global')).toHaveLength(4)
  expect(generatedCases.filter(({ operation }) => operation === 'non-shell')).toHaveLength(4)
  expect(selectGenerated(['--generated', 'codex-generated-noask'])).toEqual([
    'codex-generated-noask',
  ])
  for (const args of [
    ['--generated', '--baseline'],
    ['--generated', '--generated'],
    ['--generated', 'codex-generated-noask', 'codex-generated-noask'],
    ['--generated', 'unknown'],
  ])
    expect(() => selectGenerated(args)).toThrow()
})

test('pending oracle accepts the exact first checkpoint and rejects early effect or changed operation', () => {
  const f = fixture()
  expect(() => assertPending(f.c, f.box, f.journal, f.question(1), false)).not.toThrow()
  expect(() => assertPending(f.c, f.box, f.journal, f.question(1), true)).toThrow(
    'Native effect before consent',
  )
  expect(() =>
    assertPending(
      f.c,
      f.box,
      f.journal,
      { ...f.question(1), operation: { toolName: 'Bash', input: { command: 'different' } } },
      false,
    ),
  ).toThrow()
  f.journal.push({ event: '3', at: 10, pid: 10 })
  expect(() => assertPending(f.c, f.box, f.journal, f.question(1), false)).toThrow()
})

test('production outcome requires native identity, exactly one call, both prompts and one late effect', () => {
  const f = fixture()
  f.finish()
  const check = () => assertOutcome(f.c, [f.box], f.journal, f.anchor, 'native-effect\n', f.native)
  expect(check).not.toThrow()
  expect(() =>
    assertOutcome(f.c, [f.box, f.box], f.journal, f.anchor, 'native-effect\n', f.native),
  ).toThrow('exactly one')
  expect(() =>
    assertOutcome(
      f.c,
      [f.box],
      f.journal,
      { ...f.anchor, tool_use_id: 'wrong-call' },
      'native-effect\n',
      f.native,
    ),
  ).toThrow('tool_use_id')
  expect(() =>
    assertOutcome(
      f.c,
      [f.box],
      f.journal.filter((row) => row.event !== 'ui-response'),
      f.anchor,
      'native-effect\n',
      f.native,
    ),
  ).toThrow('prompt')
  expect(() =>
    assertOutcome(f.c, [f.box], f.journal, f.anchor, 'native-effect\nnative-effect\n', f.native),
  ).toThrow()
  const early = f.journal.filter((row) => row.event !== 'native-effect')
  early.splice(1, 0, f.journal.find((row) => row.event === 'native-effect')!)
  expect(() => assertOutcome(f.c, [f.box], early, f.anchor, 'native-effect\n', f.native)).toThrow()
  f.native.requests = 3
  expect(check).toThrow('replay')
})

test.each([3, 5])('outcome rejects hook %i advancing before its approval response', (number) => {
  const f = fixture()
  f.finish()
  const [hook] = f.journal.splice(
    f.journal.findIndex((row) => row.event === String(number)),
    1,
  )
  const responseIndex = f.journal.findIndex(
    (row) => row.event === 'ui-response' && (row.question as any).ordinal === (number - 1) / 2,
  )
  f.journal.splice(responseIndex, 0, hook!)
  expect(() =>
    assertOutcome(f.c, [f.box], f.journal, f.anchor, 'native-effect\n', f.native),
  ).toThrow(`Hook ${number} ran before`)
})

test.each([1, 2])(
  'decline at %i requires actual decline, stopped hooks and invocation-bound denial',
  (ordinal) => {
    const f = fixture()
    f.c.mode = ordinal === 1 ? 'decline-first' : 'decline-second'
    if (ordinal === 2) {
      f.journal.push(
        { event: 'ui-request', at: 10, pid: 10 },
        { event: 'ui-response', at: 10, pid: 10, question: f.question(1), action: 'accept' },
        { event: '3', at: 10, pid: 10 },
        { event: '4-ask', at: 10, pid: 10 },
      )
      f.box['question-2'] = { question: f.question(2) }
      f.box['reply-1'] = { nonce: 'nonce', confirmed: true }
    }
    f.journal.push(
      {
        event: 'ui-request',
        at: 10,
        pid: 10,
      },
      {
        event: 'ui-response',
        at: 10,
        pid: 10,
        question: f.question(ordinal),
        action: 'decline',
      },
    )
    f.box.done = {
      key: f.key,
      nonce: 'nonce',
      failure: { kind: 'declined', message: 'Approval was not positively confirmed' },
    }
    f.box['check-done'] = {
      key: f.key,
      checkId: 'check-id',
      nonce: 'nonce',
      failure: { kind: 'declined', message: 'Approval was not positively confirmed' },
    }
    f.native.output.output =
      'Command blocked by PreToolUse hook: Approval was not positively confirmed'
    const check = () => assertOutcome(f.c, [f.box], f.journal, f.anchor, undefined, f.native)
    expect(check).not.toThrow()
    for (const name of ['done', 'check-done']) {
      const failure = f.box[name].failure as Record<string, unknown>
      failure.message = 'Approval was not positively confirmed differently'
      expect(check).toThrow()
      failure.message = 'Approval was not positively confirmed'
      expect(check).not.toThrow()
      delete failure.message
      expect(check).toThrow()
      failure.message = 'Approval was not positively confirmed'
    }
    if (ordinal === 2) {
      const [hook] = f.journal.splice(
        f.journal.findIndex((row) => row.event === '3'),
        1,
      )
      const index = f.journal.findIndex((row) => row.event === 'ui-response')
      f.journal.splice(index, 0, hook!)
      expect(check).toThrow('Hook 3 ran before')
      f.journal.splice(index, 1)
      f.journal.splice(index + 1, 0, hook!)
    }
    f.journal.at(-1)!.action = 'accept'
    expect(check).toThrow()
  },
)

test.each([1, 2])(
  'cancel at %i requires actual cancellation, no positive reply and stopped hooks',
  (ordinal) => {
    const f = fixture()
    f.c.mode = ordinal === 1 ? 'cancel-first' : 'cancel-second'
    if (ordinal === 2) {
      f.journal.push(
        { event: 'ui-request', at: 10, pid: 10 },
        { event: 'ui-response', at: 10, pid: 10, question: f.question(1), action: 'accept' },
        { event: '3', at: 10, pid: 10 },
        { event: '4-ask', at: 10, pid: 10 },
      )
      f.box['question-2'] = { question: f.question(2) }
      f.box['reply-1'] = { nonce: 'nonce', confirmed: true }
    }
    f.journal.push(
      { event: 'ui-request', at: 10, pid: 10 },
      {
        event: 'ui-response',
        at: 10,
        pid: 10,
        question: f.question(ordinal),
        action: 'cancel',
      },
    )
    f.box.done = {
      key: f.key,
      nonce: 'nonce',
      failure: { kind: 'cancelled', message: 'Approval cancelled' },
    }
    f.box['check-done'] = {
      key: f.key,
      checkId: 'check-id',
      nonce: 'nonce',
      failure: { kind: 'cancelled', message: 'Approval cancelled' },
    }
    f.native.output.output = 'Command blocked by PreToolUse hook: Approval cancelled'
    const check = () => assertOutcome(f.c, [f.box], f.journal, f.anchor, undefined, f.native)
    expect(check).not.toThrow()

    for (const name of ['done', 'check-done']) {
      const failure = f.box[name].failure as Record<string, unknown>
      failure.message = 'Approval cancelled differently'
      expect(check).toThrow()
      failure.message = 'Approval cancelled'
      expect(check).not.toThrow()
      delete failure.message
      expect(check).toThrow()
      failure.message = 'Approval cancelled'
    }

    f.journal.at(-1)!.action = 'decline'
    expect(check).toThrow()
    f.journal.at(-1)!.action = 'cancel'

    f.box[`reply-${ordinal}`] = { confirmed: true, nonce: 'nonce' }
    expect(check).toThrow()
    delete f.box[`reply-${ordinal}`]

    const laterHook = ordinal === 1 ? '3' : '5'
    f.journal.push({ event: laterHook, at: 10, pid: 10 })
    expect(check).toThrow()
    f.journal.pop()
    f.journal.push({ event: 'native-effect', at: 10, pid: 10 })
    expect(check).toThrow()
  },
)

test('no-ask requires zero prompts, questions and replies', () => {
  const f = fixture()
  f.finish()
  f.c.mode = 'noask'
  const journal = f.journal
    .filter((row) => row.event !== 'ui-response' && row.event !== 'ui-request')
    .map((row) => ({ ...row, event: row.event.replace('-ask', '') }))
  for (const name of ['question-1', 'question-2', 'reply-1', 'reply-2']) delete f.box[name]
  const check = () => assertOutcome(f.c, [f.box], journal, f.anchor, 'native-effect\n', f.native)
  expect(check).not.toThrow()
  f.box['reply-1'] = { confirmed: true }
  expect(check).toThrow()
})

test('second checkpoint cannot run hook five or repeat the first question while pending', () => {
  const f = fixture()
  f.box['question-2'] = { key: f.key, nonce: 'nonce', question: f.question(2) }
  f.journal.push(
    { event: 'ui-response', at: 10, pid: 10, question: f.question(1), action: 'accept' },
    { event: '3', at: 10, pid: 10 },
    { event: '4-ask', at: 10, pid: 10 },
  )
  expect(() => assertPending(f.c, f.box, f.journal, f.question(2), false)).not.toThrow()
  expect(() => assertPending(f.c, f.box, f.journal, f.question(1), false)).toThrow()
  f.journal.push({ event: '5', at: 10, pid: 10 })
  expect(() => assertPending(f.c, f.box, f.journal, f.question(2), false)).toThrow()
})

test('Claude success uses native session identity and rejects native error results', () => {
  const f = fixture('claude')
  f.finish()
  const check = () => assertOutcome(f.c, [f.box], f.journal, f.anchor, 'native-effect\n', f.native)
  expect(check).not.toThrow()
  Object.assign(f.native.output, { is_error: true })
  expect(check).toThrow()
})

test.each([
  ['claude', 'Write'],
  ['codex', 'apply_patch'],
] as const)('non-shell %s %s success requires substantive post evidence', (provider, toolName) => {
  const f = nonShellFixture(provider, toolName)
  f.finish(true)
  if (provider === 'claude')
    f.native.output.content = [{ type: 'text', text: 'Wrote effect.txt successfully' }]
  else f.native.output.output = 'Applied patch to effect.txt'
  expect(() =>
    assertOutcome(f.c, [f.box], f.journal, f.anchor, 'native-effect\n', f.native),
  ).not.toThrow()
})

test.each([
  'Wrote effect.txt successfully',
  [{ type: 'text', text: 'Wrote effect.txt successfully' }],
  { status: 'written' },
] as const)('non-shell success accepts substantive response %p', (response) => {
  const f = nonShellFixture('claude', 'Write')
  f.finish(true)
  const post = f.journal.find((row) => row.event === 'native-post')!
  ;(post.input as Record<string, any>).tool_response = response
  f.native.output.content = response
  expect(() =>
    assertOutcome(f.c, [f.box], f.journal, f.anchor, 'native-effect\n', f.native),
  ).not.toThrow()
})

test.each(['missing', 'wrongpost', 'file', 'owner'] as const)(
  'non-shell success rejects %s evidence',
  (variant) => {
    const f = nonShellFixture('codex', 'apply_patch')
    f.finish(true)
    f.native.output.output = 'Applied patch to effect.txt'
    if (variant === 'missing')
      f.journal.splice(
        f.journal.findIndex((row) => row.event === 'native-post'),
        1,
      )
    if (variant === 'wrongpost') {
      const post = f.journal.find((row) => row.event === 'native-post')!
      ;(post.input as Record<string, any>).tool_name = 'Bash'
    }
    if (variant === 'file') {
      const check = () =>
        assertOutcome(f.c, [f.box], f.journal, f.anchor, 'wrong-content\n', f.native)
      expect(check).toThrow()
      return
    }
    if (variant === 'owner') (f.box.start.key as Record<string, any>).owner = 'global'
    expect(() =>
      assertOutcome(f.c, [f.box], f.journal, f.anchor, 'native-effect\n', f.native),
    ).toThrow()
  },
)

test('non-shell success rejects an empty tool response', () => {
  const f = nonShellFixture('codex', 'apply_patch')
  f.finish(true)
  f.native.output.output = 'Applied patch to effect.txt'
  const post = f.journal.find((row) => row.event === 'native-post')!
  ;(post.input as Record<string, any>).tool_response = {}
  expect(() =>
    assertOutcome(f.c, [f.box], f.journal, f.anchor, 'native-effect\n', f.native),
  ).toThrow('substantive')
})

test.each([[false], [true], [0], [NaN], [null], [undefined], [''], [[]], [{}]] as const)(
  'Claude non-shell success rejects non-substantive native content %p',
  (content) => {
    const f = nonShellFixture('claude', 'Write')
    f.finish(true)
    f.native.output.content = content
    expect(() =>
      assertOutcome(f.c, [f.box], f.journal, f.anchor, 'native-effect\n', f.native),
    ).toThrow('substantive')
  },
)

test('declined apply_patch requires a native tool-call refusal', () => {
  const f = nonShellFixture('codex', 'apply_patch')
  f.c.mode = 'decline-first'
  f.journal.push(
    { event: 'ui-request', at: 10, pid: 10 },
    {
      event: 'ui-response',
      at: 10,
      pid: 10,
      question: f.question(1),
      action: 'decline',
    },
  )
  f.box.done = {
    key: f.key,
    nonce: 'nonce',
    failure: { kind: 'declined', message: 'Approval was not positively confirmed' },
  }
  f.box['check-done'] = {
    key: f.key,
    checkId: 'check-id',
    nonce: 'nonce',
    failure: { kind: 'declined', message: 'Approval was not positively confirmed' },
  }
  f.native.output.output =
    'Tool call blocked by PreToolUse hook: Approval was not positively confirmed'
  const check = () => assertOutcome(f.c, [f.box], f.journal, f.anchor, undefined, f.native)
  expect(check).not.toThrow()
  for (const prefix of ['Command', 'Tool call']) {
    f.native.output.output = `${prefix} blocked by PreToolUse hook: Approval was not positively confirmed`
    expect(check).not.toThrow()
  }
  f.native.output.output = 'Native request failed before the tool call was blocked'
  expect(check).toThrow()
})

function invalidPacketRuntime(root: string): GeneratedRuntime {
  const home = join(root, 'home')
  const directory = join(home, '.clooks/.cache/approvals-live/v1', 'a'.repeat(64))
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'start.json'), '{invalid')
  return {
    kind: 'generated',
    root,
    home,
    project: root,
    env: { APPROVAL_CASE: 'approve' },
    managed: [],
  } as unknown as GeneratedRuntime
}

function finalizerRuntime(root: string, managed: unknown[]): GeneratedRuntime {
  return {
    kind: 'generated',
    root,
    home: join(root, 'home'),
    project: root,
    env: { APPROVAL_CASE: 'approve' },
    managed,
  } as unknown as GeneratedRuntime
}

test('malformed cleanup evidence cannot skip process-group teardown or replace the primary failure', async () => {
  const root = mkdtempSync(join(tmpdir(), 'clooks-generated-cleanup-'))
  try {
    const runtime = invalidPacketRuntime(root)
    const primary = new Error('original native driver failure')
    await expect(
      launch(runtime, [process.execPath, '-e', 'setInterval(() => {}, 1000)'], {}, async () => {
        throw primary
      }),
    ).rejects.toBe(primary)
    const cleanup = JSON.parse(readFileSync(join(root, 'cleanup.json'), 'utf8'))
    expect(cleanup.primaryFailure).toContain(primary.message)
    expect(cleanup.evidenceErrors).toHaveLength(1)
    expect(cleanup.evidenceErrors[0]).toContain('command evidence')
    expect(cleanup.nativeAlive).toBe(false)
    expect(cleanup.groupAlive).toBe(false)
    expect(cleanup.exited).toBe(true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('malformed claim does not hide valid claim or detached journal child during cleanup', async () => {
  const root = mkdtempSync(join(tmpdir(), 'clooks-generated-pids-'))
  const children = [0, 1].map(() =>
    Bun.spawn([process.execPath, '-e', 'setInterval(() => {}, 1000)'], {
      detached: true,
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
    }),
  )
  try {
    const runtime = invalidPacketRuntime(root)
    const directory = join(runtime.home, '.clooks/.cache/approvals-live/v1', 'a'.repeat(64))
    writeFileSync(join(directory, 'command.json'), '{invalid')
    writeFileSync(join(directory, 'check.json'), JSON.stringify({ pid: children[0]!.pid }))
    writeFileSync(
      join(root, 'production.jsonl'),
      JSON.stringify({ event: 'detached-test-child', at: Date.now(), pid: children[1]!.pid }) +
        '\n',
    )
    const primary = new Error('original native driver failure')
    await expect(
      launch(runtime, [process.execPath, '-e', 'setInterval(() => {}, 1000)'], {}, async () => {
        throw primary
      }),
    ).rejects.toBe(primary)
    await Promise.all(children.map((child) => child.exited))
    const cleanup = JSON.parse(readFileSync(join(root, 'cleanup.json'), 'utf8'))
    expect(cleanup.primaryFailure).toContain(primary.message)
    expect(cleanup.evidenceErrors.some((error: string) => error.includes('command.json'))).toBe(
      true,
    )
    expect(cleanup.pids).toEqual(children.map((child) => ({ pid: child.pid, alive: false })))
    expect(cleanup.forcedContainment).toEqual(children.map((child) => child.pid))
    expect(cleanup.nativeAlive).toBe(false)
    expect(cleanup.groupAlive).toBe(false)
  } finally {
    for (const child of children)
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await Promise.all(children.map((child) => child.exited))
    rmSync(root, { recursive: true, force: true })
  }
}, 10000)

test('packet export failures remain secondary and do not prevent subsequent case finalization', () => {
  const root = mkdtempSync(join(tmpdir(), 'clooks-generated-export-'))
  try {
    const bad = invalidPacketRuntime(root)
    const goodRoot = join(root, 'next')
    mkdirSync(goodRoot)
    const good = { ...bad, root: goodRoot, home: join(goodRoot, 'home') }
    const results: Array<Record<string, unknown>> = []
    for (const [runtime, result] of [
      [bad, { passed: false, error: 'original case failure' }],
      [good, { passed: true }],
    ] as const) {
      finalizeGeneratedCase(runtime, result)
      results.push(result)
    }
    expect(results).toHaveLength(2)
    expect(results[0]!.error).toBe('original case failure')
    expect(results[0]!.packetError).toBeString()
    expect(results[0]!.passed).toBe(false)
    expect(results[1]!.passed).toBe(true)
    expect(JSON.parse(readFileSync(join(goodRoot, 'observed-packets.json'), 'utf8'))).toEqual([])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('finalizer uses absolute managed paths and preserves only Claude MCP servers structurally', () => {
  const root = mkdtempSync(join(tmpdir(), 'clooks-generated-finalizer-'))
  try {
    const managedPath = join(root, 'home/.claude.json')
    mkdirSync(join(root, 'home'), { recursive: true })
    const before = JSON.stringify({ mcpServers: { clooks: { command: 'fixture' } }, theme: 'dark' })
    writeFileSync(managedPath, before)
    const runtime = finalizerRuntime(root, [
      { path: managedPath, text: before, compare: 'claude-mcpServers' },
    ])
    writeFileSync(
      managedPath,
      JSON.stringify({ mcpServers: { clooks: { command: 'fixture' } }, theme: 'light' }),
    )
    const preserved: Record<string, unknown> = { passed: true }
    finalizeGeneratedCase(runtime, preserved)
    expect(preserved).toEqual({ passed: true })

    writeFileSync(managedPath, JSON.stringify({ mcpServers: {}, theme: 'light' }))
    const changedServers: Record<string, unknown> = { passed: true }
    finalizeGeneratedCase(runtime, changedServers)
    expect(changedServers.passed).toBe(false)
    expect(changedServers.registrationError).toContain('mcpServers')

    const bytePath = join(root, 'managed.txt')
    writeFileSync(bytePath, 'before')
    const byteRuntime = finalizerRuntime(root, [{ path: bytePath, text: 'before' }])
    writeFileSync(bytePath, 'after')
    const changedBytes: Record<string, unknown> = { passed: true }
    finalizeGeneratedCase(byteRuntime, changedBytes)
    expect(changedBytes.passed).toBe(false)
    expect(changedBytes.registrationError).toContain(bytePath)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
