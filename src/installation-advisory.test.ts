import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  makeCodexGlobalEntrypointCommand,
  makeCodexProjectEntrypointCommand,
} from './agents/codex/settings.js'
import { collectInstallationAdvisories } from './installation-advisory.js'
import {
  CLAUDE_PROJECT_RUNTIME_ADVISORY_COMMAND,
  makeClaudeGlobalRuntimeAdvisoryCommand,
  makeCodexGlobalRuntimeAdvisoryCommand,
  makeCodexProjectRuntimeAdvisoryCommand,
} from './registration-advisory.js'
import { CLOOKS_ENTRYPOINT_PATH } from './settings.js'

const executable = '/opt/clooks/bin/clooks'
const projectId = '0123456789abcdef0123456789abcdef'
let root: string
let home: string
let project: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'clooks-installation-advisory-'))
  home = join(root, 'home')
  project = join(root, 'project with spaces')
  mkdirSync(home)
  mkdirSync(project)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function write(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents)
}

function writeMetadata(base: string, scope: 'project' | 'global', floor = '0.3.0'): void {
  write(
    join(base, '.clooks/bin/entrypoint.sh'),
    [
      '#!/bin/sh',
      `# clooks entrypoint: ${scope}`,
      '# clooks launcher revision: 1',
      `CLOOKS_REQUIRED_RUNTIME='${floor}'`,
      '',
    ].join('\n'),
  )
  write(
    join(base, '.clooks/bin/runtime-advisory.sh'),
    [
      '#!/bin/sh',
      `# clooks runtime advisory: ${scope}`,
      `CLOOKS_REQUIRED_RUNTIME='${floor}'`,
      '',
    ].join('\n'),
  )
  write(join(base, '.clooks/clooks.yml'), 'version: "1.0.0"\n')
}

function writeHooks(path: string, ...commands: string[]): void {
  write(
    path,
    JSON.stringify({
      hooks: {
        SessionStart: commands.map((command) => ({
          matcher: '*',
          hooks: [{ type: 'command', command }],
        })),
      },
    }),
  )
}

function registerClaude(base: string, scope: 'project' | 'global'): void {
  const runtime =
    scope === 'project' ? CLOOKS_ENTRYPOINT_PATH : join(base, '.clooks/bin/entrypoint.sh')
  const advisory =
    scope === 'project'
      ? CLAUDE_PROJECT_RUNTIME_ADVISORY_COMMAND
      : makeClaudeGlobalRuntimeAdvisoryCommand(base)
  writeHooks(join(base, '.claude/settings.json'), runtime, advisory)
  write(
    join(base, scope === 'global' ? '.claude.json' : '.mcp.json'),
    '{"mcpServers":{"clooks":{"command":"clooks","args":["mcp"]}}}\n',
  )
}

function registerCodexProject(): void {
  write(join(project, '.clooks/bin/codex-project-id'), `${projectId}\n`)
  writeHooks(
    join(project, '.codex/hooks.json'),
    makeCodexProjectEntrypointCommand(projectId),
    makeCodexProjectRuntimeAdvisoryCommand(projectId),
  )
  write(
    join(project, '.codex/config.toml'),
    '[mcp_servers.clooks]\ncommand = "clooks"\nargs = ["mcp"]\n',
  )
}

function registerCodexGlobal(codexHome: string): void {
  writeHooks(
    join(codexHome, 'hooks.json'),
    makeCodexGlobalEntrypointCommand(home),
    makeCodexGlobalRuntimeAdvisoryCommand(home),
  )
  write(
    join(codexHome, 'config.toml'),
    '[mcp_servers.clooks]\ncommand = "clooks"\nargs = ["mcp"]\n',
  )
}

function collect(agent: 'claude-code' | 'codex' = 'claude-code', binaryVersion = '0.3.0') {
  return collectInstallationAdvisories({
    agent,
    projectRoot: project,
    installationHome: home,
    executable,
    binaryVersion,
    env: {},
  })
}

