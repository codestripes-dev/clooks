import { join } from 'path'
import {
  isEventName as isClaudeCodeEventName,
  NOTIFY_ONLY_EVENTS,
  INJECTABLE_EVENTS,
} from '../../config/constants.js'
import { cloneDeep } from 'lodash-es'
import { legacyResultPolicy } from '../../engine/result-policy.js'
import { translateResult as translateClaudeCodeResult } from '../../engine/translate.js'
import { normalizeKeys } from '../../normalize.js'
import type { ClaudeCodeOutput } from '../../types/claude-code.js'
import type { EventName } from '../../types/branded.js'
import type { AgentAdapter, TranslatedAgentOutput, TranslateFinalOutputInput } from '../types.js'
import { EXIT_OK, EXIT_STDERR } from '../../engine/types.js'
import { discoverPluginPacks as defaultDiscoverPluginPacks } from '../../plugin-discovery.js'
import { vendorAndRegisterPack as defaultVendorAndRegisterPack } from '../../plugin-vendor.js'
import {
  defaultSettingsPaths,
  detectStaleAdvisories,
  readEnabledPlugins,
  readInstalledPlugins,
  readVendoredPluginEntries,
} from '../../claude-settings.js'
import type { StaleAdvisory } from '../../claude-settings.js'

export const claudeCodePluginDeps = {
  discoverPluginPacks: defaultDiscoverPluginPacks,
  vendorAndRegisterPack: defaultVendorAndRegisterPack,
}

/**
 * Render advisories as user-facing `systemMessage` lines.
 *
 * Stale-registration advisories that share the same (scope, pluginKey) are
 * coalesced into a single message so a project that registers N hooks from
 * one un-enabled plugin produces one warning, not N.
 */
function formatAdvisories(
  advisories: StaleAdvisory[],
  roots: { homeRoot: string; projectRoot: string },
): string[] {
  const scopeYmlPath = (scope: StaleAdvisory['scope']): string =>
    scope === 'user'
      ? join(roots.homeRoot, '.clooks/clooks.yml')
      : scope === 'project'
        ? join(roots.projectRoot, '.clooks/clooks.yml')
        : join(roots.projectRoot, '.clooks/clooks.local.yml')
  const localOverridePath = join(roots.projectRoot, '.clooks/clooks.local.yml')

  const groups = new Map<string, StaleAdvisory[]>()
  const passthrough: StaleAdvisory[] = []
  for (const a of advisories) {
    if (a.kind === 'stale-registration') {
      const key = `${a.scope}::${a.pluginKey}`
      const arr = groups.get(key)
      if (arr) arr.push(a)
      else groups.set(key, [a])
    } else {
      passthrough.push(a)
    }
  }

  const out: string[] = []

  for (const group of groups.values()) {
    const first = group[0]!
    const ymlPath = scopeYmlPath(first.scope)
    const hooks = group.map((a) => a.hookName!).filter(Boolean)
    if (hooks.length === 1) {
      const name = hooks[0]!
      out.push(
        `clooks: hook "${name}" (from plugin ${first.pluginKey}) is registered in ${ymlPath} ` +
          `but the plugin is not enabled at ${first.scope} scope in Claude settings. ` +
          `To stop this hook from running in the current project, add to ${localOverridePath}:\n` +
          `  ${name}:\n    enabled: false\n` +
          `To remove it entirely, delete the ${name} entry from ${ymlPath}.`,
      )
      continue
    }
    out.push(
      `clooks: ${hooks.length} hooks from plugin ${first.pluginKey} are registered in ${ymlPath} ` +
        `but the plugin is not enabled at ${first.scope} scope in Claude settings.\n` +
        `  Hooks: ${hooks.join(', ')}\n` +
        `  Fix: enable ${first.pluginKey} at ${first.scope} scope (Claude /plugin), ` +
        `or remove these entries from ${ymlPath}.\n` +
        `  To silence individually, add \`<hook>: { enabled: false }\` in ${localOverridePath}.`,
    )
  }

  for (const a of passthrough) {
    out.push(
      `clooks: plugin ${a.pluginKey} is enabled at ${a.scope} scope in Claude settings ` +
        `but no install record exists on disk. ` +
        `Run /plugin install ${a.pluginKey} to install it, ` +
        `or remove the ${a.pluginKey} entry from ${a.scope} Claude settings.`,
    )
  }

  return out
}

