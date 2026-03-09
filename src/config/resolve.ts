import type { HookName } from "../types/branded.js"
import { join } from "path"

export function resolveHookPath(
  hookName: HookName,
  entry: { path?: string },
  basePath?: string,
): string {
  const base = basePath ?? "."

  if (entry.path !== undefined) {
    if (basePath !== undefined) {
      return join(base, entry.path)
    }
    return entry.path
  }

  if (hookName.includes("/")) {
    return join(base, `.clooks/vendor/${hookName}/index.ts`)
  }

  return join(base, `.clooks/hooks/${hookName}.ts`)
}
