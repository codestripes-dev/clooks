import { describe, test, expect, mock, spyOn, beforeEach, afterEach } from 'bun:test'
import { Command } from 'commander'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import * as fs from 'node:fs'
import * as clack from '@clack/prompts'
import os from 'os'
import * as platform from '../platform.js'
import * as registrationState from '../registration-state.js'
import { createInitCommand } from './init.js'
import { approvalCompanion } from '../registration-approvals.js'
import {
  mcpRegistrationPath,
  prepareMcpRegistration,
  hasOwnedMcpServer,
} from '../registration-mcp.js'

// Mock @clack/prompts BEFORE imports
mock.module('@clack/prompts', () => ({
  intro: mock(),
  outro: mock(),
  log: {
    success: mock(),
    info: mock(),
    warning: mock(),
    error: mock(),
  },
  confirm: mock(() => true),
  select: mock(() => 'project'),
  isCancel: mock(() => false),
  cancel: mock(),
}))

let fakeHome = ''
let homeSpy: ReturnType<typeof spyOn>

// Import after mocking
import { createUninstallCommand } from './uninstall.js'
import { registerClooks, CLOOKS_ENTRYPOINT_PATH } from '../settings.js'
import {
  CODEX_REGISTRATION_EVENTS,
  makeCodexGlobalEntrypointCommand,
  makeCodexProjectEntrypointCommand,
  registerCodexClooks,
} from '../agents/codex/settings.js'

let tempDir: string
let originalIsTTY: boolean | undefined
let exitSpy: ReturnType<typeof spyOn>
let stdoutSpy: ReturnType<typeof spyOn>
let originalEnvironment: Record<string, string | undefined>

function resetPromptMocks() {
  for (const value of Object.values(clack.log)) {
    if (typeof value === 'function' && 'mockClear' in value) {
      ;(value as ReturnType<typeof mock>).mockClear()
    }
  }
  ;(clack.confirm as ReturnType<typeof mock>).mockReset().mockImplementation(() => true)
  ;(clack.select as ReturnType<typeof mock>).mockReset().mockImplementation(() => 'project')
  ;(clack.isCancel as unknown as ReturnType<typeof mock>)
    .mockReset()
    .mockImplementation(() => false)
}

describe('paired registration removal', () => {
  for (const scope of ['project', 'global'] as const) {
    for (const agent of ['claude-code', 'codex'] as const) {
      for (const remnant of ['server', 'companion'] as const) {
        test(`${scope} ${agent} ${remnant}-only registration is detected and removed without runtime files`, async () => {
          const root = scope === 'global' ? fakeHome : tempDir
          const server = mcpRegistrationPath(root, agent, scope === 'global')
          if (remnant === 'server') prepareMcpRegistration(server, agent).commit()
          else {
            const dir = join(root, agent === 'codex' ? '.codex' : '.claude')
            mkdirSync(dir, { recursive: true })
            const path = join(dir, agent === 'codex' ? 'hooks.json' : 'settings.json')
            writeFileSync(
              path,
              JSON.stringify({
                hooks: {
                  PreToolUse: [
                    {
                      hooks: [
                        approvalCompanion(
                          agent,
                          scope === 'global' ? 'global' : `project:${'a'.repeat(32)}`,
                        ),
                      ],
                    },
                  ],
                },
              }),
            )
          }
          await createTestProgram().parseAsync(
            ['--json', 'uninstall', `--${scope}`, '--unhook', '--force'],
            { from: 'user' },
          )
          const result = JSON.parse(
            stdoutSpy.mock.calls.map((call: unknown[]) => String(call[0])).join(''),
          ).data
          expect(result.agent).toBe(agent)
          expect(result.unhooked).toBe(true)
          expect(result.deleted).toBe(false)
          expect(hasOwnedMcpServer(server, agent)).toBe(false)
        })
      }
    }
    test(`${scope} full removal preserves live approval packets and reports retained paths`, async () => {
      const root = scope === 'global' ? fakeHome : tempDir
      const live = join(root, '.clooks/.cache/approvals-live')
      mkdirSync(join(live, 'v1/inflight'), { recursive: true })
      writeFileSync(join(live, 'v1/inflight/command.json'), 'active packet')
      writeFileSync(join(root, '.clooks/custom.ts'), 'custom hook')
      await createTestProgram().parseAsync(
        ['--json', 'uninstall', `--${scope}`, '--full', '--force', '--agent', 'all'],
        { from: 'user' },
      )
      const result = JSON.parse(
        stdoutSpy.mock.calls.map((call: unknown[]) => String(call[0])).join(''),
      ).data
      expect(result.deleted).toBe(false)
      expect(result.retainedPaths).toEqual([live])
      expect(readFileSync(join(live, 'v1/inflight/command.json'), 'utf8')).toBe('active packet')
      expect(existsSync(join(root, '.clooks/custom.ts'))).toBe(false)
    })
    test(`${scope} full removal refuses a runtime symlink before removing target registration state`, async () => {
      const root = scope === 'global' ? fakeHome : tempDir
      const outside = join(tempDir, 'outside')
      mkdirSync(outside)
      writeFileSync(join(outside, 'sentinel'), 'untouched')
      fs.symlinkSync(outside, join(root, '.clooks'))
      setupProject(root)
      setupCodexProject(root)
      fs.chmodSync(join(outside, 'bin/entrypoint.sh'), 0o755)
      writeFileSync(join(outside, '.global-entrypoint-active'), '')
      registrationState.trackCodexHome(root, join(root, '.codex'))
      registrationState.publishCodexReceipt(root, join(root, '.codex'))
      const paths = [
        '.global-entrypoint-active',
        '.global-entrypoint-active.codex',
        '.codex-registration-home',
      ].map((name) => join(outside, name))
      paths.push(join(root, '.claude/settings.json'), join(root, '.codex/hooks.json'))
      const before = paths.map((path) => readFileSync(path))
      await expect(
        createTestProgram().parseAsync(
          ['--json', 'uninstall', `--${scope}`, '--full', '--force', '--agent', 'all'],
          { from: 'user' },
        ),
      ).rejects.toThrow('process.exit called')
      expect(fs.lstatSync(join(root, '.clooks')).isSymbolicLink()).toBe(true)
      paths.forEach((path, index) => expect(readFileSync(path)).toEqual(before[index]!))
      expect(readFileSync(join(outside, 'sentinel'), 'utf8')).toBe('untouched')
      expect(stdoutSpy.mock.calls.map((call: unknown[]) => String(call[0])).join('')).toContain(
        'symbolic link',
      )
    })
  }

  test('project unhook preserves the independently registered global server and live coordination', async () => {
    const project = mcpRegistrationPath(tempDir, 'claude-code', false)
    const global = mcpRegistrationPath(fakeHome, 'claude-code', true)
    prepareMcpRegistration(project, 'claude-code').commit()
    prepareMcpRegistration(global, 'claude-code').commit()
    const globalBytes = readFileSync(global, 'utf8')
    const live = join(fakeHome, '.clooks/.cache/approvals-live/v1')
    mkdirSync(live, { recursive: true })
    writeFileSync(join(live, 'active'), 'keep')
    await createTestProgram().parseAsync(
      ['uninstall', '--project', '--unhook', '--force', '--agent', 'claude-code'],
      { from: 'user' },
    )
    expect(hasOwnedMcpServer(project, 'claude-code')).toBe(false)
    expect(readFileSync(global, 'utf8')).toBe(globalBytes)
    expect(readFileSync(join(live, 'active'), 'utf8')).toBe('keep')
  })

  test('unhook retains an owned server still referenced by an unrelated handler', async () => {
    setupProject(tempDir)
    const server = mcpRegistrationPath(tempDir, 'claude-code', false)
    prepareMcpRegistration(server, 'claude-code').commit()
    const bytes = readFileSync(server, 'utf8')
    const settings = readSettings(tempDir)
    const hooks = settings.hooks as Record<string, unknown[]>
    hooks.PreToolUse!.push({
      hooks: [{ type: 'mcp_tool', server: 'clooks', tool: 'foreign-tool' }],
      extension: 'keep',
    })
    writeFileSync(join(tempDir, '.claude/settings.json'), JSON.stringify(settings))
    await createTestProgram().parseAsync(
      ['uninstall', '--project', '--unhook', '--force', '--agent', 'claude-code'],
      { from: 'user' },
    )
    expect(readFileSync(server, 'utf8')).toBe(bytes)
    expect((readSettings(tempDir).hooks as Record<string, unknown[]>).PreToolUse).toEqual([
      { hooks: [{ type: 'mcp_tool', server: 'clooks', tool: 'foreign-tool' }], extension: 'keep' },
    ])
  })

  test('Claude hook removal retires suppression before a concurrent server change aborts cleanup', async () => {
    setupProject(fakeHome)
    const flag = join(fakeHome, '.clooks/.global-entrypoint-active')
    writeFileSync(flag, '')
    const server = join(fakeHome, '.claude.json')
    prepareMcpRegistration(server, 'claude-code').commit()
    const changedConfig = JSON.stringify({
      mcpServers: {
        clooks: { command: 'foreign-server', args: ['keep'] },
        other: { command: 'other-server' },
      },
      sessionState: 'concurrent update',
    })
    const rename = fs.renameSync
    spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      rename(from, to)
      if (String(to) === join(fakeHome, '.claude/settings.json')) {
        writeFileSync(server, changedConfig)
      }
    })
    await expect(
      createTestProgram().parseAsync(
        ['--json', 'uninstall', '--global', '--unhook', '--force', '--agent', 'claude-code'],
        { from: 'user' },
      ),
    ).rejects.toThrow('process.exit called')
    expect(readSettings(fakeHome).hooks).toBeUndefined()
    expect(existsSync(flag)).toBe(false)
    expect(readFileSync(server, 'utf8')).toBe(changedConfig)
    expect(stdoutSpy.mock.calls.map((call: unknown[]) => String(call[0])).join('')).toContain(
      server,
    )
    expect(existsSync(join(fakeHome, '.clooks/bin/entrypoint.sh'))).toBe(true)
  })

  test('failed custom Codex server removal retains cleanup identity and receipt for retry', async () => {
    const codexHome = join(tempDir, 'custom-codex')
    process.env.CODEX_HOME = codexHome
    mkdirSync(join(fakeHome, '.clooks/bin'), { recursive: true })
    writeFileSync(join(fakeHome, '.clooks/bin/entrypoint.sh'), '#!/bin/sh\n', { mode: 0o755 })
    registerCodexClooks(codexHome, makeCodexGlobalEntrypointCommand(fakeHome), { owner: 'global' })
    const server = join(codexHome, 'config.toml')
    prepareMcpRegistration(server, 'codex').commit()
    registrationState.trackCodexHome(fakeHome, codexHome)
    registrationState.publishCodexReceipt(fakeHome, codexHome)
    const receipt = readFileSync(join(fakeHome, '.clooks/.global-entrypoint-active.codex'), 'utf8')
    const rename = fs.renameSync
    const fault = spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (String(to) === server) throw new Error('server removal fault')
      rename(from, to)
    })
    await expect(
      createTestProgram().parseAsync(
        ['uninstall', '--global', '--unhook', '--force', '--agent', 'codex'],
        { from: 'user' },
      ),
    ).rejects.toThrow('process.exit called')
    expect(registrationState.readCodexTrackedHome(fakeHome)).toEqual({ kind: 'home', codexHome })
    expect(readFileSync(join(fakeHome, '.clooks/.global-entrypoint-active.codex'), 'utf8')).toBe(
      receipt,
    )
    expect(hasOwnedMcpServer(server, 'codex')).toBe(true)
    fault.mockRestore()
    await createTestProgram().parseAsync(
      ['uninstall', '--global', '--unhook', '--force', '--agent', 'codex'],
      { from: 'user' },
    )
    expect(registrationState.readCodexTrackedHome(fakeHome).kind).toBe('missing')
    expect(hasOwnedMcpServer(server, 'codex')).toBe(false)
  })

  for (const override of ['', 'default', 'custom']) {
    test(`Claude override ${override} refuses uninstall prewrite while Codex remains independent`, async () => {
      setupProject(tempDir)
      setupCodexProject(tempDir)
      const path = join(tempDir, '.claude/settings.json')
      const before = readFileSync(path, 'utf8')
      process.env.CLAUDE_CONFIG_DIR = override === 'default' ? join(fakeHome, '.claude') : override
      await expect(
        createTestProgram().parseAsync(
          ['uninstall', '--project', '--unhook', '--force', '--agent', 'all'],
          { from: 'user' },
        ),
      ).rejects.toThrow('process.exit called')
      expect(readFileSync(path, 'utf8')).toBe(before)
      await createTestProgram().parseAsync(
        ['uninstall', '--project', '--unhook', '--force', '--agent', 'codex'],
        { from: 'user' },
      )
      expect(readFileSync(path, 'utf8')).toBe(before)
    })
  }
})

function createTestProgram() {
  const program = new Command()
  program.exitOverride()
  program.option('--json', 'JSON output')
  program.addCommand(createUninstallCommand(() => Promise.resolve(tempDir)))
  return program
}

