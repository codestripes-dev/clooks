import { describe, test, expect, afterEach } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createSandbox, type Sandbox } from './helpers/sandbox'

const FIXTURES = join(import.meta.dir, '../fixtures')
const loadHook = (name: string) => readFileSync(join(FIXTURES, 'hooks', name), 'utf8')

let sandbox: Sandbox

afterEach(() => {
  sandbox?.cleanup()
})

describe('init journey', () => {
  test('clooks init → write hook → pipe event → hook runs', () => {
    sandbox = createSandbox()

    // Step 1: Run clooks init (non-interactive because subprocess has no TTY)
    const initResult = sandbox.run(['init'], { timeout: 10_000 })
    expect(initResult.exitCode).toBe(0)

    // Step 2: Verify init created the expected files
    expect(sandbox.fileExists('.clooks/clooks.yml')).toBe(true)
    expect(sandbox.fileExists('.clooks/bin/entrypoint.sh')).toBe(true)
    expect(sandbox.fileExists('.clooks/hooks/types.d.ts')).toBe(true)
    expect(sandbox.fileExists('.clooks/clooks.schema.json')).toBe(true)
    expect(sandbox.fileExists('.claude/settings.json')).toBe(true)

    // Step 3: Write a hook and register it in the config
    sandbox.writeHook('allow-all.ts', loadHook('allow-all.ts'))
    sandbox.writeConfig(`version: "1.0.0"
allow-all:
  path: .clooks/hooks/allow-all.ts
`)

    // Step 4: Pipe a PreToolUse event through the entrypoint
    const event = JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
    })
    const result = sandbox.runEntrypoint({ stdin: event })

    // Step 5: Verify the hook ran and returned a result
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('allow')
  })

  test('init is idempotent — second run does not fail', () => {
    sandbox = createSandbox()

    const first = sandbox.run(['init'], { timeout: 10_000 })
    expect(first.exitCode).toBe(0)

    const second = sandbox.run(['init'], { timeout: 10_000 })
    expect(second.exitCode).toBe(0)

    // Config should still exist and be valid
    expect(sandbox.fileExists('.clooks/clooks.yml')).toBe(true)
  })

  test('init creates .gitignore with clooks entries', () => {
    sandbox = createSandbox()

    const result = sandbox.run(['init'], { timeout: 10_000 })
    expect(result.exitCode).toBe(0)

    expect(sandbox.fileExists('.gitignore')).toBe(true)
    const gitignore = sandbox.readFile('.gitignore')
    expect(gitignore).toContain('clooks.local.yml')
    expect(gitignore).toContain('.clooks/.cache/')
  })
})
