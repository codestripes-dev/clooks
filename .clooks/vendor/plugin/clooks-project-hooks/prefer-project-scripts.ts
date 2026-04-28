// prefer-project-scripts — Blocks bare CLI tools when project scripts exist
//
// Users configure mappings: each mapping is a regex that matches a bare tool
// invocation and a recommended project script to use instead.
//
// Blocked (when configured):
//   Any command matching a user-defined regex in the mappings array.
//   Example: eslint src/ → "Use `npm run lint` instead"
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

import type { ClooksHook } from './types'

type Config = {
  mappings: { match: string; recommend: string }[]
}

// --- Exported utility functions ---

export function sanitize(command: string): string {
  return command
    .replace(/'[^']*'/g, '')
    .replace(/"[^"]*"/g, '')
    .replace(/#.*$/gm, '')
}

export function getSegments(sanitized: string): string[] {
  return sanitized.split(/\s*(?:&&|\|\||;)\s*/).filter((s) => s.length > 0)
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
  mappings: { match: string; recommend: string }[],
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
        debugMessages.push(`prefer-project-scripts: invalid regex '${mapping.match}', skipping`)
      }
    }
  }

  return { matched: null, debugMessages }
}

// --- Hook export ---

export const hook: ClooksHook<Config> = {
  meta: {
    name: 'prefer-project-scripts',
    description: 'Blocks bare CLI tools when project scripts exist',
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
     - yarn.lock → "yarn" (scripts run without "run")
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

    const recommendations = Array.from(
      new Set(mappings.map((m) => m.recommend).filter((r): r is string => Boolean(r))),
    )
    if (recommendations.length === 0) return ctx.skip()
    const list = recommendations.map((r) => `\`${r}\``).join(', ')

    return ctx.skip({
      injectContext: `The prefer-project-scripts clooks hook is active in this project. Prefer these project scripts where applicable: ${list}. The Bash tool will refuse direct invocation of the underlying tools when a script exists for them; the block message will name the specific replacement.`,
      debugMessage: 'prefer-project-scripts: announced',
    })
  },

  PreToolUse(ctx, config) {
    // 1. Skip non-Bash tools (FEAT step 1)
    if (ctx.toolName !== 'Bash') return ctx.skip()

    // 2. Skip empty commands (FEAT step 2)
    const command = ctx.toolInput.command
    if (!command) return ctx.skip()

    // 3. Skip if unconfigured (FEAT step 3)
    const mappings = Array.isArray(config.mappings) ? config.mappings : []
    if (mappings.length === 0) return ctx.skip()

    // 4. Check escape hatch on original command (FEAT step 7, moved early — safe
    //    because it checks the unsanitized original, independent of segment processing)
    if (hasEscapeHatch(command)) {
      return ctx.skip({
        debugMessage: 'prefer-project-scripts: escape hatch used',
      })
    }

    // 5. Sanitize, segment, and match (FEAT steps 4-6, 8-9 inside detectMatch)
    const { matched, debugMessages } = detectMatch(command, mappings)

    if (matched) {
      return ctx.block({
        reason: `[prefer-project-scripts] Use \`${matched.recommend}\` instead — project scripts include configuration and environment that direct tool invocation misses. If the bare tool is needed, prefix with ALLOW_DIRECT_TOOL=true.`,
        debugMessage:
          debugMessages.length > 0
            ? debugMessages.join('; ')
            : `prefer-project-scripts: blocked, recommending '${matched.recommend}'`,
      })
    }

    // 6. No match — skip, not allow (FEAT step 10)
    return ctx.skip({
      debugMessage: debugMessages.length > 0 ? debugMessages.join('; ') : undefined,
    })
  },
}
