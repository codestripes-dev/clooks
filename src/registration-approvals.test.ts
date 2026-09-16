import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  APPROVAL_TIMEOUT_SECONDS,
  approvalCommand,
  approvalCompanion,
  isApprovalCompanion,
  registerApprovalPair,
  unpairedCommand,
} from './registration-approvals.js'
import {
  CLOOKS_ENTRYPOINT_PATH,
  isClooksHook,
  registerClooks,
  unregisterClooks,
} from './settings.js'
import {
  isCodexClooksHook,
  makeCodexProjectEntrypointCommand,
  quotePosixSingleArg,
} from './agents/codex/settings.js'
import { ENTRYPOINT_SCRIPT, GLOBAL_ENTRYPOINT_SCRIPT } from './commands/init-entrypoint.js'

let root: string
const owner = `project:${'a'.repeat(32)}`
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'clooks-paired-registration-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

for (const agent of ['claude-code', 'codex'] as const) {
  test(`${agent} re-registration upgrades both old native budgets once`, () => {
    const command =
      agent === 'codex' ? makeCodexProjectEntrypointCommand('a'.repeat(32)) : CLOOKS_ENTRYPOINT_PATH
    const owned = agent === 'codex' ? isCodexClooksHook : isClooksHook
    const unrelated = {
      matcher: 'Write',
      extension: { keep: true },
      hooks: [{ type: 'command', command: 'other-hook', timeout: 7 }],
    }
    const oldPair = {
      matcher: '*',
      hooks: [
        { type: 'command', command: approvalCommand(agent, owner, command), timeout: 330 },
        { ...approvalCompanion(agent, owner), timeout: 330 },
      ],
    }
    const updated = registerApprovalPair([unrelated, oldPair], agent, command, { owner }, owned)
    expect(updated.changed).toBe(true)
    expect(updated.existed).toBe(true)
    expect(updated.groups[0]).toBe(unrelated)
    expect(updated.groups[1]?.hooks).toEqual(
      oldPair.hooks.map((hook) => ({ ...hook, timeout: APPROVAL_TIMEOUT_SECONDS })),
    )
    const repeated = registerApprovalPair(updated.groups, agent, command, { owner }, owned)
    expect(repeated.changed).toBe(false)
    expect(repeated.groups).toBe(updated.groups)
  })

  test(`${agent} paired canonicalization removes duplicates but preserves mixed group metadata`, () => {
    const command =
      agent === 'codex' ? makeCodexProjectEntrypointCommand('a'.repeat(32)) : CLOOKS_ENTRYPOINT_PATH
    const foreign = { type: 'mcp_tool', server: 'other', tool: 'check' }
    const prompt = { type: 'prompt', prompt: 'keep' }
    const groups = [
      {
        matcher: 'Bash',
        extension: { preserve: true },
        hooks: [{ type: 'command', command }, prompt],
      },
      { hooks: [approvalCompanion(agent, owner), foreign] },
      { hooks: [approvalCompanion(agent, owner)] },
      { hooks: [] },
    ]
    const owned = agent === 'codex' ? isCodexClooksHook : isClooksHook
    const result = registerApprovalPair(groups, agent, command, { owner }, owned)
    expect(result.changed).toBe(true)
    expect(result.existed).toBe(true)
    expect(result.groups.slice(0, -1)).toEqual([
      { matcher: 'Bash', extension: { preserve: true }, hooks: [prompt] },
      { hooks: [foreign] },
      { hooks: [] },
    ])
    expect(result.groups.at(-1)?.hooks).toHaveLength(2)
    const again = registerApprovalPair(result.groups, agent, command, { owner }, owned)
    expect(again.changed).toBe(false)
    expect(again.groups).toBe(result.groups)
  })
}

test('native timeout uses the largest whole seconds below the millisecond timer ceiling', () => {
  expect(APPROVAL_TIMEOUT_SECONDS).toBe(2_147_483)
  expect(APPROVAL_TIMEOUT_SECONDS * 1000).toBeLessThanOrEqual(2_147_483_647)
  expect((APPROVAL_TIMEOUT_SECONDS + 1) * 1000).toBeGreaterThan(2_147_483_647)
})

