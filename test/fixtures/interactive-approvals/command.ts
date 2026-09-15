import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import {
  alive,
  budgets,
  claim,
  coordinationRoot,
  deny,
  identity,
  log,
  mailbox,
  put,
  read,
  rendezvous,
  validateReply,
  wait,
} from './channel'

let key: ReturnType<typeof identity> | undefined
let file: ReturnType<typeof mailbox> | undefined
let output: unknown
async function execute(input: any) {
  assert.equal(process.argv[4], '1', 'Explicit paired registration protocol required')
  key = identity({ ...input, provider: process.argv[2], owner: process.argv[3] })
  const packet = mailbox(key)
  if (process.env.APPROVAL_CASE === 'bootstrap-no-start') {
    log('bootstrap-no-start', { key, input })
    return {}
  }
  if (process.env.APPROVAL_CASE?.startsWith('bootstrap-late-')) {
    const closed = await wait(() => {
      const state = rendezvous(packet('rendezvous'), key!)
      if (!state) return undefined
      assert.equal(state.state, 'closed', 'Late-command probe requires explicit closed barrier')
      return state
    }, Date.now() + 5000)
    assert.equal(closed.state, 'closed')
    if (closed.state === 'closed')
      log('bootstrap-late-ready', { key, closed, serverAlive: alive(closed.pid) })
  }
  claim(packet('command'))
  file = packet
  const start = {
    version: 1,
    key,
    nonce: randomUUID(),
    pid: process.pid,
    disposition: process.argv[5] === 'suppressed' ? 'suppressed' : 'run',
    deadline:
      Date.now() + Number(process.env.APPROVAL_BUDGET_MS ?? budgets.invocation) - budgets.reserve,
  }
  put(packet('start'), start)
  const state = rendezvous(packet('rendezvous'), key, {
    version: 1,
    key,
    state: 'started',
    nonce: start.nonce,
  })
  assert.ok(state)
  if (state.state === 'started') assert.equal(state.nonce, start.nonce)
  log('command-start', {
    key,
    input,
    start,
    ipcRoot: coordinationRoot(),
    environment: {
      HOME: process.env.HOME,
      CLOOKS_HOME_ROOT: process.env.CLOOKS_HOME_ROOT,
      XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
    },
  })
  if (start.disposition === 'suppressed') log('command-suppressed', { key, nonce: start.nonce })
  for (let hook = 1; start.disposition === 'run' && hook <= 5; hook++) {
    if (hook === 1 && process.env.APPROVAL_CASE?.startsWith('defer')) log('defer-vote', { key })
    const asks =
      !process.env.APPROVAL_CASE?.startsWith('noask') &&
      process.env.APPROVAL_CASE !== 'bootstrap-late-noask' &&
      (hook === 2 || hook === 4)
    log(asks ? `${hook}-ask` : String(hook), { key })
    if (!asks) continue
    if (state.state === 'closed') throw new Error('MCP peer unavailable: check already closed')
    const ordinal = hook / 2
    put(packet(`ask-${ordinal}`), {
      ...start,
      ordinal,
      operation: { toolName: input.tool_name, input: input.tool_input },
    })
    const peerDeadline = Date.now() + 3000
    const reply = await wait(() => {
      const failure = read(packet('failed'))
      if (failure) {
        assert.equal(failure.version, 1)
        assert.deepEqual(failure.key, key)
        assert.equal(failure.nonce, start.nonce)
        throw new Error(`MCP check ended: ${failure.reason}`)
      }
      const peer = read(packet('attached'))
      if (peer) {
        assert.equal(peer.version, 1)
        assert.deepEqual(peer.key, key)
        assert.equal(peer.nonce, start.nonce)
        assert.ok(Number.isInteger(peer.pid) && peer.pid > 0)
      }
      if (peer && !alive(peer.pid)) throw new Error('MCP peer disconnected')
      if (!peer && Date.now() > peerDeadline) throw new Error('MCP peer unavailable')
      return peer ? read(packet(`reply-${ordinal}`)) : undefined
    }, start.deadline)
    if (!validateReply(reply, start, ordinal)) throw new Error(`Checkpoint ${ordinal} declined`)
    log(`approve-${hook}`, { key })
  }
  return start.disposition === 'suppressed'
    ? {}
    : {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: process.env.APPROVAL_CASE?.startsWith('defer') ? 'defer' : 'allow',
        },
      }
}
try {
  output = await execute(await Bun.stdin.json())
} catch (error) {
  output = deny(String(error))
  try {
    log('command-denied', { key, error: String(error) })
  } catch (loggingError) {
    console.error(`Could not record command denial: ${String(loggingError)}`)
  }
}
console.log(JSON.stringify(output))
try {
  if (file) put(file('done'), output)
  log('command-finished', { key, output })
} catch (error) {
  console.error(`Could not publish command completion: ${String(error)}`)
}
