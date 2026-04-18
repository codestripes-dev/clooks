# Plugin Vendoring

How Clooks discovers hook packs installed as Claude Code plugins, copies them to local vendor directories, and registers them in `clooks.yml`.

## Overview

Clooks distributes hook packs as Claude Code data-only plugins. When a user installs such a plugin, its files land in the plugin cache at `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`. Clooks discovers these packs, vendors the hook files locally, and auto-registers them — all within a single invocation.

Plugin hooks are NOT executed live from the plugin cache. They are copied to a vendor directory and pinned until the user explicitly updates. This prevents plugin updates from silently changing running code — aligning with clooks' safety-first model.

Real-world examples of data-only hook pack plugins: `clooks-example-hooks` (educational hooks demonstrating lifecycle, config, and events), `clooks-core-hooks` (zero-config production hooks for command safety, git protection, tool hygiene, and tmux notifications), and `clooks-project-hooks` (project-configured hooks for package manager enforcement, protected paths, and project script preference). All three live in the `clooks-marketplace` repo.

## Plugin Cache Discovery

The `discoverPluginPacks()` function in `src/plugin-discovery.ts` drives discovery from **Claude settings layers**, not from the install registry. A plugin is registered at a given clooks scope if and only if the corresponding Claude settings layer declares `enabledPlugins: { <plugin>@<marketplace>: true }`.

### How it works

