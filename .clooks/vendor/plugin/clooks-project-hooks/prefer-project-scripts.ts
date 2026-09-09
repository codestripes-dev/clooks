// prefer-project-scripts — Prefers verified literal-equivalent package scripts
//
// Users configure mappings: each mapping is a regex that matches a bare tool
// invocation and a recommended project script to use instead.
//
// A regex match selects a recommendation, not proof of equivalence. Block only
// when an explicit runner run command names a script with the same literal
// executable and complete arguments, without pre/post scripts or shell syntax.
// Arbitrary recommendations remain valid config; unverifiable cases skip.
//
// Explicitly NOT blocked:
//   Commands that don't match any mapping regex, pipe targets,
//   tool names inside quoted strings, the recommended commands themselves,
//   commands prefixed with ALLOW_DIRECT_TOOL=true
//
// Escape hatch: prefix command with ALLOW_DIRECT_TOOL=true
//
// Requires configuration — ships with empty mappings. When unconfigured,
// injects a SessionStart nudge prompting the user to configure or disable.

import type { ClooksHook } from "./types"
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

type Config = {
  mappings: { match: string; recommend: string }[]
}

// Only literal words and simple quotes are understood. No shell evaluation or
// expansion is attempted; notably an unquoted glob is not a literal argument.
function literalWords(command: string): string[] | null {
  if (/[\r\n]/.test(command)) return null
  const words: string[] = []
  const pattern = /\s*(?:'([^'\r\n]*)'|"([^"$`\\\r\n]*)"|([^\s'"\\$`;&|<>(){}*?\[\]#!~]+))(?=\s|$)/gy
  let offset = 0
  while (offset < command.length) {
    if (!command.slice(offset).trim()) break
    pattern.lastIndex = offset
    const match = pattern.exec(command)
    if (!match) return null
    words.push(match[1] ?? match[2] ?? match[3]!)
    offset = pattern.lastIndex
  }
  if (!words.length || words[0]!.includes('=')) return null
  return words
}

export function equivalentScript(command: string, recommend: string, cwd: string): boolean {
  const requested = literalWords(command)
  const runner = literalWords(recommend)
  if (!requested || !runner) return false
  const [name, verb, script] = runner
  const scriptName =
    runner.length === 3 && ['bun', 'npm', 'pnpm', 'yarn'].includes(name!) && verb === 'run'
      ? script
      : undefined
  if (!scriptName || !/^[\w:.-]+$/.test(scriptName) || scriptName.startsWith('-')) return false
  try {
    const data: unknown = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))
    if (!data || typeof data !== 'object' || !('scripts' in data)) return false
    const scripts = data.scripts
    if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) return false
    const entries = scripts as Record<string, unknown>
    if (Object.hasOwn(entries, `pre${scriptName}`) || Object.hasOwn(entries, `post${scriptName}`)) return false
    const body = entries[scriptName]
    if (typeof body !== 'string') return false
    const actual = literalWords(body)
    if (actual && ['bun', 'npm', 'pnpm', 'yarn', 'npx', 'bunx', 'sh', 'bash', 'env'].includes(actual[0]!)) return false
    return actual !== null && actual.length === requested.length &&
      actual.every((word, index) => word === requested[index])
  } catch {
    return false
  }
}

// --- Exported utility functions ---

