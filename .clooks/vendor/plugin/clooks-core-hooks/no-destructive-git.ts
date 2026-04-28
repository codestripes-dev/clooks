// no-destructive-git — Blocks dangerous git operations via PreToolUse on Bash commands
//
// Blocked (13 rules):
//   reset-hard, reset-merge, checkout-discard, restore-discard,
//   clean-force, stash-drop, worktree-force-remove, force-push,
//   commit-amend, push-delete, branch-force-delete, no-verify, broad-add
//
// Explicitly NOT blocked (safe alternatives):
//   --force-with-lease, --force-if-includes, git branch -d, git restore --staged,
//   git clean -n, git clean --dry-run, git clean -i
//
// Escape hatch: prefix command with ALLOW_DESTRUCTIVE_GIT=true
// (does NOT escape broad-add or additionalRules)

import type { ClooksHook } from './types'

type Config = {
  [key: string]: boolean | { match: string; message: string }[] | undefined
  additionalRules?: { match: string; message: string }[]
}

function sanitize(command: string): string {
  return command
    .replace(/'[^']*'/g, '')
    .replace(/"[^"]*"/g, '')
    .replace(/#.*$/gm, '')
}

// --- Detection functions (exported for unit testing) ---

export function matchesResetHard(sanitized: string): boolean {
  return /\bgit\s+reset\b.*--hard/.test(sanitized)
}

export function matchesResetMerge(sanitized: string): boolean {
  return /\bgit\s+reset\b.*--merge/.test(sanitized)
}

export function matchesCheckoutDiscard(sanitized: string): boolean {
  return (
    /\bgit\s+checkout\b.*\s--(\s|$)/.test(sanitized) || /\bgit\s+checkout\s+\.\s*$/.test(sanitized)
  )
}

export function matchesRestoreDiscard(sanitized: string): boolean {
  if (!/\bgit\s+restore\b/.test(sanitized)) return false
  const hasStaged = /--staged/.test(sanitized)
  const hasWorktree = /--worktree/.test(sanitized)
  if (hasStaged && !hasWorktree) return false
  return true
}

export function matchesCleanForce(sanitized: string): boolean {
  if (!/\bgit\s+clean\b/.test(sanitized)) return false

  const tokens = sanitized.split(/\s+/)

  // Check combined short flags first
  for (const token of tokens) {
    if (token.startsWith('-') && !token.startsWith('--')) {
      if (token.includes('n') || token.includes('i')) return false
    }
  }

  // Check long safe flags
  if (/--dry-run/.test(sanitized) || /--interactive/.test(sanitized)) return false

  // Now check for force
  if (/--force/.test(sanitized)) return true
  for (const token of tokens) {
    if (token.startsWith('-') && !token.startsWith('--')) {
      if (token.includes('f')) return true
    }
  }

  return false
}

export function matchesStashDrop(sanitized: string): boolean {
  return /\bgit\s+stash\s+(drop|clear)\b/.test(sanitized)
}

export function matchesWorktreeForceRemove(sanitized: string): boolean {
  return /\bgit\s+worktree\s+remove\b.*--force/.test(sanitized)
}

export function matchesForcePush(sanitized: string): boolean {
  if (!/\bgit\s+push\b/.test(sanitized)) return false

  // Safe alternatives take precedence
  if (/--force-with-lease/.test(sanitized)) return false
  if (/--force-if-includes/.test(sanitized)) return false

  // Check --force (long flag) — negative lookahead prevents matching --force-with-lease
  if (/--force(?!-)/.test(sanitized)) return true

  // Check -f in short flag bundles
  const tokens = sanitized.split(/\s+/)
  for (const token of tokens) {
    if (/^-[a-zA-Z]+$/.test(token) && token.includes('f')) return true
  }

  // Check +refspec: token starting with + that doesn't start with -
  // Find tokens after "git push"
  const pushMatch = sanitized.match(/\bgit\s+push\b\s*(.*)/)
  if (pushMatch) {
    const afterPush = pushMatch[1].split(/\s+/)
    for (const token of afterPush) {
      if (token.startsWith('+') && !token.startsWith('-')) return true
    }
  }

  // Check --mirror
  if (/--mirror\b/.test(sanitized)) return true

  return false
}

export function matchesCommitAmend(sanitized: string): boolean {
  return /\bgit\s+commit\b.*--amend/.test(sanitized)
}

export function matchesPushDelete(sanitized: string): boolean {
  return /\bgit\s+push\b.*--delete/.test(sanitized) || /\bgit\s+push\s+\S+\s+:[^\s]/.test(sanitized)
}

export function matchesBranchForceDelete(sanitized: string): boolean {
  return /\bgit\s+branch\b.*\s-[a-zA-Z]*D/.test(sanitized)
}

export function matchesNoVerify(sanitized: string): boolean {
  return /\bgit\s+\S+.*--no-verify/.test(sanitized)
}

export function matchesBroadAdd(sanitized: string): boolean {
  return /\bgit\s+add\s+(-A|--all)\b/.test(sanitized) || /\bgit\s+add\s+\.\s*$/.test(sanitized)
}

// --- Rules table ---

interface Rule {
  id: string
  detect: (sanitized: string) => boolean
  reason: string
  hasEscapeHatch: boolean
}

const RULES: Rule[] = [
  {
    id: 'reset-hard',
    detect: matchesResetHard,
    reason:
      '[reset-hard] git reset --hard discards all uncommitted changes. Use --soft or --mixed to preserve changes, or prefix with ALLOW_DESTRUCTIVE_GIT=true if the user explicitly approved this.',
    hasEscapeHatch: true,
  },
  {
    id: 'reset-merge',
    detect: matchesResetMerge,
    reason:
      '[reset-merge] git reset --merge can discard uncommitted changes. Use --soft or --mixed to preserve changes, or prefix with ALLOW_DESTRUCTIVE_GIT=true if the user explicitly approved this.',
    hasEscapeHatch: true,
  },
  {
    id: 'checkout-discard',
    detect: matchesCheckoutDiscard,
    reason:
      '[checkout-discard] git checkout -- discards unstaged changes. Use git stash to save changes first, or prefix with ALLOW_DESTRUCTIVE_GIT=true if the user explicitly approved this.',
    hasEscapeHatch: true,
  },
  {
    id: 'restore-discard',
    detect: matchesRestoreDiscard,
    reason:
      '[restore-discard] git restore discards unstaged changes. Use git restore --staged to unstage, or git stash to save changes first, or prefix with ALLOW_DESTRUCTIVE_GIT=true if the user explicitly approved this.',
    hasEscapeHatch: true,
  },
  {
    id: 'clean-force',
    detect: matchesCleanForce,
    reason:
      '[clean-force] git clean -f permanently deletes untracked files. Use git clean -n for a dry run first, or prefix with ALLOW_DESTRUCTIVE_GIT=true if the user explicitly approved this.',
    hasEscapeHatch: true,
  },
  {
    id: 'stash-drop',
    detect: matchesStashDrop,
    reason:
      '[stash-drop] git stash drop/clear permanently deletes stashed work. Prefix with ALLOW_DESTRUCTIVE_GIT=true if the user explicitly approved this.',
    hasEscapeHatch: true,
  },
  {
    id: 'worktree-force-remove',
    detect: matchesWorktreeForceRemove,
    reason:
      '[worktree-force-remove] git worktree remove --force discards uncommitted changes in the worktree. Use git worktree remove (without --force) to check for changes first, or prefix with ALLOW_DESTRUCTIVE_GIT=true if the user explicitly approved this.',
    hasEscapeHatch: true,
  },
  {
    id: 'force-push',
    detect: matchesForcePush,
    reason:
      '[force-push] git push --force can destroy remote history. Use --force-with-lease instead, or prefix with ALLOW_DESTRUCTIVE_GIT=true if the user explicitly approved this.',
    hasEscapeHatch: true,
  },
  {
    id: 'commit-amend',
    detect: matchesCommitAmend,
    reason:
      '[commit-amend] git commit --amend rewrites the previous commit. Only do this if approved by the user or the system prompt. Prefix with ALLOW_DESTRUCTIVE_GIT=true if approved.',
    hasEscapeHatch: true,
  },
  {
    id: 'push-delete',
    detect: matchesPushDelete,
    reason:
      '[push-delete] git push --delete permanently removes a remote branch or tag. Prefix with ALLOW_DESTRUCTIVE_GIT=true if the user explicitly approved this.',
    hasEscapeHatch: true,
  },
  {
    id: 'branch-force-delete',
    detect: matchesBranchForceDelete,
    reason:
      '[branch-force-delete] git branch -D force-deletes regardless of merge status. Use git branch -d for safe delete, or prefix with ALLOW_DESTRUCTIVE_GIT=true if the user explicitly approved this.',
    hasEscapeHatch: true,
  },
  {
    id: 'no-verify',
    detect: matchesNoVerify,
    reason:
      '[no-verify] Do not skip git hooks with --no-verify. Fix the underlying issue instead, or prefix with ALLOW_DESTRUCTIVE_GIT=true if the user explicitly approved this.',
    hasEscapeHatch: true,
  },
  {
    id: 'broad-add',
    detect: matchesBroadAdd,
    reason:
      '[broad-add] Use git add <specific-files> instead of git add -A / git add . to avoid staging secrets or unwanted files. [No escape hatch — always use specific paths.]',
    hasEscapeHatch: false,
  },
]

// --- Hook export ---

export const hook: ClooksHook<Config> = {
  meta: {
    name: 'no-destructive-git',
    description: 'Blocks dangerous git operations via PreToolUse on Bash commands',
    config: {
      'reset-hard': true,
      'reset-merge': true,
      'checkout-discard': true,
      'restore-discard': true,
      'clean-force': true,
      'stash-drop': true,
      'worktree-force-remove': true,
      'force-push': true,
      'commit-amend': true,
      'push-delete': true,
      'branch-force-delete': true,
      'no-verify': true,
      'broad-add': true,
      additionalRules: [],
    },
  },

  PreToolUse(ctx, config) {
    // 1. Skip non-Bash tools
    if (ctx.toolName !== 'Bash') return ctx.skip()

    // 2. Skip empty commands
    const command = ctx.toolInput.command
    if (!command) return ctx.skip()

    // 3. Sanitize: strip quoted strings and comments
    const sanitized = sanitize(command)

    // 4. Check escape hatch prefix (on original command, not sanitized)
    const hasEscapeHatch = command.startsWith('ALLOW_DESTRUCTIVE_GIT=true')

    // 5. Check each enabled built-in rule
    for (const rule of RULES) {
      if (config[rule.id] === false) continue
      if (hasEscapeHatch && rule.hasEscapeHatch) continue
      if (rule.detect(sanitized)) {
        return ctx.block({
          reason: rule.reason,
          debugMessage: `no-destructive-git: blocked by rule '${rule.id}'`,
        })
      }
    }

    // 6. Check additionalRules (NOT affected by escape hatch or rule booleans)
    if (config.additionalRules) {
      for (const custom of config.additionalRules) {
        try {
          if (new RegExp(custom.match).test(sanitized)) {
            return ctx.block({
              reason: custom.message,
              debugMessage: `no-destructive-git: blocked by additionalRule '${custom.match}'`,
            })
          }
        } catch {
          // Invalid regex — skip silently
        }
      }
    }

    // 7. No match — skip (not allow)
    return ctx.skip()
  },
}
