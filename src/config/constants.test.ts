import { describe, expect, test } from 'bun:test'
import { isEventName } from './constants.js'

describe('isEventName', () => {
  test('returns true for valid Claude Code event names', () => {
    expect(isEventName('PreToolUse')).toBe(true)
    expect(isEventName('PostToolUse')).toBe(true)
    expect(isEventName('SessionStart')).toBe(true)
    expect(isEventName('SessionEnd')).toBe(true)
    expect(isEventName('Stop')).toBe(true)
  })

  test('returns false for unknown strings', () => {
    expect(isEventName('unknown')).toBe(false)
    expect(isEventName('')).toBe(false)
    expect(isEventName('pretooluse')).toBe(false)
    expect(isEventName('PRETOOLUSE')).toBe(false)
  })
})
