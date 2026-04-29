# Clooks

A TypeScript hook runtime for Claude Code.
Write hooks once, run them safely, share them across projects and teams.

> More agents (Cursor, Windsurf, VS Code Copilot) planned.

## Why not native hooks?

Native Claude Code hooks are bash commands wired up in JSON. Every hook
reinvents argument parsing, stdin handling, and the wire format — no
types, no composition, no shared infrastructure. Clooks itself registers
as one `command` hook per event, then dispatches to your TypeScript:

```typescript
export const hook: ClooksHook = {
  meta: { name: "no-rm-rf" },
  PreToolUse(ctx) {
    if (ctx.toolName !== "Bash") return ctx.skip()
    if (ctx.toolInput.command.includes("rm -rf /")) {
      return ctx.block({ reason: "Dangerous rm" })
    }
    return ctx.allow({ updatedInput: { timeout: 60000 } })
  },
}
```

Typed contexts, structured results, multi-hook composition, and
safe defaults — all built in.

## What Clooks gives you

- **Write once, use anywhere** — TypeScript hooks with typed contexts and
  results. Author once, run on any project that vendors them.

- **Live updates** — Edits to hook files take effect on the next event.
  No session restart, no rebuild.

- **Multi-layer config** — Layer hooks at user-wide, project, and personal-local
  scopes. Each layer can shadow, extend, or disable the others.

- **Team-shareable** — Hooks live in your repo (`.clooks/`). Clone the repo,
  hooks run. No per-developer install dance.

- **Pinned third-party hooks** — Installed marketplace hooks are vendored and
  committed. No silent updates, no supply-chain surprises.

- **Errors block by default** — A crashed hook blocks the action, never silently
  passes through. Configurable per hook.

## Quick Start

```
claude plugin marketplace add codestripes-dev/clooks-marketplace
claude plugin install clooks
claude /clooks:setup
```

