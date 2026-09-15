import { parseTOML, type AST } from 'toml-eslint-parser'

export type ClooksServerRegistration = {
  command: string
  args: string[]
  startup_timeout_sec: number
  tool_timeout_sec: number
}

type Path = (string | number)[]
type Edit = { start: number; end: number; text: string }
type Entry = { path: Path; node: AST.TOMLKeyValue; container: AST.TOMLInlineTable | null }
const target = ['mcp_servers', 'clooks']
const owned = ['command', 'args', 'startup_timeout_sec', 'tool_timeout_sec'] as const
const prefix = (a: Path, b: Path) => a.length <= b.length && a.every((v, i) => v === b[i])
const equal = (a: Path, b: Path) => a.length === b.length && prefix(a, b)
const keys = (key: AST.TOMLKey) => key.keys.map((k) => (k.type === 'TOMLBare' ? k.name : k.value))
const parse = (source: string) => parseTOML(source, { tomlVersion: '1.0.0' })
const newlineOf = (source: string) => (source.includes('\r\n') ? '\r\n' : '\n')
const record = (): Record<string, unknown> => Object.create(null)

function index(source: string) {
  const ast = parse(source)
  const entries: Entry[] = []
  const tables = ast.body[0].body.filter((node) => node.type === 'TOMLTable')
  const walk = (node: AST.TOMLKeyValue, base: Path, container: Entry['container']) => {
    const path = [...base, ...keys(node.key)]
    if (prefix(path, target) && node.value.type !== 'TOMLInlineTable') {
      throw new Error('mcp_servers.clooks and its ancestors must be tables')
    }
    entries.push({ path, node, container })
    if (node.value.type === 'TOMLInlineTable') {
      for (const child of node.value.body) walk(child, path, node.value)
    }
  }
  for (const node of ast.body[0].body) {
    if (node.type === 'TOMLKeyValue') walk(node, [], null)
    else {
      const path = keys(node.key)
      if (node.kind === 'array' && (prefix(path, target) || prefix(target, path))) {
        throw new Error('mcp_servers.clooks array tables are unsupported')
      }
      for (const child of node.body) walk(child, node.resolvedKey, null)
    }
  }
  return { ast, entries, tables }
}

function put(table: Record<string, unknown>, path: string[], value: unknown) {
  const [key, ...rest] = path
  if (key === undefined) return
  if (rest.length) {
    table[key] ??= record()
    put(table[key] as Record<string, unknown>, rest, value)
  } else table[key] = value
}

function valueOf(node: AST.TOMLContentNode): unknown {
  if (node.type === 'TOMLArray') return node.elements.map(valueOf)
  if (node.type === 'TOMLInlineTable') {
    const result = record()
    for (const child of node.body) put(result, keys(child.key), valueOf(child.value))
    return result
  }
  // Only the target is decoded; unsafe integers remain exact even in its unknown fields.
  if (node.kind === 'integer' && !Number.isSafeInteger(node.value)) return node.bigint
  return node.value
}

function checkFields(server: Record<string, unknown>, required = false) {
  for (const key of owned) {
    if (!required && !Object.hasOwn(server, key)) continue
    const value = server[key]
    const valid =
      key === 'command'
        ? typeof value === 'string'
        : key === 'args'
          ? Array.isArray(value) && Array.from(value).every((item) => typeof item === 'string')
          : typeof value === 'number' && Number.isFinite(value)
    if (!valid) throw new Error(`Invalid mcp_servers.clooks.${key}`)
  }
}

function readIndex({ entries, tables }: ReturnType<typeof index>) {
  let server: Record<string, unknown> | undefined
  for (const table of [...tables].sort((a, b) => a.resolvedKey.length - b.resolvedKey.length)) {
    if (!prefix(target, table.resolvedKey)) continue
    server ??= record()
    put(server, table.resolvedKey.slice(target.length) as string[], record())
  }
  for (const entry of entries) {
    if (!prefix(target, entry.path)) continue
    server ??= record()
    if (equal(target, entry.path)) server = valueOf(entry.node.value) as Record<string, unknown>
    else put(server, entry.path.slice(target.length) as string[], valueOf(entry.node.value))
  }
  if (server) checkFields(server)
  return server
}

/** Read only the target. Invalid TOML and incompatible target shapes throw. */
export function readClooksServer(source: string): Record<string, unknown> | undefined {
  return readIndex(index(source))
}

function apply(source: string, edits: Edit[]) {
  let result = source
  let boundary = source.length
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    if (edit.end > boundary) throw new Error('Overlapping TOML edits')
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end)
    boundary = edit.start
  }
  parse(result)
  return result
}

function quote(value: string): string {
  // JSON escapes C0 controls; TOML additionally forbids literal DEL and lone surrogates.
  if (!value.isWellFormed()) throw new Error('TOML strings require Unicode scalar values')
  return JSON.stringify(value).replaceAll('\x7f', '\\u007f')
}

