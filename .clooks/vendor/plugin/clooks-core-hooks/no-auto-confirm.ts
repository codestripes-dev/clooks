// no-auto-confirm — Blocks piping auto-responses into commands
//
// Piping yes, echo, or printf into a command simulates human input instead of
// using the command's designed non-interactive interface.
//
// Blocked:
//   yes |, yes <words...> |, /usr/bin/yes |,
//   echo y|yes |, echo -e|-n|-ne|-en y|yes |,
//   printf y|yes |
//   (case-insensitive on confirmation tokens y/yes)
//   Per-segment detection (&&, ||, ;)
//
// Explicitly NOT blocked:
//   true | command, echo hello | command, yes (no pipe),
//   echo 'yes | ...' (inside quotes), echo yesterday | command
//
// No escape hatch. No config.

import type { ClooksHook } from './types'

const BLOCK_REASON = `Piping auto-responses (yes, echo, printf) into a command simulates human input instead of using the command's non-interactive mode. Use the command's own flag (e.g. -y, --yes, --force, --non-interactive, -auto-approve) or ask the user to run the command interactively.`

type Token = { kind: 'word'; value: string; literal: boolean } | { kind: 'operator'; value: string }

// This is a bounded lexer, not shell evaluation. Unsupported nested execution
// and heredocs stop inspection, retaining already complete prefix pipelines.
export function confirmationTokens(command: string): Token[] {
  if (command.includes('\0')) return []
  const tokens: Token[] = []
  let i = 0
  while (i < command.length) {
    const char = command[i]!
    if (char === '\\' && command[i + 1] === '\n') {
      i += 2
      continue
    }
    if (/[ \t\r]/.test(char)) {
      i++
      continue
    }
    if (char === '#') {
      while (i < command.length && command[i] !== '\n') i++
      continue
    }
    if (';&|\n<>'.includes(char)) {
      const pair = command.slice(i, i + 2)
      if (pair === '<<') return tokens
      const value = ['&&', '||', '>>', '|&'].includes(pair) ? pair : char
      tokens.push({ kind: 'operator', value })
      i += value.length
      continue
    }
    if ('()'.includes(char)) return tokens
    let value = ''
    let quote = ''
    let literal = true
    while (i < command.length) {
      const next = command[i]!
      if (!quote && /[ \t\r\n;&|<>]/.test(next)) break
      if (next === quote) {
        quote = ''
        i++
        continue
      }
      if (!quote && (next === "'" || next === '"')) {
        quote = next
        i++
        continue
      }
      if (next === '\\' && quote !== "'") {
        const escaped = command[i + 1]
        if (escaped === undefined) return tokens
        if (escaped === '\n') {
          i += 2
          continue
        }
        if (quote === '"' && !['$', '`', '"', '\\'].includes(escaped)) {
          value += next
          i++
        } else {
          value += escaped
          i += 2
        }
        continue
      }
      if (quote !== "'") {
        if (next === '`' || (next === '$' && command[i + 1] === '(')) return tokens
        if (next === '$' || (!quote && /[*?\[\]{}~]/.test(next))) literal = false
        if (!quote && '()'.includes(next)) return tokens
      }
      value += next
      i++
    }
    if (quote) return tokens
    tokens.push({ kind: 'word', value, literal })
  }
  return tokens
}

function confirmationSource(words: Array<Extract<Token, { kind: 'word' }>>): boolean {
  let start = 0
  while (words[start] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[start]!.value)) start++
  const source = words.slice(start)
  if (!source[0]?.literal) return false
  const [name, ...args] = source.map((word) => word.value)
  if (!name) return false
  if (/^(?:[\w./]*\/)?yes$/.test(name)) return true
  if (source.some((word) => !word.literal)) return false
  if (name === 'echo') {
    if (args[0] && /^-[neE]+$/.test(args[0])) args.shift()
    return args.length === 1 && /^(y|yes)$/i.test(args[0]!)
  }
  if (name === 'printf') {
    const confirm = (value: string) => /^(y|yes)(?:\\n|\n)?$/i.test(value)
    if (args.length === 1) return confirm(args[0]!)
    return (
      args.length === 2 &&
      /^%[sb](?:\\n|\n)?$/.test(args[0]!) &&
      (args[0]!.startsWith('%b') ? confirm(args[1]!) : /^(y|yes)\n?$/i.test(args[1]!))
    )
  }
  return false
}

export function isAutoConfirm(command: string): boolean {
  let words: Array<Extract<Token, { kind: 'word' }>> = []
  let redirected = false
  for (const token of confirmationTokens(command)) {
    if (token.kind === 'word') words.push(token)
    else {
      if (['<', '>', '>>'].includes(token.value)) {
        redirected = true
        continue
      }
      if (!redirected && (token.value === '|' || token.value === '|&') && confirmationSource(words))
        return true
      words = []
      redirected = false
    }
  }
  return false
}

export const hook: ClooksHook = {
  meta: {
    name: 'no-auto-confirm',
    description:
      'Blocks piping auto-responses (yes, echo, printf) into commands instead of using non-interactive flags',
  },

  SessionStart(ctx) {
    return ctx.skip({
      injectContext: `INFORMATION (no need to comment on it): The no-auto-confirm clooks hook is active in this project. Shell commands will be blocked for piping auto-confirmation into commands — \`yes |\`, \`echo y |\`, \`printf y |\`, and similar. Use the command's own non-interactive flag (\`-y\`, \`--yes\`, \`--force\`, \`--non-interactive\`, \`-auto-approve\`, etc.) instead, or ask the user to run the command interactively.`,
      debugMessage: 'no-auto-confirm: announced',
    })
  },

  PreToolUse(ctx) {
    if (ctx.toolName !== 'Bash') return ctx.skip()

    const command = typeof ctx.toolInput.command === 'string' ? ctx.toolInput.command : ''
    if (!command) return ctx.skip()

    try {
      if (isAutoConfirm(command)) {
        return ctx.block({
          reason: BLOCK_REASON,
          debugMessage: `no-auto-confirm: blocked "${command}"`,
        })
      }
    } catch {
      return ctx.skip()
    }

    return ctx.skip()
  },
}
