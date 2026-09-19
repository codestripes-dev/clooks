import { afterEach, describe, expect, test } from 'bun:test'
import { rmSync } from 'fs'
import { join } from 'path'
import { createSandbox, type RunResult, type Sandbox } from './helpers/sandbox'

let sandbox: Sandbox
const marker = '.clooks/agent-codex-events.log'
const observation = '.clooks/agent-codex-events.json'
const name = 'agent-codex-events'
const events = [
  'SessionStart',
  'SubagentStart',
  'PermissionRequest',
  'PostToolUse',
  'PreCompact',
  'PostCompact',
  'UserPromptSubmit',
  'SubagentStop',
  'Stop',
] as const
type Event = (typeof events)[number]

afterEach(() => sandbox?.cleanup())

// Source-shaped release envelopes; no native Codex process runs in this suite.
function wire(event: Event, overrides: Record<string, unknown> = {}) {
  const fields: Record<Event, Record<string, unknown>> = {
    SessionStart: { permission_mode: 'default', source: 'startup' },
    SubagentStart: {
      permission_mode: 'default',
      turn_id: 'turn',
      agent_id: 'child',
      agent_type: 'worker',
    },
    PermissionRequest: {
      permission_mode: 'default',
      turn_id: 'turn',
      tool_name: 'Bash',
      tool_input: { command: 'echo approval' },
    },
    PostToolUse: {
      permission_mode: 'default',
      turn_id: 'turn',
      tool_name: 'Bash',
      tool_use_id: 'call',
      tool_input: { command: 'echo completed' },
      tool_response: null,
    },
    PreCompact: { turn_id: 'turn', trigger: 'auto' },
    PostCompact: { turn_id: 'turn', trigger: 'auto' },
    UserPromptSubmit: { permission_mode: 'default', turn_id: 'turn', prompt: 'hello' },
    SubagentStop: {
      permission_mode: 'default',
      turn_id: 'turn',
      agent_id: 'child',
      agent_type: 'worker',
      agent_transcript_path: null,
      stop_hook_active: false,
      last_assistant_message: null,
    },
    Stop: {
      permission_mode: 'default',
      turn_id: 'turn',
      stop_hook_active: false,
      last_assistant_message: null,
    },
  }
  return {
    hook_event_name: event,
    session_id: 'agent-codex-events-session',
    cwd: sandbox.dir,
    transcript_path: null,
    model: 'gpt-5',
    ...fields[event],
    ...overrides,
  }
}

function replay(event: Event, overrides: Record<string, unknown> = {}, agent = 'codex') {
  for (const file of [marker, observation]) {
    rmSync(join(sandbox.dir, file), { force: true })
    expect(sandbox.fileExists(file)).toBe(false)
  }
  return sandbox.run([], {
    stdin: JSON.stringify(wire(event, overrides)),
    timeout: 10_000,
    env: { CLOOKS_AGENT: agent, CODEX_HOME: join(sandbox.home, '.codex') },
  })
}

function install(event: Event, body: string, lifecycle = '', settings = '{}') {
  sandbox.writeHook(
    `${name}.ts`,
    `
import { appendFileSync, writeFileSync } from 'fs'
const mark = text => appendFileSync(${JSON.stringify(join(sandbox.dir, marker))}, text + '\\n')
const observe = value => writeFileSync(${JSON.stringify(join(sandbox.dir, observation))}, JSON.stringify(value))
mark('import')
export const hook = {
  meta: { name: '${name}' },
  ${event}(ctx) { mark('handler'); ${body} },
  ${lifecycle}
}
`,
  )
  sandbox.writeConfig(`version: "1.0.0"\n${name}: ${settings}\n`)
}

function marks(expected = 'import\nhandler\n') {
  expect(sandbox.fileExists(marker)).toBe(true)
  expect(sandbox.readFile(marker)).toBe(expected)
}

function observed() {
  expect(sandbox.fileExists(observation)).toBe(true)
  return JSON.parse(sandbox.readFile(observation))
}

function output(result: RunResult, expected?: unknown) {
  expect(result.exitCode).toBe(0)
  expect(result.stderr).toBe('')
  if (expected === undefined) expect(result.stdout).toBe('')
  else expect(JSON.parse(result.stdout)).toEqual(expected)
}

const dispositions: Record<Event, string> = {
  SessionStart: 'Pending turn work termination requested.',
  SubagentStart:
    'Local hook failure only; no native startup veto is available and detailed stderr may be discarded.',
  PermissionRequest: 'Pending approval denial requested.',
  PostToolUse: 'Rejected-result feedback requested after execution; no rollback is possible.',
  PreCompact: 'Stop before compaction requested.',
  PostCompact: 'Local hook failure after compaction; no rollback or native veto is requested.',
  UserPromptSubmit: 'Inspected prompt rejection requested.',
  SubagentStop: 'Child continuation termination requested; no further continuation is requested.',
  Stop: 'Continuation termination requested; no further continuation is requested.',
}

