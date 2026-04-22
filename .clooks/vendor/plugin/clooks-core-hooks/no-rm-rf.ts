// no-rm-rf — Blocks recursive rm against catastrophic paths via PreToolUse on Bash commands
//
// Triggers only on RECURSIVE rm: `rm -r`, `rm -R`, `rm -rf`, `rm --recursive`, and every
// flag-order variant (`-fr`, `-Rf`, `-rfv`, short-flag bundles containing r/R). Plain
// `rm file.txt` passes through unchanged.
//
// ─── WHAT THIS HOOK DOES TO YOUR COMMANDS ───────────────────────────────────────────
//
// For every recursive rm, each target path is checked against 11 rules grouped into
// three outcomes:
//
//   Blocked outright — no way to bypass short of disabling the rule:
//     rm-rf-no-preserve-root            `--no-preserve-root` present
//     rm-rf-dangerous-glob-unbypassable target is literal `.*` or `/*`
//     rm-rf-home                        target resolves to a user home (`~`, `$HOME`,
//                                       `/home/<user>`, `/Users/<user>`)
//     rm-rf-root                        target resolves to `/` or a system dir
//                                       (`/etc`, `/usr`, `/var`, `/tmp`, …)
//
//   Blocked unless you prefix with ALLOW_DESTRUCTIVE_RM=true:
//     rm-rf-no-project-root             no git repo or .clooks/clooks.yml reachable
//     rm-rf-unresolved-var              target contains `$VAR`, `$(cmd)`, backticks
//     rm-rf-globstar                    target contains `**`
//     rm-rf-expansion-error             glob scan failed (permission denied) or a
//                                       symlink was found in the scan parent
//     rm-rf-escape                      target resolves outside the project root
//                                       (e.g. `rm -rf ../../sibling`)
//
//   Asks you to confirm before running (becomes a hard block if strictMode: true):
//     rm-rf-project-root                target IS the project root
//     rm-rf-strict                      target is inside the project but not a known
//                                       build-artifact basename
//
// Build-artifact basenames allowed by default: `node_modules`, `dist`, `build`, `out`,
// `.cache`, `tmp`, `.tmp`, `target`, `coverage`, `.next`, `.nuxt`, `.turbo`,
// `.parcel-cache`, `.vite`, `.svelte-kit`, `.output`, `__pycache__`, `.pytest_cache`,
// `.mypy_cache`, `.ruff_cache`, `venv`, `.venv`, `vendor`. Extend with `extraAllowlist`.
//
// ─── CONFIG (clooks.yml) AND WHAT DISABLING EACH RULE COSTS ─────────────────────────
//
// Every rule ID above accepts a boolean (default: true). Setting a rule to `false`
// turns it off. Consequences:
//
//   rm-rf-no-project-root    recursive rm is allowed in any cwd that isn't a
//                            recognized project. Only disable if you routinely work
//                            in loose directories and accept the risk.
//   rm-rf-no-preserve-root   `rm -rf --no-preserve-root /` is no longer caught at the
//                            command level. Rules rm-rf-home and rm-rf-root still
//                            catch the `/` target via path classification. Only
//                            disable with a legitimate workflow that passes this flag.
//   rm-rf-unresolved-var     unresolved shell variables in rm targets are no longer
//                            pre-blocked. Bash expands them at execution; unset vars
//                            expand to empty, so `rm -rf $BUILD/src` becomes
//                            `rm -rf /src`. High risk.
//   rm-rf-globstar           `rm -rf **/*` patterns are no longer pre-blocked.
//                            Expansion still runs and each match is classified, but
//                            you lose the pre-block that flags unbounded expansion.
//   rm-rf-dangerous-glob-unbypassable
//                            literal `.*` and `/*` are no longer caught. `.*` matches
//                            `..` (your parent directory); `/*` enumerates every
//                            top-level filesystem entry. Do not disable.
//   rm-rf-expansion-error    permission-denied scans and symlinks in the scan parent
//                            (e.g. `build/cache → /etc`) are no longer caught before
//                            `rm` dereferences them. Serious fail-open.
//   rm-rf-home               recursive rm of user home directories is no longer
//                            blocked. Covers `rm -rf ~`, `rm -rf $HOME`,
//                            `rm -rf /home/alice`, `rm -rf /Users/carol`. Almost
//                            never correct to disable.
//   rm-rf-root               recursive rm of `/` and system top-levels (/etc, /usr,
//                            /bin, /lib, /var, /tmp, /boot, /dev, /proc, /sys, /opt,
//                            /root, /Users, /System, /private, /home) is no longer
//                            blocked. Disabling means accepting system-wipe risk.
//   rm-rf-project-root       `rm -rf .` at project root and `rm -rf /path/to/project`
//                            proceed silently. You lose the confirmation prompt for
//                            "delete the entire project including .git/".
//   rm-rf-escape             `rm -rf ../../sibling` and other project-root escapes
//                            are no longer blocked. An agent asked to clean up one
//                            project could delete another on the same machine.
//   rm-rf-strict             within-project non-allowlisted deletes (e.g.,
//                            `rm -rf src/`) no longer prompt you — they pass through.
//                            You give up the confirm-before-delete-source safeguard.
//
// Additional config:
//   extraAllowlist: string[]  extra basenames that allowlist inside the project.
//                             Example: `extraAllowlist: [fixtures, test-output]`.
//   strictMode: boolean       when true, rm-rf-project-root and rm-rf-strict promote
//                             from "ask" to unbypassable block. Use on shared
//                             machines or CI where no human can confirm prompts.

