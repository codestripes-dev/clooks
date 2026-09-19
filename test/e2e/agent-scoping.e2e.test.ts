import { afterEach, describe, expect, test } from 'bun:test'
import { rmSync } from 'fs'
import { join } from 'path'
import { createSandbox, formatDiagnostics, type RunResult, type Sandbox } from './helpers/sandbox'

let sandbox: Sandbox
const MARKS = '.clooks/agent-scoping.log'
const agents = ['claude-code', 'codex'] as const
const timeout = 15_000

afterEach(() => sandbox?.cleanup())

function markPath(): string {
  return join(sandbox.dir, MARKS)
}

/** Release-source-shaped envelope accepted by both adapters. */
function wire(event: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    hook_event_name: event,
    session_id: 'agent-scoping-session',
    cwd: sandbox.dir,
    transcript_path: null,
    model: 'gpt-5',
    permission_mode: 'default',
  }
  if (event === 'SessionStart') base.source = 'startup'
  if (event === 'PreToolUse' || event === 'PostToolUse') {
    base.turn_id = 'agent-scoping-turn'
    base.tool_name = 'Bash'
    base.tool_use_id = 'agent-scoping-call'
    base.tool_input = { command: 'echo hi' }
  }
  if (event === 'PostToolUse') base.tool_response = null
  return { ...base, ...overrides }
}

function run(agent: string, event: string, env: Record<string, string> = {}): RunResult {
  rmSync(markPath(), { force: true })
  return sandbox.run([], {
    stdin: JSON.stringify(wire(event)),
    env: { CLOOKS_AGENT: agent, CODEX_HOME: join(sandbox.home, '.codex'), ...env },
    timeout,
  })
}

function marks(): string[] {
  if (!sandbox.fileExists(MARKS)) return []
  return sandbox
    .readFile(MARKS)
    .split('\n')
    .filter((line) => line.length > 0)
    .sort()
}

function expectMarks(result: RunResult, expected: string[]): void {
  expect(result.exitCode, formatDiagnostics(result)).toBe(0)
  expect(marks()).toEqual([...expected].sort())
}

interface HookOptions {
  metaAgents?: string[]
  lifecycle?: boolean
  home?: boolean
}

/** A hook whose handlers append a line per invocation to the sandbox marker file. */
function markerHook(name: string, events: string[], opts: HookOptions = {}): void {
  const meta = opts.metaAgents
    ? `{ name: '${name}', agents: ${JSON.stringify(opts.metaAgents)} }`
    : `{ name: '${name}' }`
  const lifecycle = opts.lifecycle
    ? `  beforeHook() { mark('before:${name}') },\n  afterHook() { mark('after:${name}') },\n`
    : ''
  const handlers = events
    .map((event) => `  ${event}() { mark('${name}:${event}'); return { result: 'skip' } },`)
    .join('\n')
  const source = `import { appendFileSync } from 'fs'
const mark = (text) => appendFileSync(${JSON.stringify(markPath())}, text + '\\n')
export const hook = {
  meta: ${meta},
${lifecycle}${handlers}
}
`
  if (opts.home) sandbox.writeHomeHook(`${name}.ts`, source)
  else sandbox.writeHook(`${name}.ts`, source)
}

function systemMessage(result: RunResult): string {
  if (result.stdout.trim().length === 0) return ''
  const parsed = JSON.parse(result.stdout) as { systemMessage?: string }
  return parsed.systemMessage ?? ''
}

// ============================================================================
// Acceptance fixture — the four-hook cascade with an order list
// ============================================================================

describe('agent scoping — acceptance fixture', () => {
  for (const parallel of [false, true]) {
    for (const agent of agents) {
      test(`${agent}, parallel=${parallel}: only in-scope hooks run and the order list stays valid`, () => {
        sandbox = createSandbox()
        for (const name of ['only-codex', 'everywhere', 'inherits']) {
          markerHook(name, ['PreToolUse'], { lifecycle: true })
        }
        sandbox.writeConfig(`version: "1.0.0"
config:
  agents: [claude-code]
only-codex:
  agents: [codex]
  parallel: ${parallel}
everywhere:
  agents: [claude-code, codex]
  parallel: ${parallel}
inherits:
  parallel: ${parallel}
PreToolUse:
  order: [only-codex, everywhere, inherits]
`)

        const result = run(agent, 'PreToolUse')
        expect(result.stderr, formatDiagnostics(result)).toBe('')
        const ran = agent === 'codex' ? ['only-codex', 'everywhere'] : ['everywhere', 'inherits']
        expectMarks(
          result,
          ran.flatMap((name) => [`before:${name}`, `${name}:PreToolUse`, `after:${name}`]),
        )
      })
    }
  }
})