// Helper to set up a project with Clooks initialized
function setupProject(root: string) {
  mkdirSync(join(root, '.clooks', 'hooks'), { recursive: true })
  mkdirSync(join(root, '.clooks', 'bin'), { recursive: true })
  mkdirSync(join(root, '.clooks', 'vendor'), { recursive: true })
  writeFileSync(join(root, '.clooks', 'clooks.yml'), 'version: "1.0.0"\nconfig: {}\n')
  writeFileSync(join(root, '.clooks', 'hooks', 'types.d.ts'), '// generated types\n')
  writeFileSync(join(root, '.clooks', 'bin', 'entrypoint.sh'), '#!/bin/bash\n')
  // Register Clooks in settings.json
  registerClooks(join(root, '.claude'), CLOOKS_ENTRYPOINT_PATH)
}

function setupCodexProject(root: string) {
  mkdirSync(join(root, '.clooks', 'hooks'), { recursive: true })
  mkdirSync(join(root, '.clooks', 'bin'), { recursive: true })
  mkdirSync(join(root, '.clooks', 'vendor'), { recursive: true })
  writeFileSync(join(root, '.clooks', 'clooks.yml'), 'version: "1.0.0"\nconfig: {}\n')
  writeFileSync(join(root, '.clooks', 'hooks', 'types.d.ts'), '// generated types\n')
  writeFileSync(join(root, '.clooks', 'bin', 'entrypoint.sh'), '#!/bin/bash\n')
  registerCodexClooks(
    join(root, '.codex'),
    makeCodexProjectEntrypointCommand('0123456789abcdef0123456789abcdef'),
  )
}

function readSettings(root: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf-8'))
}

function readCodexHooks(root: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, '.codex', 'hooks.json'), 'utf-8'))
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'clooks-uninstall-test-'))
  fakeHome = join(tempDir, 'fakehome')
  mkdirSync(fakeHome, { recursive: true })
  homeSpy = spyOn(platform, 'getHomeDir').mockReturnValue(fakeHome)
  originalEnvironment = {
    HOME: process.env.HOME,
    CODEX_HOME: process.env.CODEX_HOME,
    CLOOKS_HOME_ROOT: process.env.CLOOKS_HOME_ROOT,
    CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
  }
  process.env.HOME = fakeHome
  delete process.env.CLAUDE_CONFIG_DIR
  process.env.CODEX_HOME = join(fakeHome, '.codex')
  process.env.CLOOKS_HOME_ROOT = fakeHome
  resetPromptMocks()
  originalIsTTY = process.stdin.isTTY
  exitSpy = spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('process.exit called')
  }) as () => never)
  stdoutSpy = spyOn(process.stdout, 'write').mockImplementation(() => true)
})

afterEach(() => {
  Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, writable: true })
  exitSpy.mockRestore()
  stdoutSpy.mockRestore()
  homeSpy.mockRestore()
  mock.restore()
  resetPromptMocks()
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

describe('global Codex home recovery', () => {
  function run(action = '--unhook') {
    return createTestProgram().parseAsync(
      ['--json', 'uninstall', '--global', '--agent', 'codex', action, '--force'],
      { from: 'user' },
    )
  }

  function init() {
    const program = new Command().option('--json').addCommand(createInitCommand())
    return program.parseAsync(['--json', 'init', '--global', '--agent', 'codex'], { from: 'user' })
  }

  function registerHome(home: string) {
    mkdirSync(join(fakeHome, '.clooks/hooks'), { recursive: true })
    writeFileSync(join(fakeHome, '.clooks/hooks/custom.ts'), 'keep custom')
    registerCodexClooks(home, makeCodexGlobalEntrypointCommand(fakeHome))
  }

  test('referenced custom-home server retains recovery identity across default-home retries', async () => {
    spyOn(os, 'homedir').mockReturnValue(fakeHome)
    const custom = join(tempDir, 'home-a')
    process.env.CODEX_HOME = custom
    await init()
    const hooksPath = join(custom, 'hooks.json')
    const data = JSON.parse(readFileSync(hooksPath, 'utf8'))
    const foreign = { hooks: [{ type: 'mcp_tool', server: 'clooks', tool: 'foreign-tool' }] }
    data.hooks.PreToolUse.push(foreign)
    writeFileSync(hooksPath, JSON.stringify(data))
    const receipt = readFileSync(join(fakeHome, '.clooks/.global-entrypoint-active.codex'))
    await run()
    expect(JSON.parse(readFileSync(hooksPath, 'utf8')).hooks).toEqual({ PreToolUse: [foreign] })
    expect(hasOwnedMcpServer(join(custom, 'config.toml'), 'codex')).toBe(true)
    expect(registrationState.readCodexTrackedHome(fakeHome)).toEqual({
      kind: 'home',
      codexHome: custom,
    })
    expect(readFileSync(join(fakeHome, '.clooks/.global-entrypoint-active.codex'))).toEqual(receipt)
    delete process.env.CODEX_HOME
    await run()
    expect(registrationState.readCodexTrackedHome(fakeHome)).toEqual({
      kind: 'home',
      codexHome: custom,
    })
    await expect(init()).rejects.toThrow('process.exit called')
    await expect(run('--full')).rejects.toThrow('process.exit called')
    expect(registrationState.readCodexTrackedHome(fakeHome)).toEqual({
      kind: 'home',
      codexHome: custom,
    })
    expect(hasOwnedMcpServer(join(custom, 'config.toml'), 'codex')).toBe(true)
    writeFileSync(hooksPath, '{}\n')
    await run('--full')
    expect(hasOwnedMcpServer(join(custom, 'config.toml'), 'codex')).toBe(false)
    expect(registrationState.readCodexTrackedHome(fakeHome).kind).toBe('missing')
    expect(existsSync(join(fakeHome, '.clooks'))).toBe(false)
  })

  test('failed publication in A rejects init B, then full B cleans recorded A', async () => {
    spyOn(os, 'homedir').mockReturnValue(fakeHome)
    const a = join(tempDir, 'home-a')
    const b = join(tempDir, 'home-b')
    process.env.CODEX_HOME = a
    const publish = spyOn(registrationState, 'publishCodexReceipt').mockImplementation(() => {
      throw new Error('publication fault')
    })
    await expect(init()).rejects.toThrow('process.exit called')
    publish.mockRestore()
    const hooks = readFileSync(join(a, 'hooks.json'), 'utf-8')
    expect(registrationState.readCodexTrackedHome(fakeHome)).toEqual({ kind: 'home', codexHome: a })
    process.env.CODEX_HOME = b
    await expect(init()).rejects.toThrow('process.exit called')
    expect(existsSync(b)).toBe(false)
    expect(readFileSync(join(a, 'hooks.json'), 'utf-8')).toBe(hooks)
    await run('--full')
    expect(JSON.parse(readFileSync(join(a, 'hooks.json'), 'utf-8')).hooks).toBeUndefined()
    expect(existsSync(join(fakeHome, '.clooks'))).toBe(false)
  })

  test('unknown reference retains A identity after unhook and rejects B until explicit repair', async () => {
    spyOn(os, 'homedir').mockReturnValue(fakeHome)
    const a = join(tempDir, 'home-a')
    const b = join(tempDir, 'home-b')
    process.env.CODEX_HOME = a
    await init()
    const hooksPath = join(a, 'hooks.json')
    const data = JSON.parse(readFileSync(hooksPath, 'utf-8'))
    data.hooks.FutureEvent = [
      { hooks: [{ type: 'command', command: makeCodexGlobalEntrypointCommand(fakeHome) }] },
    ]
    writeFileSync(hooksPath, JSON.stringify(data))
    const receipt = readFileSync(join(fakeHome, '.clooks/.global-entrypoint-active.codex'), 'utf-8')
    await expect(run()).rejects.toThrow('process.exit called')
    expect(Object.keys(JSON.parse(readFileSync(hooksPath, 'utf-8')).hooks)).toEqual(['FutureEvent'])
    expect(registrationState.readCodexTrackedHome(fakeHome)).toEqual({ kind: 'home', codexHome: a })
    expect(readFileSync(join(fakeHome, '.clooks/.global-entrypoint-active.codex'), 'utf-8')).toBe(
      receipt,
    )
    process.env.CODEX_HOME = b
    await expect(init()).rejects.toThrow('process.exit called')
    await expect(run('--full')).rejects.toThrow('process.exit called')
    expect(existsSync(b)).toBe(false)
    writeFileSync(hooksPath, '{}\n')
    process.env.CODEX_HOME = a
    await run()
    expect(registrationState.readCodexTrackedHome(fakeHome).kind).toBe('missing')
    process.env.CODEX_HOME = b
    await init()
    expect(existsSync(join(b, 'hooks.json'))).toBe(true)
  })

  test('unhook B preserves A registration and recovery identity', async () => {
    const a = join(tempDir, 'home-a')
    const b = join(tempDir, 'home-b')
    registerHome(a)
    registerHome(b)
    registrationState.trackCodexHome(fakeHome, a)
    const original = readFileSync(join(a, 'hooks.json'), 'utf-8')
    process.env.CODEX_HOME = b
    await run()
    expect(readFileSync(join(a, 'hooks.json'), 'utf-8')).toBe(original)
    expect(registrationState.readCodexTrackedHome(fakeHome)).toEqual({ kind: 'home', codexHome: a })
    expect(existsSync(join(fakeHome, '.clooks/hooks/custom.ts'))).toBe(true)
  })

  test.each([false, 'cancel'])(
    'selected B consent cannot authorize recorded A cleanup: %j',
    async (answer) => {
      const a = join(tempDir, 'home-a')
      const b = join(tempDir, 'home-b')
      registerHome(a)
      registerHome(b)
      registrationState.trackCodexHome(fakeHome, a)
      process.env.CODEX_HOME = b
      const beforeA = readFileSync(join(a, 'hooks.json'), 'utf-8')
      const beforeB = readFileSync(join(b, 'hooks.json'), 'utf-8')
      Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true })
      const confirm = clack.confirm as ReturnType<typeof mock>
      confirm
        .mockImplementationOnce(() => true)
        .mockImplementationOnce(() => true)
        .mockImplementationOnce(() => answer)
      ;(clack.isCancel as unknown as ReturnType<typeof mock>).mockImplementation(
        (value: unknown) => value === 'cancel',
      )
      const operation = createTestProgram().parseAsync(
        ['uninstall', '--global', '--agent', 'codex'],
        { from: 'user' },
      )
      if (answer === 'cancel') await expect(operation).rejects.toThrow()
      else await operation
      expect(confirm.mock.calls).toHaveLength(3)
      const prompt = (confirm.mock.calls[2]![0] as { message: string }).message
      expect(prompt).toContain(join(a, 'hooks.json'))
      expect(prompt).toContain(join(b, 'hooks.json'))
      expect(readFileSync(join(a, 'hooks.json'), 'utf-8')).toBe(beforeA)
      expect(readFileSync(join(b, 'hooks.json'), 'utf-8')).toBe(beforeB)
      expect(readFileSync(join(fakeHome, '.clooks/hooks/custom.ts'), 'utf-8')).toBe('keep custom')
      expect(registrationState.readCodexTrackedHome(fakeHome)).toEqual({
        kind: 'home',
        codexHome: a,
      })
    },
  )

  test('full cleanup unions events in catalog order and sums preserved groups across distinct homes', async () => {
    const a = join(tempDir, 'home-a')
    const b = join(tempDir, 'home-b')
    for (const home of [a, b]) {
      registerHome(home)
      const path = join(home, 'hooks.json')
      const data = JSON.parse(readFileSync(path, 'utf-8'))
      const events = home === a ? ['PreToolUse', 'SessionStart'] : ['Stop', 'PreToolUse']
      data.hooks = Object.fromEntries(events.map((event) => [event, data.hooks[event]]))
      for (let index = 0; index < (home === a ? 1 : 2); index++) {
        data.hooks.PreToolUse.push({ hooks: [{ type: 'command', command: 'echo unrelated' }] })
      }
      writeFileSync(path, JSON.stringify(data))
    }
    registrationState.trackCodexHome(fakeHome, a)
    process.env.CODEX_HOME = b
    await run('--full')
    const result = JSON.parse(
      stdoutSpy.mock.calls.map((call: unknown[]) => String(call[0])).join(''),
    ).data
    expect(result.codexEventsRemoved).toEqual(['SessionStart', 'PreToolUse', 'Stop'])
    expect(result.codexNonClooksPreserved).toBe(3)
    expect(result.eventsRemoved).toEqual(result.claudeEventsRemoved)
    expect(result.nonClooksPreserved).toBe(result.claudeNonClooksPreserved)
    expect(result.agent).toBe('codex')
    expect(result.agents).toEqual(['codex'])
  })

  test('malformed recorded-home registration preflights before effective-home cleanup', async () => {
    const a = join(tempDir, 'home-a')
    const b = join(tempDir, 'home-b')
    registerHome(a)
    registerHome(b)
    registrationState.trackCodexHome(fakeHome, a)
    writeFileSync(join(a, 'hooks.json'), '{broken')
    const beforeB = readFileSync(join(b, 'hooks.json'), 'utf-8')
    process.env.CODEX_HOME = b
    await expect(run('--full')).rejects.toThrow('process.exit called')
    expect(readFileSync(join(b, 'hooks.json'), 'utf-8')).toBe(beforeB)
    expect(readFileSync(join(a, 'hooks.json'), 'utf-8')).toBe('{broken')
    expect(existsSync(join(fakeHome, '.clooks/hooks/custom.ts'))).toBe(true)
  })

  test('state clear failure retains shared runtime and permits retry', async () => {
    const home = process.env.CODEX_HOME!
    registerHome(home)
    registrationState.trackCodexHome(fakeHome, home)
    const clear = spyOn(registrationState, 'clearCodexRegistrationState').mockImplementation(() => {
      throw new Error('clear fault')
    })
    await expect(run('--full')).rejects.toThrow('process.exit called')
    expect(existsSync(join(fakeHome, '.clooks/hooks/custom.ts'))).toBe(true)
    expect(registrationState.readCodexTrackedHome(fakeHome).kind).toBe('home')
    clear.mockRestore()
    await run('--full')
    expect(existsSync(join(fakeHome, '.clooks'))).toBe(false)
  })

  test('physical home aliases are cleaned and counted once', async () => {
    const home = join(tempDir, 'physical')
    const alias = join(tempDir, 'alias')
    registerHome(home)
    const path = join(home, 'hooks.json')
    const data = JSON.parse(readFileSync(path, 'utf-8'))
    data.hooks.Stop.push({ hooks: [{ type: 'command', command: 'echo unrelated' }] })
    writeFileSync(path, JSON.stringify(data))
    fs.symlinkSync(home, alias)
    registrationState.trackCodexHome(fakeHome, home)
    process.env.CODEX_HOME = alias
    process.env.CLOOKS_HOME_ROOT = join(tempDir, 'runtime-only')
    await run('--full')
    const result = JSON.parse(
      stdoutSpy.mock.calls.map((call: unknown[]) => String(call[0])).join(''),
    ).data
    expect(result.codexNonClooksPreserved).toBe(1)
    expect(result.codexEventsRemoved).toEqual([...CODEX_REGISTRATION_EVENTS])
    expect(existsSync(process.env.CLOOKS_HOME_ROOT)).toBe(false)
  })

  test.each(['.codex-registration-home', '.global-entrypoint-active.codex'])(
    'malformed %s preflights before any full cleanup',
    async (name) => {
      setupGlobal(fakeHome)
      registerHome(process.env.CODEX_HOME!)
      const path = join(fakeHome, '.clooks', name)
      writeFileSync(path, 'malformed\n')
      const claude = join(fakeHome, '.claude/settings.json')
      const codex = join(process.env.CODEX_HOME!, 'hooks.json')
      const before = [claude, codex, path].map((file) => readFileSync(file))
      await expect(run('--full')).rejects.toThrow('process.exit called')
      ;[claude, codex, path].forEach((file, index) =>
        expect(readFileSync(file)).toEqual(before[index]!),
      )
      expect(readFileSync(join(fakeHome, '.clooks/hooks/custom.ts'), 'utf-8')).toBe('keep custom')
    },
  )

  test('late recorded-home write failure retains identity and runtime after effective-home cleanup', async () => {
    const a = join(tempDir, 'home-a')
    const b = join(tempDir, 'home-b')
    registerHome(a)
    registerHome(b)
    registrationState.trackCodexHome(fakeHome, a)
    process.env.CODEX_HOME = b
    const aBytes = readFileSync(join(a, 'hooks.json'), 'utf-8')
    const rename = fs.renameSync
    const fault = spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (String(to) === join(a, 'hooks.json')) throw new Error('recorded home write fault')
      rename(from, to)
    })
    await expect(run('--full')).rejects.toThrow('process.exit called')
    expect(JSON.parse(readFileSync(join(b, 'hooks.json'), 'utf-8')).hooks).toBeUndefined()
    expect(readFileSync(join(a, 'hooks.json'), 'utf-8')).toBe(aBytes)
    expect(registrationState.readCodexTrackedHome(fakeHome)).toEqual({ kind: 'home', codexHome: a })
    expect(readFileSync(join(fakeHome, '.clooks/hooks/custom.ts'), 'utf-8')).toBe('keep custom')
    fault.mockRestore()
    await run('--full')
    expect(existsSync(join(fakeHome, '.clooks'))).toBe(false)
  })
})

