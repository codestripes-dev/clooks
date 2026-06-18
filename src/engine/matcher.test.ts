import { describe, expect, test } from 'bun:test'
import {
  compileMatcher,
  matches,
  matchesContext,
  type MatchContext,
} from './matcher.js'
import type { Matcher } from '../config/schema.js'
import type { EventName } from '../types/branded.js'

const makeContext = (overrides: Partial<MatchContext>): MatchContext => ({
  event: 'PreToolUse' as EventName,
  ...overrides,
})

describe('compileMatcher', () => {
  test('compiles with defaults', () => {
    const compiled = compileMatcher({})
    expect(compiled.matchLogic).toBe('and')
    expect(compiled.command).toBeUndefined()
    expect(compiled.tool).toBeUndefined()
    expect(compiled.file).toBeUndefined()
    expect(compiled.prompt).toBeUndefined()
  })

  test('compiles with explicit matchLogic', () => {
    const compiled = compileMatcher({ matchLogic: 'or' })
    expect(compiled.matchLogic).toBe('or')
  })

  test('compiles regex patterns', () => {
    const compiled = compileMatcher({ command: 'rm -rf', prompt: 'deploy' })
    expect(compiled.command).toBeInstanceOf(RegExp)
    expect(compiled.prompt).toBeInstanceOf(RegExp)
  })

  test('compiles glob pattern', () => {
    const compiled = compileMatcher({ file: '*.ts' })
    expect(compiled.file).toBeDefined()
    expect(compiled.file!.match('foo.ts')).toBe(true)
    expect(compiled.file!.match('foo.js')).toBe(false)
  })
})

describe('matches (AND logic)', () => {
  test('empty matcher matches everything', () => {
    const compiled = compileMatcher({})
    expect(matches(compiled, makeContext({}))).toBe(true)
  })

  test('command matches Bash command', () => {
    const compiled = compileMatcher({ command: 'rm -rf' })
    expect(
      matches(compiled, makeContext({
        toolName: 'Bash',
        toolInput: { command: 'rm -rf /tmp/foo' },
      })),
    ).toBe(true)
    expect(
      matches(compiled, makeContext({
        toolName: 'Bash',
        toolInput: { command: 'ls -la' },
      })),
    ).toBe(false)
  })

  test('command does not match non-Bash tools', () => {
    const compiled = compileMatcher({ command: 'rm -rf' })
    expect(
      matches(compiled, makeContext({
        toolName: 'Write',
        toolInput: { filePath: 'test.ts', content: 'x' },
      })),
    ).toBe(false)
  })

  test('tool matches exact tool name', () => {
    const compiled = compileMatcher({ tool: 'Bash' })
    expect(matches(compiled, makeContext({ toolName: 'Bash' }))).toBe(true)
    expect(matches(compiled, makeContext({ toolName: 'Write' }))).toBe(false)
  })

  test('file matches file path', () => {
    const compiled = compileMatcher({ file: '**/*.ts' })
    expect(
      matches(compiled, makeContext({
        toolName: 'Write',
        toolInput: { filePath: 'src/index.ts' },
      })),
    ).toBe(true)
    expect(
      matches(compiled, makeContext({
        toolName: 'Write',
        toolInput: { filePath: 'src/index.js' },
      })),
    ).toBe(false)
  })

  test('prompt matches user prompt', () => {
    const compiled = compileMatcher({ prompt: 'deploy' })
    expect(
      matches(compiled, makeContext({
        event: 'UserPromptSubmit',
        prompt: 'deploy to production',
      })),
    ).toBe(true)
    expect(
      matches(compiled, makeContext({
        event: 'UserPromptSubmit',
        prompt: 'run tests',
      })),
    ).toBe(false)
  })

  test('AND: multiple conditions all must match', () => {
    const compiled = compileMatcher({ tool: 'Bash', command: 'rm -rf' })
    expect(
      matches(compiled, makeContext({
        toolName: 'Bash',
        toolInput: { command: 'rm -rf /tmp/foo' },
      })),
    ).toBe(true)
    expect(
      matches(compiled, makeContext({
        toolName: 'Write',
        toolInput: { command: 'rm -rf /tmp/foo' },
      })),
    ).toBe(false) // tool doesn't match
    expect(
      matches(compiled, makeContext({
        toolName: 'Bash',
        toolInput: { command: 'ls -la' },
      })),
    ).toBe(false) // command doesn't match
  })
})

describe('matches (OR logic)', () => {
  test('OR: any condition matching is sufficient', () => {
    const compiled = compileMatcher({ matchLogic: 'or', tool: 'Bash', command: 'rm -rf' })
    expect(
      matches(compiled, makeContext({
        toolName: 'Bash',
        toolInput: { command: 'ls -la' },
      })),
    ).toBe(true) // tool matches
    expect(
      matches(compiled, makeContext({
        toolName: 'Write',
        toolInput: { command: 'rm -rf /tmp/foo' },
      })),
    ).toBe(false) // neither matches (command only checked for Bash)
  })

  test('OR: empty matcher matches everything', () => {
    const compiled = compileMatcher({ matchLogic: 'or' })
    expect(matches(compiled, makeContext({}))).toBe(true)
  })
})

describe('matchesContext (cached)', () => {
  test('matchesContext delegates to matches', () => {
    const matcher: Matcher = { command: 'test' }
    expect(
      matchesContext(matcher, makeContext({
        toolName: 'Bash',
        toolInput: { command: 'test something' },
      })),
    ).toBe(true)
    expect(
      matchesContext(matcher, makeContext({
        toolName: 'Bash',
        toolInput: { command: 'other thing' },
      })),
    ).toBe(false)
  })
})

describe('edge cases', () => {
  test('file pattern matches Glob tool pattern field', () => {
    const compiled = compileMatcher({ file: '**/*.md' })
    expect(
      matches(compiled, makeContext({
        toolName: 'Glob',
        toolInput: { pattern: 'docs/readme.md' },
      })),
    ).toBe(true)
  })

  test('file does not match when no file path in tool input', () => {
    const compiled = compileMatcher({ file: '*.ts' })
    expect(
      matches(compiled, makeContext({
        toolName: 'Bash',
        toolInput: { command: 'ls' },
      })),
    ).toBe(false)
  })

  test('prompt does not match when prompt is undefined', () => {
    const compiled = compileMatcher({ prompt: 'test' })
    expect(matches(compiled, makeContext({}))).toBe(false)
  })

  test('dotfiles are matched by glob (minimatch dot: true)', () => {
    const compiled = compileMatcher({ file: '.*' })
    expect(
      matches(compiled, makeContext({
        toolName: 'Read',
        toolInput: { filePath: '.gitignore' },
      })),
    ).toBe(true)
  })
})
