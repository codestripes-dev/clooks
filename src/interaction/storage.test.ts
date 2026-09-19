import { afterEach, expect, spyOn, test } from 'bun:test'
import * as fs from 'node:fs'
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  opendirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { approvalRoot, cleanup, closeCleanup, Mailbox, runtime } from './storage.js'
import { claimSchema, limits, startSchema, type CheckInput } from './protocol.js'

const homes: string[] = []
afterEach(() => {
  closeCleanup()
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'clooks-mailbox-'))
  homes.push(home)
  const key: CheckInput = {
    protocol: 1,
    agent: 'claude-code',
    owner: 'global',
    session_id: 'session',
    tool_use_id: 'call',
  }
  const root = approvalRoot(home)
  return { home, key, root, box: new Mailbox(root, key) }
}

test('root follows canonical HOME only and preserves safe public managed ancestors', () => {
  const f = fixture()
  chmodSync(join(f.home, '.clooks'), 0o755)
  chmodSync(join(f.home, '.clooks', '.cache'), 0o755)
  const alias = join(f.home, 'alias')
  symlinkSync(f.home, alias)
  expect(approvalRoot(alias)).toBe(f.root)
  expect(statSync(join(f.home, '.clooks')).mode & 0o777).toBe(0o755)
  expect(statSync(f.root).mode & 0o777).toBe(0o700)
  expect(() => approvalRoot('relative')).toThrow('absolute HOME')
})

test('symlink, exposed dedicated namespace and writable managed ancestor are rejected', () => {
  for (const component of [
    '.clooks',
    '.clooks/.cache',
    '.clooks/.cache/approvals-live',
    '.clooks/.cache/approvals-live/v1',
  ]) {
    const f = fixture()
    chmodSync(join(f.home, component), component.includes('approvals-live') ? 0o755 : 0o777)
    expect(() => approvalRoot(f.home)).toThrow('Unsafe approval directory')
  }
  const f = fixture()
  rmSync(join(f.home, '.clooks'), { recursive: true })
  mkdirSync(join(f.home, 'other'))
  symlinkSync(join(f.home, 'other'), join(f.home, '.clooks'))
  expect(() => approvalRoot(f.home)).toThrow('Unsafe approval directory')
})

test('exclusive publication retains the winning claim, with no temporary files', () => {
  const f = fixture()
  const winner = f.box.claim('command', 1)
  expect(f.box.bound('command', claimSchema)).toEqual(winner)
  expect(() => f.box.claim('command', 2)).toThrow()
  expect(f.box.bound('command', claimSchema)).toEqual(winner)
  expect(readdirSync(f.box.directory)).toEqual(['command.json'])
  expect(statSync(join(f.box.directory, 'command.json')).mode & 0o777).toBe(0o600)
  expect(() => f.box.publish('question-33', {})).toThrow('packet name')
  expect(() => f.box.publish('../escape', {})).toThrow('packet name')
  expect(() => f.box.publish('start', 'x'.repeat(limits.packetBytes))).toThrow('Oversized')
})

test('atomic start-or-closed election never replaces an earlier winner', () => {
  for (const reversed of [true, false]) {
    const f = fixture()
    const started = {
      version: 1,
      key: f.key,
      nonce: crypto.randomUUID(),
      state: 'started',
    } as const
    const closed = {
      version: 1,
      key: f.key,
      checkId: crypto.randomUUID(),
      state: 'closed',
      closedAt: 1,
    } as const
    const first = reversed ? closed : started
    const second = reversed ? started : closed
    expect(f.box.elect(first)).toEqual(first)
    expect(f.box.elect(second)).toEqual(first)
    expect(readdirSync(f.box.directory)).toEqual(['election.json'])
  }
})

