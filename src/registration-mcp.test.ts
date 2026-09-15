import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  existsSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assertClaudeRegistrationLayout,
  hasOwnedMcpServer,
  mcpRegistrationPath,
  prepareMcpRegistration,
} from './registration-mcp.js'
import { prepareInitRegistrations } from './commands/init-registration.js'
import { prepareProjectIdentity } from './registration-project.js'
import { prepareRegistrationWrite, readRegistrationText } from './registration-file.js'

let root: string
let saved: NodeJS.ProcessEnv
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'clooks-mcp-registration-'))
  saved = { ...process.env }
  process.env.HOME = root
  delete process.env.CLAUDE_CONFIG_DIR
})
afterEach(() => {
  process.env = saved
  rmSync(root, { recursive: true, force: true })
})

for (const agent of ['claude-code', 'codex'] as const) {
  test(`${agent} server prepare is read-only, commit idempotent, and removal scoped`, () => {
    const path = mcpRegistrationPath(root, agent, false)
    const plan = prepareMcpRegistration(path, agent)
    expect(existsSync(path)).toBe(false)
    expect(plan.changed).toBe(true)
    plan.commit()
    expect(hasOwnedMcpServer(path, agent)).toBe(true)
    const before = readFileSync(path, 'utf8')
    const inode = statSync(path).ino
    const repeated = prepareMcpRegistration(path, agent)
    expect(repeated.changed).toBe(false)
    repeated.commit()
    expect(readFileSync(path, 'utf8')).toBe(before)
    expect(statSync(path).ino).toBe(inode)
    const remove = prepareMcpRegistration(path, agent, true)
    expect(remove.owned).toBe(true)
    remove.commit()
    expect(hasOwnedMcpServer(path, agent)).toBe(false)
    prepareMcpRegistration(path, agent, true).commit()
  })
  test(`${agent} foreign named server is never claimed or deleted`, () => {
    const path = mcpRegistrationPath(root, agent, true)
    mkdirSync(join(root, '.codex'), { recursive: true })
    const bytes =
      agent === 'codex'
        ? '[mcp_servers.clooks]\ncommand="foreign"\nargs=["mcp"]\n'
        : '{"mcpServers":{"clooks":{"command":"foreign","args":["mcp"]}}}\n'
    writeFileSync(path, bytes)
    expect(() => prepareMcpRegistration(path, agent)).toThrow(path)
    expect(hasOwnedMcpServer(path, agent)).toBe(false)
    const removal = prepareMcpRegistration(path, agent, true)
    expect(removal.changed).toBe(false)
    removal.commit()
    expect(readFileSync(path, 'utf8')).toBe(bytes)
  })
  test(`${agent} absent-server removal does not create configuration`, () => {
    const path = mcpRegistrationPath(root, agent, true)
    prepareMcpRegistration(path, agent, true).commit()
    expect(existsSync(path)).toBe(false)
  })
}

test('Claude preserves native disable/trust values and unrelated servers exactly as values', () => {
  const path = join(root, '.mcp.json')
  const document = {
    disabledMcpServers: ['clooks'],
    trust: false,
    mcpServers: {
      foreign: { url: 'https://example.invalid' },
      clooks: {
        type: 'stdio',
        command: 'clooks',
        args: ['mcp'],
        enabled: false,
        env: { KEEP: 'yes' },
      },
    },
  }
  const bytes = '\t' + JSON.stringify(document) + ' \n'
  writeFileSync(path, bytes)
  prepareMcpRegistration(path, 'claude-code').commit()
  expect(readFileSync(path, 'utf8')).toBe(bytes)
  prepareMcpRegistration(path, 'claude-code', true).commit()
  const removed = JSON.parse(readFileSync(path, 'utf8'))
  expect(removed).toEqual({ ...document, mcpServers: { foreign: document.mcpServers.foreign } })
})

