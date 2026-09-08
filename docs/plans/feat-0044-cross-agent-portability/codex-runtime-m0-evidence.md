# Codex Runtime M0 Evidence

Research date: 2026-09-07 America/Los_Angeles; acquisition timestamps below are UTC on 2026-09-08. Target: Codex `0.153.4`, exact tag `rust-v0.153.4`.

Status: exact-tag source acquisition passed after two bounded routes. Both allowed harness attempts are complete: attempt 1 lacked Rust tools; the single retry obtained official Rust 1.95.0 but stopped during locked dependency preparation with exit 101. Zero upstream tests executed; no P evidence. Completed source audits are linked below, including the unresolved user-turn identity limitation. Overall M0 production entry and native release confidence remain unpassed.

## Verified Source Provenance

| Item | Verified value |
| --- | --- |
| Repository | https://github.com/openai/codex |
| Fetched ref | `refs/tags/rust-v0.153.4` |
| Tag object | `042fb41b7c813ac7999105e886b2b7aa715b5081` |
| Peeled commit | `3d2ee51ca2d5db578f328aa75e20aa22c0197c9a` |
| Exact-tag acquisition time | `2026-09-08T05:28:40.144Z` |
| Retained full archive | `tmp/codex-runtime-m0/output/exact-tag/source.tar.gz` |
| Archive type | `git archive --format=tar.gz --prefix=codex-source/ refs/tags/rust-v0.153.4^{commit}` |
| Archive SHA-256 | `45375e73d04b57a0e36520f88c8ebfd22f0eb400410b5ce40ad9b3b2dcbf07a0` |
| Archive bytes | 13,315,122 |
| Inspection export | `tmp/codex-runtime-m0/output/exact-tag/source/codex-rs/` |
| Export manifest | `tmp/codex-runtime-m0/output/exact-tag/source-manifest.json`, 4,177 regular files with per-file SHA-256 |

