import { describe, expect, test } from 'bun:test'
import { parseTOML, type AST } from 'toml-eslint-parser'
import {
  editClooksServer,
  readClooksServer,
  type ClooksServerRegistration,
} from './registration-toml.js'

const registration: ClooksServerRegistration = {
  command: '/a clone with spaces/clooks',
  args: ['mcp', 'quote"', 'line\n', '\\'],
  startup_timeout_sec: 10,
  tool_timeout_sec: 330,
}
const parse = (source: string) => parseTOML(source, { tomlVersion: '1.0.0' })
const unrelated = `# document comment
title = "keep" # inline comment
large = 9007199254740993
offset = 1979-05-27T07:32:00-07:00
local = 1979-05-27T07:32:00
date = 1979-05-27
time = 07:32:00
text = """first
[mcp_servers.clooks]
last"""
literal = '''first
"mcp_servers".clooks.command = "fake"
last'''
"quoted.key" = { nested = { answer = 42 } }
ratio = 1.00
`
const tail =
  '\n[unrelated.sibling]\ncommand = "keep" # sibling comment\n[[unrelated.array]]\nvalue = 123\n'
const forms = {
  absent: '',
  table:
    '[mcp_servers.clooks] # header comment\ncommand = "old" # command comment\nargs = ["old"]\n[mcp_servers.clooks.env]\nTOKEN = "preserve" # env comment\n',
  dotted: 'mcp_servers.clooks.command = "old"\nmcp_servers.clooks.env.TOKEN = "preserve"\n',
  quoted: '["mcp_servers".\'clooks\']\ncommand = "old"\nenv = { TOKEN = "preserve" }\n',
  escaped: '["mcp_servers"."cloo\\u006bs"]\n"comm\\u0061nd" = "old"\n',
  inlineFirst:
    'mcp_servers = { clooks = { command = "old", env = { TOKEN = "preserve" } }, other = { command = "keep" } }\n',
  inlineLast:
    'mcp_servers = { other = { command = "keep" }, clooks = { command = "old", env = { TOKEN = "preserve" } } }\n',
  inlineOnly: 'mcp_servers = { clooks = { command = "old", env = { TOKEN = "preserve" } } }\n',
  inlineAbsent: 'mcp_servers = { other = { command = "keep" } }\n',
  inlineParent: '[mcp_servers]\nclooks = { command = "old", env = { TOKEN = "preserve" } }\n',
  inlineDotted:
    'mcp_servers = { clooks.command = "old", other.command = "keep", clooks.env.TOKEN = "preserve", clooks.enabled = false }\n',
  dottedInline: 'mcp_servers.clooks = { env = { TOKEN = "preserve" } }\n',
  parent: '[mcp_servers]\nclooks.env.TOKEN = "preserve"\n[other]\nx = 1\n',
  envOnly: '[mcp_servers.clooks.env]\nTOKEN = "preserve"\n',
  emptyChild: '[mcp_servers.clooks.env]\n[mcp_servers.clooks]\n',
  empty: '[mcp_servers.clooks]\n',
  comments:
    '[mcp_servers.clooks]\nargs = [ # array comment\n "old", # item comment\n]\nstartup_timeout_sec = 2\ntool_timeout_sec = 3\n',
  inlineComments:
    'mcp_servers = { clooks = { args = [ # nested array comment\n "old" # nested item comment\n] }, other.command = "keep" }\n',
}

function expectCommentsPreserved(before: string, after: string) {
  expect(parse(after).comments.map((comment) => after.slice(...comment.range))).toEqual(
    parse(before).comments.map((comment) => before.slice(...comment.range)),
  )
}

describe('registration TOML normal forms', () => {
  for (const [name, form] of Object.entries(forms)) {
    for (const newline of ['\n', '\r\n']) {
      for (const trailing of [false, true]) {
        test(`${name}, ${newline === '\n' ? 'LF' : 'CRLF'}, ${trailing ? 'newline' : 'EOF'}`, () => {
          const normalize = (s: string) => s.replaceAll('\n', newline)
          const suffix = normalize(trailing ? tail : tail.slice(0, -1))
          const source = normalize(unrelated + form) + suffix
          const output = editClooksServer(source, structuredClone(registration))
          expect(output.startsWith(normalize(unrelated))).toBe(true)
          expect(output.endsWith(suffix)).toBe(true)
          expect(readClooksServer(output)).toMatchObject(registration)
          if (form.includes('TOKEN')) {
            expect(readClooksServer(output)?.env).toEqual({ TOKEN: 'preserve' })
          }
          expect(editClooksServer(output, structuredClone(registration))).toBe(output)
          expectCommentsPreserved(source, output)
          const large = parse(output).body[0].body.find(
            (node) =>
              node.type === 'TOMLKeyValue' &&
              node.key.keys[0]?.type === 'TOMLBare' &&
              node.key.keys[0].name === 'large',
          ) as AST.TOMLKeyValue
          expect((large.value as AST.TOMLIntegerValue).bigint).toBe(9007199254740993n)
          const removed = editClooksServer(output, null)
          expect(readClooksServer(removed)).toBeUndefined()
          expect(editClooksServer(removed, null)).toBe(removed)
          expect(removed.startsWith(normalize(unrelated))).toBe(true)
          expect(removed.endsWith(suffix)).toBe(true)
          expectCommentsPreserved(source, removed)
          if (form.includes('other')) expect(removed).toContain('"keep"')
        })
      }
    }
  }
})

