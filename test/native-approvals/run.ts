import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { journal, type AgentId } from '../fixtures/interactive-approvals/channel'
import {
  claude,
  codex,
  save,
  setup,
  type InteractiveConfig,
  type InteractiveReadiness,
} from './native'
import { checkStdinClosure } from './transport'
import { assertScope } from './scope'
import { assertBootstrap } from './bootstrap'
import { runOverlap } from './overlap'
import { observeBoundary } from './boundary'

assert.equal(process.env.CLOOKS_E2E_DOCKER, 'true', 'Run via test:approvals-native in Docker')
assert.notEqual(process.getuid!(), 0)
if (process.argv.includes('--generated')) {
  const { runGenerated } = await import('./generated')
  await runGenerated(process.argv.slice(2))
  process.exit(0)
}
if (process.argv.includes('--transport')) {
  assert.equal(process.argv.length, 3)
  await checkStdinClosure()
  save('/export/passed.json', { cases: ['transport-eof'], productionEngine: false })
  console.log('transport-eof: PASS')
  process.exit(0)
}
const baseline = process.argv.includes('--baseline')
const readinessFlags = process.argv
  .slice(2)
  .filter((arg) => arg.startsWith('--interactive-readiness='))
assert.ok(readinessFlags.length <= 1, 'Duplicate interactive readiness selection')
const interactiveReadiness = (readinessFlags[0]?.split('=')[1] ??
  'input-render') as InteractiveReadiness
assert.ok(
  ['input-render', 'mcp-status'].includes(interactiveReadiness),
  'Unknown interactive readiness',
)
const configFlags = process.argv.slice(2).filter((arg) => arg.startsWith('--interactive-config='))
assert.ok(configFlags.length <= 1, 'Duplicate interactive config selection')
const interactiveConfig = (configFlags[0]?.split('=')[1] ?? 'cli') as InteractiveConfig
assert.ok(
  ['cli', 'disk', 'cli-no-tools', 'cli-restart', 'cli-second-turn'].includes(interactiveConfig),
  'Unknown interactive config',
)
const selected = process.argv
  .slice(2)
  .filter(
    (arg) => arg !== '--baseline' && !configFlags.includes(arg) && !readinessFlags.includes(arg),
  )
const diagnostic = configFlags.length > 0 || interactiveReadiness === 'mcp-status'
if (readinessFlags.length)
  assert.ok(
    !baseline &&
      selected.length > 0 &&
      selected.every((name) =>
        /^claude-defer-interactive(?:-decline)?-(?:command|mcp)-first$/.test(name),
      ),
    'Readiness selection requires explicit Claude interactive cases',
  )
if (configFlags.length)
  assert.ok(
    !baseline &&
      selected.length === 1 &&
      /^claude-defer-interactive(?:-decline)?-(?:command|mcp)-first$/.test(selected[0]!),
    'Interactive config discriminator requires exactly one existing Claude interactive case',
  )