export function sanitize(command: string): string {
  return command
    .replace(/'[^']*'/g, '')
    .replace(/"[^"]*"/g, '')
    .replace(/#.*$/gm, '')
}

export function getSegments(sanitized: string): string[] {
  return sanitized.split(/\s*(?:&&|\|\||;)\s*/).filter(s => s.length > 0)
}

export function extractSegmentInfo(segment: string): { firstWord: string; stripped: string } {
  const pipeIndex = segment.indexOf('|')
  const prePipe = pipeIndex !== -1 ? segment.slice(0, pipeIndex) : segment
  const trimmed = prePipe.trim()
  const stripped = trimmed.replace(/^(?:\w+=\S*\s+)*/, '')
  const firstWord = stripped.split(/\s/)[0] || ''
  return { firstWord, stripped }
}

export function hasEscapeHatch(command: string): boolean {
  return /(?:^|\s)ALLOW_DIRECT_TOOL=true(?:\s|$)/.test(command)
}

type DetectResult = {
  matched: { match: string; recommend: string } | null
  debugMessages: string[]
}

export function detectMatch(
  command: string,
  mappings: { match: string; recommend: string }[]
): DetectResult {
  const debugMessages: string[] = []
  const sanitized = sanitize(command)
  const segments = getSegments(sanitized)

  for (const segment of segments) {
    const { firstWord, stripped } = extractSegmentInfo(segment)
    if (!firstWord) continue

    for (const mapping of mappings) {
      try {
        if (new RegExp(mapping.match).test(stripped)) {
          return { matched: mapping, debugMessages }
        }
      } catch {
        debugMessages.push(
          `prefer-project-scripts: invalid regex '${mapping.match}', skipping`
        )
      }
    }
  }

  return { matched: null, debugMessages }
}

// --- Hook export ---

export const hook: ClooksHook<Config> = {
  meta: {
    name: 'prefer-project-scripts',
    description: 'Prefers package scripts only when literal executable and arguments match',
    config: {
      mappings: [],
    },
  },

  SessionStart(ctx, config) {
    const mappings = Array.isArray(config.mappings) ? config.mappings : []

    if (mappings.length === 0) {
      return ctx.skip({
        injectContext: `CONFIGURATION REQUIRED: The prefer-project-scripts hook is enabled but has no mappings configured. In your very first response, regardless of what the user asked, inform them about this AND proactively offer to configure it for them.

You have enough information to do the configuration yourself — do not just ask the user to do it. Offer, and if they agree, read the project's package.json, derive sensible mappings, and edit clooks.yml.

How to derive mappings from the project:
  1. Read package.json "scripts". Map each underlying tool to its script:
     - scripts.lint invokes eslint → map eslint → "<runner> run lint"
     - scripts.format invokes prettier → map prettier → "<runner> run format"
     - scripts.typecheck or scripts.tsc invokes tsc → map tsc → "<runner> run typecheck"
     - scripts.test invokes jest/vitest → map jest/vitest → "<runner> run test"
     Inspect each script's command to confirm the underlying tool before mapping.
  2. Pick the runner from package.json "packageManager" or the lockfile:
     - bun.lockb / bun.lock → "bun run"
     - pnpm-lock.yaml → "pnpm run"
     - yarn.lock → "yarn run" (use explicit script invocation)
     - package-lock.json → "npm run"
  3. Only add a mapping if the project actually has a script for that tool. Do not invent scripts.

The match field is a regex; use a word-boundary pattern so substrings inside other names don't match. The recommend field is the exact command to use.

Example configuration (adjust to the project):

  prefer-project-scripts:
    config:
      mappings:
        - match: "(?<![\\\\w-])eslint(?![\\\\w-])"
          recommend: "npm run lint"
        - match: "(?<![\\\\w-])prettier(?![\\\\w-])"
          recommend: "npm run format"
        - match: "(?<![\\\\w-])tsc(?![\\\\w-])"
          recommend: "npm run typecheck"
        - match: "(?<![\\\\w-])jest(?![\\\\w-])"
          recommend: "npm run test"

If the user wants to disable the hook instead, set enabled: false on the hook in clooks.yml or remove it.

Without configuration, this hook cannot protect against bare tool invocations that bypass project scripts. Do not wait for the user to ask — mention this immediately. This notice will stop appearing once mappings are configured.`,
        debugMessage: 'prefer-project-scripts: unconfigured, injecting warning',
      })
    }

    const recommendations = Array.from(new Set(
      mappings.map(m => m.recommend).filter((r): r is string => Boolean(r))
    ))
    if (recommendations.length === 0) return ctx.skip()
    const list = recommendations.map(r => `\`${r}\``).join(', ')

    return ctx.skip({
      injectContext: `INFORMATION (no need to comment on it): The prefer-project-scripts clooks hook is active in this project. Configured recommendations: ${list}. Direct tool invocations are blocked only when a literal package-script comparison verifies the same executable and complete arguments. Unverifiable recommendations remain configured but do not block.`,
      debugMessage: 'prefer-project-scripts: announced',
    })
  },

  PreToolUse(ctx, config) {
    if (ctx.toolName !== 'Bash') return ctx.skip()

    const command = ctx.toolInput.command
    if (!command) return ctx.skip()

    const mappings = Array.isArray(config.mappings) ? config.mappings : []
    if (mappings.length === 0) return ctx.skip()

    if (hasEscapeHatch(command)) {
      return ctx.skip({
        debugMessage: 'prefer-project-scripts: escape hatch used',
      })
    }

    const { matched, debugMessages } = detectMatch(command, mappings)

    if (matched) {
      if (!equivalentScript(command, matched.recommend, ctx.cwd)) {
        return ctx.skip({
          debugMessage: [...debugMessages, 'prefer-project-scripts: equivalence unverified; retaining original invocation'].join('; '),
        })
      }
      return ctx.block({
        reason: `[prefer-project-scripts] Use \`${matched.recommend}\` instead: its literal script matches the requested executable and complete arguments. If the bare tool is needed, prefix with ALLOW_DIRECT_TOOL=true.`,
        debugMessage: debugMessages.length > 0
          ? debugMessages.join('; ')
          : `prefer-project-scripts: blocked, recommending '${matched.recommend}'`,
      })
    }

    return ctx.skip({
      debugMessage: debugMessages.length > 0
        ? debugMessages.join('; ')
        : undefined,
    })
  },
}
