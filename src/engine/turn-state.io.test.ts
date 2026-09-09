import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { stat, utimes } from 'fs/promises'
import * as fsPromises from 'node:fs/promises'
import { randomUUID } from 'crypto'
import { basename, dirname, join } from 'path'
import { tmpdir } from 'os'
import type { EventName, HookName } from '../types/branded.js'
import type { TurnRecord } from '../types/turn.js'
import {
  acquireTurnLock,
  applyTurnBoundary,
  commitTurnRecords,
  emptyTurnState,
  materializeTurn,
  pruneTurnState,
  readTurnState,
  releaseTurnLock,
  resetTurnStateWarnings,
  turnStampOf,
  turnStatePath,
  verifyTurnLock,
  TURN_STATE_LOCK_MAX_WAIT_MS,
  TURN_STATE_LOCK_STALE_MS,
  TURN_STATE_LOCK_TTL_MS,
  TURN_STATE_MAX_BYTES,
  TURN_STATE_MAX_FILES,
  TURN_STATE_MAX_RECORDS_PER_HOOK,
  TURN_STATE_TTL_MS,
  TURN_STATE_VERSION,
  type PendingTurnRecord,
  type TurnStamp,
  type TurnState,
} from './turn-state.js'

const tempDirs: string[] = []
let warnings: string[] = []
let stderrSpy: ReturnType<typeof spyOn> | undefined

beforeEach(() => {
  resetTurnStateWarnings()
  warnings = []
  stderrSpy = spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    warnings.push(String(chunk))
    return true
  })
})

afterEach(() => {
  stderrSpy?.mockRestore()
  stderrSpy = undefined
  resetTurnStateWarnings()
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

/** A temp directory standing in for the user's home root, fully resolved. */
function makeHome(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'clooks-turn-')))
  tempDirs.push(dir)
  return dir
}

function makeOutside(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'clooks-outside-')))
  tempDirs.push(dir)
  return dir
}

async function expectUnrelatedIO(): Promise<void> {
  const root = makeOutside()
  const path = join(root, 'control.json.stale-control.tmp')
  const renamed = join(root, 'renamed.json.stale-control.tmp')
  await fsPromises.writeFile(path, 'unrelated contents', { flag: 'wx' })
  const handle = await fsPromises.open(path, 'r')
  try {
    expect(await handle.readFile('utf8')).toBe('unrelated contents')
  } finally {
    await handle.close()
  }
  await fsPromises.rename(path, renamed)
  expect(readFileSync(renamed, 'utf8')).toBe('unrelated contents')
  await fsPromises.unlink(renamed)
  expect(readdirSync(root)).toEqual([])
}

const SESSION = 'session-abc'
const EPOCH = 'abcdef0123456789'
const STOP = 'Stop' as EventName

function statePathFor(home: string, sessionId: string = SESSION): string {
  return turnStatePath(home, sessionId)
}

/** Creates `<home>/.clooks/turn-state` as a real directory. */
function makeStateDir(home: string): string {
  const dir = join(home, '.clooks', 'turn-state')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

function writeRaw(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, contents, { mode: 0o600 })
}

function record(event = 'Stop', decision = 'block', at = '2026-08-04T10:00:00.000Z'): TurnRecord {
  return { event, decision, at } as TurnRecord
}

function pending(
  hookName: string,
  scopeKey = 'main',
  rec: TurnRecord = record(),
): PendingTurnRecord {
  return { scopeKey, hookName: hookName as HookName, record: rec }
}

function stamp(generation: number, epoch = EPOCH): TurnStamp {
  return { epoch, generation }
}

function readState(path: string): TurnState {
  return JSON.parse(readFileSync(path, 'utf8')) as TurnState
}

function scopeOf(state: TurnState, key: string): Record<string, TurnRecord[]> | undefined {
  return Object.hasOwn(state.scopes, key) ? state.scopes[key] : undefined
}

function stagingFiles(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.endsWith('.tmp'))
}

/**
 * An empty document is no longer value-comparable — every one carries a fresh
 * epoch, which is the point — so assert its shape instead.
 */
function expectEmptyState(state: TurnState): void {
  expect(state.version).toBe(TURN_STATE_VERSION)
  expect(state.generation).toBe(0)
  expect(state.scopes).toEqual({})
  expect(state.epoch).toMatch(/^[0-9a-f]{16}$/)
}

/** A state document serializing to exactly `bytes` bytes. */
function stateOfSize(bytes: number): TurnState {
  const skeleton: TurnState = {
    version: TURN_STATE_VERSION,
    epoch: EPOCH,
    generation: 0,
    updatedAt: new Date(0).toISOString(),
    scopes: { main: { '': [] } },
  }
  const overhead = Buffer.byteLength(JSON.stringify(skeleton), 'utf8')
  const name = 'h'.repeat(Math.max(1, bytes - overhead))
  return { ...skeleton, scopes: { main: { [name]: [] } } }
}

const AGES_AGO = new Date(Date.now() - TURN_STATE_TTL_MS - 60_000)
/** Comfortably past the (now one-minute) staleness threshold. */
const LONG_ABANDONED = new Date(Date.now() - TURN_STATE_LOCK_STALE_MS - 60_000)

