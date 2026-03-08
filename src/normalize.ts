// Recursively converts snake_case object keys to camelCase.
// Does NOT handle domain-specific renames (e.g., hookEventName → event).

function snakeToCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

export function normalizeKeys(
  obj: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[snakeToCamel(key)] = normalizeValue(value);
  }
  return result;
}

function normalizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (typeof value === "object") {
    return normalizeKeys(value as Record<string, unknown>);
  }
  return value;
}
