# clooks-core-hooks

Curated zero-config production hooks for [clooks](https://clooks.cc): command safety, git protection, tool hygiene, and tmux notifications. Every hook in this pack works out of the box with no per-project setup.

For hooks that encode project-specific decisions (allowed package managers, protected paths, script wrappers), see [clooks-project-hooks](../clooks-project-hooks/).

## Hooks

### no-compound-commands

Blocks compound shell commands (`&&`, `||`, `;`) to encourage single-purpose calls. Guidance names Claude tools for Claude Code and separate shell calls or apply_patch when available for Codex; classification and escape behavior are unchanged.

**When to enable:** Always. Prevents Claude from chaining fragile multi-step commands that are hard to debug and audit.

**Config options:** None.

**Escape hatch:** Prefix a command with `ALLOW_COMPOUND=true` to bypass the check. The hook also allows `cd <path> && <command>` as a safe pattern (single-command remainder only). The cd exception requires `&&`; `cd <path>; <command>` is blocked unless explicitly escaped.

---

### no-bare-mv

Rewrites a standalone literal `mv` with exactly two nonempty operands and no option except optional `--` when an argv-only `git mv -n` feasibility check succeeds. Supported quotes and escapes are decoded without evaluating a shell; unsupported syntax skips without executing a check. Feasibility is not a guarantee of history preservation.

**When to enable:** In git-tracked projects where supported file moves should use git mv when feasible.

**Config options:** None.

**Escape hatch:** None. Supported invocations use a three-second argv-only dry-run, never the submitted shell command. A failed check retains the allow-with-guidance fallback; successful inspection does not execute the move. Complex commands, expansion, other options and unsupported syntax are skipped.

---

### no-destructive-git

Blocks dangerous git operations on the Bash tool: `git reset --hard`, `git clean -f`, `git push --force`, `git stash drop`, `git commit --amend`, broad `git add -A` / `.`, and several more — 13 rules in total spanning reset, checkout, restore, clean, stash, worktree, push, branch, and hook-skipping (`--no-verify`). The block reason is tagged with the rule ID that fired so it's clear which rule triggered.

**When to enable:** Always. Each rule corresponds to a concrete way an agent can lose committed work, lose uncommitted work, or rewrite shared history.

Built-in checks also recognize Git global options before the operation (for example, `git -C repo reset --hard`), including quoted operands. Global help/version/path queries are skipped. Custom `additionalRules` still match the original command after the existing quote/comment sanitization, not a normalized command.

**Config options:**

Every rule is enabled by default. Set the rule ID to `false` in `clooks.yml` to skip instead of block:

- `reset-hard`, `reset-merge` — `git reset --hard|--merge`.
- `checkout-discard` — `git checkout -- <path>` / `git checkout .`.
- `restore-discard` — `git restore` without `--staged`.
- `clean-force` — `git clean -f` / `--force` (allows `-n`, `-i`, `--dry-run`).
- `stash-drop` — `git stash drop|clear`.
- `worktree-force-remove` — `git worktree remove --force`.
- `force-push` — `git push --force` / `+refspec` / `--mirror` (allows `--force-with-lease`, `--force-if-includes`).
- `commit-amend` — `git commit --amend`.
- `push-delete` — `git push --delete <ref>` / `git push <remote> :<ref>`.
- `branch-force-delete` — `git branch -D` (use `-d` for safe delete).
- `no-verify` — `--no-verify` on any git subcommand.
- `broad-add` — `git add -A` / `git add --all` / `git add .`. **Unbypassable** — always use specific paths.
- `additionalRules: { match: string; message: string }[]` — custom regex rules. Unbypassable.

**Escape hatch:** Prefix the command with `ALLOW_DESTRUCTIVE_GIT=true` to bypass the 12 escape-eligible rules. `broad-add` and `additionalRules` are unbypassable.

---

### no-rm-rf

Blocks recursive `rm` (`rm -rf`, `rm -r`, `rm -R`, and flag-order variants) against catastrophic paths. Expands glob patterns via `Bun.Glob.scanSync` so every concrete target is classified, not just the literal argument string. Returns `allow` for build-artifact basenames, `ask` for within-project non-artifact deletes, and `block` for home, system directories, project-root escapes, and unresolvable patterns.

**When to enable:** Always. Catches the catastrophic-rm incidents catalogued in [docs/research/agent-rm-rf-failures.md](https://github.com/codestripes-dev/clooks/blob/master/docs/research/agent-rm-rf-failures.md) (Mike Wolak's home-directory wipe and ~10 other documented agent-caused `rm -rf` disasters from Claude Code, Cursor, Gemini CLI, Replit, Amazon Q, and Google Antigravity).

**Config options:**

Each of the 11 rule IDs can be individually disabled (default: enabled). Setting a rule to `false` in `clooks.yml` returns `skip` instead of block/ask for that rule's trigger:

- `rm-rf-no-project-root` — fail-closed when no git repo or `.clooks/clooks.yml` is reachable from cwd.
- `rm-rf-no-preserve-root` — `--no-preserve-root` present (disables GNU rm's built-in safeguard).
- `rm-rf-unresolved-var` — target contains `$VAR`, `${VAR}`, `$(cmd)`, or backticks.
- `rm-rf-globstar` — target contains `**`.
- `rm-rf-dangerous-glob-unbypassable` — literal `.*` or `/*`.
- `rm-rf-expansion-error` — `Bun.Glob` scan threw (EACCES), or a symlink was detected in the scan parent (ELOOP_GUARD).
- `rm-rf-home` — target resolves to a user home directory (`~`, `$HOME`, `/home/<user>`, `/Users/<user>`).
- `rm-rf-root` — target resolves to `/` or a system top-level (`/etc`, `/usr`, `/bin`, `/lib`, `/var`, `/tmp`, ...).
- `rm-rf-project-root` — target resolves to the project root itself.
- `rm-rf-escape` — target resolves outside the project root.
- `rm-rf-strict` — target is inside project but not in the allowlist.
- `extraAllowlist: string[]` — additional basenames (beyond the default list) that should be allowed inside the project (default: `[]`).
- `strictMode: boolean` — when `true`, promotes `rm-rf-project-root` and `rm-rf-strict` from `ask` to `block` (default: `false`).

**Escape hatch:** Prefix the command with `ALLOW_DESTRUCTIVE_RM=true` to bypass rules 1, 3, 4, 6, and 10 (fail-closed/fail-open-ish triggers). Rules 2, 5, 7, 8, 9, and 11 are **unbypassable** — no escape hatch.

**Patterns blocked (11 rules, in evaluation order):**

1. `rm-rf-no-project-root` — `rm -rf` outside any recognizable project. Flag-bypassable.
2. `rm-rf-no-preserve-root` — `--no-preserve-root` present. **Unbypassable.**
3. `rm-rf-unresolved-var` — target has an unresolved shell variable or subshell. Flag-bypassable.
4. `rm-rf-globstar` — target uses `**`. Flag-bypassable.
5. `rm-rf-dangerous-glob-unbypassable` — target is literal `.*` or `/*`. **Unbypassable.**
6. `rm-rf-expansion-error` — glob scan failed (EACCES) or symlink detected in scan parent (ELOOP_GUARD). Flag-bypassable.
7. `rm-rf-home` — resolves to a user home. **Unbypassable.**
8. `rm-rf-root` — resolves to `/` or a system top-level. **Unbypassable.**
9. `rm-rf-project-root` — resolves to the project root. Asks for user confirmation (or blocks under `strictMode`).
10. `rm-rf-escape` — resolves outside the project root. Flag-bypassable.
11. `rm-rf-strict` — inside project, not allowlisted. Asks for user confirmation (or blocks under `strictMode`).

**Patterns allowed (default allowlist — 23 basenames):**

`node_modules`, `dist`, `build`, `out`, `.cache`, `tmp`, `.tmp`, `target`, `coverage`, `.next`, `.nuxt`, `.turbo`, `.parcel-cache`, `.vite`, `.svelte-kit`, `.output`, `__pycache__`, `.pytest_cache`, `.mypy_cache`, `.ruff_cache`, `venv`, `.venv`, `vendor`.

Extend via `extraAllowlist` in `clooks.yml`. Non-allowlisted within-project paths receive `ask` (user confirms), not block.

**Known limitations:**

1. **Non-recursive `rm file.ts` is not covered.** The hook ignores rm invocations without `-r`/`-R`/`--recursive`. A `no-bare-rm` sibling could ship later if incidents surface.
2. **Symlink safety.** The hook audits the immediate scan parent for symlinks and fails closed (`rm-rf-expansion-error` with `ELOOP_GUARD`) if any entry matching the glob is a symbolic link — closing the exploit where `build/cache -> /etc` would let `rm -rf build/*` delete `/etc`. One residual gap remains: when rule 4 (`rm-rf-globstar`) has been explicitly bypassed via `ALLOW_DESTRUCTIVE_RM=true`, symlinked directories nested two or more levels under the scan parent are not audited. Opting out of rule 4 means explicitly vouching for the globstar expansion.
3. **Subagent (Agent/Task tool) Bash calls are not covered by PreToolUse hooks.** Upstream [Claude Code issue #34692](https://github.com/anthropics/claude-code/issues/34692) — assumed fixed before release; if not, the hook covers main-session Bash only.
4. **Git submodules.** `git rev-parse --show-toplevel` returns the submodule root, not the parent repo. Paths in the parent repo may be classified as `escape`. Fail-closed direction (produces false blocks, not false allows).

---

### prefer-builtin-tools

Blocks bash commands that duplicate Claude Code's first-class tools: `cat`/`head`/`tail` → Read, `grep`/`rg`/`egrep`/`fgrep` → Grep, `find` → Glob, `sed -i` → Edit, `ls` → Glob, `echo`/`printf` with `>` → Write. Also refuses `sleep` outright. Stream uses (piped `grep`, `sed` without `-i`, `tail -f`) are explicitly allowed.

**When to enable:** Always when working with Claude Code. Built-in tools provide structured output, permission caching, and integrate with the rest of the toolchain. For explicit Codex, built-in read/search/listing restrictions are skipped; applicable sed-in-place, redirected-write and sleep rules remain, with apply_patch or available process-wait guidance. Configured additional rules and rule disables still apply. Claude and legacy undefined-agent contexts keep their existing guidance. Agent identity is not tool discovery.

**Config options:**

Every rule is enabled by default. Set the rule ID to `false` in `clooks.yml` to skip instead of block:

- `cat`, `head`, `tail`, `grep`, `find`, `sed-inplace`, `ls`, `sleep`, `echo-redirect`.
- `additionalRules: { match: string; message: string }[]` — custom regex rules. Unbypassable.

**Escape hatch:** Prefix the command with `ALLOW_BUILTIN_COMMAND=true` to bypass the 9 built-in rules. `additionalRules` is unbypassable.

**Per-segment detection:** Compound commands (`&&`, `||`, `;`) are split and each segment evaluated independently. Env-var prefixes (`VAR=val cat foo`) are stripped before identifying the command word.

**SessionStart announcement:** Emits an `injectContext` notice listing the active rules so the model knows which built-ins are off-limits before its first tool call.

---

### no-auto-confirm

Supported quoted literal inputs such as `echo 'y'`, `echo "yes"`, and printf confirmation formats are inspected when piped to a command; inert quoted pipe text is not a pipeline. The bounded lexer does not evaluate shell substitutions or expansions. Unsupported nested execution, heredocs or incomplete quoting stop inspection while retaining already complete prefix pipelines. This is not a complete shell parser.

Blocks commands that pipe automatic responses (`yes`, `echo y`, `printf y`, etc.) into interactive prompts. These patterns simulate human input instead of using the command's designed non-interactive interface.

**When to enable:** Always. This hook addresses a real AI agent failure mode where agents bypass confirmation prompts — prompts that exist because the program's author determined the action requires human judgment.

**What to do instead:**
- If the command has a non-interactive flag (`-y`, `--yes`, `--force`, `--non-interactive`, `-auto-approve`), use it.
- If the command has no such flag, the program's author intentionally requires human interaction. Ask the user to run the command.

**Config options:** None. No configuration needed or available.

**Escape hatch:** None. Use the command's designed non-interactive flag, or ask the user to run the command. If adding an escape hatch becomes necessary (commands with no non-interactive flag where the user doesn't want to run it themselves), `ALLOW_AUTO_CONFIRM=true` is a backward-compatible addition. See the feature spec for rationale.

**Patterns blocked:**
- `yes | command`, `yes <word> | command`, `/usr/bin/yes | command`
- `echo y | command`, `echo yes | command` (case-insensitive on y/yes)
- `echo -e|-n|-ne|-en y|yes | command`
- `printf y|yes | command` (case-insensitive)
- Per-segment detection: `cd /tmp && yes | rm -rf *`

---

### no-pasted-placeholder

Claude, Codex and legacy undefined-agent contexts check both formats, except prompts starting with `<task-notification>`, which skip to preserve completion notices.

Blocks `UserPromptSubmit` on literal `[Pasted text #N +N lines]` (Claude) or `[Pasted Content N chars]` (Codex) markers. This is a heuristic for potentially unexpanded pastes, not proof that content is missing; literal examples also match.

**When to enable:** Always. The cost of a blocked false positive is one re-submit; the cost of a false negative is a wasted turn responding to a literal placeholder string.

**Config options:** None.

**Escape hatch:** None. Re-paste the actual content, or remove the placeholder text, and submit again.

**Patterns blocked:**
- `[Pasted text #1 +10 lines]`, `[Pasted text #6 +1 line]`, `[Pasted text #15 +1234 lines]`
- `[Pasted Content 123 chars]`, `[Pasted Content 123 chars] #2` (the suffix is outside the marker)

**Not blocked:**
- Prompts starting exactly with `<task-notification>`, even when either marker format appears inside.
- The same string without brackets (e.g. quoted in a meta-discussion).
- Variants without a `+` sign (`[Pasted text #4 7 lines]`) or with `-` (`[Pasted text #3 -5 lines]`) — neither matches the format Claude Code emits.

---

### tmux-notifications

Visual tmux indicators for supported session events. Stop colors the window status orange by default and marks it for reset on focus. New prompts, completed tool use and session start reset attention. Claude notifications retain idle and permission/elicitation feedback; flashing targets the currently focused window and restores its pane/status styles. Codex PermissionRequest applies attentionStyle without flashing, then skips without deciding approval: the request may be resolved automatically without showing a prompt. flashOnPrompt applies only to Claude notifications. Claude and absent-agent PermissionRequest skip without duplicating notification feedback. SessionEnd restores window styles and automatic rename on both agents; Codex requires the eleven-event adapter and init refresh. No Codex idle, Interrupt, Notification or PostToolUseFailure event is synthesized.

**When to enable:** When running a supported agent inside tmux and visual session feedback is useful. Select the hook through existing pack/config activation; this description does not change registration.

**Config options:** `hookSlot: 81`, `idleColor: "red"`, `stopColor: "colour208"`, `attentionStyle: "bg=red,fg=white,bold"`, `attentionOnStop: true`, `flashOnPrompt: true`, `renameWindow: true`, and `idleIndicator: true`. Disabling attentionOnStop skips Stop coloring. idleIndicator has no effect when renameWindow is false.

**Slot requirement:** Choose a free configured `session-window-changed[hookSlot]` index. The installer preserves other indices, not an occupied configured slot. Its server sentinel suppresses repeat installation; changing the configured slot does not migrate an already-installed binding automatically.

**Outside tmux:** beforeHook returns skip when TMUX is absent or the pane's window cannot be resolved.

**Limitations:** Existing shell interpolation and shared tmux styles are retained, not hardened by Stop portability. Test with a stub executable or isolated server; do not infer protection of other bindings at the selected index or full native event parity.

---

## Contributing

### Regenerating types.d.ts

The `hooks/types.d.ts` file is generated by the clooks CLI. To regenerate after a clooks version update:

```bash
cd <your-clooks-project>
clooks types
cp .clooks/hooks/types.d.ts <path-to-this-pack>/hooks/types.d.ts
```

Do not edit `types.d.ts` by hand.