describe('installation advisory formatting', () => {
  test('keeps current and config-only scopes silent', () => {
    writeMetadata(project, 'project')
    registerClaude(project, 'project')
    write(join(home, '.clooks/clooks.yml'), 'version: "1.0.0"\n')

    expect(collect()).toEqual([])
  })

  test('keeps future-compatible integration silent', () => {
    writeMetadata(project, 'project')
    registerClaude(project, 'project')
    write(
      join(project, '.clooks/bin/entrypoint.sh'),
      [
        '#!/bin/sh',
        '# clooks entrypoint: project',
        '# clooks launcher revision: 2',
        "CLOOKS_REQUIRED_RUNTIME='0.3.0'",
        '',
      ].join('\n'),
    )
    rmSync(join(project, '.clooks/bin/runtime-advisory.sh'))
    writeHooks(join(project, '.claude/settings.json'), CLOOKS_ENTRYPOINT_PATH)

    expect(collect()).toEqual([])
  })

  test('offers setup update and an exact full-agent repair for inspectable drift', () => {
    writeMetadata(project, 'project')
    registerClaude(project, 'project')
    registerCodexProject()
    rmSync(join(project, '.clooks/bin/runtime-advisory.sh'))

    const messages = collect()
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain('/clooks:setup update')
    expect(messages[0]).toContain(`cd '${project}'`)
    expect(messages[0]).toContain("'--agent' 'all'")
    expect(messages[0]).not.toContain('/clooks:setup check')
  })

  test('uses check-only guidance for ambiguous ownership or metadata', () => {
    writeMetadata(project, 'project')
    registerClaude(project, 'project')
    write(join(project, '.clooks/bin/runtime-advisory.sh'), '#!/bin/sh\necho custom\n')

    const message = collect()[0]!
    expect(message).toContain('/clooks:setup check')
    expect(message).not.toContain('/clooks:setup update')
    expect(message).toContain("Cannot verify this project's Clooks installation")
    expect(message).not.toContain('is custom')
    expect(message).not.toContain('Do not update automatically')
    expect(message).not.toContain('tell the user')
    expect(message).toContain(`cd '${project}'`)
    expect(message).toContain('init --check')
  })

  test('suppresses uncertain scopes with no ownership by the active agent', () => {
    writeMetadata(project, 'project')
    writeHooks(
      join(project, '.claude/settings.json'),
      makeClaudeGlobalRuntimeAdvisoryCommand(join(root, 'foreign-home')),
    )

    expect(collect()).toEqual([])
  })

  test('reports uncertainty when the active agent has separate owned evidence', () => {
    writeMetadata(project, 'project')
    writeHooks(
      join(project, '.claude/settings.json'),
      makeClaudeGlobalRuntimeAdvisoryCommand(join(root, 'foreign-home')),
    )
    write(
      join(project, '.mcp.json'),
      '{"mcpServers":{"clooks":{"command":"clooks","args":["mcp"]}}}\n',
    )

    const message = collect()[0]!
    expect(message).toContain("Cannot verify this project's Clooks installation")
    expect(message).toContain('/clooks:setup check')
  })

  test('uses check-only guidance when integration drift has no safe repair', () => {
    writeMetadata(project, 'project')
    registerClaude(project, 'project')
    write(
      join(project, '.clooks/bin/entrypoint.sh'),
      [
        '#!/bin/sh',
        '# clooks entrypoint: project',
        '# clooks launcher revision: 0',
        "CLOOKS_REQUIRED_RUNTIME='0.3.0'",
        '',
      ].join('\n'),
    )
    rmSync(join(project, '.clooks/clooks.yml'))

    const message = collect()[0]!
    expect(message).toContain("This project's Clooks integration is outdated")
    expect(message).toContain('/clooks:setup check')
    expect(message).not.toContain('/clooks:setup update')
    expect(message).toContain(`cd '${project}'`)
    expect(message).toContain('init --check')
  })

  test('puts binary guidance first and names the original installation method', () => {
    writeMetadata(project, 'project', '1.0.0')
    registerClaude(project, 'project')

    const message = collect('claude-code', '0.3.0')[0]!
    expect(message).toContain('requires Clooks 1.0.0 or newer')
    expect(message).toContain('running 0.3.0')
    expect(message).toContain('original installation method before any init')
    expect(message.indexOf('requires Clooks')).toBeLessThan(message.indexOf('setup update'))
  })

  test('uses the global integration copy for global-only drift', () => {
    writeMetadata(home, 'global')
    registerClaude(home, 'global')
    rmSync(join(home, '.clooks/bin/runtime-advisory.sh'))

    const message = collect()[0]!
    expect(message).toContain('The global Clooks integration is outdated')
  })

  test('puts binary repair before manual init when both are needed', () => {
    writeMetadata(project, 'project', '1.0.0')
    registerClaude(project, 'project')
    rmSync(join(project, '.clooks/bin/runtime-advisory.sh'))

    const message = collect('claude-code', '0.3.0')[0]!
    expect(message).toContain('original installation method before any init')
    expect(message).toContain('then refresh manually')
    expect(message.indexOf('original installation method')).toBeLessThan(message.indexOf("'init'"))
  })

  test('combines scopes once without hiding binary or ambiguity guidance', () => {
    writeMetadata(home, 'global', '1.0.0')
    registerClaude(home, 'global')
    writeMetadata(project, 'project')
    registerClaude(project, 'project')
    write(join(project, '.clooks/bin/runtime-advisory.sh'), '#!/bin/sh\necho custom\n')

    const messages = collect('claude-code', '0.3.0')
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain('The global Clooks runtime requires Clooks 1.0.0')
    expect(messages[0]).toContain("Cannot verify this project's Clooks installation")
    expect(messages[0]).toContain('original installation method before any init')
    expect(messages[0]).toContain('/clooks:setup check')
  })

  test('uses the active Codex setup workflow', () => {
    writeMetadata(project, 'project', '1.0.0')
    registerCodexProject()

    const message = collect('codex', '0.3.0')[0]!
    expect(message).toContain('$clooks:setup update')
    expect(message).not.toContain('/clooks:setup')
  })

  test('preserves the selected global Codex home in the actual repair command', () => {
    const codexHome = join(root, 'custom codex home')
    mkdirSync(codexHome)
    writeMetadata(home, 'global')
    registerCodexGlobal(codexHome)
    rmSync(join(home, '.clooks/bin/runtime-advisory.sh'))

    const message = collectInstallationAdvisories({
      agent: 'codex',
      projectRoot: project,
      installationHome: home,
      executable,
      binaryVersion: '0.3.0',
      env: { CODEX_HOME: codexHome },
    })[0]!
    expect(message).toContain(`CODEX_HOME='${codexHome}'`)
    expect(message).toContain("'init' '--global' '--agent' 'codex'")
  })

  test('contains top-level inspection failures', () => {
    expect(
      collectInstallationAdvisories({
        agent: 'claude-code',
        projectRoot: project,
        installationHome: 'relative-home',
        executable,
        binaryVersion: '0.3.0',
        env: {},
      }),
    ).toEqual([])
  })
})
