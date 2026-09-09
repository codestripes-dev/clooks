// Inspect only a standalone literal, two-operand mv, with no options other
// than --. Git dry-run feasibility is not a history guarantee.

import { spawnSync } from 'child_process'
import type { ClooksHook } from './types'

type Move = { argv: string[]; commandStart: number }

export function literalMove(command: string): Move | null {
  if (/[\r\n\0]/.test(command)) return null
  const words: Array<{ value: string; start: number; end: number }> = []
  let i = 0
  while (i < command.length) {
    if (/[ \t]/.test(command[i]!)) {
      i++
      continue
    }
    const start = i
    let value = ''
    let quote = ''
    while (i < command.length) {
      const char = command[i]!
      if (!quote && /[ \t]/.test(char)) break
      if (char === quote) {
        quote = ''
        i++
        continue
      }
      if (!quote && (char === "'" || char === '"')) {
        quote = char
        i++
        continue
      }
      if (char === '\\' && quote !== "'") {
        const next = command[i + 1]
        if (next === undefined) return null
        if (quote === '"' && !['$', '`', '"', '\\'].includes(next)) {
          value += char
          i++
        } else {
          value += next
          i += 2
        }
        continue
      }
      if (quote !== "'" && /[$`]/.test(char)) return null
      if (!quote && /[;&|<>()*?\[\]{}~#]/.test(char)) return null
      value += char
      i++
    }
    if (quote) return null
    words.push({ value, start, end: i })
  }
  const first = words[0]
  if (!first || command.slice(first.start, first.end) !== 'mv') return null
  const args = words.slice(1).map((word) => word.value)
  const operands = args[0] === '--' ? args.slice(1) : args
  if (operands.length !== 2 || operands.some((value) => !value)) return null
  if (args[0] !== '--' && operands.some((value) => value.startsWith('-'))) return null
  return { argv: args, commandStart: first.start }
}

export function isBareMove(command: string): boolean {
  return literalMove(command) !== null
}

export function rewriteToGitMv(command: string): string {
  const move = literalMove(command)
  return move
    ? command.slice(0, move.commandStart) + 'git ' + command.slice(move.commandStart)
    : command
}

export function dryRunSucceeds(argv: string[], cwd: string): boolean {
  const result = spawnSync('git', ['mv', '-n', ...argv], {
    cwd,
    timeout: 3000,
    stdio: 'pipe',
  })
  return result.status === 0
}

export const hook: ClooksHook = {
  meta: {
    name: 'no-bare-mv',
    description: 'Rewrites a supported literal mv when git mv dry-run succeeds',
  },

  PreToolUse(ctx) {
    if (ctx.toolName !== 'Bash') {
      return ctx.skip()
    }

    const command = ctx.toolInput.command

    if (typeof command !== 'string') return ctx.skip()
    const move = literalMove(command)
    if (!move) {
      return ctx.skip()
    }

    const rewritten = rewriteToGitMv(command)

    if (!dryRunSucceeds(move.argv, ctx.cwd)) {
      return ctx.allow({
        debugMessage: `no-bare-mv: dry-run failed, allowing bare mv`,
        injectContext: `no-bare-mv: Unable to automatically use git mv for this operation - consider using git mv if possible`,
      })
    }

    return ctx.allow({
      updatedInput: { command: rewritten },
      injectContext: '[no-bare-mv] Rewrote mv to git mv after a successful feasibility dry-run.',
      debugMessage: `no-bare-mv: rewrote "${command}" → "${rewritten}"`,
    })
  },
}