describe('turn-state cleanup failures', () => {
  it('commits through descriptor-close errors during directory checks, stale-lock probing and reads', async () => {
    const home = makeHome()
    makeStateDir(home)
    const path = statePathFor(home)
    const stored = emptyTurnState()
    writeRaw(path, JSON.stringify(stored))
    writeRaw(`${path}.lock`, JSON.stringify({ token: 'abandoned' }))
    await utimes(`${path}.lock`, LONG_ABANDONED, LONG_ABANDONED)
    const originalOpen = fsPromises.open
    let closeFailed = false
    const openSpy = spyOn(fsPromises, 'open').mockImplementation(async (...args) => {
      const handle = await originalOpen(...args)
      const target = String(args[0])
      if (target !== dirname(path) && target !== path && target !== `${path}.lock`) return handle
      const close = handle.close.bind(handle)
      handle.close = async () => {
        await close()
        closeFailed = true
        throw new Error('descriptor close reported failure')
      }
      return handle
    })
    try {
      await expectUnrelatedIO()
      await commitTurnRecords(path, home, turnStampOf(stored), [pending('lint-reminder')])
      expect(readState(path).scopes.main?.['lint-reminder']).toEqual([record()])
      expect(closeFailed).toBe(true)
      expect(existsSync(`${path}.lock`)).toBe(false)
      expect(stagingFiles(dirname(path))).toEqual([])
    } finally {
      openSpy.mockRestore()
    }
  })

  it('acquires a stale lock even if deleting the renamed old lock fails', async () => {
    const home = makeHome()
    makeStateDir(home)
    const path = statePathFor(home)
    writeRaw(`${path}.lock`, JSON.stringify({ token: 'abandoned' }))
    await utimes(`${path}.lock`, LONG_ABANDONED, LONG_ABANDONED)
    const originalUnlink = fsPromises.unlink
    let residue: string | undefined
    const unlinkSpy = spyOn(fsPromises, 'unlink').mockImplementation(async (target) => {
      if (String(target).startsWith(`${path}.lock.stale-`)) {
        residue = String(target)
        throw new Error('stale cleanup failed')
      }
      return originalUnlink(target)
    })
    try {
      await expectUnrelatedIO()
      const token = await acquireTurnLock(path)
      expect(token).not.toBeNull()
      expect(await verifyTurnLock(path, token!)).toBe(true)
      expect(residue).toBeDefined()
      expect(JSON.parse(readFileSync(residue!, 'utf8'))).toEqual({ token: 'abandoned' })
      await releaseTurnLock(path, token!)
      expect(existsSync(`${path}.lock`)).toBe(false)
      expect(existsSync(residue!)).toBe(true)
    } finally {
      unlinkSpy.mockRestore()
    }
  })

  it.each(['partial-write', 'publish'] as const)(
    'preserves existing history when %s and staging cleanup fail',
    async (failure) => {
      const home = makeHome()
      makeStateDir(home)
      const path = statePathFor(home)
      const stored = { ...emptyTurnState(), scopes: { main: { existing: [record()] } } }
      const bytes = JSON.stringify(stored)
      writeRaw(path, bytes)
      const originalWrite = fsPromises.writeFile
      const originalUnlink = fsPromises.unlink
      const originalRename = fsPromises.rename
      let staged: string | undefined
      let writeFailed = false
      let publishFailed = false
      let cleanupFailed = false
      const writeSpy = spyOn(fsPromises, 'writeFile').mockImplementation(
        async (target, data, options) => {
          if (String(target).startsWith(`${path}.`) && String(target).endsWith('.tmp')) {
            staged = String(target)
            if (failure === 'partial-write') {
              await originalWrite(target, 'partial', options)
              writeFailed = true
              throw new Error('partial write failed')
            }
          }
          return originalWrite(target, data, options)
        },
      )
      const renameSpy = spyOn(fsPromises, 'rename').mockImplementation(async (source, target) => {
        if (String(source) === staged && String(target) === path) {
          publishFailed = true
          throw new Error('publish failed')
        }
        return originalRename(source, target)
      })
      const unlinkSpy = spyOn(fsPromises, 'unlink').mockImplementation(async (target) => {
        if (String(target) === staged) {
          cleanupFailed = true
          throw new Error('staging cleanup failed')
        }
        return originalUnlink(target)
      })
      try {
        await expectUnrelatedIO()
        await commitTurnRecords(path, home, turnStampOf(stored), [pending('new-hook')])
        expect(readFileSync(path, 'utf8')).toBe(bytes)
        expect(staged).toBeDefined()
        expect(cleanupFailed).toBe(true)
        expect(existsSync(staged!)).toBe(true)
        expect(existsSync(`${path}.lock`)).toBe(false)
        expect(warnings.join('')).toContain(
          failure === 'partial-write' ? 'partial write failed' : 'publish failed',
        )
        expect(writeFailed).toBe(failure === 'partial-write')
        expect(publishFailed).toBe(failure === 'publish')
      } finally {
        unlinkSpy.mockRestore()
        renameSpy.mockRestore()
        writeSpy.mockRestore()
      }
    },
  )

  it.each(['commit', 'boundary'] as const)(
    '%s abandons publication after takeover even when staging cleanup fails',
    async (operation) => {
      const home = makeHome()
      makeStateDir(home)
      const path = statePathFor(home)
      const stored = { ...emptyTurnState(), scopes: { main: { existing: [record()] } } }
      const bytes = JSON.stringify(stored)
      writeRaw(path, bytes)
      const originalWrite = fsPromises.writeFile
      const originalUnlink = fsPromises.unlink
      let staged: string | undefined
      let cleanupFailed = false
      const writeSpy = spyOn(fsPromises, 'writeFile').mockImplementation(
        async (target, data, options) => {
          await originalWrite(target, data, options)
          if (String(target).startsWith(`${path}.`) && String(target).endsWith('.tmp')) {
            staged = String(target)
            await originalWrite(`${path}.lock`, JSON.stringify({ token: 'new-owner' }))
          }
        },
      )
      const unlinkSpy = spyOn(fsPromises, 'unlink').mockImplementation(async (target) => {
        if (String(target) === staged) {
          cleanupFailed = true
          throw new Error('cleanup failed')
        }
        return originalUnlink(target)
      })
      try {
        await expectUnrelatedIO()
        if (operation === 'commit') {
          await commitTurnRecords(path, home, turnStampOf(stored), [pending('new-hook')])
        } else {
          expect(await applyTurnBoundary(path, home, 'advance')).toEqual(stored)
        }
        expect(readFileSync(path, 'utf8')).toBe(bytes)
        expect(await verifyTurnLock(path, 'new-owner')).toBe(true)
        expect(staged).toBeDefined()
        expect(existsSync(staged!)).toBe(true)
        expect(cleanupFailed).toBe(true)
        expect(warnings.join('')).toContain('taken over mid-write')
      } finally {
        unlinkSpy.mockRestore()
        writeSpy.mockRestore()
      }
    },
  )

  it('retains committed history when releasing the owned lock fails', async () => {
    const home = makeHome()
    makeStateDir(home)
    const path = statePathFor(home)
    const stored = emptyTurnState()
    writeRaw(path, JSON.stringify(stored))
    const originalUnlink = fsPromises.unlink
    let cleanupFailed = false
    const unlinkSpy = spyOn(fsPromises, 'unlink').mockImplementation(async (target) => {
      if (String(target) === `${path}.lock`) {
        cleanupFailed = true
        throw new Error('lock cleanup failed')
      }
      return originalUnlink(target)
    })
    try {
      await expectUnrelatedIO()
      await commitTurnRecords(path, home, turnStampOf(stored), [pending('lint-reminder')])
      expect(readState(path).scopes.main?.['lint-reminder']).toEqual([record()])
      expect(cleanupFailed).toBe(true)
      const lock = JSON.parse(readFileSync(`${path}.lock`, 'utf8')) as { token: string }
      expect(await verifyTurnLock(path, lock.token)).toBe(true)
      expect(stagingFiles(dirname(path))).toEqual([])
    } finally {
      unlinkSpy.mockRestore()
    }
  })

  it('leaves session files intact when cap eviction fails', async () => {
    const home = makeHome()
    const dir = makeStateDir(home)
    const oldest = new Date(Date.now() - 60_000)
    const paths: string[] = []
    for (let i = 0; i <= TURN_STATE_MAX_FILES; i++) {
      const path = join(dir, `${i.toString(16).padStart(16, '0')}.json`)
      writeFileSync(path, `session-${i}`)
      paths.push(path)
    }
    await utimes(paths[0]!, oldest, oldest)
    const originalUnlink = fsPromises.unlink
    let evictionFailed = false
    const unlinkSpy = spyOn(fsPromises, 'unlink').mockImplementation(async (target) => {
      if (String(target) === paths[0]) {
        evictionFailed = true
        throw new Error('eviction failed')
      }
      return originalUnlink(target)
    })
    try {
      await expectUnrelatedIO()
      await pruneTurnState(home)
      expect(evictionFailed).toBe(true)
      expect(readdirSync(dir)).toHaveLength(TURN_STATE_MAX_FILES + 1)
      for (const [i, path] of paths.entries())
        expect(readFileSync(path, 'utf8')).toBe(`session-${i}`)
    } finally {
      unlinkSpy.mockRestore()
    }
  })
})

