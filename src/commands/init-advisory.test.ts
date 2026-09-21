import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lt } from 'semver'
import { LAUNCHER_REVISION, MIN_RUNTIME_VERSION } from '../installation-metadata.js'
import { renderRuntimeAdvisoryScript } from './init-advisory.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function isolatedPath(root: string) {
  const bin = join(root, 'bin')
  mkdirSync(bin)
  for (const tool of ['bash', 'cat']) symlinkSync(`/bin/${tool}`, join(bin, tool))
  return bin
}

function quietSuccess(result: ReturnType<typeof Bun.spawnSync>) {
  expect(result.exitCode).toBe(0)
  expect(result.stderr!.toString()).toBe('')
}

function run(
  installed: string,
  floor = MIN_RUNTIME_VERSION,
  env: Record<string, string> = {},
  scope: 'project' | 'global' = 'project',
) {
  const root = mkdtempSync(join(tmpdir(), 'clooks-advisory-'))
  roots.push(root)
  const bin = isolatedPath(root)
  const clooks = join(bin, 'clooks')
  writeFileSync(
    clooks,
    `#!/bin/sh
[ "$#" = 1 ] && [ "$1" = --version ] || exit 71
if IFS= read -r input; then echo input >> "$HOME/probes.log"; else echo eof >> "$HOME/probes.log"; fi
printf '%s\\n' "$FIXTURE_VERSION"
`,
  )
  chmodSync(clooks, 0o755)
  const script = join(root, 'advisory.sh')
  writeFileSync(script, renderRuntimeAdvisoryScript(scope, floor))
  chmodSync(script, 0o755)
  const result = Bun.spawnSync([script], {
    stdin: new TextEncoder().encode('{"secret":"not-output"}'),
    env: { PATH: bin, HOME: root, FIXTURE_VERSION: installed, ...env },
    timeout: 2000,
  })
  quietSuccess(result)
  if (env.SKIP_CLOOKS === 'true') expect(existsSync(join(root, 'probes.log'))).toBe(false)
  else expect(readFileSync(join(root, 'probes.log'), 'utf8')).toBe('eof\n')
  return { result, root }
}

function runScript(scriptText: string, probe?: string, globalActive = false, closedStdin = false) {
  const root = mkdtempSync(join(tmpdir(), 'clooks-advisory-direct-'))
  roots.push(root)
  const bin = isolatedPath(root)
  if (globalActive) {
    mkdirSync(join(root, '.clooks'))
    writeFileSync(join(root, '.clooks/.global-entrypoint-active'), '')
  }
  if (probe) {
    writeFileSync(join(bin, 'clooks'), probe)
    chmodSync(join(bin, 'clooks'), 0o755)
  }
  const script = join(root, 'advisory.sh')
  writeFileSync(script, scriptText)
  chmodSync(script, 0o755)
  const result = Bun.spawnSync(
    closedStdin ? ['/bin/bash', '-c', 'exec bash "$1" 0<&-', 'fixture', script] : [script],
    {
      stdin: new TextEncoder().encode('{}'),
      env: { PATH: bin, HOME: root },
      timeout: 2000,
    },
  )
  quietSuccess(result)
  return result
}

