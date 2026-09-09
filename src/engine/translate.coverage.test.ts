import { describe, expect, test } from 'bun:test'
import { translateResult } from './translate.js'
import type { EventName } from '../types/branded.js'

describe('translation of supplemental event output', () => {
  test('permission allow without modifications leaves the native permission flow unchanged', () => {
    expect(translateResult('PermissionRequest' as EventName, { result: 'allow' })).toEqual({
      exitCode: 0,
    })
  })

  test.each(['Stop', 'SubagentStop'])(
    '%s allow does not emit unsupported context or a block decision',
    (event) => {
      const result = translateResult(event as EventName, {
        result: 'allow',
        injectContext: 'Review completed',
      })
      expect(result).toEqual({ exitCode: 0 })
    },
  )

  test('observe-event crash feedback is delivered as injectable context', () => {
    const result = translateResult('PostToolUseFailure' as EventName, {
      result: 'block',
      reason: 'Audit failed',
    })
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.output!)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PostToolUseFailure',
        additionalContext: 'Audit failed',
      },
    })
  })

  test('skipped continuation emits neither retry feedback nor a stop instruction', () => {
    expect(translateResult('TeammateIdle' as EventName, { result: 'skip' })).toEqual({
      exitCode: 0,
    })
  })
})
