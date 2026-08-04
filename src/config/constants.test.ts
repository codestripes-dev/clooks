import { describe, expect, test } from 'bun:test'
import { HANDOFF_ELIGIBLE_EVENTS, INJECTABLE_EVENTS, isEventName } from './constants.js'
import type { EventName } from '../types/branded.js'

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

describe('HANDOFF_ELIGIBLE_EVENTS', () => {
  test('contains every injectable event', () => {
    for (const event of INJECTABLE_EVENTS) {
      expect(HANDOFF_ELIGIBLE_EVENTS.has(event)).toBe(true)
    }
  })

  test('contains the model-facing block and continuation events', () => {
    for (const event of ['Stop', 'SubagentStop', 'TeammateIdle', 'TaskCreated', 'TaskCompleted']) {
      expect(HANDOFF_ELIGIBLE_EVENTS.has(event as EventName)).toBe(true)
    }
  })

  test('excludes events with no model-facing payload', () => {
    for (const event of ['SessionEnd', 'PermissionRequest', 'WorktreeCreate', 'PreCompact']) {
      expect(HANDOFF_ELIGIBLE_EVENTS.has(event as EventName)).toBe(false)
    }
  })
})