import type { ClooksHook, PreToolUseResult } from './types'
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, readdirSync } from 'node:fs'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve as resolvePathNode,
} from 'node:path'

type Config = {
  'rm-rf-no-project-root'?: boolean
  'rm-rf-no-preserve-root'?: boolean
  'rm-rf-unresolved-var'?: boolean
  'rm-rf-globstar'?: boolean
  'rm-rf-dangerous-glob-unbypassable'?: boolean
  'rm-rf-expansion-error'?: boolean
  'rm-rf-home'?: boolean
  'rm-rf-root'?: boolean
  'rm-rf-project-root'?: boolean
  'rm-rf-escape'?: boolean
  'rm-rf-strict'?: boolean
  extraAllowlist?: string[]
  strictMode?: boolean
  [key: string]: boolean | string[] | undefined
}

export const DEFAULT_ALLOWLIST = [
  'node_modules',
  'dist',
  'build',
  'out',
  '.cache',
  'tmp',
  '.tmp',
  'target',
  'coverage',
  '.next',
  '.nuxt',
  '.turbo',
  '.parcel-cache',
  '.vite',
  '.svelte-kit',
  '.output',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  'venv',
  '.venv',
  'vendor',
] as const

export const SYSTEM_TOP_LEVEL = new Set([
  '/etc',
  '/usr',
  '/bin',
  '/sbin',
  '/lib',
  '/lib64',
  '/boot',
  '/dev',
  '/proc',
  '/sys',
  '/opt',
  '/root',
  '/var',
  '/tmp',
  '/Users',
  '/System',
  '/private',
  '/home',
])

/**
 * Strips shell-quoted content from a bash command for downstream pattern matching.
 *
 * Before stripping single-quoted content, unwrap rm-command-name singles, shell
 * -c singles, and trap handler singles so inner rm invocations reach downstream
 * classification. Single-quoted spans are otherwise removed entirely. Double-
 * quoted spans have only the quote characters stripped (content preserved) so
 * `$VAR` inside double quotes still surfaces to rule 3.
 */
export function sanitize(command: string): string {
  return (
    command
      // Unwrap rm-command-name single-quotes: 'rm' → rm, '/usr/bin/rm' → /usr/bin/rm,
      // '\rm' → \rm, etc. Only matches quoted content that IS an rm-invocation name
      // (optional leading backslash, optional path prefix ending in /, then literal
      // `rm`). Quoted arguments that happen to contain 'rm'-like substrings still
      // get stripped by the later pass.
      .replace(/'(\\?(?:[\w./-]*\/)?rm)'/g, '$1')
      // Unwrap single-quoted scripts passed to a shell via -c. Covers bash, sh, zsh,
      // dash, fish, ash, ksh. The quoted script becomes inline tokens so downstream
      // segment-splitting, rm detection, and classification handle the inner command
      // as if it had been typed directly.
      .replace(/(^|\s)(bash|sh|zsh|dash|fish|ash|ksh)(\s+-c\s+)'([^']*)'/g, '$1$2$3$4')
      // Unwrap single-quoted trap handlers: trap '...' SIG → trap ... .
      // The signal name is dropped (not a shell token the hook cares about) so
      // extractTargets doesn't collect it as a literal rm target.
      .replace(/(^|\s)(trap)\s+'([^']*)'\s+\w+/g, '$1$2 $3')
      // Existing: strip any remaining single-quoted content (literal filename-style
      // arguments like 'foo && bar').
      .replace(/'[^']*'/g, '')
      // Existing: preserve double-quoted content (quote chars stripped, content kept
      // so `$HOME` inside "..." still surfaces to rule 3).
      .replace(/"([^"]*)"/g, '$1')
      // Existing: strip # comments.
      .replace(/#.*$/gm, '')
  )
}

