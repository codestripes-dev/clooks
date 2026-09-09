# Native Pack Smoke Research

Status: read-only feasibility research, persisted 2026-09-08. New custom-patch and catalog behavior is **source-supported, not executed**. No production implementation, builds, tests, native launches, archive access/downloads, or live auth occurred. The existing M4 research scope remains in the parent plan; this handoff does not change that plan or authorize execution. Wait for M1-3 approval and subsequent execution authorization.

## Retained Tooling

- Native CLI: 0.153.4; SHA-256 `56ef98ab4032d317ab26e9b5e5a175650717351edb16ed9cde0cb6d1734d62da`. Research read-hashed the retained executable and confirmed this pin; it did not execute a version command.
- Retained distribution: `/home/joedegler/.asdf/installs/nodejs/24.15.0/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl`. The runner takes this directory through `CLOOKS_CODEX_DIST` and mounts it read-only at `/native`.
- Retained upstream source root, called `UPSTREAM` below: `tmp/codex-runtime-m0/output/exact-tag/source/codex-rs/`.
- [Provenance](../../../../tmp/codex-runtime-m0/output/exact-tag/provenance.json): tag `rust-v0.153.4`, commit `3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`.
- Historical six-case evidence: [native evidence](../feat-0044-native-conformance/native-conformance-evidence.md), [retained attempt](../../../../tmp/codex-native-m1/smoke-d7UBQ3EW/). These are historical results, not new validation.

## Exact Responses Interfaces

Pass the custom item directly to `startFixture([item, finalAssistantMessage], logs)`:

```ts
const patch = '*** Begin Patch\n*** Add File: safe-companion.txt\n+safe\n*** Update File: nested/bun.lock\n@@\n-before\n+after\n*** End Patch\n'
const item = {
  type: 'custom_tool_call',
  call_id: 'native_m4_patch_denied',
  name: 'apply_patch',
  input: patch,
}
```

`input` is raw patch text. Do not JSON-stringify it separately, wrap it in `{command: ...}`, use `arguments`, or dispatch a shell heredoc. Existing SSE JSON serialization escapes newlines. `id`, `status`, and `namespace` can be omitted. `UPSTREAM/core/tests/common/responses.rs:1008` supplies this exact upstream helper pattern; `protocol/src/models.rs:1100` defines the item.

The shell case retains the working function interface:

```ts
{
  type: 'function_call',
  call_id: 'native_m4_shell_read',
  name: 'exec_command',
  arguments: JSON.stringify({
    cmd: 'cat readable.txt', workdir: project,
    yield_time_ms: 1000, max_output_tokens: 1000,
  }),
}
```

Keep feedback oracles separate:

| Interface | Shell | Direct Patch |
| --- | --- | --- |
| Next request output type | `function_call_output` | `custom_tool_call_output` |
| Native hook input | command-shaped shell input | `tool_name: "apply_patch"`, `tool_input: {command: patch}` |
| Clooks normalized input | `toolName: "Bash"`, `toolInput.command` | `toolName: "apply_patch"`, `toolInput.command` |
| Successful output text | `Process exited with code 0` | `Exit code: 0`, variable wall time, `Success. Updated the following files:` and operation/path lines |

For these cases, require a string `output` and exactly one output of the expected type with the exact scripted `call_id`. Join raw PreToolUse/PostToolUse through `tool_use_id`. Never accept scripted assistant text, echoed arguments, wrong-type outputs, or generic errors as execution evidence. Patch PostToolUse carries `tool_input.command` and textual `tool_response`.

Exact native patch denial wrapper: `Command blocked by PreToolUse hook: ${reason}. Command: ${patch}`. Require the actual protected-hook reason/path/rule, not parser failure, unavailable-tool feedback, or unsupported-result refusal. Sources: `UPSTREAM/core/src/hook_runtime.rs:229`, `core/src/tools/handlers/apply_patch.rs:469`, `core/tests/suite/apply_patch_serialization.rs:14`, and local [tool codec](../../../../src/agents/codex/tool-codecs.ts).

## Required Local Catalog

The [retained request 1](../../../../tmp/codex-native-m1/smoke-d7UBQ3EW/export/M1-BASE/request-1.json) advertises `exec_command` but no `apply_patch`. The unknown `gpt-5.1-codex` fallback sets `apply_patch_tool_type: None`; registration requires a non-null value. `features.apply_patch_freeform` is removed and is not a solution.

For the three new cases only, keep `model = "gpt-5.1-codex"` and add top-level `model_catalog_json = "/absolute/synthetic/codex-home/models.json"` before TOML table headers. Proposed source-derived minimal catalog:

```json
{
  "models": [{
    "slug": "gpt-5.1-codex",
    "display_name": "Native fixture",
    "supported_reasoning_levels": [],
    "shell_type": "unified_exec",
    "visibility": "none",
    "supported_in_api": true,
    "priority": 99,
    "support_verbosity": false,
    "apply_patch_tool_type": "freeform",
    "truncation_policy": {"mode": "bytes", "limit": 10000},
    "experimental_supported_tools": [],
    "context_window": 272000,
    "base_instructions": "Execute the scripted tool call."
  }]
}
```

