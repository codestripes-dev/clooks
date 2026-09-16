import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createSandbox, formatDiagnostics, type RunResult, type Sandbox } from './helpers/sandbox'
import {
  bounded,
  assertCompanion,
  cleanupAll,
  connectApprovalPeer,
  invocation,
  runWithConsent,
  startEngine,
  type ApprovalIdentity,
  type Provider,
} from './helpers/live-approvals'

let sandbox: Sandbox
const peers: Awaited<ReturnType<typeof connectApprovalPeer>>[] = []
const engines: ReturnType<typeof startEngine>[] = []
afterEach(async () => {
  await cleanupAll(
    ...peers.splice(0).map((peer) => () => peer.close()),
    ...engines.splice(0).map((engine) => () => engine.close()),
    () => sandbox?.cleanup(),
  )
})

function hook(name: string, body: string, preamble = '', after = '') {
  sandbox.writeHook(
    `${name}.ts`,
    `
import { appendFileSync } from 'node:fs'
${preamble}
const record = (value) => appendFileSync(${JSON.stringify(join(sandbox.dir, 'journal.jsonl'))}, JSON.stringify(value) + '\\n')
export const hook = {
  meta: { name: ${JSON.stringify(name)} },
  async PreToolUse(ctx) {
    record({ hook: ${JSON.stringify(name)}, phase: 'handler', input: ctx.toolInput, prior: ctx.turn.prior })
    ${body}
  },
  afterHook(event) { record({ hook: ${JSON.stringify(name)}, phase: 'after', result: event.handlerResult?.result }); ${after} },
}
`,
  )
}

function config(names: string[], overrides: Record<string, unknown> = {}) {
  sandbox.writeConfig(
    JSON.stringify({
      version: '1.0.0',
      ...Object.fromEntries(names.map((name) => [name, { handoff: false, maxFailures: 0 }])),
      ...overrides,
      PreToolUse: { order: names },
    }),
  )
}

function journal(): Array<{
  hook: string
  phase: string
  result?: string
  input?: unknown
  prior?: Array<{ decision: string }>
}> {
  if (!sandbox.fileExists('journal.jsonl')) return []
  return sandbox
    .readFile('journal.jsonl')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}
function handlers() {
  return journal()
    .filter((row) => row.phase === 'handler')
    .map((row) => row.hook)
}

function output(result: RunResult) {
  expect(result.rawExitCode, formatDiagnostics(result)).toBe(0)
  expect(result.signalCode, formatDiagnostics(result)).toBeNull()
  expect(result.stderr, formatDiagnostics(result)).toBe('')
  return result.stdout ? JSON.parse(result.stdout) : {}
}
function approved(
  result: RunResult,
  provider: Provider,
  fields: { reason?: string; context?: string; input?: unknown } = {},
) {
  const value = output(result)
  const specific = {
    hookEventName: 'PreToolUse',
    ...(provider === 'claude-code' || fields.input !== undefined
      ? { permissionDecision: 'allow' }
      : {}),
    ...(provider === 'claude-code' && fields.reason !== undefined
      ? { permissionDecisionReason: fields.reason }
      : {}),
    ...(fields.context !== undefined ? { additionalContext: fields.context } : {}),
    ...(fields.input !== undefined ? { updatedInput: fields.input } : {}),
  }
  expect(value).toEqual({
    ...(Object.keys(specific).length > 1 ? { hookSpecificOutput: specific } : {}),
    ...(provider === 'codex' && fields.reason !== undefined
      ? {
          systemMessage: `clooks: PreToolUse allow reason (human annotation only; original allow-reason recipient unavailable; native policy retained): ${fields.reason}`,
        }
      : {}),
  })
  return value
}
function denied(result: RunResult) {
  const value = output(result)
  expect(value.hookSpecificOutput).toMatchObject({
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
  })
  expect(value.hookSpecificOutput.permissionDecisionReason).toBeTruthy()
  expect(value.hookSpecificOutput.updatedInput).toBeUndefined()
  return value
}
function companion(
  value: Awaited<ReturnType<Awaited<ReturnType<typeof connectApprovalPeer>>['check']>>,
) {
  expect(value.isError).not.toBe(true)
  expect(value.content).toHaveLength(1)
  const text = value.content[0]!
  if (text.type !== 'text') throw new Error('Expected native hook JSON')
  return JSON.parse(text.text)
}
function completion(identity: ApprovalIdentity) {
  const root = join(sandbox.home, '.clooks/.cache/approvals-live/v1')
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const directory = join(root, entry.name)
    const start = JSON.parse(readFileSync(join(directory, 'start.json'), 'utf8'))
    if (start.key.tool_use_id !== identity.tool_use_id) continue
    const done = JSON.parse(readFileSync(join(directory, 'done.json'), 'utf8'))
    expect(done.key).toEqual(identity)
    expect(done.nonce).toBe(start.nonce)
    return done
  }
  throw new Error('Missing command completion')
}
async function paired(provider: Provider) {
  const peer = await connectApprovalPeer(sandbox)
  peers.push(peer)
  const call = invocation(sandbox, provider)
  const engine = startEngine(sandbox, call)
  engines.push(engine)
  const check = peer.check(call.identity)
  return { peer, call, engine, check }
}

