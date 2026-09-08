import { describe, expect, test } from 'bun:test'
import { isJsonValue, jsonRecord, materializePatch, toolCodec } from './tool-codecs.js'

describe('Codex tool input codecs', () => {
  test.each(['Bash', 'exec_command', 'apply_patch'])('%s replaces only command', (name) => {
    const codec = toolCodec(name)!
    const original = codec.decode({ command: 'old' })
    const next = codec.applyPatch(original, { command: 'new' })
    expect(codec.encode(next)).toEqual({ command: 'new' })
    expect(original).toEqual({ command: 'old' })
    expect(codec.canonicalName).toBe(name === 'exec_command' ? 'Bash' : name)
    expect(() => codec.applyPatch(original, { command: null })).toThrow()
    expect(() => codec.applyPatch(original, { timeout: 5 })).toThrow()
    expect(codec.applyPatch(original, { command: undefined })).toEqual(original)
    expect(codec.applyPatch(original, { command: '' })).toEqual({ command: '' })
  })

  test('partial materialization preserves untouched null and opaque nested spelling', () => {
    const original = { keep_null: null, remove_me: 1, nested_key: { old_key: true } }
    const patch = { remove_me: null, ignored: undefined, nested_key: { new_key: [null, false] } }
    const next = materializePatch(original, patch)
    expect(next).toEqual({ keep_null: null, nested_key: { new_key: [null, false] } })
    patch.nested_key.new_key.push(true)
    expect(next).toEqual({ keep_null: null, nested_key: { new_key: [null, false] } })
    expect(next.nested_key).not.toBe(patch.nested_key)
    expect(original.nested_key).toEqual({ old_key: true })
  })

  test('opaque tools are observable records without an approved rewrite codec', () => {
    expect(toolCodec('unknown_tool')).toBeNull()
    expect(jsonRecord({ opaque_key: [null, { nested_key: false }] })).toEqual({
      opaque_key: [null, { nested_key: false }],
    })
    for (const value of [null, [], 1, 'input', false, { bad: undefined }]) {
      expect(() => jsonRecord(value)).toThrow()
    }
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    expect(isJsonValue(cycle)).toBe(false)
    expect(isJsonValue({ number: Infinity })).toBe(false)
  })

  test('patch own keys remain data, including prototype-like names', () => {
    const patch = JSON.parse('{"__proto__":{"opaque_key":true},"constructor":null}')
    const next = materializePatch({ constructor: 'remove' }, patch)
    expect(Object.keys(next)).toEqual(['__proto__'])
    expect(Object.getPrototypeOf(next)).toBe(Object.prototype)
    expect(next.__proto__).toEqual({ opaque_key: true })
  })

  test('MCP full replacement preserves opaque own keys and detaches nested values', () => {
    const codec = toolCodec('mcp__server__call')!
    const raw = JSON.parse(
      '{"__proto__":{"snake_key":null},"constructor":{"keep_key":false},"keep_null":null,"keep_value":1,"delete_value":2}',
    )
    const input = codec.decode(raw)
    const patch = { keep_value: undefined, delete_value: null, added_key: [{ child_key: true }] }
    const candidate = codec.applyPatch(input, patch)
    const encoded = codec.encode(candidate)
    patch.added_key[0]!.child_key = false
    raw.__proto__.snake_key = 'changed'
    expect(JSON.parse(JSON.stringify(encoded))).toEqual(
      JSON.parse(
        '{"__proto__":{"snake_key":null},"constructor":{"keep_key":false},"keep_null":null,"keep_value":1,"added_key":[{"child_key":true}]}',
      ),
    )
    expect(Object.getPrototypeOf(candidate)).toBe(Object.prototype)
    expect(input.delete_value).toBe(2)
  })
})
