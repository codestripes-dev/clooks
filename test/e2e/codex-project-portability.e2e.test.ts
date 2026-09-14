import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { dirname, join } from 'path'
import { createRegistrationSandbox, registrationEnv } from './helpers/registration'
import { formatDiagnostics, type RunResult, type Sandbox } from './helpers/sandbox'

let sandbox: Sandbox
const marker = '.clooks/bin/codex-project-id'
const launcher = '.clooks/bin/entrypoint.sh'
const receipt = '.clooks/portable-receipt'
const toolCommand = 'printf "%s" "spaces and quotes"\n# intact input'
beforeEach(() => {
  sandbox = createRegistrationSandbox()
})
afterEach(() => sandbox.cleanup())

function git(root: string, args: string[]) {
  const proc = Bun.spawnSync(['git', ...args], {
    cwd: root,
    env: registrationEnv(sandbox),
    timeout: 10_000,
  })
  expect(proc.exitCode, proc.stderr.toString()).toBe(0)
}
function init(root: string, name = 'owner') {
  mkdirSync(root, { recursive: true })
  const result = sandbox.run(['init', '--agent', 'codex', '--json'], { cwd: root })
  expect(result.exitCode, formatDiagnostics(result)).toBe(0)
  writeFileSync(
    join(root, '.clooks/hooks/portable.ts'),
    `import { appendFileSync } from 'fs'
import { dirname, resolve, join } from 'path'
import { fileURLToPath } from 'url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const hook = {
  meta: { name: 'portable' },
  PreToolUse(ctx) {
    appendFileSync(join(root, ${JSON.stringify(receipt)}), JSON.stringify({ root, cwd: process.cwd(), command: ctx.toolInput.command }) + '\\n')
    return ctx.block({ reason: ${JSON.stringify(name + '-denied')} })
  }
}`,
  )
  writeFileSync(
    join(root, '.clooks/clooks.yml'),
    'version: "1.0.0"\nportable:\n  uses: ./.clooks/hooks/portable.ts\n',
  )
  return command(root)
}
function command(root: string) {
  return JSON.parse(readFileSync(join(root, '.codex/hooks.json'), 'utf8')).hooks.PreToolUse[0]
    .hooks[0].command as string
}
function run(command: string, cwd: string, env: Record<string, string> = {}): RunResult {
  const started = performance.now()
  const proc = Bun.spawnSync(['sh', '-c', command], {
    cwd,
    env: { ...registrationEnv(sandbox), ...env },
    timeout: 10_000,
    stdin: Buffer.from(
      JSON.stringify({
        hook_event_name: 'PreToolUse',
        session_id: 'portable-session',
        turn_id: 'portable-turn',
        tool_use_id: 'portable-tool',
        model: 'fixture',
        permission_mode: 'default',
        transcript_path: null,
        cwd,
        tool_name: 'Bash',
        tool_input: { command: toolCommand },
      }),
    ),
  })
  return {
    exitCode: proc.exitCode ?? 2,
    rawExitCode: proc.exitCode,
    signalCode: proc.signalCode ?? null,
    elapsedMs: performance.now() - started,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  }
}
function denied(
  command: string,
  cwd: string,
  root: string,
  name = 'owner',
  env: Record<string, string> = {},
) {
  rmSync(join(root, receipt), { force: true })
  const result = run(command, cwd, env)
  expect(result.exitCode, formatDiagnostics(result)).toBe(0)
  expect(result.stderr, formatDiagnostics(result)).toBe('')
  const output = JSON.parse(result.stdout)
  expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
  expect(output.hookSpecificOutput.permissionDecisionReason).toBe(`${name}-denied`)
  expect(readFileSync(join(root, receipt), 'utf8')).toBe(
    JSON.stringify({ root, cwd, command: toolCommand }) + '\n',
  )
}
function refused(command: string, cwd: string, message: string) {
  const result = run(command, cwd)
  expect(result.exitCode, formatDiagnostics(result)).toBe(2)
  expect(result.stdout).toBe('')
  expect(result.stderr).toContain(message)
}

