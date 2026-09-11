import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  assertSkill,
  onboardingCases,
  onboardingPin,
  pendingSession,
  publishOnboarding,
  toolOutput,
} from './onboarding'
import { save } from './harness'

const directories: string[] = []
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true })
})
const skill = '# Fixture setup\nOnly explicitly.'
function body(text: string, role = 'user') {
  return { input: [{ type: 'message', role, content: [{ type: 'input_text', text }] }] }
}

test('full explicit skill body is required and absent from ordinary requests', () => {
  expect(() => assertSkill(body(`<skill>${skill}</skill>`), skill, true)).not.toThrow()
  expect(() => assertSkill(body('Hello'), skill, false)).not.toThrow()
  expect(() => assertSkill(body(`<skill>${skill}</skill>`), skill, false)).toThrow()
})
test.each(['truncated', 'assistant', 'metadata'])('rejects false skill evidence: %s', (mutant) => {
  const sample: any =
    mutant === 'assistant'
      ? body(`<skill>${skill}</skill>`, 'assistant')
      : mutant === 'metadata'
        ? { input: [{ metadata: `<skill>${skill}</skill>` }] }
        : body('<skill># Fixture setup</skill>')
  expect(() => assertSkill(sample, skill, true)).toThrow('Missing full explicit skill')
})
test('rejects Claude setup content and requires attributed native tool output', () => {
  expect(() => assertSkill(body('# Clooks Runtime Setup'), skill, false)).toThrow(
    'Claude setup leaked',
  )
  const result = {
    input: [
      {
        type: 'function_call_output',
        call_id: 'a',
        output: 'Process exited with code 0\nOutput:\n/selected/clooks\n',
      },
    ],
  }
  expect(toolOutput(result, 'a')).toContain('/selected/clooks')
  expect(() => toolOutput(result, 'b')).toThrow('Missing actual tool result')
  expect(() => toolOutput(result, 'a', 1)).toThrow('Tool failed')
  expect(() => toolOutput(body('Process exited with code 0\n'), 'a')).toThrow()
})
test('distinguishes pending native sessions from completed tool output', () => {
  expect(pendingSession('Process running with session ID 4201\nOutput:\ndownloading')).toBe(4201)
  expect(pendingSession('Process exited with code 0\nOutput:\n')).toBeUndefined()
  expect(() =>
    toolOutput(
      {
        input: [
          {
            type: 'function_call_output',
            call_id: 'pending',
            output: 'Process running with session ID 4201\nOutput:\n',
          },
        ],
      },
      'pending',
    ),
  ).toThrow('Tool failed')
})
test('onboarding completion requires all receipts, cleanup, and real test success', () => {
  const logs = mkdtempSync('/tmp/clooks-onboarding-publication-')
  directories.push(logs)
  save(join(logs, 'completed.json'), {
    mode: '--onboarding',
    completed: onboardingCases.length,
    cases: onboardingCases,
  })
  expect(publishOnboarding(logs, 1)).toBe(1)
  expect(existsSync(join(logs, 'passed.json'))).toBe(false)
  expect(() => publishOnboarding(logs, 0)).toThrow()
  for (const id of onboardingCases) {
    mkdirSync(join(logs, id))
    save(join(logs, id, 'passed.json'), { id, status: 'passed', codexSha256: onboardingPin })
    save(join(logs, id, 'cleanup.json'), { removed: true })
  }
  expect(publishOnboarding(logs, 0)).toBe(0)
  expect(existsSync(join(logs, 'clooks'))).toBe(false)
})
test('onboarding cannot publish a conformance-mode completion', () => {
  const logs = mkdtempSync('/tmp/clooks-onboarding-publication-')
  directories.push(logs)
  save(join(logs, 'completed.json'), {
    mode: '--smoke',
    completed: onboardingCases.length,
    cases: onboardingCases,
  })
  expect(() => publishOnboarding(logs, 0)).toThrow('Incomplete onboarding cases')
})