describe('clooks uninstall — force mode', () => {
  test('--project --full --force removes settings.json hooks and .clooks/ directory', async () => {
    setupProject(tempDir)

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--project', '--full', '--force'], { from: 'user' })

    // settings.json should exist but have no Clooks hooks
    const settings = readSettings(tempDir)
    expect(settings.hooks).toBeUndefined()

    // .clooks/ directory should not exist
    expect(existsSync(join(tempDir, '.clooks'))).toBe(false)

    expect(exitSpy).not.toHaveBeenCalled()
  })

  test('--project --full --force preserves non-Clooks hooks', async () => {
    setupProject(tempDir)

    // Add a non-Clooks hook alongside Clooks on PreToolUse (a real event)
    const settings = readSettings(tempDir)
    const hooks = settings.hooks as Record<string, unknown[]>
    hooks['PreToolUse']!.push({ hooks: [{ type: 'command', command: '/my/other/hook.sh' }] })
    writeFileSync(
      join(tempDir, '.claude', 'settings.json'),
      JSON.stringify(settings, null, 2) + '\n',
    )

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--project', '--full', '--force'], { from: 'user' })

    // The non-Clooks hook on PreToolUse should still exist, Clooks hook removed
    const updatedSettings = readSettings(tempDir)
    const updatedHooks = updatedSettings.hooks as Record<string, unknown[]>
    expect(updatedHooks).toBeDefined()
    expect(updatedHooks['PreToolUse']).toBeDefined()
    expect(updatedHooks['PreToolUse']).toHaveLength(1)
    const mg = updatedHooks['PreToolUse']![0] as Record<string, unknown>
    const hookEntries = mg.hooks as Record<string, string>[]
    expect(hookEntries[0]!.command).toBe('/my/other/hook.sh')
  })

  test('--project --unhook --force only removes settings.json entries', async () => {
    setupProject(tempDir)

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--project', '--unhook', '--force'], { from: 'user' })

    // settings.json should have no Clooks hooks
    const settings = readSettings(tempDir)
    expect(settings.hooks).toBeUndefined()

    // .clooks/ directory should STILL exist
    expect(existsSync(join(tempDir, '.clooks'))).toBe(true)
    expect(existsSync(join(tempDir, '.clooks', 'clooks.yml'))).toBe(true)
  })

  test('--project --full --force with non-Clooks hooks prints preservation count', async () => {
    setupProject(tempDir)

    // Add a non-Clooks hook alongside Clooks on PreToolUse
    const settings = readSettings(tempDir)
    const hooks = settings.hooks as Record<string, unknown[]>
    hooks['PreToolUse']!.push({ hooks: [{ type: 'command', command: '/my/other/hook.sh' }] })
    writeFileSync(
      join(tempDir, '.claude', 'settings.json'),
      JSON.stringify(settings, null, 2) + '\n',
    )

    const clack = await import('@clack/prompts')
    const infoMock = clack.log.info as unknown as ReturnType<typeof mock>
    infoMock.mockClear()

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--project', '--full', '--force'], { from: 'user' })

    const infoCalls = infoMock.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(infoCalls.some((msg: string) => msg.includes('non-Clooks hook(s) preserved'))).toBe(true)
  })

  test('--project --full --json --force outputs envelope', async () => {
    setupProject(tempDir)

    const program = createTestProgram()
    await program.parseAsync(['--json', 'uninstall', '--project', '--full', '--force'], {
      from: 'user',
    })

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    const parsed = JSON.parse(output.trim())

    expect(parsed).toEqual({
      ok: true,
      command: 'uninstall',
      data: expect.objectContaining({
        scope: 'project',
        agent: 'claude-code',
        agents: ['claude-code'],
        unhooked: true,
        deleted: true,
        customHooksDeleted: [],
        eventsRemoved: expect.any(Array),
        nonClooksPreserved: 0,
        claudeEventsRemoved: expect.any(Array),
        codexEventsRemoved: [],
      }),
    })
    expect(parsed.data.eventsRemoved).toHaveLength(22)
    expect(parsed.data.claudeEventsRemoved).toHaveLength(22)
  })
})