This is synthetic fixture metadata, not a hosted-model capability claim. Retain the catalog bytes/hash and assert request 1 advertises `type: "custom", name: "apply_patch"` before treating patch results as valid. The static catalog needs no `/models` endpoint or network lookup. Source pointers under `UPSTREAM`: `protocol/src/openai_models.rs:392` (ModelInfo), `:752` (ModelsResponse and legacy base-instruction promotion), `core/src/config/mod.rs:2045` (loader), `model-provider/src/provider.rs:282` (static catalog), `models-manager/src/model_info.rs:143` (fallback), `core/src/tools/spec_plan.rs:1239` (registration), `features/src/lib.rs:1115` (removed flag). This exact catalog has not been run.

## Six Existing Cases Plus Three Actual-Pack Cases

Preserve `M1-BASE`, `M1-DENY`, `M1-REWRITE`, `M1-ASK`, `M1-CONTEXT`, `M1-STOP`, in their existing order with unchanged scripts, configuration, and assertions. Do not enable actual packs for those synthetic-hook cases. Append separate fresh-project cases; IDs below are suggestions, not plan edits.

| Case | Setup And Required Oracles |
| --- | --- |
| `M4-SHELL-READ` | Preseed `readable.txt` with a unique token. Execute `cat readable.txt` without an escape prefix. Require actual `prefer-builtin-tools` PreToolUse `skip`, matching raw Pre/Post call IDs, successful function output containing the token, and unchanged target bytes. |
| `M4-PATCH-ALLOW` | Preseed `editable.txt` with `before\n`. Use the patch above with `nested/bun.lock` replaced by `editable.txt`. Require actual `no-edit-protected` `skip`, exact `after\n` and companion `safe\n`, successful custom output naming both files, and matching Pre/Post call IDs. Run before patch denial as the positive control. |
| `M4-PATCH-DENY` | Preseed `nested/bun.lock` with `before\n`; companion absent. Submit the patch above with the safe operation first. Require actual `no-edit-protected` `block`, matching custom-output denial, byte-identical protected file, absent companion, and no denied-call PostToolUse. |

Precreate writable parent directories and use valid patches. Snapshot the complete owned target tree, existence and bytes, before/after; export snapshots before cleanup. Absent effects alone cannot prove hook denial. The inspected protected hook still skipped `apply_patch`; completion of approved M1-3 changes is a prerequisite, not something this research implements.

## Minimal Later Changes And Risks

- **Fixture server: no required extension.** [fixture-server.ts](../../../../test/native-codex/fixture-server.ts) already accepts arbitrary items and emits the required created/item-done/completed SSE sequence. Keep auth/route/body/encoding/exhaustion checks and native-only tool outputs. Do not add synthetic tool results, streaming deltas, or a `/models` route.
- **Actual source inputs:** [runner](../../../../scripts/test-codex-native.sh) snapshots `src`, `test`, `schemas`, scripts and metadata, but omits `.clooks/vendor/plugin`. Explicitly freeze/hash/read-only mount required approved hook sources and dependencies. Copy those exact bytes into disposable projects and configure explicit `uses` paths. Do not use stale image copies or online pack installation. Update runner unit-test dummy inputs for the new snapshot paths.
- **Actual handler attribution:** synthetic `native-m1` handler logs alone do not prove pack execution. Export `$HOME/.clooks/turn-state/codex/<sha256(session_id).slice(0,16)>.json` before cleanup; require `scopes.main[hookName]` to contain the expected PreToolUse decision and no error records. Pair with raw call-ID captures in these single-call scenarios; turn records themselves have no call IDs. Existing pattern: [default-hooks E2E](../../../../test/e2e/default-hooks.e2e.test.ts:65), [turn-state path](../../../../src/engine/turn-state.ts:470). Codex Stop preserves turn scope. Observer logs, if retained, must not substitute for actual-hook attribution.
- **Harness:** [harness.ts](../../../../test/native-codex/harness.ts) hardcodes shell commands, marker fields, `callId`, function feedback and success wording. Add separate actual-pack observations/assertions; do not weaken the old six-case oracle. Extend mandatory completion to nine; update `completed: 6` samples in [harness.test.ts](../../../../test/native-codex/harness.test.ts:398), test title, and actual unit-test count (`expectedUnitTests` is currently 17).
- **Negative oracle tests:** reject missing/wrong call IDs, wrong feedback types, missing actual-hook records, generic failure text, altered protected bytes, safe-companion creation, unexpected PostToolUse, and false success without target effects. Preserve exit-status/cleanup/publication failure tests.
- **Execution boundary:** retain non-root offline Docker, fresh credential-free homes, generated registration, explicit project trust, hook-trust bypass, danger-full-access, pin checks, raw captures, and attempt/cleanup accounting. Reassess the 180-second suite and 300-second outer deadlines for nine cases without silently adding retries. Evidence remains native CLI with a synthetic model/catalog, not normal sandbox/approval behavior or full-release conformance.

## Implementation File Inventory

Expected later touchpoints, not modified by this research: `test/native-codex/native-conformance.smoke.test.ts`, `test/native-codex/harness.ts`, `test/native-codex/harness.test.ts`, `scripts/test-codex-native.sh`, and a small test-owned catalog fixture if preferred over an inline catalog. `test/native-codex/fixture-server.ts` and `container-entrypoint.sh` need no identified protocol change. Preserve parent-owned plan files and historical native evidence.
