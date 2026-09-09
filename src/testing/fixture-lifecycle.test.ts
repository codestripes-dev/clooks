import { describe, expect, test, spyOn } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { runHarness } from '../commands/test.js'

const FIXTURES = join(import.meta.dir, '../../test/fixtures/hooks')
const toolPayload = {
  toolName: 'Bash',
  toolInput: { command: 'echo lifecycle' },
  originalToolInput: { command: 'echo lifecycle' },
  toolUseId: 'tu_fixture_lifecycle',
}

class HarnessExit extends Error {
  constructor(readonly code: number) {
    super(`Harness exited with ${code}`)
  }
}

async function captureHarness(hookPath: string, inputPath: string) {
  const stdout: string[] = []
  const stderr: string[] = []
  const exitSpy = spyOn(process, 'exit').mockImplementation((code) => {
    throw new HarnessExit(Number(code ?? 0))
  })
  const stdoutSpy = spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk))
    return true
  })
  const stderrSpy = spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk))
    return true
  })
  try {
    await runHarness(hookPath, { input: inputPath })
    throw new Error('Harness returned without exiting')
  } catch (error) {
    if (!(error instanceof HarnessExit)) throw error
    return { code: error.code, stdout: stdout.join(''), stderr: stderr.join('') }
  } finally {
    stderrSpy.mockRestore()
    stdoutSpy.mockRestore()
    exitSpy.mockRestore()
  }
}

describe('shared fixture harness contracts', () => {
  test.each([
    { event: 'PreToolUse', payload: toolPayload, result: 'allow' },
    {
      event: 'PostToolUse',
      payload: { ...toolPayload, toolResponse: 'lifecycle' },
      result: 'skip',
    },
    { event: 'UserPromptSubmit', payload: { prompt: 'Check this change' }, result: 'allow' },
  ])('allow-all dispatches $event as $result', async ({ event, payload, result }) => {
    const dir = mkdtempSync(join(tmpdir(), 'clooks-fixture-events-'))
    try {
      const input = join(dir, 'input.json')
      writeFileSync(input, JSON.stringify({ event, ...payload }))
      expect(await captureHarness(join(FIXTURES, 'allow-all.ts'), input)).toEqual({
        code: 0,
        stdout: JSON.stringify({ result }) + '\n',
        stderr: '',
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  for (const decision of ['block', 'skip'] as const) {
    test(`${decision} suppresses otherwise executable handler and observer phases`, async () => {
      const dir = mkdtempSync(join(tmpdir(), `clooks-fixture-${decision}-`))
      try {
        const fixture = join(FIXTURES, `harness-lifecycle-${decision}.ts`)
        const input = join(dir, 'input.json')
        writeFileSync(input, JSON.stringify({ event: 'PreToolUse', ...toolPayload }))

        const expected = {
          code: decision === 'block' ? 1 : 0,
          stdout:
            JSON.stringify(
              decision === 'block'
                ? { result: 'block', reason: 'before-blocked' }
                : { result: 'skip' },
            ) + '\n',
          stderr: 'lifecycle:before;',
        }
        expect(await captureHarness(fixture, input)).toEqual(expected)

        // Positive controls prove the suppressed phases are executable and ordered.
        // Clone the export instead of mutating the cached fixture used by other tests.
        for (const mode of ['absent', 'passthrough'] as const) {
          const control = join(dir, `${mode}.ts`)
          writeFileSync(
            control,
            `import { hook as original } from ${JSON.stringify(fixture)}
const { beforeHook, ...remaining } = original
export const hook = {
  ...remaining,
  ${
    mode === 'passthrough'
      ? `beforeHook(event) {
    process.stderr.write('control:before;')
    return event.passthrough()
  },`
      : ''
  }
}
`,
          )
          expect(await captureHarness(control, input)).toEqual({
            code: 0,
            stdout: '{"result":"allow"}\n',
            stderr:
              (mode === 'passthrough' ? 'control:before;' : '') +
              'lifecycle:handler-RAN;lifecycle:after-RAN;',
          })
        }

        // The controls must not alter subsequent imports of the original fixture.
        expect(await captureHarness(fixture, input)).toEqual(expected)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  }
})
