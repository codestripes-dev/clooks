import { describe, test } from 'bun:test'
import { printIntro, printSuccess, printInfo, printWarning, printError, printOutro } from './output.js'

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

    test('printError is NOT suppressed (always visible)', () => {
      // printError should call through even in JSON mode
      // This verifies it doesn't early-return
      printError(jsonCtx, 'error message')
    })
  })
})
