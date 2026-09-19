import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import * as childProcess from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  hook as protectedFiles,
  patchPaths,
} from '../../.clooks/vendor/plugin/clooks-project-hooks/no-edit-protected'
import {
  hook as move,
  literalMove,
  rewriteToGitMv,
} from '../../.clooks/vendor/plugin/clooks-core-hooks/no-bare-mv'
import {
  hook as confirmation,
  isAutoConfirm,
} from '../../.clooks/vendor/plugin/clooks-core-hooks/no-auto-confirm'

const patch = (...lines: string[]) => ['*** Begin Patch', ...lines, '*** End Patch'].join('\n')
function decision(result: unknown) {
  expect(result).not.toBeInstanceOf(Promise)
  return result as {
    result: string
    reason?: string
    debugMessage?: string
    injectContext?: string
    updatedInput?: Record<string, unknown>
  }
}
function context(command: string, extra = {}) {
  return {
    agent: 'codex',
    cwd: '/project',
    toolName: 'Bash',
    toolInput: { command },
    skip: (opts = {}) => ({ result: 'skip', ...opts }),
    allow: (opts = {}) => ({ result: 'allow', ...opts }),
    block: (opts = {}) => ({ result: 'block', ...opts }),
    ...extra,
  }
}
function inspect(command: string, config = protectedFiles.meta.config, extra = {}) {
  return decision(
    protectedFiles.PreToolUse!(
      context(command, { toolName: 'apply_patch', ...extra }) as never,
      config!,
    ),
  )
}
function inspectMove(command: string, cwd: string, agent: 'codex' | 'claude-code' = 'codex') {
  return decision(move.PreToolUse!(context(command, { cwd, agent }) as never, {}))
}