// ============================================================================
// Precedence
// ============================================================================

describe('agent scoping — precedence', () => {
  test('per-event agents override the hook-level list, for that event only', () => {
    sandbox = createSandbox()
    markerHook('multi', ['PreToolUse', 'PostToolUse'])
    sandbox.writeConfig(`version: "1.0.0"
multi:
  agents: [claude-code]
  events:
    PreToolUse:
      agents: [codex]
`)

    expectMarks(run('codex', 'PreToolUse'), ['multi:PreToolUse'])
    expectMarks(run('codex', 'PostToolUse'), [])
    expectMarks(run('claude-code', 'PreToolUse'), [])
    expectMarks(run('claude-code', 'PostToolUse'), ['multi:PostToolUse'])
  })

  test('meta beats config.agents, and the hook entry beats meta', () => {
    sandbox = createSandbox()
    markerHook('claude-only', ['PreToolUse'], { metaAgents: ['claude-code'] })
    sandbox.writeConfig(`version: "1.0.0"
config:
  agents: [codex]
claude-only: {}
`)

    // meta wins over the global fallback, so Codex does not run it.
    expectMarks(run('codex', 'PreToolUse'), [])
    expectMarks(run('claude-code', 'PreToolUse'), ['claude-only:PreToolUse'])

    // A deliberate yaml entry overrides the author's statement.
    sandbox.writeConfig(`version: "1.0.0"
config:
  agents: [codex]
claude-only:
  agents: [codex]
`)
    expectMarks(run('codex', 'PreToolUse'), ['claude-only:PreToolUse'])
    expectMarks(run('claude-code', 'PreToolUse'), [])
  })

  test('an alias uses its own entry and the imported implementation meta', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'impl.ts',
      `import { appendFileSync } from 'fs'
const mark = (text) => appendFileSync(${JSON.stringify(markPath())}, text + '\\n')
export const hook = {
  meta: { name: 'impl', agents: ['claude-code'], config: { tag: 'unset' } },
  PreToolUse(_ctx, config) { mark('run:' + config.tag); return { result: 'skip' } },
}
`,
    )
    sandbox.writeConfig(`version: "1.0.0"
impl:
  agents: [codex]
  config: { tag: target }
alias-one:
  uses: impl
  config: { tag: alias-one }
`)

    // The target entry's agents list is not inherited by the alias, which
    // falls back to the imported file's meta.
    expectMarks(run('codex', 'PreToolUse'), ['run:target'])
    expectMarks(run('claude-code', 'PreToolUse'), ['run:alias-one'])
  })

  test('a home hook with no agents of its own follows the merged config.agents', () => {
    sandbox = createSandbox()
    markerHook('home-hook', ['PreToolUse'], { home: true })
    sandbox.writeHomeConfig(`version: "1.0.0"
config:
  agents: [claude-code]
home-hook: {}
`)
    // The project layer replaces the home layer's list wholesale.
    sandbox.writeConfig(`version: "1.0.0"
config:
  agents: [codex]
`)

    expectMarks(run('codex', 'PreToolUse'), ['home-hook:PreToolUse'])
    expectMarks(run('claude-code', 'PreToolUse'), [])

    // And the local layer replaces the project layer in turn.
    sandbox.writeLocalConfig(`config:
  agents: [claude-code]
`)
    expectMarks(run('claude-code', 'PreToolUse'), ['home-hook:PreToolUse'])
    expectMarks(run('codex', 'PreToolUse'), [])
  })

  test('mixed and all-unknown lists: known ids match, unknown-only matches nothing', () => {
    sandbox = createSandbox()
    markerHook('mixed', ['PreToolUse'])
    markerHook('unknown-only', ['PreToolUse'])
    sandbox.writeConfig(`version: "1.0.0"
config:
  agents: [claude-code, codex]
mixed:
  agents: [codex, cursor]
unknown-only:
  agents: [cursor]
`)

    expectMarks(run('codex', 'PreToolUse'), ['mixed:PreToolUse'])
    expectMarks(run('claude-code', 'PreToolUse'), [])
  })
})

