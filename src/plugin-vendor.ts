import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'fs'
import { join, extname, dirname } from 'path'
import { validateHookExport } from './loader.js'
import { classifyConfigKeys } from './config/classify.js'
import type { DiscoveredPack } from './plugin-discovery.js'

export interface VendorResult {
  registered: string[]
  disabledHooks: string[]
  skipped: string[]
  collisions: string[]
  errors: string[]
}

const SAFE_NAME_PATTERN = /^[a-z][a-z0-9._-]*$/

/**
 * Reads the hook names registered in a single scope's yml. Returns an empty
 * set if the file doesn't exist or cannot be parsed.
 *
 * Scope-local: this intentionally does NOT look at the merged three-layer
 * config. Cross-scope same-name hooks are shadows (handled by the merge
 * machinery), not collisions.
 */
function readScopeHookNames(configPath: string): Set<string> {
  if (!existsSync(configPath)) return new Set()
  let raw: unknown
  try {
    const text = readFileSync(configPath, 'utf-8')
    raw = Bun.YAML.parse(text)
  } catch {
    // Malformed yml — fall back to empty set. The engine's config loader
    // surfaces parse errors through its own circuit-breaker path; we don't
    // want to double-report here.
    return new Set()
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return new Set()
  const { hooks } = classifyConfigKeys(raw as Record<string, unknown>)
  return new Set(Object.keys(hooks))
}

export async function vendorAndRegisterPack(
  pack: DiscoveredPack,
  projectRoot: string,
  homeRoot: string,
): Promise<VendorResult> {
  const result: VendorResult = {
    registered: [],
    disabledHooks: [],
    skipped: [],
    collisions: [],
    errors: [],
  }

  const packName = pack.manifest.name

  // Guard against path traversal via malicious pack names
  if (!SAFE_NAME_PATTERN.test(packName)) {
    result.errors.push(`pack name "${packName}" contains unsafe characters`)
    return result
  }

  // Determine scope root and config path based on scope
  let scopeRoot: string
  let configPath: string

  switch (pack.scope) {
    case 'user':
      scopeRoot = homeRoot
      configPath = join(homeRoot, '.clooks', 'clooks.yml')
      break
    case 'project':
      scopeRoot = projectRoot
      configPath = join(projectRoot, '.clooks', 'clooks.yml')
      break
    case 'local':
      scopeRoot = projectRoot
      configPath = join(projectRoot, '.clooks', 'clooks.local.yml')
      break
  }

  // Build scope-local collision set from the target yml. Collisions only apply
  // within a single scope — cross-scope same-name is a shadow handled by the
  // three-layer merge.
  const existingHookNames = readScopeHookNames(configPath)

  // Phase 1: Check collisions, then vendor (copy) hook files
  const vendored: { hookName: string; usesPath: string; autoEnable?: boolean }[] = []
  const registeredInBatch = new Set<string>()

  for (const [hookName, hookDef] of Object.entries(pack.manifest.hooks)) {
    const ext = extname(hookDef.path)
    const vendorRelPath = `./.clooks/vendor/plugin/${packName}/${hookName}${ext}`
    const vendorAbsPath = join(
      scopeRoot,
      '.clooks',
      'vendor',
      'plugin',
      packName,
      `${hookName}${ext}`,
    )
    const sourcePath = join(pack.installPath, hookDef.path)

    // Check if already vendored (idempotent skip)
    if (existsSync(vendorAbsPath)) {
      result.skipped.push(hookName)
      continue
    }

    // Check collision BEFORE copying to avoid stuck limbo state
    if (existingHookNames.has(hookName) || registeredInBatch.has(hookName)) {
      result.collisions.push(`${hookName}: conflicts with existing hook (from plugin ${packName})`)
      continue
    }

    // Copy source file to vendor path
    try {
      mkdirSync(dirname(vendorAbsPath), { recursive: true })
      copyFileSync(sourcePath, vendorAbsPath)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      result.errors.push(`${hookName}: copy failed — ${msg}`)
      continue
    }

    // Validate via dynamic import + shape check
    try {
      const mod = (await import(vendorAbsPath)) as Record<string, unknown>
      validateHookExport(mod, vendorAbsPath)
    } catch (err) {
      // Validation failed — delete vendored file and record error
      try {
        unlinkSync(vendorAbsPath)
      } catch {
        // Ignore cleanup errors
      }
      const msg = err instanceof Error ? err.message : String(err)
      result.errors.push(`${hookName}: validation failed — ${msg}`)
      continue
    }

    vendored.push({ hookName, usesPath: vendorRelPath, autoEnable: hookDef.autoEnable })
    registeredInBatch.add(hookName)
  }

  // Phase 2: Register vendored hooks in config file
  if (vendored.length === 0) {
    return result
  }

  // Ensure config file exists
  if (!existsSync(configPath)) {
    mkdirSync(dirname(configPath), { recursive: true })
    writeFileSync(configPath, 'version: "1.0.0"\n')
  }

  let configContent = readFileSync(configPath, 'utf-8')

  for (const { hookName, usesPath, autoEnable } of vendored) {
    if (autoEnable === false) {
      configContent += `\n${hookName}:\n  uses: ${usesPath}\n  enabled: false\n`
    } else {
      configContent += `\n${hookName}:\n  uses: ${usesPath}\n`
    }
    result.registered.push(hookName)
    if (autoEnable === false) {
      result.disabledHooks.push(hookName)
    }
  }

  // Write config file once with all accumulated entries
  writeFileSync(configPath, configContent)

  return result
}
