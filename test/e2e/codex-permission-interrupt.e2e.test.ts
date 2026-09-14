import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'path'
import { createSandbox, type Sandbox } from './helpers/sandbox'

let sandbox: Sandbox
const name = 'agent-codex-permission-interrupt'
const marker = '.clooks/permission-interrupt-calls.json'
const reason = ' Original approval denial. '
afterEach(() => sandbox?.cleanup())

function replay(origin: 'handler' | 'before-hook', interrupt: unknown) {
  sandbox.writeConfig(`version: "1.0.0"\n${name}: { handoff: true }\n`)
  const result = JSON.stringify({ result: 'block', reason, interrupt })
  const block =
    interrupt === undefined || interrupt === false
      ? `${origin === 'before-hook' ? 'event' : 'ctx'}.block(${JSON.stringify({ reason, interrupt })})`
      : result
  sandbox.writeHook(
    `${name}.ts`,
    `
import { writeFileSync } from 'fs'
const calls = []
function mark(stage) {
  calls.push(stage)
  writeFileSync(${JSON.stringify(join(sandbox.dir, marker))}, JSON.stringify(calls))
}
export const hook = {
  meta: { name: '${name}' },
  beforeHook(event) {
    mark('before')
    ${origin === 'before-hook' ? `return ${block}` : ''}
  },
  PermissionRequest(ctx) {
    mark('handler')
    ${origin === 'handler' ? `return ${block}` : 'return ctx.allow()'}
  },
}
`,
  )
  return sandbox.run([], {
    stdin: JSON.stringify({
      hook_event_name: 'PermissionRequest',
      session_id: 'permission-session',
      turn_id: 'turn',
      cwd: sandbox.dir,
      model: 'gpt-5',
      transcript_path: null,
      permission_mode: 'default',
      tool_name: 'Bash',
      tool_input: { command: 'echo approval' },
    }),
    env: { CLOOKS_AGENT: 'codex', CODEX_HOME: join(sandbox.home, '.codex') },
    timeout: 10_000,
  })
}

describe('Codex compiled PermissionRequest interrupt compatibility', () => {
  for (const origin of ['handler', 'before-hook'] as const) {
    for (const interrupt of [undefined, false, true, null, 0, 'false', {}, []]) {
      test(`${origin} interrupt=${JSON.stringify(interrupt)} preserves the supported denial contract`, () => {
        sandbox = createSandbox()
        const result = replay(origin, interrupt)
        expect(result.exitCode).toBe(0)
        expect(result.stderr).toBe('')
        expect(JSON.parse(sandbox.readFile(marker))).toEqual(
          origin === 'before-hook' ? ['before'] : ['before', 'handler'],
        )
        const output = JSON.parse(result.stdout)
        if (interrupt === undefined || interrupt === false) {
          expect(output).toEqual({
            hookSpecificOutput: {
              hookEventName: 'PermissionRequest',
              decision: { behavior: 'deny', message: reason },
            },
          })
        } else {
          expect(output.systemMessage).toContain('capability "interrupt"')
          expect(output.systemMessage).toContain('result effects refused')
          expect(output.hookSpecificOutput).toEqual({
            hookEventName: 'PermissionRequest',
            decision: { behavior: 'deny', message: output.systemMessage },
          })
          expect(output.hookSpecificOutput.decision.message).not.toBe(reason)
        }
        expect(output).not.toHaveProperty('interrupt')
        expect(output).not.toHaveProperty('continue')
        expect(sandbox.fileExists('.clooks/tmp')).toBe(false)
        expect(sandbox.homeFileExists('.clooks/tmp')).toBe(false)
      })
    }
  }
})
