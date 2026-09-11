import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  APPROVAL_MAX_BYTES,
  APPROVAL_MAX_ROWS,
  APPROVAL_TTL_MS,
  ApprovalStore,
  ApprovalStoreError,
  approvalStorePath,
  type ApprovalBinding,
  type ApprovalRecord,
} from './approval-store'

const base = 'a'.repeat(64)
const decision = 'b'.repeat(64)
const confirmation = 'c'.repeat(64)
const other = 'd'.repeat(64)
const binding: ApprovalBinding = {
  baseInvocationHash: base,
  decisionHash: decision,
  confirmationHash: confirmation,
}
let home: string
let now: number
let store: ApprovalStore

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'clooks-approval-unit-'))
  now = 1_000_000
  store = new ApprovalStore(home, () => now)
})
afterEach(() => rmSync(home, { recursive: true, force: true }))

function sql<T>(work: (db: Database) => T): T {
  const db = new Database(store.path)
  try {
    return work(db)
  } finally {
    db.close()
  }
}

function row(token: string): ApprovalRecord | null {
  return sql((db) =>
    db.query<ApprovalRecord, [string]>('SELECT * FROM approvals WHERE token = ?').get(token),
  )
}

function required(record: ApprovalRecord) {
  return { token: record.token, expectedConfirmationHash: record.confirmationHash }
}