describe('native patch path scanner', () => {
  test('all operations and both move paths across one patch', () => {
    expect(
      patchPaths(
        patch(
          '*** Environment ID: local',
          '*** Add File: new file.ts',
          '+inert',
          '*** Delete File: old file.ts',
          '*** Update File: source file.ts',
          '*** Move to: target file.ts',
          '@@',
          '-old',
          '+new',
          '*** Update File: unchanged-name.ts',
          '@@',
          '-old',
          '+new',
        ),
      ),
    ).toEqual([
      'new file.ts',
      'old file.ts',
      'source file.ts',
      'target file.ts',
      'unchanged-name.ts',
    ])
  })
  test.each(['Add', 'Delete', 'Update'])(
    '%s protects relative, absolute and normalized nested locks',
    (kind) => {
      for (const path of [
        'bun.lock',
        'pkg/bun.lock',
        '/project/pkg/bun.lock',
        './pkg/../bun.lock',
      ]) {
        const text = patch(
          `*** ${kind} File: ${path}`,
          ...(kind === 'Add' ? ['+x'] : kind === 'Update' ? ['@@', '-x', '+y'] : []),
        )
        expect(inspect(text)).toMatchObject({
          result: 'block',
          reason: expect.stringContaining('lock-files'),
        })
        expect(inspect(text, { ...protectedFiles.meta.config, 'lock-files': false }).result).toBe(
          'skip',
        )
      }
    },
  )
  test.each([
    ['bun.lock', 'safe.ts'],
    ['safe.ts', 'nested/bun.lock'],
    ['/project/vendor/old.ts', 'safe.ts'],
    ['safe.ts', '/project/vendor/new.ts'],
  ])('checks old %s and new %s independently', (oldPath, newPath) => {
    expect(
      inspect(patch(`*** Update File: ${oldPath}`, `*** Move to: ${newPath}`, '@@', '-x', '+y'))
        .result,
    ).toBe('block')
  })
  test('every file checked even after unprotected or outside-cwd files', () => {
    expect(
      inspect(
        patch(
          '*** Delete File: /other/bun.lock',
          '*** Add File: safe.ts',
          '+x',
          '*** Delete File: nested/bun.lock',
        ),
      ).result,
    ).toBe('block')
    for (const path of [
      '/other/bun.lock',
      '../bun.lock',
      '/project-other/bun.lock',
      'bun.lock.backup',
      'vendor.ts',
    ]) {
      expect(inspect(patch(`*** Delete File: ${path}`)).result).toBe('skip')
    }
  })
  test('native wrapper, environment preamble and CRLF handling', () => {
    const text = patch('*** Environment ID: local', '*** Delete File: bun.lock')
    for (const body of [text, text.replaceAll('\n', '\r\n')]) {
      expect(inspect(` \n${body}\n `).result).toBe('block')
      for (const wrapper of ['<<EOF', "<<'EOF'", '<<"EOF"']) {
        expect(inspect(`${wrapper}\n${body}\nEOF`).result).toBe('block')
      }
    }
    // Native lenient boundary uses ends_with("EOF"), not exact equality.
    expect(inspect(`<<EOF\n${text}\nprefixEOF`).result).toBe('block')
  })
  test.each([
    '',
    '*** Delete File: bun.lock',
    'preamble\n*** Begin Patch\n*** Delete File: bun.lock\n*** End Patch',
    '*** Begin Patch\n*** Delete File: bun.lock',
    '*** Begin Patch\n*** Delete File: bun.lock\n*** End Patch\ntrailer',
    '<<PATCH\n*** Begin Patch\n*** Delete File: bun.lock\n*** End Patch\nPATCH',
    'apply_patch <<EOF\n*** Begin Patch\n*** Delete File: bun.lock\n*** End Patch\nEOF',
    patch('ordinary preamble', '*** Delete File: bun.lock'),
    patch('*** Environment ID:', '*** Delete File: bun.lock'),
    patch('*** Environment ID: a', '*** Environment ID: b', '*** Delete File: bun.lock'),
  ])('malformed/unsupported envelope abstains: %s', (text) => {
    expect(patchPaths(text)).toEqual([])
    expect(inspect(text).result).toBe('skip')
  })
  test('native state-specific header precedence, not trimmed-line regex matching', () => {
    expect(
      patchPaths(
        patch('*** Add File: safe.ts', '+*** Delete File: bun.lock', '+*** Move to: bun.lock'),
      ),
    ).toEqual(['safe.ts'])
    expect(
      patchPaths(
        patch(
          '*** Update File: safe.ts',
          '@@',
          ' *** Delete File: bun.lock',
          '+*** Add File: bun.lock',
          '-*** Update File: bun.lock',
        ),
      ),
    ).toEqual(['safe.ts'])
    expect(
      patchPaths(patch('*** Add File: safe.ts', '+x', '  *** Delete File: bun.lock  ')),
    ).toEqual(['safe.ts', 'bun.lock'])
    expect(
      patchPaths(patch('*** Delete File: safe.ts', '  *** Add File: bun.lock  ', '+x')),
    ).toEqual(['safe.ts', 'bun.lock'])
    expect(
      patchPaths(patch('*** Update File: safe.ts', '@@', '+x', '*** Delete File: bun.lock  ')),
    ).toEqual(['safe.ts', 'bun.lock'])
  })
  test('move is recognized only before update body/context, at most once', () => {
    for (const prefix of ['@@', ' context', '+new', '-old', '']) {
      expect(
        patchPaths(patch('*** Update File: safe.ts', prefix, '*** Move to: bun.lock')),
      ).toEqual(['safe.ts'])
    }
    expect(
      patchPaths(patch('*** Update File: safe.ts', ' *** Move to: bun.lock', '@@', '+x')),
    ).toEqual(['safe.ts'])
    expect(
      patchPaths(
        patch(
          '*** Update File: safe.ts',
          '*** Move to: other.ts',
          '*** Move to: bun.lock',
          '@@',
          '+x',
        ),
      ),
    ).toEqual(['safe.ts', 'other.ts'])
  })
  test('recognized paths are inspected without hunk content validation', () => {
    expect(inspect(patch('*** Update File: bun.lock')).result).toBe('block')
    expect(inspect(patch('*** Add File: safe.ts', '+inert')).result).toBe('skip')
  })
  test('preserves custom patterns, exclusions and built-in precedence', () => {
    const config = {
      ...protectedFiles.meta.config,
      'lock-files': false,
      rules: [{ pattern: '**/bun.lock', message: 'custom', except: ['safe/**'] }],
    }
    expect(inspect(patch('*** Delete File: safe/bun.lock'), config).result).toBe('skip')
    expect(inspect(patch('*** Delete File: pkg/bun.lock'), config).reason).toContain('custom')
    expect(
      inspect(patch('*** Delete File: safe/bun.lock', '*** Delete File: pkg/bun.lock'), config)
        .reason,
    ).toContain('pkg/bun.lock')
    expect(
      inspect(patch('*** Delete File: pkg/bun.lock'), { ...config, 'lock-files': true }).reason,
    ).toContain('lock-files')
    expect(
      inspect(patch('*** Delete File: generated space/file.ts'), {
        ...config,
        rules: [{ pattern: 'generated space/**', message: 'generated' }],
      }).reason,
    ).toContain('generated')
  })
  test('agent/tool/payload boundaries and legacy Claude file handling', () => {
    const text = patch('*** Delete File: bun.lock')
    for (const agent of [undefined, 'claude-code'])
      expect(inspect(text, undefined, { agent }).result).toBe('skip')
    for (const toolName of ['Bash', 'Read', 'mcp__apply_patch'])
      expect(inspect(text, undefined, { toolName }).result).toBe('skip')
    for (const toolInput of [{}, { command: 2 }, { patch: text }])
      expect(inspect(text, undefined, { toolInput }).result).toBe('skip')
    expect(inspect(text, undefined, { cwd: '' }).result).toBe('skip')
    expect(
      inspect('', undefined, {
        agent: 'claude-code',
        toolName: 'Edit',
        toolInput: { filePath: '/project/bun.lock' },
      }).result,
    ).toBe('block')
  })
})