Install any of the [production packs](#marketplace) from the
[clooks-marketplace](https://github.com/codestripes-dev/clooks-marketplace)
repo:
```
claude plugin install clooks-core-hooks --scope user  # If you want general-purpose global hooks and installed clooks globally
claude plugin install clooks-project-hooks --scope project  # If you want general-purpose project hooks
```
Once installed as claude plugins, they'll automatically be sourced by
`clooks` once any hook runs and added to the corresponding `.clooks/clooks.yml` file (based on scope).

For manual install, see [Other install methods](#other-install-methods).

## Marketplace

Two production packs (`clooks-core-hooks`, `clooks-project-hooks`) plus `clooks-example-hooks` (a learning/reference pack — **not for productive use**).

### Bring your own marketplace

A marketplace is just a git repo with a `.claude-plugin/marketplace.json`
manifest and one or more data-only plugins. Point Claude Code at your
team's internal repo and every member gets the same hooks, auto-installed:

```
claude plugin marketplace add my-org/internal-hooks
claude plugin install <pack-name> --scope project
```

### Vendoring & updates

Installed packs are vendored into your repo under `.clooks/vendor/plugin/` and committed. Existing hooks are never updated silently.

To update hooks after a Claude marketplace plugin updates:

```bash
clooks update plugin:<pack-name>   # e.g., plugin:clooks-core-hooks
```

> New hooks added to the pack since your last vendor are pulled in and registered automatically. They are enabled by default unless the pack marks them `autoEnable: false`.

## Other install methods

<details>
<summary><b>Prebuilt binary</b></summary>

Download the binary for your platform from the GitHub releases page,
put it on your PATH, then:

```
cd /your/project
clooks init
```

Available targets: `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`.

</details>

<details>
<summary><b>Build from source</b></summary>

Requires [Bun](https://bun.sh).

```
git clone https://github.com/codestripes-dev/clooks
cd clooks
bun install && bun run build
mv dist/clooks ~/.local/bin/

cd /your/project
clooks init
```

</details>

### Global (user-wide) setup

Configure global hooks (apply to every Claude Code session):

```
clooks init --global
```

This creates `~/.clooks/` (mirroring the project layout) and registers
a global entrypoint in `~/.claude/settings.json`. Project hooks layer
on top and can override them.

### What `init` creates

```
your-project/
├── .clooks/
│   ├── clooks.yml            # Config + hook registration
│   ├── clooks.schema.json    # JSON Schema for editor validation
│   ├── bin/entrypoint.sh     # Bash entrypoint
│   └── hooks/types.d.ts      # TypeScript types for authoring
└── .claude/
    └── settings.json         # Hook registration (auto-managed)
```

`.gitignore` is updated to exclude `clooks.local.yml`, `.clooks/.cache/`,
and `.clooks/.failures`.

## Write your own hook

A hook is a single TypeScript file in `.clooks/hooks/` that exports a
`hook` object.

### 1. Scaffold the file

```
clooks new-hook --name no-rm-rf
```

### 2. Write the handler

```typescript
import type { ClooksHook } from './types'

type Config = {}

export const hook: ClooksHook<Config> = {
  meta: {
    name: 'no-rm-rf',
    description: 'Blocks dangerous rm commands',
    config: {},
  },

  PreToolUse(ctx) {
    if (ctx.toolName !== 'Bash') return ctx.skip()

    if (ctx.toolInput.command.includes('rm -rf /')) {
      return ctx.block({ reason: 'Blocked dangerous rm command' })
    }

    return ctx.allow()
  },
}
```

`ctx` is a discriminated union typed per event — for example, narrowing on `ctx.toolName` yields a typed `ctx`, so autocomplete reveals the available fields for the tool you're handling, and the response methods (like `ctx.allow()`) are narrowed to the event type. The `Config` generic ties `meta.config` defaults to the typed `config` parameter your handlers receive.

Every handler returns a result appropriate for the event — guard events (like `PreToolUse`) use `allow`/`block`/`skip`; continuation events use `continue`/`stop`; implementation events use `success`/`failure`. See [Return values](#return-values) below for the full set, plus `injectContext` for steering the agent and `updatedInput` — a **partial patch** merged onto the running `toolInput` (`null` keys are an explicit-unset sentinel; `undefined` / absent means "no change").

### 3. Register it

Add the hook name to `.clooks/clooks.yml`:

```yaml
no-rm-rf: {}
```

Clooks hooks are picked up dynamically - no reloading necessary.

### 4. Test it

Run a hook against a synthetic event without standing up Claude Code:

```bash
clooks test example PreToolUse                              # prints fixture template + field docs (not parseable JSON)
clooks test ./.clooks/hooks/no-rm-rf.ts --input fixture.json                          # exit 0 unless block/failure/stop (then 1)
clooks test ./.clooks/hooks/no-rm-rf.ts --config-json '{"threshold":7}' --input fixture.json
```

### Return values

Clooks supports most of the same return values as native Claude Code hooks:

| Method                       | Behavior                                                                      | Where it works                                                                                   |
|------------------------------|-------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------|
| `ctx.allow()`                | Proceeds; optionally patches input via `updatedInput`¹ or injects context     | Guard events (PreToolUse, UserPromptSubmit, PermissionRequest, Stop, SubagentStop, ConfigChange) |
| `ctx.block({ reason })`      | Stops the action; `reason` is shown to the agent²                             | Guard events                                                                                     |
| `ctx.skip()`                 | No opinion; pipeline continues                                                | All events                                                                                       |
| `ctx.ask({ reason })`        | Surfaces a permission prompt to the user; `reason` becomes the prompt text    | PreToolUse only                                                                                  |
| `ctx.defer()`                | Pauses the turn for `claude -p --resume`³                                     | PreToolUse only                                                                                  |
| `ctx.continue({ feedback })` | Keeps a teammate working past idle/gate; `feedback` is sent back to the model | Continuation events (TeammateIdle, TaskCreated, TaskCompleted)                                   |
| `ctx.stop({ reason })`       | Terminates a teammate                                                         | Continuation events (TeammateIdle, TaskCreated, TaskCompleted)                                   |
| `ctx.success({ path })`      | Reports the absolute path of the created worktree⁴                            | WorktreeCreate                                                                                   |
| `ctx.failure({ reason })`    | Reports a worktree-creation error to surface to the user                      | WorktreeCreate                                                                                   |
| `ctx.retry()`                | Hints that the model may retry the denied call⁵                               | PermissionDenied only                                                                            |

¹ Sequential `PreToolUse` or sequential `PermissionRequest` only. Shallow-merged onto the running `toolInput`; keys set to `null` are removed. Returning it from a parallel hook blocks the action.

² On `Stop`/`SubagentStop`, `block` forces the agent to keep going with `reason` as its next instruction rather than stopping it. On `ConfigChange` with `source: 'policy_settings'`, `block` is silently downgraded to `skip`.

³ Honored only in `-p` mode and only when the turn has a single tool call.

⁴ Replaces Claude Code's default `git worktree` behavior; the engine does not fall back to native handling.

⁵ Does not reverse the denial — the action remains blocked regardless.

Full type definitions live in `.clooks/hooks/types.d.ts`. Regenerate with:

```bash
clooks types
```

For event-specific context shapes and the four unsupported events, see the [Parity map](#parity-map).

## Configuration

Clooks reads three config files, merged at load time:

| Layer | Path | Committed? | Purpose |
|-------|------|-----------|---------|
| Home | `~/.clooks/clooks.yml` | n/a (per machine) | User-wide hooks for all your projects |
| Project | `.clooks/clooks.yml` | yes | Hooks shared with your team |
| Local | `.clooks/clooks.local.yml` | no (gitignored) | Personal overrides |

### File merge rules

Merge rules are asymmetric per field — the same three files don't apply the same strategy to every key:

| Field | Rule |
|-------|------|
| `config:` (global engine defaults) | Deep-merged across all three layers (home → project → local) |
| Hook entries (top-level keys per hook name) | Replaced atomically per hook — later layer wins for the entire entry; no partial merge |
| `events.<EventName>.order` | Home + project lists are concatenated (home first); a local entry for the same event replaces both entirely |
| `version` | Last-writer-wins (local > project > home) |

**Hook scoping constraint:** Home event `order:` lists may only reference hooks defined in `~/.clooks/clooks.yml`; project `order:` lists may only reference hooks defined in `.clooks/clooks.yml`. Clooks throws at load time if either list crosses that boundary.

### Automatic name resolution

Clooks resolves the file path from the key name:

```yaml
no-rm-rf: {}
```

Looks for `.clooks/hooks/no-rm-rf.ts`. The hook's `meta.name` must match
the YAML key — Clooks rejects the config at load time if they disagree.

### Custom names with `uses:`

Use `uses:` to register **multiple variations** of the same hook with different configs:

```yaml
log-bash-to-tmp:
  uses: ./.clooks/hooks/log-bash-commands.ts
  config:
    logDir: "/tmp/clooks"

log-bash-to-project:
  uses: ./.clooks/hooks/log-bash-commands.ts
  config:
    logDir: "logs"
```

`uses:` accepts:

- A path (`./...` or `/...`) to load any `.ts` file
- A bare hook name to alias another registered hook
- A short address (`owner/repo:hook-name`) to reference a vendored hook

### What goes in clooks.yml

```yaml
version: "1.0.0"

# Global engine defaults (applied to every hook unless overridden)
config:
  timeout: 30000        # Per-hook timeout in ms
  onError: "block"      # block | continue (per-hook can also use "trace")
  maxFailures: 3        # Consecutive failures before circuit-breaker disables the hook

# Hook registration — every hook must be listed here
no-rm-rf: {}            # Minimal: just register it

log-bash-commands:      # With overrides
  config:
    logDir: "logs"      # Override the hook's own meta.config defaults
  timeout: 5000         # Per-hook timeout
  onError: "continue"   # Don't block if this hook crashes
  parallel: true        # Run independently of the sequential pipeline
  events:
    PreToolUse:
      enabled: false    # Don't run on PreToolUse
    PostToolUse:
      onError: "trace"  # Inject errors as agent context for this event only

domain-doc-size:
  enabled: false        # Disable this hook entirely

# Optional: control execution order for an event
PreToolUse:
  order:
    - no-rm-rf
    - log-bash-commands
```

### Precedence

Two independent cascades.

**Hook config** (`config` parameter your handler receives):

| Layer | Source | Notes |
|-------|--------|-------|
| 1 (lowest) | `meta.config` defaults in the hook `.ts` file | |
| 2 (highest) | Per-hook `config:` block in `clooks.yml` | Shallow merge — nested objects are replaced wholesale, not recursively merged |

**Engine behavior** (`timeout`, `onError`, `enabled`, `parallel`):

| Layer | Source | Notes |
|-------|--------|-------|
| 1 (lowest) | Global `config:` block in `clooks.yml` | `timeout`, `onError` only |
| 2 | Per-hook entry in `clooks.yml` | All fields |
| 3 (highest) | `events.<EventName>` under the hook entry | `onError`, `enabled` only |

### Disabling a hook

Add `enabled: false` to the hook entry — typically in `clooks.local.yml`.

```yaml
no-rm-rf:
  enabled: false
```

To disable for one event only, set `enabled: false` under `events.<EventName>` instead (see the `log-bash-commands` example in [What goes in clooks.yml](#what-goes-in-clooksyml)).

For hooks vendored from a plugin pack, also include `uses:` in the local entry — the local layer replaces the project entry atomically (see [File merge rules](#file-merge-rules)), so without `uses:` the entry is dangling.

```yaml
tmux-notifications:
  uses: ./.clooks/vendor/plugin/clooks-core-hooks/tmux-notifications.ts
  enabled: false
```

### Validation

Clooks validates configuration at load time. Unknown keys, invalid hook
names, invalid event names, and type errors are rejected with clear messages
before any hook runs.

## Parity map

Clooks aims for full parity with Claude Code's native hook system. Today
it covers 22 of 26 events and all of the core return values.

<details>
<summary><b>Events</b> — 22 of 26 Claude Code events supported</summary>

| Event | Supported |
|-------|:---------:|
| `SessionStart` | ✓ |
| `SessionEnd` | ✓ |
| `InstructionsLoaded` | ✓ |
| `UserPromptSubmit` | ✓ |
| `PreToolUse` | ✓ |
| `PostToolUse` | ✓ |
| `PostToolUseFailure` | ✓ |
| `PermissionRequest` | ✓ |
| `PermissionDenied` | ✓ |
| `Stop` | ✓ |
| `StopFailure` | ✓ |
| `SubagentStart` | ✓ |
| `SubagentStop` | ✓ |
| `Notification` | ✓ |
| `PreCompact` | ✓ |
| `PostCompact` | ✓ |
| `ConfigChange` | ✓ |
| `WorktreeCreate` | ✓ |
| `WorktreeRemove` | ✓ |
| `TeammateIdle` | ✓ |
| `TaskCreated` | ✓ |
| `TaskCompleted` | ✓ |
| `CwdChanged` | ✗ * |
| `FileChanged` | ✗ * |
| `Elicitation` | ✗ * |
| `ElicitationResult` | ✗ * |

\* Planned — see [Roadmap](#roadmap).

</details>

<details>
<summary><b>Return values by event category</b></summary>

| Category | Events | `allow`/`block`/`skip` | `injectContext` | `updatedInput` | `continue`/`stop` | `success`/`failure` |
|----------|--------|:---:|:---:|:---:|:---:|:---:|
| Guard | PreToolUse, UserPromptSubmit, PermissionRequest, Stop, SubagentStop, ConfigChange | ✓ | ✓ | ✓¹ | – | – |
| Observe | PostToolUse, PostToolUseFailure, SessionStart, SessionEnd, InstructionsLoaded, Notification, SubagentStart, WorktreeRemove, PreCompact, PostCompact, PermissionDenied, StopFailure | – | ✓ | – | – | – |
| Continuation | TeammateIdle, TaskCreated, TaskCompleted | – | – | – | ✓ | – |
| Implementation | WorktreeCreate | – | – | – | – | ✓ |

¹ Sequential `PreToolUse` or sequential `PermissionRequest` only. Shallow-merged onto the running `toolInput`; keys set to `null` are removed. Returning it from a parallel hook blocks the action.

</details>

### Hook handler types

Claude Code natively supports four handler types: `command`, `http`,
`prompt`, and `agent`. Clooks runs as a `command` handler — your TypeScript
hooks execute inside the Clooks binary. The other handler types remain
available natively in `.claude/settings.json` and don't conflict with
Clooks.

## Execution model

### Ordering

When multiple hooks subscribe to the same event:

1. **Unordered parallel hooks** run first, concurrently
2. **Ordered hooks** (those listed in `events.<EventName>.order`) run in
   the specified sequence — each retains its own `parallel` setting
3. **Remaining unordered sequential hooks** run last, in registration order

### Parallel vs sequential

By default, hooks run **sequentially** — each sees the result of the
previous hook. Set `parallel: true` to run a hook concurrently with others:

```yaml
fast-logger:
  parallel: true
```

**Sequential hooks** form a pipeline:
- Each hook sees `toolInput` as modified by the previous hook
- `block` from any hook stops the pipeline immediately
- `injectContext` values accumulate across all hooks
- The original `toolInput` is always available as `ctx.originalToolInput`

**Parallel hooks** run concurrently:
- All see the same `toolInput` (state at group start)
- `block` from any hook short-circuits the rest of the batch
- `updatedInput` is forbidden on parallel `PreToolUse` **and** parallel `PermissionRequest` hooks — returning it from either is a contract violation and blocks the action

### Lifecycle hooks

`beforeHook` and `afterHook` wrap every matched event handler. Both run
once per handler invocation — a hook with three event handlers gets three
`beforeHook` / `afterHook` calls per engine run.

```typescript
export const hook: ClooksHook = {
  meta: { name: "tmux-notifications" },

  beforeHook(event) {
    if (!process.env.TMUX) return event.skip()  // skip all handlers when not in tmux
  },

  Notification(ctx) {
    // set tmux status indicator
    return ctx.skip()
  },

  PreToolUse(ctx) {
    // reset tmux status indicator
    return ctx.skip()
  },
}
```

**`beforeHook(event, config)`** — runs before each matched handler:
- `event.block({ reason })` — short-circuit; block the action
- `event.skip()` — short-circuit; skip the handler (hook is invisible to the agent)
- `return;` — proceed to the handler; optionally `event.passthrough({ debugMessage })` to surface a debug message in `--debug` output

**`afterHook(event, config)`** — runs after the handler returns. Not called if the handler throws:
- `event.handlerResult` is typed per event (narrow on `event.type` for full types)
- Observer-only — cannot mutate the handler result
- `return;` — completes; optionally `event.passthrough({ debugMessage })` to surface a debug message in `--debug` output

## Safety

### Errors block by default

Any error path blocks the action by default.

| Scenario | Default behavior |
|----------|-----------------|
| Hook throws an exception | Block |
| Hook returns an unknown result type | Block |
| Hook binary not found | Block |
| Invalid stdin JSON | Block |
| Unexpected exit code | Block |

The bash entrypoint enforces this at the outermost layer — even if the
binary crashes in an unexpected way, the action is blocked.

### onError modes

Control what happens when a hook crashes:

| Mode | Effect | Use case |
|------|--------|----------|
| `block` (default) | Action blocked, failure recorded for the circuit breaker | Security-critical hooks |
| `continue` | Action proceeds, error logged as a system message | Optional / observational hooks |
| `trace` | Error injected as agent context (visible in conversation) | Debugging during development |

Configure per-hook or per-event:

```yaml
config:
  onError: "block"          # Global default — only "block" or "continue"

my-hook:
  onError: "continue"
  events:
    PreToolUse:
      onError: "trace"      # Trace errors only on PreToolUse
```

`trace` is rejected at the global level. If `trace` is set for an event
that doesn't support agent-context injection, it falls back to `continue`
at runtime with a warning.

### Circuit breaker

After repeated consecutive failures, a hook is automatically disabled:

```
Failure 1/3 → block, record
Failure 2/3 → block, record
Failure 3/3 → disable hook, allow action, show warning
```

Tune via `maxFailures` (default `3`). Set `maxFailures: 0` to disable
the breaker entirely — the hook will block on every failure.

```yaml
my-flaky-hook:
  maxFailures: 5
  maxFailuresMessage: "Hook {hook} failed {count} times. Last: {error}"
```

Hooks that fail to load (syntax errors, missing files) are tracked by
the same breaker.

### Timeouts

Each hook is bounded by a timeout enforced inside the binary (default
30s). Override per-hook in `clooks.yml`:

```yaml
my-slow-hook:
  timeout: 60000
```

A hook that exceeds its timeout is treated like any other crash — the
`onError` mode for that hook decides whether to block, continue, or trace.

## CLI reference

<details>
<summary><b>Setup</b></summary>

| Command | Description |
|---------|-------------|
| `clooks init` | Initialize Clooks in the current project |
| `clooks init --global` | Initialize global hooks at `~/.clooks/` |
| `clooks uninstall --project` | Uninstall Clooks from the current project |
| `clooks uninstall --global` | Uninstall Clooks globally |
| `clooks uninstall --unhook` | Only remove the entrypoint from `settings.json` |
| `clooks uninstall --full` | Unhook **and** delete the `.clooks/` directory |
| `clooks uninstall --force` | Skip confirmation prompts |

</details>

<details>
<summary><b>Authoring</b></summary>

| Command | Description |
|---------|-------------|
| `clooks new-hook --name <name>` | Scaffold a new hook file (defaults to project scope) |
| `clooks new-hook --scope user` | Scaffold a global (user-scope) hook |
| `clooks types` | Extract / refresh `.clooks/hooks/types.d.ts` |
| `clooks types --global` | Extract types to `~/.clooks/hooks/` |
| `clooks test <hook> [flags]` | Run a hook against a JSON fixture event. Flags: `--input <file>` (fixture path; reads stdin if omitted), `--config <path>` / `--config-json '<json>'` (mutually exclusive — shallow-merge over `meta.config` defaults), `--hook-name <name>` (pick entry when `--config` matches multiple hooks) |
| `clooks test example <Event>` | Print fixture template + field docs for `<Event>` (prose + annotated JSON, not parseable as fixture) |

</details>

<details>
<summary><b>Inspection</b></summary>

| Command | Description |
|---------|-------------|
| `clooks config` | Show resolved configuration summary |
| `clooks config --resolved` | Show fully merged config with provenance annotations |

</details>

<details>
<summary><b>Hook packs</b></summary>

| Command | Description |
|---------|-------------|
| `clooks add <url>` | Install hooks from GitHub (blob URL = single hook, repo URL = pack) |
| `clooks add <url> --all` | Install all hooks from a pack without prompting |
| `clooks add <url> --global` | Install hooks globally to `~/.clooks/` |
| `clooks add <url> --project` | Install hooks to project `.clooks/` (default) |
| `clooks update plugin:<pack>` | Re-vendor an installed plugin pack from the plugin cache |

Examples:

```
# Install a single hook from a GitHub blob URL
clooks add https://github.com/someuser/hooks/blob/main/lint-guard.ts

# Install an entire pack from a repo URL
clooks add https://github.com/someuser/security-hooks

# Pull updates for an installed plugin pack
clooks update plugin:clooks-core-hooks
```

</details>

<details>
<summary><b>Other</b></summary>

| Command | Description |
|---------|-------------|
| `clooks --version` (or `-v`) | Print version |

</details>

All commands accept `--json` for machine-readable output.

## Environment variables

<details>
<summary><b>Full list</b></summary>

Hook results may include `debugMessage: "..."` — surfaced to stderr when `CLOOKS_DEBUG=true`.

| Variable | Effect |
|----------|--------|
| `SKIP_CLOOKS=true` | Bypass all hook processing entirely (entrypoint exits 0 immediately) |
| `CLOOKS_DEBUG=true` | Enable debug logging — stderr output + JSON request dumps to `CLOOKS_LOGDIR` |
| `CLOOKS_LOGDIR=/path` | Directory for `CLOOKS_DEBUG` JSON dumps (default: `/tmp/clooks-debug`) |
| `CLOOKS_HOME_ROOT=/path` | Override the home directory used for config resolution (mostly for tests) |
| `CLOOKS_SILENCE_STALE_PLUGIN_ADVISORIES=true` | Suppress plugin drift advisories on `SessionStart` |

</details>

## Development

<details>
<summary><b>Building</b></summary>

```
bun install
bun run build                  # Compile to dist/clooks (current platform)
bun run build:darwin-arm64     # Cross-compile for macOS ARM64
bun run build:darwin-x64       # Cross-compile for macOS x64
```

</details>

<details>
<summary><b>Testing</b></summary>

```
bun run test                   # Unit tests (co-located .test.ts files)
bun run test:e2e               # E2E suite (builds Docker base image, then runs)
bun run test:e2e:run           # Fast re-run (skips build, bind-mounts source)
bun run test:e2e:build         # Rebuild the Docker base image
bun run test:e2e:run -- test/e2e/smoke.e2e.test.ts   # Single test file
```

The Docker image contains only the base environment (Bun, deps, testuser).
Source and tests are bind-mounted at runtime; rebuild only when dependencies
change.

</details>

<details>
<summary><b>Other commands</b></summary>

```
bun run typecheck              # Type-check with tsc
bun run lint                   # ESLint
bun run lint:sh                # Shell script linting
bun run lint:all               # Both lint + lint:sh
bun run format                 # Prettier formatting
bun run format:check           # Prettier check (no write)
bun run generate:types         # Regenerate hooks/types.d.ts from source
bun run generate:schema        # Regenerate clooks.schema.json from source
```

</details>

## Roadmap

- **Remaining event parity** — `CwdChanged`, `FileChanged`, `Elicitation`,
  and `ElicitationResult` (the four events called out in the
  [Parity map](#parity-map)).
- **Cross-agent support** — Cursor, Windsurf, and VS Code Copilot. Same
  authoring model, runtime adapters per agent.

## License

MIT
