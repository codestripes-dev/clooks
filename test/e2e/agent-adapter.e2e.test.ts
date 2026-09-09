import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { createSandbox, type Sandbox } from './helpers/sandbox'

const FIXTURES = join(import.meta.dir, '../fixtures')
const loadEvent = (name: string) => readFileSync(join(FIXTURES, 'events', name), 'utf8')
const CLAUDE_ENVIRONMENTS: Record<string, string>[] = [{}, { CLOOKS_AGENT: 'claude-code' }]

let sandbox: Sandbox

afterEach(() => {
  sandbox?.cleanup()
})

function writeAllowHook(s: Sandbox): void {
  s.writeHook(
    'allow-all.ts',
    `
export const hook = {
  meta: { name: "allow-all" },
  PreToolUse() { return { result: "allow" } },
}
`,
  )
  s.writeConfig(`version: "1.0.0"
allow-all: {}
`)
}

function expectClaudeAllowOutput(result: { exitCode: number; stdout: string; stderr: string }) {
  expect(result.exitCode).toBe(0)
  expect(result.stderr).toBe('')
  const output = JSON.parse(result.stdout)
  expect(output).toMatchObject({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
    },
  })
  return output
}

describe('agent adapter selection: compiled binary engine mode', () => {
  test('unset CLOOKS_AGENT uses Claude Code output shape', () => {
    sandbox = createSandbox()
    writeAllowHook(sandbox)

    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })

    expectClaudeAllowOutput(result)
  })

  test('CLOOKS_AGENT=claude-code matches unset Claude Code output shape', () => {
    sandbox = createSandbox()
    writeAllowHook(sandbox)

    const unsetResult = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    const explicitResult = sandbox.run([], {
      stdin: loadEvent('pre-tool-use-bash.json'),
      env: { CLOOKS_AGENT: 'claude-code' },
    })

    expectClaudeAllowOutput(unsetResult)
    expectClaudeAllowOutput(explicitResult)
    expect(JSON.parse(explicitResult.stdout)).toEqual(JSON.parse(unsetResult.stdout))
  })

  test('unknown CLOOKS_AGENT fails closed before engine execution', () => {
    sandbox = createSandbox()

    const result = sandbox.run([], {
      stdin: loadEvent('pre-tool-use-bash.json'),
      env: { CLOOKS_AGENT: 'unknown' },
    })

    expect(result.exitCode).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('unsupported CLOOKS_AGENT "unknown"')
    expect(result.stderr).toContain('Recognized values')
  })

  test('CLOOKS_AGENT=codex enables valid PreToolUse and rejects configured invalid input before import', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'agent-codex-runtime-selection.ts',
      `
import { appendFileSync } from 'fs'
const marker = import.meta.dir + '/agent-codex-runtime-selection.log'
appendFileSync(marker, 'import\\n')
export const hook = {
  meta: { name: 'agent-codex-runtime-selection' },
  PreToolUse() {
    appendFileSync(marker, 'handler\\n')
    return { result: 'allow' }
  },
}
`,
    )
    sandbox.writeConfig(`version: "1.0.0"
agent-codex-runtime-selection: {}
`)

    expectClaudeAllowOutput(sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') }))
    const marker = '.clooks/hooks/agent-codex-runtime-selection.log'
    const baseline = sandbox.readFile(marker)
    expect(baseline).toBe('import\nhandler\n')

    rmSync(join(sandbox.dir, marker), { force: true })
    expect(sandbox.fileExists(marker)).toBe(false)
    const result = sandbox.run([], {
      stdin: JSON.stringify({
        hook_event_name: 'PreToolUse',
        session_id: 'agent-codex-runtime-selection',
        cwd: sandbox.dir,
        transcript_path: null,
        model: 'gpt-5',
        permission_mode: 'default',
        turn_id: 'selection-turn',
        tool_name: 'Bash',
        tool_use_id: 'selection-call',
        tool_input: { command: 'echo selection' },
      }),
      env: { CLOOKS_AGENT: 'codex', CODEX_HOME: join(sandbox.home, '.codex') },
      timeout: 10_000,
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')
    expect(sandbox.fileExists(marker)).toBe(true)
    expect(sandbox.readFile(marker)).toBe(baseline)

    rmSync(join(sandbox.dir, marker), { force: true })
    expect(sandbox.fileExists(marker)).toBe(false)
    const invalid = sandbox.run([], {
      stdin: '{',
      env: { CLOOKS_AGENT: 'codex', CODEX_HOME: join(sandbox.home, '.codex') },
      timeout: 10_000,
    })
    expect(invalid.exitCode).toBe(2)
    expect(invalid.stdout).toBe('')
    expect(invalid.stderr.trim().length).toBeGreaterThan(0)
    expect(sandbox.fileExists(marker)).toBe(false)
  })
})

