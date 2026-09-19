// Illustrative approval mailbox. This is not the production Clooks approval engine.
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { isAbsolute, join } from 'node:path'

export type AgentId = 'claude' | 'codex'
export interface Identity {
  agent: AgentId
  owner: string
  session_id: string
  tool_use_id: string
  turn_id?: string
}
export const checkpointInputSchema = {
  type: 'object' as const,
  properties: {
    protocol: { type: 'integer', const: 1 },
    agent: { type: 'string' },
    owner: { type: 'string' },
    session_id: { type: 'string' },
    tool_use_id: { type: 'string' },
    turn_id: { type: 'string' },
  },
  required: ['protocol', 'agent', 'owner', 'session_id', 'tool_use_id'],
}
export const budgets = {
  invocation: 300000,
  reserve: 5000,
  native: 330,
  sdk: 325000,
  discovery: 1000,
  poll: 20,
}
export const root = () => {
  const value = process.env.APPROVAL_LOG_ROOT || process.env.APPROVAL_ROOT
  assert.ok(
    value && value.startsWith('/export/'),
    'Native fixtures require disposable Docker /export roots',
  )
  return value
}
export function sharedHomeRoot(home = process.env.HOME) {
  assert.ok(home && isAbsolute(home), 'Shared approval root requires absolute HOME')
  let directory = realpathSync(home)
  for (const part of ['.clooks', '.cache', 'approvals-live', 'v1']) {
    directory = join(directory, part)
    try {
      mkdirSync(directory, { mode: 0o700 })
    } catch (error: any) {
      if (error.code !== 'EEXIST') throw error
    }
    const stat = lstatSync(directory)
    assert.ok(
      stat.isDirectory() && !stat.isSymbolicLink(),
      'IPC component must be a real directory',
    )
    assert.equal(stat.uid, process.getuid!(), 'IPC component has a different owner')
    assert.equal(stat.mode & 0o022, 0, 'IPC ancestor must not be group/other writable')
    if (part === 'approvals-live' || part === 'v1')
      assert.equal(stat.mode & 0o077, 0, 'Dedicated IPC component must be private')
  }
  return directory
}
export const coordinationRoot = () =>
  process.env.APPROVAL_SHARED_HOME === '1' ? sharedHomeRoot() : root()
export const read = (file: string): any =>
  existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined
export function put(file: string, value: unknown) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 })
  renameSync(temporary, file)
}
export function log(event: string, data: Record<string, unknown> = {}, directory = root()) {
  appendFileSync(
    join(directory, 'journal.jsonl'),
    JSON.stringify({ at: Date.now(), pid: process.pid, event, ...data }) + '\n',
  )
}
export const journal = (directory = root()): any[] =>
  existsSync(join(directory, 'journal.jsonl'))
    ? readFileSync(join(directory, 'journal.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : []
export function identity(value: any): Identity {
  assert.ok(value.agent === 'claude' || value.agent === 'codex', 'Missing literal agent')
  for (const field of [
    'owner',
    'session_id',
    'tool_use_id',
    ...(value.agent === 'codex' ? ['turn_id'] : []),
  ]) {
    assert.ok(
      typeof value[field] === 'string' &&
        value[field].length > 0 &&
        value[field].length < 512 &&
        !value[field].includes('${'),
      `Invalid ${field}`,
    )
  }
  return {
    agent: value.agent,
    owner: value.owner,
    session_id: value.session_id,
    tool_use_id: value.tool_use_id,
    ...(value.agent === 'codex' ? { turn_id: value.turn_id } : {}),
  }
}
export function mailbox(key: Identity, directory = coordinationRoot()) {
  const dir = join(
    directory,
    createHash('sha256')
      .update(JSON.stringify(identity(key)))
      .digest('hex'),
  )
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return (name: string) => join(dir, name + '.json')
}
export function claim(file: string, beforePublish?: (temporary: string) => void) {
  publishExclusive(file, { pid: process.pid }, beforePublish)
}
export function publishExclusive(
  file: string,
  value: unknown,
  beforePublish?: (temporary: string) => void,
) {
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 })
    beforePublish?.(temporary)
    // Hard-link publication exposes complete JSON atomically and never replaces another owner.
    linkSync(temporary, file)
  } finally {
    try {
      unlinkSync(temporary)
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error
    }
  }
}
type Rendezvous =
  | { version: 1; key: Identity; state: 'started'; nonce: string }
  | { version: 1; key: Identity; state: 'closed'; pid: number; closedAt: number }
export function rendezvous(
  file: string,
  key: Identity,
  candidate?: Rendezvous,
  beforePublish?: (temporary: string) => void,
): Rendezvous | undefined {
  if (candidate) {
    try {
      publishExclusive(file, candidate, beforePublish)
    } catch (error: any) {
      if (error.code !== 'EEXIST') throw error
    }
  }
  const value = read(file)
  if (value === undefined) return undefined
  assert.equal(value.version, 1)
  assert.deepEqual(value.key, key)
  assert.ok(value.state === 'started' || value.state === 'closed', 'Invalid rendezvous state')
  if (value.state === 'started') assert.ok(typeof value.nonce === 'string' && value.nonce.length)
  else {
    assert.ok(Number.isInteger(value.pid) && value.pid > 0)
    assert.ok(Number.isFinite(value.closedAt) && value.closedAt > 0)
  }
  return value
}
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: any) {
    if (error.code === 'ESRCH') return false
    throw error
  }
}
export function signalProcess(pid: number, signal: NodeJS.Signals, kill = process.kill) {
  try {
    kill(pid, signal)
  } catch (error: any) {
    if (error.code !== 'ESRCH') throw error
  }
}
export function remaining(deadline: number, now = Date.now()) {
  assert.ok(deadline > now, 'Controlled approval deadline exceeded')
  return deadline - now
}
export function completionOrPeerExit<T>(
  readDone: () => T | undefined,
  peerAlive: () => boolean,
  error: string,
): T | undefined {
  const done = readDone()
  if (done !== undefined || peerAlive()) return done
  // Completion can be published between the first read and observing peer exit.
  const final = readDone()
  if (final !== undefined) return final
  throw new Error(error)
}
export async function wait<T>(
  get: () => T | undefined,
  deadline: number,
  signal?: AbortSignal,
): Promise<T> {
  while (true) {
    signal?.throwIfAborted()
    remaining(deadline)
    const value = get()
    if (value !== undefined) return value
    await Bun.sleep(budgets.poll)
  }
}
export const deny = (reason: string) => ({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: reason,
  },
})
export function validateReply(reply: any, start: any, ordinal: number) {
  assert.equal(reply.version, 1)
  assert.deepEqual(reply.key, start.key)
  assert.equal(reply.nonce, start.nonce)
  assert.equal(reply.ordinal, ordinal, 'Reply ordinal mismatch')
  assert.ok(Date.now() < start.deadline, 'Reply after deadline')
  return reply.confirmed === true
}
