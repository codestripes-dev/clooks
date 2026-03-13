// Utilities for parsing and converting GitHub blob URLs.

export interface GitHubBlobInfo {
  owner: string // e.g., "someuser"
  repo: string // e.g., "hooks"
  ref: string // e.g., "main", "v1.0.0", "abc123"
  path: string // e.g., "lint-guard.ts" or "src/hooks/lint-guard.ts"
  filename: string // e.g., "lint-guard.ts"
  filenameStem: string // e.g., "lint-guard" (without extension)
}

/**
 * Parses a GitHub blob URL and returns a structured GitHubBlobInfo object.
 *
 * Accepts URLs of the form:
 *   https://github.com/<owner>/<repo>/blob/<ref>/<path>
 *
 * Throws a descriptive error if the URL is invalid.
 *
 * Note: refs containing `/` (e.g., `feature/my-branch`) are not supported in V0.
 * The ref is always a single path segment.
 */
export function parseGitHubBlobUrl(url: string): GitHubBlobInfo {
  if (!url || typeof url !== 'string') {
    throw new Error(
      `Invalid GitHub blob URL: expected a non-empty string, got ${JSON.stringify(url)}`,
    )
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`Invalid GitHub blob URL: not a valid URL — ${JSON.stringify(url)}`)
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`Only HTTPS GitHub URLs are supported: ${url}`)
  }

  if (parsed.hostname !== 'github.com') {
    throw new Error(`Invalid GitHub blob URL: expected host "github.com", got "${parsed.hostname}"`)
  }

  // Strip query and fragment — work from pathname only.
  // Segments: ['', owner, repo, 'blob', ref, ...pathParts]
  // Decode each segment to handle percent-encoded characters (e.g., spaces, special chars).
  const segments = parsed.pathname.split('/').map((s) => decodeURIComponent(s))

  // segments[0] is always '' (leading slash), so meaningful content starts at index 1
  const owner = segments[1] ?? ''
  const repo = segments[2] ?? ''
  const blobSegment = segments[3] ?? ''
  const ref = segments[4] ?? ''
  const pathParts = segments.slice(5)

  if (!owner) {
    throw new Error(`Invalid GitHub blob URL: owner is missing — ${JSON.stringify(url)}`)
  }
  if (!repo) {
    throw new Error(`Invalid GitHub blob URL: repo is missing — ${JSON.stringify(url)}`)
  }
  if (blobSegment !== 'blob') {
    throw new Error(
      `Invalid GitHub blob URL: expected "/blob/" segment, got "/${blobSegment}/" — ${JSON.stringify(url)}`,
    )
  }
  if (!ref) {
    throw new Error(`Invalid GitHub blob URL: ref is missing — ${JSON.stringify(url)}`)
  }
  if (pathParts.length === 0 || pathParts.every((p) => p === '')) {
    throw new Error(`Invalid GitHub blob URL: file path is missing — ${JSON.stringify(url)}`)
  }

  const path = pathParts.join('/')
  if (!path) {
    throw new Error(`Invalid GitHub blob URL: file path is missing — ${JSON.stringify(url)}`)
  }

  const filename = pathParts[pathParts.length - 1]
  if (!filename) {
    throw new Error(`Invalid GitHub blob URL: file path is missing — ${JSON.stringify(url)}`)
  }

  if (!filename.endsWith('.ts') && !filename.endsWith('.js')) {
    throw new Error(
      `Invalid GitHub blob URL: file must end with ".ts" or ".js", got "${filename}" — ${JSON.stringify(url)}`,
    )
  }

  // Strip extension to get the stem (remove the last dot-segment).
  const dotIndex = filename.lastIndexOf('.')
  const filenameStem = dotIndex !== -1 ? filename.slice(0, dotIndex) : filename

  return { owner, repo, ref, path, filename, filenameStem }
}

/**
 * Converts a GitHubBlobInfo to a raw.githubusercontent.com download URL.
 */
export function toRawUrl(info: GitHubBlobInfo): string {
  return `https://raw.githubusercontent.com/${info.owner}/${info.repo}/${info.ref}/${info.path}`
}
