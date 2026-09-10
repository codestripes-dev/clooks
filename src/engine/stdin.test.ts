import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  EMPTY_STDIN_DIAGNOSTIC,
  EmptyStdinError,
  formatStdinError,
  readStdinJson,
} from './stdin.js'

let bytesSpy: ReturnType<typeof spyOn<typeof Bun.stdin, 'bytes'>> | undefined

afterEach(() => bytesSpy?.mockRestore())

describe('readStdinJson', () => {
  test.each(['', ' ', '\t', '\r', '\n', ' \t\r\n \n'])('rejects empty input %j', async (input) => {
    bytesSpy = spyOn(Bun.stdin, 'bytes').mockResolvedValue(new TextEncoder().encode(input))
    await expect(readStdinJson()).rejects.toBeInstanceOf(EmptyStdinError)
    expect(bytesSpy).toHaveBeenCalledTimes(1)
  })

  const fixtures = [
    ...[
      '\uFEFF',
      '\uFEFF \t\r\n',
      '\uFEFF{}',
      '\uFEFF{',
      '\u00a0',
      '\u0000',
      '\v',
      '\f',
      '{',
      '{"a":}',
      '{} trailing',
      '"unterminated',
      'null',
      'true',
      'false',
      '42',
      '"text"',
      '[1,2]',
      '{"text":"\u00e9","escaped":"\\n"}',
      ' \r\n{}\t',
    ].map((s) => new TextEncoder().encode(s)),
    new Uint8Array([0xff]),
    new Uint8Array([34, 0xc3, 34]),
    new Uint8Array([0xef, 0xbb]),
  ]

  test.each(fixtures.map((bytes, index) => ({ bytes, index })))(
    'matches native Blob.json fixture $index',
    async ({ bytes }) => {
      bytesSpy = spyOn(Bun.stdin, 'bytes').mockResolvedValue(bytes)
      const baseline = await Promise.allSettled([new Blob([bytes]).json()])
      const actual = await Promise.allSettled([readStdinJson()])
      expect(actual[0]!.status).toBe(baseline[0]!.status)
      const expected = baseline[0]!
      const received = actual[0]!
      if (expected.status === 'fulfilled' && received.status === 'fulfilled') {
        expect(received.value).toEqual(expected.value)
      } else if (expected.status === 'rejected' && received.status === 'rejected') {
        expect(received.reason).not.toBeInstanceOf(EmptyStdinError)
        expect(received.reason.name).toBe(expected.reason.name)
        expect(received.reason.message).toBe(expected.reason.message)
      }
      expect(bytesSpy).toHaveBeenCalledTimes(1)
    },
  )

  test.each(fixtures.map((bytes, index) => ({ bytes, index })))(
    'matches original Bun.stdin.json subprocess fixture $index',
    async ({ bytes }) => {
      const home = mkdtempSync(join(tmpdir(), 'clooks-native-stdin-'))
      try {
        const baseline = Bun.spawnSync(
          [process.execPath, join(import.meta.dir, '../../test/fixtures/native-stdin-json.ts')],
          {
            stdin: new Blob([bytes]),
            stdout: 'pipe',
            stderr: 'pipe',
            cwd: home,
            env: { HOME: home, CLOOKS_HOME_ROOT: home, TMPDIR: home },
            timeout: 2000,
          },
        )
        expect(baseline.exitCode).toBe(0)
        expect(baseline.signalCode ?? null).toBeNull()
        expect(baseline.stderr.toString()).toBe('')
        bytesSpy = spyOn(Bun.stdin, 'bytes').mockResolvedValue(bytes)
        const actual = await readStdinJson().then(
          (value) => ({ status: 'fulfilled', value }),
          (error: unknown) => {
            expect(error).not.toBeInstanceOf(EmptyStdinError)
            if (!(error instanceof Error)) throw error
            return { status: 'rejected', name: error.name, message: error.message }
          },
        )
        expect(actual).toEqual(JSON.parse(baseline.stdout.toString()))
        expect(bytesSpy).toHaveBeenCalledTimes(1)
      } finally {
        rmSync(home, { recursive: true, force: true })
      }
    },
  )

  test('propagates reader rejection unchanged', async () => {
    const error = new Error('read failed')
    bytesSpy = spyOn(Bun.stdin, 'bytes').mockRejectedValue(error)
    await expect(readStdinJson()).rejects.toBe(error)
  })
})

describe('formatStdinError', () => {
  test('recognizes only the dedicated error and owns no trailing newline', () => {
    expect(formatStdinError(new EmptyStdinError())).toBe(EMPTY_STDIN_DIAGNOSTIC)
    expect(EMPTY_STDIN_DIAGNOSTIC.endsWith('\n')).toBe(false)
    expect(formatStdinError(new Error(EMPTY_STDIN_DIAGNOSTIC))).toBe(
      `clooks: failed to parse stdin JSON: ${EMPTY_STDIN_DIAGNOSTIC}`,
    )
  })

  test.each([new SyntaxError('bad JSON'), 'bad JSON', null, 42])(
    'preserves generic error %s',
    (error) => {
      expect(formatStdinError(error)).toBe(
        `clooks: failed to parse stdin JSON: ${error instanceof Error ? error.message : String(error)}`,
      )
    },
  )
})
