# Plugin Vendoring

How Clooks discovers hook packs installed through Claude Code or Codex, copies them to local vendor directories, and registers them in `clooks.yml`.

## Overview

Clooks hook packs are data-only plugins. Each runtime adapter discovers its own installed packs, then shares additive vendoring and registration. Claude caches live under `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`; Codex caches live under its effective home at `plugins/cache/<marketplace>/<plugin>/<version>/`. Discovery requires an already initialized Clooks configuration. Applicable newly registered hooks can run in that same invocation.

Plugin hooks are NOT executed live from the plugin cache. They are copied to a vendor directory and pinned until the user explicitly updates. This prevents plugin updates from silently changing running code — aligning with clooks' safety-first model.

Real-world examples of data-only hook pack plugins: `clooks-example-hooks` (educational hooks demonstrating lifecycle, config, and events), `clooks-core-hooks` (zero-config production hooks for command safety, git protection, tool hygiene, and tmux notifications), and `clooks-project-hooks` (project-configured hooks for package manager enforcement, protected paths, and project script preference). All three live in the `clooks-marketplace` repo.

## Onboarding Is Not Pack Discovery

The marketplace's `clooks/` onboarding package supports both Claude and Codex,
and runtime pack discovery reads each agent's persisted configuration and cache. Codex's
`.agents/plugins/marketplace.json` catalog and `.codex-plugin/plugin.json` manifest
expose explicit `$clooks:setup`, independently of data-only pack discovery. The plugin's
SessionStart reminder never installs or initializes the runtime; `clooks init`
owns runtime registrations.

Codex can run compatible custom or already-vendored hooks through shared Clooks
configuration. For direct downloads, `clooks add` accepts individual GitHub blob
URLs or a repository with a root `clooks-pack.json`; nested `/tree/.../<pack>`
URLs do not select marketplace subdirectories. `clooks update plugin:<pack>`
reads installed pack sources from both agents, not remote catalog contents.

Runtime updates, native plugin updates and hook-file refresh are distinct
operations. A plugin version change does not replace the user's runtime or existing
vendored hooks. Keep plugin release versions aligned with their listings where
declared; `clooks-pack.json` numeric `version: 1` remains the pack schema version.

## Plugin Cache Discovery

### Codex file-backed contract

`discoverCodexPluginPacks()` in `src/agents/codex/plugin-discovery.ts` requires explicit `homeRoot` and `projectRoot`, with optional `codexHome`. The engine forwards `CODEX_HOME`; discovery itself never reads process environment or cwd. The existing `resolveCodexHome()` treats unset/empty home as `homeRoot/.codex`, requires an absolute path, and resolves physical locations. A user config reached through a project/home symlink is not reclassified as project activation.

Discovery reads the user `config.toml`, then project `.codex/config.toml` layers from the nearest root marker through the anchored Clooks project root. The default marker is a `.git` file or a directory containing `HEAD`. The user file's `project_root_markers` string array replaces that default; an empty array or no matching marker means only the anchor participates. Narrower tool cwd and payload cwd do not change this anchor. The repository is trusted by explicit user requirement; this code does not recreate native trust policy.

Only persisted plugin tables participate. A present table defaults to enabled. The narrowest explicit `enabled` field sets enabled state and destination scope: user activation vendors user-wide, project activation vendors to the anchored project. A project table changing only another field preserves an inherited user enablement and scope; a project-only table defaults to project scope. Project `enabled=false` suppresses new discovery even over a user enablement. An effective `features.plugins=false` suppresses all discovery. This differs deliberately from Claude's independent-layer activations.

Participating files use `Bun.TOML.parse`. Parser errors, unreadable files, non-table `plugins`/`features` containers or plugin entries, nonboolean `enabled`/`features.plugins`, and non-string-array `project_root_markers` suppress the whole discovery batch with a path-bearing warning. Missing files are ordinary absence. Unrelated keys are not validated as a second native schema. Syntax acceptance follows Bun's parser: Bun 1.3.10 accepts an unterminated header such as `[broken`; Clooks does not add a second TOML parser to reject syntax Bun accepts.

Only configured safe `plugin@marketplace` identities are resolved, in deterministic order. Actual cache directories participate; symlink versions and symlink plugin/marketplace parents do not. `local` wins; otherwise version selection follows pinned Codex 0.154.0's Rust semantic-version ordering, with lexical fallback when either version is invalid. The small `semver` dependency validates normalized suffix syntax; a private compatibility adapter preserves canonical full u64 core numbers, exact large numeric identifiers, and Rust's leading-zero build ordering (`1 < 01 < 001 < 2`). Prefixes such as `v1.2.3`, partial versions, and u64 overflow are not Rust semver. Cache segments are bounded by the filesystem's 255-byte name limit. Only the selected version's `clooks-pack.json` is loaded: missing manifests skip unrelated plugins, invalid manifests warn, and neither falls back to older versions or imports hooks.

