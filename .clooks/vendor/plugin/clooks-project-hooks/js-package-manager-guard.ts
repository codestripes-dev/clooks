// js-package-manager-guard — Blocks wrong JS/TS package managers, runners, and runtimes
//
// Known universe (9 tools): npm, npx, node, yarn, pnpm, pnpx, bun, bunx, deno
//
// Users configure allowed tools (e.g., allowed: ["bun"]). Everything else in the
// known universe is blocked. Auto-extension: npm→npx+node, pnpm→pnpx, bun→bunx.
//
// Explicitly NOT blocked:
//   Non-JS tools (cargo, pip, etc.), pipe targets, PM names in string literals,
//   PM names in paths, tools outside the known universe (unless in additionalBlocked)
//
// No escape hatch — configuration is the control mechanism.
// When unconfigured (allowed is empty), injects a SessionStart warning.

import type { ClooksHook } from "./types"

type Config = {
  allowed: string[]
  additionalBlocked?: Array<{ tool: string; message: string }>
}

// --- Constants ---

type ToolRole = 'pm' | 'runner' | 'runtime'

const KNOWN_UNIVERSE: ReadonlyMap<string, ToolRole> = new Map([
  ['npm', 'pm'],
  ['npx', 'runner'],
  ['node', 'runtime'],
  ['yarn', 'pm'],
  ['pnpm', 'pm'],
  ['pnpx', 'runner'],
  ['bun', 'pm'],        // also runtime, but pm is primary
  ['bunx', 'runner'],
  ['deno', 'runtime'],  // also pm, but runtime is primary
])

const AUTO_EXTENSIONS: ReadonlyMap<string, readonly string[]> = new Map([
  ['npm', ['npx', 'node']],
  ['pnpm', ['pnpx']],
  ['bun', ['bunx']],
])

const RUNNER_FOR: ReadonlyMap<string, string> = new Map([
  ['npm', 'npx'],
  ['pnpm', 'pnpx'],
  ['bun', 'bunx'],
])

const RUNTIME_CAPABLE = new Set(['node', 'bun', 'deno'])

// --- Private helpers ---

// Bounded lexical inspection, not shell evaluation. Only pipeline heads count;
// nested execution and heredocs stop inspection of the remaining input.
function commandHeads(command: string): string[] {
  const heads: string[] = []
  if (command.includes('\0')) return heads
  let i = 0
  let head = true
  let pipeTarget = false
  let pendingPipe = false
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
    if (';&|\n'.includes(char)) {
      const pair = command.slice(i, i + 2)
      if (char === '|' && pair !== '||') {
        pipeTarget = true
        pendingPipe = true
      } else if (char !== '\n' || !pendingPipe) {
        pipeTarget = false
        pendingPipe = false
      }
      head = true
      i += ['&&', '||', '|&'].includes(pair) ? 2 : 1
      continue
    }
    if ('()'.includes(char) || command.slice(i, i + 2) === '<<') return heads
    if ('<>'.includes(char)) {
      head = false
      i++
      continue
    }
    const start = i
    let value = ''
    let quote = ''
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
        if (escaped === undefined) return heads
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
      if (quote !== "'" && (next === '`' || (next === '$' && command[i + 1] === '(') || (!quote && '()'.includes(next)))) return heads
      value += next
      i++
    }
    if (quote) return heads
    pendingPipe = false
    if (head && /^[A-Za-z_][A-Za-z0-9_]*=/.test(command.slice(start, i))) continue
    if (head && !pipeTarget) heads.push(value)
    head = false
  }
  return heads
}

// --- Exported utility and detection functions ---

export function expandAllowed(allowed: string[]): Set<string> {
  const expanded = new Set(allowed)
  for (const entry of allowed) {
    const extensions = AUTO_EXTENSIONS.get(entry)
    if (extensions) {
      for (const ext of extensions) expanded.add(ext)
    }
  }
  return expanded
}

export function isBlocked(firstWord: string, expandedAllowed: Set<string>): boolean {
  return KNOWN_UNIVERSE.has(firstWord) && !expandedAllowed.has(firstWord)
}

export function generateBlockMessage(blocked: string, expandedAllowed: Set<string>, allowed: string[]): string {
  const role = KNOWN_UNIVERSE.get(blocked)

  let suggested: string | null = null
  let context: string | null = null

  if (role === 'pm') {
    // Find first allowed PM
    for (const entry of allowed) {
      if (KNOWN_UNIVERSE.get(entry) === 'pm') {
        suggested = entry
        context = 'for package management'
        break
      }
    }
  } else if (role === 'runner') {
    // Find runner for first allowed PM
    for (const entry of allowed) {
      const runner = RUNNER_FOR.get(entry)
      if (runner) {
        suggested = runner
        context = 'for package execution'
        break
      }
    }
    // Fallback: use first PM-capable entry directly
    if (!suggested) {
      for (const entry of allowed) {
        if (KNOWN_UNIVERSE.get(entry) === 'pm') {
          suggested = entry
          context = 'for package execution'
          break
        }
      }
    }
  } else if (role === 'runtime') {
    // Find first runtime-capable tool in expanded set
    for (const tool of expandedAllowed) {
      if (RUNTIME_CAPABLE.has(tool)) {
        suggested = tool
        context = 'as its JS runtime'
        break
      }
    }
  }

  if (suggested && context) {
    return `[js-package-manager-guard] This project uses ${suggested} ${context}. Use '${suggested}' instead of '${blocked}'.`
  }

  return `[js-package-manager-guard] '${blocked}' is not allowed in this project. Allowed tools: ${allowed.join(', ')}.`
}

