import { describe, expect, test } from 'bun:test'
import { codexAdapter } from './adapter.js'
import { checkDetachedResult } from '../../engine/result-policy.js'
import { hn } from '../../test-utils.js'
import { InvocationPolicyError, type ResultOrigin } from '../types.js'

const payload = {
  hook_event_name: 'SessionEnd',
  session_id: 'session',
  cwd: '/project',
  transcript_path: null,
  reason: 'other',
}
const normalize = (raw = payload) => codexAdapter.normalizeInvocation(raw, 'SessionEnd')
function check(value: unknown, origin: ResultOrigin = 'handler') {
  return checkDetachedResult(
    codexAdapter.createResultPolicy(normalize()),
    {
      value,
      origin,
      parallel: false,
      hookName: hn('observer'),
    },
    'SessionEnd',
  )
}

describe('Codex SessionEnd', () => {
  test('recognizes minimal source-shaped payload without turn or permission metadata', () => {
    expect(codexAdapter.readEventName(payload)).toBe('SessionEnd')
    const invocation = normalize()
    expect(invocation.context).toEqual({
      event: 'SessionEnd',
      sessionId: 'session',
      cwd: '/project',
      transcriptPath: '',
      reason: 'other',
    })
    expect(invocation.private.nativeTurnId).toBeNull()
    expect(codexAdapter.resolveTurnPolicy!(invocation)).toBeNull()
  })

  test('spoofed irrelevant fields stay private and cannot activate history', () => {
    const invocation = codexAdapter.normalizeInvocation(
      {
        ...payload,
        turn_id: 'spoof',
        model: false,
        permission_mode: null,
        agent_id: 'spoof',
      },
      'SessionEnd',
    )
    expect(invocation.context).toEqual(normalize().context)
    expect(invocation.private.nativeTurnId).toBeNull()
    expect(invocation.private.referencedAgentId).toBeNull()
    invocation.private.nativeTurnId = 'spoof-again'
    expect(codexAdapter.resolveTurnPolicy!(invocation)).toBeNull()
  })

  test.each(['session_id', 'cwd', 'reason'])('rejects missing or invalid %s', (key) => {
    for (const value of [undefined, null, '', false, 3]) {
      expect(() =>
        codexAdapter.normalizeInvocation({ ...payload, [key]: value }, 'SessionEnd'),
      ).toThrow(InvocationPolicyError)
    }
  })
  test.each(['exit', 'clear', 'logout', 'OTHER'])('rejects unsupported reason %s', (reason) => {
    expect(() => normalize({ ...payload, reason })).toThrow(InvocationPolicyError)
  })
  test.each([undefined, null, '', '/transcript'])('preserves nullable transcript %j', (value) => {
    expect(
      codexAdapter.normalizeInvocation({ ...payload, transcript_path: value }, 'SessionEnd').context
        .transcriptPath,
    ).toBe(value ?? '')
  })
  test('rejects incompatible transcript', () => {
    expect(() =>
      codexAdapter.normalizeInvocation({ ...payload, transcript_path: false }, 'SessionEnd'),
    ).toThrow(InvocationPolicyError)
  })

  test.each([undefined, null, { result: 'skip' }, { result: 'skip', debugMessage: 'observed' }])(
    'accepts observer result %j without stdout',
    (value) => {
      const result = check(value)
      expect(result.kind).toBe('accepted')
      if (result.kind !== 'accepted') throw new Error('expected accepted result')
      expect(
        codexAdapter.translateFinalOutput({
          eventName: 'SessionEnd',
          result: result.result,
          diagnostics: [],
          systemMessages: [],
        }),
      ).toEqual({ exitCode: 0, stderr: undefined })
    },
  )
  test.each([
    { result: 'allow' },
    { result: 'block', reason: 'deny' },
    { result: 'ask', reason: 'ask' },
    { result: 'skip', injectContext: 'context' },
    { result: 'skip', updatedInput: {} },
    { result: 'skip', continue: false },
    { result: 'skip', interrupt: true },
  ])('rejects controls %j from handler and beforeHook policy', (value) => {
    for (const origin of ['handler', 'before-hook'] as const) {
      expect(check(value, origin).kind).toBe('rejected')
    }
  })
  test.each(['engine-error', 'load-error', 'parallel-contract'] as const)(
    '%s fails locally without closure veto',
    (origin) => {
      const result = check({ result: 'block', reason: 'crashed' }, origin)
      expect(result.kind).toBe('rejected')
      if (result.kind !== 'rejected') throw new Error('expected rejection')
      const translated = codexAdapter.translateFailure({
        eventName: 'SessionEnd',
        failure: result.failure,
      })
      expect(translated.exitCode).toBe(2)
      expect(translated.output).toBeUndefined()
      expect(translated.stderr).toContain('Local hook failure only; no session closure veto')
    },
  )
  test('diagnostics and system messages stay local stderr, not native controls', () => {
    const composed = codexAdapter.composeDiagnostics({
      eventName: 'SessionEnd',
      traceMessages: ['trace'],
      degradedMessages: ['degraded'],
      debugMessages: ['debug'],
    })
    expect(composed.stderr).toEqual(['[clooks:debug] debug'])
    expect(codexAdapter.routeSystemMessage('SessionEnd', 'message')).toBe('stderr')
    expect(
      codexAdapter.translateFinalOutput({
        eventName: 'SessionEnd',
        ...composed,
        diagnostics: ['diagnostic'],
      }),
    ).toEqual({ exitCode: 0, stderr: 'degraded\ntrace\ndiagnostic' })
  })
})
