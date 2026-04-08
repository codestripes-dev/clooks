# Vendoring

How Clooks downloads and registers hooks from GitHub, commits them to the repository, and makes them available to all team members without a marketplace or install step.

## Overview

Vendoring is Clooks' mechanism for single-command hook sharing. A developer finds a useful hook on GitHub, copies the blob URL, and runs `clooks add <url>`. The hook file is downloaded to `.clooks/vendor/`, validated, and registered in `clooks.yml`. Because the vendor directory is committed to git, new team members get the hooks automatically on clone — no install step needed.

V0 (FEAT-0039) is a deliberate simplification: public repos, single-file hooks, no lockfile, no SHA pinning. Full lockfile and SHA pinning land in FEAT-0025.

## Vendor Directory Layout

Vendored hooks follow a GitHub-mirrored path layout:

```
.clooks/vendor/github.com/<owner>/<repo>/<filename>
```

Example: `clooks add https://github.com/someuser/hooks/blob/main/lint-guard.ts` writes to:

```
.clooks/vendor/github.com/someuser/hooks/lint-guard.ts
```

This layout avoids name collisions, mirrors the source provenance, and matches FEAT-0025's planned multi-file hook convention (which will add per-hook directories for multi-file installs).

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

The short address format is `owner/repo:hook-name`. It is the primary user-facing format for all vendored hooks going forward (FEAT-0040+).

**Resolution** is deterministic: `isShortAddress()` in `src/config/resolve.ts` detects values matching `owner/repo:hook-name` (contains `:`, not path-like). The resolver splits on `:`, constructs `.clooks/vendor/github.com/<owner>/<repo>/<hook-name>.{ts,js}`, and uses `existsSync` to detect the extension. No cache or lookup table needed — the address contains all the information required to derive the file path.

**Backward compatibility:** Path-like `uses:` values written by FEAT-0039 V0 (e.g., `uses: ./.clooks/vendor/github.com/someuser/hooks/lint-guard.ts`) continue to resolve correctly via `isPathLike()`. No migration is needed or performed automatically.

## Hook Registration

`clooks add` writes a short address `uses:` entry to `clooks.yml` (short address format is primary; path-like is V0 legacy):

```yaml
# Short address (current — FEAT-0040+)
lint-guard:
  uses: someuser/hooks:lint-guard

# Path-like (V0 legacy — FEAT-0039, still supported)
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

## Validation

After downloading, the file is dynamically imported and validated via `validateHookExport()` in `src/loader.ts`. The function checks that the module exports a `hook` object with a `meta.name` field. If validation fails (missing export, missing `meta`, import error), the file is deleted and `clooks.yml` is not updated. The error is reported to the user.

Because validation requires importing the module, the hook code is executed during `clooks add`. This is unavoidable — there is no way to inspect module exports without executing the module.

## What Happens on Clone

Vendored files in `.clooks/vendor/` are committed to git. Clooks has no install step. When a team member clones the repository and runs the agent, the compiled binary reads `clooks.yml`, resolves the `uses:` path to the committed vendor file, and loads it. No network access, no download command.

## Multi-Hook Packs

A **multi-hook pack** is a GitHub repository that contains a `clooks-pack.json` manifest at its root, listing available hooks for bulk install.

### `clooks-pack.json` manifest format

The JSON Schema is at `schemas/clooks-pack.schema.json`. Hook authors can reference it with `"$schema": "https://clooks.cc/clooks-pack.schema.json"` for editor validation.

```json
{
  "$schema": "https://clooks.cc/clooks-pack.schema.json",
  "version": 1,
  "name": "security-hooks",
  "description": "Safety and compliance hooks for AI coding agents",
  "hooks": {
    "no-bare-mv": {
      "path": "hooks/no-bare-mv.ts",
      "description": "Rewrites bare mv commands to git mv",
      "events": ["PreToolUse"],
      "tags": ["git", "safety"]
    },
    "secret-scanner": {
      "path": "dist/secret-scanner.js",
      "description": "Blocks commits containing API keys",
      "events": ["PreToolUse"],
      "tags": ["security"]
    }
  }
}
```

Top-level fields: `version` (integer, must be `1`, required), `name` (string, required), `hooks` (object mapping hook names to hook descriptors, required), `description`/`author`/`license`/`repository` (optional). Per-hook fields: `path` (string, relative path to hook file, required), `description` (string, required), `events` (string[], optional), `tags` (string[], optional), `configDefaults` (object, optional). Additional unknown fields are ignored for forward compatibility.

### Pack install workflow (`clooks add <repo-url>`)

1. **Detect URL type** — `isGitHubRepoUrl()` distinguishes repo URLs (`https://github.com/owner/repo`) from blob URLs (`https://github.com/owner/repo/blob/…`).
2. **Fetch manifest** — Downloads `https://raw.githubusercontent.com/<owner>/<repo>/HEAD/clooks-pack.json`. HTTP 404 produces a "no clooks-pack.json found" message; non-2xx produces a generic error.
3. **Validate manifest** — `validateManifest()` in `src/manifest.ts` checks required fields with explicit error messages. Unknown fields are ignored.
4. **TUI multi-select picker** — `promptMultiSelect` presents the hook list. The user selects which hooks to install. `--all` selects all without prompting.
5. **Non-interactive guard** — In non-interactive mode (piped stdin, CI), `--all` is required. Without it, clooks lists available hooks and exits 0 without installing.
6. **Download and validate** — For each selected hook, fetch the file, write to vendor, validate via `validateHookExport()`. Validation failures warn but continue (soft validation at install time; runtime remains fail-closed).
7. **Name conflict resolution** — If a hook name already exists in `clooks.yml`, clooks first tries the full address as the key (e.g., `someuser/security-hooks:no-bare-mv`), printing an info message explaining the conflict. If the full address key is also taken, the hook is skipped with a warning. No interactive prompt.
8. **Register** — Each successfully installed hook is appended to `clooks.yml` with a short address `uses:` value (`owner/repo:hook-name`).

