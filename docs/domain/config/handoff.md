# Config — Handoff (Long Message Delivery)

How the `handoff` config option trades inline hook text for a short file pointer, to avoid skimmed instructions, transcript bloat, and upstream output truncation.

## Overview

Hooks return text the model reads: a block reason, injected context, or continuation feedback. When `handoff` is enabled and a payload qualifies, clooks writes the full text to a content-addressed file under `<projectRoot>/.clooks/tmp/` and replaces it with a one-sentence pointer naming the absolute path.

```
[clooks] Hook "style-guide": read /abs/path/.clooks/tmp/handoff-style-guide-3fa9c2e81b04.md and follow its instructions.
```

### Value shape

`handoff` is `false | true | N` (positive integer):

- `false` (default) — never hand off.
- `true` — hand off any non-empty payload.
- `N` — hand off only when the payload's JavaScript string length (UTF-16 code units) exceeds `N`. Not a byte-precise truncation guarantee — multiple short inline payloads can still concatenate into a large response.

### Three levels, wholesale precedence

Settable at global (`config.handoff`), per-hook (`hooks.<name>.handoff`), and per-hook-per-event (`hooks.<name>.events.<Event>.handoff`). Resolution is `!== undefined` per layer, event → hook → global — a wholesale override, not a merge. An explicit event-level `false` beats a hook-level or global `true`. Threshold semantics are per-payload: a result with a short `reason` and a long `injectContext` hands off only the `injectContext`.

```yaml
config:
  handoff: 100        # global default: hand off anything over 100 chars

style-guide:
  handoff: true        # this hook always hands off
  events:
    PreToolUse:
      handoff: false   # ...except on PreToolUse, where it stays inline
```

### Eligibility — model-facing payloads only

Only fields the model reads are eligible: `injectContext` on injectable events; `reason` on `block` results for `PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop`; `feedback` on `continue` results for `TeammateIdle`, `TaskCreated`, `TaskCompleted`. Everything human-facing is always inline: `ask`/`allow` reasons, `PermissionRequest` messages, `UserPromptSubmit` block reasons, `stopReason`, `systemMessage`, and all engine-generated diagnostics.

Config-time validation rejects an event-level `handoff: true` or a number on an event with no eligible payload (mirrors the `trace`-on-non-injectable check). An explicit event-level `handoff: false` is always accepted, even on an ineligible event — global and hook-level `handoff` are accepted everywhere since a hook typically serves multiple events.

### Provider delivery eligibility

Claude and Codex use the shared file protocol for accepted, eligible payloads. Codex no longer applies a blanket inline-only guard: qualifying context on SessionStart, SubagentStart, PreToolUse, PostToolUse and UserPromptSubmit, and block reasons on PreToolUse, PostToolUse, Stop and SubagentStop, can become file pointers. Decision tags are preserved. Human-facing reasons and diagnostics remain inline, and capability rejection occurs before handoff so refused result effects do not create payload files.

`applyHandoff()` still accepts an invocation policy's optional delivery eligibility and an inline-fallback callback. If a policy marks a qualifying field ineligible, the field stays inline without a file write and the executor collects a human system-message notice. Neither current Claude nor Codex policy imposes that extra restriction. File-write failure separately retains the original inline text with a stderr warning.

Compiled E2E coverage checks exact pointers and file contents, thresholds, preserved decisions, rejection before writes and inline write-failure fallback. The separate [native handoff scenarios](../testing/codex-native.md#native-handoff-interrupt-and-mcp) verify that parent and child tool reads deliver the full contents into subsequent model requests, including sandboxed child reads. The scripted model requests prove delivery, not that a model will follow the instructions.

## File protocol

Files live in `<projectRoot>/.clooks/tmp/` (directory mode 0700, files mode 0600), named `handoff-<sanitized-hook-name>-<sha256(content)[0:12]>.md`. Content addressing gives dedup (repeated identical messages reuse one file) and a byte-identical pointer across repeats, so the model can recognize instructions it already read. Existing content at the target path is verified before reuse (never trusted on name alone); a mismatch triggers an atomic replace via temp-file + `rename`. The directory is self-gitignoring — a `.clooks/tmp/.gitignore` containing `*` is created on first use, so no changes to `clooks init` or the project's root `.gitignore` are needed.

**Cleanup** is two-layered: a TTL prune (files older than 24h deleted on every `SessionStart`, even if no hook handles it) and a count cap (200 files; oldest-by-mtime evicted before a write that would exceed it). Both only ever touch regular files matching the handoff/staging naming pattern.

**Fail-safe writes:** if the file cannot be written, the original text is delivered inline, one stderr warning is emitted, and the hook's decision is never altered.

## Interactions with self-referential hooks

A hook that recognizes its own past output in the transcript is blinded by handoff. The pattern shows up in once-per-turn reminders: a `Stop` hook blocks with a reminder, then on the next turn scans the transcript for that reminder's text to decide whether it already fired. With handoff enabled the transcript records the pointer, not the reminder, so the check never matches and the hook blocks again every turn until whatever safety valve it has trips.

This is not a bug in the engine — handoff replaces the payload by design, and any hook whose logic depends on reading its own delivered text is coupled to the delivery format. Two ways to handle it:

- Set `handoff: false` on that hook. Reminder-style payloads are usually short enough that handoff buys nothing anyway.
- Match the pointer as well as the raw text. The prefix `[clooks] Hook "<name>"` is stable and unique to that hook, so a check of the form `content.includes(reminder) || content.includes('[clooks] Hook "my-hook"')` survives both delivery modes.

Worth checking before enabling `handoff` globally: any hook that greps the transcript for a string it produced itself needs one of the two treatments above.

## Key Files

- `src/engine/handoff.ts` — `resolveHandoff`, `shouldHandoff`, `writeHandoffFile`, `buildPointer`, `applyHandoff`, `pruneHandoffFiles`.
- `src/config/constants.ts` — `HandoffSetting`, `DEFAULT_HANDOFF`, `HANDOFF_ELIGIBLE_EVENTS`.
- `src/config/schema.ts` — `HandoffSchema`, eligibility `superRefine` check.
- `src/engine/execute.ts` — `applyHandoff` runs per-hook, before reduction and before debug serialization.

## Related

- `docs/domain/config.md` — Config option tables and cascade rules.
- `docs/domain/config/execution.md` — Where `applyHandoff` sits relative to the reducers.
