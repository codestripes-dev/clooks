# CLI Architecture — Hook & Lifecycle Commands

`clooks add`, `clooks new-hook`, `clooks update plugin:<pack>`, `clooks test`, and `clooks uninstall`. Part of [CLI Architecture](../cli-architecture.md).

## `clooks add <url>`

Installs hooks from GitHub and registers them in the project. Accepts two URL forms:

- **Blob URL** (`https://github.com/<owner>/<repo>/blob/<ref>/<filename>`) — single-file install. Only `.ts` and `.js` files are accepted.
- **Repo URL** (`https://github.com/<owner>/<repo>`) — multi-hook pack install. Fetches `clooks-pack.json` manifest, presents a TUI multi-select picker, downloads selected hooks.

**Flags:** `--all` (install all pack hooks without prompting), `--global` (install to `~/.clooks/`), `--project` (install to project `.clooks/`, default).

**Blob URL pipeline:**

1. Parse via `parseGitHubBlobUrl()` — extracts `owner`, `repo`, `ref`, `filename`, `filenameStem`.
2. Load config via `loadConfig(scope.root)` — verifies `clooks init` has been run.
3. Check for name conflicts — exits with error if the stem already exists in `clooks.yml`.
4. Fetch raw file from `raw.githubusercontent.com`.
5. Write to `.clooks/vendor/github.com/<owner>/<repo>/<filename>`.
6. Validate via `validateHookExport()` — deletes file on failure.
7. Append hook entry to `clooks.yml` with short address `uses:` value (`owner/repo:hook-name`).

**Repo URL (pack) pipeline:**

1. Detect repo URL via `isGitHubRepoUrl()`.
2. Fetch `clooks-pack.json` manifest from `raw.githubusercontent.com/<owner>/<repo>/HEAD/clooks-pack.json`.
3. Validate manifest via `validateManifest()` in `src/manifest.ts`.
4. Non-interactive guard: if stdin is not a TTY and `--all` is not set, list available hooks and exit 0.
5. Present `promptMultiSelect` picker (or select all if `--all`).
6. For each selected hook: fetch, write, validate (soft — warns but continues on failure), register.
7. Append each installed hook to `clooks.yml` with short address `uses:` value.

**Error cases:** invalid/unrecognized URL, unsupported file extension, not initialized, HTTP 404, fetch failure, manifest missing or invalid, all hooks skipped due to conflicts.

**TUI output:** spinner during fetch, multi-select picker for packs, per-hook success/warning messages, outro with summary.

**`--json` support:** On success, `{ ok: true, command: "add", data: { name, address, url } }` (blob) or `{ ok: true, command: "add", data: { installed: string[] } }` (pack). On error, `{ ok: false, command: "add", error: "<message>" }`.

## `clooks new-hook`

Interactive scaffolding command. Prompts for a hook name (kebab-case validated) and scope (project/global), then generates a ready-to-edit `.ts` hook file with the correct `import type { ClooksHook } from './types'` and a typed `ClooksHook<Config>` export.

Refuses to overwrite an existing file (safe by default). Does NOT auto-register the hook in `clooks.yml` — users must add it manually. Supports `--name` and `--json` flags for non-interactive use.

## `clooks update plugin:<pack-name>`

Re-vendors hooks from the plugin cache for a specific pack. Overwrites existing vendor files with updated content from the cache. New hooks (added in the plugin update) are validated and registered. Existing config entries are never modified — only new entries are appended.

Discovery queries both Claude and Codex by default, independently of `CLOOKS_AGENT`; `--agent claude-code|codex` filters the source agent. Every matching manifest and referenced file is preflighted before writes/imports. Equivalent sources coalesce by physical vendor destination, including aliases and missing descendants of existing prefixes. Project/local config destinations remain separate. Manifest or byte disagreement and missing source files fail without modifying any destination. Filtering does not resolve conflicting marketplaces within one agent; those must be disabled explicitly.

The existing fourth discovery-function argument to `updatePluginPack()` remains an isolated Claude-only injection. The options form accepts optional discovery functions and explicit Codex home; missing injected dependencies never fall back to defaults. `createUpdateCommand()` accepts optional discovery dependencies alongside its existing root resolver. No provenance database or agent-process lookup is involved.

