# Codex Runtime M1 Evidence

Date: 2026-09-08 UTC. M1 implementation, full unit, compiled E2E, static and final review gates are complete (final GO confirmed). M2 is in progress with separate acceptance pending. This record was assembled by reading retained logs and source, not rerunning tests; its proof applies only to the frozen M1 manifests below.

## Final Runs

Commands ran from `/opt/development/clooks`. `bun run test:e2e` orchestrates Docker; typecheck, compilation and tests ran inside the container. All three attempts used freeze reference `m1-capture-fix-reviewed`, a 600-second deadline and a 10-second kill grace. Each metadata file records command exit 0, tee exit 0 and `source_changed=false`.

| Evidence | Exact command / scope | Result | Artifact directory under `tmp/codex-runtime-m1/` |
| --- | --- | --- | --- |
| U: full units | `bun run test:e2e src/` | Typecheck/build passed; 2,000 pass, 0 fail, 64 files, 7,207 assertions; exit 0 | `20260908T065006Z-units-EYbymd/` |
| D: full compiled E2E | `bun run test:e2e` | Typecheck/build passed; 603 pass, 0 fail, 44 files, 5,369 assertions; exit 0 | `20260908T065029Z-e2e-gtCAyf/` |
| Static | Docker command below; in-container `bun run typecheck`, `bun run lint`, `bun run format:check` | Each exit 0; lint 112 warnings, 0 errors; formatting matched | `20260908T065232Z-static-k02BdQ/` |

Each directory retains `output.log`, `metadata.txt`, `docker-commands.log`, `source-before.sha256`, `source-after.sha256` and `container.cid`. U ran 06:50:06-06:50:15Z; D 06:50:29-06:51:54Z; static 06:52:32-06:52:44Z. Bun reports `1.3.10 (30e609e0)` in both test logs. Static log commands are `tsc --noEmit`, `eslint src/`, and `prettier --check 'src/**/*.ts' '*.json' '*.mjs'`; the formatting command does not cover test files or these Markdown documents.

The U build stdout reports `sha256:02c65ba40323b8a2ce0119ae5a1afda0d236da6706bf209ca19eae0f3127c3d6`; D build stdout reports `sha256:74b15f931b6c3829ad8b48c9171cac06bf647b7f5593a5978767dd3259541ad9`. These are build-reported IDs; the unit/E2E execution commands name the `clooks-e2e` tag, not an independently captured runtime digest. The static execution command explicitly names `sha256:74b15f931b6c3829ad8b48c9171cac06bf647b7f5593a5978767dd3259541ad9`. Metadata's `parent_reported_image=sha256:247579aeb8a59503de74693d631015e7b2f94e2909b1f8c2b358669588c7eee0` is a stale reference, not evidence of the final executed image. Exact injected names, labels and cidfile flags are retained in each `docker-commands.log`. Matching input manifests do not imply identical build images.

Exact static command recorded in metadata (shell escapes normalized, same arguments):

```bash
docker run --rm --entrypoint bash \
  --mount type=bind,src=/opt/development/clooks/src,dst=/app/src,readonly \
  --mount type=bind,src=/opt/development/clooks/test,dst=/app/test,readonly \
  --mount type=bind,src=/opt/development/clooks/schemas,dst=/app/schemas,readonly \
  --mount type=bind,src=/opt/development/clooks/scripts,dst=/app/scripts,readonly \
  --mount type=bind,src=/opt/development/clooks/.prettierrc,dst=/app/.prettierrc,readonly \
  --mount type=bind,src=/opt/development/clooks/.prettierignore,dst=/app/.prettierignore,readonly \
  --mount type=bind,src=/opt/development/clooks/package.json,dst=/app/package.json,readonly \
  --mount type=bind,src=/opt/development/clooks/tsconfig.json,dst=/app/tsconfig.json,readonly \
  --mount type=bind,src=/opt/development/clooks/eslint.config.mjs,dst=/app/eslint.config.mjs,readonly \
  --mount type=bind,src=/opt/development/clooks/tmp/codex-runtime-m1/static-checks.sh,dst=/app/codex-static-checks.sh,readonly \
  sha256:74b15f931b6c3829ad8b48c9171cac06bf647b7f5593a5978767dd3259541ad9 \
  /app/codex-static-checks.sh
```

