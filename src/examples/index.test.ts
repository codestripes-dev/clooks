// Runtime sanity check for the `EXAMPLES` and `META` corpora. M3's drift gate
// (`scripts/verify-context-examples.ts`) catches type-level drift; this test
// catches "we added a new EventName but forgot the example/meta entry" with a
// friendlier message than tsc's structural-error wall.

import { describe, test, expect } from 'bun:test'
import { CLAUDE_CODE_EVENTS } from '../config/constants.js'
import type { EventName } from '../types/branded.js'
import { EXAMPLES, META, TOOL_KEYED_EVENTS } from './index.js'

const ALL_EVENTS = Array.from(CLAUDE_CODE_EVENTS).sort()

describe('examples corpus — coverage of every EventName', () => {
  test('every EventName has an EXAMPLES entry', () => {
    const missing = ALL_EVENTS.filter((e) => !(e in EXAMPLES))
    expect(missing).toEqual([])
  })

  test('every EventName has a META entry', () => {
    const missing = ALL_EVENTS.filter((e) => !(e in META))
    expect(missing).toEqual([])
  })

  test('EXAMPLES has no extra keys beyond EventName', () => {
    const extra = (Object.keys(EXAMPLES) as EventName[]).filter((k) => !CLAUDE_CODE_EVENTS.has(k))
    expect(extra).toEqual([])
  })

  test('META has no extra keys beyond EventName', () => {
    const extra = (Object.keys(META) as EventName[]).filter((k) => !CLAUDE_CODE_EVENTS.has(k))
    expect(extra).toEqual([])
  })
})

describe('examples corpus — payload validity', () => {
  test('every EXAMPLES entry parses as JSON and carries an event field that matches the key', () => {
    for (const event of ALL_EVENTS) {
      const raw = EXAMPLES[event as EventName]
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch (e) {
        throw new Error(`EXAMPLES[${event}] is not valid JSON: ${(e as Error).message}`, {
          cause: e,
        })
      }
      expect(typeof parsed === 'object' && parsed !== null).toBe(true)
      const obj = parsed as Record<string, unknown>
      expect(obj.event).toBe(event)
    }
  })

  test('every META.required entry is a non-empty array of {name,type,description}', () => {
    for (const event of ALL_EVENTS) {
      const meta = META[event as EventName]
      expect(Array.isArray(meta.required)).toBe(true)
      expect(meta.required.length).toBeGreaterThan(0)
      for (const field of meta.required) {
        expect(typeof field.name).toBe('string')
        expect(typeof field.type).toBe('string')
        expect(typeof field.description).toBe('string')
      }
    }
  })

  test('every META.required entry names a key that exists in the corresponding EXAMPLES payload', () => {
    // Without this, a meta entry pointing at a field that doesn't exist in the
    // example JSON ships green — and `clooks test example <Event>` would tell
    // hook authors to set a field the example doesn't even illustrate.
    for (const event of ALL_EVENTS) {
      const meta = META[event as EventName]
      const parsed = JSON.parse(EXAMPLES[event as EventName]) as Record<string, unknown>
      for (const f of meta.required) {
        expect(parsed).toHaveProperty(f.name)
      }
    }
  })
})

describe('TOOL_KEYED_EVENTS', () => {
  test('contains exactly the 4 tool-keyed events', () => {
    const expected: EventName[] = [
      'PermissionRequest' as EventName,
      'PostToolUse' as EventName,
      'PostToolUseFailure' as EventName,
      'PreToolUse' as EventName,
    ]
    expect(Array.from(TOOL_KEYED_EVENTS).sort()).toEqual(expected)
  })

  test('every TOOL_KEYED_EVENTS member is itself a valid EventName', () => {
    for (const e of TOOL_KEYED_EVENTS) {
      expect(CLAUDE_CODE_EVENTS.has(e)).toBe(true)
    }
  })
})
