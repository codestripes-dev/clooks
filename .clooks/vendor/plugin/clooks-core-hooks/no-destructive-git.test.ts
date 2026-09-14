import { describe, expect, test } from 'bun:test'
import type { PreToolUseContext } from "./types"
import {
  matchesResetHard,
  matchesResetMerge,
  matchesCheckoutDiscard,
  matchesRestoreDiscard,
  matchesCleanForce,
  matchesStashDrop,
  matchesWorktreeForceRemove,
  matchesForcePush,
  matchesCommitAmend,
  matchesPushDelete,
  matchesBranchForceDelete,
  matchesNoVerify,
  matchesBroadAdd,
  hook,
} from "./no-destructive-git"

// --- Helpers ---

function makeCtx(command: string, toolName = 'Bash'): PreToolUseContext {
  return {
    event: 'PreToolUse',
    toolName,
    toolInput: { command },
    originalToolInput: { command },
    toolUseId: 'tu-test',
    sessionId: 'test-session',
    cwd: '/tmp',
    permissionMode: 'default',
    transcriptPath: '/tmp/transcript.jsonl',
    allow: (opts = {}) => ({ result: 'allow', ...opts }),
    block: (opts) => ({ result: 'block', ...opts }),
    skip: (opts = {}) => ({ result: 'skip', ...opts }),
    ask: (opts) => ({ result: 'ask', ...opts }),
    defer: (opts = {}) => ({ result: 'defer', ...opts }),
  } as PreToolUseContext
}

type Config = {
  [key: string]: boolean | { match: string; message: string }[] | undefined
  additionalRules?: { match: string; message: string }[]
}

const DEFAULT_CONFIG: Config = {
  "reset-hard": true,
  "reset-merge": true,
  "checkout-discard": true,
  "restore-discard": true,
  "clean-force": true,
  "stash-drop": true,
  "worktree-force-remove": true,
  "force-push": true,
  "commit-amend": true,
  "push-delete": true,
  "branch-force-delete": true,
  "no-verify": true,
  "broad-add": true,
  additionalRules: [],
}

// =============================================================================
// Section 1: Detection function tests
// =============================================================================

describe('matchesResetHard', () => {
  test.each([
    ['git reset --hard', true],
    ['git reset --hard HEAD', true],
    ['git reset --hard HEAD~3', true],
    ['git reset --hard origin/main', true],
    ['git reset --hard abc1234', true],
    ['git reset --soft HEAD~1', false],
    ['git reset --mixed HEAD~1', false],
    ['git reset HEAD file.ts', false],
    ['git reset', false],
  ])('%s → %s', (command, expected) => {
    expect(matchesResetHard(command)).toBe(expected)
  })
})

describe('matchesResetMerge', () => {
  test.each([
    ['git reset --merge', true],
    ['git reset --merge HEAD~1', true],
    ['git reset --soft', false],
    ['git reset --mixed', false],
    ['git reset', false],
  ])('%s → %s', (command, expected) => {
    expect(matchesResetMerge(command)).toBe(expected)
  })
})

describe('matchesCheckoutDiscard', () => {
  test.each([
    ['git checkout -- file.ts', true],
    ['git checkout -- .', true],
    ['git checkout -- src/', true],
    ['git checkout HEAD -- file.ts', true],
    ['git checkout .', true],
    ['git checkout --', true],
    ['git checkout main', false],
    ['git checkout -b new-branch', false],
    ['git checkout feature', false],
    ['git checkout -', false],
    ['git checkout --orphan new', false],
  ])('%s → %s', (command, expected) => {
    expect(matchesCheckoutDiscard(command)).toBe(expected)
  })
})

describe('matchesRestoreDiscard', () => {
  test.each([
    ['git restore file.ts', true],
    ['git restore .', true],
    ['git restore src/', true],
    ['git restore --worktree file.ts', true],
    ['git restore --staged --worktree file.ts', true],
    ['git restore --staged file.ts', false],
    ['git restore --staged .', false],
  ])('%s → %s', (command, expected) => {
    expect(matchesRestoreDiscard(command)).toBe(expected)
  })
})

