import type { ClooksHook } from './types'

type Config = {
  /**
   * Extra credential filename patterns (regex strings, matched
   * case-insensitively against the basename or full path) on top of the
   * built-in list.
   */
  extraPatterns: string[]
  /**
   * Allowlist of regex strings. If any matches the basename or full path of
   * the targeted file, the access is permitted (e.g. example fixtures,
   * docs).
   */
  allowPatterns: string[]
}

/**
 * Built-in credential filename patterns. Matched against the basename
 * first, then the full path. Case-insensitive.
 */
const CREDENTIAL_PATTERNS: RegExp[] = [
  // Dotenv family: .env, .env.local, .env.production, env.local, .env.foo.bar
  /(^|\/)\.?env(\.[^/]+)?$/i,
  // SSH private keys
  /(^|\/)id_(rsa|ed25519|ecdsa|dsa)$/i,
  /(^|\/)\.ssh\//i,
  // Generic key/cert/credential file extensions
  /\.(pem|key|p12|pfx|asc|gpg|jks|keystore)$/i,
  // Common credential filenames (basename match)
  /(^|\/)(credentials|secrets?|secret|private[_-]?key|service[_-]?account|service-account)(\.[a-z0-9]+)?$/i,
  // Cloud provider config dirs / files
  /(^|\/)\.aws\/(credentials|config)$/i,
  /(^|\/)\.gcp\//i,
  /(^|\/)gcloud\/.*credentials/i,
  /(^|\/)\.azure\//i,
  /(^|\/)\.kube\/config$/i,
  // Auth tokens / netrc / npmrc / pypirc / docker config
  /(^|\/)\.netrc$/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.pypirc$/i,
  /(^|\/)\.docker\/config\.json$/i,
  // Terraform state often contains secrets
  /\.tfstate(\.backup)?$/i,
  // Wallet / token files
  /(^|\/)(wallet|token|api[_-]?key|auth[_-]?token)(\.[a-z0-9]+)?$/i,
]

/**
 * Bash command tokens commonly used to read file contents. Detects
 * `<reader> path/to/.env` style invocations as well as redirected reads
 * like `dotenv < .env`.
 */
const BASH_READERS = [
  'cat',
  'bat',
  'less',
  'more',
  'head',
  'tail',
  'nl',
  'tac',
  'xxd',
  'od',
  'strings',
  'awk',
  'sed',
  'rg',
  'grep',
  'egrep',
  'fgrep',
  'jq',
  'yq',
  'cp',
  'rsync',
  'scp',
  'tar',
  'zip',
  'curl',
  'wget',
  'source',
  '.',
]

function matchesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(value))
}

function isCredentialPath(rawPath: string, extra: RegExp[], allow: RegExp[]): boolean {
  if (!rawPath) return false
  // Strip surrounding quotes a Bash command might carry.
  const path = rawPath.replace(/^['"]|['"]$/g, '')
  if (matchesAny(path, allow)) return false
  return matchesAny(path, CREDENTIAL_PATTERNS) || matchesAny(path, extra)
}

/**
 * Pulls candidate paths out of a Bash command. Tokenizes naively on
 * whitespace and scans every token. Good enough for catching the common
 * `cat .env`, `grep KEY .env.production`, `cp ~/.aws/credentials /tmp`
 * shapes; not trying to be a full shell parser.
 */
function bashCommandPaths(command: string): string[] {
  // Split on whitespace, |, &&, ||, ;, <, >. Keep tokens that look like paths
  // (contain a slash or a dot, but not pure flags).
  const tokens = command.split(/[\s|;&<>]+/).filter(Boolean)
  const paths: string[] = []
  for (const tok of tokens) {
    const cleaned = tok.replace(/^['"]|['"]$/g, '')
    if (!cleaned) continue
    if (cleaned.startsWith('-')) continue // flag
    // Anything containing a slash or starting with a dot, or with an extension.
    if (cleaned.includes('/') || cleaned.startsWith('.') || /\.[a-z0-9]+$/i.test(cleaned)) {
      paths.push(cleaned)
    }
  }
  return paths
}

function bashLooksLikeRead(command: string): boolean {
  // Lowercase the leading token + pipeline tokens to find readers.
  const tokens = command.split(/[\s|;&]+/).filter(Boolean)
  for (const tok of tokens) {
    const base = tok.replace(/^.*\//, '').toLowerCase()
    if (BASH_READERS.includes(base)) return true
  }
  // Bare redirection: `< .env` would also leak, but no reader -> still treat
  // any `< file` as a read.
  if (/<\s*\S/.test(command)) return true
  return false
}

export const hook: ClooksHook<Config> = {
  meta: {
    name: 'block-credential-reads',
    description:
      'Blocks the agent from reading .env files and other credential files via Read, Edit, Write, Glob, Grep, or Bash readers (cat/less/grep/etc.).',
    config: {
      extraPatterns: [],
      allowPatterns: [],
    },
  },

  PreToolUse(ctx, config) {
    const extra = (config?.extraPatterns ?? []).map((p) => new RegExp(p, 'i'))
    const allow = (config?.allowPatterns ?? []).map((p) => new RegExp(p, 'i'))

    const tool = ctx.toolName

    // Direct file-touching tools: check the filePath.
    if (tool === 'Read' || tool === 'Edit' || tool === 'Write') {
      const path = ctx.toolInput.filePath
      if (isCredentialPath(path, extra, allow)) {
        return ctx.block({
          reason: `Reading credential-like file is blocked: ${path}. If this is a false positive, add the pattern to allowPatterns in clooks.yml.`,
          debugMessage: `block-credential-reads: ${tool} matched credential pattern (${path})`,
        })
      }
      return ctx.skip({ debugMessage: `block-credential-reads: ${tool} clean (${path})` })
    }

    // Glob: pattern itself can target credential files (e.g. **/.env*).
    if (tool === 'Glob') {
      const pattern = ctx.toolInput.pattern
      if (isCredentialPath(pattern, extra, allow)) {
        return ctx.block({
          reason: `Glob pattern targets credential files: ${pattern}.`,
          debugMessage: `block-credential-reads: Glob pattern matched (${pattern})`,
        })
      }
      return ctx.skip({ debugMessage: `block-credential-reads: Glob clean` })
    }

    // Grep: blocks if the file glob or path targets credentials. Grep with
    // outputMode=content over .env-shaped files leaks contents.
    if (tool === 'Grep') {
      const candidates = [ctx.toolInput.path, ctx.toolInput.glob].filter(
        (s): s is string => typeof s === 'string' && s.length > 0,
      )
      for (const c of candidates) {
        if (isCredentialPath(c, extra, allow)) {
          return ctx.block({
            reason: `Grep target points at credential files: ${c}.`,
            debugMessage: `block-credential-reads: Grep target matched (${c})`,
          })
        }
      }
      return ctx.skip({ debugMessage: 'block-credential-reads: Grep clean' })
    }

    // Bash: scan command for reader invocations against credential paths.
    if (tool === 'Bash') {
      const command = ctx.toolInput.command
      if (!bashLooksLikeRead(command)) {
        return ctx.skip({ debugMessage: 'block-credential-reads: Bash not a read' })
      }
      const paths = bashCommandPaths(command)
      for (const p of paths) {
        if (isCredentialPath(p, extra, allow)) {
          return ctx.block({
            reason: `Bash command would read credential file (${p}). Use environment-variable indirection or block this access.`,
            debugMessage: `block-credential-reads: Bash matched (${p}) in command: ${command}`,
          })
        }
      }
      return ctx.skip({ debugMessage: 'block-credential-reads: Bash clean' })
    }

    return ctx.skip()
  },
}
