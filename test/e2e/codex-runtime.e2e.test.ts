import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'fs'
import { dirname, join } from 'path'
import { createSandbox, type RunResult, type Sandbox } from './helpers/sandbox'

let sandbox: Sandbox
const timeout = 10_000
const marker = '.clooks/agent-codex-runtime.log'
const observation = '.clooks/agent-codex-runtime.json'
const inputRecordFailure =
  'clooks: Codex PreToolUse hook "runtime" capability "tool_input": tool input must be a JSON record; scalar, array and null inputs are unsupported; hooks were not imported or executed. Pending call denial requested.'
const configFailureMessage =
  'clooks: Codex PreToolUse hook "runtime" capability "config": config validation failed: clooks: global config "onError" must be "block" or "continue", got "invalid"; hooks were not imported or executed. Pending call denial requested.'

afterEach(() => sandbox?.cleanup())

// Release-source-shaped replay, not a captured native invocation or a native probe.
function wire(overrides: Record<string, unknown> = {}) {
  return {
    hook_event_name: 'PreToolUse',
    session_id: 'agent-codex-runtime-session',
    cwd: sandbox.dir,
    transcript_path: null,
    model: 'gpt-5',
    permission_mode: 'default',
    turn_id: 'agent-codex-runtime-turn',
    tool_name: 'Bash',
    tool_use_id: 'agent-codex-runtime-call',
    tool_input: { command: 'echo original' },
    ...overrides,
  }
}

function fresh() {
  for (const path of [marker, observation]) {
    rmSync(join(sandbox.dir, path), { force: true })
    expect(sandbox.fileExists(path)).toBe(false)
  }
}

function runtimeEnv(extra: Record<string, string> = {}) {
  return { CLOOKS_AGENT: 'codex', CODEX_HOME: join(sandbox.home, '.codex'), ...extra }
}

function replay(overrides: Record<string, unknown> = {}, extraEnv: Record<string, string> = {}) {
  fresh()
  return sandbox.run([], {
    stdin: JSON.stringify(wire(overrides)),
    env: runtimeEnv(extraEnv),
    timeout,
  })
}

function hook(name: string, body: string, scope: 'project' | 'home' = 'project') {
  sandbox.writeFile(marker, '')
  const source = `
import { appendFileSync, writeFileSync } from 'fs'
const mark = (text) => appendFileSync(${JSON.stringify(join(sandbox.dir, marker))}, text + '\\n')
const observe = (value) => writeFileSync(${JSON.stringify(join(sandbox.dir, observation))}, JSON.stringify(value))
mark(${JSON.stringify('import:' + name)})
export const hook = {
  meta: { name: ${JSON.stringify(name)} },
  PreToolUse(ctx) {
    mark(${JSON.stringify(name)})
    ${body}
  },
}
`
  if (scope === 'home') sandbox.writeHomeHook(`${name}.ts`, source)
  else sandbox.writeHook(`${name}.ts`, source)
}

function configure(names: string[], settings = '') {
  sandbox.writeConfig(`version: "1.0.0"
${names.map((name) => `${name}: {}`).join('\n')}
PreToolUse:
  order: ${JSON.stringify(names)}
${settings}`)
}

function calls() {
  expect(sandbox.fileExists(marker)).toBe(true)
  return sandbox
    .readFile(marker)
    .trim()
    .split('\n')
    .filter((line) => !line.startsWith('import:'))
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

function denial(result: RunResult, message: string) {
  output(result, {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: message,
    },
    systemMessage: message,
  })
}

function noHandoff() {
  for (const root of [sandbox.dir, sandbox.home]) {
    const dir = join(root, '.clooks/tmp')
    expect(
      existsSync(dir) ? readdirSync(dir).filter((name) => name.startsWith('handoff-')) : [],
    ).toEqual([])
  }
}