describe('turnStatePath', () => {
  it('hashes the session id and never interpolates it', () => {
    const home = makeHome()
    const path = turnStatePath(home, 'my-secret-session-id')

    expect(path).not.toContain('my-secret-session-id')
    expect(basename(path)).toMatch(/^[0-9a-f]{16}\.json$/)
    expect(path).toBe(join(home, '.clooks', 'turn-state', basename(path)))
  })

  it('is stable for one session and distinct across sessions', () => {
    const home = makeHome()
    expect(turnStatePath(home, 'a')).toBe(turnStatePath(home, 'a'))
    expect(turnStatePath(home, 'a')).not.toBe(turnStatePath(home, 'b'))
  })
})

describe('readTurnState', () => {
  it('returns empty state for a missing file, without warning', async () => {
    const home = makeHome()
    expectEmptyState(await readTurnState(statePathFor(home)))
    expect(warnings).toEqual([])
  })

  it('returns empty state for an empty file', async () => {
    const home = makeHome()
    const path = statePathFor(home)
    writeRaw(path, '')

    expectEmptyState(await readTurnState(path))
  })

  it('returns empty state for invalid JSON', async () => {
    const home = makeHome()
    const path = statePathFor(home)
    writeRaw(path, '{not json')

    expectEmptyState(await readTurnState(path))
  })

  it('returns empty state for a JSON array', async () => {
    const home = makeHome()
    const path = statePathFor(home)
    writeRaw(path, '[]')

    expectEmptyState(await readTurnState(path))
  })

  it('returns empty state for an unrecognized version', async () => {
    const home = makeHome()
    const path = statePathFor(home)
    writeRaw(path, JSON.stringify({ ...emptyTurnState(), version: 99 }))

    expectEmptyState(await readTurnState(path))
  })

  it('returns empty state for a missing epoch or an unusable generation', async () => {
    const home = makeHome()

    const broken: Record<string, unknown>[] = [
      { ...emptyTurnState(), epoch: undefined },
      { ...emptyTurnState(), epoch: '' },
      { ...emptyTurnState(), generation: -1 },
      { ...emptyTurnState(), generation: 2.5 },
    ]
    for (const [index, doc] of broken.entries()) {
      const path = statePathFor(home, `broken-${index}`)
      writeRaw(path, JSON.stringify(doc))
      expectEmptyState(await readTurnState(path))
    }
  })

  it('returns empty state when a nested per-hook value is not an array', async () => {
    const home = makeHome()
    const path = statePathFor(home)
    writeRaw(
      path,
      JSON.stringify({ ...emptyTurnState(), scopes: { main: { 'lint-reminder': 'nope' } } }),
    )

    expectEmptyState(await readTurnState(path))
  })

  it('reads a well-formed document', async () => {
    const home = makeHome()
    const path = statePathFor(home)
    const stored: TurnState = {
      version: TURN_STATE_VERSION,
      epoch: EPOCH,
      generation: 4,
      updatedAt: '2026-08-04T10:00:00.000Z',
      scopes: { main: { 'lint-reminder': [record()] } },
    }
    writeRaw(path, JSON.stringify(stored))

    const state = await readTurnState(path)
    expect(state.epoch).toBe(EPOCH)
    expect(state.generation).toBe(4)
    expect(scopeOf(state, 'main')!['lint-reminder']).toEqual([record()])
  })

  it('drops records whose decision or event is outside the known sets', async () => {
    const home = makeHome()
    const path = statePathFor(home)
    const good = record('Stop', 'block', '2026-08-04T10:00:02.000Z')
    writeRaw(
      path,
      JSON.stringify({
        ...emptyTurnState(),
        scopes: {
          main: {
            'lint-reminder': [
              record('Stop', 'nonsense', '2026-08-04T10:00:00.000Z'),
              record('NotAnEvent', 'block', '2026-08-04T10:00:01.000Z'),
              record('Stop', 'toString', '2026-08-04T10:00:03.000Z'),
              good,
            ],
          },
        },
      }),
    )

    const state = await readTurnState(path)
    // The surrounding document survives; only the unusable entries are dropped,
    // because discarding a whole turn over one bad record is the record loss
    // the feature exists to prevent.
    expect(scopeOf(state, 'main')!['lint-reminder']).toEqual([good])

    const turn = materializeTurn(scopeOf(state, 'main'), 'lint-reminder' as HookName, STOP)
    expect(turn.prior).toEqual([good])
    expect(turn.priorInterventions).toBe(1)
  })

  it('rejects an oversized file by its fstat size, never returning its contents', async () => {
    const home = makeHome()
    const path = statePathFor(home)
    // Valid, parseable, and one byte over the bound: the only thing that can
    // make this read empty is the size check happening before the body read.
    const oversized = stateOfSize(TURN_STATE_MAX_BYTES + 1)
    writeRaw(path, JSON.stringify(oversized))
    expect((await stat(path)).size).toBe(TURN_STATE_MAX_BYTES + 1)

    const state = await readTurnState(path)
    expectEmptyState(state)
    expect(state.epoch).not.toBe(EPOCH)
    expect(warnings.join('')).toContain('size bound')
  })

  it('does not follow a symlink planted at the state path', async () => {
    const home = makeHome()
    const outside = makeOutside()
    const secret = join(outside, 'secret.json')
    const stored: TurnState = {
      version: TURN_STATE_VERSION,
      epoch: EPOCH,
      generation: 7,
      updatedAt: '2026-08-04T10:00:00.000Z',
      scopes: { main: { evil: [record()] } },
    }
    writeFileSync(secret, JSON.stringify(stored))

    const path = statePathFor(home)
    makeStateDir(home)
    symlinkSync(secret, path)

    const state = await readTurnState(path)
    expectEmptyState(state)
    expect(state.generation).not.toBe(7)
    expect(readState(secret)).toEqual(stored)
  })

  it('never observes a partially written document across an atomic replace', async () => {
    const home = makeHome()
    const path = statePathFor(home)
    const dir = makeStateDir(home)

    writeRaw(path, JSON.stringify({ ...emptyTurnState(), epoch: EPOCH, generation: 1 }))

    // The commit path only ever publishes by rename, so a reader sees one whole
    // document or the other — never a mix.
    const staging = join(dir, `${basename(path)}.0-abcdef.tmp`)
    writeFileSync(staging, JSON.stringify({ ...emptyTurnState(), epoch: EPOCH, generation: 2 }))
    renameSync(staging, path)

    const state = await readTurnState(path)
    expect(state.generation).toBe(2)
    expect(state.scopes).toEqual({})
  })

  it('never throws on any failure path', async () => {
    const home = makeHome()
    const dir = makeStateDir(home)
    mkdirSync(join(dir, basename(statePathFor(home))))

    expectEmptyState(await readTurnState(statePathFor(home)))
  })

  it('emits at most one warning across several failing reads', async () => {
    const home = makeHome()
    const a = statePathFor(home, 'a')
    const b = statePathFor(home, 'b')
    writeRaw(a, '{not json')
    writeRaw(b, '[]')

    await readTurnState(a)
    await readTurnState(b)

    expect(warnings.length).toBe(1)
  })
})