test('empty and unterminated final lines can be edited and removed', () => {
  for (const source of [
    '',
    '# comment',
    '[mcp_servers.clooks]',
    'mcp_servers = {}',
    'mcp_servers.clooks.command = "old"',
    '[mcp_servers.clooks]\r\ncommand = "old"',
  ]) {
    const output = editClooksServer(source, registration)
    expect(readClooksServer(output)).toEqual(registration)
    expect(editClooksServer(output, registration)).toBe(output)
    expect(readClooksServer(editClooksServer(output, null))).toBeUndefined()
    expectCommentsPreserved(source, output)
    if (source) expect(output.endsWith('\n')).toBe(false)
    if (source.includes('\r\n')) expect(output.replaceAll('\r\n', '')).not.toContain('\n')
  }
})

test('no-op compares decoded values without changing spelling, comments or EOF', () => {
  const source = `[mcp_servers.clooks]\r\ncommand = 'clooks'\r\nargs = [ # keep\r\n 'mcp',\r\n]\r\nstartup_timeout_sec = 0x0a\r\ntool_timeout_sec = 3.30e2`
  expect(editClooksServer(source, { ...registration, command: 'clooks', args: ['mcp'] })).toBe(
    source,
  )
  for (const absent of [
    '',
    '# nothing',
    '[mcp_servers.other]\ncommand = "other"',
    'mcp_servers = {}',
  ]) {
    expect(readClooksServer(absent)).toBeUndefined()
    expect(editClooksServer(absent, null)).toBe(absent)
  }
})

test('only four owned value spans change, preserving unknown fields and disabled state', () => {
  const source = `[mcp_servers.clooks]
command = 'old' # command
args = ['old'] # args
startup_timeout_sec = 1 # startup
tool_timeout_sec = 2 # tool
enabled = false
url = 'https://foreign.example/mcp'
unknown = { huge = 9007199254740993, date = 1979-05-27, ratio = 1.00 }
[mcp_servers.clooks.env]
TOKEN = 'keep'
`
  const output = editClooksServer(source, { ...registration, command: 'clooks', args: ['mcp'] })
  expect(output).toBe(
    source
      .replace("command = 'old'", 'command = "clooks"')
      .replace("args = ['old']", 'args = ["mcp"]')
      .replace('startup_timeout_sec = 1', 'startup_timeout_sec = 10')
      .replace('tool_timeout_sec = 2', 'tool_timeout_sec = 330'),
  )
  const server = readClooksServer(output)
  expect(server?.enabled).toBe(false)
  expect(server?.url).toBe('https://foreign.example/mcp')
  expect(server?.unknown).toMatchObject({ huge: 9007199254740993n, ratio: 1 })
  expect(server?.env).toEqual({ TOKEN: 'keep' })
})

test('reader retains empty children regardless of header order and returns only target', () => {
  const source =
    '[mcp_servers.clooks.env.child]\n[mcp_servers.clooks.env]\n[mcp_servers.clooks]\n[other]\nx = 1'
  expect(readClooksServer(source)).toEqual({ env: { child: {} } })
  expect(readClooksServer('[mcp_servers.clooks]\n')).toEqual({})
})

test('decoded paths do not match quoted dots or unrelated array tables', () => {
  const source = `"mcp_servers.clooks" = { command = "keep" }
[mcp_servers."clooks.extra"]
command = "keep"
[[mcp_servers.other]]
command = "keep"
[mcp_servers.other.clooks]
enabled = false
`
  expect(readClooksServer(source)).toBeUndefined()
  expect(editClooksServer(source, null)).toBe(source)
  const output = editClooksServer(source, registration)
  expect(output.startsWith(source.slice(0, source.indexOf('\n') + 1))).toBe(true)
  expect(output.endsWith(source.slice(source.indexOf('\n') + 1))).toBe(true)
  expect(readClooksServer(output)).toEqual(registration)
})

