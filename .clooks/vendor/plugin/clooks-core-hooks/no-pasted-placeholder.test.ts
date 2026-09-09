import { describe, expect, test } from 'bun:test'
import type { UserPromptSubmitContext } from './types'
import { hook, hasPastedPlaceholder } from './no-pasted-placeholder'

function makeCtx(prompt: string): UserPromptSubmitContext {
  return {
    event: 'UserPromptSubmit',
    prompt,
    sessionId: 'test-session',
    cwd: '/tmp',
    permissionMode: 'default',
    transcriptPath: '/tmp/transcript.jsonl',
    allow: (opts = {}) => ({ result: 'allow', ...opts }),
    block: (opts) => ({ result: 'block', ...opts }),
    skip: (opts = {}) => ({ result: 'skip', ...opts }),
  } as UserPromptSubmitContext
}

const DEFAULT_CONFIG = {}

describe('hasPastedPlaceholder', () => {
  test.each([
    ['exact placeholder', '[Pasted text #1 +10 lines]', true],
    ['embedded in prompt', 'Please review this: [Pasted text #2 +42 lines] thanks', true],
    ['multi-digit ids', '[Pasted text #15 +1234 lines]', true],
    ['singular line', '[Pasted text #6 +1 line]', true],
    ['multiple placeholders', '[Pasted text #1 +10 lines] and [Pasted text #2 +20 lines]', true],
    ['empty prompt', '', false],
    ['plain prompt', 'fix the bug in foo.ts', false],
    ['near-miss: lowercase', '[pasted text #1 +10 lines]', false],
    ['near-miss: missing #', '[Pasted text 1 +10 lines]', false],
    ['near-miss: missing lines word', '[Pasted text #1 +10]', false],
    ['near-miss: missing + sign', '[Pasted text #4 7 lines]', false],
    ['near-miss: minus sign', '[Pasted text #3 -5 lines]', false],
    ['near-miss: code block mention', 'mention of "Pasted text #1 +10 lines" without brackets', false],
  ])('%s', (_label, input, expected) => {
    expect(hasPastedPlaceholder(input)).toBe(expected)
  })
})

describe('hook.UserPromptSubmit', () => {
  test('skips clean prompts', () => {
    const result = hook.UserPromptSubmit!(makeCtx('hello, please refactor foo.ts'), DEFAULT_CONFIG)
    expect(result.result).toBe('skip')
  })

  test('skips empty prompt', () => {
    const result = hook.UserPromptSubmit!(makeCtx(''), DEFAULT_CONFIG)
    expect(result.result).toBe('skip')
  })

  test('blocks prompt with placeholder', () => {
    const result = hook.UserPromptSubmit!(
      makeCtx('Please review this: [Pasted text #1 +10 lines]'),
      DEFAULT_CONFIG,
    ) as any
    expect(result.result).toBe('block')
    expect(result.reason).toContain('unresolved paste placeholder')
    expect(result.reason).toContain('Re-paste')
    expect(result.debugMessage).toContain('no-pasted-placeholder')
  })

  test('blocks when placeholder appears alone', () => {
    const result = hook.UserPromptSubmit!(
      makeCtx('[Pasted text #7 +250 lines]'),
      DEFAULT_CONFIG,
    ) as any
    expect(result.result).toBe('block')
  })

  test('does not block similar-looking but non-matching text', () => {
    const result = hook.UserPromptSubmit!(
      makeCtx('Reference to "Pasted text #1 +10 lines" without brackets'),
      DEFAULT_CONFIG,
    )
    expect(result.result).toBe('skip')
  })
})
