// Per-tool toolInput field documentation, used by `clooks test example` for the
// 4 tool-keyed events (PreToolUse, PostToolUse, PostToolUseFailure,
// PermissionRequest). Grounded in src/types/contexts.ts:78-152 (the *ToolInput
// interfaces) and docs/domain/raw-claude-ai/hook-docs/PreToolUse.md.
//
// Each entry's `name` and `required` flag MUST match the corresponding
// interface in src/types/contexts.ts exactly. M3's verifier asserts that the
// keys here are exactly `keyof ToolInputMap`.

import type { ToolInputMap } from '../types/contexts.js'

export interface ToolInputFieldDoc {
  readonly name: string
  readonly type: string
  readonly required: boolean
  readonly description: string
}

export const TOOL_INPUT_DOCS: Record<keyof ToolInputMap, ReadonlyArray<ToolInputFieldDoc>> = {
  Bash: [
    {
      name: 'command',
      type: 'string',
      required: true,
      description: 'The shell command to execute.',
    },
    {
      name: 'description',
      type: 'string',
      required: false,
      description: 'Optional description of what the command does.',
    },
    {
      name: 'timeout',
      type: 'number',
      required: false,
      description: 'Optional timeout in milliseconds.',
    },
    {
      name: 'runInBackground',
      type: 'boolean',
      required: false,
      description: 'Optional. Whether to run the command in the background.',
    },
  ],
  Edit: [
    {
      name: 'filePath',
      type: 'string',
      required: true,
      description: 'Absolute path to the file to edit.',
    },
    {
      name: 'oldString',
      type: 'string',
      required: true,
      description: 'Text to find and replace.',
    },
    {
      name: 'newString',
      type: 'string',
      required: true,
      description: 'Replacement text.',
    },
    {
      name: 'replaceAll',
      type: 'boolean',
      required: false,
      description: 'Optional. Whether to replace all occurrences.',
    },
  ],
  Write: [
    {
      name: 'filePath',
      type: 'string',
      required: true,
      description: 'Absolute path to the file to write.',
    },
    {
      name: 'content',
      type: 'string',
      required: true,
      description: 'Content to write to the file.',
    },
  ],
  Read: [
    {
      name: 'filePath',
      type: 'string',
      required: true,
      description: 'Absolute path to the file to read.',
    },
    {
      name: 'offset',
      type: 'number',
      required: false,
      description: 'Optional line number to start reading from.',
    },
    {
      name: 'limit',
      type: 'number',
      required: false,
      description: 'Optional number of lines to read.',
    },
  ],
  Glob: [
    {
      name: 'pattern',
      type: 'string',
      required: true,
      description: 'Glob pattern to match files against (e.g. "src/**/*.ts").',
    },
    {
      name: 'path',
      type: 'string',
      required: false,
      description: 'Optional directory to search in. Defaults to current working directory.',
    },
  ],
  Grep: [
    {
      name: 'pattern',
      type: 'string',
      required: true,
      description: 'Regular expression pattern to search for.',
    },
    {
      name: 'path',
      type: 'string',
      required: false,
      description: 'Optional file or directory to search in.',
    },
    {
      name: 'glob',
      type: 'string',
      required: false,
      description: 'Optional glob pattern to filter files.',
    },
    {
      name: 'outputMode',
      type: 'string',
      required: false,
      description: '"content", "files_with_matches", or "count". Defaults to "files_with_matches".',
    },
    {
      name: '-i',
      type: 'boolean',
      required: false,
      description: 'Case-insensitive search.',
    },
    {
      name: 'multiline',
      type: 'boolean',
      required: false,
      description: 'Enable multiline matching (pattern spans newlines).',
    },
  ],
  WebFetch: [
    {
      name: 'url',
      type: 'string',
      required: true,
      description: 'URL to fetch content from.',
    },
    {
      name: 'prompt',
      type: 'string',
      required: true,
      description: 'Prompt to run on the fetched content.',
    },
  ],
  WebSearch: [
    {
      name: 'query',
      type: 'string',
      required: true,
      description: 'Search query.',
    },
    {
      name: 'allowedDomains',
      type: 'string[]',
      required: false,
      description: 'Optional. Only include results from these domains.',
    },
    {
      name: 'blockedDomains',
      type: 'string[]',
      required: false,
      description: 'Optional. Exclude results from these domains.',
    },
  ],
  Agent: [
    {
      name: 'prompt',
      type: 'string',
      required: true,
      description: 'The task for the agent to perform.',
    },
    {
      name: 'description',
      type: 'string',
      required: true,
      description: 'Short description of the task.',
    },
    {
      name: 'subagentType',
      type: 'string',
      required: true,
      description: 'Type of specialized agent to use (e.g. "Explore", "general-purpose").',
    },
    {
      name: 'model',
      type: 'string',
      required: false,
      description: 'Optional model alias to override the default.',
    },
  ],
  AskUserQuestion: [
    {
      name: 'questions',
      type: 'array',
      required: true,
      description:
        'Array of { question, header, options: [{ label }], multiSelect? } objects. One to four questions.',
    },
    {
      name: 'answers',
      type: 'object',
      required: false,
      description:
        'Optional. Maps question text to the selected option label. Claude does not set this field; supply it via `updatedInput` to answer programmatically.',
    },
  ],
}
