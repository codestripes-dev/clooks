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

  describe('agents', () => {
    type SchemaNode = Record<string, unknown>

    function at(root: SchemaNode, ...path: string[]): SchemaNode {
      let node = root
      for (const key of path) node = node[key] as SchemaNode
      return node
    }

    function rootSchema(): SchemaNode {
      return generateJsonSchema() as unknown as SchemaNode
    }

    function globalAgents(): SchemaNode {
      return at(rootSchema(), 'properties', 'config', 'properties', 'agents')
    }

    function hookAgents(): SchemaNode {
      return at(rootSchema(), 'additionalProperties', 'properties', 'agents')
    }

    function eventOverrideAgents(): SchemaNode {
      return at(
        rootSchema(),
        'additionalProperties',
        'properties',
        'events',
        'properties',
        'PreToolUse',
        'properties',
        'agents',
      )
    }

    test('is present at global, hook, and per-event positions', () => {
      expect(globalAgents()).toBeDefined()
      expect(hookAgents()).toBeDefined()
      expect(eventOverrideAgents()).toBeDefined()
    })

    test('is a non-empty array of unrestricted strings at every position', () => {
      for (const node of [globalAgents(), hookAgents(), eventOverrideAgents()]) {
        expect(node.type).toBe('array')
        expect(node.minItems).toBe(1)
        const items = node.items as SchemaNode
        expect(items.type).toBe('string')
        // Any agent id must validate — no enum of known ids
        expect(items.enum).toBeUndefined()
        expect(items.const).toBeUndefined()
      }
    })

    test('is not offered on top-level event entries', () => {
      const properties = at(rootSchema(), 'properties', 'PreToolUse', 'properties')
      expect(Object.keys(properties)).toEqual(['order'])
    })
  })
})