describe('Codex compiled PreToolUse wire translation', () => {
  test('plain allow retains native policy without emitting a permission decision', () => {
    sandbox = createSandbox()
    hook('agent-codex-runtime-allow', 'return ctx.allow()')
    configure(['agent-codex-runtime-allow'])
    output(replay())
    expect(calls()).toEqual(['agent-codex-runtime-allow'])
  })

  for (const rewrite of [false, true]) {
    test(`allow reason is a human annotation only, rewrite=${rewrite}`, () => {
      sandbox = createSandbox()
      hook(
        'agent-codex-runtime-reason',
        `return ctx.allow({ reason: 'R', ${rewrite ? "updatedInput: { command: 'B' }," : ''} })`,
      )
      configure(['agent-codex-runtime-reason'])
      output(replay(), {
        ...(rewrite
          ? {
              hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'allow',
                updatedInput: { command: 'B' },
              },
            }
          : {}),
        systemMessage:
          'clooks: PreToolUse allow reason (human annotation only; original allow-reason recipient unavailable; native policy retained): R',
      })
      expect(calls()).toEqual(['agent-codex-runtime-reason'])
    })
  }

  for (const toolName of [
    'Bash',
    'exec_command',
    'apply_patch',
    'mcp__fixture__inspect',
    'opaque_local',
  ]) {
    test(`record codec preserves opaque input and canonical identity: ${toolName}`, () => {
      sandbox = createSandbox()
      const input =
        toolName === 'Bash' || toolName === 'exec_command'
          ? { command: 'echo original' }
          : toolName === 'apply_patch'
            ? { command: '*** Begin Patch\n*** Add File: replay.txt\n+hello\n*** End Patch' }
            : {
                snake_key: [{ camelKey: null, keep_flag: false }],
                zero: 0,
                empty: '',
                text: '\u03bb\nsecond line',
              }
      hook(
        'agent-codex-runtime-codec',
        `
        observe({ event: ctx.event, toolName: ctx.toolName, toolInput: ctx.toolInput,
          originalToolInput: ctx.originalToolInput, sessionId: ctx.sessionId,
          transcriptPath: ctx.transcriptPath,
          privateKeys: ['private', 'provider', 'raw', 'model', 'nativeTurnId', 'codec']
            .filter(key => Object.hasOwn(ctx, key)) })
        return ctx.allow()
      `,
      )
      configure(['agent-codex-runtime-codec'])
      output(replay({ tool_name: toolName, tool_input: input }))
      expect(calls()).toEqual(['agent-codex-runtime-codec'])
      expect(observed()).toEqual({
        event: 'PreToolUse',
        toolName: toolName === 'exec_command' ? 'Bash' : toolName,
        toolInput: input,
        originalToolInput: input,
        sessionId: 'agent-codex-runtime-session',
        transcriptPath: '',
        privateKeys: [],
      })
    })
  }

  test('opaque sequential patches produce a full replacement and preserve untouched nulls', () => {
    sandbox = createSandbox()
    hook(
      'agent-codex-runtime-patch',
      `return ctx.allow({ updatedInput: {
      remove_me: null, untouched: undefined, nested_data: { snake_key: [false, null] }, added_key: 0,
    } })`,
    )
    hook(
      'agent-codex-runtime-observe',
      `observe({ current: ctx.toolInput, original: ctx.originalToolInput }); return ctx.skip()`,
    )
    configure(['agent-codex-runtime-patch', 'agent-codex-runtime-observe'])
    const original = {
      remove_me: 'old',
      untouched: null,
      keep_flag: false,
      nested_data: { old_key: 1 },
    }
    const replacement = {
      untouched: null,
      keep_flag: false,
      nested_data: { snake_key: [false, null] },
      added_key: 0,
    }
    output(replay({ tool_name: 'mcp__fixture__inspect', tool_input: original }), {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        updatedInput: replacement,
      },
    })
    expect(calls()).toEqual(['agent-codex-runtime-patch', 'agent-codex-runtime-observe'])
    expect(observed()).toEqual({ current: replacement, original })
  })

  test('MCP own __proto__ and constructor keys survive an unrelated patch without changing original input', () => {
    sandbox = createSandbox()
    const original = JSON.parse(
      '{"__proto__":{"polluted":"own data"},"constructor":{"prototype":{"snake_key":null}},"untouched":null,"changed_key":"old"}',
    )
    const replacement = JSON.parse(
      '{"__proto__":{"polluted":"own data"},"constructor":{"prototype":{"snake_key":null}},"untouched":null,"changed_key":"new"}',
    )
    hook('agent-codex-runtime-patch', "return ctx.allow({ updatedInput: { changed_key: 'new' } })")
    hook(
      'agent-codex-runtime-observe',
      `
      observe({
        current: ctx.toolInput,
        original: ctx.originalToolInput,
        own: ['__proto__', 'constructor'].map(key => Object.hasOwn(ctx.toolInput, key)),
        originalOwn: ['__proto__', 'constructor'].map(key => Object.hasOwn(ctx.originalToolInput, key)),
        polluted: Object.hasOwn(Object.prototype, 'polluted'),
      })
      return ctx.skip()
    `,
    )
    configure(['agent-codex-runtime-patch', 'agent-codex-runtime-observe'])
    output(replay({ tool_name: 'mcp__fixture__inspect', tool_input: original }), {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        updatedInput: replacement,
      },
    })
    expect(calls()).toEqual(['agent-codex-runtime-patch', 'agent-codex-runtime-observe'])
    expect(observed()).toEqual({
      current: replacement,
      original,
      own: [true, true],
      originalOwn: [true, true],
      polluted: false,
    })
  })

  for (const toolName of ['Bash', 'apply_patch']) {
    test(`command-only ${toolName} rewrite reaches the next hook as a full record`, () => {
      sandbox = createSandbox()
      const command =
        toolName === 'Bash'
          ? 'echo rewritten'
          : '*** Begin Patch\n*** Delete File: replay.txt\n*** End Patch'
      hook(
        'agent-codex-runtime-patch',
        `return ctx.allow({ updatedInput: { command: ${JSON.stringify(command)} } })`,
      )
      hook('agent-codex-runtime-observe', 'observe(ctx.toolInput); return ctx.skip()')
      configure(['agent-codex-runtime-patch', 'agent-codex-runtime-observe'])
      output(replay({ tool_name: toolName }), {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          updatedInput: { command },
        },
      })
      expect(calls()).toEqual(['agent-codex-runtime-patch', 'agent-codex-runtime-observe'])
      expect(observed()).toEqual({ command })
    })
  }

  test('blank block reason becomes a nonblank policy denial before a later hook', () => {
    sandbox = createSandbox()
    hook('agent-codex-runtime-blank', "return ctx.block({ reason: '  \\t' })")
    hook('agent-codex-runtime-later', 'return ctx.allow()')
    configure(['agent-codex-runtime-blank', 'agent-codex-runtime-later'])
    output(replay(), {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          'clooks: Codex PreToolUse hook "agent-codex-runtime-blank" capability "reason": clooks: invalid blank block reason; result effects refused. Pending call denial requested.',
      },
      systemMessage:
        'clooks: Codex PreToolUse hook "agent-codex-runtime-blank" capability "reason": clooks: invalid blank block reason; result effects refused. Pending call denial requested.',
    })
    expect(calls()).toEqual(['agent-codex-runtime-blank'])
    noHandoff()
  })
})

