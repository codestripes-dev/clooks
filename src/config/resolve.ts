import type { HookName } from "../types/branded.js"
import { join } from "path"

export function isPathLike(value: string): boolean {
  return value.startsWith("./") || value.startsWith("../") || value.startsWith("/")
}

export function resolveHookPath(
  hookName: HookName,
  entry: { uses?: string },
  basePath?: string,
): string {
  const base = basePath ?? "."

  if (entry.uses !== undefined) {
    if (isPathLike(entry.uses)) {
      // Path-like: direct file reference
      return basePath !== undefined ? join(base, entry.uses) : entry.uses
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