test('quoted Claude global paired command-only remnants are recognized, repaired once, and unregistered', () => {
  const home = join(root, "home 'with quotes'")
  const settings = join(home, '.claude')
  mkdirSync(settings, { recursive: true })
  const command = join(home, '.clooks/bin/entrypoint.sh')
  const paired = approvalCommand('claude-code', 'global', quotePosixSingleArg(command))
  expect(isClooksHook({ type: 'command', command: paired }, command)).toBe(true)
  const path = join(settings, 'settings.json')
  writeFileSync(
    path,
    JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: paired }] }] } }),
  )
  registerClooks(settings, command, { owner: 'global', command: quotePosixSingleArg(command) })
  const bytes = readFileSync(path, 'utf8')
  const inode = statSync(path).ino
  expect(JSON.parse(bytes).hooks.PreToolUse).toHaveLength(1)
  expect(JSON.parse(bytes).hooks.PreToolUse[0].hooks).toHaveLength(2)
  registerClooks(settings, command, { owner: 'global', command: quotePosixSingleArg(command) })
  expect(readFileSync(path, 'utf8')).toBe(bytes)
  expect(statSync(path).ino).toBe(inode)
  unregisterClooks(settings)
  expect(JSON.parse(readFileSync(path, 'utf8')).hooks).toBeUndefined()
})

test('companion ownership is exact, not a server-name substring or a public provider alias', () => {
  const hook = approvalCompanion('claude-code', owner)
  expect(isApprovalCompanion(hook, 'claude-code')).toBe(true)
  for (const value of [
    null,
    [],
    {},
    { ...hook, server: 'clooks-extra' },
    { ...hook, input: { ...(hook.input as object), provider: 'claude' } },
    { ...hook, input: { ...(hook.input as object), session_id: 'another' } },
  ]) {
    expect(isApprovalCompanion(value, 'claude-code')).toBe(false)
  }
  expect(() => approvalCompanion('codex', 'project:bad')).toThrow('Invalid')
  expect(() => approvalCommand('codex', 'arbitrary', 'clooks')).toThrow('Invalid')
  expect(unpairedCommand(approvalCommand('codex', owner, 'clooks'), 'claude-code')).toContain(
    'CLOOKS_APPROVAL_PROTOCOL',
  )
})

for (const mode of [
  'skip',
  'dedup',
  'global',
  'legacy',
  'locator-skip',
  'failure',
  'missing',
] as const) {
  test(`generated launcher ${mode} preserves stdin and suppresses only paired PreToolUse`, () => {
    const home = join(root, 'home')
    const bin = join(root, 'bin')
    mkdirSync(join(home, '.clooks'), { recursive: true })
    mkdirSync(bin)
    const entrypoint = join(root, 'entrypoint.sh')
    writeFileSync(entrypoint, mode === 'global' ? GLOBAL_ENTRYPOINT_SCRIPT : ENTRYPOINT_SCRIPT)
    if (mode !== 'missing')
      writeFileSync(
        join(bin, 'clooks'),
        `#!/bin/sh\nprintf '%s\\n' "$CLOOKS_AGENT:$CLOOKS_APPROVAL_PROTOCOL:$CLOOKS_APPROVAL_OWNER:$CLOOKS_APPROVAL_DISPOSITION"\ncat\nexit ${mode === 'failure' ? 7 : 0}\n`,
        { mode: 0o755 },
      )
    if (mode === 'dedup' || mode === 'global')
      writeFileSync(join(home, '.clooks/.global-entrypoint-active'), '')
    const agent = mode === 'locator-skip' ? 'codex' : 'claude-code'
    const env = {
      HOME: home,
      PATH: mode === 'missing' ? bin : `${bin}:/usr/bin:/bin`,
      CLOOKS_AGENT: agent,
      ...(mode !== 'legacy'
        ? {
            CLOOKS_APPROVAL_PROTOCOL: '1',
            CLOOKS_APPROVAL_OWNER: owner,
            CLOOKS_APPROVAL_DISPOSITION: 'run',
          }
        : {}),
      ...(!['dedup', 'global'].includes(mode) ? { SKIP_CLOOKS: 'true' } : {}),
    }
    const command =
      mode === 'locator-skip'
        ? [
            'sh',
            '-c',
            approvalCommand(
              'codex',
              owner,
              makeCodexProjectEntrypointCommand('a'.repeat(32), true),
            ),
          ]
        : ['/bin/bash', entrypoint]
    const input = '{"hook_event_name":"PreToolUse","tool_input":{"command":"unchanged"}}\n'
    const result = Bun.spawnSync(command, {
      cwd: root,
      env,
      stdin: Buffer.from(input),
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 2000,
    })
    expect(result.exitCode).toBe(mode === 'failure' ? 2 : 0)
    if (mode === 'legacy' || mode === 'missing') expect(result.stdout.toString()).toBe('')
    else
      expect(result.stdout.toString()).toBe(
        `${agent}:1:${owner}:${mode === 'global' ? 'run' : 'suppressed'}\n${input}`,
      )
    if (mode === 'failure')
      expect(result.stderr.toString()).toContain('Suppression completion failed')
  })
}