// ============================================================================
// Imports, lifecycle, and diagnostics
// ============================================================================

describe('agent scoping — imports, lifecycle, diagnostics', () => {
  for (const parallel of [false, true]) {
    for (const agent of agents) {
      const other = agent === 'codex' ? 'claude-code' : 'codex'
      test(`${agent}, parallel=${parallel}: an excluded hook imports but neither its handler nor its lifecycle runs`, () => {
        sandbox = createSandbox()
        markerHook('runs', ['PreToolUse'], { lifecycle: true })
        sandbox.writeHook(
          'excluded.ts',
          `import { appendFileSync } from 'fs'
const mark = (text) => appendFileSync(${JSON.stringify(markPath())}, text + '\\n')
mark('import:excluded')
export const hook = {
  meta: { name: 'excluded' },
  beforeHook() { mark('before:excluded') },
  afterHook() { mark('after:excluded') },
  PreToolUse() { mark('excluded:PreToolUse'); return { result: 'skip' } },
}
`,
        )
        sandbox.writeConfig(`version: "1.0.0"
runs:
  parallel: ${parallel}
excluded:
  agents: [${other}]
  parallel: ${parallel}
`)

        const result = run(agent, 'PreToolUse')
        expectMarks(result, ['import:excluded', 'before:runs', 'runs:PreToolUse', 'after:runs'])
      })
    }
  }

  for (const agent of agents) {
    const other = agent === 'codex' ? 'claude-code' : 'codex'
    test(`${agent}: an excluded hook whose import throws still blocks the action`, () => {
      sandbox = createSandbox()
      sandbox.writeHook(
        'broken.ts',
        `throw new Error('import exploded')
export const hook = { meta: { name: 'broken' }, PreToolUse() { return { result: 'skip' } } }
`,
      )
      sandbox.writeConfig(`version: "1.0.0"
broken:
  agents: [${other}]
`)

      const result = run(agent, 'PreToolUse')
      expect(result.exitCode, formatDiagnostics(result)).toBe(0)
      const output = JSON.parse(result.stdout)
      expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
      expect(output.systemMessage).toContain('broken')
      expect(output.systemMessage).toContain('import exploded')
    })
  }

  test('an order list naming a hook whose import throws degrades instead of throwing an ordering error', () => {
    sandbox = createSandbox()
    markerHook('healthy', ['PreToolUse'])
    sandbox.writeHook(
      'broken.ts',
      `throw new Error('import exploded')
export const hook = { meta: { name: 'broken' }, PreToolUse() { return { result: 'skip' } } }
`,
    )
    sandbox.writeConfig(`version: "1.0.0"
broken:
  maxFailures: 1
healthy: {}
PreToolUse:
  order: [broken, healthy]
`)

    const result = run('claude-code', 'PreToolUse')
    expect(result.exitCode, formatDiagnostics(result)).toBe(0)
    expect(result.stderr).not.toContain('does not handle this event')
    const output = JSON.parse(result.stdout)
    expect(output.systemMessage).toContain('has been disabled after 1 consecutive load failures')
    expectMarks(result, ['healthy:PreToolUse'])
  })

  test('debug output names the level that excluded the hook', () => {
    sandbox = createSandbox()
    markerHook('by-entry', ['PreToolUse'])
    markerHook('by-event', ['PreToolUse'])
    markerHook('by-meta', ['PreToolUse'], { metaAgents: ['claude-code'] })
    markerHook('by-global', ['PreToolUse'])
    sandbox.writeConfig(`version: "1.0.0"
config:
  agents: [claude-code]
by-entry:
  agents: [claude-code]
by-event:
  events:
    PreToolUse:
      agents: [claude-code]
by-meta: {}
by-global: {}
`)

    const result = run('codex', 'PreToolUse', { CLOOKS_DEBUG: 'true' })
    expect(result.exitCode, formatDiagnostics(result)).toBe(0)
    expect(result.stderr).toContain(
      'hook "by-entry" skipped for agent "codex" via clooks.yml hook agents',
    )
    expect(result.stderr).toContain(
      'hook "by-event" skipped for agent "codex" via clooks.yml events.PreToolUse.agents',
    )
    expect(result.stderr).toContain('hook "by-meta" skipped for agent "codex" via hook meta.agents')
    expect(result.stderr).toContain(
      'hook "by-global" skipped for agent "codex" via clooks.yml config.agents',
    )
    expect(marks()).toEqual([])
  })

  test('exclusion alone produces no startup warning', () => {
    sandbox = createSandbox()
    markerHook('only-claude', ['PreToolUse', 'SessionStart'])
    markerHook('shared', ['PreToolUse', 'SessionStart'])
    sandbox.writeConfig(`version: "1.0.0"
only-claude:
  agents: [claude-code]
shared: {}
PreToolUse:
  order: [only-claude, shared]
`)

    const session = run('codex', 'SessionStart')
    expect(systemMessage(session)).toBe('')
    expect(session.stderr).toBe('')
    expectMarks(session, ['shared:SessionStart'])

    const pre = run('codex', 'PreToolUse')
    expect(pre.stderr, formatDiagnostics(pre)).toBe('')
    expectMarks(pre, ['shared:PreToolUse'])
  })
})