function routeClaudeCodeSystemMessage(eventName: EventName) {
  return NOTIFY_ONLY_EVENTS.has(eventName) ? 'stderr' : 'stdout-json'
}

function translateFinalClaudeCodeOutput(input: TranslateFinalOutputInput): TranslatedAgentOutput {
  const translated = input.result
    ? translateClaudeCodeResult(input.eventName, input.result)
    : ({ exitCode: EXIT_OK } satisfies TranslatedAgentOutput)
  const systemMessages = [...input.systemMessages, ...input.diagnostics]

  if (systemMessages.length === 0) {
    return translated
  }

  if (routeClaudeCodeSystemMessage(input.eventName) === 'stderr') {
    const stderrMessages = systemMessages.map((message) => `clooks: ${message}`).join('\n')
    translated.stderr = translated.stderr
      ? `${translated.stderr}\n${stderrMessages}`
      : stderrMessages
    return translated
  }

  const systemMessage = systemMessages.join('\n')
  if (translated.output) {
    const parsed = JSON.parse(translated.output) as ClaudeCodeOutput
    parsed.systemMessage = systemMessage
    translated.output = JSON.stringify(parsed)
    return translated
  }

  translated.output = JSON.stringify({ systemMessage } as ClaudeCodeOutput)
  return translated
}

