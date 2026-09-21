# Code Quality

Unwieldy code, smelly patterns, confusing architecture, or excessive complexity that made work harder than it should be.

### Approval prompt for a delete operation does not show the target path

**Severity:** note (was blocker; not reproducible on the current build)
**Date:** 2026-09-19
**Repro result (2026-09-19, build `04d579a` deployed to `~/bin/clooks`):** `rm -rf <project>/approval-repro-victim` under Claude Code triggered `no-rm-rf` rule `rm-rf-strict`; the owner confirmed the dialog showed the question, the full command with the path, and the requesting hook. The original sighting happened in a session whose `clooks mcp` approval server had been running since before that deploy, so an older server build is the likely cause but was not confirmed. Remove this entry if it does not recur; if it does, record the tool name and whether the command contained newlines (`approvalMessage` in `src/interaction/server.ts` drops the inline preview for commands with control characters and falls back to the JSON input block).
**Context:** Owner-observed live approval prompt (`src/interaction/`, `src/agents/approval-operation.ts`, `src/engine/live-approvals.ts`, `docs/domain/interactive-approvals.md`) for a file delete under Claude Code.

The prompt did not display which file would be deleted, even though commit `b5cdf4b` ("Improve Claude approval message previews") was meant to show it. The owner could not give informed consent on a destructive operation. Owner ranks this top priority.

**Disposition:** Unresolved, not yet root-caused. First step: reproduce with a delete (`rm` via Bash, and a native delete tool if one exists) under Claude Code and inspect what `approvalOperation` / the preview builder emits for that tool input.

### Codex registration ownership misses earlier absolute commands

**Severity:** friction
**Date:** 2026-09-15
**Context:** Refreshing an existing local Codex project registration after installing the shared-approval binary.

The current registration detector did not recognize the earlier absolute command `CLOOKS_AGENT=codex CLOOKS_PROJECT_ROOT='/opt/development/clooks' '/opt/development/clooks/.clooks/bin/entrypoint.sh'`. Successful project init therefore retained 10 old event entries while adding the canonical 12 commands and paired `PreToolUse` `clooks/check` companion. The private pre-install backup established the old command and count; an assertion-heavy, local-only cleanup script removes only byte-equal entries for this installation.

**Disposition:** Production migration remains deferred. A future bounded migration slice should recognize owned earlier absolute registration forms, distinguish them from foreign commands, test mixed old/new and idempotent refreshes, and retire only entries attributable to the selected project.

### Tmux notification installation can overwrite its configured slot

**Severity:** note
**Date:** 2026-09-08
**Context:** Read-only inspection of retained marketplace/global tmux hook source during portability planning; no live tmux mutation or exploit was attempted.

The retained `clooks-core-hooks/hooks/tmux-notifications.ts` implementation installs `session-window-changed[hookSlot]` using `set-hook -g`. Its sentinel prevents repeated installation but does not check whether another binding already occupies the configured slot. Other indices remain separate; an occupied selected slot can be replaced. The implementation also builds shell commands using interpolated pane/window/configuration/directory values, rather than an argv-only boundary.

**Disposition:** Existing behavior retained for the bounded Stop-portability reconciliation, not fixed by it. Require a free configured slot and test preservation of other indices only. Slot-collision handling and shell-interpolation hardening need separately scoped follow-up. No claim of exploitability, new trust model or protection of an occupied configured slot follows from this inspection.

### Recursive-removal parser loses quoted target boundaries

**Severity:** friction
**Date:** 2026-09-08
**Context:** Read-only source inspection during default-hook portability planning; no exploit or live removal command was executed.

In `.clooks/vendor/plugin/clooks-core-hooks/no-rm-rf.ts`, `sanitize` removes remaining single-quoted content after its special command/script handling, including literal target arguments. It removes double-quote delimiters while retaining their contents; `extractTargets` then splits on whitespace. Consequently, single-quoted targets can disappear from inspection and double-quoted paths containing spaces can become multiple targets, so classification need not describe the shell's actual target list.

**Disposition:** Existing behavior, unresolved and separately scoped. The historical Codex ask-to-block change and its subsequent replacement with the Clooks hybrid approval fallback change only the final decision arm; neither fixes target parsing. A future correction needs quote-preserving target tests and a bounded parser change. This finding is not native exploit evidence and does not change the trusted-repository model.

### Stale-plugin advisory loses inherited home origin in local overrides

**Severity:** note
**Date:** 2026-09-21
**Context:** Actual Claude review of the bounded project-activation/local-customization stale-warning fix; logged by the delegated implementation worker after checking for an existing entry.

A global plugin hook customized in `.clooks/clooks.local.yml` with no project definition retains its home origin in `src/config/merge.ts`; `src/config/index.ts` resolves it using the original home `uses`. The advisory detector in `src/claude-settings.ts` instead treats the local config entry as project-destination storage. With distinct home/project roots, an enabled user plugin can therefore still produce a false local-scope stale warning despite supplying the hook that executes.

**Disposition:** Preexisting gap, deferred rather than broadened into the reported Playbook fix. A separate follow-up must align advisory consumption with the effective hook origin without changing merge, discovery or execution semantics. Current coverage proves project-backed local customization, not this home-origin variant.

### Local domain-doc size guard skips native patches

**Severity:** note
**Date:** 2026-09-08
**Context:** Source inspection of a repo-local hook, not the shipped pack.

In `.clooks/hooks/domain-doc-size.ts`, `extractFilePath` accepts only `Write` and `Edit`; `PreToolUse` skips when no path is returned. Native `apply_patch` therefore bypasses this hook's line-count warning and limit checks.

**Disposition:** Static finding only, left unresolved. Add separately scoped patch-path and resulting-content handling if native patches must be covered; no runtime probe or fix performed.
