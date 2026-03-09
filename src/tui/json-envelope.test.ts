import { describe, expect, test } from 'bun:test'
import { jsonSuccess, jsonError } from './json-envelope.js'

describe('jsonSuccess', () => {
  test('returns valid JSON with ok: true, command, and data', () => {
    const result = jsonSuccess('config', { hooks: 3 })
    const parsed = JSON.parse(result)
    expect(parsed).toEqual({
      ok: true,
      command: 'config',
      data: { hooks: 3 },
    })
  })
})

describe('jsonError', () => {
  test('returns valid JSON with ok: false, command, and error', () => {
    const result = jsonError('config', 'No config found')
    const parsed = JSON.parse(result)
    expect(parsed).toEqual({
      ok: false,
      command: 'config',
      error: 'No config found',
    })
  })
})