function failure(result: RunResult, event: Event, message: string) {
  if (event === 'SubagentStart' || event === 'PostCompact') {
    expect(result.exitCode).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe(message + '\n')
  } else if (event === 'PermissionRequest') {
    output(result, {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'deny', message },
      },
      systemMessage: message,
    })
  } else if (event === 'PostToolUse' || event === 'UserPromptSubmit') {
    output(result, { decision: 'block', reason: message, systemMessage: message })
  } else {
    output(result, { continue: false, stopReason: message, systemMessage: message })
  }
}

describe('Codex event no-ops, public envelopes and lifecycle', () => {
  for (const event of events) {
    test(`${event}: source-shaped input reaches a real skip handler without native control output`, () => {
      sandbox = createSandbox()
      install(
        event,
        `observe({ event: ctx.event, agent: ctx.agent, sessionId: ctx.sessionId, transcriptPath: ctx.transcriptPath,
        model: ctx.model,
        privateKeys: ['private', 'raw', 'nativeTurnId', 'codec', ${event === 'SessionStart' ? '' : "'model'"}].filter(key => Object.hasOwn(ctx, key)) }); return ctx.skip()`,
      )
      output(replay(event))
      marks()
      expect(observed()).toEqual({
        event,
        agent: 'codex',
        sessionId: 'agent-codex-events-session',
        transcriptPath: '',
        privateKeys: [],
        ...(event === 'SessionStart' ? { model: 'gpt-5' } : {}),
      })
    })

    test(`${event}: beforeHook skip bypasses a reachable handler`, () => {
      sandbox = createSandbox()
      install(event, 'return ctx.skip()')
      output(replay(event))
      marks()
      install(
        event,
        "throw new Error('must be skipped')",
        "beforeHook(event) { mark('before'); return event.skip() },",
      )
      output(replay(event))
      marks('import\nbefore\n')
    })

    test(`${event}: required model omission fails before import after a positive control`, () => {
      sandbox = createSandbox()
      install(event, 'return ctx.skip()')
      output(replay(event))
      marks()
      failure(
        replay(event, { model: undefined }),
        event,
        `clooks: Codex ${event} hook "runtime" capability "model": model must be a nonempty string; hooks were not imported or executed. ${dispositions[event]}`,
      )
      expect(sandbox.fileExists(marker)).toBe(false)
      expect(sandbox.fileExists(observation)).toBe(false)
    })

    test(`${event}: falsy foreign control is rejected after lifecycle mutation`, () => {
      sandbox = createSandbox()
      install(event, 'return ctx.skip()')
      output(replay(event))
      marks()
      install(
        event,
        'return ctx.skip()',
        "afterHook(event) { mark('after'); event.handlerResult.continue = false },",
      )
      failure(
        replay(event),
        event,
        `clooks: Codex ${event} hook "${name}" capability "continue": unsupported field continue on skip; result effects refused. ${dispositions[event]}`,
      )
      marks('import\nhandler\nafter\n')
    })
  }
})

