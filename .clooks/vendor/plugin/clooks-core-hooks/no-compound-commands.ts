// no-compound-commands — Blocks compound bash commands (&&, ||, ;)
//
// Prevents Claude from chaining multiple commands in a single Bash call.
// Encourages using built-in tools or separate Bash calls instead.
// Escape hatch: prefix with ALLOW_COMPOUND=true.

import type { ClooksHook } from "./types"

const BLOCK_REASON = `Compound command detected. Instead:
  - Use built-in Claude tools (Read, Write, Edit, Grep, Glob) instead of bash
  - Run commands separately in individual Bash calls
  - Write a dedicated bash script in tmp/ for multi-step sequences
  - If both commands MUST run together and a script is overkill, prefix with ALLOW_COMPOUND=true`

// Matches &&, ||, or a single ; (excluding ;; case terminators)
const COMPOUND_RE = /&&|\|\||[^;];[^;]|^;[^;]|[^;];$/m

// Matches a leading `cd <path>` followed by && or ;
// Captures the remainder after the operator so we can check if IT is compound.
const CD_PREFIX_RE = /^cd\s+(?:'[^']*'|"[^"]*"|\S+)\s*(?:&&|;)\s*/

function hasCompoundOperator(text: string): boolean {
  const sanitized = text
    .replace(/'[^']*'/g, '')
    .replace(/"[^"]*"/g, '')
    .replace(/#.*$/gm, '')
  return COMPOUND_RE.test(sanitized)
}

export function isCompoundCommand(command: string): boolean {
  if (command.startsWith('ALLOW_COMPOUND=true')) return false

  // Strip quoted strings and comments to avoid false positives
  const sanitized = command
    .replace(/'[^']*'/g, '')
    .replace(/"[^"]*"/g, '')
    .replace(/#.*$/gm, '')

  if (!COMPOUND_RE.test(sanitized)) return false

  // If the command starts with `cd <path> && ...` or `cd <path>; ...`,
  // allow it as long as the remainder is not itself compound.
  // Match against original command to preserve quoted cd arguments.
  const cdMatch = command.match(CD_PREFIX_RE)
  if (cdMatch) {
    const remainder = command.slice(cdMatch[0].length)
    if (!hasCompoundOperator(remainder)) return false
  }

  return true
}

export const hook: ClooksHook = {
  meta: {
    name: 'no-compound-commands',
    description:
      'Blocks compound bash commands (&&, ||, ;) unless prefixed with ALLOW_COMPOUND=true',
  },

  SessionStart(ctx) {
    return ctx.skip({
      injectContext: `INFORMATION (no need to comment on it): The no-compound-commands clooks hook is active in this project. The Bash tool will refuse compound commands joined with \`&&\`, \`||\`, or \`;\`. Issue each command in a separate Bash call, or write a script under \`tmp/\` for multi-step sequences. A single leading \`cd <path> && <one-command>\` is allowed as a special case.`,
      debugMessage: 'no-compound-commands: announced',
    })
  },

  PreToolUse(ctx) {
    if (ctx.toolName !== 'Bash') {
      return ctx.skip()
    }

    const command = ctx.toolInput.command

    if (!command) {
      return ctx.skip()
    }

    if (isCompoundCommand(command)) {
      return ctx.block({
        reason: BLOCK_REASON,
        debugMessage: `no-compound-commands: blocked "${command}"`,
      })
    }

    return ctx.allow({
      debugMessage: `no-compound-commands: allowed "${command}"`,
    })
  },
}
