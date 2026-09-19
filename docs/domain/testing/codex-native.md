# Codex Native Testing

## Overview

Codex fixture provenance, native evidence boundaries and the opt-in isolated CLI workflow. See [E2E Testing Architecture](../testing.md) for shared sandbox, binary and coverage conventions.

## Key Files

`test/fixtures/codex/events/` contains synthetic wire fixtures; `scripts/test-codex-native.sh` orchestrates isolated native runs; `test/native-codex/` contains the harness, fixture server and container entrypoint.

Create disposable fixture HOME directories explicitly with mode `0700`; never
inherit the container login umask for their permissions. Keep production
approval-storage permission checks unchanged.

## Sub-docs

| Document | Path | Topics |
|----------|------|--------|
| Fixtures & Evidence | `codex-native/fixtures-and-evidence.md` | Synthetic fixture provenance, evidence-level taxonomy (`S`/`P`/`L`), authorized real-session probes, opt-in native CLI smoke |
| Approval Case Evidence | `codex-native/approval-cases.md` | Actual-pack native evidence, direct-rewrite native policy controls, historical hybrid (token-runtime) approval cases |
| Native Scenarios | `codex-native/scenarios.md` | Native SessionEnd shutdown, handoff/Interrupt/MCP observation, local function-tool rewrites |
| Plugin Onboarding | `codex-native/onboarding.md` | Native marketplace onboarding: `$clooks:setup`, installer dispatch, full case matrix |

## Tested Binary Export

After successful full smoke and completion publication, the container exports /app/dist/clooks to /export/clooks before sealing. Export requires all 24 mandatory cases for `--smoke` across 26 native launches, including both direct-rewrite policy-denial controls, handoff, Interrupt, MCP observation, `LOCAL-REWRITE` and `LOCAL-DENY`. Historical 28-case/30-launch passes do not validate later changes. Focused `--session-end` publishes a distinct one-case evidence receipt only: it cannot publish full-smoke completion or export a binary. Successful full-smoke case receipts must match the Clooks hash; export also checks a regular executable source, exclusive creation and post-copy hash equality. binary.json records hash, architecture/platform and original/sealed modes. Unit-only, focused or failed native tests are not binary-producing paths. Test, publication, export, sealing, cleanup and manifest failures remain failures; passed.json alone is insufficient for deployment. Rehash the sealed artifact against retained receipts before any separately approved installation. Permission sealing is not immutable storage.

## Running the Harness

The runner requires an existing local `clooks-e2e` Docker image; it does not build or pull one. Helper checks do not require a native distribution:

    bash scripts/test-codex-native.sh --unit

Native smoke requires an explicit retained distribution directory containing executable `bin/codex`; its binary hash is checked:

    CLOOKS_CODEX_DIST=/absolute/path/to/x86_64-unknown-linux-musl bun run test:codex-native

To run the real orderly SessionEnd shutdown case and its observation/publication helper tests, with a separate evidence-only completion receipt and no binary export:

    CLOOKS_CODEX_DIST=/absolute/path/to/x86_64-unknown-linux-musl bash scripts/test-codex-native.sh --session-end

Focused oracle/publication regressions run with `bun test ./test/native-codex/session-end-observation.test.ts`; they reject missing native captures, handler/cleanup omissions, mismatched identity and false full-smoke publication.

The equivalent shell command is `bash scripts/test-codex-native.sh --smoke` with the same environment variable. The runner performs no implicit home search, host native execution or credential copy. Typecheck/build/tests run in Docker against frozen read-only inputs, with attempt-specific raw captures, hashes, native launch counts and separate test/cleanup/export/final statuses. Permission sealing is not immutable storage. Default `test` and `test:e2e` selection is unchanged. Native/helper containers use network none; ordinary E2E keeps its normal network for real GitHub smoke cases.
