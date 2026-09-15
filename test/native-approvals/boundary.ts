import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import {
  alive,
  budgets,
  journal,
  log,
  read,
  root,
  type Identity,
} from '../fixtures/interactive-approvals/channel'
import type { setup } from './native'

export async function holdBoundary(
  message: string,
  directory: string,
  mode: string,
  signal?: AbortSignal,
): Promise<never> {
  assert.ok(mode === 'boundary-timeout' || mode === 'boundary-dual-exit')
  const { key, ordinal, operation } = JSON.parse(message)
  assert.equal(ordinal, 1)
  const rows = journal(directory)
  const commands = rows.filter((row) => row.event === 'command-start')
  const calls = rows.filter((row) => row.event === 'mcp-call')
  assert.equal(commands.length, 1)
  assert.equal(calls.length, 1)
  const command = commands[0],
    check = calls[0]
  assert.deepEqual(key, command.key)
  assert.deepEqual(key, check.key)
  assert.deepEqual(operation, read(join(directory, 'operation.json')))
  assert.deepEqual(operation, {
    toolName: command.input.tool_name,
    input: command.input.tool_input,
  })
  assert.ok(alive(command.pid) && alive(check.pid))
  assert.ok(command.start.deadline - Date.now() > 290000, 'Internal budget must remain long')
  assert.ok(!existsSync(join(directory, 'project/effect.txt')))
  log(
    'boundary-held',
    { key, ordinal, mode, commandPid: command.pid, checkPid: check.pid },
    directory,
  )
  if (mode === 'boundary-dual-exit') {
    // Stop both before killing either so a surviving peer cannot issue a denial.
    process.kill(check.pid, 'SIGSTOP')
    process.kill(command.pid, 'SIGSTOP')
    log('boundary-peers-stopped', { key, commandPid: command.pid, checkPid: check.pid }, directory)
    process.kill(command.pid, 'SIGKILL')
    process.kill(check.pid, 'SIGKILL')
    log('boundary-peers-killed', { key, commandPid: command.pid, checkPid: check.pid }, directory)
  }
  await delay(30000, undefined, { signal })
  throw new Error('Boundary holder outlived the 20-second native observation ceiling')
}