describe('turn lock', () => {
  it('acquires, writing a 0600 lockfile carrying pid and token', async () => {
    const home = makeHome()
    makeStateDir(home)
    const path = statePathFor(home)

    const token = await acquireTurnLock(path)
    expect(token).toMatch(/^[0-9a-f]{32}$/)

    const lock = `${path}.lock`
    expect((await stat(lock)).mode & 0o777).toBe(0o600)

    const body = JSON.parse(readFileSync(lock, 'utf8')) as Record<string, unknown>
    expect(body.pid).toBe(process.pid)
    expect(body.token).toBe(token)
    expect(typeof body.at).toBe('string')
  })

  it('gives up within the advertised wait budget when the lock is held and fresh', async () => {
    const home = makeHome()
    makeStateDir(home)
    const path = statePathFor(home)

    const first = await acquireTurnLock(path)
    expect(first).not.toBeNull()

    const start = performance.now()
    const second = await acquireTurnLock(path)
    const elapsed = performance.now() - start

    expect(second).toBeNull()
    // The backoff ladder sums to 155ms and each sleep is clipped to the
    // remaining budget, so the wait must stay close to the stated bound.
    expect(elapsed).toBeGreaterThan(50)
    expect(elapsed).toBeLessThan(TURN_STATE_LOCK_MAX_WAIT_MS * 3)
    expect(await verifyTurnLock(path, first!)).toBe(true)
  })

  it('does not steal a lock that is only a few seconds old', async () => {
    const home = makeHome()
    makeStateDir(home)
    const path = statePathFor(home)
    const lock = `${path}.lock`

    const held = await acquireTurnLock(path)
    const recent = new Date(Date.now() - 5_000)
    await utimes(lock, recent, recent)

    // Five seconds is an eternity for a millisecond-scale critical section, but
    // the threshold is deliberately generous: stealing from a live owner is a
    // worse outcome than waiting out a crashed one.
    expect(await acquireTurnLock(path)).toBeNull()
    expect(await verifyTurnLock(path, held!)).toBe(true)
  })

  it('takes over a long-abandoned lock and ends up holding its own token', async () => {
    const home = makeHome()
    makeStateDir(home)
    const path = statePathFor(home)
    const lock = `${path}.lock`

    const stale = await acquireTurnLock(path)
    await utimes(lock, LONG_ABANDONED, LONG_ABANDONED)

    const fresh = await acquireTurnLock(path)
    expect(fresh).not.toBeNull()
    expect(fresh).not.toBe(stale)
    expect(await verifyTurnLock(path, fresh!)).toBe(true)
    expect(await verifyTurnLock(path, stale!)).toBe(false)
    expect(readdirSync(dirname(path)).filter((n) => n.includes('.stale-'))).toEqual([])
  })

  it('lets exactly one of two contenders own the lock after racing one stale lock', async () => {
    const home = makeHome()
    makeStateDir(home)
    const path = statePathFor(home)
    const lock = `${path}.lock`

    await acquireTurnLock(path)
    await utimes(lock, LONG_ABANDONED, LONG_ABANDONED)

    const [a, b] = await Promise.all([acquireTurnLock(path), acquireTurnLock(path)])
    const claimed = [a, b].filter((t): t is string => t !== null)
    expect(claimed.length).toBeGreaterThanOrEqual(1)

    const verified = await Promise.all(claimed.map((t) => verifyTurnLock(path, t)))
    // A loser may still have been handed a token, but only one token is on disk:
    // the other holder must discover it was taken over before it writes.
    expect(verified.filter(Boolean).length).toBe(1)
    expect(existsSync(lock)).toBe(true)
  })

  it('does not let a taken-over owner delete the new holder’s lock', async () => {
    const home = makeHome()
    makeStateDir(home)
    const path = statePathFor(home)
    const lock = `${path}.lock`

    const old = await acquireTurnLock(path)
    await utimes(lock, LONG_ABANDONED, LONG_ABANDONED)
    const holder = await acquireTurnLock(path)

    expect(await verifyTurnLock(path, old!)).toBe(false)

    await releaseTurnLock(path, old!)

    expect(existsSync(lock)).toBe(true)
    expect(await verifyTurnLock(path, holder!)).toBe(true)
    expect(warnings.join('')).toContain('taken over')
  })

  it('releases a lock it still owns', async () => {
    const home = makeHome()
    makeStateDir(home)
    const path = statePathFor(home)

    const token = await acquireTurnLock(path)
    await releaseTurnLock(path, token!)

    expect(existsSync(`${path}.lock`)).toBe(false)
    expect(await verifyTurnLock(path, token!)).toBe(false)
  })

  it('refuses to acquire when a symlink is planted at the lock path', async () => {
    const home = makeHome()
    const outside = makeOutside()
    const decoy = join(outside, 'decoy.lock')
    writeFileSync(decoy, JSON.stringify({ pid: 1, token: 'attacker', at: 'x' }))

    makeStateDir(home)
    const path = statePathFor(home)
    symlinkSync(decoy, `${path}.lock`)

    expect(await acquireTurnLock(path)).toBeNull()
    expect(JSON.parse(readFileSync(decoy, 'utf8')).token).toBe('attacker')
    expect(warnings.join('')).toContain('not a regular file')
  })

  it('verifyTurnLock is false for a missing lock and for a foreign token', async () => {
    const home = makeHome()
    makeStateDir(home)
    const path = statePathFor(home)

    expect(await verifyTurnLock(path, 'anything')).toBe(false)
    const token = await acquireTurnLock(path)
    expect(await verifyTurnLock(path, `${token}x`)).toBe(false)
  })
})