describe('Codex supported event decisions and context', () => {
  for (const event of ['SessionStart', 'SubagentStart'] as const) {
    test(`${event}: skip context remains inline with the emitting session and child identity`, () => {
      sandbox = createSandbox()
      install(
        event,
        `observe({ sessionId: ctx.sessionId, agentId: ctx.agentId, agentType: ctx.agentType }); return ctx.skip({ injectContext: 'context' })`,
      )
      output(replay(event), {
        hookSpecificOutput: { hookEventName: event, additionalContext: 'context' },
      })
      marks()
      expect(observed()).toEqual(
        event === 'SubagentStart'
          ? { sessionId: 'agent-codex-events-session', agentId: 'child', agentType: 'worker' }
          : { sessionId: 'agent-codex-events-session' },
      )
    })
  }

  for (const event of [
    'PermissionRequest',
    'PreCompact',
    'UserPromptSubmit',
    'Stop',
    'SubagentStop',
  ] as const) {
    test(`${event}: allow and block retain their event-specific meaning`, () => {
      sandbox = createSandbox()
      install(event, 'return ctx.allow()')
      output(
        replay(event),
        event === 'PermissionRequest'
          ? {
              hookSpecificOutput: {
                hookEventName: 'PermissionRequest',
                decision: { behavior: 'allow' },
              },
            }
          : undefined,
      )
      marks()
      install(event, "return ctx.block({ reason: 'R' })")
      const expected =
        event === 'PermissionRequest'
          ? {
              hookSpecificOutput: {
                hookEventName: 'PermissionRequest',
                decision: { behavior: 'deny', message: 'R' },
              },
            }
          : event === 'PreCompact'
            ? { continue: false, stopReason: 'R' }
            : { decision: 'block', reason: 'R' }
      output(replay(event), expected)
      marks()
    })
  }

  test('UserPromptSubmit retains context on allow, skip and block', () => {
    sandbox = createSandbox()
    for (const tag of ['allow', 'skip', 'block']) {
      install(
        'UserPromptSubmit',
        `return { result: '${tag}', injectContext: 'prompt context', ${tag === 'block' ? "reason: 'R'" : ''} }`,
      )
      output(replay('UserPromptSubmit'), {
        ...(tag === 'block' ? { decision: 'block', reason: 'R' } : {}),
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: 'prompt context',
        },
      })
      marks()
    }
  })

  test('PostToolUse preserves every JSON response kind and emits feedback only after the completed action', () => {
    sandbox = createSandbox()
    for (const response of [
      null,
      false,
      0,
      '',
      'line\ntext',
      ['one', { snake_key: null }],
      { constructor: false, camelKey: 0 },
    ]) {
      install(
        'PostToolUse',
        "observe(ctx.toolResponse); return ctx.block({ reason: 'review completed action', injectContext: 'feedback' })",
      )
      output(replay('PostToolUse', { tool_response: response }), {
        decision: 'block',
        reason: 'review completed action',
        hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'feedback' },
      })
      marks()
      expect(observed()).toEqual(response)
    }
  })

  test('compact and PermissionRequest public inputs do not invent producer fields', () => {
    sandbox = createSandbox()
    for (const event of ['PreCompact', 'PostCompact', 'PermissionRequest'] as const) {
      install(
        event,
        `observe({ permissionMode: ctx.permissionMode, toolUseId: ctx.toolUseId,
        customInstructions: ctx.customInstructions, compactSummary: ctx.compactSummary }); return ctx.skip()`,
      )
      output(replay(event))
      marks()
      expect(observed()).toEqual(
        event === 'PermissionRequest'
          ? { permissionMode: 'default' }
          : event === 'PreCompact'
            ? { customInstructions: '' }
            : { compactSummary: '' },
      )
    }
  })

  test('PermissionRequest retains nested Bash description without inventing a tool-use ID', () => {
    sandbox = createSandbox()
    install(
      'PermissionRequest',
      `observe({ toolInput: ctx.toolInput, toolUseId: ctx.toolUseId,
      topLevelDescription: ctx.description }); return ctx.allow()`,
    )
    const toolInput = { command: 'echo approval', description: 'nested approval description' }
    output(replay('PermissionRequest', { tool_input: toolInput }), {
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
    })
    marks()
    expect(observed()).toEqual({ toolInput })
  })

  test('PostToolUse observes MCP JSON shapes but still validates the response', () => {
    sandbox = createSandbox()
    install('PostToolUse', 'observe(ctx.toolInput); return ctx.skip()')
    const toolInput = { opaque_key: [null, false] }
    output(replay('PostToolUse', { tool_name: 'mcp__fixture__inspect', tool_input: toolInput }))
    marks()
    expect(observed()).toEqual(toolInput)
    for (const value of [null, false, [], 'arguments']) {
      output(replay('PostToolUse', { tool_name: 'mcp__fixture__inspect', tool_input: value }))
      marks()
      expect(observed()).toEqual(value)
    }
    failure(
      replay('PostToolUse', { tool_response: undefined }),
      'PostToolUse',
      'clooks: Codex PostToolUse hook "runtime" capability "tool_response": tool_response must be JSON; hooks were not imported or executed. Rejected-result feedback requested after execution; no rollback is possible.',
    )
    expect(sandbox.fileExists(marker)).toBe(false)
  })
})