const reductions: { name: string; votes: Record<string, unknown>[]; expected?: unknown }[] = [
  {
    name: 'single skip context',
    votes: [{ result: 'skip', injectContext: 'A' }],
    expected: {
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'A' },
    },
  },
  {
    name: 'skip loses to allow',
    votes: [{ result: 'skip', injectContext: 'A' }, { result: 'allow' }],
  },
  {
    name: 'skip loses to deny',
    votes: [
      { result: 'skip', injectContext: 'A' },
      { result: 'block', reason: 'R' },
    ],
    expected: {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'R',
      },
    },
  },
  {
    name: 'last empty skip wins',
    votes: [{ result: 'skip', injectContext: 'A' }, { result: 'skip' }],
  },
  {
    name: 'last skip context wins',
    votes: [
      { result: 'skip', injectContext: 'A' },
      { result: 'skip', injectContext: 'B' },
    ],
    expected: {
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'B' },
    },
  },
]

describe('Codex configured-order reduction with controlled completion', () => {
  for (const mode of ['sequential', 'parallel-forward', 'parallel-reverse']) {
    for (const row of reductions) {
      test(`${mode}: ${row.name}`, () => {
        sandbox = createSandbox()
        const names = row.votes.map((_, index) => `agent-codex-runtime-vote-${index}`)
        const parallel = mode !== 'sequential'
        const completion = mode === 'parallel-reverse' ? [...names].reverse() : names
        // afterHook releases the next handler; no timing sleeps choose the winner.
        sandbox.writeHook(
          'agent-codex-runtime-barrier.ts',
          `
const releases = new Map()
const gates = new Map(${JSON.stringify(names)}.map(name => [name, new Promise(resolve => releases.set(name, resolve))]))
export const wait = name => gates.get(name)
export const release = name => releases.get(name)?.()
release(${JSON.stringify(completion[0])})
`,
        )
        names.forEach((name, index) => {
          sandbox.writeHook(
            `${name}.ts`,
            `
import { appendFileSync } from 'fs'
import { wait, release } from './agent-codex-runtime-barrier.ts'
export const hook = {
  meta: { name: ${JSON.stringify(name)} },
  async PreToolUse() {
    ${parallel ? `await wait(${JSON.stringify(name)})` : ''}
    appendFileSync(${JSON.stringify(join(sandbox.dir, marker))}, ${JSON.stringify(name + '\n')})
    return ${JSON.stringify(row.votes[index])}
  },
  afterHook() { release(${JSON.stringify(completion[completion.indexOf(name) + 1] ?? '')}) },
}
`,
          )
        })
        sandbox.writeConfig(`version: "1.0.0"
${names.map((name) => `${name}: { parallel: ${parallel}, handoff: false }`).join('\n')}
PreToolUse:
  order: ${JSON.stringify(names)}
`)
        output(replay(), row.expected)
        expect(calls()).toEqual(completion)
        noHandoff()
      })
    }
  }
})