const unsupportedMoves = [
  'mv -n a b',
  'mv --help',
  'mv --help a b',
  'mv -f a b',
  'mv -v a b',
  'mv -u a b',
  'mv a b -n',
  'mv a b c',
  'mv a',
  'mv "" b',
  'mv a b\necho sentinel',
  'mv a b; touch sentinel',
  'mv a b && touch sentinel',
  'mv a b | touch sentinel',
  'mv a b > sentinel',
  'mv a < b',
  'FOO=1 mv a b',
  'env mv a b',
  'cd /tmp && mv a b',
  'mv $(touch sentinel) b',
  'mv "$(touch sentinel)" b',
  'mv `touch sentinel` b',
  'mv $HOME b',
  'mv "$HOME" b',
  'mv ${a} b',
  'mv $((1+1)) b',
  'mv *.ts b',
  'mv a? b',
  'mv [ab] b',
  'mv {a,b} c',
  'mv ~/a b',
  'mv a b &',
  'mv a b # comment',
  'mv "a b',
  'mv a b\\',
  'mv a\\\nb c',
  'git mv a b',
  'mvn clean',
  'echo "mv a b"',
  '# mv a b',
  'mv a\0 b',
]
const directories: string[] = []
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function directory() {
  if (process.env.CLOOKS_E2E_DOCKER !== 'true')
    throw new Error('Move subprocess tests require Docker')
  const dir = mkdtempSync(join(tmpdir(), 'clooks-move-'))
  directories.push(dir)
  return dir
}
function git(cwd: string, ...args: string[]) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
  return result.stdout
}
const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')