This is file-backed discovery, not native runtime authorization. Parent CLI flags, selected external profiles, cloud/managed policy and remote catalogs are not inferred. No native process is spawned. Native disabling/removal stops new discovery, not execution of user-owned vendored hooks; existing Clooks configuration remains authoritative.

Explicit updates discover both agents independently of the invoking runtime's `CLOOKS_AGENT`. Claude SessionStart advisories require known Claude install/settings identity and account for an enabled Codex source at the same physical vendor destination. Shared vendor paths alone are not proof of Claude ownership.

### Claude discovery

The `discoverPluginPacks()` function in `src/plugin-discovery.ts` drives discovery from **Claude settings layers**, not from the install registry. A plugin is registered at a given clooks scope if and only if the corresponding Claude settings layer declares `enabledPlugins: { <plugin>@<marketplace>: true }`.

### How it works

1. Resolves `installedPluginsPath`, `settingsPaths`, `homeRoot`, and `projectRoot` from `DiscoverOptions` or canonical defaults (see interface below).
2. Reads `~/.claude/plugins/installed_plugins.json` via `readInstalledPlugins()`. Returns `[]` if missing or malformed. The install registry is treated purely as a **scope-agnostic lookup table** — its own `scope` and `projectPath` fields are metadata and do not influence where clooks vendors the hook.
3. Reads each Claude settings layer (`user`, `project`, `local`) independently via `readEnabledPlugins()`. The `managed` layer is read but skipped for registration (see "Managed scope skipped" below).
4. For each scope in `{ user, project, local }`, for each plugin key that layer activates (its own `enabledPlugins[key] === true`):
   - `lookupInstallPath(installedPluginsFile, pluginKey)` — finds the first install entry whose `installPath` exists on disk, has no `.orphaned_at` marker, and whose scope is not `managed`. If nothing valid → skip (the stale detector can surface this as an `enable-without-install` advisory).
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

The cache lives at `~/.claude/plugins/cache/` with a 3-level hierarchy: `<marketplace>/<plugin>/<version>/`. Version directories may use semver (`1.0.0`) or truncated git SHAs (`a5c3762d7ad8`). Orphaned directories (from plugin updates/uninstalls) contain an `.orphaned_at` marker file with an epoch-millisecond timestamp.

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

A `DiscoveredPack`'s `scope` is the activation scope selected by its adapter: the independent Claude settings layer or effective Codex enabled-field provenance. It is not inferred from cache location or pack name. The routing table is unchanged:

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
2. For Codex, validate and normalize input before any pack discovery/import. Each adapter calls only its own discovery dependency.
3. `preparePluginPacks()` calls `vendorAndRegisterPack()` for each pack; each call checks current scope-local names for collisions.
4. If any new hooks were registered: re-load config via `loadConfig()` (phase 2). This is the two-phase load — newly registered hooks become active in the same invocation they are discovered.
5. Reloaded config, shadows, and `hasProjectConfig` travel together. The engine derives normal failure storage after preparation and uses refreshed metadata for its no-project SessionStart advisory. A first project pack can create project config from a home-only initial load. The pre-load config-failure path and no-config exit remain unchanged. Null/failed reloads retain all original metadata; failures add a diagnostic.
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

`discoverPluginPacks`, `discoverCodexPluginPacks`, and `vendorAndRegisterPack` are optional fields on `RunEngineDeps`. Default engine dependencies supply both discovery functions; test-owned dependencies missing the selected function do not fall back to default discovery or a real home. The shared preparation helper accepts packs and vendor/load dependencies, never discovers another provider, and has no mutable adapter state. Optional preparation metadata preserves existing injected adapters. Tests use explicit DI, not `mock.module()`.

## Stale Entry Detection

`detectStaleAdvisories()` in `src/claude-settings.ts` surfaces two kinds of drift between Claude settings and clooks vendored state. The engine calls it from `src/engine/run.ts` on `SessionStart` events only and pushes the formatted results into `pluginSystemMessages`.

