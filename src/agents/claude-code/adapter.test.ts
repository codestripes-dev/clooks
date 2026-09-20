import { describe, expect, test } from 'bun:test'
import { claudeCodeAdapter } from './adapter.js'

describe('claudeCodeAdapter', () => {
  test('invocation envelopes retain separate raw data without exposing metadata in context', () => {
    const payload = {
      hook_event_name: 'PreToolUse',
      session_id: 'first',
      agent_id: 'child',
      tool_input: { nested_key: [{ value: 1 }] },
    }
    const first = claudeCodeAdapter.normalizeInvocation(payload, 'PreToolUse')
    const second = claudeCodeAdapter.normalizeInvocation(
      { ...payload, session_id: 'second' },
      'PreToolUse',
    )
    expect(first.private.agent).toBe('claude-code')
    expect(first.private.sessionId).toBe('first')
    expect(second.private.sessionId).toBe('second')
    expect(first.private.referencedAgentId).toBe('child')
    expect(Object.keys(first.context).sort()).toEqual([
      'agentId',
      'event',
      'sessionId',
      'toolInput',
    ])
    const input = first.context.toolInput as { nestedKey: { value: number }[] }
    input.nestedKey[0]!.value = 99
    payload.tool_input.nested_key[0]!.value = 77
    expect(first.private.raw.tool_input).toEqual({ nested_key: [{ value: 1 }] })
    expect(second.context.toolInput).toEqual({ nestedKey: [{ value: 1 }] })
    expect(second.private.raw.tool_input).toEqual({ nested_key: [{ value: 1 }] })
  })

  test('diagnostics are composed separately with unchanged Claude ordering and no input mutation', () => {
    const result = { result: 'skip' as const, injectContext: 'hook' }
    const composed = claudeCodeAdapter.composeDiagnostics({
      eventName: 'SessionStart',
      result,
      traceMessages: ['trace'],
      degradedMessages: ['degraded'],
      debugMessages: ['debug'],
    })
    expect(composed).toEqual({
      result: { result: 'skip', injectContext: 'hook\ntrace\ndegraded\n[clooks:debug] debug' },
      stderr: ['[clooks:debug] debug'],
      systemMessages: [],
    })
    expect(result.injectContext).toBe('hook')
    expect(
      claudeCodeAdapter.composeDiagnostics({
        eventName: 'PostCompact',
        traceMessages: [],
        degradedMessages: ['degraded'],
        debugMessages: [],
      }),
    ).toEqual({ result: undefined, stderr: ['clooks: warning: degraded'], systemMessages: [] })
  })

  test.each(['TeammateIdle', 'TaskCreated', 'TaskCompleted', 'PostCompact', 'SessionEnd'] as const)(
    '%s debug diagnostics preserve empty and skip aggregates',
    (eventName) => {
      for (const result of [undefined, { result: 'skip' as const }]) {
        const composed = claudeCodeAdapter.composeDiagnostics({
          eventName,
          result,
          traceMessages: [],
          degradedMessages: [],
          debugMessages: ['debug'],
        })
        expect(composed).toEqual({
          result,
          stderr: ['[clooks:debug] debug'],
          systemMessages: [],
        })
        expect(
          claudeCodeAdapter.translateFinalOutput({
            eventName,
            result: composed.result,
            systemMessages: [],
            diagnostics: [],
          }),
        ).toEqual({ exitCode: 0 })
      }
    },
  )

  test.each(['TeammateIdle', 'TaskCreated', 'TaskCompleted'] as const)(
    '%s debug diagnostics preserve continuation controls',
    (eventName) => {
      for (const result of [
        { result: 'block', reason: 'blocked' },
        { result: 'continue', feedback: 'retry' },
        { result: 'stop', reason: 'finished' },
      ] as const) {
        const composed = claudeCodeAdapter.composeDiagnostics({
          eventName,
          result,
          traceMessages: [],
          degradedMessages: [],
          debugMessages: ['debug'],
        })
        expect(composed.result).toEqual(result)
        expect(composed.stderr).toEqual(['[clooks:debug] debug'])
        const output = (value: typeof composed.result) =>
          claudeCodeAdapter.translateFinalOutput({
            eventName,
            result: value,
            systemMessages: [],
            diagnostics: [],
          })
        expect(output(composed.result)).toEqual(output(result))
      }
    },
  )

  test('a latched failure dominates an internally composed allow result', () => {
    const output = claudeCodeAdapter.translateFinalOutput({
      eventName: 'SessionStart',
      result: { result: 'allow', injectContext: 'trace' },
      policyFailure: {
        eventName: 'SessionStart',
        capability: 'test-policy',
        message: 'policy rejected',
      },
      systemMessages: ['advisory'],
      diagnostics: ['diagnostic'],
    })
    expect(output).toEqual({ exitCode: 2, stderr: 'policy rejected\n\nadvisory\ndiagnostic' })
  })

  test('SessionStart failure stderr carries warnings after the failure message', () => {
    const failure = {
      eventName: 'SessionStart' as const,
      capability: 'test-policy',
      message: 'policy rejected',
    }
    const bare = claudeCodeAdapter.translateFailure({ eventName: 'SessionStart', failure })
    expect(bare).toEqual({ exitCode: 2, stderr: 'policy rejected' })
    expect(
      claudeCodeAdapter.translateFailure({
        eventName: 'SessionStart',
        failure,
        systemMessages: [],
      }),
    ).toEqual(bare)
    expect(
      claudeCodeAdapter.translateFailure({
        eventName: 'SessionStart',
        failure,
        systemMessages: ['order references hook "guard"', 'shadowed by project hook'],
      }),
    ).toEqual({
      exitCode: 2,
      stderr: 'policy rejected\n\norder references hook "guard"\nshadowed by project hook',
    })
  })

  test('PreToolUse failure JSON carries warnings without touching the denial fields', () => {
    const failure = {
      eventName: 'PreToolUse' as const,
      capability: 'ask',
      message: 'clooks: ask is not expressible',
    }
    const bare = claudeCodeAdapter.translateFailure({ eventName: 'PreToolUse', failure })
    const withWarnings = claudeCodeAdapter.translateFailure({
      eventName: 'PreToolUse',
      failure,
      systemMessages: ['order references hook "guard"', 'hook "guard" failed to import'],
    })

    expect(
      claudeCodeAdapter.translateFailure({ eventName: 'PreToolUse', failure, systemMessages: [] }),
    ).toEqual(bare)
    expect(withWarnings.exitCode).toBe(0)
    expect(withWarnings.stderr).toBeUndefined()
    const bareOutput = JSON.parse(bare.output ?? '{}')
    const output = JSON.parse(withWarnings.output ?? '{}')
    expect(output.hookSpecificOutput).toEqual(bareOutput.hookSpecificOutput)
    expect(output.systemMessage).toBe(
      'order references hook "guard"\nhook "guard" failed to import',
    )
  })

  test('a typed approval refusal stays byte-identical when warnings are present', () => {
    const failure = {
      eventName: 'PreToolUse' as const,
      capability: 'approval',
      message: 'clooks: user declined',
      approvalDecision: 'declined' as const,
    }
    const bare = claudeCodeAdapter.translateFailure({ eventName: 'PreToolUse', failure })
    expect(
      claudeCodeAdapter.translateFailure({
        eventName: 'PreToolUse',
        failure,
        systemMessages: ['order references hook "guard"'],
      }),
    ).toEqual(bare)
    expect(bare.approvalDecision).toBe('declined')
    expect(JSON.parse(bare.output ?? '{}')).not.toHaveProperty('systemMessage')
  })

  test.each(['Stop', 'PostToolUse', 'UserPromptSubmit'] as const)(
    '%s exit-2 failure omits warnings so the model sees only the block reason',
    (eventName) => {
      const failure = { eventName, capability: 'test-policy', message: 'policy rejected' }
      expect(
        claudeCodeAdapter.translateFailure({
          eventName,
          failure,
          systemMessages: ['order references hook "guard"'],
        }),
      ).toEqual({ exitCode: 2, stderr: 'policy rejected' })
    },
  )

  test('reads only recognized Claude Code event names', () => {
    expect(claudeCodeAdapter.readEventName({ hook_event_name: 'PreToolUse' })).toBe('PreToolUse')
    expect(claudeCodeAdapter.readEventName({ hook_event_name: 'Nope' })).toBeNull()
    expect(claudeCodeAdapter.readEventName({ hook_event_name: 42 })).toBeNull()
  })

  test('normalizes Claude Code payload keys late, including PermissionDenied reason rename', () => {
    const invocation = claudeCodeAdapter.normalizeInvocation(
      {
        hook_event_name: 'PermissionDenied',
        session_id: 's1',
        reason: 'denied by upstream',
      },
      'PermissionDenied',
    )

    expect(invocation.context).toEqual({
      event: 'PermissionDenied',
      sessionId: 's1',
      denialReason: 'denied by upstream',
    })
  })

  test('routes system messages through Claude Code stdout JSON by default', () => {
    const translated = claudeCodeAdapter.translateFinalOutput({
      eventName: 'SessionStart',
      systemMessages: ['hello'],
      diagnostics: [],
    })

    expect(translated.exitCode).toBe(0)
    expect(JSON.parse(translated.output ?? '{}')).toEqual({ systemMessage: 'hello' })
    expect(translated.stderr).toBeUndefined()
  })

  test('merges system messages into existing Claude Code result output', () => {
    const translated = claudeCodeAdapter.translateFinalOutput({
      eventName: 'PreToolUse',
      result: { result: 'block', reason: 'unsafe command' },
      systemMessages: ['startup warning'],
      diagnostics: [],
    })

    const output = JSON.parse(translated.output ?? '{}')
    expect(translated.exitCode).toBe(0)
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(output.hookSpecificOutput.permissionDecisionReason).toBe('unsafe command')
    expect(output.systemMessage).toBe('startup warning')
    expect(translated.stderr).toBeUndefined()
  })

  test('routes notify-only system messages to stderr', () => {
    const translated = claudeCodeAdapter.translateFinalOutput({
      eventName: 'StopFailure',
      systemMessages: ['dropped stdout warning'],
      diagnostics: [],
    })

    expect(translated.exitCode).toBe(0)
    expect(translated.output).toBeUndefined()
    expect(translated.stderr).toBe('clooks: dropped stdout warning')
  })

  test('downgrades ConfigChange policy_settings block before final output', () => {
    const adjusted = claudeCodeAdapter.adjustResultBeforeFinalOutput({
      eventName: 'ConfigChange',
      context: { source: 'policy_settings' },
      result: { result: 'block', reason: 'disallowed' },
    })

    expect(adjusted.result).toEqual({ result: 'skip' })
    expect(adjusted.systemMessages).toHaveLength(1)
    expect(adjusted.systemMessages[0]).toContain('policy_settings')
    expect(adjusted.systemMessages[0]).toContain('disallowed')
  })

  test('vendors Claude plugin packs and returns registration messages', async () => {
    const prepared = await claudeCodeAdapter.prepareConfigAfterLoad({
      projectRoot: '/project',
      homeRoot: '/home',
      config: {
        version: '1.0.0',
        global: {
          timeout: 30000 as any,
          onError: 'block',
          maxFailures: 3,
          maxFailuresMessage: 'Too many failures',
          handoff: false,
        },
        hooks: {},
        events: {},
      },
      shadows: [],
      loadConfig: (async () => null) as any,
      discoverPluginPacks: (() => [
        {
          pluginName: 'test@marketplace',
          scope: 'user',
          installPath: '/plugins/test',
          manifest: {
            version: 1,
            name: 'test-pack',
            hooks: {
              added: {
                path: 'hooks/added.ts',
                description: 'Added hook',
              },
            },
          },
        },
      ]) as any,
      vendorAndRegisterPack: (async () => ({
        registered: ['added'],
        disabledHooks: [],
        skipped: [],
        collisions: ['conflict: conflicts with existing hook (from plugin test-pack)'],
        errors: ['broken: validation failed'],
      })) as any,
    })

    expect(prepared.systemMessages).toContain(
      'clooks: Registered 1 hook(s) from test-pack (plugin)',
    )
    expect(prepared.systemMessages).toContain(
      'clooks: conflict: conflicts with existing hook (from plugin test-pack)',
    )
    expect(prepared.systemMessages).toContain('clooks: broken: validation failed')
  })
})
