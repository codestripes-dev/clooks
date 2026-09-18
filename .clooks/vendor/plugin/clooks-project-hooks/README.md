# clooks-project-hooks

Project-configured hooks for [clooks](https://clooks.cc). These hooks require per-project setup via `clooks.yml` — they encode decisions that only you can make about your project (which package manager to use, which paths are protected, which CLI tools should go through project scripts).

Contrast with [clooks-core-hooks](../clooks-core-hooks/), which ships zero-config safety and hygiene rules that apply to any project.

## Hooks

### js-package-manager-guard

Blocks JS/TS package managers, runners, and runtimes that aren't on your allowlist. Keeps the agent from mixing `npm`, `pnpm`, `yarn`, and `bun` in a project that has committed to one.

Checks command heads in Claude and Codex shell tools, including quoted executable names, environment assignments and newline-separated commands. Quoted arguments and comments are inert; escaped newlines continue the same command. Pipe targets (including newline continuations) are always excluded, including from `additionalBlocked`. Executable paths and unknown tools are excluded from the known-tool check; `additionalBlocked` retains exact-name matching for explicitly configured entries. This is bounded lexical inspection, not shell evaluation; nested execution and heredocs are not inspected.

A plain direct `node <absolute-script>` command bypasses the default runtime block only when Clooks identifies the literal script path as an installed plugin file. Assignments, runtime flags, expansions and redirections do not qualify; explicit `additionalBlocked` entries and later compound-command segments still apply.

**When to enable:** Any JS/TS project where the choice of package manager is a team decision captured in a lockfile.

**Config options:**

```yaml
js-package-manager-guard:
  config:
    allowed: ["bun"]
    additionalBlocked:
      - tool: "npx"
        message: "Use 'bunx' instead."
```

- `allowed` — package managers/runners/runtimes permitted. Auto-extends: `npm` implies `npx` + `node`, `pnpm` implies `pnpx`, `bun` implies `bunx`.
- `additionalBlocked` — tools outside the known universe (npm, npx, node, yarn, pnpm, pnpx, bun, bunx, deno) to block with a custom message.

**Escape hatch:** None. Configuration is the control mechanism.

**Unconfigured behavior:** When `allowed` is empty, the hook injects a SessionStart warning prompting the user to configure an allowlist. No commands are blocked until `allowed` is populated.

---

### no-edit-protected

Blocks Claude Write/Edit/MultiEdit and explicit Codex native apply_patch on protected paths. NotebookEdit and unrelated tools are not intercepted. Prevents the agent from editing files that should change via a different workflow (regeneration, manual curation, vendor upstream).

**When to enable:** Any project with generated files, vendored dependencies, or lockfiles that agents should not hand-edit.

**Config options:**

```yaml
no-edit-protected:
  config:
    lock-files: true        # default: true
    vendor-dirs: true       # default: true
    minified-assets: true   # default: true
    rules:
      - pattern: "src/generated/**"
        message: "Auto-generated. Run 'bun run codegen' instead."
      - pattern: "**/*.pb.go"
        message: "Generated from proto. Edit the .proto file."
        except: ["src/generated/overrides/**"]
```

Built-in rule groups:
- `lock-files` — `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock`, `bun.lockb`, `Gemfile.lock`, `poetry.lock`, `Pipfile.lock`, `composer.lock`, `Cargo.lock`, `go.sum`, `flake.lock`, `pubspec.lock`
- `vendor-dirs` — `**/vendor/**`, `**/vendored/**`
- `minified-assets` — `**/*.min.js`, `**/*.min.css`, `**/*.min.mjs`

Lock names use `**/` patterns covering project-root and nested workspace files.

Native patch inspection reads the string command payload and scans supported Add/Delete/Update headers plus both move paths, resolving paths against cwd before existing rules. It uses the typed unknown-tool context; it neither applies contents nor replaces native malformed-patch validation. Supported environment-ID/heredoc envelopes and CRLF are handled. Paths outside the existing cwd matching boundary remain outside this hook's protection.

Disable a group by setting it to `false`. Add project-specific globs under `rules` with custom block messages and optional `except` list.

**Escape hatch:** None. Protection is firm — adjust configuration or edit through the intended workflow.

---

### prefer-project-scripts

Blocks a matching direct invocation only when its configured package-script recommendation has exactly the same supported literal command words and ordered arguments. It does not redirect a check to a write, drop requested files/options, guess forwarded arguments, or select another script.

**When to enable:** Projects with literal package scripts whose exact command invocations should use the configured runner. Package-script tools may use any language; this is not limited to JavaScript executables.

**Config options:**

```yaml
prefer-project-scripts:
  config:
    mappings:
      - match: "(?<![\\w-])eslint(?![\\w-])"
        recommend: "bun run lint"
      - match: "(?<![\\w-])prettier(?![\\w-])"
        recommend: "bun run format"
      - match: "(?<![\\w-])tsc(?![\\w-])"
        recommend: "bun run typecheck"
      - match: "(?<![\\w-])jest(?![\\w-])"
        recommend: "bun run test"
```

**Verification boundary:** Recommendations must be exactly `bun run <script>`, `npm run <script>`, `pnpm run <script>` or `yarn run <script>`, without extra runner arguments. Yarn shorthand remains valid configuration but is unverified and skips, since commands such as `yarn add` can select built-ins rather than scripts. The hook reads package.json as JSON and compares the selected string script with the original command using a bounded literal-word parser. Matching pre/post script keys, environment-assignment prefixes, unquoted tilde/globs, unsupported expansion syntax and listed nested runner/shell/env wrappers prevent verification. Comparison is lexical; it does not prove identical executable resolution or package-runner environments. Neither the original command nor the script is executed during inspection.

Arbitrary non-package recommendations remain valid configuration, but unverifiable matches return skip with debug information only, not allow, injected advice or a coerced replacement. A verified match blocks with the exact configured recommendation. Unconfigured announcements remain unchanged.

`match` is a regex. The recommended pattern `(?<![\\w-])tool(?![\\w-])` avoids matching inside hyphenated package names (e.g. `eslint-plugin-react`).

**Escape hatch:** Prefix a command with `ALLOW_DIRECT_TOOL=true` to bypass all mappings for that invocation. Useful for diagnostics (`eslint --print-config .`) or when no project script exists.

**Unconfigured behavior:** When `mappings` is empty, the hook injects a SessionStart message prompting configuration. Not auto-enabled in `clooks.yml` — add it explicitly after defining mappings.

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