Exits with code 1 when all hooks fail (errors only, no successes). Supports `--json` for structured output.

See `docs/domain/vendoring/plugin-vendoring.md` for the full update algorithm.

## `clooks test <hook-file>` / `clooks test example <Event>`

One-shot hook author harness. Runs a single hook handler against a synthetic event payload and prints the decision JSON to stdout, with an exit code mapped from the decision's `result` tag.

Two subcommand forms with deliberately different output contracts:

- **`clooks test <hook-file>`** — reads a JSON payload from stdin (or `--input <file>`), dispatches the matching per-event handler from the hook file, and writes the handler's return value as a single JSON line to stdout. `hookConfig` defaults to `meta.config`; `--config <path>` / `--config-json '<json>'` (mutually exclusive) override it, and `--hook-name <alias>` disambiguates entry resolution under `--config`. Output is **valid JSON** — pipe to `jq`. Input contract is the **cleaned-up `Context` shape** (the type hooks program against), not Claude Code's wire shape; the harness skips wire normalization and the multi-hook reducer.
- **`clooks test example <Event>`** — prints prose-and-JSON documentation for the named event: a minimum-viable JSON fixture block, the required-fields list, and (for the four tool-keyed events) inline documentation of all 10 built-in tools' `toolInput` shapes plus a fallback note for `ExitPlanMode` and `mcp__*` tools. Output is **documentation, not parseable JSON** — authors copy-paste the JSON block; do **not** pipe to `jq`.

**Exit codes for `clooks test <hook>`:** `allow`/`skip`/`success`/`continue`/`retry`/`ask`/`defer` and `undefined` return → 0; `block`/`failure`/`stop` → 1; hook throws or harness usage error → 2. `clooks test example` always exits 0 on a known event, 2 on unknown.

**`--config` and `--config-json`** are mutually exclusive and both shallow-merge their override over `meta.config` defaults — same shape as production's `loadHook` (`src/loader.ts:144-146`). Full contract (entry resolution, `--hook-name`, `enabled: false` behavior) lives in [testing/hook-author-testing.md](../testing/hook-author-testing/invocation-and-shape.md#hookconfig--overriding-via---config----config-json). **No `--tool` flag** for `clooks test example` — tool-keyed events inline all 10 tools' `toolInput` shapes in one document.

Routing: `clooks test` is registered in `KNOWN_COMMANDS` so the dual-mode dispatcher routes it to CLI mode; `example` is wired as a true sub-`Command` via `testCmd.addCommand(exampleCmd)`. Hook author guide: [testing/hook-author-testing.md](../testing/hook-author-testing.md).

## `clooks uninstall`

Removes Clooks from a project or global scope. An explicit `--agent claude-code`, `--agent codex`, or `--agent all` selects registrations without detecting unrelated agents. Without `--agent`, the command inspects the chosen scope: one registered agent is selected automatically; both offer an interactive Claude Code/Codex/both picker. Both agents with `--force` or noninteractive input require explicit `--agent`; force confirms actions, never selects an agent. Global detection uses only the effective `CODEX_HOME` (or `HOME/.codex`), not other recorded homes. Agent selection does not depend on `CLOOKS_AGENT`.

When neither agent is registered, automatic selection reports no registrations without offering deletion or clearing stale flags. Explicit `--full` still permits orphan `.clooks/` cleanup through the existing all-reference checks. Explicit agent selection retains stale-global-flag cleanup. Explicit `--unhook` confirms registration removal but never offers directory deletion; `--unhook` and `--full` are mutually exclusive in both interactive and forced use. Without `--unhook`, the existing interactive deletion confirmations remain in place.

With `--project --unhook`, the command removes Clooks-owned registrations for the selected agent from `.claude/settings.json`, `.codex/hooks.json`, or both, while preserving unrelated hooks. With `--global --unhook`, it does the same for `HOME/.claude/settings.json` and the effective Codex home's `hooks.json`. Codex state clears only for the matching home after an all-event remaining-reference check. Unhooking home B neither edits recorded home A nor erases A's receipt/recovery identity. Unknown-event references retain identity and block switching until explicitly repaired; a missing registration file allows matching state cleanup.

