import { afterEach, describe, expect, test } from 'bun:test'
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { createRegistrationSandbox } from './helpers/registration'
import type { Sandbox } from './helpers/sandbox'

interface ScopeStatus {
  scope: 'project' | 'global'
  root: string
  agents: string[]
  revision: number | null
  minimumRuntime: string | null
  state: string
  needsBinaryUpdate: boolean
  needsIntegrationRefresh: boolean
  diagnostics: string[]
  repair: {
    executable: string
    args: string[]
    cwd: string
    env: Record<string, string>
  } | null
}

interface CheckEnvelope {
  ok: true
  command: 'init'
  data: { binaryVersion: string; scopes: ScopeStatus[] }
}

let sandbox: Sandbox

afterEach(() => sandbox?.cleanup())

function snapshotTree(root: string): string {
  const records: unknown[] = []
  const visit = (relative: string) => {
    const path = join(root, relative)
    const stat = lstatSync(path)
    const mode = stat.mode & 0o777
    if (stat.isDirectory()) {
      records.push(['directory', relative, mode])
      for (const name of readdirSync(path).sort()) visit(join(relative, name))
    } else if (stat.isSymbolicLink()) {
      records.push(['symlink', relative, mode, readlinkSync(path)])
    } else {
      records.push(['file', relative, mode, readFileSync(path).toString('base64')])
    }
  }
  visit('.')
  return JSON.stringify(records)
}

function parseCheck(stdout: string): CheckEnvelope {
  const envelope = JSON.parse(stdout) as CheckEnvelope
  expect(envelope.ok).toBe(true)
  expect(envelope.command).toBe('init')
  return envelope
}

function replaceRevision(path: string, revision: number): void {
  const before = readFileSync(path, 'utf8')
  const after = before.replace(
    '# clooks launcher revision: 1',
    `# clooks launcher revision: ${revision}`,
  )
  expect(after).not.toBe(before)
  writeFileSync(path, after)
  chmodSync(path, 0o755)
}

function replaceMinimumRuntime(path: string, version: string): void {
  const before = readFileSync(path, 'utf8')
  const after = before.replace(
    "CLOOKS_REQUIRED_RUNTIME='0.3.0'",
    `CLOOKS_REQUIRED_RUNTIME='${version}'`,
  )
  expect(after).not.toBe(before)
  writeFileSync(path, after)
  chmodSync(path, 0o755)
}

function replaceLauncherText(path: string, beforeText: string, afterText: string): void {
  const before = readFileSync(path, 'utf8')
  const after = before.replace(beforeText, afterText)
  expect(after).not.toBe(before)
  writeFileSync(path, after)
  chmodSync(path, 0o755)
}

