# Plugin Vendoring

How Clooks discovers hook packs installed as Claude Code plugins, copies them to local vendor directories, and registers them in `clooks.yml`.

## Overview

Clooks distributes hook packs as Claude Code data-only plugins. When a user installs such a plugin, its files land in the plugin cache at `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`. Clooks discovers these packs, vendors the hook files locally, and auto-registers them — all within a single invocation.

Plugin hooks are NOT executed live from the plugin cache. They are copied to a vendor directory and pinned until the user explicitly updates. This prevents plugin updates from silently changing running code — aligning with clooks' safety-first model.

Real-world examples of data-only hook pack plugins: `clooks-example-hooks` (educational hooks demonstrating lifecycle, config, and events) and `clooks-core-hooks` (production hooks for command safety, git history preservation, logging, and tmux notifications). Both live in the `clooks-marketplace` repo.

## Plugin Cache Discovery

The `discoverPluginPacks()` function in `src/plugin-discovery.ts` scans the Claude Code plugin cache and returns validated manifests for all installed hook packs.

### How it works

1. Reads `~/.claude/plugins/installed_plugins.json` — the Claude Code registry of installed plugins. Each entry maps a plugin key (`plugin-name@marketplace-name`) to an array of scope entries (`user`, `project`, `local`, or `managed`).
2. For each entry, skips if: scope is `managed` (deferred), scope is unrecognized (warns and skips), `installPath` doesn't exist, directory contains `.orphaned_at` (orphaned by a plugin update), or no `clooks-pack.json` exists at the root.
3. Loads and validates the manifest via `loadManifestFromFile()`. Invalid manifests are logged as warnings and skipped — one broken plugin does not prevent others from being discovered.
4. Returns `DiscoveredPack[]` with `pluginName`, `scope`, `installPath`, and the validated `Manifest`.

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

The plugin's `scope` field determines where hooks are vendored and which config file they register in:

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

### Algorithm

The function operates in two phases:

1. **Vendor**: For each hook in the manifest: check if already vendored (skip if file exists), check for name collisions against existing config hooks (skip if taken), copy the source file from the plugin cache to the vendor path, validate via `validateHookExport()` (dynamic import + shape check). Validation failures delete the vendored file and record an error.
2. **Register**: Append YAML entries for all successfully vendored hooks. The config file is written once after all entries are accumulated.

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
- **Collisions:** Passed through from `vendorAndRegisterPack()` with `clooks:` prefix.
- **Errors:** Passed through from `vendorAndRegisterPack()` with `clooks:` prefix.

These messages are merged into the existing `allSystemMessages` array alongside startup warnings and hook-level system messages.

### Performance

The discovery step adds ~5ms per invocation when `installed_plugins.json` exists (filesystem scan + manifest read). When the file is absent (no plugins installed), the cost is a single `existsSync` check (<1ms). The config reload on first discovery adds ~1ms (config parsing is ~0.17ms per layer).

### Dependency Injection

`discoverPluginPacks` and `vendorAndRegisterPack` are optional fields on `RunEngineDeps` (in `src/engine/types.ts`). This enables unit testing via mocks without `mock.module()`, matching the existing DI pattern used for `loadConfig` and `loadAllHooks`.

## Update Command

`clooks update plugin:<pack-name>` re-vendors hooks from the plugin cache, picking up changes from plugin updates.

### How it works

1. Parses the `plugin:<pack>` argument to extract the pack name.
2. Calls `discoverPluginPacks()` to find matching packs (by `manifest.name`). A pack may appear at multiple scopes.
3. For each matching pack and each hook in its manifest:
   - **Existing hook** (vendor file exists): Overwrites the vendor file from the cache. Does NOT modify the `clooks.yml` entry (the `uses` path is stable).
   - **New hook** (vendor file absent): Copies from cache, validates via `validateHookExport()`, registers in the appropriate config file. Validation failures delete the file (no orphan).
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
