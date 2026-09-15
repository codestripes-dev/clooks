import { lstatSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentId } from './agents/types.js'
import {
  isRegistrationObject,
  prepareRegistrationWrite,
  readRegistrationText,
} from './registration-file.js'
import { editClooksServer, readClooksServer } from './interaction/registration-toml.js'

export function assertClaudeRegistrationLayout(home: string): void {
  if (process.env.CLAUDE_CONFIG_DIR !== undefined) {
    throw new Error(
      'CLAUDE_CONFIG_DIR overrides are not supported for Claude registration; no files were changed.',
    )
  }
  const legacy = join(home, '.claude/.config.json')
  if (lstatSync(legacy, { throwIfNoEntry: false })) {
    throw new Error(
      `Legacy Claude user configuration at \`${legacy}\` is not supported for registration; no files were changed.`,
    )
  }
}

export function mcpRegistrationPath(
  root: string,
  agent: AgentId,
  global: boolean,
  codexHome?: string,
): string {
  return agent === 'codex'
    ? join(codexHome ?? join(root, '.codex'), 'config.toml')
    : join(root, global ? '.claude.json' : '.mcp.json')
}

function ownedServer(value: unknown): value is Record<string, unknown> {
  return (
    isRegistrationObject(value) &&
    value.command === 'clooks' &&
    Array.isArray(value.args) &&
    value.args.length === 1 &&
    value.args[0] === 'mcp' &&
    (value.type === undefined || value.type === 'stdio') &&
    value.url === undefined
  )
}

function readServer(path: string, agent: AgentId) {
  const original = readRegistrationText(path)
  if (agent === 'codex') {
    try {
      return { original, server: readClooksServer(original ?? '') }
    } catch (cause) {
      throw new Error(
        `\`${path}\` contains invalid MCP configuration: ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause },
      )
    }
  }
  let document: unknown
  try {
    document = original?.trim() ? JSON.parse(original) : {}
  } catch (cause) {
    throw new Error(`\`${path}\` contains invalid JSON.`, { cause })
  }
  if (
    !isRegistrationObject(document) ||
    (document.mcpServers !== undefined && !isRegistrationObject(document.mcpServers))
  ) {
    throw new Error(`\`${path}\` must contain an object with an object mcpServers field.`)
  }
  const servers = (document.mcpServers ?? {}) as Record<string, unknown>
  return { original, document, servers, server: servers.clooks }
}

export function hasOwnedMcpServer(path: string, agent: AgentId): boolean {
  return ownedServer(readServer(path, agent).server)
}

/** Preparing never writes: init can validate every selected agent before publishing anything. */
export function prepareMcpRegistration(path: string, agent: AgentId, remove = false) {
  const state = readServer(path, agent)
  if (state.server !== undefined && !ownedServer(state.server)) {
    if (!remove)
      throw new Error(
        `\`${path}\` has a foreign or invalid MCP server named clooks; registration will not overwrite it.`,
      )
    return {
      ...prepareRegistrationWrite(path, state.original, state.original ?? ''),
      owned: false,
      changed: false,
      commit() {},
    }
  }
  const owned = state.server !== undefined
  if (remove && !owned)
    return {
      ...prepareRegistrationWrite(path, state.original, state.original ?? ''),
      owned: false,
      changed: false,
      commit() {},
    }
  let contents: string
  if (agent === 'codex') {
    try {
      contents = editClooksServer(
        state.original ?? '',
        remove
          ? null
          : {
              command: 'clooks',
              args: ['mcp'],
              startup_timeout_sec: 10,
              tool_timeout_sec: 330,
            },
      )
    } catch (cause) {
      throw new Error(
        `\`${path}\` could not update MCP configuration: ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause },
      )
    }
  } else {
    const servers = state.servers!
    if (remove) delete servers.clooks
    else
      servers.clooks = {
        ...(state.server as Record<string, unknown> | undefined),
        command: 'clooks',
        args: ['mcp'],
      }
    state.document!.mcpServers = servers
    if (remove && Object.keys(servers).length === 0) delete state.document!.mcpServers
    const unchanged = !remove && owned && ownedServer(state.server)
    contents = unchanged ? state.original! : JSON.stringify(state.document, null, 2) + '\n'
  }
  return { ...prepareRegistrationWrite(path, state.original, contents), owned }
}
