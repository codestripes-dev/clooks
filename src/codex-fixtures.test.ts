import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const FIXTURE_DIR = join(import.meta.dir, '..', 'test', 'fixtures', 'codex', 'events')

const DOCUMENTED_CODEX_EVENTS = new Set([
  'SessionStart',
  'SubagentStart',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PreCompact',
  'PostCompact',
  'UserPromptSubmit',
  'SubagentStop',
  'Stop',
  'SessionEnd',
  'Interrupt',
])

const EXPECTED_FIXTURES = new Map([
  ['interrupt.json', 'Interrupt'],
  ['permission-request-bash.json', 'PermissionRequest'],
  ['post-compact-auto.json', 'PostCompact'],
  ['post-tool-use-bash.json', 'PostToolUse'],
  ['pre-compact-manual.json', 'PreCompact'],
  ['pre-tool-use-bash.json', 'PreToolUse'],
  ['session-start-startup.json', 'SessionStart'],
  ['session-end-other.json', 'SessionEnd'],
  ['stop.json', 'Stop'],
  ['subagent-start-reviewer.json', 'SubagentStart'],
  ['subagent-stop-reviewer.json', 'SubagentStop'],
  ['user-prompt-submit.json', 'UserPromptSubmit'],
])

function expectObject(value: unknown): asserts value is Record<string, unknown> {
  expect(value).toBeTruthy()
  expect(Array.isArray(value)).toBe(false)
  expect(typeof value).toBe('object')
}

function expectStringField(raw: Record<string, unknown>, field: string): void {
  expect(typeof raw[field]).toBe('string')
}

function expectObjectField(raw: Record<string, unknown>, field: string): void {
  expectObject(raw[field])
}

describe('Codex event fixtures', () => {
  test('cover each documented event exactly once with expected filenames', () => {
    const fixtureFiles = readdirSync(FIXTURE_DIR)
      .filter((file) => file.endsWith('.json'))
      .sort()

    expect(fixtureFiles).toEqual([...EXPECTED_FIXTURES.keys()].sort())

    const seenEvents = new Set<string>()

    for (const file of fixtureFiles) {
      const raw = JSON.parse(readFileSync(join(FIXTURE_DIR, file), 'utf8'))

      expectObject(raw)
      expectStringField(raw, 'hook_event_name')
      const eventName = raw.hook_event_name as string
      const expectedEventName = EXPECTED_FIXTURES.get(file)
      expect(expectedEventName).toBeDefined()
      expect(eventName).toBe(expectedEventName!)
      expect(DOCUMENTED_CODEX_EVENTS.has(eventName)).toBe(true)
      seenEvents.add(eventName)
    }

    expect(seenEvents).toEqual(DOCUMENTED_CODEX_EVENTS)
  })

  test('preserve basic docs-shaped fields needed by the future normalizer', () => {
    for (const file of EXPECTED_FIXTURES.keys()) {
      const raw = JSON.parse(readFileSync(join(FIXTURE_DIR, file), 'utf8'))
      expectObject(raw)

      expectStringField(raw, 'session_id')
      expectStringField(raw, 'cwd')
      expect(raw.transcript_path === null || typeof raw.transcript_path === 'string').toBe(true)

      switch (raw.hook_event_name) {
        case 'Interrupt':
          for (const key of ['turn_id', 'model', 'permission_mode']) {
            expectStringField(raw, key)
            expect((raw[key] as string).length).toBeGreaterThan(0)
          }
          for (const key of ['agent_id', 'agent_type', 'reason'])
            expect(raw).not.toHaveProperty(key)
          break
        case 'SessionEnd':
          expect(raw.reason).toBe('other')
          for (const key of ['model', 'permission_mode', 'turn_id'])
            expect(raw).not.toHaveProperty(key)
          break
        case 'SessionStart':
          expect(raw.source).toBe('startup')
          break
        case 'SubagentStart':
          expectStringField(raw, 'agent_id')
          expectStringField(raw, 'agent_type')
          break
        case 'PreToolUse':
        case 'PermissionRequest':
          expectStringField(raw, 'tool_name')
          expectObjectField(raw, 'tool_input')
          break
        case 'PostToolUse':
          expectStringField(raw, 'tool_name')
          expectObjectField(raw, 'tool_input')
          expectObjectField(raw, 'tool_response')
          break
        case 'PreCompact':
        case 'PostCompact':
          expectStringField(raw, 'trigger')
          break
        case 'UserPromptSubmit':
          expectStringField(raw, 'prompt')
          break
        case 'SubagentStop':
          expectStringField(raw, 'agent_id')
          expectStringField(raw, 'agent_type')
          expect(typeof raw.stop_hook_active).toBe('boolean')
          expectStringField(raw, 'last_assistant_message')
          break
        case 'Stop':
          expect(typeof raw.stop_hook_active).toBe('boolean')
          expectStringField(raw, 'last_assistant_message')
          break
      }
    }
  })
})
