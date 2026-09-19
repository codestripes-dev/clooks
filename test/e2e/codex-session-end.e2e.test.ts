import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'path'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { createRegistrationSandbox, registrationEnv } from './helpers/registration'
import type { Sandbox } from './helpers/sandbox'

let sandbox: Sandbox
afterEach(() => sandbox?.cleanup())
const failurePath = '.clooks/.cache/agents/codex/failures.json'

function install(body = 'return ctx.skip()', settings = '{}', lifecycle = '') {
  sandbox = createRegistrationSandbox()
  expect(sandbox.run(['init', '--agent', 'codex']).exitCode).toBe(0)
  sandbox.writeConfig(`version: "1.0.0"\nend-observer: ${settings}\n`)
  sandbox.writeHook(
    'end-observer.ts',
    `
import { writeFileSync } from 'fs'
export const hook = {
  meta: { name: 'end-observer' },
  SessionEnd(ctx) {
    writeFileSync(${JSON.stringify(join(sandbox.dir, 'observed.json'))}, JSON.stringify({
      event: ctx.event, agent: ctx.agent, reason: ctx.reason,
      transcriptPath: ctx.transcriptPath, turn: ctx.turn,
      extra: ['model', 'permissionMode', 'turnId', 'nativeTurnId'].filter(key => Object.hasOwn(ctx, key)),
    }));
    ${body}
  },
  ${lifecycle}
}
`,
  )
}

// Synthetic source-shaped input through the actual registered compiled launcher, not native Codex.
function invoke(overrides: Record<string, unknown> = {}) {
  const entry = JSON.parse(sandbox.readFile('.codex/hooks.json')).hooks.SessionEnd[0].hooks[0]
  expect(entry.timeout).toBe(3)
  return Bun.spawnSync(['bash', '-c', entry.command], {
    cwd: sandbox.dir,
    env: registrationEnv(sandbox),
    stdin: Buffer.from(
      JSON.stringify({
        hook_event_name: 'SessionEnd',
        session_id: 'end-session',
        cwd: sandbox.dir,
        transcript_path: null,
        reason: 'other',
        ...overrides,
      }),
    ),
    timeout: 10_000,
  })
}

function count() {
  return sandbox.fileExists(failurePath)
    ? (JSON.parse(sandbox.readFile(failurePath))['end-observer']?.SessionEnd?.consecutiveFailures ??
        0)
    : 0
}