### `--all` flag

`clooks add <repo-url> --all` installs all hooks from the pack without presenting the picker. In non-interactive mode, `--all` is required for pack installs.

## `clooks add` Workflow

### Single-file blob URL flow

1. **Parse URL** — `parseGitHubBlobUrl()` in `src/github-url.ts` parses a GitHub blob URL (`https://github.com/<owner>/<repo>/blob/<ref>/<path>`) into `{ owner, repo, ref, path, filename, filenameStem }`. Only `.ts` and `.js` files are accepted.
2. **Load config** — `loadConfig(cwd)` checks that the project has been initialized. If no project config is found, `clooks add` exits with an error and suggests running `clooks init` first.
3. **Check conflicts** — If a hook with the same name (filename stem) already exists in `clooks.yml`, `clooks add` exits with an error. Users must remove the existing entry first.
4. **Fetch** — `toRawUrl()` converts the blob URL to a `raw.githubusercontent.com` download URL. `fetch()` retrieves the content. HTTP 404 produces a specific "file not found" message; other non-2xx statuses produce a generic HTTP error.
5. **Write** — The vendor directory is created (`mkdirSync` with `recursive: true`) and the file is written.
6. **Validate** — The file is imported and checked via `validateHookExport()`. On failure, the file is deleted.
7. **Register** — `clooks.yml` is updated by appending the new hook entry with a short address `uses:` value.

### Repo URL (pack) flow

See [Multi-Hook Packs](#multi-hook-packs) above.

## V0 Limitations

- **Public repos only.** `fetch()` to `raw.githubusercontent.com` requires no authentication. Private repo support is deferred.
- **Single-file only.** Either a self-contained `.ts` file or a pre-bundled `.js` file.
- **No lockfile, no SHA pinning.** The vendored file is committed to git, which provides version history, but there is no `hooks.lock` with content hashes or resolved SHAs. Deferred to FEAT-0025.
- **No update/upgrade command.** To update a vendored hook, delete the vendor file and its `clooks.yml` entry, then re-run `clooks add` with the new URL.
- **No `clooks remove`.** Manual deletion only.
- **Branch/tag refs are not resolved to SHAs.** If the blob URL uses a branch name (e.g., `main`), the downloaded content may drift from what was originally installed. Use a commit SHA in the URL for reproducibility.
- **Refs containing `/` are not supported** (e.g., `feature/my-branch`). The ref must be a single path segment.

## Relationship to Future Features

- **FEAT-0025 — Lockfile & vendoring system**: Full lockfile with SHA pinning and content hashes. Multi-file hook directories. `clooks install` to regenerate vendor from lockfile.
- **FEAT-0019 — Full `clooks add` with marketplace/TUI**: Registry lookup, short-name addressing (`clooks add owner/hook-name`), TUI browser. The V0 URL-based command is designed so URL form and future short-name form coexist — URL detection is straightforward (starts with `https://`).

## Key Files

- `src/github-url.ts` — `parseGitHubBlobUrl()`, `toRawUrl()`, `isGitHubRepoUrl()`, `GitHubBlobInfo` interface
- `src/manifest.ts` — `validateManifest()` — hand-written manifest validation, `Manifest` and `ManifestHook` types
- `src/commands/add.ts` — `createAddCommand()` — full `clooks add` pipeline (both blob URL and repo URL flows)
- `src/config/resolve.ts` — `isPathLike()`, `isShortAddress()` — format detectors for `uses:` values
- `src/loader.ts` — `validateHookExport()` — validates that an imported module exports a compliant `hook` object

## Related

- `docs/domain/config.md` — Hook path resolution, `uses:` field, path-like values
- `docs/domain/cli-architecture.md` — Command patterns, TUI output, JSON mode
- `docs/research/bundled-js-dist-in-bun-compiled.md` — Full format compatibility for pre-bundled `.js` hooks
- `docs/planned/FEAT-0039-vendoring-v0.md` — Feature specification
- `docs/planned/FEAT-0025-lockfile-and-vendoring.md` — Future lockfile system
