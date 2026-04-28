// no-edit-protected — Blocks Write/Edit/MultiEdit on protected file paths
//
// Built-in rule groups (all enabled by default):
//   lock-files    — package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lockb,
//                   Gemfile.lock, poetry.lock, Pipfile.lock, composer.lock,
//                   Cargo.lock, go.sum, flake.lock, pubspec.lock
//   vendor-dirs   — **/vendor/**, **/vendored/**
//   minified-assets — **/*.min.js, **/*.min.css, **/*.min.mjs
//
// Custom rules: array of { pattern, message, except? } in clooks.yml
//
// NOT intercepted: Read, Bash, Glob, Grep, NotebookEdit, and all other tools
// No escape hatch — protection is firm. Configure rules in clooks.yml.

import type { ClooksHook } from "./types"

type Config = {
  [key: string]: boolean | Array<{ pattern: string; message: string; except?: string[] }> | undefined
  "lock-files"?: boolean
  "vendor-dirs"?: boolean
  "minified-assets"?: boolean
  rules?: Array<{ pattern: string; message: string; except?: string[] }>
}

// --- Glob-to-regex converter (exported for unit testing) ---

export function globToRegex(pattern: string): RegExp {
  let regex = '^'
  let i = 0

  while (i < pattern.length) {
    const char = pattern[i]
    const next = pattern[i + 1]

    if (char === '*' && next === '*') {
      const prev = i === 0 ? undefined : pattern[i - 1]
      const afterStars = pattern[i + 2]

      if ((prev === undefined || prev === '/') && afterStars === '/') {
        // **/ at a segment boundary → zero or more path segments
        regex += '(?:.*/)?'
        i += 3 // consume **, /
      } else if ((prev === undefined || prev === '/') && afterStars === undefined) {
        // trailing ** → match everything
        regex += '.*'
        i += 2
      } else {
        // fallback: ** not at boundary
        regex += '.*'
        i += 2
      }
    } else if (char === '*') {
      // single * → any characters except /
      regex += '[^/]*'
      i += 1
    } else if (char === '?') {
      // ? → single character except /
      regex += '[^/]'
      i += 1
    } else if ('.+^${}()|[]\\'.includes(char)) {
      // regex special character → escape
      regex += '\\' + char
      i += 1
    } else {
      // literal character
      regex += char
      i += 1
    }
  }

  regex += '$'
  return new RegExp(regex)
}

// --- Path normalization (exported for unit testing) ---

export function normalizePath(filePath: string, cwd: string): string | null {
  // Guard: empty cwd would become "/" after normalization, causing false positives
  if (!cwd) return null

  // Ensure cwd ends with / to prevent prefix false matches
  if (!cwd.endsWith('/')) cwd = cwd + '/'

  // Guard: file outside project
  if (!filePath.startsWith(cwd)) return null

  // Strip cwd prefix to get project-relative path
  const relative = filePath.slice(cwd.length)

  // Guard: filePath equals cwd (directory, not a file) — returns empty string
  if (!relative) return null

  return relative
}

// --- Built-in rules ---

interface BuiltinRuleGroup {
  id: string
  patterns: string[]
  message: string
}

const BUILTIN_RULES: BuiltinRuleGroup[] = [
  {
    id: 'lock-files',
    patterns: [
      'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb',
      'Gemfile.lock', 'poetry.lock', 'Pipfile.lock', 'composer.lock',
      'Cargo.lock', 'go.sum', 'flake.lock', 'pubspec.lock',
    ],
    message: 'This is a lock file managed by your package manager. Do not modify it directly \u2014 use your package manager (e.g., npm install, yarn add, pnpm add, bun add) to change dependencies. To disable this rule: set "lock-files": false in clooks.yml.',
  },
  {
    id: 'vendor-dirs',
    patterns: ['**/vendor/**', '**/vendored/**'],
    message: 'This is vendored third-party code. Do not modify it directly \u2014 update the upstream dependency instead, or ask the user how patches to vendored code are managed in this project. If this is not vendored code, disable this rule with "vendor-dirs": false in clooks.yml.',
  },
  {
    id: 'minified-assets',
    patterns: ['**/*.min.js', '**/*.min.css', '**/*.min.mjs'],
    message: 'This is a minified build artifact. Edit the source file and rebuild instead of modifying the minified output. To disable this rule: set "minified-assets": false in clooks.yml.',
  },
]

// --- Block message helper ---

function blockMessage(relativePath: string, ruleLabel: string, message: string): string {
  return `[no-edit-protected] Blocked: ${relativePath}\nRule: ${ruleLabel}\n${message}`
}

// --- Hook export ---

export const hook: ClooksHook<Config> = {
  meta: {
    name: 'no-edit-protected',
    description: 'Blocks Write/Edit/MultiEdit on protected file paths',
    config: {
      "lock-files": true,
      "vendor-dirs": true,
      "minified-assets": true,
      rules: [],
    },
  },

  PreToolUse(ctx, config) {
    // 1. Guard: skip non-target tools
    const targetTools = ['Write', 'Edit', 'MultiEdit']
    if (!targetTools.includes(ctx.toolName)) return ctx.skip()

    // 2. Extract filePath
    const filePath = typeof ctx.toolInput.filePath === 'string'
      ? ctx.toolInput.filePath
      : ''
    if (!filePath) return ctx.skip()

    // 3. Normalize path (strip cwd, get project-relative)
    const relativePath = normalizePath(filePath, ctx.cwd)
    if (relativePath === null) return ctx.skip()
    // (null = file outside project — no opinion)

    // 4. Check built-in rules
    for (const group of BUILTIN_RULES) {
      if (config[group.id] === false) continue  // disabled via config
      for (const pattern of group.patterns) {
        try {
          if (globToRegex(pattern).test(relativePath)) {
            return ctx.block({
              reason: blockMessage(relativePath, group.id, group.message),
              debugMessage: `no-edit-protected: blocked by built-in rule '${group.id}' (pattern: ${pattern})`,
            })
          }
        } catch {
          // Invalid glob — skip this pattern
        }
      }
    }

    // 5. Check custom rules
    const rules = Array.isArray(config.rules) ? config.rules : []
    for (const rule of rules) {
      try {
        if (!globToRegex(rule.pattern).test(relativePath)) continue

        // Check except patterns
        if (Array.isArray(rule.except)) {
          const excepted = rule.except.some(exc => {
            try { return globToRegex(exc).test(relativePath) }
            catch { return false }
          })
          if (excepted) continue  // path is excluded from this rule
        }

        return ctx.block({
          reason: blockMessage(relativePath, rule.pattern, rule.message),
          debugMessage: `no-edit-protected: blocked by custom rule '${rule.pattern}'`,
        })
      } catch {
        // Invalid glob — skip this rule
      }
    }

    // 6. No match — skip (not allow)
    return ctx.skip()
  },
}
