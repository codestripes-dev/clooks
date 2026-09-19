# Config — Agents

`agents` restricts which invoking agent (`claude-code`, `codex`) runs a hook. It is an allowlist only — there is no denylist form.

## Overview

`agents` can be set in four places:

- `config.agents` in the global `config:` block — a fallback default for hooks that declare no allowlist of their own.
- A hook entry's own `agents:` in `clooks.yml`.
- A hook entry's `events.<Event>.agents:` in `clooks.yml` — per event, on top of the hook-wide value.
- A hook author's `meta.agents` in the hook's `.ts` file — hook-wide only, no per-event form in `meta`.

Every position accepts a non-empty array of non-empty strings. Any string validates, not just the ids this version recognizes (`claude-code`, `codex`) — see Unknown ids below.

## Precedence

Exactly one list governs a hook for a given event. Most specific wins and **replaces** the rest — nothing is intersected or merged:

1. `events.<Event>.agents` (yaml, per hook, per event)
2. hook entry `agents` (yaml, hook-wide)
3. `meta.agents` (hook author, hook-wide)
4. `config.agents` (yaml, global fallback)
5. none of the above — the hook runs under every agent

Two consequences of "replaces, most specific first, not intersected":

- **The global fallback can never override an author's `meta.agents`.** `config.agents` only applies when nothing more specific is set for that hook and event. A hook whose `meta.agents` says `['claude-code']` still does not run under Codex even when `config.agents: [codex]` is set project-wide.
- **A per-hook yaml line silently overrides the author.** Adding `agents: [codex]` to that same hook's yaml entry makes it run under Codex, discarding `meta.agents` for that hook entirely — this is deliberate user intent, not a bug, and produces no warning.

For an **alias entry** (a yaml entry whose `uses:` names another hook's implementation), the chain resolves against the alias's *own* yaml `agents`/`events.<Event>.agents` and the *imported implementation's* `meta.agents`. The target entry's own yaml `agents` is never inherited — aliases are already independent hooks for every other cascade (ordering, circuit breaker, error tracking), and this follows the same rule.

`enabled: false` is an independent veto: agent inclusion can never enable a disabled hook, and a hook excluded by `agents` never gains a handler it doesn't have. The two concepts don't interact.

## Unknown ids

The schema accepts any non-empty string so a `clooks.yml` written for a future clooks version — one that adds a new agent id — keeps validating under this version. Ids this version does not recognize are simply never the current agent: a list made up entirely of unknown ids matches nothing, and (per the replacement rule above) does **not** fall through to a broader level.

Every unknown id across `config.agents`, every hook entry's `agents`, every per-event override, and every loaded hook's `meta.agents` is collected and reported once, at `SessionStart`, as a single collapsed, deduplicated, alphabetically sorted line:

```
clooks: unknown agent ids in agents lists (ignored): cursor, windsurf
```

This warning is independent of matching — it is built from the whole config and every loaded hook's metadata, not from what actually ran, so it still fires even when zero hooks are registered or nothing matches the current event.

A hook being excluded for the current agent is, by contrast, silent — it produces no startup warning (see `docs/domain/config/execution.md`).

## Validation

`agents: []` and non-string elements are rejected. The exact messages:

- Global config: `clooks: global config "agents" must be a non-empty array of agent id strings`
- Hook entry: `clooks: hook "<name>" has invalid "agents": must be a non-empty array of agent id strings`
- Per-event override: `clooks: hook "<name>" events.<Event> "agents" must be a non-empty array of agent id strings`
- Hook `meta.agents` (checked at load time, not config validation — a malformed value is a load error naming the file): `clooks: <hookPath> hook.meta.agents must be a non-empty array of agent id strings`

`agents` is a known key at all three yaml positions (global, hook entry, per-event override) but is **not** accepted on a top-level event entry — `PreToolUse: { agents: [...] }` is rejected as an unknown key; only `order` is valid there. Scope a per-event allowlist through the owning hook's `events.<Event>.agents` instead.

## Layering across home/project/local

`config.agents` follows the same three-layer merge as the rest of the global `config:` block (see `docs/domain/config.md` § Config Merging): a layer that sets `agents` replaces it outright (arrays are never concatenated); a layer that omits it inherits whatever the layer below resolved to. It does not reset to "every agent" just because a later layer is silent on it.

Hook entries replace atomically, same as every other hook-entry field: a project or local entry for the same hook name discards the entire lower-layer entry, including its `agents` — so shadowing a hook without repeating `agents` loses the allowlist along with everything else. This is the existing atomic-replacement rule (see `docs/domain/config.md` § Disabling Hooks for the same gotcha with `enabled`), not something new to `agents`.

## Debug output

With `CLOOKS_DEBUG=true`, an excluded hook produces one line naming the deciding level:

```
hook "x" skipped for agent "codex" via clooks.yml events.PreToolUse.agents
hook "x" skipped for agent "codex" via clooks.yml hook agents
hook "x" skipped for agent "codex" via hook meta.agents
hook "x" skipped for agent "codex" via clooks.yml config.agents
```

## Related

- `docs/domain/config.md` — Hook entry, global config, and event entry field tables; the other option cascades (`timeout`, `onError`, `handoff`); three-layer merge rules.
- `docs/domain/config/execution.md` — Why an `agents`-excluded name in an `order:` list stays valid instead of throwing.
- `docs/domain/cross-agent-hooks.md` — Worked yaml/meta example, and what "excluded but still imported" means for a hook whose import has side effects.
