import { describe, expect, test } from 'bun:test'
import { codexAdapter } from './adapter.js'
import { checkDetachedResult } from '../../engine/result-policy.js'
import { hn } from '../../test-utils.js'
import { InvocationPolicyError } from '../types.js'
import type { ResultOrigin } from '../types.js'
import type { EventName } from '../../types/branded.js'
import { denial, userApprovalFailure } from '../../interaction/protocol.js'

const events = [
  'SessionStart',
  'SubagentStart',
  'PermissionRequest',
  'PostToolUse',
  'PreCompact',
  'PostCompact',
  'UserPromptSubmit',
  'SubagentStop',
  'Stop',
] as const

function payload(
  event: EventName,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const raw: Record<string, unknown> = {
    hook_event_name: event,
    session_id: 'session',
    cwd: '/project',
    model: 'model',
    transcript_path: null,
  }
  if (event !== 'SessionStart') raw.turn_id = 'turn'
  if (event !== 'PreCompact' && event !== 'PostCompact') raw.permission_mode = 'default'
  if (event === 'SessionStart') raw.source = 'startup'
  if (event === 'SubagentStart' || event === 'SubagentStop') {
    raw.agent_id = 'child'
    raw.agent_type = 'worker'
  }
  if (event === 'PermissionRequest' || event === 'PostToolUse') {
    raw.tool_name = 'Bash'
    raw.tool_input = { command: 'echo done', description: 'explain approval' }
    if (event === 'PostToolUse') {
      raw.tool_use_id = 'call'
      raw.tool_response = false
    }
  }
  if (event === 'PreCompact' || event === 'PostCompact') raw.trigger = 'auto'
  if (event === 'UserPromptSubmit') raw.prompt = ''
  if (event === 'Stop' || event === 'SubagentStop') {
    raw.stop_hook_active = false
    raw.last_assistant_message = null
    if (event === 'SubagentStop') raw.agent_transcript_path = null
  }
  return { ...raw, ...overrides }
}

function check(event: EventName, value: unknown, origin: ResultOrigin = 'handler') {
  const invocation = codexAdapter.normalizeInvocation(payload(event), event)
  return checkDetachedResult(
    codexAdapter.createResultPolicy(invocation),
    {
      value,
      origin,
      parallel: false,
      hookName: hn('guard'),
    },
    event,
  )
}

function output(event: EventName, value: unknown) {
  const checked = check(event, value)
  expect(checked.kind).toBe('accepted')
  if (checked.kind !== 'accepted') throw new Error('expected accepted result')
  const translated = codexAdapter.translateFinalOutput({
    eventName: event,
    result: checked.result,
    diagnostics: checked.diagnostics,
    systemMessages: [],
  })
  expect(translated.exitCode).toBe(0)
  expect(translated.stderr).toBeUndefined()
  return translated.output === undefined ? undefined : JSON.parse(translated.output)
}

