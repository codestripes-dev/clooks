import { describe, expect, test } from 'bun:test'
import { AgentSelectionError, UnsupportedAgentAdapterError, selectAgentAdapter } from './index.js'
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

  test('selects the Codex placeholder explicitly', () => {
    const adapter = selectAgentAdapter({ CLOOKS_AGENT: 'codex' })

    expect(adapter.id).toBe('codex')
    expect(adapter.supportsRuntime).toBe(false)
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

  test('Codex placeholder runtime methods fail closed as unsupported', async () => {
    const adapter = selectAgentAdapter({ CLOOKS_AGENT: 'codex' })

    expect(adapter.readEventName({ hook_event_name: 'SessionStart' })).toBeNull()
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
      adapter.normalizeContext({ hook_event_name: 'SessionStart' }, 'SessionStart'),
    ).toThrow(UnsupportedAgentAdapterError)
    expect(() =>
      adapter.translateFinalOutput({
        eventName: 'SessionStart',
        systemMessages: [],
        diagnostics: [],
      }),
    ).toThrow(UnsupportedAgentAdapterError)
    expect(() => adapter.routeSystemMessage('SessionStart', 'message')).toThrow(
      UnsupportedAgentAdapterError,
    )
  })
})