- **`stale-registration`** — a plugin-vendored hook entry is identifiable through a Claude install manifest or a matching persisted install/settings plugin identity, but none of its known Claude keys is enabled at that scope. An enabled Codex pack at the same physical vendor destination suppresses this warning, including equal home/project roots and directory aliases. Distinct user/project destinations remain separate; project/local config entries share a vendor destination. Unknown-origin copies produce no Claude stale-registration claim. A removed cache may remain identifiable from its retained native key; removing all identifying records deliberately loses that diagnostic.
- **`enable-without-install`** — a plugin key is `true` at some Claude settings layer, at least one of its install entries has a reachable `clooks-pack.json` (so clooks can confirm it is — or was — a clooks pack), but every install entry is rejected by `lookupInstallPath` (orphaned, `managed`, etc.). Plugins that fail the `clooks-pack.json` check are suppressed to avoid noise from unrelated marketplace plugins. Codex does not repair a broken native Claude enablement.

Advisory collection **never mutates `clooks.yml`**. Advisories are informational `systemMessage` lines telling the user the exact next step (e.g., the exact `.clooks/clooks.local.yml` snippet to shadow the entry, or the `/plugin install` command to re-install).

### SessionStart gating

The detector runs on Claude `SessionStart` only. The engine passes explicit home/project/Codex-home values and its optional Codex discovery dependency into the adapter. The detector requests Codex discovery lazily, only after finding a vendored entry with known Claude identity that is not enabled at its Claude scope. Results (including an empty list) are reused for the rest of that invocation. No vendored entries, unknown-origin entries, and enabled Claude registrations cause no Codex lookup or Codex configuration warnings. Injected callers without that function never fall back to real-home discovery; existing injected pack arrays remain supported. Non-SessionStart events skip advisory collection; the silencer also skips Codex lookup and filesystem identity checks.

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

- `docs/research/plugin-enable-state.md` — research background.

## Update Command

`clooks update plugin:<pack-name>` re-vendors hooks from the plugin cache, picking up changes from plugin updates.

### How it works

1. Parses the `plugin:<pack>` argument to extract the pack name.
2. Discovers matching `manifest.name` values from Claude and Codex independently of inherited `CLOOKS_AGENT`. Optional `--agent claude-code|codex` filters providers before discovery; unsupported values are rejected.
3. Preflights every matching source before any destination writes or hook imports. Validated manifest structures are compared with `isDeepStrictEqual`, ignoring object key order but preserving arrays/types. Every referenced hook file is read into a byte snapshot and compared with `Buffer.equals`. Missing/unreadable sources fail preflight with provider, plugin key and path.
4. Groups by physical vendor directory, resolving existing prefixes even when the destination is missing. Root/vendor aliases cannot evade conflict detection. Equivalent sources copy once per destination. Separate project/local config destinations are retained; aliased config files coalesce. Distinct home/project destinations may have different source content.
5. Differing sources for one destination fail with zero writes anywhere, identifying providers and plugin keys. Cross-provider conflicts can be selected with `--agent`; same-provider marketplace conflicts remain errors after filtering and require disabling the unwanted source. No provider or newest-version preference silently resolves an update conflict.
6. Writes the preflighted bytes. Existing vendor files are refreshed without changing existing YAML. For absent files, structured YAML inspection checks each target config before copying. A registration whose `uses` resolves to the same physical vendor file is repaired: the file is restored and validated, reported as updated, and its YAML (including comments and disabled settings) is unchanged. A registration pointing elsewhere remains a name collision; all-collision targets create no vendor file. Genuinely new registrations are appended to each eligible config after validation; `autoEnable=false` stays disabled. Invalid new or restored modules are deleted and reported, leaving existing YAML intact. Destination resolution failures identify the vendor or config path, not a Codex-home setting.
7. Prints updated, registered, skipped and error lists. Ambiguity/source-preflight failure has no successes and exits 1. Later copy/import/registration failures are reported per hook; the update is not a general filesystem transaction.

`updatePluginPack()` retains its fourth-argument discovery-function form for existing callers. That form is Claude-only and never implicitly enables Codex discovery. The options form accepts optional per-provider discovery functions, selected agent and explicit Codex home; test-owned options do not acquire missing default dependencies. CLI defaults supply both providers. No provenance database is maintained.

### What it does NOT do

- Does not remove config entries for hooks deleted from the manifest. Dangling entries are handled by the dangling-hook detection path.
- Does not modify existing YAML entries — only appends new ones.
- Does not re-validate files already present on update; missing files are validated when restored, even when already registered.

## Key Files

- `src/plugin-discovery.ts` — `discoverPluginPacks()` — scans the plugin cache, returns `DiscoveredPack[]`
- `src/agents/codex/plugin-discovery.ts` — persisted Codex activation and selected-cache discovery
- `src/agents/prepare-plugin-packs.ts` — shared additive vendoring, messages and config/metadata reload
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
