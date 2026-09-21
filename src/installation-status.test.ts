import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import {
  makeCodexGlobalEntrypointCommand,
  makeCodexProjectEntrypointCommand,
} from './agents/codex/settings.js'
import { CLOOKS_ENTRYPOINT_PATH } from './settings.js'
import {
  CLAUDE_PROJECT_RUNTIME_ADVISORY_COMMAND,
  makeClaudeGlobalRuntimeAdvisoryCommand,
  makeCodexGlobalRuntimeAdvisoryCommand,
  makeCodexProjectRuntimeAdvisoryCommand,
} from './registration-advisory.js'
import {
  assertLauncherRefreshAllowed,
  inspectInstallation,
  LAUNCHER_REVISION,
  MIN_RUNTIME_VERSION,
  type InspectInstallationOptions,
} from './installation-status.js'

let root: string
let home: string
let project: string
const executable = '/usr/local/bin/clooks'

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'clooks-installation-status-'))
  home = join(root, 'home')
  project = join(root, 'project')
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

function launcher(
  scope: 'project' | 'global',
  revision: number | null = LAUNCHER_REVISION,
  floor = MIN_RUNTIME_VERSION,
): string {
  return [
    '#!/usr/bin/env bash',
    `# clooks entrypoint: ${scope}`,
    ...(revision === null
      ? []
      : [`# clooks launcher revision: ${revision}`, `CLOOKS_REQUIRED_RUNTIME='${floor}'`]),
    '',
  ].join('\n')
}

function writeLauncher(
  base: string,
  scope: 'project' | 'global',
  revision: number | null = LAUNCHER_REVISION,
  floor = MIN_RUNTIME_VERSION,
): string {
  const path = join(base, '.clooks/bin/entrypoint.sh')
  write(path, launcher(scope, revision, floor))
  writeAdvisory(base, scope, floor)
  return path
}

function advisory(scope: 'project' | 'global', floor = MIN_RUNTIME_VERSION): string {
  return [
    '#!/usr/bin/env bash',
    `# clooks runtime advisory: ${scope}`,
    `CLOOKS_REQUIRED_RUNTIME='${floor}'`,
    '',
  ].join('\n')
}

function writeAdvisory(
  base: string,
  scope: 'project' | 'global',
  floor = MIN_RUNTIME_VERSION,
): string {
  const path = join(base, '.clooks/bin/runtime-advisory.sh')
  write(path, advisory(scope, floor))
  return path
}

function writeConfig(base: string): void {
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
    }) + '\n',
  )
}

function writeMcp(path: string, agent: 'claude-code' | 'codex'): void {
  write(
    path,
    agent === 'codex'
      ? '[mcp_servers.clooks]\ncommand = "clooks"\nargs = ["mcp"]\n'
      : '{"mcpServers":{"clooks":{"command":"clooks","args":["mcp"]}}}\n',
  )
}

function registerClaude(base: string, scope: 'project' | 'global'): void {
  const command =
    scope === 'project' ? CLOOKS_ENTRYPOINT_PATH : join(base, '.clooks/bin/entrypoint.sh')
  const advisoryCommand =
    scope === 'project'
      ? CLAUDE_PROJECT_RUNTIME_ADVISORY_COMMAND
      : makeClaudeGlobalRuntimeAdvisoryCommand(base)
  writeHooks(join(base, '.claude/settings.json'), command, advisoryCommand)
  writeMcp(join(base, scope === 'global' ? '.claude.json' : '.mcp.json'), 'claude-code')
}

function registerCodex(
  base: string,
  scope: 'project' | 'global',
  codexHome = join(base, '.codex'),
): void {
  let command: string
  if (scope === 'project') {
    const id = '0123456789abcdef0123456789abcdef'
    write(join(base, '.clooks/bin/codex-project-id'), `${id}\n`)
    command = makeCodexProjectEntrypointCommand(id)
    writeHooks(join(codexHome, 'hooks.json'), command, makeCodexProjectRuntimeAdvisoryCommand(id))
  } else {
    command = makeCodexGlobalEntrypointCommand(base)
    writeHooks(join(codexHome, 'hooks.json'), command, makeCodexGlobalRuntimeAdvisoryCommand(base))
  }
  writeMcp(join(codexHome, 'config.toml'), 'codex')
}

function inspect(overrides: Partial<InspectInstallationOptions> = {}) {
  return inspectInstallation({
    projectRoot: project,
    installationHome: home,
    executable,
    binaryVersion: '0.3.0',
    env: {},
    scopes: ['project'],
    ...overrides,
  })
}

function treeSnapshot(base: string): Record<string, string> {
  const snapshot: Record<string, string> = {}
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isSymbolicLink())
        snapshot[relative(base, path)] = `link:${readFileSync(path, 'utf8')}`
      else snapshot[relative(base, path)] = readFileSync(path, 'utf8')
    }
  }
  visit(base)
  return snapshot
}