describe('installation update inspection E2E', () => {
  test('invalid --agent check returns one JSON error with no partial result or writes', () => {
    sandbox = createRegistrationSandbox()
    const beforeProject = snapshotTree(sandbox.dir)
    const beforeHome = snapshotTree(sandbox.home)

    const result = sandbox.run(['init', '--check', '--agent', 'invalid', '--json'])

    expect(result.exitCode).toBe(1)
    const envelope = JSON.parse(result.stdout) as Record<string, unknown>
    expect(envelope).toEqual({
      ok: false,
      command: 'init',
      error: 'Invalid --agent value "invalid". Expected one of: claude-code, codex, all.',
    })
    expect(result.stdout.trim().split('\n')).toHaveLength(1)
    expect(snapshotTree(sandbox.dir)).toBe(beforeProject)
    expect(snapshotTree(sandbox.home)).toBe(beforeHome)
  })

  test('default check discovers a nested project and reports project and global agents without writes', () => {
    sandbox = createRegistrationSandbox()
    expect(sandbox.run(['init', '--agent', 'all']).exitCode).toBe(0)
    expect(sandbox.run(['init', '--global', '--agent', 'all']).exitCode).toBe(0)
    const nested = join(sandbox.dir, 'nested', 'deeper')
    mkdirSync(nested, { recursive: true })
    const beforeProject = snapshotTree(sandbox.dir)
    const beforeHome = snapshotTree(sandbox.home)

    const result = sandbox.run(['init', '--check', '--json'], { cwd: nested })

    expect(result.exitCode).toBe(0)
    const status = parseCheck(result.stdout).data
    expect(status.binaryVersion).toBe('0.3.0')
    expect(status.scopes.map((scope) => scope.scope).sort()).toEqual(['global', 'project'])
    for (const scope of status.scopes) {
      expect(scope.state).toBe('current')
      expect(scope.agents).toEqual(['claude-code', 'codex'])
      expect(scope.revision).toBe(1)
      expect(scope.minimumRuntime).toBe('0.3.0')
      expect(scope.needsBinaryUpdate).toBe(false)
      expect(scope.needsIntegrationRefresh).toBe(false)
      expect(scope.repair).toBeNull()
    }
    expect(status.scopes.find((scope) => scope.scope === 'project')?.root).toBe(sandbox.dir)
    expect(status.scopes.find((scope) => scope.scope === 'global')?.root).toBe(sandbox.home)
    expect(snapshotTree(sandbox.dir)).toBe(beforeProject)
    expect(snapshotTree(sandbox.home)).toBe(beforeHome)
  })

  test('scope and agent filters select reports without shrinking a shared repair command', () => {
    sandbox = createRegistrationSandbox()
    expect(sandbox.run(['init', '--agent', 'claude-code']).exitCode).toBe(0)
    expect(sandbox.run(['init', '--global', '--agent', 'all']).exitCode).toBe(0)
    replaceRevision(join(sandbox.home, '.clooks/bin/entrypoint.sh'), 0)

    const filtered = sandbox.run(['init', '--check', '--agent', 'codex', '--json'])
    expect(filtered.exitCode).toBe(0)
    const filteredScopes = parseCheck(filtered.stdout).data.scopes
    expect(filteredScopes).toHaveLength(1)
    expect(filteredScopes[0]?.scope).toBe('global')
    expect(filteredScopes[0]?.agents).toEqual(['claude-code', 'codex'])
    expect(filteredScopes[0]?.repair?.args).toEqual(['init', '--global', '--agent', 'all'])

    const globalOnly = sandbox.run(['init', '--check', '--global', '--json'])
    expect(globalOnly.exitCode).toBe(0)
    expect(parseCheck(globalOnly.stdout).data.scopes.map((scope) => scope.scope)).toEqual([
      'global',
    ])
  })

  test('human repair output shell-quotes a project path containing spaces', () => {
    sandbox = createRegistrationSandbox()
    const spacedProject = join(sandbox.dir, 'project with spaces')
    mkdirSync(spacedProject)
    expect(sandbox.run(['init', '--agent', 'claude-code'], { cwd: spacedProject }).exitCode).toBe(0)
    replaceRevision(join(spacedProject, '.clooks/bin/entrypoint.sh'), 0)
    const beforeProject = snapshotTree(sandbox.dir)
    const beforeHome = snapshotTree(sandbox.home)

    const result = sandbox.run(['init', '--check', '--agent', 'claude-code'], {
      cwd: spacedProject,
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(
      `Repair from '${spacedProject}': '/app/dist/clooks' 'init' '--agent' 'claude-code'`,
    )
    expect(snapshotTree(sandbox.dir)).toBe(beforeProject)
    expect(snapshotTree(sandbox.home)).toBe(beforeHome)
  })

  test('a current launcher with an unmet floor is reported as needing a binary update', () => {
    sandbox = createRegistrationSandbox()
    expect(sandbox.run(['init', '--agent', 'claude-code']).exitCode).toBe(0)
    replaceMinimumRuntime(join(sandbox.dir, '.clooks/bin/entrypoint.sh'), '0.4.0')
    replaceMinimumRuntime(join(sandbox.dir, '.clooks/bin/runtime-advisory.sh'), '0.4.0')
    const beforeProject = snapshotTree(sandbox.dir)
    const beforeHome = snapshotTree(sandbox.home)

    const json = sandbox.run(['init', '--check', '--agent', 'claude-code', '--json'])
    expect(json.exitCode).toBe(0)
    const project = parseCheck(json.stdout).data.scopes.find((scope) => scope.scope === 'project')!
    expect(project.state).toBe('current')
    expect(project.needsBinaryUpdate).toBe(true)
    expect(project.needsIntegrationRefresh).toBe(false)
    expect(project.repair).toBeNull()

    const human = sandbox.run(['init', '--check', '--agent', 'claude-code'])
    expect(human.exitCode).toBe(0)
    expect(human.stdout).toContain('needs binary update')
    expect(snapshotTree(sandbox.dir)).toBe(beforeProject)
    expect(snapshotTree(sandbox.home)).toBe(beforeHome)
  })

  test('recorded Codex home wins over environment disagreement in an exact repair', () => {
    sandbox = createRegistrationSandbox()
    const recorded = join(sandbox.home, 'recorded-codex')
    const other = join(sandbox.home, 'other-codex')
    mkdirSync(other, { recursive: true })
    expect(
      sandbox.run(['init', '--global', '--agent', 'codex'], {
        env: { CODEX_HOME: recorded },
      }).exitCode,
    ).toBe(0)
    replaceRevision(join(sandbox.home, '.clooks/bin/entrypoint.sh'), 0)
    const beforeHome = snapshotTree(sandbox.home)

    const result = sandbox.run(['init', '--check', '--global', '--agent', 'codex', '--json'], {
      env: { CODEX_HOME: other },
    })

    expect(result.exitCode).toBe(0)
    const scope = parseCheck(result.stdout).data.scopes[0]!
    expect(scope.state).toBe('outdated')
    expect(scope.diagnostics.join('\n')).toContain('takes precedence over environment home')
    expect(scope.repair?.env).toEqual({ CODEX_HOME: recorded })
    expect(scope.repair?.cwd).toBe(sandbox.home)
    expect(snapshotTree(sandbox.home)).toBe(beforeHome)
  })

  test('recorded Codex home still supplies repair data when ambient CODEX_HOME is invalid', () => {
    sandbox = createRegistrationSandbox()
    const recorded = join(sandbox.home, 'recorded-codex')
    expect(
      sandbox.run(['init', '--global', '--agent', 'codex'], {
        env: { CODEX_HOME: recorded },
      }).exitCode,
    ).toBe(0)
    replaceRevision(join(sandbox.home, '.clooks/bin/entrypoint.sh'), 0)
    const beforeHome = snapshotTree(sandbox.home)

    const result = sandbox.run(['init', '--check', '--global', '--agent', 'codex', '--json'], {
      env: { CODEX_HOME: 'relative-codex-home' },
    })

    expect(result.exitCode).toBe(0)
    const scope = parseCheck(result.stdout).data.scopes[0]!
    expect(scope.state).toBe('outdated')
    expect(scope.diagnostics.join('\n')).toContain('CODEX_HOME must be an absolute path')
    expect(scope.repair?.env).toEqual({ CODEX_HOME: recorded })
    expect(scope.repair?.cwd).toBe(sandbox.home)
    expect(snapshotTree(sandbox.home)).toBe(beforeHome)
  })

  test('--global check reports project MCP ownership at HOME as ambiguous', () => {
    sandbox = createRegistrationSandbox()
    expect(sandbox.run(['init', '--agent', 'claude-code']).exitCode).toBe(0)
    expect(sandbox.run(['init', '--global', '--agent', 'claude-code']).exitCode).toBe(0)
    sandbox.writeHomeFile('.mcp.json', sandbox.readFile('.mcp.json'))
    const beforeProject = snapshotTree(sandbox.dir)
    const beforeHome = snapshotTree(sandbox.home)

    const result = sandbox.run(['init', '--check', '--global', '--json'])

    expect(result.exitCode).toBe(0)
    const scopes = parseCheck(result.stdout).data.scopes
    expect(scopes).toHaveLength(1)
    expect(scopes[0]?.scope).toBe('global')
    expect(scopes[0]?.state).toBe('uninspectable')
    expect(scopes[0]?.repair).toBeNull()
    expect(scopes[0]?.diagnostics.join('\n')).toContain(
      'Project-specific Claude MCP registration exists at the installation home.',
    )
    expect(snapshotTree(sandbox.dir)).toBe(beforeProject)
    expect(snapshotTree(sandbox.home)).toBe(beforeHome)
  })

  test('--global check detects a Codex project at HOME beside a custom global Codex home', () => {
    sandbox = createRegistrationSandbox()
    expect(sandbox.run(['init', '--agent', 'codex']).exitCode).toBe(0)
    const projectHooks = sandbox.readFile('.codex/hooks.json')
    const projectServer = sandbox.readFile('.codex/config.toml')
    const projectId = sandbox.readFile('.clooks/bin/codex-project-id')
    const customGlobal = join(sandbox.home, 'custom-global-codex')
    expect(
      sandbox.run(['init', '--global', '--agent', 'codex'], {
        env: { CODEX_HOME: customGlobal },
      }).exitCode,
    ).toBe(0)
    sandbox.writeHomeFile('.codex/hooks.json', projectHooks)
    sandbox.writeHomeFile('.codex/config.toml', projectServer)
    sandbox.writeHomeFile('.clooks/bin/codex-project-id', projectId)
    const beforeProject = snapshotTree(sandbox.dir)
    const beforeHome = snapshotTree(sandbox.home)

    const result = sandbox.run(['init', '--check', '--global', '--agent', 'codex', '--json'], {
      env: { CODEX_HOME: customGlobal },
    })

    expect(result.exitCode).toBe(0)
    const scopes = parseCheck(result.stdout).data.scopes
    expect(scopes).toHaveLength(1)
    expect(scopes[0]?.scope).toBe('global')
    expect(scopes[0]?.state).toBe('uninspectable')
    expect(scopes[0]?.repair).toBeNull()
    expect(scopes[0]?.diagnostics.join('\n')).toContain(
      'Project-specific Codex hook registration exists at the installation home.',
    )
    expect(snapshotTree(sandbox.dir)).toBe(beforeProject)
    expect(snapshotTree(sandbox.home)).toBe(beforeHome)
  })

  const guardCases: Array<{
    name: string
    artifact?: 'launcher' | 'advisory'
    mutate: (path: string, scope: 'project' | 'global') => void
    error: (scope: 'project' | 'global') => string
  }> = [
    {
      name: 'future revision',
      mutate: (path) => replaceRevision(path, 2),
      error: () => 'future launcher revision 2',
    },
    {
      name: 'unmet runtime floor',
      mutate: (path) => replaceMinimumRuntime(path, '0.4.0'),
      error: () => 'requires Clooks 0.4.0 or newer',
    },
    {
      name: 'malformed metadata',
      mutate: (path) =>
        replaceLauncherText(
          path,
          '# clooks launcher revision: 1',
          '# clooks launcher revision: 01',
        ),
      error: () => 'contains malformed launcher metadata',
    },
    {
      name: 'wrong scope',
      mutate: (path, scope) =>
        replaceLauncherText(
          path,
          `# clooks entrypoint: ${scope}`,
          `# clooks entrypoint: ${scope === 'project' ? 'global' : 'project'}`,
        ),
      error: (scope) =>
        `is a managed ${scope === 'project' ? 'global' : 'project'} launcher, not a managed ${scope} launcher`,
    },
    {
      name: 'advisory unmet runtime floor',
      artifact: 'advisory',
      mutate: (path) => replaceMinimumRuntime(path, '0.4.0'),
      error: () => 'requires Clooks 0.4.0 or newer',
    },
    {
      name: 'advisory malformed metadata',
      artifact: 'advisory',
      mutate: (path) =>
        replaceLauncherText(
          path,
          "CLOOKS_REQUIRED_RUNTIME='0.3.0'",
          "CLOOKS_REQUIRED_RUNTIME='not-semver'",
        ),
      error: () => 'contains malformed advisory metadata',
    },
    {
      name: 'advisory wrong scope',
      artifact: 'advisory',
      mutate: (path, scope) =>
        replaceLauncherText(
          path,
          `# clooks runtime advisory: ${scope}`,
          `# clooks runtime advisory: ${scope === 'project' ? 'global' : 'project'}`,
        ),
      error: (scope) =>
        `is a managed ${scope === 'project' ? 'global' : 'project'} advisory, not a managed ${scope} advisory`,
    },
    {
      name: 'custom advisory',
      artifact: 'advisory',
      mutate: (path, scope) =>
        replaceLauncherText(
          path,
          `# clooks runtime advisory: ${scope}`,
          '# independently managed advisory',
        ),
      error: () => 'is custom and has no managed Clooks advisory header',
    },
    {
      name: 'nonregular advisory destination',
      artifact: 'advisory',
      mutate: (path) => {
        unlinkSync(path)
        mkdirSync(path)
      },
      error: () => 'must be a regular file',
    },
  ]

  for (const scope of ['project', 'global'] as const) {
    for (const guardCase of guardCases) {
      test(`${scope} init rejects ${guardCase.name} before changing any installation file`, () => {
        sandbox = createRegistrationSandbox()
        const initArgs = ['init', ...(scope === 'global' ? ['--global'] : []), '--agent', 'all']
        expect(sandbox.run(initArgs).exitCode).toBe(0)
        const root = scope === 'global' ? sandbox.home : sandbox.dir
        guardCase.mutate(
          join(
            root,
            guardCase.artifact === 'advisory'
              ? '.clooks/bin/runtime-advisory.sh'
              : '.clooks/bin/entrypoint.sh',
          ),
          scope,
        )
        const beforeProject = snapshotTree(sandbox.dir)
        const beforeHome = snapshotTree(sandbox.home)

        const result = sandbox.run([...initArgs, '--json'])

        expect(result.exitCode).toBe(1)
        const envelope = JSON.parse(result.stdout) as { ok: false; error: string }
        expect(envelope.ok).toBe(false)
        expect(envelope.error).toContain(guardCase.error(scope))
        expect(snapshotTree(sandbox.dir)).toBe(beforeProject)
        expect(snapshotTree(sandbox.home)).toBe(beforeHome)
      })
    }
  }
})
