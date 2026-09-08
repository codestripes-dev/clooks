import { describe, test, expect, afterEach } from 'bun:test'
import { readFileSync, mkdirSync, statSync } from 'fs'
import { join } from 'path'
import { type Sandbox } from './helpers/sandbox'
import { createRegistrationSandbox as createSandbox } from './helpers/registration'
import { chmodSync, readdirSync, symlinkSync, readlinkSync } from 'fs'

describe('claude-code registration preservation E2E', () => {
  for (const contents of [
    'null',
    '[]',
    'true',
    '42',
    '"scalar"',
    '{ bad',
    '{"hooks":null}',
    '{"hooks":[]}',
    '{"hooks":{"Stop":{}}}',
    '{"hooks":{"Stop":[null]}}',
    '{"hooks":{"Stop":[{}]}}',
    '{"hooks":{"Stop":[{"hooks":null}]}}',
    '{"hooks":{"Stop":[{"hooks":[[]]}]}}',
    '{"hooks":true}',
    '{"hooks":{"Stop":null}}',
    '{"hooks":{"Stop":[[]]}}',
    '{"hooks":{"Stop":[{"hooks":[null]}]}}',
    '{"hooks":{"Stop":[{"hooks":["bad"]}]}}',
  ]) {
    test(`init and unhook reject ${contents} with exact bytes intact`, () => {
      sandbox = createSandbox()
      sandbox.writeConfig('version: "1.0.0"\n')
      const bytes = '\n ' + contents + '\n'
      sandbox.writeFile('.claude/settings.json', bytes)
      for (const args of [
        ['init', '--agent', 'claude-code', '--json'],
        ['uninstall', '--project', '--agent', 'claude-code', '--unhook', '--force', '--json'],
      ]) {
        const result = sandbox.run(args, { timeout: 10_000 })
        expect(result.exitCode).toBe(1)
        const envelope = JSON.parse(result.stdout)
        expect(envelope.ok).toBe(false)
        expect(envelope.error).toContain(join(sandbox.dir, '.claude/settings.json'))
        expect(sandbox.readFile('.claude/settings.json')).toBe(bytes)
      }
    })
  }

  test('mixed metadata, empty groups and command mentions survive init and unhook', () => {
    sandbox = createSandbox()
    expect(sandbox.run(['init', '--agent', 'claude-code']).exitCode).toBe(0)
    const owned = { type: 'command', command: '"$CLAUDE_PROJECT_DIR"/.clooks/bin/entrypoint.sh' }
    const unrelated = [
      { type: 'command', command: 'echo CLOOKS_AGENT=codex .clooks/bin/entrypoint.sh' },
      { type: 'command', command: '/usr/bin/echo .clooks/bin/entrypoint.sh' },
      { type: 'command', command: owned.command + ' --extra' },
      ...['; echo extra', ' | cat', ' > output', ' # comment', '\n'].map((suffix) => ({
        type: 'command',
        command: owned.command + suffix,
      })),
      { type: 'command', command: 'printf "%s" ' + owned.command },
      { type: 'prompt', command: owned.command, prompt: 'keep' },
    ]
    const empty = { hooks: [], extension: { keep: true } }
    const metadata = { matcher: 'Bash', extension: [null, 'keep'] }
    sandbox.writeFile(
      '.claude/settings.json',
      JSON.stringify({
        extension: { keep: true },
        hooks: { Stop: [empty, { ...metadata, hooks: [owned, ...unrelated] }], Future: [] },
      }),
    )
    expect(sandbox.run(['init', '--agent', 'claude-code']).exitCode).toBe(0)
    const before = sandbox.readFile('.claude/settings.json')
    expect(sandbox.run(['init', '--agent', 'claude-code']).exitCode).toBe(0)
    expect(sandbox.readFile('.claude/settings.json')).toBe(before)
    const result = sandbox.run([
      'uninstall',
      '--project',
      '--agent',
      'claude-code',
      '--unhook',
      '--force',
      '--json',
    ])
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout).ok).toBe(true)
    expect(JSON.parse(sandbox.readFile('.claude/settings.json'))).toEqual({
      extension: { keep: true },
      hooks: { Stop: [empty, { ...metadata, hooks: unrelated }], Future: [] },
    })
  })

  test('parent permission failure preserves bytes and mode, then retry succeeds', () => {
    expect(process.getuid!()).not.toBe(0)
    sandbox = createSandbox()
    expect(sandbox.run(['init', '--agent', 'claude-code']).exitCode).toBe(0)
    sandbox.writeFile('.claude/settings.json', '{ "keep": true }\n')
    const directory = join(sandbox.dir, '.claude')
    chmodSync(join(sandbox.dir, '.claude/settings.json'), 0o640)
    chmodSync(directory, 0o500)
    try {
      const result = sandbox.run(['init', '--agent', 'claude-code', '--json'])
      expect(result.exitCode).toBe(1)
      expect(JSON.parse(result.stdout).ok).toBe(false)
      expect(sandbox.readFile('.claude/settings.json')).toBe('{ "keep": true }\n')
      expect(statSync(join(sandbox.dir, '.claude/settings.json')).mode & 0o777).toBe(0o640)
      expect(readdirSync(directory)).toEqual(['settings.json'])
    } finally {
      chmodSync(directory, 0o700)
    }
    expect(sandbox.run(['init', '--agent', 'claude-code']).exitCode).toBe(0)
    expect(JSON.parse(sandbox.readFile('.claude/settings.json')).keep).toBe(true)
    expect(statSync(join(sandbox.dir, '.claude/settings.json')).mode & 0o777).toBe(0o640)
    expect(readdirSync(directory)).toEqual(['settings.json'])
    const registered = sandbox.readFile('.claude/settings.json')
    const unhook = [
      'uninstall',
      '--project',
      '--agent',
      'claude-code',
      '--unhook',
      '--force',
      '--json',
    ]
    chmodSync(directory, 0o500)
    try {
      const result = sandbox.run(unhook)
      expect(result.exitCode).toBe(1)
      expect(JSON.parse(result.stdout).error).toContain('settings.json')
      expect(sandbox.readFile('.claude/settings.json')).toBe(registered)
      expect(statSync(join(sandbox.dir, '.claude/settings.json')).mode & 0o777).toBe(0o640)
      expect(readdirSync(directory)).toEqual(['settings.json'])
    } finally {
      chmodSync(directory, 0o700)
    }
    expect(sandbox.run(unhook).exitCode).toBe(0)
    expect(JSON.parse(sandbox.readFile('.claude/settings.json'))).toEqual({ keep: true })
    expect(statSync(join(sandbox.dir, '.claude/settings.json')).mode & 0o777).toBe(0o640)
    expect(readdirSync(directory)).toEqual(['settings.json'])
  })

  test('first registration write failure leaves no destination and can be retried', () => {
    sandbox = createSandbox()
    expect(process.getuid!()).not.toBe(0)
    sandbox.writeConfig('version: "1.0.0"\n')
    const directory = join(sandbox.dir, '.claude')
    mkdirSync(directory)
    chmodSync(directory, 0o500)
    try {
      const result = sandbox.run(['init', '--agent', 'claude-code', '--json'])
      expect(result.exitCode).toBe(1)
      const envelope = JSON.parse(result.stdout)
      expect(envelope.ok).toBe(false)
      expect(envelope.error).toContain(directory)
      expect(sandbox.fileExists('.claude/settings.json')).toBe(false)
      expect(readdirSync(directory)).toEqual([])
    } finally {
      chmodSync(directory, 0o700)
    }
    expect(sandbox.run(['init', '--agent', 'claude-code']).exitCode).toBe(0)
    expect(JSON.parse(sandbox.readFile('.claude/settings.json')).hooks.Stop).toHaveLength(1)
    expect(readdirSync(directory)).toEqual(['settings.json'])
  })

  test('whitespace files initialize and unknown event values remain opaque', () => {
    sandbox = createSandbox()
    sandbox.writeFile('.claude/settings.json', ' \n\t')
    expect(sandbox.run(['init', '--agent', 'claude-code']).exitCode).toBe(0)
    const document = JSON.parse(sandbox.readFile('.claude/settings.json'))
    document.hooks.Future = { arbitrary: [null, false, { keep: true }] }
    document.extension = ['keep', 42]
    const bytes = JSON.stringify(document, null, 4) + '\n'
    sandbox.writeFile('.claude/settings.json', bytes)
    expect(sandbox.run(['init', '--agent', 'claude-code']).exitCode).toBe(0)
    expect(sandbox.readFile('.claude/settings.json')).toBe(bytes)
  })

  for (const dangling of [false, true]) {
    test(`CLI rejects ${dangling ? 'dangling' : 'regular-target'} registration symlinks`, () => {
      sandbox = createSandbox()
      sandbox.writeConfig('version: "1.0.0"\n')
      sandbox.writeFile('.claude/keep', '')
      const target = join(sandbox.dir, 'target.json')
      if (!dangling) sandbox.writeFile('target.json', '{ "keep": true }')
      symlinkSync(target, join(sandbox.dir, '.claude/settings.json'))
      for (const args of [
        ['init', '--agent', 'claude-code', '--json'],
        ['uninstall', '--project', '--agent', 'claude-code', '--unhook', '--force', '--json'],
      ]) {
        const result = sandbox.run(args)
        expect(result.exitCode).toBe(1)
        expect(JSON.parse(result.stdout).error).toContain('settings.json')
        expect(readlinkSync(join(sandbox.dir, '.claude/settings.json'))).toBe(target)
        expect(sandbox.fileExists('target.json')).toBe(!dangling)
        if (!dangling) expect(sandbox.readFile('target.json')).toBe('{ "keep": true }')
      }
    })
  }
})

const FIXTURES = join(import.meta.dir, '../fixtures')
const loadHook = (name: string) => readFileSync(join(FIXTURES, 'hooks', name), 'utf8')

let sandbox: Sandbox

afterEach(() => {
  sandbox?.cleanup()
})

describe('init journey', () => {
  test('global Claude init and unhook preserve historical generated homes with spaces and Unicode', () => {
    sandbox = createSandbox()
    const home = join(sandbox.home, 'home with 日本語')
    mkdirSync(home)
    const env = { HOME: home, CLOOKS_HOME_ROOT: home }
    expect(sandbox.run(['init', '--global'], { env }).exitCode).toBe(0)
    const path = join(home, '.claude/settings.json')
    const bytes = readFileSync(path, 'utf8')
    expect(sandbox.run(['init', '--global'], { env }).exitCode).toBe(0)
    expect(readFileSync(path, 'utf8')).toBe(bytes)
    const result = sandbox.run(['uninstall', '--global', '--unhook', '--force', '--json'], { env })
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout).ok).toBe(true)
    expect(JSON.parse(readFileSync(path, 'utf8')).hooks).toBeUndefined()
  })
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
allow-all: {}
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
