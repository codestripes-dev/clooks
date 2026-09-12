import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'
import { createSandbox, type RunResult, type Sandbox } from './helpers/sandbox'
import { registrationEnv } from './helpers/registration'

let sandbox: Sandbox
const name = 'agent-codex-runtime-state-delivery'
const observation = '.clooks/agent-codex-runtime-state-delivery.json'
const imported = '.clooks/agent-codex-runtime-state-delivery.import'
const ready = '.clooks/agent-codex-runtime-state-delivery.ready'
const release = '.clooks/agent-codex-runtime-state-delivery.release'
type Event =
  | 'Stop'
  | 'SubagentStop'
  | 'UserPromptSubmit'
  | 'SessionStart'
  | 'SubagentStart'
  | 'PermissionRequest'

afterEach(() => sandbox?.cleanup())

function wire(event: Event, fields: Record<string, unknown> = {}) {
  return {
    hook_event_name: event,
    session_id: 'shared-session',
    cwd: sandbox.dir,
    model: 'gpt-5',
    transcript_path: null,
    permission_mode: 'default',
    ...(event === 'SessionStart' ? { source: 'startup' } : { turn_id: 'same-turn' }),
    ...(event === 'UserPromptSubmit' ? { prompt: 'ordinary prompt' } : {}),
    ...(event === 'PermissionRequest'
      ? { tool_name: 'Bash', tool_input: { command: 'echo approval' } }
      : {}),
    ...(event === 'SubagentStart' ? { agent_id: 'child-a', agent_type: 'worker' } : {}),
    ...(event === 'Stop' || event === 'SubagentStop'
      ? { stop_hook_active: false, last_assistant_message: null }
      : {}),
    ...(event === 'SubagentStop'
      ? { agent_id: 'child-a', agent_type: 'worker', agent_transcript_path: null }
      : {}),
    ...fields,
  }
}

function options(event: Event, fields: Record<string, unknown> = {}, provider = 'codex') {
  return {
    stdin: JSON.stringify(wire(event, fields)),
    timeout: 10_000,
    env: { CLOOKS_AGENT: provider, CODEX_HOME: join(sandbox.home, '.codex') },
  }
}

function clearArtifacts() {
  for (const path of [observation, imported]) {
    rmSync(join(sandbox.dir, path), { force: true })
    expect(sandbox.fileExists(path)).toBe(false)
  }
}

function replay(event: Event, fields: Record<string, unknown> = {}, provider = 'codex') {
  clearArtifacts()
  return sandbox.run([], options(event, fields, provider))
}

function output(result: RunResult, expected?: unknown) {
  expect(result.exitCode).toBe(0)
  expect(result.stderr).toBe('')
  if (expected === undefined) expect(result.stdout).toBe('')
  else expect(JSON.parse(result.stdout)).toEqual(expected)
}

function install() {
  sandbox.writeConfig(`version: "1.0.0"\n${name}: {}\n`)
  // Deliberately no prompt/start handler: boundaries must not depend on a match.
  sandbox.writeHook(
    `${name}.ts`,
    `
import { existsSync, writeFileSync } from 'fs'
writeFileSync(${JSON.stringify(join(sandbox.dir, imported))}, 'imported')
async function stop(ctx) {
  writeFileSync(${JSON.stringify(join(sandbox.dir, observation))}, JSON.stringify({
    prior: ctx.turn.priorInterventions, session: ctx.sessionId, agent: ctx.agentId
  }))
  if (ctx.lastAssistantMessage === 'hold') {
    writeFileSync(${JSON.stringify(join(sandbox.dir, ready))}, 'ready')
    const deadline = Date.now() + 5000
    while (!existsSync(${JSON.stringify(join(sandbox.dir, release))})) {
      if (Date.now() > deadline) throw new Error('release deadline exceeded')
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }
  return ctx.turn.priorInterventions ? ctx.skip() : ctx.block({ reason: 'reminder' })
}
export const hook = { meta: { name: '${name}' }, Stop: stop, SubagentStop: stop }
`,
  )
}

