import { describe, expect, test } from 'bun:test'
import { AgentSelectionError, InvocationPolicyError, selectAgentAdapter } from './index.js'
import type { AgentSelectionEnv } from './select.js'

describe('selectAgentAdapter', () => {
  test('defaults to Claude Code when CLOOKS_AGENT is unset', () => {
    expect(selectAgentAdapter({}).id).toBe('claude-code')
  })

  test('defaults to Claude Code when CLOOKS_AGENT is empty', () => {
    expect(selectAgentAdapter({ CLOOKS_AGENT: '' }).id).toBe('claude-code')
  })

  test('selects Claude Code explicitly', () => {
    expect(selectAgentAdapter({ CLOOKS_AGENT: 'claude-code' }).id).toBe('claude-code')
  })

  test('selects the Codex runtime explicitly', () => {
    const adapter = selectAgentAdapter({ CLOOKS_AGENT: 'codex' })

    expect(adapter.id).toBe('codex')
    expect(adapter.supportsRuntime).toBe(true)
    expect(adapter.supportsClaudePluginAdvisories).toBe(false)
  })

  test('fails closed for unknown agents', () => {
    let error: unknown

    try {
      selectAgentAdapter({ CLOOKS_AGENT: 'unknown-agent' })
    } catch (e) {
      error = e
    }

    expect(error).toBeInstanceOf(AgentSelectionError)
    expect((error as AgentSelectionError).agent).toBe('unknown-agent')
    expect((error as Error).message).toContain('CLOOKS_AGENT "unknown-agent"')
    expect((error as Error).message).toContain('Recognized values')
    expect((error as Error).message).toContain('"claude-code"')
    expect((error as Error).message).toContain('"codex"')
  })

  test('does not inspect hook payload shape', () => {
    const codexShapedPayload = {
      hook_event_name: 'SessionStart',
      cwd: '/repo',
      transcript_path: null,
    }

    expect(selectAgentAdapter(codexShapedPayload as AgentSelectionEnv).id).toBe('claude-code')
    expect(
      selectAgentAdapter({ CLOOKS_AGENT: 'codex', ...codexShapedPayload } as AgentSelectionEnv).id,
    ).toBe('codex')
  })

  test('Codex supports valid SessionStart without enabling Claude plugins', async () => {
    const adapter = selectAgentAdapter({ CLOOKS_AGENT: 'codex' })

    expect(adapter.readEventName({ hook_event_name: 'SessionStart' })).toBe('SessionStart')
    await expect(
      adapter.prepareConfigAfterLoad({
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
      }),
    ).resolves.toMatchObject({ systemMessages: [] })
    expect(
      adapter.collectSessionStartAdvisories({ projectRoot: '/project', homeRoot: '/home' }),
    ).toEqual([])
    expect(() =>
      adapter.normalizeInvocation({ hook_event_name: 'SessionStart' }, 'SessionStart'),
    ).toThrow(InvocationPolicyError)
    const invocation = adapter.normalizeInvocation(
      {
        hook_event_name: 'SessionStart',
        session_id: 'session',
        cwd: '/project',
        model: 'actual-model',
        permission_mode: 'default',
        transcript_path: null,
        source: 'startup',
      },
      'SessionStart',
    )
    expect(invocation.context).toMatchObject({
      event: 'SessionStart',
      model: 'actual-model',
      source: 'startup',
    })
    expect(invocation.private.nativeTurnId).toBeNull()
    const translated = adapter.translateFinalOutput({
      eventName: 'SessionStart',
      invocation,
      systemMessages: [],
      diagnostics: [],
    })
    expect(translated.exitCode).toBe(0)
    expect(translated.output).toBeUndefined()
    expect(adapter.routeSystemMessage('SessionStart', 'message')).toBe('stdout-json')
  })
})
