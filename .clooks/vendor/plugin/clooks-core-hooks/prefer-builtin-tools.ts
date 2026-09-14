// prefer-builtin-tools — Provider-aware shell tool preferences
//
// Blocked (9 rules):
//   cat, head, tail, grep (grep/rg/egrep/fgrep), find, sed-inplace,
//   ls, sleep, echo-redirect (echo/printf with >)
//
// Explicitly NOT blocked (safe alternatives):
//   awk, curl/wget, less/more, mv, sed without -i, echo/printf without redirect,
//   wc/sort/uniq/cut/tr/diff/jq, touch/mkdir/cp/chmod, pipe targets, pipe sources
//
// Escape hatch: prefix command with ALLOW_BUILTIN_COMMAND=true
// (does NOT escape additionalRules)

import type { ClooksHook } from "./types"

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

// --- Segment-processing utilities (exported for unit testing) ---

export function getSegments(sanitized: string): string[] {
  return sanitized.split(/\s*(?:&&|\|\||;)\s*/).filter(s => s.length > 0)
}

export function extractSegmentInfo(segment: string): { command: string; hasPipe: boolean; firstWord: string } {
  const pipeIndex = segment.indexOf('|')
  const hasPipe = pipeIndex !== -1
  const prePipe = hasPipe ? segment.slice(0, pipeIndex) : segment
  const trimmed = prePipe.trim()
  const command = trimmed.replace(/^(?:\w+=\S*\s+)*/, '')  // strip VAR=val prefixes
  const firstWord = command.split(/\s/)[0] || ''
  return { command, hasPipe, firstWord }
}

// --- Per-rule detection functions (exported for unit testing) ---

export function isTailFollow(segment: string): boolean {
  const afterTail = segment.replace(/^.*?\btail\s+/, '')
  return /(?:^|\s)-[a-zA-Z0-9]*[fF]/.test(afterTail) || /--follow/.test(afterTail)
}

export function hasSedInplace(segment: string): boolean {
  return /(?:^|\s)-i(?:\S*)(?:\s|$)/.test(segment) || /--in-place/.test(segment)
}

export function hasRedirect(segment: string): boolean {
  return />/.test(segment)
}

// --- Rules table ---

interface Rule {
  id: string
  commands: string[]
  additionalCheck?: (segment: string) => boolean
  hasPipeException: boolean
  reason: string
  codexReason?: string
  claudeOnly?: boolean
}

const RULES: Rule[] = [
  {
    id: 'cat',
    claudeOnly: true,
    commands: ['cat'],
    hasPipeException: true,
    reason: '[cat] Use the Read tool instead of cat — it integrates with your toolchain and provides structured output. If cat is needed, prefix with ALLOW_BUILTIN_COMMAND=true.',
  },
  {
    id: 'head',
    claudeOnly: true,
    commands: ['head'],
    hasPipeException: true,
    reason: '[head] Use the Read tool (with the limit parameter) instead of head. If head is needed, prefix with ALLOW_BUILTIN_COMMAND=true.',
  },
  {
    id: 'tail',
    claudeOnly: true,
    commands: ['tail'],
    additionalCheck: (segment) => !isTailFollow(segment),
    hasPipeException: true,
    reason: '[tail] Use the Read tool (with offset/limit parameters) instead of tail. If tail is needed, prefix with ALLOW_BUILTIN_COMMAND=true.',
  },
  {
    id: 'grep',
    claudeOnly: true,
    commands: ['grep', 'rg', 'egrep', 'fgrep'],
    hasPipeException: true,
    reason: '[grep] Use the Grep tool instead of grep/rg — it provides structured output modes, file-type filters, and context lines. If grep is needed as a stream filter or for features Grep doesn\'t support, prefix with ALLOW_BUILTIN_COMMAND=true.',
  },
  {
    id: 'find',
    claudeOnly: true,
    commands: ['find'],
    hasPipeException: true,
    reason: '[find] Use the Glob tool for file discovery. If you need find\'s action flags (-exec, -delete) or predicates (-mtime, -size), prefix with ALLOW_BUILTIN_COMMAND=true.',
  },
  {
    id: 'sed-inplace',
    codexReason: '[sed-inplace] Use apply_patch for in-place file modifications when available. Stream processing (sed without -i) is allowed.',
    commands: ['sed'],
    additionalCheck: hasSedInplace,
    hasPipeException: true,
    reason: '[sed-inplace] Use the Edit tool instead of sed for in-place file modifications — it provides diff preview and integrates with your toolchain. Stream processing (sed without -i) is allowed.',
  },
  {
    id: 'ls',
    claudeOnly: true,
    commands: ['ls'],
    hasPipeException: true,
    reason: '[ls] Use the Glob tool for file and directory listing. If you need file metadata (permissions, sizes), prefix with ALLOW_BUILTIN_COMMAND=true.',
  },
  {
    id: 'sleep',
    codexReason: '[sleep] Do not use shell sleep to poll a process. Use the available process tools to wait for a running command; use a returned session ID only with the matching process tool. Tool availability depends on this session.',
    commands: ['sleep'],
    hasPipeException: false,
    reason: '[sleep] Don\'t sleep. Execute commands sequentially, use timeout for long-running commands, or use run_in_background to avoid blocking.',
  },
  {
    id: 'echo-redirect',
    codexReason: '[echo-redirect] Use apply_patch to create or modify files when available instead of shell redirects.',
    commands: ['echo', 'printf'],
    additionalCheck: hasRedirect,
    hasPipeException: true,
    reason: '[echo-redirect] Use the Write tool to create or modify files instead of shell redirects — it integrates with your toolchain and supports permission caching.',
  },
]

