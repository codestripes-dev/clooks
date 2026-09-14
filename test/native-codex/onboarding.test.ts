import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  assertSkill,
  assertRuntimeRegistration,
  deniedToolOutput,
  onboardingCases,
  onboardingPin,
  onboardingPacks,
  onboardingProvider,
  pendingSession,
  publishOnboarding,
  toolOutput,
} from './onboarding'
import { save } from './harness'
import { CODEX_REGISTRATION_EVENTS } from '../../src/agents/codex/settings'

function runtimeRegistration(): Record<string, any[]> {
  return Object.fromEntries(
    CODEX_REGISTRATION_EVENTS.map((event) => [
      event,
      [
        {
          matcher: '*',
          hooks: [
            {
              type: 'command',
              command: 'CLOOKS_AGENT=codex entrypoint',
              ...(event === 'SessionEnd' || event === 'Interrupt' ? { timeout: 3 } : {}),
            },
          ],
        },
      ],
    ]),
  )
}

test('runtime registration accepts all twelve current events including bounded Interrupt', () => {
  expect(() => assertRuntimeRegistration(runtimeRegistration())).not.toThrow()
})
test.each([
  'missing',
  'extra',
  'replacement',
  'duplicate-group',
  'duplicate-command',
  'timeout',
  'missing-timeout',
  'end-timeout',
  'unbounded-timeout',
  'matcher',
  'command',
])('runtime registration rejects %s', (mutation) => {
  const hooks = runtimeRegistration()
  if (mutation === 'missing') delete hooks.Interrupt
  if (mutation === 'extra') hooks.Unknown = hooks.Stop!
  if (mutation === 'replacement') {
    hooks.Unknown = hooks.Interrupt!
    delete hooks.Interrupt
  }
  if (mutation === 'duplicate-group') hooks.Interrupt!.push(hooks.Interrupt![0])
  if (mutation === 'duplicate-command') hooks.Interrupt![0].hooks.push(hooks.Interrupt![0].hooks[0])
  if (mutation === 'timeout') hooks.Interrupt![0].hooks[0].timeout = 1
  if (mutation === 'missing-timeout') delete hooks.Interrupt![0].hooks[0].timeout
  if (mutation === 'end-timeout') hooks.SessionEnd![0].hooks[0].timeout = 1
  if (mutation === 'unbounded-timeout') hooks.Stop![0].hooks[0].timeout = 3
  if (mutation === 'matcher') hooks.Interrupt![0].matcher = 'wrong'
  if (mutation === 'command') hooks.Interrupt![0].hooks[0].type = 'prompt'
  expect(() => assertRuntimeRegistration(hooks)).toThrow()
})
test.each([{ hooks: null }, { hooks: [] }, { hooks: {} }, { hooks: false }])(
  'runtime registration rejects malformed root %j',
  ({ hooks }) => {
    expect(() => assertRuntimeRegistration(hooks)).toThrow('exact twelve-event inventory')
  },
)

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
test('expected denial requires exact attributed hook reason and command, not a process failure', () => {
  const command = 'printf one && printf two'
  const reason = 'Compound command detected. Instead:\n  - Run commands separately'
  const output = `Command blocked by PreToolUse hook: ${reason}. Command: ${command}`
  const result = (text: string, callId = 'deny') => ({
    input: [{ type: 'function_call_output', call_id: callId, output: text }],
  })
  expect(deniedToolOutput(result(output), 'deny', reason, command)).toBe(output)
  for (const text of [
    'Process exited with code 1\n',
    'Process exited with code 0\n',
    'Process running with session ID 1\n',
    'Error: tool failed',
    output + '\n',
    output.replace(reason, 'another hook'),
    output.replace(command, 'different command'),
  ]) {
    expect(() => deniedToolOutput(result(text), 'deny', reason, command)).toThrow(
      'Unexpected denial',
    )
  }
  expect(() => deniedToolOutput(result(output, 'other'), 'deny', reason, command)).toThrow(
    'Missing actual tool result',
  )
  expect(() => deniedToolOutput(body(output), 'deny', reason, command)).toThrow(
    'Missing actual tool result',
  )
  expect(() => deniedToolOutput(result(output), 'deny', '', command)).toThrow(
    'Missing expected denial',
  )
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
    save(join(logs, id, 'passed.json'), {
      id,
      status: 'passed',
      codexSha256: onboardingPin,
      ...(id === 'ONBOARDING-INSTALL' ? { createHook: true } : {}),
      ...(id === 'ONBOARDING-REUSE-REMOVE'
        ? {
            packs: {
              installed: onboardingPacks,
              denial: true,
              idempotent: true,
              cachePreserved: true,
              explicitUpdate: true,
            },
          }
        : {}),
    })
    save(join(logs, id, 'cleanup.json'), { removed: true })
  }
  const id = 'ONBOARDING-REUSE-REMOVE'
  const installReceipt = join(logs, 'ONBOARDING-INSTALL', 'passed.json')
  for (const createHook of [undefined, false]) {
    rmSync(installReceipt)
    save(installReceipt, {
      id: 'ONBOARDING-INSTALL',
      status: 'passed',
      codexSha256: onboardingPin,
      createHook,
    })
    expect(() => publishOnboarding(logs, 0)).toThrow('Missing native create-hook receipt')
    expect(existsSync(join(logs, 'passed.json'))).toBe(false)
  }
  rmSync(installReceipt)
  save(installReceipt, {
    id: 'ONBOARDING-INSTALL',
    status: 'passed',
    codexSha256: onboardingPin,
    createHook: true,
  })
  const receiptPath = join(logs, id, 'passed.json')
  const receipt = { id, status: 'passed', codexSha256: onboardingPin }
  const good = {
    installed: onboardingPacks,
    denial: true,
    idempotent: true,
    cachePreserved: true,
    explicitUpdate: true,
  }
  const mutants: any[] = [
    undefined,
    { ...good, installed: onboardingPacks.slice(1) },
    { ...good, installed: [...onboardingPacks].reverse() },
  ]
  for (const flag of ['denial', 'idempotent', 'cachePreserved', 'explicitUpdate']) {
    mutants.push({ ...good, [flag]: false })
    const missing: any = { ...good }
    delete missing[flag]
    mutants.push(missing)
  }
  for (const packs of mutants) {
    rmSync(receiptPath)
    save(receiptPath, { ...receipt, packs })
    expect(() => publishOnboarding(logs, 0)).toThrow('Missing native pack receipt')
    expect(existsSync(join(logs, 'passed.json'))).toBe(false)
  }
  rmSync(receiptPath)
  save(receiptPath, { ...receipt, packs: good })
  expect(publishOnboarding(logs, 0)).toBe(0)
  expect(existsSync(join(logs, 'clooks'))).toBe(false)
})

