# Vendoring

How Clooks downloads and registers hooks from GitHub, commits them to the repository, and makes them available to all team members without a marketplace or install step.

## Overview

Vendoring is Clooks' mechanism for single-command hook sharing. A developer finds a useful hook on GitHub, copies the blob URL, and runs `clooks add <url>`. The hook file is downloaded to `.clooks/vendor/`, validated, and registered in `clooks.yml`. Because the vendor directory is committed to git, new team members get the hooks automatically on clone — no install step needed.

V0 is a deliberate simplification: public repos, single-file hooks, no lockfile, no SHA pinning. Full lockfile and SHA pinning are planned future work.

## Vendor Directory Layout

Vendored hooks follow a GitHub-mirrored path layout:

```
.clooks/vendor/github.com/<owner>/<repo>/<filename>
```

Example: `clooks add https://github.com/someuser/hooks/blob/main/lint-guard.ts` writes to:

```
.clooks/vendor/github.com/someuser/hooks/lint-guard.ts
```

This layout avoids name collisions, mirrors the source provenance, and matches the planned multi-file hook convention (which will add per-hook directories for multi-file installs).

Plugin-delivered hooks use a separate prefix: `.clooks/vendor/plugin/<pack-name>/<hook-name>.ts`. See `vendoring/plugin-vendoring.md` for details.

## Supported File Formats

Vendored hooks must be single-file. Two formats are supported:

- **`.ts` — self-contained TypeScript.** Loaded directly by Bun. All imports must be resolvable at runtime (i.e., the file should not depend on npm packages that are not installed in the project).
- **`.js` — pre-bundled ESM or CJS.** Bun transparently converts CJS to ESM at import time. IIFE format does not work — IIFE bundles have no accessible exports.

For `.js` bundles, the recommended format is ESM (`export { hook }`). CJS (`module.exports = { hook }`) also works. See `docs/research/bundled-js-dist-in-bun-compiled.md` for full format compatibility details, bundler settings, and gotchas.

## Short Address Format

`clooks add` writes a **short address** `uses:` entry to `clooks.yml`:

```yaml
lint-guard:
  uses: someuser/hooks:lint-guard
```

The short address format is `owner/repo:hook-name`. It is the primary user-facing format for all vendored hooks going forward.

**Resolution** is deterministic: `isShortAddress()` in `src/config/resolve.ts` detects values matching `owner/repo:hook-name` (contains `:`, not path-like). The resolver splits on `:`, constructs `.clooks/vendor/github.com/<owner>/<repo>/<hook-name>.{ts,js}`, and uses `existsSync` to detect the extension. No cache or lookup table needed — the address contains all the information required to derive the file path.

**Backward compatibility:** Path-like `uses:` values written by the earlier V0 vendoring scheme (e.g., `uses: ./.clooks/vendor/github.com/someuser/hooks/lint-guard.ts`) continue to resolve correctly via `isPathLike()`. No migration is needed or performed automatically.

## Hook Registration

`clooks add` writes a short address `uses:` entry to `clooks.yml` (short address format is primary; path-like is V0 legacy):

```yaml
# Short address (current)
lint-guard:
  uses: someuser/hooks:lint-guard

# Path-like (V0 legacy — still supported)
lint-guard:
  uses: ./.clooks/vendor/github.com/someuser/hooks/lint-guard.ts
```

When a pack install encounters a name conflict and falls back to the full short address as the YAML key (see "Name conflict resolution" below), the `uses:` field is omitted because it would be identical to the key. The resolver handles short address keys without `uses:` the same way it handles short address `uses:` values — both produce the same vendor file path.

```yaml
# No conflict — short name key, uses: carries provenance
lint-guard:
  uses: someuser/hooks:lint-guard

# Conflict — full address key, no uses: needed
"someuser/hooks:lint-guard": {}
```

