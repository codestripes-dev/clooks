// no-compound-commands — Blocks compound bash commands (&&, ||, ;)
//
// Prevents Claude from chaining multiple commands in a single Bash call.
// Encourages using built-in tools or separate Bash calls instead.
// Escape hatch: prefix with ALLOW_COMPOUND=true.

import type { ClooksHook } from './types'

const BLOCK_REASON = `Compound command detected. Instead:
  - Use built-in Claude tools (Read, Write, Edit, Grep, Glob) instead of bash
  - Run commands separately in individual Bash calls
  - Write a dedicated bash script in tmp/ for multi-step sequences
  - If both commands MUST run together and a script is overkill, prefix with ALLOW_COMPOUND=true`

// Matches &&, ||, or a single ; (excluding ;; case terminators)
const COMPOUND_RE = /&&|\|\||[^;];[^;]|^;[^;]|[^;];$/m

export function isCompoundCommand(command: string): boolean {
  if (command.startsWith('ALLOW_COMPOUND=true')) return false

  // Strip quoted strings and comments to avoid false positives
  const sanitized = command
    .replace(/'[^']*'/g, '')
    .replace(/"[^"]*"/g, '')
    .replace(/#.*$/gm, '')

  return COMPOUND_RE.test(sanitized)
}

export const hook: ClooksHook = {
  meta: {
    name: 'no-compound-commands',
    description:
      'Blocks compound bash commands (&&, ||, ;) unless prefixed with ALLOW_COMPOUND=true',
  },

  PreToolUse(ctx) {
    if (ctx.toolName !== 'Bash') {
      return { result: 'skip' }
    }

    const command = typeof ctx.toolInput.command === 'string' ? ctx.toolInput.command : ''

    if (!command) {
      return { result: 'skip' }
    }

    if (isCompoundCommand(command)) {
      return {
        result: 'block',
        reason: BLOCK_REASON,
        debugMessage: `no-compound-commands: blocked "${command}"`,
      }
    }

    return {
      result: 'allow',
      debugMessage: `no-compound-commands: allowed "${command}"`,
    }
  },
}