export function detectBlockedTool(command: string, expandedAllowed: Set<string>): string | null {
  for (const firstWord of commandHeads(command)) {
    if (isBlocked(firstWord, expandedAllowed)) {
      return firstWord
    }
  }

  return null
}

export function isAdditionalBlocked(command: string, additionalBlocked: Array<{ tool: string; message: string }>): { tool: string; message: string } | null {
  for (const firstWord of commandHeads(command)) {
    for (const entry of additionalBlocked) {
      if (firstWord === entry.tool) {
        return entry
      }
    }
  }

  return null
}

// --- Hook export ---

export const hook: ClooksHook<Config> = {
  meta: {
    name: 'js-package-manager-guard',
    description: 'Blocks wrong JS/TS package managers, runners, and runtimes',
    config: {
      allowed: [],
      additionalBlocked: [],
    },
  },

  SessionStart(ctx, config) {
    const allowed = Array.isArray(config.allowed) ? config.allowed : []

    if (allowed.length === 0) {
      return ctx.skip({
        injectContext: `CONFIGURATION REQUIRED: The js-package-manager-guard hook is enabled but has no package managers configured. In your very first response, regardless of what the user asked, inform them about this AND proactively offer to configure it for them.

You have enough information to do the configuration yourself — do not just ask the user to do it. Offer, and if they agree, detect the right package manager and edit clooks.yml.

How to detect the project's package manager (in priority order):
  1. package.json "packageManager" field (e.g., "bun@1.1.0" → bun, "pnpm@9" → pnpm)
  2. Lockfiles in the project root:
     - bun.lockb or bun.lock → bun
     - pnpm-lock.yaml → pnpm
     - yarn.lock → yarn
     - package-lock.json → npm
     - deno.lock → deno
  3. If none found, ask the user which one they use.

How to configure (edit .clooks/clooks.yml):
  Find the js-package-manager-guard entry and set the allowed list. Example:

    js-package-manager-guard:
      config:
        allowed: ["bun"]

  Only list the primary PM(s) — runners (npx, pnpx, bunx) and runtimes (node) are auto-extended from their PM and do not need to be listed separately. List multiple entries only if the project genuinely uses more than one (rare).

If the user wants to disable the hook instead, set enabled: false on the hook in clooks.yml or remove it.

Without configuration, this hook cannot protect against wrong package manager usage. Do not wait for the user to ask — mention this immediately. This notice will stop appearing once the allowed list is configured.`,
        debugMessage: 'js-package-manager-guard: unconfigured, injecting warning',
      })
    }

    const expandedAllowed = expandAllowed(allowed)
    const allowedTools = Array.from(expandedAllowed)
    const blockedTools = Array.from(KNOWN_UNIVERSE.keys()).filter(t => !expandedAllowed.has(t))
    const allowedList = allowedTools.map(t => `\`${t}\``).join(', ')
    const blockedList = blockedTools.map(t => `\`${t}\``).join(', ')

    const injectContext = 'INFORMATION (no need to comment on it):' + (blockedTools.length > 0
      ? `The js-package-manager-guard clooks hook is active in this project. Allowed JS toolchain: ${allowedList}. Calls through shell tools will be blocked for other JS package managers, runners, and runtimes: ${blockedList}.`
      : `The js-package-manager-guard clooks hook is active in this project. Allowed JS toolchain: ${allowedList}.`)

    return ctx.skip({
      injectContext,
      debugMessage: 'js-package-manager-guard: announced',
    })
  },

  PreToolUse(ctx, config) {
    // 1. Skip non-Bash tools
    if (ctx.toolName !== 'Bash') return ctx.skip()

    // 2. Skip empty commands
    const command = ctx.toolInput.command
    if (!command) return ctx.skip()

    // 3. Skip if unconfigured (allowed is empty — warning already injected on SessionStart)
    const allowed = Array.isArray(config.allowed) ? config.allowed : []
    if (allowed.length === 0) return ctx.skip()

    // 4. Expand the allowed set (PM → runner/runtime)
    const expandedAllowed = expandAllowed(allowed)

    // 5. Check against known universe
    const blockedTool = detectBlockedTool(command, expandedAllowed)
    if (blockedTool) {
      const reason = generateBlockMessage(blockedTool, expandedAllowed, allowed)
      return ctx.block({
        reason,
        debugMessage: `js-package-manager-guard: blocked '${blockedTool}'`,
      })
    }

    // 6. Check additionalBlocked
    const additional = Array.isArray(config.additionalBlocked) ? config.additionalBlocked : []
    if (additional.length > 0) {
      const match = isAdditionalBlocked(command, additional)
      if (match) {
        return ctx.block({
          reason: `[js-package-manager-guard] ${match.message}`,
          debugMessage: `js-package-manager-guard: blocked '${match.tool}' (additionalBlocked)`,
        })
      }
    }

    // 7. No match — skip (not allow)
    return ctx.skip()
  },
}