describe('compiled engine live approvals', () => {
  for (const provider of ['claude-code', 'codex'] as const) {
    for (const declineAt of [0, 1, 2]) {
      test(`${provider}: two checkpoints, decline at ${declineAt || 'neither'}, no replay or premature output`, async () => {
        sandbox = createSandbox()
        const names = ['first', 'ask-a', 'middle', 'ask-b', 'last']
        for (const name of names)
          hook(
            name,
            name.startsWith('ask')
              ? `return ctx.ask({ ${name === 'ask-a' ? "question: 'Can ask-a proceed?', " : ''}reason: ${JSON.stringify(name)}, injectContext: ${JSON.stringify(name + '-context')} })`
              : `return ctx.skip({ injectContext: ${JSON.stringify(name + '-context')} })`,
          )
        config(names, {
          'ask-a': { timeout: 100, onError: 'continue', maxFailures: 1, handoff: false },
          'ask-b': { timeout: 100, onError: 'continue', maxFailures: 1, handoff: false },
        })
        const { peer, call, engine, check } = await paired(provider)
        const first = await peer.nextPrompt()
        expect(first.question).toMatchObject({
          hookName: 'ask-a',
          ordinal: 1,
          question: 'Can ask-a proceed?',
          reason: 'ask-a',
          operation: { input: call.payload.tool_input },
        })
        expect(handlers()).toEqual(['first', 'ask-a'])
        expect(journal().find((row) => row.hook === 'ask-a' && row.phase === 'after')?.result).toBe(
          'ask',
        )
        // Human time is outside the configured 100ms hook-code timeout.
        await Bun.sleep(250)
        expect(engine.stdout).toBe('')
        expect(engine.process.exitCode).toBeNull()
        expect(handlers()).toEqual(['first', 'ask-a'])
        first.reply(
          declineAt === 1
            ? { action: 'decline' }
            : { action: 'accept', content: { decision: 'Approve' } },
        )
        if (declineAt !== 1) {
          const second = await peer.nextPrompt()
          expect(second.question).toMatchObject({ hookName: 'ask-b', ordinal: 2, reason: 'ask-b' })
          expect(second.question).not.toHaveProperty('question')
          expect(handlers()).toEqual(['first', 'ask-a', 'middle', 'ask-b'])
          expect(engine.stdout).toBe('')
          second.reply(
            declineAt === 2
              ? { action: 'decline' }
              : { action: 'accept', content: { decision: 'Approve' } },
          )
        }
        const result = await bounded(engine.result, 'Engine result')
        const checkResult = await check
        assertCompanion(
          checkResult,
          declineAt ? 'Approval was not positively confirmed' : undefined,
        )
        const peerResult = companion(checkResult)
        if (declineAt) {
          denied(result)
          expect(peerResult.hookSpecificOutput.permissionDecision).toBe('deny')
          expect(handlers()).toEqual(names.slice(0, declineAt === 1 ? 2 : 4))
        } else {
          approved(result, provider, {
            reason: 'ask-b',
            context: names.map((name) => name + '-context').join('\n'),
          })
          expect(peerResult).toEqual({})
          expect(handlers()).toEqual(names)
        }
        expect(peer.prompts).toHaveLength(declineAt || 2)
        expect(peer.errors).toEqual([])
        expect(peer.stderr).toBe('')
        completion(call.identity)
        expect(sandbox.homeFileExists('.clooks/approvals/codex.sqlite')).toBe(false)

        // Read the same hook's next-invocation history, without another ask or replay.
        hook('ask-a', 'return ctx.skip()')
        config(['ask-a'])
        const probe = startEngine(
          sandbox,
          invocation(sandbox, provider, { sessionId: call.identity.session_id }),
        )
        engines.push(probe)
        expect(output(await probe.result)).toEqual({})
        expect(
          journal()
            .filter((row) => row.phase === 'handler' && row.hook === 'ask-a')
            .at(-1)!
            .prior!.map((record) => record.decision),
        ).toEqual(['ask'])
      }, 20_000)
    }

    test(`${provider}: early no-config/no-match/no-ask/suppressed exits publish completion before returning`, async () => {
      sandbox = createSandbox()
      for (const mode of ['no-config', 'no-match', 'no-ask', 'suppressed']) {
        if (mode === 'no-match') {
          sandbox.writeHook(
            'observer.ts',
            "export const hook = { meta: { name: 'observer' }, PostToolUse(ctx) { return ctx.skip() } }",
          )
          config(['observer'])
        } else if (mode === 'no-ask' || mode === 'suppressed') {
          hook('observer', 'return ctx.skip()')
          config(['observer'])
        }
        const before = handlers().length
        const call = invocation(sandbox, provider)
        const engine = startEngine(
          sandbox,
          call,
          mode === 'suppressed' ? { CLOOKS_APPROVAL_DISPOSITION: 'suppressed' } : {},
        )
        engines.push(engine)
        expect(output(await engine.result)).toEqual({})
        expect(completion(call.identity).failure).toBeUndefined()
        expect(handlers().length - before).toBe(mode === 'no-ask' ? 1 : 0)
        const peer = await connectApprovalPeer(sandbox)
        peers.push(peer)
        expect(companion(await peer.check(call.identity))).toEqual({})
        expect(peer.prompts).toHaveLength(0)
      }
    }, 20_000)

    test(`${provider}: missing peer refuses only the ask and ignores permissive error policy`, async () => {
      sandbox = createSandbox()
      hook('ask', "return ctx.ask({ reason: 'required consent' })")
      hook('later', 'return ctx.allow()')
      config(['ask', 'later'], { ask: { onError: 'continue', maxFailures: 1, handoff: false } })
      const call = invocation(sandbox, provider)
      const engine = startEngine(sandbox, call)
      engines.push(engine)
      expect(denied(await engine.result).hookSpecificOutput.permissionDecisionReason).toMatch(
        /unavailable|init|restart/i,
      )
      expect(handlers()).toEqual(['ask'])
      expect(completion(call.identity).failure).toBeDefined()
    }, 15_000)

    test(`${provider}: SDK request cancellation stops the pipeline and preserves the server`, async () => {
      sandbox = createSandbox()
      hook('ask', "return ctx.ask({ reason: 'required consent' })")
      hook('later', 'return ctx.allow()')
      config(['ask', 'later'])
      const peer = await connectApprovalPeer(sandbox)
      peers.push(peer)
      const call = invocation(sandbox, provider)
      const engine = startEngine(sandbox, call)
      engines.push(engine)
      const controller = new AbortController()
      const check = peer.check(call.identity, controller.signal).then(
        () => undefined,
        (error: unknown) => error,
      )
      await peer.nextPrompt()
      expect(engine.stdout).toBe('')
      controller.abort()
      expect(await check).toBeInstanceOf(Error)
      denied(await engine.result)
      expect(handlers()).toEqual(['ask'])
      expect(completion(call.identity).failure.kind).toBe('cancelled')
      expect((await peer.client.listTools()).tools.map((tool) => tool.name)).toEqual(['check'])
    }, 15_000)

    for (const declineFinal of [false, true]) {
      test(`${provider}: later rewrite reconfirms the final operation without replay (decline=${declineFinal})`, async () => {
        sandbox = createSandbox()
        hook(
          'ask',
          "return ctx.ask({ question: '  Use the candidate command?\\nReview scope.  ', reason: 'confirm candidate', updatedInput: { command: 'echo candidate' } })",
        )
        hook('rewrite', "return ctx.allow({ updatedInput: { command: 'echo final' } })")
        hook('last', 'return ctx.skip()')
        config(['ask', 'rewrite', 'last'])
        const { peer, call, engine, check } = await paired(provider)
        const first = await peer.nextPrompt()
        expect(first.question.operation).toEqual({
          toolName: call.payload.tool_name,
          input: { command: 'echo candidate' },
        })
        expect(first.question.question).toBe('  Use the candidate command?\nReview scope.  ')
        expect(handlers()).toEqual(['ask'])
        first.reply({ action: 'accept', content: { decision: 'Approve' } })
        const final = await peer.nextPrompt()
        expect(final.question).toMatchObject({
          hookName: 'ask',
          ordinal: 2,
          question: '  Use the candidate command?\nReview scope.  ',
          reason: 'confirm candidate',
          operation: { toolName: call.payload.tool_name, input: { command: 'echo final' } },
        })
        expect(handlers()).toEqual(['ask', 'rewrite', 'last'])
        expect(engine.stdout).toBe('')
        final.reply(
          declineFinal
            ? { action: 'decline' }
            : { action: 'accept', content: { decision: 'Approve' } },
        )
        const result = await engine.result
        if (declineFinal) denied(result)
        else approved(result, provider, { input: { command: 'echo final' } })
        assertCompanion(
          await check,
          declineFinal ? 'Approval was not positively confirmed' : undefined,
        )
        expect(handlers()).toEqual(['ask', 'rewrite', 'last'])
        expect(
          journal()
            .filter((row) => row.phase === 'handler')
            .map((row) => row.input),
        ).toEqual([
          { command: '/usr/bin/true' },
          { command: 'echo candidate' },
          { command: 'echo final' },
        ])
      }, 15_000)
    }
  }

  test('Claude renders Bash input with an optional field as complete JSON', async () => {
    sandbox = createSandbox()
    hook('ask', "return ctx.ask({ question: 'Run this operation?', reason: 'Explain risk.' })")
    config(['ask'])
    const input = { command: 'echo exact', timeout: 0 }
    const result = await runWithConsent(
      sandbox,
      invocation(sandbox, 'claude-code', { toolName: 'Bash', input }),
      (prompt) => {
        expect(prompt.question.operation).toEqual({ toolName: 'Bash', input })
        expect(prompt.message).toBe(
          `Run this operation?\n\nTool: Bash\nInput:\n${JSON.stringify(input, null, 2)}\n\nExplain risk.\n\nRequested by ask`,
        )
        return { action: 'accept', content: { decision: 'Approve' } }
      },
    )
    expect(result.prompts).toHaveLength(1)
    approved(result.result, 'claude-code', { reason: 'Explain risk.' })
    expect(handlers()).toEqual(['ask'])
  })

  test('parallel asks complete out of order but prompt in configured order before the next group', async () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'barrier.ts',
      'let release; export const ready = new Promise(r => release = r); export const done = () => release()',
    )
    hook(
      'ask-a',
      "await ready; return ctx.ask({ reason: 'first configured' })",
      "import { ready } from './barrier.ts'",
    )
    hook(
      'ask-b',
      "return ctx.ask({ reason: 'second configured' })",
      "import { done } from './barrier.ts'",
      'done()',
    )
    hook('last', 'return ctx.skip()')
    config(['ask-a', 'ask-b', 'last'], { 'ask-a': { parallel: true }, 'ask-b': { parallel: true } })
    const { peer, engine, check } = await paired('codex')
    for (const name of ['ask-a', 'ask-b']) {
      const prompt = await peer.nextPrompt()
      expect(prompt.question.hookName).toBe(name)
      expect(handlers().sort()).toEqual(['ask-a', 'ask-b'])
      expect(engine.stdout).toBe('')
      prompt.reply({ action: 'accept', content: { decision: 'Approve' } })
    }
    approved(await engine.result, 'codex', { reason: 'second configured' })
    expect(companion(await check)).toEqual({})
    expect(handlers()).toEqual(['ask-a', 'ask-b', 'last'])
    expect(
      journal()
        .filter((row) => row.phase === 'after')
        .map((row) => row.hook),
    ).toEqual(['ask-b', 'ask-a', 'last'])
  }, 15_000)

  test.each(['SIGINT', 'SIGTERM'] as const)(
    'engine %s drains the live interaction before exiting',
    async (signal) => {
      sandbox = createSandbox()
      hook('ask', "return ctx.ask({ reason: 'required consent' })")
      hook('later', 'return ctx.allow()')
      config(['ask', 'later'])
      const { peer, call, engine, check } = await paired('codex')
      await peer.nextPrompt()
      expect(engine.stdout).toBe('')
      engine.process.kill(signal)
      const result = await bounded(engine.result, 'Signalled engine')
      expect(result.rawExitCode, formatDiagnostics(result)).toBe(0)
      expect(result.signalCode).toBeNull()
      expect(result.stderr).toBe(
        signal === 'SIGINT' ? 'clooks: interrupted\n' : 'clooks: killed by SIGTERM\n',
      )
      expect(JSON.parse(result.stdout).hookSpecificOutput).toMatchObject({
        permissionDecision: 'deny',
      })
      expect(JSON.parse(result.stdout).hookSpecificOutput.updatedInput).toBeUndefined()
      expect(completion(call.identity).failure.kind).toBe('cancelled')
      expect(companion(await check).hookSpecificOutput.permissionDecision).toBe('deny')
      expect(handlers()).toEqual(['ask'])
      expect(() => process.kill(engine.process.pid, 0)).toThrow()
      expect((await peer.client.listTools()).tools.map((tool) => tool.name)).toEqual(['check'])
    },
    15_000,
  )

  test('suppressed invocation with an invalid IPC directory never loads configuration or hooks', async () => {
    sandbox = createSandbox()
    hook('must-not-run', "throw new Error('suppressed hook executed')")
    config(['must-not-run'])
    sandbox.writeHomeFile('.clooks/.cache/approvals-live', 'not a directory')
    const engine = startEngine(sandbox, invocation(sandbox, 'claude-code'), {
      CLOOKS_APPROVAL_DISPOSITION: 'suppressed',
    })
    engines.push(engine)
    const result = await bounded(engine.result, 'Suppressed invalid IPC')
    expect(denied(result).hookSpecificOutput.permissionDecisionReason).toContain('suppressed')
    expect(handlers()).toEqual([])
  })

  test('malformed Claude ask patch is refused before prompting or running later hooks', async () => {
    sandbox = createSandbox()
    hook('ask', "return { result: 'ask', reason: 'invalid patch', updatedInput: [] }")
    hook('later', 'return ctx.allow()')
    config(['ask', 'later'])
    const result = await runWithConsent(sandbox, invocation(sandbox, 'claude-code'), () => {
      throw new Error('Malformed patch must not prompt')
    })
    expect(denied(result.result).hookSpecificOutput.permissionDecisionReason).toContain(
      'result policy failed for hook "ask" on PreToolUse; result effects refused.',
    )
    expect(result.prompts).toHaveLength(0)
    expect(handlers()).toEqual(['ask'])
  })

  for (const provider of ['claude-code', 'codex'] as const) {
    test.each([
      ['non-string', '42'],
      ['null', 'null'],
      ['empty', "''"],
      ['blank', "'   '"],
      ['oversized', JSON.stringify('x'.repeat(513))],
    ])(
      `${provider}: %s ask question fails closed before prompting or later hooks`,
      async (_case, question) => {
        sandbox = createSandbox()
        hook('ask', `return { result: 'ask', question: ${question}, reason: 'confirm' }`)
        hook('later', 'return ctx.allow()')
        config(['ask', 'later'])
        const result = await runWithConsent(sandbox, invocation(sandbox, provider), () => {
          throw new Error('Malformed question must not prompt')
        })
        expect(denied(result.result).hookSpecificOutput.permissionDecisionReason).toContain(
          'ask question must be a nonblank string of at most 512 UTF-16 code units when provided',
        )
        expect(result.prompts).toHaveLength(0)
        expect(handlers()).toEqual(['ask'])
      },
    )
  }

  test.each(['block', 'crash'] as const)(
    'approved checkpoint never clears a later %s',
    async (mode) => {
      sandbox = createSandbox()
      hook('ask', "return ctx.ask({ reason: 'confirm' })")
      hook(
        'gate',
        mode === 'block'
          ? "return ctx.block({ reason: 'policy block' })"
          : "throw new Error('policy crash')",
      )
      config(['ask', 'gate'])
      const result = await runWithConsent(sandbox, invocation(sandbox, 'codex'), () => ({
        action: 'accept',
        content: { decision: 'Approve' },
      }))
      expect(denied(result.result).hookSpecificOutput.permissionDecisionReason).toContain(
        mode === 'block' ? 'policy block' : 'policy crash',
      )
      expect(result.prompts).toHaveLength(1)
      expect(handlers()).toEqual(['ask', 'gate'])
    },
  )

  test('known parallel block suppresses elicitation without skipping already-started hooks', async () => {
    sandbox = createSandbox()
    hook('ask', "return ctx.ask({ reason: 'unnecessary' })")
    hook('block', "return ctx.block({ reason: 'known policy block' })")
    config(['ask', 'block'], { ask: { parallel: true }, block: { parallel: true } })
    const result = await runWithConsent(sandbox, invocation(sandbox, 'claude-code'), () => {
      throw new Error('Known block must suppress consent')
    })
    expect(denied(result.result).hookSpecificOutput.permissionDecisionReason).toContain(
      'known policy block',
    )
    expect(result.prompts).toHaveLength(0)
    expect(handlers().sort()).toEqual(['ask', 'block'])
  })

  test.each([false, true])(
    'Claude defer reconfirms original input after a patched ask (decline=%s)',
    async (decline) => {
      sandbox = createSandbox()
      hook(
        'ask',
        "return ctx.ask({ reason: 'confirm patch', updatedInput: { command: 'echo candidate' } })",
      )
      hook('defer', 'return ctx.defer()')
      config(['ask', 'defer'])
      const call = invocation(sandbox, 'claude-code')
      const result = await runWithConsent(sandbox, call, (prompt, index) => {
        expect(prompt.question.operation.input).toEqual({
          command: index === 0 ? 'echo candidate' : '/usr/bin/true',
        })
        return index === 1 && decline
          ? { action: 'decline' }
          : { action: 'accept', content: { decision: 'Approve' } }
      })
      expect(result.prompts).toHaveLength(2)
      if (decline) denied(result.result)
      else {
        const value = output(result.result)
        expect(value.hookSpecificOutput.permissionDecision).toBe('defer')
        expect(value.hookSpecificOutput.updatedInput).toBeUndefined()
      }
      expect(handlers()).toEqual(['ask', 'defer'])
    },
  )
})
