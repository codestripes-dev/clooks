import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  equivalentScript,
  hook as scriptsHook,
} from '../../.clooks/vendor/plugin/clooks-project-hooks/prefer-project-scripts'

const { hook: removal } = await import(
  join(import.meta.dir, '../../.clooks/vendor/plugin/clooks-core-hooks/no-rm-rf.ts')
)
const owned: string[] = []
afterEach(() => {
  for (const dir of owned.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function project(scripts: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'clooks-script-equivalence-'))
  owned.push(dir)
  mkdirSync(join(dir, '.clooks'))
  writeFileSync(join(dir, '.clooks/clooks.yml'), 'version: "1.0.0"\n')
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts }))
  writeFileSync(join(dir, 'sentinel'), 'unchanged')
  return dir
}
function context(cwd: string, command: string, provider: string | undefined) {
  return {
    cwd,
    provider,
    toolName: 'Bash',
    toolInput: { command },
    skip: (opts = {}) => ({ result: 'skip', ...opts }),
    block: (opts = {}) => ({ result: 'block', ...opts }),
    ask: (opts = {}) => ({ result: 'ask', ...opts }),
    allow: () => {
      throw new Error('Must not grant permission')
    },
  }
}

describe('literal script equivalence', () => {
  test.each([
    ['bun run lint', 'eslint src/'],
    ['npm run lint', 'eslint src/'],
    ['pnpm run lint', 'eslint src/'],
    ['yarn run lint', 'eslint src/'],
  ])('%s preserves complete arguments', (recommend, command) => {
    expect(equivalentScript(command, recommend, project({ lint: command }))).toBe(true)
  })
  test.each([
    ['ruff check src', 'ruff check src'],
    ['spacetime publish --clear-database', 'spacetime publish --clear-database'],
    ['tsc --noEmit', 'tsc --noEmit'],
    ['prettier --write "file name.ts"', "prettier --write 'file name.ts'"],
  ])('custom or quoted literal %s', (command, body) => {
    expect(equivalentScript(command, 'bun run task', project({ task: body }))).toBe(true)
  })
  test.each([
    ['prettier --check src/a.ts', 'prettier --write src/a.ts'],
    ['prettier --check src/a.ts', "prettier --check 'src/**/*.ts'"],
    ['eslint test/', 'eslint src/'],
    ['eslint --fix src/', 'eslint src/'],
    ['tsc', 'tsc --noEmit'],
    ['spacetime publish --clear-database', 'spacetime publish'],
    ['FOO=bar eslint src/', 'FOO=bar eslint src/'],
    ['eslint src/ && touch sentinel', 'eslint src/ && touch sentinel'],
    ['eslint src/\ntouch sentinel', 'eslint src/\ntouch sentinel'],
    ['eslint $(touch sentinel)', 'eslint $(touch sentinel)'],
    ['eslint *.ts', 'eslint *.ts'],
    ['eslint src/ > sentinel', 'eslint src/ > sentinel'],
    ['eslint src/ | cat', 'eslint src/ | cat'],
    ['npx eslint src/', 'eslint src/'],
    ['bun run nested', 'bun run nested'],
    ['eslint ~/target', "eslint '~/target'"],
    ["eslint '~/target'", 'eslint ~/target'],
  ])('abstains from %s versus %s', (command, body) => {
    const dir = project({ task: body })
    expect(equivalentScript(command, 'bun run task', dir)).toBe(false)
    expect(readFileSync(join(dir, 'sentinel'), 'utf8')).toBe('unchanged')
  })
  test.each(['pretask', 'posttask'])('abstains with %s lifecycle', (lifecycle) => {
    expect(
      equivalentScript(
        'eslint src/',
        'bun run task',
        project({ task: 'eslint src/', [lifecycle]: '' }),
      ),
    ).toBe(false)
  })
  test.each([
    'make lint',
    './lint.sh',
    'yarn task',
    'yarn add',
    'bun run missing',
    'bun run task -- src/',
    'FOO=x bun run task',
  ])('unverifiable recommendation %s remains nonblocking', (recommend) => {
    const dir = project({ task: 'eslint src/' })
    expect(equivalentScript('eslint src/', recommend, dir)).toBe(false)
  })
  test('yarn built-in shorthand never resolves scripts.add', () => {
    const dir = project({ add: 'eslint src/' })
    expect(equivalentScript('eslint src/', 'yarn add', dir)).toBe(false)
    expect(equivalentScript('eslint src/', 'yarn run add', dir)).toBe(true)
  })
  test('missing or malformed package data abstains', () => {
    const dir = project()
    for (const bytes of ['{', 'null', '{"scripts":[]}', '{"scripts":{"task":7}}']) {
      writeFileSync(join(dir, 'package.json'), bytes)
      expect(equivalentScript('eslint src/', 'bun run task', dir)).toBe(false)
    }
    rmSync(join(dir, 'package.json'))
    expect(equivalentScript('eslint src/', 'bun run task', dir)).toBe(false)
  })
  for (const provider of [undefined, 'claude-code', 'codex']) {
    test(`${provider}: verified block, debug-only skip, detection and escape compatibility`, async () => {
      const dir = project({ lint: 'eslint src/' })
      const config = { mappings: [{ match: 'eslint', recommend: 'bun run lint' }] }
      const invoke = (command: string, settings = config) =>
        scriptsHook.PreToolUse!(context(dir, command, provider) as never, settings)
      expect((await invoke('eslint src/')).result).toBe('block')
      for (const command of [
        'eslint test/',
        'echo "eslint"',
        'cat x | eslint src/',
        'ALLOW_DIRECT_TOOL=true eslint src/',
        'bun run lint',
      ]) {
        const result = await invoke(command)
        expect(result.result).toBe('skip')
        expect(Object.keys(result).every((key) => ['result', 'debugMessage'].includes(key))).toBe(
          true,
        )
      }
      expect((await invoke('eslint src/', { mappings: [] })).result).toBe('skip')
      expect(
        (await invoke('eslint src/', { mappings: [{ match: '(', recommend: 'bun run lint' }] }))
          .result,
      ).toBe('skip')
    })
  }
})

