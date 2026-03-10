# Clooks

A hook runtime for AI coding agents. Write hooks in TypeScript, run them safely, share them across projects.

Starting with [Claude Code](https://docs.anthropic.com/en/docs/claude-code), with cross-agent support planned for Cursor, Windsurf, and VS Code Copilot.

> **Status:** Clooks is in active development. The core engine, CLI, and hook authoring model are functional. The marketplace, `clooks test`, and `clooks register` commands are planned but not yet implemented. Mac and Linux only.

## Why Clooks

Native hooks are raw and limited — bash scripts in JSON config, no error handling, no composition. Clooks sits between the agent's hook system and your hook scripts, adding:

- **Safety** — Fail-closed by default. A crashed hook blocks the action, never silently passes through.
- **Programmability** — TypeScript with typed contexts and results, not bash.
- **Composability** — Multiple hooks per event, parallel or sequential, with defined merge semantics.
- **Portability** — Vendored into your repo. Clone and it works.
- **Testability** — Co-located `.test.ts` files with `bun test`.

## Quick Start

```bash
# Build from source (requires Bun)
git clone <repo> && cd clooks
bun install && bun run build
# Copy dist/clooks somewhere on your PATH (e.g., ~/.local/bin/)

# Initialize in your project
clooks init

# Scaffold a hook
clooks new-hook --name my-hook

# Edit .clooks/hooks/my-hook.ts, then register it:
# Add "my-hook: {}" to .clooks/clooks.yml

# Restart Claude Code for hooks to take effect
```

After `clooks init`, your project looks like:

```
project/
├── .clooks/
│   ├── clooks.yml            # Config + hook registration
│   ├── bin/entrypoint.sh     # Bash entrypoint (registered in settings.json)
│   ├── hooks/
│   │   └── types.d.ts        # TypeScript types for hook authoring
│   └── vendor/               # Marketplace hooks (future)
├── .claude/
│   └── settings.json         # Claude Code hook registration (auto-managed)
└── .gitignore                # Updated with Clooks entries
```

`clooks init` also updates `.gitignore` to exclude `clooks.local.yml`, `.clooks/.cache/`, and `.clooks/.failures`.

## How It Works

```
Claude Code event (JSON on stdin)
  → Bash entrypoint (~1ms, fail-closed wrapper)
    → Compiled Bun binary (~15ms startup)
      → Loads config (home + project + local YAML, merged)
      → Imports all registered hook modules
      → Reads stdin JSON
      → Matches hooks for this event
      → Runs hooks (lifecycle → handler, parallel or sequential)
      → Translates result to Claude Code wire format
    → JSON response on stdout
  → Claude Code processes result
```

## Writing Hooks

A hook is a TypeScript file that exports a **named** `hook` object conforming to `ClooksHook`. Each hook declares metadata and one or more event handlers:

```typescript
import type { ClooksHook } from "./types"

export const hook: ClooksHook = {
  meta: {
    name: "no-rm-rf",
    description: "Blocks dangerous rm commands",
  },

  PreToolUse(ctx) {
    if (ctx.toolName !== "Bash") return { result: "skip" }

    const command =
      typeof ctx.toolInput.command === "string" ? ctx.toolInput.command : ""
    if (command.includes("rm -rf /")) {
      return {
        result: "block",
        reason: "Blocked dangerous rm command",
      }
    }

    return { result: "allow" }
  },
}
```

### Handler Pattern

Every handler receives `(ctx, config)` and returns a result:

```typescript
PreToolUse(ctx, config) {
  // 1. Filter — skip events you don't care about
  if (ctx.toolName !== "Bash") return { result: "skip" }

  // 2. Inspect — look at the context
  const command =
    typeof ctx.toolInput.command === "string" ? ctx.toolInput.command : ""

  // 3. Decide — return allow, block, or skip
  if (isBad(command)) {
    return { result: "block", reason: "Explanation for the agent" }
  }

  return { result: "allow" }
}
```

All results can include an optional `debugMessage` field, visible when `CLOOKS_DEBUG=true`:

```typescript
return {
  result: "allow",
  debugMessage: `checked command: ${command}`,
}
```

### Using Config

Hooks can declare typed config with defaults. Users override values in `clooks.yml` under the per-hook `config:` key (shallow-merged with `meta.config`):

```typescript
import type { ClooksHook } from "./types"
import { appendFileSync, mkdirSync, existsSync } from "fs"
import { join } from "path"

type Config = { logDir: string }

export const hook: ClooksHook<Config> = {
  meta: {
    name: "log-bash-commands",
    config: { logDir: ".clooks" }, // Defaults
  },

  PreToolUse(ctx, config) {
    if (ctx.toolName !== "Bash") return { result: "skip" }

    const command =
      typeof ctx.toolInput.command === "string" ? ctx.toolInput.command : ""

    try {
      const logFile = join(config.logDir, "hook.log")
      if (!existsSync(config.logDir)) mkdirSync(config.logDir, { recursive: true })
      appendFileSync(logFile, `[${new Date().toISOString()}] ${command}\n`)
    } catch {
      // Don't block on logging failures
    }

    return { result: "allow" }
  },
}
```

```yaml
# clooks.yml — override the default
log-bash-commands:
  config:
    logDir: "logs"
```

### Injecting Context

Hooks on [injectable events](#injectable-events) can inject text into the agent's conversation using `injectContext`. This is useful for adding warnings, reminders, or diagnostic info without blocking:

```typescript
PreToolUse(ctx) {
  const lines = countLines(ctx.toolInput)
  if (lines > 150) {
    return {
      result: "allow",
      injectContext: `Warning: file is ${lines} lines. Consider splitting.`,
    }
  }
  return { result: "allow" }
}
```

### Modifying Tool Input

`PreToolUse` hooks can modify the tool's input before it executes:

```typescript
PreToolUse(ctx) {
  if (ctx.toolName !== "Bash") return { result: "skip" }

  return {
    result: "allow",
    updatedInput: {
      ...ctx.toolInput,
      timeout: 30000, // Add a timeout
    },
  }
}
```

When hooks run sequentially, each hook sees the `toolInput` as modified by previous hooks. The original is always available as `ctx.originalToolInput`.

> `updatedInput` is only allowed in sequential hooks. Returning it from a parallel hook is a contract violation and will block the action.

## Events

Clooks supports all 18 Claude Code hook events, organized into four categories:

### Guard Events

Intercept actions **before** they happen. Can `allow`, `block`, or `skip`.

| Event | When It Fires |
|-------|--------------|
| `PreToolUse` | Before a tool executes (Bash, Read, Write, Edit, etc.) |
| `UserPromptSubmit` | User submits a prompt |
| `PermissionRequest` | Permission dialog appears |
| `Stop` | Stop button pressed |
| `SubagentStop` | Subagent stopped |
| `ConfigChange` | Config file changed |

### Observe Events

Fire **after** actions complete. Cannot block (the action already happened). Returning `{ result: "block" }` from an observe hook is silently converted to a context message or system message — the action is not reversed.

| Event | When It Fires |
|-------|--------------|
| `PostToolUse` | After successful tool execution |
| `PostToolUseFailure` | After failed tool execution |
| `SessionStart` | Session begins |
| `SessionEnd` | Session ends |
| `InstructionsLoaded` | Instructions file loaded |
| `Notification` | Notification displayed |
| `SubagentStart` | Subagent started |
| `WorktreeRemove` | Worktree deleted |
| `PreCompact` | Before transcript compaction |

### Continuation Events

Decide whether ongoing operations should continue. Return `continue`, `stop`, or `skip`.

| Event | When It Fires |
|-------|--------------|
| `TeammateIdle` | Teammate became idle |
| `TaskCompleted` | Task completed |

### Implementation Events

Perform work on behalf of the agent. Return `success` or `failure`.

| Event | When It Fires |
|-------|--------------|
| `WorktreeCreate` | Worktree creation requested |

### Injectable Events

Only these events support `injectContext` (text injected into the agent's conversation). Returning `injectContext` on other events is silently ignored.

`PreToolUse`, `UserPromptSubmit`, `SessionStart`, `PostToolUse`, `PostToolUseFailure`, `Notification`, `SubagentStart`

## Configuration

### clooks.yml

```yaml
version: "1.0.0"

# Global defaults (engine behavior, not hook-specific config)
config:
  timeout: 30000        # Per-hook timeout in ms (default: 30000)
  onError: "block"      # What happens when a hook crashes (default: "block")
  maxFailures: 3        # Consecutive failures before a hook is disabled (default: 3)
  maxFailuresMessage: "Hook {hook} failed {count} times on {event}. Last: {error}"

# Hook registration — every hook must be listed here
my-guard-hook: {}                    # Minimal (just register it)

log-bash-commands:                   # With overrides
  config:
    logDir: "logs"                   # Override hook's meta.config default
  timeout: 5000                      # Per-hook timeout
  onError: "continue"               # Don't block if this hook crashes
  parallel: true                     # Run independently of sequential pipeline

domain-doc-size:
  onError: "block"                   # Block on crash (default anyway)
  events:
    PreToolUse:
      onError: "trace"              # But only trace errors for this specific event

# Event ordering (optional)
PreToolUse:
  order:
    - my-guard-hook
    - log-bash-commands
    - domain-doc-size
```

### Config Cascade

There are two separate config systems:

**Hook config** (the data your handler receives as the `config` parameter):
1. **Hook defaults** — `meta.config` in the hook file (lowest precedence)
2. **Per-hook `config:` in clooks.yml** — Shallow-merged over hook defaults

**Engine behavior** (how the engine runs your hook):
1. **Global `config:` in clooks.yml** — `timeout`, `onError`, `maxFailures`
2. **Per-hook options** — `timeout`, `onError`, `parallel`, `maxFailures` on the hook entry
3. **Per-hook per-event** — `events.PreToolUse.onError` (highest precedence)

> Note: `meta.config` is shallow-merged with the per-hook `config:` override. If your `meta.config` has nested objects and the user overrides one key, the entire nested object is replaced, not deep-merged.

### Three Config Layers

Clooks supports three overlapping config files, merged at load time:

| Layer | Path | Committed | Purpose |
|-------|------|-----------|---------|
| Home | `~/.clooks/clooks.yml` | N/A | Global hooks for all projects |
| Project | `.clooks/clooks.yml` | Yes | Project-specific hooks |
| Local | `.clooks/clooks.local.yml` | No (gitignored) | Personal overrides |

Project hooks with the same name as home hooks **shadow** (replace) them. Local overrides can only modify existing hooks — they cannot define new ones.

## Execution Model

### Ordering

When no `order` list is specified, parallel hooks run first (concurrently), then sequential hooks run in registration order.

When an `order` list is specified for an event:
1. **Unordered parallel hooks** run first, concurrently
2. **Ordered hooks** run in the specified sequence (each retains its own `parallel` setting)
3. **Remaining unordered sequential hooks** run last

### Parallel vs Sequential

By default, hooks run **sequentially** — each sees the result of the previous one. Set `parallel: true` to run a hook concurrently with others:

```yaml
fast-logger:
  parallel: true    # Runs independently, doesn't block the pipeline
```

**Sequential hooks** form a pipeline:
- Each hook sees `toolInput` as modified by the previous hook
- `block` from any hook stops the pipeline immediately
- `injectContext` values accumulate across all hooks

**Parallel hooks** run concurrently:
- All see the same `toolInput` (the state at group start)
- `block` from any hook short-circuits the batch via `AbortSignal`
- Cannot return `updatedInput` (contract violation → blocked)

### Lifecycle Hooks

Every hook can optionally define `beforeHook` and `afterHook` to wrap all event handlers. Both receive `(event, config)`:

```typescript
export const hook: ClooksHook = {
  meta: { name: "env-gate" },

  beforeHook(event, config) {
    // Runs before the matched handler.
    // Call respond() to block early — handler is skipped entirely.
    // beforeHook can ONLY block, not allow or skip.
    if (event.type === "PreToolUse" && event.meta.gitBranch === "production") {
      event.respond({
        result: "block",
        reason: "Hooks disabled on production branch",
      })
    }
  },

  PreToolUse(ctx) {
    return { result: "allow" }
  },

  afterHook(event, config) {
    // Runs after the handler completes normally (not on throw).
    // Call respond() to override the handler's result.
    console.log(`${event.type} completed`)
  },
}
```

`beforeHook` receives a `BeforeHookEvent` with:
- `event.type` — The event name (`"PreToolUse"`, `"SessionStart"`, etc.)
- `event.input` — The context object for this event
- `event.meta` — Hook metadata (git root, branch, platform, hook name/path, timestamp)
- `event.respond(result)` — Call to block; handler is skipped. Only accepts a block result.

`afterHook` receives an `AfterHookEvent` with the same fields plus:
- `event.handlerResult` — What the handler returned
- `event.respond(result)` — Call to override the handler's result with any valid result

`afterHook` only runs when the handler returns normally — if the handler throws, `afterHook` is not called.

## Safety

### Fail-Closed by Default

Every error path blocks the action unless explicitly configured otherwise:

| Scenario | Default Behavior |
|----------|-----------------|
| Hook throws an exception | Block the action |
| Hook returns unknown result type | Block the action |
| Binary not found | Block the action |
| Invalid stdin JSON | Block the action |
| Unexpected exit code | Block the action |

The bash entrypoint enforces this at the outermost layer — even if the binary crashes in an unexpected way, the action is blocked.

**Exception:** Entrypoint timeouts are deliberately fail-open. See [Timeouts](#timeouts).

### onError Modes

Control what happens when a hook crashes:

| Mode | Effect | Use Case |
|------|--------|----------|
| `"block"` (default) | Action blocked, failure recorded in circuit breaker | Security-critical hooks |
| `"continue"` | Action proceeds, error logged as system message | Optional/observational hooks |
| `"trace"` | Error injected as `additionalContext` (visible to agent) | Debugging during development |

Configure per-hook or per-event. `"trace"` is **not valid at the global level** (validation will reject it):

```yaml
config:
  onError: "block"          # Global default ("block" or "continue" only)

my-hook:
  onError: "continue"       # This hook's crashes won't block
  events:
    PreToolUse:
      onError: "trace"      # Trace errors only for PreToolUse
```

If `"trace"` is configured for an event that doesn't support `additionalContext` (not in the [injectable events](#injectable-events) list), it falls back to `"continue"` at runtime with a warning.

### Circuit Breaker

After repeated consecutive failures, a hook is automatically disabled rather than repeatedly blocking work:

```
Failure 1/3 → block action, record failure
Failure 2/3 → block action, record failure
Failure 3/3 → disable hook, allow action, show warning
             (hook stays disabled until a successful run resets the counter)
```

The threshold is configurable via `maxFailures` (default: 3). Setting `maxFailures: 0` disables the circuit breaker entirely — the hook will always block on failure, no matter how many times.

```yaml
my-flaky-hook:
  maxFailures: 5                    # More tolerance before disabling
  maxFailuresMessage: "Hook {hook} failed {count} times. Last: {error}"
```

### Timeouts

Two layers of timeout protection:

| Layer | Default | Override |
|-------|---------|---------|
| Per-hook (in binary) | 30s | `timeout:` in clooks.yml |
| Entrypoint (bash wrapper) | 5s | `CLOOKS_TIMEOUT` env var |

If the entire binary times out, the entrypoint **allows the action** rather than blocking. This is a deliberate exception to the fail-closed default: a timeout indicates Clooks itself is misbehaving, not that the action is dangerous. The agent should not be blocked by infrastructure failures.

## Common Mistakes

**Using `export default` instead of a named export.** The hook file must use `export const hook = { ... }`. A default export will fail to load with: *"does not export a `hook` named export"*.

**Hook name mismatch.** The `meta.name` in your hook file must exactly match the key in `clooks.yml`. If you register `my-hook: {}` but your file has `meta: { name: "myHook" }`, the hook will fail to load.

**Forgetting to register in `clooks.yml`.** A `.ts` file in `.clooks/hooks/` that isn't listed in `clooks.yml` will be silently ignored. There is no auto-discovery — every hook must be registered.

**Importing npm packages.** Hook files are loaded directly by the Bun runtime, not bundled. Bare npm imports like `import { z } from "zod"` will fail unless the package is available in the runtime's module resolution path.

## CLI Reference

| Command | Description |
|---------|-------------|
| `clooks init` | Initialize Clooks in the current project |
| `clooks init --global` | Initialize global hooks at `~/.clooks/` |
| `clooks new-hook --name <name>` | Scaffold a new hook file |
| `clooks new-hook --scope user` | Scaffold a global (user-scope) hook |
| `clooks config` | Show resolved configuration summary |
| `clooks config --resolved` | Show full config with provenance annotations |
| `clooks types` | Extract/refresh `types.d.ts` for hook authoring |
| `clooks register` | Register a local hook *(not yet implemented)* |
| `clooks test` | Test hooks with synthetic events *(not yet implemented)* |
| `clooks --version` | Print version |

All commands support `--json` for machine-readable output.

## Global Hooks

Run `clooks init --global` once per machine to set up hooks that apply to every project:

```bash
clooks init --global
```

This creates `~/.clooks/` with the same structure as project hooks, plus a `.global-entrypoint-active` flag. When this flag exists, project entrypoints become no-ops — the global entrypoint handles the merged pipeline, avoiding duplicate hook execution.

Global and project configs merge at load time:
- **Hooks**: Project hooks shadow (replace) global hooks with the same name
- **Event order**: Global order runs first, then project order. Each layer's order can only reference hooks defined in that layer.
- **Config**: Deep-merged (project overrides global)

## Environment Variables

| Variable | Effect |
|----------|--------|
| `SKIP_CLOOKS=true` | Bypass all hook processing entirely |
| `CLOOKS_DEBUG=true` | Enable debug logging (stderr + agent context) |
| `CLOOKS_TIMEOUT=10` | Override entrypoint timeout in seconds (default: 5) |
| `CLOOKS_HOME_ROOT=/path` | Override home directory for config resolution |
| `CLOOKS_LOGDIR=/path` | Directory for debug JSON logs (default: `/tmp/clooks-debug`) |

## License

TBD
