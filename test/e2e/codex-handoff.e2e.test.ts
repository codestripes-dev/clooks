import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'crypto'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { createSandbox, type Sandbox } from './helpers/sandbox'

let sandbox: Sandbox
const name = 'agent-codex-handoff'
afterEach(() => sandbox?.cleanup())

function run(event: string, result: Record<string, unknown>, setting: boolean | number = true) {
  sandbox.writeConfig(`version: "1.0.0"\n${name}: { handoff: ${setting} }\n`)
  sandbox.writeHook(
    `${name}.ts`,
    `export const hook = {
    meta: { name: '${name}' },
    ${event}() { return ${JSON.stringify(result)} }
  }`,
  )
  return sandbox.run([], {
    stdin: JSON.stringify({
      hook_event_name: event,
      session_id: 'handoff-session',
      turn_id: 'handoff-turn',
      cwd: sandbox.dir,
      model: 'gpt-5',
      transcript_path: null,
      permission_mode: 'default',
      tool_name: 'Bash',
      tool_use_id: 'handoff-call',
      tool_input: { command: 'echo original' },
      tool_response: 'done',
      prompt: 'prompt',
      source: 'startup',
      agent_id: 'child',
      agent_type: 'worker',
      agent_transcript_path: null,
      stop_hook_active: false,
      last_assistant_message: null,
    }),
    env: { CLOOKS_AGENT: 'codex', CODEX_HOME: join(sandbox.home, '.codex') },
    timeout: 10_000,
  })
}

function files() {
  return [sandbox.dir, sandbox.home]
    .flatMap((root) => {
      const dir = join(root, '.clooks/tmp')
      return existsSync(dir)
        ? readdirSync(dir)
            .filter((file) => file.startsWith('handoff-'))
            .map((file) => join(dir, file))
        : []
    })
    .sort()
}

function pointer(text: string) {
  const digest = createHash('sha256').update(text).digest('hex').slice(0, 12)
  const path = join(sandbox.dir, '.clooks/tmp', `handoff-${name}-${digest}.md`)
  expect(readFileSync(path, 'utf8')).toBe(text)
  return `[clooks] Hook "${name}": read ${path} and follow its instructions.`
}

describe('Codex compiled shared handoff', () => {
  for (const event of [
    'PreToolUse',
    'PostToolUse',
    'UserPromptSubmit',
    'SessionStart',
    'SubagentStart',
  ]) {
    test(`${event} delivers exact context pointers without warnings`, () => {
      sandbox = createSandbox()
      const text = `Context for ${event}.\n`.repeat(100)
      const result = run(event, { result: 'skip', injectContext: text })
      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe('')
      expect(JSON.parse(result.stdout)).toEqual({
        hookSpecificOutput: { hookEventName: event, additionalContext: pointer(text) },
      })
      expect(files()).toHaveLength(1)
    })
  }

  for (const event of ['PreToolUse', 'PostToolUse', 'Stop', 'SubagentStop']) {
    test(`${event} retains block decisions and rejection writes no new payloads`, () => {
      sandbox = createSandbox()
      const reason = `Block for ${event}.\n`.repeat(100)
      const result = run(event, { result: 'block', reason })
      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe('')
      const delivered = pointer(reason)
      expect(JSON.parse(result.stdout)).toEqual(
        event === 'PreToolUse'
          ? {
              hookSpecificOutput: {
                hookEventName: event,
                permissionDecision: 'deny',
                permissionDecisionReason: delivered,
              },
            }
          : { decision: 'block', reason: delivered },
      )
      const before = files()
      expect(before).toHaveLength(1)
      const rejected = run(event, {
        result: 'block',
        reason: 'NEW rejected reason',
        injectContext: 'NEW rejected context',
        continue: false,
      })
      expect(rejected.exitCode).toBe(0)
      expect(rejected.stderr).toBe('')
      const refusal = JSON.parse(rejected.stdout)
      expect(refusal.systemMessage).toContain('result effects refused')
      expect(refusal.hookSpecificOutput?.additionalContext).toBeUndefined()
      expect(files()).toEqual(before)
      expect(pointer(reason)).toBe(delivered)
    })
  }

  for (const setting of [false, 10] as const) {
    for (const text of ['123456789', '1234567890', '12345678901']) {
      test(`handoff=${setting} measures context length ${text.length}`, () => {
        sandbox = createSandbox()
        const result = run('PreToolUse', { result: 'skip', injectContext: text }, setting)
        const handedOff = setting !== false && text.length > setting
        expect(result.exitCode).toBe(0)
        expect(result.stderr).toBe('')
        expect(JSON.parse(result.stdout)).toEqual({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            additionalContext: handedOff ? pointer(text) : text,
          },
        })
        expect(files()).toHaveLength(handedOff ? 1 : 0)
      })
    }
  }

  test('failed file writes retain inline context and block decision', () => {
    sandbox = createSandbox()
    sandbox.writeFile('.clooks/tmp', 'not a directory')
    const reason = 'block reason\n'.repeat(100)
    const injectContext = 'model context\n'.repeat(100)
    const result = run('PreToolUse', { result: 'block', reason, injectContext })
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toContain('handoff write failed')
    expect(result.stderr).toContain('delivering inline')
    expect(JSON.parse(result.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
        additionalContext: injectContext,
      },
    })
    expect(sandbox.readFile('.clooks/tmp')).toBe('not a directory')
  })

  for (const event of ['UserPromptSubmit', 'PreToolUse']) {
    test(`${event} keeps human-only reasons inline`, () => {
      sandbox = createSandbox()
      const reason = 'human annotation\n'.repeat(100)
      const debugMessage = 'human debug\n'.repeat(100)
      const result = run(event, {
        result: event === 'PreToolUse' ? 'allow' : 'block',
        reason,
        debugMessage,
      })
      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe('')
      const output = JSON.parse(result.stdout)
      if (event === 'PreToolUse') {
        expect(Object.keys(output)).toEqual(['systemMessage'])
        expect(output.systemMessage).toContain(reason)
      } else expect(output).toEqual({ decision: 'block', reason })
      expect(files()).toEqual([])
    })
  }
})