describe('removal classification and provider decision', () => {
  test('missing project and glob symlink retain their denial classifications', async () => {
    const dir = project()
    symlinkSync(join(dir, 'sentinel'), join(dir, 'linked'))
    for (const provider of ['claude-code', 'codex']) {
      const result = await removal.PreToolUse(context(dir, 'rm -rf link*', provider), {})
      expect(result.result).toBe('block')
      expect(result.reason).toContain('[rm-rf-expansion-error]')
    }
    rmSync(join(dir, '.clooks/clooks.yml'))
    for (const provider of ['claude-code', 'codex']) {
      const result = await removal.PreToolUse(context(dir, 'rm -rf src', provider), {})
      expect(result.result).toBe('block')
      expect(result.reason).toContain('[rm-rf-no-project-root]')
    }
  })
  for (const provider of [undefined, 'claude-code', 'codex']) {
    test.each([
      ['rm -rf src', {}, 'ask', 'rm-rf-strict'],
      ['rm -rf .', {}, 'ask', 'rm-rf-project-root'],
      ['ALLOW_DESTRUCTIVE_RM=true rm -rf src', {}, 'ask', 'rm-rf-strict'],
      ['rm -rf src', { strictMode: true }, 'block', 'rm-rf-strict'],
      ['rm -rf src', { 'rm-rf-strict': false }, 'skip', ''],
      ['rm -rf src', { extraAllowlist: ['src'] }, 'skip', ''],
      ['rm -rf dist', {}, 'skip', ''],
      ['rm file', {}, 'skip', ''],
      ['rm -rf /', {}, 'block', 'rm-rf-root'],
      ['rm -rf ~', {}, 'block', 'rm-rf-home'],
      ['rm -rf $UNKNOWN', {}, 'block', 'rm-rf-unresolved-var'],
      ['rm -rf **', {}, 'block', 'rm-rf-globstar'],
      ['rm -rf .*', {}, 'block', 'rm-rf-dangerous-glob-unbypassable'],
      ['rm -rf --no-preserve-root /', {}, 'block', 'rm-rf-no-preserve-root'],
      ['rm -rf /unlikely-outside-project', {}, 'block', 'rm-rf-escape'],
      ['rm -rf src /', {}, 'block', 'rm-rf-root'],
    ])(`${provider}: %s`, async (command, config, expected, rule) => {
      const dir = project()
      const result = await removal.PreToolUse(context(dir, command, provider), config)
      expect(result.result).toBe(expected)
      if (expected === 'ask') {
        expect(result.debugMessage).toBe(`no-rm-rf: asking on ${rule}`)
        if (rule === 'rm-rf-project-root') {
          expect(result.question).toBe('Delete this project and its contents?')
          expect(result.reason).toBe(
            `This deletes the entire project at ${dir}, including its Git metadata.`,
          )
        } else {
          expect(result.question).toBe('Delete this path and its contents?')
          expect(result.reason).toBe(`"${join(dir, 'src')}" is not on the cleanup allowlist.`)
        }
      } else if (rule) {
        expect(result.question).toBeUndefined()
        expect(result.reason).toContain(`[${rule}]`)
      }
      expect(readFileSync(join(dir, 'sentinel'), 'utf8')).toBe('unchanged')
    })
  }
})