function nativeExpiry(provider: string, key: Identity, native: any, debug: string, heldAt: number) {
  if (provider === 'codex') {
    const timeouts = (native.messages ?? []).filter((message: any) => {
      const run = message.params?.run
      return (
        message.method === 'hook/completed' &&
        message.params.threadId === key.session_id &&
        message.params.turnId === key.turn_id &&
        run?.eventName === 'preToolUse' &&
        run.id?.endsWith(`:${key.tool_use_id}`) &&
        ['command', 'mcpTool'].includes(run.handlerType) &&
        run.status === 'failed' &&
        run.durationMs >= 2000 &&
        run.entries?.some(
          (entry: any) => entry.kind === 'error' && entry.text === 'hook timed out after 2s',
        )
      )
    })
    assert.ok(timeouts.length > 0, 'Missing invocation-bound native timeout evidence')
    for (const timeout of timeouts)
      assert.ok(Number.isFinite(timeout.emittedAtMs) && timeout.emittedAtMs >= heldAt)
    return {
      at: Math.min(...timeouts.map((message: any) => message.emittedAtMs)),
      records: timeouts,
    }
  }
  const cancellations = debug.split('\n').flatMap((line) => {
    const match = line.match(/^(\S+) \[DEBUG\] "?Hook PreToolUse:Bash \(PreToolUse\) cancelled:/)
    return match ? [{ at: Date.parse(match[1]!), line }] : []
  })
  assert.equal(cancellations.length, 1, 'Missing unambiguous native PreToolUse cancellation')
  const cancellation = cancellations[0]!
  assert.ok(Number.isFinite(cancellation.at) && cancellation.at >= heldAt)
  const durations = debug.split('\n').filter((line) => {
    const match = line.match(/^(\S+) \[INFO\] Slow PreToolUse hooks: (\d+)ms for Bash /)
    if (!match) return false
    const at = Date.parse(match[1]!)
    return Number(match[2]) >= 2000 && at >= cancellation.at && at - cancellation.at <= 100
  })
  assert.equal(durations.length, 1, 'Native cancellation lacks matching timeout-duration evidence')
  return { at: cancellation.at, records: [cancellation.line, durations[0]] }
}

export function observeBoundary(r: ReturnType<typeof setup>, native: any, rows: any[]) {
  const one = (event: string) => {
    const values = rows.filter((row) => row.event === event)
    assert.equal(values.length, 1, event)
    return values[0]!
  }
  const command = one('command-start'),
    call = one('mcp-call'),
    held = one('boundary-held')
  assert.deepEqual(command.key, call.key)
  assert.deepEqual(held.key, command.key)
  assert.equal(command.key.tool_use_id, r.callId)
  assert.equal(held.commandPid, command.pid)
  assert.equal(held.checkPid, call.pid)
  assert.ok(command.start.deadline - command.at > 290000)
  assert.deepEqual(
    rows
      .filter((row) => /^(?:[1-5](?:-ask)?|approve-[24])$/.test(row.event))
      .map((row) => row.event),
    ['1', '2-ask'],
  )
  assert.equal(rows.filter((row) => row.event === 'ui-response').length, 0)
  assert.equal(
    rows.filter((row) => row.event === 'mcp-response' && row.reply.action === 'accept').length,
    0,
  )
  const debug = existsSync(join(r.root, 'debug.log'))
    ? readFileSync(join(r.root, 'debug.log'), 'utf8')
    : ''
  let cause: { at: number; records: any[] }
  if (r.env.APPROVAL_CASE === 'boundary-dual-exit') {
    const stopped = one('boundary-peers-stopped'),
      killed = one('boundary-peers-killed')
    for (const record of [stopped, killed]) {
      assert.deepEqual(record.key, command.key)
      assert.equal(record.commandPid, command.pid)
      assert.equal(record.checkPid, call.pid)
    }
    assert.ok(held.at <= stopped.at && stopped.at <= killed.at)
    assert.ok(
      rows.indexOf(held) < rows.indexOf(stopped) && rows.indexOf(stopped) < rows.indexOf(killed),
    )
    cause = { at: killed.at, records: [stopped, killed] }
    for (const event of ['command-denied', 'command-finished', 'mcp-error', 'mcp-finished'])
      assert.equal(rows.filter((row) => row.event === event).length, 0, event)
  } else {
    assert.equal(r.env.APPROVAL_CASE, 'boundary-timeout')
    const handlers = r.hooks.hooks.PreToolUse[0]!.hooks
    assert.equal(handlers.length, 2)
    assert.ok(
      handlers.every((handler) => handler.timeout === 2),
      'Both native handler budgets must be 2s',
    )
    cause = nativeExpiry(r.provider, command.key, native, debug, held.at)
  }
  assert.ok(command.start.deadline > cause.at, 'Native boundary must precede internal expiry')
  const denials = rows.filter(
    (row) =>
      ['command-finished', 'mcp-finished'].includes(row.event) &&
      row.output?.hookSpecificOutput?.permissionDecision === 'deny',
  )
  const reasons = denials.map((row) => {
    const peer = row.event === 'command-finished' ? command : call
    assert.equal(row.pid, peer.pid)
    assert.deepEqual(row.key, peer.key)
    const reason = row.output.hookSpecificOutput.permissionDecisionReason
    assert.ok(typeof reason === 'string' && reason.length > 0)
    assert.ok(
      rows.some(
        (error) =>
          error.event === (row.event === 'command-finished' ? 'command-denied' : 'mcp-error') &&
          error.pid === peer.pid &&
          JSON.stringify(error.key) === JSON.stringify(peer.key) &&
          error.error === reason,
      ),
    )
    return reason as string
  })
  const executed = existsSync(join(r.project, 'effect.txt'))
  const nativeError =
    r.provider === 'claude'
      ? Boolean(native.output.is_error)
      : String(native.output.output).includes('Command blocked by PreToolUse hook')
  const feedback =
    r.provider === 'claude'
      ? typeof native.output.content === 'string'
        ? native.output.content
        : (native.output.content ?? []).map((part: any) => part.text ?? '').join('\n')
      : String(native.output.output)
  const refused = nativeError && reasons.some((reason) => feedback.includes(reason))
  const observedOutcome = refused
    ? 'native-refused'
    : nativeError
      ? 'native-execution-error'
      : 'native-executed-without-consent'
  if (refused) assert.equal(executed, false, 'A hook refusal must prevent the effect')
  else if (!nativeError)
    assert.equal(executed, true, 'Successful native result requires the actual effect')
  for (const event of ['native-effect', 'native-post'])
    assert.equal(rows.filter((row) => row.event === event).length, executed ? 1 : 0)
  if (executed) {
    const effect = one('native-effect')
    assert.ok(effect.at >= cause.at, 'Native effect preceded the observed boundary')
    if (r.env.APPROVAL_CASE === 'boundary-dual-exit')
      assert.ok(rows.indexOf(effect) > rows.indexOf(one('boundary-peers-killed')))
    assert.equal(readFileSync(join(r.project, 'effect.txt'), 'utf8'), 'native-effect\n')
    const post = one('native-post')
    assert.equal(post.input.tool_use_id, r.callId)
    assert.deepEqual(post.input.tool_input, { command: r.cmd })
  }
  const cleanup = read(join(r.root, 'cleanup.json'))
  const nativeHooks = native.messages?.filter((message: any) => message.method === 'hook/completed')
  return {
    characterizationOnly: true,
    enforcementPassed: false,
    observedOutcome,
    nativeOutput: native.output,
    nativeHooks,
    boundaryEvidence: cause,
    handlerTimeoutSeconds: r.env.APPROVAL_CASE === 'boundary-timeout' ? 2 : budgets.native,
    internalBudgetMs: budgets.invocation,
    internalReserveMs: budgets.reserve,
    elapsedAfterCommandMs: cleanup.preTeardown.at - command.at,
    cleanup,
    containmentRequired: cleanup.forcedContainment.length > 0,
  }
}

if (import.meta.main) {
  const input = await Bun.stdin.json()
  await holdBoundary(input.message, root(), process.env.APPROVAL_CASE!)
}
