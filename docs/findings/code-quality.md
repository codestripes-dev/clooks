# Code Quality

Unwieldy code, smelly patterns, confusing architecture, or excessive complexity that made work harder than it should be.

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

**Disposition:** Existing behavior, unresolved and separately scoped. The approved Codex ask-to-block update changes only the final decision arm and does not fix target parsing. A future correction needs quote-preserving target tests and a bounded parser change. This finding is not native exploit evidence and does not change the trusted-repository model.

### Local domain-doc size guard skips native patches

**Severity:** note
**Date:** 2026-09-08
**Context:** Source inspection of a repo-local hook, not the shipped pack.

In `.clooks/hooks/domain-doc-size.ts`, `extractFilePath` accepts only `Write` and `Edit`; `PreToolUse` skips when no path is returned. Native `apply_patch` therefore bypasses this hook's line-count warning and limit checks.

**Disposition:** Static finding only, left unresolved. Add separately scoped patch-path and resulting-content handling if native patches must be covered; no runtime probe or fix performed.
