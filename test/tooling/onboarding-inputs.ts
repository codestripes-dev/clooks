import { createHash } from 'node:crypto'
import {
  chmodSync,
  constants,
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from 'node:fs'
import { join, resolve, sep } from 'node:path'

interface InputEntry {
  path: string
  kind: 'directory' | 'file'
  mode: number
  sha256?: string
}

export interface OnboardingInputs {
  entries: InputEntry[]
  sha256: string
}

function inspect(root: string): OnboardingInputs {
  if (!lstatSync(root).isDirectory())
    throw new Error('Onboarding source must be a regular directory')
  const entries: InputEntry[] = []
  function visit(path: string, kind: InputEntry['kind'], recursive = false) {
    const full = join(root, path)
    const stat = lstatSync(full)
    if (kind === 'directory' ? !stat.isDirectory() : !stat.isFile()) {
      throw new Error(`Unsupported onboarding input (expected regular ${kind}): ${path}`)
    }
    entries.push({
      path,
      kind,
      mode: stat.mode & 0o777,
      ...(kind === 'file'
        ? { sha256: createHash('sha256').update(readFileSync(full)).digest('hex') }
        : {}),
    })
    if (recursive) {
      for (const name of readdirSync(full).sort()) {
        const child = join(path, name)
        const directory = lstatSync(join(root, child)).isDirectory()
        visit(child, directory ? 'directory' : 'file', directory)
      }
    }
  }
  visit('clooks', 'directory', true)
  visit('.claude-plugin', 'directory')
  visit('.claude-plugin/marketplace.json', 'file')
  visit('.agents', 'directory')
  visit('.agents/plugins', 'directory')
  visit('.agents/plugins/marketplace.json', 'file')
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return { entries, sha256: createHash('sha256').update(JSON.stringify(entries)).digest('hex') }
}

export function verifyOnboardingInputs(root: string, expected: OnboardingInputs): void {
  if (JSON.stringify(inspect(root)) !== JSON.stringify(expected)) {
    throw new Error('Onboarding input bytes or modes changed')
  }
}

export function freezeOnboardingInputs(sourceRoot: string, destination: string): OnboardingInputs {
  if (!sourceRoot.trim())
    throw new Error('CLOOKS_MARKETPLACE_ROOT must be an explicit nonempty path')
  const source = resolve(sourceRoot)
  const target = resolve(destination)
  if (target === source || target.startsWith(source + sep)) {
    throw new Error('Onboarding snapshot must be outside its source')
  }
  const manifest = inspect(source)
  mkdirSync(target, { mode: 0o755 })
  chmodSync(target, 0o755)
  // Create writable directories first; restore their exact permission modes after copying.
  for (const entry of manifest.entries) {
    const full = join(target, entry.path)
    if (entry.kind === 'directory') mkdirSync(full, { mode: 0o755 })
    else {
      copyFileSync(join(source, entry.path), full, constants.COPYFILE_EXCL)
      chmodSync(full, entry.mode)
    }
  }
  for (const entry of [...manifest.entries].reverse()) {
    if (entry.kind === 'directory') chmodSync(join(target, entry.path), entry.mode)
  }
  verifyOnboardingInputs(source, manifest)
  verifyOnboardingInputs(target, manifest)
  return manifest
}
