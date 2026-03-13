import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test'

// Mock @clack/prompts before import
const mockText = mock(() => Promise.resolve('typed-value'))
const mockSelect = mock(() => Promise.resolve('selected'))
const mockConfirm = mock(() => Promise.resolve(true))
const mockIsCancel = mock(() => false)
const mockCancel = mock()

mock.module('@clack/prompts', () => ({
  text: mockText,
  select: mockSelect,
  confirm: mockConfirm,
  isCancel: mockIsCancel,
  cancel: mockCancel,
}))

import {
  CancelError,
  promptText,
  promptConfirm,
  promptSelect,
  isNonInteractive,
} from './prompts.js'

describe('prompts', () => {
  let originalIsTTY: boolean | undefined

  beforeEach(() => {
    originalIsTTY = process.stdin.isTTY
    mockText.mockImplementation(() => Promise.resolve('typed-value'))
    mockSelect.mockImplementation(() => Promise.resolve('selected'))
    mockConfirm.mockImplementation(() => Promise.resolve(true))
    mockIsCancel.mockImplementation(() => false)
  })

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, writable: true })
  })

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

  describe('interactive mode', () => {
    const ctx = { json: false }

    beforeEach(() => {
      Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true })
    })

    test('promptText calls @clack/prompts text() and returns result', async () => {
      const result = await promptText(ctx, { message: 'Name?' })
      expect(result).toBe('typed-value')
      expect(mockText).toHaveBeenCalled()
    })

    test('promptSelect calls @clack/prompts select() and returns result', async () => {
      const result = await promptSelect(ctx, {
        message: 'Pick one',
        options: [{ value: 'selected' as const, label: 'S' }],
      })
      expect(result).toBe('selected')
      expect(mockSelect).toHaveBeenCalled()
    })

    test('promptConfirm calls @clack/prompts confirm() and returns result', async () => {
      const result = await promptConfirm(ctx, { message: 'Sure?' })
      expect(result).toBe(true)
      expect(mockConfirm).toHaveBeenCalled()
    })

    test('promptText throws CancelError when user cancels', async () => {
      mockIsCancel.mockImplementation(() => true)
      mockText.mockImplementation(() => Promise.resolve(Symbol('clack:cancel')))

      await expect(promptText(ctx, { message: 'Name?' })).rejects.toThrow(CancelError)
      expect(mockCancel).toHaveBeenCalled()
    })

    test('promptSelect throws CancelError when user cancels', async () => {
      mockIsCancel.mockImplementation(() => true)
      mockSelect.mockImplementation(() => Promise.resolve(Symbol('clack:cancel')))

      await expect(
        promptSelect(ctx, {
          message: 'Pick',
          options: [{ value: 'a' as const, label: 'A' }],
        }),
      ).rejects.toThrow(CancelError)
    })

    test('promptConfirm throws CancelError when user cancels', async () => {
      mockIsCancel.mockImplementation(() => true)
      mockConfirm.mockImplementation(() => Promise.resolve(Symbol('clack:cancel')))

      await expect(promptConfirm(ctx, { message: 'Sure?' })).rejects.toThrow(CancelError)
    })
  })

  describe('isNonInteractive', () => {
    test('returns true when ctx.json is true', () => {
      expect(isNonInteractive({ json: true })).toBe(true)
    })

    test('returns true when stdin is not a TTY', () => {
      Object.defineProperty(process.stdin, 'isTTY', { value: false, writable: true })
      expect(isNonInteractive({ json: false })).toBe(true)
    })

    test('returns false when not json and stdin is TTY', () => {
      Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true })
      expect(isNonInteractive({ json: false })).toBe(false)
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
