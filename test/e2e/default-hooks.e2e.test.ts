import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createSandbox, formatDiagnostics, type Sandbox } from './helpers/sandbox'

const packs: Record<string, string> = {
  'prefer-builtin-tools': 'clooks-core-hooks',
  'no-pasted-placeholder': 'clooks-core-hooks',
  'no-compound-commands': 'clooks-core-hooks',
  'no-destructive-git': 'clooks-core-hooks',
  'no-bare-mv': 'clooks-core-hooks',
  'no-auto-confirm': 'clooks-core-hooks',
  'no-edit-protected': 'clooks-project-hooks',
  'js-package-manager-guard': 'clooks-project-hooks',
  'no-rm-rf': 'clooks-core-hooks',
  'prefer-project-scripts': 'clooks-project-hooks',
  'tmux-notifications': 'clooks-core-hooks',
}
const originals: Record<string, string> = {
  'no-destructive-git': '4278f695615bb43e9516cf02a948a07dd6805d98dd9f1849c765fbbdc5f85ff8',
  'js-package-manager-guard': '7482fb75d6ba43f0675d102238d9a61b34c812f354de0fdc0abceb53c4805268',
}
const root = join(import.meta.dir, '../../.clooks/vendor/plugin')
const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')
type Provider = 'claude-code' | 'codex'
let sandbox: Sandbox
let sequence = 0
afterEach(() => sandbox?.cleanup())

function configure(entries: Record<string, { config?: unknown; enabled?: boolean }>) {
  const config: Record<string, unknown> = { version: '1.0.0' }
  for (const [name, options] of Object.entries(entries)) {
    const relative = `.clooks/vendor/plugin/${packs[name]}/${name}.ts`
    const source = readFileSync(join(root, packs[name]!, `${name}.ts`), 'utf8')
    sandbox.writeFile(relative, source)
    expect(digest(sandbox.readFile(relative))).toBe(digest(source))
    if (originals[name]) expect(digest(source)).toBe(originals[name])
    config[name] = { uses: `./${relative}`, ...options }
  }
  sandbox.writeConfig(JSON.stringify(config))
}

// Wire replay through the compiled engine. No tested command is dispatched.
function run(
  provider: Provider,
  event: string,
  fields: Record<string, unknown>,
  decisions: Record<string, string>,
  extraEnv: Record<string, string> = {},
) {
  const session = `default-hooks-${++sequence}`
  const result = sandbox.run([], {
    stdin: JSON.stringify({
      hook_event_name: event,
      session_id: session,
      turn_id: `turn-${sequence}`,
      cwd: sandbox.dir,
      transcript_path: '/tmp/default-hooks.jsonl',
      model: 'fixture',
      permission_mode: 'default',
      tool_use_id: `call-${sequence}`,
      ...fields,
    }),
    env: { CLOOKS_AGENT: provider, CODEX_HOME: join(sandbox.home, '.codex'), ...extraEnv },
    timeout: 10_000,
  })
  expect(result.rawExitCode, formatDiagnostics(result)).toBe(0)
  expect(result.signalCode).toBeNull()
  expect(result.stderr, formatDiagnostics(result)).toBe('')
  if (Object.keys(decisions).length > 0) {
    const path = join(
      sandbox.home,
      '.clooks/turn-state',
      ...(provider === 'codex' ? ['codex'] : []),
      `${digest(session).slice(0, 16)}.json`,
    )
    expect(existsSync(path), formatDiagnostics(result)).toBe(true)
    const state = JSON.parse(readFileSync(path, 'utf8')) as {
      scopes: Record<string, Record<string, Array<{ event: string; decision: string }>>>
    }
    for (const [name, decision] of Object.entries(decisions)) {
      const records = Object.values(state.scopes).flatMap((scope) => scope[name] ?? [])
      expect(records).toContainEqual(expect.objectContaining({ event, decision }))
    }
  }
  return result.stdout ? JSON.parse(result.stdout) : null
}

function shell(
  provider: Provider,
  command: string,
  decisions: Record<string, string>,
  extraEnv: Record<string, string> = {},
) {
  return run(
    provider,
    'PreToolUse',
    {
      tool_name: provider === 'codex' ? 'exec_command' : 'Bash',
      tool_input: { command },
    },
    decisions,
    extraEnv,
  )
}
function denied(output: ReturnType<typeof run>, reason: string) {
  expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
  expect(output.hookSpecificOutput.permissionDecisionReason).toContain(reason)
  expect(JSON.stringify(output)).not.toMatch(/capability|failed|errored|unsupported result/)
}
function permitted(output: ReturnType<typeof run>, provider: Provider, allow = false) {
  if (provider === 'codex' || !allow) expect(output).toBeNull()
  else expect(output.hookSpecificOutput.permissionDecision).toBe('allow')
}