// --- Hook export ---

const RULE_LABELS: Record<string, string> = {
  'cat': 'cat',
  'head': 'head',
  'tail': 'tail',
  'grep': 'grep/rg',
  'find': 'find',
  'sed-inplace': 'sed -i',
  'ls': 'ls',
  'sleep': 'sleep',
  'echo-redirect': 'echo/printf with > redirects',
}

export const hook: ClooksHook<Config> = {
  meta: {
    name: 'prefer-builtin-tools',
    description: 'Provider-aware shell tool preferences',
    config: {
      "cat": true,
      "head": true,
      "tail": true,
      "grep": true,
      "find": true,
      "sed-inplace": true,
      "ls": true,
      "sleep": true,
      "echo-redirect": true,
      additionalRules: [],
    },
  },

  SessionStart(ctx, config) {
    const isCodex = 'provider' in ctx && ctx.provider === 'codex'
    const enabled = RULES
      .filter(r => !isCodex || !r.claudeOnly)
      .filter(r => config[r.id] !== false)
      .map(r => RULE_LABELS[r.id])
      .filter(Boolean)
    if (enabled.length === 0) return ctx.skip()
    if (isCodex) return ctx.skip({
      injectContext: `INFORMATION (no need to comment on it): The prefer-builtin-tools clooks hook is active in this project. Shell calls will refuse: ${enabled.join(', ')}. Shell reads and searches are permitted by the built-in preferences. Use apply_patch for file edits when available, and available process tools to wait for running commands using their returned session IDs. Tool availability depends on this session; configured additional rules still apply.`,
      debugMessage: 'prefer-builtin-tools: announced',
    })
    return ctx.skip({
      injectContext: `INFORMATION (no need to comment on it): The prefer-builtin-tools clooks hook is active in this project. The Bash tool will refuse: ${enabled.join(', ')}. Use the dedicated tools instead — Read, Glob, Grep, Edit, Write. Stream uses (piped grep, sed without -i) are allowed.`,
      debugMessage: 'prefer-builtin-tools: announced',
    })
  },

  PreToolUse(ctx, config) {
    const isCodex = 'provider' in ctx && ctx.provider === 'codex'
    // 1. Skip non-Bash tools
    if (ctx.toolName !== 'Bash') return ctx.skip()

    // 2. Skip empty commands
    const command = ctx.toolInput.command
    if (!command) return ctx.skip()

    // 3. Sanitize: strip quoted strings and comments
    const sanitized = sanitize(command)

    // 4. Check escape hatch prefix (on original command, not sanitized)
    const hasEscapeHatch = command.startsWith('ALLOW_BUILTIN_COMMAND=true')

    // 5. Split into segments and check each against rules
    const segments = getSegments(sanitized)

    for (const segment of segments) {
      const info = extractSegmentInfo(segment)
      if (!info.firstWord) continue

      // Escape hatch skips all built-in rules
      if (hasEscapeHatch) continue

      for (const rule of RULES) {
        if (isCodex && rule.claudeOnly) continue
        // Skip disabled rules
        if (config[rule.id] === false) continue

        // Check first word match
        if (!rule.commands.includes(info.firstWord)) continue

        // Check additional rule-specific condition (if any)
        if (rule.additionalCheck && !rule.additionalCheck(info.command)) continue

        // Check pipe-source exception
        if (rule.hasPipeException && info.hasPipe) continue

        // All checks passed — block
        return ctx.block({
          reason: isCodex ? (rule.codexReason ?? rule.reason) : rule.reason,
          debugMessage: `prefer-builtin-tools: blocked by rule '${rule.id}'`,
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
              debugMessage: `prefer-builtin-tools: blocked by additionalRule '${custom.match}'`,
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
