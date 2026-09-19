// no-edit-protected — Blocks Claude file edits and Codex native patch paths
//
// Built-in rule groups (all enabled by default):
//   lock-files    — root/nested package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lock, bun.lockb,
//                   Gemfile.lock, poetry.lock, Pipfile.lock, composer.lock,
//                   Cargo.lock, go.sum, flake.lock, pubspec.lock
//   vendor-dirs   — **/vendor/**, **/vendored/**
//   minified-assets — **/*.min.js, **/*.min.css, **/*.min.mjs
//
// Custom rules: array of { pattern, message, except? } in clooks.yml
//
// Also inspects Codex apply_patch command headers, including both move paths.
// NOT intercepted: Read, Bash, Glob, Grep, NotebookEdit, and unrelated tools
// No escape hatch — protection is firm. Configure rules in clooks.yml.

import type { ClooksHook, UnknownPreToolUseContext } from './types'
import { resolve } from 'node:path'

type Config = {
  [key: string]:
    | boolean
    | Array<{ pattern: string; message: string; except?: string[] }>
    | undefined
  'lock-files'?: boolean
  'vendor-dirs'?: boolean
  'minified-assets'?: boolean
  rules?: Array<{ pattern: string; message: string; except?: string[] }>
}

// --- Glob-to-regex converter (exported for unit testing) ---

export function globToRegex(pattern: string): RegExp {
  let regex = '^'
  let i = 0

  while (i < pattern.length) {
    const char = pattern[i]!
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

  if (!filePath.startsWith(cwd)) return null

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
      '**/package-lock.json',
      '**/yarn.lock',
      '**/pnpm-lock.yaml',
      '**/bun.lock',
      '**/bun.lockb',
      '**/Gemfile.lock',
      '**/poetry.lock',
      '**/Pipfile.lock',
      '**/composer.lock',
      '**/Cargo.lock',
      '**/go.sum',
      '**/flake.lock',
      '**/pubspec.lock',
    ],
    message:
      'This is a lock file managed by your package manager. Do not modify it directly \u2014 use your package manager (e.g., npm install, yarn add, pnpm add, bun add) to change dependencies. To disable this rule: set "lock-files": false in clooks.yml.',
  },
  {
    id: 'vendor-dirs',
    patterns: ['**/vendor/**', '**/vendored/**'],
    message:
      'This is vendored third-party code. Do not modify it directly \u2014 update the upstream dependency instead, or ask the user how patches to vendored code are managed in this project. If this is not vendored code, disable this rule with "vendor-dirs": false in clooks.yml.',
  },
  {
    id: 'minified-assets',
    patterns: ['**/*.min.js', '**/*.min.css', '**/*.min.mjs'],
    message:
      'This is a minified build artifact. Edit the source file and rebuild instead of modifying the minified output. To disable this rule: set "minified-assets": false in clooks.yml.',
  },
]

// --- Block message helper ---

function blockMessage(relativePath: string, ruleLabel: string, message: string): string {
  return `[no-edit-protected] Blocked: ${relativePath}\nRule: ${ruleLabel}\n${message}`
}

// Match native envelope/header precedence without applying or validating contents.
export function patchPaths(command: string): string[] {
  let lines = command.trim().split(/\r?\n/)
  const bounded = (input: string[]) =>
    input.length >= 2 &&
    input[0]!.trim() === '*** Begin Patch' &&
    input[input.length - 1]!.trim() === '*** End Patch'
  if (!bounded(lines)) {
    if (
      lines.length < 4 ||
      !['<<EOF', "<<'EOF'", '<<"EOF"'].includes(lines[0]!) ||
      !lines[lines.length - 1]!.endsWith('EOF')
    )
      return []
    lines = lines.slice(1, -1)
    if (!bounded(lines)) return []
  }
  const paths: string[] = []
  let state: 'start' | 'add' | 'delete' | 'update' = 'start'
  let environment = false
  let moveAllowed = false
  for (const line of lines.slice(1)) {
    // Native update context retains leading space; other states trim both ends.
    const header = state === 'update' ? line.trimEnd() : line.trim()
    if (header === '*** End Patch') break
    if (state === 'start' && header.startsWith('*** Environment ID:')) {
      if (environment || !header.slice('*** Environment ID:'.length).trim()) return []
      environment = true
      continue
    }
    let matched = false
    for (const [marker, next] of [
      ['*** Add File: ', 'add'],
      ['*** Delete File: ', 'delete'],
      ['*** Update File: ', 'update'],
    ] as const) {
      if (!header.startsWith(marker)) continue
      paths.push(header.slice(marker.length))
      state = next
      moveAllowed = next === 'update'
      matched = true
      break
    }
    if (matched) continue
    if (state === 'start') return []
    if (state === 'update') {
      if (moveAllowed && header.startsWith('*** Move to: ')) {
        paths.push(header.slice('*** Move to: '.length))
        moveAllowed = false
      } else if (header !== '*** End of File') {
        moveAllowed = false
      }
    }
  }
  return paths
}

// --- Hook export ---

export const hook: ClooksHook<Config> = {
  meta: {
    name: 'no-edit-protected',
    description: 'Blocks Write/Edit/MultiEdit and Codex apply_patch on protected file paths',
    config: {
      'lock-files': true,
      'vendor-dirs': true,
      'minified-assets': true,
      rules: [],
    },
  },

  PreToolUse(ctx, config) {
    const raw = ctx as unknown as UnknownPreToolUseContext
    const nativePatch = 'agent' in ctx && ctx.agent === 'codex' && raw.toolName === 'apply_patch'
    const targetTools = ['Write', 'Edit', 'MultiEdit']
    if (!nativePatch && !targetTools.includes(ctx.toolName)) return ctx.skip()

    const input = raw.toolInput
    if (input === null || typeof input !== 'object' || Array.isArray(input)) return ctx.skip()

    const filePath =
      'filePath' in input && typeof input.filePath === 'string'
        ? input.filePath
        : ''
    const paths = nativePatch
      ? 'command' in input && typeof input.command === 'string' && ctx.cwd
        ? patchPaths(input.command).map((path) => resolve(ctx.cwd, path))
        : []
      : filePath
        ? [filePath]
        : []

    for (const path of paths) {
      const relativePath = normalizePath(path, ctx.cwd)
      if (relativePath === null) continue

      for (const group of BUILTIN_RULES) {
        if (config[group.id] === false) continue
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

      const rules = Array.isArray(config.rules) ? config.rules : []
      for (const rule of rules) {
        try {
          if (!globToRegex(rule.pattern).test(relativePath)) continue

          if (Array.isArray(rule.except)) {
            const excepted = rule.except.some((exc) => {
              try {
                return globToRegex(exc).test(relativePath)
              } catch {
                return false
              }
            })
            if (excepted) continue
          }

          return ctx.block({
            reason: blockMessage(relativePath, rule.pattern, rule.message),
            debugMessage: `no-edit-protected: blocked by custom rule '${rule.pattern}'`,
          })
        } catch {
          // Invalid glob — skip this rule
        }
      }
    }
    return ctx.skip()
  },
}