describe('clooks uninstall — force validation', () => {
  test('--project and --global together in interactive mode errors', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true })

    const program = createTestProgram()
    await program
      .parseAsync(['uninstall', '--project', '--global'], { from: 'user' })
      .catch(() => {})

    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  test('--force without action flag errors', async () => {
    const program = createTestProgram()
    await program
      .parseAsync(['uninstall', '--project', '--force'], { from: 'user' })
      .catch(() => {})

    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  test('--force without scope flag errors', async () => {
    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--full', '--force'], { from: 'user' }).catch(() => {})

    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  test('--unhook and --full together errors', async () => {
    const program = createTestProgram()
    await program
      .parseAsync(['uninstall', '--project', '--unhook', '--full', '--force'], { from: 'user' })
      .catch(() => {})

    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  test('invalid --agent value errors clearly', async () => {
    const program = createTestProgram()
    await program
      .parseAsync(['uninstall', '--project', '--agent', 'cursor', '--unhook', '--force'], {
        from: 'user',
      })
      .catch(() => {})

    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})

describe('clooks uninstall — codex agents', () => {
  test('--project --agent codex --unhook --force removes only .codex/hooks.json entries', async () => {
    setupProject(tempDir)
    setupCodexProject(tempDir)

    const claudeBefore = readFileSync(join(tempDir, '.claude', 'settings.json'), 'utf-8')

    const program = createTestProgram()
    await program.parseAsync(
      ['uninstall', '--project', '--agent', 'codex', '--unhook', '--force'],
      {
        from: 'user',
      },
    )

    expect(readFileSync(join(tempDir, '.claude', 'settings.json'), 'utf-8')).toBe(claudeBefore)
    expect(existsSync(join(tempDir, '.clooks'))).toBe(true)
    expect(readCodexHooks(tempDir).hooks).toBeUndefined()
  })

  test('--project --agent codex --unhook --force preserves unrelated Codex hooks', async () => {
    setupCodexProject(tempDir)

    const hooksFile = readCodexHooks(tempDir)
    const hooks = hooksFile.hooks as Record<string, unknown[]>
    const [firstGroup] = hooks['PreToolUse'] as Record<string, unknown>[]
    expect(firstGroup).toBeDefined()
    if (!firstGroup) throw new Error('expected PreToolUse Codex matcher group')
    firstGroup.hooks = [
      ...((firstGroup.hooks as unknown[]) ?? []),
      { type: 'command', command: '/usr/local/bin/unrelated-codex-hook' },
    ]
    writeFileSync(join(tempDir, '.codex', 'hooks.json'), JSON.stringify(hooksFile, null, 2) + '\n')

    const program = createTestProgram()
    await program.parseAsync(
      ['uninstall', '--project', '--agent', 'codex', '--unhook', '--force'],
      {
        from: 'user',
      },
    )

    const updatedHooks = readCodexHooks(tempDir).hooks as Record<string, unknown[]>
    expect(updatedHooks['PreToolUse']).toHaveLength(1)
    const preservedGroup = updatedHooks['PreToolUse']![0] as Record<string, unknown>
    expect(preservedGroup.hooks).toEqual([
      { type: 'command', command: '/usr/local/bin/unrelated-codex-hook' },
    ])
    for (const event of CODEX_REGISTRATION_EVENTS.filter((event) => event !== 'PreToolUse')) {
      expect(updatedHooks[event]).toBeUndefined()
    }
  })

  test('--project --agent all --unhook --force removes Claude and Codex registrations', async () => {
    setupProject(tempDir)
    setupCodexProject(tempDir)

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--project', '--agent', 'all', '--unhook', '--force'], {
      from: 'user',
    })

    expect(readSettings(tempDir).hooks).toBeUndefined()
    expect(readCodexHooks(tempDir).hooks).toBeUndefined()
    expect(existsSync(join(tempDir, '.clooks'))).toBe(true)
  })

  test('--project --agent codex --full --force unhooks all agents before deleting shared .clooks', async () => {
    setupProject(tempDir)
    setupCodexProject(tempDir)

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--project', '--agent', 'codex', '--full', '--force'], {
      from: 'user',
    })

    expect(readSettings(tempDir).hooks).toBeUndefined()
    expect(readCodexHooks(tempDir).hooks).toBeUndefined()
    expect(existsSync(join(tempDir, '.clooks'))).toBe(false)
  })

  test('--project --agent codex --full --force explains all-agent unhooking when shared .clooks is deleted', async () => {
    setupProject(tempDir)
    setupCodexProject(tempDir)

    const clack = await import('@clack/prompts')
    const infoMock = clack.log.info as unknown as ReturnType<typeof mock>
    infoMock.mockClear()

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--project', '--agent', 'codex', '--full', '--force'], {
      from: 'user',
    })

    const infoCalls = infoMock.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(
      infoCalls.some((msg: string) =>
        msg.includes(
          'Deleting the shared Clooks directory requires removing all agent registrations that use it.',
        ),
      ),
    ).toBe(true)
  })

  test('--project --agent all --full --force does not print all-agent widening explanation', async () => {
    setupProject(tempDir)
    setupCodexProject(tempDir)

    const clack = await import('@clack/prompts')
    const infoMock = clack.log.info as unknown as ReturnType<typeof mock>
    infoMock.mockClear()

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--project', '--agent', 'all', '--full', '--force'], {
      from: 'user',
    })

    const infoCalls = infoMock.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(
      infoCalls.some((msg: string) => msg.includes('requires removing all agent registrations')),
    ).toBe(false)
  })

  test('--project --agent codex --full --json --force reports codex counts separately', async () => {
    setupCodexProject(tempDir)

    const program = createTestProgram()
    await program.parseAsync(
      ['--json', 'uninstall', '--project', '--agent', 'codex', '--full', '--force'],
      { from: 'user' },
    )

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    const parsed = JSON.parse(output.trim())

    expect(parsed.data.agent).toBe('codex')
    expect(parsed.data.agents).toEqual(['codex'])
    expect(parsed.data.eventsRemoved).toEqual([])
    expect(parsed.data.claudeEventsRemoved).toEqual([])
    expect(parsed.data.codexEventsRemoved).toHaveLength(CODEX_REGISTRATION_EVENTS.length)
    expect(parsed.data.deleted).toBe(true)
  })

  test('--project --agent codex --full --force human output omits unregistered agent zero-count lines', async () => {
    setupCodexProject(tempDir)

    const clack = await import('@clack/prompts')
    const successMock = clack.log.success as unknown as ReturnType<typeof mock>
    successMock.mockClear()

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--project', '--agent', 'codex', '--full', '--force'], {
      from: 'user',
    })

    const successCalls = successMock.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(
      successCalls.some((msg: string) =>
        msg.includes('Removed Clooks hooks from .claude/settings.json (0 events).'),
      ),
    ).toBe(false)
    expect(
      successCalls.some((msg: string) =>
        msg.includes(
          `Removed Clooks hooks from .codex/hooks.json (${CODEX_REGISTRATION_EVENTS.length} events).`,
        ),
      ),
    ).toBe(true)
  })

  test('--project --agent codex --full --json --force reports Claude too when present', async () => {
    setupProject(tempDir)
    setupCodexProject(tempDir)

    const program = createTestProgram()
    await program.parseAsync(
      ['--json', 'uninstall', '--project', '--agent', 'codex', '--full', '--force'],
      { from: 'user' },
    )

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    const parsed = JSON.parse(output.trim())

    expect(parsed.data.agent).toBe('codex')
    expect(parsed.data.claudeEventsRemoved).toHaveLength(22)
    expect(parsed.data.codexEventsRemoved).toHaveLength(CODEX_REGISTRATION_EVENTS.length)
    expect(parsed.data.eventsRemoved).toHaveLength(22)
  })

  test('--project --agent claude-code --unhook --force preserves Codex registration', async () => {
    setupProject(tempDir)
    setupCodexProject(tempDir)
    const codexBefore = readFileSync(join(tempDir, '.codex', 'hooks.json'), 'utf-8')

    const program = createTestProgram()
    await program.parseAsync(
      ['uninstall', '--project', '--agent', 'claude-code', '--unhook', '--force'],
      { from: 'user' },
    )

    expect(readSettings(tempDir).hooks).toBeUndefined()
    expect(readFileSync(join(tempDir, '.codex', 'hooks.json'), 'utf-8')).toBe(codexBefore)
  })

  test('--project --agent codex --unhook --force human no-op is clear in Claude-only setup', async () => {
    setupProject(tempDir)

    const clack = await import('@clack/prompts')
    const infoMock = clack.log.info as unknown as ReturnType<typeof mock>
    infoMock.mockClear()

    const program = createTestProgram()
    await program.parseAsync(
      ['uninstall', '--project', '--agent', 'codex', '--unhook', '--force'],
      {
        from: 'user',
      },
    )

    const infoCalls = infoMock.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(
      infoCalls.some((msg: string) =>
        msg.includes('No Codex Clooks hook registrations found. Nothing changed.'),
      ),
    ).toBe(true)
  })

  test('--project --agent codex --unhook --force human output reports Codex count', async () => {
    setupCodexProject(tempDir)

    const clack = await import('@clack/prompts')
    const successMock = clack.log.success as unknown as ReturnType<typeof mock>
    successMock.mockClear()

    const program = createTestProgram()
    await program.parseAsync(
      ['uninstall', '--project', '--agent', 'codex', '--unhook', '--force'],
      {
        from: 'user',
      },
    )

    const successCalls = successMock.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(
      successCalls.some((msg: string) =>
        msg.includes(
          `Removed Clooks hooks from .codex/hooks.json (${CODEX_REGISTRATION_EVENTS.length} events).`,
        ),
      ),
    ).toBe(true)
  })

  test('--project --agent all --unhook --json --force reports Claude and Codex counts', async () => {
    setupProject(tempDir)
    setupCodexProject(tempDir)

    const program = createTestProgram()
    await program.parseAsync(
      ['--json', 'uninstall', '--project', '--agent', 'all', '--unhook', '--force'],
      { from: 'user' },
    )

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    const parsed = JSON.parse(output.trim())
    expect(parsed.data.agent).toBe('all')
    expect(parsed.data.agents).toEqual(['claude-code', 'codex'])
    expect(parsed.data.claudeEventsRemoved).toHaveLength(22)
    expect(parsed.data.codexEventsRemoved).toHaveLength(CODEX_REGISTRATION_EVENTS.length)
  })

  test('--project --agent all --unhook --force human output reports separate counts', async () => {
    setupProject(tempDir)
    setupCodexProject(tempDir)

    const clack = await import('@clack/prompts')
    const successMock = clack.log.success as unknown as ReturnType<typeof mock>
    successMock.mockClear()

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--project', '--agent', 'all', '--unhook', '--force'], {
      from: 'user',
    })

    const successCalls = successMock.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(
      successCalls.some((msg: string) =>
        msg.includes('Removed Clooks hooks from .claude/settings.json (22 events).'),
      ),
    ).toBe(true)
    expect(
      successCalls.some((msg: string) =>
        msg.includes(
          `Removed Clooks hooks from .codex/hooks.json (${CODEX_REGISTRATION_EVENTS.length} events).`,
        ),
      ),
    ).toBe(true)
  })

  test('omitted --agent rejects ambiguous forced project unhook without writes', async () => {
    setupProject(tempDir)
    setupCodexProject(tempDir)

    const codexBefore = readFileSync(join(tempDir, '.codex', 'hooks.json'), 'utf-8')
    const claudeBefore = readFileSync(join(tempDir, '.claude', 'settings.json'), 'utf-8')

    const program = createTestProgram()
    await expect(
      program.parseAsync(['uninstall', '--project', '--unhook', '--force'], { from: 'user' }),
    ).rejects.toThrow('process.exit called')
    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(clack.log.error).toHaveBeenCalledWith(
      'Both Claude Code and Codex Clooks registrations found in project scope. Specify --agent claude-code, --agent codex, or --agent all; --force does not select an agent.',
    )

    expect(readFileSync(join(tempDir, '.claude', 'settings.json'), 'utf-8')).toBe(claudeBefore)
    expect(readFileSync(join(tempDir, '.codex', 'hooks.json'), 'utf-8')).toBe(codexBefore)
  })

  test('--project --agent codex --unhook --force JSON no-op when only Claude is registered', async () => {
    setupProject(tempDir)

    const program = createTestProgram()
    await program.parseAsync(
      ['--json', 'uninstall', '--project', '--agent', 'codex', '--unhook', '--force'],
      { from: 'user' },
    )

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    const parsed = JSON.parse(output.trim())
    expect(parsed.data).toEqual(
      expect.objectContaining({
        agent: 'codex',
        agents: ['codex'],
        unhooked: false,
        deleted: false,
        claudeEventsRemoved: [],
        codexEventsRemoved: [],
      }),
    )
    expect(readSettings(tempDir).hooks).toBeDefined()
  })
})

describe('clooks uninstall — non-interactive guard', () => {
  test('non-interactive without --force errors', async () => {
    const program = createTestProgram()
    await program.parseAsync(['--json', 'uninstall', '--project'], { from: 'user' }).catch(() => {})

    expect(exitSpy).toHaveBeenCalledWith(1)

    // Find the JSON error envelope in stdout calls
    const calls = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0]))
    const jsonLine = calls.find((s: string) => s.includes('"ok"'))
    expect(jsonLine).toBeDefined()
    const parsed = JSON.parse(jsonLine!.trim())
    expect(parsed.ok).toBe(false)
    expect(parsed.error).toContain('requires --force')
  })
})

describe('clooks uninstall — interactive mode', () => {
  test('--project declines both unhook and delete prints "Nothing changed."', async () => {
    setupProject(tempDir)

    const clack = await import('@clack/prompts')
    const confirmMock = clack.confirm as unknown as ReturnType<typeof mock>
    confirmMock.mockImplementationOnce(() => false) // decline unhook
    confirmMock.mockImplementationOnce(() => false) // decline delete

    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true })

    const infoMock = clack.log.info as unknown as ReturnType<typeof mock>
    infoMock.mockClear()

    const settingsBefore = readFileSync(join(tempDir, '.claude', 'settings.json'), 'utf-8')

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--project'], { from: 'user' })

    const infoCalls = infoMock.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(infoCalls.some((msg: string) => msg.includes('Nothing changed in project scope.'))).toBe(
      true,
    )

    // settings.json unchanged
    const settingsAfter = readFileSync(join(tempDir, '.claude', 'settings.json'), 'utf-8')
    expect(settingsAfter).toBe(settingsBefore)

    // .clooks/ still exists
    expect(existsSync(join(tempDir, '.clooks'))).toBe(true)
  })

  test('--project unhook-only when user declines delete', async () => {
    setupProject(tempDir)

    const { confirm } = await import('@clack/prompts')
    const confirmMock = confirm as unknown as ReturnType<typeof mock>
    confirmMock.mockImplementationOnce(() => true) // unhook
    confirmMock.mockImplementationOnce(() => false) // don't delete

    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true })

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--project'], { from: 'user' })

    // settings.json should be cleaned
    const settings = readSettings(tempDir)
    expect(settings.hooks).toBeUndefined()

    // .clooks/ should still exist
    expect(existsSync(join(tempDir, '.clooks'))).toBe(true)
  })

  test('--project warns about custom hooks before deletion', async () => {
    setupProject(tempDir)
    writeFileSync(join(tempDir, '.clooks', 'hooks', 'my-hook.ts'), 'export default {}')

    const { confirm } = await import('@clack/prompts')
    const confirmMock = confirm as unknown as ReturnType<typeof mock>
    confirmMock.mockImplementationOnce(() => true) // unhook
    confirmMock.mockImplementationOnce(() => true) // delete

    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true })

    const clack = await import('@clack/prompts')
    const warningMock = clack.log.warning as unknown as ReturnType<typeof mock>
    warningMock.mockClear()

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--project'], { from: 'user' })

    // log.warning should have been called with a string containing my-hook.ts
    const warningCalls = warningMock.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(warningCalls.some((msg: string) => msg.includes('my-hook.ts'))).toBe(true)
  })

  test('--project cancel exits cleanly with no partial state', async () => {
    setupProject(tempDir)
    const settingsBefore = readFileSync(join(tempDir, '.claude', 'settings.json'), 'utf-8')

    const clack = await import('@clack/prompts')
    const confirmMock = clack.confirm as unknown as ReturnType<typeof mock>
    const isCancelMock = clack.isCancel as unknown as ReturnType<typeof mock>
    const cancelSymbol = Symbol('clack:cancel')
    confirmMock.mockImplementationOnce(() => cancelSymbol)
    isCancelMock.mockImplementationOnce(() => true)

    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true })

    const program = createTestProgram()
    let threw = false
    try {
      await program.parseAsync(['uninstall', '--project'], { from: 'user' })
    } catch (e) {
      if (e instanceof Error && e.name === 'CancelError') {
        threw = true
      }
    }

    expect(threw).toBe(true)
    // settings.json should be UNCHANGED
    const settingsAfter = readFileSync(join(tempDir, '.claude', 'settings.json'), 'utf-8')
    expect(settingsAfter).toBe(settingsBefore)
  })

  test('--project cancel on delete prompt exits cleanly with no partial state', async () => {
    setupProject(tempDir)
    const settingsBefore = readFileSync(join(tempDir, '.claude', 'settings.json'), 'utf-8')

    const clack = await import('@clack/prompts')
    const confirmMock = clack.confirm as unknown as ReturnType<typeof mock>
    const isCancelMock = clack.isCancel as unknown as ReturnType<typeof mock>
    const cancelSymbol = Symbol('clack:cancel')

    // First call: confirm unhook (true), second call: cancel on delete
    confirmMock.mockImplementationOnce(() => true)
    confirmMock.mockImplementationOnce(() => cancelSymbol)
    isCancelMock.mockImplementationOnce(() => false)
    isCancelMock.mockImplementationOnce(() => true)

    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true })

    const program = createTestProgram()
    let threw = false
    try {
      await program.parseAsync(['uninstall', '--project'], { from: 'user' })
    } catch (e) {
      if (e instanceof Error && e.name === 'CancelError') {
        threw = true
      }
    }

    expect(threw).toBe(true)
    // settings.json should be UNCHANGED (batch execution — no unhook happened even though user confirmed it)
    const settingsAfter = readFileSync(join(tempDir, '.claude', 'settings.json'), 'utf-8')
    expect(settingsAfter).toBe(settingsBefore)
  })

  test('--project --full can delete an already unhooked .clooks/ interactively', async () => {
    // Create .clooks/ directory but do NOT register in settings.json
    mkdirSync(join(tempDir, '.clooks', 'hooks'), { recursive: true })
    writeFileSync(join(tempDir, '.clooks', 'clooks.yml'), 'version: "1.0.0"\n')

    const { confirm } = await import('@clack/prompts')
    const confirmMock = confirm as unknown as ReturnType<typeof mock>
    confirmMock.mockImplementationOnce(() => true) // delete

    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true })

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--project'], { from: 'user' })

    expect(existsSync(join(tempDir, '.clooks'))).toBe(true)
    expect(confirmMock).not.toHaveBeenCalled()
    await createTestProgram().parseAsync(['uninstall', '--project', '--full'], { from: 'user' })
    expect(existsSync(join(tempDir, '.clooks'))).toBe(false)
  })
})

