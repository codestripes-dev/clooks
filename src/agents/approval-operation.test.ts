import { expect, test } from 'bun:test'
import { claudeCodeAdapter } from './claude-code/adapter.js'
import { codexAdapter } from './codex/adapter.js'

for (const adapter of [claudeCodeAdapter, codexAdapter]) {
  function invocation(input: unknown = { command: 'original' }, tool = 'Bash') {
    return adapter.normalizeInvocation(
      {
        hook_event_name: 'PreToolUse',
        session_id: 'native-session',
        tool_use_id: 'native-call',
        turn_id: 'native-turn',
        agent_id: 'child',
        agent_type: 'worker',
        cwd: '/test',
        model: 'test',
        permission_mode: 'default',
        tool_name: tool,
        tool_input: input,
      },
      'PreToolUse',
    )
  }
  test(`${adapter.id} approval identity uses raw session and native call, never child identity`, () => {
    const raw = invocation().private.raw
    expect(adapter.approvalIdentity(raw, 'project:owner', '1')).toEqual({
      protocol: 1,
      owner: 'project:owner',
      session_id: 'native-session',
      tool_use_id: 'native-call',
      ...(adapter.id === 'codex'
        ? { agent: 'codex' as const, turn_id: 'native-turn' }
        : { agent: 'claude-code' as const }),
    })
    for (const [owner, version] of [
      ['foreign', '1'],
      ['global', '2'],
    ]) {
      expect(() => adapter.approvalIdentity(raw, owner!, version!)).toThrow()
    }
    expect(() =>
      adapter.approvalIdentity({ ...raw, tool_use_id: undefined }, 'global', '1'),
    ).toThrow()
    if (adapter.id === 'codex')
      expect(() =>
        adapter.approvalIdentity({ ...raw, turn_id: undefined }, 'global', '1'),
      ).toThrow()
  })
  for (const input of [null, false, 0, '', 'raw {', [], [null, { snake_key: true }]]) {
    test(`${adapter.id} exact non-record MCP operation ${JSON.stringify(input)}`, () => {
      const normalized = invocation(input, 'mcp__server__tool')
      const operation = { toolName: 'mcp__server__tool', input }
      expect(adapter.approvalOperation(normalized, normalized.context.toolInput, false)).toEqual(
        operation,
      )
      expect(adapter.serializedApprovalOperation(normalized, { exitCode: 0 })).toEqual(operation)
    })
  }
  test(`${adapter.id} candidate and serialized replacement retain actual JSON and opaque keys`, () => {
    const normalized = invocation({ snake_key: 'raw' }, 'mcp__server__tool')
    const candidate = JSON.parse('{"snake_key":{"__proto__":null},"keep":null}')
    const operation = adapter.approvalOperation(normalized, candidate, true)
    const translated = adapter.translateFinalOutput({
      eventName: 'PreToolUse',
      invocation: normalized,
      result: { result: 'allow', updatedInput: candidate },
      systemMessages: [],
      diagnostics: [],
    })
    expect(operation.input).toEqual(candidate)
    expect(adapter.serializedApprovalOperation(normalized, translated)).toEqual(operation)
    candidate.keep = 'changed'
    expect(operation.input).toHaveProperty('keep', null)
  })
  test(`${adapter.id} serialized refusal cannot require another approval`, () => {
    const normalized = invocation()
    for (const output of [
      { hookSpecificOutput: { permissionDecision: 'deny' } },
      { continue: false },
      { decision: 'block' },
    ]) {
      expect(
        adapter.serializedApprovalOperation(normalized, {
          output: JSON.stringify(output),
          exitCode: 0,
        }),
      ).toBeNull()
    }
    expect(adapter.serializedApprovalOperation(normalized, { exitCode: 2 })).toBeNull()
    expect(() =>
      adapter.serializedApprovalOperation(normalized, { exitCode: 0, output: 'invalid' }),
    ).toThrow()
    expect(() =>
      adapter.serializedApprovalOperation(normalized, {
        exitCode: 0,
        output: '{"hookSpecificOutput":{"permissionDecision":"ask"}}',
      }),
    ).toThrow('Unresolved native ask')
  })
}
test('Codex replacement needs an actual codec; unchanged operation does not', () => {
  const invocation = codexAdapter.normalizeInvocation(
    {
      hook_event_name: 'PreToolUse',
      session_id: 's',
      tool_use_id: 'u',
      turn_id: 't',
      cwd: '/test',
      model: 'test',
      permission_mode: 'default',
      tool_name: 'mcp__tool',
      tool_input: null,
    },
    'PreToolUse',
  )
  expect(invocation.private.tool).toBeNull()
  expect(() => codexAdapter.approvalOperation(invocation, {}, true)).toThrow()
  expect(codexAdapter.approvalOperation(invocation, null, false).input).toBeNull()
})