describe('Codex unsupported event fields reject before downstream effects', () => {
  const cases: { event: Event; tag: string; field: string; value: unknown; positive?: unknown }[] =
    [
      {
        event: 'PermissionRequest',
        tag: 'allow',
        field: 'updatedInput',
        value: {},
        positive: {
          hookSpecificOutput: {
            hookEventName: 'PermissionRequest',
            decision: { behavior: 'allow' },
          },
        },
      },
      {
        event: 'PermissionRequest',
        tag: 'allow',
        field: 'updatedPermissions',
        value: [],
        positive: {
          hookSpecificOutput: {
            hookEventName: 'PermissionRequest',
            decision: { behavior: 'allow' },
          },
        },
      },
      {
        event: 'PermissionRequest',
        tag: 'allow',
        field: 'updatedPermissions',
        value: null,
        positive: {
          hookSpecificOutput: {
            hookEventName: 'PermissionRequest',
            decision: { behavior: 'allow' },
          },
        },
      },
      {
        event: 'PermissionRequest',
        tag: 'block',
        field: 'interrupt',
        value: true,
        positive: {
          hookSpecificOutput: {
            hookEventName: 'PermissionRequest',
            decision: { behavior: 'deny', message: 'R' },
          },
        },
      },
      { event: 'PermissionRequest', tag: 'skip', field: 'updatedInput', value: null },
      { event: 'PostToolUse', tag: 'skip', field: 'updatedMCPToolOutput', value: null },
      {
        event: 'PostToolUse',
        tag: 'block',
        field: 'updatedMCPToolOutput',
        value: false,
        positive: { decision: 'block', reason: 'R' },
      },
      { event: 'PostCompact', tag: 'skip', field: 'injectContext', value: '' },
      { event: 'PreCompact', tag: 'allow', field: 'injectContext', value: '' },
      {
        event: 'Stop',
        tag: 'block',
        field: 'continue',
        value: false,
        positive: { decision: 'block', reason: 'R' },
      },
      { event: 'SubagentStop', tag: 'skip', field: 'stopReason', value: null },
    ]
  for (const tag of ['allow', 'skip', 'block']) {
    for (const value of ['', false, null]) {
      cases.push({
        event: 'UserPromptSubmit',
        tag,
        field: 'sessionTitle',
        value,
        positive: tag === 'block' ? { decision: 'block', reason: 'R' } : undefined,
      })
    }
  }
  for (const row of cases) {
    test(`${row.event} ${row.tag} rejects ${row.field}=${JSON.stringify(row.value)}`, () => {
      sandbox = createSandbox()
      const base = { result: row.tag, ...(row.tag === 'block' ? { reason: 'R' } : {}) }
      install(row.event, `return ${JSON.stringify(base)}`)
      output(replay(row.event), row.positive)
      marks()
      install(
        row.event,
        `return ${JSON.stringify({ ...base, [row.field]: row.value })}`,
        '',
        '{ onError: continue, maxFailures: 1, handoff: false }',
      )
      const message = `clooks: Codex ${row.event} hook "${name}" capability "${row.field}": unsupported field ${row.field} on ${row.tag}; result effects refused. ${dispositions[row.event]}`
      for (let attempt = 0; attempt < 2; attempt++) {
        failure(replay(row.event), row.event, message)
        marks()
        expect(sandbox.fileExists('.clooks/tmp')).toBe(false)
      }
    })
  }
})

