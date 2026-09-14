import { afterEach, describe, expect, test } from 'bun:test'
import { readdirSync } from 'fs'
import { join } from 'path'
import { createSandbox, type Sandbox } from './helpers/sandbox'

let sandbox: Sandbox
afterEach(() => sandbox?.cleanup())

function replay() {
  return sandbox.run([], {
    stdin: JSON.stringify({
      hook_event_name: 'PreToolUse',
      model: 'gpt-5',
      session_id: 'timeout-session',
      turn_id: 'timeout-turn',
      cwd: sandbox.dir,
      transcript_path: null,
      permission_mode: 'default',
      tool_name: 'Bash',
      tool_use_id: 'timeout-call',
      tool_input: { command: 'echo original' },
    }),
    env: { CLOOKS_AGENT: 'codex', CODEX_HOME: join(sandbox.home, '.codex') },
    timeout: 5000,
  })
}

describe('Codex compiled hook execution timeout', () => {
  for (const mode of ['block', 'continue', 'trace']) {
    test(`onError:${mode} uses the hook timeout and preserves diagnostic delivery`, () => {
      sandbox = createSandbox()
      sandbox.writeHook(
        'timeout-hang.ts',
        `
export const hook = {
  meta: { name: 'timeout-hang' },
  async PreToolUse() { await new Promise(() => {}) },
}
`,
      )
      sandbox.writeHook(
        'timeout-next.ts',
        `
import { writeFileSync } from 'fs'
export const hook = {
  meta: { name: 'timeout-next' },
  PreToolUse(ctx) {
    writeFileSync(${JSON.stringify(join(sandbox.dir, 'next.json'))}, JSON.stringify(ctx.toolInput))
    return ctx.skip({ injectContext: 'next-context' })
  },
}
`,
      )
      sandbox.writeConfig(`version: "1.0.0"
config:
  timeout: 2000
timeout-hang: { timeout: 100, onError: ${mode} }
timeout-next: {}
PreToolUse:
  order: [timeout-hang, timeout-next]
`)
      const result = replay()
      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe('')
      const output = JSON.parse(result.stdout)
      expect(output.hookSpecificOutput?.updatedInput).toBeUndefined()
      if (mode === 'block') {
        expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
        expect(output.hookSpecificOutput.permissionDecisionReason).toContain(
          'timed out after 100ms',
        )
        expect(output.hookSpecificOutput.permissionDecisionReason).toContain('timeout-hang')
        expect(output.hookSpecificOutput.additionalContext).toBeUndefined()
        expect(sandbox.fileExists('next.json')).toBe(false)
      } else {
        expect(output.hookSpecificOutput.permissionDecision).toBeUndefined()
        expect(JSON.parse(sandbox.readFile('next.json'))).toEqual({ command: 'echo original' })
        if (mode === 'continue') {
          expect(output.hookSpecificOutput.additionalContext).toBe('next-context')
          expect(output.systemMessage).toContain('timed out after 100ms')
          expect(output.systemMessage).toContain('Continuing')
        } else {
          expect(output.hookSpecificOutput.additionalContext).toContain('next-context')
          expect(output.hookSpecificOutput.additionalContext).toContain('timed out after 100ms')
          expect(output.hookSpecificOutput.additionalContext).toContain('onError: trace')
        }
      }
    })
  }

  for (const mode of ['continue', 'trace']) {
    for (const lateDecision of ['allow', 'ask']) {
      test(`onError:${mode} ignores a late ${lateDecision} after JavaScript completes`, () => {
        sandbox = createSandbox()
        sandbox.writeHook(
          'timeout-gate.ts',
          `
let release: () => void
let finish: () => void
export const gate = new Promise<void>(resolve => { release = resolve })
export const finished = new Promise<void>(resolve => { finish = resolve })
export const resume = () => release()
export const complete = () => finish()
`,
        )
        sandbox.writeHook(
          'timeout-late.ts',
          `
import { writeFileSync } from 'fs'
import { gate, complete } from './timeout-gate.ts'
export const hook = {
  meta: { name: 'timeout-late' },
  async PreToolUse(ctx) {
    await gate
    // A timeout does not cancel arbitrary JavaScript side effects.
    writeFileSync(${JSON.stringify(join(sandbox.dir, 'late-ran'))}, 'completed')
    return ctx.${lateDecision}({
      ${lateDecision === 'ask' ? "reason: 'late-ask-reason'," : ''}
      injectContext: 'late-context-must-not-appear',
      updatedInput: { command: 'echo late-rewrite' },
    })
  },
  afterHook() { complete() },
}
`,
        )
        sandbox.writeHook(
          'timeout-observer.ts',
          `
import { writeFileSync } from 'fs'
import { resume, finished } from './timeout-gate.ts'
export const hook = {
  meta: { name: 'timeout-observer' },
  async PreToolUse(ctx) {
    resume()
    await finished
    await new Promise(resolve => setTimeout(resolve, 0))
    writeFileSync(${JSON.stringify(join(sandbox.dir, 'observed.json'))}, JSON.stringify(ctx.toolInput))
    return ctx.skip({ injectContext: 'accepted-context' })
  },
}
`,
        )
        sandbox.writeConfig(`version: "1.0.0"
timeout-late: { timeout: 100, onError: ${mode}, handoff: true }
timeout-observer: { timeout: 2000, handoff: false }
PreToolUse:
  order: [timeout-late, timeout-observer]
`)
        const result = replay()
        expect(result.exitCode).toBe(0)
        expect(result.stderr).toBe('')
        expect(sandbox.readFile('late-ran')).toBe('completed')
        expect(JSON.parse(sandbox.readFile('observed.json'))).toEqual({ command: 'echo original' })
        const output = JSON.parse(result.stdout)
        expect(output.hookSpecificOutput.permissionDecision).toBeUndefined()
        expect(output.hookSpecificOutput.permissionDecisionReason).toBeUndefined()
        expect(output.hookSpecificOutput.updatedInput).toBeUndefined()
        expect(output.hookSpecificOutput.additionalContext).toContain('accepted-context')
        expect(result.stdout).not.toContain('late-context-must-not-appear')
        expect(result.stdout).not.toContain('late-ask-reason')
        expect(result.stdout).not.toContain('echo late-rewrite')
        const diagnostic =
          mode === 'trace' ? output.hookSpecificOutput.additionalContext : output.systemMessage
        expect(diagnostic).toContain('timed out after 100ms')
        const files = sandbox.fileExists('.clooks/tmp')
          ? readdirSync(join(sandbox.dir, '.clooks/tmp'))
          : []
        expect(files.filter((file) => file.startsWith('handoff-'))).toEqual([])
      })
    }
  }
})