describe('approval lifecycle', () => {
  test('lazy absent-store lookup and retirement never create state', () => {
    expect(store.exists()).toBe(false)
    expect(store.resolveAttempt(binding, [], [confirmation])).toEqual({
      requiredTokens: [],
      pendingConfirmations: [confirmation],
    })
    store.finalizePermit(base, null, [])
    expect(() => store.acknowledge('ca1_' + '0'.repeat(64))).toThrow('Unknown approval token')
    expect(existsSync(join(home, '.clooks'))).toBe(false)
  })

  test('raw token survives reopening; pending and acknowledged reuse never slide expiry', () => {
    const issued = store.issueOrReuse(binding)
    expect(issued.token).toMatch(/^ca1_[0-9a-f]{64}$/)
    expect(issued).toMatchObject({
      issuedAt: now,
      expiresAt: now + APPROVAL_TTL_MS,
      acknowledgedAt: null,
      consumedAt: null,
    })
    now += 1000
    expect(new ApprovalStore(home, () => now).issueOrReuse(binding)).toEqual(issued)
    const ack = store.acknowledge(issued.token)
    now += 1000
    expect(store.acknowledge(issued.token)).toEqual(ack)
    expect(store.issueOrReuse(binding)).toEqual(ack)
    expect(row(issued.token)).toEqual(ack)
    expect(statSync(store.path).mode & 0o777).toBe(0o600)
    expect(statSync(dirname(store.path)).mode & 0o777).toBe(0o700)
    expect(sql((db) => db.query('PRAGMA journal_mode').get())).toEqual({ journal_mode: 'delete' })
  })

  test('issuance is not acknowledgement; mixing registered and presented tokens retains intermediate approvals', () => {
    const a = store.issueOrReuse(binding)
    const b = store.issueOrReuse({ ...binding, confirmationHash: other })
    expect(store.resolveAttempt(binding, [], [confirmation, other]).pendingConfirmations).toEqual([
      confirmation,
      other,
    ])
    store.acknowledge(a.token)
    expect(store.resolveAttempt(binding, [], [confirmation, other])).toEqual({
      requiredTokens: [required(a)],
      pendingConfirmations: [other],
    })
    const resolved = store.resolveAttempt(
      binding,
      [b.token, b.token],
      [confirmation, other, confirmation],
    )
    expect(resolved).toEqual({
      requiredTokens: [required(a), required(b)],
      pendingConfirmations: [],
    })
    expect(row(a.token)?.consumedAt).toBeNull()
    store.finalizePermit(base, decision, resolved.requiredTokens)
    expect(row(a.token)?.consumedAt).toBe(now)
    expect(row(b.token)?.consumedAt).toBe(now)
    expect(() => store.finalizePermit(base, decision, resolved.requiredTokens)).toThrow()
    expect(() => store.acknowledge(a.token)).toThrow()
    expect(() => store.resolveAttempt(binding, [b.token], [other])).toThrow()
    expect(store.issueOrReuse(binding).token).not.toBe(a.token)
  })

  test('fixed five-minute expiry rejects the exact boundary and issues a fresh pending token', () => {
    const issued = store.issueOrReuse(binding)
    now = issued.expiresAt - 1
    store.acknowledge(issued.token)
    now += 1
    expect(() => store.acknowledge(issued.token)).toThrow()
    expect(() => store.resolveAttempt(binding, [issued.token], [confirmation])).toThrow()
    expect(() => store.finalizePermit(base, decision, [required(issued)])).toThrow()
    const fresh = store.issueOrReuse(binding)
    expect(fresh.token).not.toBe(issued.token)
    expect(fresh.acknowledgedAt).toBeNull()
    expect(fresh.expiresAt).toBe(now + APPROVAL_TTL_MS)
  })

  for (const field of ['baseInvocationHash', 'decisionHash', 'confirmationHash'] as const) {
    test(`exact ${field} binding rejects presentation and final consume without partial writes`, () => {
      const a = store.issueOrReuse(binding)
      const wrong = store.issueOrReuse({ ...binding, [field]: other })
      expect(() => store.resolveAttempt(binding, [a.token, wrong.token], [confirmation])).toThrow()
      expect(row(a.token)?.acknowledgedAt).toBeNull()
      store.acknowledge(a.token)
      store.acknowledge(wrong.token)
      expect(() =>
        store.finalizePermit(base, decision, [
          required(a),
          { token: wrong.token, expectedConfirmationHash: confirmation },
        ]),
      ).toThrow()
      expect(row(a.token)?.consumedAt).toBeNull()
      expect(row(wrong.token)?.consumedAt).toBeNull()
    })
  }

  for (const invalid of ['pending', 'expired', 'unknown'] as const) {
    test(`${invalid} group member rolls back every consumption and retirement`, () => {
      const a = store.issueOrReuse(binding)
      const b = store.issueOrReuse({ ...binding, confirmationHash: other })
      const stale = store.issueOrReuse({ ...binding, decisionHash: other })
      store.acknowledge(a.token)
      store.acknowledge(stale.token)
      if (invalid === 'expired') {
        store.acknowledge(b.token)
        sql((db) =>
          db.query('UPDATE approvals SET expiresAt = ? WHERE token = ?').run(now, b.token),
        )
      }
      const second =
        invalid === 'unknown' ? { ...required(b), token: 'ca1_' + '0'.repeat(64) } : required(b)
      expect(() => store.finalizePermit(base, decision, [required(a), second])).toThrow()
      expect(row(a.token)?.consumedAt).toBeNull()
      expect(row(stale.token)?.consumedAt).toBeNull()
      expect(row(b.token)?.consumedAt).toBeNull()
    })
  }

  for (const withAsk of [false, true]) {
    test(`finalization retires other decisions on the same base, asks=${withAsk}`, () => {
      const current = store.issueOrReuse(binding)
      const old = store.issueOrReuse({ ...binding, decisionHash: other })
      const unrelated = store.issueOrReuse({ ...binding, baseInvocationHash: other })
      const pending = store.issueOrReuse({ ...binding, confirmationHash: other })
      for (const record of [current, old, unrelated]) store.acknowledge(record.token)
      store.finalizePermit(base, withAsk ? decision : null, withAsk ? [required(current)] : [])
      expect(row(current.token)?.consumedAt).toBe(now)
      expect(row(old.token)?.consumedAt).toBe(now)
      expect(row(unrelated.token)?.consumedAt).toBeNull()
      expect(row(pending.token)?.consumedAt).toBeNull()
    })
  }

  test('unknown and malformed presented tokens reject the entire acknowledgement group', () => {
    const issued = store.issueOrReuse(binding)
    for (const token of ['ca1_' + '0'.repeat(64), 'ca1_bad', issued.token + ';']) {
      expect(() => store.resolveAttempt(binding, [issued.token, token], [confirmation])).toThrow()
      expect(row(issued.token)?.acknowledgedAt).toBeNull()
    }
  })
})