The YAML key is the hook's short name (e.g., `lint-guard`). In `src/config/resolve.ts`, `isShortAddress()` detects the short address format; `isPathLike()` detects path-like values. Both bypass convention rules and `meta.name` matching, so the vendored hook's `meta.name` is not validated against the YAML key.

Plugin-delivered hooks use path-like `uses:` values (`./.clooks/vendor/plugin/<pack>/<hook>.ts`). See `vendoring/plugin-vendoring.md` for their registration format.

## Validation

After downloading, the file is dynamically imported and validated via `validateHookExport()` in `src/loader.ts`. The function checks that the module exports a `hook` object with a `meta.name` field. If validation fails (missing export, missing `meta`, import error), the file is deleted and `clooks.yml` is not updated. The error is reported to the user.

Because validation requires importing the module, the hook code is executed during `clooks add`. This is unavoidable — there is no way to inspect module exports without executing the module.

## What Happens on Clone

Vendored files in `.clooks/vendor/` are committed to git. Clooks has no install step. When a team member clones the repository and runs the agent, the compiled binary reads `clooks.yml`, resolves the `uses:` path to the committed vendor file, and loads it. No network access, no download command.

## V0 Limitations

- **Public repos only.** `fetch()` to `raw.githubusercontent.com` requires no authentication. Private repo support is deferred.
- **Single-file only.** Either a self-contained `.ts` file or a pre-bundled `.js` file.
- **No lockfile, no SHA pinning.** The vendored file is committed to git, which provides version history, but there is no `hooks.lock` with content hashes or resolved SHAs. Deferred to a future release.
- **No update/upgrade command.** To update a vendored hook, delete the vendor file and its `clooks.yml` entry, then re-run `clooks add` with the new URL.
- **No `clooks remove`.** Manual deletion only.
- **Branch/tag refs are not resolved to SHAs.** If the blob URL uses a branch name (e.g., `main`), the downloaded content may drift from what was originally installed. Use a commit SHA in the URL for reproducibility.
- **Refs containing `/` are not supported** (e.g., `feature/my-branch`). The ref must be a single path segment.

## Relationship to Future Features

- **Lockfile & vendoring system (planned)**: Full lockfile with SHA pinning and content hashes. Multi-file hook directories. `clooks install` to regenerate vendor from lockfile.
- **Full `clooks add` with marketplace/TUI (planned)**: Registry lookup, short-name addressing (`clooks add owner/hook-name`), TUI browser. The V0 URL-based command is designed so URL form and future short-name form coexist — URL detection is straightforward (starts with `https://`).

## Key Files

- `src/github-url.ts` — `parseGitHubBlobUrl()`, `toRawUrl()`, `isGitHubRepoUrl()`, `GitHubBlobInfo` interface
- `src/manifest.ts` — `validateManifest()`, `loadManifestFromFile()`, `fetchManifest()` — manifest validation and loading (local disk and HTTP)
- `src/plugin-discovery.ts` — `discoverPluginPacks()` — scans Claude Code plugin cache for installed hook packs
- `src/plugin-vendor.ts` — `vendorAndRegisterPack()` — copies hook files from plugin cache to vendor directory and registers in config
- `src/commands/add.ts` — `createAddCommand()` — full `clooks add` pipeline (both blob URL and repo URL flows)
- `src/config/resolve.ts` — `isPathLike()`, `isShortAddress()` — format detectors for `uses:` values
- `src/loader.ts` — `validateHookExport()` — validates that an imported module exports a compliant `hook` object

## Related

- `docs/domain/vendoring/clooks-add.md` — `clooks add` workflow details, multi-hook packs
- `docs/domain/vendoring/plugin-vendoring.md` — Plugin cache discovery and plugin hook vendoring
- `docs/domain/config.md` — Hook path resolution, `uses:` field, path-like values
- `docs/domain/cli-architecture.md` — Command patterns, TUI output, JSON mode
- `docs/research/bundled-js-dist-in-bun-compiled.md` — Full format compatibility for pre-bundled `.js` hooks