describe('static move inspection', () => {
  test.each(unsupportedMoves)('unsupported syntax gets no rewrite: %s', (command) => {
    expect(literalMove(command)).toBeNull()
    expect(rewriteToGitMv(command)).toBe(command)
  })
  test.each([
    ['mv a b', ['a', 'b'], 'git mv a b'],
    [' \tmv\ta\tb  ', ['a', 'b'], ' \tgit mv\ta\tb  '],
    [
      'mv \'literal space\' "new space"',
      ['literal space', 'new space'],
      'git mv \'literal space\' "new space"',
    ],
    ['mv a\\ b c\\ d', ['a b', 'c d'], 'git mv a\\ b c\\ d'],
    ["mv '$(literal)' '$HOME'", ['$(literal)', '$HOME'], "git mv '$(literal)' '$HOME'"],
    ['mv "a\\$b" "c\\qd"', ['a$b', 'c\\qd'], 'git mv "a\\$b" "c\\qd"'],
    ['mv -- -a -b', ['--', '-a', '-b'], 'git mv -- -a -b'],
    ["mv a\\'b 'c'\"d\"", ["a'b", 'cd'], "git mv a\\'b 'c'\"d\""],
    ['mv a\\;b c\\|d', ['a;b', 'c|d'], 'git mv a\\;b c\\|d'],
  ])('preserves literal spelling: %s', (command, argv, rewrite) => {
    expect(literalMove(command as string)?.argv).toEqual(argv)
    expect(rewriteToGitMv(command as string)).toBe(rewrite)
  })
  test('unsupported syntax executes no git probe or shell sentinel under either agent', () => {
    const dir = directory()
    const probe = spyOn(childProcess, 'spawnSync').mockReturnValue({ status: 0 } as ReturnType<
      typeof spawnSync
    >)
    try {
      for (const agent of ['claude-code', 'codex'] as const) {
        for (const command of unsupportedMoves)
          expect(inspectMove(command, dir, agent)).toEqual({ result: 'skip' })
      }
      expect(probe).not.toHaveBeenCalled()
      expect(existsSync(join(dir, 'sentinel'))).toBe(false)
      let expectedCalls = 0
      for (const agent of ['claude-code', 'codex'] as const) {
        for (const [command, argv] of [
          ['mv a b', ['a', 'b']],
          ["mv 'literal space' 'new space'", ['literal space', 'new space']],
          ["mv '$(literal)' a\\;b", ['$(literal)', 'a;b']],
          ['mv -- -a -b', ['--', '-a', '-b']],
        ] as const) {
          expect(inspectMove(command, dir, agent).updatedInput).toEqual({
            command: `git ${command}`,
          })
          expect(probe).toHaveBeenLastCalledWith('git', ['mv', '-n', ...argv], {
            cwd: dir,
            timeout: 3000,
            stdio: 'pipe',
          })
          expectedCalls++
        }
      }
      expect(probe).toHaveBeenCalledTimes(expectedCalls)
    } finally {
      probe.mockRestore()
    }
  })
  test('real git dry-run preserves files/index and fallback for untracked/missing/non-repo', () => {
    const dir = directory()
    git(dir, 'init')
    for (const name of ['a', 'literal space', 'a;b', '-a', '$(literal)'])
      writeFileSync(join(dir, name), name)
    git(dir, 'add', '--', 'a', 'literal space', 'a;b', '-a', '$(literal)')
    writeFileSync(join(dir, 'untracked'), 'untracked')
    const index = digest(join(dir, '.git/index'))
    for (const agent of ['claude-code', 'codex'] as const) {
      for (const command of [
        'mv a b',
        "mv 'literal space' 'new space'",
        'mv a\\;b c',
        'mv -- -a -b',
        "mv '$(literal)' literal-new",
      ]) {
        expect(inspectMove(command, dir, agent).updatedInput).toEqual({
          command: `git ${command}`,
        })
        expect(digest(join(dir, '.git/index'))).toBe(index)
      }
      for (const command of ['mv untracked new', 'mv missing new', 'mv a untracked']) {
        const result = inspectMove(command, dir, agent)
        expect(result.result).toBe('allow')
        expect(result.updatedInput).toBeUndefined()
        expect(result.injectContext).toContain('Unable to automatically use git mv')
      }
    }
    for (const name of ['a', 'literal space', 'a;b', '-a', '$(literal)'])
      expect(readFileSync(join(dir, name), 'utf8')).toBe(name)
    for (const name of ['b', 'new space', 'c', '-b', 'literal-new', 'new'])
      expect(existsSync(join(dir, name))).toBe(false)
    expect(digest(join(dir, '.git/index'))).toBe(index)
    expect(inspectMove('mv a b', directory()).updatedInput).toBeUndefined()
    expect(
      decision(move.PreToolUse!(context('mv a b', { toolName: 'Write' }) as never, {})).result,
    ).toBe('skip')
  })
})

