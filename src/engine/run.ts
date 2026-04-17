import { homedir } from 'os'
import { join } from 'path'
import type { EventName, HookName } from '../types/branded.js'
import type { ClaudeCodeOutput } from '../types/claude-code.js'
import { normalizeKeys } from '../normalize.js'
import { loadConfig } from '../config/index.js'
import type { LoadConfigResult } from '../config/index.js'
import { loadAllHooks } from '../loader.js'
import { INJECTABLE_EVENTS, isEventName } from '../config/constants.js'
import { DEFAULT_MAX_FAILURES } from '../config/constants.js'
import {
  getFailurePath,
  readFailures,
  writeFailures,
  recordFailure,
  clearFailure,
  getFailureCount,
  LOAD_ERROR_EVENT,
} from '../failures.js'
import { discoverPluginPacks as defaultDiscoverPluginPacks } from '../plugin-discovery.js'
import { vendorAndRegisterPack as defaultVendorAndRegisterPack } from '../plugin-vendor.js'
import {
  defaultSettingsPaths,
  detectStaleAdvisories,
  readEnabledPlugins,
  readInstalledPlugins,
  readVendoredPluginEntries,
} from '../claude-settings.js'
import type { StaleAdvisory } from '../claude-settings.js'
import type { RunEngineDeps } from './types.js'
import { EXIT_OK, EXIT_STDERR } from './types.js'
import { matchHooksForEvent, buildShadowWarnings } from './match.js'
import { executeHooks } from './execute.js'
import { translateResult } from './translate.js'

/**
 * Sentinel keys for config-error circuit breaker.
 * Config errors have no hook identity, so we use synthetic keys
 * in the same FailureState structure that hook failures use.
 */
const CONFIG_ERROR_HOOK = '__config__' as HookName
const CONFIG_ERROR_EVENT = '__parse__' as EventName

/**
 * Render a StaleAdvisory as a user-facing `systemMessage` line.
 * Paths are taken from the live homeRoot / projectRoot so a user with
 * CLOOKS_HOME_ROOT overridden sees the correct paths.
 */
function formatAdvisory(
  a: StaleAdvisory,
  roots: { homeRoot: string; projectRoot: string },
): string {
  const scopeYmlPath =
    a.scope === 'user'
      ? join(roots.homeRoot, '.clooks/clooks.yml')
      : a.scope === 'project'
        ? join(roots.projectRoot, '.clooks/clooks.yml')
        : join(roots.projectRoot, '.clooks/clooks.local.yml')
  const localOverridePath = join(roots.projectRoot, '.clooks/clooks.local.yml')
  if (a.kind === 'stale-registration') {
    return (
      `clooks: hook "${a.hookName}" (from plugin ${a.pluginKey}) is registered in ${scopeYmlPath} ` +
      `but the plugin is not enabled at ${a.scope} scope in Claude settings. ` +
      `To stop this hook from running in the current project, add to ${localOverridePath}:\n` +
      `  ${a.hookName}:\n    enabled: false\n` +
      `To remove it entirely, delete the ${a.hookName} entry from ${scopeYmlPath}.`
    )
  }
  return (
    `clooks: plugin ${a.pluginKey} is enabled at ${a.scope} scope in Claude settings ` +
    `but no install record exists on disk. ` +
    `Run /plugin install ${a.pluginKey} to install it, ` +
    `or remove the ${a.pluginKey} entry from ${a.scope} Claude settings.`
  )
}

export const defaultDeps: RunEngineDeps = {
  loadConfig,
  loadAllHooks,
  readStdin: () => Bun.stdin.json(),
  discoverPluginPacks: defaultDiscoverPluginPacks,
  vendorAndRegisterPack: defaultVendorAndRegisterPack,
}

/**
 * Main engine entry point. Reads stdin, loads hooks from config, runs matching
 * hooks, and writes output. Called by src/cli.ts when no CLI flags are present.
 */
