import { isEventName } from './config/constants.js'
import { getRawBaseUrl } from './github-url.js'

const HOOK_NAME_PATTERN = /^[a-z][a-z0-9-]*$/

export interface Manifest {
  version: number
  name: string
  hooks: Record<string, ManifestHook>
  description?: string
  author?: string
  license?: string
  repository?: string
}

export interface ManifestHook {
  path: string
  description: string
  events?: string[]
  tags?: string[]
  configDefaults?: Record<string, unknown>
}

export function validateManifest(raw: unknown): Manifest {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid clooks-pack.json: must be a non-null object')
  }

  const obj = raw as Record<string, unknown>

  // version must be 1 (integer)
  if (!('version' in obj)) {
    throw new Error('Invalid clooks-pack.json: missing required field "version"')
  }
  if (obj.version !== 1 || !Number.isInteger(obj.version)) {
    throw new Error('Invalid clooks-pack.json: "version" must be 1')
  }

  // name must be a non-empty string
  if (!('name' in obj) || typeof obj.name !== 'string' || obj.name.trim() === '') {
    throw new Error('Invalid clooks-pack.json: "name" must be a non-empty string')
  }

  // hooks must be a non-empty object
  if (
    !('hooks' in obj) ||
    obj.hooks === null ||
    typeof obj.hooks !== 'object' ||
    Array.isArray(obj.hooks)
  ) {
    throw new Error('Invalid clooks-pack.json: "hooks" must be a non-empty object')
  }

  const rawHooks = obj.hooks as Record<string, unknown>
  if (Object.keys(rawHooks).length === 0) {
    throw new Error('Invalid clooks-pack.json: "hooks" must be a non-empty object')
  }

  const hooks: Record<string, ManifestHook> = {}

  for (const [hookName, hookValue] of Object.entries(rawHooks)) {
    // Hook name must match pattern
    if (!HOOK_NAME_PATTERN.test(hookName)) {
      throw new Error(
        `Invalid clooks-pack.json: hook "${hookName}" name must match pattern /^[a-z][a-z0-9-]*$/`,
      )
    }

    // Hook name must not be a reserved event name
    if (isEventName(hookName)) {
      throw new Error(
        `Invalid clooks-pack.json: hook "${hookName}" name conflicts with a reserved event name`,
      )
    }

    if (hookValue === null || typeof hookValue !== 'object' || Array.isArray(hookValue)) {
      throw new Error(`Invalid clooks-pack.json: hook "${hookName}" must be an object`)
    }

    const hook = hookValue as Record<string, unknown>

    // path must be a string ending in .ts or .js
    if (typeof hook.path !== 'string' || hook.path === '') {
      throw new Error(`Invalid clooks-pack.json: hook "${hookName}" missing required field "path"`)
    }
    if (!hook.path.endsWith('.ts') && !hook.path.endsWith('.js')) {
      throw new Error(
        `Invalid clooks-pack.json: hook "${hookName}" path must end with ".ts" or ".js"`,
      )
    }

    // description must be a non-empty string
    if (typeof hook.description !== 'string' || hook.description.trim() === '') {
      throw new Error(
        `Invalid clooks-pack.json: hook "${hookName}" missing required field "description"`,
      )
    }

    // events if present must be an array of known event names
    let events: string[] | undefined
    if ('events' in hook) {
      if (!Array.isArray(hook.events)) {
        throw new Error(`Invalid clooks-pack.json: hook "${hookName}" "events" must be an array`)
      }
      for (const ev of hook.events) {
        if (typeof ev !== 'string') {
          throw new Error(
            `Invalid clooks-pack.json: hook "${hookName}" "events" must be an array of strings`,
          )
        }
        if (!isEventName(ev)) {
          throw new Error(`Invalid clooks-pack.json: hook "${hookName}" unknown event "${ev}"`)
        }
      }
      events = hook.events as string[]
    }

    // tags if present must be an array of lowercase strings
    let tags: string[] | undefined
    if ('tags' in hook) {
      if (!Array.isArray(hook.tags)) {
        throw new Error(`Invalid clooks-pack.json: hook "${hookName}" "tags" must be an array`)
      }
      for (const tag of hook.tags) {
        if (typeof tag !== 'string') {
          throw new Error(
            `Invalid clooks-pack.json: hook "${hookName}" "tags" must be an array of strings`,
          )
        }
        if (tag !== tag.toLowerCase()) {
          throw new Error(
            `Invalid clooks-pack.json: hook "${hookName}" tags must be lowercase strings`,
          )
        }
      }
      tags = hook.tags as string[]
    }

    // configDefaults if present must be an object
    let configDefaults: Record<string, unknown> | undefined
    if ('configDefaults' in hook) {
      if (
        hook.configDefaults === null ||
        typeof hook.configDefaults !== 'object' ||
        Array.isArray(hook.configDefaults)
      ) {
        throw new Error(
          `Invalid clooks-pack.json: hook "${hookName}" "configDefaults" must be an object`,
        )
      }
      configDefaults = hook.configDefaults as Record<string, unknown>
    }

    const manifestHook: ManifestHook = {
      path: hook.path,
      description: hook.description,
      ...(events !== undefined ? { events } : {}),
      ...(tags !== undefined ? { tags } : {}),
      ...(configDefaults !== undefined ? { configDefaults } : {}),
    }

    hooks[hookName] = manifestHook
  }

  const manifest: Manifest = {
    version: obj.version as number,
    name: obj.name as string,
    hooks,
    ...(typeof obj.description === 'string' ? { description: obj.description } : {}),
    ...(typeof obj.author === 'string' ? { author: obj.author } : {}),
    ...(typeof obj.license === 'string' ? { license: obj.license } : {}),
    ...(typeof obj.repository === 'string' ? { repository: obj.repository } : {}),
  }

  return manifest
}

export async function fetchManifest(owner: string, repo: string): Promise<Manifest> {
  const url = `${getRawBaseUrl()}/${owner}/${repo}/HEAD/clooks-pack.json`
  const res = await fetch(url)

  if (!res.ok) {
    if (res.status === 404) {
      throw new Error('No clooks-pack.json found — this repository may not be a hook pack.')
    }
    throw new Error(`Failed to fetch manifest: HTTP ${res.status} ${res.statusText}`)
  }

  let parsed: unknown
  try {
    parsed = await res.json()
  } catch {
    throw new Error('Failed to parse clooks-pack.json — invalid JSON.')
  }

  return validateManifest(parsed)
}
