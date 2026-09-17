import {
  closeSync,
  constants,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  opendirSync,
  readSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  type Dir,
} from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import type { z } from 'zod'
import {
  checkDoneSchema,
  claimSchema,
  digest,
  doneSchema,
  electionSchema,
  limits,
  same,
  startSchema,
  unavailable,
  type CheckInput,
} from './protocol.js'

export interface InteractionRuntime {
  home: string
  now(): number
  alive(pid: number): boolean
  pause(ms: number, signal?: AbortSignal): Promise<void>
}

export function runtime(overrides: Partial<InteractionRuntime> = {}): InteractionRuntime {
  return {
    home: process.env.HOME ?? '',
    now: Date.now,
    alive(pid) {
      try {
        process.kill(pid, 0)
        return true
      } catch (error) {
        if (code(error) === 'ESRCH') return false
        throw error
      }
    },
    async pause(ms, signal) {
      await delay(ms, undefined, { signal })
    },
    ...overrides,
  }
}

export function code(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error ? String(error.code) : undefined
}

function ownedDirectory(path: string, privateMode: boolean): void {
  const stat = lstatSync(path)
  if (
    !stat.isDirectory() ||
    stat.uid !== process.getuid!() ||
    (stat.mode & (privateMode ? 0o077 : 0o022)) !== 0
  ) {
    unavailable(`Unsafe approval directory: ${path}`)
  }
}

function ensureDirectory(path: string, privateMode: boolean): void {
  try {
    mkdirSync(path, { mode: 0o700 })
  } catch (error) {
    if (code(error) !== 'EEXIST') throw error
  }
  ownedDirectory(path, privateMode)
}

export function approvalRoot(home: string): string {
  if (!isAbsolute(home)) unavailable('Approval transport requires an absolute HOME')
  let directory = realpathSync(home)
  ownedDirectory(directory, false)
  for (const part of ['.clooks', '.cache', 'approvals-live', 'v1']) {
    directory = join(directory, part)
    ensureDirectory(directory, part === 'approvals-live' || part === 'v1')
  }
  return directory
}

function boundedRead<T>(path: string, schema: z.ZodType<T>): T | undefined {
  let fd: number
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  } catch (error) {
    if (code(error) === 'ENOENT') return undefined
    throw error
  }
  try {
    const stat = fstatSync(fd)
    if (
      !stat.isFile() ||
      stat.uid !== process.getuid!() ||
      (stat.mode & 0o077) !== 0 ||
      stat.size > limits.packetBytes
    )
      unavailable('Unsafe or oversized approval packet')
    const maximum = limits.packetBytes + 1
    let bytes = Buffer.alloc(Math.min(stat.size + 1, maximum))
    let size = 0
    while (true) {
      const count = readSync(fd, bytes, size, bytes.length - size, null)
      if (!count) break
      size += count
      if (size === bytes.length) {
        if (bytes.length === maximum) break
        const grown = Buffer.alloc(maximum)
        bytes.copy(grown, 0, 0, size)
        bytes = grown
      }
    }
    if (size > limits.packetBytes) unavailable('Oversized approval packet')
    return schema.parse(JSON.parse(bytes.subarray(0, size).toString('utf8')))
  } finally {
    closeSync(fd)
  }
}

export class Mailbox {
  readonly directory: string
  constructor(
    readonly root: string,
    readonly key: CheckInput,
    create = true,
  ) {
    this.directory = join(root, digest(key))
    if (create) ensureDirectory(this.directory, true)
  }

  private path(name: string): string {
    if (
      !/^(command|check|start|election|attached|done|check-done|denial-ack|retired|question-([1-9]|[12][0-9]|3[0-2])|reply-([1-9]|[12][0-9]|3[0-2]))$/.test(
        name,
      )
    ) {
      unavailable('Invalid approval packet name')
    }
    ownedDirectory(this.root, true)
    ownedDirectory(this.directory, true)
    return join(this.directory, `${name}.json`)
  }

  read<T>(name: string, schema: z.ZodType<T>): T | undefined {
    return boundedRead(this.path(name), schema)
  }

  bound<T extends { key: CheckInput; nonce?: string }>(
    name: string,
    schema: z.ZodType<T>,
    nonce?: string,
  ): T | undefined {
    const packet = this.read(name, schema)
    if (packet) {
      same(packet.key, this.key, 'identity')
      if (nonce !== undefined) same(packet.nonce, nonce, 'nonce')
    }
    return packet
  }