describe('Codex policy audit before effects', () => {
  const invalidResults = [
    {
      name: 'ask',
      value: { result: 'ask', reason: 'ask me' },
      capability: 'result',
      detail: 'unsupported result arm ask',
    },
    {
      name: 'defer',
      value: { result: 'defer' },
      capability: 'result',
      detail: 'unsupported result arm defer',
    },
    {
      name: 'false suppressOutput',
      value: { result: 'allow', suppressOutput: false },
      capability: 'suppressOutput',
      detail: 'unsupported field suppressOutput on allow',
    },
    {
      name: 'null continue',
      value: { result: 'allow', continue: null },
      capability: 'continue',
      detail: 'unsupported field continue on allow',
    },
    {
      name: 'empty stopReason',
      value: { result: 'allow', stopReason: '' },
      capability: 'stopReason',
      detail: 'unsupported field stopReason on allow',
    },
  ]
  for (const row of invalidResults) {
    test(`${row.name} rejects even after a stronger deny vote and cannot reach the next hook`, () => {
      sandbox = createSandbox()
      hook('agent-codex-runtime-deny', "return ctx.block({ reason: 'ordinary deny' })")
      hook(
        'agent-codex-runtime-reject',
        `return ${JSON.stringify({ ...row.value, injectContext: 'rejected context '.repeat(100) })}`,
      )
      hook('agent-codex-runtime-later', 'observe(ctx.toolInput); return ctx.allow()')
      configure(
        ['agent-codex-runtime-deny', 'agent-codex-runtime-reject', 'agent-codex-runtime-later'],
        'config:\n  onError: continue\n  maxFailures: 1\n',
      )
      // A positive run proves that neither the prior deny nor config hides the later hook.
      hook('agent-codex-runtime-reject', 'return ctx.allow()')
      output(replay(), {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: 'ordinary deny',
        },
      })
      expect(calls()).toEqual([
        'agent-codex-runtime-deny',
        'agent-codex-runtime-reject',
        'agent-codex-runtime-later',
      ])
      expect(observed()).toEqual({ command: 'echo original' })
      hook(
        'agent-codex-runtime-reject',
        `return ${JSON.stringify({ ...row.value, injectContext: 'rejected context '.repeat(100) })}`,
      )
      for (let attempt = 0; attempt < 2; attempt++) {
        denial(
          replay(),
          `clooks: Codex PreToolUse hook "agent-codex-runtime-reject" capability "${row.capability}": ${row.detail}; result effects refused. Pending call denial requested.`,
        )
        expect(calls()).toEqual(['agent-codex-runtime-deny', 'agent-codex-runtime-reject'])
        expect(sandbox.fileExists(observation)).toBe(false)
        noHandoff()
      }
    })
  }

  for (const patch of [{ cwd: '/ignored' }, { timeout: 1 }, { command: null }, { command: 7 }]) {
    for (const toolName of ['Bash', 'apply_patch']) {
      test(`${toolName} rejects command-only codec violation ${JSON.stringify(patch)} before later input`, () => {
        sandbox = createSandbox()
        hook(
          'agent-codex-runtime-reject',
          `return ctx.allow({ updatedInput: ${JSON.stringify(patch)} })`,
        )
        hook('agent-codex-runtime-later', 'observe(ctx.toolInput); return ctx.allow()')
        configure(['agent-codex-runtime-reject', 'agent-codex-runtime-later'])
        const detail =
          'command' in patch
            ? 'command-only tool input requires a string command and no additional keys'
            : 'command-only updates cannot contain additional keys, including null deletions'
        denial(
          replay({ tool_name: toolName }),
          `clooks: Codex PreToolUse hook "agent-codex-runtime-reject" capability "updatedInput": ${detail}; result effects refused. Pending call denial requested.`,
        )
        expect(calls()).toEqual(['agent-codex-runtime-reject'])
        expect(sandbox.fileExists(observation)).toBe(false)
        noHandoff()
      })
    }
  }

  test('parallel empty rewrite aborts the pending sibling before later groups', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'agent-codex-runtime-barrier.ts',
      `
let release
export const started = new Promise(resolve => { release = resolve })
export const signalStarted = () => release()
`,
    )
    sandbox.writeHook(
      'agent-codex-runtime-reject.ts',
      `
import { appendFileSync } from 'fs'
import { started } from './agent-codex-runtime-barrier.ts'
export const hook = { meta: { name: 'agent-codex-runtime-reject' }, async PreToolUse() {
  await started
  appendFileSync(${JSON.stringify(join(sandbox.dir, marker))}, 'reject\\n')
  return { result: 'allow', updatedInput: {}, injectContext: 'must not hand off' }
} }
`,
    )
    sandbox.writeHook(
      'agent-codex-runtime-wait.ts',
      `
import { appendFileSync } from 'fs'
import { signalStarted } from './agent-codex-runtime-barrier.ts'
export const hook = { meta: { name: 'agent-codex-runtime-wait' }, async PreToolUse(ctx) {
  appendFileSync(${JSON.stringify(join(sandbox.dir, marker))}, 'waiting\\n')
  const aborted = new Promise(resolve => ctx.signal.addEventListener('abort', () => {
    appendFileSync(${JSON.stringify(join(sandbox.dir, marker))}, 'aborted\\n')
    resolve()
  }, { once: true }))
  signalStarted()
  await aborted
  return { result: 'allow', injectContext: 'late context' }
} }
`,
    )
    hook('agent-codex-runtime-later', 'observe(ctx.toolInput); return ctx.allow()')
    sandbox.writeConfig(`version: "1.0.0"
agent-codex-runtime-reject: { parallel: true, handoff: true }
agent-codex-runtime-wait: { parallel: true, handoff: true }
agent-codex-runtime-later: {}
PreToolUse:
  order: [agent-codex-runtime-reject, agent-codex-runtime-wait, agent-codex-runtime-later]
`)
    denial(
      replay(),
      'clooks: Codex PreToolUse hook "agent-codex-runtime-reject" capability "updatedInput": parallel input rewrites are unsupported; result effects refused. Pending call denial requested.',
    )
    expect(calls()).toEqual(['waiting', 'reject', 'aborted'])
    expect(sandbox.fileExists(observation)).toBe(false)
    noHandoff()
  })

  for (const requested of [false, true]) {
    test(`eligible context stays inline with handoff requested=${requested}`, () => {
      sandbox = createSandbox()
      const text = 'inline model context\n'.repeat(100)
      hook(
        'agent-codex-runtime-inline',
        `return ctx.allow({ injectContext: ${JSON.stringify(text)} })`,
      )
      sandbox.writeConfig(
        `version: "1.0.0"\nagent-codex-runtime-inline: { handoff: ${requested} }\n`,
      )
      output(replay(), {
        hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: text },
        ...(requested
          ? {
              systemMessage:
                'clooks: requested Codex handoff remains inline; recipient file readability is unverified.',
            }
          : {}),
      })
      expect(calls()).toEqual(['agent-codex-runtime-inline'])
      noHandoff()
    })
  }
})

