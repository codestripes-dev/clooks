// Runtime sanity check for `TOOL_INPUT_DOCS`. M3's drift gate enforces the
// type-level invariant `keyof typeof TOOL_INPUT_DOCS === keyof ToolInputMap`;
// this test asserts the same invariant at runtime against the canonical list
// of 10 built-in tools, producing a friendlier error message than tsc when a
// tool is added or removed.

import { describe, test, expect } from 'bun:test'
import { TOOL_INPUT_DOCS } from './tool-inputs.meta.js'

// Canonical ToolInputMap key set — kept in lockstep with src/types/contexts.ts:161-172.
// Updating ToolInputMap without updating this list is the failure mode this
// test exists to catch.
const EXPECTED_TOOLS = [
  'Agent',
  'AskUserQuestion',
  'Bash',
  'Edit',
  'Glob',
  'Grep',
  'Read',
  'WebFetch',
  'WebSearch',
  'Write',
] as const

describe('TOOL_INPUT_DOCS — coverage', () => {
  test('keys match the 10 built-in ToolInputMap entries exactly', () => {
    const actual = Object.keys(TOOL_INPUT_DOCS).sort()
    expect(actual).toEqual([...EXPECTED_TOOLS])
  })

  test('every tool has at least one documented field', () => {
    for (const tool of EXPECTED_TOOLS) {
      const fields = TOOL_INPUT_DOCS[tool]
      expect(Array.isArray(fields)).toBe(true)
      expect(fields.length).toBeGreaterThan(0)
    }
  })

  test('every field has a name, type, required flag, and description', () => {
    for (const tool of EXPECTED_TOOLS) {
      for (const field of TOOL_INPUT_DOCS[tool]) {
        expect(typeof field.name).toBe('string')
        expect(field.name.length).toBeGreaterThan(0)
        expect(typeof field.type).toBe('string')
        expect(field.type.length).toBeGreaterThan(0)
        expect(typeof field.required).toBe('boolean')
        expect(typeof field.description).toBe('string')
        expect(field.description.length).toBeGreaterThan(0)
      }
    }
  })

  test('every tool has at least one required field', () => {
    for (const tool of EXPECTED_TOOLS) {
      const required = TOOL_INPUT_DOCS[tool].filter((f) => f.required)
      expect(required.length).toBeGreaterThan(0)
    }
  })
})