describe('Codex event-specific required and nullable inputs', () => {
  const required: { event: Event; field: string }[] = [
    { event: 'SessionStart', field: 'source' },
    { event: 'SubagentStart', field: 'agent_id' },
    { event: 'PermissionRequest', field: 'tool_name' },
    { event: 'PostToolUse', field: 'tool_use_id' },
    { event: 'PreCompact', field: 'trigger' },
    { event: 'PostCompact', field: 'trigger' },
    { event: 'UserPromptSubmit', field: 'prompt' },
    { event: 'SubagentStop', field: 'agent_type' },
    { event: 'Stop', field: 'turn_id' },
  ]
  for (const { event, field } of required) {
    test(`${event}: absent ${field} is not replaced with a fabricated sentinel`, () => {
      sandbox = createSandbox()
      install(event, 'return ctx.skip()')
      output(replay(event))
      marks()
      failure(
        replay(event, { [field]: undefined }),
        event,
        `clooks: Codex ${event} hook "runtime" capability "${field}": ${field} must be a ${field === 'prompt' ? 'string' : 'nonempty string'}; hooks were not imported or executed. ${dispositions[event]}`,
      )
      expect(sandbox.fileExists(marker)).toBe(false)
    })
  }

  for (const event of ['PreCompact', 'PostCompact'] as const) {
    test(`${event}: unavailable compact text accepts designated absence/null but not false`, () => {
      sandbox = createSandbox()
      const field = event === 'PreCompact' ? 'custom_instructions' : 'compact_summary'
      const publicField = event === 'PreCompact' ? 'customInstructions' : 'compactSummary'
      install(event, `observe(ctx.${publicField}); return ctx.skip()`)
      for (const value of [undefined, null, '', 'supplied text']) {
        output(replay(event, { [field]: value }))
        marks()
        expect(observed()).toBe(value ?? '')
      }
      failure(
        replay(event, { [field]: false }),
        event,
        `clooks: Codex ${event} hook "runtime" capability "${field}": ${field} must be a string, null or absent; hooks were not imported or executed. ${dispositions[event]}`,
      )
      expect(sandbox.fileExists(marker)).toBe(false)
    })
  }

  for (const event of ['Stop', 'SubagentStop'] as const) {
    test(`${event}: only designated nullable fields accept absence; stop_hook_active remains required`, () => {
      sandbox = createSandbox()
      install(
        event,
        `observe({ lastAssistantMessage: ctx.lastAssistantMessage, transcriptPath: ctx.transcriptPath,
        agentTranscriptPath: ctx.agentTranscriptPath, stopHookActive: ctx.stopHookActive }); return ctx.skip()`,
      )
      for (const nullable of [null, undefined]) {
        output(
          replay(event, {
            transcript_path: nullable,
            last_assistant_message: nullable,
            ...(event === 'SubagentStop' ? { agent_transcript_path: nullable } : {}),
          }),
        )
        marks()
        expect(observed()).toEqual({
          lastAssistantMessage: '',
          transcriptPath: '',
          stopHookActive: false,
          ...(event === 'SubagentStop' ? { agentTranscriptPath: '' } : {}),
        })
      }
      for (const value of [null, undefined, 0, 'false']) {
        failure(
          replay(event, { stop_hook_active: value }),
          event,
          `clooks: Codex ${event} hook "runtime" capability "stop_hook_active": stop_hook_active must be a boolean; hooks were not imported or executed. ${dispositions[event]}`,
        )
        expect(sandbox.fileExists(marker)).toBe(false)
      }
      failure(
        replay(event, { last_assistant_message: false }),
        event,
        `clooks: Codex ${event} hook "runtime" capability "last_assistant_message": last_assistant_message must be a string, null or absent; hooks were not imported or executed. ${dispositions[event]}`,
      )
      expect(sandbox.fileExists(marker)).toBe(false)
    })
  }

  test('SubagentStop preserves the shared session and separate parent/child transcript paths', () => {
    sandbox = createSandbox()
    install(
      'SubagentStop',
      `observe({ sessionId: ctx.sessionId, agentId: ctx.agentId, agentType: ctx.agentType,
      transcriptPath: ctx.transcriptPath, agentTranscriptPath: ctx.agentTranscriptPath,
      lastAssistantMessage: ctx.lastAssistantMessage }); return ctx.block({ reason: 'child reminder' })`,
    )
    output(
      replay('SubagentStop', {
        transcript_path: '/parent/transcript',
        agent_transcript_path: '/child/transcript',
        last_assistant_message: 'child answer',
      }),
      { decision: 'block', reason: 'child reminder' },
    )
    marks()
    expect(observed()).toEqual({
      sessionId: 'agent-codex-events-session',
      agentId: 'child',
      agentType: 'worker',
      transcriptPath: '/parent/transcript',
      agentTranscriptPath: '/child/transcript',
      lastAssistantMessage: 'child answer',
    })
  })
})

