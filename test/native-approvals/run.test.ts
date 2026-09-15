import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

// Evaluate only the receipt expression, never the Docker/native runner body.
const source = ts.createSourceFile(
  'run.ts',
  readFileSync(join(import.meta.dir, 'run.ts'), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
)
const summary = source.statements
  .filter(ts.isExpressionStatement)
  .map((statement) => statement.expression)
  .filter(ts.isCallExpression)
  .find(
    (call) =>
      ts.isIdentifier(call.expression) &&
      call.expression.text === 'save' &&
      call.arguments[0] &&
      ts.isStringLiteral(call.arguments[0]) &&
      call.arguments[0].text === '/export/passed.json',
  )!

for (const overlapProof of [true, false]) {
  test(`diagnostic summary preserves primed overlap proof ${overlapProof} and readiness`, () => {
    const primed = {
      name: 'codex-overlap-primed-child-control',
      diagnosticOnly: true,
      overlapProof,
      childReadiness: 'direct-native-check',
      ordinaryColdChildReadiness: false,
    }
    const serial = {
      name: 'codex-overlap-serial-child-control',
      diagnosticOnly: true,
      overlapProof: false,
    }
    const ordinary = { name: 'codex-overlap-parent-child' }
    const receipt = runInNewContext(`(${summary.arguments[1]!.getText(source)})`, {
      baseline: false,
      interactiveConfig: 'cli',
      interactiveReadiness: 'input-render',
      diagnostic: false,
      results: [primed, serial, ordinary],
    })
    expect(receipt.diagnosticCases).toEqual([primed, serial])
    expect(receipt.diagnostic).toBe(true)
    expect(receipt.productionEngine).toBe(false)
    expect(receipt.milestoneComplete).toBe(false)
    expect(receipt.cases).toEqual([primed.name, serial.name, ordinary.name])
  })
}