describe('clooks uninstall — general', () => {
  test('--project --full --force with only types.d.ts lists no custom hooks', async () => {
    setupProject(tempDir)

    const program = createTestProgram()
    await program.parseAsync(['--json', 'uninstall', '--project', '--full', '--force'], {
      from: 'user',
    })

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    const parsed = JSON.parse(output.trim())
    expect(parsed.data.customHooksDeleted).toEqual([])
  })

  test('--project --full --force JSON no-op when not initialized', async () => {
    // No .clooks/, no settings.json
    const program = createTestProgram()
    await program.parseAsync(['--json', 'uninstall', '--project', '--full', '--force'], {
      from: 'user',
    })

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    const parsed = JSON.parse(output.trim())
    expect(parsed).toEqual({
      ok: true,
      command: 'uninstall',
      data: expect.objectContaining({
        scope: 'project',
        agent: null,
        agents: [],
        unhooked: false,
        deleted: false,
        customHooksDeleted: [],
        eventsRemoved: [],
        claudeEventsRemoved: [],
        codexEventsRemoved: [],
      }),
    })
  })

  test('detectCustomHooks excludes subdirectories', async () => {
    setupProject(tempDir)
    mkdirSync(join(tempDir, '.clooks', 'hooks', 'utils'), { recursive: true })
    writeFileSync(join(tempDir, '.clooks', 'hooks', 'my-hook.ts'), 'export default {}')

    const program = createTestProgram()
    await program.parseAsync(['--json', 'uninstall', '--project', '--full', '--force'], {
      from: 'user',
    })

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    const parsed = JSON.parse(output.trim())
    expect(parsed.data.customHooksDeleted).toContain('my-hook.ts')
    expect(parsed.data.customHooksDeleted).not.toContain('utils')
  })

  test('--project no-op when not initialized', async () => {
    // No .clooks/, no Clooks in settings.json
    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true })

    const clack = await import('@clack/prompts')
    const infoMock = clack.log.info as unknown as ReturnType<typeof mock>
    infoMock.mockClear()

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--project'], { from: 'user' })

    expect(exitSpy).not.toHaveBeenCalled()

    const infoCalls = infoMock.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(infoCalls.some((msg: string) => msg.includes('Nothing to uninstall'))).toBe(true)
  })

  test('--project --full --force idempotent', async () => {
    setupProject(tempDir)

    // First run
    const program1 = createTestProgram()
    await program1.parseAsync(['uninstall', '--project', '--full', '--force'], { from: 'user' })

    // Second run
    const clack = await import('@clack/prompts')
    const infoMock = clack.log.info as unknown as ReturnType<typeof mock>
    infoMock.mockClear()

    const program2 = createTestProgram()
    await program2.parseAsync(['uninstall', '--project', '--full', '--force'], { from: 'user' })

    // Second run should not error
    expect(exitSpy).not.toHaveBeenCalled()

    // Should print "Nothing to uninstall."
    const infoCalls = infoMock.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(infoCalls.some((msg: string) => msg.includes('Nothing to uninstall'))).toBe(true)
  })

  test('explicit unhook confirms registration removal without offering deletion', async () => {
    setupProject(tempDir)

    const { confirm } = await import('@clack/prompts')
    const confirmMock = confirm as unknown as ReturnType<typeof mock>
    confirmMock.mockClear()
    confirmMock.mockImplementationOnce(() => true) // unhook

    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true })

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--project', '--unhook'], { from: 'user' })

    expect(confirmMock).toHaveBeenCalledTimes(1)
    expect(confirmMock.mock.calls[0]![0].message).toBe(
      'Remove Claude Code Clooks hook registrations?',
    )
    expect(existsSync(join(tempDir, '.clooks/bin/entrypoint.sh'))).toBe(true)
    expect(readSettings(tempDir).hooks).toBeUndefined()
  })

  test('--project --full --force with custom hooks lists them in JSON', async () => {
    setupProject(tempDir)
    writeFileSync(join(tempDir, '.clooks', 'hooks', 'my-hook.ts'), 'export default {}')

    const program = createTestProgram()
    await program.parseAsync(['--json', 'uninstall', '--project', '--full', '--force'], {
      from: 'user',
    })

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    const parsed = JSON.parse(output.trim())
    expect(parsed.data.customHooksDeleted).toContain('my-hook.ts')
  })
})

// Helper to set up a global Clooks installation
function setupGlobal(homeRoot: string) {
  mkdirSync(join(homeRoot, '.clooks', 'hooks'), { recursive: true })
  mkdirSync(join(homeRoot, '.clooks', 'bin'), { recursive: true })
  mkdirSync(join(homeRoot, '.clooks', 'vendor'), { recursive: true })
  writeFileSync(join(homeRoot, '.clooks', 'clooks.yml'), 'version: "1.0.0"\nconfig: {}\n')
  writeFileSync(join(homeRoot, '.clooks', 'hooks', 'types.d.ts'), '// generated types\n')
  writeFileSync(join(homeRoot, '.clooks', 'bin', 'entrypoint.sh'), '#!/bin/bash\n')
  const globalEntrypointCommand = join(homeRoot, '.clooks/bin/entrypoint.sh')
  registerClooks(join(homeRoot, '.claude'), globalEntrypointCommand)
}

function setupCodexGlobal(homeRoot: string) {
  mkdirSync(join(homeRoot, '.clooks', 'hooks'), { recursive: true })
  mkdirSync(join(homeRoot, '.clooks', 'bin'), { recursive: true })
  mkdirSync(join(homeRoot, '.clooks', 'vendor'), { recursive: true })
  writeFileSync(join(homeRoot, '.clooks', 'clooks.yml'), 'version: "1.0.0"\nconfig: {}\n')
  writeFileSync(join(homeRoot, '.clooks', 'hooks', 'types.d.ts'), '// generated types\n')
  writeFileSync(join(homeRoot, '.clooks', 'bin', 'entrypoint.sh'), '#!/bin/bash\n')
  registerCodexClooks(join(homeRoot, '.codex'), makeCodexGlobalEntrypointCommand(homeRoot))
}

function readHomeSettings(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(fakeHome, '.claude', 'settings.json'), 'utf-8'))
}

function readHomeCodexHooks(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(fakeHome, '.codex', 'hooks.json'), 'utf-8'))
}

