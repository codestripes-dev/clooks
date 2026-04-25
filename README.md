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
    if (ctx.toolInput.command?.includes("rm -rf /")) {
      return ctx.block({ reason: "Dangerous rm" })
    }
    return ctx.allow({ updatedInput: { timeout: 60000 } })
  },
}
```

Typed contexts, structured results, multi-hook composition, and
fail-closed defaults — all built in.

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

- **Fail-closed by default** — A crashed hook blocks the action, never silently
  passes through. Configurable per hook.

## Quick Start

If you prefer to use plugins for Claude Code, this is the fastest path:

```
claude plugin marketplace add codestripes-dev/clooks-marketplace
claude plugin install clooks
claude plugin install clooks-core-hooks --scope user
claude plugin install clooks-project-hooks --scope project
```

Reload Claude Code, then run `/clooks:setup` when prompted. The six core
hooks are active immediately. The three project-configured hooks need a
few lines in `clooks.yml` before they activate.

Prefer to install manually? See [Other install methods](#other-install-methods).

## Marketplace

The Quick Start above installs hooks from
[clooks-marketplace](https://github.com/codestripes-dev/clooks-marketplace) —
the runtime plus two packs (`clooks-core-hooks`, `clooks-project-hooks`)
covering 9 production-ready hooks. Browse the repo for the full catalog
and per-hook configuration.

### Bring your own marketplace

A marketplace is just a git repo with a `.claude-plugin/marketplace.json`
manifest and one or more data-only plugins. Point Claude Code at your
team's internal repo and every member gets the same hooks, auto-installed:

```
claude plugin marketplace add my-org/internal-hooks
claude plugin install <pack-name> --scope project
```

The same mechanism lets you ship hooks alongside an open-source project
(enforce project conventions for contributors), distribute security
hooks org-wide, or share a personal toolbox across machines.

### Vendoring & updates

Installed packs are vendored into your repo under `.clooks/vendor/plugin/`
and committed. Updates never happen silently — after the plugin cache
refreshes (e.g., via `claude plugin update`), run
`clooks update plugin:<pack-name>` to pull the new version into your
vendor directory, then review the diff before committing.

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

In addition to project hooks, you can also configure global hooks that
apply to every Claude Code session, regardless of project:

```
clooks init --global
```

This creates `~/.clooks/` (mirroring the project layout) and registers
a global entrypoint in `~/.claude/settings.json`. Project hooks layer
on top and can override them.

The `/clooks:setup` skill prompts you for this automatically. With the
prebuilt or source paths, run it manually.

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
`hook` object. Three steps:

### 1. Scaffold the file

```
clooks new-hook --name no-rm-rf
```

This creates `.clooks/hooks/no-rm-rf.ts` with a starter template.

### 2. Write the handler

```typescript
import type { ClooksHook } from "./types"

export const hook: ClooksHook = {
  meta: {
    name: "no-rm-rf",
    description: "Blocks dangerous rm commands",
  },

  PreToolUse(ctx) {
    if (ctx.toolName !== "Bash") return ctx.skip()

    const command =
      typeof ctx.toolInput.command === "string" ? ctx.toolInput.command : ""

    if (command.includes("rm -rf /")) {
      return ctx.block({ reason: "Blocked dangerous rm command" })
    }

    return ctx.allow()
  },
}
```

Every handler receives `(ctx, config)` and returns a result appropriate
for the event — guard events (like `PreToolUse`) use `allow`/`block`/`skip`;
continuation events use `continue`/`stop`; implementation events use
`success`/`failure`. See [Return values](#return-values) below for the
full set, plus `injectContext` for steering the agent and `updatedInput`
— a **partial patch** merged onto the running `toolInput` (`null` keys
are an explicit-unset sentinel; `undefined` / absent means "no change").

### 3. Register it

Add the hook name to `.clooks/clooks.yml`:

```yaml
no-rm-rf: {}
```

Reload Claude Code. Done.

### Return values

Clooks supports most of the same return values as native Claude Code hooks:

| Return value | What it does | Where it works |
|--------------|-------------|----------------|
| `result: "allow"` | Lets the action proceed | All guard events |
| `result: "block", reason` | Stops the action; `reason` is shown to the agent | All guard events |
| `result: "skip"` | This hook has no opinion; pipeline continues | All events |
| `result: "continue"` / `"stop"` | Continue or halt an ongoing operation | Continuation events (TeammateIdle, TaskCreated, TaskCompleted) |
| `result: "success"` / `"failure"` | Report outcome of work performed on the agent's behalf | Implementation events (WorktreeCreate) |
| `injectContext: "..."` | Adds text to the agent's conversation | PreToolUse, UserPromptSubmit, SessionStart, PostToolUse, PostToolUseFailure, Notification, SubagentStart |
| `updatedInput: { ... }` | Partial patch merged onto the running `toolInput`; keys set to `null` are unset post-merge, `undefined` / absent keys are left unchanged | Sequential PreToolUse or PermissionRequest |

Clooks-specific extras layered on top:

- **Typed config** from `clooks.yml` — declare `config: {...}` on `meta`, type with `ClooksHook<MyConfig>`
- **Lifecycle hooks** — define `beforeHook(event, config)` / `afterHook(event, config)` to wrap every handler
- **Debug payloads** — return `debugMessage: "..."` from any result; surfaced when `CLOOKS_DEBUG=true`

Full type definitions live in `.clooks/hooks/types.d.ts` (generated by
`clooks types`). For event-specific context shapes and the four unsupported
events, see the [Parity map](#parity-map).

## Configuration

Clooks reads three config files, merged at load time:

| Layer | Path | Committed? | Purpose |
|-------|------|-----------|---------|
| Home | `~/.clooks/clooks.yml` | n/a (per machine) | User-wide hooks for all your projects |
| Project | `.clooks/clooks.yml` | yes | Hooks shared with your team |
| Local | `.clooks/clooks.local.yml` | no (gitignored) | Personal overrides |

Project hooks shadow home hooks with the same name. Local overrides can
modify existing hooks or add new ones.

### Automatic name resolution

Register a hook by its name in `clooks.yml` and Clooks resolves the file
path automatically:

```yaml
no-rm-rf: {}
```

Looks for `.clooks/hooks/no-rm-rf.ts`. The hook's `meta.name` must match
the YAML key — Clooks rejects the config at load time if they disagree.

### Custom names with `uses:`

Use `uses:` to register a hook under a different name — useful when you
want **multiple variations** of the same hook with different configs:

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

Both entries load the same hook file but run as independent registrations
with their own configs. `uses:` accepts:

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

Two separate cascades:

**Hook config** — what your handler receives as the `config` parameter:
1. Hook defaults (`meta.config` in the `.ts` file)
2. Per-hook `config:` in `clooks.yml` (shallow-merged)

**Engine behavior** — how the engine runs the hook:
1. Global `config:` in `clooks.yml`
2. Per-hook options on the hook entry
3. Per-hook per-event under `events.<EventName>` (highest)

> Shallow merge means nested objects in `meta.config` are replaced wholesale
> when overridden, not deep-merged.

### Disabling a vendored hook

To stop a vendored plugin hook from running in one project without
uninstalling the plugin, shadow it in `.clooks/clooks.local.yml`:

```yaml
<hookName>:
  uses: ./.clooks/vendor/plugin/<packName>/<hookName>.ts
  enabled: false
