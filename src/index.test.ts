import { describe, expect, test } from 'bun:test'
import { VERSION } from './index'

describe('index', () => {
  test('VERSION is a non-empty string', () => {
    expect(typeof VERSION).toBe('string')
    expect(VERSION.length).toBeGreaterThan(0)
  })

  test('VERSION follows semver format', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
  })
})
