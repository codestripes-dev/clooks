import { describe, expect, test } from 'bun:test'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  identity,
  claim,
  journal,
  log,
  mailbox,
  remaining,
  signalProcess,
  sharedHomeRoot,
  completionOrPeerExit,
  rendezvous,
  validateReply,
} from '../fixtures/interactive-approvals/channel'
import { respond } from '../fixtures/interactive-approvals/responder'
import { finishPrimingFailure } from './native'

describe('illustrative approval protocol checks, not production enforcement', () => {
  const key = {
    provider: 'codex' as const,
    owner: 'project:m1',
    session_id: 'session',
    turn_id: 'turn',
    tool_use_id: 'call',
  }
  test('retains exact native identity without command-text correlation', () => {
    expect(identity({ ...key, tool_input: { command: 'ignored' } })).toEqual(key)
  })
  for (const field of ['provider', 'owner', 'session_id', 'turn_id', 'tool_use_id']) {
    test(`rejects missing or unexpanded ${field}`, () => {
      expect(() => identity({ ...key, [field]: undefined })).toThrow()
      expect(() => identity({ ...key, [field]: '${' + field + '}' })).toThrow()
    })
  }
  test('Claude requires session and tool identity but no invented turn', () => {
    expect(identity({ ...key, provider: 'claude', turn_id: undefined })).toEqual({
      provider: 'claude',
      owner: key.owner,
      session_id: key.session_id,
      tool_use_id: key.tool_use_id,
    })
  })
  test('deadline boundary is exclusive, without a five-minute sleep', () => {
    expect(remaining(300000, 299999)).toBe(1)
    expect(() => remaining(300000, 300000)).toThrow()
    expect(() => remaining(300000, 300001)).toThrow()
  })
  const start = { key, nonce: 'live-nonce', deadline: Date.now() + 60000 }
  const reply = { version: 1, key, nonce: 'live-nonce', ordinal: 1, confirmed: true }
  test('only literal positive confirmation approves', () => {
    expect(validateReply(reply, start, 1)).toBe(true)
    for (const confirmed of [false, null, undefined, 'true', 1, {}])
      expect(validateReply({ ...reply, confirmed }, start, 1)).toBe(false)
  })
  test('shared HOME locator preserves existing public managed ancestors', () => {
    const home = mkdtempSync(join(tmpdir(), 'approval-home-'))
    try {
      mkdirSync(join(home, '.clooks'), { mode: 0o755 })
      mkdirSync(join(home, '.clooks', '.cache'), { mode: 0o755 })
      expect(sharedHomeRoot(home)).toBe(join(home, '.clooks', '.cache', 'approvals-live', 'v1'))
      expect(statSync(join(home, '.clooks')).mode & 0o777).toBe(0o755)
      expect(statSync(join(home, '.clooks', '.cache')).mode & 0o777).toBe(0o755)
      expect(statSync(sharedHomeRoot(home)).mode & 0o777).toBe(0o700)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
  test('shared HOME locator refuses an exposed dedicated IPC namespace', () => {
    const home = mkdtempSync(join(tmpdir(), 'approval-home-'))
    try {
      mkdirSync(join(home, '.clooks', '.cache'), { recursive: true })
      mkdirSync(join(home, '.clooks', '.cache', 'approvals-live'), { mode: 0o755 })
      expect(() => sharedHomeRoot(home)).toThrow('Dedicated IPC component must be private')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
  test('shared HOME locator rejects writable managed ancestors without changing them', () => {
    for (const ancestor of ['.clooks', '.clooks/.cache']) {
      const home = mkdtempSync(join(tmpdir(), 'approval-home-'))
      try {
        mkdirSync(join(home, '.clooks', '.cache'), { recursive: true, mode: 0o755 })
        chmodSync(join(home, ancestor), 0o777)
        expect(() => sharedHomeRoot(home)).toThrow('IPC ancestor must not be group/other writable')
        expect(statSync(join(home, ancestor)).mode & 0o777).toBe(0o777)
      } finally {
        rmSync(home, { recursive: true, force: true })
      }
    }
  })
  test('command root and input failures still emit a native denial', () => {
    const home = mkdtempSync(join(tmpdir(), 'approval-command-deny-'))
    try {
      mkdirSync(join(home, '.clooks'))
      chmodSync(join(home, '.clooks'), 0o777)
      for (const input of [
        '{invalid-json',
        JSON.stringify({
          session_id: 'session',
          tool_use_id: 'call',
          tool_name: 'Bash',
          tool_input: { command: 'never-executed' },
        }),
      ]) {
        const child = Bun.spawnSync(
          [
            process.execPath,
            join(import.meta.dir, '../fixtures/interactive-approvals/command.ts'),
            'claude',
            'project:m1',
            '1',
          ],
          {
            env: { HOME: home, APPROVAL_SHARED_HOME: '1' },
            stdin: Buffer.from(input),
            timeout: 3000,
          },
        )
        expect(child.exitCode).toBe(0)
        const output = JSON.parse(child.stdout.toString())
        expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
        expect(output.hookSpecificOutput.permissionDecisionReason.length).toBeGreaterThan(0)
      }
      expect(existsSync(join(home, '.clooks', '.cache'))).toBe(false)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
  test('completion published during peer-death observation is read before failure', () => {
    let packet: {} | undefined
    let reads = 0
    const completed = completionOrPeerExit(
      () => {
        reads++
        return packet
      },
      () => {
        packet = {}
        return false
      },
      'peer exited',
    )
    expect(completed).toEqual({})
    expect(reads).toBe(2)
    expect(
      completionOrPeerExit(
        () => undefined,
        () => true,
        'peer exited',
      ),
    ).toBeUndefined()
    expect(() =>
      completionOrPeerExit(
        () => undefined,
        () => false,
        'peer exited',
      ),
    ).toThrow('peer exited')
  })
  for (const field of ['provider', 'owner', 'session_id', 'turn_id', 'tool_use_id']) {
    test(`cannot move a response across ${field}`, () => {
      expect(() =>
        validateReply({ ...reply, key: { ...key, [field]: 'foreign' } }, start, 1),
      ).toThrow()
    })
  }
  test('rejects wrong version, stale nonce, wrong ordinal and late response', () => {
    for (const change of [{ version: 2 }, { nonce: 'old' }, { ordinal: 2 }])
      expect(() => validateReply({ ...reply, ...change }, start, 1)).toThrow()
    expect(() => validateReply(reply, { ...start, deadline: 0 }, 1)).toThrow()
  })

  test('cleanup tolerates process disappearance but does not suppress other signal errors', () => {
    const gone = Object.assign(new Error('already exited'), { code: 'ESRCH' })
    expect(() =>
      signalProcess(123, 'SIGTERM', () => {
        throw gone
      }),
    ).not.toThrow()
    const denied = Object.assign(new Error('not permitted'), { code: 'EPERM' })
    expect(() =>
      signalProcess(-123, 'SIGKILL', () => {
        throw denied
      }),
    ).toThrow(denied)
  })

  test('claim publication exposes no partial JSON before its publication barrier', () => {
    const directory = mkdtempSync(join(tmpdir(), 'clooks-approval-claim-'))
    const file = join(directory, 'claim.json')
    try {
      claim(file, (temporary) => {
        expect(existsSync(file)).toBe(false)
        expect(JSON.parse(readFileSync(temporary, 'utf8'))).toEqual({ pid: process.pid })
      })
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ pid: process.pid })
      expect(readdirSync(directory)).toEqual(['claim.json'])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test('claim publication loses a collision without replacing the winning owner', () => {
    const directory = mkdtempSync(join(tmpdir(), 'clooks-approval-claim-'))
    const file = join(directory, 'claim.json')
    const winner = JSON.stringify({ pid: 42 })
    try {
      expect(() => claim(file, () => writeFileSync(file, winner, { flag: 'wx' }))).toThrow(/EEXIST/)
      expect(readFileSync(file, 'utf8')).toBe(winner)
      expect(() => claim(file)).toThrow(/EEXIST/)
      expect(readFileSync(file, 'utf8')).toBe(winner)
      expect(readdirSync(directory)).toEqual(['claim.json'])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test('start and closed election is exclusive in either publication order', () => {
    const directory = mkdtempSync(join(tmpdir(), 'approval-election-'))
    const started = { version: 1 as const, key, state: 'started' as const, nonce: 'fresh' }
    const closed = {
      version: 1 as const,
      key,
      state: 'closed' as const,
      pid: process.pid,
      closedAt: Date.now(),
    }
    try {
      for (const [first, second] of [
        [started, closed],
        [closed, started],
      ] as const) {
        const file = join(directory, `${first.state}.json`)
        expect(
          rendezvous(file, key, second, () => {
            expect(rendezvous(file, key)).toBeUndefined()
            expect(rendezvous(file, key, first)).toEqual(first)
          }),
        ).toEqual(first)
        expect(rendezvous(file, key, second)).toEqual(first)
      }
      expect(readdirSync(directory).sort()).toEqual(['closed.json', 'started.json'])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test('malformed or conflicting rendezvous is never unmatched absence', () => {
    const directory = mkdtempSync(join(tmpdir(), 'approval-election-invalid-'))
    const file = join(directory, 'rendezvous.json')
    const closed = {
      version: 1 as const,
      key,
      state: 'closed' as const,
      pid: process.pid,
      closedAt: Date.now(),
    }
    try {
      for (const value of [
        '{partial',
        JSON.stringify({ ...closed, version: 2 }),
        JSON.stringify({ ...closed, key: { ...key, owner: 'foreign' } }),
        JSON.stringify({ ...closed, state: 'unknown' }),
        JSON.stringify({ ...closed, pid: 0 }),
      ]) {
        writeFileSync(file, value)
        expect(() => rendezvous(file, key)).toThrow()
        expect(() => rendezvous(file, key, closed)).toThrow()
        expect(readFileSync(file, 'utf8')).toBe(value)
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  function responseFixture() {
    const directory = mkdtempSync(join(tmpdir(), 'clooks-approval-responder-'))
    mkdirSync(join(directory, 'project'))
    const operation = { toolName: 'Bash', input: { command: 'fixture-only' } }
    writeFileSync(join(directory, 'operation.json'), JSON.stringify(operation))
    writeFileSync(mailbox(key, directory)('start'), JSON.stringify({ pid: process.pid }))
    log(
      'command-start',
      { key, input: { tool_name: operation.toolName, tool_input: operation.input } },
      directory,
    )
    return { directory, message: JSON.stringify({ key, ordinal: 1, operation }) }
  }

  test('aborting a pending responder settles without a UI response or later observations', async () => {
    const fixture = responseFixture()
    const controller = new AbortController()
    try {
      const pending = respond(fixture.message, {
        directory: fixture.directory,
        mode: 'long',
        signal: controller.signal,
      })
      expect(journal(fixture.directory).some((row) => row.event === 'pending-observation')).toBe(
        true,
      )
      controller.abort(new Error('native turn finished'))
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
      const settled = journal(fixture.directory)
      expect(settled.some((row) => row.event === 'ui-response')).toBe(false)
      await Bun.sleep(30)
      expect(journal(fixture.directory)).toEqual(settled)
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true })
    }
  })

  test('responder retains explicit directory and captures default mode before waiting', async () => {
    const fixture = responseFixture()
    const previousRoot = process.env.APPROVAL_ROOT,
      previousMode = process.env.APPROVAL_CASE
    try {
      process.env.APPROVAL_CASE = 'approve'
      const pending = respond(fixture.message, { directory: fixture.directory })
      process.env.APPROVAL_ROOT = '/not-the-running-case'
      process.env.APPROVAL_CASE = 'decline-first'
      expect(await pending).toEqual({ action: 'accept', content: { confirmed: true } })
      expect(journal(fixture.directory).filter((row) => row.event === 'ui-response').length).toBe(1)
    } finally {
      if (previousRoot === undefined) delete process.env.APPROVAL_ROOT
      else process.env.APPROVAL_ROOT = previousRoot
      if (previousMode === undefined) delete process.env.APPROVAL_CASE
      else process.env.APPROVAL_CASE = previousMode
      rmSync(fixture.directory, { recursive: true, force: true })
    }
  })

  test('unmet priming precondition completes the native turn but retains diagnostic failure', async () => {
    const error = new Error('This discriminator requires a denied priming turn')
    const errors: string[] = []
    const response = finishPrimingFailure({ model: 'fixture-only', stream: true }, error, errors)
    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body).toContain('NATIVE_INTERACTIVE_COMPLETE')
    expect(body).toContain('"stop_reason":"end_turn"')
    expect(body).not.toContain('NATIVE_INTERACTIVE_PRIMED')
    expect(errors).toEqual([String(error)])
  })
})
