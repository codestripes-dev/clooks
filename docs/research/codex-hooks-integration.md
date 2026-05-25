# Codex Hooks Integration Research

**Date:** 2026-05-17
**Status:** exploratory
**Prompted by:** roadmap goal to make Clooks a general-purpose hook framework across Claude Code and Codex

## Question

What is the current shape of Codex hooks, and can Clooks support them with a translation layer without changing the existing hook authoring surface?

## Sources

- OpenAI Codex hooks docs: https://developers.openai.com/codex/hooks
- OpenAI Codex config basics: https://developers.openai.com/codex/config-basic
- OpenAI Codex generated hook schemas: https://github.com/openai/codex/tree/main/codex-rs/hooks/schema/generated
- OpenAI Codex repository config stub: https://raw.githubusercontent.com/openai/codex/main/docs/config.md
- Local Clooks config and engine code, especially `src/config/constants.ts`, `src/engine/run.ts`, `src/engine/execute.ts`, `src/engine/translate.ts`, and `src/types/results.ts`

## Summary

Codex hooks are close enough to Claude Code hooks that a translation layer is viable for the core events. The best first step is not a new Clooks authoring model. Keep the current `ClooksHook` surface and add an agent adapter around engine input/output:

1. Detect the incoming agent wire format.
2. Normalize Codex hook payloads into the current Clooks event/context shape.
3. Run the existing Clooks config, matching, lifecycle, ordering, failure, and reducer machinery.
4. Translate Clooks results back to Codex hook JSON.

This works well for `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `Stop`, and likely `PreCompact` / `PostCompact` once exposed in docs and validated against schemas. It will not give perfect parity for every Claude-only Clooks event because Codex simply does not have those lifecycle points.

## Codex Hook Shape

Codex hooks are enabled by default. They can be disabled via:

```toml
[features]
hooks = false
```

Codex still accepts `codex_hooks` as a deprecated alias, but `hooks` is canonical.

Hooks are discovered next to active config layers in either `hooks.json` or inline `[hooks]` tables in `config.toml`. Useful locations are:

- `~/.codex/hooks.json`
- `~/.codex/config.toml`
- `<repo>/.codex/hooks.json`
- `<repo>/.codex/config.toml`

Project-local Codex hooks only load when the project `.codex/` layer is trusted. User and system hooks still load in untrusted projects. Codex config itself is layered with CLI/profile/project/user/system/default precedence, and project `.codex/` layers are skipped when the project is untrusted.

Codex hook config is structurally similar to Claude Code:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/entrypoint.sh",
            "statusMessage": "Checking Bash command",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

Important runtime details:

- Matching hooks from multiple files all run.
- Multiple matching command hooks for the same event launch concurrently.
- Non-managed command hooks must be reviewed and trusted before they run.
- `timeout` is seconds, defaulting to 600.
- Commands run with the session `cwd`.
- Only `type: "command"` handlers run today. `prompt` and `agent` are parsed but skipped.
- `async: true` is parsed but unsupported; Codex skips async handlers.
- Plugin hooks exist but are off by default unless `[features].plugin_hooks = true`.

## Codex Events

The public hooks page documents these current release events:

| Codex event | Clooks fit | Notes |
|---|---|---|
| `SessionStart` | Good | Plain stdout or JSON `additionalContext` injects context. Matcher is startup source. |
| `PreToolUse` | Good | Can allow/block/ask and update input. Tool events include `turn_id`. |
| `PermissionRequest` | Partial | Can allow/deny. Codex reserves `updatedInput`, `updatedPermissions`, and `interrupt`; those fail closed today. |
| `PostToolUse` | Good | Can add context or block normal processing of the original tool result. Cannot undo side effects. |
| `UserPromptSubmit` | Good | Can inject context or block prompt. Matcher unused. |
| `Stop` | Good | `decision: "block"` means continue the turn with the reason as a continuation prompt. |

Generated schemas also include `PreCompact` and `PostCompact` input/output schemas. The Codex docs explicitly warn that `main` schemas can include hook fields not in the current release and that the hooks page is the release behavior reference, so these should be treated as near-term but not assumed stable without runtime testing.

Codex `PostToolUse` currently runs for Bash, `apply_patch`, and MCP tool calls. The docs note interception is incomplete: not all shell calls are intercepted yet, `unified_exec` shell handling is richer but incomplete, and `WebSearch`/other non-shell non-MCP tools are not intercepted.

## Wire Format Notes

Common Codex input fields overlap strongly with Claude/Clooks:

- `session_id`
- `cwd`
- `permission_mode`
- `hook_event_name`
- `transcript_path`
- `model`

Codex-specific additions:

- `turn_id` on turn-scoped hooks
- `tool_name`, `tool_input`, `tool_use_id` for tool hooks
- `tool_response` for `PostToolUse`

Generated Codex schemas show `transcript_path` can be `string | null`. Clooks currently types `transcriptPath` as required string in `BaseContext`, so a Codex adapter needs a policy. Options:

- Preserve the existing surface and coerce `null` to `""` or a synthetic path.
- Broaden Clooks’ internal/base type to `string | null`, which is a surface change and likely undesirable for a first integration.
- Store the raw value in an agent extension and keep `transcriptPath` as an empty string when absent.

The last option is the least disruptive.

## Result Mapping

### PreToolUse

Codex supports top-level `decision: "approve" | "block"` plus hook-specific output:

```json
{
  "decision": "approve",
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "permissionDecisionReason": "safe",
    "updatedInput": {},
    "additionalContext": "extra context"
  }
}
```

Clooks can map:

| Clooks result | Codex output |
|---|---|
| `allow` | `permissionDecision: "allow"` when decisive, or no decision for pass-through depending reducer result |
| `ask` | `permissionDecision: "ask"` plus `permissionDecisionReason` |
| `block` | `decision: "block"` or `permissionDecision: "deny"` plus reason |
| `skip` | no decision |
| `defer` | No Codex equivalent found in current docs; should degrade to `skip` or `ask` behind a capability check. |
| `injectContext` | `hookSpecificOutput.additionalContext` |
| `updatedInput` | `hookSpecificOutput.updatedInput` |

Codex reduction says any deny wins; otherwise allow can bypass the approval prompt; if no hook decides, normal approval flow applies. Clooks already has a richer `PreToolUse` reducer (`block > defer > ask > allow > skip`). For Codex, the adapter should drop or downgrade unsupported `defer`.

### PermissionRequest

Codex `PermissionRequest` hook-specific output is:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "allow",
      "message": "ok"
    }
  }
}
```