function stop(prior: number, session = 'shared-session', child?: string, provider = 'codex') {
  output(
    replay(
      child ? 'SubagentStop' : 'Stop',
      {
        session_id: session,
        stop_hook_active: prior > 0,
        ...(child ? { agent_id: child } : {}),
      },
      provider,
    ),
    prior ? undefined : { decision: 'block', reason: 'reminder' },
  )
  expect(sandbox.fileExists(imported)).toBe(true)
  expect(sandbox.fileExists(observation)).toBe(true)
  expect(JSON.parse(sandbox.readFile(observation))).toEqual({
    prior,
    session,
    ...(child ? { agent: child } : {}),
  })
}

function statePath(session = 'shared-session') {
  const hash = createHash('sha256').update(session).digest('hex').slice(0, 16)
  return `.clooks/turn-state/codex/${hash}.json`
}

async function waitReady(path = ready) {
  const deadline = Date.now() + 5000
  while (!sandbox.fileExists(path) || sandbox.readFile(path) !== 'ready') {
    if (Date.now() > deadline) throw new Error('ready deadline exceeded')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  expect(sandbox.readFile(path)).toBe('ready')
}

describe('Codex cross-event state isolation', () => {
  test('two sessions and two children retain independent reminders across a root reset and Claude interleave', () => {
    sandbox = createSandbox()
    install()
    for (const session of ['shared-session', 'other-session']) {
      for (const child of [undefined, 'child-a', 'child-b']) stop(0, session, child)
    }
    stop(0, 'shared-session', undefined, 'claude-code')
    output(replay('UserPromptSubmit'))
    expect(sandbox.fileExists(observation)).toBe(false)
    for (const child of [undefined, 'child-a', 'child-b']) {
      stop(0, 'shared-session', child)
      stop(1, 'other-session', child)
    }
    stop(1, 'shared-session', undefined, 'claude-code')
  }, 30_000)

  test('unmatched session boundaries preserve or reset history and malformed identity leaves bytes unchanged', () => {
    sandbox = createSandbox()
    install()
    stop(0)
    for (const source of ['resume', 'compact']) {
      output(replay('SessionStart', { source }))
      expect(sandbox.fileExists(observation)).toBe(false)
      stop(1)
    }
    const before = sandbox.readHomeFile(statePath())
    const result = replay('UserPromptSubmit', { session_id: undefined })
    const reason =
      'clooks: Codex UserPromptSubmit hook "runtime" capability "session_id": session_id must be a nonempty string; hooks were not imported or executed. Inspected prompt rejection requested.'
    output(result, { decision: 'block', reason, systemMessage: reason })
    expect(sandbox.fileExists(imported)).toBe(false)
    expect(sandbox.fileExists(observation)).toBe(false)
    expect(sandbox.readHomeFile(statePath())).toBe(before)
    for (const source of ['clear', 'startup']) {
      output(replay('SessionStart', { source }))
      expect(sandbox.fileExists(observation)).toBe(false)
      stop(0)
    }
  }, 30_000)

  for (const reset of [false, true]) {
    test(`a held Stop commits only into its original prompt generation, reset=${reset}`, async () => {
      sandbox = createSandbox()
      install()
      output(replay('UserPromptSubmit'))
      for (const path of [ready, release]) {
        rmSync(join(sandbox.dir, path), { force: true })
        expect(sandbox.fileExists(path)).toBe(false)
      }
      clearArtifacts()
      const pending = sandbox.runAsync([], options('Stop', { last_assistant_message: 'hold' }))
      try {
        await waitReady()
        expect(sandbox.fileExists(observation)).toBe(true)
        expect(JSON.parse(sandbox.readFile(observation)).prior).toBe(0)
        if (reset) output(replay('UserPromptSubmit'))
      } finally {
        sandbox.writeFile(release, 'release')
        output(await pending, { decision: 'block', reason: 'reminder' })
      }
      stop(reset ? 0 : 1)
    }, 20_000)
  }
})

test('overlapping root and two child invocations retain every acknowledged write in their own scope', async () => {
  sandbox = createSandbox()
  install()
  const participants = [
    { scope: 'main', event: 'Stop' as const, fields: {} },
    { scope: 'child-a', event: 'SubagentStop' as const, fields: { agent_id: 'child-a' } },
    { scope: 'child-b', event: 'SubagentStop' as const, fields: { agent_id: 'child-b' } },
  ]
  // Warm one shared generation before launching writers; cold starts can have distinct epochs.
  stop(0)
  stop(0, 'shared-session', 'child-a')
  stop(0, 'shared-session', 'child-b')
  rmSync(join(sandbox.dir, release), { force: true })
  expect(sandbox.fileExists(release)).toBe(false)
  for (const participant of participants) {
    for (const suffix of ['ready', 'json']) {
      const path = `${ready}.${participant.scope}.${suffix}`
      rmSync(join(sandbox.dir, path), { force: true })
      expect(sandbox.fileExists(path)).toBe(false)
    }
  }
  sandbox.writeHook(
    `${name}.ts`,
    `
import { existsSync, writeFileSync } from 'fs'
async function observe(ctx) {
  const scope = ctx.agentId || 'main'
  const prefix = ${JSON.stringify(join(sandbox.dir, ready))} + '.' + scope
  writeFileSync(prefix + '.json', JSON.stringify({
    scope, session: ctx.sessionId, prior: ctx.turn.prior.map(record => record.decision), pid: process.pid
  }))
  writeFileSync(prefix + '.ready', 'ready')
  const deadline = Date.now() + 5000
  while (!existsSync(${JSON.stringify(join(sandbox.dir, release))})) {
    if (Date.now() > deadline) throw new Error('concurrent release deadline exceeded')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  return ctx.skip()
}
export const hook = { meta: { name: '${name}' }, Stop: observe, SubagentStop: observe }
`,
  )
  const pending = participants.map((participant) =>
    sandbox.runAsync(
      [],
      options(participant.event, {
        ...participant.fields,
        stop_hook_active: true,
      }),
    ),
  )
  try {
    await Promise.all(
      participants.map((participant) => waitReady(`${ready}.${participant.scope}.ready`)),
    )
    const pids = new Set<number>()
    for (const participant of participants) {
      const path = `${ready}.${participant.scope}.json`
      expect(sandbox.fileExists(path)).toBe(true)
      const record = JSON.parse(sandbox.readFile(path))
      expect(record).toEqual({
        scope: participant.scope,
        session: 'shared-session',
        prior: ['block'],
        pid: expect.any(Number),
      })
      pids.add(record.pid)
    }
    expect(pids.size).toBe(3)
    expect(sandbox.fileExists(release)).toBe(false)
  } finally {
    sandbox.writeFile(release, 'release')
    const results = await Promise.all(pending)
    // Empty stderr excludes lock-timeout/write-skipped outcomes: all three commits are acknowledged.
    for (const result of results) output(result)
  }
  const state = JSON.parse(sandbox.readHomeFile(statePath()))
  expect(Object.keys(state.scopes).sort()).toEqual(['agent:child-a', 'agent:child-b', 'main'])
  for (const scope of ['main', 'agent:child-a', 'agent:child-b']) {
    expect(
      state.scopes[scope][name].map((record: { decision: string }) => record.decision),
    ).toEqual(['block', 'skip'])
  }
}, 20_000)

function noHandoffFiles() {
  for (const root of [sandbox.dir, sandbox.home]) {
    const dir = join(root, '.clooks/tmp')
    expect(
      existsSync(dir) ? readdirSync(dir).filter((file) => file.includes('handoff-')) : [],
    ).toEqual([])
  }
}

describe('Codex inline delivery and reminder history', () => {
  for (const event of ['Stop', 'SubagentStop'] as const) {
    test(`${event}: requested long handoff stays inline, preserves raw reminder history and rejects before delivery`, () => {
      sandbox = createSandbox()
      const reason = 'Recipient-specific reminder.\n'.repeat(100)
      sandbox.writeConfig(`version: "1.0.0"\n${name}: { handoff: true }\n`)
      sandbox.writeHook(
        `${name}.ts`,
        `
import { writeFileSync } from 'fs'
export const hook = { meta: { name: '${name}' }, ${event}(ctx) {
  writeFileSync(${JSON.stringify(join(sandbox.dir, observation))}, JSON.stringify({
    prior: ctx.turn.priorInterventions, session: ctx.sessionId, agent: ctx.agentId
  }))
  if (ctx.lastAssistantMessage === 'reject') return { result: 'block', reason: ${JSON.stringify(reason)}, continue: false }
  return ctx.turn.priorInterventions ? ctx.skip() : ctx.block({ reason: ${JSON.stringify(reason)} })
} }
`,
      )
      output(replay(event), {
        decision: 'block',
        reason,
        systemMessage:
          'clooks: requested Codex handoff remains inline; recipient file readability is unverified.',
      })
      expect(sandbox.fileExists(observation)).toBe(true)
      expect(JSON.parse(sandbox.readFile(observation))).toEqual({
        prior: 0,
        session: 'shared-session',
        ...(event === 'SubagentStop' ? { agent: 'child-a' } : {}),
      })
      noHandoffFiles()
      output(replay(event, { stop_hook_active: true }))
      expect(sandbox.fileExists(observation)).toBe(true)
      expect(JSON.parse(sandbox.readFile(observation)).prior).toBe(1)
      noHandoffFiles()
      const rejected = replay(event, { last_assistant_message: 'reject', stop_hook_active: true })
      const message = `clooks: Codex ${event} hook "${name}" capability "continue": unsupported field continue on block; result effects refused. ${event === 'Stop' ? 'Continuation' : 'Child continuation'} termination requested; no further continuation is requested.`
      output(rejected, { continue: false, stopReason: message, systemMessage: message })
      expect(sandbox.fileExists(observation)).toBe(true)
      noHandoffFiles()
    }, 20_000)
  }
})

function launcher(command: string, event: Event) {
  clearArtifacts()
  const started = performance.now()
  const result = Bun.spawnSync(['bash', '-c', command], {
    cwd: sandbox.dir,
    env: registrationEnv(sandbox),
    stdin: Buffer.from(JSON.stringify(wire(event))),
    timeout: 10_000,
  })
  return {
    exitCode: result.exitCode ?? 2,
    rawExitCode: result.exitCode,
    signalCode: result.signalCode ?? null,
    elapsedMs: performance.now() - started,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}

describe('Generated Codex commands execute the compiled runtime', () => {
  for (const scope of ['project', 'global'] as const) {
    test(`${scope}: actual registered commands retain JSON refusal, local failure and advisory-only channels`, () => {
      sandbox = createSandbox()
      mkdirSync(join(sandbox.dir, '.clooks'), { recursive: true })
      const init = sandbox.run(
        ['init', '--agent', 'codex', ...(scope === 'global' ? ['--global'] : [])],
        {
          timeout: 10_000,
          env: registrationEnv(sandbox),
        },
      )
      expect(init.exitCode).toBe(0)
      const registration = JSON.parse(
        scope === 'global'
          ? sandbox.readHomeFile('.codex/hooks.json')
          : sandbox.readFile('.codex/hooks.json'),
      )
      const configure = (body: string, event: Event, settings = '{}') => {
        const config = `version: "1.0.0"\n${name}: ${settings}\n`
        const hook = `
import { writeFileSync } from 'fs'
export const hook = { meta: { name: '${name}' }, ${event}(ctx) {
  writeFileSync(${JSON.stringify(join(sandbox.dir, observation))}, 'reached')
  ${body}
} }
`
        if (scope === 'global') {
          sandbox.writeHomeConfig(config)
          sandbox.writeHomeHook(`${name}.ts`, hook)
        } else {
          sandbox.writeConfig(config)
          sandbox.writeHook(`${name}.ts`, hook)
        }
      }
      for (const event of ['PermissionRequest', 'SubagentStart', 'Stop'] as const) {
        const command = registration.hooks[event][0].hooks[0].command
        expect(typeof command).toBe('string')
        configure('return ctx.skip()', event)
        output(launcher(command, event))
        expect(sandbox.fileExists(observation)).toBe(true)
        expect(sandbox.readFile(observation)).toBe('reached')
        if (event === 'PermissionRequest') {
          configure("return ctx.block({ reason: 'approval refused' })", event)
          output(launcher(command, event), {
            hookSpecificOutput: {
              hookEventName: event,
              decision: { behavior: 'deny', message: 'approval refused' },
            },
          })
        } else if (event === 'Stop') {
          configure("throw new Error('fixture crash')", event, '{ onError: continue }')
          output(launcher(command, event), {
            systemMessage: `[clooks] Hook "${name}" failed on Stop (Error: fixture crash). Continuing (onError: continue).`,
          })
        } else {
          configure("throw new Error('fixture crash')", event)
          const result = launcher(command, event)
          expect(result.exitCode).toBe(2)
          expect(result.stdout).toBe('')
          expect(result.stderr).toBe(
            `clooks: Codex SubagentStart hook "${name}" capability "engine-error": [clooks] Hook "${name}" failed on SubagentStart (Error: fixture crash). Action blocked (onError: block).; result effects refused. Local hook failure only; no native startup veto is available and detailed stderr may be discarded.\n`,
          )
        }
        expect(sandbox.fileExists(observation)).toBe(true)
        expect(sandbox.readFile(observation)).toBe('reached')
      }
    }, 30_000)
  }
})

describe('Compiled Codex engine process failure channels', () => {
  const faults = [
    {
      name: 'SIGTERM',
      action: "process.kill(process.pid, 'SIGTERM')",
      stderr: 'clooks: killed by SIGTERM\n',
    },
    {
      name: 'SIGINT',
      action: "process.kill(process.pid, 'SIGINT')",
      stderr: 'clooks: interrupted\n',
    },
    {
      name: 'uncaught exception',
      action: "throw new Error('fixture asynchronous exception')",
      stderr: 'clooks: uncaught exception: Error: fixture asynchronous exception\n',
    },
    {
      name: 'unhandled rejection',
      action: "void Promise.reject(new Error('fixture asynchronous rejection'))",
      stderr: 'clooks: unhandled rejection: fixture asynchronous rejection\n',
    },
  ]
  for (const fault of faults) {
    test(`${fault.name} after a reached hook exits locally without fabricated JSON`, () => {
      sandbox = createSandbox()
      install()
      stop(0)
      sandbox.writeHook(
        `${name}.ts`,
        `
import { writeFileSync } from 'fs'
export const hook = { meta: { name: '${name}' }, async Stop(ctx) {
  writeFileSync(${JSON.stringify(join(sandbox.dir, observation))}, 'fault reached')
  setTimeout(() => { ${fault.action} }, 0)
  await new Promise(() => {})
  return ctx.skip()
} }
`,
      )
      clearArtifacts()
      const started = performance.now()
      const result = Bun.spawnSync([join(import.meta.dir, '../../dist/clooks')], {
        cwd: sandbox.dir,
        env: { ...registrationEnv(sandbox), CLOOKS_AGENT: 'codex' },
        stdin: Buffer.from(JSON.stringify(wire('Stop', { stop_hook_active: true }))),
        timeout: 10_000,
      })
      // A timeout's SIGTERM must not masquerade as the fixture's own signal.
      expect(performance.now() - started).toBeLessThan(5000)
      expect(sandbox.fileExists(observation)).toBe(true)
      expect(sandbox.readFile(observation)).toBe('fault reached')
      expect(result.exitCode).toBe(2)
      expect(result.stdout.toString()).toBe('')
      expect(result.stderr.toString()).toBe(fault.stderr)
    }, 20_000)
  }
})