const agents: AgentId[] = ['claude', 'codex']
const results: any[] = []
for (const agent of agents) {
  const binary = `/native/${agent}`
  const version = Bun.spawnSync([binary, '--version'], {
    env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/tmp' },
    timeout: 5000,
  })
  assert.equal(version.exitCode, 0)
  save(`/export/${agent}-version.json`, {
    version: version.stdout.toString().trim(),
    sha256: createHash('sha256').update(readFileSync(binary)).digest('hex'),
  })
  for (const topology of [
    'same-session',
    'parent-child',
    ...(agent === 'codex' && !baseline && selected.includes('codex-overlap-serial-child-control')
      ? ['serial-child-control' as const]
      : []),
    ...(agent === 'codex' && !baseline && selected.includes('codex-overlap-primed-child-control')
      ? ['primed-child-control' as const]
      : []),
  ] as const) {
    const name = `${agent}-overlap-${topology}`
    if (baseline || (selected.length && !selected.includes(name))) continue
    const directory = join('/export', name)
    let result: any
    try {
      result = { name, ...(await runOverlap(directory, agent, topology)) }
    } catch (error) {
      result = {
        name,
        passed: false,
        ...(topology === 'serial-child-control'
          ? { diagnosticOnly: true, overlapProof: false }
          : {}),
        ...(topology === 'primed-child-control'
          ? {
              diagnosticOnly: true,
              overlapProof: false,
              childReadiness: 'direct-native-check',
              ordinaryColdChildReadiness: false,
            }
          : {}),
        error: error instanceof Error ? error.stack : String(error),
      }
    }
    results.push(result)
    save('/export/results.json', { baseline, productionEngine: false, scriptedUI: true, results })
    console.log(`${name}: ${result.passed ? 'PASS' : result.error}`)
    if (!result.passed) process.exit(1)
  }
  for (const reverse of [false, true]) {
    for (const mode of baseline
      ? ['approve']
      : [
          'approve',
          'decline-first',
          'decline-second',
          'noask',
          'noask-missing',
          'noask-disabled',
          'cancel',
          'long',
          'non-shell',
          'stale',
          'duplicate',
          'empty',
          'command-exit',
          'server-disconnect',
          'missing',
          'wrong-owner',
          'disabled',
          'native-interrupt',
          'deadline',
          ...(!reverse ? ['boundary-timeout', 'boundary-dual-exit'] : []),
          'bootstrap-no-start',
          'bootstrap-late-ask',
          'bootstrap-late-noask',
          'scope-project-approve',
          'scope-project-decline',
          'scope-global-approve',
          'scope-global-decline',
          ...(agent === 'claude'
            ? ['defer', 'defer-decline', 'defer-interactive', 'defer-interactive-decline']
            : []),
        ]) {
      const name = `${agent}-${mode}-${reverse ? 'mcp-first' : 'command-first'}`
      if (selected.length && !selected.includes(name)) continue
      const r = setup(
        join('/export', name),
        agent,
        mode,
        reverse,
        interactiveConfig,
        interactiveReadiness,
      )
      process.env.APPROVAL_ROOT = r.root
      process.env.APPROVAL_CASE = mode
      const result: any = {
        name,
        interactiveConfig,
        interactiveReadiness,
        diagnostic,
        passed: false,
      }
      try {
        const native = await (agent === 'claude' ? claude(r) : codex(r))
        const rows = journal(r.root),
          events = rows.map((row) => row.event)
        if (agent === 'codex' || !mode.startsWith('defer-interactive')) {
          const anchor = JSON.parse(readFileSync(join(r.root, 'native-identity.json'), 'utf8'))
          assert.equal(anchor.agent, agent)
          assert.equal(anchor.tool_use_id, r.callId)
          assert.equal(typeof anchor.session_id, 'string')
          assert.ok(anchor.session_id.length > 0)
          if (agent === 'codex') {
            assert.equal(typeof anchor.turn_id, 'string')
            assert.ok(anchor.turn_id.length > 0)
          }
          for (const row of rows.filter(
            (row) =>
              row.event === 'command-start' ||
              row.event === 'mcp-call' ||
              row.event === 'bootstrap-no-start',
          ))
            for (const [field, value] of Object.entries(anchor)) assert.equal(row.key[field], value)
        }
        if (agent === 'codex') {
          const responders = JSON.parse(readFileSync(join(r.root, 'responders.json'), 'utf8'))
          const cleanup = JSON.parse(readFileSync(join(r.root, 'cleanup.json'), 'utf8'))
          assert.equal(responders.pending, 0)
          assert.equal(responders.started, responders.settled)
          assert.deepEqual(responders.errors, [])
          assert.ok(responders.at <= cleanup.preTeardown.at)
          assert.ok(
            rows
              .filter((row) => row.event === 'ui-response')
              .every((row) => row.at <= responders.at),
          )
        }
        if (mode.startsWith('boundary-')) {
          const observation = observeBoundary(r, native, rows)
          save(join(r.root, 'boundary-observation.json'), observation)
          Object.assign(result, observation, { passed: true, diagnostic: true, native })
        } else if (mode.startsWith('bootstrap-') || mode === 'wrong-owner') {
          assertBootstrap(r, native, rows)
          Object.assign(result, {
            passed: true,
            native,
            protocolProof: 'unmatched-neutral-not-approval',
          })
        } else if (r.scoped) {
          assertScope(r, native, rows)
          Object.assign(result, {
            passed: true,
            native,
            registrationProof: 'fixture-disk-shape-and-explicit-disposition-not-generated-launcher',
          })
        } else if (mode === 'native-interrupt') {
          assert.deepEqual(
            events.filter((e) => /^(?:[1-5](?:-ask)?|approve-[24])$/.test(e)),
            ['1', '2-ask'],
          )
          assert.ok(!existsSync(join(r.project, 'effect.txt')))
          assert.equal(events.filter((e) => e === 'ui-response').length, 0)
          assert.equal(events.filter((e) => e === 'native-effect' || e === 'native-post').length, 0)
          if (agent === 'codex') {
            const commands = rows.filter((row) => row.event === 'command-start')
            const calls = rows.filter((row) => row.event === 'mcp-call')
            const finished = rows.filter((row) => row.event === 'mcp-finished')
            assert.equal(commands.length, 1)
            assert.equal(calls.length, 1)
            assert.equal(finished.length, 1)
            assert.deepEqual(commands[0].key, calls[0].key)
            assert.equal(commands[0].input.tool_use_id, r.callId)
            assert.equal(finished[0].pid, calls[0].pid)
            const interrupt = JSON.parse(readFileSync(join(r.root, 'interrupt.json'), 'utf8'))
            assert.equal(interrupt.threadId, commands[0].key.session_id)
            assert.equal(interrupt.turnId, commands[0].key.turn_id)
            assert.ok(
              'messages' in native,
              'Codex interruption requires native app-server receipts',
            )
            const completed = native.messages.filter(
              (message: any) => message.method === 'turn/completed',
            )
            assert.equal(completed.length, 1)
            assert.equal(completed[0].params.turn.status, 'interrupted')
            assert.equal(completed[0].params.turn.id, interrupt.turnId)
            assert.equal(completed[0].params.threadId, interrupt.threadId)
            assert.ok(
              rows
                .filter((row) => row.event === 'mcp-response')
                .every((row) => row.reply.action === 'cancel'),
            )
            const cancellations = rows.filter(
              (row) =>
                row.event === 'elicitation-peer-exited' ||
                (row.event === 'mcp-response' && row.reply.action === 'cancel'),
            )
            assert.ok(
              cancellations.length > 0,
              'Cancelled check requires an actual cancellation trace',
            )
            for (const cancellation of cancellations) {
              assert.equal(cancellation.pid, calls[0].pid)
              assert.deepEqual(cancellation.key, calls[0].key)
              assert.equal(cancellation.ordinal, 1)
              assert.ok(cancellation.at >= calls[0].at && cancellation.at <= finished[0].at)
            }
            const cleanup = JSON.parse(readFileSync(join(r.root, 'cleanup.json'), 'utf8'))
            assert.ok(finished[0].at <= cleanup.preTeardown.at)
          } else {
            assert.equal(events.filter((e) => e === 'interrupt-injected').length, 1)
            const cleanup = JSON.parse(readFileSync(join(r.root, 'cleanup.json'), 'utf8'))
            assert.ok(
              events.includes('mcp-finished') ||
                cleanup.preTeardown.servers.every((p: any) => !p.alive),
              'Cancelled check must settle or native server must already be gone',
            )
          }
          Object.assign(result, { passed: true, native })
        } else {
          const permits =
            mode.startsWith('noask') ||
            ['approve', 'long', 'non-shell', 'defer-interactive'].includes(mode)
          const unavailable = mode.endsWith('missing') || mode.endsWith('disabled')
          const early = !permits && !['decline-second', 'duplicate', 'defer'].includes(mode)
          const expected = mode.startsWith('noask')
            ? ['1', '2', '3', '4', '5']
            : early
              ? ['1', '2-ask']
              : ['decline-second', 'duplicate'].includes(mode)
                ? ['1', '2-ask', 'approve-2', '3', '4-ask']
                : ['1', '2-ask', 'approve-2', '3', '4-ask', 'approve-4', '5']
          assert.deepEqual(
            events.filter((e) => /^(?:[1-5](?:-ask)?|approve-[24])$/.test(e)),
            expected,
          )
          assert.equal(events.filter((e) => e === 'command-start').length, 1)
          assert.equal(events.filter((e) => e === 'mcp-call').length, unavailable ? 0 : 1)
          assert.equal(
            events.filter((e) => e === 'mcp-finished').length,
            unavailable || mode === 'server-disconnect' ? 0 : 1,
          )
          assert.equal(existsSync(join(r.project, 'effect.txt')), permits)
          if (permits)
            assert.equal(readFileSync(join(r.project, 'effect.txt'), 'utf8'), 'native-effect\n')
          if (agent === 'claude')
            assert.equal(Boolean(native.output.is_error), !permits && mode !== 'defer')
          else
            assert.equal(
              String(native.output.output).includes(
                mode === 'non-shell'
                  ? 'Tool call blocked by PreToolUse hook'
                  : 'Command blocked by PreToolUse hook',
              ),
              !permits,
            )
          const posts = rows.filter((row) => row.event === 'native-post')
          assert.equal(posts.length, permits ? 1 : 0)
          const commands = rows.filter((row) => row.event === 'command-start')
          const calls = rows.filter((row) => row.event === 'mcp-call')
          if (!unavailable) assert.deepEqual(calls[0].key, commands[0].key)
          assert.equal(commands[0].input.tool_use_id, r.callId)
          if (permits) {
            assert.equal(posts[0].input.tool_use_id, r.callId)
            const expectedOperation = JSON.parse(
              readFileSync(join(r.root, 'operation.json'), 'utf8'),
            )
            assert.equal(posts[0].input.tool_name, expectedOperation.toolName)
            assert.deepEqual(posts[0].input.tool_input, expectedOperation.input)
            assert.ok(events.indexOf('native-post') > events.indexOf('5'))
            if (mode !== 'non-shell') {
              assert.equal(events.filter((e) => e === 'native-effect').length, 1)
              assert.ok(events.indexOf('native-effect') > events.indexOf('5'))
              assert.ok(events.indexOf('native-effect') > events.indexOf('command-finished'))
            } else
              assert.ok(
                posts[0].input.tool_response,
                'Native non-shell completion response required',
              )
          }
          if (!permits && mode !== 'defer') {
            const feedback =
              agent === 'claude'
                ? typeof native.output.content === 'string'
                  ? native.output.content
                  : native.output.content.map((b: any) => b.text ?? '').join('\n')
                : String(native.output.output)
            const reason = [
              'decline-first',
              'cancel',
              'defer-decline',
              'defer-interactive-decline',
            ].includes(mode)
              ? 'Checkpoint 1 declined'
              : mode === 'decline-second'
                ? 'Checkpoint 2 declined'
                : ['missing', 'disabled'].includes(mode)
                  ? 'MCP peer unavailable'
                  : mode === 'command-exit'
                    ? 'Command exited'
                    : mode === 'server-disconnect'
                      ? 'MCP peer disconnected'
                      : mode === 'empty'
                        ? 'confirmed'
                        : 'stale-nonce'
            if (mode === 'duplicate') {
              assert.ok(feedback.includes('Reply ordinal mismatch'))
              assert.equal(events.filter((e) => e === 'duplicate-response-injected').length, 1)
            } else if (mode === 'deadline') {
              assert.deepEqual(commands[0].key, {
                agent,
                owner: 'project:m1',
                session_id: commands[0].input.session_id,
                tool_use_id: r.callId,
                ...(agent === 'codex' ? { turn_id: commands[0].input.turn_id } : {}),
              })
              assert.notEqual(commands[0].pid, calls[0].pid)
              assert.equal(events.filter((value) => value === 'native-effect').length, 0)
              const cleanup = JSON.parse(readFileSync(join(r.root, 'cleanup.json'), 'utf8'))
              const emittedReasons: string[] = []
              for (const peer of [
                {
                  invocation: commands[0],
                  errorEvent: 'command-denied',
                  finishEvent: 'command-finished',
                },
                {
                  invocation: calls[0],
                  errorEvent: 'mcp-error',
                  finishEvent: 'mcp-finished',
                },
              ]) {
                const failures = rows.filter((row) => row.event === peer.errorEvent)
                const completions = rows.filter((row) => row.event === peer.finishEvent)
                assert.equal(failures.length, 1)
                assert.equal(completions.length, 1)
                const failure = failures[0],
                  completion = completions[0]
                assert.equal(failure.pid, peer.invocation.pid)
                assert.equal(completion.pid, peer.invocation.pid)
                assert.equal(typeof failure.error, 'string')
                assert.deepEqual(completion.output, {
                  hookSpecificOutput: {
                    hookEventName: 'PreToolUse',
                    permissionDecision: 'deny',
                    permissionDecisionReason: failure.error,
                  },
                })
                assert.ok(peer.invocation.at <= failure.at && failure.at <= completion.at)
                assert.ok(completion.at <= cleanup.preTeardown.at)
                emittedReasons.push(completion.output.hookSpecificOutput.permissionDecisionReason)
              }
              if (mode === 'deadline') {
                const commandFailure = rows.find((row) => row.event === 'command-denied')!
                const mcpFailure = rows.find((row) => row.event === 'mcp-error')!
                const controlled =
                  'AssertionError [ERR_ASSERTION]: Controlled approval deadline exceeded'
                if (
                  mcpFailure.error ===
                  'McpError: MCP error -32001: Error: Command exited during elicitation'
                ) {
                  assert.equal(commandFailure.error, controlled)
                  const exited = rows.filter((row) => row.event === 'elicitation-peer-exited')
                  assert.equal(exited.length, 1)
                  assert.equal(exited[0].pid, calls[0].pid)
                  assert.deepEqual(exited[0].key, calls[0].key)
                  assert.ok(
                    exited[0].at >= rows.find((row) => row.event === 'command-finished')!.at,
                  )
                  assert.ok(exited[0].at <= mcpFailure.at)
                } else {
                  assert.ok(
                    [controlled, 'McpError: MCP error -32001: Request timed out'].includes(
                      mcpFailure.error,
                    ),
                  )
                  if (mcpFailure.error === controlled)
                    assert.ok(mcpFailure.at >= commands[0].start.deadline)
                  else {
                    assert.equal(mcpFailure.phase, 'elicitation')
                    assert.equal(mcpFailure.code, -32001)
                    const requests = rows.filter((row) => row.event === 'elicitation-start')
                    assert.equal(requests.length, 1)
                    assert.equal(requests[0].pid, calls[0].pid)
                    assert.deepEqual(requests[0].key, calls[0].key)
                    assert.equal(requests[0].deadline, commands[0].start.deadline)
                    assert.ok(requests[0].timeout > 0 && requests[0].timeout <= 1500)
                    assert.ok(mcpFailure.at >= requests[0].at)
                  }
                }
                if (commandFailure.error === controlled)
                  assert.ok(commandFailure.at >= commands[0].start.deadline)
                else {
                  assert.equal(commandFailure.error, `Error: MCP check ended: ${mcpFailure.error}`)
                  assert.ok(commandFailure.at >= mcpFailure.at)
                }
              }
              assert.ok(
                emittedReasons.some((emitted) => feedback.includes(emitted)),
                `Original native result lacks either validated emitted denial: ${feedback}`,
              )
            } else if (mode === 'empty') {
              const failures = rows.filter((row) => row.event === 'mcp-error')
              assert.equal(failures.length, 1)
              assert.equal(failures[0].pid, calls[0].pid)
              assert.equal(failures[0].phase, 'elicitation')
              assert.equal(failures[0].code, -32602)
              assert.equal(
                failures[0].error,
                "McpError: MCP error -32602: Elicitation response content does not match requested schema: data must have required property 'confirmed'",
              )
              assert.ok(feedback.includes(failures[0].error))
            } else
              assert.ok(
                feedback.includes(reason),
                `Original native result lacks scenario refusal: ${reason}: ${feedback}`,
              )
            if (['command-exit', 'server-disconnect'].includes(mode))
              assert.equal(
                rows.filter((row) => row.event === 'fault-injected' && row.mode === mode).length,
                1,
              )
            assert.ok(
              rows.some(
                (row) => row.event === (mode === 'command-exit' ? 'mcp-error' : 'command-denied'),
              ),
              'Missing denying peer evidence',
            )
          }
          if (mode !== 'deadline')
            assert.equal(
              rows.filter((row) => row.event === 'ui-response').length,
              mode.startsWith('noask') || unavailable ? 0 : early ? 1 : 2,
            )
          else {
            assert.equal(rows.filter((row) => row.event === 'mcp-prompt').length, 1)
            const finished = rows.find((row) => row.event === 'command-finished')
            assert.ok(
              finished && finished.at - commands[0].at < 6500,
              'Controlled deadline must deny before native expiry',
            )
            assert.ok(
              rows
                .filter((row) => row.event === 'mcp-response')
                .every((row) => row.reply.action !== 'accept'),
            )
          }
          if (mode.startsWith('defer'))
            assert.equal(events.filter((e) => e === 'defer-vote').length, 1)
          if (
            [
              'decline-first',
              'decline-second',
              'cancel',
              'defer-decline',
              'defer-interactive-decline',
            ].includes(mode)
          ) {
            const actions = rows
              .filter((row) => row.event === 'mcp-response')
              .map((row) => row.reply.action)
            assert.deepEqual(
              actions,
              mode === 'decline-second'
                ? ['accept', 'decline']
                : [mode === 'cancel' ? 'cancel' : 'decline'],
              'Native elicitation must preserve the explicit scripted action',
            )
          }
          if (mode === 'long')
            assert.ok(rows.some((row) => row.event === 'ui-response' && row.heldMs >= 65000))
          Object.assign(result, { passed: true, native })
        }
      } catch (error) {
        result.error = error instanceof Error ? error.stack : String(error)
        if (mode.startsWith('boundary-'))
          Object.assign(result, {
            diagnostic: true,
            characterizationOnly: true,
            enforcementPassed: false,
            observedOutcome: 'characterization-incomplete',
          })
      }
      if (interactiveConfig === 'cli-second-turn') {
        result.requiredFirstTurn = 'denied'
        result.firstTurnPassed = null
        try {
          const priming = join(r.root, 'priming', 'summary.json')
          const precondition = join(r.root, 'diagnostic-precondition.json')
          const receiptPath = existsSync(priming) ? priming : precondition
          if (existsSync(receiptPath)) {
            const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'))
            if (
              receipt.output?.tool_use_id === receipt.callId &&
              typeof receipt.output?.is_error === 'boolean'
            )
              result.firstTurnPassed = !receipt.output.is_error
          }
          if (result.passed) {
            assert.ok(existsSync(priming), 'Successful diagnostic requires validated priming')
            assert.equal(result.firstTurnPassed, false)
            result.passingPhase = 'second-turn-only'
          }
        } catch (error) {
          result.passed = false
          result.error = error instanceof Error ? error.stack : String(error)
        }
      }
      results.push(result)
      save(join(r.root, 'result.json'), result)
      save('/export/results.json', { baseline, productionEngine: false, scriptedUI: true, results })
      console.log(
        `${name}: ${result.passed ? (result.characterizationOnly ? `CHARACTERIZED: ${result.observedOutcome}` : 'PASS') : result.error}`,
      )
      if (!result.passed) process.exit(1)
    }
  }
}
assert.ok(results.length > 0, 'No cases selected')
if (selected.length)
  assert.equal(results.length, selected.length, 'Unknown or duplicate selected cases')