test('reader treats prototype names as ordinary TOML keys', () => {
  const source = '[mcp_servers.clooks]\n__proto__.polluted = true\nconstructor.prototype = "keep"\n'
  const server = readClooksServer(source)
  expect(server?.__proto__).toEqual({ polluted: true })
  expect(server?.constructor as unknown).toEqual({ prototype: 'keep' })
  expect(Object.hasOwn({}, 'polluted')).toBe(false)
  expect(readClooksServer(editClooksServer(source, registration))).toMatchObject(server!)
})

describe('fail closed', () => {
  for (const source of [
    'x = [',
    'x = 1\nx = 2',
    '[mcp_servers.clooks]\ncommand = "a"\ncommand = "b"',
    'mcp_servers = { clooks = {}, clooks = {} }',
    '[mcp_servers.clooks]\n[mcp_servers.clooks]',
    'mcp_servers = 1',
    'mcp_servers = []',
    'mcp_servers.clooks = "foreign"',
    'mcp_servers = { clooks = [] }',
    '[mcp_servers]\nclooks = [{ command = "foreign" }]',
    '[[mcp_servers]]\n',
    '[[mcp_servers.clooks]]\ncommand = "foreign"',
    '[[mcp_servers.clooks.env]]\nTOKEN = "foreign"',
    '[mcp_servers.clooks]\ncommand = 1',
    '[mcp_servers.clooks]\nargs = ["mcp", 1]',
    '[mcp_servers.clooks]\nargs = "mcp"',
    '[mcp_servers.clooks.command]\nx = 1',
    '[mcp_servers.clooks]\nstartup_timeout_sec = "10"',
    '[mcp_servers.clooks]\ntool_timeout_sec = inf',
  ]) {
    test(JSON.stringify(source), () => {
      expect(() => readClooksServer(source)).toThrow()
      expect(() => editClooksServer(source, registration)).toThrow()
      expect(() => editClooksServer(source, null)).toThrow()
    })
  }
})

test('owned strings escape every C0 control, DEL, quotes and backslashes correctly', () => {
  const controls = Array.from({ length: 32 }, (_, i) => String.fromCharCode(i)).join('') + '\x7f'
  const command = `prefix${controls}\\"suffix`
  const args = [controls, '\\u0000', '"', '\u0085\u2028\u2029', '\u{1f600}']
  const output = editClooksServer('', { ...registration, command, args })
  expect(readClooksServer(output)).toEqual({ ...registration, command, args })
  expect(output).not.toContain('\x7f')
  expect(editClooksServer(output, { ...registration, command, args })).toBe(output)
})

test('invalid registration values cannot be silently serialized', () => {
  for (const invalid of [
    { command: '\ud800' },
    { args: ['\udfff'] },
    { command: 1 },
    { args: [1] },
    { args: new Array(1) },
    { startup_timeout_sec: Infinity },
    { tool_timeout_sec: NaN },
    { tool_timeout_sec: undefined },
  ]) {
    expect(() =>
      editClooksServer('', { ...registration, ...invalid } as ClooksServerRegistration),
    ).toThrow()
  }
})

test('numeric timeouts retain their values and no-op semantics', () => {
  for (const timeout of [0, 0.5, 1e-7, 9007199254740992, 1e30]) {
    const value = { ...registration, startup_timeout_sec: timeout, tool_timeout_sec: timeout }
    const output = editClooksServer('', value)
    expect(readClooksServer(output)).toEqual(value)
    expect(editClooksServer(output, value)).toBe(output)
  }
})

test('inline removal preserves exact unrelated sibling spans in each position', () => {
  const before = 'before = { args = ["a", "b"], ratio = 1.00 }'
  const after = 'after = { date = 1979-05-27, big = 9007199254740993 }'
  for (const [body, expected] of [
    [`clooks = {}, ${before}`, ` ${before}`],
    [`${before}, clooks = {}, ${after}`, `${before},  ${after}`],
    [`${before}, clooks = {}`, before],
    ['clooks = {}', ''],
    [`clooks.command = "old", clooks.args = [], ${after}`, `  ${after}`],
  ]) {
    expect(editClooksServer(`mcp_servers = {${body}} # keep`, null)).toBe(
      `mcp_servers = {${expected}} # keep`,
    )
  }
})

test('removal includes separated child sections without changing intervening content', () => {
  const middle = '\n[unrelated]\nvalue = { nested = [1, 2], text = "keep" } # middle\n'
  const source =
    '[mcp_servers.clooks]\ncommand = "old"\n' +
    middle +
    '[mcp_servers.clooks.env]\nTOKEN = "remove"\n'
  const removed = editClooksServer(source, null)
  expect(readClooksServer(removed)).toBeUndefined()
  expect(removed).toContain(middle)
  expect(removed).not.toContain('TOKEN')
  expect(removed).not.toContain('remove')
})
