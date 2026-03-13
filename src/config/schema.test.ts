import { describe, test, expect } from 'bun:test'
import { generateJsonSchema } from './schema.js'

describe('generateJsonSchema', () => {
  test('returns a valid JSON Schema object', () => {
    const schema = generateJsonSchema()
    expect(schema).toBeDefined()
    expect(typeof schema).toBe('object')
  })

  test('schema has expected top-level properties', () => {
    const schema = generateJsonSchema() as Record<string, unknown>
    // JSON Schema should have a type or $schema
    expect(schema.type ?? schema.$schema).toBeDefined()
  })
})