describe('matchesCleanForce', () => {
  test.each([
    ['git clean -f', true],
    ['git clean -fd', true],
    ['git clean -fx', true],
    ['git clean -fdx', true],
    ['git clean -fX', true],
    ['git clean --force', true],
    ['git clean -df', true],
    ['git clean -n', false],
    ['git clean -dn', false],
    ['git clean -nf', false],
    ['git clean --dry-run', false],
    ['git clean -i', false],
    ['git clean --interactive', false],
    ['git clean', false],
  ])('%s → %s', (command, expected) => {
    expect(matchesCleanForce(command)).toBe(expected)
  })
})

describe('matchesStashDrop', () => {
  test.each([
    ['git stash drop', true],
    ['git stash drop stash@{0}', true],
    ['git stash drop stash@{2}', true],
    ['git stash clear', true],
    ['git stash', false],
    ['git stash push', false],
    ['git stash pop', false],
    ['git stash list', false],
    ['git stash show', false],
    ['git stash apply', false],
  ])('%s → %s', (command, expected) => {
    expect(matchesStashDrop(command)).toBe(expected)
  })
})

describe('matchesWorktreeForceRemove', () => {
  test.each([
    ['git worktree remove --force /path/to/worktree', true],
    ['git worktree remove /path --force', true],
    ['git worktree remove /path', false],
    ['git worktree add /path', false],
    ['git worktree list', false],
  ])('%s → %s', (command, expected) => {
    expect(matchesWorktreeForceRemove(command)).toBe(expected)
  })
})

describe('matchesForcePush', () => {
  // Block
  test.each([
    ['git push --force', true],
    ['git push -f', true],
    ['git push origin main --force', true],
    ['git push --force origin main', true],
    ['git push -f origin feature-branch', true],
    ['git push -vf origin main', true],
    ['git push -fu origin main', true],
    ['git push origin +main', true],
    ['git push --mirror', true],
  ])('blocks: %s → %s', (command, expected) => {
    expect(matchesForcePush(command)).toBe(expected)
  })

  // Allow
  test.each([
    ['git push', false],
    ['git push origin main', false],
    ['git push --force-with-lease', false],
    ['git push --force-with-lease --force-if-includes', false],
    ['git push --force-if-includes', false],
  ])('allows: %s → %s', (command, expected) => {
    expect(matchesForcePush(command)).toBe(expected)
  })

  // Edge cases
  test('allows: --force-with-lease takes precedence over --force', () => {
    expect(matchesForcePush('git push --force-with-lease --force')).toBe(false)
  })

  test('allows: --force-if-includes takes precedence over --force', () => {
    expect(matchesForcePush('git push --force-if-includes --force')).toBe(false)
  })
})

describe('matchesCommitAmend', () => {
  test.each([
    ['git commit --amend', true],
    ['git commit --amend -m "fix"', true],
    ['git commit --amend --no-edit', true],
    ['git commit -m "message"', false],
    ['git commit', false],
  ])('%s → %s', (command, expected) => {
    expect(matchesCommitAmend(command)).toBe(expected)
  })
})

describe('matchesPushDelete', () => {
  test.each([
    ['git push --delete origin feature-branch', true],
    ['git push origin --delete feature-branch', true],
    ['git push origin :feature-branch', true],
    ['git push origin main', false],
    ['git push --force origin main', false],
  ])('%s → %s', (command, expected) => {
    expect(matchesPushDelete(command)).toBe(expected)
  })
})

describe('matchesBranchForceDelete', () => {
  test.each([
    ['git branch -D feature-branch', true],
    ['git branch -D feature-1 feature-2', true],
    ['git branch -d feature-branch', false],
    ['git branch --delete feature', false],
    ['git branch -a', false],
    ['git branch new-branch', false],
    ['git branch -m old new', false],
  ])('%s → %s', (command, expected) => {
    expect(matchesBranchForceDelete(command)).toBe(expected)
  })
})