The current registration implementation also detects companion-only and
server-only remnants. Unhook removes owned companions and the selected owned
MCP server only when no remaining handler in that registration references
`clooks`; foreign servers and unrelated references are preserved. Hook and server
destinations are preflighted before mutation. Global Codex cleanup removes the
server before clearing matching receipt/recovery state, including custom homes.
If an unrelated handler requires retaining the owned server, its recorded home
and recovery state are retained too.

Cleanup scope follows the final deletion decision, whether supplied by `--full --force` or an interactive answer. Before deleting the shared `.clooks/` directory, the command inspects both agents and requires cleanup of all owned references. Interactive deletion asks for additional all-agent consent when another agent was not selected or an earlier unhook was declined. Declining or cancelling that required confirmation leaves all registrations and runtime files in that scope unchanged, including any earlier approved unhook. After agent selection is resolved, `--full --force` authorizes all-reference cleanup within the explicit project/global scope.

Full cleanup deliberately preserves `.cache/approvals-live` rather than deleting
ongoing IPC. It removes other runtime contents and removes empty parents only;
JSON includes `retainedPaths` when something remains and reports `deleted:false`
if the runtime directory still exists. Full removal refuses a root `.clooks`
symlink before registration or state mutation; it does not unlink the root or
traverse its target. Preservation is not proof that an in-flight native call
will complete, and uninstall does not bypass remaining-reference checks.

Global full deletion includes distinct effective and recorded Codex homes, with an empty legacy flag contributing the default home. Malformed/unreadable state and conflicting identities block cleanup before writes. The global additional-consent prompt names Claude's settings path and every known Codex hooks path. Prior consent to selected home B does not authorize recorded home A, even with the same Codex selector. This is a bounded set, not a directory scan or many-home registry; older unrecorded homes need explicit unhook with their own `CODEX_HOME`.

All registration files needed for an action are preflighted before writes. Invalid other-agent data blocks full deletion, but does not block independent selected-agent unhook. Owned commands on unsupported events block deletion with their file path and event names; uninstall does not expand the supported event catalog to remove them. A second all-event inspection immediately before directory deletion rejects remaining references, including ones introduced during cleanup. These checks do not provide a transaction against concurrent external writers.

Cleanup commits one registration file at a time. Successful Claude global hook
unregister is followed by retirement of its dedup flag before the fallible MCP
server commit. A failed server removal must not leave that flag suppressing the
project pipeline after global hooks are gone. Codex instead retains recovery
identity while an owned server remains. Later failures return an error and keep
the runtime/custom hooks; earlier successful writes are not rolled back.
Preserved-group counts include every action agent; unselected counts remain zero.

Without a scope flag, uninstall presents an interactive scope picker (project, global, or both). Choosing both executes project scope first, then global scope, resolving omitted agents independently in each scope. Decisions and cancellation are scoped to the current operation: completed project cleanup is not rolled back when global cleanup is declined or cancelled. No-change messages identify the scope or root to avoid implying cross-scope rollback. `--force` skips all confirmation prompts and requires explicit scope (`--project`/`--global`) and action (`--unhook`/`--full`) flags. Noninteractive use still requires force and explicit scope/action. `--json` outputs a structured result envelope with legacy Claude fields plus separate Claude/Codex counts. Its `agent` and `agents` fields report the explicit or detected selection, even when deletion requires both agents; no detected registration is `agent: null`, `agents: []`. Per-agent counts report the actual action. Never loads or validates `clooks.yml` — works even when config is broken.

For JSON compatibility, `eventsRemoved` and `nonClooksPreserved` remain Claude Code aliases. Agent-aware callers should read `claudeEventsRemoved`, `codexEventsRemoved`, `claudeNonClooksPreserved`, and `codexNonClooksPreserved`. Multi-home Codex cleanup unions removed event names in registration-catalog order and sums preserved groups across distinct files; human output names each changed path. For example, `clooks uninstall --agent codex --json` reports Codex removals in `codexEventsRemoved`; `eventsRemoved` stays empty unless Claude registrations were also removed.

## Related

- [CLI Architecture](../cli-architecture.md) — parent overview and key files
- [Engine Mode & Dispatch](./dispatch.md)
- [Command Framework](./command-framework.md)
- [Setup Commands](./commands-setup.md) — `init`, `config`, `types`, plugin installer
