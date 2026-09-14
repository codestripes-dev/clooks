import { afterEach, describe, expect, test } from 'bun:test'
import { join, resolve } from 'path'
import { createSandbox, type Sandbox } from './helpers/sandbox'

let sandbox: Sandbox
afterEach(() => sandbox?.cleanup())

describe('typed PreToolUse skip context across agents', () => {
  for (const agent of ['claude-code', 'codex']) {
    for (const mode of ['sequential', 'parallel-forward', 'parallel-reverse']) {
      for (const winner of ['skip', 'allow', 'block']) {
        test(`${agent} ${mode} ending with ${winner}`, () => {
          sandbox = createSandbox()
          const names = ['skip-first', 'skip-second', 'skip-final']
          const parallel = mode !== 'sequential'
          const completion = mode === 'parallel-reverse' ? [...names].reverse() : names
          const log = 'completion.log'
          sandbox.writeHook(
            'barrier.ts',
            `
const releases = new Map<string, () => void>()
const gates = new Map(${JSON.stringify(names)}.map(name => [name, new Promise<void>(resolve => releases.set(name, resolve))]))
export const wait = (name: string) => gates.get(name)
export const release = (name: string) => releases.get(name)?.()
release(${JSON.stringify(completion[0])})
`,
          )
          names.forEach((name, index) => {
            const decision =
              index < 2
                ? `ctx.skip({ injectContext: ${JSON.stringify(index === 0 ? 'A' : 'B')} })`
                : winner === 'block'
                  ? `ctx.block({ reason: 'R' })`
                  : `ctx.${winner}()`
            sandbox.writeHook(
              `${name}.ts`,
              `
import type { PreToolUseContext } from ${JSON.stringify(resolve(import.meta.dir, '../../src/types/contexts.ts'))}
import { appendFileSync } from 'fs'
import { wait, release } from './barrier.ts'
export const hook = {
  meta: { name: ${JSON.stringify(name)} },
  async PreToolUse(ctx: PreToolUseContext) {
    ${parallel ? `await wait(${JSON.stringify(name)})` : ''}
    appendFileSync(${JSON.stringify(join(sandbox.dir, log))}, ${JSON.stringify(name + '\n')})
    return ${decision}
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
          const result = sandbox.run([], {
            stdin: JSON.stringify({
              hook_event_name: 'PreToolUse',
              model: 'gpt-5',
              session_id: 'skip-session',
              cwd: sandbox.dir,
              transcript_path: null,
              permission_mode: 'default',
              turn_id: 'skip-turn',
              tool_name: 'Bash',
              tool_use_id: 'skip-call',
              tool_input: { command: 'echo original' },
            }),
            env: { CLOOKS_AGENT: agent, CODEX_HOME: join(sandbox.home, '.codex') },
            timeout: 10_000,
          })
          expect(result.exitCode).toBe(0)
          expect(result.stderr).toBe('')
          expect(JSON.parse(result.stdout)).toEqual({
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              additionalContext: 'A\nB',
              ...(winner === 'block'
                ? { permissionDecision: 'deny', permissionDecisionReason: 'R' }
                : winner === 'allow' && agent === 'claude-code'
                  ? { permissionDecision: 'allow' }
                  : {}),
            },
          })
          expect(sandbox.readFile(log).trim().split('\n')).toEqual(completion)
        })
      }
    }
  }
})
