import type { HookName } from '../types/branded.js'
import { join, isAbsolute } from 'path'
import { existsSync } from 'fs'

export function isPathLike(value: string): boolean {
  return (
    value === '..' || value.startsWith('./') || value.startsWith('../') || value.startsWith('/')
  )
}

export function isShortAddress(value: string): boolean {
  if (isPathLike(value)) return false
  // Must match owner/repo:hook-name — exactly one slash before the colon
  return /^[^/:]+\/[^/:]+:[^/:]+$/.test(value)
}

/** Extracts the hook-name portion from a short address (after the `:`). */
export function shortAddressHookName(address: string): string {
  return address.split(':')[1] ?? ''
}

export function resolveHookPath(
  hookName: HookName,
  entry: { uses?: string },
  basePath?: string,
): string {
  const base = basePath ?? '.'

  if (entry.uses !== undefined) {
    if (isPathLike(entry.uses)) {
      // Absolute paths are returned as-is
      if (isAbsolute(entry.uses)) {
        return entry.uses
      }

      // Relative path: join with basePath when known
      if (basePath !== undefined) {
        return join(base, entry.uses)
      }
      return entry.uses
    }
    // Short address resolution (owner/repo:hook-name)
    if (isShortAddress(entry.uses)) {
      const [repoPath, shortName] = entry.uses.split(':')
      const tsPath = join(base, `.clooks/vendor/github.com/${repoPath}/${shortName}.ts`)
      const jsPath = join(base, `.clooks/vendor/github.com/${repoPath}/${shortName}.js`)
      // Prefer .ts; use .js if it exists and .ts does not
      if (!existsSync(tsPath) && existsSync(jsPath)) return jsPath
      return tsPath // Default — produces a clear "file not found" error if missing
    }

    // Hook name reference: resolve via conventions using uses value instead of hookName
    const name = entry.uses
    if (name.includes('/')) {
      return join(base, `.clooks/vendor/${name}/index.ts`)
    }
    return join(base, `.clooks/hooks/${name}.ts`)
  }

  // No uses: resolve from hookName via conventions
  if (isShortAddress(hookName)) {
    const [repoPath, shortName] = hookName.split(':')
    const tsPath = join(base, `.clooks/vendor/github.com/${repoPath}/${shortName}.ts`)
    const jsPath = join(base, `.clooks/vendor/github.com/${repoPath}/${shortName}.js`)
    if (!existsSync(tsPath) && existsSync(jsPath)) return jsPath
    return tsPath
  }
  if (hookName.includes('/')) {
    return join(base, `.clooks/vendor/${hookName}/index.ts`)
  }
  return join(base, `.clooks/hooks/${hookName}.ts`)
}