describe('portable project registration through compiled Clooks', () => {
  for (const state of ['present', 'moved', 'deleted']) {
    test(`cloned command executes clone with original ${state}, including quoted paths and nested cwd`, () => {
      const original = join(sandbox.dir, "original joe's $(literal)")
      const clone = join(sandbox.dir, "clone joe's $(literal)")
      const cmd = init(original)
      git(original, ['init'])
      git(original, ['add', '.'])
      git(original, [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.invalid',
        'commit',
        '-m',
        'fixture',
      ])
      git(sandbox.dir, ['clone', '--no-hardlinks', original, clone])
      const bytes = readFileSync(join(clone, '.codex/hooks.json'), 'utf8')
      expect(command(clone)).toBe(cmd)
      expect(readFileSync(join(clone, marker))).toEqual(readFileSync(join(original, marker)))
      if (state === 'moved') renameSync(original, original + '-retained')
      if (state === 'deleted') rmSync(original, { recursive: true })
      const cwd = join(clone, 'deep/subdir')
      mkdirSync(cwd, { recursive: true })
      chmodSync(join(clone, launcher), 0o644)
      denied(cmd, cwd, clone)
      expect(existsSync(join(original, receipt))).toBe(false)
      expect(existsSync(join(original + '-retained', receipt))).toBe(false)
      expect(readFileSync(join(clone, '.codex/hooks.json'), 'utf8')).toBe(bytes)
    })
  }

  for (const withGit of [false, true]) {
    test(`distinct nested declarations execute their own pipeline, git=${withGit}`, () => {
      if (withGit) git(sandbox.dir, ['init'])
      const parent = init(sandbox.dir, 'parent')
      const childRoot = join(sandbox.dir, 'child')
      const child = init(childRoot, 'child')
      const cwd = join(childRoot, 'deep')
      mkdirSync(cwd)
      expect(parent).not.toBe(child)
      denied(parent, cwd, sandbox.dir, 'parent')
      expect(existsSync(join(childRoot, receipt))).toBe(false)
      denied(child, cwd, childRoot, 'child')
      expect(readFileSync(join(sandbox.dir, receipt), 'utf8').trim().split('\n')).toHaveLength(1)
    })
  }

  test('main checkout declaration runs linked worktree pipeline without worktree re-init', () => {
    const cmd = init(sandbox.dir)
    git(sandbox.dir, ['init'])
    git(sandbox.dir, ['add', '.'])
    git(sandbox.dir, [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '-m',
      'fixture',
    ])
    const linked = join(dirname(sandbox.dir), 'linked worktree')
    git(sandbox.dir, ['worktree', 'add', '-b', 'linked', linked])
    const cwd = join(linked, 'deep')
    mkdirSync(cwd)
    denied(cmd, cwd, linked)
    expect(existsSync(join(sandbox.dir, receipt))).toBe(false)
  })

  test('repeated ID in nested non-git copies refuses before either pipeline executes', () => {
    const cmd = init(sandbox.dir)
    const child = join(sandbox.dir, 'child')
    mkdirSync(child)
    cpSync(join(sandbox.dir, '.clooks'), join(child, '.clooks'), { recursive: true })
    refused(cmd, child, 'Ambiguous Codex project registration ID')
    expect(existsSync(join(child, receipt))).toBe(false)
    expect(existsSync(join(sandbox.dir, receipt))).toBe(false)
  })

  test('matching declaration with missing launcher never borrows a child or ancestor launcher', () => {
    const parent = init(sandbox.dir, 'parent')
    const childRoot = join(sandbox.dir, 'child')
    const child = init(childRoot, 'child')
    rmSync(join(childRoot, launcher))
    refused(child, childRoot, 'Project entrypoint missing or unreadable')
    expect(existsSync(join(sandbox.dir, receipt))).toBe(false)
    denied(parent, childRoot, sandbox.dir, 'parent')
    rmSync(join(sandbox.dir, receipt))
    cpSync(join(sandbox.dir, launcher), join(childRoot, launcher))
    rmSync(join(childRoot, marker))
    refused(child, childRoot, 'registration ID not found')
    expect(existsSync(join(sandbox.dir, receipt))).toBe(false)
    expect(existsSync(join(childRoot, receipt))).toBe(false)
  })

  test('missing own config does not discover a different ancestor pipeline', () => {
    init(sandbox.dir, 'parent')
    const childRoot = join(sandbox.dir, 'child')
    const child = init(childRoot, 'child')
    rmSync(join(childRoot, '.clooks/clooks.yml'))
    const result = run(child, childRoot)
    expect(result.exitCode, formatDiagnostics(result)).toBe(0)
    expect(result.stdout).toBe('')
    expect(existsSync(join(sandbox.dir, receipt))).toBe(false)
    expect(existsSync(join(childRoot, receipt))).toBe(false)
  })

  test('explicit relative override affects config only, resolved from original cwd', () => {
    const cmd = init(sandbox.dir)
    const selected = join(sandbox.dir, 'selected')
    init(selected, 'selected')
    rmSync(join(selected, launcher))
    const cwd = join(sandbox.dir, 'deep')
    mkdirSync(cwd)
    denied(cmd, cwd, selected, 'selected', { CLOOKS_PROJECT_ROOT: '../selected' })
    expect(existsSync(join(sandbox.dir, receipt))).toBe(false)
  })

  test('applicable Git boundary above HOME finds ownership and detects duplicates above HOME', () => {
    const base = dirname(sandbox.dir)
    const cmd = init(base)
    git(base, ['init'])
    const cwd = join(sandbox.home, 'deep')
    mkdirSync(cwd)
    denied(cmd, cwd, base)
    rmSync(join(base, receipt))
    mkdirSync(join(sandbox.home, '.clooks/bin'), { recursive: true })
    writeFileSync(join(sandbox.home, marker), readFileSync(join(base, marker)))
    refused(cmd, cwd, 'Ambiguous Codex project registration ID')
    expect(existsSync(join(base, receipt))).toBe(false)
    expect(existsSync(join(sandbox.home, receipt))).toBe(false)
  })

  test('unrelated Git repository and home boundaries never borrow ancestor identity', () => {
    const base = dirname(sandbox.dir)
    const cmd = init(base)
    git(sandbox.dir, ['init'])
    refused(cmd, sandbox.dir, 'registration ID not found')
    const homeChild = join(sandbox.home, 'child')
    mkdirSync(homeChild)
    refused(cmd, homeChild, 'registration ID not found')
    expect(existsSync(join(base, receipt))).toBe(false)
  })

  test('identity is retained by re-init and unhook; foreign hooks remain', () => {
    const cmd = init(sandbox.dir)
    const id = readFileSync(join(sandbox.dir, marker), 'utf8')
    const path = join(sandbox.dir, '.codex/hooks.json')
    const document = JSON.parse(readFileSync(path, 'utf8'))
    const foreign = { hooks: [{ type: 'command', command: cmd + ' --foreign' }] }
    document.hooks.PreToolUse.push(foreign)
    writeFileSync(path, JSON.stringify(document))
    const before = readFileSync(path, 'utf8')
    const result = sandbox.run(['init', '--agent', 'codex'])
    expect(result.exitCode, formatDiagnostics(result)).toBe(0)
    expect(readFileSync(path, 'utf8')).toBe(before)
    expect(readFileSync(join(sandbox.dir, marker), 'utf8')).toBe(id)
    denied(cmd, sandbox.dir, sandbox.dir)
    const unhook = sandbox.run([
      'uninstall',
      '--project',
      '--agent',
      'codex',
      '--unhook',
      '--force',
    ])
    expect(unhook.exitCode, formatDiagnostics(unhook)).toBe(0)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ hooks: { PreToolUse: [foreign] } })
    expect(readFileSync(join(sandbox.dir, marker), 'utf8')).toBe(id)
  })

  for (const args of [
    [],
    ['--agent', 'claude-code'],
    ['--global', '--agent', 'codex'],
    ['--global', '--agent', 'all'],
  ]) {
    test(`init ${args.join(' ')} creates no project marker`, () => {
      const result = sandbox.run(['init', ...args])
      expect(result.exitCode, formatDiagnostics(result)).toBe(0)
      expect(existsSync(join(sandbox.dir, marker))).toBe(false)
      expect(existsSync(join(sandbox.home, marker))).toBe(false)
    })
  }
})