1. Resolves `installedPluginsPath`, `settingsPaths`, `homeRoot`, and `projectRoot` from `DiscoverOptions` or canonical defaults (see interface below).
2. Reads `~/.claude/plugins/installed_plugins.json` via `readInstalledPlugins()`. Returns `[]` if missing or malformed. The install registry is treated purely as a **scope-agnostic lookup table** — its own `scope` and `projectPath` fields are metadata and do not influence where clooks vendors the hook.
3. Reads each Claude settings layer (`user`, `project`, `local`) independently via `readEnabledPlugins()`. The `managed` layer is read but skipped for registration (see "Managed scope skipped" below).
4. For each scope in `{ user, project, local }`, for each plugin key that layer activates (its own `enabledPlugins[key] === true`):
   - `lookupInstallPath(installedPluginsFile, pluginKey)` — finds the first install entry whose `installPath` exists on disk, has no `.orphaned_at` marker, and whose scope is not `managed`. If nothing valid → skip (M4's stale detector later surfaces this as an `enable-without-install` advisory).
   - Check for `clooks-pack.json` at `installPath`. Missing → silent skip (not every plugin is a hook pack).
   - Validate the manifest via `loadManifestFromFile()`. Invalid manifests log a warning and are skipped — one broken plugin does not prevent others from being discovered.
   - Emit a `DiscoveredPack` tagged with the **Claude settings layer's scope**, not the install record's scope.

### `DiscoverOptions`

```ts
export interface DiscoverOptions {
  installedPluginsPath?: string       // defaults to ~/.claude/plugins/installed_plugins.json
  settingsPaths?: SettingsLayerPaths  // defaults via defaultSettingsPaths(homeRoot, projectRoot)
  homeRoot?: string                   // defaults to os.homedir()
  projectRoot?: string                // defaults to process.cwd()
}

export function discoverPluginPacks(opts?: DiscoverOptions): DiscoveredPack[]
```

Callers that pass no argument get the canonical defaults. The engine passes `{ homeRoot, projectRoot }` through from its own resolution so overrides (e.g., `CLOOKS_HOME_ROOT` in tests) propagate to discovery.

### Managed scope skipped

Clooks has no `managed/.clooks/clooks.yml` layer to register into, and managed Claude settings are set by platform policy (not user-editable), so drift advisories against them would be user-unactionable. Managed is therefore excluded from both registration and drift detection. This matches the prior code's blanket skip of `managed` install entries.

### Manifest loading

`loadManifestFromFile(filePath)` in `src/manifest.ts` is the local-disk counterpart to `fetchManifest(owner, repo)`. It reads a JSON file, parses it, and passes it through the same `validateManifest()` used by `clooks add`. The schema (`clooks-pack.json`) is identical whether the manifest comes from GitHub or the plugin cache.

### Plugin cache structure

The cache lives at `~/.claude/plugins/cache/` with a 3-level hierarchy: `<marketplace>/<plugin>/<version>/`. Version directories may use semver (`1.0.0`) or truncated git SHAs (`a5c3762d7ad8`). Orphaned directories (from plugin updates/uninstalls) contain an `.orphaned_at` marker file with an epoch-millisecond timestamp. See `docs/research/feat-0041/s3-plugin-cache-structure.md` and `docs/research/feat-0041/spike-cache-inspection.md` for full details.

## Plugin Vendoring

The `vendorAndRegisterPack()` function in `src/plugin-vendor.ts` handles both copying hook files from the plugin cache and registering them in the appropriate config file.

### Vendor path convention

```
{scopeRoot}/.clooks/vendor/plugin/{packName}/{hookName}.{ts|js}
```

Examples:
- User-scoped: `~/.clooks/vendor/plugin/security-hooks/secret-scanner.ts`
- Project-scoped: `.clooks/vendor/plugin/security-hooks/secret-scanner.ts`

The `vendor/plugin/` prefix separates plugin-delivered hooks from manually vendored hooks under `vendor/github.com/`.

### Scope-based routing

A `DiscoveredPack`'s `scope` field is the Claude settings layer that declared `enabledPlugins: <key>: true` — **not** the `scope` field inside `installed_plugins.json`. The routing table is unchanged:

| Scope | Vendor root | Config file |
|-------|-------------|-------------|
| `user` | `~/.clooks/` | `~/.clooks/clooks.yml` |
| `project` | `.clooks/` | `.clooks/clooks.yml` |
| `local` | `.clooks/` | `.clooks/clooks.local.yml` |

### Registration format

Plugin hooks are registered with path-like `uses` values (relative to the scope root):

```yaml
secret-scanner:
  uses: ./.clooks/vendor/plugin/security-hooks/secret-scanner.ts
```

This follows the same string-concatenation model as `clooks add`. The config file is auto-created with `version: "1.0.0"` if absent.

When a hook has `autoEnable: false` in the manifest, it is registered with `enabled: false`:

```yaml
enforce-commits:
  uses: ./.clooks/vendor/plugin/security-hooks/enforce-commits.ts
  enabled: false
```

Hooks with `autoEnable: true` or `autoEnable` omitted produce the standard format (no `enabled` field). Explicitly writing `autoEnable: true` is a no-op — it does not produce `enabled: true` in the YAML.

### Algorithm

The function operates in two phases:

1. **Vendor**: For each hook in the manifest: check if already vendored (skip if file exists), check for name collisions against existing config hooks (skip if taken), copy the source file from the plugin cache to the vendor path, validate via `validateHookExport()` (dynamic import + shape check). Validation failures delete the vendored file and record an error.
2. **Register**: Append YAML entries for all successfully vendored hooks. The config file is written once after all entries are accumulated. If a hook has `autoEnable: false` in the manifest, the appended entry includes `enabled: false`. The hook name is also added to `disabledHooks` in the `VendorResult`.

Returns a `VendorResult` with arrays of `registered`, `skipped`, `collisions`, and `errors` for the caller to build systemMessages from.

### Idempotency

If a hook file already exists at the vendor path, it is skipped (added to `skipped`). On typical subsequent runs, all hooks are already vendored and the function returns with zero file writes or config changes.

### Safety

Pack names are validated against `^[a-z][a-z0-9._-]*$` before use in file paths, preventing path traversal via malicious `clooks-pack.json` manifests. Hook names are already constrained by `validateManifest()`.

## Engine Integration (Two-Phase Load)

Plugin discovery runs inside `runEngine()` in `src/engine/run.ts`, inserted between config loading and hook loading. On most invocations, all hooks are already vendored and the step completes with zero writes.

### Flow

1. Load config (existing step — phase 1).
2. Call `discoverPluginPacks()` to find installed hook packs.
3. For each pack, call `vendorAndRegisterPack()`. Track registered hook names across packs for cross-pack collision detection.
4. If any new hooks were registered: re-load config via `loadConfig()` (phase 2). This is the two-phase load — newly registered hooks become active in the same invocation they are discovered.
5. If the reload fails, the engine continues with the original config and emits an error systemMessage. Newly registered hooks activate on the next invocation instead.
6. Load hooks from the (possibly reloaded) config and continue normally.

### SystemMessage Output

The engine builds systemMessage lines from vendor results:
- **Registrations:** `"clooks: Registered N hook(s) from <pack> (plugin)"` — only on first discovery, not on idempotent skips.

When a pack contains disabled hooks (`autoEnable: false`), the message distinguishes enabled and disabled hooks:
- **Mixed pack:** `"clooks: Registered 5 hook(s) from security-hooks (plugin): no-rm-rf, no-secrets (enabled); enforce-commits (disabled -- enable in clooks.yml)"`
- **All disabled:** `"clooks: Registered 2 hook(s) from style-hooks (plugin): lint-check, format-check (disabled -- enable in clooks.yml)"`
- **Collisions:** Passed through from `vendorAndRegisterPack()` with `clooks:` prefix.
- **Errors:** Passed through from `vendorAndRegisterPack()` with `clooks:` prefix.

These messages are merged into the existing `allSystemMessages` array alongside startup warnings and hook-level system messages.

### Performance

The discovery step adds ~5ms per invocation when `installed_plugins.json` exists (filesystem scan + manifest read). When the file is absent (no plugins installed), the cost is a single `existsSync` check (<1ms). The config reload on first discovery adds ~1ms (config parsing is ~0.17ms per layer).

### Dependency Injection

`discoverPluginPacks` and `vendorAndRegisterPack` are optional fields on `RunEngineDeps` (in `src/engine/types.ts`). This enables unit testing via mocks without `mock.module()`, matching the existing DI pattern used for `loadConfig` and `loadAllHooks`.

## Stale Entry Detection

`detectStaleAdvisories()` in `src/claude-settings.ts` surfaces two kinds of drift between Claude settings and clooks vendored state. The engine calls it from `src/engine/run.ts` on `SessionStart` events only and pushes the formatted results into `pluginSystemMessages`.

- **`stale-registration`** — a plugin-vendored hook entry exists in `<scope>/clooks.yml` (entry whose `uses` path starts with `./.clooks/vendor/plugin/<pack>/`), but the corresponding plugin key is NOT `true` at that scope in Claude settings. Happens when the user runs `/plugin disable <key>` (or `/plugin uninstall`) without cleaning up the already-registered clooks entries.
- **`enable-without-install`** — a plugin key is `true` at some Claude settings layer, at least one of its install entries has a reachable `clooks-pack.json` (so clooks can confirm it is — or was — a clooks pack), but every install entry is rejected by `lookupInstallPath` (orphaned, `managed`, etc.). Plugins that fail the `clooks-pack.json` check (non-clooks Claude plugins, or clooks plugins whose `installPath` is stale on disk) are suppressed to avoid noise from unrelated marketplace plugins; drift A still surfaces any vendored entries left behind in `clooks.yml`.

Clooks **never mutates `clooks.yml`** on the user's behalf. Advisories are informational `systemMessage` lines telling the user the exact next step (e.g., the exact `.clooks/clooks.local.yml` snippet to shadow the entry, or the `/plugin install` command to re-install).

### SessionStart gating

The detector runs on `SessionStart` only. The per-invocation cost (two to four settings file reads + one `clooks.yml` scan) is acceptable once per session but noisy if added to every tool call. Non-SessionStart events skip the detector entirely.

### Silencing

Set `CLOOKS_SILENCE_STALE_PLUGIN_ADVISORIES=true` in the environment to suppress both advisory kinds. This is an env-var escape hatch, not a config-file setting — matching the project's preference for env-based gates (cf. `CLOOKS_DEBUG`).

## Claude settings.local.json merge bypass

Clooks reads each Claude settings layer independently (per-layer independence — see the routing section above), which deliberately bypasses Claude Code's known `enabledPlugins` merge bug in issues [#25086](https://github.com/anthropics/claude-code/issues/25086) and [#27247](https://github.com/anthropics/claude-code/issues/27247). That bug silently drops `enabledPlugins` values inside `.claude/settings.local.json` when the key is absent in the sibling `.claude/settings.json`. Clooks honors the `settings.local.json` entry regardless.

**Tradeoff (pre-launch, acknowledged):** clooks' self-consistent behavior can diverge from a Claude Code session that is subject to the merge bug — a plugin can appear disabled in CC's own UI while still being active in clooks. If a user is debugging "Claude says this plugin is off but clooks keeps running it," this bypass is the explanation. The workaround on the Claude Code side is to seed `settings.json` with `"enabledPlugins": {}` so the merge finds the key.

## Layer independence and the co-enable case

When the same plugin is enabled at two Claude settings scopes simultaneously (e.g., user **and** project), `discoverPluginPacks()` emits **two** `DiscoveredPack` entries — one per layer. The vendor step then copies the hook files to **both** scope roots (`~/.clooks/vendor/plugin/<pack>/` and `.clooks/vendor/plugin/<pack>/`) and appends entries to **both** `clooks.yml` files. Both writes are visible in `git diff`. This is deliberate parallel vendoring, not a bug.

At runtime, clooks' three-layer config merge (user/project/local, narrowest-wins) dedupes the two entries by hook name — the narrower layer's entry shadows the wider one — so the hook fires exactly once per event.

A project-scope `enabledPlugins: { X: false }` does **not** unregister a user-scope enablement of X. Each layer is independent. To stop an already-registered plugin hook from running in one project, shadow it via `.clooks/clooks.local.yml` (see the README's "Disabling a plugin hook" section).

## See also

- `docs/plans/done/PLAN-0013-plugin-enabled-activation.md` — full design and decision log for the settings-driven discovery model.
- `docs/research/plugin-enable-state.md` — research background (concluded; superseded by the plan above).

## Update Command

`clooks update plugin:<pack-name>` re-vendors hooks from the plugin cache, picking up changes from plugin updates.

### How it works

1. Parses the `plugin:<pack>` argument to extract the pack name.
2. Calls `discoverPluginPacks()` to find matching packs (by `manifest.name`). A pack may appear at multiple scopes.
3. For each matching pack and each hook in its manifest:
   - **Existing hook** (vendor file exists): Overwrites the vendor file from the cache. Does NOT modify the `clooks.yml` entry (the `uses` path is stable).
   - **New hook** (vendor file absent): Copies from cache, validates via `validateHookExport()`, registers in the appropriate config file. Validation failures delete the file (no orphan). If the new hook has `autoEnable: false` in the manifest, it is registered with `enabled: false`, same as initial discovery.
   - **Name collision** (new hook whose name already exists in config): Skipped with warning.
4. Prints a summary of updated, registered, skipped, and errored hooks.

### What it does NOT do

- Does not remove config entries for hooks deleted from the manifest. Dangling entries are handled by Plan C (dangling detection).
- Does not modify existing YAML entries — only appends new ones.
- Does not re-validate existing hooks on update — they were validated on initial install.

## Key Files

- `src/plugin-discovery.ts` — `discoverPluginPacks()` — scans the plugin cache, returns `DiscoveredPack[]`
- `src/plugin-vendor.ts` — `vendorAndRegisterPack()` — copies hook files to vendor and registers in config
- `src/commands/update.ts` — `updatePluginPack()`, `createUpdateCommand()` — explicit update via `clooks update plugin:<pack>`
- `src/engine/run.ts` — `runEngine()` — engine pipeline with two-phase load for plugin discovery
- `src/engine/types.ts` — `RunEngineDeps` — DI interface with optional plugin discovery deps
- `src/manifest.ts` — `loadManifestFromFile()`, `validateManifest()` — manifest loading and validation
- `src/loader.ts` — `validateHookExport()` — validates hook module shape after vendoring

## Related

- `docs/domain/vendoring/overview.md` — Core vendoring concepts, directory layout, formats
- `docs/domain/vendoring/clooks-add.md` — `clooks add` workflow (GitHub-based vendoring)
- `docs/domain/config.md` — Config merging, YAML write patterns
- `docs/domain/global-hooks.md` — Home config loading (user-scoped plugin hooks)
- `docs/research/feat-0041/s3-plugin-cache-structure.md` — Plugin cache directory structure
- `docs/research/feat-0041/spike-cache-inspection.md` — Real installed_plugins.json format