Codex explicitly says `updatedInput`, `updatedPermissions`, and `interrupt` are reserved and fail closed today. This conflicts with Clooks’ Claude-facing `PermissionRequestResult`, which can currently include `updatedInput`, `updatedPermissions`, and `interrupt`.

Recommended adapter behavior:

- `ctx.allow()` without updates -> Codex `behavior: "allow"`.
- `ctx.block({ reason })` -> Codex `behavior: "deny", message: reason`.
- `ctx.skip()` -> no decision.
- If a hook returns `updatedInput`, `updatedPermissions`, or `interrupt` under Codex, do not pass them through. Emit a visible `systemMessage` or fail closed in Clooks before Codex does, with an explanation.

### PostToolUse

Codex supports:

```json
{
  "decision": "block",
  "reason": "The output needs review.",
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "The command updated generated files."
  }
}
```

For `PostToolUse`, Codex `decision: "block"` does not undo the completed action. It replaces the tool result with hook feedback and continues the model from that feedback. This lines up with Clooks’ current `PostToolUseResult` semantics.

Codex parses but does not support `updatedMCPToolOutput` and `suppressOutput` yet; unsupported fields fail open. Clooks should avoid passing `updatedMCPToolOutput` through on Codex until support is documented/tested.

### UserPromptSubmit

Clooks maps well:

- `block({ reason })` -> Codex top-level `decision: "block", reason`.
- `injectContext` -> `hookSpecificOutput.additionalContext`.
- `skip/allow` -> no blocking decision.

Plain stdout is context in Codex, but Clooks should keep emitting JSON for deterministic behavior.

### Stop

Clooks maps well:

- `block({ reason })` -> Codex `decision: "block", reason`, meaning continue the turn.
- `allow/skip` -> no continuation decision.

Codex says `continue: false` takes precedence over continuation decisions from other matching Stop hooks. Clooks currently uses `allow/block/skip` for Stop and does not expose a Stop-specific "force stop" result. That is acceptable for preserving existing surface, but it means Clooks cannot express all raw Codex Stop behavior initially.

## Architectural Options

### Option A: Thin Codex adapter around existing Clooks engine

Add agent adapters:

- `src/agents/claude-code/*`
- `src/agents/codex/*`

The CLI entrypoint decides agent mode from either an explicit flag/env var or payload shape. The adapter normalizes wire input into the current Clooks normalized event shape, calls the existing engine, then translates the engine result to agent-specific output.

Pros:

- Preserves current Clooks authoring API.
- Reuses config loading, hook loading, ordering, lifecycle, circuit breaker, and test harness concepts.
- Smallest path to prove Codex support.