describe('Codex event envelopes', () => {
  test.each([...events])(
    '%s accepts its producer shape without private metadata exposure',
    (event) => {
      const invocation = codexAdapter.normalizeInvocation(payload(event), event)
      expect(invocation.context.event).toBe(event)
      expect(invocation.context.transcriptPath).toBe('')
      if (event === 'SessionStart') expect(invocation.context.model).toBe('model')
      else expect(invocation.context).not.toHaveProperty('model')
      expect(invocation.context).not.toHaveProperty('turnId')
      expect(invocation.private.nativeTurnId).toBe(event === 'SessionStart' ? null : 'turn')
      expect(output(event, { result: 'skip' })).toBeUndefined()
    },
  )

  for (const event of events) {
    test.each(['session_id', 'cwd', 'model'])(`${event} rejects missing %s`, (key) => {
      const raw = payload(event)
      delete raw[key]
      try {
        codexAdapter.normalizeInvocation(raw, event)
        throw new Error('normalization unexpectedly succeeded')
      } catch (error) {
        expect(error).toBeInstanceOf(InvocationPolicyError)
        expect((error as InvocationPolicyError).failure.capability).toBe(key)
      }
    })
  }

  test('approval description stays nested with no invented tool-use identifier', () => {
    const raw = payload('PermissionRequest')
    const invocation = codexAdapter.normalizeInvocation(raw, 'PermissionRequest')
    expect(invocation.context.toolInput).toEqual(raw.tool_input)
    expect(invocation.context).not.toHaveProperty('toolUseId')
    expect(invocation.context).not.toHaveProperty('description')
    expect(invocation.private.tool).toBeNull()
  })

  test.each(['PermissionRequest', 'PostToolUse'] as const)(
    '%s validates canonical Bash optional fields for exec_command',
    (event) => {
      const valid = {
        command: 'echo done',
        description: 'approval',
        timeout: 100,
        runInBackground: false,
      }
      const invocation = codexAdapter.normalizeInvocation(
        payload(event, {
          tool_name: 'exec_command',
          tool_input: valid,
        }),
        event,
      )
      expect(invocation.context.toolName).toBe('Bash')
      expect(invocation.context.toolInput).toEqual(valid)
      for (const invalid of [{ description: false }, { timeout: 'bad' }, { runInBackground: 1 }]) {
        try {
          codexAdapter.normalizeInvocation(
            payload(event, {
              tool_name: 'exec_command',
              tool_input: { ...valid, ...invalid },
            }),
            event,
          )
          throw new Error('normalization unexpectedly succeeded')
        } catch (error) {
          expect(error).toBeInstanceOf(InvocationPolicyError)
          expect((error as InvocationPolicyError).failure.capability).toBe('tool_input')
        }
      }
    },
  )

  test('PreToolUse exec_command retains its stricter command-only codec', () => {
    const raw = {
      ...payload('PermissionRequest'),
      hook_event_name: 'PreToolUse',
      tool_name: 'exec_command',
      tool_use_id: 'call',
      tool_input: { command: 'echo done' },
    }
    const invocation = codexAdapter.normalizeInvocation(raw, 'PreToolUse')
    expect(invocation.context.toolName).toBe('Bash')
    expect(invocation.context.toolInput).toEqual({ command: 'echo done' })
    for (const timeout of [100, 'bad']) {
      expect(() =>
        codexAdapter.normalizeInvocation(
          {
            ...raw,
            tool_input: { command: 'echo done', timeout },
          },
          'PreToolUse',
        ),
      ).toThrow(InvocationPolicyError)
    }
  })

  test('SessionStart preserves supplied model and rejects incompatible values', () => {
    expect(
      codexAdapter.normalizeInvocation(
        payload('SessionStart', { model: 'actual-model' }),
        'SessionStart',
      ).context.model,
    ).toBe('actual-model')
    for (const model of [null, undefined, false, '']) {
      expect(() =>
        codexAdapter.normalizeInvocation(payload('SessionStart', { model }), 'SessionStart'),
      ).toThrow(InvocationPolicyError)
    }
  })

  test.each([false, null, [null, false, { opaque_key: 1 }]])(
    'post-tool response %j is preserved',
    (response) => {
      const invocation = codexAdapter.normalizeInvocation(
        payload('PostToolUse', { tool_response: response }),
        'PostToolUse',
      )
      expect(invocation.context.toolResponse).toEqual(response)
    },
  )

  test('post-tool nested response and input are detached', () => {
    const response = [{ opaque_key: ['original'] }]
    const input = { command: 'echo done', nested_key: { items: [null as string | null] } }
    const invocation = codexAdapter.normalizeInvocation(
      payload('PostToolUse', {
        tool_input: input,
        tool_response: response,
      }),
      'PostToolUse',
    )
    response[0]!.opaque_key[0] = 'changed'
    input.nested_key.items[0] = 'changed'
    expect(invocation.context.toolResponse).toEqual([{ opaque_key: ['original'] }])
    expect(invocation.context.toolInput).toEqual({
      command: 'echo done',
      nested_key: { items: [null] },
    })
  })

  test.each([
    ['Stop', 'stop_hook_active', undefined],
    ['SubagentStop', 'agent_id', null],
    ['SubagentStart', 'agent_type', undefined],
    ['UserPromptSubmit', 'prompt', null],
    ['SessionStart', 'source', 'invented'],
    ['PreCompact', 'trigger', 'invented'],
    ['PostCompact', 'compact_summary', false],
    ['PostToolUse', 'tool_response', undefined],
    ['PermissionRequest', 'tool_input', { command: 'x', description: false }],
  ] as const)('%s rejects invalid %s', (event, key, value) => {
    expect(() => codexAdapter.normalizeInvocation(payload(event, { [key]: value }), event)).toThrow(
      InvocationPolicyError,
    )
  })
})

