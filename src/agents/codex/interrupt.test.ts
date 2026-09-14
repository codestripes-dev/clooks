import { describe, expect, test } from 'bun:test'
import { codexAdapter } from './adapter.js'
import { claudeCodeAdapter } from '../claude-code/adapter.js'
import {
  ALL_SUPPORTED_EVENTS,
  CLAUDE_CODE_EVENTS,
  isEventName,
  RESERVED_CONFIG_KEYS,
} from '../../config/constants.js'
import { generateJsonSchema } from '../../config/schema.js'
import { validateConfig } from '../../config/validate.js'
import { checkDetachedResult } from '../../engine/result-policy.js'
import { createContext } from '../../testing/create-context.js'
import { hn } from '../../test-utils.js'
import { InvocationPolicyError, type ResultOrigin } from '../types.js'
import type { InterruptResult } from '../../types/index.js'

const payload = {
  hook_event_name: 'Interrupt',
  session_id: 'session',
  turn_id: 'turn',
  cwd: '/project',
  transcript_path: null,
  model: 'gpt-5',
  permission_mode: 'default',
}
const normalize = (extra: Record<string, unknown> = {}) =>
  codexAdapter.normalizeInvocation({ ...payload, ...extra }, 'Interrupt')
function check(value: unknown, origin: ResultOrigin = 'handler') {
  return checkDetachedResult(
    codexAdapter.createResultPolicy(normalize()),
    {
      value,
      origin,
      parallel: false,
      hookName: hn('observer'),
    },
    'Interrupt',
  )
}

describe('Codex Interrupt', () => {
  test('shared validation accepts event ordering and overrides without making a hook named Interrupt', () => {
    const config = validateConfig({
      version: '1.0.0',
      observer: { events: { Interrupt: { enabled: true, handoff: false } } },
      Interrupt: { order: ['observer'] },
    })
    expect(config.events.Interrupt?.order).toEqual([hn('observer')])
    expect(config.hooks[hn('observer')]?.events?.Interrupt).toEqual({
      enabled: true,
      handoff: false,
    })
    expect(config.hooks[hn('Interrupt')]).toBeUndefined()
    expect(() =>
      validateConfig({ version: '1.0.0', observer: { events: { Interrupt: { handoff: true } } } }),
    ).toThrow('handoff cannot be enabled')
  })
  test('shared catalog and schema include Interrupt but Claude recognition does not', () => {
    expect(ALL_SUPPORTED_EVENTS.has('Interrupt')).toBe(true)
    expect(isEventName('Interrupt')).toBe(true)
    expect(RESERVED_CONFIG_KEYS.has('Interrupt')).toBe(true)
    expect(JSON.stringify(generateJsonSchema())).toContain('"Interrupt"')
    expect(CLAUDE_CODE_EVENTS.has('Interrupt')).toBe(false)
    expect(claudeCodeAdapter.readEventName(payload)).toBeNull()
    expect(codexAdapter.readEventName(payload)).toBe('Interrupt')
  })

  test('preserves required metadata and root history without a new boundary', () => {
    const invocation = normalize({ agent_id: 'spoof', agent_type: false })
    expect(invocation.context).toEqual({
      event: 'Interrupt',
      sessionId: 'session',
      cwd: '/project',
      transcriptPath: '',
      model: 'gpt-5',
      permissionMode: 'default',
    })
    expect(invocation.private.nativeTurnId).toBe('turn')
    expect(invocation.private.referencedAgentId).toBeNull()
    expect(codexAdapter.resolveTurnPolicy!(invocation)).toEqual({
      sessionId: 'session',
      scopeKey: 'main',
      boundary: null,
      prune: false,
    })
    const ctx = createContext('Interrupt', { model: 'gpt-5', permissionMode: 'default' })
    const result: InterruptResult = ctx.skip({ debugMessage: 'observed' })
    expect(result).toEqual({ result: 'skip', debugMessage: 'observed' })
    expect('block' in ctx).toBe(false)
    // @ts-expect-error Interrupt has no decision arm.
    const invalid: InterruptResult = { result: 'block', reason: 'veto' }
    void invalid
  })

  test.each(['session_id', 'turn_id', 'cwd', 'model', 'permission_mode'])(
    'rejects missing or malformed %s',
    (key) => {
      for (const value of [undefined, null, '', false, 3])
        expect(() => normalize({ [key]: value })).toThrow(InvocationPolicyError)
    },
  )
  test('nullable transcript stays normalized; malformed transcript fails', () => {
    for (const value of [undefined, null, '', '/transcript'])
      expect(normalize({ transcript_path: value }).context.transcriptPath).toBe(value ?? '')
    expect(() => normalize({ transcript_path: false })).toThrow(InvocationPolicyError)
  })

  test.each([undefined, null, { result: 'skip' }, { result: 'skip', debugMessage: 'observed' }])(
    'accepts observer result %j without native controls',
    (value) => {
      const result = check(value)
      expect(result.kind).toBe('accepted')
      if (result.kind !== 'accepted') throw new Error('expected acceptance')
      expect(
        codexAdapter.translateFinalOutput({
          eventName: 'Interrupt',
          result: result.result,
          diagnostics: [],
          systemMessages: [],
        }),
      ).toEqual({ exitCode: 0, output: undefined })
    },
  )
  test.each([
    { result: 'allow' },
    { result: 'block', reason: 'veto' },
    { result: 'ask', reason: 'ask' },
    { result: 'skip', injectContext: 'context' },
    { result: 'skip', updatedInput: {} },
    { result: 'skip', continue: false },
    { result: 'skip', interrupt: true },
  ])('rejects unsupported controls %j', (value) => {
    for (const origin of ['handler', 'before-hook'] as const)
      expect(check(value, origin).kind).toBe('rejected')
  })
  test.each(['engine-error', 'load-error', 'parallel-contract'] as const)(
    '%s translates only to a human diagnostic',
    (origin) => {
      const result = check({ result: 'block', reason: 'observer crashed' }, origin)
      if (result.kind !== 'rejected') throw new Error('expected rejection')
      const translated = codexAdapter.translateFailure({
        eventName: 'Interrupt',
        failure: result.failure,
      })
      expect(translated.exitCode).toBe(0)
      expect(translated.stderr).toBeUndefined()
      const output = JSON.parse(translated.output!)
      expect(Object.keys(output)).toEqual(['systemMessage'])
      expect(output.systemMessage).toContain('no cancellation veto')
    },
  )
  test('diagnostics use stdout systemMessage, with debug remaining local', () => {
    const composed = codexAdapter.composeDiagnostics({
      eventName: 'Interrupt',
      traceMessages: ['trace'],
      degradedMessages: ['degraded'],
      debugMessages: ['debug'],
    })
    expect(composed.stderr).toEqual(['[clooks:debug] debug'])
    expect(codexAdapter.routeSystemMessage('Interrupt', 'message')).toBe('stdout-json')
    expect(
      codexAdapter.translateFinalOutput({
        eventName: 'Interrupt',
        ...composed,
        diagnostics: ['diagnostic'],
      }),
    ).toEqual({
      exitCode: 0,
      output: JSON.stringify({ systemMessage: 'degraded\ntrace\ndiagnostic' }),
    })
  })
})