export const claudeCodeAdapter: AgentAdapter = {
  id: 'claude-code',
  supportsRuntime: true,
  supportsClaudePluginAdvisories: true,

  readEventName(payload) {
    const rawEventName = payload.hook_event_name
    if (typeof rawEventName !== 'string' || !isClaudeCodeEventName(rawEventName)) {
      return null
    }
    return rawEventName
  },

  async prepareConfigAfterLoad(input) {
    let config = input.config
    let shadows = input.shadows
    const systemMessages: string[] = []

    if (!input.discoverPluginPacks || !input.vendorAndRegisterPack) {
      return { config, shadows, systemMessages }
    }

    const packs = input.discoverPluginPacks({
      homeRoot: input.homeRoot,
      projectRoot: input.projectRoot,
    })
    if (packs.length === 0) {
      return { config, shadows, systemMessages }
    }

    let needsReload = false
    for (const pack of packs) {
      const vendorResult = await input.vendorAndRegisterPack(
        pack,
        input.projectRoot,
        input.homeRoot,
      )

      if (vendorResult.registered.length > 0) {
        needsReload = true
        const enabledHooks = vendorResult.registered.filter(
          (h) => !vendorResult.disabledHooks.includes(h),
        )
        const disabledHooks = vendorResult.disabledHooks
        let msg = `clooks: Registered ${vendorResult.registered.length} hook(s) from ${pack.manifest.name} (plugin)`
        if (disabledHooks.length > 0 && enabledHooks.length > 0) {
          msg += `: ${enabledHooks.join(', ')} (enabled); ${disabledHooks.join(', ')} (disabled -- enable in clooks.yml)`
        } else if (disabledHooks.length > 0) {
          msg += `: ${disabledHooks.join(', ')} (disabled -- enable in clooks.yml)`
        }
        systemMessages.push(msg)
      }

      for (const collision of vendorResult.collisions) {
        systemMessages.push(`clooks: ${collision}`)
      }

      for (const error of vendorResult.errors) {
        systemMessages.push(`clooks: ${error}`)
      }
    }

    if (needsReload) {
      try {
        const reloaded = await input.loadConfig(input.projectRoot, { homeRoot: input.homeRoot })
        if (reloaded !== null) {
          config = reloaded.config
          shadows = reloaded.shadows
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        systemMessages.push(`clooks: Config reload after plugin registration failed: ${msg}`)
      }
    }

    return { config, shadows, systemMessages }
  },

  collectSessionStartAdvisories(input) {
    const settingsPaths = defaultSettingsPaths(input.homeRoot, input.projectRoot)
    const installedPluginsPath = join(
      input.homeRoot,
      '.claude',
      'plugins',
      'installed_plugins.json',
    )
    const installedPluginsFile = readInstalledPlugins(installedPluginsPath)
    const layers = readEnabledPlugins(settingsPaths)
    const advisories = detectStaleAdvisories({
      installedPluginsFile,
      layers,
      clooksYmlReaders: {
        user: () => readVendoredPluginEntries(join(input.homeRoot, '.clooks', 'clooks.yml')),
        project: () => readVendoredPluginEntries(join(input.projectRoot, '.clooks', 'clooks.yml')),
        local: () =>
          readVendoredPluginEntries(join(input.projectRoot, '.clooks', 'clooks.local.yml')),
      },
    })
    return formatAdvisories(advisories, {
      homeRoot: input.homeRoot,
      projectRoot: input.projectRoot,
    })
  },

  normalizeInvocation(payload, eventName) {
    const normalized = normalizeKeys(payload)
    normalized.event = normalized.hookEventName
    delete normalized.hookEventName
    if (eventName === 'PermissionDenied') {
      normalized.denialReason = normalized.reason
      delete normalized.reason
    }
    return {
      eventName,
      context: normalized,
      private: {
        provider: 'claude-code',
        raw: cloneDeep(payload),
        sessionId: typeof payload.session_id === 'string' ? payload.session_id : null,
        nativeTurnId: null,
        referencedAgentId: typeof payload.agent_id === 'string' ? payload.agent_id : null,
        tool: null,
      },
    }
  },

  discoveryEnvironment(env) {
    return env
  },

  createResultPolicy() {
    return legacyResultPolicy
  },

  composeDiagnostics(input) {
    let result = input.result
    const stderr: string[] = []
    const append = (text: string) => {
      if (result === undefined) result = { result: 'allow', injectContext: text }
      else
        result = {
          ...result,
          injectContext:
            (typeof result.injectContext === 'string' ? result.injectContext + '\n' : '') + text,
        }
    }
    if (input.traceMessages.length > 0 && INJECTABLE_EVENTS.has(input.eventName)) {
      append(input.traceMessages.join('\n'))
    }
    if (input.degradedMessages.length > 0) {
      if (INJECTABLE_EVENTS.has(input.eventName)) append(input.degradedMessages.join('\n'))
      else for (const message of input.degradedMessages) stderr.push(`clooks: warning: ${message}`)
    }
    for (const line of input.debugMessages) stderr.push(`[clooks:debug] ${line}`)
    if (input.debugMessages.length > 0 && INJECTABLE_EVENTS.has(input.eventName))
      append(input.debugMessages.map((line) => `[clooks:debug] ${line}`).join('\n'))
    return { result, stderr, systemMessages: [] }
  },

  translateFailure({ failure }) {
    return { exitCode: EXIT_STDERR, stderr: failure.message }
  },

  adjustResultBeforeFinalOutput(input) {
    if (
      input.eventName !== 'ConfigChange' ||
      input.result?.result !== 'block' ||
      (input.context.source as string | undefined) !== 'policy_settings'
    ) {
      return { result: input.result, systemMessages: [] }
    }

    const blockReason = input.result.reason ?? 'clooks: hook attempted to block policy_settings'
    return {
      result: { result: 'skip' },
      systemMessages: [
        `Clooks downgraded a ConfigChange hook's block to skip for source: "policy_settings" (reason: "${blockReason}"). ` +
          `Upstream Claude Code silently ignores blocks on policy_settings (enterprise policy always applies).`,
      ],
    }
  },

  translateFinalOutput(input) {
    if (input.policyFailure)
      return this.translateFailure({
        eventName: input.eventName,
        invocation: input.invocation,
        failure: input.policyFailure,
      })
    return translateFinalClaudeCodeOutput(input)
  },

  routeSystemMessage(eventName) {
    return routeClaudeCodeSystemMessage(eventName)
  },
}
