import { describe, test, expect, afterEach } from 'bun:test'
import { createSandbox, type Sandbox } from './helpers/sandbox'

const REPO_URL = 'https://github.com/codestripes-dev/clooks-example-hooks'
const SHORTHAND = 'codestripes-dev/clooks-example-hooks'
const BLOB_URL =
  'https://github.com/codestripes-dev/clooks-example-hooks/blob/master/hooks/no-compound-commands.ts'

const VENDOR_BASE = '.clooks/vendor/github.com/codestripes-dev/clooks-example-hooks'

const HOOK_NAMES = [
  'log-bash-commands',
  'no-compound-commands',
  'no-bare-mv',
  'debug-payload',
  'tmux-notifications',
]

// Network timeout — GitHub fetches may be slow in CI
const NETWORK_TIMEOUT = 30_000

let sandbox: Sandbox

afterEach(() => {
  sandbox?.cleanup()
})

describe('clooks add — pack from real GitHub repo', () => {
  test('--all --project installs all hooks and registers short addresses', () => {
    sandbox = createSandbox()
    sandbox.writeConfig('version: "1.0.0"\n')

    const result = sandbox.run(['add', '--all', '--project', REPO_URL], {
      timeout: NETWORK_TIMEOUT,
    })
    expect(result.exitCode).toBe(0)

    // All 5 hooks should be vendored
    for (const name of HOOK_NAMES) {
      expect(sandbox.fileExists(`${VENDOR_BASE}/${name}.ts`)).toBe(true)
    }

    // clooks.yml should have all 5 short addresses
    const config = sandbox.readFile('.clooks/clooks.yml')
    for (const name of HOOK_NAMES) {
      expect(config).toContain(`uses: codestripes-dev/clooks-example-hooks:${name}`)
    }
  })

  test('shorthand URL (owner/repo) works the same as full URL', () => {
    sandbox = createSandbox()
    sandbox.writeConfig('version: "1.0.0"\n')

    const result = sandbox.run(['add', '--all', '--project', SHORTHAND], {
      timeout: NETWORK_TIMEOUT,
    })
    expect(result.exitCode).toBe(0)

    const config = sandbox.readFile('.clooks/clooks.yml')
    for (const name of HOOK_NAMES) {
      expect(config).toContain(`uses: codestripes-dev/clooks-example-hooks:${name}`)
    }
  })

  test('--all --global installs to home directory', () => {
    sandbox = createSandbox()
    // Create a project config so we can confirm --global doesn't touch it
    sandbox.writeConfig('version: "1.0.0"\n')

    const result = sandbox.run(['add', '--all', '--global', REPO_URL], {
      timeout: NETWORK_TIMEOUT,
    })
    expect(result.exitCode).toBe(0)

    // Hooks should be at home vendor path
    const homeVendorBase = '.clooks/vendor/github.com/codestripes-dev/clooks-example-hooks'
    for (const name of HOOK_NAMES) {
      expect(sandbox.homeFileExists(`${homeVendorBase}/${name}.ts`)).toBe(true)
    }

    // Home config should have the hooks
    const homeConfig = sandbox.readHomeFile('.clooks/clooks.yml')
    for (const name of HOOK_NAMES) {
      expect(homeConfig).toContain(`uses: codestripes-dev/clooks-example-hooks:${name}`)
    }

    // Project config should be unchanged
    const projectConfig = sandbox.readFile('.clooks/clooks.yml')
    expect(projectConfig).toBe('version: "1.0.0"\n')
  })

  test('second add of same pack fails with name conflicts', () => {
    sandbox = createSandbox()
    sandbox.writeConfig('version: "1.0.0"\n')

    // First install
    const first = sandbox.run(['add', '--all', '--project', REPO_URL], {
      timeout: NETWORK_TIMEOUT,
    })
    expect(first.exitCode).toBe(0)

    // Second install — all names conflict. Short names are taken,
    // so it falls back to full address keys. Those should succeed.
    const second = sandbox.run(['add', '--all', '--project', REPO_URL], {
      timeout: NETWORK_TIMEOUT,
    })
    expect(second.exitCode).toBe(0)

    // Config should have both short and full-address keys
    const config = sandbox.readFile('.clooks/clooks.yml')
    for (const name of HOOK_NAMES) {
      // Short key from first install
      expect(config).toContain(`${name}:`)
      // Full address key from second install (quoted because it contains : and /)
      expect(config).toContain(`"codestripes-dev/clooks-example-hooks:${name}"`)
    }
  })

  test('JSON mode returns structured envelope', () => {
    sandbox = createSandbox()
    sandbox.writeConfig('version: "1.0.0"\n')

    const result = sandbox.run(['--json', 'add', '--all', '--project', REPO_URL], {
      timeout: NETWORK_TIMEOUT,
    })
    expect(result.exitCode).toBe(0)

    const parsed = JSON.parse(result.stdout.trim())
    expect(parsed.ok).toBe(true)
    expect(parsed.command).toBe('add')
    expect(Array.isArray(parsed.data.hooks)).toBe(true)
    expect(parsed.data.hooks).toHaveLength(HOOK_NAMES.length)
    expect(parsed.data.skipped).toHaveLength(0)
  })
})

