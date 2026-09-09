# Codex Native Testing

## Overview

Codex fixture provenance, native evidence boundaries and the opt-in isolated CLI workflow. See [E2E Testing Architecture](../testing.md) for shared sandbox, binary and coverage conventions.

## Key Files

`test/fixtures/codex/events/` contains synthetic wire fixtures; `scripts/test-codex-native.sh` orchestrates isolated native runs; `test/native-codex/` contains the harness, fixture server and container entrypoint.

## Codex event fixtures
Codex wire fixtures live under `test/fixtures/codex/events/`. They use the snake_case input field names described by the documentation snapshot, not Clooks' camelCase normalized names. The fixture set is validated by `src/codex-fixtures.test.ts`, which checks coverage of the agreed ten-event target and basic per-event fields without treating the shapes as runtime-captured payloads. This hardcoded coverage check does not discover new upstream events or independently validate the wire contract. Revalidate each fixture against version-specific evidence before adapter consumption.

These historical fixtures remain docs-shaped contract artifacts, not native payload captures. The current PreToolUse unit and compiled E2E suites separately exercise the implemented adapter; passing replay does not upgrade fixture provenance. Live Codex CLI hook spikes should stay opt-in and disposable: use temporary `HOME`, `CODEX_HOME`, and project directories, avoid real `~/.codex` or trust-state changes, and promote only summarized evidence back into docs.

## Codex evidence levels
Keep three kinds of evidence separate:

| Evidence | What it establishes |
|---|---|
| Pinned source inspection (`S`; unsupported capabilities labeled `unsupported`) | Inspected producers, parser branches, consumers and test assertions at an immutable revision. Reading a test is not running it. |
| Actual upstream parser/executor execution (`P`) | Original upstream code executed at that revision with recorded command, exit status and matched/executed test counts. A Clooks replay or local parser mirror does not qualify. |
| Native execution (`L`) | Captured behavior from the actual Codex runtime for the exercised workflow. Source inspection, registration receipts and shell probes do not establish native activation or enforcement. |