describe('Codex discovery and pre-import validation', () => {
  test('paired child identity is public only when both fields are valid strings', () => {
    sandbox = createSandbox()
    hook(
      'agent-codex-runtime-import',
      'observe({ agentId: ctx.agentId, agentType: ctx.agentType }); return ctx.allow()',
    )
    configure(['agent-codex-runtime-import'])
    output(replay({ agent_id: 'child', agent_type: 'worker' }))
    expect(calls()).toEqual(['agent-codex-runtime-import'])
    expect(observed()).toEqual({ agentId: 'child', agentType: 'worker' })
    for (const { fields, field } of [
      { fields: { agent_id: 'child' }, field: 'agent_type' },
      { fields: { agent_type: 'worker' }, field: 'agent_id' },
      { fields: { agent_id: null, agent_type: 'worker' }, field: 'agent_id' },
      { fields: { agent_id: 'child', agent_type: false }, field: 'agent_type' },
      { fields: { agent_id: true, agent_type: 'worker' }, field: 'agent_id' },
      { fields: { agent_id: 'child', agent_type: null }, field: 'agent_type' },
    ]) {
      denial(
        replay(fields),
        `clooks: Codex PreToolUse hook "runtime" capability "${field}": ${field} must be a nonempty string; hooks were not imported or executed. Pending call denial requested.`,
      )
      expect(sandbox.fileExists(marker)).toBe(false)
      expect(sandbox.fileExists(observation)).toBe(false)
      noHandoff()
    }
  })

  test('non-object JSON envelopes fail locally before imports without inventing an event', () => {
    sandbox = createSandbox()
    hook('agent-codex-runtime-import', 'return ctx.allow()')
    configure(['agent-codex-runtime-import'])
    output(replay())
    expect(calls()).toEqual(['agent-codex-runtime-import'])
    for (const value of [null, true, false, [], 7, 'PreToolUse']) {
      fresh()
      const result = sandbox.run([], { stdin: JSON.stringify(value), env: runtimeEnv(), timeout })
      expect(result.exitCode).toBe(2)
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe(
        'clooks: Codex unidentified event hook "runtime" capability "stdin": clooks: stdin payload is not a JSON object Unidentified event; local failure only, with no native prevention guarantee.\n',
      )
      expect(sandbox.fileExists(marker)).toBe(false)
      noHandoff()
    }
  })

  test('missing required identity fields reject before imports; nullable transcript absence is compatibility', () => {
    sandbox = createSandbox()
    hook('agent-codex-runtime-import', 'observe(ctx.transcriptPath); return ctx.allow()')
    configure(['agent-codex-runtime-import'])
    output(replay())
    expect(calls()).toEqual(['agent-codex-runtime-import'])
    expect(observed()).toBe('')
    // Absence is intentionally broader than the release producer's required nullable field.
    output(replay({ transcript_path: undefined }))
    expect(calls()).toEqual(['agent-codex-runtime-import'])
    expect(observed()).toBe('')
    for (const field of [
      'session_id',
      'cwd',
      'model',
      'permission_mode',
      'turn_id',
      'tool_name',
      'tool_use_id',
    ]) {
      denial(
        replay({ [field]: undefined }),
        `clooks: Codex PreToolUse hook "runtime" capability "${field}": ${field} must be a nonempty string; hooks were not imported or executed. Pending call denial requested.`,
      )
      expect(sandbox.fileExists(marker)).toBe(false)
      expect(sandbox.fileExists(observation)).toBe(false)
      noHandoff()
    }
    for (const value of [false, true, 7, []]) {
      denial(
        replay({ transcript_path: value }),
        'clooks: Codex PreToolUse hook "runtime" capability "transcript_path": transcript_path must be a string, null or absent; hooks were not imported or executed. Pending call denial requested.',
      )
      expect(sandbox.fileExists(marker)).toBe(false)
      expect(sandbox.fileExists(observation)).toBe(false)
    }
  })

  test('home/project shadowing is atomic and local order overrides project order', () => {
    sandbox = createSandbox()
    hook('agent-codex-runtime-home', "return { result: 'skip', injectContext: 'home' }", 'home')
    hook('agent-codex-runtime-shared', "throw new Error('shadowed home must not run')", 'home')
    sandbox.writeHomeConfig(
      'version: "1.0.0"\nagent-codex-runtime-home: {}\nagent-codex-runtime-shared: {}\n',
    )
    hook('agent-codex-runtime-shared', "return { result: 'skip', injectContext: 'project' }")
    sandbox.writeConfig(`version: "1.0.0"
agent-codex-runtime-shared: {}
PreToolUse:
  order: [agent-codex-runtime-shared]
`)
    output(replay(), {
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'home' },
    })
    expect(calls()).toEqual(['agent-codex-runtime-shared', 'agent-codex-runtime-home'])
    sandbox.writeLocalConfig(
      'version: "1.0.0"\nPreToolUse:\n  order: [agent-codex-runtime-home, agent-codex-runtime-shared]\n',
    )
    output(replay(), {
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'project' },
    })
    expect(calls()).toEqual(['agent-codex-runtime-home', 'agent-codex-runtime-shared'])
    expect(
      sandbox
        .readFile(marker)
        .split('\n')
        .filter((line) => line === 'import:agent-codex-runtime-shared'),
    ).toHaveLength(1)
  })

  test('Codex ignores inherited Claude root but honors the explicit Clooks root', () => {
    sandbox = createSandbox()
    hook('agent-codex-runtime-root', "return { result: 'skip', injectContext: 'real root' }")
    configure(['agent-codex-runtime-root'])
    sandbox.writeFile(
      'decoy/.clooks/clooks.yml',
      'version: "1.0.0"\nagent-codex-runtime-decoy: {}\n',
    )
    sandbox.writeFile(
      'decoy/.clooks/hooks/agent-codex-runtime-decoy.ts',
      `
import { appendFileSync } from 'fs'
export const hook = { meta: { name: 'agent-codex-runtime-decoy' }, PreToolUse() {
  appendFileSync(${JSON.stringify(join(sandbox.dir, marker))}, 'decoy\\n')
  return { result: 'skip', injectContext: 'explicit root' }
} }
`,
    )
    const decoy = join(sandbox.dir, 'decoy')
    output(replay({}, { CLAUDE_PROJECT_DIR: decoy }), {
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'real root' },
    })
    expect(calls()).toEqual(['agent-codex-runtime-root'])
    output(replay({}, { CLAUDE_PROJECT_DIR: sandbox.dir, CLOOKS_PROJECT_ROOT: decoy }), {
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'explicit root' },
    })
    expect(calls()).toEqual(['decoy'])
  })

  test('configured malformed/non-record input is rejected before hook imports after a reachable baseline', () => {
    sandbox = createSandbox()
    hook('agent-codex-runtime-import', 'return ctx.allow()')
    configure(['agent-codex-runtime-import'])
    output(replay())
    expect(calls()).toEqual(['agent-codex-runtime-import'])
    for (const invalid of [null, [], 'echo hidden', 7, true, false]) {
      denial(replay({ tool_input: invalid }), inputRecordFailure)
      expect(sandbox.fileExists(marker)).toBe(false)
      expect(sandbox.fileExists(observation)).toBe(false)
      noHandoff()
    }
    fresh()
    const malformed = sandbox.run([], { stdin: '{', env: runtimeEnv(), timeout })
    expect(malformed.exitCode).toBe(2)
    expect(malformed.stdout).toBe('')
    expect(malformed.stderr.trim().length).toBeGreaterThan(0)
    expect(sandbox.fileExists(marker)).toBe(false)
  })

  test('no-config malformed input keeps the intentional no-op bypass', () => {
    sandbox = createSandbox()
    output(sandbox.run([], { stdin: '{', env: runtimeEnv(), timeout }))
  })

  test('known-event config failure refuses without inventing a parse event or importing hooks', () => {
    sandbox = createSandbox()
    hook('agent-codex-runtime-import', 'return ctx.allow()')
    configure(['agent-codex-runtime-import'])
    output(replay())
    expect(calls()).toEqual(['agent-codex-runtime-import'])
    sandbox.writeConfig(
      'version: "1.0.0"\nconfig:\n  onError: invalid\nagent-codex-runtime-import: {}\n',
    )
    const result = replay()
    denial(result, configFailureMessage)
    expect(result.stdout).not.toContain('__parse__')
    expect(sandbox.fileExists(marker)).toBe(false)
    noHandoff()
  })
})