describe('Codex event result contracts', () => {
  test.each(['SessionStart', 'SubagentStart', 'PostToolUse', 'UserPromptSubmit'] as const)(
    '%s emits supported context',
    (event) => {
      expect(output(event, { result: 'skip', injectContext: 'context' })).toEqual({
        hookSpecificOutput: { hookEventName: event, additionalContext: 'context' },
      })
    },
  )

  test('approval grant and denial use only the supported nested decision', () => {
    expect(output('PermissionRequest', { result: 'allow' })).toEqual({
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
    })
    expect(output('PermissionRequest', { result: 'block', reason: 'deny' })).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'deny', message: 'deny' },
      },
    })
  })

  test.each(['Stop', 'SubagentStop', 'UserPromptSubmit', 'PostToolUse'] as const)(
    '%s maps an author block without termination',
    (event) => {
      expect(output(event, { result: 'block', reason: ' reason ' })).toEqual({
        decision: 'block',
        reason: ' reason ',
      })
    },
  )

  test('pre-compaction block stops before compaction', () => {
    expect(output('PreCompact', { result: 'block', reason: 'wait' })).toEqual({
      continue: false,
      stopReason: 'wait',
    })
  })

  test.each([
    ['PermissionRequest', { result: 'allow', updatedInput: {} }, 'updatedInput'],
    ['PermissionRequest', { result: 'allow', updatedPermissions: [] }, 'updatedPermissions'],
    ['PermissionRequest', { result: 'block', reason: 'deny', interrupt: true }, 'interrupt'],
    ['PostToolUse', { result: 'skip', updatedMCPToolOutput: null }, 'updatedMCPToolOutput'],
    ['UserPromptSubmit', { result: 'allow', sessionTitle: '' }, 'sessionTitle'],
    ['UserPromptSubmit', { result: 'skip', sessionTitle: null }, 'sessionTitle'],
    [
      'UserPromptSubmit',
      { result: 'block', reason: 'deny', sessionTitle: 'title' },
      'sessionTitle',
    ],
    ['Stop', { result: 'block', reason: ' ' }, 'reason'],
    ['PostCompact', { result: 'skip', injectContext: '' }, 'injectContext'],
  ] as const)('%s refuses unsupported fields before effects', (event, value, capability) => {
    expect(check(event, value)).toMatchObject({
      kind: 'rejected',
      failure: { capability, hookName: 'guard' },
    })
  })

  for (const origin of ['handler', 'before-hook'] as const) {
    test(`PermissionRequest ${origin} accepts interrupt:false without altering the denial`, () => {
      const value = { result: 'block', reason: ' original denial ', interrupt: false }
      const checked = check('PermissionRequest', value, origin)
      expect(checked.kind).toBe('accepted')
      if (checked.kind !== 'accepted') throw new Error('expected accepted denial')
      expect(checked.result).toEqual({ result: 'block', reason: value.reason })
      expect(checked.diagnostics).toEqual([])
      const translated = codexAdapter.translateFinalOutput({
        eventName: 'PermissionRequest',
        result: checked.result,
        diagnostics: checked.diagnostics,
        systemMessages: [],
      })
      expect(translated.exitCode).toBe(0)
      expect(translated.stderr).toBeUndefined()
      expect(JSON.parse(translated.output!)).toEqual({
        hookSpecificOutput: {
          hookEventName: 'PermissionRequest',
          decision: { behavior: 'deny', message: value.reason },
        },
      })
      expect(value).toEqual({ result: 'block', reason: ' original denial ', interrupt: false })
    })

    for (const interrupt of [true, null, 0, 1, '', 'false', {}, []]) {
      test(`PermissionRequest ${origin} rejects interrupt=${JSON.stringify(interrupt)}`, () => {
        expect(
          check('PermissionRequest', { result: 'block', reason: 'deny', interrupt }, origin),
        ).toMatchObject({
          kind: 'rejected',
          failure: { capability: 'interrupt' },
        })
      })
    }
  }

  test('interrupt:false remains invalid outside PermissionRequest block', () => {
    for (const tag of ['allow', 'skip']) {
      expect(check('PermissionRequest', { result: tag, interrupt: false })).toMatchObject({
        kind: 'rejected',
        failure: { capability: 'interrupt' },
      })
    }
    expect(check('Stop', { result: 'block', reason: 'deny', interrupt: false })).toMatchObject({
      kind: 'rejected',
      failure: { capability: 'interrupt' },
    })
  })

  test.each(['SessionStart', 'SubagentStart', 'PostCompact'] as const)(
    '%s distinguishes observer handlers and lifecycle blocks',
    (event) => {
      expect(check(event, { result: 'block', reason: 'deny' })).toMatchObject({
        kind: 'rejected',
        failure: { capability: 'result' },
      })
      expect(check(event, { result: 'block', reason: 'deny' }, 'before-hook')).toMatchObject({
        kind: 'rejected',
        failure: { capability: 'before-hook' },
      })
      expect(check(event, { result: 'skip' }, 'before-hook').kind).toBe('accepted')
    },
  )

  test.each([...events])('%s routes generated blocks through its failure disposition', (event) => {
    for (const origin of ['engine-error', 'load-error', 'parallel-contract'] as const) {
      const checked = check(event, { result: 'block', reason: 'crashed' }, origin)
      expect(checked.kind).toBe('rejected')
      if (checked.kind !== 'rejected') throw new Error('missing failure')
      const translated = codexAdapter.translateFailure({
        eventName: event,
        failure: checked.failure,
      })
      if (event === 'SubagentStart' || event === 'PostCompact') {
        expect(translated.exitCode).toBe(2)
        expect(translated.output).toBeUndefined()
        expect(translated.stderr).toContain('Local hook failure')
      } else {
        expect(translated.exitCode).toBe(0)
        const json = JSON.parse(translated.output!)
        expect(json.systemMessage).toContain(origin)
        if (
          event === 'Stop' ||
          event === 'SubagentStop' ||
          event === 'SessionStart' ||
          event === 'PreCompact'
        ) {
          expect(json.continue).toBe(false)
          expect(json).not.toHaveProperty('decision')
        }
      }
    }
  })

  test('typed user refusal omits duplicate systemMessage without changing transport failures', () => {
    const refusal = userApprovalFailure('declined', 'guard')
    const typed = codexAdapter.translateFailure({
      eventName: 'PreToolUse',
      failure: {
        eventName: 'PreToolUse',
        hookName: hn('guard'),
        capability: 'approval',
        message: refusal.message,
        approvalDecision: refusal.kind,
      },
    })
    expect(JSON.parse(typed.output!)).toEqual(denial(refusal.message))
    expect(JSON.parse(typed.output!)).not.toHaveProperty('systemMessage')
    expect(typed.approvalDecision).toBe('declined')

    const transport = codexAdapter.translateFailure({
      eventName: 'PreToolUse',
      failure: {
        eventName: 'PreToolUse',
        hookName: hn('guard'),
        capability: 'approval',
        message: 'transport failed',
      },
    })
    expect(JSON.parse(transport.output!)).toHaveProperty('systemMessage')
    expect(transport.approvalDecision).toBeUndefined()
  })

  test.each(['declined', 'cancelled'] as const)(
    'a typed %s refusal stays byte-identical when warnings are present',
    (decision) => {
      const refusal = userApprovalFailure(decision, 'guard')
      const failure = {
        eventName: 'PreToolUse' as const,
        hookName: hn('guard'),
        capability: 'approval',
        message: refusal.message,
        approvalDecision: refusal.kind,
      }
      const withWarnings = codexAdapter.translateFailure({
        eventName: 'PreToolUse',
        failure,
        systemMessages: ['clooks: event "PreToolUse" order references hook "guard"'],
      })
      expect(withWarnings).toEqual({
        output: `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"[guard] Approval ${decision}. Operation not run."}}`,
        exitCode: 0,
        approvalDecision: decision,
      })
      expect(withWarnings).toEqual(
        codexAdapter.translateFailure({ eventName: 'PreToolUse', failure }),
      )
    },
  )

  // Literal expectations, fixed to what the translator produced before warnings
  // could reach a failure at all, one per output shape it can take.
  test('a failure without warnings is byte-identical to the pre-warning output', () => {
    const failure = {
      eventName: null,
      hookName: hn('guard'),
      capability: 'result',
      message: 'crashed',
    }
    const call = (eventName: EventName | null) =>
      codexAdapter.translateFailure({
        eventName,
        failure: { ...failure, eventName },
        systemMessages: [],
      })

    expect(call('Stop')).toEqual({
      output:
        '{"systemMessage":"clooks: Codex Stop hook \\"guard\\" capability \\"result\\": crashed Continuation termination requested; no further continuation is requested.","continue":false,"stopReason":"clooks: Codex Stop hook \\"guard\\" capability \\"result\\": crashed Continuation termination requested; no further continuation is requested."}',
      exitCode: 0,
    })
    expect(call('PostToolUse')).toEqual({
      output:
        '{"systemMessage":"clooks: Codex PostToolUse hook \\"guard\\" capability \\"result\\": crashed Rejected-result feedback requested after execution; no rollback is possible.","decision":"block","reason":"clooks: Codex PostToolUse hook \\"guard\\" capability \\"result\\": crashed Rejected-result feedback requested after execution; no rollback is possible."}',
      exitCode: 0,
    })
    expect(call('PreToolUse')).toEqual({
      output:
        '{"systemMessage":"clooks: Codex PreToolUse hook \\"guard\\" capability \\"result\\": crashed Pending call denial requested.","hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"clooks: Codex PreToolUse hook \\"guard\\" capability \\"result\\": crashed Pending call denial requested."}}',
      exitCode: 0,
    })
    expect(call('PermissionRequest')).toEqual({
      output:
        '{"systemMessage":"clooks: Codex PermissionRequest hook \\"guard\\" capability \\"result\\": crashed Pending approval denial requested.","hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny","message":"clooks: Codex PermissionRequest hook \\"guard\\" capability \\"result\\": crashed Pending approval denial requested."}}}',
      exitCode: 0,
    })
    expect(call('Interrupt')).toEqual({
      output:
        '{"systemMessage":"clooks: Codex Interrupt hook \\"guard\\" capability \\"result\\": crashed Local observer failure only; no cancellation veto or continuation is requested."}',
      exitCode: 0,
    })
    expect(call('SessionEnd')).toEqual({
      stderr:
        'clooks: Codex SessionEnd hook "guard" capability "result": crashed Local hook failure only; no session closure veto is available and native stderr delivery is not guaranteed.',
      exitCode: 2,
    })
    expect(call(null)).toEqual({
      stderr:
        'clooks: Codex unidentified event hook "guard" capability "result": crashed Unidentified event; local failure only, with no native prevention guarantee.',
      exitCode: 2,
    })
  })

  test('final output delegates a latched failure with the messages it was given', () => {
    const failure = {
      eventName: 'Stop' as const,
      hookName: hn('guard'),
      capability: 'result',
      message: 'crashed',
    }
    const delegated = codexAdapter.translateFinalOutput({
      eventName: 'Stop',
      result: { result: 'allow' },
      policyFailure: failure,
      systemMessages: ['advisory'],
      diagnostics: ['diagnostic'],
    })
    expect(delegated).toEqual(
      codexAdapter.translateFailure({
        eventName: 'Stop',
        failure,
        systemMessages: ['advisory', 'diagnostic'],
      }),
    )
    expect(JSON.parse(delegated.output!).continue).toBe(false)
  })

  test.each([...events, 'Interrupt', null] as const)(
    '%s failure output only gains warnings in its user-facing channel',
    (event) => {
      const failure = {
        eventName: event,
        hookName: hn('guard'),
        capability: 'result',
        message: 'crashed',
      }
      const warning = 'clooks: event "Stop" order references hook "guard" which is disabled'
      const bare = codexAdapter.translateFailure({ eventName: event, failure })
      expect(
        codexAdapter.translateFailure({ eventName: event, failure, systemMessages: [] }),
      ).toEqual(bare)

      const withWarning = codexAdapter.translateFailure({
        eventName: event,
        failure,
        systemMessages: [warning],
      })
      expect(withWarning.exitCode).toBe(bare.exitCode)

      if (bare.output === undefined) {
        expect(withWarning.output).toBeUndefined()
        expect(withWarning.stderr).toBe(`${bare.stderr}\n\n${warning}`)
        return
      }

      const bareJson = JSON.parse(bare.output) as Record<string, unknown>
      const json = JSON.parse(withWarning.output!) as Record<string, unknown>
      expect(json.systemMessage).toBe(`${String(bareJson.systemMessage)}\n${warning}`)
      json.systemMessage = bareJson.systemMessage
      expect(json).toEqual(bareJson)
    },
  )

  test.each(['PermissionRequest', 'PreCompact', 'PostCompact', 'Stop', 'SubagentStop'] as const)(
    '%s generated trace has no invented context channel',
    (eventName) => {
      const composed = codexAdapter.composeDiagnostics({
        eventName,
        traceMessages: ['trace'],
        degradedMessages: ['degraded'],
        debugMessages: ['debug'],
      })
      expect(composed.result).toBeUndefined()
      expect(composed.systemMessages).toEqual(['degraded', 'trace'])
      expect(composed.stderr).toEqual(['[clooks:debug] debug'])
      expect(
        JSON.parse(
          codexAdapter.translateFinalOutput({ eventName, ...composed, diagnostics: [] }).output!,
        ),
      ).toEqual({ systemMessage: 'degraded\ntrace' })
    },
  )
})