describe('clooks add — single blob URL from real GitHub repo', () => {
  test('blob URL installs single hook and registers short address', () => {
    sandbox = createSandbox()
    sandbox.writeConfig('version: "1.0.0"\n')

    const result = sandbox.run(['add', '--project', BLOB_URL], {
      timeout: NETWORK_TIMEOUT,
    })
    expect(result.exitCode).toBe(0)

    // Vendor file should exist
    expect(sandbox.fileExists(`${VENDOR_BASE}/no-compound-commands.ts`)).toBe(true)

    // Config should have short address
    const config = sandbox.readFile('.clooks/clooks.yml')
    expect(config).toContain('no-compound-commands:')
    expect(config).toContain('uses: codestripes-dev/clooks-example-hooks:no-compound-commands')
  })
})

describe('clooks add → engine run — installed hooks execute', () => {
  test('no-compound-commands blocks compound command after install', () => {
    sandbox = createSandbox()
    sandbox.writeConfig('version: "1.0.0"\n')

    // Install the pack
    const addResult = sandbox.run(['add', '--all', '--project', REPO_URL], {
      timeout: NETWORK_TIMEOUT,
    })
    expect(addResult.exitCode).toBe(0)

    // Pipe a compound command through the engine
    const event = JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'ls && pwd' },
    })
    const engineResult = sandbox.run([], { stdin: event })
    expect(engineResult.exitCode).toBe(0)

    const output = JSON.parse(engineResult.stdout)
    // no-compound-commands should block it
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
  })

  test('no-compound-commands allows simple command after install', () => {
    sandbox = createSandbox()
    sandbox.writeConfig('version: "1.0.0"\n')

    // Install the pack
    const addResult = sandbox.run(['add', '--all', '--project', REPO_URL], {
      timeout: NETWORK_TIMEOUT,
    })
    expect(addResult.exitCode).toBe(0)

    // Pipe a simple command through the engine
    const event = JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'ls -la' },
    })
    const engineResult = sandbox.run([], { stdin: event })
    expect(engineResult.exitCode).toBe(0)

    const output = JSON.parse(engineResult.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('allow')
  })

  test('no-compound-commands allows ALLOW_COMPOUND escape hatch', () => {
    sandbox = createSandbox()
    sandbox.writeConfig('version: "1.0.0"\n')

    const addResult = sandbox.run(['add', '--all', '--project', REPO_URL], {
      timeout: NETWORK_TIMEOUT,
    })
    expect(addResult.exitCode).toBe(0)

    const event = JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'ALLOW_COMPOUND=true ls && pwd' },
    })
    const engineResult = sandbox.run([], { stdin: event })
    expect(engineResult.exitCode).toBe(0)

    const output = JSON.parse(engineResult.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('allow')
  })

  test('non-Bash tool use passes through after install', () => {
    sandbox = createSandbox()
    sandbox.writeConfig('version: "1.0.0"\n')

    const addResult = sandbox.run(['add', '--all', '--project', REPO_URL], {
      timeout: NETWORK_TIMEOUT,
    })
    expect(addResult.exitCode).toBe(0)

    // The pack hooks focus on Bash — a Read tool use should pass through.
    // All hooks return "skip" for non-Bash tools, so the engine exits 0
    // with empty stdout (no hook claimed authority).
    const event = JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Read',
      tool_input: { file_path: '/tmp/test.txt' },
    })
    const engineResult = sandbox.run([], { stdin: event })
    expect(engineResult.exitCode).toBe(0)
    // Empty stdout means all hooks skipped — tool use proceeds unmodified
    expect(engineResult.stdout.trim()).toBe('')
  })
})
