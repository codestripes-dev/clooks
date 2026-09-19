import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hook, sanitize, extractTargets } from './no-rm-rf'
import type { PreToolUseContext } from './types'

type Config = Parameters<NonNullable<typeof hook.PreToolUse>>[1]
type AgentId = 'claude-code' | 'codex' | undefined
let cwd: string

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'clooks-removal-ask-'))
  mkdirSync(join(cwd, '.clooks'))
  writeFileSync(join(cwd, '.clooks/clooks.yml'), 'version: "1.0.0"\n')
  writeFileSync(join(cwd, 'sentinel'), 'unchanged')
})
afterEach(() => rmSync(cwd, { recursive: true, force: true }))

function context(command: string, agent: AgentId, toolName = 'Bash'): PreToolUseContext {
  return {
    agent,
    cwd,
    toolName,
    toolInput: { command },
    skip: (opts = {}) => ({ result: 'skip', ...opts }),
    block: (opts = {}) => ({ result: 'block', ...opts }),
    ask: (opts = {}) => ({ result: 'ask', ...opts }),
    allow: () => {
      throw new Error('Removal hook must not grant permission')
    },
  } as PreToolUseContext
}

async function invoke(command: string, agent: AgentId, config: Config = {}) {
  const result = await hook.PreToolUse!(context(command, agent), config)
  expect(readFileSync(join(cwd, 'sentinel'), 'utf8')).toBe('unchanged')
  return result
}

describe('actual vendored removal decisions are agent independent', () => {
  const cases: Array<[string, Config, string, string]> = [
    ['rm -rf src', {}, 'ask', 'rm-rf-strict'],
    ['rm -rf .', {}, 'ask', 'rm-rf-project-root'],
    ['rm -r src', {}, 'ask', 'rm-rf-strict'],
    ['rm -R src', {}, 'ask', 'rm-rf-strict'],
    ['rm -fr src', {}, 'ask', 'rm-rf-strict'],
    ['rm --recursive src', {}, 'ask', 'rm-rf-strict'],
    ['ALLOW_DESTRUCTIVE_RM=true rm -rf src', {}, 'ask', 'rm-rf-strict'],
    ['ALLOW_DESTRUCTIVE_RM=true rm -rf .', {}, 'ask', 'rm-rf-project-root'],
    ['rm -rf src', { strictMode: true }, 'block', 'rm-rf-strict'],
    ['rm -rf .', { strictMode: true }, 'block', 'rm-rf-project-root'],
    ['ALLOW_DESTRUCTIVE_RM=true rm -rf src', { strictMode: true }, 'block', 'rm-rf-strict'],
    ['ALLOW_DESTRUCTIVE_RM=true rm -rf .', { strictMode: true }, 'block', 'rm-rf-project-root'],
    ['rm -rf src', { 'rm-rf-strict': false }, 'skip', ''],
    ['rm -rf .', { 'rm-rf-project-root': false }, 'skip', ''],
    ['rm -rf src', { extraAllowlist: ['src'] }, 'skip', ''],
    ['rm -rf dist node_modules', {}, 'skip', ''],
    ['rm file', {}, 'skip', ''],
    ['', {}, 'skip', ''],
    ['echo ok', {}, 'skip', ''],
    ['rm -rf /', {}, 'block', 'rm-rf-root'],
    ['ALLOW_DESTRUCTIVE_RM=true rm -rf /', {}, 'block', 'rm-rf-root'],
    ['rm -rf ~', {}, 'block', 'rm-rf-home'],
    ['rm -rf $UNKNOWN', {}, 'block', 'rm-rf-unresolved-var'],
    ['rm -rf **', {}, 'block', 'rm-rf-globstar'],
    ['rm -rf .*', {}, 'block', 'rm-rf-dangerous-glob-unbypassable'],
    ['rm -rf --no-preserve-root /', {}, 'block', 'rm-rf-no-preserve-root'],
    ['rm -rf /unlikely-outside-project', {}, 'block', 'rm-rf-escape'],
    ['ALLOW_DESTRUCTIVE_RM=true rm -rf /unlikely-outside-project', {}, 'skip', ''],
    ['rm -rf src /', {}, 'block', 'rm-rf-root'],
    ['rm -rf / src', {}, 'block', 'rm-rf-root'],
    ['rm -rf src; rm -rf /', {}, 'block', 'rm-rf-root'],
  ]
  test.each(cases)(
    '%s %j preserves decision and complete result',
    async (command, config, tag, rule) => {
      const legacy = await invoke(command, undefined, config)
      expect(legacy.result).toBe(tag)
      if (legacy.result === 'ask' || legacy.result === 'block') {
        expect(legacy.reason).toContain(`[${rule}]`)
        expect(legacy.debugMessage).toBe(
          `no-rm-rf: ${tag === 'ask' ? 'asking' : 'blocked'} on ${rule}`,
        )
      }
      expect(await invoke(command, 'claude-code', config)).toEqual(legacy)
      expect(await invoke(command, 'codex', config)).toEqual(legacy)
    },
  )

  test('multiple asks retain reason order and the original asking diagnostic', async () => {
    const source = await invoke('rm -rf src', 'claude-code')
    const root = await invoke('rm -rf .', 'claude-code')
    expect(source.result).toBe('ask')
    expect(root.result).toBe('ask')
    if (source.result !== 'ask' || root.result !== 'ask') throw new Error('Expected asks')
    for (const agent of [undefined, 'claude-code', 'codex'] as const) {
      expect(await invoke('rm -rf src .', agent)).toEqual({
        result: 'ask',
        reason: `${source.reason}\n\n${root.reason}`,
        debugMessage: 'no-rm-rf: asking on rm-rf-strict',
      })
    }
  })

  test('missing project and symlink glob remain explicit blocks', async () => {
    symlinkSync(join(cwd, 'sentinel'), join(cwd, 'linked'))
    for (const agent of [undefined, 'claude-code', 'codex'] as const) {
      expect(await invoke('rm -rf link*', agent)).toMatchObject({
        result: 'block',
        reason: expect.stringContaining('[rm-rf-expansion-error]'),
      })
    }
    rmSync(join(cwd, '.clooks/clooks.yml'))
    for (const agent of [undefined, 'claude-code', 'codex'] as const) {
      expect(await invoke('rm -rf src', agent)).toMatchObject({
        result: 'block',
        reason: expect.stringContaining('[rm-rf-no-project-root]'),
      })
    }
  })

  test('non-Bash tools still skip', async () => {
    for (const agent of [undefined, 'claude-code', 'codex'] as const) {
      expect(await hook.PreToolUse!(context('rm -rf src', agent, 'Read'), {})).toEqual({
        result: 'skip',
      })
    }
  })

  test('existing quoted-target parser limitations are unchanged', () => {
    expect(extractTargets(sanitize("rm -rf 'src dir'"))).toEqual([])
    expect(extractTargets(sanitize('rm -rf "src dir"'))).toEqual(['src', 'dir'])
  })
})