export async function runEngine(deps: RunEngineDeps = defaultDeps): Promise<void> {
  try {
    const projectRoot = process.cwd()
    const homeRoot = process.env.CLOOKS_HOME_ROOT ?? homedir()

    // --- Load config (optional — no config = no hooks) ---
    // Config errors use a circuit breaker: block the first N invocations so
    // the agent sees the error, then degrade to warn-only to prevent deadlock.
    // Config errors are stored in the project's .clooks/.failures (if .clooks/ exists)
    // or in the home failures directory. Since a config error means .clooks/clooks.yml
    // exists but is invalid, .clooks/ is guaranteed to exist.
    const configFailurePath = join(projectRoot, '.clooks/.failures')
    let result: LoadConfigResult | null
    try {
      result = await deps.loadConfig(projectRoot, { homeRoot })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      let state = await readFailures(configFailurePath)
      state = recordFailure(state, CONFIG_ERROR_HOOK, CONFIG_ERROR_EVENT, message)
      await writeFailures(configFailurePath, state)
      const failCount = getFailureCount(state, CONFIG_ERROR_HOOK, CONFIG_ERROR_EVENT)

      if (failCount < DEFAULT_MAX_FAILURES) {
        // Under threshold — block so the agent sees the error
        process.stderr.write(`clooks: ${message}\n`)
        process.exit(EXIT_STDERR)
      }

      // Over threshold — degrade to warn-only to break deadlock
      process.stderr.write(
        `clooks: config error (degraded after ${failCount} consecutive failures): ${message}\n`,
      )
      const output: ClaudeCodeOutput = {
        systemMessage:
          `[clooks] Config validation failed ${failCount} consecutive times. ` +
          `Hooks are disabled to prevent deadlock. Fix .clooks/clooks.yml: ${message}`,
      }
      process.stdout.write(JSON.stringify(output) + '\n')
      process.exit(EXIT_OK)
    }

    if (result === null) {
      process.exit(EXIT_OK)
    }

    // Config loaded successfully — clear any config-error circuit breaker state
    const configState = await readFailures(configFailurePath)
    if (getFailureCount(configState, CONFIG_ERROR_HOOK, CONFIG_ERROR_EVENT) > 0) {
      const cleared = clearFailure(configState, CONFIG_ERROR_HOOK, CONFIG_ERROR_EVENT)
      await writeFailures(configFailurePath, cleared)
    }

    let config = result!.config
    let shadows = result!.shadows
    const hasProjectConfig = result!.hasProjectConfig

    // --- Compute failure path once ---
    const failurePath = getFailurePath(projectRoot, homeRoot, hasProjectConfig)

    // --- Discover and vendor plugin hooks ---
    const pluginSystemMessages: string[] = []
    const danglingWarnings: string[] = []
    if (deps.discoverPluginPacks && deps.vendorAndRegisterPack) {
      const packs = deps.discoverPluginPacks({ homeRoot, projectRoot })
      if (packs.length > 0) {
        let needsReload = false

        for (const pack of packs) {
          // Collision detection is scope-local and performed inside
          // vendorAndRegisterPack by reading the target scope's yml. Each pack
          // freshly observes the target file (which may have been updated by a
          // prior pack in the same batch that wrote to the same scope).
          const vendorResult = await deps.vendorAndRegisterPack(pack, projectRoot, homeRoot)

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
            pluginSystemMessages.push(msg)
          }

          for (const collision of vendorResult.collisions) {
            pluginSystemMessages.push(`clooks: ${collision}`)
          }

          for (const error of vendorResult.errors) {
            pluginSystemMessages.push(`clooks: ${error}`)
          }
        }

        if (needsReload) {
          try {
            const reloaded = await deps.loadConfig(projectRoot, { homeRoot })
            if (reloaded !== null) {
              config = reloaded.config
              shadows = reloaded.shadows
              // hasProjectConfig not updated: plugin registration only appends
              // entries to existing config files, it cannot change whether a
              // project config exists.
            }
          } catch (e) {
            // Config reload failed — continue with original config.
            // The newly registered hooks won't be active until next invocation.
            const msg = e instanceof Error ? e.message : String(e)
            pluginSystemMessages.push(
              `clooks: Config reload after plugin registration failed: ${msg}`,
            )
          }
        }
      }
    }

    // --- Load all hooks (fault-tolerant — load errors go through circuit breaker) ---
    const debug = process.env.CLOOKS_DEBUG === 'true'
    const engineDebugLines: string[] = []
    const {
      loaded: hooks,
      loadErrors,
      dangling = [],
    } = await deps.loadAllHooks(config, projectRoot, homeRoot)

    if (debug) {
      engineDebugLines.push(
        `loaded ${hooks.length} hook(s): ${hooks.map((h) => h.name).join(', ') || '(none)'}`,
      )
      for (const err of loadErrors) {
        engineDebugLines.push(`load error: ${err.name} — ${err.error}`)
      }
      for (const d of dangling) {
        engineDebugLines.push(`dangling: ${d.name} — ${d.resolvedPath}`)
      }
    }

    // --- Build dangling hook warnings ---
    for (const d of dangling) {
      const configFile = d.origin === 'home' ? '~/.clooks/clooks.yml' : '.clooks/clooks.yml'
      danglingWarnings.push(
        `[clooks] Hook "${d.name}" skipped — file not found: ${d.resolvedPath}. ` +
          `Remove from ${configFile} or reinstall. Run \`clooks config --resolved\` for details.`,
      )
    }

    // Clear stale circuit breaker state for dangling hooks (from before this fix)
    if (dangling.length > 0) {
      let failureState = await readFailures(failurePath)
      let cleared = false
      for (const d of dangling) {
        if (getFailureCount(failureState, d.name, LOAD_ERROR_EVENT) > 0) {
          failureState = clearFailure(failureState, d.name, LOAD_ERROR_EVENT)
          cleared = true
        }
      }
      if (cleared) {
        await writeFailures(failurePath, failureState)
      }
    }

    // --- Read and parse stdin ---
    // Parsed here (before the hooks-empty early-exit) so that eventName is
    // available for SessionStart-gated advisory emission below, even in the
    // "no hooks configured at all" case (e.g. pure enable-without-install drift).
    let input: unknown
    try {
      input = await deps.readStdin()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      process.stderr.write(`clooks: failed to parse stdin JSON: ${message}\n`)
      process.exit(EXIT_STDERR)
    }

    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      process.stderr.write('clooks: stdin payload is not a JSON object\n')
      process.exit(EXIT_STDERR)
    }

    const payload = input as Record<string, unknown>
    const rawEventName = payload.hook_event_name

    if (typeof rawEventName !== 'string' || !isEventName(rawEventName)) {
      process.stderr.write('clooks: stdin payload missing or unrecognized hook_event_name field\n')
      process.exit(EXIT_STDERR)
    }
    const eventName: EventName = rawEventName

    // --- SessionStart stale-plugin advisories (M4) ---
    // Detect (a) plugin-vendored hook entries whose plugin key is no longer
    // `true` at that scope in Claude settings (drift A: stale-registration)
    // and (b) plugin keys enabled in Claude settings with no install record
    // (drift B: enable-without-install). Advisories are gated to SessionStart
    // to keep per-tool-call overhead low and visible at session open.
    if (eventName === 'SessionStart' && deps.discoverPluginPacks) {
      const settingsPaths = defaultSettingsPaths(homeRoot, projectRoot)
      const installedPluginsPath = join(homeRoot, '.claude', 'plugins', 'installed_plugins.json')
      const installedPluginsFile = readInstalledPlugins(installedPluginsPath)
      const layers = readEnabledPlugins(settingsPaths)
      const advisories = detectStaleAdvisories({
        installedPluginsFile,
        layers,
        clooksYmlReaders: {
          user: () => readVendoredPluginEntries(join(homeRoot, '.clooks', 'clooks.yml')),
          project: () => readVendoredPluginEntries(join(projectRoot, '.clooks', 'clooks.yml')),
          local: () => readVendoredPluginEntries(join(projectRoot, '.clooks', 'clooks.local.yml')),
        },
      })
      for (const a of advisories) {
        pluginSystemMessages.push(formatAdvisory(a, { homeRoot, projectRoot }))
      }
    }

    if (hooks.length === 0 && loadErrors.length === 0) {
      const earlyMessages = [...pluginSystemMessages, ...danglingWarnings]
      if (earlyMessages.length > 0) {
        const output: ClaudeCodeOutput = { systemMessage: earlyMessages.join('\n') }
        process.stdout.write(JSON.stringify(output) + '\n')
      }
      if (debug) {
        for (const line of engineDebugLines) {
          process.stderr.write(`[clooks:debug] ${line}\n`)
        }
      }
      process.exit(EXIT_OK)
    }

    // --- Match hooks for this event ---
    const { matched, disabledSkips } = matchHooksForEvent(hooks, eventName, config)

    if (debug) {
      for (const skip of disabledSkips) {
        engineDebugLines.push(skip.reason)
      }
      engineDebugLines.push(
        `event="${eventName}" matched ${matched.length} hook(s): ${matched.map((h) => h.name).join(', ') || '(none)'}`,
      )
    }

    // --- Shadow warnings (SessionStart only) ---
    // Computed before the early exit so warnings are emitted even when
    // no hooks match the current event.
    const startupWarnings: string[] = buildShadowWarnings(eventName, shadows)

    // --- Startup validation: warn about disabled hooks in order lists ---
    for (const [eventKey, eventEntry] of Object.entries(config.events)) {
      if (eventEntry?.order) {
        for (const hookName of eventEntry.order) {
          const hookEntry = config.hooks[hookName]
          if (!hookEntry) continue
          if (hookEntry.enabled === false) {
            startupWarnings.push(
              `clooks: event "${eventKey}" order references hook "${hookName}" which is disabled (enabled: false)`,
            )
          } else if (hookEntry.events?.[eventKey as EventName]?.enabled === false) {
            startupWarnings.push(
              `clooks: event "${eventKey}" order references hook "${hookName}" which has enabled: false for ${eventKey}`,
            )
          }
        }
      }
    }

    // --- Startup validation: warn about enabled: false on events the hook doesn't handle ---
    for (const loaded of hooks) {
      const hookEntry = config.hooks[loaded.name]
      if (!hookEntry?.events) continue
      for (const [evKey, evOverride] of Object.entries(hookEntry.events)) {
        if (evOverride?.enabled === false) {
          const handlesEvent =
            typeof (loaded.hook as unknown as Record<string, unknown>)[evKey] === 'function'
          if (!handlesEvent) {
            startupWarnings.push(
              `clooks: hook "${loaded.name}" events.${evKey} has enabled: false, but hook does not handle event "${evKey}"`,
            )
          }
        }
      }
    }

    if (matched.length === 0 && loadErrors.length === 0) {
      const earlyMessages = [...pluginSystemMessages, ...danglingWarnings, ...startupWarnings]
      if (earlyMessages.length > 0) {
        const output: ClaudeCodeOutput = { systemMessage: earlyMessages.join('\n') }
        process.stdout.write(JSON.stringify(output) + '\n')
      }
      if (debug) {
        for (const line of engineDebugLines) {
          process.stderr.write(`[clooks:debug] ${line}\n`)
        }
      }
      process.exit(EXIT_OK)
    }

    // --- Normalize payload ---
    const normalized = normalizeKeys(payload)
    normalized.event = normalized.hookEventName
    delete normalized.hookEventName

    // --- Startup validation: warn about hook-level trace on non-injectable events ---
    for (const loaded of hooks) {
      const hookEntry = config.hooks[loaded.name]
      if (hookEntry?.onError === 'trace' && !INJECTABLE_EVENTS.has(eventName)) {
        const handlesEvent =
          typeof (loaded.hook as unknown as Record<string, unknown>)[eventName] === 'function'
        if (handlesEvent) {
          startupWarnings.push(
            `Hook "${loaded.name}" has onError: "trace" but ${eventName} ` +
              `does not support additionalContext. Trace will fall back to "continue" for ${eventName}.`,
          )
        }
      }
    }

    // --- Execute hooks with circuit breaker ---
    const disabledNames = new Set<HookName>()
    for (const s of disabledSkips) disabledNames.add(s.hook)
    // lastResult is separated from the const destructuring because it's reassigned
    // below when injecting trace/degraded/debug context into additionalContext.
    const {
      lastResult: initialResult,
      degradedMessages,
      debugMessages,
      traceMessages,
      systemMessages,
    } = await executeHooks(
      matched,
      eventName,
      normalized,
      config,
      failurePath,
      loadErrors,
      disabledNames,
    )
    let lastResult = initialResult

    // --- Handle trace messages (from onError: "trace" hooks) ---
    // Injected first so additionalContext order is: trace → degraded → debug
    if (traceMessages.length > 0 && INJECTABLE_EVENTS.has(eventName)) {
      const traceBlock = traceMessages.join('\n')
      if (lastResult === undefined) {
        lastResult = { result: 'allow', injectContext: traceBlock }
      } else {
        const existing =
          typeof lastResult.injectContext === 'string' ? lastResult.injectContext + '\n' : ''
        lastResult.injectContext = existing + traceBlock
      }
    }

    // --- Handle degraded hook messages ---
    if (degradedMessages.length > 0) {
      if (INJECTABLE_EVENTS.has(eventName)) {
        if (lastResult === undefined) {
          lastResult = { result: 'allow', injectContext: degradedMessages.join('\n') }
        } else {
          const existing =
            typeof lastResult.injectContext === 'string' ? lastResult.injectContext + '\n' : ''
          lastResult.injectContext = existing + degradedMessages.join('\n')
        }
      } else {
        for (const msg of degradedMessages) {
          process.stderr.write(`clooks: warning: ${msg}\n`)
        }
      }
    }

    // --- Merge engine-level and hook-level debug lines ---
    if (debug) {
      const allDebug = [...engineDebugLines, ...debugMessages]
      // Always write to stderr for external visibility
      for (const line of allDebug) {
        process.stderr.write(`[clooks:debug] ${line}\n`)
      }

      // Inject into additionalContext so Claude can read it
      if (allDebug.length > 0) {
        const debugBlock = allDebug.map((l) => `[clooks:debug] ${l}`).join('\n')
        if (lastResult === undefined) {
          lastResult = { result: 'allow', injectContext: debugBlock }
        } else {
          const existing =
            typeof lastResult.injectContext === 'string' ? lastResult.injectContext + '\n' : ''
          lastResult.injectContext = existing + debugBlock
        }
      }
    }

    // --- Translate and output ---
    if (lastResult === undefined) {
      // Even with no hook results, we may have system messages to deliver
      const allSystemMessages = [
        ...pluginSystemMessages,
        ...danglingWarnings,
        ...startupWarnings,
        ...systemMessages,
      ]
      if (allSystemMessages.length > 0) {
        const output: ClaudeCodeOutput = { systemMessage: allSystemMessages.join('\n') }
        process.stdout.write(JSON.stringify(output) + '\n')
      }
      process.exit(EXIT_OK)
    }

    const translated = translateResult(eventName, lastResult)

    // --- Inject systemMessage into translated output ---
    const allSystemMessages = [
      ...pluginSystemMessages,
      ...danglingWarnings,
      ...startupWarnings,
      ...systemMessages,
    ]
    if (allSystemMessages.length > 0) {
      const systemMessage = allSystemMessages.join('\n')
      if (translated.output) {
        const parsed = JSON.parse(translated.output) as ClaudeCodeOutput
        parsed.systemMessage = systemMessage
        translated.output = JSON.stringify(parsed)
      } else {
        translated.output = JSON.stringify({ systemMessage } as ClaudeCodeOutput)
      }
    }

    if (translated.stderr) {
      process.stderr.write(`${translated.stderr}\n`)
    }

    if (translated.output) {
      process.stdout.write(translated.output + '\n')
    }

    if (translated.exitCode !== EXIT_OK) {
      process.exit(translated.exitCode)
    }

    process.exitCode = EXIT_OK
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    process.stderr.write(`clooks: fatal error: ${message}\n`)
    process.exit(EXIT_STDERR)
  }
}
