import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createSandbox, formatDiagnostics, type Sandbox } from './helpers/sandbox'
import { invocation, runWithConsent } from './helpers/live-approvals'

// Compiled source-shaped replay; native update_plan effects have a separate native probe.
let sandbox: Sandbox
afterEach(() => sandbox?.cleanup())
const original = JSON.parse(
  '{"keep_null":null,"delete_key":1,"snake_key":{"old_key":true},"__proto__":{"untouched_key":false},"constructor":"data"}',
)
const first = JSON.parse(
  '{"keep_null":null,"snake_key":{"new_key":[false]},"__proto__":{"untouched_key":false},"constructor":"data"}',
)
const final = { ...first, added_key: 0 }

function env() {
  return { CLOOKS_AGENT: 'codex', CODEX_HOME: join(sandbox.home, '.codex') }
}
function hook(name: string, body: string) {
  sandbox.writeHook(
    `${name}.ts`,
    `
import { appendFileSync, readFileSync } from 'node:fs'
function handle(ctx) {
  appendFileSync(${JSON.stringify(join(sandbox.dir, 'observed.jsonl'))}, JSON.stringify({
    hook: ${JSON.stringify(name)}, event: ctx.event, name: ctx.toolName,
    input: ctx.toolInput, original: ctx.originalToolInput
  }) + '\\n')
  ${body}
}
export const hook = { meta: { name: '${name}' }, PreToolUse: handle, PermissionRequest: handle, PostToolUse: handle }
`,
  )
}
function install(bodies: string[], parallel = false, handoff = false) {
  sandbox = createSandbox()
  const names = bodies.map((body, i) => {
    const name = `local-rewrite-${i}`
    hook(name, body)
    return name
  })
  sandbox.writeConfig(`version: "1.0.0"
${names.map((name) => `${name}: { parallel: ${parallel}, handoff: ${handoff}, maxFailures: 0 }`).join('\n')}
PreToolUse:
  order: ${JSON.stringify(names)}
PermissionRequest:
  order: ${JSON.stringify(names)}
PostToolUse:
  order: ${JSON.stringify(names)}
`)
}
function replay(name = 'update_plan', input: unknown = original, event = 'PreToolUse') {
  sandbox.writeFile('observed.jsonl', '')
  const result = sandbox.run([], {
    env: env(),
    timeout: 10_000,
    stdin: JSON.stringify({
      hook_event_name: event,
      session_id: 's',
      turn_id: 't',
      cwd: sandbox.dir,
      model: 'm',
      permission_mode: 'default',
      tool_use_id: 'call',
      tool_name: name,
      tool_input: input,
      tool_response: null,
    }),
  })
  expect(result.exitCode, formatDiagnostics(result)).toBe(0)
  expect(result.stderr, formatDiagnostics(result)).toBe('')
  return result.stdout ? JSON.parse(result.stdout) : {}
}
function seen() {
  return sandbox
    .readFile('observed.jsonl')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}
function noEffects(output: ReturnType<typeof replay>) {
  expect(output.hookSpecificOutput?.updatedInput).toBeUndefined()
  expect(output.hookSpecificOutput?.additionalContext).toBeUndefined()
  expect(JSON.stringify(output)).not.toContain('FORBIDDEN_CONTEXT')
  expect(sandbox.homeFileExists('.clooks/approvals/codex.sqlite')).toBe(false)
  for (const root of [sandbox.home, sandbox.dir]) {
    const dir = join(root, '.clooks/tmp')
    expect(
      existsSync(dir) ? readdirSync(dir).filter((name) => name.startsWith('handoff-')) : [],
    ).toEqual([])
  }
}

