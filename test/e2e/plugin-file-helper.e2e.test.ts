import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { createSandbox, formatDiagnostics, type Sandbox } from './helpers/sandbox'

let sandbox: Sandbox

afterEach(() => sandbox?.cleanup())

type Provider = 'claude-code' | 'codex'
type ProbePaths = Record<string, string>

function write(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function writeProbe(name: string, paths: ProbePaths, event = 'SessionStart') {
  const receipt = join(sandbox.dir, `.clooks/${name}.jsonl`)
  sandbox.writeHook(
    `${name}.ts`,
    `import { appendFileSync } from 'fs'
const paths = ${JSON.stringify(paths)}
const receipt = ${JSON.stringify(receipt)}
function record(phase, context) {
  const checks = Object.fromEntries(Object.entries(paths).map(([label, path]) => [label, context.helpers.belongsToPlugin(path)]))
  appendFileSync(receipt, JSON.stringify({ phase, checks }) + '\\n')
}
export const hook = {
  meta: { name: ${JSON.stringify(name)} },
  beforeHook(event) { record('before', event.input) },
  ${event}(context) { record('handler', context); return context.skip({ injectContext: ${JSON.stringify(name)} }) },
  afterHook(event) { record('after', event.input) },
}
`,
  )
}

function writeConfig(names: string[], parallel: boolean) {
  sandbox.writeConfig(
    `version: "1.0.0"\n${names.map((name) => `${name}:\n  parallel: ${parallel}`).join('\n')}\n`,
  )
}

function sessionStart(provider: Provider, cwd = sandbox.dir, rawHelpers = true) {
  return sandbox.run([], {
    cwd: sandbox.dir,
    stdin: JSON.stringify({
      hook_event_name: 'SessionStart',
      session_id: 'plugin-file-helper-session',
      cwd,
      transcript_path: '/tmp/plugin-file-helper-transcript.jsonl',
      model: 'gpt-5',
      permission_mode: 'default',
      source: 'startup',
      provider: provider === 'codex' ? 'claude-code' : 'codex',
      ...(rawHelpers ? { helpers: { belongsToPlugin: true, forged: true } } : {}),
    }),
    env: {
      CLOOKS_AGENT: provider,
      CODEX_HOME: join(sandbox.home, 'custom-codex-home'),
    },
    timeout: 10_000,
  })
}

function expectCleanSession(result: ReturnType<Sandbox['run']>) {
  expect(result.rawExitCode, formatDiagnostics(result)).toBe(0)
  expect(result.signalCode).toBeNull()
  expect(result.stderr).toBe('')
  expect(result.stdout).not.toContain('helpers')
}

function expectRegistryDiagnostic(result: ReturnType<Sandbox['run']>, detail: string) {
  expect(result.rawExitCode, formatDiagnostics(result)).toBe(0)
  expect(result.signalCode).toBeNull()
  expect(result.stdout).not.toContain('helpers')
  const lines = result.stderr.trimEnd().split('\n')
  expect(lines).toHaveLength(2)
  expect(lines[0]).toBe(lines[1])
  expect(lines[0]).toContain('[clooks] Failed to parse installed_plugins.json at ')
  expect(lines[0]).toContain(detail)
}

function receipt(name: string) {
  return readFileSync(join(sandbox.dir, `.clooks/${name}.jsonl`), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
}

function expectLifecycleReceipt(name: string, checks: Record<string, boolean>) {
  expect(receipt(name)).toEqual(['before', 'handler', 'after'].map((phase) => ({ phase, checks })))
}

function setupInstalledFixtures() {
  const claudeRoot = join(sandbox.home, '.claude/plugins/cache/original-market/node-helper/1.0.0')
  const codexHome = join(sandbox.home, 'custom-codex-home')
  const codexRoot = join(codexHome, 'plugins/cache/original-market/node-helper/2.0.0')
  const codexOldRoot = join(codexHome, 'plugins/cache/original-market/node-helper/1.0.0')

  const claudeFile = join(claudeRoot, 'node_modules/@scope/node/bin/node')
  const codexFile = join(codexRoot, 'node_modules/@scope/node/bin/node')
  const codexOldFile = join(codexOldRoot, 'node_modules/@scope/node/bin/node')
  const ordinaryFile = join(sandbox.dir, 'ordinary-project-file.ts')
  const claudeNestedFile = join(claudeRoot, 'nested/owned.ts')
  const codexNestedFile = join(codexRoot, 'nested/owned.ts')

  write(claudeFile, '#!/usr/bin/env node\n')
  write(claudeNestedFile, 'export const installed = true\n')
  write(codexFile, '#!/usr/bin/env node\n')
  write(codexOldFile, '#!/usr/bin/env node\n')
  write(codexNestedFile, 'export const installed = true\n')
  write(ordinaryFile, 'export const ordinary = true\n')

  write(
    join(sandbox.home, '.claude/plugins/installed_plugins.json'),
    JSON.stringify({
      version: 2,
      plugins: {
        'node-helper@original-market': [
          {
            scope: 'user',
            installPath: claudeRoot,
            version: '1.0.0',
          },
        ],
      },
    }),
  )
  write(
    join(sandbox.home, '.claude/settings.json'),
    JSON.stringify({ enabledPlugins: { 'node-helper@original-market': false } }),
  )

  for (const root of [codexRoot, codexOldRoot]) {
    write(
      join(root, '.codex-plugin/plugin.json'),
      JSON.stringify({ name: 'node-helper', version: 'native' }),
    )
  }
  write(
    join(codexHome, 'config.toml'),
    '[plugins."node-helper@original-market"]\nenabled = false\n',
  )

  const claudeEscape = join(claudeRoot, 'escape.ts')
  const codexEscape = join(codexRoot, 'escape.ts')
  symlinkSync(ordinaryFile, claudeEscape)
  symlinkSync(ordinaryFile, codexEscape)

  return {
    claudeRoot,
    codexHome,
    codexRoot,
    codexOldRoot,
    claudeFile,
    codexFile,
    codexOldFile,
    ordinaryFile,
    claudeNestedFile,
    codexNestedFile,
    claudeEscape,
    codexEscape,
  }
}

function selectedChecks(provider: Provider, fixtures: ReturnType<typeof setupInstalledFixtures>) {
  const ownRoot = provider === 'claude-code' ? fixtures.claudeRoot : fixtures.codexRoot
  const ownFile = provider === 'claude-code' ? fixtures.claudeFile : fixtures.codexFile
  const oldVersion = fixtures.codexOldFile
  const otherProvider = provider === 'claude-code' ? fixtures.codexFile : fixtures.claudeFile
  const escape = provider === 'claude-code' ? fixtures.claudeEscape : fixtures.codexEscape
  const nestedFile =
    provider === 'claude-code' ? fixtures.claudeNestedFile : fixtures.codexNestedFile
  const dotDot = `${ownRoot}/nested/../nested/owned.ts`
  const boundary = `${ownRoot}-sibling/outside.ts`
  write(boundary, 'export const outside = true\n')

  return {
    own: [ownFile, true] as const,
    oldVersion: [oldVersion, provider === 'codex'] as const,
    otherProvider: [otherProvider, false] as const,
    ordinary: [fixtures.ordinaryFile, false] as const,
    rootDirectory: [ownRoot, false] as const,
    missing: [join(ownRoot, 'missing.ts'), false] as const,
    boundary: [boundary, false] as const,
    symlinkEscape: [escape, false] as const,
    dotDot: [dotDot, false] as const,
    nested: [nestedFile, true] as const,
  }
}

describe('compiled engine plugin file helper', () => {
  for (const provider of ['claude-code', 'codex'] as const) {
    for (const parallel of [false, true]) {
      test(`${provider} selected roots are isolated across ${parallel ? 'parallel' : 'sequential'} lifecycle dispatch`, () => {
        sandbox = createSandbox()
        const fixtures = setupInstalledFixtures()
        const checks = selectedChecks(provider, fixtures)
        const checkValues: Record<string, boolean> = {}
        const probePaths: ProbePaths = {}
        for (const label of Object.keys(checks) as Array<keyof typeof checks>) {
          const [path, expected] = checks[label]
          probePaths[label] = path
          checkValues[label] = expected
        }

        for (const name of ['helper-a', 'helper-b']) writeProbe(name, probePaths)
        writeConfig(['helper-a', 'helper-b'], parallel)

        const result = sessionStart(provider)
        expectCleanSession(result)
        expectLifecycleReceipt('helper-a', checkValues)
        expectLifecycleReceipt('helper-b', checkValues)
      })
    }
  }

  for (const mode of ['missing', 'malformed', 'unreadable', 'invalid roots'] as const) {
    test(`Claude ${mode} registry fails closed`, () => {
      sandbox = createSandbox()
      sandbox.writeConfig('version: "1.0.0"\n')
      const root = join(sandbox.home, '.claude/plugins/cache/invalid/plugin/1.0.0')
      const candidate = join(root, 'plugin.js')
      let registryPath: string | undefined
      write(candidate, 'export const plugin = true\n')

      if (mode === 'malformed') {
        registryPath = join(sandbox.home, '.claude/plugins/installed_plugins.json')
        write(registryPath, '{malformed')
      } else if (mode === 'unreadable') {
        const registry = join(sandbox.home, '.claude/plugins/installed_plugins.json')
        registryPath = registry
        write(
          registry,
          JSON.stringify({
            version: 2,
            plugins: { valid: [{ installPath: root }] },
          }),
        )
        chmodSync(registry, 0o000)
        expect(() => readFileSync(registry, 'utf8')).toThrow()
      } else if (mode === 'invalid roots') {
        const missingRoot = join(sandbox.home, '.claude/plugins/cache/missing/plugin/1.0.0')
        const directoryRoot = join(sandbox.home, '.claude/plugins/cache/directory/plugin/1.0.0')
        const orphanRoot = join(sandbox.home, '.claude/plugins/cache/orphan/plugin/1.0.0')
        const rawDotDotRoot = `${sandbox.home}/.claude/plugins/cache/../cache/invalid/plugin/1.0.0`
        mkdirSync(directoryRoot, { recursive: true })
        write(join(orphanRoot, 'plugin.js'), 'orphaned plugin\n')
        write(join(orphanRoot, '.orphaned_at'), '2026-09-17T00:00:00.000Z')
        write(
          join(sandbox.home, '.claude/plugins/installed_plugins.json'),
          JSON.stringify({
            version: 2,
            plugins: {
              invalid: [
                { installPath: directoryRoot },
                { installPath: missingRoot },
                { installPath: orphanRoot },
                { installPath: rawDotDotRoot },
              ],
            },
          }),
        )
      }

      const paths: ProbePaths =
        mode === 'invalid roots'
          ? {
              missing: join(sandbox.home, '.claude/plugins/cache/missing/plugin/1.0.0/plugin.js'),
              orphan: join(sandbox.home, '.claude/plugins/cache/orphan/plugin/1.0.0/plugin.js'),
              rootDirectory: join(sandbox.home, '.claude/plugins/cache/directory/plugin/1.0.0'),
              dotDot: `${sandbox.home}/.claude/plugins/cache/../cache/invalid/plugin/1.0.0/plugin.js`,
            }
          : { candidate }
      writeProbe('invalid-registry', paths)
      writeConfig(['invalid-registry'], false)
      const result = sessionStart('claude-code')
      if (mode === 'malformed') {
        expectRegistryDiagnostic(result, "SyntaxError: JSON Parse error: Expected '}'")
      } else if (mode === 'unreadable') {
        expectRegistryDiagnostic(result, `Error: EACCES: permission denied, open '${registryPath}'`)
      } else {
        expectCleanSession(result)
      }
      expectLifecycleReceipt(
        'invalid-registry',
        Object.fromEntries(Object.keys(paths).map((label) => [label, false])),
      )
    })
  }

  test('Codex accepts disabled, unconfigured, and older materialized versions with matching parseable native manifest identity', () => {
    sandbox = createSandbox()
    sandbox.writeConfig('version: "1.0.0"\n')
    const codexHome = join(sandbox.home, 'custom-codex-home')
    const validRoot = join(codexHome, 'plugins/cache/market/node-helper/2.0.0')
    const oldRoot = join(codexHome, 'plugins/cache/market/node-helper/1.0.0')
    const malformedRoot = join(codexHome, 'plugins/cache/market/bad-json/1.0.0')
    const mismatchRoot = join(codexHome, 'plugins/cache/market/wrong-name/1.0.0')
    const missingManifestRoot = join(codexHome, 'plugins/cache/market/missing-manifest/1.0.0')
    const valid = join(validRoot, 'hooks/guard.ts')
    const old = join(oldRoot, 'hooks/guard.ts')
    const malformed = join(malformedRoot, 'hooks/guard.ts')
    const mismatch = join(mismatchRoot, 'hooks/guard.ts')
    const missingManifest = join(missingManifestRoot, 'hooks/guard.ts')

    write(valid, 'export const valid = true\n')
    write(old, 'export const old = true\n')
    write(malformed, 'export const malformed = true\n')
    write(mismatch, 'export const mismatch = true\n')
    write(missingManifest, 'export const missing = true\n')
    // Membership checks parseable native identity only; other upstream manifest fields are not schema-validated here.
    write(join(validRoot, '.codex-plugin/plugin.json'), JSON.stringify({ name: 'node-helper' }))
    write(join(oldRoot, '.codex-plugin/plugin.json'), JSON.stringify({ name: 'node-helper' }))
    write(join(malformedRoot, '.codex-plugin/plugin.json'), '{bad-json')
    write(
      join(mismatchRoot, '.codex-plugin/plugin.json'),
      JSON.stringify({ name: 'different-plugin' }),
    )
    write(join(codexHome, 'config.toml'), '[plugins."node-helper@market"]\nenabled = false\n')

    writeProbe('codex-manifest', { valid, old, malformed, mismatch, missingManifest })
    writeConfig(['codex-manifest'], false)
    const result = sessionStart('codex')
    expectCleanSession(result)
    expectLifecycleReceipt('codex-manifest', {
      valid: true,
      old: true,
      malformed: false,
      mismatch: false,
      missingManifest: false,
    })
  })

  test('relative candidates resolve from event cwd, while a process-cwd path is not consulted', () => {
    sandbox = createSandbox()
    sandbox.writeConfig('version: "1.0.0"\n')
    const eventCwd = join(sandbox.dir, 'nested-worktree')
    const root = join(eventCwd, 'installed/plugin/1.0.0')
    const relative = 'installed/plugin/1.0.0/plugin.ts'
    write(join(root, 'plugin.ts'), 'export const installed = true\n')
    write(
      join(sandbox.home, '.claude/plugins/installed_plugins.json'),
      JSON.stringify({ version: 2, plugins: { 'nested@market': [{ installPath: root }] } }),
    )
    write(join(sandbox.dir, 'installed/plugin/1.0.0/plugin.ts'), 'export const wrong = true\n')

    writeProbe('cwd-probe', {
      relative,
      dotDot: '../nested-worktree/installed/plugin/1.0.0/plugin.ts',
    })
    writeConfig(['cwd-probe'], false)
    const result = sessionStart('claude-code', eventCwd)
    expectCleanSession(result)
    expectLifecycleReceipt('cwd-probe', { relative: true, dotDot: false })
  })

  test('candidate state is rechecked after an installed file is replaced by an outside symlink', () => {
    sandbox = createSandbox()
    sandbox.writeConfig('version: "1.0.0"\n')
    const codexHome = join(sandbox.home, 'custom-codex-home')
    const root = join(codexHome, 'plugins/cache/recheck/plugin/1.0.0')
    const candidate = join(root, 'hooks/guard.ts')
    const outside = join(sandbox.dir, 'outside.ts')
    const receiptPath = join(sandbox.dir, '.clooks/recheck.jsonl')
    write(candidate, 'export const guard = true\n')
    write(outside, 'export const outside = true\n')
    write(join(root, '.codex-plugin/plugin.json'), JSON.stringify({ name: 'plugin' }))
    write(join(codexHome, 'config.toml'), '[plugins."recheck@market"]\nenabled = false\n')
    sandbox.writeHook(
      'recheck.ts',
      `import { appendFileSync, rmSync, symlinkSync } from 'fs'
const candidate = ${JSON.stringify(candidate)}
const outside = ${JSON.stringify(outside)}
export const hook = {
  meta: { name: 'recheck' },
  PreToolUse(context) {
    const first = context.helpers.belongsToPlugin(candidate)
    rmSync(candidate)
    symlinkSync(outside, candidate)
    const second = context.helpers.belongsToPlugin(candidate)
    appendFileSync(${JSON.stringify(receiptPath)}, JSON.stringify({ first, second }) + '\\n')
    return context.allow({ updatedInput: { command: 'node ' + candidate } })
  },
}
`,
    )
    writeConfig(['recheck'], false)
    const result = sandbox.run([], {
      stdin: JSON.stringify({
        hook_event_name: 'PreToolUse',
        tool_name: 'exec_command',
        tool_input: { command: `node ${candidate}` },
        cwd: sandbox.dir,
        session_id: 'recheck-session',
        transcript_path: null,
        model: 'gpt-5',
        permission_mode: 'default',
        turn_id: 'turn',
        tool_use_id: 'recheck-call',
        source: 'startup',
        provider: 'claude-code',
        helpers: { belongsToPlugin: true },
      }),
      env: { CLOOKS_AGENT: 'codex', CODEX_HOME: codexHome },
      timeout: 10_000,
    })
    expectCleanSession(result)
    expect(JSON.parse(result.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        updatedInput: { command: `node ${candidate}` },
      },
    })
    expect(readFileSync(receiptPath, 'utf8')).toBe('{"first":true,"second":false}\n')
    expect(result.stdout).not.toContain('helpers')
  })
})
