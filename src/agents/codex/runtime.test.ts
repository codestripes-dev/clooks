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
  test.each([
    {
      tool: 'Edit',
      required: { filePath: '/file', oldString: 'old', newString: 'new' },
      optional: { replaceAll: false },
    },
    { tool: 'Read', required: { filePath: '/file' }, optional: { offset: 0, limit: 10 } },
    { tool: 'Glob', required: { pattern: '*.ts' }, optional: { path: '/project' } },
    {
      tool: 'Grep',
      required: { pattern: 'needle' },
      optional: {
        path: '/project',
        glob: '*.ts',
        outputMode: 'content',
        '-i': false,
        multiline: true,
      },
    },
    {
      tool: 'WebSearch',
      required: { query: 'query' },
      optional: { allowedDomains: ['example.org'], blockedDomains: ['blocked.org'] },
    },
    {
      tool: 'Agent',
      required: { prompt: 'inspect', description: 'review', subagentType: 'worker' },
      optional: { model: 'model' },
    },
  ])(
    '$tool validates each optional public input field without changing its value',
    ({ tool, required, optional }) => {
      const toolInput = { ...required, ...optional }
      const invocation = codexAdapter.normalizeInvocation(
        payload({ tool_name: tool, tool_input: toolInput }),
        'PreToolUse',
      )
      expect(invocation.context.toolName).toBe(tool)
      expect(invocation.context.toolInput).toEqual(toolInput)
      expect(invocation.context.toolInput).not.toBe(toolInput)
      for (const [key, value] of Object.entries(optional)) {
        const invalidValues = Array.isArray(value) ? [false, ['valid.org', 1]] : [null]
        for (const invalid of invalidValues) {
          expect(() =>
            codexAdapter.normalizeInvocation(
              payload({ tool_name: tool, tool_input: { ...toolInput, [key]: invalid } }),
              'PreToolUse',
            ),
          ).toThrow(`${tool}.${key} has an incompatible public input type`)
        }
      }
    },
  )

  test('recognized but unsupported events fail before envelope validation', () => {
    expect(() => codexAdapter.normalizeInvocation({}, 'Notification')).toThrow(
      'runtime handling for this recognized event is unsupported',
    )
  })

  test.each([
    { tool_name: 'Write', tool_input: { filePath: '/file' } },
    { tool_name: 'AskUserQuestion', tool_input: { questions: [] } },
  ])('refuses a tool discriminator without a compatible public shape: %j', (overrides) => {
    expect(() => codexAdapter.normalizeInvocation(payload(overrides), 'PreToolUse')).toThrow(
      `no compatible public input shape for ${overrides.tool_name}`,
    )
  })

  test('context-channel diagnostics preserve the result and order without mutating it', () => {
    const result = { result: 'allow' as const, injectContext: 'author context' }
    expect(
      codexAdapter.composeDiagnostics({
        eventName: 'PreToolUse',
        result,
        traceMessages: ['first', 'second'],
        degradedMessages: ['degraded'],
        debugMessages: ['debug'],
      }),
    ).toEqual({
      result: { result: 'allow', injectContext: 'author context\nfirst\nsecond' },
      stderr: ['[clooks:debug] debug'],
      systemMessages: ['degraded'],
    })
    expect(result).toEqual({ result: 'allow', injectContext: 'author context' })
    expect(
      codexAdapter.composeDiagnostics({
        eventName: 'SessionStart',
        traceMessages: ['trace'],
        degradedMessages: [],
        debugMessages: [],
      }),
    ).toEqual({
      result: { result: 'skip', injectContext: 'trace' },
      stderr: [],
      systemMessages: [],
    })
  })

  test('allow reasons become human annotations without granting a native policy override', () => {
    const invocation = codexAdapter.normalizeInvocation(payload(), 'PreToolUse')
    const checked = checkDetachedResult(
      codexAdapter.createResultPolicy(invocation),
      {
        value: { result: 'allow', reason: 'reviewed', debugMessage: 'checked' },
        origin: 'handler',
        parallel: false,
      },
      'PreToolUse',
    )
    expect(checked.kind).toBe('accepted')
    if (checked.kind !== 'accepted') throw new Error('expected accepted allow')
    expect(checked.result).toEqual({ result: 'allow', debugMessage: 'checked' })
    expect(checked.diagnostics).toEqual([
      'clooks: PreToolUse allow reason (human annotation only; original allow-reason recipient unavailable; native policy retained): reviewed',
    ])
    const translated = codexAdapter.translateFinalOutput({
      eventName: 'PreToolUse',
      invocation,
      result: checked.result,
      diagnostics: checked.diagnostics,
      systemMessages: [],
    })
    expect(translated.exitCode).toBe(0)
    expect(JSON.parse(translated.output!)).not.toHaveProperty(
      'hookSpecificOutput.permissionDecision',
    )
    expect(translated.output).toContain('reviewed')
  })

  test.each([
    { value: 42, origin: 'handler' as const, capability: 'result' },
    { value: { result: 'allow' }, origin: 'before-hook' as const, capability: 'before-hook' },
    {
      value: { result: 'skip', injectContext: false },
      origin: 'handler' as const,
      capability: 'injectContext',
    },
  ])(
    'policy refuses $capability violations at its own boundary',
    ({ value, origin, capability }) => {
      const invocation = codexAdapter.normalizeInvocation(payload(), 'PreToolUse')
      expect(
        codexAdapter.createResultPolicy(invocation).checkResult({
          value,
          origin,
          parallel: false,
          hookName: hn('guard'),
        }),
      ).toMatchObject({
        kind: 'rejected',
        failure: { eventName: 'PreToolUse', hookName: 'guard', capability },
      })
    },
  )

  test('policy accepts omitted optional effects and absent hook results', () => {
    const policy = codexAdapter.createResultPolicy(
      codexAdapter.normalizeInvocation(payload(), 'PreToolUse'),
    )
    for (const value of [null, undefined]) {
      expect(policy.checkResult({ value, origin: 'handler', parallel: false })).toEqual({
        kind: 'accepted',
        diagnostics: [],
      })
    }
    expect(
      policy.checkResult({
        value: { result: 'skip', unsupported: undefined },
        origin: 'handler',
        parallel: false,
      }),
    ).toEqual({
      kind: 'accepted',
      result: { result: 'skip' },
      nextToolInput: undefined,
      diagnostics: [],
    })
  })

  test('rewrite refusal distinguishes parallel execution from a missing codec', () => {
    const invocation = codexAdapter.normalizeInvocation(
      payload({ tool_name: 'Read', tool_input: { filePath: '/file' } }),
      'PreToolUse',
    )
    const policy = codexAdapter.createResultPolicy(invocation)
    for (const parallel of [true, false]) {
      const checked = policy.checkResult({
        value: { result: 'allow', updatedInput: { filePath: '/other' } },
        origin: 'handler',
        parallel,
      })
      expect(checked).toMatchObject({ kind: 'rejected', failure: { capability: 'updatedInput' } })
      if (checked.kind !== 'rejected') throw new Error('expected refused rewrite')
      expect(checked.failure.message).toContain(
        parallel
          ? 'parallel input rewrites are unsupported'
          : 'tool has no approved replacement codec',
      )
    }
  })

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
