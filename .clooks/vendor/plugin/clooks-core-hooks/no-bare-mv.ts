// no-bare-mv — Rewrites bare `mv` commands to `git mv` when possible
//
// When a bare `mv` is detected, runs the rewritten command as a dry-run
// (`git mv -n`) to check feasibility. If it succeeds: rewrites via
// updatedInput. If it fails: lets the bare `mv` through.

import { spawnSync } from 'child_process'
import type { ClooksHook } from './types'

// Matches bare `mv` at the start of a command or after whitespace,
// but not `git mv` or partial words like `mvn`
const MV_RE = /(?:^|\s)mv\s/

export function isBareMove(command: string): boolean {
  const sanitized = command
    .replace(/'[^']*'/g, '')
    .replace(/"[^"]*"/g, '')
    .replace(/#.*$/gm, '')
    .replace(/\bgit\s+mv\b/g, '')

  return MV_RE.test(sanitized)
}

/** Replace the first bare `mv` with `git mv`. */
export function rewriteToGitMv(command: string): string {
  return command.replace(/(?:^|\s)mv\s/, (match) => match.replace('mv ', 'git mv '))
}

/** Run the rewritten command as a dry-run by injecting `-n` after `git mv`. */
export function dryRunSucceeds(rewritten: string, cwd: string): boolean {
  const dryRunCmd = rewritten.replace(/\bgit mv\s/, 'git mv -n ')
  const result = spawnSync('sh', ['-c', dryRunCmd], {
    cwd,
    timeout: 3000,
    stdio: 'pipe',
  })
  return result.status === 0
}

export const hook: ClooksHook = {
  meta: {
    name: 'no-bare-mv',
    description: 'Rewrites bare mv commands to git mv when git mv would succeed',
  },

  PreToolUse(ctx) {
    if (ctx.toolName !== 'Bash') {
      return { result: 'skip' }
    }

    const command = typeof ctx.toolInput.command === 'string' ? ctx.toolInput.command : ''

    if (!command || !isBareMove(command)) {
      return { result: 'skip' }
    }

    const rewritten = rewriteToGitMv(command)

    if (!dryRunSucceeds(rewritten, ctx.cwd)) {
      return {
        result: 'allow',
        debugMessage: `no-bare-mv: dry-run failed, allowing bare mv`,
        injectContext: `no-bare-mv: Unable to automatically use git mv for this operation - consider using git mv if possible`,
      }
    }

    return {
      result: 'allow',
      updatedInput: { command: rewritten },
      injectContext: `[no-bare-mv] Rewrote \`mv\` → \`git mv\` to preserve git history.`,
      debugMessage: `no-bare-mv: rewrote "${command}" → "${rewritten}"`,
    }
  },
}
