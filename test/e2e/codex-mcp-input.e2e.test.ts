import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { createSandbox, formatDiagnostics, type Sandbox } from './helpers/sandbox'

// Compiled CLI replay of source-shaped MCP envelopes, not native server delivery.
let sandbox: Sandbox
afterEach(() => sandbox?.cleanup())
const values = [null, false, true, 0, 42, '', ' {not valid JSON ', [], [null, { snake_key: false }]]
function env() {
  return { CLOOKS_AGENT: 'codex', CODEX_HOME: join(sandbox.home, '.codex') }
}
function install(body: string, parallel = false) {
  sandbox = createSandbox()
  sandbox.writeConfig(`version: "1.0.0"\nmcp-observe: { parallel: ${parallel} }\n`)
  sandbox.writeHook(
    'mcp-observe.ts',
    `
import { appendFileSync } from 'node:fs'
function observe(ctx) {
  appendFileSync(${JSON.stringify(join(sandbox.dir, 'observed.jsonl'))}, JSON.stringify({
    event: ctx.event, input: ctx.toolInput, original: ctx.originalToolInput
  }) + '\\n')
  ${body}
}
export const hook = { meta: { name: 'mcp-observe' }, PreToolUse: observe, PostToolUse: observe }
`,
  )
}
function replay(input: unknown, event = 'PreToolUse', extra: Record<string, string> = {}) {
  const result = sandbox.run([], {
    env: { ...env(), ...extra },
    timeout: 10_000,
    stdin: JSON.stringify({
      hook_event_name: event,
      session_id: 's',
      turn_id: 't',
      cwd: sandbox.dir,
      model: 'm',
      permission_mode: 'default',
      tool_use_id: 'call',
      tool_name: 'mcp__fixture__inspect',
      tool_input: input,
      tool_response: null,
    }),
  })
  expect(result.exitCode, formatDiagnostics(result)).toBe(0)
  expect(result.stderr, formatDiagnostics(result)).toBe('')
  return result.stdout ? JSON.parse(result.stdout) : {}
}
function observations() {
  return sandbox
    .readFile('observed.jsonl')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
}
function token(output: ReturnType<typeof replay>): string {
  expect(output.hookSpecificOutput?.permissionDecision).toBe('deny')
  const found = /ca1_[a-f0-9]{64}/.exec(output.hookSpecificOutput.permissionDecisionReason)?.[0]
  expect(found).toBeDefined()
  return found!
}

describe('compiled MCP JSON input observation', () => {
  for (const parallel of [false, true]) {
    test(`pre/post skip preserves all shapes, parallel=${parallel}`, () => {
      install('return ctx.skip()', parallel)
      for (const input of values) {
        for (const event of ['PreToolUse', 'PostToolUse']) {
          expect(replay(input, event)).toEqual({})
          const seen = observations().at(-1)
          expect(seen.input).toEqual(input)
          if (event === 'PreToolUse') expect(seen.original).toEqual(input)
        }
      }
    })
  }
  test('pre/post block sees the exact input without a replacement', () => {
    install("return ctx.block({ reason: 'inspected MCP input' })")
    for (const input of values) {
      const pre = replay(input)
      expect(pre.hookSpecificOutput.permissionDecision).toBe('deny')
      expect(pre.hookSpecificOutput.permissionDecisionReason).toBe('inspected MCP input')
      expect(pre.hookSpecificOutput.updatedInput).toBeUndefined()
      const post = replay(input, 'PostToolUse')
      expect(post.decision).toBe('block')
      expect(post.reason).toBe('inspected MCP input')
      expect(observations().at(-1).input).toEqual(input)
    }
  })
  test('non-record patches fail closed; records retain materialized partial patches', () => {
    install('return ctx.allow({ updatedInput: { delete_key: null, added_key: [false] } })')
    for (const input of values) {
      const output = replay(input)
      expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
      expect(output.hookSpecificOutput.permissionDecisionReason).toContain(
        'no approved replacement codec',
      )
      expect(output.hookSpecificOutput.updatedInput).toBeUndefined()
    }
    const output = replay({ keep_null: null, delete_key: 1, snake_key: { untouched_key: true } })
    expect(output.hookSpecificOutput.updatedInput).toEqual({
      keep_null: null,
      snake_key: { untouched_key: true },
      added_key: [false],
    })
  })
  for (const input of values) {
    test(`approval binds exact shape ${JSON.stringify(input)} and preserves falsy votes`, () => {
      install("return ctx.ask({ reason: 'confirm MCP' })")
      const pending = token(replay(input))
      expect(token(replay(input))).toBe(pending)
      const registered = sandbox.run(['approve', pending, '--json'], {
        env: env(),
        timeout: 10_000,
      })
      expect(registered.exitCode, formatDiagnostics(registered)).toBe(0)
      expect(token(replay({}))).not.toBe(pending)
      expect(replay(input)).toEqual({
        systemMessage:
          'clooks: PreToolUse allow reason (human annotation only; original allow-reason recipient unavailable; native policy retained): confirm MCP',
      })
      expect(token(replay(input))).not.toBe(pending)
      expect(observations().every((row) => row.event === 'PreToolUse')).toBe(true)
      expect(observations()[0]).toEqual({ event: 'PreToolUse', input, original: input })
    })
  }
})