describe('Codex failure namespaces', () => {
  for (const scope of ['home', 'project'] as const) {
    test(`${scope} config failure and repair touch only Codex counter state, preserving Claude bytes`, () => {
      sandbox = createSandbox()
      hook('agent-codex-runtime-recovery', 'return ctx.allow()', scope)
      const valid = 'version: "1.0.0"\nagent-codex-runtime-recovery: {}\n'
      const invalid =
        'version: "1.0.0"\nconfig:\n  onError: invalid\nagent-codex-runtime-recovery: {}\n'
      const writeConfig = (value: string) =>
        scope === 'home' ? sandbox.writeHomeConfig(value) : sandbox.writeConfig(value)
      writeConfig(valid)
      output(replay())
      expect(calls()).toEqual(['agent-codex-runtime-recovery'])
      const hash = createHash('sha256').update(sandbox.dir).digest('hex').slice(0, 12)
      const claudeBytes =
        '{ "__config__": { "__parse__": { "consecutiveFailures": 4, "lastError": "Claude only", "lastFailedAt": "2026-09-08T00:00:00.000Z" } } }\n'
      sandbox.writeFile('.clooks/.failures', claudeBytes)
      sandbox.writeHomeFile(`.clooks/failures/${hash}.json`, claudeBytes)
      const codexPath =
        scope === 'home'
          ? join(sandbox.home, '.clooks/failures/codex', `${hash}.json`)
          : join(sandbox.dir, '.clooks/.cache/agents/codex/failures.json')
      expect(existsSync(codexPath)).toBe(false)
      const codexBytes =
        '{ "__config__": { "__parse__": { "consecutiveFailures": 1, "lastError": "Codex prior config error", "lastFailedAt": "2026-09-08T00:00:00.000Z" } } }\n'
      if (scope === 'home') sandbox.writeHomeFile(`.clooks/failures/codex/${hash}.json`, codexBytes)
      else sandbox.writeFile('.clooks/.cache/agents/codex/failures.json', codexBytes)
      // Invalid wire must precede both failure accounting and repaired-config clearing.
      for (const config of [invalid, valid]) {
        writeConfig(config)
        for (const stdin of ['{', JSON.stringify(wire({ tool_input: null }))]) {
          fresh()
          const rejected = sandbox.run([], { stdin, env: runtimeEnv(), timeout })
          if (stdin === '{') {
            expect(rejected.exitCode).toBe(2)
            expect(rejected.stdout).toBe('')
            expect(rejected.stderr).toContain('failed to parse stdin JSON')
          } else {
            denial(rejected, inputRecordFailure)
          }
          expect(sandbox.fileExists(marker)).toBe(false)
          expect(readFileSync(codexPath, 'utf8')).toBe(codexBytes)
          expect(sandbox.readFile('.clooks/.failures')).toBe(claudeBytes)
          expect(sandbox.readHomeFile(`.clooks/failures/${hash}.json`)).toBe(claudeBytes)
        }
      }
      writeConfig(invalid)
      const result = replay()
      denial(result, configFailureMessage)
      expect(result.stdout).not.toContain('__parse__')
      expect(sandbox.fileExists(marker)).toBe(false)
      const ownState = JSON.parse(readFileSync(codexPath, 'utf8'))
      expect(Object.keys(ownState)).toEqual(['__config__'])
      expect(ownState.__config__.__parse__.consecutiveFailures).toBe(2)
      expect(ownState.__config__.__parse__.lastError).toContain('onError')
      expect(sandbox.readFile('.clooks/.failures')).toBe(claudeBytes)
      expect(sandbox.readHomeFile(`.clooks/failures/${hash}.json`)).toBe(claudeBytes)
      output(replay(), {
        systemMessage:
          '[clooks] Config validation failed 3 consecutive times. Hooks are disabled to prevent deadlock. Fix .clooks/clooks.yml: clooks: global config "onError" must be "block" or "continue", got "invalid"',
      })
      expect(sandbox.fileExists(marker)).toBe(false)
      expect(sandbox.fileExists(observation)).toBe(false)
      const degradedState = JSON.parse(readFileSync(codexPath, 'utf8'))
      expect(Object.keys(degradedState)).toEqual(['__config__'])
      expect(degradedState.__config__.__parse__.consecutiveFailures).toBe(3)
      expect(sandbox.readFile('.clooks/.failures')).toBe(claudeBytes)
      expect(sandbox.readHomeFile(`.clooks/failures/${hash}.json`)).toBe(claudeBytes)
      noHandoff()
      writeConfig(valid)
      output(replay())
      expect(calls()).toEqual(['agent-codex-runtime-recovery'])
      expect(existsSync(codexPath)).toBe(false)
      expect(sandbox.readFile('.clooks/.failures')).toBe(claudeBytes)
      expect(sandbox.readHomeFile(`.clooks/failures/${hash}.json`)).toBe(claudeBytes)
    })
  }

  test('tool history isolates providers and child scopes without resetting on native turn ID changes', () => {
    sandbox = createSandbox()
    hook(
      'agent-codex-runtime-history',
      'observe(ctx.turn.prior.map(run => run.decision)); return ctx.allow()',
    )
    configure(['agent-codex-runtime-history'])
    const invocations = [
      { fields: {}, provider: 'codex', prior: [] },
      { fields: { turn_id: 'another-native-id' }, provider: 'codex', prior: ['allow'] },
      { fields: { agent_id: 'child', agent_type: 'worker' }, provider: 'codex', prior: [] },
      { fields: {}, provider: 'claude-code', prior: [] },
      { fields: {}, provider: 'codex', prior: ['allow', 'allow'] },
      { fields: { agent_id: 'child', agent_type: 'worker' }, provider: 'codex', prior: ['allow'] },
    ]
    for (const invocation of invocations) {
      const result = replay(invocation.fields, { CLOOKS_AGENT: invocation.provider })
      output(
        result,
        invocation.provider === 'claude-code'
          ? {
              hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' },
            }
          : undefined,
      )
      expect(calls()).toEqual(['agent-codex-runtime-history'])
      expect(observed()).toEqual(invocation.prior)
    }
    const hash = createHash('sha256')
      .update('agent-codex-runtime-session')
      .digest('hex')
      .slice(0, 16)
    expect(sandbox.homeFileExists(`.clooks/turn-state/codex/${hash}.json`)).toBe(true)
    expect(sandbox.homeFileExists(`.clooks/turn-state/${hash}.json`)).toBe(true)
  })

  test('home and project failure counts are isolated from Claude and each other', () => {
    sandbox = createSandbox()
    hook('agent-codex-runtime-crash', "throw new Error('fixture crash')", 'home')
    sandbox.writeHomeConfig('version: "1.0.0"\nagent-codex-runtime-crash:\n  maxFailures: 5\n')
    const hash = createHash('sha256').update(sandbox.dir).digest('hex').slice(0, 12)
    const homeCodex = join(sandbox.home, '.clooks/failures/codex', `${hash}.json`)
    const homeClaude = join(sandbox.home, '.clooks/failures', `${hash}.json`)
    const read = (path: string) =>
      JSON.parse(readFileSync(path, 'utf8'))['agent-codex-runtime-crash'].PreToolUse
        .consecutiveFailures
    const first = replay()
    expect(first.exitCode).toBe(0)
    expect(JSON.parse(first.stdout).hookSpecificOutput.permissionDecision).toBe('deny')
    expect(calls()).toEqual(['agent-codex-runtime-crash'])
    expect(read(homeCodex)).toBe(1)
    expect(existsSync(homeClaude)).toBe(false)
    const claude = replay({}, { CLOOKS_AGENT: 'claude-code' })
    expect(claude.exitCode).toBe(0)
    expect(JSON.parse(claude.stdout).hookSpecificOutput.permissionDecision).toBe('deny')
    expect(calls()).toEqual(['agent-codex-runtime-crash'])
    expect(read(homeClaude)).toBe(1)
    expect(read(homeCodex)).toBe(1)
    hook('agent-codex-runtime-crash', "throw new Error('project crash')")
    configure(['agent-codex-runtime-crash'])
    const project = replay()
    expect(project.exitCode).toBe(0)
    expect(JSON.parse(project.stdout).hookSpecificOutput.permissionDecision).toBe('deny')
    expect(calls()).toEqual(['agent-codex-runtime-crash'])
    expect(read(join(sandbox.dir, '.clooks/.cache/agents/codex/failures.json'))).toBe(1)
    expect(sandbox.fileExists('.clooks/.failures')).toBe(false)
    expect(read(homeCodex)).toBe(1)
    expect(read(homeClaude)).toBe(1)
  })
})