describe('Codex event turn boundaries', () => {
  test.each(['startup', 'clear', 'resume', 'compact'])(
    'session %s owns tracking despite absent native turn',
    (source) => {
      const invocation = codexAdapter.normalizeInvocation(
        payload('SessionStart', { source }),
        'SessionStart',
      )
      expect(invocation.private.nativeTurnId).toBeNull()
      expect(codexAdapter.resolveTurnPolicy!(invocation)).toEqual({
        sessionId: 'session',
        scopeKey: 'main',
        boundary: source === 'startup' || source === 'clear' ? 'reset' : null,
        prune: true,
      })
    },
  )

  test('each root prompt advances, including repeated native turn IDs; children preserve', () => {
    for (let index = 0; index < 2; index++) {
      const root = codexAdapter.normalizeInvocation(payload('UserPromptSubmit'), 'UserPromptSubmit')
      expect(codexAdapter.resolveTurnPolicy!(root)?.boundary).toBe('advance')
    }
    const child = codexAdapter.normalizeInvocation(
      payload('UserPromptSubmit', { agent_id: 'child', agent_type: 'worker' }),
      'UserPromptSubmit',
    )
    expect(codexAdapter.resolveTurnPolicy!(child)).toEqual({
      sessionId: 'session',
      scopeKey: 'agent:child',
      boundary: null,
      prune: false,
    })
  })

  test.each(['Stop', 'SubagentStop'] as const)('%s continuation preserves scope', (event) => {
    for (const active of [false, true]) {
      const invocation = codexAdapter.normalizeInvocation(
        payload(event, { stop_hook_active: active }),
        event,
      )
      expect(codexAdapter.resolveTurnPolicy!(invocation)).toEqual({
        sessionId: 'session',
        scopeKey: event === 'Stop' ? 'main' : 'agent:child',
        boundary: null,
        prune: false,
      })
    }
  })
})