  assertOpen(): void {
    try {
      lstatSync(this.path('retired'))
    } catch (error) {
      if (code(error) === 'ENOENT') return
      throw error
    }
    unavailable('Approval invocation has been retired')
  }

  publish(name: string, packet: unknown): void {
    if (name !== 'retired') this.assertOpen()
    const target = this.path(name)
    const text = JSON.stringify(packet)
    if (Buffer.byteLength(text) > limits.packetBytes) unavailable('Oversized approval packet')
    const temporary = join(this.directory, `.${randomUUID()}.tmp`)
    let created = false
    try {
      writeFileSync(temporary, text, { flag: 'wx', mode: 0o600 })
      created = true
      // A hard link publishes complete bytes without replacing another role or packet.
      linkSync(temporary, target)
    } finally {
      if (created) unlinkSync(temporary)
    }
  }

  elect(candidate: Parameters<typeof electionSchema.parse>[0]) {
    const valid = electionSchema.parse(candidate)
    same(valid.key, this.key, 'election identity')
    try {
      this.publish('election', valid)
    } catch (error) {
      if (code(error) !== 'EEXIST') throw error
    }
    const winner = this.bound('election', electionSchema)
    if (!winner) unavailable('Missing approval election')
    return winner
  }

  claim(role: 'command' | 'check', now: number) {
    const packet = {
      version: 1 as const,
      key: this.key,
      id: randomUUID(),
      pid: process.pid,
      createdAt: now,
    }
    this.publish(role, packet)
    this.assertOpen()
    return packet
  }
}

let cleanupCursor: { root: string; entries: Dir } | undefined
export function closeCleanup(): void {
  if (!cleanupCursor) return
  const previous = cleanupCursor
  cleanupCursor = undefined
  previous.entries.closeSync()
}

// One retained iterator bounds both work and handles while making progress past active prefixes.
// Retention is not consent storage. Only terminal/dead roles can be collected.
export function cleanup(root: string, clock: InteractionRuntime): void {
  if (cleanupCursor?.root !== root) closeCleanup()
  cleanupCursor ??= { root, entries: opendirSync(root) }
  const { entries } = cleanupCursor
  try {
    for (let inspected = 0; inspected < limits.cleanupEntries; inspected++) {
      const entry = entries.readSync()
      if (!entry) {
        closeCleanup()
        break
      }
      if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue
      try {
        const directory = join(root, entry.name)
        ownedDirectory(directory, true)
        const command = boundedRead(join(directory, 'command.json'), claimSchema)
        const check = boundedRead(join(directory, 'check.json'), claimSchema)
        const key = command?.key ?? check?.key
        if (!key || digest(key) !== entry.name) continue
        const box = new Mailbox(root, key, false)
        const canPrune = () => {
          const c = box.bound('command', claimSchema)
          const m = box.bound('check', claimSchema)
          const start = box.bound('start', startSchema)
          const done = box.bound('done', doneSchema, c?.id)
          const ended = box.bound('check-done', checkDoneSchema)
          if (ended && m) same(ended.checkId, m.id, 'check completion')
          if (ended?.nonce !== undefined && start)
            same(ended.nonce, start.nonce, 'check completion nonce')
          if (c && !done && clock.alive(c.pid)) return false
          if (m && !ended && clock.alive(m.pid)) return false
          const last = Math.max(
            done?.at ?? (c ? (start?.deadline ?? c.createdAt + limits.invocationMs) : 0),
            ended?.at ?? (m ? m.createdAt + limits.invocationMs : 0),
          )
          return clock.now() >= last + limits.retentionMs
        }
        if (!canPrune()) continue
        try {
          box.publish('retired', { at: clock.now() })
        } catch (error) {
          if (code(error) !== 'EEXIST') throw error
        }
        // New roles must observe retirement after their exclusive claim as well.
        if (canPrune()) rmSync(directory, { recursive: true })
      } catch {
        // Invalid/unreadable state is never permission to prune a possibly active invocation.
      }
    }
  } catch (error) {
    closeCleanup()
    throw error
  }
}

export function openMailbox(key: CheckInput, clock: InteractionRuntime): Mailbox {
  const root = approvalRoot(clock.home)
  cleanup(root, clock)
  return new Mailbox(root, key)
}
