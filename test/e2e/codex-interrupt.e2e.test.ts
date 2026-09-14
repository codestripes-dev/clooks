import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'path'
import { createRegistrationSandbox, registrationEnv } from './helpers/registration'
import type { Sandbox } from './helpers/sandbox'

let sandbox: Sandbox
afterEach(() => sandbox?.cleanup())
function install(body = 'return ctx.skip()', settings = '{}', lifecycle = '') {
  sandbox = createRegistrationSandbox()
  expect(sandbox.run(['init', '--agent', 'codex']).exitCode).toBe(0)
  sandbox.writeConfig(`version: "1.0.0"\ninterrupt-observer: ${settings}\nInterrupt: {}\n`)
  sandbox.writeHook(
    'interrupt-observer.ts',
    `
import { writeFileSync } from 'fs'
export const hook = {
  meta: { name: 'interrupt-observer' },
  Interrupt(ctx) {
    writeFileSync(${JSON.stringify(join(sandbox.dir, 'observed.json'))}, JSON.stringify({
      event: ctx.event, provider: ctx.provider, model: ctx.model,
      permissionMode: ctx.permissionMode, transcriptPath: ctx.transcriptPath, turn: ctx.turn,
    }));
    ${body}
  },
  ${lifecycle}
}`,
  )
}

// Source-shaped replay through the compiled registered launcher, not a native interruption.
function invoke(extra: Record<string, unknown> = {}) {
  const entry = JSON.parse(sandbox.readFile('.codex/hooks.json')).hooks.Interrupt[0].hooks[0]
  expect(entry.timeout).toBe(3)
  return Bun.spawnSync(['bash', '-c', entry.command], {
    cwd: sandbox.dir,
    env: registrationEnv(sandbox),
    timeout: 10_000,
    stdin: Buffer.from(
      JSON.stringify({
        hook_event_name: 'Interrupt',
        session_id: 'session',
        turn_id: 'turn',
        model: 'gpt-5',
        permission_mode: 'default',
        cwd: sandbox.dir,
        transcript_path: null,
        ...extra,
      }),
    ),
  })
}
function diagnostic(result: ReturnType<typeof invoke>, message: string) {
  expect(result.exitCode).toBe(0)
  const output = JSON.parse(result.stdout.toString())
  expect(Object.keys(output)).toEqual(['systemMessage'])
  expect(output.systemMessage).toContain(message)
}

describe('Codex Interrupt compiled registration replay', () => {
  test('dispatches typed observer and keeps history in the same root turn', () => {
    install()
    expect(invoke().stdout.toString()).toBe('')
    expect(invoke().exitCode).toBe(0)
    expect(JSON.parse(sandbox.readFile('observed.json'))).toMatchObject({
      event: 'Interrupt',
      provider: 'codex',
      model: 'gpt-5',
      permissionMode: 'default',
      transcriptPath: '',
      turn: { priorRuns: 1, priorInterventions: 0 },
    })
  })
  test.each(['session_id', 'turn_id', 'cwd', 'model', 'permission_mode', 'transcript_path'])(
    'malformed %s never executes the observer',
    (key) => {
      install()
      diagnostic(invoke({ [key]: false }), 'no cancellation veto')
      expect(sandbox.fileExists('observed.json')).toBe(false)
    },
  )
  test.each([
    "return { result: 'allow' }",
    "return { result: 'block', reason: 'deny' }",
    "return { result: 'skip', injectContext: 'context' }",
    "return { result: 'skip', continue: false }",
  ])('invalid observer result emits only systemMessage: %s', (body) => {
    install(body)
    diagnostic(invoke(), 'no cancellation veto')
  })
  test('beforeHook veto is refused without executing the handler', () => {
    install(
      'return ctx.skip()',
      '{}',
      "beforeHook(event) { return event.block({ reason: 'deny' }) }",
    )
    diagnostic(invoke(), 'no cancellation veto')
    expect(sandbox.fileExists('observed.json')).toBe(false)
  })
  test.each(['block', 'continue', 'trace'])(
    'onError %s never emits a cancellation decision',
    (mode) => {
      install("throw new Error('observer crash')", `{ onError: ${mode} }`)
      diagnostic(invoke(), 'observer crash')
    },
  )
  test('repeated init is byte-idempotent and unhook preserves unrelated Interrupt entries', () => {
    install()
    const data = JSON.parse(sandbox.readFile('.codex/hooks.json'))
    const unrelated = { matcher: '*', hooks: [{ type: 'command', command: 'echo retained' }] }
    delete data.hooks.Interrupt[0].hooks[0].timeout
    data.hooks.Interrupt.push(unrelated)
    sandbox.writeFile('.codex/hooks.json', JSON.stringify(data))
    expect(sandbox.run(['init', '--agent', 'codex']).exitCode).toBe(0)
    const bytes = sandbox.readFile('.codex/hooks.json')
    expect(JSON.parse(bytes).hooks.Interrupt[1].hooks[0].timeout).toBe(3)
    expect(sandbox.run(['init', '--agent', 'codex']).exitCode).toBe(0)
    expect(sandbox.readFile('.codex/hooks.json')).toBe(bytes)
    expect(
      sandbox.run(['uninstall', '--project', '--agent', 'codex', '--unhook', '--force']).exitCode,
    ).toBe(0)
    expect(JSON.parse(sandbox.readFile('.codex/hooks.json'))).toEqual({
      hooks: { Interrupt: [unrelated] },
    })
  })
})
