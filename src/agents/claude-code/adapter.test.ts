import { describe, expect, test } from 'bun:test'
import { claudeCodeAdapter } from './adapter.js'

describe('claudeCodeAdapter', () => {
  test('reads only recognized Claude Code event names', () => {
    expect(claudeCodeAdapter.readEventName({ hook_event_name: 'PreToolUse' })).toBe('PreToolUse')
    expect(claudeCodeAdapter.readEventName({ hook_event_name: 'Nope' })).toBeNull()
    expect(claudeCodeAdapter.readEventName({ hook_event_name: 42 })).toBeNull()
  })

  test('normalizes Claude Code payload keys late, including PermissionDenied reason rename', () => {
    const normalized = claudeCodeAdapter.normalizeContext(
      {
        hook_event_name: 'PermissionDenied',
        session_id: 's1',
        reason: 'denied by upstream',
      },
      'PermissionDenied',
    )

    expect(normalized).toEqual({
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
