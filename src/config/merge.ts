function isPlainObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === "object" && !Array.isArray(val)
}

export function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...base }
  for (const key of Object.keys(override)) {
    const baseVal = result[key]
    const overVal = override[key]
    if (isPlainObject(baseVal) && isPlainObject(overVal)) {
      result[key] = deepMerge(
        baseVal as Record<string, unknown>,
        overVal as Record<string, unknown>,
      )
    } else {
      result[key] = overVal
    }
  }
  return result
}

export function mergeConfigFiles(
  base: Record<string, unknown>,
  local: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (local === undefined) return base
  return deepMerge(base, local)
}