describe('installation metadata and classification', () => {
  test('exports independent launcher metadata constants', () => {
    expect(LAUNCHER_REVISION).toBe(1)
    expect(MIN_RUNTIME_VERSION).toBe('0.3.0')
  })

  test('reports a healthy managed project from actual hook and MCP ownership', () => {
    writeConfig(project)
    writeLauncher(project, 'project')
    registerClaude(project, 'project')

    expect(inspect().scopes).toEqual([
      {
        scope: 'project',
        root: project,
        agents: ['claude-code'],
        revision: 1,
        minimumRuntime: '0.3.0',
        state: 'current',
        needsBinaryUpdate: false,
        needsIntegrationRefresh: false,
        diagnostics: [],
        repair: null,
      },
    ])
  })

  test('registration absence wins over orphan launcher and config artifacts', () => {
    writeConfig(project)
    writeLauncher(project, 'project', 0)

    const [scope] = inspect().scopes
    expect(scope).toMatchObject({ state: 'absent', agents: [], repair: null })
  })

  test('classifies legacy and lower revisions independently of the binary version', () => {
    writeConfig(project)
    registerClaude(project, 'project')
    writeLauncher(project, 'project', null)
    let scope = inspect().scopes[0]!
    expect(scope).toMatchObject({
      state: 'legacy',
      revision: null,
      minimumRuntime: MIN_RUNTIME_VERSION,
      needsIntegrationRefresh: true,
    })
    expect(scope.repair?.args).toEqual(['init', '--agent', 'claude-code'])

    writeLauncher(project, 'project', 0, '0.2.0')
    scope = inspect().scopes[0]!
    expect(scope).toMatchObject({ state: 'outdated', needsIntegrationRefresh: true })
  })

  test('uses SemVer precedence for stable floors, prereleases, and build metadata', () => {
    writeConfig(project)
    registerClaude(project, 'project')
    writeLauncher(project, 'project', 1, '1.0.0')

    expect(inspect({ binaryVersion: '1.0.0-beta.1' }).scopes[0]?.needsBinaryUpdate).toBe(true)
    expect(inspect({ binaryVersion: '1.0.0+local.1' }).scopes[0]?.needsBinaryUpdate).toBe(false)

    writeLauncher(project, 'project', 1, '1.0.0+required.9')
    expect(inspect({ binaryVersion: '1.0.0+selected.4' }).scopes[0]).toMatchObject({
      minimumRuntime: '1.0.0+required.9',
      needsBinaryUpdate: false,
    })
  })

  test('keeps future compatible launchers silent and without repair', () => {
    writeConfig(project)
    registerClaude(project, 'project')
    writeLauncher(project, 'project', 2, '0.3.0')

    expect(inspect().scopes[0]).toMatchObject({
      state: 'future',
      needsBinaryUpdate: false,
      needsIntegrationRefresh: false,
      repair: null,
    })
  })

  test('future launchers can independently require a binary update without offering init', () => {
    writeConfig(project)
    registerClaude(project, 'project')
    writeLauncher(project, 'project', 2, '1.0.0')

    expect(inspect().scopes[0]).toMatchObject({
      state: 'future',
      needsBinaryUpdate: true,
      needsIntegrationRefresh: false,
      repair: null,
    })
  })

  test('missing advisory file and registration independently require integration refresh', () => {
    writeConfig(project)
    writeLauncher(project, 'project')
    registerClaude(project, 'project')
    const advisoryPath = join(project, '.clooks/bin/runtime-advisory.sh')

    rmSync(advisoryPath)
    let scope = inspect().scopes[0]!
    expect(scope).toMatchObject({
      state: 'outdated',
      minimumRuntime: MIN_RUNTIME_VERSION,
      needsIntegrationRefresh: true,
    })
    expect(scope.diagnostics.join('\n')).toContain('Managed runtime advisory is missing')

    writeAdvisory(project, 'project')
    writeHooks(join(project, '.claude/settings.json'), CLOOKS_ENTRYPOINT_PATH)
    scope = inspect().scopes[0]!
    expect(scope).toMatchObject({ state: 'outdated', needsIntegrationRefresh: true })
    expect(scope.diagnostics.join('\n')).not.toContain('Managed runtime advisory is missing')
  })

  test('requires advisory presence independently for every registered agent', () => {
    writeConfig(project)
    writeLauncher(project, 'project')
    registerClaude(project, 'project')
    registerCodex(project, 'project')
    const id = '0123456789abcdef0123456789abcdef'
    writeHooks(join(project, '.codex/hooks.json'), makeCodexProjectEntrypointCommand(id))

    const scope = inspect().scopes[0]!
    expect(scope).toMatchObject({
      agents: ['claude-code', 'codex'],
      state: 'outdated',
      needsIntegrationRefresh: true,
    })
    expect(scope.repair?.args).toEqual(['init', '--agent', 'all'])
  })

  test('advisory-only ownership keeps an incomplete scope visible', () => {
    writeConfig(project)
    writeAdvisory(project, 'project')
    writeHooks(join(project, '.claude/settings.json'), CLAUDE_PROJECT_RUNTIME_ADVISORY_COMMAND)

    const scope = inspect().scopes[0]!
    expect(scope).toMatchObject({
      agents: ['claude-code'],
      state: 'uninspectable',
      repair: null,
    })
    expect(scope.diagnostics.join('\n')).toContain('Managed launcher is missing')
  })

  test.each([
    ['advisory', '0.3.0', '1.0.0+required.9', '1.0.0+required.9'],
    ['launcher', '1.0.0+required.9', '0.3.0', '1.0.0+required.9'],
  ])(
    'uses the higher %s floor and diagnoses literal mismatch',
    (_, launcherFloor, advisoryFloor, expected) => {
      writeConfig(project)
      writeLauncher(project, 'project', 1, launcherFloor)
      writeAdvisory(project, 'project', advisoryFloor)
      registerClaude(project, 'project')

      const scope = inspect({ binaryVersion: '0.9.0' }).scopes[0]!
      expect(scope).toMatchObject({
        state: 'outdated',
        minimumRuntime: expected,
        needsBinaryUpdate: true,
        needsIntegrationRefresh: true,
      })
      expect(scope.diagnostics.join('\n')).toContain('minimum versions differ')
    },
  )

  test('literal advisory mismatch refreshes even when SemVer precedence is equal', () => {
    writeConfig(project)
    writeLauncher(project, 'project', 1, '1.0.0+launcher')
    writeAdvisory(project, 'project', '1.0.0+advisory')
    registerClaude(project, 'project')

    expect(inspect({ binaryVersion: '1.0.0' }).scopes[0]).toMatchObject({
      state: 'outdated',
      needsBinaryUpdate: false,
      needsIntegrationRefresh: true,
    })
  })

  test('future compatible launchers stay silent for missing advisory files and registrations', () => {
    writeConfig(project)
    writeLauncher(project, 'project', 2)
    registerClaude(project, 'project')
    rmSync(join(project, '.clooks/bin/runtime-advisory.sh'))
    writeHooks(join(project, '.claude/settings.json'), CLOOKS_ENTRYPOINT_PATH)

    expect(inspect().scopes[0]).toMatchObject({
      state: 'future',
      needsBinaryUpdate: false,
      needsIntegrationRefresh: false,
      repair: null,
    })
  })

  test.each([
    ['partial', '#!/bin/sh\n# clooks runtime advisory: project\n'],
    [
      'duplicate',
      "#!/bin/sh\n# clooks runtime advisory: project\nCLOOKS_REQUIRED_RUNTIME='0.3.0'\nCLOOKS_REQUIRED_RUNTIME='0.3.0'\n",
    ],
    [
      'duplicate-header',
      "#!/bin/sh\n# clooks runtime advisory: project\n# clooks runtime advisory: project\nCLOOKS_REQUIRED_RUNTIME='0.3.0'\n",
    ],
    [
      'malformed-header',
      "#!/bin/sh\n# clooks runtime advisory: PROJECT\nCLOOKS_REQUIRED_RUNTIME='0.3.0'\n",
    ],
    ['malformed', '#!/bin/sh\n# clooks runtime advisory: project\nCLOOKS_REQUIRED_RUNTIME=0.3.0\n'],
    [
      'indented',
      "#!/bin/sh\n# clooks runtime advisory: project\n CLOOKS_REQUIRED_RUNTIME='9.0.0'\n",
    ],
    [
      'invalid-semver',
      "#!/bin/sh\n# clooks runtime advisory: project\nCLOOKS_REQUIRED_RUNTIME='01.0.0'\n",
    ],
    [
      'revisioned',
      "#!/bin/sh\n# clooks runtime advisory: project\n# clooks launcher revision: 1\nCLOOKS_REQUIRED_RUNTIME='0.3.0'\n",
    ],
  ])('rejects %s advisory metadata', (_, contents) => {
    writeConfig(project)
    writeLauncher(project, 'project')
    registerClaude(project, 'project')
    const advisoryPath = join(project, '.clooks/bin/runtime-advisory.sh')
    write(advisoryPath, contents)

    expect(inspect().scopes[0]).toMatchObject({ state: 'uninspectable', repair: null })
    expect(() =>
      assertLauncherRefreshAllowed({
        launcherPath: join(project, '.clooks/bin/entrypoint.sh'),
        advisoryPath,
        expectedScope: 'project',
        runtimeVersion: '9.0.0',
      }),
    ).toThrow(/advisory (?:metadata|headers)/u)
  })

  test.each([
    ['partial', '#!/bin/sh\n# clooks entrypoint: project\n# clooks launcher revision: 1\n'],
    [
      'duplicate',
      "#!/bin/sh\n# clooks entrypoint: project\n# clooks launcher revision: 1\n# clooks launcher revision: 1\nCLOOKS_REQUIRED_RUNTIME='0.3.0'\n",
    ],
    [
      'malformed',
      '#!/bin/sh\n# clooks entrypoint: project\n# clooks launcher revision: 01\nCLOOKS_REQUIRED_RUNTIME=0.3.0\n',
    ],
    [
      'indented',
      "#!/bin/sh\n# clooks entrypoint: project\n # clooks launcher revision: 1\n CLOOKS_REQUIRED_RUNTIME='9.0.0'\n",
    ],
  ])('rejects %s managed metadata', (_, contents) => {
    writeConfig(project)
    registerClaude(project, 'project')
    const path = join(project, '.clooks/bin/entrypoint.sh')
    write(path, contents)

    expect(inspect().scopes[0]).toMatchObject({ state: 'uninspectable', repair: null })
    expect(() =>
      assertLauncherRefreshAllowed({
        launcherPath: path,
        advisoryPath: join(project, '.clooks/bin/runtime-advisory.sh'),
        expectedScope: 'project',
        runtimeVersion: '0.3.0',
      }),
    ).toThrow(/metadata/u)
  })

  test.each([
    ['NUL bytes', '#!/bin/sh\n# clooks entrypoint: project\n\0', 'contains NUL bytes'],
    [
      'a malformed managed header',
      '#!/bin/sh\n# clooks entrypoint: PROJECT\n',
      'malformed or duplicate managed launcher headers',
    ],
  ])('reports a launcher with %s as uninspectable', (_, contents, diagnostic) => {
    writeConfig(project)
    registerClaude(project, 'project')
    write(join(project, '.clooks/bin/entrypoint.sh'), contents)

    const scope = inspect().scopes[0]!
    expect(scope).toMatchObject({ state: 'uninspectable', repair: null })
    expect(scope.diagnostics.join('\n')).toContain(diagnostic)
  })

  test('custom and symlinked launchers never become inspector repair permission', () => {
    writeConfig(project)
    registerClaude(project, 'project')
    const path = join(project, '.clooks/bin/entrypoint.sh')
    write(path, '#!/bin/sh\necho custom\n')
    let scope = inspect().scopes[0]!
    expect(scope).toMatchObject({ state: 'uninspectable', repair: null })
    expect(scope.diagnostics.join('\n')).toContain('is custom')
    expect(() =>
      assertLauncherRefreshAllowed({
        launcherPath: path,
        advisoryPath: join(project, '.clooks/bin/runtime-advisory.sh'),
        expectedScope: 'project',
        runtimeVersion: '0.3.0',
      }),
    ).not.toThrow()

    const target = join(root, 'launcher-target')
    write(target, launcher('project'))
    rmSync(path)
    symlinkSync(target, path)
    scope = inspect().scopes[0]!
    expect(scope).toMatchObject({ state: 'uninspectable', repair: null })
    expect(lstatSync(path).isSymbolicLink()).toBe(true)
    expect(() =>
      assertLauncherRefreshAllowed({
        launcherPath: path,
        advisoryPath: join(project, '.clooks/bin/runtime-advisory.sh'),
        expectedScope: 'project',
        runtimeVersion: '0.3.0',
      }),
    ).toThrow('regular file')
  })

  test('custom, symlinked, wrong-scope, and oversized advisories cannot be refreshed', () => {
    writeConfig(project)
    const launcherPath = writeLauncher(project, 'project')
    registerClaude(project, 'project')
    const advisoryPath = join(project, '.clooks/bin/runtime-advisory.sh')
    const guard = () =>
      assertLauncherRefreshAllowed({
        launcherPath,
        advisoryPath,
        expectedScope: 'project',
        runtimeVersion: '9.0.0',
      })

    write(advisoryPath, '#!/bin/sh\necho custom\n')
    expect(inspect().scopes[0]).toMatchObject({ state: 'uninspectable', repair: null })
    expect(guard).toThrow('will not be overwritten')

    write(advisoryPath, "# clooks runtime advisory: project\nCLOOKS_REQUIRED_RUNTIME='0.3.0'\n\0")
    expect(inspect().scopes[0]?.diagnostics.join('\n')).toContain('contains NUL bytes')
    expect(guard).toThrow('contains NUL bytes')

    writeAdvisory(project, 'global')
    expect(inspect().scopes[0]).toMatchObject({ state: 'uninspectable', repair: null })
    expect(guard).toThrow('managed global advisory')

    write(advisoryPath, advisory('project') + '#'.repeat(256 * 1024))
    expect(inspect().scopes[0]?.diagnostics.join('\n')).toContain('inspection size limit')
    expect(guard).toThrow('inspection size limit')

    const target = join(root, 'advisory-target')
    write(target, advisory('project'))
    rmSync(advisoryPath)
    symlinkSync(target, advisoryPath)
    expect(inspect().scopes[0]).toMatchObject({ state: 'uninspectable', repair: null })
    expect(guard).toThrow('regular file')
  })

  test('reports an actionable diagnostic for a missing managed launcher', () => {
    writeConfig(project)
    registerClaude(project, 'project')

    const scope = inspect().scopes[0]!
    expect(scope).toMatchObject({ state: 'uninspectable', repair: null })
    expect(scope.diagnostics.join('\n')).toContain('Managed launcher is missing')
  })

  test('requires authored config before offering integration repair', () => {
    registerClaude(project, 'project')
    writeLauncher(project, 'project', null)

    const scope = inspect().scopes[0]!
    expect(scope.state).toBe('legacy')
    expect(scope.repair).toBeNull()
    expect(scope.diagnostics.join('\n')).toContain('init would create one')
  })

  test('does not treat a current launcher stamp as complete registration', () => {
    writeConfig(project)
    writeLauncher(project, 'project')
    writeHooks(join(project, '.claude/settings.json'), CLOOKS_ENTRYPOINT_PATH)

    const scope = inspect().scopes[0]!
    expect(scope).toMatchObject({
      state: 'outdated',
      needsIntegrationRefresh: true,
      agents: ['claude-code'],
    })
    expect(scope.repair?.args).toEqual(['init', '--agent', 'claude-code'])
  })

  test('diagnoses missing authored config even when registration metadata is current', () => {
    writeLauncher(project, 'project')
    registerClaude(project, 'project')

    const scope = inspect().scopes[0]!
    expect(scope).toMatchObject({ state: 'current', repair: null })
    expect(scope.diagnostics.join('\n')).toContain('init would create one')
  })
})

