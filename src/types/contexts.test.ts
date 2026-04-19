import { expect, test } from 'bun:test'
import type { PreToolUseContext, UnknownPreToolUseContext } from './contexts.js'

test('ctx.toolName === "Bash" narrows toolInput to BashToolInput', () => {
  const ctx = {
    toolName: 'Bash',
    toolInput: { command: 'echo hi', runInBackground: false },
  } as unknown as PreToolUseContext
  if (ctx.toolName === 'Bash') {
    const cmd: string = ctx.toolInput.command
    const rib: boolean | undefined = ctx.toolInput.runInBackground
    expect(cmd).toBe('echo hi')
    expect(rib).toBe(false)
  }
})

test('ctx.toolName === "Write" narrows toolInput to WriteToolInput', () => {
  const ctx = {
    toolName: 'Write',
    toolInput: { filePath: '/tmp/x', content: 'y' },
  } as unknown as PreToolUseContext
  if (ctx.toolName === 'Write') {
    const fp: string = ctx.toolInput.filePath
    const c: string = ctx.toolInput.content
    expect(fp).toBe('/tmp/x')
    expect(c).toBe('y')
  }
})

test('ctx.toolName === "Edit" narrows toolInput to EditToolInput', () => {
  const ctx = {
    toolName: 'Edit',
    toolInput: { filePath: '/tmp/x', oldString: 'a', newString: 'b', replaceAll: true },
  } as unknown as PreToolUseContext
  if (ctx.toolName === 'Edit') {
    const fp: string = ctx.toolInput.filePath
    const os: string = ctx.toolInput.oldString
    const ns: string = ctx.toolInput.newString
    const ra: boolean | undefined = ctx.toolInput.replaceAll
    expect(fp).toBe('/tmp/x')
    expect(os).toBe('a')
    expect(ns).toBe('b')
    expect(ra).toBe(true)
  }
})

test('ctx.toolName === "Read" narrows toolInput to ReadToolInput', () => {
  const ctx = {
    toolName: 'Read',
    toolInput: { filePath: '/tmp/x', offset: 10, limit: 50 },
  } as unknown as PreToolUseContext
  if (ctx.toolName === 'Read') {
    const fp: string = ctx.toolInput.filePath
    const offset: number | undefined = ctx.toolInput.offset
    const limit: number | undefined = ctx.toolInput.limit
    expect(fp).toBe('/tmp/x')
    expect(offset).toBe(10)
    expect(limit).toBe(50)
  }
})

test('ctx.toolName === "Glob" narrows toolInput to GlobToolInput', () => {
  const ctx = {
    toolName: 'Glob',
    toolInput: { pattern: '**/*.ts', path: '/src' },
  } as unknown as PreToolUseContext
  if (ctx.toolName === 'Glob') {
    const pattern: string = ctx.toolInput.pattern
    const path: string | undefined = ctx.toolInput.path
    expect(pattern).toBe('**/*.ts')
    expect(path).toBe('/src')
  }
})

test('ctx.toolName === "Grep" narrows toolInput to GrepToolInput', () => {
  const ctx = {
    toolName: 'Grep',
    toolInput: {
      pattern: 'foo',
      path: '/src',
      glob: '*.ts',
      outputMode: 'content',
      multiline: true,
      '-i': true,
    },
  } as unknown as PreToolUseContext
  if (ctx.toolName === 'Grep') {
    const pattern: string = ctx.toolInput.pattern
    const path: string | undefined = ctx.toolInput.path
    const glob: string | undefined = ctx.toolInput.glob
    const multiline: boolean | undefined = ctx.toolInput.multiline
    const insensitive: boolean | undefined = ctx.toolInput['-i']
    void insensitive
    expect(pattern).toBe('foo')
    expect(path).toBe('/src')
    expect(glob).toBe('*.ts')
    expect(multiline).toBe(true)
  }
})

test('ctx.toolName === "WebFetch" narrows toolInput to WebFetchToolInput', () => {
  const ctx = {
    toolName: 'WebFetch',
    toolInput: { url: 'https://example.com', prompt: 'summarize' },
  } as unknown as PreToolUseContext
  if (ctx.toolName === 'WebFetch') {
    const url: string = ctx.toolInput.url
    const prompt: string = ctx.toolInput.prompt
    expect(url).toBe('https://example.com')
    expect(prompt).toBe('summarize')
  }
})

