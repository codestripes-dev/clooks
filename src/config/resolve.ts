import type { HookName } from "../types/branded.js"
import { join, isAbsolute, normalize, resolve } from "path"

export function isPathLike(value: string): boolean {
  return value === ".." || value.startsWith("./") || value.startsWith("../") || value.startsWith("/")
}

export function resolveHookPath(
  hookName: HookName,
  entry: { uses?: string },
  basePath?: string,
): string {
  const base = basePath ?? "."

  if (entry.uses !== undefined) {
    if (isPathLike(entry.uses)) {
      // Guard 1: reject absolute paths
      if (isAbsolute(entry.uses)) {
        throw new Error(
          `clooks: hook path "${entry.uses}" must be a relative path, not an absolute path`
        )
      }

      // Guard 2: reject traversal sequences unconditionally
      // Check normalized path segments for exact ".." (not "..." or other dot names)
      const normalized = normalize(entry.uses)
      if (normalized.split("/").some(seg => seg === "..")) {
        throw new Error(
          `clooks: hook path "${entry.uses}" contains path traversal sequences ("..") which are not allowed`
        )
      }

      // Guard 3: when basePath is known, verify the joined path stays within base
      if (basePath !== undefined) {
        const joined = join(base, entry.uses)
        const resolvedJoined = resolve(joined)
        const resolvedBase = resolve(base)
        if (!resolvedJoined.startsWith(resolvedBase + "/") && resolvedJoined !== resolvedBase) {
          throw new Error(
            `clooks: hook path "${entry.uses}" escapes the base directory "${base}"`
          )
        }
        return joined
      }
      return entry.uses
    }
    // Hook name reference: resolve via conventions using uses value instead of hookName
    const name = entry.uses
    if (name.includes("/")) {
      return join(base, `.clooks/vendor/${name}/index.ts`)
    }
    return join(base, `.clooks/hooks/${name}.ts`)
  }

  // No uses: resolve from hookName via conventions
  if (hookName.includes("/")) {
    return join(base, `.clooks/vendor/${hookName}/index.ts`)
  }
  return join(base, `.clooks/hooks/${hookName}.ts`)
}
