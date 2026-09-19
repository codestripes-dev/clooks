import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BaseContext as CoreContext } from '../../.clooks/vendor/plugin/clooks-core-hooks/types'
import type { BaseContext as ProjectContext } from '../../.clooks/vendor/plugin/clooks-project-hooks/types'
// Include the edited hook implementations in the project's strict TypeScript check.
import '../../.clooks/vendor/plugin/clooks-core-hooks/prefer-builtin-tools'
import '../../.clooks/vendor/plugin/clooks-core-hooks/no-pasted-placeholder'
import '../../.clooks/vendor/plugin/clooks-core-hooks/no-compound-commands'
import '../../.clooks/vendor/plugin/clooks-core-hooks/no-destructive-git'
import '../../.clooks/vendor/plugin/clooks-project-hooks/no-edit-protected'
import '../../.clooks/vendor/plugin/clooks-project-hooks/js-package-manager-guard'

const root = join(import.meta.dir, '../../.clooks/vendor/plugin')
const packs = {
  'clooks-core-hooks': [
    'prefer-builtin-tools',
    'no-pasted-placeholder',
    'no-compound-commands',
    'no-destructive-git',
    'tmux-notifications',
  ],
  'clooks-project-hooks': ['no-edit-protected', 'js-package-manager-guard'],
}

// Keep upstream regressions adjacent to the actual pack, but discover them in the default src suite.
for (const [pack, names] of Object.entries(packs)) {
  for (const name of names) await import(join(root, pack, `${name}.test.ts`))
}
const { hook: prefer } = await import(join(root, 'clooks-core-hooks/prefer-builtin-tools.ts'))
const { hook: placeholder } = await import(join(root, 'clooks-core-hooks/no-pasted-placeholder.ts'))
const { hook: compound } = await import(join(root, 'clooks-core-hooks/no-compound-commands.ts'))
const { hook: protectedFiles } = await import(
  join(root, 'clooks-project-hooks/no-edit-protected.ts')
)
const { hook: git } = await import(join(root, 'clooks-core-hooks/no-destructive-git.ts'))
const { hook: manager } = await import(
  join(root, 'clooks-project-hooks/js-package-manager-guard.ts')
)

type AgentId = CoreContext['agent'] & ProjectContext['agent']
const agents: Array<AgentId | undefined> = [undefined, 'claude-code', 'codex']
function context(agent: AgentId | undefined, extra = {}) {
  return {
    agent,
    cwd: '/project',
    toolName: 'Bash',
    toolInput: { command: 'echo ok' },
    skip: (opts = {}) => ({ result: 'skip', ...opts }),
    allow: (opts = {}) => ({ result: 'allow', ...opts }),
    block: (opts = {}) => ({ result: 'block', ...opts }),
    ...extra,
  }
}
function shell(agent: AgentId | undefined, command: string) {
  return context(agent, { toolInput: { command } })
}