describe('clooks uninstall — global scope', () => {
  test('--global --full --force JSON no-op when not initialized', async () => {
    // No ~/.clooks/, no ~/.claude/settings.json
    const program = createTestProgram()
    await program.parseAsync(['--json', 'uninstall', '--global', '--full', '--force'], {
      from: 'user',
    })

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    const parsed = JSON.parse(output.trim())
    expect(parsed).toEqual({
      ok: true,
      command: 'uninstall',
      data: expect.objectContaining({
        scope: 'global',
        agent: null,
        agents: [],
        unhooked: false,
        deleted: false,
        customHooksDeleted: [],
        eventsRemoved: [],
        claudeEventsRemoved: [],
        codexEventsRemoved: [],
      }),
    })
  })

  test('--global --full --force with custom hooks lists them in JSON', async () => {
    setupGlobal(fakeHome)
    writeFileSync(join(fakeHome, '.clooks', 'hooks', 'my-hook.ts'), 'export default {}')

    const program = createTestProgram()
    await program.parseAsync(['--json', 'uninstall', '--global', '--full', '--force'], {
      from: 'user',
    })

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    const parsed = JSON.parse(output.trim())
    expect(parsed.data.customHooksDeleted).toContain('my-hook.ts')
  })

  test('--global unhook-only when user declines delete (interactive)', async () => {
    setupGlobal(fakeHome)

    const clack = await import('@clack/prompts')
    const confirmMock = clack.confirm as unknown as ReturnType<typeof mock>
    confirmMock.mockImplementationOnce(() => true) // unhook
    confirmMock.mockImplementationOnce(() => false) // don't delete

    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true })

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--global'], { from: 'user' })

    // ~/.claude/settings.json should be cleaned
    const settings = readHomeSettings()
    expect(settings.hooks).toBeUndefined()

    // ~/.clooks/ should still exist
    expect(existsSync(join(fakeHome, '.clooks'))).toBe(true)
  })

  test('--global --full --force removes ~/.claude/settings.json hooks and ~/.clooks/', async () => {
    setupGlobal(fakeHome)

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--global', '--full', '--force'], { from: 'user' })

    // ~/.claude/settings.json should have no Clooks hooks
    const settings = readHomeSettings()
    expect(settings.hooks).toBeUndefined()

    // ~/.clooks/ should not exist
    expect(existsSync(join(fakeHome, '.clooks'))).toBe(false)

    expect(exitSpy).not.toHaveBeenCalled()
  })

  test('--global --unhook --force only removes ~/.claude/settings.json entries', async () => {
    setupGlobal(fakeHome)

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--global', '--unhook', '--force'], { from: 'user' })

    // settings cleaned
    const settings = readHomeSettings()
    expect(settings.hooks).toBeUndefined()

    // ~/.clooks/ should still exist
    expect(existsSync(join(fakeHome, '.clooks'))).toBe(true)
    expect(existsSync(join(fakeHome, '.clooks', 'clooks.yml'))).toBe(true)
  })

  test('--global --full --force recovery messaging references init --global', async () => {
    setupGlobal(fakeHome)

    const clack = await import('@clack/prompts')
    const infoMock = clack.log.info as unknown as ReturnType<typeof mock>
    infoMock.mockClear()

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--global', '--full', '--force'], { from: 'user' })

    const infoCalls = infoMock.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(infoCalls.some((msg: string) => msg.includes('clooks init --global'))).toBe(true)
  })

  test('--global no-op when not initialized', async () => {
    // No ~/.clooks/, no Clooks in ~/.claude/settings.json
    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true })

    const clack = await import('@clack/prompts')
    const infoMock = clack.log.info as unknown as ReturnType<typeof mock>
    infoMock.mockClear()

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--global'], { from: 'user' })

    expect(exitSpy).not.toHaveBeenCalled()

    const infoCalls = infoMock.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(infoCalls.some((msg: string) => msg.includes('Nothing to uninstall'))).toBe(true)
  })

  test('--global --full --json --force outputs envelope with scope global', async () => {
    setupGlobal(fakeHome)

    const program = createTestProgram()
    await program.parseAsync(['--json', 'uninstall', '--global', '--full', '--force'], {
      from: 'user',
    })

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    const parsed = JSON.parse(output.trim())

    expect(parsed.data.scope).toBe('global')
    expect(parsed.ok).toBe(true)
    expect(parsed.data.unhooked).toBe(true)
    expect(parsed.data.deleted).toBe(true)
  })

  test('--global --agent codex --unhook --force removes Codex registration and codex flag only', async () => {
    setupGlobal(fakeHome)
    setupCodexGlobal(fakeHome)
    writeFileSync(join(fakeHome, '.clooks', '.global-entrypoint-active'), '')
    writeFileSync(join(fakeHome, '.clooks', '.global-entrypoint-active.codex'), '')

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--global', '--agent', 'codex', '--unhook', '--force'], {
      from: 'user',
    })

    expect(readHomeSettings().hooks).toBeDefined()
    expect(readHomeCodexHooks().hooks).toBeUndefined()
    expect(existsSync(join(fakeHome, '.clooks', '.global-entrypoint-active'))).toBe(true)
    expect(existsSync(join(fakeHome, '.clooks', '.global-entrypoint-active.codex'))).toBe(false)
    expect(existsSync(join(fakeHome, '.clooks'))).toBe(true)
  })

  test('--global omitted agent rejects ambiguous forced unhook without changing registrations or flags', async () => {
    setupGlobal(fakeHome)
    setupCodexGlobal(fakeHome)
    writeFileSync(join(fakeHome, '.clooks', '.global-entrypoint-active'), '')
    writeFileSync(join(fakeHome, '.clooks', '.global-entrypoint-active.codex'), '')
    const codexBefore = readFileSync(join(fakeHome, '.codex', 'hooks.json'), 'utf-8')
    const claudeBefore = readFileSync(join(fakeHome, '.claude', 'settings.json'), 'utf-8')

    const program = createTestProgram()
    await expect(
      program.parseAsync(['uninstall', '--global', '--unhook', '--force'], { from: 'user' }),
    ).rejects.toThrow('process.exit called')
    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(clack.log.error).toHaveBeenCalledWith(
      'Both Claude Code and Codex Clooks registrations found in global scope. Specify --agent claude-code, --agent codex, or --agent all; --force does not select an agent.',
    )

    expect(readFileSync(join(fakeHome, '.claude', 'settings.json'), 'utf-8')).toBe(claudeBefore)
    expect(existsSync(join(fakeHome, '.clooks', '.global-entrypoint-active'))).toBe(true)
    expect(readFileSync(join(fakeHome, '.codex', 'hooks.json'), 'utf-8')).toBe(codexBefore)
    expect(existsSync(join(fakeHome, '.clooks', '.global-entrypoint-active.codex'))).toBe(true)
  })

  test('--global --agent claude-code --unhook --force preserves Codex registration and flag', async () => {
    setupGlobal(fakeHome)
    setupCodexGlobal(fakeHome)
    writeFileSync(join(fakeHome, '.clooks', '.global-entrypoint-active'), '')
    writeFileSync(join(fakeHome, '.clooks', '.global-entrypoint-active.codex'), '')
    const codexBefore = readFileSync(join(fakeHome, '.codex', 'hooks.json'), 'utf-8')

    const program = createTestProgram()
    await program.parseAsync(
      ['uninstall', '--global', '--agent', 'claude-code', '--unhook', '--force'],
      { from: 'user' },
    )

    expect(readHomeSettings().hooks).toBeUndefined()
    expect(readFileSync(join(fakeHome, '.codex', 'hooks.json'), 'utf-8')).toBe(codexBefore)
    expect(existsSync(join(fakeHome, '.clooks', '.global-entrypoint-active.codex'))).toBe(true)
  })

  test('--global --agent codex --full --force unhooks all agents before deleting shared .clooks', async () => {
    setupGlobal(fakeHome)
    setupCodexGlobal(fakeHome)
    writeFileSync(join(fakeHome, '.clooks', '.global-entrypoint-active'), '')
    writeFileSync(join(fakeHome, '.clooks', '.global-entrypoint-active.codex'), '')

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--global', '--agent', 'codex', '--full', '--force'], {
      from: 'user',
    })

    expect(readHomeSettings().hooks).toBeUndefined()
    expect(readHomeCodexHooks().hooks).toBeUndefined()
    expect(existsSync(join(fakeHome, '.clooks'))).toBe(false)
  })

  test('--global --agent codex --full --force explains all-agent unhooking when shared ~/.clooks is deleted', async () => {
    setupGlobal(fakeHome)
    setupCodexGlobal(fakeHome)

    const clack = await import('@clack/prompts')
    const infoMock = clack.log.info as unknown as ReturnType<typeof mock>
    infoMock.mockClear()

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--global', '--agent', 'codex', '--full', '--force'], {
      from: 'user',
    })

    const infoCalls = infoMock.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(
      infoCalls.some((msg: string) =>
        msg.includes(
          'Deleting the shared Clooks directory requires removing all agent registrations that use it.',
        ),
      ),
    ).toBe(true)
  })

  test('--global --agent codex --unhook --force human no-op is clear in Claude-only setup', async () => {
    setupGlobal(fakeHome)

    const clack = await import('@clack/prompts')
    const infoMock = clack.log.info as unknown as ReturnType<typeof mock>
    infoMock.mockClear()

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--global', '--agent', 'codex', '--unhook', '--force'], {
      from: 'user',
    })

    const infoCalls = infoMock.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(
      infoCalls.some((msg: string) =>
        msg.includes('No Codex global Clooks hook registrations found. Nothing changed.'),
      ),
    ).toBe(true)
  })

  test('--global --agent all --unhook --json --force reports Claude and Codex counts', async () => {
    setupGlobal(fakeHome)
    setupCodexGlobal(fakeHome)

    const program = createTestProgram()
    await program.parseAsync(
      ['--json', 'uninstall', '--global', '--agent', 'all', '--unhook', '--force'],
      { from: 'user' },
    )

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    const parsed = JSON.parse(output.trim())
    expect(parsed.data.agent).toBe('all')
    expect(parsed.data.claudeEventsRemoved).toHaveLength(22)
    expect(parsed.data.codexEventsRemoved).toHaveLength(CODEX_REGISTRATION_EVENTS.length)
  })

  test('--global --agent all --unhook --force human output reports separate counts', async () => {
    setupGlobal(fakeHome)
    setupCodexGlobal(fakeHome)

    const clack = await import('@clack/prompts')
    const successMock = clack.log.success as unknown as ReturnType<typeof mock>
    successMock.mockClear()

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--global', '--agent', 'all', '--unhook', '--force'], {
      from: 'user',
    })

    const successCalls = successMock.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(
      successCalls.some((msg: string) =>
        msg.includes('Removed Clooks hooks from ~/.claude/settings.json (22 events).'),
      ),
    ).toBe(true)
    expect(
      successCalls.some((msg: string) =>
        msg.includes(
          `Removed Clooks hooks from ${join(fakeHome, '.codex/hooks.json')} (${CODEX_REGISTRATION_EVENTS.length} events).`,
        ),
      ),
    ).toBe(true)
  })

  test('--global --agent all --unhook --force removes both registrations and both flags', async () => {
    setupGlobal(fakeHome)
    setupCodexGlobal(fakeHome)
    writeFileSync(join(fakeHome, '.clooks', '.global-entrypoint-active'), '')
    writeFileSync(join(fakeHome, '.clooks', '.global-entrypoint-active.codex'), '')

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--global', '--agent', 'all', '--unhook', '--force'], {
      from: 'user',
    })

    expect(readHomeSettings().hooks).toBeUndefined()
    expect(readHomeCodexHooks().hooks).toBeUndefined()
    expect(existsSync(join(fakeHome, '.clooks', '.global-entrypoint-active'))).toBe(false)
    expect(existsSync(join(fakeHome, '.clooks', '.global-entrypoint-active.codex'))).toBe(false)
  })

  test('--global --agent codex --unhook --json --force reports global flag removal', async () => {
    setupCodexGlobal(fakeHome)
    writeFileSync(join(fakeHome, '.clooks', '.global-entrypoint-active.codex'), '')

    const program = createTestProgram()
    await program.parseAsync(
      ['--json', 'uninstall', '--global', '--agent', 'codex', '--unhook', '--force'],
      { from: 'user' },
    )

    const output = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('')
    const parsed = JSON.parse(output.trim())

    expect(parsed.data.agent).toBe('codex')
    expect(parsed.data.codexEventsRemoved).toHaveLength(CODEX_REGISTRATION_EVENTS.length)
    expect(parsed.data.globalFlagsRemoved).toEqual(['codex'])
  })

  test('--global --agent codex --unhook --force human output omits hook zero-count line when only flag is removed', async () => {
    mkdirSync(join(fakeHome, '.clooks'), { recursive: true })
    writeFileSync(join(fakeHome, '.clooks', '.global-entrypoint-active.codex'), '')

    const clack = await import('@clack/prompts')
    const successMock = clack.log.success as unknown as ReturnType<typeof mock>
    const infoMock = clack.log.info as unknown as ReturnType<typeof mock>
    successMock.mockClear()
    infoMock.mockClear()

    const program = createTestProgram()
    await program.parseAsync(['uninstall', '--global', '--agent', 'codex', '--unhook', '--force'], {
      from: 'user',
    })

    const successCalls = successMock.mock.calls.map((c: unknown[]) => String(c[0]))
    const infoCalls = infoMock.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(
      successCalls.some((msg: string) =>
        msg.includes('Removed Clooks hooks from ~/.codex/hooks.json (0 events).'),
      ),
    ).toBe(false)
    expect(
      infoCalls.some((msg: string) => msg.includes('Removed 1 global entrypoint flag(s).')),
    ).toBe(true)
  })

  test('--project and --global together errors', async () => {
    const program = createTestProgram()
    await program
      .parseAsync(['uninstall', '--project', '--global', '--full', '--force'], { from: 'user' })
      .catch(() => {})

    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})

const cleanupQuestion =
  'Remove all Claude Code and Codex Clooks hook registrations before deleting the shared directory?'