describe('compiled generic Codex local object rewrites', () => {
  for (const name of ['update_plan', 'localtools.inspect', 'spawn_agent', 'localtools.Read']) {
    test(`${name} sequential patches emit full replacement with exact opaque keys`, () => {
      install([
        'return ctx.allow({ updatedInput: { delete_key: null, keep_null: undefined, snake_key: { new_key: [false] } } })',
        'return ctx.allow({ updatedInput: { added_key: 0 } })',
        'return ctx.skip()',
      ])
      expect(replay(name)).toEqual({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          updatedInput: final,
        },
      })
      expect(seen().map((row) => row.input)).toEqual([original, first, final])
      expect(seen().map((row) => row.original)).toEqual([original, original, original])
      expect(seen().map((row) => row.name)).toEqual([name, name, name])
    })
    for (const patchVote of ['allow', 'ask']) {
      test(`${name} ${patchVote} rewrite presents each actual replacement for live approval`, async () => {
        install([
          `const patch = JSON.parse(readFileSync(${JSON.stringify('candidate.json')}, 'utf8'))
           return ctx.${patchVote}({ ${patchVote === 'ask' ? "reason: 'confirm local'," : ''} updatedInput: patch })`,
          patchVote === 'ask' ? 'return ctx.skip()' : "return ctx.ask({ reason: 'confirm local' })",
        ])
        const expected = { ...original, added_key: 0 }
        delete expected.delete_key
        for (const added_key of [0, 1]) {
          sandbox.writeFile('observed.jsonl', '')
          sandbox.writeFile('candidate.json', JSON.stringify({ delete_key: null, added_key }))
          const live = await runWithConsent(
            sandbox,
            invocation(sandbox, 'codex', {
              toolName: name,
              input: original,
            }),
            (prompt) => {
              expect(prompt.question.operation).toEqual({
                toolName: name,
                input: { ...expected, added_key },
              })
              return { action: 'accept', content: { decision: 'Approve' } }
            },
          )
          expect(live.result.rawExitCode, formatDiagnostics(live.result)).toBe(0)
          expect(live.result.stderr).toBe('')
          expect(live.prompts).toHaveLength(1)
          expect(JSON.parse(live.result.stdout).hookSpecificOutput).toMatchObject({
            hookEventName: 'PreToolUse',
            permissionDecision: 'allow',
            updatedInput: { ...expected, added_key },
          })
          expect(seen().map((row) => row.original)).toEqual([original, original])
          expect(seen()[1].input).toEqual({ ...expected, added_key })
        }
      })
    }
  }
  const malformed = [
    { name: 'update_plan', input: original, patch: '{ nested_key: { invalid: undefined } }' },
    { name: 'update_plan', input: original, patch: '[]' },
    { name: 'Read', input: { filePath: '/a', offset: 0 }, patch: '{ filePath: null }' },
    { name: 'Read', input: { filePath: '/a', offset: 0 }, patch: '{ offset: "wrong" }' },
    { name: 'Write', input: { filePath: '/a', content: 'text' }, patch: '{ content: false }' },
    { name: 'WebSearch', input: { query: 'a' }, patch: '{ allowedDomains: [false] }' },
    { name: 'write_stdin', input: { session_id: 1 }, patch: '{}' },
  ]
  for (const row of malformed) {
    for (const result of ['allow', 'ask']) {
      test(`${row.name} ${result} refuses ${row.patch} before later hooks or effects`, () => {
        install(['return ctx.skip()', 'return ctx.skip()'], false, true)
        // Positive control establishes that the later hook is scheduled.
        expect(replay(row.name, row.input)).toEqual({})
        expect(seen()).toHaveLength(2)
        hook(
          'local-rewrite-0',
          `return { result: '${result}', reason: 'confirm local', updatedInput: ${row.patch}, injectContext: 'FORBIDDEN_CONTEXT'.repeat(100) }`,
        )
        const output = replay(row.name, row.input)
        expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
        expect(output.hookSpecificOutput.permissionDecisionReason).toContain(
          'result effects refused',
        )
        expect(seen()).toHaveLength(1)
        expect(seen()[0].input).toEqual(row.input)
        noEffects(output)
      })
    }
  }
  test('parallel local patch is refused without replacement or approval issuance', () => {
    install(["return ctx.ask({ reason: 'confirm local', updatedInput: {} })"], true)
    const output = replay()
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(output.hookSpecificOutput.permissionDecisionReason).toContain(
      'parallel input rewrites are unsupported',
    )
    noEffects(output)
  })
  for (const event of ['PermissionRequest', 'PostToolUse']) {
    test(`${event} remains non-mutating and stops later hooks`, () => {
      install([
        `return { result: '${event === 'PostToolUse' ? 'skip' : 'allow'}', updatedInput: {} }`,
        'return ctx.skip()',
      ])
      const output = replay('update_plan', original, event)
      expect(output.systemMessage).toContain('updatedInput')
      if (event === 'PermissionRequest')
        expect(output.hookSpecificOutput.decision.behavior).toBe('deny')
      else expect(output.decision).toBe('block')
      expect(seen()).toHaveLength(1)
      noEffects(output)
    })
  }
  test('local non-record inputs remain refused before handlers run', () => {
    install(['return ctx.skip()'])
    for (const input of [null, false, 1, 'raw', []]) {
      const output = replay('update_plan', input)
      expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
      expect(seen()).toEqual([])
      noEffects(output)
    }
  })
})
