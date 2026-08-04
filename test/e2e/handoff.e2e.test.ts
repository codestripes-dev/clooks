import { describe, test, expect, afterEach } from 'bun:test'
import { readFileSync, readdirSync } from 'fs'
import { join, basename } from 'path'
import { createHash } from 'crypto'
import { createSandbox, type Sandbox } from './helpers/sandbox'

const FIXTURES = join(import.meta.dir, '../fixtures')
const loadEvent = (name: string) => readFileSync(join(FIXTURES, 'events', name), 'utf8')

let sandbox: Sandbox

afterEach(() => {
  sandbox?.cleanup()
})

const LONG_BLOCK_REASON =
  'STYLE-GUIDE-BEGIN\n' +
  'Always run the formatter before committing.\n'.repeat(90) +
  'STYLE-GUIDE-END'

const LONG_SESSION_CONTEXT =
  'SESSION-CONTEXT-BEGIN\n' +
  'Inspect existing project patterns before making changes.\n'.repeat(8) +
  'SESSION-CONTEXT-END'

// Sanity: the shared fixture must actually sit in the interesting length band.
if (LONG_BLOCK_REASON.length <= 3000 || LONG_BLOCK_REASON.length >= 5000) {
  throw new Error(`LONG_BLOCK_REASON.length out of expected band: ${LONG_BLOCK_REASON.length}`)
}

/**
 * Verifies a pointer string against the exact sentence from `buildPointer`
 * (src/engine/handoff.ts), extracts the absolute path, and confirms the path is
 * a content-addressed file under the given tmp dir.
 */
function assertPointer(
  pointer: string,
  opts: { hookName: string; tmpDir: string; originalText: string },
): { absPath: string } {
  const match = pointer.match(
    /^\[clooks\] Hook "([^"]+)": read (.+) and follow its instructions\.$/,
  )
  if (!match) throw new Error(`pointer did not match expected sentence shape: ${pointer}`)
  const [, hookName, absPath] = match as unknown as [string, string, string]

  expect(hookName).toBe(opts.hookName)
  expect(absPath.startsWith('/')).toBe(true)
  expect(absPath.startsWith(opts.tmpDir + '/')).toBe(true)

  const digest = createHash('sha256').update(opts.originalText).digest('hex').slice(0, 12)
  expect(basename(absPath)).toBe(`handoff-${opts.hookName}-${digest}.md`)

  return { absPath }
}