/**
 * Splits a sanitized command on shell segment separators: &&, ||, ;, |.
 */
export function getSegments(sanitized: string): string[] {
  return sanitized
    .split(/\s*(?:&&|\|\||;|\|)\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/** Peels environment-variable prefixes (VAR=value) off the front of a segment. */
export function stripEnvPrefix(segment: string): { prefix: string[]; rest: string } {
  const trimmed = segment.trim()
  const match = trimmed.match(/^((?:\w+=\S*\s+)+)/)
  if (!match) return { prefix: [], rest: trimmed }
  const prefix = match[1].trim().split(/\s+/)
  const rest = trimmed.slice(match[1].length).trim()
  return { prefix, rest }
}

/** Returns true iff the env prefix array contains `ALLOW_DESTRUCTIVE_RM=true`. */
export function hasEscapeHatch(prefix: string[]): boolean {
  return prefix.includes('ALLOW_DESTRUCTIVE_RM=true')
}

/** Returns true iff the tokens include an rm invocation AND a recursive flag. */
export function hasRecursiveFlag(rest: string): boolean {
  const tokens = rest
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0)
  if (!tokens.some(isRmCommand)) return false
  let sawRm = false
  let sawEndOfOptions = false
  for (const tok of tokens) {
    if (!sawRm) {
      if (isRmCommand(tok)) sawRm = true
      continue
    }
    if (!sawEndOfOptions && tok === '--') {
      sawEndOfOptions = true
      continue
    }
    if (sawEndOfOptions) continue // anything after -- is a target, not a flag
    if (tok === '--recursive') return true
    if (!tok.startsWith('-')) continue
    if (tok.startsWith('--')) continue
    if (/[rR]/.test(tok)) return true
  }
  return false
}

/** Returns the non-flag argument tokens to rm. Order-preserving. */
export function extractTargets(rest: string): string[] {
  const tokens = rest
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0)
  const result: string[] = []
  let seenRm = false
  let sawEndOfOptions = false
  for (const tok of tokens) {
    if (!seenRm) {
      if (isRmCommand(tok)) seenRm = true
      continue
    }
    if (!sawEndOfOptions && tok === '--') {
      sawEndOfOptions = true
      continue
    }
    if (!sawEndOfOptions && tok.startsWith('-')) continue
    result.push(tok)
  }
  return result
}

function isRmCommand(tok: string): boolean {
  // Strip a leading backslash: bash parses `\rm` as `rm` (the backslash is
  // an alias-bypass escape, not a path character), so `\rm -rf ~` still
  // invokes the real rm binary.
  const t = tok.startsWith('\\') ? tok.slice(1) : tok
  if (t === 'rm') return true
  if (t.includes('/') && basename(t) === 'rm') return true
  return false
}