// ============================================================================
// Unknown agent ids
// ============================================================================

describe('agent scoping — unknown agent ids', () => {
  const warning = 'clooks: unknown agent ids in agents lists (ignored)'

  function occurrences(result: RunResult): number {
    return (result.stdout + result.stderr).split(warning).length - 1
  }

  for (const agent of agents) {
    test(`${agent}: one collapsed SessionStart warning, deduplicated and sorted`, () => {
      sandbox = createSandbox()
      markerHook('a', ['SessionStart'], { metaAgents: ['cursor'] })
      markerHook('b', ['SessionStart'])
      sandbox.writeConfig(`version: "1.0.0"
config:
  agents: [windsurf]
a: {}
b:
  agents: [cursor, claude-code]
  events:
    SessionStart:
      agents: [cursor, codex]
`)

      const result = run(agent, 'SessionStart')
      expect(result.exitCode, formatDiagnostics(result)).toBe(0)
      const message = systemMessage(result)
      expect(message).toContain(`${warning}: cursor, windsurf`)
      expect(occurrences(result)).toBe(1)
    })

    test(`${agent}: warns exactly once with no hooks registered at all`, () => {
      sandbox = createSandbox()
      sandbox.writeConfig(`version: "1.0.0"
config:
  agents: [future-agent]
`)

      const result = run(agent, 'SessionStart')
      expect(result.exitCode, formatDiagnostics(result)).toBe(0)
      expect(systemMessage(result)).toContain(`${warning}: future-agent`)
      expect(occurrences(result)).toBe(1)
    })

    test(`${agent}: silent with no hooks registered on a non-SessionStart event`, () => {
      sandbox = createSandbox()
      sandbox.writeConfig(`version: "1.0.0"
config:
  agents: [future-agent]
`)

      const result = run(agent, 'PreToolUse')
      expect(result.exitCode, formatDiagnostics(result)).toBe(0)
      expect(occurrences(result)).toBe(0)
    })

    test(`${agent}: warns exactly once when no hook handles SessionStart`, () => {
      sandbox = createSandbox()
      markerHook('pre-only', ['PreToolUse'])
      sandbox.writeConfig(`version: "1.0.0"
pre-only:
  agents: [cursor]
`)

      const result = run(agent, 'SessionStart')
      expect(result.exitCode, formatDiagnostics(result)).toBe(0)
      expect(systemMessage(result)).toContain(`${warning}: cursor`)
      expect(occurrences(result)).toBe(1)
    })

    test(`${agent}: silent on events other than SessionStart`, () => {
      sandbox = createSandbox()
      markerHook('pre-only', ['PreToolUse'])
      sandbox.writeConfig(`version: "1.0.0"
config:
  agents: [claude-code, codex]
pre-only:
  agents: [cursor]
`)

      const result = run(agent, 'PreToolUse')
      expect(result.exitCode, formatDiagnostics(result)).toBe(0)
      expect(occurrences(result)).toBe(0)
      expectMarks(result, [])
    })
  }
})