describe('actual default hook portability', () => {
  test('both pack declarations match the agent-bearing generated bundle', () => {
    const generated = readFileSync(join(import.meta.dir, '../generated/clooks-types.d.ts'), 'utf8')
    expect(generated).toContain('agent:')
    for (const pack of Object.keys(packs)) {
      expect(readFileSync(join(root, pack, 'types.d.ts'), 'utf8')).toBe(generated)
    }
  })

  for (const agent of agents) {
    describe(agent ?? 'legacy missing agent', () => {
      test.each([
        'cat a',
        'head a',
        'tail a',
        'grep x a',
        'rg x a',
        'egrep x a',
        'fgrep x a',
        'find .',
        'ls',
      ])('read/search: %s', (command) => {
        expect(prefer.PreToolUse(shell(agent, command), prefer.meta.config).result).toBe(
          agent === 'codex' ? 'skip' : 'block',
        )
      })
      test.each([
        ['sed-inplace', "sed -i 's/a/b/' a"],
        ['echo-redirect', 'echo x > a'],
        ['sleep', 'sleep 1'],
      ])('retains %s with appropriate guidance and disable', (rule, command) => {
        const result = prefer.PreToolUse(shell(agent, command), prefer.meta.config)
        expect(result.result).toBe('block')
        expect(result.reason).toContain(
          agent === 'codex'
            ? rule === 'sleep'
              ? 'available process tools'
              : 'apply_patch'
            : rule === 'sleep'
              ? 'run_in_background'
              : 'tool',
        )
        if (agent === 'codex')
          expect(result.reason).not.toMatch(/Read|Glob|Grep|Edit tool|Write tool|run_in_background/)
        expect(
          prefer.PreToolUse(shell(agent, command), { ...prefer.meta.config, [rule]: false }).result,
        ).toBe('skip')
        expect(
          prefer.PreToolUse(
            shell(agent, `ALLOW_BUILTIN_COMMAND=true ${command}`),
            prefer.meta.config,
          ).result,
        ).toBe('skip')
      })
      test('additional rules survive agent skips, disabled defaults, and escape prefixes', () => {
        const config = {
          ...Object.fromEntries(Object.keys(prefer.meta.config).map((key) => [key, false])),
          additionalRules: [{ match: '\\bcat\\b', message: 'custom cat rule' }],
        }
        for (const command of ['cat a', 'ALLOW_BUILTIN_COMMAND=true cat a']) {
          expect(prefer.PreToolUse(shell(agent, command), config)).toMatchObject({
            result: 'block',
            reason: 'custom cat rule',
          })
        }
      })
      test('announcement reflects effective built-in rules and disabled rules', () => {
        const config = { ...prefer.meta.config, sleep: false }
        const result = prefer.SessionStart(context(agent), config)
        expect(result.result).toBe('skip')
        expect(result.injectContext).not.toContain('sleep')
        if (agent === 'codex') {
          expect(result.injectContext).toContain('apply_patch')
          expect(result.injectContext).toContain('sed -i')
          expect(result.injectContext).not.toMatch(/Read|Glob|Grep|run_in_background/)
        } else expect(result.injectContext).toContain('Read, Glob, Grep, Edit, Write')
        expect(
          prefer.SessionStart(
            context(agent),
            Object.fromEntries(Object.keys(prefer.meta.config).map((key) => [key, false])),
          ),
        ).toEqual({ result: 'skip' })
      })
      test('paste placeholder formats block on every agent, preserving exact notification skip', () => {
        for (const prompt of [
          '[Pasted text #1 +10 lines]',
          'explain [Pasted text #2 +1 line]',
          '[Pasted Content 123 chars]',
          'explain [Pasted Content 123 chars] #2',
          '[Pasted text #1 +10 lines] [Pasted text #1 +10 lines]',
          '[Pasted Content 123 chars] [Pasted Content 123 chars] #2',
          '[Pasted text #1 +10 lines] [Pasted Content 123 chars]',
        ]) {
          expect(placeholder.UserPromptSubmit(context(agent, { prompt })).result).toBe('block')
          expect(
            placeholder.UserPromptSubmit(
              context(agent, { prompt: `<task-notification>${prompt}</task-notification>` }),
            ).result,
          ).toBe('skip')
          expect(
            placeholder.UserPromptSubmit(
              context(agent, { prompt: ` <task-notification>${prompt}` }),
            ).result,
          ).toBe('block')
        }
        for (const prompt of [
          '',
          'ordinary prompt',
          '[Pasted text #1 10 lines]',
          '[Pasted Content 123 char]',
          '[Pasted content 123 chars]',
          'Pasted Content 123 chars',
          '[Pasted Content abc chars]',
        ]) {
          expect(placeholder.UserPromptSubmit(context(agent, { prompt })).result).toBe('skip')
        }
      })
      test('compound cd exception requires &&; escape and agent guidance remain', () => {
        for (const command of [
          'echo a && echo b',
          'echo a || echo b',
          'echo a; echo b',
          'cd /tmp ; echo a',
          'cd /tmp;echo a',
          'cd /tmp;true && echo done',
          'cd /tmp&&true && echo done',
          'cd "/path with spaces"; echo a',
        ]) {
          const result = compound.PreToolUse(shell(agent, command))
          expect(result.result).toBe('block')
          expect(result.reason).toContain(
            agent === 'codex' ? 'individual shell tool calls' : 'individual Bash calls',
          )
        }
        for (const command of [
          'echo a',
          'cd /tmp && echo a',
          'cd "/path with spaces" && echo a | sort',
          'cd "/path;literal" && echo a',
          'ALLOW_COMPOUND=true cd /tmp; echo a',
          'ALLOW_COMPOUND=true echo a && echo b',
          'echo "a && b"',
        ]) {
          expect(compound.PreToolUse(shell(agent, command)).result).toBe('allow')
        }
        const announcement = compound.SessionStart(context(agent)).injectContext
        expect(announcement).toStartWith('The no-compound-commands')
        expect(announcement).toContain(agent === 'codex' ? 'Shell tools' : 'The Bash tool')
        if (agent === 'codex') expect(announcement).not.toMatch(/Claude|Bash|Read|Glob|Grep/)
      })
      test('all existing lock defaults cover root and nested paths, without widening custom patterns', () => {
        const config = protectedFiles.meta.config
        for (const name of [
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
        ]) {
          for (const prefix of ['', 'packages/widget/']) {
            for (const toolName of ['Write', 'Edit', 'MultiEdit']) {
              const ctx = context(agent, {
                toolName,
                toolInput: { filePath: `/project/${prefix}${name}` },
              })
              expect(protectedFiles.PreToolUse(ctx, config).result).toBe('block')
              expect(
                protectedFiles.PreToolUse(ctx, { ...config, 'lock-files': false }).result,
              ).toBe('skip')
            }
          }
        }
        const custom = {
          ...config,
          'lock-files': false,
          rules: [{ pattern: 'bun.lock', message: 'root only' }],
        }
        for (const [filePath, result] of [
          ['/project/bun.lock', 'block'],
          ['/project/pkg/bun.lock', 'skip'],
          ['/other/bun.lock', 'skip'],
        ]) {
          expect(
            protectedFiles.PreToolUse(
              context(agent, { toolName: 'Write', toolInput: { filePath } }),
              custom,
            ).result,
          ).toBe(result)
        }
        for (const name of [
          'bun.lock.backup',
          'notbun.lock',
          'yarn.lock.old',
          'package-lock.json.txt',
        ]) {
          expect(
            protectedFiles.PreToolUse(
              context(agent, {
                toolName: 'Edit',
                toolInput: { filePath: `/project/pkg/${name}` },
              }),
              config,
            ).result,
          ).toBe('skip')
        }
        const excluded = {
          ...config,
          'lock-files': false,
          rules: [{ pattern: '**/bun.lock', message: 'custom lock', except: ['safe/**'] }],
        }
        expect(
          protectedFiles.PreToolUse(
            context(agent, {
              toolName: 'Edit',
              toolInput: { filePath: '/project/safe/bun.lock' },
            }),
            excluded,
          ).result,
        ).toBe('skip')
        expect(
          protectedFiles.PreToolUse(
            context(agent, {
              toolName: 'Edit',
              toolInput: { filePath: '/project/pkg/bun.lock' },
            }),
            excluded,
          ).reason,
        ).toContain('custom lock')
      })
      test('git and manager guards retain decisions with both agents', () => {
        for (const [command, result] of [
          ['git reset --hard', 'block'],
          ['git status', 'skip'],
          ['ALLOW_DESTRUCTIVE_GIT=true git reset --hard', 'skip'],
          ['ALLOW_DESTRUCTIVE_GIT=true git add .', 'block'],
        ] as const) {
          expect(git.PreToolUse(shell(agent, command), git.meta.config).result).toBe(result)
        }
        for (const [command, result] of [
          ['npm install', 'block'],
          ['bun install', 'skip'],
          ['bunx prettier', 'skip'],
        ] as const) {
          expect(manager.PreToolUse(shell(agent, command), { allowed: ['bun'] }).result).toBe(
            result,
          )
        }
      })
    })
  }
})