describe('agent policy boundary: compiled Claude preservation', () => {
  test('handler and lifecycle inputs retain normalized public data without the private envelope', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'agent-policy-envelope.ts',
      `
import { writeFileSync } from 'fs'
const observations = []
function observe(phase, input) {
  observations.push({
    phase,
    keys: Reflect.ownKeys(input).sort(),
    event: input.event,
    sessionId: input.sessionId,
    toolUseId: input.toolUseId,
    toolName: input.toolName,
    toolInput: input.toolInput,
    originalToolInput: input.originalToolInput,
    requestMetadata: input.requestMetadata,
  })
}
export const hook = {
  meta: { name: 'agent-policy-envelope' },
  beforeHook(event) { observe('before', event.input) },
  PreToolUse(ctx) {
    observe('handler', ctx)
    return ctx.allow({ reason: 'public result' })
  },
  afterHook(event) {
    observe('after', event.input)
    observations.push({ phase: 'result', keys: Reflect.ownKeys(event.handlerResult).sort() })
    writeFileSync(import.meta.dir + '/agent-policy-envelope.json', JSON.stringify(observations))
  },
}
`,
    )
    sandbox.writeConfig(`version: "1.0.0"
agent-policy-envelope: {}
`)
    const stdin = JSON.stringify({
      hook_event_name: 'PreToolUse',
      session_id: 'agent-policy-envelope-session',
      tool_use_id: 'agent-policy-tool',
      tool_name: 'Bash',
      tool_input: {
        command: 'echo original',
        nested_data: [{ snake_key: null, keep_flag: false }],
      },
      request_metadata: { wire_key: 'public metadata' },
    })
    const expectedInput = {
      command: 'echo original',
      nestedData: [{ snakeKey: null, keepFlag: false }],
    }
    let defaultOutput: string | undefined
    for (const env of CLAUDE_ENVIRONMENTS) {
      rmSync(join(sandbox.dir, '.clooks/hooks/agent-policy-envelope.json'), { force: true })
      expect(sandbox.fileExists('.clooks/hooks/agent-policy-envelope.json')).toBe(false)
      const result = sandbox.run([], { stdin, env })
      expect(sandbox.fileExists('.clooks/hooks/agent-policy-envelope.json')).toBe(true)
      expect(expectClaudeAllowOutput(result)).toEqual({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          permissionDecisionReason: 'public result',
        },
      })
      const observations = JSON.parse(sandbox.readFile('.clooks/hooks/agent-policy-envelope.json'))
      expect(observations).toEqual([
        ...['before', 'handler', 'after'].map((phase) => ({
          phase,
          keys: [
            'allow',
            'ask',
            'block',
            'defer',
            'event',
            'originalToolInput',
            'parallel',
            'provider',
            'requestMetadata',
            'sessionId',
            'signal',
            'skip',
            'toolInput',
            'toolName',
            'toolUseId',
            'turn',
          ],
          event: 'PreToolUse',
          sessionId: 'agent-policy-envelope-session',
          toolUseId: 'agent-policy-tool',
          toolName: 'Bash',
          toolInput: expectedInput,
          originalToolInput: expectedInput,
          requestMetadata: { wireKey: 'public metadata' },
        })),
        { phase: 'result', keys: ['reason', 'result'] },
      ])
      if (defaultOutput === undefined) defaultOutput = result.stdout
      else expect(result.stdout).toBe(defaultOutput)
    }
  })

  test('afterHook mutation is retained while its returned replacement remains ignored', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'agent-policy-after.ts',
      `
import { writeFileSync } from 'fs'
const phases = []
export const hook = {
  meta: { name: 'agent-policy-after' },
  beforeHook() { phases.push('before') },
  PreToolUse(ctx) {
    phases.push('handler')
    return ctx.allow({ reason: 'before observer', updatedInput: { command: 'echo before observer' } })
  },
  afterHook(event) {
    phases.push('after')
    event.handlerResult.reason = 'after observer'
    event.handlerResult.updatedInput.command = 'echo after observer'
    writeFileSync(import.meta.dir + '/agent-policy-after.json', JSON.stringify(phases))
    return { result: 'block', reason: 'ignored override' }
  },
}
`,
    )
    sandbox.writeConfig(`version: "1.0.0"
agent-policy-after: {}
`)
    let defaultResult: { exitCode: number; stdout: string; stderr: string } | undefined
    for (const env of CLAUDE_ENVIRONMENTS) {
      rmSync(join(sandbox.dir, '.clooks/hooks/agent-policy-after.json'), { force: true })
      expect(sandbox.fileExists('.clooks/hooks/agent-policy-after.json')).toBe(false)
      const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json'), env })
      expect(sandbox.fileExists('.clooks/hooks/agent-policy-after.json')).toBe(true)
      expect(result.exitCode).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          permissionDecisionReason: 'after observer',
          updatedInput: { command: 'echo after observer' },
        },
      })
      expect(result.stderr).toBe(
        'clooks: hook "agent-policy-after" afterHook returned an unrecognized shape (result=block). ' +
          'Expected event.passthrough or void. Treating as no-op.\n',
      )
      expect(JSON.parse(sandbox.readFile('.clooks/hooks/agent-policy-after.json'))).toEqual([
        'before',
        'handler',
        'after',
      ])
      const semanticResult = {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      }
      if (defaultResult === undefined) defaultResult = semanticResult
      else expect(semanticResult).toEqual(defaultResult)
    }
  })

  test('a later hook cannot mutate an accepted nested rewrite through the author-held result', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'agent-policy-detach.ts',
      `
import { appendFileSync } from 'fs'
export const retained = {
  result: 'allow',
  reason: 'accepted reason',
  updatedInput: { nested_payload: { items: [{ snake_key: 'accepted', nullable: null }], enabled: false } },
}
export const hook = {
  meta: { name: 'agent-policy-detach' },
  PreToolUse() {
    appendFileSync(import.meta.dir + '/agent-policy-detach.log', 'producer\\n')
    return retained
  },
}
`,
    )
    sandbox.writeHook(
      'agent-policy-mutate.ts',
      `
import { appendFileSync, writeFileSync } from 'fs'
import { retained } from './agent-policy-detach.ts'
export const hook = {
  meta: { name: 'agent-policy-mutate' },
  PreToolUse(ctx) {
    retained.reason = 'late mutation'
    retained.updatedInput.nested_payload.items[0].snake_key = 'late mutation'
    retained.updatedInput.nested_payload.items.push({ snake_key: 'added', nullable: null })
    retained.updatedInput.nested_payload.enabled = true
    appendFileSync(import.meta.dir + '/agent-policy-detach.log', 'mutator\\n')
    writeFileSync(import.meta.dir + '/agent-policy-detach.json', JSON.stringify({
      author: retained,
      current: ctx.toolInput,
      original: ctx.originalToolInput,
    }))
    return ctx.skip()
  },
}
`,
    )
    sandbox.writeConfig(`version: "1.0.0"
agent-policy-detach: {}
agent-policy-mutate: {}
PreToolUse:
  order: [agent-policy-detach, agent-policy-mutate]
`)
    const stdin = JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'echo unchanged', timeout: 0, description: '' },
    })
    const original = { command: 'echo unchanged', timeout: 0, description: '' }
    const updatedInput = {
      ...original,
      nested_payload: { items: [{ snake_key: 'accepted', nullable: null }], enabled: false },
    }
    let defaultOutput: string | undefined
    for (const env of CLAUDE_ENVIRONMENTS) {
      rmSync(join(sandbox.dir, '.clooks/hooks/agent-policy-detach.json'), { force: true })
      expect(sandbox.fileExists('.clooks/hooks/agent-policy-detach.json')).toBe(false)
      sandbox.writeFile('.clooks/hooks/agent-policy-detach.log', '')
      const result = sandbox.run([], { stdin, env })
      expect(sandbox.fileExists('.clooks/hooks/agent-policy-detach.json')).toBe(true)
      expect(expectClaudeAllowOutput(result)).toEqual({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          permissionDecisionReason: 'accepted reason',
          updatedInput,
        },
      })
      expect(sandbox.readFile('.clooks/hooks/agent-policy-detach.log')).toBe('producer\nmutator\n')
      const observed = JSON.parse(sandbox.readFile('.clooks/hooks/agent-policy-detach.json'))
      expect(observed.current).toEqual(updatedInput)
      expect(observed.original).toEqual(original)
      expect(observed.author).toEqual({
        result: 'allow',
        reason: 'late mutation',
        updatedInput: {
          nested_payload: {
            items: [
              { snake_key: 'late mutation', nullable: null },
              { snake_key: 'added', nullable: null },
            ],
            enabled: true,
          },
        },
      })
      if (defaultOutput === undefined) defaultOutput = result.stdout
      else expect(result.stdout).toBe(defaultOutput)
    }
  })
})
