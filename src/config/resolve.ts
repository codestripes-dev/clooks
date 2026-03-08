export function resolveHookPath(
  hookName: string,
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
