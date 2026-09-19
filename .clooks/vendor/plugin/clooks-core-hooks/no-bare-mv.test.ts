import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'
import * as childProcess from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dryRunSucceeds, hook, isBareMove, literalMove, rewriteToGitMv } from './no-bare-mv'
import type { PreToolUseContext } from './types'

function inspect(command: unknown, cwd = '/unused', toolName = 'Bash') {
  const ctx = {
    toolName,
    toolInput: { command },
    cwd,
    skip: (opts = {}) => ({ result: 'skip', ...opts }),
    allow: (opts = {}) => ({ result: 'allow', ...opts }),
  } as unknown as PreToolUseContext
  return hook.PreToolUse!(ctx, {}) as {
    result: string
    updatedInput?: { command: string }
    injectContext?: string
  }
}

afterEach(() => mock.restore())

const supported = [
  ['mv a b', ['a', 'b'], 'git mv a b'],
  [' \tmv\ta\tb  ', ['a', 'b'], ' \tgit mv\ta\tb  '],
  ["mv 'literal space' \"new space\"", ['literal space', 'new space'], "git mv 'literal space' \"new space\""],
  ['mv a\\ b c\\ d', ['a b', 'c d'], 'git mv a\\ b c\\ d'],
  ["mv '$(literal)' '$HOME'", ['$(literal)', '$HOME'], "git mv '$(literal)' '$HOME'"],
  ['mv "a\\$b" "c\\qd"', ['a$b', 'c\\qd'], 'git mv "a\\$b" "c\\qd"'],
  ['mv -- -a -b', ['--', '-a', '-b'], 'git mv -- -a -b'],
  ["mv a\\'b 'c'\"d\"", ["a'b", 'cd'], "git mv a\\'b 'c'\"d\""],
  ['mv a\\;b c\\|d', ['a;b', 'c|d'], 'git mv a\\;b c\\|d'],
] as const

const unsupported = [
  'mv -n a b', 'mv -f a b', 'mv -v a b', 'mv -u a b', 'mv --help',
  'mv a b -n', 'mv a b c', 'mv a', 'mv "" b',
  'FOO=1 mv a b', 'env mv a b', 'cd /tmp && mv a b',
  'mv a b; touch sentinel', 'mv a b && touch sentinel', 'mv a b | touch sentinel',
  'mv a b > sentinel', 'mv a < b', 'mv a b\necho sentinel',
  'mv $(touch sentinel) b', 'mv "$(touch sentinel)" b', 'mv `touch sentinel` b',
  'mv $HOME b', 'mv "$HOME" b', 'mv *.ts b', 'mv a? b', 'mv [ab] b',
  'mv {a,b} c', 'mv ~/a b', 'mv a b &', 'mv a b # comment',
  'mv "a b', 'mv a b\\', 'mv a\\\nb c', 'mv a\0 b',
  'git mv a b', 'mvn clean', 'echo "mv a b"', '# mv a b',
]

describe('literal inspection and mocked probes', () => {
  test.each(supported)('preserves spelling and passes exact argv: %s', (command, argv, rewrite) => {
    const probe = spyOn(childProcess, 'spawnSync').mockReturnValue({ status: 0 } as ReturnType<
      typeof childProcess.spawnSync
    >)
    expect(isBareMove(command)).toBe(true)
    expect(literalMove(command)?.argv).toEqual(argv)
    expect(rewriteToGitMv(command)).toBe(rewrite)
    expect(inspect(command).updatedInput).toEqual({ command: rewrite })
    expect(probe).toHaveBeenCalledTimes(1)
    expect(probe).toHaveBeenCalledWith('git', ['mv', '-n', ...argv], {
      cwd: '/unused', timeout: 3000, stdio: 'pipe',
    })
  })

  test.each(unsupported)('skips unsupported syntax without any probe: %s', (command) => {
    const probe = spyOn(childProcess, 'spawnSync').mockReturnValue({ status: 0 } as ReturnType<
      typeof childProcess.spawnSync
    >)
    expect(isBareMove(command)).toBe(false)
    expect(literalMove(command)).toBeNull()
    expect(rewriteToGitMv(command)).toBe(command)
    expect(inspect(command)).toEqual({ result: 'skip' })
    expect(probe).not.toHaveBeenCalled()
  })

  test('skips non-Bash and empty or missing commands without probing', () => {
    const probe = spyOn(childProcess, 'spawnSync')
    expect(inspect('mv a b', '/unused', 'Write')).toEqual({ result: 'skip' })
    for (const command of ['', '   ', undefined, null, 42])
      expect(inspect(command)).toEqual({ result: 'skip' })
    expect(probe).not.toHaveBeenCalled()
  })

  test.each([1, null])('failed or unavailable probe retains allow-with-guidance: %s', (status) => {
    spyOn(childProcess, 'spawnSync').mockReturnValue({ status } as ReturnType<
      typeof childProcess.spawnSync
    >)
    expect(dryRunSucceeds(['a', 'b'], '/unused')).toBe(false)
    const result = inspect('mv a b')
    expect(result.result).toBe('allow')
    expect(result.updatedInput).toBeUndefined()
    expect(result.injectContext).toContain('Unable to automatically use git mv')
  })
})

