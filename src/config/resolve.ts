import type { HookName } from "../types/branded.js"

export function resolveHookPath(
  hookName: HookName,
  entry: { path?: string },
): string {
  if (entry.path !== undefined) {
    return entry.path
  }

  if (hookName.includes("/")) {
    return `.clooks/vendor/${hookName}/index.ts`
  }

  return `.clooks/hooks/${hookName}.ts`
}