describe('Codex persisted ordinary prompt boundaries', () => {
  function setupReminders() {
    sandbox = createSandbox()
    sandbox.writeHook(
      `${name}.ts`,
      `
import { appendFileSync, writeFileSync } from 'fs'
const mark = text => appendFileSync(${JSON.stringify(join(sandbox.dir, marker))}, text + '\\n')
mark('import')
function stop(ctx) {
  mark(ctx.event)
  writeFileSync(${JSON.stringify(join(sandbox.dir, observation))}, JSON.stringify({ prior: ctx.turn.priorInterventions, sessionId: ctx.sessionId, agentId: ctx.agentId }))
  return ctx.turn.priorInterventions > 0 ? ctx.skip() : ctx.block({ reason: 'reminder' })
}
export const hook = {
  meta: { name: '${name}' },
  Stop: stop,
  SubagentStop: stop,
  UserPromptSubmit(ctx) { mark('prompt'); return ctx.allow() },
  SessionStart(ctx) { mark('start'); return ctx.skip() },
}
`,
    )
    sandbox.writeConfig(`version: "1.0.0"\n${name}: {}\n`)
    const stop = (event: 'Stop' | 'SubagentStop', prior: number, agent = 'codex') => {
      output(
        replay(event, { stop_hook_active: prior > 0 }, agent),
        prior === 0 ? { decision: 'block', reason: 'reminder' } : undefined,
      )
      marks(`import\n${event}\n`)
      expect(observed()).toEqual({
        prior,
        sessionId: 'agent-codex-events-session',
        ...(event === 'SubagentStop' ? { agentId: 'child' } : {}),
      })
    }
    const start = (source: string) => {
      output(replay('SessionStart', { source }))
      marks('import\nstart\n')
    }
    return { start, stop }
  }

  test('child prompts and repeated stops preserve root and child reminders', () => {
    const { start, stop } = setupReminders()
    start('startup')
    stop('Stop', 0)
    stop('Stop', 1)
    stop('SubagentStop', 0)
    output(replay('UserPromptSubmit', { agent_id: 'child', agent_type: 'worker' }))
    marks('import\nprompt\n')
    stop('Stop', 1)
    stop('SubagentStop', 1)
  })

  test('root same-ID prompts reset root and child reminders', () => {
    const { start, stop } = setupReminders()
    start('startup')
    stop('Stop', 0)
    stop('SubagentStop', 0)
    output(replay('UserPromptSubmit'))
    marks('import\nprompt\n')
    stop('Stop', 0)
    stop('SubagentStop', 0)
  })

  test('resume and compact preserve reminders', () => {
    const { start, stop } = setupReminders()
    start('startup')
    stop('Stop', 0)
    stop('SubagentStop', 0)
    start('resume')
    stop('Stop', 1)
    start('compact')
    stop('SubagentStop', 1)
  })

  test('clear resets root and child reminders', () => {
    const { start, stop } = setupReminders()
    start('startup')
    stop('Stop', 0)
    stop('SubagentStop', 0)
    start('clear')
    stop('Stop', 0)
    stop('SubagentStop', 0)
  })

  test('agent reminders stay isolated when Codex startup resets its reminders', () => {
    const { start, stop } = setupReminders()
    start('startup')
    stop('Stop', 0)
    stop('Stop', 0, 'claude-code')
    stop('Stop', 1)
    start('startup')
    stop('Stop', 0)
    stop('Stop', 1, 'claude-code')
  })
})

