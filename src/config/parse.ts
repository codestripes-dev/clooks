export class ConfigNotFoundError extends Error {
  constructor(filePath: string) {
    super(`clooks: config file not found: ${filePath}`)
    this.name = "ConfigNotFoundError"
  }
}

export async function parseYamlFile(
  filePath: string,
): Promise<Record<string, unknown>> {
  if (!(await Bun.file(filePath).exists())) {
    throw new ConfigNotFoundError(filePath)
  }

  const text = await Bun.file(filePath).text()

  let parsed: unknown
  try {
    parsed = Bun.YAML.parse(text)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    throw new Error(`clooks: invalid YAML in ${filePath}: ${message}`)
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    const type = parsed === null ? "null" : Array.isArray(parsed) ? "array" : typeof parsed
    throw new Error(
      `clooks: config file must contain a YAML mapping, got ${type}`,
    )
  }

  return parsed as Record<string, unknown>
}