test('partial, malformed, foreign, oversized and exposed packets are errors, not absence', () => {
  const f = fixture()
  const file = join(f.box.directory, 'command.json')
  expect(f.box.bound('command', claimSchema)).toBeUndefined()
  for (const text of [
    '{"version":',
    JSON.stringify({ version: 1 }),
    'x'.repeat(limits.packetBytes + 1),
  ]) {
    writeFileSync(file, text, { mode: 0o600 })
    expect(() => f.box.bound('command', claimSchema)).toThrow()
  }
  rmSync(file)
  writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      key: { ...f.key, owner: 'project:foreign' },
      id: crypto.randomUUID(),
      pid: process.pid,
      createdAt: 1,
    }),
    { mode: 0o600 },
  )
  expect(() => f.box.bound('command', claimSchema)).toThrow('identity mismatch')
  chmodSync(file, 0o644)
  expect(() => f.box.read('command', z.unknown())).toThrow('Unsafe')
  rmSync(file)
  const outside = join(f.home, 'outside')
  writeFileSync(outside, '{}', { mode: 0o600 })
  symlinkSync(outside, file)
  expect(() => f.box.read('command', z.unknown())).toThrow()
  expect(readFileSync(outside, 'utf8')).toBe('{}')
})

test('bounded packet reads accept the exact byte limit and reject an initially oversized file', () => {
  const f = fixture()
  const file = join(f.box.directory, 'command.json')
  const exact = JSON.stringify('x'.repeat(limits.packetBytes - 2))
  expect(Buffer.byteLength(exact)).toBe(limits.packetBytes)
  writeFileSync(file, exact, { mode: 0o600 })
  expect(f.box.read('command', z.string())).toHaveLength(limits.packetBytes - 2)

  writeFileSync(file, JSON.stringify('x'.repeat(limits.packetBytes - 1)), { mode: 0o600 })
  expect(() => f.box.read('command', z.string())).toThrow('oversized')
})

test.each([
  { name: 'empty', text: '' },
  { name: 'truncated', text: '{"version":' },
  { name: 'malformed', text: '{not-json}' },
])('bounded packet reads fail closed for $name content', ({ text }) => {
  const f = fixture()
  writeFileSync(join(f.box.directory, 'command.json'), text, { mode: 0o600 })
  expect(() => f.box.read('command', z.unknown())).toThrow()
})

test.each([
  { name: 'small', suffix: 'bcdef"', expectedLength: 6 },
  {
    name: 'exact packet limit',
    suffix: `${'x'.repeat(limits.packetBytes - 3)}"`,
    expectedLength: limits.packetBytes - 2,
  },
])('bounded packet reads accept $name growth after fstat', ({ suffix, expectedLength }) => {
  const f = fixture()
  const file = join(f.box.directory, 'command.json')
  writeFileSync(file, '"a', { mode: 0o600 })
  const originalReadSync = fs.readSync
  const read = spyOn(fs, 'readSync')
  let appended = false
  read.mockImplementation(((fd, buffer, offset, length, position) => {
    if (!appended) {
      appended = true
      appendFileSync(file, suffix)
    }
    return originalReadSync(fd, buffer, offset, length, position)
  }) as typeof fs.readSync)
  try {
    const value = f.box.read('command', z.string())
    expect(value).toHaveLength(expectedLength)
    expect(value?.startsWith('a')).toBe(true)
  } finally {
    read.mockRestore()
  }
})

test('bounded packet reads reject growth past the limit after fstat', () => {
  const f = fixture()
  const file = join(f.box.directory, 'command.json')
  writeFileSync(file, '"a', { mode: 0o600 })
  const originalReadSync = fs.readSync
  const read = spyOn(fs, 'readSync')
  let appended = false
  read.mockImplementation(((fd, buffer, offset, length, position) => {
    if (!appended) {
      appended = true
      appendFileSync(file, `${'x'.repeat(limits.packetBytes - 2)}"`)
    }
    return originalReadSync(fd, buffer, offset, length, position)
  }) as typeof fs.readSync)
  try {
    expect(() => f.box.read('command', z.string())).toThrow('Oversized')
  } finally {
    read.mockRestore()
  }
})

test('bounded packet reads retain bytes across partial reads', () => {
  const f = fixture()
  const file = join(f.box.directory, 'command.json')
  writeFileSync(file, '"partial"', { mode: 0o600 })
  const originalReadSync = fs.readSync
  const read = spyOn(fs, 'readSync')
  read.mockImplementation(((fd, buffer, offset, length, position) =>
    originalReadSync(fd, buffer, offset, Math.min(length, 2), position)) as typeof fs.readSync)
  try {
    expect(f.box.read('command', z.string())).toBe('partial')
  } finally {
    read.mockRestore()
  }
})