describe('shared runtime deletion', () => {
  for (const scope of ['project', 'global'] as const) {
    function fixture(agents: readonly string[] = ['claude-code', 'codex']) {
      const root = scope === 'project' ? tempDir : fakeHome
      if (agents.includes('claude-code')) {
        if (scope === 'project') setupProject(root)
        else setupGlobal(root)
      }
      if (agents.includes('codex')) {
        if (scope === 'project') setupCodexProject(root)
        else setupCodexGlobal(root)
      }
      const custom = join(root, '.clooks/hooks/custom.ts')
      writeFileSync(custom, 'export const sentinel = "preserve me"\n')
      if (scope === 'global') {
        writeFileSync(join(root, '.clooks/.global-entrypoint-active'), 'claude sentinel')
        writeFileSync(join(root, '.clooks/.global-entrypoint-active.codex'), '')
      }
      const claude = join(root, '.claude/settings.json')
      const codex = join(root, '.codex/hooks.json')
      const before = new Map(
        [
          claude,
          codex,
          custom,
          join(root, '.clooks/bin/entrypoint.sh'),
          ...(scope === 'global'
            ? [
                join(root, '.clooks/.global-entrypoint-active'),
                join(root, '.clooks/.global-entrypoint-active.codex'),
              ]
            : []),
        ]
          .filter(existsSync)
          .map((path) => [path, readFileSync(path, 'utf8')]),
      )
      return { root, custom, claude, codex, before }
    }

    function unchanged(before: Map<string, string>) {
      for (const [path, bytes] of before) expect(readFileSync(path, 'utf8')).toBe(bytes)
    }

    async function interactive(agent: string, answers: (boolean | symbol)[]) {
      Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true })
      const confirm = clack.confirm as ReturnType<typeof mock>
      confirm.mockReset().mockImplementation(() => {
        throw new Error('Unexpected confirmation prompt')
      })
      for (const answer of answers) confirm.mockImplementationOnce(() => answer)
      ;(clack.isCancel as unknown as ReturnType<typeof mock>).mockImplementation(
        (value: unknown) => typeof value === 'symbol',
      )
      return createTestProgram().parseAsync(['uninstall', `--${scope}`, '--agent', agent], {
        from: 'user',
      })
    }

    async function forced(agent: string, action = '--full') {
      return createTestProgram().parseAsync(
        ['--json', 'uninstall', `--${scope}`, '--agent', agent, action, '--force'],
        { from: 'user' },
      )
    }

    function errorEnvelope() {
      const output = stdoutSpy.mock.calls.map((call: unknown[]) => String(call[0])).join('')
      const envelope = JSON.parse(output.trim())
      expect(envelope.ok).toBe(false)
      expect(exitSpy).toHaveBeenCalledWith(1)
      return envelope.error as string
    }

    for (const agent of ['claude-code', 'codex']) {
      test(`${scope}: declined ${agent} unhook needs fresh consent before all-agent deletion`, async () => {
        const { root, claude, codex } = fixture()
        await interactive(agent, [false, true, true])
        expect(clack.confirm).toHaveBeenLastCalledWith({
          message:
            scope === 'project'
              ? cleanupQuestion
              : `Remove all Claude Code and Codex Clooks hook registrations at ${claude}, ${codex} before deleting the shared directory?`,
          initialValue: false,
        })
        expect(JSON.parse(readFileSync(claude, 'utf8')).hooks).toBeUndefined()
        expect(JSON.parse(readFileSync(codex, 'utf8')).hooks).toBeUndefined()
        expect(existsSync(join(root, '.clooks'))).toBe(false)
        expect(exitSpy).not.toHaveBeenCalled()
      })

      for (const selectedConsent of [false, true]) {
        test(`${scope}: refusing required cleanup after ${agent} unhook=${selectedConsent} preserves all bytes`, async () => {
          const { before, claude, codex } = fixture()
          await interactive(agent, [selectedConsent, true, false])
          expect(clack.confirm).toHaveBeenLastCalledWith({
            message:
              scope === 'project'
                ? cleanupQuestion
                : `Remove all Claude Code and Codex Clooks hook registrations at ${claude}, ${codex} before deleting the shared directory?`,
            initialValue: false,
          })
          unchanged(before)
          expect(exitSpy).not.toHaveBeenCalled()
        })
      }

      test(`${scope}: other-agent-only installation requires consent with selector ${agent}`, async () => {
        const other = agent === 'codex' ? 'claude-code' : 'codex'
        const { root, claude, codex } = fixture([other])
        await interactive(agent, [true, true])
        expect(clack.confirm).toHaveBeenCalledTimes(2)
        expect(clack.confirm).toHaveBeenLastCalledWith({
          message:
            scope === 'project'
              ? cleanupQuestion
              : `Remove all Claude Code and Codex Clooks hook registrations at ${claude}, ${codex} before deleting the shared directory?`,
          initialValue: false,
        })
        expect(existsSync(join(root, '.clooks'))).toBe(false)
      })

      test(`${scope}: selected ${agent} unhook ignores malformed unselected data`, async () => {
        const state = fixture()
        const otherPath = agent === 'codex' ? state.claude : state.codex
        writeFileSync(otherPath, '{"hooks":null}\n')
        await forced(agent, '--unhook')
        const selectedPath = agent === 'codex' ? state.codex : state.claude
        expect(JSON.parse(readFileSync(selectedPath, 'utf8')).hooks).toBeUndefined()
        expect(readFileSync(otherPath, 'utf8')).toBe('{"hooks":null}\n')
        expect(readFileSync(state.custom, 'utf8')).toBe(state.before.get(state.custom)!)
        expect(exitSpy).not.toHaveBeenCalled()
      })

      test(`${scope}: malformed other-agent file prevents any full cleanup for ${agent}`, async () => {
        const state = fixture()
        const path = agent === 'codex' ? state.claude : state.codex
        const invalid = '{"hooks":{"FutureEvent":null}}\n'
        writeFileSync(path, invalid)
        state.before.set(path, invalid)
        await expect(forced(agent)).rejects.toThrow('process.exit called')
        expect(errorEnvelope()).toContain(path)
        unchanged(state.before)
      })

      test(`${scope}: owned unknown event on ${agent} prevents deletion before any write`, async () => {
        const state = fixture()
        const path = agent === 'codex' ? state.codex : state.claude
        const settings = JSON.parse(readFileSync(path, 'utf8'))
        settings.hooks.FutureEvent = settings.hooks.PreToolUse
        const bytes = JSON.stringify(settings, null, 3) + '\n'
        writeFileSync(path, bytes)
        state.before.set(path, bytes)
        await expect(forced('all')).rejects.toThrow('process.exit called')
        const error = errorEnvelope()
        expect(error).toContain(path)
        expect(error).toContain('FutureEvent')
        unchanged(state.before)
      })

      for (const installed of [['claude-code'], ['codex'], ['claude-code', 'codex']]) {
        test(`${scope}: force full ${agent} cleans ${installed.join('+')} and keeps requested JSON selector`, async () => {
          const { root } = fixture(installed)
          await forced(agent)
          const output = stdoutSpy.mock.calls.map((call: unknown[]) => String(call[0])).join('')
          const { data } = JSON.parse(output.trim())
          expect(data.agent).toBe(agent)
          expect(data.agents).toEqual([agent])
          expect(data.eventsRemoved).toEqual(data.claudeEventsRemoved)
          expect(data.nonClooksPreserved).toBe(data.claudeNonClooksPreserved)
          expect(data.claudeEventsRemoved.length > 0).toBe(installed.includes('claude-code'))
          expect(data.codexEventsRemoved.length > 0).toBe(installed.includes('codex'))
          expect(existsSync(join(root, '.clooks'))).toBe(false)
          expect(exitSpy).not.toHaveBeenCalled()
        })
      }
    }

    for (const step of [0, 1, 2]) {
      test(`${scope}: cancellation at confirmation ${step + 1} preserves registrations and runtime`, async () => {
        const { before } = fixture()
        const answers: (boolean | symbol)[] = [true, true, true]
        answers[step] = Symbol('cancel')
        await expect(interactive('codex', answers.slice(0, step + 1))).rejects.toThrow(
          'Operation cancelled.',
        )
        expect(clack.confirm).toHaveBeenCalledTimes(step + 1)
        unchanged(before)
        expect(exitSpy).not.toHaveBeenCalled()
      })
    }

    test(`${scope}: all-agent consent already granted needs no redundant cleanup prompt`, async () => {
      const { root } = fixture()
      await interactive('all', [true, true])
      expect(clack.confirm).toHaveBeenCalledTimes(2)
      expect(existsSync(join(root, '.clooks'))).toBe(false)
    })

    test(`${scope}: full cleanup leaves the opposite scope unchanged`, async () => {
      const { root } = fixture()
      const otherRoot = scope === 'project' ? fakeHome : tempDir
      if (scope === 'project') {
        setupGlobal(otherRoot)
        setupCodexGlobal(otherRoot)
      } else {
        setupProject(otherRoot)
        setupCodexProject(otherRoot)
      }
      const paths = [
        join(otherRoot, '.claude/settings.json'),
        join(otherRoot, '.codex/hooks.json'),
        join(otherRoot, '.clooks/bin/entrypoint.sh'),
        join(otherRoot, '.clooks/hooks/custom.ts'),
        join(otherRoot, '.clooks/.global-entrypoint-active'),
        join(otherRoot, '.clooks/.global-entrypoint-active.codex'),
      ]
      for (const path of paths.slice(3)) writeFileSync(path, 'opposite-scope sentinel')
      const before = new Map(paths.map((path) => [path, readFileSync(path, 'utf8')]))
      await forced('all')
      unchanged(before)
      expect(existsSync(join(root, '.clooks'))).toBe(false)
    })

    for (const agent of ['claude-code', 'codex', 'all']) {
      test(`${scope}: unrelated-only ${agent} counts do not depend on removed hooks or flags`, async () => {
        const state = fixture()
        for (const path of [state.claude, state.codex]) {
          writeFileSync(
            path,
            JSON.stringify({
              hooks: {
                PreToolUse: [
                  { hooks: [{ type: 'command', command: '/usr/bin/true' }] },
                  { hooks: [] },
                ],
              },
            }),
          )
        }
        await forced(agent, '--unhook')
        const output = stdoutSpy.mock.calls.map((call: unknown[]) => String(call[0])).join('')
        const { data } = JSON.parse(output.trim())
        expect(data.claudeNonClooksPreserved).toBe(agent === 'codex' ? 0 : 2)
        expect(data.codexNonClooksPreserved).toBe(agent === 'claude-code' ? 0 : 2)
        expect(data.nonClooksPreserved).toBe(data.claudeNonClooksPreserved)
        expect(data.eventsRemoved).toEqual([])
        expect(data.claudeEventsRemoved).toEqual([])
        expect(data.codexEventsRemoved).toEqual([])
        expect(data.unhooked).toBe(scope === 'global')
        expect(data.deleted).toBe(false)
        if (scope === 'global') {
          expect(data.globalFlagsRemoved).toEqual(
            agent === 'all' ? ['claude-code', 'codex'] : [agent],
          )
        }
        expect(existsSync(join(state.root, '.clooks'))).toBe(true)
      })
    }

    test(`${scope}: second registration write failure retains runtime and allows retry`, async () => {
      const state = fixture()
      const claudeFlag = join(state.root, '.clooks/.global-entrypoint-active')
      const codexFlag = join(state.root, '.clooks/.global-entrypoint-active.codex')
      if (scope === 'global') {
        writeFileSync(claudeFlag, '')
        writeFileSync(codexFlag, '')
      }
      const rename = fs.renameSync
      const renameSpy = spyOn(fs, 'renameSync').mockImplementation((from, to) => {
        if (String(to) === state.codex) throw new Error(`Injected rename failure: ${to}`)
        return rename(from, to)
      })
      await expect(forced('all')).rejects.toThrow('process.exit called')
      expect(errorEnvelope()).toContain('Injected rename failure')
      expect(JSON.parse(readFileSync(state.claude, 'utf8')).hooks).toBeUndefined()
      expect(readFileSync(state.codex, 'utf8')).toBe(state.before.get(state.codex)!)
      expect(readFileSync(state.custom, 'utf8')).toBe(state.before.get(state.custom)!)
      expect(existsSync(join(state.root, '.clooks/bin/entrypoint.sh'))).toBe(true)
      if (scope === 'global') {
        expect(existsSync(claudeFlag)).toBe(false)
        expect(existsSync(codexFlag)).toBe(true)
      }
      renameSpy.mockRestore()
      stdoutSpy.mockClear()
      exitSpy.mockClear()
      await forced('all')
      expect(existsSync(join(state.root, '.clooks'))).toBe(false)
      expect(exitSpy).not.toHaveBeenCalled()
    })

    test(`${scope}: remaining-reference recheck catches a hook inserted during cleanup`, async () => {
      const state = fixture()
      const rename = fs.renameSync
      const renameSpy = spyOn(fs, 'renameSync').mockImplementation((from, to) => {
        rename(from, to)
        if (String(to) === state.codex) {
          const original = JSON.parse(state.before.get(state.claude)!)
          writeFileSync(
            state.claude,
            JSON.stringify({ hooks: { FutureEvent: original.hooks.PreToolUse } }),
          )
        }
      })
      await expect(forced('all')).rejects.toThrow('process.exit called')
      const error = errorEnvelope()
      expect(error).toContain(state.claude)
      expect(error).toContain('FutureEvent')
      expect(readFileSync(state.custom, 'utf8')).toBe(state.before.get(state.custom)!)
      renameSpy.mockRestore()
    })
  }

  for (const agent of ['claude-code', 'codex']) {
    test(`global: ${agent} flag removal failure retains runtime and is retryable`, async () => {
      setupGlobal(fakeHome)
      setupCodexGlobal(fakeHome)
      const flag = join(
        fakeHome,
        '.clooks',
        agent === 'codex' ? '.global-entrypoint-active.codex' : '.global-entrypoint-active',
      )
      const flagBytes = agent === 'codex' ? '' : 'sentinel'
      writeFileSync(flag, flagBytes)
      const custom = join(fakeHome, '.clooks/hooks/custom.ts')
      writeFileSync(custom, 'preserve me')
      const unlink = fs.unlinkSync
      const unlinkSpy = spyOn(fs, 'unlinkSync').mockImplementation((path) => {
        if (String(path) === flag) throw new Error(`Injected flag failure: ${path}`)
        return unlink(path)
      })
      const args = ['--json', 'uninstall', '--global', '--agent', 'all', '--full', '--force']
      await expect(createTestProgram().parseAsync(args, { from: 'user' })).rejects.toThrow(
        'process.exit called',
      )
      expect(stdoutSpy.mock.calls.map((call: unknown[]) => String(call[0])).join('')).toContain(
        'Injected flag failure',
      )
      expect(readFileSync(custom, 'utf8')).toBe('preserve me')
      expect(readFileSync(flag, 'utf8')).toBe(flagBytes)
      unlinkSpy.mockRestore()
      exitSpy.mockClear()
      await createTestProgram().parseAsync(args, { from: 'user' })
      expect(existsSync(join(fakeHome, '.clooks'))).toBe(false)
      expect(exitSpy).not.toHaveBeenCalled()
    })

    test(`global: stale ${agent} flag with no registration is removed without deleting runtime`, async () => {
      mkdirSync(join(fakeHome, '.clooks'), { recursive: true })
      const flag = join(
        fakeHome,
        '.clooks',
        agent === 'codex' ? '.global-entrypoint-active.codex' : '.global-entrypoint-active',
      )
      writeFileSync(flag, '')
      await createTestProgram().parseAsync(
        ['--json', 'uninstall', '--global', '--agent', agent, '--unhook', '--force'],
        { from: 'user' },
      )
      expect(existsSync(flag)).toBe(false)
      expect(existsSync(join(fakeHome, '.clooks'))).toBe(true)
      expect(existsSync(join(fakeHome, '.claude'))).toBe(false)
      expect(existsSync(join(fakeHome, '.codex'))).toBe(false)
      expect(exitSpy).not.toHaveBeenCalled()
    })
  }
})