test('real git dry-run preserves files/index and fallback', () => {
  const root = mkdtempSync(join(tmpdir(), 'no-bare-mv-'))
  const repo = join(root, 'repo')
  const home = join(root, 'home')
  const outside = join(root, 'outside')
  const template = join(root, 'template')
  const saved = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      key.startsWith('GIT_') || key === 'HOME' || key === 'XDG_CONFIG_HOME'),
  )
  try {
    for (const dir of [repo, home, outside, template]) mkdirSync(dir)
    // The hook inherits process.env; isolate Git discovery, config and templates too.
    for (const key of Object.keys(process.env))
      if (key.startsWith('GIT_')) delete process.env[key]
    Object.assign(process.env, {
      HOME: home,
      XDG_CONFIG_HOME: home,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_COUNT: '0',
      GIT_TEMPLATE_DIR: template,
      GIT_CEILING_DIRECTORIES: root,
    })
    const git = (...args: string[]) => {
      const result = childProcess.spawnSync('git', args, {
        cwd: repo, encoding: 'utf8', timeout: 3000,
      })
      expect(result.status, result.stderr).toBe(0)
    }
    git('init')
    const sources = ['a', 'literal space', 'a;b', '-a', '$(literal)']
    for (const name of sources) writeFileSync(join(repo, name), name)
    git('add', '--', ...sources)
    writeFileSync(join(repo, 'untracked'), 'untracked')
    const index = readFileSync(join(repo, '.git', 'index'))
    expect(dryRunSucceeds(['a', 'b'], repo)).toBe(true)
    for (const command of [
      'mv a b', "mv 'literal space' 'new space'", 'mv a\\;b c',
      'mv -- -a -b', "mv '$(literal)' literal-new",
    ]) {
      const result = inspect(command, repo)
      expect(result.result).toBe('allow')
      expect(result.updatedInput).toEqual({ command: `git ${command}` })
      expect(readFileSync(join(repo, '.git', 'index'))).toEqual(index)
    }
    for (const [command, cwd] of [
      ['mv untracked new', repo], ['mv missing new', repo],
      ['mv a untracked', repo], ['mv a b', outside],
    ]) {
      const result = inspect(command!, cwd!)
      expect(result.result).toBe('allow')
      expect(result.updatedInput).toBeUndefined()
      expect(result.injectContext).toContain('Unable to automatically use git mv')
    }
    for (const name of [...sources, 'untracked'])
      expect(readFileSync(join(repo, name), 'utf8')).toBe(name)
    for (const name of ['b', 'new space', 'c', '-b', 'literal-new', 'new'])
      expect(existsSync(join(repo, name))).toBe(false)
    expect(readFileSync(join(repo, '.git', 'index'))).toEqual(index)
  } finally {
    for (const key of Object.keys(process.env))
      if (key.startsWith('GIT_') || key === 'HOME' || key === 'XDG_CONFIG_HOME')
        delete process.env[key]
    Object.assign(process.env, saved)
    rmSync(root, { recursive: true, force: true })
  }
})
