# Cross-Agent Hooks — Scoping Hooks to Agents

How a hook opts out of running under a particular agent, and what the engine actually does with an excluded hook at runtime. Part of [Cross-Agent Hooks](../cross-agent-hooks.md); see also `docs/domain/config/agents.md` for the yaml-side cascade, validation and layering reference.

## Two ways to restrict a hook

A hook author restricts their own hook with `meta.agents`:

```typescript
import type { ClooksHook } from './types'

export const hook: ClooksHook = {
  meta: {
    name: 'prefer-claude-grep',
    description: 'Tells the model to use Claude Code\'s built-in Grep tool',
    agents: ['claude-code'],
  },
  SessionStart(ctx) {
    return ctx.skip({ injectContext: 'Use the built-in Grep tool instead of grep/rg.' })
  },
}
```

A user restricts (or re-includes) any hook from `clooks.yml`, without touching the hook's source — globally, per hook, or per hook and event:

```yaml
version: "1.0.0"

config:
  agents: [claude-code]       # fallback default for hooks that declare none

only-codex:
  agents: [codex]              # this hook's own allowlist, hook-wide

everywhere:
  agents: [claude-code, codex] # explicit both, overriding any global default

scoped-per-event:
  events:
    PreToolUse:
      agents: [codex]          # only PreToolUse is restricted; other events on
                                # this hook fall through to meta.agents / config.agents
```

Prefer `meta.agents` when the hook should never make sense under an agent (the example above — a hook that only means something under Claude Code's own built-in tools). Keep `ctx.agent === 'codex'` branching for hooks that run under every agent but whose *behavior* differs — most of this repository's own vendored hooks do that instead (`prefer-builtin-tools.ts`, `no-compound-commands.ts`): the hook still runs everywhere, it just says something different.

## Precedence

Exactly one list governs a hook for a given event. Most specific wins and **replaces** the rest — nothing is intersected:

1. `events.<Event>.agents` (yaml, per hook, per event)
2. hook entry `agents` (yaml, hook-wide)
3. `meta.agents` (hook author, hook-wide)
4. `config.agents` (yaml, global fallback)
5. none of the above — every agent

The ordering means a project-wide `config.agents` default can never defeat an author's `meta.agents` — it only fills in for hooks that declare no allowlist at all — while a hook-specific yaml `agents:` line silently overrides the author, because that is deliberate user intent. An alias entry (a yaml entry whose `uses:` names another hook) resolves against its *own* yaml levels and the *imported implementation's* `meta.agents`; the target entry's yaml `agents` is not inherited, matching how aliases already work for every other per-hook cascade.

Any string id is accepted by validation, not only `claude-code` and `codex`. An id this version does not recognize is simply never the invoking agent, so a list made entirely of unknown ids matches nothing and does not fall through to a broader level — see `docs/domain/config/agents.md` § Unknown ids for the collected `SessionStart` warning this produces.

## What "excluded" means at runtime

An agent-excluded hook is still imported: import-time side effects still happen, and an import that throws still counts as a load error and still blocks (or degrades, per the circuit breaker) exactly as it would for an agent that runs the hook. Only the matched handler — and that hook's `beforeHook` / `afterHook` — never execute. Concretely, for the excluded agent:

- The hook never appears in the matched list for that event, so it records no turn result, no handoff, and no runtime failure count for that invocation.
- An `order:` list naming the hook stays valid — the name is silently skipped, the same way `enabled: false` names are skipped, so one `order:` list works under every agent.
- No startup warning is produced for the exclusion itself. A correct, working config would otherwise warn on every session of the other agent, which would be noise rather than signal. (Unrecognized agent ids still produce their own, separate `SessionStart` warning — see Precedence above.)

With `CLOOKS_DEBUG=true`, an excluded hook produces exactly one debug line naming the level that decided it:

```
hook "x" skipped for agent "codex" via clooks.yml events.PreToolUse.agents
hook "x" skipped for agent "codex" via clooks.yml hook agents
hook "x" skipped for agent "codex" via hook meta.agents
hook "x" skipped for agent "codex" via clooks.yml config.agents
```

`enabled: false` stays an independent veto throughout: agent inclusion can never enable a disabled hook, and inclusion never creates a handler a hook doesn't have.

## The reserved `agent` context key

Every context object is built by spreading the upstream wire payload and then setting `agent: adapter.id` on top, so `agent` is a reserved key at the top level of a hook's context: an upstream payload field literally named `agent` would be silently overwritten by the invoking-agent id. This is unrelated to the subagent identity fields `agentId` and `agentType`, which name a *child* agent and pass through untouched.

## `clooks test` does not simulate this

`clooks test` dispatches a handler directly against a synthetic context; it does not run `matchHooksForEvent()` and does not simulate agent scoping at all. A fixture's `agent` field only changes what the handler reads at `ctx.agent` — it never causes the harness to skip the handler. See `docs/domain/testing/hook-author-testing/invocation-and-shape.md`.

## Related

- [Cross-Agent Hooks](../cross-agent-hooks.md) — parent overview and agent comparison
- `docs/domain/config/agents.md` — the yaml-side cascade, validation messages, and layering across home/project/local config
- `docs/domain/config/execution.md` — the `order:` list silent-skip exception
- `docs/domain/global-hooks.md` — the unknown-agent-id `SessionStart` warning, alongside the shadow-hooks warning