describe('matchesNoVerify', () => {
  test.each([
    ['git commit --no-verify -m "skip hooks"', true],
    ['git push --no-verify', true],
    ['git merge --no-verify', true],
    ['npm run test --no-verify', false],
  ])('%s → %s', (command, expected) => {
    expect(matchesNoVerify(command)).toBe(expected)
  })

  test('does not match --no-verify inside quotes (stripped by sanitization)', () => {
    // Simulating what the hook does: sanitize first, then test
    const command = 'echo "--no-verify"'
    const sanitized = command
      .replace(/'[^']*'/g, '')
      .replace(/"[^"]*"/g, '')
      .replace(/#.*$/gm, '')
    expect(matchesNoVerify(sanitized)).toBe(false)
  })
})

describe('matchesBroadAdd', () => {
  test.each([
    ['git add -A', true],
    ['git add --all', true],
    ['git add .', true],
    ['git add . src/', false],
    ['git add ./src/utils.ts', false],
    ['git add .github/', false],
    ['git add .gitignore', false],
    ['git add src/file.ts', false],
  ])('%s → %s', (command, expected) => {
    expect(matchesBroadAdd(command)).toBe(expected)
  })
})

// =============================================================================
// Section 2: Handler integration tests
// =============================================================================

describe('hook.PreToolUse', () => {
  test('skips non-Bash tools', () => {
    const result = hook.PreToolUse!(makeCtx('ls', 'Read'), DEFAULT_CONFIG)
    expect(result).toEqual({ result: 'skip' })
  })

  test('skips empty command', () => {
    const result = hook.PreToolUse!(makeCtx(''), DEFAULT_CONFIG)
    expect(result).toEqual({ result: 'skip' })
  })

  test('skips non-git command', () => {
    const result = hook.PreToolUse!(makeCtx('ls -la'), DEFAULT_CONFIG)
    expect(result).toEqual({ result: 'skip' })
  })

  // True positive — one per rule
  test.each([
    ['reset-hard', 'git reset --hard HEAD'],
    ['reset-merge', 'git reset --merge'],
    ['checkout-discard', 'git checkout -- file.ts'],
    ['restore-discard', 'git restore file.ts'],
    ['clean-force', 'git clean -f'],
    ['stash-drop', 'git stash drop'],
    ['worktree-force-remove', 'git worktree remove --force /path'],
    ['force-push', 'git push --force'],
    ['commit-amend', 'git commit --amend'],
    ['push-delete', 'git push --delete origin branch'],
    ['branch-force-delete', 'git branch -D feature'],
    ['no-verify', 'git commit --no-verify -m "msg"'],
    ['broad-add', 'git add .'],
  ])('blocks %s: %s', (ruleId, command) => {
    const result = hook.PreToolUse!(makeCtx(command), DEFAULT_CONFIG) as unknown as Record<string, unknown>
    expect(result.result).toBe('block')
    expect(result.reason).toContain(`[${ruleId}]`)
  })

  // True negative — safe alternative per rule
  test.each([
    ['reset-hard', 'git reset --soft HEAD~1'],
    ['reset-merge', 'git reset --mixed HEAD~1'],
    ['checkout-discard', 'git checkout main'],
    ['restore-discard', 'git restore --staged file.ts'],
    ['clean-force', 'git clean -n'],
    ['stash-drop', 'git stash push'],
    ['worktree-force-remove', 'git worktree remove /path'],
    ['force-push', 'git push --force-with-lease'],
    ['commit-amend', 'git commit -m "message"'],
    ['push-delete', 'git push origin main'],
    ['branch-force-delete', 'git branch -d feature'],
    ['no-verify', 'git commit -m "message"'],
    ['broad-add', 'git add src/file.ts'],
  ])('allows safe alternative for %s: %s', (_ruleId, command) => {
    const result = hook.PreToolUse!(makeCtx(command), DEFAULT_CONFIG) as unknown as Record<string, unknown>
    expect(result.result).toBe('skip')
  })

  test('escape hatch allows destructive command', () => {
    const result = hook.PreToolUse!(
      makeCtx('ALLOW_DESTRUCTIVE_GIT=true git reset --hard'),
      DEFAULT_CONFIG,
    )
    expect(result).toEqual({ result: 'skip' })
  })

  test('escape hatch does NOT skip broad-add', () => {
    const result = hook.PreToolUse!(
      makeCtx('ALLOW_DESTRUCTIVE_GIT=true git add .'),
      DEFAULT_CONFIG,
    ) as unknown as Record<string, unknown>
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[broad-add]')
  })

  test('escape hatch does NOT skip additionalRules', () => {
    const config: Config = {
      ...DEFAULT_CONFIG,
      additionalRules: [{ match: 'git rebase', message: 'No rebase allowed' }],
    }
    const result = hook.PreToolUse!(
      makeCtx('ALLOW_DESTRUCTIVE_GIT=true git rebase main'),
      config,
    ) as unknown as Record<string, unknown>
    expect(result.result).toBe('block')
    expect(result.reason).toBe('No rebase allowed')
  })

  test('config disables a rule', () => {
    const config: Config = { ...DEFAULT_CONFIG, "force-push": false }
    const result = hook.PreToolUse!(makeCtx('git push --force'), config)
    expect(result).toEqual({ result: 'skip' })
  })

  test('additionalRules with custom regex', () => {
    const config: Config = {
      ...DEFAULT_CONFIG,
      additionalRules: [{ match: '\\bgit\\s+rebase\\b', message: 'Rebase blocked by policy' }],
    }
    const result = hook.PreToolUse!(makeCtx('git rebase main'), config) as unknown as Record<string, unknown>
    expect(result.result).toBe('block')
    expect(result.reason).toBe('Rebase blocked by policy')
  })

  test('additionalRules with invalid regex does not crash', () => {
    const config: Config = {
      ...DEFAULT_CONFIG,
      additionalRules: [{ match: '[invalid', message: 'should not crash' }],
    }
    const result = hook.PreToolUse!(makeCtx('git status'), config)
    expect(result).toEqual({ result: 'skip' })
  })

  test('sanitization: git command inside quotes not matched', () => {
    const result = hook.PreToolUse!(
      makeCtx('echo "git reset --hard"'),
      DEFAULT_CONFIG,
    )
    expect(result).toEqual({ result: 'skip' })
  })

  test('debugMessage contains rule ID', () => {
    const result = hook.PreToolUse!(makeCtx('git reset --hard'), DEFAULT_CONFIG) as unknown as Record<
      string,
      unknown
    >
    expect(result.debugMessage).toBe("no-destructive-git: blocked by rule 'reset-hard'")
  })

  test('config disabling one rule does not affect other rules', () => {
    const config: Config = { ...DEFAULT_CONFIG, 'force-push': false }
    const result = hook.PreToolUse!(makeCtx('git reset --hard'), config) as unknown as Record<string, unknown>
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[reset-hard]')
  })

  test('sanitization: git command inside single quotes not matched', () => {
    const result = hook.PreToolUse!(makeCtx("echo 'git reset --hard'"), DEFAULT_CONFIG)
    expect(result).toEqual({ result: 'skip' })
  })

  test('sanitization: git command in comment not matched', () => {
    const result = hook.PreToolUse!(makeCtx('echo hello # git reset --hard'), DEFAULT_CONFIG)
    expect(result).toEqual({ result: 'skip' })
  })

  test('escape hatch allows clean-force', () => {
    const result = hook.PreToolUse!(
      makeCtx('ALLOW_DESTRUCTIVE_GIT=true git clean -f'),
      DEFAULT_CONFIG,
    )
    expect(result).toEqual({ result: 'skip' })
  })

  test('additionalRules debugMessage includes regex', () => {
    const config: Config = {
      ...DEFAULT_CONFIG,
      additionalRules: [{ match: '\\bgit\\s+rebase\\b', message: 'Rebase blocked' }],
    }
    const result = hook.PreToolUse!(makeCtx('git rebase main'), config) as unknown as Record<string, unknown>
    expect(result.debugMessage).toBe("no-destructive-git: blocked by additionalRule '\\bgit\\s+rebase\\b'")
  })
})

// =============================================================================
// Section 3: Edge case tests
// =============================================================================

describe('handler: Git global options', () => {
  const cases = [
    ['reset-hard', 'reset --hard', 'reset --soft HEAD~1'],
    ['reset-merge', 'reset --merge', 'reset --mixed HEAD~1'],
    ['checkout-discard', 'checkout -- file.ts', 'checkout main'],
    ['restore-discard', 'restore file.ts', 'restore --staged file.ts'],
    ['clean-force', 'clean -f', 'clean -nf'],
    ['stash-drop', 'stash drop', 'stash push'],
    ['worktree-force-remove', 'worktree remove --force path', 'worktree remove path'],
    ['force-push', 'push --force', 'push --force-with-lease'],
    ['commit-amend', 'commit --amend', 'commit -m "message"'],
    ['push-delete', 'push --delete origin branch', 'push origin main'],
    ['branch-force-delete', 'branch -D feature', 'branch -d feature'],
    ['no-verify', 'commit --no-verify', 'commit -m "message"'],
    ['broad-add', 'add .', 'add src/file.ts'],
  ]
  const prefixes = [
    '-C repo', '-C "repo with spaces"', "-C 'repo with spaces'",
    '-C ""', "-C ''", '-C repo\\ with\\ spaces',
    '-C"" .', "-C'' .", '-""C .', '-c"" core.autocrlf=false',
    '-c core.autocrlf=false', '-c "core.pager=git reset --hard"',
    '-c core.bare', '--git-dir=repo/.git', '--git-dir repo/.git',
    '--git-dir "repo with spaces/.git"', '--git-dir ""', '--work-tree=repo', '--work-tree repo',
    '--work-tree="repo with spaces"', '--config-env=core.pager=PAGER',
    '--config-env="core.pager=PAGER"', '--config-env core.pager=PATH',
    '--config-env "core.pager=PATH"', '--namespace test', '--namespace=test',
    '--exec-path=/usr/lib/git-core', '--attr-source=HEAD', '--attr-source HEAD',
    '--attr-source "HEAD"', '--shallow-file repo/shallow', '--shallow-file "repo with spaces/shallow"',
    '-C repo -C "" -C subdir -c core.autocrlf=false --no-pager',
    '-C . --config-env core.pager=PATH --attr-source HEAD --shallow-file repo/shallow',
    '--no-literal-pathspecs -C . --no-lazy-fetch --config-env core.pager=PATH --no-advice',
    '-p', '--paginate', '-P', '--no-pager', '--bare', '--no-replace-objects',
    '--literal-pathspecs', '--no-literal-pathspecs', '--glob-pathspecs', '--noglob-pathspecs',
    '--icase-pathspecs', '--no-optional-locks', '--no-lazy-fetch', '--no-advice',
  ]
  const run = (command: string, config = DEFAULT_CONFIG) =>
    hook.PreToolUse!(makeCtx(command), config)

  for (const prefix of prefixes) {
    test.each(cases)(`${prefix}: preserves %s block, safe alternative, config and escape`, (id, dangerous, safe) => {
      const command = `git ${prefix} ${dangerous}`
      const blocked = run(`git ${dangerous}`)
      expect(blocked).toMatchObject({ result: 'block', reason: expect.stringContaining(`[${id}]`) })
      expect(run(command)).toEqual(blocked)
      expect(run(`git ${prefix} ${safe}`)).toEqual({ result: 'skip' })
      expect(run(command, { ...DEFAULT_CONFIG, [id]: false })).toEqual({ result: 'skip' })
      expect(run(`ALLOW_DESTRUCTIVE_GIT=true ${command}`)).toEqual(
        id === 'broad-add' ? blocked : { result: 'skip' },
      )
    })
  }

  test.each([
    ['checkout .', 'checkout-discard'], ['add -A', 'broad-add'], ['add --all', 'broad-add'],
    ['stash clear', 'stash-drop'], ['push -f', 'force-push'],
    ['push origin +main', 'force-push'], ['push --mirror', 'force-push'],
    ['push origin :branch', 'push-delete'], ['clean --force', 'clean-force'],
    ['restore --staged --worktree file.ts', 'restore-discard'],
  ])('retains operation variant %s', (operation, id) => {
    expect(run(`git -C "" ${operation}`)).toMatchObject({
      result: 'block', reason: expect.stringContaining(`[${id}]`),
    })
  })

  test.each([
    'git -C --no-verify status', 'git -C --hard reset --soft',
    'git -c core.pager=--no-verify status',
    'git --git-dir=--no-verify status', 'git --work-tree --no-verify status',
    'git -C "git reset --hard" status', 'git -C "" status',
    'git -C repo clean --dry-run -f', 'git -C repo clean -if',
    'git -C repo push --force-if-includes --force',
    'git -C repo push --force-with-lease --force',
    'echo "git -C repo reset --hard"', "echo 'git -C repo reset --hard'",
    'echo hello # git -C repo reset --hard',
    'git -C repo status # reset --hard', 'git -C repo status "--no-verify"',
    'git -C', 'git -c', 'git --git-dir', 'git --work-tree',
    'git -C "reset" --hard', 'git -c ""', 'git -C repo --unknown reset --hard',
    'git -C "--no-verify" status', "git --work-tree '--force' push origin main",
    'git -C repo -c', 'git -C repo --work-tree',
    'git --config-env', 'git --attr-source', 'git --shallow-file',
    'git -C . --config-env', 'git -C . --attr-source', 'git -C . --shallow-file',
    'git --config-env ""', 'git --attr-source ""', 'git --shallow-file ""',
    'git --config-env "core.pager=--no-verify" status',
    'git --attr-source --no-verify status', 'git --shallow-file --no-verify status',
    'git -C && echo reset --hard', 'git -C; echo reset --hard',
    'git --git-dir | echo reset --hard', 'git --work-tree\necho reset --hard',
    'git -c # git reset --hard',
  ])('skips inert or incomplete input: %s', (command) => {
    expect(run(command)).toEqual({ result: 'skip' })
  })

  test.each(['-Crepo', '-ccore.pager=cat', '-ccore.pager="git reset --hard"', '--shallow-file=repo/shallow'])(
    'does not normalize invalid option %s', (option) => {
      expect(run(`git ${option} reset --hard`)).toEqual({ result: 'skip' })
      expect(run(`git -C . ${option} reset --hard`)).toEqual({ result: 'skip' })
    },
  )

  test.each(['-C""', "-C''", '-c""'])(
    'empty quote fragments in %s do not supply an operand', (option) => {
      expect(run(`git ${option} reset --hard`)).toEqual({ result: 'skip' })
      expect(run(`git -C . ${option} reset --hard`)).toEqual({ result: 'skip' })
    },
  )

  test.each([
    'git -C repo --future-option commit --no-verify',
    'git --no-pager --future-option commit --no-verify',
    'git -C "" --config-env core.pager=PATH --future-option commit --no-verify',
    'git -C repo -Crepo commit --no-verify',
    'git -C --no-verify --future-option status',
  ])('unknown option retains legacy no-verify protection: %s', (command) => {
    expect(run(command)).toEqual(run('git commit --no-verify'))
    expect(run(command, { ...DEFAULT_CONFIG, 'no-verify': false })).toEqual({ result: 'skip' })
    expect(run(`ALLOW_DESTRUCTIVE_GIT=true ${command}`)).toEqual({ result: 'skip' })
  })

  test.each(['&&', '||', ';', '|', '&', '\n'])(
    'unknown-option fallback resumes across %s', (separator) => {
      const unknown = 'git -C repo --future-option commit --no-verify'
      const destructive = 'git -C "" reset --hard'
      const config = { ...DEFAULT_CONFIG, 'no-verify': false }
      expect(run(`${unknown} ${separator} ${destructive}`, config)).toEqual(run('git reset --hard'))
      expect(run(`${destructive} ${separator} ${unknown}`, config)).toEqual(run('git reset --hard'))
      expect(run(`git -C repo status ${separator} ${unknown}`)).toEqual(run('git commit --no-verify'))
      expect(run(`ALLOW_DESTRUCTIVE_GIT=true ${unknown} ${separator} git -C repo add .`))
        .toEqual(run('git add .'))
    },
  )

  test.each(['--config-env core.pager=PATH', '--attr-source HEAD', '--shallow-file repo/shallow'])(
    'separated operand regression: %s before no-verify', (option) => {
      expect(run(`git -C . ${option} commit --no-verify`)).toEqual(run('git commit --no-verify'))
    },
  )

  test.each([
    '-h', '--help', '-v', '--version', '--exec-path', '--html-path',
    '--man-path', '--info-path', '--list-cmds=builtins',
  ])('skips non-executing global query %s', (query) => {
    for (const prefix of ['', '-C "" --no-pager ']) {
      expect(run(`git ${prefix}${query} reset --hard --no-verify`)).toEqual({ result: 'skip' })
    }
  })

  test.each([
    'git -C --dry-run clean -f', 'git -C --force-with-lease push --force',
    'git -c core.pager=--staged restore file.ts',
    'git --attr-source --force-with-lease push --force',
    'git --shallow-file --dry-run clean -f',
    'git --config-env core.pager=--staged restore file.ts',
  ])('global operand cannot suppress operation flags: %s', (command) => {
    expect(run(command)).toMatchObject({ result: 'block' })
  })

  test.each(['&&', '||', ';', '|', '&', '\n'])('stops at boundary %s', (separator) => {
    for (const prefix of ['git -C', 'git -c', 'git --work-tree', 'git --git-dir',
      'git --config-env', 'git --attr-source', 'git --shallow-file',
      'git -C . --config-env', 'git -C . --attr-source', 'git -C . --shallow-file',
      'git -C""', 'git --help reset']) {
      expect(run(`${prefix} ${separator} git -C "" reset --hard`)).toEqual(run('git reset --hard'))
    }
    expect(run(`echo hello ${separator} git -C repo reset --hard`)).toEqual(run('git reset --hard'))
    expect(run(`git -C repo reset --hard ${separator} echo done`)).toEqual(run('git reset --hard'))
  })

  test.each([
    ['git -C repo rebase main', '\\bgit\\s+rebase\\b', false],
    ['git -C repo rebase main', 'git -C repo rebase', true],
    ['git -C "repo" rebase main', 'git -C  rebase', true],
    ['git -C "git rebase" status', 'git rebase', false],
    ['git -C repo status # git rebase', 'git rebase', false],
    ['git --help rebase --no-verify', '--no-verify', true],
    ['git -C repo status', '[invalid', false],
  ])('custom patterns retain original sanitized input: %s / %s', (command, match, blocked) => {
    const config = { ...DEFAULT_CONFIG, additionalRules: [{ match, message: 'custom policy' }] }
    for (const prefix of ['', 'ALLOW_DESTRUCTIVE_GIT=true ']) {
      expect(run(prefix + command, config)).toEqual(blocked ? {
        result: 'block', reason: 'custom policy',
        debugMessage: `no-destructive-git: blocked by additionalRule '${match}'`,
      } : { result: 'skip' })
    }
  })

  test('disabled built-in still checks custom patterns', () => {
    expect(run('ALLOW_DESTRUCTIVE_GIT=true git -C repo add .', {
      ...DEFAULT_CONFIG, 'broad-add': false,
      additionalRules: [{ match: 'git -C repo add', message: 'custom policy' }],
    })).toMatchObject({ result: 'block', reason: 'custom policy' })
  })
})

describe('edge cases', () => {
  test('commands in compound statements: cd /repo && git reset --hard', () => {
    const result = hook.PreToolUse!(
      makeCtx('cd /repo && git reset --hard'),
      DEFAULT_CONFIG,
    ) as unknown as Record<string, unknown>
    expect(result.result).toBe('block')
    expect(result.reason).toContain('[reset-hard]')
  })

  test('git push --force-with-lease --force is allowed (safe alternative wins)', () => {
    const result = hook.PreToolUse!(
      makeCtx('git push --force-with-lease --force'),
      DEFAULT_CONFIG,
    )
    expect(result).toEqual({ result: 'skip' })
  })
})