describe('actual default packs through the compiled binary', () => {
  const file = (relative: string, decision: string) =>
    run(
      'claude-code',
      'PreToolUse',
      {
        tool_name: 'Write',
        tool_input: { file_path: join(sandbox.dir, relative), content: 'inert' },
      },
      { 'no-edit-protected': decision },
    )
  test.each([
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'bun.lock',
    'bun.lockb',
    'Gemfile.lock',
    'poetry.lock',
    'Pipfile.lock',
    'composer.lock',
    'Cargo.lock',
    'go.sum',
    'flake.lock',
    'pubspec.lock',
  ])('Claude Write: %s root/nested protection and near misses', (name) => {
    sandbox = createSandbox()
    configure({ 'no-edit-protected': {} })
    for (const prefix of ['', 'packages/widget/'])
      denied(file(prefix + name, 'block'), 'lock-files')
    permitted(file(`packages/${name}.backup`, 'skip'), 'claude-code')
  })
  test('Claude Write: disabled defaults and custom exclusions', () => {
    const provider = 'claude-code'
    sandbox = createSandbox()
    configure({
      'no-edit-protected': {
        config: {
          'lock-files': false,
          rules: [{ pattern: '**/bun.lock', message: 'custom lock', except: ['safe/**'] }],
        },
      },
    })
    denied(file('pkg/bun.lock', 'block'), 'custom lock')
    permitted(file('safe/bun.lock', 'skip'), provider)
    permitted(file('pkg/yarn.lock', 'skip'), provider)
    configure({
      'no-edit-protected': {
        config: { 'lock-files': false, rules: [{ pattern: 'bun.lock', message: 'root only' }] },
      },
    })
    denied(file('bun.lock', 'block'), 'root only')
    permitted(file('pkg/bun.lock', 'skip'), provider)
  })

  for (const provider of ['claude-code', 'codex'] as const) {
    describe(provider, () => {
      test.each(['cat a', 'head a', 'tail a', 'grep x a', 'rg x a', 'find .', 'ls'])(
        'provider-specific read/search preference: %s',
        (command) => {
          sandbox = createSandbox()
          configure({ 'prefer-builtin-tools': {} })
          const output = shell(provider, command, {
            'prefer-builtin-tools': provider === 'codex' ? 'skip' : 'block',
          })
          if (provider === 'codex') permitted(output, provider)
          else denied(output, 'tool')
        },
      )
      test.each(["sed -i 's/a/b/' a", 'echo x > a', 'sleep 1'])(
        'applicable tool guidance: %s',
        (command) => {
          sandbox = createSandbox()
          configure({ 'prefer-builtin-tools': {} })
          denied(
            shell(provider, command, { 'prefer-builtin-tools': 'block' }),
            provider === 'codex'
              ? command.startsWith('sleep')
                ? 'available process tools'
                : 'apply_patch'
              : command.startsWith('sleep')
                ? "Don't sleep"
                : 'tool',
          )
        },
      )
      test('tool preference preserves explicit escape', () => {
        sandbox = createSandbox()
        configure({ 'prefer-builtin-tools': {} })
        permitted(
          shell(provider, 'ALLOW_BUILTIN_COMMAND=true sed -i s/a/b/ a', {
            'prefer-builtin-tools': 'skip',
          }),
          provider,
        )
      })
      test('additional rules survive escape and built-in disable', () => {
        sandbox = createSandbox()
        configure({
          'prefer-builtin-tools': {
            config: {
              'sed-inplace': false,
              additionalRules: [{ match: '\\bcat\\b', message: 'custom cat restriction' }],
            },
          },
        })
        denied(
          shell(provider, 'ALLOW_BUILTIN_COMMAND=true cat a', { 'prefer-builtin-tools': 'block' }),
          'custom cat restriction',
        )
        permitted(shell(provider, 'sed -i s/a/b/ a', { 'prefer-builtin-tools': 'skip' }), provider)
      })
      test('tool preference respects whole-hook disable', () => {
        sandbox = createSandbox()
        configure({ 'prefer-builtin-tools': { enabled: false } })
        permitted(shell(provider, 'echo x > a', {}), provider)
      })

      test('provider-specific announcements reflect config and preserve compound prefix customization', () => {
        sandbox = createSandbox()
        configure({
          'prefer-builtin-tools': { config: { sleep: false } },
          'no-compound-commands': {},
        })
        const output = run(
          provider,
          'SessionStart',
          { source: 'startup' },
          { 'prefer-builtin-tools': 'skip', 'no-compound-commands': 'skip' },
        )
        const message = output.hookSpecificOutput.additionalContext
        expect(message).toContain('sed -i')
        expect(message).not.toContain('sleep')
        expect(message).not.toContain('INFORMATION (no need to comment on it): The no-compound')
        if (provider === 'codex') {
          expect(message).toContain('apply_patch')
          expect(message).not.toMatch(/Read|Glob|Grep|Bash|run_in_background/)
        } else expect(message).toContain('Read, Glob, Grep, Edit, Write')
      })

      test('placeholder provider selection and task-notification compatibility', () => {
        sandbox = createSandbox()
        configure({ 'no-pasted-placeholder': {} })
        for (const prompt of [
          '[Pasted text #1 +10 lines]',
          ' <task-notification>[Pasted text #1 +10 lines]',
        ]) {
          const decision = provider === 'codex' ? 'skip' : 'block'
          const output = run(
            provider,
            'UserPromptSubmit',
            { prompt },
            { 'no-pasted-placeholder': decision },
          )
          if (provider === 'codex') expect(output).toBeNull()
          else {
            expect(output.decision).toBe('block')
            expect(output.reason).toContain('unresolved paste placeholder')
          }
        }
        for (const prompt of [
          'ordinary prompt',
          '<task-notification>[Pasted text #1 +10 lines]</task-notification>',
        ]) {
          expect(
            run(provider, 'UserPromptSubmit', { prompt }, { 'no-pasted-placeholder': 'skip' }),
          ).toBeNull()
        }
      })

      test('compound classification and escape are unchanged', () => {
        sandbox = createSandbox()
        configure({ 'no-compound-commands': {} })
        for (const command of ['echo a && echo b', 'echo a || echo b', 'echo a; echo b']) {
          denied(
            shell(provider, command, { 'no-compound-commands': 'block' }),
            provider === 'codex' ? 'individual shell tool calls' : 'individual Bash calls',
          )
        }
        for (const command of [
          'echo a',
          'cd /tmp && echo a',
          'ALLOW_COMPOUND=true echo a && echo b',
          'echo "a && b"',
        ]) {
          permitted(shell(provider, command, { 'no-compound-commands': 'allow' }), provider, true)
        }
      })

      test('unchanged git and package guards retain blocking and permissive decisions', () => {
        sandbox = createSandbox()
        configure({
          'no-destructive-git': {},
          'js-package-manager-guard': { config: { allowed: ['bun'] } },
        })
        denied(
          shell(provider, 'git reset --hard', {
            'no-destructive-git': 'block',
            'js-package-manager-guard': 'skip',
          }),
          '[reset-hard]',
        )
        denied(
          shell(provider, 'npm install', {
            'no-destructive-git': 'skip',
            'js-package-manager-guard': 'block',
          }),
          'js-package-manager-guard',
        )
        denied(
          shell(provider, 'ALLOW_DESTRUCTIVE_GIT=true git add .', {
            'no-destructive-git': 'block',
            'js-package-manager-guard': 'skip',
          }),
          '[broad-add]',
        )
        for (const command of [
          'git status',
          'ALLOW_DESTRUCTIVE_GIT=true git reset --hard',
          'bun install',
          'bunx prettier',
        ]) {
          permitted(
            shell(provider, command, {
              'no-destructive-git': 'skip',
              'js-package-manager-guard': 'skip',
            }),
            provider,
          )
        }
      })

      test('combined default hook configuration preserves independent guards and overlay disable', () => {
        sandbox = createSandbox()
        configure(
          Object.fromEntries(
            Object.keys(packs).map((name) => [
              name,
              name === 'js-package-manager-guard' ? { config: { allowed: ['bun'] } } : {},
            ]),
          ),
        )
        denied(
          shell(provider, 'echo x > a', { 'prefer-builtin-tools': 'block' }),
          provider === 'codex' ? 'apply_patch' : 'Write tool',
        )
        denied(
          shell(provider, 'git reset --hard', { 'no-destructive-git': 'block' }),
          '[reset-hard]',
        )
        denied(
          shell(provider, 'npm install', { 'js-package-manager-guard': 'block' }),
          'js-package-manager-guard',
        )
        permitted(
          shell(provider, 'bun run test', {
            'prefer-builtin-tools': 'skip',
            'no-compound-commands': 'allow',
            'no-destructive-git': 'skip',
            'js-package-manager-guard': 'skip',
            'no-edit-protected': 'skip',
          }),
          provider,
          true,
        )
        sandbox.writeLocalConfig(
          JSON.stringify({
            version: '1.0.0',
            'prefer-builtin-tools': {
              uses: './.clooks/vendor/plugin/clooks-core-hooks/prefer-builtin-tools.ts',
              enabled: false,
            },
          }),
        )
        permitted(
          shell(provider, 'echo x > a', { 'no-compound-commands': 'allow' }),
          provider,
          true,
        )
        denied(
          shell(provider, 'git reset --hard', { 'no-destructive-git': 'block' }),
          '[reset-hard]',
        )
      })
    })
  }
})