describe('ownership and repair scope', () => {
  test('does not claim a registration pointing at another root', () => {
    writeConfig(project)
    writeLauncher(project, 'project')
    writeHooks(
      join(project, '.claude/settings.json'),
      join(root, 'foreign', '.clooks/bin/entrypoint.sh'),
    )
    writeMcp(join(project, '.mcp.json'), 'claude-code')

    const scope = inspect().scopes[0]!
    expect(scope).toMatchObject({ state: 'uninspectable', repair: null })
    expect(scope.diagnostics.join('\n')).toContain('uncertain ownership')
  })

  test('does not claim an unsafe unquoted Claude absolute project command', () => {
    const spacedProject = join(root, 'project with spaces')
    mkdirSync(spacedProject)
    writeConfig(spacedProject)
    writeLauncher(spacedProject, 'project', null)
    writeHooks(
      join(spacedProject, '.claude/settings.json'),
      join(spacedProject, '.clooks/bin/entrypoint.sh'),
    )
    writeMcp(join(spacedProject, '.mcp.json'), 'claude-code')

    const scope = inspect({ projectRoot: spacedProject }).scopes[0]!
    expect(scope).toMatchObject({ state: 'uninspectable', repair: null })
    expect(scope.diagnostics.join('\n')).toContain('uncertain ownership')
  })

  test('detects unsupported old absolute Codex project commands without claiming them', () => {
    writeConfig(project)
    writeLauncher(project, 'project')
    const old = `CLOOKS_AGENT=codex CLOOKS_PROJECT_ROOT='${project}' '${join(project, '.clooks/bin/entrypoint.sh')}'`
    writeHooks(join(project, '.codex/hooks.json'), old)
    writeMcp(join(project, '.codex/config.toml'), 'codex')

    expect(inspect().scopes[0]).toMatchObject({ state: 'uninspectable', repair: null })
  })

  test('distinguishes a foreign named MCP server from absence', () => {
    writeConfig(project)
    writeLauncher(project, 'project')
    writeHooks(join(project, '.claude/settings.json'), CLOOKS_ENTRYPOINT_PATH)
    write(join(project, '.mcp.json'), '{"mcpServers":{"clooks":{"command":"foreign"}}}\n')

    const scope = inspect().scopes[0]!
    expect(scope).toMatchObject({ state: 'uninspectable', repair: null })
    expect(scope.diagnostics.join('\n')).toContain('foreign or invalid MCP server named clooks')
  })

  test('inspects owned MCP state larger than one MiB within its dedicated bound', () => {
    writeConfig(project)
    writeLauncher(project, 'project')
    registerClaude(project, 'project')
    write(
      join(project, '.mcp.json'),
      JSON.stringify({
        unrelatedState: 'x'.repeat(1024 * 1024),
        mcpServers: { clooks: { command: 'clooks', args: ['mcp'] } },
      }),
    )

    expect(inspect().scopes[0]).toMatchObject({ state: 'current', agents: ['claude-code'] })
  })

  test('does not claim an unquoted Codex global command at the right root', () => {
    writeConfig(home)
    writeLauncher(home, 'global', null)
    const unquoted = `CLOOKS_AGENT=codex ${join(home, '.clooks/bin/entrypoint.sh')}`
    writeHooks(join(home, '.codex/hooks.json'), unquoted)
    writeMcp(join(home, '.codex/config.toml'), 'codex')

    const scope = inspect({ projectRoot: undefined, scopes: ['global'] }).scopes[0]!
    expect(scope).toMatchObject({ state: 'uninspectable', repair: null })
    expect(scope.diagnostics.join('\n')).toContain('uncertain ownership')
  })

  test('does not claim an advisory command targeting another scope', () => {
    writeConfig(project)
    writeLauncher(project, 'project')
    writeHooks(
      join(project, '.claude/settings.json'),
      CLOOKS_ENTRYPOINT_PATH,
      makeClaudeGlobalRuntimeAdvisoryCommand(join(root, 'foreign-home')),
    )
    writeMcp(join(project, '.mcp.json'), 'claude-code')

    const scope = inspect().scopes[0]!
    expect(scope).toMatchObject({ state: 'uninspectable', repair: null })
    expect(scope.diagnostics.join('\n')).toContain('runtime advisory with uncertain ownership')
  })

  test('requires advisory registration specifically on SessionStart', () => {
    writeConfig(project)
    writeLauncher(project, 'project')
    write(
      join(project, '.claude/settings.json'),
      JSON.stringify({
        hooks: {
          SessionStart: [
            { matcher: '*', hooks: [{ type: 'command', command: CLOOKS_ENTRYPOINT_PATH }] },
          ],
          Stop: [
            {
              matcher: '*',
              hooks: [{ type: 'command', command: CLAUDE_PROJECT_RUNTIME_ADVISORY_COMMAND }],
            },
          ],
        },
      }),
    )
    writeMcp(join(project, '.mcp.json'), 'claude-code')

    expect(inspect().scopes[0]).toMatchObject({
      state: 'outdated',
      needsIntegrationRefresh: true,
    })
  })

  test('agent filters select scopes but preserve the full registered repair set', () => {
    writeConfig(project)
    writeLauncher(project, 'project', null)
    registerClaude(project, 'project')
    registerCodex(project, 'project')

    const scope = inspect({ agents: ['codex'] }).scopes[0]!
    expect(scope.agents).toEqual(['claude-code', 'codex'])
    expect(scope.repair?.args).toEqual(['init', '--agent', 'all'])
  })

  test('mismatched generated approval ownership remains uncertain', () => {
    writeConfig(project)
    writeLauncher(project, 'project', null)
    const command =
      'CLOOKS_APPROVAL_PROTOCOL=1 CLOOKS_APPROVAL_OWNER=global ' +
      'CLOOKS_APPROVAL_DISPOSITION=run CLOOKS_AGENT=codex ' +
      CLOOKS_ENTRYPOINT_PATH
    writeHooks(join(project, '.claude/settings.json'), command)
    writeMcp(join(project, '.mcp.json'), 'claude-code')

    const scope = inspect().scopes[0]!
    expect(scope).toMatchObject({ state: 'uninspectable', repair: null })
    expect(scope.diagnostics.join('\n')).toContain('uncertain ownership')
  })

  test('contains malformed registration failure to its scope', () => {
    write(join(project, '.claude/settings.json'), '{ invalid\n')
    writeConfig(project)
    writeLauncher(project, 'project')

    const result = inspect({ scopes: ['project', 'global'] })
    expect(result.scopes.find((scope) => scope.scope === 'project')?.state).toBe('uninspectable')
    expect(result.scopes.find((scope) => scope.scope === 'global')?.state).toBe('absent')
  })

  test('uses only injected Claude layout environment', () => {
    writeConfig(project)
    writeLauncher(project, 'project')
    registerClaude(project, 'project')
    const previous = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = '/ambient/ignored'
    try {
      expect(inspect({ env: {} }).scopes[0]?.state).toBe('current')
      expect(inspect({ env: { CLAUDE_CONFIG_DIR: '/injected' } }).scopes[0]?.state).toBe(
        'uninspectable',
      )
    } finally {
      if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = previous
    }
  })

  test('does not apply Claude layout diagnostics to a Codex-only scope selected by all agents', () => {
    writeConfig(project)
    writeLauncher(project, 'project')
    registerCodex(project, 'project')

    const scope = inspect({
      agents: ['claude-code', 'codex'],
      env: { CLAUDE_CONFIG_DIR: '/injected' },
    }).scopes[0]!
    expect(scope).toMatchObject({ state: 'current', agents: ['codex'] })
    expect(scope.diagnostics.join('\n')).not.toContain('CLAUDE_CONFIG_DIR')
  })
})