describe('approval storage bounds and errors', () => {
  test('rejects malformed keys, duplicates, missing decision and over-limit requests', () => {
    const issued = store.issueOrReuse(binding)
    for (const field of ['baseInvocationHash', 'decisionHash', 'confirmationHash']) {
      expect(() => store.issueOrReuse({ ...binding, [field]: '' })).toThrow('binding hash')
    }
    expect(() => store.acknowledge('bad')).toThrow('Malformed')
    expect(() =>
      store.resolveAttempt(binding, Array(65).fill(issued.token), [confirmation]),
    ).toThrow('maximum 64')
    expect(() => store.resolveAttempt(binding, [], Array(65).fill(confirmation))).toThrow(
      'maximum 64',
    )
    expect(() => store.finalizePermit(base, decision, Array(65).fill(required(issued)))).toThrow(
      'maximum 64',
    )
    expect(() => store.finalizePermit(base, null, [required(issued)])).toThrow('decision hash')
    expect(() =>
      store.finalizePermit(base, decision, [required(issued), required(issued)]),
    ).toThrow('Duplicate')
    expect(() =>
      store.finalizePermit(base, decision, [{ ...required(issued), expectedConfirmationHash: '' }]),
    ).toThrow('binding hash')
    expect(() => new ApprovalStore(home, () => NaN).acknowledge(issued.token)).toThrow('clock')
  })

  test('rejects duplicate live exact bindings instead of choosing an interchangeable token', () => {
    store.issueOrReuse(binding)
    sql((db) =>
      db.exec(`INSERT INTO approvals SELECT 'ca1_' || '${'0'.repeat(64)}',
      baseInvocationHash, decisionHash, confirmationHash, issuedAt, expiresAt, acknowledgedAt, consumedAt FROM approvals`),
    )
    expect(() => store.issueOrReuse(binding)).toThrow('Duplicate live')
    expect(() => store.resolveAttempt(binding, [], [confirmation])).toThrow('Duplicate live')
  })

  test('row ceiling refuses new records without evicting live records, but permits reuse', () => {
    const issued = store.issueOrReuse(binding)
    sql((db) => {
      const insert = db.query('INSERT INTO approvals VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)')
      db.transaction(() => {
        for (let i = 1; i < APPROVAL_MAX_ROWS; i++) {
          const id = i.toString(16).padStart(64, '0')
          insert.run('ca1_' + id, base, decision, id, now, now + APPROVAL_TTL_MS)
        }
      })()
    })
    expect(store.issueOrReuse(binding)).toEqual(issued)
    expect(() => store.issueOrReuse({ ...binding, confirmationHash: other })).toThrow('full')
    expect(sql((db) => db.query('SELECT count(*) AS count FROM approvals').get())).toEqual({
      count: APPROVAL_MAX_ROWS,
    })
  })

  test('prunes at most 256 expired rows per successful write', () => {
    store.issueOrReuse(binding)
    sql((db) => {
      const insert = db.query('INSERT INTO approvals VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)')
      db.transaction(() => {
        for (let i = 0; i < 300; i++)
          insert.run('ca1_' + i.toString(16).padStart(64, '0'), base, decision, other, 0, now)
      })()
    })
    store.issueOrReuse(binding)
    expect(
      sql((db) =>
        db.query('SELECT count(*) AS count FROM approvals WHERE expiresAt <= ?').get(now),
      ),
    ).toEqual({ count: 44 })
  })

  test('bounded allocation fails explicitly and preserves the database', () => {
    const issued = store.issueOrReuse(binding)
    // A test-only trigger makes the real issuance transaction hit its allocation ceiling.
    sql((db) => {
      db.exec(`CREATE TABLE filler (value BLOB);
        CREATE TRIGGER fill_on_issue AFTER INSERT ON approvals BEGIN
          INSERT INTO filler VALUES (zeroblob(${APPROVAL_MAX_BYTES}));
        END`)
    })
    expect(() => store.issueOrReuse({ ...binding, confirmationHash: other })).toThrow(
      'storage unavailable',
    )
    expect(statSync(store.path).size).toBeLessThanOrEqual(APPROVAL_MAX_BYTES)
    expect(store.issueOrReuse(binding)).toEqual(issued)
    expect(sql((db) => db.query('SELECT count(*) AS count FROM approvals').get())).toEqual({
      count: 1,
    })
    sql((db) => db.exec('DROP TRIGGER fill_on_issue'))
    expect(store.issueOrReuse({ ...binding, confirmationHash: other }).acknowledgedAt).toBeNull()
  })

  test('an oversized existing database is rejected without truncation or recreation', () => {
    store.issueOrReuse(binding)
    truncateSync(store.path, APPROVAL_MAX_BYTES + 1)
    expect(() => store.issueOrReuse(binding)).toThrow('oversized approval database')
    expect(statSync(store.path).size).toBe(APPROVAL_MAX_BYTES + 1)
  })

  test('unknown schema and corrupt bytes are refused without recreation', () => {
    const issued = store.issueOrReuse(binding)
    sql((db) => db.exec('PRAGMA user_version = 99'))
    expect(() => store.acknowledge(issued.token)).toThrow('Unknown approval database schema')
    expect(sql((db) => db.query('PRAGMA user_version').get())).toEqual({ user_version: 99 })
    writeFileSync(store.path, 'not sqlite')
    expect(() => store.issueOrReuse(binding)).toThrow(ApprovalStoreError)
    expect(readFileSync(store.path, 'utf8')).toBe('not sqlite')
  })

  test('version zero with existing objects is not initialized as an approval schema', () => {
    mkdirSync(dirname(store.path), { recursive: true })
    sql((db) => db.exec('CREATE TABLE unrelated (value TEXT)'))
    expect(() => store.issueOrReuse(binding)).toThrow('Unknown approval database schema')
  })

  test('invalid directories, symlink files and sidecars fail closed', () => {
    mkdirSync(join(home, 'outside'))
    symlinkSync(join(home, 'outside'), join(home, '.clooks'))
    expect(() => store.exists()).toThrow('directory')
    expect(() => store.issueOrReuse(binding)).toThrow('directory')
    rmSync(join(home, '.clooks'))
    store.issueOrReuse(binding)
    rmSync(store.path)
    symlinkSync(join(home, 'outside'), store.path)
    expect(() => store.issueOrReuse(binding)).toThrow('database')
    rmSync(store.path)
    store.issueOrReuse(binding)
    symlinkSync(join(home, 'outside'), store.path + '-journal')
    expect(() => store.issueOrReuse(binding)).toThrow('sidecar')
  })

  test('wrong home does not search elsewhere; environment override matches explicit path', () => {
    const issued = store.issueOrReuse(binding)
    expect(() => new ApprovalStore(join(home, 'other')).acknowledge(issued.token)).toThrow(
      'Unknown',
    )
    const old = process.env.CLOOKS_HOME_ROOT
    try {
      process.env.CLOOKS_HOME_ROOT = home
      expect(new ApprovalStore().path).toBe(store.path)
      expect(approvalStorePath()).toBe(store.path)
      delete process.env.CLOOKS_HOME_ROOT
      expect(approvalStorePath()).toEndWith('/.clooks/approvals/codex.sqlite')
      expect(new ApprovalStore().path).toBe(approvalStorePath())
    } finally {
      if (old === undefined) delete process.env.CLOOKS_HOME_ROOT
      else process.env.CLOOKS_HOME_ROOT = old
    }
  })
})

