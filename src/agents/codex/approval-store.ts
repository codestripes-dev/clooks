import { Database } from 'bun:sqlite'
import { randomBytes } from 'node:crypto'
import { chmodSync, lstatSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const APPROVAL_TTL_MS = 300_000
export const APPROVAL_MAX_ROWS = 10_000
export const APPROVAL_MAX_TOKENS = 64
export const APPROVAL_MAX_BYTES = 16 * 1024 * 1024
const TOKEN = /^ca1_[0-9a-f]{64}$/
const HASH = /^[0-9a-f]{64}$/

export interface InvocationBinding {
  baseInvocationHash: string
  decisionHash: string
}

export interface ApprovalBinding extends InvocationBinding {
  confirmationHash: string
}

export interface ApprovalRecord extends ApprovalBinding {
  token: string
  issuedAt: number
  expiresAt: number
  acknowledgedAt: number | null
  consumedAt: number | null
}

export interface RequiredApproval {
  token: string
  expectedConfirmationHash: string
}

export interface ResolvedApprovals {
  requiredTokens: RequiredApproval[]
  pendingConfirmations: string[]
}

export class ApprovalStoreError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ApprovalStoreError'
  }
}

export function approvalStorePath(homeRoot = process.env.CLOOKS_HOME_ROOT ?? homedir()): string {
  return join(homeRoot, '.clooks', 'approvals', 'codex.sqlite')
}