describe('global Codex identity and coincident roots', () => {
  test('recorded Codex home precedes environment and is preserved in repair', () => {
    const recorded = join(root, 'recorded-codex')
    const selected = join(root, 'selected-codex')
    mkdirSync(recorded)
    mkdirSync(selected)
    writeConfig(home)
    writeLauncher(home, 'global', null)
    registerCodex(home, 'global', recorded)
    write(join(home, '.clooks/.codex-registration-home'), `clooks-codex-home-v1\n${recorded}\n`)

    const scope = inspect({
      projectRoot: undefined,
      scopes: ['global'],
      env: { CODEX_HOME: selected },
    }).scopes[0]!
    expect(scope.agents).toEqual(['codex'])
    expect(scope.state).toBe('legacy')
    expect(scope.repair?.env).toEqual({ CODEX_HOME: recorded })
    expect(scope.diagnostics.join('\n')).toContain('takes precedence')
  })

  test('valid recorded Codex home survives an invalid ambient CODEX_HOME', () => {
    const recorded = join(root, 'recorded-codex')
    mkdirSync(recorded)
    writeConfig(home)
    writeLauncher(home, 'global', null)
    registerCodex(home, 'global', recorded)
    write(join(home, '.clooks/.codex-registration-home'), `clooks-codex-home-v1\n${recorded}\n`)

    const scope = inspect({
      projectRoot: undefined,
      scopes: ['global'],
      env: { CODEX_HOME: 'relative-invalid' },
    }).scopes[0]!
    expect(scope).toMatchObject({ state: 'legacy', agents: ['codex'] })
    expect(scope.repair?.env).toEqual({ CODEX_HOME: recorded })
    expect(scope.diagnostics.join('\n')).toContain('CODEX_HOME must be an absolute path')
  })

  test('conflicting valid records make the global scope uninspectable', () => {
    const a = join(root, 'codex-a')
    const b = join(root, 'codex-b')
    mkdirSync(a)
    mkdirSync(b)
    writeConfig(home)
    writeLauncher(home, 'global', null)
    registerCodex(home, 'global', a)
    write(
      join(home, '.clooks/.global-entrypoint-active.codex'),
      `clooks-codex-registration-v1\n${home}\n${a}\n1:1\n`,
    )
    write(join(home, '.clooks/.codex-registration-home'), `clooks-codex-home-v1\n${b}\n`)

    const scope = inspect({ projectRoot: undefined, scopes: ['global'] }).scopes[0]!
    expect(scope).toMatchObject({ state: 'uninspectable', repair: null })
    expect(scope.diagnostics.join('\n')).toContain('conflicting homes')
  })

  test('bounds persisted Codex registration-state reads', () => {
    write(join(home, '.clooks/.codex-registration-home'), 'x'.repeat(4097))

    const scope = inspect({ projectRoot: undefined, scopes: ['global'] }).scopes[0]!
    expect(scope).toMatchObject({ state: 'uninspectable', repair: null })
    expect(scope.diagnostics.join('\n')).toContain('exceeds the inspection size limit')
  })

  test('deduplicates HOME project fallback to one global scope', () => {
    writeConfig(home)
    writeLauncher(home, 'global')
    registerClaude(home, 'global')

    const result = inspect({ projectRoot: home, scopes: ['project', 'global'] })
    expect(result.scopes).toHaveLength(1)
    expect(result.scopes[0]).toMatchObject({ scope: 'global', state: 'current' })
  })

  test('keeps default-home Codex registration classified as global', () => {
    writeConfig(home)
    writeLauncher(home, 'global')
    registerCodex(home, 'global')

    const scope = inspect({ projectRoot: home, scopes: ['project', 'global'] }).scopes[0]!
    expect(scope).toMatchObject({ scope: 'global', state: 'current', agents: ['codex'] })
  })

  test.each(['claude-code', 'codex'] as const)(
    'accepts %s global advisory ownership through a symlinked HOME',
    (agent) => {
      const linkedHome = join(root, 'linked-home')
      symlinkSync(home, linkedHome)
      writeConfig(home)
      writeLauncher(home, 'global')
      if (agent === 'claude-code') {
        writeHooks(
          join(home, '.claude/settings.json'),
          join(linkedHome, '.clooks/bin/entrypoint.sh'),
          makeClaudeGlobalRuntimeAdvisoryCommand(linkedHome),
        )
        writeMcp(join(home, '.claude.json'), 'claude-code')
      } else {
        writeHooks(
          join(home, '.codex/hooks.json'),
          makeCodexGlobalEntrypointCommand(linkedHome),
          makeCodexGlobalRuntimeAdvisoryCommand(linkedHome),
        )
        writeMcp(join(home, '.codex/config.toml'), 'codex')
      }

      const scope = inspect({
        projectRoot: undefined,
        installationHome: linkedHome,
        scopes: ['global'],
      }).scopes[0]!
      expect(scope).toMatchObject({ scope: 'global', state: 'current', agents: [agent] })
      expect(scope.diagnostics).toEqual([])
    },
  )

  test('pins the resolved default Codex home in global repair commands', () => {
    writeConfig(home)
    writeLauncher(home, 'global', null)
    registerCodex(home, 'global')

    const scope = inspect({ projectRoot: undefined, scopes: ['global'] }).scopes[0]!
    expect(scope).toMatchObject({ scope: 'global', state: 'legacy', agents: ['codex'] })
    expect(scope.repair?.env).toEqual({ CODEX_HOME: join(home, '.codex') })
  })

  test('diagnoses genuine project-specific registration at coincident HOME', () => {
    writeConfig(home)
    writeLauncher(home, 'global', null)
    registerClaude(home, 'global')
    writeMcp(join(home, '.mcp.json'), 'claude-code')

    const scope = inspect({ projectRoot: home, scopes: ['project', 'global'] }).scopes[0]!
    expect(scope).toMatchObject({ scope: 'global', state: 'uninspectable', repair: null })
    expect(scope.diagnostics.join('\n')).toContain('Project-specific Claude MCP registration')
  })

  test('diagnoses project-specific registration at HOME during global-only checks', () => {
    writeConfig(home)
    writeLauncher(home, 'global', null)
    registerClaude(home, 'global')
    writeMcp(join(home, '.mcp.json'), 'claude-code')

    const scope = inspect({ projectRoot: undefined, scopes: ['global'] }).scopes[0]!
    expect(scope).toMatchObject({ scope: 'global', state: 'uninspectable', repair: null })
    expect(scope.diagnostics.join('\n')).toContain('Project-specific Claude MCP registration')
  })

  test('diagnoses project Codex hooks at HOME when global Codex uses a custom home', () => {
    const globalCodexHome = join(root, 'global-codex')
    mkdirSync(globalCodexHome)
    writeConfig(home)
    writeLauncher(home, 'global', null)
    registerCodex(home, 'global', globalCodexHome)
    registerCodex(home, 'project')

    const scope = inspect({
      projectRoot: undefined,
      scopes: ['global'],
      env: { CODEX_HOME: globalCodexHome },
    }).scopes[0]!
    expect(scope).toMatchObject({ scope: 'global', state: 'uninspectable', repair: null })
    expect(scope.diagnostics.join('\n')).toContain('Project-specific Codex hook registration')
  })

  test('diagnoses advisory-only project Codex ownership at HOME with a custom global home', () => {
    const globalCodexHome = join(root, 'global-codex')
    const id = '0123456789abcdef0123456789abcdef'
    mkdirSync(globalCodexHome)
    writeConfig(home)
    writeLauncher(home, 'global', null)
    registerCodex(home, 'global', globalCodexHome)
    write(join(home, '.clooks/bin/codex-project-id'), `${id}\n`)
    writeHooks(join(home, '.codex/hooks.json'), makeCodexProjectRuntimeAdvisoryCommand(id))

    const scope = inspect({
      projectRoot: undefined,
      scopes: ['global'],
      env: { CODEX_HOME: globalCodexHome },
    }).scopes[0]!
    expect(scope).toMatchObject({ scope: 'global', state: 'uninspectable', repair: null })
    expect(scope.diagnostics.join('\n')).toContain(
      'Project-specific Codex runtime advisory registration',
    )
  })
})