describe('uninstall automatic agent selection', () => {
  const foreignRegistration =
    JSON.stringify(
      { hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'echo foreign-hook' }] }] } },
      null,
      2,
    ) + '\n'

  function data() {
    return JSON.parse(
      stdoutSpy.mock.calls
        .map((call: unknown[]) => String(call[0]))
        .join('')
        .trim(),
    ).data
  }

  for (const scope of ['project', 'global'] as const) {
    function root() {
      return scope === 'project' ? tempDir : fakeHome
    }
    function setup(agent: 'claude-code' | 'codex') {
      if (scope === 'project') {
        if (agent === 'codex') setupCodexProject(root())
        else setupProject(root())
      } else if (agent === 'codex') setupCodexGlobal(root())
      else setupGlobal(root())
    }
    function snapshot() {
      return ['.claude/settings.json', '.codex/hooks.json', '.clooks/bin/entrypoint.sh'].map(
        (path) => readFileSync(join(root(), path), 'utf8'),
      )
    }

    for (const agent of ['claude-code', 'codex'] as const) {
      test(`${scope}: detects only ${agent}, reports selection and retains runtime`, async () => {
        setup(agent)
        const otherPath = join(
          root(),
          agent === 'codex' ? '.claude/settings.json' : '.codex/hooks.json',
        )
        mkdirSync(join(otherPath, '..'), { recursive: true })
        writeFileSync(otherPath, foreignRegistration)
        await createTestProgram().parseAsync(
          ['--json', 'uninstall', `--${scope}`, '--unhook', '--force'],
          { from: 'user' },
        )
        expect(data()).toMatchObject({ agent, agents: [agent], unhooked: true, deleted: false })
        expect(
          data()[agent === 'codex' ? 'codexEventsRemoved' : 'claudeEventsRemoved'].length,
        ).toBeGreaterThan(0)
        expect(existsSync(join(root(), '.clooks/bin/entrypoint.sh'))).toBe(true)
        expect(readFileSync(otherPath, 'utf8')).toBe(foreignRegistration)
        expect(clack.select).not.toHaveBeenCalled()
      })
    }

    for (const agent of ['claude-code', 'codex', 'all'] as const) {
      test(`${scope}: picker ${agent} unhooks only selection without a delete offer`, async () => {
        setup('claude-code')
        setup('codex')
        const before = snapshot()
        Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true })
        ;(clack.select as ReturnType<typeof mock>).mockImplementationOnce(() => agent)
        await createTestProgram().parseAsync(['uninstall', `--${scope}`, '--unhook'], {
          from: 'user',
        })
        expect(clack.select).toHaveBeenCalledTimes(1)
        expect(clack.select).toHaveBeenCalledWith(
          expect.objectContaining({
            message: `Which agent registrations do you want to remove in ${scope} scope?`,
          }),
        )
        expect(clack.confirm).toHaveBeenCalledTimes(1)
        for (const [index, target] of (['claude-code', 'codex'] as const).entries()) {
          const path = target === 'codex' ? '.codex/hooks.json' : '.claude/settings.json'
          const bytes = readFileSync(join(root(), path), 'utf8')
          if (agent === 'all' || agent === target) expect(JSON.parse(bytes).hooks).toBeUndefined()
          else expect(bytes).toBe(before[index]!)
        }
        expect(readFileSync(join(root(), '.clooks/bin/entrypoint.sh'), 'utf8')).toBe(before[2]!)
      })
    }

    test(`${scope}: cancelling agent picker preserves both agents and runtime`, async () => {
      setup('claude-code')
      setup('codex')
      const before = snapshot()
      Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true })
      ;(clack.select as ReturnType<typeof mock>).mockImplementationOnce(() => Symbol('cancel'))
      ;(clack.isCancel as unknown as ReturnType<typeof mock>).mockImplementation(
        (value: unknown) => typeof value === 'symbol',
      )
      await expect(
        createTestProgram().parseAsync(['uninstall', `--${scope}`], { from: 'user' }),
      ).rejects.toThrow('Operation cancelled.')
      expect(snapshot()).toEqual(before)
      expect(clack.confirm).not.toHaveBeenCalled()
    })

    for (const tty of [false, true]) {
      test(`${scope}: force full with both agents rejects selection even with tty=${tty}`, async () => {
        setup('claude-code')
        setup('codex')
        const before = snapshot()
        Object.defineProperty(process.stdin, 'isTTY', { value: tty, writable: true })
        await expect(
          createTestProgram().parseAsync(['uninstall', `--${scope}`, '--full', '--force'], {
            from: 'user',
          }),
        ).rejects.toThrow('process.exit called')
        expect(snapshot()).toEqual(before)
        expect(clack.select).not.toHaveBeenCalled()
        expect(clack.confirm).not.toHaveBeenCalled()
        const errors = [
          ...(clack.log.error as ReturnType<typeof mock>).mock.calls.flat(),
          ...stdoutSpy.mock.calls.flat(),
        ].join(' ')
        expect(errors).toContain('--force does not select an agent')
        expect(errors).toContain(
          `Both Claude Code and Codex Clooks registrations found in ${scope} scope. Specify --agent`,
        )
        expect(exitSpy).toHaveBeenCalledWith(1)
      })
    }

    test(`${scope}: neither detected preserves orphan runtime and flags until explicit full`, async () => {
      const dir = join(root(), '.clooks')
      const foreignPaths = ['.claude/settings.json', '.codex/hooks.json'].map((path) =>
        join(root(), path),
      )
      for (const path of foreignPaths) {
        mkdirSync(join(path, '..'), { recursive: true })
        writeFileSync(path, foreignRegistration)
      }
      mkdirSync(join(dir, 'hooks'), { recursive: true })
      writeFileSync(join(dir, 'hooks/keep.ts'), 'orphan sentinel')
      writeFileSync(join(dir, '.global-entrypoint-active'), 'stale')
      Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true })
      await createTestProgram().parseAsync(['uninstall', `--${scope}`], { from: 'user' })
      expect(clack.confirm).not.toHaveBeenCalled()
      expect(clack.select).not.toHaveBeenCalled()
      expect(readFileSync(join(dir, '.global-entrypoint-active'), 'utf8')).toBe('stale')
      await createTestProgram().parseAsync(
        ['--json', 'uninstall', `--${scope}`, '--unhook', '--force'],
        { from: 'user' },
      )
      expect(data()).toMatchObject({ agent: null, agents: [], unhooked: false, deleted: false })
      expect(readFileSync(join(dir, 'hooks/keep.ts'), 'utf8')).toBe('orphan sentinel')
      expect(foreignPaths.map((path) => readFileSync(path, 'utf8'))).toEqual([
        foreignRegistration,
        foreignRegistration,
      ])
      stdoutSpy.mockClear()
      await createTestProgram().parseAsync(
        ['--json', 'uninstall', `--${scope}`, '--full', '--force'],
        { from: 'user' },
      )
      expect(data()).toMatchObject({ agent: null, agents: [], deleted: true })
      expect(existsSync(dir)).toBe(false)
      expect(foreignPaths.map((path) => readFileSync(path, 'utf8'))).toEqual([
        foreignRegistration,
        foreignRegistration,
      ])
    })

    test(`${scope}: unhook/full conflict is rejected interactively without writes`, async () => {
      setup('claude-code')
      setup('codex')
      const before = snapshot()
      Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true })
      await expect(
        createTestProgram().parseAsync(['uninstall', `--${scope}`, '--unhook', '--full'], {
          from: 'user',
        }),
      ).rejects.toThrow('process.exit called')
      expect(snapshot()).toEqual(before)
      expect(clack.select).not.toHaveBeenCalled()
      expect(clack.confirm).not.toHaveBeenCalled()
    })
  }

  test('explicit Claude global unhook does not resolve malformed CODEX_HOME or Codex settings', async () => {
    setupGlobal(fakeHome)
    mkdirSync(join(fakeHome, '.codex'))
    writeFileSync(join(fakeHome, '.codex/hooks.json'), '{broken')
    process.env.CODEX_HOME = 'relative-invalid-home'
    await createTestProgram().parseAsync(
      ['--json', 'uninstall', '--global', '--agent', 'claude-code', '--unhook', '--force'],
      { from: 'user' },
    )
    expect(data()).toMatchObject({ agent: 'claude-code', unhooked: true, deleted: false })
    expect(readFileSync(join(fakeHome, '.codex/hooks.json'), 'utf8')).toBe('{broken')
  })

  test('global detection selects effective Codex home, not default or tracked home', async () => {
    setupCodexGlobal(fakeHome)
    const defaultPath = join(fakeHome, '.codex/hooks.json')
    const before = readFileSync(defaultPath, 'utf8')
    registrationState.trackCodexHome(fakeHome, join(fakeHome, '.codex'))
    process.env.CODEX_HOME = join(tempDir, 'effective-codex')
    await createTestProgram().parseAsync(
      ['--json', 'uninstall', '--global', '--unhook', '--force'],
      { from: 'user' },
    )
    expect(data()).toMatchObject({ agent: null, agents: [], unhooked: false })
    expect(readFileSync(defaultPath, 'utf8')).toBe(before)
    expect(registrationState.readCodexTrackedHome(fakeHome)).toEqual({
      kind: 'home',
      codexHome: join(fakeHome, '.codex'),
    })
    registerCodexClooks(process.env.CODEX_HOME, makeCodexGlobalEntrypointCommand(fakeHome))
    stdoutSpy.mockClear()
    await createTestProgram().parseAsync(
      ['--json', 'uninstall', '--global', '--unhook', '--force'],
      { from: 'user' },
    )
    expect(data()).toMatchObject({ agent: 'codex', unhooked: true })
    expect(
      JSON.parse(readFileSync(join(process.env.CODEX_HOME, 'hooks.json'), 'utf8')).hooks,
    ).toBeUndefined()
    expect(readFileSync(defaultPath, 'utf8')).toBe(before)
  })

  test('scope both detects different sole agents independently', async () => {
    setupCodexProject(tempDir)
    setupGlobal(fakeHome)
    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true })
    ;(clack.select as ReturnType<typeof mock>).mockImplementationOnce(() => 'both')
    await createTestProgram().parseAsync(['uninstall', '--unhook'], { from: 'user' })
    expect(readCodexHooks(tempDir).hooks).toBeUndefined()
    expect(readHomeSettings().hooks).toBeUndefined()
    expect(clack.select).toHaveBeenCalledTimes(1)
    expect(clack.confirm).toHaveBeenCalledTimes(2)
    expect(existsSync(join(tempDir, '.clooks'))).toBe(true)
    expect(existsSync(join(fakeHome, '.clooks'))).toBe(true)
  })
})

describe('clooks uninstall — scope picker', () => {
  for (const cancel of [false, true]) {
    test(`both scopes: completed project cleanup survives global ${cancel ? 'cancellation' : 'decline'}`, async () => {
      setupProject(tempDir)
      setupGlobal(fakeHome)
      setupCodexGlobal(fakeHome)
      const paths = [
        join(fakeHome, '.claude/settings.json'),
        join(fakeHome, '.codex/hooks.json'),
        join(fakeHome, '.clooks/bin/entrypoint.sh'),
        join(fakeHome, '.clooks/hooks/custom.ts'),
      ]
      writeFileSync(paths[3]!, 'global sentinel')
      const before = paths.map((path) => readFileSync(path, 'utf8'))
      Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true })
      ;(clack.select as ReturnType<typeof mock>).mockImplementationOnce(() => 'both')
      ;(clack.select as ReturnType<typeof mock>).mockImplementationOnce(() => 'claude-code')
      const confirm = clack.confirm as ReturnType<typeof mock>
      for (const answer of [true, true, true, true, cancel ? Symbol('cancel') : false]) {
        confirm.mockImplementationOnce(() => answer)
      }
      ;(clack.isCancel as unknown as ReturnType<typeof mock>).mockImplementation(
        (value: unknown) => typeof value === 'symbol',
      )
      const operation = createTestProgram().parseAsync(['uninstall'], { from: 'user' })
      if (cancel) await expect(operation).rejects.toThrow('Operation cancelled.')
      else await operation
      expect(existsSync(join(tempDir, '.clooks'))).toBe(false)
      expect(readSettings(tempDir).hooks).toBeUndefined()
      for (const [index, path] of paths.entries()) {
        expect(readFileSync(path, 'utf8')).toBe(before[index]!)
      }
      expect(clack.confirm).toHaveBeenCalledTimes(5)
      if (!cancel) {
        expect(clack.log.info).toHaveBeenCalledWith(`Nothing changed in ${fakeHome}.`)
      }
      expect(exitSpy).not.toHaveBeenCalled()
    })
  }

  test('no flags in interactive mode shows scope picker', async () => {
    setupProject(tempDir)

    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true })

    const clack = await import('@clack/prompts')
    const selectMock = clack.select as unknown as ReturnType<typeof mock>
    selectMock.mockImplementationOnce(() => 'project')

    const confirmMock = clack.confirm as unknown as ReturnType<typeof mock>
    confirmMock.mockImplementationOnce(() => true) // unhook
    confirmMock.mockImplementationOnce(() => true) // delete

    const program = createTestProgram()
    await program.parseAsync(['uninstall'], { from: 'user' })

    // select was called
    expect(selectMock).toHaveBeenCalled()

    // project was uninstalled
    expect(existsSync(join(tempDir, '.clooks'))).toBe(false)
  })

  test("scope picker with 'both' uninstalls project and global", async () => {
    setupProject(tempDir)
    setupGlobal(fakeHome)

    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true })

    const clack = await import('@clack/prompts')
    const selectMock = clack.select as unknown as ReturnType<typeof mock>
    selectMock.mockImplementationOnce(() => 'both')

    const confirmMock = clack.confirm as unknown as ReturnType<typeof mock>
    // Project: unhook + delete
    confirmMock.mockImplementationOnce(() => true)
    confirmMock.mockImplementationOnce(() => true)
    // Global: unhook + delete
    confirmMock.mockImplementationOnce(() => true)
    confirmMock.mockImplementationOnce(() => true)

    const program = createTestProgram()
    await program.parseAsync(['uninstall'], { from: 'user' })

    // Both project and global should be uninstalled
    expect(existsSync(join(tempDir, '.clooks'))).toBe(false)
    expect(existsSync(join(fakeHome, '.clooks'))).toBe(false)
  })

  test('no flags in non-interactive mode errors', async () => {
    const program = createTestProgram()
    await program.parseAsync(['--json', 'uninstall'], { from: 'user' }).catch(() => {})

    expect(exitSpy).toHaveBeenCalledWith(1)

    const calls = stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0]))
    const jsonLine = calls.find((s: string) => s.includes('"ok"'))
    expect(jsonLine).toBeDefined()
    const parsed = JSON.parse(jsonLine!.trim())
    expect(parsed.ok).toBe(false)
    expect(parsed.error).toContain('requires --force')
  })
})