test('provider rejects pending original output on an expected-denial turn without polling', async () => {
  const logs = mkdtempSync('/tmp/clooks-onboarding-pending-denial-')
  directories.push(logs)
  let completed = false
  const provider = onboardingProvider(
    logs,
    '/tmp',
    [
      {
        prompt: 'DENY_FIXTURE',
        done: 'DENY_DONE',
        commands: ['touch one && touch two'],
        denialReason: 'fixture denial',
        inspect() {},
        complete() {
          completed = true
        },
      },
    ],
    '0.3.0',
  )
  try {
    const post = (input: any[]) =>
      fetch(`http://127.0.0.1:${provider.port}/v1/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input, tools: [{ name: 'exec_command' }, { name: 'write_stdin' }] }),
      })
    const prompt = body('DENY_FIXTURE').input
    const first = await post(prompt)
    expect(first.status).toBe(200)
    expect(await first.text()).toContain('onboarding_0_0')
    const second = await post([
      ...prompt,
      {
        type: 'function_call_output',
        call_id: 'onboarding_0_0',
        output: 'Process running with session ID 4201\nOutput:\n',
      },
    ])
    expect(second.status).toBe(409)
    expect(await second.text()).toContain('Unexpected denial output')
    expect(provider.errors).toHaveLength(1)
    expect(completed).toBe(false)
    expect(() => provider.assertComplete()).toThrow('Incomplete onboarding provider')
  } finally {
    await provider.stop()
  }
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
