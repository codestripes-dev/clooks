import { describe, test, expect } from 'bun:test'
import { CancelError, promptText, promptConfirm, promptSelect } from './prompts.js'

describe('prompts', () => {
  describe('non-interactive mode (JSON)', () => {
    const jsonCtx = { json: true }

    test('promptText returns defaultValue', async () => {
      const result = await promptText(jsonCtx, { message: 'Name?', defaultValue: 'default' })
      expect(result).toBe('default')
    })

    test('promptText without default throws', async () => {
      expect(promptText(jsonCtx, { message: 'Name?' })).rejects.toThrow('requires a value')
    })

    test('promptConfirm returns defaultValue', async () => {
      expect(await promptConfirm(jsonCtx, { message: 'Sure?', defaultValue: false })).toBe(false)
    })

    test('promptConfirm returns true when no default', async () => {
      expect(await promptConfirm(jsonCtx, { message: 'Sure?' })).toBe(true)
    })

    test('promptSelect returns defaultValue', async () => {
      const result = await promptSelect(jsonCtx, {
        message: 'Pick one',
        options: [{ value: 'a' as const, label: 'A' }],
        defaultValue: 'a' as const,
      })
      expect(result).toBe('a')
    })

    test('promptSelect without default throws', async () => {
      expect(
        promptSelect(jsonCtx, {
          message: 'Pick one',
          options: [{ value: 'a' as const, label: 'A' }],
        }),
      ).rejects.toThrow('requires a selection')
    })
  })

  describe('CancelError', () => {
    test('is an instance of Error', () => {
      const err = new CancelError()
      expect(err).toBeInstanceOf(Error)
      expect(err.name).toBe('CancelError')
      expect(err.message).toBe('Operation cancelled.')
    })
  })
})
