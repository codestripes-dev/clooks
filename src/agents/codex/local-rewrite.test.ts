import { describe, expect, test } from 'bun:test'
import { codexAdapter } from './adapter.js'
import type { JsonValue } from '../types.js'
import { toolCodec } from './tool-codecs.js'

function wire(tool_name: string, tool_input: unknown) {
  return {
    hook_event_name: 'PreToolUse',
    session_id: 's',
    turn_id: 't',
    cwd: '/project',
    model: 'm',
    permission_mode: 'default',
    tool_use_id: 'call',
    tool_name,
    tool_input,
    tool_response: null,
  }
}

const known: Array<{
  name: string
  input: Record<string, JsonValue>
  required: string[]
  optional: Record<string, JsonValue>
}> = [
  {
    name: 'Write',
    input: { filePath: '/a', content: 'text' },
    required: ['filePath', 'content'],
    optional: {},
  },
  {
    name: 'Edit',
    input: { filePath: '/a', oldString: 'a', newString: 'b' },
    required: ['filePath', 'oldString', 'newString'],
    optional: { replaceAll: false },
  },
  {
    name: 'Read',
    input: { filePath: '/a' },
    required: ['filePath'],
    optional: { offset: 0, limit: 1 },
  },
  { name: 'Glob', input: { pattern: '*' }, required: ['pattern'], optional: { path: '/a' } },
  {
    name: 'Grep',
    input: { pattern: '*' },
    required: ['pattern'],
    optional: { path: '/a', glob: '*', outputMode: 'content', '-i': false, multiline: true },
  },
  {
    name: 'WebFetch',
    input: { url: 'url', prompt: 'prompt' },
    required: ['url', 'prompt'],
    optional: {},
  },
  {
    name: 'WebSearch',
    input: { query: 'query' },
    required: ['query'],
    optional: { allowedDomains: ['a'], blockedDomains: ['b'] },
  },
  {
    name: 'Agent',
    input: { prompt: 'p', description: 'd', subagentType: 's' },
    required: ['prompt', 'description', 'subagentType'],
    optional: { model: 'm' },
  },
]

describe('generic local function object rewriting', () => {
  for (const name of ['update_plan', 'localtools.inspect', 'spawn_agent', 'localtools.Read']) {
    test(`${name} materializes allow and ask sequentially without renaming or mutation`, () => {
      const original = { keep_null: null, remove_key: 1, nested_key: { old_key: true } }
      const raw = wire(name, original)
      const invocation = codexAdapter.normalizeInvocation(raw, 'PreToolUse')
      expect(invocation.context.toolName).toBe(name)
      const policy = codexAdapter.createResultPolicy(invocation)
      let current = invocation.context.toolInput
      for (const result of ['allow', 'ask']) {
        const checked = policy.checkResult({
          value: {
            result,
            reason: 'confirm',
            updatedInput: {
              remove_key: null,
              keep_null: undefined,
              nested_key: { new_key: [false] },
            },
          },
          origin: 'handler',
          parallel: false,
          currentToolInput: current,
        })
        expect(checked.kind).toBe('accepted')
        if (checked.kind !== 'accepted') throw new Error('expected accepted patch')
        current = checked.nextToolInput
        expect(current).toEqual({ keep_null: null, nested_key: { new_key: [false] } })
        expect(checked.result?.updatedInput).toEqual(checked.nextToolInput)
        expect(checked.result?.updatedInput).not.toBe(current)
      }
      expect(raw.tool_input).toEqual(original)
      expect(invocation.context.toolInput).toEqual(original)
      expect(invocation.private.raw.tool_input).toEqual(original)
    })
    test(`${name} refuses non-record input and parallel/non-PreToolUse patches`, () => {
      for (const input of [null, [], false, 1, 'raw']) {
        expect(() => codexAdapter.normalizeInvocation(wire(name, input), 'PreToolUse')).toThrow()
      }
      for (const event of ['PreToolUse', 'PermissionRequest', 'PostToolUse'] as const) {
        const invocation = codexAdapter.normalizeInvocation(wire(name, {}), event)
        if (event !== 'PreToolUse') expect(invocation.private.tool).toBeNull()
        expect(
          codexAdapter.createResultPolicy(invocation).checkResult({
            value: { result: event === 'PostToolUse' ? 'skip' : 'allow', updatedInput: {} },
            origin: 'handler',
            parallel: event === 'PreToolUse',
            currentToolInput: {},
          }).kind,
        ).toBe('rejected')
      }
    })
  }
  for (const row of known) {
    test(`${row.name} validates required and optional public fields at every boundary`, () => {
      const codec = toolCodec(row.name)!
      const original = { ...row.input, ...row.optional }
      expect(codec.decode(original)).toEqual(original)
      for (const key of row.required) {
        for (const value of [null, 42, false, []]) {
          expect(() => codec.applyPatch(original, { [key]: value })).toThrow()
          expect(() => codec.encode({ ...original, [key]: value })).toThrow()
          for (const event of ['PreToolUse', 'PermissionRequest', 'PostToolUse'] as const) {
            expect(() =>
              codexAdapter.normalizeInvocation(
                wire(row.name, { ...original, [key]: value }),
                event,
              ),
            ).toThrow()
          }
        }
      }
      for (const key of Object.keys(row.optional)) {
        for (const value of [{ bad: true }, [1]]) {
          expect(() => codec.applyPatch(original, { [key]: value })).toThrow()
          expect(() => codec.decode({ ...original, [key]: value })).toThrow()
          expect(() => codec.encode({ ...original, [key]: value })).toThrow()
        }
        const removed = codec.applyPatch(original, { [key]: null })
        expect(Object.hasOwn(removed, key)).toBe(false)
        expect(codec.applyPatch(original, { [key]: undefined })).toEqual(original)
      }
      for (const result of ['allow', 'ask']) {
        const invocation = codexAdapter.normalizeInvocation(wire(row.name, original), 'PreToolUse')
        expect(
          codexAdapter.createResultPolicy(invocation).checkResult({
            value: {
              result,
              reason: 'confirm',
              updatedInput: { [row.required[0]!]: null },
              injectContext: 'must not escape',
            },
            origin: 'handler',
            parallel: false,
            currentToolInput: original,
          }).kind,
        ).toBe('rejected')
        expect(invocation.context.toolInput).toEqual(original)
      }
    })
  }
  test('unsupported public question shape remains refused', () => {
    expect(() => toolCodec('AskUserQuestion')!.decode({ questions: [] })).toThrow(
      'compatible public input shape',
    )
  })
})
