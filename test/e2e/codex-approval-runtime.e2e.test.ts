import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { createSandbox, formatDiagnostics, type RunResult, type Sandbox } from './helpers/sandbox'
import {
  connectApprovalPeer,
  cleanupAll,
  invocation,
  runWithConsent,
  startEngine,
} from './helpers/live-approvals'

// Compiled hook envelopes and live SDK consent, not native tool execution.
let sandbox: Sandbox
afterEach(() => sandbox?.cleanup())
function install(body = "return ctx.ask({ reason: 'confirm operation' })") {
  sandbox = createSandbox()
  sandbox.writeConfig('version: "1.0.0"\nask: { handoff: false, maxFailures: 0 }\n')
  sandbox.writeHook(
    'ask.ts',
    `
import { appendFileSync } from 'node:fs'
export const hook = { meta: { name: 'ask' }, PreToolUse(ctx) {
  appendFileSync(${JSON.stringify(join(sandbox.dir, 'calls.jsonl'))}, JSON.stringify(ctx.toolInput) + '\\n')
  ${body}
} }
`,
  )
}
function output(result: RunResult) {
  expect(result.rawExitCode, formatDiagnostics(result)).toBe(0)
  expect(result.signalCode, formatDiagnostics(result)).toBeNull()
  expect(result.stderr, formatDiagnostics(result)).toBe('')
  return result.stdout ? JSON.parse(result.stdout) : {}
}
function calls() {
  return sandbox
    .readFile('calls.jsonl')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
}
function approved(reason: string, input?: unknown) {
  return {
    ...(input === undefined
      ? {}
      : {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'allow',
            updatedInput: input,
          },
        }),
    systemMessage: `clooks: PreToolUse allow reason (human annotation only; original allow-reason recipient unavailable; native policy retained): ${reason}`,
  }
}

describe('compiled Codex live approval isolation', () => {
  test('legacy storage and token-looking command text cannot grant or carry consent', async () => {
    install()
    sandbox.writeHomeFile('.clooks/approvals/codex.sqlite', 'not an approval database')
    const input = { command: `CLOOKS_APPROVAL_TOKENS=ca1_${'a'.repeat(64)} /usr/bin/true` }
    const sessionId = crypto.randomUUID()
    for (const accept of [true, false]) {
      const result = await runWithConsent(
        sandbox,
        invocation(sandbox, 'codex', { sessionId, input }),
        (prompt) => {
          expect(prompt.question.operation.input).toEqual(input)
          return accept ? { action: 'accept', content: { confirmed: true } } : { action: 'decline' }
        },
      )
      expect(result.prompts).toHaveLength(1)
      const value = output(result.result)
      if (accept) expect(value).toEqual(approved('confirm operation'))
      else expect(value.hookSpecificOutput.permissionDecision).toBe('deny')
      expect(value.hookSpecificOutput?.updatedInput).toBeUndefined()
    }
    expect(calls()).toEqual([input, input])
    expect(sandbox.readHomeFile('.clooks/approvals/codex.sqlite')).toBe('not an approval database')
  })

  test.each(['owner', 'session_id', 'tool_use_id', 'turn_id'] as const)(
    'a mismatched %s check cannot answer the live command',
    async (field) => {
      install()
      const call = invocation(sandbox, 'codex')
      const peer = await connectApprovalPeer(sandbox)
      let engine: ReturnType<typeof startEngine> | undefined
      try {
        engine = startEngine(sandbox, call, { CLOOKS_APPROVAL_TOKENS: `ca1_${'b'.repeat(64)}` })
        const check = peer.check({
          ...call.identity,
          [field]: field === 'owner' ? 'global' : 'different',
        })
        const value = output(await engine.result)
        expect(value.hookSpecificOutput.permissionDecision).toBe('deny')
        expect(value.hookSpecificOutput.updatedInput).toBeUndefined()
        const reply = await check
        expect(reply.isError).not.toBe(true)
        expect(reply.content).toEqual([{ type: 'text', text: '{}' }])
        expect(peer.prompts).toHaveLength(0)
        expect(calls()).toHaveLength(1)
        expect(sandbox.homeFileExists('.clooks/approvals/codex.sqlite')).toBe(false)
      } finally {
        await cleanupAll(
          () => peer.close(),
          () => engine?.close(),
        )
      }
    },
    15_000,
  )

  test('aliases sharing one hook module still require separate live answers', async () => {
    install()
    sandbox.writeConfig(`version: "1.0.0"
ask-a: { uses: ask, handoff: false }
ask-b: { uses: ask, handoff: false }
PreToolUse: { order: [ask-a, ask-b] }
`)
    const result = await runWithConsent(sandbox, invocation(sandbox, 'codex'), (prompt, index) => {
      expect(prompt.question.hookName).toBe(['ask-a', 'ask-b'][index]!)
      expect(calls()).toHaveLength(index + 1)
      return { action: 'accept', content: { confirmed: true } }
    })
    expect(result.prompts).toHaveLength(2)
    expect(output(result.result)).toEqual(approved('confirm operation'))
  })

  test.each([
    {
      toolName: 'apply_patch',
      input: { command: 'old' },
      patch: '{ command: "new" }',
      expected: { command: 'new' },
    },
    {
      toolName: 'mcp__fixture__inspect',
      input: { keep: null, remove: 1 },
      patch: '{ remove: null, added: false }',
      expected: { keep: null, added: false },
    },
  ])('$toolName consent displays the materialized native replacement', async (row) => {
    install(`return ctx.ask({ reason: 'confirm replacement', updatedInput: ${row.patch} })`)
    const result = await runWithConsent(sandbox, invocation(sandbox, 'codex', row), (prompt) => {
      expect(prompt.question.operation).toEqual({ toolName: row.toolName, input: row.expected })
      return { action: 'accept', content: { confirmed: true } }
    })
    expect(result.prompts).toHaveLength(1)
    expect(output(result.result)).toEqual(approved('confirm replacement', row.expected))
    expect(calls()).toHaveLength(1)
  })

  test('invalid command replacement refuses before any elicitation', async () => {
    install("return ctx.ask({ reason: 'confirm', updatedInput: { cwd: '/wrong' } })")
    const result = await runWithConsent(sandbox, invocation(sandbox, 'codex'), () => {
      throw new Error('Invalid replacement must not prompt')
    })
    const value = output(result.result)
    expect(value.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(value.hookSpecificOutput.permissionDecisionReason).toContain(
      'command-only updates cannot contain additional keys',
    )
    expect(value.hookSpecificOutput.updatedInput).toBeUndefined()
    expect(result.prompts).toHaveLength(0)
    expect(calls()).toHaveLength(1)
  })

  test('default and explicit Claude without registration refuse ask identically', () => {
    install()
    const call = invocation(sandbox, 'claude-code')
    const environments: Record<string, string>[] = [{}, { CLOOKS_AGENT: 'claude-code' }]
    const values = environments.map((env) =>
      output(sandbox.run([], { env, stdin: JSON.stringify(call.payload) })),
    )
    expect(values[0]).toEqual(values[1])
    expect(values[0].hookSpecificOutput.permissionDecision).toBe('deny')
    expect(values[0].hookSpecificOutput.permissionDecisionReason).toMatch(/registration|restart/i)
    expect(values[0].hookSpecificOutput.updatedInput).toBeUndefined()
  })
})