const confirmations = [
  'yes | command',
  'yes sure | command',
  '/usr/bin/yes | command',
  './yes | command',
  'echo y| command',
  'echo YES | command',
  'echo -ne yes | command',
  'echo -E y | command',
  "echo 'y' | command",
  'echo "yes" | command',
  "echo y'e's | command",
  "printf 'y\\n' | command",
  'printf "yes\\n" | command',
  "printf '%s\\n' 'yes' | command",
  "printf '%b' 'y\\n' | command",
  'printf YES | command',
  "echo ok && echo 'y' | command",
  'echo ok; echo "yes"|command || echo failed',
  "echo ok\nprintf 'y\\n' | command",
  "echo ok # comment\necho 'y' | command",
  "A='literal space' B=2 echo 'yes' | command",
  "echo 'y' \\\n| command",
  "echo 'y' |& command",
  "yes 'confirm' | command",
  'yes $WORD | command',
  'yes "$WORD" | command',
  'yes sure thing | command',
  'yes | command; echo $(date)',
  'echo "y" | command; echo `date`',
  'yes | command; cat <<EOF\ninert\nEOF',
  'yes | command; echo "unterminated',
]
const inert = [
  'yes',
  'yes sure',
  'true | command',
  'echo hello | command',
  'echo yesterday | command',
  'echo ye | command',
  'echo | command',
  'echo y > file',
  'echo y > file | command',
  'echo hello > yes | cat',
  'echo hello >> yes | cat',
  'cat < yes | cat',
  "echo 'yes | command'",
  'echo "echo y | command"',
  "echo 'a; echo y | cmd'",
  "echo 'x\nyes | cmd'",
  '# echo y | command',
  'echo ok # echo y | command',
  'echo y#comment | command',
  "echo 'y#comment' | command",
  'echo y \\| command',
  'echo y || command',
  "printf 'hello\\n' | command",
  "printf '%s' 'yesterday' | command",
  "printf '%s' 'y\\n' | command",
  'cat <<EOF\necho y | command\nEOF',
  'echo "$(echo y | command)"',
  'echo `echo y | command`',
  'echo "$Y" | command',
  "echo 'unterminated",
  'echo y | command\0',
  'YES | command',
]
describe('quoted confirmation pipelines', () => {
  test('preserves the unsupported separate echo-option-token limitation', () => {
    expect(isAutoConfirm('echo -e -n y | command')).toBe(false)
  })
  test.each(confirmations)('detects real pipeline %s', (command) => {
    expect(isAutoConfirm(command)).toBe(true)
    for (const agent of ['claude-code', 'codex']) {
      const result = decision(confirmation.PreToolUse!(context(command, { agent }) as never, {}))
      expect(result.result).toBe('block')
      expect(result.reason).toContain('non-interactive mode')
      expect(result.debugMessage).toContain(command)
    }
  })
  test.each(inert)('preserves inert or unsupported input %s', (command) => {
    expect(isAutoConfirm(command)).toBe(false)
    expect(decision(confirmation.PreToolUse!(context(command) as never, {})).result).toBe('skip')
  })
  test('non-Bash and empty inputs skip', () => {
    expect(
      decision(
        confirmation.PreToolUse!(context('yes | command', { toolName: 'Write' }) as never, {}),
      ).result,
    ).toBe('skip')
    expect(decision(confirmation.PreToolUse!(context('') as never, {})).result).toBe('skip')
  })
})