describe('actual patch paths, move inspection and confirmation', () => {
  function moveProbe() {
    sandbox = createSandbox()
    configure({ 'no-bare-mv': {} })
    sandbox.writeFile(
      'stub/git',
      '#!/bin/sh\nif [ "$1" = mv ]; then\n  printf \'%s\\0\' "$PWD" "$@" >> "$CLOOKS_TEST_MOVE_PROBE"\n  exit 0\nfi\nexec /usr/bin/git "$@"\n',
    )
    chmodSync(join(sandbox.dir, 'stub/git'), 0o755)
    return {
      PATH: join(sandbox.dir, 'stub') + ':' + process.env.PATH,
      CLOOKS_TEST_MOVE_PROBE: join(sandbox.dir, 'probes'),
    }
  }
  const patch = (...lines: string[]) => ['*** Begin Patch', ...lines, '*** End Patch'].join('\n')
  function nativePatch(command: string, decision: string) {
    return run(
      'codex',
      'PreToolUse',
      { tool_name: 'apply_patch', tool_input: { command } },
      { 'no-edit-protected': decision },
    )
  }
  test('native Add/Delete/Update/Move: every protected path denies without changing owned files', () => {
    sandbox = createSandbox()
    configure({ 'no-edit-protected': {} })
    sandbox.writeFile('bun.lock', 'lock before')
    sandbox.writeFile('pkg/bun.lock', 'nested before')
    sandbox.writeFile('safe.ts', 'safe before')
    const texts = [
      patch('*** Add File: vendor/new file.ts', '+new'),
      patch('*** Delete File: bun.lock'),
      patch('*** Update File: pkg/bun.lock', '@@', '-nested before', '+after'),
      patch(
        '*** Update File: safe.ts',
        '*** Move to: pkg/bun.lock',
        '@@',
        '-safe before',
        '+after',
      ),
      patch('*** Update File: bun.lock', '*** Move to: new.ts', '@@', '-lock before', '+after'),
      patch(
        '*** Delete File: /outside/bun.lock',
        '*** Add File: ordinary.ts',
        '+new',
        '*** Delete File: pkg/bun.lock',
      ),
      patch(`*** Delete File: ${join(sandbox.dir, 'bun.lock')}`),
      patch('*** Delete File: ./pkg/../bun.lock'),
      patch('*** Environment ID: local', '*** Delete File: bun.lock'),
      patch('*** Add File: ordinary.ts', '+new', '  *** Delete File: bun.lock  '),
      patch('*** Update File: safe.ts', '@@', '+new', '*** Delete File: bun.lock  '),
    ]
    for (const text of texts) denied(nativePatch(text, 'block'), 'no-edit-protected')
    for (const wrapper of ['<<EOF', "<<'EOF'", '<<"EOF"']) {
      denied(
        nativePatch(`${wrapper}\r\n${texts[1]!.replaceAll('\n', '\r\n')}\r\nEOF`, 'block'),
        'lock-files',
      )
    }
    expect(sandbox.readFile('bun.lock')).toBe('lock before')
    expect(sandbox.readFile('pkg/bun.lock')).toBe('nested before')
    expect(sandbox.readFile('safe.ts')).toBe('safe before')
    for (const path of ['new.ts', 'ordinary.ts', 'vendor/new file.ts'])
      expect(sandbox.fileExists(path)).toBe(false)
  })
  test('native allowed paths, inert headers, malformed envelopes and configured exclusions actually skip', () => {
    sandbox = createSandbox()
    configure({ 'no-edit-protected': {} })
    for (const text of [
      patch('*** Add File: ordinary.ts', '+new'),
      patch('*** Delete File: /outside/bun.lock'),
      patch('*** Add File: ordinary.ts', '+*** Delete File: bun.lock'),
      patch(
        '*** Update File: ordinary.ts',
        '@@',
        ' *** Delete File: bun.lock',
        '+*** Add File: bun.lock',
      ),
      '*** Delete File: bun.lock',
      'preamble\n' + patch('*** Delete File: bun.lock'),
      patch('*** Delete File: bun.lock') + '\ntrailer',
      '<<PATCH\n' + patch('*** Delete File: bun.lock') + '\nPATCH',
    ])
      permitted(nativePatch(text, 'skip'), 'codex')
    configure({
      'no-edit-protected': {
        config: {
          'lock-files': false,
          rules: [{ pattern: '**/bun.lock', message: 'custom lock', except: ['safe/**'] }],
        },
      },
    })
    permitted(nativePatch(patch('*** Delete File: safe/bun.lock'), 'skip'), 'codex')
    permitted(nativePatch(patch('*** Delete File: yarn.lock'), 'skip'), 'codex')
    denied(nativePatch(patch('*** Delete File: pkg/bun.lock'), 'block'), 'custom lock')
    denied(
      nativePatch(
        patch('*** Delete File: safe/bun.lock', '*** Delete File: pkg/bun.lock'),
        'block',
      ),
      'pkg/bun.lock',
    )
    expect(sandbox.fileExists('ordinary.ts')).toBe(false)
  })
  test('merged pack cannot mask native protected patch denial or unprotected skip', () => {
    sandbox = createSandbox()
    configure(Object.fromEntries(Object.keys(packs).map((name) => [name, {}])))
    denied(nativePatch(patch('*** Delete File: bun.lock'), 'block'), 'no-edit-protected')
    permitted(nativePatch(patch('*** Add File: ordinary.ts', '+new'), 'skip'), 'codex')
  })
  for (const provider of ['claude-code', 'codex'] as const) {
    test(`${provider}: real argv-only move dry-run leaves files/index unchanged and retains fallback`, () => {
      sandbox = createSandbox()
      configure({ 'no-bare-mv': {} })
      const git = (...args: string[]) => {
        const result = spawnSync('git', args, { cwd: sandbox.dir, encoding: 'utf8' })
        expect(result.status, result.stderr).toBe(0)
      }
      git('init')
      for (const path of ['old file.ts', '-old', 'a;b']) sandbox.writeFile(path, path)
      git('add', '--', 'old file.ts', '-old', 'a;b')
      sandbox.writeFile('untracked', 'untracked')
      const index = digest(readFileSync(join(sandbox.dir, '.git/index')))
      for (const command of ["mv 'old file.ts' 'new file.ts'", 'mv -- -old -new', 'mv a\\;b new']) {
        const output = shell(provider, command, { 'no-bare-mv': 'allow' })
        expect(output.hookSpecificOutput.permissionDecision).toBe('allow')
        expect(output.hookSpecificOutput.updatedInput).toEqual({ command: `git ${command}` })
        expect(digest(readFileSync(join(sandbox.dir, '.git/index')))).toBe(index)
      }
      for (const command of ['mv untracked new', 'mv missing new']) {
        const output = shell(provider, command, { 'no-bare-mv': 'allow' })
        expect(output.hookSpecificOutput?.updatedInput).toBeUndefined()
        expect(output.hookSpecificOutput.additionalContext).toContain(
          'Unable to automatically use git mv',
        )
      }
      for (const path of ['old file.ts', '-old', 'a;b']) expect(sandbox.readFile(path)).toBe(path)
      for (const path of ['new file.ts', '-new', 'new'])
        expect(sandbox.fileExists(path)).toBe(false)
      expect(digest(readFileSync(join(sandbox.dir, '.git/index')))).toBe(index)
    })
    test.each([
      'mv -n a b',
      'mv --help',
      'mv --help a b',
      'mv -f a b',
      'mv -v a b',
      'mv a b; touch sentinel',
      'mv a b && touch sentinel',
      'mv a b\ntouch sentinel',
      'mv $(touch sentinel) b',
      'mv "$(touch sentinel)" b',
      'mv `touch sentinel` b',
      'mv a b > sentinel',
      'mv a b | touch sentinel',
      'FOO=1 mv a b',
      'mv $HOME b',
      'mv *.ts b',
      'mv a b c',
      'mv a b # comment',
    ])(`${provider}: unsupported move has no probe, rewrite or sentinel: %s`, (command) => {
      const env = moveProbe()
      permitted(shell(provider, command, { 'no-bare-mv': 'skip' }, env), provider)
      expect(sandbox.fileExists('probes')).toBe(false)
      expect(sandbox.fileExists('sentinel')).toBe(false)
      expect(
        shell(provider, 'mv a b', { 'no-bare-mv': 'allow' }, env).hookSpecificOutput.updatedInput,
      ).toEqual({ command: 'git mv a b' })
      expect(sandbox.readFile('probes')).toBe([sandbox.dir, 'mv', '-n', 'a', 'b'].join('\0') + '\0')
    })
    test.each([
      ['mv a b', ['a', 'b']],
      ["mv 'literal space' 'new space'", ['literal space', 'new space']],
      ["mv '$(literal)' a\\;b", ['$(literal)', 'a;b']],
      ['mv -- -a -b', ['--', '-a', '-b']],
    ] as const)(`${provider}: literal move passes exact argv and cwd: %s`, (command, argv) => {
      const env = moveProbe()
      expect(
        shell(provider, command, { 'no-bare-mv': 'allow' }, env).hookSpecificOutput.updatedInput,
      ).toEqual({ command: `git ${command}` })
      expect(sandbox.readFile('probes')).toBe([sandbox.dir, 'mv', '-n', ...argv].join('\0') + '\0')
    })
    test.each([
      "echo 'y' | command",
      'echo "yes" | command',
      "printf 'y\\n' | command",
      "printf '%s\\n' 'yes' | command",
      "A='literal space' echo 'y' | command",
      "echo ok\nprintf 'y\\n' | command",
      "echo ok; echo 'y' | command",
      'yes $WORD | command',
      'yes "$ANSWER" | command',
      'yes | command; echo $(date)',
      'echo "yes" | command; echo `date`',
    ])(`${provider}: real quoted confirmation pipeline blocks: %s`, (command) => {
      sandbox = createSandbox()
      configure({ 'no-auto-confirm': {} })
      denied(shell(provider, command, { 'no-auto-confirm': 'block' }), 'non-interactive mode')
    })
    test.each([
      "echo 'yes | command'",
      'echo "echo y | command"',
      '# echo y | command',
      'echo ok # echo y | command',
      "echo 'a; echo y | cmd'",
      'echo "$(echo y | command)"',
      'cat <<EOF\necho y | command\nEOF',
      'echo hello | command',
      'echo y || command',
      'echo hello > yes | cat',
      'echo hello >> yes | cat',
      'cat < yes | cat',
    ])(`${provider}: inert or unsupported confirmation text skips: %s`, (command) => {
      sandbox = createSandbox()
      configure({ 'no-auto-confirm': {} })
      permitted(shell(provider, command, { 'no-auto-confirm': 'skip' }), provider)
      denied(
        shell(provider, "echo 'y' | command", { 'no-auto-confirm': 'block' }),
        'non-interactive mode',
      )
    })
    test(`${provider}: combined pack preserves quoted confirmation denial`, () => {
      sandbox = createSandbox()
      configure(Object.fromEntries(Object.keys(packs).map((name) => [name, {}])))
      denied(
        shell(provider, "echo 'y' | command", { 'no-auto-confirm': 'block' }),
        'non-interactive mode',
      )
    })
  }
})