Cons:

- Current engine is Claude-shaped in names and assumptions, so the adapter must tolerate small mismatches like `transcript_path: null`, Codex-only `turn_id`, and unsupported fields.
- Some Codex capabilities, like `continue: false` on Stop, are not expressible.

This is the recommended first implementation.

### Option B: Introduce canonical cross-agent Clooks events

Create a new authoring model like:

```typescript
export const hook = {
  meta: { name: "policy" },
  "pre-tool-use"(ctx) {}
}
```

or an explicit `agent`/`capabilities` model.

Pros:

- Cleaner long-term abstraction for multiple agents.
- Avoids pretending Claude-specific events are universal.

Cons:

- Breaks or forks the existing surface.
- Requires a migration story.
- Delays Codex support.

This is worth considering later, but not as the first Codex bridge.

### Option C: Separate Codex runtime with shared loader/config only

Build `clooks-codex` with separate event/result types.

Pros:

- Honest about differences.
- Avoids contorting the current engine.

Cons:

- Splits the product.
- Duplicates engine semantics.
- Weakens the "write once" goal.

This should be a fallback only if runtime testing shows the adapter model is too leaky.

## Recommended Direction

Implement a thin adapter first and keep the existing hook surface.

Concrete shape:

1. Add an `AgentAdapter` interface:

   ```typescript
   interface AgentAdapter {
     agent: "claude-code" | "codex"
     detect(input: unknown): boolean
     normalizeInput(input: Record<string, unknown>): NormalizedEngineInput
     translateOutput(event: EventName, result: EngineResult | undefined, messages: string[]): AgentWireOutput
     registration(scope: "user" | "project"): RegistrationPlan
   }
   ```

2. Split the engine into:

   - wire read/agent detection
   - config/load/match/execute core
   - agent-specific output translation

3. Add `.codex` registration:

   - project: `.codex/hooks.json` or inline `.codex/config.toml`
   - user: `~/.codex/hooks.json`
   - command points to Clooks entrypoint with an explicit `--agent codex` or `CLOOKS_AGENT=codex`

4. Register only events Clooks can translate safely:

   - `SessionStart`
   - `PreToolUse`
   - `PermissionRequest`
   - `PostToolUse`
   - `UserPromptSubmit`
   - `Stop`

5. Add capability-aware translation:

   - Codex supports `updatedInput` for `PreToolUse`.
   - Codex does not currently support PermissionRequest input/permission rewrites.
   - Codex does not currently support `defer`.
   - Codex does not currently support `updatedMCPToolOutput`.

6. Preserve raw payload access somehow before committing to public API:

   - short-term: internal symbol/non-enumerable field, or `ctx.raw` only in experimental types
   - long-term: explicit `agent` and `raw` fields may be necessary for real cross-agent hooks

## Open Questions

- How should Clooks expose Codex `turn_id`? A first pass can ignore it, but audit hooks will want it.
- Should `transcriptPath` become nullable, or should the Codex adapter fill an empty string?
- Should `clooks init` learn `--agent codex`, `--agent claude-code`, and `--agent all`?
- Should project `.codex/hooks.json` be committed by default, mirroring `.claude/settings.json` behavior?
- How should Clooks represent "hook needs Codex review/trust" in CLI output?
- Should Codex support be gated behind an explicit feature flag until e2e coverage exists?
- Can we get a local Codex CLI fixture test without requiring interactive `/hooks` trust UI?

## Risks

- Codex hooks are active but still moving. The docs reference generated schemas and warn that main-branch schemas may include fields not in the current release.
- Trust/review behavior means Clooks registration may not immediately run until a user reviews hooks with `/hooks`.
- Codex launches multiple matching command hooks concurrently. Clooks can preserve its own internal ordering only if it registers a single entrypoint per event and performs all ordering inside that entrypoint.
- Codex hook coverage is not universal. `PostToolUse` docs explicitly call out incomplete shell interception and missing WebSearch/non-shell/non-MCP coverage.
- Existing Clooks event names are Claude-derived. That is acceptable for a bridge, but a future product-level "general-purpose hook framework" may need a canonical vocabulary.

## Conclusion

Codex support should start as an adapter, not a new authoring model. Clooks can plausibly make existing TypeScript hooks run under Codex for the shared lifecycle subset while preserving its current strengths: typed hooks, config layering, sequential/parallel ordering, fail-closed behavior, circuit breaker, and testing.

The first implementation should be intentionally conservative: register only the six documented release events, translate only supported result fields, warn or block on unsupported result capabilities, and keep Codex-specific data as adapter metadata until the public cross-agent API is designed.