test('Codex edits owned timeout leaves without reformatting disabled, env, or unrelated rich TOML', () => {
  const path = join(root, 'config.toml')
  const prefix = '# unrelated\nwhen = 1979-05-27T07:32:00Z\nbig = 9007199254740993\n'
  const bytes =
    prefix +
    '[mcp_servers.clooks]\ncommand = "clooks"\nargs = ["mcp"]\nenabled = false\ntool_timeout_sec = 60 # timeout\n[mcp_servers.clooks.env]\nKEEP = "value"\n'
  writeFileSync(path, bytes)
  prepareMcpRegistration(path, 'codex').commit()
  const updated = readFileSync(path, 'utf8')
  expect(updated.startsWith(prefix)).toBe(true)
  expect(updated).toContain('enabled = false')
  expect(updated).toContain('tool_timeout_sec = 330 # timeout')
  expect(updated).toContain('KEEP = "value"')
})

for (const bytes of ['{invalid', '[]', 'null', '{"mcpServers":[]}']) {
  test(`Claude malformed destination identifies its path before writes: ${bytes}`, () => {
    const path = join(root, '.mcp.json')
    writeFileSync(path, bytes)
    expect(() => prepareMcpRegistration(path, 'claude-code')).toThrow(path)
    expect(readFileSync(path, 'utf8')).toBe(bytes)
  })
}
test('Codex parser errors retain their file path and cause', () => {
  const path = join(root, 'config.toml')
  writeFileSync(path, '[malformed')
  try {
    prepareMcpRegistration(path, 'codex')
    throw new Error('expected parse refusal')
  } catch (error) {
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain(path)
    expect((error as Error).cause).toBeInstanceOf(Error)
  }
})

for (const override of ['', 'default', 'custom']) {
  test(`any defined Claude config override refuses prewrite, including ${override}`, () => {
    process.env.CLAUDE_CONFIG_DIR = override === 'default' ? join(root, '.claude') : override
    expect(() => prepareInitRegistrations(root, root, ['claude-code', 'codex'], true)).toThrow(
      'CLAUDE_CONFIG_DIR',
    )
    expect(existsSync(join(root, '.clooks'))).toBe(false)
    expect(() => prepareInitRegistrations(root, root, ['codex'], true)).not.toThrow()
  })
}
test('legacy Claude config file is refused without changing either native destination', () => {
  mkdirSync(join(root, '.claude'))
  const path = join(root, '.claude/.config.json')
  writeFileSync(path, '{}')
  expect(() => assertClaudeRegistrationLayout(root)).toThrow(path)
  expect(readFileSync(path, 'utf8')).toBe('{}')
  expect(existsSync(join(root, '.claude.json'))).toBe(false)
})

test('all-agent preflight fails before creating identities or runtime files', () => {
  mkdirSync(join(root, '.codex'))
  writeFileSync(join(root, '.codex/config.toml'), '[broken')
  expect(() => prepareInitRegistrations(root, root, ['claude-code', 'codex'], false)).toThrow(
    'config.toml',
  )
  expect(existsSync(join(root, '.claude'))).toBe(false)
  expect(existsSync(join(root, '.mcp.json'))).toBe(false)
  expect(existsSync(join(root, '.clooks'))).toBe(false)
})

test('project owner preparation preserves IDs and refuses malformed or linked identities', () => {
  const first = prepareProjectIdentity(root, 'claude-code')
  expect(existsSync(first.path)).toBe(false)
  first.commit()
  expect(prepareProjectIdentity(root, 'claude-code').owner).toBe(first.owner)
  writeFileSync(first.path, 'broken')
  expect(() => prepareProjectIdentity(root, 'claude-code')).toThrow('invalid project ID')
  rmSync(first.path)
  symlinkSync(join(root, 'missing'), first.path)
  expect(() => prepareProjectIdentity(root, 'claude-code')).toThrow('regular')
})

test('prepared file refuses a concurrent edit and invalid parent paths', () => {
  const path = join(root, 'file')
  writeFileSync(path, 'before')
  const write = prepareRegistrationWrite(path, 'before', 'after')
  writeFileSync(path, 'concurrent')
  expect(() => write.commit()).toThrow('changed during registration')
  expect(readFileSync(path, 'utf8')).toBe('concurrent')
  expect(() => readRegistrationText(join(path, 'child'))).toThrow('directory')
})