Immutable upstream source entry points: [hooks crate](https://github.com/openai/codex/tree/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/hooks), [core consumers](https://github.com/openai/codex/tree/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core), and [Rust toolchain](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/rust-toolchain.toml). These links identify the acquired revision; linked file contents are not by themselves a completed consumer audit.

The full archive retains non-Rust build inputs for a later offline container. The filtered inspection export retains regular `.rs`, `.json`, `.toml`, `.lock` and `.md` files under codex-rs; symlinks, git databases, binaries and container homes are not exported. The full archive was independently SHA-256 checked and successfully unpacked by the subsequent network-disabled probe.

## Isolation and Bounds

All upstream acquisition and harness work ran in disposable Docker containers. The cached `clooks-e2e` image was pinned to `sha256:fd276ca251ba628aef3a57ec4a50caad47bec3e47902a590e9112c67c0df2b3a`. Its normal entrypoint typechecks/builds Clooks and runs tests; these commands explicitly override that entrypoint. Acquisition and attempt 1 required no image pull or installation. Attempt 2 pulled only the official pinned Rust image and attempted container-local dependency fetching; no host package or tool installation occurred.

Only repository M0 scratch was mounted. Container runtime homes were under ephemeral /tmp, the environment was cleared with env -i, the root filesystem was read-only, capabilities were dropped, and the containers were removed on exit. Docker access required sandbox escalation after socket permission denial; the daemon was running. Unrelated containers were not changed.

Each source route had one 60-second process-group kill deadline encompassing its network work, with no retries. Export had a separate 60-second deadline. The first container had a 190-second outer deadline; the second had 130 seconds. Both permitted routes are now consumed. The harness feasibility container disabled networking and had a 600-second process deadline. No host Codex or tests, host HOME/CODEX_HOME/auth/trust changes or mounts, global install, Clooks init/uninstall, deployment, production/test edits, staging or commits occurred.

## Route 1: Provisional Archive

The first route completed before review corrections arrived. Its endpoint was ambiguous between a same-named branch and tag, and it did not retain the archive. It therefore did not establish exact-tag provenance. The second permitted route corrected those gaps; the first attempt's files and historical claims remain unchanged.

Exact executed Docker command, working directory `/opt/development/clooks`:

```bash
docker run --rm --pull=never --name clooks-codex-runtime-m0-acquire --read-only --cap-drop=ALL --security-opt=no-new-privileges --pids-limit=128 --memory=2g --cpus=2 --user "$(id -u):$(id -g)" --tmpfs /tmp:rw,nosuid,nodev,size=1g,mode=1777 --mount type=bind,src=/opt/development/clooks/tmp/codex-runtime-m0,dst=/scripts,readonly --mount type=bind,src=/opt/development/clooks/tmp/codex-runtime-m0/output,dst=/evidence --workdir /tmp --entrypoint /usr/bin/env sha256:fd276ca251ba628aef3a57ec4a50caad47bec3e47902a590e9112c67c0df2b3a -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/m0/home CODEX_HOME=/tmp/m0/codex-home CLOOKS_HOME_ROOT=/tmp/m0/clooks-home GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0 /usr/bin/timeout --signal=KILL 190s /bin/bash /scripts/acquire.sh
```

Inside the container, `timeout --signal=KILL 60s bun /scripts/acquire-archive.mjs` performed these unauthenticated public requests in order:

1. `GET https://api.github.com/repos/openai/codex/commits/rust-v0.153.4`, HTTP 200, resolved SHA `3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`.
2. `GET https://codeload.github.com/openai/codex/tar.gz/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`, HTTP 200.
3. Hash downloaded bytes and validate every listed archive member is under `codex-3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/` without parent traversal, then unpack and export filtered regular files.

Historical archive SHA-256: `bbbf66ffa30846f1e9bc3ae8a87a5aa0bb768efee8dbb94759dc9eb64bb4aa3a`, 13,330,433 bytes, acquired at `2026-09-08T05:26:15.730Z`. Those archive bytes were discarded with the container; this checksum must not be presented as the retained git archive checksum.

Route exit 0; export and Docker exit 0. Console stdout reported `acquired; source audits and executor not performed` plus provenance JSON. The captured archive-route log contains the two HTTP-200 records above and no error. Original logs/provenance/export remain in `tmp/codex-runtime-m0/output/`.

The scratch archive script was subsequently corrected to use `git/ref/tags/rust-v0.153.4` and peel annotated tags through `git/tags/SHA` with maximum depth eight. That corrected archive route was never executed. No repeat archive route or third source acquisition occurred.

## Route 2: Exact Tag and Retained Archive

Exact executed Docker command, same working directory:

```bash
docker run --rm --pull=never --name clooks-codex-runtime-m0-acquire --read-only --cap-drop=ALL --security-opt=no-new-privileges --pids-limit=128 --memory=2g --cpus=2 --user "$(id -u):$(id -g)" --tmpfs /tmp:rw,nosuid,nodev,size=1g,mode=1777 --mount type=bind,src=/opt/development/clooks/tmp/codex-runtime-m0,dst=/scripts,readonly --mount type=bind,src=/opt/development/clooks/tmp/codex-runtime-m0/output/exact-tag,dst=/evidence --workdir /tmp --entrypoint /usr/bin/env sha256:fd276ca251ba628aef3a57ec4a50caad47bec3e47902a590e9112c67c0df2b3a -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/m0/home CODEX_HOME=/tmp/m0/codex-home CLOOKS_HOME_ROOT=/tmp/m0/clooks-home GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0 /usr/bin/timeout --signal=KILL 130s /bin/bash /scripts/acquire-remaining-git.sh
```

Inside `timeout --signal=KILL 60s bash /scripts/acquire-git.sh`, these exact operations ran with credential helpers disabled and terminal prompts forbidden:

```bash
git init --quiet /tmp/m0/git-source
git -C /tmp/m0/git-source -c credential.helper= -c core.hooksPath=/dev/null \
  fetch --depth=1 --no-tags https://github.com/openai/codex.git \
  refs/tags/rust-v0.153.4:refs/tags/rust-v0.153.4
git -C /tmp/m0/git-source rev-parse 'refs/tags/rust-v0.153.4^{commit}' > /tmp/m0/commit.txt
git -C /tmp/m0/git-source rev-parse refs/tags/rust-v0.153.4 > /tmp/m0/tag-object.txt
test "$(cat /tmp/m0/commit.txt)" = 3d2ee51ca2d5db578f328aa75e20aa22c0197c9a
git -C /tmp/m0/git-source archive --format=tar.gz --prefix=codex-source/ \
  'refs/tags/rust-v0.153.4^{commit}' > /tmp/m0/archive.tar.gz
```

The equality assertion passed, binding the first observed commit to the exact tag. The distinct tag object and peeled commit above were recorded. This is not a tag-signature verification claim.

Export hashed the generated archive, checked member roots/paths, unpacked it, retained the full archive, and generated the filtered inspection files and manifest. All outputs were written separately under `output/exact-tag/`; no original attempt logs or provenance were replaced.

Route exit 0; export and Docker exit 0. Git's captured stderr was:

```text
From https://github.com/openai/codex
 * [new tag]         rust-v0.153.4 -> rust-v0.153.4
```

Console stdout reported `acquired via exact git tag; source audits and executor not performed` and the verified provenance table values. No error was reported. The codeload and git-generated archive hashes differ because they are different archive representations; their hashes are not interchangeable.

## Real Upstream Harness Feasibility

The acquired `codex-rs/rust-toolchain.toml` requires Rust `1.95.0`. The acquired `codex-rs/hooks/Cargo.toml` defines the real `codex-hooks` library, depending on codex-config, codex-plugin, codex-protocol, PTY utilities and other workspace crates. The intended invocation was the original upstream `cargo test --locked --offline -p codex-hooks --lib`, not a local parser mirror or the Clooks entrypoint.

Exact executed Docker command:

```bash
docker run --rm --pull=never --name clooks-codex-runtime-m0-probe --network=none --read-only --cap-drop=ALL --security-opt=no-new-privileges --pids-limit=256 --memory=4g --cpus=2 --user "$(id -u):$(id -g)" --tmpfs /tmp:rw,nosuid,nodev,size=3g,mode=1777 --mount type=bind,src=/opt/development/clooks/tmp/codex-runtime-m0,dst=/scripts,readonly --mount type=bind,src=/opt/development/clooks/tmp/codex-runtime-m0/output/exact-tag,dst=/archive,readonly --mount type=bind,src=/opt/development/clooks/tmp/codex-runtime-m0/output/upstream-probe,dst=/evidence --workdir /tmp --entrypoint /usr/bin/env sha256:fd276ca251ba628aef3a57ec4a50caad47bec3e47902a590e9112c67c0df2b3a -i PATH=/usr/local/bin:/usr/bin:/bin:/usr/local/cargo/bin HOME=/tmp/m0/home CODEX_HOME=/tmp/m0/codex-home CLOOKS_HOME_ROOT=/tmp/m0/clooks-home CARGO_HOME=/tmp/m0/cargo RUSTUP_HOME=/tmp/m0/rustup CARGO_NET_OFFLINE=true /usr/bin/timeout --signal=KILL 600s /bin/bash /scripts/probe-upstream.sh
```

The scratch probe verified the full archive with `sha256sum -c -`, extracted it into `/tmp/m0/source`, entered `codex-source/codex-rs`, recorded the required toolchain, and checked `command -v cargo` and `command -v rustc` on the isolated PATH. Both tools were absent. The container exited 30 before invoking cargo.

Concise actual output:

```text
/archive/source.tar.gz: OK
blocked: cached image has no cargo/rustc on isolated PATH; no upstream tests executed
```

The checksum line is in `output/upstream-probe/archive-check.log`; the blocker is in `output/upstream-probe/probe-status.txt` and console stdout. No separate error was emitted. Empty cargo-path.txt and rustc-path.txt record the failed tool lookups. No matched/executed/passing test count exists; zero tests is not a pass.

Attempt 1 disposition: one bounded offline feasibility attempt, no upstream parser/executor execution, no P evidence. At that stopping point no retry was spent and no replacement Rust image or dependency cache had been established. The missing toolchain is a diagnosed harness defect, not proof that upstream execution is permanently unavailable. The single permitted retry is described below. Attempt 1 logs remain unchanged, and probe-upstream.sh now checks for an existing probe-started.txt before writing any attempt records.

## Attempt 2: Toolchain Retry Result

Read-only `docker image ls rust` returned no cached Rust images. `timeout --signal=KILL 60s docker manifest inspect docker.io/library/rust:1.95.0-bookworm` succeeded. The official Linux/amd64 platform manifest is `sha256:4c2fd73ef19c5ef9d54bee03b06b2839a392604fbfcd578ed948b71b37c1d7fb`.

The new attempt directory is `tmp/codex-runtime-m0/output/upstream-probe-attempt-2`. The orchestration creates it with exclusive mkdir before any writes, refusing reuse. It never writes to attempt 1 or either acquisition directory. No target-source refetch or source/manifest edits are part of this retry.

Before container creation, a fresh UUID from `/proc/sys/kernel/random/uuid` is recorded as container-owner-token.txt and added as the Docker label `clooks.m0.retry-owner`. Cleanup is armed before docker run and removes the container only if inspection returns that exact label. This covers a client timeout after container creation without risking deletion of an unrelated same-named container. Cleanup allows two seconds for ownership inspection and three seconds for removal.

Exact executed host orchestration command, working directory `/opt/development/clooks`:

```bash
timeout --signal=TERM --kill-after=5s 595s /bin/bash tmp/codex-runtime-m0/run-retry.sh
```

The host script only orchestrates Docker and captures records. It starts a 580-second shared deadline before image pull. Pull is capped at 180 seconds, container start at 15 seconds, dependency preparation at 180 seconds, and network disconnect at 10 seconds; every cap is reduced to the shared time remaining. The test receives only the remaining shared time. The external timeout sends TERM at 595 seconds and KILL at 600 seconds; cleanup removes only the newly owned container, with a five-second cleanup cap. An existing container with the same name causes refusal before ownership is claimed. The container has its own 580-second watchdog.

Exact Docker pull and container invocation, prepared before execution and both executed successfully. The recorded retry_token value was `fe6be075-26fd-424b-a1f5-786105b813fe`:

```bash
docker pull --platform linux/amd64 docker.io/library/rust@sha256:4c2fd73ef19c5ef9d54bee03b06b2839a392604fbfcd578ed948b71b37c1d7fb
docker run --detach --rm --pull=never --platform linux/amd64 \
  --name clooks-codex-runtime-m0-retry-2 --network=bridge --read-only --cap-drop=ALL \
  --label "clooks.m0.retry-owner=$retry_token" \
  --security-opt=no-new-privileges --pids-limit=512 --memory=8g --cpus=4 \
  --user "$(id -u):$(id -g)" --tmpfs /tmp:rw,nosuid,nodev,size=8g,mode=1777 \
  --mount type=bind,src=/opt/development/clooks/tmp/codex-runtime-m0,dst=/scripts,readonly \
  --mount type=bind,src=/opt/development/clooks/tmp/codex-runtime-m0/output/exact-tag,dst=/archive,readonly \
  --mount type=bind,src=/opt/development/clooks/tmp/codex-runtime-m0/output/upstream-probe-attempt-2,dst=/evidence \
  --workdir /tmp --entrypoint /usr/bin/timeout \
  docker.io/library/rust@sha256:4c2fd73ef19c5ef9d54bee03b06b2839a392604fbfcd578ed948b71b37c1d7fb \
  --signal=KILL 580s /bin/sleep infinity
```

Preparation used `docker exec clooks-codex-runtime-m0-retry-2` followed by this cleared, container-only environment. The unexecuted test phase was prepared to use the same environment:

```bash
/usr/bin/env -i PATH=/usr/local/cargo/bin:/usr/local/bin:/usr/bin:/bin \
  HOME=/tmp/m0/home CODEX_HOME=/tmp/m0/codex-home CLOOKS_HOME_ROOT=/tmp/m0/clooks-home \
  CARGO_HOME=/tmp/m0/cargo RUSTUP_HOME=/usr/local/rustup RUSTUP_TOOLCHAIN=1.95.0 \
  GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0 \
  CARGO_NET_RETRY=0 CARGO_HTTP_TIMEOUT=30 CARGO_BUILD_JOBS=4 \
  CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
```

Preparation appends `/bin/bash /scripts/retry-container.sh prepare`. It verifies the retained archive checksum, unpacks it container-locally, requires the reported rustc version to be exactly 1.95.0, records Cargo version and selected source/lockfile hashes, and runs `cargo fetch --locked --target x86_64-unknown-linux-gnu` in `/tmp/m0/source/codex-source/codex-rs`. This fetch permits public locked crate/Git dependencies but executes no upstream build scripts or tests. The Rust installation belongs to the official image; no host toolchain is mounted.

On successful preparation, the orchestration runs `docker network disconnect bridge clooks-codex-runtime-m0-retry-2`, then records `docker inspect clooks-codex-runtime-m0-retry-2 --format '{{json .NetworkSettings.Networks}}'` in network-before-test.json. Both scripts require that record to equal `{}` before continuing. The test exec appends `CARGO_NET_OFFLINE=true /bin/bash /scripts/retry-container.sh test`, which checks unchanged source/lockfile hashes and runs the original `cargo test --locked -p codex-hooks --lib --offline`. Test stdout/stderr, phase exit, cargo exit and timestamps are separate attempt-2 artifacts. Actual executed test counts are required before reporting any P evidence; a preparation failure or zero tests is not a pass.

This was the only permitted diagnosed retry. It started at `2026-09-08T05:46:04Z` and finished at `2026-09-08T05:46:53Z`, 49 seconds including cleanup, inside the ten-minute bound. It stopped on a concrete preparation failure rather than a deadline. No further loop, lockfile repair, source reacquisition or test rerun occurred; the two-route acquisition and one-retry executor budgets are exhausted.

| Attempt-2 phase | Actual result |
| --- | --- |
| Official image pull | Exit 0; requested digest matched reported digest and Docker image inspection |
| Container start | Exit 0 |
| Retained archive verification | `/archive/source.tar.gz: OK`, followed by successful unpack |
| Rust toolchain | `rustc 1.95.0 (59807616e 2026-04-14)` |
| Cargo toolchain | `cargo 1.95.0 (f2d3ce0bd 2026-03-21)` |
| Dependency preparation | `cargo fetch --locked --target x86_64-unknown-linux-gnu`, exit 101 |
| Network disconnect | Not reached because preparation failed |
| Offline build/test | Not reached; zero tests executed, no passing count and no P evidence |
| Orchestration | Exit 101 |
| Cleanup | Label verified, owned container removed; cleanup.log records its name |

Final read-only cleanup verification ran the following exact command and exited 0 with empty stdout and stderr, confirming no running or stopped container retained this attempt's unique ownership label:

```bash
timeout --signal=KILL 10s docker ps -a --filter label=clooks.m0.retry-owner=fe6be075-26fd-424b-a1f5-786105b813fe --format '{{.ID}} {{.Names}} {{.Status}}'
```

The removed container was `clooks-codex-runtime-m0-retry-2`. No unrelated container was removed. This final verification performed no retries, dependency operations, lockfile edits or tests.

Preparation stdout was exactly:

```text
/archive/source.tar.gz: OK
rustc 1.95.0 (59807616e 2026-04-14)
cargo 1.95.0 (f2d3ce0bd 2026-03-21)
```

Preparation stderr first reported updates for the pinned crossterm, tokio-tungstenite, tungstenite-rs, rules_rust, nucleo and mxc Git repositories and the crates.io index. It then ended with:

```text
error: cannot update the lock file /tmp/m0/source/codex-source/codex-rs/Cargo.lock because --locked was passed to prevent this
help: to generate the lock file without accessing the network, remove the --locked flag and use --offline instead.
```

This proves that the selected workspace, exact toolchain and preparation command required a lockfile update in this environment. It does not identify which dependency/resolution difference caused that requirement, prove an intrinsic release defect, or establish that an unlocked run would succeed. No lockfile was changed, and Cargo's suggested command was not run. No online build or test executed. The offline-only test condition was preserved because the test phase was never entered.

Before dependency fetching, the container recorded these hashes from the unpacked archive:

```text
3494b8a78d0f643556a83a9cc184e912bcab9f4c5640288952f4223452ba5dc8  Cargo.lock
03d55888127bb1b7ab683696e11080046f0b9bade863bd4a81e1d746123f7e08  hooks/Cargo.toml
ae4b2a80569025e97d3ca39d5f4b7383c1c836ca29fe3980f18029ac4e00336f  hooks/src/engine/output_parser.rs
```

The attempt-2 directory retains separate phase stdout/stderr/exits, start/finish timestamps, toolchain versions, source hashes, image identity, ownership token and cleanup record. Attempt 1's timestamps and logs are preserved at `output/upstream-probe/`. The original source-route records and full retained archive remain unchanged. Scratch scripts now prevent attempt-record reuse rather than overwriting historical results.

## Completed Source Audits

The [wire contract audit](codex-runtime-m0-wire-contract.md) binds all ten input producers, generated declarations, actual output parser, synchronous executor/event consumers and tool codecs to the verified release commit. It distinguishes source findings from executed conformance. Concrete plan deltas include bare PreToolUse allow rejection, PermissionRequest reserved-field failure falling through without a decision, PermissionRequest exit-2 denial only with nonblank stderr, and loss of synchronous success stderr in native completion summaries.

The [identity and delivery audit](codex-runtime-m0-identity-delivery.md) traces root/ThreadSpawn identity, native continuation, compaction/resume and recipients. Stop continuation stays in the same run_turn loop and does not itself emit UserPromptSubmit. Synthetic Review work can nevertheless emit an indistinguishable no-agent-id UserPromptSubmit under the shared root session. Persistent once-per-real-user-turn parity therefore still requires an evidence-backed resolution or explicitly accepted bounded compatibility decision. File-pointer readability remains unproven; source insertion is not proof a recipient read a file.

These completed S audits remain valid despite the harness preparation failures. They do not become P or L evidence, and this evidence document does not accept a weaker product promise.

## Gate Dispositions

| Gate | Current disposition |
| --- | --- |
| Exact selected source | Passed: exact tag object, peeled commit match and retained archive checksum |
| E01-E10 schema and consumer semantics | Source audit completed in the linked wire report; no executable conformance claim |
| Applicable F01-F09 failure semantics | Source failure tuples traced in the wire report; no universal exit-2 claim |
| Applicable C01-C14 codecs, identity, continuation and delivery | Source audits completed; concrete synthetic-input boundary limitation and unproven pointer readability remain explicit |
| Pinned parser/executor P | Both bounded attempts consumed: attempt 1 missing Rust; attempt 2 locked dependency preparation exit 101; zero tests and no P evidence |
| Native N01-N07 / L | Not attempted; no native/model/auth use |
| M0 production entry | Not passed: source audits require policy reconciliation and the identity compatibility decision; P evidence remains unavailable |
| Release confidence | Not established |

No new runtime support, failure enforcement, tool codec, turn identity or delivery guarantee is claimed by this acquisition and feasibility record.