describe('commitTurnRecords', () => {
  it('creates the file 0600 inside a 0700 directory with the documented shape', async () => {
    const home = makeHome()
    const path = statePathFor(home)
    const fresh = await readTurnState(path)

    await commitTurnRecords(path, home, turnStampOf(fresh), [pending('lint-reminder')])

    expect((await stat(dirname(path))).mode & 0o777).toBe(0o700)
    expect((await stat(path)).mode & 0o777).toBe(0o600)

    const state = readState(path)
    expect(state.version).toBe(TURN_STATE_VERSION)
    expect(state.generation).toBe(0)
    expect(state.epoch).toBe(fresh.epoch)
    expect(typeof state.updatedAt).toBe('string')
    expect(state.scopes).toEqual({ main: { 'lint-reminder': [record()] } })
    expect(existsSync(`${path}.lock`)).toBe(false)
  })

  it('tightens a pre-existing loose directory to 0700 before writing', async () => {
    const home = makeHome()
    const dir = makeStateDir(home)
    chmodSync(dir, 0o777)
    expect((await stat(dir)).mode & 0o777).toBe(0o777)

    const path = statePathFor(home)
    await commitTurnRecords(path, home, turnStampOf(await readTurnState(path)), [
      pending('lint-reminder'),
    ])

    expect((await stat(dir)).mode & 0o777).toBe(0o700)
    expect(existsSync(path)).toBe(true)
  })

  it('appends to an existing document without disturbing other scopes', async () => {
    const home = makeHome()
    const path = statePathFor(home)
    writeRaw(
      path,
      JSON.stringify({
        ...emptyTurnState(),
        epoch: EPOCH,
        generation: 2,
        scopes: { 'agent:sub': { other: [record('SubagentStop', 'skip')] } },
      }),
    )

    await commitTurnRecords(path, home, stamp(2), [pending('lint-reminder')])

    const state = readState(path)
    expect(state.generation).toBe(2)
    expect(state.epoch).toBe(EPOCH)
    expect(scopeOf(state, 'agent:sub')!.other!.length).toBe(1)
    expect(scopeOf(state, 'main')!['lint-reminder']!.length).toBe(1)
  })

  it('is a no-op with nothing pending', async () => {
    const home = makeHome()
    const path = statePathFor(home)

    await commitTurnRecords(path, home, stamp(0), [])

    expect(existsSync(path)).toBe(false)
  })

  it('discards everything when the captured generation is behind the on-disk one', async () => {
    const home = makeHome()
    const path = statePathFor(home)
    const stored = { ...emptyTurnState(), epoch: EPOCH, generation: 5 }
    writeRaw(path, JSON.stringify(stored))

    await commitTurnRecords(path, home, stamp(4), [pending('lint-reminder'), pending('other')])

    expect(readState(path)).toEqual(stored as TurnState)
  })

  it('discards everything when the epoch differs, even at an equal generation', async () => {
    const home = makeHome()
    const path = statePathFor(home)
    const stored = { ...emptyTurnState(), epoch: 'ffffffffffffffff', generation: 1 }
    writeRaw(path, JSON.stringify(stored))

    // The case a generation counter alone cannot catch: the numbers match, but
    // they belong to two different documents.
    await commitTurnRecords(path, home, stamp(1, EPOCH), [pending('lint-reminder')])

    expect(readState(path)).toEqual(stored as TurnState)
  })

  it('drops new records at the per-hook ceiling while a different hook still records', async () => {
    const home = makeHome()
    const path = statePathFor(home)
    const saturated = Array.from({ length: TURN_STATE_MAX_RECORDS_PER_HOOK }, (_item, i) =>
      record('Stop', 'skip', `2026-08-04T10:00:${String(i % 60).padStart(2, '0')}.000Z`),
    )
    writeRaw(
      path,
      JSON.stringify({ ...emptyTurnState(), epoch: EPOCH, scopes: { main: { noisy: saturated } } }),
    )

    await commitTurnRecords(path, home, stamp(0), [pending('noisy'), pending('quiet')])

    const state = readState(path)
    expect(scopeOf(state, 'main')!.noisy!.length).toBe(TURN_STATE_MAX_RECORDS_PER_HOOK)
    expect(scopeOf(state, 'main')!.noisy).toEqual(saturated)
    // The point of a per-hook ceiling: a hammering hook cannot starve another
    // hook's first intervention.
    expect(scopeOf(state, 'main')!.quiet!.length).toBe(1)
    expect(warnings.join('')).toContain('growth ceiling')
  })

  it('keys the per-hook ceiling so a delimiter inside an identifier cannot collide', async () => {
    const home = makeHome()
    const path = statePathFor(home)
    // Under a flat join these two (scope, hook) pairs share a key; under a JSON
    // tuple they do not. Saturating the first must not affect the second.
    const saturated = Array.from({ length: TURN_STATE_MAX_RECORDS_PER_HOOK }, () => record())
    writeRaw(
      path,
      JSON.stringify({ ...emptyTurnState(), epoch: EPOCH, scopes: { 'a b': { c: saturated } } }),
    )

    await commitTurnRecords(path, home, stamp(0), [pending('b c', 'a')])

    const state = readState(path)
    expect(scopeOf(state, 'a b')!.c!.length).toBe(TURN_STATE_MAX_RECORDS_PER_HOOK)
    expect(scopeOf(state, 'a')!['b c']!.length).toBe(1)
  })

  it('drops only the pending records that individually overflow the byte bound', async () => {
    const home = makeHome()
    const path = statePathFor(home)
    writeRaw(path, JSON.stringify(stateOfSize(TURN_STATE_MAX_BYTES - 2600)))

    // Oversized entry FIRST: a bound that pops from the tail would discard the
    // small legitimate record behind it, which is the noisy-neighbor failure.
    const huge = 'H'.repeat(4000)
    await commitTurnRecords(path, home, stamp(0), [pending(huge), pending('small')])

    const state = readState(path)
    expect(scopeOf(state, 'main')![huge]).toBeUndefined()
    expect(scopeOf(state, 'main')!.small!.length).toBe(1)
    expect(Buffer.byteLength(readFileSync(path, 'utf8'), 'utf8')).toBeLessThanOrEqual(
      TURN_STATE_MAX_BYTES,
    )
    expect(warnings.join('')).toContain('growth ceiling')
  })

  it('records hook and scope names that collide with Object.prototype members', async () => {
    const home = makeHome()
    const path = statePathFor(home)
    const names = ['constructor', 'toString', '__proto__', 'hasOwnProperty']

    await commitTurnRecords(path, home, turnStampOf(await readTurnState(path)), [
      ...names.map((name) => pending(name)),
      pending('normal', '__proto__'),
    ])

    const state = await readTurnState(path)
    for (const name of names) {
      const turn = materializeTurn(scopeOf(state, 'main'), name as HookName, STOP)
      expect(turn.prior).toHaveLength(1)
      expect(turn.priorInterventions).toBe(1)
    }
    expect(
      materializeTurn(scopeOf(state, '__proto__'), 'normal' as HookName, STOP).prior,
    ).toHaveLength(1)
    // A hook that never ran must read as absent, not as an inherited member.
    expect(materializeTurn(scopeOf(state, 'main'), 'valueOf' as HookName, STOP).prior).toEqual([])
    // The raw file carries them as ordinary keys.
    expect(Object.keys(readState(path).scopes.main!).sort()).toEqual([...names].sort())
  })

  it('leaves the file untouched when the lock cannot be acquired', async () => {
    const home = makeHome()
    const path = statePathFor(home)
    const stored = { ...emptyTurnState(), epoch: EPOCH, generation: 3 }
    writeRaw(path, JSON.stringify(stored))
    writeFileSync(`${path}.lock`, JSON.stringify({ pid: 1, token: 'other', at: 'x' }), {
      mode: 0o600,
    })

    await commitTurnRecords(path, home, stamp(3), [pending('lint-reminder')])

    expect(readState(path)).toEqual(stored as TurnState)
    expect(await verifyTurnLock(path, 'other')).toBe(true)
  })

  it('abandons the write when the lock is taken over before the rename', async () => {
    const home = makeHome()
    const dir = makeStateDir(home)
    const path = statePathFor(home)

    // A large document makes the commit's read, serialize and staging write
    // take milliseconds, so the swapper below lands inside the ownership window
    // with a wide margin. If it ever lost the race the state assertion fails
    // loudly rather than passing vacuously.
    const stored = stateOfSize(400_000)
    writeRaw(path, JSON.stringify(stored))

    const lock = `${path}.lock`
    const foreign = join(dir, 'foreign-lock-source')
    writeFileSync(foreign, JSON.stringify({ pid: 999_999, token: 'foreign-holder', at: 'x' }))

    let settled = false
    const commit = commitTurnRecords(path, home, turnStampOf(stored), [
      pending('lint-reminder'),
    ]).finally(() => {
      settled = true
    })

    // Clobber the lockfile atomically the moment it appears, standing in for a
    // takeover by another process while this commit is mid-flight.
    let guard = 0
    while (!settled && guard++ < 10_000) {
      if (existsSync(lock)) {
        const replacement = join(dir, `swap-${randomUUID()}`)
        copyFileSync(foreign, replacement)
        renameSync(replacement, lock)
      }
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    await commit

    expect(await verifyTurnLock(path, 'foreign-holder')).toBe(true)
    // The new holder's document is untouched, and the old owner's release did
    // not remove the new holder's lock either.
    expect(readState(path).scopes).toEqual(stored.scopes)
    expect(stagingFiles(dir)).toEqual([])
    expect(warnings.join('')).toContain('taken over')
  })

  it('leaves no staging file behind when the rename fails', async () => {
    const home = makeHome()
    const dir = makeStateDir(home)
    const path = statePathFor(home)
    // A directory at the target makes rename fail after staging succeeded.
    mkdirSync(path)

    await commitTurnRecords(path, home, stamp(0), [pending('lint-reminder')])

    expect(stagingFiles(dir)).toEqual([])
    expect(existsSync(`${path}.lock`)).toBe(false)
  })

  it('never deletes another writer’s staging file', async () => {
    const home = makeHome()
    const dir = makeStateDir(home)
    const path = statePathFor(home)
    // Same directory, same naming shape, different owner.
    const foreign = join(dir, `${basename(path)}.999999-deadbeef.tmp`)
    writeFileSync(foreign, 'someone else is mid-write')

    await commitTurnRecords(path, home, turnStampOf(await readTurnState(path)), [
      pending('lint-reminder'),
    ])

    expect(readFileSync(foreign, 'utf8')).toBe('someone else is mid-write')
    expect(stagingFiles(dir)).toEqual([basename(foreign)])
    expect(existsSync(path)).toBe(true)
  })
})

describe('applyTurnBoundary', () => {
  const stored: TurnState = {
    version: TURN_STATE_VERSION,
    epoch: EPOCH,
    generation: 2,
    updatedAt: '2026-08-04T10:00:00.000Z',
    scopes: { main: { 'lint-reminder': [record()] }, 'agent:sub': { other: [record()] } },
  }

  for (const kind of ['advance', 'reset'] as const) {
    it(`${kind} clears every scope and advances the generation`, async () => {
      const home = makeHome()
      const path = statePathFor(home)
      writeRaw(path, JSON.stringify(stored))

      const next = await applyTurnBoundary(path, home, kind)

      expect(next.scopes).toEqual({})
      expect(next.generation).toBeGreaterThan(stored.generation)
      expect(readState(path).generation).toBe(next.generation)
      expect(readState(path).scopes).toEqual({})
      expect(existsSync(`${path}.lock`)).toBe(false)
    })

    it(`${kind} discards a tracker holding the pre-boundary stamp`, async () => {
      const home = makeHome()
      const path = statePathFor(home)
      writeRaw(path, JSON.stringify(stored))

      await applyTurnBoundary(path, home, kind)
      await commitTurnRecords(path, home, turnStampOf(stored), [pending('lint-reminder')])

      expect(readState(path).scopes).toEqual({})
    })
  }

  // `reset` is what SessionStart uses for both `startup` and `clear`; the two
  // sources differ only at the call site, so both are covered here.
  it('reset via a second boundary keeps the generation strictly monotonic', async () => {
    const home = makeHome()
    const path = statePathFor(home)
    writeRaw(path, JSON.stringify(stored))

    const first = await applyTurnBoundary(path, home, 'reset')
    const second = await applyTurnBoundary(path, home, 'reset')

    expect(second.generation).toBeGreaterThan(first.generation)
    expect(second.generation).toBeGreaterThan(stored.generation)
  })

  it('creates a fresh document when none exists', async () => {
    const home = makeHome()
    const path = statePathFor(home)

    const next = await applyTurnBoundary(path, home, 'advance')

    expect(next.generation).toBe(1)
    expect(readState(path).generation).toBe(1)
    expect(readState(path).epoch).toBe(next.epoch)
  })

  const unusableDocuments: [string, string][] = [
    ['corrupt', '{not json'],
    ['array-shaped', '[]'],
    ['version-mismatched', JSON.stringify({ ...emptyTurnState(), version: 99 })],
  ]

  for (const [label, contents] of unusableDocuments) {
    it(`discards a stale tracker after a boundary over a ${label} document`, async () => {
      const home = makeHome()
      const path = statePathFor(home)
      writeRaw(path, contents)

      const next = await applyTurnBoundary(path, home, 'reset')
      // An unreadable document collapses to generation 0, so the boundary
      // writes generation 1. Without the epoch, an ancient tracker that also
      // held generation 1 would compare equal and resurrect its records.
      expect(next.generation).toBe(1)

      await commitTurnRecords(path, home, stamp(1, EPOCH), [pending('lint-reminder')])
      expect(readState(path).scopes).toEqual({})

      // The same tracker carrying the CURRENT epoch is accepted, proving the
      // rejection above was the epoch and not something incidental.
      await commitTurnRecords(path, home, turnStampOf(next), [pending('lint-reminder')])
      expect(scopeOf(readState(path), 'main')!['lint-reminder']).toHaveLength(1)
    })
  }

  it('discards a stale tracker after a boundary over an oversized document', async () => {
    const home = makeHome()
    const path = statePathFor(home)
    writeRaw(path, JSON.stringify(stateOfSize(TURN_STATE_MAX_BYTES + 1)))

    const next = await applyTurnBoundary(path, home, 'reset')
    expect(next.epoch).not.toBe(EPOCH)

    await commitTurnRecords(path, home, stamp(next.generation, EPOCH), [pending('lint-reminder')])
    expect(readState(path).scopes).toEqual({})
  })

  it('reborns the document under a fresh epoch when the counter is exhausted', async () => {
    const home = makeHome()
    const path = statePathFor(home)
    writeRaw(path, JSON.stringify({ ...stored, generation: Number.MAX_SAFE_INTEGER }))

    const next = await applyTurnBoundary(path, home, 'advance')

    // A plain increment here is a no-op, which would stop separating turns and
    // make every stale stamp match forever.
    expect(next.epoch).not.toBe(EPOCH)
    expect(next.generation).toBe(0)
    expect(next.scopes).toEqual({})

    await commitTurnRecords(path, home, stamp(Number.MAX_SAFE_INTEGER, EPOCH), [
      pending('lint-reminder'),
    ])
    expect(readState(path).scopes).toEqual({})
  })

  it('returns the unchanged on-disk state when the lock cannot be acquired', async () => {
    const home = makeHome()
    const path = statePathFor(home)
    writeRaw(path, JSON.stringify(stored))
    writeFileSync(`${path}.lock`, JSON.stringify({ pid: 1, token: 'other', at: 'x' }), {
      mode: 0o600,
    })

    const next = await applyTurnBoundary(path, home, 'advance')

    // The documented failure direction: a finished turn keeps looking live.
    expect(next.generation).toBe(stored.generation)
    expect(next.scopes).toEqual(stored.scopes)
    expect(readState(path)).toEqual(stored)
  })
})

describe('directory hardening', () => {
  it('refuses a symlinked .clooks and creates nothing at its target', async () => {
    const home = makeHome()
    const outside = makeOutside()
    symlinkSync(outside, join(home, '.clooks'))
    const path = join(home, '.clooks', 'turn-state', 'aaaaaaaaaaaaaaaa.json')

    await commitTurnRecords(path, home, stamp(0), [pending('lint-reminder')])

    expect(existsSync(join(outside, 'turn-state'))).toBe(false)
    expect(warnings.join('')).toContain('symlink')
  })

  it('refuses a symlinked turn-state directory and creates nothing at its target', async () => {
    const home = makeHome()
    const outside = makeOutside()
    mkdirSync(join(home, '.clooks'), { mode: 0o700 })
    symlinkSync(outside, join(home, '.clooks', 'turn-state'))
    const path = statePathFor(home)

    await commitTurnRecords(path, home, stamp(0), [pending('lint-reminder')])

    expect(readdirSync(outside)).toEqual([])
    expect(warnings.join('')).toContain('symlink')
  })

  it('refuses a non-directory sitting where turn-state belongs', async () => {
    const home = makeHome()
    mkdirSync(join(home, '.clooks'), { mode: 0o700 })
    writeFileSync(join(home, '.clooks', 'turn-state'), 'not a directory')

    await commitTurnRecords(statePathFor(home), home, stamp(0), [pending('lint-reminder')])

    expect(readFileSync(join(home, '.clooks', 'turn-state'), 'utf8')).toBe('not a directory')
    expect(warnings.join('')).toContain('not a directory')
  })

  it('degrades rather than throwing when the boundary cannot create its directory', async () => {
    const home = makeHome()
    const outside = makeOutside()
    symlinkSync(outside, join(home, '.clooks'))

    const state = await applyTurnBoundary(
      join(home, '.clooks', 'turn-state', 'aaaaaaaaaaaaaaaa.json'),
      home,
      'advance',
    )

    expectEmptyState(state)
    expect(existsSync(join(outside, 'turn-state'))).toBe(false)
  })
})

describe('pruneTurnState', () => {
  const OLD = AGES_AGO
  const FRESH = new Date()

  async function age(path: string, when: Date): Promise<void> {
    await utimes(path, when, when)
  }

  it('no-ops on a missing directory', async () => {
    const home = makeHome()
    await pruneTurnState(home)
    expect(warnings).toEqual([])
  })

  it('sweeps stale session files, locks, takeover leftovers and staging files', async () => {
    const home = makeHome()
    const dir = makeStateDir(home)
    const outside = makeOutside()
    const linkTarget = join(outside, 'target.json')
    writeFileSync(linkTarget, '{}')

    const files: Record<string, Date> = {
      '0000000000000001.json': OLD,
      '0000000000000002.json': FRESH,
      '0000000000000003.json.lock': new Date(Date.now() - TURN_STATE_LOCK_TTL_MS - 5_000),
      '0000000000000004.json.lock': FRESH,
      '0000000000000005.json.lock.stale-abcdef': new Date(
        Date.now() - TURN_STATE_LOCK_TTL_MS - 5_000,
      ),
      '0000000000000006.json.123-abcdef.tmp': OLD,
      '0000000000000007.json.123-abcdef.tmp': FRESH,
      'notes.txt': OLD,
    }
    for (const [name, when] of Object.entries(files)) {
      const path = join(dir, name)
      writeFileSync(path, '{}')
      await age(path, when)
    }
    symlinkSync(linkTarget, join(dir, '0000000000000008.json'))

    await pruneTurnState(home)

    const remaining = new Set(readdirSync(dir))
    expect(remaining.has('0000000000000001.json')).toBe(false)
    expect(remaining.has('0000000000000002.json')).toBe(true)
    expect(remaining.has('0000000000000003.json.lock')).toBe(false)
    expect(remaining.has('0000000000000004.json.lock')).toBe(true)
    expect(remaining.has('0000000000000005.json.lock.stale-abcdef')).toBe(false)
    expect(remaining.has('0000000000000006.json.123-abcdef.tmp')).toBe(false)
    expect(remaining.has('0000000000000007.json.123-abcdef.tmp')).toBe(true)
    expect(remaining.has('notes.txt')).toBe(true)
    // A symlink is never followed and never unlinked by the sweep.
    expect(remaining.has('0000000000000008.json')).toBe(true)
    expect(existsSync(linkTarget)).toBe(true)
  })

  it('never deletes a directory that matches a session name', async () => {
    const home = makeHome()
    const dir = makeStateDir(home)
    const nested = join(dir, '00000000000000ff.json')
    mkdirSync(nested)
    await age(nested, OLD)

    await pruneTurnState(home)

    expect(existsSync(nested)).toBe(true)
  })

  it('enforces the file cap oldest-first', async () => {
    const home = makeHome()
    const dir = makeStateDir(home)
    const excess = 5
    const total = TURN_STATE_MAX_FILES + excess

    for (let i = 0; i < total; i++) {
      const name = `${i.toString(16).padStart(16, '0')}.json`
      const path = join(dir, name)
      writeFileSync(path, '{}')
      await age(path, new Date(Date.now() - (total - i) * 1000))
    }

    await pruneTurnState(home)

    const remaining = readdirSync(dir)
    expect(remaining.length).toBe(TURN_STATE_MAX_FILES)
    for (let i = 0; i < excess; i++) {
      expect(remaining).not.toContain(`${i.toString(16).padStart(16, '0')}.json`)
    }
    expect(remaining).toContain(`${excess.toString(16).padStart(16, '0')}.json`)
  })

  it('deletes nothing and warns once when turn-state resolves outside the home root', async () => {
    const home = makeHome()
    const outside = makeOutside()
    const victim = join(outside, '0000000000000001.json')
    writeFileSync(victim, '{}')
    await utimes(victim, OLD, OLD)

    mkdirSync(join(home, '.clooks'), { mode: 0o700 })
    symlinkSync(outside, join(home, '.clooks', 'turn-state'))

    await pruneTurnState(home)

    expect(existsSync(victim)).toBe(true)
    expect(warnings.length).toBe(1)
  })

  it('deletes nothing when turn-state links to another directory INSIDE the home root', async () => {
    const home = makeHome()
    // Containment alone passes here — the target is inside the home root — so
    // only the per-component symlink refusal stops the sweep from running in
    // an unrelated directory. This is the case a realpath-first check misses.
    const victimDir = join(home, 'unrelated')
    mkdirSync(victimDir)
    const victim = join(victimDir, '0000000000000001.json')
    writeFileSync(victim, '{}')
    await utimes(victim, OLD, OLD)

    mkdirSync(join(home, '.clooks'), { mode: 0o700 })
    symlinkSync(victimDir, join(home, '.clooks', 'turn-state'))

    await pruneTurnState(home)

    expect(existsSync(victim)).toBe(true)
    expect(warnings.join('')).toContain('symlink')
  })

  it('deletes nothing when .clooks links to another directory inside the home root', async () => {
    const home = makeHome()
    const victimHome = join(home, 'unrelated')
    mkdirSync(join(victimHome, 'turn-state'), { recursive: true })
    const victim = join(victimHome, 'turn-state', '0000000000000001.json')
    writeFileSync(victim, '{}')
    await utimes(victim, OLD, OLD)

    symlinkSync(victimHome, join(home, '.clooks'))

    await pruneTurnState(home)

    expect(existsSync(victim)).toBe(true)
    expect(warnings.join('')).toContain('symlink')
  })
})
