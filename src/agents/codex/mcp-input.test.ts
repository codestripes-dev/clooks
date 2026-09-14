import { describe, expect, test } from 'bun:test'
import { codexAdapter } from './adapter.js'
import { canonicalHash, prepareApprovalAttempt } from './approvals.js'
import { jsonInput, toolCodec } from './tool-codecs.js'

const values = [null, false, true, 0, 42, '', ' {not valid JSON ', [], [null, { snake_key: false }]]
function wire(tool_input: unknown, tool_name = 'mcp__fixture__inspect') {
  return {
    hook_event_name: 'PreToolUse',
    session_id: 's',
    turn_id: 't',
    cwd: '/project',
    model: 'm',
    permission_mode: 'default',
    tool_use_id: 'call',
    tool_name,
    tool_input,
    tool_response: null,
  }
}

describe('MCP JSON observation and record-only patches', () => {
  for (const value of values) {
    test(`preserves ${JSON.stringify(value)} through preparation and normalization`, () => {
      const attempt = prepareApprovalAttempt(wire(value))
      expect(attempt.originalInput).toEqual(value)
      expect(attempt.nativeInput).toEqual(value)
      expect(attempt.presentedTokens).toEqual([])
      expect(canonicalHash(attempt.originalInput)).toBe(canonicalHash(value))
      expect(attempt.baseInvocationHash).not.toBe(
        prepareApprovalAttempt(wire({})).baseInvocationHash,
      )
      for (const event of ['PreToolUse', 'PostToolUse', 'PermissionRequest'] as const) {
        const invocation = codexAdapter.normalizeInvocation(
          { ...attempt.payload, hook_event_name: event },
          event,
        )
        expect(invocation.context.toolInput).toEqual(value)
        expect(invocation.private.tool).toBeNull()
        const policy = codexAdapter.createResultPolicy(invocation)
        for (const result of [{ result: 'skip' }, { result: 'block', reason: 'inspected' }]) {
          expect(
            policy.checkResult({
              value: result,
              origin: 'handler',
              parallel: false,
              currentToolInput: value,
            }).kind,
          ).toBe('accepted')
        }
        if (event === 'PreToolUse') {
          expect(
            policy.checkResult({
              value: { result: 'allow', updatedInput: {} },
              origin: 'handler',
              parallel: false,
              currentToolInput: value,
            }).kind,
          ).toBe('rejected')
        }
      }
      expect(() => toolCodec('mcp__fixture__inspect')!.applyPatch(value, {})).toThrow()
      expect(() => prepareApprovalAttempt(wire(value, 'exec_command'))).toThrow()
    })
  }

  test('detaches opaque nested arrays without changing key spelling', () => {
    const input = [null, { snake_key: [false] }]
    const attempt = prepareApprovalAttempt(wire(input))
    const invocation = codexAdapter.normalizeInvocation(attempt.payload, 'PreToolUse')
    ;(input[1] as { snake_key: boolean[] }).snake_key.push(true)
    expect(attempt.nativeInput).toEqual([null, { snake_key: [false] }])
    expect(invocation.context.toolInput).toEqual([null, { snake_key: [false] }])
    expect(invocation.context.toolInput).not.toBe(attempt.originalInput)
  })

  test('rejects non-JSON values and never interprets an MCP string as shell transport', () => {
    for (const value of [
      undefined,
      NaN,
      Infinity,
      { missing: undefined },
      new Date(),
      new Array(2),
    ]) {
      expect(() => jsonInput(value)).toThrow()
      expect(() => prepareApprovalAttempt(wire(value))).toThrow()
      expect(() => codexAdapter.normalizeInvocation(wire(value), 'PostToolUse')).toThrow()
    }
    const input = `CLOOKS_APPROVAL_TOKENS=ca1_${'a'.repeat(64)} /usr/bin/true`
    const attempt = prepareApprovalAttempt(wire(input))
    expect(attempt.originalInput).toBe(input)
    expect(attempt.presentedTokens).toEqual([])
  })
})
