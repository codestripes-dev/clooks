import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { normalizeKeys } from './normalize.js'

describe('normalizeKeys', () => {
  it('converts simple snake_case keys', () => {
    expect(normalizeKeys({ session_id: 'abc' })).toEqual({
      sessionId: 'abc',
    })
  })

  it('converts nested object keys recursively', () => {
    expect(
      normalizeKeys({
        tool_input: { file_path: '/tmp/f.txt', run_in_background: true },
      }),
    ).toEqual({
      toolInput: { filePath: '/tmp/f.txt', runInBackground: true },
    })
  })

  it('converts keys inside arrays of objects', () => {
    expect(
      normalizeKeys({
        items: [{ item_name: 'a' }, { item_name: 'b' }],
      }),
    ).toEqual({
      items: [{ itemName: 'a' }, { itemName: 'b' }],
    })
  })

  it('passes through non-object values', () => {
    expect(
      normalizeKeys({
        count: 42,
        active: true,
        label: 'hello',
        nothing: null,
      }),
    ).toEqual({
      count: 42,
      active: true,
      label: 'hello',
      nothing: null,
    })
  })

  it('handles empty objects', () => {
    expect(normalizeKeys({})).toEqual({})
  })

  it('leaves already-camelCase keys unchanged', () => {
    expect(normalizeKeys({ sessionId: 'abc', toolName: 'Bash' })).toEqual({
      sessionId: 'abc',
      toolName: 'Bash',
    })
  })

  it('normalizes a full PreToolUse payload from Claude Code', () => {
    const raw = {
      session_id: 'abc123',
      hook_event_name: 'PreToolUse',
      cwd: '/opt/development/myproject',
      permission_mode: 'default',
      transcript_path: '/home/user/.claude/transcript.jsonl',
      tool_name: 'Bash',
      tool_input: {
        command: 'echo hello',
        description: 'Print hello',
        timeout: 5000,
      },
      tool_use_id: 'tu-abc123',
    }

    const normalized = normalizeKeys(raw)

    expect(normalized).toEqual({
      sessionId: 'abc123',
      hookEventName: 'PreToolUse',
      cwd: '/opt/development/myproject',
      permissionMode: 'default',
      transcriptPath: '/home/user/.claude/transcript.jsonl',
      toolName: 'Bash',
      toolInput: {
        command: 'echo hello',
        description: 'Print hello',
        timeout: 5000,
      },
      toolUseId: 'tu-abc123',
    })
  })

  it('normalizes the StopFailure fixture → errorDetails and lastAssistantMessage are camelCased', () => {
    const fixturePath = join(__dirname, '..', 'test', 'fixtures', 'events', 'stop-failure.json')
    const raw = JSON.parse(readFileSync(fixturePath, 'utf8'))
    const normalized = normalizeKeys(raw) as Record<string, unknown>
    expect(normalized.hookEventName).toBe('StopFailure')
    expect(normalized.error).toBe('rate_limit')
    expect(normalized.errorDetails).toBe('429 Too Many Requests')
    expect(normalized.lastAssistantMessage).toBe('API Error: Rate limit reached')
    expect((normalized as Record<string, unknown>).error_details).toBeUndefined()
    expect((normalized as Record<string, unknown>).last_assistant_message).toBeUndefined()
  })
})