describe('Codex SessionEnd registered compiled smoke', () => {
  test.each([false, true])('minimal envelope preserves real home history (seeded=%s)', (seeded) => {
    install()
    const hash = createHash('sha256').update('end-session').digest('hex').slice(0, 16)
    const statePath = `.clooks/turn-state/codex/${hash}.json`
    const stateDirectory = join(sandbox.home, '.clooks/turn-state/codex')
    const bytes =
      JSON.stringify({
        version: 1,
        epoch: 'fixture-epoch',
        generation: 1,
        updatedAt: '2020-01-01T00:00:00.000Z',
        scopes: {
          main: {
            'end-observer': [{ event: 'Stop', decision: 'block', at: '2020-01-01T00:00:00.000Z' }],
          },
        },
      }) + '\n'
    if (seeded) sandbox.writeHomeFile(statePath, bytes)
    else expect(existsSync(join(sandbox.home, '.clooks/turn-state'))).toBe(false)
    const entries = seeded ? readdirSync(stateDirectory).sort() : []
    const result = invoke({ turn_id: 'spoofed', model: false, permission_mode: false })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.toString()).toBe('')
    expect(result.stderr.toString()).toBe('')
    const observed = JSON.parse(sandbox.readFile('observed.json'))
    expect(observed).toMatchObject({
      event: 'SessionEnd',
      agent: 'codex',
      reason: 'other',
      transcriptPath: '',
      extra: [],
    })
    expect(observed.turn).toEqual({ prior: [], priorRuns: 0, priorInterventions: 0 })
    if (seeded) {
      expect(sandbox.readHomeFile(statePath)).toBe(bytes)
      expect(readdirSync(stateDirectory).sort()).toEqual(entries)
    } else expect(existsSync(join(sandbox.home, '.clooks/turn-state'))).toBe(false)
  })

  test.each([
    { session_id: undefined },
    { cwd: undefined },
    { reason: undefined },
    { reason: 'logout' },
    { transcript_path: false },
  ])('invalid envelope %j fails locally before handler execution', (overrides) => {
    install()
    const result = invoke(overrides)
    expect(result.exitCode).toBe(2)
    expect(result.stdout.toString()).toBe('')
    expect(result.stderr.toString()).toContain('no session closure veto')
    expect(sandbox.fileExists('observed.json')).toBe(false)
  })

  test.each([
    "return { result: 'allow' }",
    "return { result: 'block', reason: 'deny' }",
    "return { result: 'ask', reason: 'ask' }",
    "return { result: 'skip', injectContext: 'context' }",
    "return { result: 'skip', updatedInput: {} }",
  ])('unsupported observer result fails locally: %s', (body) => {
    install(body)
    const result = invoke()
    expect(result.exitCode).toBe(2)
    expect(result.stdout.toString()).toBe('')
    expect(result.stderr.toString()).toContain('no session closure veto')
  })

  test('beforeHook block is a local policy failure and never runs the observer', () => {
    install(
      'return ctx.skip()',
      '{}',
      "beforeHook(event) { return event.block({ reason: 'deny' }) }",
    )
    const result = invoke()
    expect(result.exitCode).toBe(2)
    expect(result.stdout.toString()).toBe('')
    expect(result.stderr.toString()).toContain('no session closure veto')
    expect(sandbox.fileExists('observed.json')).toBe(false)
  })

  test.each(['continue', 'trace'])(
    'onError %s retains local diagnostics without failure count',
    (mode) => {
      install("throw new Error('closure observer crash')", `{ onError: ${mode}, maxFailures: 1 }`)
      const result = invoke()
      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString()).toBe('')
      expect(result.stderr.toString()).toContain('closure observer crash')
      expect(count()).toBe(0)
    },
  )

  test('blocking error accounting degrades locally and repair clears the count', () => {
    install(
      "throw new Error('closure observer crash')",
      '{ maxFailures: 2, maxFailuresMessage: "observer degraded" }',
    )
    expect(invoke().exitCode).toBe(2)
    expect(count()).toBe(1)
    const degraded = invoke()
    expect(degraded.exitCode).toBe(0)
    expect(degraded.stdout.toString()).toBe('')
    expect(degraded.stderr.toString()).toContain('observer degraded')
    expect(count()).toBe(2)
    sandbox.writeHook(
      'end-observer.ts',
      "export const hook = { meta: { name: 'end-observer' }, SessionEnd(ctx) { return ctx.skip() } }",
    )
    expect(invoke().exitCode).toBe(0)
    expect(count()).toBe(0)
  })

  test.each([false, true])(
    'upgrades ten events with old SessionEnd=%s, then repeats and uninstalls cleanly',
    (oldEnd) => {
      install()
      const data = JSON.parse(sandbox.readFile('.codex/hooks.json'))
      const otherEvents = Object.fromEntries(
        Object.entries(data.hooks).filter(([event]) => event !== 'SessionEnd'),
      )
      const unrelated = {
        matcher: '*',
        hooks: [{ type: 'command', command: 'echo unrelated', timeout: 20 }],
      }
      if (oldEnd) {
        delete data.hooks.SessionEnd[0].hooks[0].timeout
        data.hooks.SessionEnd.push(unrelated)
      } else data.hooks.SessionEnd = [unrelated]
      sandbox.writeFile('.codex/hooks.json', JSON.stringify(data))
      expect(sandbox.run(['init', '--agent', 'codex']).exitCode).toBe(0)
      const bytes = sandbox.readFile('.codex/hooks.json')
      const upgraded = JSON.parse(bytes)
      expect(Object.keys(upgraded.hooks)).toHaveLength(12)
      expect(upgraded.hooks.SessionEnd[0]).toEqual(unrelated)
      expect(upgraded.hooks.SessionEnd[1].hooks[0].timeout).toBe(3)
      expect(
        Object.fromEntries(
          Object.entries(upgraded.hooks).filter(([event]) => event !== 'SessionEnd'),
        ),
      ).toEqual(otherEvents)
      expect(sandbox.run(['init', '--agent', 'codex']).exitCode).toBe(0)
      expect(sandbox.readFile('.codex/hooks.json')).toBe(bytes)
      expect(
        sandbox.run(['uninstall', '--project', '--agent', 'codex', '--unhook', '--force']).exitCode,
      ).toBe(0)
      expect(JSON.parse(sandbox.readFile('.codex/hooks.json'))).toEqual({
        hooks: { SessionEnd: [unrelated] },
      })
    },
  )
})