function terminal(f: ReturnType<typeof fixture>, at: number) {
  const command = f.box.claim('command', at)
  const check = f.box.claim('check', at)
  const start = {
    version: 1,
    key: f.key,
    nonce: command.id,
    pid: process.pid,
    disposition: 'run',
    startedAt: at,
    deadline: at + limits.invocationMs - limits.reserveMs,
  }
  f.box.publish('start', start)
  f.box.publish('done', { version: 1, key: f.key, nonce: command.id, at })
  f.box.publish('check-done', { version: 1, key: f.key, nonce: command.id, checkId: check.id, at })
}

test('fully terminal retention is exactly ten minutes even if the PIDs remain alive', () => {
  const f = fixture()
  terminal(f, 1000)
  cleanup(f.root, runtime({ home: f.home, now: () => 1000 + limits.retentionMs - 1 }))
  expect(existsSync(f.box.directory)).toBe(true)
  cleanup(f.root, runtime({ home: f.home, now: () => 1000 + limits.retentionMs }))
  expect(existsSync(f.box.directory)).toBe(false)
})

test('unfinished live command or check is never pruned, even after expiry', () => {
  for (const role of ['command', 'check'] as const) {
    const f = fixture()
    f.box.claim(role, 1)
    cleanup(f.root, runtime({ home: f.home, now: () => 10 * limits.retentionMs }))
    expect(existsSync(f.box.directory)).toBe(true)
    expect(existsSync(join(f.box.directory, 'retired.json'))).toBe(false)
  }
})

test('dead abandoned roles retain an invocation budget before terminal retention', () => {
  const f = fixture()
  f.box.claim('command', 1000)
  const clock = runtime({
    home: f.home,
    alive: () => false,
    now: () => 1000 + limits.invocationMs + limits.retentionMs - 1,
  })
  cleanup(f.root, clock)
  expect(existsSync(f.box.directory)).toBe(true)
  cleanup(f.root, { ...clock, now: () => clock.now() + 1 })
  expect(existsSync(f.box.directory)).toBe(false)
})

test('retirement prevents new role claims, and cleanup never trusts malformed terminal evidence', () => {
  const f = fixture()
  f.box.publish('retired', { at: 1 })
  expect(() => f.box.claim('command', 1)).toThrow('retired')
  const g = fixture()
  terminal(g, 1000)
  writeFileSync(join(g.box.directory, 'done.json'), '{partial')
  cleanup(g.root, runtime({ home: g.home, now: () => 10 * limits.retentionMs }))
  expect(existsSync(g.box.directory)).toBe(true)
  expect(() => g.box.bound('start', startSchema, crypto.randomUUID())).toThrow('nonce mismatch')
})

test('bounded cleanup advances beyond more than 128 unprunable entries', () => {
  const f = fixture()
  const boxes = new Map<string, Mailbox>()
  for (let n = 0; n < limits.cleanupEntries * 2; n++) {
    const box = new Mailbox(f.root, { ...f.key, tool_use_id: `active-${n}` })
    box.claim('command', 1000)
    boxes.set(box.directory.split('/').at(-1)!, box)
  }
  const names: string[] = []
  const entries = opendirSync(f.root)
  try {
    for (let entry = entries.readSync(); entry; entry = entries.readSync()) names.push(entry.name)
  } finally {
    entries.closeSync()
  }
  const targetName = names.slice(limits.cleanupEntries).find((name) => boxes.has(name))!
  expect(names.indexOf(targetName)).toBeGreaterThanOrEqual(limits.cleanupEntries)
  const target = boxes.get(targetName)!
  const claim = target.bound('command', claimSchema)!
  const check = target.claim('check', 1000)
  target.publish('done', { version: 1, key: target.key, nonce: claim.id, at: 1000 })
  target.publish('check-done', {
    version: 1,
    key: target.key,
    nonce: claim.id,
    checkId: check.id,
    at: 1000,
  })
  const clock = runtime({ home: f.home, now: () => 1000 + limits.retentionMs })
  cleanup(f.root, clock)
  expect(existsSync(target.directory)).toBe(true)
  for (let pass = 0; pass < 2; pass++) cleanup(f.root, clock)
  expect(existsSync(target.directory)).toBe(false)
  expect(readdirSync(f.root).length).toBe(names.length - 1)
})
