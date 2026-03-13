import { describe, expect, it, beforeAll, afterAll } from 'bun:test'
import { mkdirSync, writeFileSync } from 'fs'
import { execSync } from 'child_process'
import { hook, isBareMove, rewriteToGitMv, dryRunSucceeds } from './no-bare-mv.js'
import type { PreToolUseContext } from '../../src/types/contexts.js'

function makeCtx(overrides: Partial<PreToolUseContext> = {}): PreToolUseContext {
  return {
    event: 'PreToolUse',
    sessionId: 'test-session',
    cwd: '/tmp',
    permissionMode: 'default',
    transcriptPath: '/tmp/transcript.jsonl',
    toolName: 'Bash',
    toolInput: { command: 'mv foo.ts bar.ts' },
    originalToolInput: { command: 'mv foo.ts bar.ts' },
    toolUseId: 'tu-test-1',
    parallel: false,
    signal: new AbortController().signal,
    ...overrides,
  }
}

describe('isBareMove', () => {
  it('detects bare mv', () => {
    expect(isBareMove('mv foo.ts bar.ts')).toBe(true)
  })

  it('detects mv with flags', () => {
    expect(isBareMove('mv -f src/old.ts src/new.ts')).toBe(true)
  })

  it('allows git mv', () => {
    expect(isBareMove('git mv foo.ts bar.ts')).toBe(false)
  })

  it('ignores mv inside quotes', () => {
    expect(isBareMove("echo 'mv foo bar'")).toBe(false)
  })

  it('ignores mv in comments', () => {
    expect(isBareMove('# mv foo bar')).toBe(false)
  })

  it('allows commands without mv', () => {
    expect(isBareMove('ls -la')).toBe(false)
  })

  it('does not match partial words like mvn', () => {
    expect(isBareMove('mvn clean install')).toBe(false)
  })
})

describe('rewriteToGitMv', () => {
  it('rewrites bare mv', () => {
    expect(rewriteToGitMv('mv foo.ts bar.ts')).toBe('git mv foo.ts bar.ts')
  })

  it('rewrites mv with flags', () => {
    expect(rewriteToGitMv('mv -f foo.ts bar.ts')).toBe('git mv -f foo.ts bar.ts')
  })

  it('preserves leading env vars', () => {
    expect(rewriteToGitMv('FOO=1 mv a.ts b.ts')).toBe('FOO=1 git mv a.ts b.ts')
  })
})

describe('dryRunSucceeds', () => {
  const testDir = '/tmp/no-bare-mv-dryrun-test'

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true })
    execSync('git init', { cwd: testDir })
    execSync("git config user.email 'test@test.com'", { cwd: testDir })
    execSync("git config user.name 'Test'", { cwd: testDir })
    writeFileSync(`${testDir}/tracked.ts`, 'export const x = 1')
    execSync('git add tracked.ts', { cwd: testDir })
    execSync("git commit -m 'init'", { cwd: testDir })
    writeFileSync(`${testDir}/untracked.ts`, 'export const y = 2')
  })

  afterAll(() => {
    execSync(`rm -rf ${testDir}`)
  })

  it('returns true for tracked files', () => {
    expect(dryRunSucceeds('git mv tracked.ts renamed.ts', testDir)).toBe(true)
  })

  it('returns false for untracked files', () => {
    expect(dryRunSucceeds('git mv untracked.ts renamed.ts', testDir)).toBe(false)
  })

  it('returns false for nonexistent files', () => {
    expect(dryRunSucceeds('git mv nope.ts renamed.ts', testDir)).toBe(false)
  })

  it('returns false for unsupported flags', () => {
    expect(dryRunSucceeds('git mv -u tracked.ts renamed.ts', testDir)).toBe(false)
  })
})

describe('no-bare-mv hook (integration)', () => {
  const testDir = '/tmp/no-bare-mv-hook-test'

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true })
    execSync('git init', { cwd: testDir })
    execSync("git config user.email 'test@test.com'", { cwd: testDir })
    execSync("git config user.name 'Test'", { cwd: testDir })
    writeFileSync(`${testDir}/tracked.ts`, 'export const x = 1')
    execSync('git add tracked.ts', { cwd: testDir })
    execSync("git commit -m 'init'", { cwd: testDir })
    writeFileSync(`${testDir}/untracked.ts`, 'export const y = 2')
  })

  afterAll(() => {
    execSync(`rm -rf ${testDir}`)
  })

  it('exports meta with correct name', () => {
    expect(hook.meta.name).toBe('no-bare-mv')
  })

  it('rewrites bare mv of tracked files', async () => {
    const result = await hook.PreToolUse!(
      makeCtx({ cwd: testDir, toolInput: { command: 'mv tracked.ts renamed.ts' } }),
      {},
    )
    expect(result.result).toBe('allow')
    expect((result as any).updatedInput).toEqual({ command: 'git mv tracked.ts renamed.ts' })
    expect((result as any).injectContext).toBeDefined()
  })

  it('allows bare mv of untracked files without rewrite', async () => {
    const result = await hook.PreToolUse!(
      makeCtx({ cwd: testDir, toolInput: { command: 'mv untracked.ts renamed.ts' } }),
      {},
    )
    expect(result.result).toBe('allow')
    expect((result as any).updatedInput).toBeUndefined()
  })

  it('skips git mv commands', async () => {
    const result = await hook.PreToolUse!(
      makeCtx({ cwd: testDir, toolInput: { command: 'git mv tracked.ts renamed.ts' } }),
      {},
    )
    expect(result.result).toBe('skip')
  })

  it('skips non-Bash tools', async () => {
    const result = await hook.PreToolUse!(
      makeCtx({ toolName: 'Write', toolInput: { filePath: '/tmp/f.txt' } }),
      {},
    )
    expect(result.result).toBe('skip')
  })

  it('skips empty commands', async () => {
    const result = await hook.PreToolUse!(makeCtx({ toolInput: { command: '' } }), {})
    expect(result.result).toBe('skip')
  })
})
