# `clooks add` Workflow

How `clooks add` downloads, validates, and registers hooks from GitHub — both single-file blob URLs and multi-hook pack repositories.

## Single-file Blob URL Flow

1. **Parse URL** — `parseGitHubBlobUrl()` in `src/github-url.ts` parses a GitHub blob URL (`https://github.com/<owner>/<repo>/blob/<ref>/<path>`) into `{ owner, repo, ref, path, filename, filenameStem }`. Only `.ts` and `.js` files are accepted.
2. **Load config** — `loadConfig(cwd)` checks that the project has been initialized. If no project config is found, `clooks add` exits with an error and suggests running `clooks init` first.
3. **Check conflicts** — If a hook with the same name (filename stem) already exists in `clooks.yml`, `clooks add` exits with an error. Users must remove the existing entry first.
4. **Fetch** — `toRawUrl()` converts the blob URL to a `raw.githubusercontent.com` download URL. `fetch()` retrieves the content. HTTP 404 produces a specific "file not found" message; other non-2xx statuses produce a generic HTTP error.
5. **Write** — The vendor directory is created (`mkdirSync` with `recursive: true`) and the file is written.
6. **Validate** — The file is imported and checked via `validateHookExport()`. On failure, the file is deleted.
7. **Register** — `clooks.yml` is updated by appending the new hook entry with a short address `uses:` value.

## Multi-Hook Packs

A **multi-hook pack** is a GitHub repository that contains a `clooks-pack.json` manifest at its root, listing available hooks for bulk install.

### `clooks-pack.json` Manifest Format

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

### Pack Install Workflow (`clooks add <repo-url>`)

1. **Detect URL type** — `isGitHubRepoUrl()` distinguishes repo URLs (`https://github.com/owner/repo`) from blob URLs (`https://github.com/owner/repo/blob/…`).
2. **Fetch manifest** — Downloads `https://raw.githubusercontent.com/<owner>/<repo>/HEAD/clooks-pack.json`. HTTP 404 produces a "no clooks-pack.json found" message; non-2xx produces a generic error.
3. **Validate manifest** — `validateManifest()` in `src/manifest.ts` checks required fields with explicit error messages. Unknown fields are ignored.
4. **TUI multi-select picker** — `promptMultiSelect` presents the hook list. The user selects which hooks to install. `--all` selects all without prompting.
5. **Non-interactive guard** — In non-interactive mode (piped stdin, CI), `--all` is required. Without it, clooks lists available hooks and exits 0 without installing.
6. **Download and validate** — For each selected hook, fetch the file, write to vendor, validate via `validateHookExport()`. Validation failures warn but continue (soft validation at install time; runtime remains fail-closed).
7. **Name conflict resolution** — If a hook name already exists in `clooks.yml`, clooks first tries the full address as the key (e.g., `someuser/security-hooks:no-bare-mv`), printing an info message explaining the conflict. If the full address key is also taken, the hook is skipped with a warning. No interactive prompt.
8. **Register** — Each successfully installed hook is appended to `clooks.yml` with a short address `uses:` value (`owner/repo:hook-name`).

### `--all` Flag

`clooks add <repo-url> --all` installs all hooks from the pack without presenting the picker. In non-interactive mode, `--all` is required for pack installs.

## Key Files

- `src/commands/add.ts` — `createAddCommand()` — full `clooks add` pipeline
- `src/github-url.ts` — URL parsing and raw URL conversion
- `src/manifest.ts` — Manifest validation and fetching
- `src/loader.ts` — `validateHookExport()` — hook shape validation

## Related

- `docs/domain/vendoring/overview.md` — Core vendoring concepts, directory layout, formats
- `docs/domain/vendoring/plugin-vendoring.md` — Plugin-delivered hook vendoring
- `docs/domain/cli-architecture.md` — Command patterns, TUI output, JSON mode
