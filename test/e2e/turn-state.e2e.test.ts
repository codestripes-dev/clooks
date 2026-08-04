import { describe, test, expect, afterEach } from 'bun:test'
import { chmodSync, existsSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import { createSandbox, type Sandbox } from './helpers/sandbox'

const FIXTURES = join(import.meta.dir, '../fixtures')
const loadEvent = (name: string) => readFileSync(join(FIXTURES, 'events', name), 'utf8')

/**
 * The event fixtures are minimal and carry no `session_id` (and `session-start.json`
 * carries no `source`). Turn state is skipped entirely without a session identity, so
 * a test written against a bare fixture would pass while exercising nothing. Every
 * payload below is therefore built by parsing the fixture and adding what it needs.
 */
function payload(fixture: string, extra: Record<string, unknown>): string {
  return JSON.stringify({ ...JSON.parse(loadEvent(fixture)), ...extra })
}

const BREADCRUMB = 'turn-breadcrumb.log'

function crumbs(box: Sandbox): string[] {
  if (!box.fileExists(BREADCRUMB)) return []
  return box.readFile(BREADCRUMB).split('\n').filter(Boolean)
}

/** Mirrors `turnStatePath` in src/engine/turn-state.ts: sha256(sessionId), first 16 hex. */
function stateFileFor(box: Sandbox, sessionId: string): string {
  const hash = createHash('sha256').update(sessionId).digest('hex').slice(0, 16)
  return join(box.home, '.clooks', 'turn-state', `${hash}.json`)
}

function turnStateDir(box: Sandbox): string {
  return join(box.home, '.clooks', 'turn-state')
}

function crumbEnv(box: Sandbox): Record<string, string> {
  return { BREADCRUMB_FILE: join(box.dir, BREADCRUMB) }
}

/**
 * A `Stop` hook that reminds once per turn — the motivating pattern for the whole
 * feature. It leaves a breadcrumb on every run so a "did not block" assertion can
 * be distinguished from "never ran".
 */
const STOP_REMINDER = `
import { appendFileSync } from "fs"
export const hook = {
  meta: { name: "stop-reminder" },
  Stop(ctx: any) {
    appendFileSync(process.env.BREADCRUMB_FILE!, "saw:" + ctx.turn.priorInterventions + "\\n")
    if (ctx.turn.priorInterventions > 0) return { result: "skip" as const }
    return { result: "block" as const, reason: "Remember to lint." }
  },
}
`

function writeStopReminder(box: Sandbox): void {
  box.writeHook('stop-reminder.ts', STOP_REMINDER)
  box.writeConfig(`
version: "1.0.0"
stop-reminder: {}
`)
}

let sandbox: Sandbox

afterEach(() => {
  sandbox?.cleanup()
})

describe('turn state — E2E', () => {
  test('1. once-per-turn reminder blocks on the first Stop and skips on the second', () => {
    sandbox = createSandbox()
    writeStopReminder(sandbox)
    const stdin = payload('stop.json', { session_id: 'sess-motivating' })

    const first = sandbox.run([], { stdin, env: crumbEnv(sandbox) })
    expect(first.exitCode).toBe(0)
    expect(JSON.parse(first.stdout).decision).toBe('block')

    const second = sandbox.run([], { stdin, env: crumbEnv(sandbox) })
    expect(second.exitCode).toBe(0)
    expect(second.stdout).not.toContain('"decision"')

    // The hook ran both times — the second run is a decision, not a no-show.
    expect(crumbs(sandbox)).toEqual(['saw:0', 'saw:1'])
  })

  test('2. a UserPromptSubmit between two Stops resets the counter', () => {
    sandbox = createSandbox()
    writeStopReminder(sandbox)
    const session = 'sess-boundary'
    const stopStdin = payload('stop.json', { session_id: session })

    expect(
      JSON.parse(sandbox.run([], { stdin: stopStdin, env: crumbEnv(sandbox) }).stdout).decision,
    ).toBe('block')

    // No hook is registered for UserPromptSubmit: the boundary must still run,
    // because it sits ahead of the engine's no-hooks-matched early exit.
    const boundary = sandbox.run([], {
      stdin: payload('user-prompt-submit.json', { session_id: session }),
      env: crumbEnv(sandbox),
    })
    expect(boundary.exitCode).toBe(0)

    const after = sandbox.run([], { stdin: stopStdin, env: crumbEnv(sandbox) })
    expect(JSON.parse(after.stdout).decision).toBe('block')
    expect(crumbs(sandbox)).toEqual(['saw:0', 'saw:0'])
  })

  test('3. two sessions do not see each other history', () => {
    sandbox = createSandbox()
    writeStopReminder(sandbox)
    const a = payload('stop.json', { session_id: 'sess-a' })
    const b = payload('stop.json', { session_id: 'sess-b' })

    expect(JSON.parse(sandbox.run([], { stdin: a, env: crumbEnv(sandbox) }).stdout).decision).toBe(
      'block',
    )
    // A different session starts fresh even though `sess-a` just intervened.
    expect(JSON.parse(sandbox.run([], { stdin: b, env: crumbEnv(sandbox) }).stdout).decision).toBe(
      'block',
    )
    // …and the first session still remembers its own intervention.
    expect(sandbox.run([], { stdin: a, env: crumbEnv(sandbox) }).stdout).not.toContain('"decision"')

    expect(crumbs(sandbox)).toEqual(['saw:0', 'saw:0', 'saw:1'])
    expect(existsSync(stateFileFor(sandbox, 'sess-a'))).toBe(true)
    expect(existsSync(stateFileFor(sandbox, 'sess-b'))).toBe(true)
  })

  test('4. a subagent run records in the subagent scope, invisible to the main agent', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'scope-probe.ts',
      `
import { appendFileSync } from "fs"
export const hook = {
  meta: { name: "scope-probe" },
  SubagentStop(ctx: any) {
    appendFileSync(process.env.BREADCRUMB_FILE!, "SubagentStop:" + ctx.turn.prior.length + "\\n")
    return { result: "block" as const, reason: "subagent intervened" }
  },
  Stop(ctx: any) {
    appendFileSync(process.env.BREADCRUMB_FILE!, "Stop:" + ctx.turn.prior.length + "\\n")
    return { result: "skip" as const }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
scope-probe: {}
`)
    const session = 'sess-scopes'
    // Written inline: there is no subagent-stop fixture, and this is the only
    // test that needs one.
    const subagentStdin = JSON.stringify({
      hook_event_name: 'SubagentStop',
      session_id: session,
      agent_id: 'sub-1',
    })

    expect(
      JSON.parse(sandbox.run([], { stdin: subagentStdin, env: crumbEnv(sandbox) }).stdout).decision,
    ).toBe('block')

    sandbox.run([], {
      stdin: payload('stop.json', { session_id: session }),
      env: crumbEnv(sandbox),
    })

    // The subagent's own scope did keep the record — so the empty main-agent
    // history above is scoping, not a write that never happened.
    sandbox.run([], { stdin: subagentStdin, env: crumbEnv(sandbox) })

    expect(crumbs(sandbox)).toEqual(['SubagentStop:0', 'Stop:0', 'SubagentStop:1'])
  })

  test('5. a crash is recorded and visible to the same hook on its next run', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'crash-then-report.ts',
      `
export const hook = {
  meta: { name: "crash-then-report" },
  PostToolUse(ctx: any) {
    if (ctx.turn.prior.length === 0) throw new Error("first-run crash")
    return {
      result: "skip" as const,
      injectContext: "PRIOR=" + ctx.turn.prior.map((r: any) => r.decision).join(","),
    }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
crash-then-report: {}
`)
    const stdin = payload('post-tool-use.json', { session_id: 'sess-crash' })

    // A crash on PostToolUse surfaces through upstream's post-hoc feedback shape
    // (`decision: block` + reason), not through additionalContext.
    const first = sandbox.run([], { stdin })
    expect(first.exitCode).toBe(0)
    expect(JSON.parse(first.stdout).reason).toContain('first-run crash')

    const second = sandbox.run([], { stdin })
    expect(second.exitCode).toBe(0)
    expect(JSON.parse(second.stdout).hookSpecificOutput.additionalContext).toBe('PRIOR=error')
  })

  test('6. SessionStart source compact preserves history, startup clears it', () => {
    sandbox = createSandbox()
    writeStopReminder(sandbox)

    const preserved = 'sess-compact'
    const preservedStop = payload('stop.json', { session_id: preserved })
    expect(
      JSON.parse(sandbox.run([], { stdin: preservedStop, env: crumbEnv(sandbox) }).stdout).decision,
    ).toBe('block')
    sandbox.run([], {
      stdin: payload('session-start.json', { session_id: preserved, source: 'compact' }),
      env: crumbEnv(sandbox),
    })
    expect(sandbox.run([], { stdin: preservedStop, env: crumbEnv(sandbox) }).stdout).not.toContain(
      '"decision"',
    )

    const cleared = 'sess-startup'
    const clearedStop = payload('stop.json', { session_id: cleared })
    expect(
      JSON.parse(sandbox.run([], { stdin: clearedStop, env: crumbEnv(sandbox) }).stdout).decision,
    ).toBe('block')
    sandbox.run([], {
      stdin: payload('session-start.json', { session_id: cleared, source: 'startup' }),
      env: crumbEnv(sandbox),
    })
    expect(
      JSON.parse(sandbox.run([], { stdin: clearedStop, env: crumbEnv(sandbox) }).stdout).decision,
    ).toBe('block')

    expect(crumbs(sandbox)).toEqual(['saw:0', 'saw:1', 'saw:0', 'saw:0'])
  })

  test('7. an unwritable turn-state directory changes nothing a hook decides', () => {
    sandbox = createSandbox()
    writeStopReminder(sandbox)

    const healthy = sandbox.run([], {
      stdin: payload('stop.json', { session_id: 'sess-healthy' }),
      env: crumbEnv(sandbox),
    })
    expect(JSON.parse(healthy.stdout).decision).toBe('block')

    // Remove the managed directory and revoke write on its parent. Chmod-ing
    // `turn-state` itself would not bite: the engine tightens that directory's
    // mode through a descriptor it owns, so it would simply repair the mode and
    // write anyway. `.clooks` is deliberately left alone by that code, so a
    // directory that cannot be recreated is the reachable failure.
    const homeClooks = join(sandbox.home, '.clooks')
    rmSync(turnStateDir(sandbox), { recursive: true, force: true })
    chmodSync(homeClooks, 0o500)

    let degraded
    try {
      degraded = sandbox.run([], {
        stdin: payload('stop.json', { session_id: 'sess-degraded' }),
        env: crumbEnv(sandbox),
      })
    } finally {
      // Without this, `sandbox.cleanup()` cannot traverse the directory it must remove.
      chmodSync(homeClooks, 0o700)
    }

    expect(degraded.exitCode).toBe(healthy.exitCode)
    expect(degraded.stdout).toBe(healthy.stdout)
    expect(existsSync(turnStateDir(sandbox))).toBe(false)

    const warnings = degraded.stderr.split('\n').filter((line) => line.includes('clooks: warning:'))
    expect(warnings.length).toBeLessThanOrEqual(1)

    // Both runs were first-runs of their own session, so both saw an empty turn.
    expect(crumbs(sandbox)).toEqual(['saw:0', 'saw:0'])
  })

  test('8. concurrent invocations against one session leave a valid file and lose no acknowledged write', async () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'concurrent-observer.ts',
      `
export const hook = {
  meta: { name: "concurrent-observer" },
  PostToolUse() {
    return { result: "skip" as const }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
concurrent-observer: {}
`)
    const session = 'sess-contention'
    const stdin = payload('post-tool-use.json', { session_id: session })

    // Warm the document first. Every process that finds no file mints its own
    // random epoch, so a cold-start batch is not a lock-contention scenario at
    // all — the losers are discarded by the stamp check, by design, and the lock
    // is never the thing under test. One prior invocation gives all contenders a
    // shared stamp, which is the state a real session is in.
    const warmup = sandbox.run([], { stdin })
    expect(warmup.exitCode).toBe(0)

    const INVOCATIONS = 6
    const results = await Promise.all(
      Array.from({ length: INVOCATIONS }, () => sandbox.runAsync([], { stdin })),
    )
    for (const result of results) expect(result.exitCode).toBe(0)

    // A writer that could not take the lock, or whose write was abandoned, never
    // claimed its record landed. The bounded wait makes that a legitimate outcome,
    // so those invocations are excluded rather than assumed away.
    const skippedWrites = results.filter(
      (r) =>
        r.stderr.includes('turn state lock') ||
        r.stderr.includes('turn state write skipped') ||
        r.stderr.includes('turn state write failed'),
    ).length

    const raw = readFileSync(stateFileFor(sandbox, session), 'utf8')
    const state = JSON.parse(raw) as Record<string, unknown>

    // Mirrors `isTurnStateShape` in src/engine/turn-state.ts, re-implemented
    // locally because E2E tests exercise the compiled binary and never import
    // engine modules — and because importing the predicate would make the
    // assertion circular. A document that fails any of these is one the engine
    // would reject on the next read, silently resetting the turn.
    const isObject = (v: unknown) => typeof v === 'object' && v !== null && !Array.isArray(v)

    expect(state.version).toBe(1)
    expect(typeof state.epoch === 'string' && (state.epoch as string).length > 0).toBe(true)
    expect(Number.isSafeInteger(state.generation) && (state.generation as number) >= 0).toBe(true)
    expect(typeof state.updatedAt).toBe('string')
    expect(isObject(state.scopes)).toBe(true)

    const scopes = state.scopes as Record<string, Record<string, unknown[]>>
    let total = 0
    for (const byHook of Object.values(scopes)) {
      expect(isObject(byHook)).toBe(true)
      for (const records of Object.values(byHook)) {
        expect(Array.isArray(records)).toBe(true)
        for (const record of records as Record<string, unknown>[]) {
          expect(isObject(record)).toBe(true)
          expect(typeof record.event).toBe('string')
          expect(typeof record.decision).toBe('string')
          expect(typeof record.at).toBe('string')
          total++
        }
      }
    }

    expect(scopes.main?.['concurrent-observer']?.length ?? 0).toBe(total)
    expect(total).toBe(1 + INVOCATIONS - skippedWrites)
  })
})