function encode(value: string | string[] | number): string {
  if (typeof value === 'string') return quote(value)
  if (Array.isArray(value)) return `[${value.map(quote).join(', ')}]`
  // Large JS numbers must remain TOML floats, not be read back as exact bigint integers.
  if (Number.isInteger(value) && !Number.isSafeInteger(value)) return value.toExponential()
  return String(value)
}

function setLeaf(source: string, field: (typeof owned)[number], value: string | string[] | number) {
  const { ast, entries, tables } = index(source)
  const path = [...target, field]
  const existing = entries.find((entry) => equal(entry.path, path))
  let text = encode(value)
  if (existing) {
    const node = existing.node.value
    if (JSON.stringify(valueOf(node)) === JSON.stringify(value)) return source
    const comments = ast.comments.filter(
      (comment) => comment.range[0] >= node.range[0] && comment.range[1] <= node.range[1],
    )
    if (comments.length) {
      const newline = newlineOf(source)
      text = `${text.slice(0, -1)}${newline}${comments.map((c) => source.slice(...c.range)).join(newline)}${newline}]`
    }
    return apply(source, [{ start: node.range[0], end: node.range[1], text }])
  }
  const ancestor = entries
    .filter((entry) => prefix(entry.path, path))
    .sort((a, b) => b.path.length - a.path.length)[0]
  if (ancestor) {
    const table = ancestor.node.value
    if (table.type !== 'TOMLInlineTable') throw new Error('Non-table TOML ancestor')
    const pos = table.range[1] - 1
    const key = path.slice(ancestor.path.length).map(quote).join('.')
    return apply(source, [
      { start: pos, end: pos, text: `${table.body.length ? ', ' : ' '}${key} = ${text} ` },
    ])
  }
  const table = tables
    .filter((table) => prefix(table.resolvedKey, path))
    .sort((a, b) => b.resolvedKey.length - a.resolvedKey.length)[0]
  const next = table ? tables[tables.indexOf(table) + 1] : tables[0]
  const pos = next?.range[0] ?? source.length
  const newline = newlineOf(source)
  const lead = pos > 0 && source[pos - 1] !== '\n' ? newline : ''
  const trail = pos === source.length && pos > 0 && !source.endsWith('\n') ? '' : newline
  const key = path
    .slice(table?.resolvedKey.length ?? 0)
    .map(quote)
    .join('.')
  return apply(source, [{ start: pos, end: pos, text: `${lead}${key} = ${text}${trail}` }])
}

function removeServer(source: string): string {
  const { ast, entries, tables } = index(source)
  const selected = entries.filter((entry) => prefix(target, entry.path))
  const edits: Edit[] = []
  // Delete syntax tokens, leaving all comments and whitespace (including array comments).
  const removeRange = (start: number, end: number) =>
    ast.tokens
      .filter((token) => token.range[0] >= start && token.range[1] <= end)
      .map((token) => ({ start: token.range[0], end: token.range[1], text: '' }))
  for (const entry of selected) {
    if (selected.some((other) => other !== entry && prefix(other.path, entry.path))) continue
    let [start, end] = entry.node.range
    if (entry.container) {
      const siblings = entry.container.body
      const i = siblings.indexOf(entry.node)
      const next = siblings[i + 1]
      const previous = siblings[i - 1]
      const comma = ast.tokens.find(
        (token) =>
          token.value === ',' &&
          (next
            ? token.range[0] >= end && token.range[1] <= next.range[0]
            : previous && token.range[0] >= previous.range[1] && token.range[1] <= start),
      )
      if (comma) {
        start = Math.min(start, comma.range[0])
        end = Math.max(end, comma.range[1])
      }
      const comments = ast.comments.filter(
        (comment) => comment.range[0] >= start && comment.range[1] <= end,
      )
      const inlineEdits: Edit[] = [{ start, end, text: '' }]
      if (comments.length) {
        // Array comments cannot remain loose inside an inline table after its removal.
        let outer: AST.TOMLNode = entry.node
        while (
          outer.parent &&
          outer.parent.type !== 'TOMLTopLevelTable' &&
          outer.parent.type !== 'TOMLTable'
        )
          outer = outer.parent
        const newline = newlineOf(source)
        inlineEdits.push({
          start: outer.range[0],
          end: outer.range[0],
          text: comments.map((comment) => source.slice(...comment.range)).join(newline) + newline,
        })
      }
      // Adjacent inline entries share commas; re-index after each removal.
      return removeServer(apply(source, inlineEdits))
    }
    edits.push(...removeRange(start, end))
  }
  for (const table of tables.filter((table) => prefix(target, table.resolvedKey))) {
    const close = ast.tokens.find(
      (token) => token.value === ']' && token.range[0] >= table.key.range[1],
    )
    if (!close) throw new Error('Missing TOML header close')
    edits.push(...removeRange(table.range[0], close.range[1]))
  }
  return apply(source, edits)
}

/** Edit owned fields only. Ownership/conflict policy belongs to the caller. */
export function editClooksServer(
  source: string,
  registration: ClooksServerRegistration | null,
): string {
  readClooksServer(source)
  if (registration === null) return removeServer(source)
  checkFields({ ...registration }, true)
  for (const field of owned) source = setLeaf(source, field, registration[field])
  return source
}