function stat(path: string) {
  try {
    return lstatSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function hash(value: string): void {
  if (!HASH.test(value)) throw new ApprovalStoreError('Invalid approval binding hash')
}

function tokenId(value: string): void {
  if (!TOKEN.test(value)) throw new ApprovalStoreError('Malformed approval token')
}

function bounded(values: readonly unknown[]): void {
  if (values.length > APPROVAL_MAX_TOKENS) {
    throw new ApprovalStoreError('Too many approval confirmations or tokens (maximum 64)')
  }
}

export class ApprovalStore {
  readonly path: string
  private readonly clock: () => number

  constructor(
    homeRoot = process.env.CLOOKS_HOME_ROOT ?? homedir(),
    clock: () => number = Date.now,
  ) {
    this.path = approvalStorePath(homeRoot)
    this.clock = clock
  }

  exists(): boolean {
    for (const path of [dirname(dirname(this.path)), dirname(this.path)]) {
      const info = stat(path)
      if (!info) return false
      if (!info.isDirectory()) throw new ApprovalStoreError('Invalid approval state directory')
    }
    const info = stat(this.path)
    if (!info) return false
    if (!info.isFile() || info.size > APPROVAL_MAX_BYTES) {
      throw new ApprovalStoreError('Invalid or oversized approval database')
    }
    return true
  }

  private write<T>(create: boolean, operation: (db: Database, now: number) => T): T {
    let db: Database | undefined
    let locked = false
    try {
      if (!this.exists() && !create) throw new ApprovalStoreError('Unknown approval token')
      for (const path of [dirname(dirname(this.path)), dirname(this.path)]) {
        mkdirSync(path, { recursive: true, mode: 0o700 })
        if (!lstatSync(path).isDirectory()) {
          throw new ApprovalStoreError('Invalid approval state directory')
        }
      }
      chmodSync(dirname(this.path), 0o700)
      for (const suffix of ['-journal', '-wal', '-shm']) {
        const info = stat(this.path + suffix)
        if (info && !info.isFile())
          throw new ApprovalStoreError('Invalid approval database sidecar')
      }
      db = new Database(this.path, { create, strict: true })
      chmodSync(this.path, 0o600)
      db.exec('PRAGMA busy_timeout = 1000; PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL')
      const pageSize = (db.query('PRAGMA page_size').get() as { page_size: number }).page_size
      db.exec(`PRAGMA max_page_count = ${Math.floor(APPROVAL_MAX_BYTES / pageSize)}`)
      db.exec('BEGIN IMMEDIATE')
      locked = true
      // Expiry is sampled only after serialization, never before waiting for another writer.
      const now = this.clock()
      if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(now + APPROVAL_TTL_MS)) {
        throw new ApprovalStoreError('Invalid approval clock')
      }
      const version = (db.query('PRAGMA user_version').get() as { user_version: number })
        .user_version
      if (version === 0 && create) {
        const tables = db.query('SELECT name FROM sqlite_master').all()
        if (tables.length !== 0) throw new ApprovalStoreError('Unknown approval database schema')
        db.exec(`CREATE TABLE approvals (
          token TEXT PRIMARY KEY NOT NULL,
          baseInvocationHash TEXT NOT NULL,
          decisionHash TEXT NOT NULL,
          confirmationHash TEXT NOT NULL,
          issuedAt INTEGER NOT NULL,
          expiresAt INTEGER NOT NULL,
          acknowledgedAt INTEGER,
          consumedAt INTEGER
        ) STRICT;
        CREATE INDEX approval_base ON approvals(baseInvocationHash);
        CREATE INDEX approval_expiry ON approvals(expiresAt);
        PRAGMA user_version = 1`)
      } else if (version !== 1) {
        throw new ApprovalStoreError('Unknown approval database schema')
      }
      db.query(
        `DELETE FROM approvals WHERE token IN
        (SELECT token FROM approvals WHERE expiresAt <= ? ORDER BY expiresAt LIMIT 256)`,
      ).run(now)
      const result = operation(db, now)
      db.exec('COMMIT')
      locked = false
      return result
    } catch (error) {
      if (locked) {
        try {
          db!.exec('ROLLBACK')
        } catch {
          // Closing the connection below also abandons an uncommitted transaction.
        }
      }
      if (error instanceof ApprovalStoreError) throw error
      throw new ApprovalStoreError('Approval storage unavailable', { cause: error })
    } finally {
      db?.close()
    }
  }

  private live(db: Database, token: string, now: number): ApprovalRecord {
    const record = db
      .query<ApprovalRecord, [string]>('SELECT * FROM approvals WHERE token = ?')
      .get(token)
    if (!record || record.expiresAt <= now || record.consumedAt !== null) {
      throw new ApprovalStoreError('Unknown, expired or consumed approval token')
    }
    return record
  }

  private exact(db: Database, binding: ApprovalBinding, now: number): ApprovalRecord | null {
    const records = db
      .query<ApprovalRecord, [string, string, string, number]>(
        `SELECT * FROM approvals
      WHERE baseInvocationHash = ? AND decisionHash = ? AND confirmationHash = ?
      AND consumedAt IS NULL AND expiresAt > ? LIMIT 2`,
      )
      .all(binding.baseInvocationHash, binding.decisionHash, binding.confirmationHash, now)
    if (records.length > 1) throw new ApprovalStoreError('Duplicate live approval records')
    return records[0] ?? null
  }

  issueOrReuse(binding: ApprovalBinding): ApprovalRecord {
    hash(binding.baseInvocationHash)
    hash(binding.decisionHash)
    hash(binding.confirmationHash)
    return this.write(true, (db, now) => {
      const existing = this.exact(db, binding, now)
      if (existing) return existing
      const { count } = db
        .query<
          { count: number },
          [number]
        >('SELECT count(*) AS count FROM approvals WHERE expiresAt > ?')
        .get(now)!
      if (count >= APPROVAL_MAX_ROWS) throw new ApprovalStoreError('Approval store is full')
      const record: ApprovalRecord = {
        ...binding,
        token: `ca1_${randomBytes(32).toString('hex')}`,
        issuedAt: now,
        expiresAt: now + APPROVAL_TTL_MS,
        acknowledgedAt: null,
        consumedAt: null,
      }
      db.query(`INSERT INTO approvals VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`).run(
        record.token,
        record.baseInvocationHash,
        record.decisionHash,
        record.confirmationHash,
        record.issuedAt,
        record.expiresAt,
      )
      return record
    })
  }

  acknowledge(token: string): ApprovalRecord {
    tokenId(token)
    return this.write(false, (db, now) => {
      const record = this.live(db, token, now)
      db.query(
        'UPDATE approvals SET acknowledgedAt = COALESCE(acknowledgedAt, ?) WHERE token = ?',
      ).run(now, token)
      return { ...record, acknowledgedAt: record.acknowledgedAt ?? now }
    })
  }

  resolveAttempt(
    binding: InvocationBinding,
    presentedTokens: readonly string[],
    confirmations: readonly string[],
  ): ResolvedApprovals {
    hash(binding.baseInvocationHash)
    hash(binding.decisionHash)
    bounded(presentedTokens)
    bounded(confirmations)
    presentedTokens.forEach(tokenId)
    confirmations.forEach(hash)
    const current = [...new Set(confirmations)]
    if (!this.exists() && presentedTokens.length === 0) {
      return { requiredTokens: [], pendingConfirmations: current }
    }
    return this.write(false, (db, now) => {
      for (const token of new Set(presentedTokens)) {
        const record = this.live(db, token, now)
        if (
          record.baseInvocationHash !== binding.baseInvocationHash ||
          record.decisionHash !== binding.decisionHash ||
          !current.includes(record.confirmationHash)
        ) {
          throw new ApprovalStoreError('Approval token does not match the current confirmation')
        }
        db.query(
          'UPDATE approvals SET acknowledgedAt = COALESCE(acknowledgedAt, ?) WHERE token = ?',
        ).run(now, token)
      }
      const requiredTokens: RequiredApproval[] = []
      const pendingConfirmations: string[] = []
      for (const confirmationHash of current) {
        const record = this.exact(db, { ...binding, confirmationHash }, now)
        if (record?.acknowledgedAt != null) {
          requiredTokens.push({ token: record.token, expectedConfirmationHash: confirmationHash })
        } else pendingConfirmations.push(confirmationHash)
      }
      return { requiredTokens, pendingConfirmations }
    })
  }

  finalizePermit(
    baseInvocationHash: string,
    expectedDecisionHash: string | null,
    requiredTokens: readonly RequiredApproval[],
  ): void {
    hash(baseInvocationHash)
    if (expectedDecisionHash !== null) hash(expectedDecisionHash)
    bounded(requiredTokens)
    if (expectedDecisionHash === null && requiredTokens.length > 0) {
      throw new ApprovalStoreError('Required approvals need an expected decision hash')
    }
    const seen = new Set<string>()
    for (const required of requiredTokens) {
      tokenId(required.token)
      hash(required.expectedConfirmationHash)
      if (seen.has(required.token))
        throw new ApprovalStoreError('Duplicate required approval token')
      seen.add(required.token)
    }
    if (requiredTokens.length === 0 && !this.exists()) return
    this.write(false, (db, now) => {
      for (const required of requiredTokens) {
        const result = db
          .query(
            `UPDATE approvals SET consumedAt = ?
          WHERE token = ? AND baseInvocationHash = ? AND decisionHash = ? AND confirmationHash = ?
          AND acknowledgedAt IS NOT NULL AND consumedAt IS NULL AND expiresAt > ?`,
          )
          .run(
            now,
            required.token,
            baseInvocationHash,
            expectedDecisionHash,
            required.expectedConfirmationHash,
            now,
          )
        if (result.changes !== 1)
          throw new ApprovalStoreError('Approval is no longer valid for this permit')
      }
      db.query(
        `UPDATE approvals SET consumedAt = ? WHERE baseInvocationHash = ?
        AND acknowledgedAt IS NOT NULL AND consumedAt IS NULL`,
      ).run(now, baseInvocationHash)
    })
  }
}