The wrapper added `--name clooks-runtime-m1-20260908t065232z-static-k02bdq`, its attempt-specific cidfile and ownership label, as recorded in `docker-commands.log`. Source/test/schema mounts were read-only; runtime homes/state stayed container-local. Parent reports no owned containers remain and no code changes after the final formatting freeze. No host tests, host HOME/auth/trust use, local/global binary replacement, staging or commits were performed for this evidence update.

## Frozen Source Identity

All six final before/after manifest files have SHA-256:

```text
5cbfed02f56ad973d59e9338de7ba4116dd1ace81a687526dd8ee3a7c648cb23
```

This is a **manifest-file fingerprint, not a Git commit or binary digest**. The runner snapshots files under `src`, `test`, `schemas`, `scripts`, plus `bun.lock`, `.prettierrc`, `.prettierignore` and root JSON/MJS files. Equality was checked by the parent and by read-only hashing of the retained six files. It establishes that the recorded source manifests match across final U/D/static runs; it does not assert identical image digests or coverage of later documentation-only edits.

## Fixed Failures and Review

The first focused attempt (`20260908T063003Z-focused-v6uSz3/output.log`) failed typecheck on three branded HookName test values and executed zero tests. `hn` construction fixed those values. The focused rerun (`20260908T063150Z-focused-lWO01D/output.log`) passed 467 tests, 18 files and 1,526 assertions; its source-only selection established U, not D.

The first full-unit attempt (`20260908T064014Z-units-rQPz5R/output.log`) passed typecheck/build but failed 1 of 1,998 tests: 1,997 pass, 64 files, 7,189 assertions, exit 1. Existing `src/engine.test.ts` case "circuit breaker updated after all settle" lost hookB's counter when two parallel hooks threw synchronously. The original expectation was preserved; the final 2,000/0 run passes it. New "ordinary crash counters: sibling before abort" and "ordinary crash counters: sibling after abort" cases distinguish already-settled crashes from late settlements.

The raw-getter P1 is fixed and covered by "a throwing result getter resolves as a policy failure without orphaning the parallel batch" in `src/engine/execute.policy.test.ts`. It requires bounded completion, typed policy failure, one history commit, no handoff, no unhandled rejection and no late sibling effects. Additional final cases cover lifecycle timeout in serial/parallel execution and overlapping invocation isolation. The E2E observation artifacts are removed and required to be freshly created for every explicit/default invocation, closing the stale-artifact QA finding.

Reviewed interface clarifications are `createResultPolicy(invocation)`, pure structured `ComposeDiagnosticsInput -> ComposedDiagnostics`, `ExecutionResult.policyFailure`, shared `checkDetachedResult`, engine-owned failure selection and unconditional configured-noop finalization. No-config bypass and Claude behavior remain preserved. Final documentation review is the remaining closure step; M2 waits for that closure.

## Proof Boundary

Source inspection identifies the interfaces and the assertions written; it is not a runtime pass. U exercises internal/injected policies and real source-level consumers. D invokes the compiled Clooks binary with real Claude hooks and configuration, including envelope isolation, observer mutation/ignored override, detached nested results and disabled-Codex controls. Stable C/F mappings and exact test names are in [the acceptance matrix](codex-runtime-acceptance-matrix.md).

The tested M1 snapshot kept Codex runtime disabled. These passes establish neither Codex compiled execution nor native interception, refusal, recipient access or live continuation behavior. M0's release-bound S evidence remains separate; no P or L evidence was obtained, and the exhausted upstream probe budget is unchanged. M2+ behavior requires separate acceptance; release confidence remains open.
