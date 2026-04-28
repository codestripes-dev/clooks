// Renderer for `clooks test example <Event>`.
//
// Produces a prose-and-JSON document that hook authors can read top-to-bottom
// or pipe-extract the JSON block from. Output is documentation, NOT valid JSON
// in full — `jq` does not apply to the full output. Authors copy-paste the
// JSON block out of it.
//
// Structure:
//   # <Event> — example input
//
//   A minimum-viable fixture:
//
//     <indented JSON block>
//
//   Required fields:
//     <name> — <description>
//     ...
//
//   (For tool-keyed events only:)
//   Tool inputs (toolName + toolInput shapes):
//
//     <Tool>:
//       <fieldName>   <type>   <description>
//       ...
//
//     ExitPlanMode and any mcp__* tool: <fallback note>
//
//   Optional keys — provided during real Claude Code invocations,
//   optional when running `clooks test`. The harness fills these in with
//   deterministic defaults; override only when your hook reads them.
//
//     <fieldName>   <type>   <default-or-description>
//     ...

import type { EventName } from '../../types/branded.js'
import {
  EXAMPLES,
  META,
  TOOL_INPUT_DOCS,
  TOOL_KEYED_EVENTS,
  type RequiredFieldDoc,
  type ToolInputFieldDoc,
} from '../../examples/index.js'

const JSON_INDENT = '  '
const REQUIRED_FIELDS_INDENT = '  '
const TOOL_HEADER_INDENT = '  '
const TOOL_FIELD_INDENT = '    '
const OPTIONAL_KEYS_INDENT = '  '

// Field descriptions for the documented optional keys (from BaseContext, plus
// the sketch-listed `permissionMode`, `agentId`, `agentType`). Grounded in
// src/types/contexts.ts:60-73 and the harness defaults set by
// `createHarnessContext` in src/testing/create-context.ts.
const OPTIONAL_KEYS: ReadonlyArray<{ name: string; type: string; description: string }> = [
  {
    name: 'sessionId',
    type: 'string',
    description: 'Default: "test-session-0000000000000000"',
  },
  {
    name: 'cwd',
    type: 'string',
    description: "Default: harness's cwd.",
  },
  {
    name: 'transcriptPath',
    type: 'string',
    description: 'Default: "/tmp/clooks-test-transcript.jsonl"',
  },
  {
    name: 'permissionMode',
    type: 'enum',
    description: '"default" | "plan" | "acceptEdits" | "dontAsk" | "bypassPermissions"',
  },
  {
    name: 'agentId',
    type: 'string',
    description: 'Identifies a specific agent invocation.',
  },
  {
    name: 'agentType',
    type: 'string',
    description: 'Subagent type, when running inside a subagent.',
  },
  {
    name: 'parallel',
    type: 'boolean',
    description: 'Default: false. True when running alongside other hooks for the same event.',
  },
]

/** Indent every line of `text` by `indent` and return the result. */
function indentBlock(text: string, indent: string): string {
  return text
    .split('\n')
    .map((line) => (line.length === 0 ? line : indent + line))
    .join('\n')
}

/** Pretty-print the embedded text-imported JSON payload. */
function formatJsonBlock(rawJson: string): string {
  const parsed = JSON.parse(rawJson) as unknown
  const pretty = JSON.stringify(parsed, null, 2)
  return indentBlock(pretty, JSON_INDENT)
}

function renderRequiredFields(required: ReadonlyArray<RequiredFieldDoc>): string {
  const lines = required.map((f) => `${REQUIRED_FIELDS_INDENT}${f.name} — ${f.description}`)
  return ['Required fields:', ...lines].join('\n')
}

function renderOneToolBlock(toolName: string, fields: ReadonlyArray<ToolInputFieldDoc>): string {
  // Width of the name column: the longest field name across this tool's fields.
  const nameWidth = Math.max(...fields.map((f) => f.name.length))
  const typeWidth = Math.max(...fields.map((f) => formatType(f).length))

  const fieldLines = fields.map((f) => {
    const namePad = ' '.repeat(nameWidth - f.name.length)
    const typeStr = formatType(f)
    const typePad = ' '.repeat(typeWidth - typeStr.length)
    return `${TOOL_FIELD_INDENT}${f.name}${namePad}  ${typeStr}${typePad}  ${f.description}`
  })

  return [`${TOOL_HEADER_INDENT}${toolName}:`, ...fieldLines].join('\n')
}

/** Render a field's type column: optional fields get a trailing `?`. */
function formatType(f: ToolInputFieldDoc): string {
  return f.required ? f.type : `${f.type}?`
}

function renderToolInputsSection(): string {
  const toolBlocks = (Object.keys(TOOL_INPUT_DOCS) as Array<keyof typeof TOOL_INPUT_DOCS>).map(
    (tool) => renderOneToolBlock(tool, TOOL_INPUT_DOCS[tool]),
  )
  // Insert blank lines between tool blocks so the columns read cleanly.
  const body = toolBlocks.join('\n\n')
  const fallback = [
    `${TOOL_HEADER_INDENT}ExitPlanMode and any mcp__* tool: toolName accepts any string;`,
    `${TOOL_HEADER_INDENT}  toolInput is Record<string, unknown> — provide whatever shape`,
    `${TOOL_HEADER_INDENT}  the tool expects.`,
  ].join('\n')
  return ['Tool inputs (toolName + toolInput shapes):', '', body, '', fallback].join('\n')
}

function renderOptionalKeysSection(): string {
  const nameWidth = Math.max(...OPTIONAL_KEYS.map((k) => k.name.length))
  const typeWidth = Math.max(...OPTIONAL_KEYS.map((k) => k.type.length))

  const lines = OPTIONAL_KEYS.map((k) => {
    const namePad = ' '.repeat(nameWidth - k.name.length)
    const typePad = ' '.repeat(typeWidth - k.type.length)
    return `${OPTIONAL_KEYS_INDENT}${k.name}${namePad}  ${k.type}${typePad}  ${k.description}`
  })

  const header = [
    'Optional keys — provided during real Claude Code invocations,',
    'optional when running `clooks test`. The harness fills these in with',
    'deterministic defaults; override only when your hook reads them.',
  ].join('\n')

  return [header, '', ...lines].join('\n')
}

/**
 * Build the full prose-and-JSON document for `clooks test example <event>`.
 *
 * @throws if `event` is not a key of `EXAMPLES` / `META` (caller validates).
 */
export function renderExample(event: EventName): string {
  const payload = EXAMPLES[event]
  const meta = META[event]

  const sections: string[] = []
  sections.push(`# ${event} — example input`)
  sections.push('')
  sections.push('A minimum-viable fixture:')
  sections.push('')
  sections.push(formatJsonBlock(payload))
  sections.push('')
  sections.push(renderRequiredFields(meta.required))
  sections.push('')

  if (TOOL_KEYED_EVENTS.has(event)) {
    sections.push(renderToolInputsSection())
    sections.push('')
  }

  sections.push(renderOptionalKeysSection())

  // Trailing newline so terminal output looks right.
  return sections.join('\n') + '\n'
}