describe('actual removal, script equivalence and tmux hooks', () => {
  test.each(['inline', 'registered'] as const)(
    'Codex: actual removal ask supports %s approval and rejects replay',
    (transport) => {
      sandbox = createSandbox()
      configure({ 'no-rm-rf': {} })
      sandbox.writeFile('src/owned.ts', 'unchanged')
      const env = {
        CLOOKS_AGENT: 'codex',
        CODEX_HOME: join(sandbox.home, '.codex'),
        CLOOKS_HOME_ROOT: sandbox.home,
      }
      let attempt = 0
      const invoke = (command = 'rm -rf src') => {
        const result = sandbox.run([], {
          stdin: JSON.stringify({
            hook_event_name: 'PreToolUse',
            session_id: 'actual-removal-approval',
            turn_id: `turn-${++attempt}`,
            tool_use_id: `call-${attempt}`,
            cwd: sandbox.dir,
            transcript_path: null,
            model: 'fixture',
            permission_mode: 'default',
            tool_name: 'exec_command',
            tool_input: { command },
          }),
          env,
          timeout: 10_000,
        })
        expect(result.rawExitCode, formatDiagnostics(result)).toBe(0)
        expect(result.signalCode).toBeNull()
        expect(result.stderr, formatDiagnostics(result)).toBe('')
        // This suite replays wire input; it never executes the deletion command.
        expect(sandbox.readFile('src/owned.ts')).toBe('unchanged')
        return result.stdout ? JSON.parse(result.stdout) : null
      }
      const first = invoke()
      denied(first, '[rm-rf-strict]')
      const reason = first.hookSpecificOutput.permissionDecisionReason as string
      const tokens = [...new Set(reason.match(/ca1_[0-9a-f]{64}/g) ?? [])]
      expect(tokens).toHaveLength(1)
      const token = tokens[0]!
      const pending = invoke()
      denied(pending, token)
      expect(pending.hookSpecificOutput.permissionDecisionReason).toMatch(
        /wait for explicit approval/i,
      )
      if (transport === 'registered') {
        const registration = sandbox.run(['--json', 'approve', token], { env, timeout: 10_000 })
        expect(registration.rawExitCode, formatDiagnostics(registration)).toBe(0)
        expect(registration.signalCode).toBeNull()
        expect(registration.stderr).toBe('')
        expect(JSON.parse(registration.stdout)).toMatchObject({
          ok: true,
          command: 'approve',
          data: { token },
        })
      }
      const retry = `CLOOKS_APPROVAL_TOKENS=${token} rm -rf src`
      const approved = invoke(transport === 'inline' ? retry : 'rm -rf src')
      expect(approved.hookSpecificOutput).toBeUndefined()
      expect(Object.keys(approved)).toEqual(['systemMessage'])
      expect(approved.systemMessage).toContain('native policy retained')
      expect(approved.systemMessage).toContain('[rm-rf-strict]')
      const replay = invoke(retry)
      expect(replay.hookSpecificOutput.hookEventName).toBe('PreToolUse')
      expect(replay.hookSpecificOutput.permissionDecision).toBe('deny')
      expect(replay.hookSpecificOutput.updatedInput).toBeUndefined()
      expect(replay.hookSpecificOutput.permissionDecisionReason).toContain(
        'Unknown, expired or consumed approval token',
      )
      const fresh = invoke()
      denied(fresh, '[rm-rf-strict]')
      const freshTokens = [
        ...new Set(
          (fresh.hookSpecificOutput.permissionDecisionReason as string).match(
            /ca1_[0-9a-f]{64}/g,
          ) ?? [],
        ),
      ]
      expect(freshTokens).toHaveLength(1)
      expect(freshTokens[0]).not.toBe(token)
    },
  )

  for (const provider of ['claude-code', 'codex'] as const) {
    test.each([
      ['rm -rf src', {}, 'ask', 'rm-rf-strict'],
      ['rm -rf .', {}, 'ask', 'rm-rf-project-root'],
      ['rm -rf src /', {}, 'block', 'rm-rf-root'],
      ['rm -rf src', { strictMode: true }, 'block', 'rm-rf-strict'],
      ['rm -rf src', { 'rm-rf-strict': false }, 'skip', ''],
      ['rm -rf src', { extraAllowlist: ['src'] }, 'skip', ''],
      ['rm -rf dist', {}, 'skip', ''],
      ['ALLOW_DESTRUCTIVE_RM=true rm -rf src', {}, 'ask', 'rm-rf-strict'],
    ])(`${provider}: removal %s %j`, (command, config, expected, rule) => {
      sandbox = createSandbox()
      configure({ 'no-rm-rf': { config } })
      sandbox.writeFile('src/owned.ts', 'unchanged')
      const output = shell(provider, command, { 'no-rm-rf': expected })
      if (expected === 'skip') permitted(output, provider)
      else if (expected === 'ask' && provider === 'claude-code') {
        expect(output.hookSpecificOutput.permissionDecision).toBe('ask')
        expect(output.hookSpecificOutput.permissionDecisionReason).toContain(rule)
      } else {
        denied(output, rule)
        const reason = output.hookSpecificOutput.permissionDecisionReason
        if (expected === 'ask') {
          expect(reason).toMatch(/ca1_[0-9a-f]{64}/)
          expect(reason).toContain('clooks approve ')
          expect(reason).toMatch(/wait for explicit approval/i)
          expect(reason).not.toContain('confirmation is unavailable')
        } else expect(reason).not.toMatch(/ca1_[0-9a-f]{64}/)
      }
      expect(sandbox.readFile('src/owned.ts')).toBe('unchanged')
    })

    test.each([
      ['eslint src/', 'eslint src/', {}, 'bun run task', 'block'],
      ['eslint test/', 'eslint src/', {}, 'bun run task', 'skip'],
      ['prettier --check src/a.ts', 'prettier --write src/a.ts', {}, 'bun run task', 'skip'],
      ['prettier --check src/a.ts', "prettier --check 'src/**/*.ts'", {}, 'bun run task', 'skip'],
      ['tsc --noEmit', 'tsc --noEmit', {}, 'bun run task', 'block'],
      ['tsc', 'tsc --noEmit', {}, 'bun run task', 'skip'],
      ['ruff check src', 'ruff check src', {}, 'bun run task', 'block'],
      ['spacetime publish --clear-database', 'spacetime publish', {}, 'bun run task', 'skip'],
      ['eslint src/', 'eslint src/', { pretask: 'touch sentinel' }, 'bun run task', 'skip'],
      ['eslint src/', 'eslint src/', { posttask: 'touch sentinel' }, 'bun run task', 'skip'],
      ['FOO=bar eslint src/', 'FOO=bar eslint src/', {}, 'bun run task', 'skip'],
      [
        'eslint src/ && touch sentinel',
        'eslint src/ && touch sentinel',
        {},
        'bun run task',
        'skip',
      ],
      ['eslint src/', 'eslint src/', {}, 'make lint', 'skip'],
      ['eslint src/', 'eslint src/', {}, 'yarn task', 'skip'],
      ['eslint ~/target', "eslint '~/target'", {}, 'bun run task', 'skip'],
      ["eslint '~/target'", 'eslint ~/target', {}, 'bun run task', 'skip'],
      ['ALLOW_DIRECT_TOOL=true eslint src/', 'eslint src/', {}, 'bun run task', 'skip'],
    ])(
      `${provider}: scripts %s / %s / %j / %s`,
      (command, body, lifecycle, recommend, decision) => {
        sandbox = createSandbox()
        configure({
          'prefer-project-scripts': {
            config: { mappings: [{ match: 'eslint|prettier|tsc|ruff|spacetime', recommend }] },
          },
        })
        sandbox.writeFile('package.json', JSON.stringify({ scripts: { task: body, ...lifecycle } }))
        sandbox.writeFile('src/a.ts', 'unchanged')
        const output = shell(provider, command, { 'prefer-project-scripts': decision })
        if (decision === 'block') denied(output, recommend)
        else permitted(output, provider)
        expect(sandbox.readFile('src/a.ts')).toBe('unchanged')
        expect(sandbox.fileExists('sentinel')).toBe(false)
      },
    )

    test(`${provider}: merged guards retain independent decisions`, () => {
      sandbox = createSandbox()
      configure({
        'prefer-project-scripts': {
          config: { mappings: [{ match: 'eslint', recommend: 'bun run lint' }] },
        },
        'no-rm-rf': {},
        'no-destructive-git': {},
        'js-package-manager-guard': { config: { allowed: ['bun'] } },
      })
      sandbox.writeFile('package.json', JSON.stringify({ scripts: { lint: 'eslint src/' } }))
      denied(
        shell(provider, 'eslint src/', { 'prefer-project-scripts': 'block', 'no-rm-rf': 'skip' }),
        'bun run lint',
      )
      denied(
        shell(provider, 'git reset --hard', {
          'prefer-project-scripts': 'skip',
          'no-destructive-git': 'block',
          'no-rm-rf': 'skip',
        }),
        '[reset-hard]',
      )
    })

    test.each([
      ['Stop', {}, true, true],
      ['Stop', { attentionOnStop: false }, true, false],
      ['Stop', {}, false, false],
      ['UserPromptSubmit', {}, true, false],
      ['PostToolUse', {}, true, false],
      ['SessionStart', {}, true, false],
    ])(`${provider}: tmux %s / %j / available=%s`, (event, config, available, attention) => {
      sandbox = createSandbox()
      configure({ 'tmux-notifications': { config } })
      const log = join(sandbox.dir, 'tmux-log.jsonl')
      const state = join(sandbox.dir, 'tmux-hooks.json')
      sandbox.writeFile(
        'tmux-hooks.json',
        JSON.stringify({ 'session-window-changed[12]': 'user hook' }),
      )
      sandbox.writeFile(
        'stub-bin/tmux',
        `#!/usr/bin/env bun
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
appendFileSync(process.env.TMUX_TEST_LOG, JSON.stringify(args) + '\\n')
if (args[0] === 'display-message') console.log('@7')
if (args[0] === 'set-hook') {
  const hooks = JSON.parse(readFileSync(process.env.TMUX_TEST_STATE, 'utf8'))
  hooks[args[2]] = args[3]
  writeFileSync(process.env.TMUX_TEST_STATE, JSON.stringify(hooks))
}
`,
      )
      chmodSync(join(sandbox.dir, 'stub-bin/tmux'), 0o755)
      const output = run(
        provider,
        event,
        {
          stop_hook_active: false,
          last_assistant_message: 'done',
          prompt: 'continue',
          source: 'startup',
          tool_name: provider === 'codex' ? 'exec_command' : 'Bash',
          tool_input: { command: 'echo inert' },
          tool_response: { stdout: 'inert', stderr: '', exit_code: 0 },
        },
        { 'tmux-notifications': 'skip' },
        {
          TMUX: available ? '/inert/no-socket,1,0' : '',
          TMUX_PANE: available ? '%4' : '',
          TMUX_TEST_LOG: log,
          TMUX_TEST_STATE: state,
          PATH: `${join(sandbox.dir, 'stub-bin')}:${process.env.PATH}`,
        },
      )
      if (provider === 'claude-code' && event === 'SessionStart') {
        expect(output).toEqual({
          systemMessage: expect.stringContaining('plugin is not enabled at project scope'),
        })
      } else permitted(output, provider)
      const commands: string[][] = existsSync(log)
        ? readFileSync(log, 'utf8')
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line))
        : []
      if (!available) expect(commands).toEqual([])
      if (attention) {
        expect(commands).toContainEqual([
          'set-window-option',
          '-t',
          '@7',
          'window-status-style',
          'fg=colour208',
        ])
        const install = commands.find((args) => args[0] === 'set-hook')
        expect(install?.[2]).toBe('session-window-changed[81]')
        expect(install?.[3]).toContain('set-option -wu @clooks-attention')
      } else {
        expect(commands.some((args) => args.includes('fg=colour208'))).toBe(false)
        if (available && event !== 'Stop')
          expect(commands).toContainEqual(['set-option', '-wu', '-t', '@7', '@clooks-attention'])
      }
      expect(JSON.parse(sandbox.readFile('tmux-hooks.json'))['session-window-changed[12]']).toBe(
        'user hook',
      )
    })
  }
})