describe('refresh guard and read-only behavior', () => {
  test('allows missing, custom, legacy, and supported managed launchers', () => {
    const path = join(project, '.clooks/bin/entrypoint.sh')
    for (const contents of [
      undefined,
      '#!/bin/sh\necho custom\n',
      launcher('project', null),
      launcher('project'),
    ]) {
      rmSync(path, { force: true })
      if (contents !== undefined) write(path, contents)
      expect(() =>
        assertLauncherRefreshAllowed({
          launcherPath: path,
          advisoryPath: join(project, '.clooks/bin/runtime-advisory.sh'),
          expectedScope: 'project',
          runtimeVersion: '0.3.0',
        }),
      ).not.toThrow()
    }
  })

  test('blocks future revisions, unsupported floors, and wrong managed scope', () => {
    const path = writeLauncher(project, 'project', 2)
    expect(() =>
      assertLauncherRefreshAllowed({
        launcherPath: path,
        advisoryPath: join(project, '.clooks/bin/runtime-advisory.sh'),
        expectedScope: 'project',
        runtimeVersion: '0.3.0',
      }),
    ).toThrow('future launcher revision')

    write(path, launcher('project', 1, '1.0.0'))
    expect(() =>
      assertLauncherRefreshAllowed({
        launcherPath: path,
        advisoryPath: join(project, '.clooks/bin/runtime-advisory.sh'),
        expectedScope: 'project',
        runtimeVersion: '0.3.0',
      }),
    ).toThrow('requires Clooks 1.0.0')

    write(path, launcher('project', 1, '1.0.0+required.9'))
    expect(() =>
      assertLauncherRefreshAllowed({
        launcherPath: path,
        advisoryPath: join(project, '.clooks/bin/runtime-advisory.sh'),
        expectedScope: 'project',
        runtimeVersion: '1.0.0+selected.4',
      }),
    ).not.toThrow()

    write(path, launcher('global'))
    expect(() =>
      assertLauncherRefreshAllowed({
        launcherPath: path,
        advisoryPath: join(project, '.clooks/bin/runtime-advisory.sh'),
        expectedScope: 'project',
        runtimeVersion: '0.3.0',
      }),
    ).toThrow(
      'managed global launcher, not a managed project launcher. Check the intended directory and scope before retrying.',
    )
  })

  test('guards an existing advisory independently before refresh writes', () => {
    const launcherPath = join(project, '.clooks/bin/entrypoint.sh')
    const advisoryPath = writeAdvisory(project, 'project', '1.0.0')
    const guard = (runtimeVersion: string) =>
      assertLauncherRefreshAllowed({
        launcherPath,
        advisoryPath,
        expectedScope: 'project',
        runtimeVersion,
      })

    expect(() => guard('0.9.0')).toThrow('requires Clooks 1.0.0')
    expect(() => guard('1.0.0')).not.toThrow()

    writeLauncher(project, 'project', 1, '0.9.0')
    writeAdvisory(project, 'project', '1.0.0')
    expect(() => guard('1.0.0')).not.toThrow()

    rmSync(advisoryPath)
    expect(() => guard('1.0.0')).not.toThrow()
  })

  test('inspection leaves every file byte unchanged and creates nothing', () => {
    writeConfig(project)
    writeLauncher(project, 'project', null)
    registerClaude(project, 'project')
    registerCodex(project, 'project')
    const before = treeSnapshot(root)

    inspect({ scopes: ['project', 'global'] })

    expect(treeSnapshot(root)).toEqual(before)
  })
})
