import { describe, expect, test } from 'bun:test'
import { codexAdapter } from './adapter.js'
import { checkDetachedResult } from '../../engine/result-policy.js'
import { hn } from '../../test-utils.js'
import { InvocationPolicyError } from '../types.js'

function payload(overrides: Record<string, unknown> = {}) {
  return {
    hook_event_name: 'PreToolUse',
    session_id: 'session',
    turn_id: 'native-turn',
    cwd: '/project',
    model: 'model',
    permission_mode: 'default',
    transcript_path: null,
    tool_name: 'Bash',
    tool_use_id: 'call',
    tool_input: { command: 'old' },
    ...overrides,
  }
}

describe('Codex PreToolUse runtime policy', () => {
  test('normalization keeps private identity and opaque record data separate', () => {
    const opaqueInput: { opaque_key: { nested_key: string | null }[] } = {
      opaque_key: [{ nested_key: null }],
    }
    const raw = payload({
      tool_name: 'mcp__server__tool',
      tool_input: opaqueInput,
      agent_id: 'child',
      agent_type: 'worker',
    })
    const invocation = codexAdapter.normalizeInvocation(raw, 'PreToolUse')
    expect(invocation.context.toolInput).toEqual({ opaque_key: [{ nested_key: null }] })
    expect(invocation.context.transcriptPath).toBe('')
    expect(invocation.context).not.toHaveProperty('private')
    expect(invocation.context).not.toHaveProperty('turnId')
    expect(invocation.context).not.toHaveProperty('model')
    expect(invocation.private.nativeTurnId).toBe('native-turn')
    expect(codexAdapter.resolveTurnPolicy!(invocation)).toEqual({
      sessionId: 'session',
      scopeKey: 'agent:child',
      boundary: null,
      prune: false,
    })
    opaqueInput.opaque_key[0]!.nested_key = 'changed'
    opaqueInput.opaque_key.push({ nested_key: 'added' })
    expect(invocation.context.toolInput).toEqual({ opaque_key: [{ nested_key: null }] })
    expect(invocation.private.raw.tool_input).toEqual({ opaque_key: [{ nested_key: null }] })
  })

  test.each([undefined, null, '', '/actual/transcript'])(
    'transcript %j maps without inventing a path',
    (value) => {
      const raw: Record<string, unknown> = payload({ transcript_path: value })
      if (value === undefined) delete raw.transcript_path
      const invocation = codexAdapter.normalizeInvocation(raw, 'PreToolUse')
      expect(invocation.context.transcriptPath).toBe(value ?? '')
      expect(Object.hasOwn(invocation.private.raw, 'transcript_path')).toBe(value !== undefined)
    },
  )

  test.each([{ transcript_path: 5 }, { agent_id: 'child' }, { turn_id: '' }, { tool_input: [] }])(
    'rejects an incompatible envelope %j',
    (overrides) => {
      expect(() => codexAdapter.normalizeInvocation(payload(overrides), 'PreToolUse')).toThrow()
    },
  )

  test.each([
    {
      toolName: 'Read',
      valid: { filePath: '/file', offset: 2 },
      invalid: { filePath: '/file', offset: 'bad' },
    },
    {
      toolName: 'WebSearch',
      valid: { query: 'q', allowedDomains: ['example.org'] },
      invalid: { query: 'q', allowedDomains: false },
    },
  ])(
    '$toolName preserves valid optional fields and identifies invalid input capability',
    ({ toolName, valid, invalid }) => {
      const invocation = codexAdapter.normalizeInvocation(
        payload({ tool_name: toolName, tool_input: valid }),
        'PreToolUse',
      )
      expect(invocation.context.toolName).toBe(toolName)
      expect(invocation.context.toolInput).toEqual(valid)
      expect(invocation.context.toolInput).not.toBe(valid)
      let failure: unknown
      try {
        codexAdapter.normalizeInvocation(
          payload({ tool_name: toolName, tool_input: invalid }),
          'PreToolUse',
        )
      } catch (error) {
        failure = error
      }
      expect(failure).toBeInstanceOf(InvocationPolicyError)
      expect((failure as InvocationPolicyError).failure).toMatchObject({
        eventName: 'PreToolUse',
        capability: 'tool_input',
      })
    },
  )

  test('plain allow retains native policy and rewrite allow emits the full candidate', () => {
    const invocation = codexAdapter.normalizeInvocation(payload(), 'PreToolUse')
    const policy = codexAdapter.createResultPolicy(invocation)
    const plain = checkDetachedResult(
      policy,
      {
        value: { result: 'allow' },
        origin: 'handler',
        parallel: false,
      },
      'PreToolUse',
    )
    expect(plain.kind).toBe('accepted')
    if (plain.kind !== 'accepted') return
    expect(
      codexAdapter.translateFinalOutput({
        eventName: 'PreToolUse',
        invocation,
        result: plain.result,
        systemMessages: [],
        diagnostics: [],
      }),
    ).toEqual({ output: undefined, exitCode: 0 })
    const rewritten = checkDetachedResult(
      policy,
      {
        value: { result: 'allow', updatedInput: { command: 'new' } },
        origin: 'handler',
        parallel: false,
        currentToolInput: { command: 'old' },
      },
      'PreToolUse',
    )
    expect(rewritten.kind).toBe('accepted')
    if (rewritten.kind !== 'accepted') return
    expect(rewritten.nextToolInput).toEqual({ command: 'new' })
    const translated = codexAdapter.translateFinalOutput({
      eventName: 'PreToolUse',
      invocation,
      result: rewritten.result,
      systemMessages: [],
      diagnostics: [],
    })
    expect(JSON.parse(translated.output!)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        updatedInput: { command: 'new' },
      },
    })
  })

  test.each([
    { result: 'ask', reason: 'ask' },
    { result: 'defer' },
    { result: 'block', reason: ' ' },
    { result: 'allow', updatedInput: { timeout: null } },
    { result: 'skip', suppressOutput: false },
    { result: 'allow', updatedInput: null },
  ])('refuses unsupported result %j with a pending-call denial request', (value) => {
    const invocation = codexAdapter.normalizeInvocation(payload(), 'PreToolUse')
    const checked = checkDetachedResult(
      codexAdapter.createResultPolicy(invocation),
      {
        value,
        origin: 'handler',
        hookName: hn('guard'),
        parallel: false,
        currentToolInput: { command: 'old' },
      },
      'PreToolUse',
    )
    expect(checked.kind).toBe('rejected')
    if (checked.kind !== 'rejected') return
    const output = codexAdapter.translateFailure({
      eventName: 'PreToolUse',
      invocation,
      failure: checked.failure,
    })
    expect(output.exitCode).toBe(0)
    expect(JSON.parse(output.output!).hookSpecificOutput.permissionDecision).toBe('deny')
    expect(output.output).toContain('Pending call denial requested.')
    expect(output.output).toContain('guard')
  })

  test('lossy arrays are refused before lodash can erase their shape', () => {
    const invocation = codexAdapter.normalizeInvocation(
      payload({ tool_name: 'mcp__server__tool', tool_input: {} }),
      'PreToolUse',
    )
    const sparse = new Array(2)
    sparse[1] = 1
    const extra = Object.assign([1], { opaque_key: true })
    for (const value of [sparse, extra]) {
      const checked = checkDetachedResult(
        codexAdapter.createResultPolicy(invocation),
        {
          value: { result: 'allow', updatedInput: { value } },
          origin: 'handler',
          hookName: hn('shape'),
          parallel: false,
          currentToolInput: {},
        },
        'PreToolUse',
      )
      expect(checked).toMatchObject({
        kind: 'rejected',
        failure: { capability: 'result-shape', hookName: 'shape' },
      })
    }
  })
})