describe('Codex rejected lower-priority results cannot disappear behind later refusals', () => {
  test('parallel permission allow settles before a lower-priority unsupported skip is rejected', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      `${name}-barrier.ts`,
      `
let release
export const allowed = new Promise(resolve => { release = resolve })
export const allowFinished = () => release()
`,
    )
    sandbox.writeHook(
      `${name}-allow.ts`,
      `
import { appendFileSync } from 'fs'
import { allowFinished } from './${name}-barrier.ts'
export const hook = {
  meta: { name: '${name}-allow' },
  PermissionRequest(ctx) {
    appendFileSync(${JSON.stringify(join(sandbox.dir, marker))}, 'allow\\n')
    return ctx.allow()
  },
  afterHook() { allowFinished() },
}
`,
    )
    sandbox.writeHook(
      `${name}.ts`,
      `
import { appendFileSync } from 'fs'
import { allowed } from './${name}-barrier.ts'
export const hook = { meta: { name: '${name}' }, async PermissionRequest() {
  await allowed
  // A task boundary drains the allow lifecycle's settlement/audit microtasks first.
  await new Promise(resolve => setImmediate(resolve))
  appendFileSync(${JSON.stringify(join(sandbox.dir, marker))}, 'invalid-skip\\n')
  return { result: 'skip', updatedInput: null }
} }
`,
    )
    sandbox.writeConfig(`version: "1.0.0"
${name}-allow: { parallel: true }
${name}: { parallel: true }
PermissionRequest:
  order: [${name}-allow, ${name}]
`)
    failure(
      replay('PermissionRequest'),
      'PermissionRequest',
      `clooks: Codex PermissionRequest hook "${name}" capability "updatedInput": unsupported field updatedInput on skip; result effects refused. Pending approval denial requested.`,
    )
    marks('allow\ninvalid-skip\n')
    expect(sandbox.fileExists('.clooks/tmp')).toBe(false)
  })

  for (const event of ['PermissionRequest', 'UserPromptSubmit'] as const) {
    test(`${event}: unsupported allow fails before a reachable later block`, () => {
      sandbox = createSandbox()
      const later = `${name}-later`
      const config = `version: "1.0.0"\n${name}: { onError: continue }\n${later}: {}\n${event}:\n  order: [${name}, ${later}]\n`
      sandbox.writeHook(
        `${later}.ts`,
        `
import { appendFileSync } from 'fs'
export const hook = { meta: { name: '${later}' }, ${event}(ctx) {
  appendFileSync(${JSON.stringify(join(sandbox.dir, marker))}, 'later\\n')
  return ctx.block({ reason: 'later refusal' })
} }
`,
      )
      install(event, 'return ctx.allow()')
      sandbox.writeConfig(config)
      output(
        replay(event),
        event === 'PermissionRequest'
          ? {
              hookSpecificOutput: {
                hookEventName: event,
                decision: { behavior: 'deny', message: 'later refusal' },
              },
            }
          : { decision: 'block', reason: 'later refusal' },
      )
      marks('import\nhandler\nlater\n')
      const field = event === 'PermissionRequest' ? 'updatedInput' : 'sessionTitle'
      install(event, `return { result: 'allow', ${field}: null }`)
      sandbox.writeConfig(config)
      failure(
        replay(event),
        event,
        `clooks: Codex ${event} hook "${name}" capability "${field}": unsupported field ${field} on allow; result effects refused. ${dispositions[event]}`,
      )
      marks()
      expect(sandbox.fileExists('.clooks/tmp')).toBe(false)
    })
  }

  test('parallel prompt title refusal aborts a started stronger block and the next group', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      `${name}-barrier.ts`,
      `
let signal
export const started = new Promise(resolve => { signal = resolve })
export const ready = () => signal()
`,
    )
    sandbox.writeHook(
      `${name}.ts`,
      `
import { appendFileSync } from 'fs'
import { started } from './${name}-barrier.ts'
export const hook = { meta: { name: '${name}' }, async UserPromptSubmit() {
  await started
  appendFileSync(${JSON.stringify(join(sandbox.dir, marker))}, 'invalid\\n')
  return { result: 'allow', sessionTitle: false }
} }
`,
    )
    sandbox.writeHook(
      `${name}-block.ts`,
      `
import { appendFileSync } from 'fs'
import { ready } from './${name}-barrier.ts'
export const hook = { meta: { name: '${name}-block' }, async UserPromptSubmit(ctx) {
  appendFileSync(${JSON.stringify(join(sandbox.dir, marker))}, 'started\\n')
  const aborted = new Promise(resolve => ctx.signal.addEventListener('abort', () => {
    appendFileSync(${JSON.stringify(join(sandbox.dir, marker))}, 'aborted\\n')
    resolve(ctx.block({ reason: 'late stronger block' }))
  }, { once: true }))
  ready()
  return await aborted
} }
`,
    )
    sandbox.writeHook(
      `${name}-later.ts`,
      `
import { appendFileSync } from 'fs'
export const hook = { meta: { name: '${name}-later' }, UserPromptSubmit(ctx) {
  appendFileSync(${JSON.stringify(join(sandbox.dir, marker))}, 'later\\n')
  return ctx.allow()
} }
`,
    )
    sandbox.writeConfig(`version: "1.0.0"
${name}: { parallel: true }
${name}-block: { parallel: true }
${name}-later: {}
UserPromptSubmit:
  order: [${name}, ${name}-block, ${name}-later]
`)
    failure(
      replay('UserPromptSubmit'),
      'UserPromptSubmit',
      `clooks: Codex UserPromptSubmit hook "${name}" capability "sessionTitle": unsupported field sessionTitle on allow; result effects refused. Inspected prompt rejection requested.`,
    )
    marks('started\ninvalid\naborted\n')
    expect(sandbox.fileExists('.clooks/tmp')).toBe(false)
  })
})