/** Rule 3 (`rm-rf-unresolved-var`) trigger. */
export function hasVariableExpansion(target: string): boolean {
  return /\$[\w{(#?$!@*-]|`/.test(target)
}

/** Returns true iff the target contains glob metacharacters (* ? [). */
export function hasGlobChars(target: string): boolean {
  return /[*?[]/.test(target)
}

/** Expands tilde forms at the start of a target path. */
export function resolveTilde(target: string, home: string): string {
  if (target === '~') return home
  if (target.startsWith('~/')) return home + target.slice(1)
  if (target === '~+') return process.cwd()
  if (target.startsWith('~+/')) return process.cwd() + target.slice(2)
  if (target === '~-') return process.env.OLDPWD ?? home
  if (target.startsWith('~-/')) return (process.env.OLDPWD ?? home) + target.slice(2)
  return target
}

/** Two-step project-root detection (git rev-parse, then .clooks/clooks.yml walk-up). */
export function findProjectRoot(cwd: string): string | null {
  try {
    const git = spawnSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      timeout: 1000,
      encoding: 'utf8',
    })
    if (git.status === 0 && git.stdout) {
      const root = git.stdout.trim()
      if (root) return root
    }
  } catch {
    // git not on PATH — fall through
  }
  let dir = cwd
  while (true) {
    if (existsSync(join(dir, '.clooks', 'clooks.yml'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** Tags produced by `classifyPath`. */
export type VerdictTag = 'home' | 'root' | 'project-root' | 'escape' | 'strict' | 'allow'

/**
 * Classifies an absolute path against the project root, home, and allowlists.
 *
 * Ordering: literal-tilde guard → project-root containment → home → system-root
 * → escape. Project-root containment is checked BEFORE home/system so a project
 * that lives under /tmp/ or /home/<user>/ (the common case) classifies its
 * internal paths correctly — `/home/alice/proj/src` is strict, not home;
 * `/tmp/myproj/node_modules` is allow, not root.
 */
export function classifyPath(
  absolutePath: string,
  projectRoot: string,
  home: string,
  allowlist: Set<string>,
): VerdictTag {
  if (absolutePath.startsWith('~')) return 'home'

  const p = normalize(absolutePath)
  const root = normalize(projectRoot)

  // Project-root containment short-circuits — the path is unambiguously
  // inside the project, even when the project itself sits under a home or
  // system-top-level path.
  if (p === root) return 'project-root'
  if (p.startsWith(root + '/')) {
    const firstSegment = relative(root, p).split('/')[0]
    if (allowlist.has(firstSegment)) return 'allow'
    return 'strict'
  }

  if (home) {
    const h = normalize(home)
    if (p === h || p.startsWith(h + '/')) return 'home'
  }
  if (/^\/(home|Users)\/[^/]+(\/|$)/.test(p)) return 'home'

  if (p === '/') return 'root'
  const firstSlashAfterRoot = p.indexOf('/', 1)
  const topLevel = firstSlashAfterRoot === -1 ? p : p.slice(0, firstSlashAfterRoot)
  if (SYSTEM_TOP_LEVEL.has(topLevel)) return 'root'

  return 'escape'
}

export type GlobResult =
  | { ok: true; paths: string[] }
  | { ok: false; errno?: string; failedPath?: string }

/**
 * Wraps Bun.Glob.scanSync with a symlink-audit pre-pass and post-pass to
 * close the symlink-escape exploit. Returns ELOOP_GUARD if any matching
 * entry in the scan parent is a symlink. Bun.Glob's default behavior is to
 * silently drop symlinks from results, but rm follows them during recursive
 * deletion — so we fail-closed instead.
 */
export function expandGlob(pattern: string, cwd: string): GlobResult {
  // Step 1: audit scan parent for symlinks matching the leaf pattern.
  const { scanParent, leaf } = splitPattern(pattern, cwd)
  const auditResult = auditScanParent(scanParent, leaf)
  if (!auditResult.ok) return auditResult

  // Step 2: run Bun.Glob for the actual match list.
  let matches: string[]
  try {
    const g = new Bun.Glob(pattern)
    matches = []
    for (const p of g.scanSync({ cwd, absolute: true, onlyFiles: false })) matches.push(p)
  } catch (e: unknown) {
    const err = e as { code?: string; path?: string; cause?: { code?: string; path?: string } }
    const errno = err.code ?? err.cause?.code
    const failedPath = err.path ?? err.cause?.path
    return { ok: false, errno, failedPath }
  }

  // Step 3: defense-in-depth lstat on each match.
  for (const match of matches) {
    try {
      if (lstatSync(match).isSymbolicLink()) {
        return { ok: false, errno: 'ELOOP_GUARD', failedPath: match }
      }
    } catch {
      // path vanished between scan and lstat — ignore
    }
  }

  return { ok: true, paths: matches }
}

function splitPattern(pattern: string, cwd: string): { scanParent: string; leaf: string } {
  const firstGlobIdx = pattern.search(/[*?[{]/)
  const literal = firstGlobIdx < 0 ? pattern : pattern.slice(0, firstGlobIdx)
  const lastSlash = literal.lastIndexOf('/')
  const literalDir = lastSlash < 0 ? '' : literal.slice(0, lastSlash)
  const leafStart = lastSlash < 0 ? 0 : lastSlash + 1
  const leaf = pattern.slice(leafStart)
  const scanParent = isAbsolute(literalDir) ? literalDir : resolvePathNode(cwd, literalDir || '.')
  return { scanParent, leaf }
}

function auditScanParent(scanParent: string, leaf: string): GlobResult {
  let entries: string[]
  try {
    entries = readdirSync(scanParent)
  } catch {
    return { ok: true, paths: [] }
  }
  // For globstar leaves, use '*' for matching — '**/*.tmp' shouldn't fail to
  // match a plain directory name like 'cache'.
  const simpleLeaf = leaf.includes('**') ? '*' : leaf
  const leafMatcher = new Bun.Glob(simpleLeaf)
  for (const name of entries) {
    if (!leafMatcher.match(name)) continue
    const full = `${scanParent}/${name}`
    try {
      if (lstatSync(full).isSymbolicLink()) {
        return { ok: false, errno: 'ELOOP_GUARD', failedPath: full }
      }
    } catch {
      // entry vanished — ignore
    }
  }
  return { ok: true, paths: [] }
}

type RuleId =
  | 'rm-rf-no-project-root'
  | 'rm-rf-no-preserve-root'
  | 'rm-rf-unresolved-var'
  | 'rm-rf-globstar'
  | 'rm-rf-dangerous-glob-unbypassable'
  | 'rm-rf-expansion-error'
  | 'rm-rf-home'
  | 'rm-rf-root'
  | 'rm-rf-project-root'
  | 'rm-rf-escape'
  | 'rm-rf-strict'

type ReasonContext = {
  pattern: string
  resolved?: string
  projectRoot?: string
  cwd?: string
  glob?: GlobResult
}

interface Rule {
  id: RuleId
  hasEscapeHatch: boolean
  verdict: 'deny' | 'ask'
  reason: (ctx: ReasonContext) => string
}

function reasonForHome(token: string, resolved: string): string {
  if (token === '~' || token === '~/') {
    return `[rm-rf-home] Argument "~" expands to your home directory ($HOME = ${resolved}) at shell execution, so this command would recursively delete your entire home. This check runs before shell expansion, which is why the literal "~" is flagged. Drop "~" from the argument list — the other paths can still be deleted in the same command. Unbypassable.`
  }
  return `[rm-rf-home] Argument "${token}" expands to ${resolved}, a user home directory. Name an explicit subdirectory instead. Unbypassable.`
}

function reasonForDangerousGlob(token: string): string {
  if (token === '.*') {
    return `[rm-rf-dangerous-glob-unbypassable] Argument ".*" is a glob that matches \`..\` as well as dotfiles, so \`rm -rf .*\` recursively deletes the parent directory. Use a specific dotfile pattern instead (e.g. \`./.[!.]*\`). Unbypassable.`
  }
  return `[rm-rf-dangerous-glob-unbypassable] Argument "/*" expands to every top-level directory on the filesystem — equivalent to \`rm -rf /\`. Unbypassable.`
}

function reasonForExpansionError(
  pattern: string,
  result: { errno?: string; failedPath?: string },
): string {
  const failedPath = result.failedPath ?? '<unknown>'
  const errno = result.errno ?? '<unknown>'
  if (errno === 'ELOOP_GUARD') {
    return `[rm-rf-expansion-error] Cannot safely expand pattern "${pattern}" — (errno ELOOP_GUARD): "${failedPath}" is a symlink. rm -rf follows symlinks during recursive deletion, meaning this command could delete data outside the glob's apparent scope. Replace the glob with an explicit list of concrete paths (e.g. \`rm -rf build/legit.o\` instead of \`rm -rf build/*\`) so the targets can be classified. If you have verified that following this symlink is intentional, prefix with ALLOW_DESTRUCTIVE_RM=true.`
  }
  return `[rm-rf-expansion-error] Cannot safely expand pattern "${pattern}" — (errno ${errno}): read permission denied on "${failedPath}". This hook cannot verify which files the pattern would match, so the command is blocked fail-closed. If you've confirmed the expansion is safe and the permission error is expected, prefix with ALLOW_DESTRUCTIVE_RM=true. Note that \`rm\` itself would likely fail on these paths too.`
}

const RULES: Record<RuleId, Rule> = {
  'rm-rf-no-project-root': {
    id: 'rm-rf-no-project-root',
    hasEscapeHatch: true,
    verdict: 'deny',
    reason: (ctx) =>
      `[rm-rf-no-project-root] Cannot determine a project root from ${ctx.cwd} (no git repository, no .clooks/clooks.yml reachable). rm -rf is blocked outside a recognized project. Move to a project directory, run \`clooks init\`, or prefix with ALLOW_DESTRUCTIVE_RM=true.`,
  },
  'rm-rf-no-preserve-root': {
    id: 'rm-rf-no-preserve-root',
    hasEscapeHatch: false,
    verdict: 'deny',
    reason: () =>
      `[rm-rf-no-preserve-root] The command passes --no-preserve-root, which disables GNU rm's built-in safeguard against \`rm -rf /\`. No legitimate agent workflow emits this flag. Remove the flag and reconsider the intended target. Unbypassable.`,
  },
  'rm-rf-unresolved-var': {
    id: 'rm-rf-unresolved-var',
    hasEscapeHatch: true,
    verdict: 'deny',
    reason: (ctx) =>
      `[rm-rf-unresolved-var] Argument "${ctx.pattern}" contains a shell variable this hook cannot evaluate. If the variable is unset, bash expands it to an empty string — \`rm -rf $BUILD_DIR/src\` becomes \`rm -rf /src\`. Resolve the variable to a literal path first. If you are certain it is set and safe, prefix the command with ALLOW_DESTRUCTIVE_RM=true.`,
  },
  'rm-rf-globstar': {
    id: 'rm-rf-globstar',
    hasEscapeHatch: true,
    verdict: 'deny',
    reason: (ctx) =>
      `[rm-rf-globstar] Argument "${ctx.pattern}" uses bash's globstar, which recursively matches every file under the current directory and may follow symlinks. This hook cannot evaluate the expansion. Replace with an explicit path list or a narrower glob (e.g. \`build/*.o\`). If the expansion is known-safe, prefix with ALLOW_DESTRUCTIVE_RM=true.`,
  },
  'rm-rf-dangerous-glob-unbypassable': {
    id: 'rm-rf-dangerous-glob-unbypassable',
    hasEscapeHatch: false,
    verdict: 'deny',
    reason: (ctx) => reasonForDangerousGlob(ctx.pattern),
  },
  'rm-rf-expansion-error': {
    id: 'rm-rf-expansion-error',
    hasEscapeHatch: true,
    verdict: 'deny',
    reason: (ctx) =>
      reasonForExpansionError(
        ctx.pattern,
        (ctx.glob ?? { ok: false }) as { errno?: string; failedPath?: string },
      ),
  },
  'rm-rf-home': {
    id: 'rm-rf-home',
    hasEscapeHatch: false,
    verdict: 'deny',
    reason: (ctx) => reasonForHome(ctx.pattern, ctx.resolved!),
  },
  'rm-rf-root': {
    id: 'rm-rf-root',
    hasEscapeHatch: false,
    verdict: 'deny',
    reason: (ctx) =>
      `[rm-rf-root] Argument "${ctx.pattern}" targets a system directory outside any project (${ctx.pattern} is one of the protected top-level paths). If you intend to modify system configuration, ask the user to run the command themselves — agents should not recursively delete system directories. Unbypassable.`,
  },
  'rm-rf-project-root': {
    id: 'rm-rf-project-root',
    hasEscapeHatch: false,
    verdict: 'ask',
    reason: (ctx) =>
      `[rm-rf-project-root] Argument "${ctx.pattern}" resolves to the project root (${ctx.projectRoot}), which would recursively delete the entire project, including the .git directory. Confirm if this is intentional.\n\nNote: ALLOW_DESTRUCTIVE_RM=true does not bypass this rule.`,
  },
  'rm-rf-escape': {
    id: 'rm-rf-escape',
    hasEscapeHatch: true,
    verdict: 'deny',
    reason: (ctx) =>
      `[rm-rf-escape] Argument "${ctx.pattern}" resolves to ${ctx.resolved}, which is outside the project root ${ctx.projectRoot}. This hook prevents cross-project deletion. Rewrite as a project-relative path. If cross-project cleanup is intentional, prefix with ALLOW_DESTRUCTIVE_RM=true.`,
  },
  'rm-rf-strict': {
    id: 'rm-rf-strict',
    hasEscapeHatch: false,
    verdict: 'ask',
    reason: (ctx) => {
      // Use the first segment (basename inside project) as the label — matches canonical template.
      const label = relative(ctx.projectRoot!, ctx.resolved!).split('/')[0] || ctx.pattern
      return `[rm-rf-strict] Recursive delete of "${label}" inside ${ctx.projectRoot}. "${label}" is not in the default allowlist (build artifacts, caches, dependency directories) or your configured \`extraAllowlist\`. Confirm if you intend to delete a source directory.\n\nNote: ALLOW_DESTRUCTIVE_RM=true does not bypass this rule — it is a user-confirmation rule, not a denial. Either extend extraAllowlist in clooks.yml or confirm the prompt.`
    },
  },
}

// Map VerdictTag (other than 'allow') to the rule ID that tag triggers.
const TAG_TO_RULE: Record<Exclude<VerdictTag, 'allow'>, RuleId> = {
  home: 'rm-rf-home',
  root: 'rm-rf-root',
  'project-root': 'rm-rf-project-root',
  escape: 'rm-rf-escape',
  strict: 'rm-rf-strict',
}

function ruleEnabled(id: RuleId, config: Config): boolean {
  return config[id] !== false
}

/** True iff a rule is enabled in config AND not escaped by ALLOW_DESTRUCTIVE_RM=true. */
function shouldApply(rule: Rule, config: Config, escape: boolean): boolean {
  return ruleEnabled(rule.id, config) && !(escape && rule.hasEscapeHatch)
}

function resolvePath(target: string, cwd: string, home: string): string {
  const tildeResolved = resolveTilde(target, home)
  if (tildeResolved.startsWith('~')) return tildeResolved
  if (isAbsolute(tildeResolved)) return tildeResolved
  return resolvePathNode(cwd, tildeResolved)
}

type AggregatedEntry = { rule: Rule; reason: string }

function fire(id: RuleId, ctx: ReasonContext): AggregatedEntry {
  const rule = RULES[id]
  return { rule, reason: rule.reason(ctx) }
}

function severityRank(entry: AggregatedEntry): number {
  const { verdict, hasEscapeHatch } = entry.rule
  if (verdict === 'ask') return 2
  if (!hasEscapeHatch) return 0
  return 1
}

/** Mutates `entries`: sorts in place by severity rank. */
function aggregate(entries: AggregatedEntry[]): PreToolUseResult {
  if (entries.length === 0) return { result: 'skip' }
  entries.sort((a, b) => severityRank(a) - severityRank(b))
  const head = entries[0]
  const reason = entries.map((e) => e.reason).join('\n\n')
  if (head.rule.verdict === 'ask') {
    return {
      result: 'ask',
      reason,
      debugMessage: `no-rm-rf: asking on ${head.rule.id}`,
    }
  }
  return {
    result: 'block',
    reason,
    debugMessage: `no-rm-rf: blocked on ${head.rule.id}`,
  }
}

export const hook: ClooksHook<Config> = {
  meta: {
    name: 'no-rm-rf',
    description:
      'Blocks recursive rm against catastrophic paths (home, system, project-root escapes)',
    config: {
      'rm-rf-no-project-root': true,
      'rm-rf-no-preserve-root': true,
      'rm-rf-unresolved-var': true,
      'rm-rf-globstar': true,
      'rm-rf-dangerous-glob-unbypassable': true,
      'rm-rf-expansion-error': true,
      'rm-rf-home': true,
      'rm-rf-root': true,
      'rm-rf-project-root': true,
      'rm-rf-escape': true,
      'rm-rf-strict': true,
      extraAllowlist: [],
      strictMode: false,
    },
  },

  PreToolUse(ctx, config) {
    if (ctx.toolName !== 'Bash') return { result: 'skip' }

    const command = ctx.toolInput.command
    if (!command) return { result: 'skip' }

    const sanitized = sanitize(command)
    const segments = getSegments(sanitized)

    // Short-circuit: if no segment contains a recursive rm, skip the expensive
    // findProjectRoot call (git rev-parse spawn, up to 1s). This avoids the
    // latency cost on every non-rm Bash tool call.
    //
    // Recursive-rm detection runs on the FULL segment (not on `rest` after
    // stripEnvPrefix) to be robust against env prefixes with quoted values
    // that `sanitize` collapsed into bare spaces. Example:
    //   `VAR="a b" rm -rf ~` sanitizes to `VAR=a b rm -rf ~`; stripEnvPrefix
    //   only peels `VAR=a`, leaving rest = `b rm -rf ~`. Scanning the full
    //   segment still locates the rm invocation.
    const hasAnyRecursiveRm = segments.some((seg) => hasRecursiveFlag(seg))
    if (!hasAnyRecursiveRm) return { result: 'skip' }

    // Hoist project-root detection out of the segment loop: cwd is the same
    // for all segments, and git rev-parse has a 1s timeout — one call per
    // segment would scale catastrophically on compound commands.
    const projectRoot = findProjectRoot(ctx.cwd)
    const home = process.env.HOME ?? ''
    const allowlist = new Set<string>([...DEFAULT_ALLOWLIST, ...(config.extraAllowlist ?? [])])

    const aggregated: AggregatedEntry[] = []

    for (const segment of segments) {
      const { prefix } = stripEnvPrefix(segment)
      const escape = hasEscapeHatch(prefix)

      // Recursive-rm detection runs on the full segment to avoid missing
      // commands whose env prefix got malformed by quote stripping (see the
      // short-circuit above). extractTargets below also runs on the full
      // segment — it latches on the first `rm` token internally, so leading
      // env-fragment tokens are skipped naturally.
      if (!hasRecursiveFlag(segment)) continue

      // Rule 1 preflight: no project root at all.
      if (projectRoot === null) {
        if (shouldApply(RULES['rm-rf-no-project-root'], config, escape)) {
          aggregated.push(fire('rm-rf-no-project-root', { pattern: '', cwd: ctx.cwd }))
        }
        continue
      }

      // Rule 2 command-level: --no-preserve-root (unbypassable).
      if (/--no-preserve-root(?=\s|$)/.test(segment)) {
        if (shouldApply(RULES['rm-rf-no-preserve-root'], config, escape)) {
          aggregated.push(fire('rm-rf-no-preserve-root', { pattern: '' }))
          continue // fatal when rule is active — skip classification on this segment
        }
        // Rule disabled — fall through so other targets in the segment still get classified.
      }

      const targets = extractTargets(segment)
      const classificationSet: Array<{ pattern: string; resolved: string }> = []

      for (const target of targets) {
        // Rule 3 — unresolved variable / subshell.
        if (hasVariableExpansion(target)) {
          if (shouldApply(RULES['rm-rf-unresolved-var'], config, escape)) {
            aggregated.push(fire('rm-rf-unresolved-var', { pattern: target }))
          }
          continue
        }
        // Rule 4 — globstar.
        if (target.includes('**')) {
          if (shouldApply(RULES['rm-rf-globstar'], config, escape)) {
            aggregated.push(fire('rm-rf-globstar', { pattern: target }))
          }
          continue
        }
        // Rule 5 — literal .* or /* (unbypassable).
        if (target === '.*' || target === '/*') {
          if (shouldApply(RULES['rm-rf-dangerous-glob-unbypassable'], config, escape)) {
            aggregated.push(fire('rm-rf-dangerous-glob-unbypassable', { pattern: target }))
          }
          continue
        }

        // Glob or literal expansion.
        if (hasGlobChars(target)) {
          const result = expandGlob(target, ctx.cwd)
          if (!result.ok) {
            if (shouldApply(RULES['rm-rf-expansion-error'], config, escape)) {
              aggregated.push(fire('rm-rf-expansion-error', { pattern: target, glob: result }))
            }
            continue
          }
          for (const p of result.paths) classificationSet.push({ pattern: target, resolved: p })
        } else {
          const resolved = resolvePath(target, ctx.cwd, home)
          classificationSet.push({ pattern: target, resolved })
        }
      }

      // Classification (rules 7–11)
      for (const { pattern, resolved } of classificationSet) {
        const tag = classifyPath(resolved, projectRoot, home, allowlist)
        if (tag === 'allow') continue
        const ruleId = TAG_TO_RULE[tag]
        const rule = RULES[ruleId]
        if (!shouldApply(rule, config, escape)) continue
        const reason = rule.reason({ pattern, resolved, projectRoot })
        const promoteToDeny =
          config.strictMode === true &&
          (ruleId === 'rm-rf-project-root' || ruleId === 'rm-rf-strict')
        aggregated.push({ rule: promoteToDeny ? { ...rule, verdict: 'deny' } : rule, reason })
      }
    }

    return aggregate(aggregated)
  },
}