```

The `uses:` field is required — the local layer atomically replaces the
project entry, so without `uses` the hook would be skipped as dangling.

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
| Guard | PreToolUse, UserPromptSubmit, PermissionRequest, Stop, SubagentStop, ConfigChange | ✓ | ✓¹ | ✓² | – | – |
| Observe | PostToolUse, PostToolUseFailure, SessionStart, SessionEnd, InstructionsLoaded, Notification, SubagentStart, WorktreeRemove, PreCompact, PostCompact, PermissionDenied, StopFailure | – | ✓¹ | – | – | – |
| Continuation | TeammateIdle, TaskCreated, TaskCompleted | – | – | – | ✓ | – |
| Implementation | WorktreeCreate | – | – | – | – | ✓ |

¹ Only on injectable events: PreToolUse, UserPromptSubmit, SessionStart, PostToolUse, PostToolUseFailure, Notification, SubagentStart. Returning `injectContext` on other events is silently ignored.

² Sequential `PreToolUse` or sequential `PermissionRequest` only. `updatedInput` is a **partial patch** — the engine shallow-merges it onto the running `toolInput`, then strips keys whose value is `null` (the explicit-unset sentinel). `undefined` / absent keys mean "no change on this key." Upstream Claude Code still receives a full replacement object on the wire — the engine performs the merge internally. Returning `updatedInput` from a parallel `PreToolUse` **or** parallel `PermissionRequest` hook is a contract violation and blocks the action.

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

`beforeHook` and `afterHook` wrap every event handler in the hook. The
common use case for `beforeHook` is a shared early-exit check that all
handlers would otherwise have to repeat — for example, skipping every
event when the hook isn't applicable to the current environment:

```typescript
export const hook: ClooksHook = {
  meta: { name: "tmux-notifications" },

  beforeHook(event) {
    // Skip every handler when we're not running inside tmux.
    if (!process.env.TMUX) {
      event.respond({ result: "skip" })
    }
  },

  Notification(ctx) {
    setTmuxStatus("attention")
    return ctx.skip()
  },

  PreToolUse(ctx) {
    resetTmuxStatus()
    return ctx.skip()
  },
}
```

`beforeHook` can `block` or `skip` — when it calls `event.respond()`, the
matched handler is never invoked. `afterHook` runs after the handler
returns normally (not on throw) and can call `event.respond()` to
override the result with anything.

## Safety

### Fail-closed by default

Clooks relies on hooks being correctly configured to keep an AI agent in
check. Any error path therefore blocks the action by default — a hook
that crashes, misbehaves, or returns garbage must not silently let the
agent through, since that's exactly the situation a hook was supposed
to catch.

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

After repeated consecutive failures, a hook is automatically disabled
rather than repeatedly blocking work:

```
Failure 1/3 → block, record
Failure 2/3 → block, record
Failure 3/3 → disable hook, allow action, show warning
             (stays disabled until a successful run resets the counter)
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
Source and tests are bind-mounted at runtime, so `test:e2e:run` picks up
changes instantly without a rebuild. Only run `test:e2e:build` when
dependencies change.

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
