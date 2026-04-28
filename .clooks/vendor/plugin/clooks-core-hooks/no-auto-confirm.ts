// no-auto-confirm — Blocks piping auto-responses into commands
//
// Piping yes, echo, or printf into a command simulates human input instead of
// using the command's designed non-interactive interface.
//
// Blocked:
//   yes |, yes <word> |, /usr/bin/yes |,
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

import type { ClooksHook } from "./types"

const BLOCK_REASON = `Piping auto-responses (yes, echo, printf) into a command simulates human input instead of using the command's non-interactive mode. Use the command's own flag (e.g. -y, --yes, --force, --non-interactive, -auto-approve) or ask the user to run the command interactively.`

export function sanitize(command: string): string {
  return command
    .replace(/'[^']*'/g, '')
    .replace(/"[^"]*"/g, '')
    .replace(/#.*$/gm, '')
}

export function getSegments(sanitized: string): string[] {
  return sanitized.split(/\s*(?:&&|\|\||;)\s*/).filter(s => s.length > 0)
}

export function stripEnvPrefix(segment: string): string {
  return segment.trim().replace(/^(?:\w+=\S*\s+)*/, '')
}

export function isAutoConfirm(stripped: string): boolean {
  // yes: optional path prefix, optional argument, pipe
  if (/^(?:[\w./]*\/)?yes(?:\s+\S+)?\s*\|/.test(stripped)) return true

  // echo: optional -[neE]+ flags, then y or yes (case-insensitive), pipe
  if (/^echo\s+(?:-[neE]+\s+)?[yY](?:[eE][sS])?\s*\|/.test(stripped)) return true

  // printf: y or yes (case-insensitive), pipe
  if (/^printf\s+[yY](?:[eE][sS])?\s*\|/.test(stripped)) return true

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
      injectContext: `INFORMATION (no need to comment on it): The no-auto-confirm clooks hook is active in this project. The Bash tool will refuse piping auto-confirmation into commands — \`yes |\`, \`echo y |\`, \`printf y |\`, and similar. Use the command's own non-interactive flag (\`-y\`, \`--yes\`, \`--force\`, \`--non-interactive\`, \`-auto-approve\`, etc.) instead, or ask the user to run the command interactively.`,
      debugMessage: 'no-auto-confirm: announced',
    })
  },

  PreToolUse(ctx) {
    if (ctx.toolName !== 'Bash') return ctx.skip()

    const command = typeof ctx.toolInput.command === 'string'
      ? ctx.toolInput.command : ''
    if (!command) return ctx.skip()

    try {
      const sanitized = sanitize(command)
      const segments = getSegments(sanitized)

      for (const segment of segments) {
        const stripped = stripEnvPrefix(segment)
        if (!stripped) continue

        if (isAutoConfirm(stripped)) {
          return ctx.block({
            reason: BLOCK_REASON,
            debugMessage: `no-auto-confirm: blocked "${command}"`,
          })
        }
      }
    } catch {
      return ctx.skip()
    }

    return ctx.skip()
  },
}