As of the 2026-09-07 source audit, exact tag `rust-v0.153.4` is verified to commit `3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`. The ten-event source inspection resolves input/output, failure, codec and identity constraints; it does not upgrade the existing docs-shaped fixtures into captures. Generated schemas are not the upstream runtime validator: the [output parser](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks/src/engine/output_parser.rs#L345-L363) uses Serde. Future conformance coverage must distinguish schema declarations from actual null, unknown-field and discriminator handling, plain allow without rewrite, discarded rewrite-allow reasons versus human-facing `systemMessage`, reserved PermissionRequest fields yielding no decision, exit 2 with blank/nonblank stderr, and ignored successful stderr.

The original offline feasibility probe verified the retained archive but found neither cargo nor rustc in the cached container; **zero upstream tests executed**. The [pinned toolchain](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/rust-toolchain.toml) requires Rust `1.95.0`. The one bounded retry stopped during dependency preparation: `cargo fetch --locked` refused the required update to upstream `Cargo.lock`, exiting 101 after 49 seconds. No tests ran in the retry either. The retry allowance is exhausted; upstream execution remains unverified with no `P` evidence. This does not establish general toolchain unavailability or diagnose why the lockfile needed updating. The owned container was removed, and the label-filtered container listing was empty. That historical probe added no native `L` evidence; the separate native probe below establishes narrow native proof. Full genuine-user-turn parity has the concrete [Review limitation](../turn-state.md#codex-source-constraints-and-proposed-mapping); normal best-effort history is approved as a planned mapping with Review as a nonblocking limitation and no special workaround. Provider-isolated history has the completed PreToolUse gate. Prompt-boundary handling is now implemented, with expanded Docker validation passed.

The native CLI smoke exercises real Codex 0.153.4 through unchanged generated registration, using a synthetic loopback model in network-disabled Docker, synthetic project trust, hook-trust bypass and `--sandbox danger-full-access`, without real home/auth mounts. Measured capabilities are baseline invocation of SessionStart/UserPromptSubmit/PreToolUse/PostToolUse/ordinary Stop, shell denial with actual request feedback and no denied-call PostToolUse, command rewrite with original-marker absence and rewritten-marker presence, unsupported-ask refusal with no tool effect, context tokens in actual request text, and one same-turn Stop continuation with history-skip. Context uses PreToolUse ALLOW and SessionStart/UserPromptSubmit/PostToolUse SKIP; the public PreToolUse `ctx.skip()` helper does not accept `injectContext`; native skip-context consumption was not tested. Structured text oracles exclude metadata, function arguments and scripted assistant text; positive/mutant helper tests check false-pass resistance and truthful exits. PermissionRequest, PreCompact, PostCompact, SubagentStart and SubagentStop were unverified by that smoke, as were other result arms/codecs, normal trust/approvals, layered activation and recipient readability. Historical fixtures retain their original provenance.

## Authorized real-session evidence

Separate user-authorized temporary probes on 2026-09-08 exercised the existing configured, restarted Codex 0.153.4 session without changing real authentication or trust. This extends, rather than rewrites, the historical Docker smoke results above: PermissionRequest allow and default skip produced stdout with Pre/Permission/Post observations; deny produced a native rejected-process error with the fixture reason and no PostToolUse. Attribution used exact commands because PermissionRequest natively has no tool-use ID. Skip success is evidence for that approval path, not a general approval guarantee.

Two actual children received distinct SubagentStart context tokens and reported them before the parent read the token log; the second reported exactly one token. Child-identity-matched start, prompt, tool and stop observations were recorded. One explicitly targeted resumed child executed a one-shot SubagentStop continuation, then stopped with intervention history advancing from 0 to 1 and prior runs from 1 to 2, with no intervening UserPromptSubmit. Observer data proves the same child/session and preserved hook history, not equality of native turn IDs, which were not captured.

Live shell cases also demonstrated allow, denial, command rewrite, unsupported-ask refusal and controlled-throw failure blocking, plus pre/post random context tokens received directly as developer messages before token-log inspection. A post-block rerun used exact-matched PostToolUse response capture to prove completed stdout plus feedback: the wrapper hid stdout, but blocking did not roll back execution. An unmatched printf still worked.

Separate forced zero-threshold local compaction in a new session exercised the native runtime in offline Docker with a synthetic loopback model. Raw and handler PreCompact then PostCompact (auto) shared the raw turn ID; the actual summary reached user-message content in the second request and final stdout followed. Only these two handlers were configured; additional raw SessionStart startup/source-compact, UserPromptSubmit and Stop captures are not Clooks handler coverage.

Combining historical native smoke, interactive probes and this compaction pass gives all ten target events some native invocation evidence, not all result/failure variants, all tools or full release conformance. The interactive fixture did not newly test root startup/prompt/Stop; the compaction case did not test the real conversation, rich history or block variants. At that historical boundary, patch/MCP mutation and the protected-path hook gap were unverified. The actual-pack cases below add bounded direct-patch proof; broader patch/MCP variants, file-handoff readability, layered activation, root reset, broader trust/approval modes and exactly-once delivery remain outside that proof.

Stage live fixtures while inactive before multi-file updates, preserve an exact configuration backup, and use guarded restoration that preserves unrelated edits; verify byte-exact restoration when no unrelated changes occurred.

## Opt-in native CLI smoke

The harness retains six baseline cases and adds separate actual-pack shell-read, unprotected-patch and protected-patch cases. The three pack cases alone use a synthetic model catalog with freeform apply_patch enabled; the first request must advertise the custom tool. Script raw patches as custom_tool_call input, not JSON-wrapped shell commands, and match custom_tool_call_output by exact call ID. Keep shell function feedback separate. Copy frozen read-only vendor bytes into disposable projects, verify source hashes, and attribute decisions to actual pack turn-state entries alongside raw Pre/Post IDs. Snapshot the complete owned target tree; absence of effects alone is not denial evidence.

## Actual-Pack Native Evidence

The retained nine-case smoke establishes real Codex shell-read success with the built-in preference hook skipping, unprotected direct-patch success with exact changed/added bytes, and protected nested bun.lock denial with the entire owned tree unchanged and no denied-call PostToolUse. The safe companion Add precedes the denied operation and remains absent. Custom feedback includes the actual protected-hook reason/rule; the success case is the positive control. See [retained proof and export identity](../../plans/done/default-hook-portability/M4-NATIVE-EVIDENCE.md). This is native CLI execution with a synthetic model/catalog in offline non-root Docker and synthetic trust, without real home/auth mounts. It is not proof of global installation, normal trust/approval behavior, every patch variant, MCP mutation, tmux visuals or full conformance.

## Tested Binary Export

After successful smoke and completion publication, the container exports /app/dist/clooks to /export/clooks before sealing. Export requires the exact mandatory case list, successful case receipts with matching Clooks hashes, a regular executable source, exclusive creation and post-copy hash equality. binary.json records hash, architecture/platform and original/sealed modes. Unit-only or failed smoke is not an artifact-producing path. Test, publication, export, sealing, cleanup and manifest failures remain failures; passed.json alone is insufficient for deployment. Rehash the sealed artifact against retained receipts before any separately approved installation. Permission sealing is not immutable storage.

## Running the Harness

The runner requires an existing local `clooks-e2e` Docker image; it does not build or pull one. Helper checks do not require a native distribution:

    bash scripts/test-codex-native.sh --unit

Native smoke requires an explicit retained distribution directory containing executable `bin/codex`; its binary hash is checked:

    CLOOKS_CODEX_DIST=/absolute/path/to/x86_64-unknown-linux-musl bun run test:codex-native

The equivalent shell command is `bash scripts/test-codex-native.sh --smoke` with the same environment variable. The runner performs no implicit home search, host native execution or credential copy. Typecheck/build/tests run in Docker against frozen read-only inputs, with attempt-specific raw captures, hashes, native launch counts and separate test/cleanup/export/final statuses. Permission sealing is not immutable storage. Default `test` and `test:e2e` selection is unchanged. Native/helper containers use network none; ordinary E2E keeps its normal network for real GitHub smoke cases.