describe('Codex managed storage through the compiled engine', () => {
  function expectStorageDenial(result: RunResult) {
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    const parsed = JSON.parse(result.stdout)
    expect(parsed.hookSpecificOutput.hookEventName).toBe('PreToolUse')
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(parsed.systemMessage).toContain('hook "runtime" capability "runtime"')
    expect(parsed.systemMessage).toContain('Pending call denial requested.')
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toBe(parsed.systemMessage)
  }

  for (const link of ['directory', 'file'] as const) {
    test(`home config accounting refuses a linked ${link} without touching foreign counters`, () => {
      sandbox = createSandbox()
      hook('agent-codex-runtime-linked-config', 'return ctx.allow()', 'home')
      sandbox.writeHomeConfig('version: "1.0.0"\nagent-codex-runtime-linked-config: {}\n')
      output(replay())
      expect(calls()).toEqual(['agent-codex-runtime-linked-config'])
      sandbox.writeHomeConfig(
        'version: "1.0.0"\nconfig:\n  onError: invalid\nagent-codex-runtime-linked-config: {}\n',
      )
      denial(replay(), configFailureMessage)
      expect(sandbox.fileExists(marker)).toBe(false)
      const hash = createHash('sha256').update(sandbox.dir).digest('hex').slice(0, 12)
      const statePath = join(sandbox.home, '.clooks/failures/codex', `${hash}.json`)
      const bytes = readFileSync(statePath, 'utf8')
      expect(JSON.parse(bytes).__config__.__parse__.consecutiveFailures).toBe(1)
      const foreignDir = join(sandbox.home, 'agent-codex-runtime-foreign')
      const foreignFile = join(foreignDir, `${hash}.json`)
      sandbox.writeHomeFile(`agent-codex-runtime-foreign/${hash}.json`, bytes)
      const target = link === 'directory' ? dirname(statePath) : statePath
      rmSync(target, { recursive: true, force: true })
      symlinkSync(link === 'directory' ? foreignDir : foreignFile, target)
      expectStorageDenial(replay())
      expect(sandbox.fileExists(marker)).toBe(false)
      expect(readFileSync(foreignFile, 'utf8')).toBe(bytes)
      expect(readdirSync(foreignDir)).toEqual([`${hash}.json`])
    })

    test(`ordinary failure refuses a ${link} linked by a reached hook before counter commit`, () => {
      sandbox = createSandbox()
      hook('agent-codex-runtime-linked-crash', "throw new Error('positive crash')")
      configure(['agent-codex-runtime-linked-crash'])
      const baseline = replay()
      expect(baseline.exitCode).toBe(0)
      expect(JSON.parse(baseline.stdout).hookSpecificOutput.permissionDecision).toBe('deny')
      expect(calls()).toEqual(['agent-codex-runtime-linked-crash'])
      const statePath = join(sandbox.dir, '.clooks/.cache/agents/codex/failures.json')
      const bytes = readFileSync(statePath, 'utf8')
      expect(
        JSON.parse(bytes)['agent-codex-runtime-linked-crash'].PreToolUse.consecutiveFailures,
      ).toBe(1)
      sandbox.writeFile('agent-codex-runtime-foreign/failures.json', bytes)
      const foreignDir = join(sandbox.dir, 'agent-codex-runtime-foreign')
      const foreignFile = join(foreignDir, 'failures.json')
      const target = link === 'directory' ? dirname(statePath) : statePath
      sandbox.writeHook(
        'agent-codex-runtime-linked-crash.ts',
        `
import { appendFileSync, rmSync, symlinkSync } from 'fs'
export const hook = {
  meta: { name: 'agent-codex-runtime-linked-crash' },
  PreToolUse() {
    appendFileSync(${JSON.stringify(join(sandbox.dir, marker))}, 'agent-codex-runtime-linked-crash\\n')
    rmSync(${JSON.stringify(target)}, { recursive: true, force: true })
    symlinkSync(${JSON.stringify(link === 'directory' ? foreignDir : foreignFile)}, ${JSON.stringify(target)})
    throw new Error('crash after planting sandbox link')
  },
}
`,
      )
      expectStorageDenial(replay())
      expect(calls()).toEqual(['agent-codex-runtime-linked-crash'])
      expect(readFileSync(foreignFile, 'utf8')).toBe(bytes)
      expect(readdirSync(foreignDir)).toEqual(['failures.json'])
    })

    test(`turn history ignores a linked ${link} snapshot and never commits into foreign storage`, () => {
      sandbox = createSandbox()
      hook(
        'agent-codex-runtime-linked-history',
        'observe(ctx.turn.prior.map(run => run.decision)); return ctx.allow()',
      )
      configure(['agent-codex-runtime-linked-history'])
      output(replay())
      expect(calls()).toEqual(['agent-codex-runtime-linked-history'])
      expect(observed()).toEqual([])
      output(replay())
      expect(calls()).toEqual(['agent-codex-runtime-linked-history'])
      expect(observed()).toEqual(['allow'])
      const hash = createHash('sha256')
        .update('agent-codex-runtime-session')
        .digest('hex')
        .slice(0, 16)
      const statePath = join(sandbox.home, '.clooks/turn-state/codex', `${hash}.json`)
      const bytes = readFileSync(statePath, 'utf8')
      sandbox.writeHomeFile(`agent-codex-runtime-foreign/${hash}.json`, bytes)
      const foreignDir = join(sandbox.home, 'agent-codex-runtime-foreign')
      const foreignFile = join(foreignDir, `${hash}.json`)
      const target = link === 'directory' ? dirname(statePath) : statePath
      rmSync(target, { recursive: true, force: true })
      mkdirSync(dirname(target), { recursive: true })
      symlinkSync(link === 'directory' ? foreignDir : foreignFile, target)
      const result = replay()
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('')
      expect(calls()).toEqual(['agent-codex-runtime-linked-history'])
      expect(observed()).toEqual([])
      expect(readFileSync(foreignFile, 'utf8')).toBe(bytes)
      expect(readdirSync(foreignDir)).toEqual([`${hash}.json`])
    })
  }
})