describe('Codex ordinary failures retain configured accounting and event-specific delivery', () => {
  const failurePath = '.clooks/.cache/agents/codex/failures.json'
  const count = (event: string) =>
    sandbox.fileExists(failurePath)
      ? (JSON.parse(sandbox.readFile(failurePath))[name]?.[event]?.consecutiveFailures ?? 0)
      : 0

  for (const event of events) {
    test(`${event}: selected crash refuses, threshold degrades, and successful repair clears its counter`, () => {
      sandbox = createSandbox()
      install(event, 'return ctx.skip()')
      output(replay(event))
      marks()
      expect(count(event)).toBe(0)
      const settings = '{ maxFailures: 2, maxFailuresMessage: "fixture degraded" }'
      install(event, "throw new Error('fixture crash')", '', settings)
      failure(
        replay(event),
        event,
        `clooks: Codex ${event} hook "${name}" capability "engine-error": [clooks] Hook "${name}" failed on ${event} (Error: fixture crash). Action blocked (onError: block).; result effects refused. ${dispositions[event]}`,
      )
      marks()
      expect(count(event)).toBe(1)
      output(replay(event), { systemMessage: 'fixture degraded' })
      marks()
      expect(count(event)).toBe(2)
      install(event, 'return ctx.skip()', '', settings)
      output(replay(event))
      marks()
      expect(count(event)).toBe(0)
    })
  }

  test('Stop crash continue produces a human diagnostic without requesting continuation or incrementing block counters', () => {
    sandbox = createSandbox()
    install('Stop', "return ctx.block({ reason: 'supported continuation' })")
    output(replay('Stop'), { decision: 'block', reason: 'supported continuation' })
    marks()
    install('Stop', "throw new Error('fixture crash')", '', '{ onError: continue, maxFailures: 1 }')
    for (let attempt = 0; attempt < 2; attempt++) {
      output(replay('Stop'), {
        systemMessage: `[clooks] Hook "${name}" failed on Stop (Error: fixture crash). Continuing (onError: continue).`,
      })
      marks()
      expect(count('Stop')).toBe(0)
    }
  })

  test('PostToolUse crash trace retains model context without a selected block or failure counter', () => {
    sandbox = createSandbox()
    install('PostToolUse', 'return ctx.skip()')
    output(replay('PostToolUse'))
    marks()
    install(
      'PostToolUse',
      "throw new Error('fixture crash')",
      '',
      '{ onError: trace, maxFailures: 1 }',
    )
    output(replay('PostToolUse'), {
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: `Hook "${name}" errored: Error: fixture crash. Configured as onError: trace \u2014 action not affected.`,
      },
    })
    marks()
    expect(count('PostToolUse')).toBe(0)
  })

  test('Stop crash trace falls back to continue without inventing a context channel', () => {
    sandbox = createSandbox()
    install('Stop', 'return ctx.skip()')
    output(replay('Stop'))
    marks()
    install('Stop', "throw new Error('fixture crash')", '', '{ onError: trace, maxFailures: 1 }')
    output(replay('Stop'), {
      systemMessage:
        `Hook "${name}" has onError: "trace" but Stop does not support additionalContext. Trace will fall back to "continue" for Stop.\n` +
        `Hook "${name}" has onError: "trace" but Stop does not support additionalContext. Falling back to "continue".\n` +
        `[clooks] Hook "${name}" failed on Stop (Error: fixture crash). Continuing (onError: continue).`,
    })
    marks()
    expect(count('Stop')).toBe(0)
  })

  for (const event of ['SessionStart', 'SubagentStart', 'PostCompact'] as const) {
    test(`${event}: lifecycle block is a runtime refusal, not a widened observer handler method`, () => {
      sandbox = createSandbox()
      install(event, 'return ctx.skip()')
      output(replay(event))
      marks()
      install(
        event,
        "throw new Error('unreachable handler')",
        "beforeHook(event) { mark('before'); return event.block({ reason: 'lifecycle gate' }) },",
      )
      failure(
        replay(event),
        event,
        `clooks: Codex ${event} hook "${name}" capability "before-hook": lifecycle block requires event-aware runtime refusal; result effects refused. ${dispositions[event]}`,
      )
      marks('import\nbefore\n')
    })
  }

  for (const event of [
    'PermissionRequest',
    'PostToolUse',
    'PreCompact',
    'PostCompact',
    'Stop',
  ] as const) {
    test(`${event}: known-event config failure occurs before module import`, () => {
      sandbox = createSandbox()
      install(event, 'return ctx.skip()')
      output(replay(event))
      marks()
      sandbox.writeConfig(`version: "1.0.0"\nconfig:\n  onError: invalid\n${name}: {}\n`)
      failure(
        replay(event),
        event,
        `clooks: Codex ${event} hook "runtime" capability "config": config validation failed: clooks: global config "onError" must be "block" or "continue", got "invalid"; hooks were not imported or executed. ${dispositions[event]}`,
      )
      expect(sandbox.fileExists(marker)).toBe(false)
      expect(count('__parse__')).toBe(0)
      expect(
        JSON.parse(sandbox.readFile(failurePath)).__config__.__parse__.consecutiveFailures,
      ).toBe(1)
    })
  }

  for (const event of ['SubagentStart', 'Stop'] as const) {
    test(`${event}: import failure uses a local load counter and never becomes author continuation`, () => {
      sandbox = createSandbox()
      install(event, 'return ctx.skip()')
      output(replay(event))
      marks()
      sandbox.writeHook(
        `${name}.ts`,
        `
import { appendFileSync } from 'fs'
appendFileSync(${JSON.stringify(join(sandbox.dir, marker))}, 'failed-import\\n')
throw new Error('fixture import')
export const hook = { meta: { name: '${name}' }, ${event}() { throw new Error('unreachable') } }
`,
      )
      failure(
        replay(event),
        event,
        `clooks: Codex ${event} hook "${name}" capability "load-error": [clooks] Hook "${name}" failed on ${event} (Error: clooks: failed to import hook "${name}" from .clooks/hooks/${name}.ts: fixture import). Action blocked (onError: block).; result effects refused. ${dispositions[event]}`,
      )
      marks('failed-import\n')
      expect(count('__load__')).toBe(1)
      expect(count(event)).toBe(0)
    })
  }
})