test('ctx.toolName === "WebSearch" narrows toolInput to WebSearchToolInput', () => {
  const ctx = {
    toolName: 'WebSearch',
    toolInput: { query: 'bun runtime', allowedDomains: ['bun.sh'], blockedDomains: ['evil.com'] },
  } as unknown as PreToolUseContext
  if (ctx.toolName === 'WebSearch') {
    const query: string = ctx.toolInput.query
    const allowed: string[] | undefined = ctx.toolInput.allowedDomains
    const bd: string[] | undefined = ctx.toolInput.blockedDomains
    void bd
    expect(query).toBe('bun runtime')
    expect(allowed).toEqual(['bun.sh'])
  }
})

test('ctx.toolName === "Agent" narrows toolInput to AgentToolInput', () => {
  const ctx = {
    toolName: 'Agent',
    toolInput: {
      prompt: 'do the thing',
      description: 'subagent task',
      subagentType: 'claude',
      model: 'claude-opus-4-5',
    },
  } as unknown as PreToolUseContext
  if (ctx.toolName === 'Agent') {
    const prompt: string = ctx.toolInput.prompt
    const description: string = ctx.toolInput.description
    const subagentType: string = ctx.toolInput.subagentType
    const model: string | undefined = ctx.toolInput.model
    expect(prompt).toBe('do the thing')
    expect(description).toBe('subagent task')
    expect(subagentType).toBe('claude')
    expect(model).toBe('claude-opus-4-5')
  }
})

test('ctx.toolName === "AskUserQuestion" narrows toolInput to AskUserQuestionToolInput', () => {
  const ctx = {
    toolName: 'AskUserQuestion',
    toolInput: {
      questions: [
        {
          question: 'Pick one',
          header: 'Choice',
          options: [{ label: 'A' }, { label: 'B' }],
          multiSelect: false,
        },
      ],
    },
  } as unknown as PreToolUseContext
  if (ctx.toolName === 'AskUserQuestion') {
    const questions = ctx.toolInput.questions
    const first = questions[0]
    if (!first) throw new Error('expected first question')
    const q: string = first.question
    const header: string = first.header
    const ms: boolean | undefined = first.multiSelect
    void ms
    expect(q).toBe('Pick one')
    expect(header).toBe('Choice')
    const firstOption = first.options[0]
    if (!firstOption) throw new Error('expected first option')
    expect(firstOption.label).toBe('A')
  }
})

test('unknown toolName (mcp__custom__tool) handled via UnknownPreToolUseContext', () => {
  const ctx = {
    toolName: 'mcp__custom__tool',
    toolInput: { anything: 'goes', filePath: '/some/path' },
  } as unknown as UnknownPreToolUseContext
  if (ctx.toolName === 'mcp__custom__tool') {
    const anything: unknown = ctx.toolInput.anything
    const ti: Record<string, unknown> = ctx.toolInput
    const fp: unknown = ctx.toolInput.filePath
    void ti
    void fp
    expect(anything).toBe('goes')
  }
})

test('ExitPlanMode handled via UnknownPreToolUseContext', () => {
  const ctx = {
    toolName: 'ExitPlanMode',
    toolInput: {},
  } as unknown as UnknownPreToolUseContext
  if (ctx.toolName === 'ExitPlanMode') {
    const ti: Record<string, unknown> = ctx.toolInput
    expect(ti).toEqual({})
  }
})

test('Write branch forbids reading Bash-only field command', () => {
  const ctx = {
    toolName: 'Write',
    toolInput: { filePath: '/x', content: 'y' },
  } as unknown as PreToolUseContext
  if (ctx.toolName === 'Write') {
    // @ts-expect-error — command does not exist on WriteToolInput
    const cmd = ctx.toolInput.command
    void cmd
  }
})

test('Bash branch forbids reading Write-only field filePath', () => {
  const ctx = {
    toolName: 'Bash',
    toolInput: { command: 'echo hi' },
  } as unknown as PreToolUseContext
  if (ctx.toolName === 'Bash') {
    // @ts-expect-error — filePath does not exist on BashToolInput
    const fp = ctx.toolInput.filePath
    void fp
  }
})