save('/export/passed.json', {
  baseline,
  interactiveConfig,
  interactiveReadiness,
  diagnostic: diagnostic || results.some((result) => result.diagnosticOnly),
  ...(results.some((result) => result.diagnosticOnly)
    ? {
        diagnosticCases: results
          .filter((result) => result.diagnosticOnly)
          .map((result) => ({
            name: result.name,
            diagnosticOnly: true,
            overlapProof: result.overlapProof ?? false,
            ...(result.name === 'codex-overlap-primed-child-control'
              ? {
                  childReadiness: result.childReadiness,
                  ordinaryColdChildReadiness: result.ordinaryColdChildReadiness,
                }
              : {}),
          })),
      }
    : {}),
  ...(results.some((result) => result.characterizationOnly)
    ? {
        boundaryObservations: results
          .filter((result) => result.characterizationOnly)
          .map((result) => ({
            name: result.name,
            observedOutcome: result.observedOutcome,
            enforcementPassed: false,
          })),
      }
    : {}),
  ...(interactiveConfig === 'cli-second-turn'
    ? {
        requiredFirstTurn: results[0].requiredFirstTurn,
        firstTurnPassed: results[0].firstTurnPassed,
        passingPhase: results[0].passingPhase,
      }
    : {}),
  milestoneComplete: false,
  productionEngine: false,
  scriptedUI: true,
  cases: results.map((r) => r.name),
})