const worker = join(import.meta.dir, '../../../test/fixtures/approval-store-worker.ts')
function workerOptions() {
  const cwd = join(home, 'project')
  mkdirSync(cwd, { recursive: true })
  return {
    cwd,
    env: {
      HOME: home,
      CODEX_HOME: join(home, '.codex'),
      CLOOKS_HOME_ROOT: home,
      PATH: '/usr/bin:/bin',
    },
    stdout: 'pipe' as const,
    stderr: 'pipe' as const,
    timeout: 7000,
  }
}
async function ready(paths: string[]) {
  const deadline = Date.now() + 5000
  while (!paths.every((path) => existsSync(path))) {
    if (Date.now() > deadline) throw new Error('Worker did not reach barrier')
    await Bun.sleep(5)
  }
}

async function race(action: string, data: unknown) {
  const gate = join(home, 'gate')
  const signals = [join(home, 'ready-1'), join(home, 'ready-2')]
  const processes = signals.map((signal) =>
    Bun.spawn(
      [process.execPath, worker, home, action, signal, gate, JSON.stringify(data)],
      workerOptions(),
    ),
  )
  try {
    await ready(signals)
    writeFileSync(gate, '')
    return await Promise.all(
      processes.map(async (child) => ({
        code: await child.exited,
        stdout: await new Response(child.stdout).text(),
        stderr: await new Response(child.stderr).text(),
      })),
    )
  } finally {
    for (const child of processes) child.kill()
    await Promise.all(processes.map((child) => child.exited))
  }
}