/** Runs a git command in the sandbox's project dir; fails the test on nonzero exit. */
function git(dir: string, args: string[]): { stdout: string; exitCode: number } {
  const proc = Bun.spawnSync(['git', ...args], { cwd: dir })
  if (proc.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${proc.stderr.toString()}`)
  }
  return { stdout: proc.stdout.toString(), exitCode: proc.exitCode }
}

function gitInitBaseline(dir: string, opts?: { empty?: boolean }): void {
  git(dir, ['init', '-q'])
  git(dir, ['config', 'user.name', 'Handoff E2E'])
  git(dir, ['config', 'user.email', 'handoff-e2e@example.test'])
  if (opts?.empty) {
    git(dir, ['commit', '--allow-empty', '-qm', 'baseline'])
    return
  }
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-qm', 'baseline'])
}

function assertGitClean(dir: string): void {
  const { stdout } = git(dir, ['status', '--porcelain=v1', '--untracked-files=all'])
  expect(stdout).toBe('')
}

function assertGitIgnored(dir: string, relativePath: string): void {
  const proc = Bun.spawnSync(['git', 'check-ignore', '-q', relativePath], { cwd: dir })
  expect(proc.exitCode).toBe(0)
}

describe('handoff — E2E', () => {
  test('1. project PreToolUse block, handoff: true → pointer delivered, file written, git-clean', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'handoff-block.ts',
      `
export const hook = {
  meta: { name: "handoff-block" },
  PreToolUse() {
    return { result: "block" as const, reason: ${JSON.stringify(LONG_BLOCK_REASON)} }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
handoff-block:
  handoff: true
`)
    gitInitBaseline(sandbox.dir)

    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.hookEventName).toBe('PreToolUse')
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny')

    const tmpDir = join(sandbox.dir, '.clooks', 'tmp')
    const { absPath } = assertPointer(output.hookSpecificOutput.permissionDecisionReason, {
      hookName: 'handoff-block',
      tmpDir,
      originalText: LONG_BLOCK_REASON,
    })

    const fileContent = sandbox.readFile(join('.clooks', 'tmp', basename(absPath)))
    expect(fileContent).toBe(LONG_BLOCK_REASON)

    const gitignoreContent = sandbox.readFile(join('.clooks', 'tmp', '.gitignore'))
    expect(gitignoreContent.trim()).toBe('*')

    const tmpEntries = readdirSync(tmpDir).sort()
    expect(tmpEntries).toEqual(['.gitignore', basename(absPath)].sort())

    assertGitClean(sandbox.dir)
    assertGitIgnored(sandbox.dir, '.clooks/tmp/.gitignore')
    assertGitIgnored(sandbox.dir, join('.clooks', 'tmp', basename(absPath)))
  })

  test('2. per-hook threshold keeps a below-threshold reason inline, no file created', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'handoff-block.ts',
      `
export const hook = {
  meta: { name: "handoff-block" },
  PreToolUse() {
    return { result: "block" as const, reason: ${JSON.stringify(LONG_BLOCK_REASON)} }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
handoff-block:
  handoff: 5000
`)

    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(output.hookSpecificOutput.permissionDecisionReason).toBe(LONG_BLOCK_REASON)
    expect(sandbox.fileExists(join('.clooks', 'tmp'))).toBe(false)
  })

  test('3. global threshold hands off SessionStart injectContext', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'session-context.ts',
      `
export const hook = {
  meta: { name: "session-context" },
  SessionStart() {
    return { result: "skip" as const, injectContext: ${JSON.stringify(LONG_SESSION_CONTEXT)} }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
config:
  handoff: 100
session-context: {}
`)

    const result = sandbox.run([], { stdin: loadEvent('session-start.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.hookEventName).toBe('SessionStart')
    expect(output.hookSpecificOutput.permissionDecision).toBeUndefined()
    expect(output.hookSpecificOutput.permissionDecisionReason).toBeUndefined()

    const tmpDir = join(sandbox.dir, '.clooks', 'tmp')
    const { absPath } = assertPointer(output.hookSpecificOutput.additionalContext, {
      hookName: 'session-context',
      tmpDir,
      originalText: LONG_SESSION_CONTEXT,
    })
    const fileContent = sandbox.readFile(join('.clooks', 'tmp', basename(absPath)))
    expect(fileContent).toBe(LONG_SESSION_CONTEXT)
    const gitignoreContent = sandbox.readFile(join('.clooks', 'tmp', '.gitignore'))
    expect(gitignoreContent.trim()).toBe('*')
  })

  test('4. home-only config writes handoff into the project tmp dir, project stays git-clean', () => {
    sandbox = createSandbox()
    expect(sandbox.fileExists('.clooks')).toBe(false)
    gitInitBaseline(sandbox.dir, { empty: true })

    sandbox.writeHomeHook(
      'home-handoff.ts',
      `
export const hook = {
  meta: { name: "home-handoff" },
  PreToolUse() {
    return { result: "block" as const, reason: ${JSON.stringify(LONG_BLOCK_REASON)} }
  },
}
`,
    )
    sandbox.writeHomeConfig(`
version: "1.0.0"
config:
  handoff: true
home-handoff: {}
`)

    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny')

    const tmpDir = join(sandbox.dir, '.clooks', 'tmp')
    const { absPath } = assertPointer(output.hookSpecificOutput.permissionDecisionReason, {
      hookName: 'home-handoff',
      tmpDir,
      originalText: LONG_BLOCK_REASON,
    })
    expect(absPath.startsWith(sandbox.dir + '/')).toBe(true)
    expect(absPath.startsWith(sandbox.home)).toBe(false)

    // Project gains only the managed .clooks/tmp tree — no clooks.yml, no hooks dir.
    expect(sandbox.fileExists(join('.clooks', 'clooks.yml'))).toBe(false)
    expect(sandbox.fileExists(join('.clooks', 'hooks'))).toBe(false)
    expect(sandbox.fileExists(join('.clooks', 'tmp', '.gitignore'))).toBe(true)

    // Home dir gains no tmp tree of its own.
    expect(sandbox.homeFileExists(join('.clooks', 'tmp'))).toBe(false)

    const fileContent = sandbox.readFile(join('.clooks', 'tmp', basename(absPath)))
    expect(fileContent).toBe(LONG_BLOCK_REASON)

    assertGitClean(sandbox.dir)
    assertGitIgnored(sandbox.dir, '.clooks/tmp/.gitignore')
    assertGitIgnored(sandbox.dir, join('.clooks', 'tmp', basename(absPath)))
  })

  test('5. event-level handoff:false overrides global handoff:true — stays inline, wholesale precedence', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'handoff-block.ts',
      `
export const hook = {
  meta: { name: "handoff-block" },
  PreToolUse() {
    return { result: "block" as const, reason: ${JSON.stringify(LONG_BLOCK_REASON)} }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
config:
  handoff: true
handoff-block:
  events:
    PreToolUse:
      handoff: false
`)

    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(output.hookSpecificOutput.permissionDecisionReason).toBe(LONG_BLOCK_REASON)
    expect(sandbox.fileExists(join('.clooks', 'tmp'))).toBe(false)
  })

  test('6. handoff: 0 at the global level is a config error', () => {
    sandbox = createSandbox()
    sandbox.writeConfig(`
version: "1.0.0"
config:
  handoff: 0
`)

    const result = sandbox.run([], { stdin: loadEvent('pre-tool-use-bash.json') })
    expect(result.exitCode).toBe(2)
    expect(result.stdout.trim()).toBe('')
    expect(result.stderr).toContain('handoff')
    expect(result.stderr).toContain('must be true, false, or a positive integer')
    expect(sandbox.fileExists(join('.clooks', 'tmp'))).toBe(false)
  })

  test('7. handoff: true on SessionEnd (ineligible event) is a config error', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'session-end-hook.ts',
      `
export const hook = {
  meta: { name: "session-end-hook" },
  SessionEnd() {
    return { result: "skip" as const }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
session-end-hook:
  events:
    SessionEnd:
      handoff: true
`)

    const result = sandbox.run([], { stdin: loadEvent('session-end.json') })
    expect(result.exitCode).toBe(2)
    expect(result.stdout.trim()).toBe('')
    expect(result.stderr).toContain('session-end-hook')
    expect(result.stderr).toContain('events.SessionEnd handoff cannot be enabled')
    expect(result.stderr).toContain('has no model-facing payload to hand off')
    expect(sandbox.fileExists(join('.clooks', 'tmp'))).toBe(false)
  })

  test('8. handoff: false on SessionEnd is accepted — hook runs normally', () => {
    sandbox = createSandbox()
    sandbox.writeHook(
      'session-end-hook.ts',
      `
export const hook = {
  meta: { name: "session-end-hook" },
  async SessionEnd() {
    await Bun.write(".clooks/session-end-ran", "ran")
    return { result: "skip" as const }
  },
}
`,
    )
    sandbox.writeConfig(`
version: "1.0.0"
session-end-hook:
  events:
    SessionEnd:
      handoff: false
`)

    const result = sandbox.run([], { stdin: loadEvent('session-end.json') })
    expect(result.exitCode).toBe(0)
    expect(result.stderr.trim()).toBe('')
    expect(sandbox.readFile('.clooks/session-end-ran')).toBe('ran')
    expect(sandbox.fileExists(join('.clooks', 'tmp'))).toBe(false)
  })
})
