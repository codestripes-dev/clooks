import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'fs'
import { join, extname, dirname } from 'path'
import { validateHookExport } from './loader.js'
import type { DiscoveredPack } from './plugin-discovery.js'

export interface VendorResult {
  registered: string[]
  skipped: string[]
  collisions: string[]
  errors: string[]
}

const SAFE_NAME_PATTERN = /^[a-z][a-z0-9._-]*$/

export async function vendorAndRegisterPack(
  pack: DiscoveredPack,
  projectRoot: string,
  homeRoot: string,
  existingHookNames: Set<string>,
): Promise<VendorResult> {
  const result: VendorResult = {
    registered: [],
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

  // Phase 1: Check collisions, then vendor (copy) hook files
  const vendored: { hookName: string; usesPath: string }[] = []
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

    vendored.push({ hookName, usesPath: vendorRelPath })
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

  for (const { hookName, usesPath } of vendored) {
    configContent += `\n${hookName}:\n  uses: ${usesPath}\n`
    result.registered.push(hookName)
  }

  // Write config file once with all accumulated entries
  writeFileSync(configPath, configContent)

  return result
}
