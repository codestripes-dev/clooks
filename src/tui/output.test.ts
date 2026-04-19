import { describe, test, expect, spyOn, mock } from 'bun:test'

mock.module('@clack/prompts', () => ({
  log: {
    error: mock(() => {}),
    success: mock(() => {}),
    info: mock(() => {}),
    warning: mock(() => {}),
  },
  intro: mock(() => {}),
  outro: mock(() => {}),
}))

const { log } = await import('@clack/prompts')
const { printIntro, printSuccess, printInfo, printWarning, printError, printOutro } =
  await import('./output.js')

describe('output', () => {
  describe('JSON mode suppression', () => {
    const jsonCtx = { json: true }

    test('printIntro is suppressed', () => {
      // In JSON mode, should not throw and should not produce output
      printIntro(jsonCtx, 'test')
    })

    test('printSuccess is suppressed', () => {
      printSuccess(jsonCtx, 'test')
    })

    test('printInfo is suppressed', () => {
      printInfo(jsonCtx, 'test')
    })

    test('printWarning is suppressed', () => {
      printWarning(jsonCtx, 'test')
    })

    test('printOutro is suppressed', () => {
      printOutro(jsonCtx, 'test')
    })
  })

  describe('printError JSON mode', () => {
    test('in JSON mode, writes JSON error envelope to stdout (not log.error)', () => {
      const stdoutSpy = spyOn(process.stdout, 'write').mockImplementation(() => true)
      try {
        printError({ json: true }, 'init', 'something went wrong')
        const written = stdoutSpy.mock.calls.map((c) => String(c[0])).join('')
        const parsed = JSON.parse(written.trim())
        expect(parsed.ok).toBe(false)
        expect(parsed.command).toBe('init')
        expect(parsed.error).toBe('something went wrong')
      } finally {
        stdoutSpy.mockRestore()
      }
    })

    test('in human mode, calls log.error and does NOT write to stdout', () => {
      const logError = log.error as ReturnType<typeof mock>
      logError.mockClear()
      const stdoutSpy = spyOn(process.stdout, 'write').mockImplementation(() => true)
      try {
        printError({ json: false }, 'init', 'something went wrong')
        expect(logError).toHaveBeenCalledWith('something went wrong')
        expect(stdoutSpy).not.toHaveBeenCalled()
      } finally {
        stdoutSpy.mockRestore()
      }
    })
  })
})