describe('independent process transactions', () => {
  test('concurrent first issuance returns the same recoverable token and fixed deadline', async () => {
    const results = await race('issue', binding)
    expect(results.map((result) => result.code)).toEqual([0, 0])
    const records = results.map((result) => JSON.parse(result.stdout) as ApprovalRecord)
    expect(records[0]).toEqual(records[1])
    expect(records[0]!.expiresAt - records[0]!.issuedAt).toBe(APPROVAL_TTL_MS)
    expect(sql((db) => db.query('SELECT count(*) AS count FROM approvals').get())).toEqual({
      count: 1,
    })
  }, 15_000)

  test('two processes requiring the same two tokens yield exactly one permit', async () => {
    store = new ApprovalStore(home)
    const a = store.issueOrReuse(binding)
    const b = store.issueOrReuse({ ...binding, confirmationHash: other })
    store.acknowledge(a.token)
    store.acknowledge(b.token)
    const results = await race('consume', {
      ...binding,
      requiredTokens: [required(a), required(b)],
    })
    expect(results.map((result) => result.code).sort()).toEqual([0, 1])
    expect(results.filter((result) => result.stdout.trim() === 'permit')).toHaveLength(1)
    const loser = results.find((result) => result.code === 1)!
    expect(loser.stdout).toBe('')
    expect(loser.stderr.trim()).toBe('Approval is no longer valid for this permit')
    expect(results.find((result) => result.code === 0)!.stderr).toBe('')
    expect(row(a.token)?.consumedAt).not.toBeNull()
    expect(row(b.token)?.consumedAt).toBe(row(a.token)?.consumedAt)
  }, 15_000)

  test('expiry clock is sampled after waiting for another process write lock', async () => {
    const issued = store.issueOrReuse(binding)
    const signal = join(home, 'locked')
    const release = join(home, 'release')
    const waiting = join(home, 'waiting')
    const clockReceipt = join(home, 'clock')
    const child = Bun.spawn(
      [process.execPath, worker, home, 'lock', signal, release],
      workerOptions(),
    )
    let contender: ReturnType<typeof Bun.spawn> | undefined
    try {
      await ready([signal])
      const ack = Bun.spawn(
        [
          process.execPath,
          worker,
          home,
          'acknowledge',
          waiting,
          release,
          JSON.stringify({ token: issued.token, expiresAt: issued.expiresAt, clockReceipt }),
        ],
        workerOptions(),
      )
      contender = ack
      await ready([waiting])
      expect(existsSync(clockReceipt)).toBe(false)
      const releasedAt = Date.now()
      writeFileSync(release, '')
      expect(await ack.exited).toBe(1)
      expect(await new Response(ack.stdout).text()).toBe('')
      expect((await new Response(ack.stderr).text()).trim()).toBe(
        'Unknown, expired or consumed approval token',
      )
      const observed = JSON.parse(readFileSync(clockReceipt, 'utf8'))
      expect(observed.released).toBe(true)
      expect(observed.sampledAt).toBeGreaterThanOrEqual(releasedAt)
      expect(await child.exited).toBe(0)
      expect(row(issued.token)?.acknowledgedAt).toBeNull()
    } finally {
      contender?.kill()
      child.kill()
      if (contender) await contender.exited
      await child.exited
    }
  }, 15_000)

  test('held-lock timeout is bounded, changes nothing and permits retry after release', async () => {
    const issued = store.issueOrReuse(binding)
    const signal = join(home, 'locked')
    const release = join(home, 'release')
    const child = Bun.spawn(
      [process.execPath, worker, home, 'lock', signal, release],
      workerOptions(),
    )
    let clockCalls = 0
    const contender = new ApprovalStore(home, () => {
      clockCalls++
      return now
    })
    try {
      await ready([signal])
      const started = performance.now()
      expect(() => contender.acknowledge(issued.token)).toThrow('Approval storage unavailable')
      expect(performance.now() - started).toBeGreaterThanOrEqual(900)
      expect(performance.now() - started).toBeLessThan(3000)
      expect(clockCalls).toBe(0)
      writeFileSync(release, '')
      expect(await child.exited).toBe(0)
      expect(row(issued.token)).toEqual(issued)
      expect(contender.acknowledge(issued.token).acknowledgedAt).toBe(now)
      expect(clockCalls).toBe(1)
    } finally {
      child.kill()
      await child.exited
    }
  }, 15_000)
})
