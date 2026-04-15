import { describe, test, expect, afterEach } from 'bun:test'
import { createSandbox, type Sandbox } from './helpers/sandbox'

let sandbox: Sandbox

afterEach(() => {
  sandbox?.cleanup()
})

describe('uninstall journey', () => {
  test('init then uninstall --project --full --force removes everything', () => {
    sandbox = createSandbox()

    const initResult = sandbox.run(['init'], { timeout: 10_000 })
    expect(initResult.exitCode).toBe(0)

    const result = sandbox.run(['uninstall', '--project', '--full', '--force'])
    expect(result.exitCode).toBe(0)

    // .clooks/ directory should be gone
    expect(sandbox.fileExists('.clooks/clooks.yml')).toBe(false)

    // .claude/settings.json should still exist but have no Clooks hooks
    expect(sandbox.fileExists('.claude/settings.json')).toBe(true)
    const settings = JSON.parse(sandbox.readFile('.claude/settings.json'))
    expect(settings.hooks).toBeUndefined()
  })

  test('uninstall --project --full --force preserves non-Clooks hooks', () => {
    sandbox = createSandbox()

    const initResult = sandbox.run(['init'], { timeout: 10_000 })
    expect(initResult.exitCode).toBe(0)

    // Add a non-Clooks hook alongside Clooks on PreToolUse (a real event)
    const settings = JSON.parse(sandbox.readFile('.claude/settings.json'))
    settings.hooks.PreToolUse.push({
      hooks: [{ type: 'command', command: '/my/other/hook.sh' }],
    })
    sandbox.writeFile('.claude/settings.json', JSON.stringify(settings, null, 2) + '\n')

    const result = sandbox.run(['uninstall', '--project', '--full', '--force'])
    expect(result.exitCode).toBe(0)

    // The non-Clooks hook on PreToolUse should still be there
    const after = JSON.parse(sandbox.readFile('.claude/settings.json'))
    expect(after.hooks).toBeDefined()
    expect(after.hooks.PreToolUse).toBeDefined()
    expect(after.hooks.PreToolUse).toHaveLength(1)
    expect(after.hooks.PreToolUse[0].hooks[0].command).toBe('/my/other/hook.sh')
  })

  test('uninstall --project --unhook --force only removes settings.json entries', () => {
    sandbox = createSandbox()

    const initResult = sandbox.run(['init'], { timeout: 10_000 })
    expect(initResult.exitCode).toBe(0)

    const result = sandbox.run(['uninstall', '--project', '--unhook', '--force'])
    expect(result.exitCode).toBe(0)

    // settings.json should have no Clooks hooks
    const settings = JSON.parse(sandbox.readFile('.claude/settings.json'))
    expect(settings.hooks).toBeUndefined()

    // .clooks/ directory should still exist
    expect(sandbox.fileExists('.clooks/clooks.yml')).toBe(true)
  })

  test('uninstall --project --full --json --force outputs valid envelope', () => {
    sandbox = createSandbox()

    const initResult = sandbox.run(['init'], { timeout: 10_000 })
    expect(initResult.exitCode).toBe(0)

    const result = sandbox.run(['uninstall', '--project', '--full', '--force', '--json'])
    expect(result.exitCode).toBe(0)

    const envelope = JSON.parse(result.stdout)
    expect(envelope.ok).toBe(true)
    expect(envelope.command).toBe('uninstall')
    expect(envelope.data.scope).toBe('project')
    expect(envelope.data.unhooked).toBe(true)
    expect(envelope.data.deleted).toBe(true)
  })

  test('uninstall --project --full --force is idempotent', () => {
    sandbox = createSandbox()

    const initResult = sandbox.run(['init'], { timeout: 10_000 })
    expect(initResult.exitCode).toBe(0)

    // First uninstall
    const firstResult = sandbox.run(['uninstall', '--project', '--full', '--force'])
    expect(firstResult.exitCode).toBe(0)

    // Second uninstall — should be a no-op
    const result = sandbox.run(['uninstall', '--project', '--full', '--force'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout + result.stderr).toContain('Nothing to uninstall')
  })

  test('init --global then uninstall --global --full --force removes global hooks', () => {
    sandbox = createSandbox()

    const initResult = sandbox.run(['init', '--global'], { timeout: 10_000 })
    expect(initResult.exitCode).toBe(0)

    const result = sandbox.run(['uninstall', '--global', '--full', '--force'])
    expect(result.exitCode).toBe(0)

    // Global .clooks/ should be gone
    expect(sandbox.homeFileExists('.clooks/clooks.yml')).toBe(false)

    // Global settings.json should still exist but have no Clooks hooks
    expect(sandbox.homeFileExists('.claude/settings.json')).toBe(true)
    const settings = JSON.parse(sandbox.readHomeFile('.claude/settings.json'))
    expect(settings.hooks).toBeUndefined()
  })

  test('uninstall --json without --force errors', () => {
    sandbox = createSandbox()

    const result = sandbox.run(['uninstall', '--project', '--json'])
    expect(result.exitCode).toBe(1)

    const envelope = JSON.parse(result.stdout)
    expect(envelope.ok).toBe(false)
    expect(envelope.error).toContain('--force')
  })

  test('uninstall --project --force without action flag errors', () => {
    sandbox = createSandbox()

    const result = sandbox.run(['uninstall', '--project', '--force'])
    expect(result.exitCode).toBe(1)
  })

  test('init --global then uninstall --global --unhook --force keeps ~/.clooks/', () => {
    sandbox = createSandbox()

    const initResult = sandbox.run(['init', '--global'], { timeout: 10_000 })
    expect(initResult.exitCode).toBe(0)

    const result = sandbox.run(['uninstall', '--global', '--unhook', '--force'])
    expect(result.exitCode).toBe(0)

    // ~/.clooks/ should still exist
    expect(sandbox.homeFileExists('.clooks/clooks.yml')).toBe(true)

    // Global settings.json should have no Clooks hooks
    expect(sandbox.homeFileExists('.claude/settings.json')).toBe(true)
    const settings = JSON.parse(sandbox.readHomeFile('.claude/settings.json'))
    expect(settings.hooks).toBeUndefined()
  })

  test('uninstall --project --full --force --json includes custom hooks in envelope', () => {
    sandbox = createSandbox()

    const initResult = sandbox.run(['init'], { timeout: 10_000 })
    expect(initResult.exitCode).toBe(0)

    sandbox.writeHook('my-hook.ts', 'export default {}')

    const result = sandbox.run(['uninstall', '--project', '--full', '--force', '--json'])
    expect(result.exitCode).toBe(0)

    const envelope = JSON.parse(result.stdout)
    expect(envelope.ok).toBe(true)
    expect(envelope.data.customHooksDeleted).toContain('my-hook.ts')
  })

  test('uninstall --project --full --force deletes custom hooks without warning', () => {
    sandbox = createSandbox()

    const initResult = sandbox.run(['init'], { timeout: 10_000 })
    expect(initResult.exitCode).toBe(0)

    sandbox.writeHook(
      'my-hook.ts',
      'export default { meta: { name: "test" }, handler: () => ({}) }',
    )

    const result = sandbox.run(['uninstall', '--project', '--full', '--force'])
    expect(result.exitCode).toBe(0)

    // Custom hook should be gone along with the entire .clooks/ directory
    expect(sandbox.fileExists('.clooks/hooks/my-hook.ts')).toBe(false)
  })
})