describe('renderRuntimeAdvisoryScript', () => {
  test('revision 1 pins the complete project and global advisory scripts', () => {
    expect(LAUNCHER_REVISION).toBe(1)
    expect(createHash('sha256').update(renderRuntimeAdvisoryScript('project')).digest('hex')).toBe(
      '398f33c62e5dc21339fd4487a305fb65dc8d0523d85de359e2706e23852d7f26',
    )
    expect(createHash('sha256').update(renderRuntimeAdvisoryScript('global')).digest('hex')).toBe(
      '689d5f33fa22caae697ef97b71059599f8e676928d8c79d41f8dbd8a5a06ddad',
    )
  })

  test.each(['0.3.0+build.01', '0.3.0-rc.1+build.01'])(
    'accepts canonical floor with build metadata %s',
    (floor) => {
      const result = run('0.1.0', floor).result
      expect(JSON.parse(result.stdout.toString()).systemMessage).toContain(
        `requires Clooks ${floor}`,
      )
    },
  )

  test.each([
    'v0.3.0',
    '=0.3.0',
    ' 0.3.0',
    '0.3.0\n',
    '0.3.0\r',
    '0.3.0-01',
    '00.3.0',
    '0.3.0"',
    '0.3.0\x27',
  ])('rejects noncanonical floor %p before rendering', (floor) => {
    expect(() => renderRuntimeAdvisoryScript('project', floor)).toThrow('canonical SemVer')
  })

  test('closed stdin is nonblocking and produces no drain error', () => {
    const result = runScript(
      renderRuntimeAdvisoryScript('project'),
      "#!/bin/sh\necho 'clooks 0.0.1'\n",
      false,
      true,
    )
    expect(JSON.parse(result.stdout.toString()).systemMessage).toContain('installed: 0.0.1')
  })

  test('emits scoped owned metadata and dual SessionStart output', () => {
    const { result } = run('clooks 0.2.0')
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout.toString())
    expect(output.systemMessage).toContain(`This project requires Clooks ${MIN_RUNTIME_VERSION}`)
    expect(output.systemMessage).toContain('/clooks:setup update')
    expect(output.hookSpecificOutput).toEqual({
      hookEventName: 'SessionStart',
      additionalContext: expect.stringContaining('Tell the user; do not update automatically.'),
    })
    expect(renderRuntimeAdvisoryScript('global')).toContain('# clooks runtime advisory: global')
    expect(
      JSON.parse(run('clooks 0.2.0', MIN_RUNTIME_VERSION, {}, 'global').result.stdout.toString())
        .systemMessage,
    ).toContain('This global installation requires Clooks')
  })

  test.each([
    ['0.9.9', '1.0.0'],
    ['1.0.0', '1.0.1'],
    ['1.9.9', '2.0.0'],
    ['1.0.0-alpha', '1.0.0'],
    ['1.0.0-alpha.2', '1.0.0-alpha.10'],
    ['1.0.0-2', '1.0.0-alpha'],
    ['1.0.0-alpha', '1.0.0-2'],
    ['1.0.0+old', '1.0.0+new'],
    ['2.0.0', '1.9.9'],
    ['1.0.0-alpha', '1.0.0-alpha.1'],
    ['1.0.0-alpha.1', '1.0.0-alpha'],
    ['1.0.0-beta.11', '1.0.0-rc.1'],
    ['1.0.0-alpha-a', '1.0.0-alpha-b'],
    ['1.0.0-10000000000000000000', '1.0.0-20000000000000000000'],
    ['1.0.0+build.01', '1.0.0'],
    ['1.0.0-alpha.1+build', '1.0.0-alpha.1+other'],
    ['1.0.0', '1.0.0-alpha'],
    ['10.0.0', '2.0.0'],
    ['1.10.0', '1.2.0'],
    ['1.0.10', '1.0.2'],
  ])('compares %s against %s', (installed, floor) => {
    const { result } = run(`clooks ${installed}`, floor)
    expect(result.exitCode).toBe(0)
    expect(result.stderr.toString()).toBe('')
    expect(result.stdout.toString().length > 0).toBe(lt(installed, floor))
  })

  test('uses Codex spelling and honors literal SKIP_CLOOKS=true', () => {
    expect(
      JSON.parse(run('v0.1.0', '0.2.0', { CLOOKS_AGENT: 'codex' }).result.stdout.toString())
        .systemMessage,
    ).toContain('$clooks:setup update')
    expect(run('0.1.0', '0.2.0', { SKIP_CLOOKS: 'true' }).result.stdout.toString()).toBe('')
    expect(run('0.1.0', '0.2.0', { SKIP_CLOOKS: '1' }).result.stdout.toString()).not.toBe('')
  })

  test('compares long numeric identifiers without floating-point rounding', () => {
    // node-semver rounds these two identifiers to the same Number. The Bash
    // comparator can retain SemVer ordering without arithmetic conversion.
    const { result } = run('1.0.0-99999999999999999999', '1.0.0-100000000000000000000')
    expect(JSON.parse(result.stdout.toString()).systemMessage).toContain(
      'installed: 1.0.0-99999999999999999999',
    )
  })

  test.each([
    'garbage',
    '1.0.0-01',
    'clooks 1.0.0 extra',
    '01.0.0',
    '1.0',
    '1.0.0-',
    '1.0.0+',
    '1.0.0-a..b',
    '1.0.0"',
    '0.1.0\nextra',
    '0.1.0\r',
    '1.0.0;exit 2',
  ])('is quiet for invalid probe %s', (probe) => {
    const { result } = run(probe, '2.0.0')
    expect(result.exitCode).toBe(0)
    expect(result.stdout.toString()).toBe('')
    expect(result.stderr.toString()).toBe('')
  })

  test('does not echo stdin or write files', () => {
    const { result, root } = run('clooks 9.0.0')
    expect(result.stdout.toString()).toBe('')
    expect(result.stderr.toString()).toBe('')
    expect(readdirSync(root).sort()).toEqual(['advisory.sh', 'bin', 'probes.log'])
    expect(readdirSync(join(root, 'bin')).sort()).toEqual(['bash', 'cat', 'clooks'])
  })

  test('is quiet when clooks is off PATH or its version probe fails', () => {
    const generated = renderRuntimeAdvisoryScript('project')
    const missing = runScript(generated)
    expect(missing.exitCode).toBe(0)
    expect(missing.stdout.toString()).toBe('')
    expect(missing.stderr.toString()).toBe('')

    const failed = runScript(
      generated,
      '#!/bin/sh\necho "clooks 0.0.1"\necho failure >&2\nexit 7\n',
    )
    expect(failed.exitCode).toBe(0)
    expect(failed.stdout.toString()).toBe('')
    expect(failed.stderr.toString()).toBe('')
  })

  test('generates valid Bash', () => {
    for (const scope of ['project', 'global'] as const) {
      const result = Bun.spawnSync(['bash', '-n'], {
        stdin: new TextEncoder().encode(renderRuntimeAdvisoryScript(scope)),
      })
      expect(result.exitCode).toBe(0)
      expect(result.stderr.toString()).toBe('')
    }
  })

  test.each(['true', '1'])('drains stdin before handling SKIP_CLOOKS=%s', async (skip) => {
    const root = mkdtempSync(join(tmpdir(), 'clooks-advisory-drain-'))
    roots.push(root)
    const bin = isolatedPath(root)
    const script = join(root, 'advisory.sh')
    writeFileSync(script, renderRuntimeAdvisoryScript('project'))
    const child = Bun.spawn(['/bin/bash', script], {
      env: { HOME: root, PATH: bin, SKIP_CLOOKS: skip },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 2000,
    })
    try {
      child.stdin.write('{"payload":"must be drained"}')
      await Bun.sleep(50)
      expect(child.exitCode).toBeNull()
      child.stdin.end()
      expect(await child.exited).toBe(0)
      expect(await new Response(child.stdout).text()).toBe('')
      expect(await new Response(child.stderr).text()).toBe('')
    } finally {
      child.stdin.end()
      if (child.exitCode === null) child.kill()
      await child.exited
    }
  })

  test('project advisory ignores global runtime dedup flags', () => {
    const result = runScript(
      renderRuntimeAdvisoryScript('project'),
      "#!/bin/sh\necho 'clooks 0.0.1'\n",
      true,
    )
    expect(JSON.parse(result.stdout.toString()).systemMessage).toContain(
      'This project requires Clooks',
    )
  })
})
