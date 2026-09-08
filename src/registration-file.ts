import * as fs from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

export type RegistrationFileOps = Pick<
  typeof fs,
  | 'lstatSync'
  | 'openSync'
  | 'writeFileSync'
  | 'fchmodSync'
  | 'closeSync'
  | 'renameSync'
  | 'unlinkSync'
>

function regularFile(path: string, ops: Pick<RegistrationFileOps, 'lstatSync'>) {
  let stat
  try {
    stat = ops.lstatSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  if (!stat.isFile()) {
    throw new Error(
      `\`${path}\` must be a regular file, not a symlink or other file type. Repair the path, then retry.`,
    )
  }
  return stat
}

/** Publish complete bytes; cleanup is limited to the temporary file we created. */
export function writeRegistrationFileAtomic(
  path: string,
  contents: string,
  ops: RegistrationFileOps = fs,
): void {
  const previous = regularFile(path, ops)
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`)
  let descriptor: number | undefined
  let owned = false
  try {
    descriptor = ops.openSync(temporary, 'wx', previous ? previous.mode & 0o777 : 0o666)
    owned = true
    ops.writeFileSync(descriptor, contents)
    if (previous) ops.fchmodSync(descriptor, previous.mode & 0o7777)
    ops.closeSync(descriptor)
    descriptor = undefined
    regularFile(path, ops)
    ops.renameSync(temporary, path)
    owned = false
  } finally {
    if (descriptor !== undefined) {
      try {
        ops.closeSync(descriptor)
      } catch {
        /* Preserve the original write error. */
      }
    }
    if (owned) {
      try {
        ops.unlinkSync(temporary)
      } catch {
        /* Cleanup must not hide the original error. */
      }
    }
  }
}

export interface RegistrationGroup extends Record<string, unknown> {
  hooks: Record<string, unknown>[]
}

export function isRegistrationObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function validateRegistrationGroups(
  value: unknown,
  path: string,
  field: string,
): RegistrationGroup[] {
  const invalid = (name: string): never => {
    throw new Error(`\`${path}\` contains invalid ${name}. Repair the file, then retry.`)
  }
  if (!Array.isArray(value)) invalid(field)
  for (const [index, group] of (value as unknown[]).entries()) {
    const location = `${field}[${index}]`
    if (!isRegistrationObject(group)) return invalid(location)
    if (!Array.isArray(group.hooks)) return invalid(`${location}.hooks`)
    for (const [hookIndex, hook] of (group.hooks as unknown[]).entries()) {
      if (!isRegistrationObject(hook)) invalid(`${location}.hooks[${hookIndex}]`)
    }
  }
  return value as RegistrationGroup[]
}

/** Unknown events stay opaque during mutation; inspection validates every event. */
export function readRegistrationFile(
  path: string,
  events?: readonly string[],
): {
  settings: Record<string, unknown>
  hooks: Record<string, unknown>
  fileExisted: boolean
} {
  const stat = regularFile(path, fs)
  const text = stat ? fs.readFileSync(path, 'utf8') : ''
  let settings: unknown = {}
  if (text.trim()) {
    try {
      settings = JSON.parse(text)
    } catch (cause) {
      throw new Error(`\`${path}\` contains invalid JSON. Repair the file, then retry.`, { cause })
    }
  }
  if (!isRegistrationObject(settings)) {
    throw new Error(
      `\`${path}\` contains invalid root; expected an object. Repair the file, then retry.`,
    )
  }
  if (Object.hasOwn(settings, 'hooks') && !isRegistrationObject(settings.hooks)) {
    throw new Error(
      `\`${path}\` contains invalid hooks; expected an object. Repair the file, then retry.`,
    )
  }
  const hooks = (settings.hooks ?? {}) as Record<string, unknown>
  for (const event of events ?? Object.keys(hooks)) {
    if (Object.hasOwn(hooks, event))
      validateRegistrationGroups(hooks[event], path, `hooks.${event}`)
  }
  return { settings, hooks, fileExisted: stat !== undefined }
}
