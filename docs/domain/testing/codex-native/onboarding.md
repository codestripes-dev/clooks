# Codex Native Testing — Plugin Onboarding

Native marketplace onboarding evidence: `$clooks:setup`, installer dispatch, and the full TUI/PATH/reuse case matrix. Part of [Codex Native Testing](../codex-native.md).

## Native Plugin Onboarding

`bash scripts/test-codex-native.sh --onboarding` tests the actual marketplace
package with pinned Codex CLI 0.154.0, independently of the existing 0.153.4
conformance modes. The runner requires explicit `CLOOKS_CODEX_DIST` and
`CLOOKS_MARKETPLACE_ROOT` paths. It copies only `bin/codex` from the supplied
distribution and requires SHA256
`3188814c35471432d4123203e0eb38e5bddc60226e3d7ddf0e59e649ea140022`.
`test/tooling/onboarding-inputs.ts` freezes the sibling's `clooks/` package,
both catalogs and every Codex catalog-listed local top-level package directory,
including all three hook packs. It preserves bytes and modes, includes companion
files and generated declarations, and rejects symlinks and unsafe source paths.
The snapshot is mounted read-only at `/onboarding-marketplace` and verified again
during runner cleanup. Freezer tests independently check the complete expected
file inventory and hashes, not only the freezer's own manifest.

The onboarding container deliberately omits the usual `/usr/local/bin/clooks`
link. Test sessions exclude `/app/dist` from PATH, create their own HOME and
CODEX_HOME before installing the plugin, and receive no host home or credentials.
The real CLI adds the local marketplace, installs `clooks@clooks-marketplace`,
and lists its enabled state. `onboarding.exp` drives the real hook-review TUI,
without a hook-trust bypass. Project trust is preconfigured synthetically;
`danger-full-access` and shell approval mode `never` permit installation into
the disposable HOME inside network-disabled Docker. These sandbox choices do
not bypass hook review and are not evidence about restricted-sandbox setup.

`onboarding.smoke.test.ts` runs three native cases. Fresh install accepts hook
review and sends Hello in that same session; the first model request contains
the reminder but no full setup skill body and no installation/init effects.
Explicit `$clooks:setup` includes the full cached Codex skill. A scripted local
Responses provider then drives the actual bundled installer, resolver, compiled
CLI init and repeated init through native tool calls. A loopback release fixture
serves the compiled binary and its real checksum, with release version derived
from the frozen runtime package metadata. Reinit preserves registration bytes.
A new session reviews the generated runtime commands and verifies SessionStart
context plus a native shell effect and one PostToolUse observation.

The fresh-install case also invokes `$clooks:create-hook` in a new native session.
It requires the full cached skill in the model request, then reads the shared
Claude/Codex authoring guide through native shell calls in 40-line sections.
Each section must arrive intact: a single read can be truncated by Codex even
when the tool call requests a larger output budget. Native tool calls then
scaffold a PreToolUse hook, test a normalized Codex fixture, and register the
hook without changing native registrations. Completion requires the authoring
receipt; helper tests reject missing or false receipts. This proves skill
delivery, reference readability, and the scripted authoring workflow, not an
unscripted model's ability to design a correct hook.

The decline case chooses continue-without-trusting in the real UI: Hello receives
no reminder, explicit setup/check remains invocable with its full skill body,
and check reports the missing runtime without installing it. The reuse/removal
case uses an existing PATH binary, performs no downloads or managed installation,
and checks native dispatch. Removing the plugin with the real CLI preserves
the binary, Clooks config and init-owned registrations; a subsequent session
still executes the runtime hook. These baseline assertions finish before the
reuse case installs core, project and example packs through the native CLI.
Each installed tree must match the actual catalog source bytes, retain its
Claude manifest without a duplicate Codex manifest, and contain declarations
matching the runtime's generated bundle.

The next session verifies real core SessionStart context, every hook's user-scope
vendor bytes and config entry, and disabled-by-default entries. A native compound
command must return the exact core hook denial with its matching tool call ID
and command; neither side-effect sentinel may exist. A repeated session must
leave vendor files, configuration and native registrations byte-identical.
After comment-only cache and user-copy edits plus a user enablement override,
another native session must preserve the customized copies and configuration.
A compiled `clooks update plugin:clooks-core-hooks --json` then copies the changed
cache bytes while preserving config overrides and registrations. No test hook
substitutes for the actual pack in these checks. Pack receipts are required for
completion publication; missing or false stage flags and altered pack lists fail.

Verified coverage is **27 tests across 2 files, 0 failures, 80 assertions**:
one orchestration test covering three native cases, plus 26 helper tests.
All three cases passed across ten native sessions, including create-hook. Tested Clooks was 0.3.0,
compiled SHA256
`883791fc7e2dcca2b5a62f5dd7a0c310205f35cae4f6b36ab9c512af7c10cc0a`.
Registration assertions independently require the exact twelve-event inventory,
one command per event, and three-second SessionEnd/Interrupt timeouts. Negative
helper cases reject missing/replaced events, duplicate groups and invalid timeouts.
Final status, container cleanup, completion publication, snapshot verification,
permission sealing and artifact hash checks all exited zero. The runner retains
per-attempt requests, TUI transcripts, case receipts, snapshots and final status
under `tmp/codex-native-m1/onboarding-*/`; individual run IDs and timing belong
in those artifacts rather than this domain reference.

This is real native CLI/TUI, package, installer and runtime execution with a
scripted local provider. It proves model-input delivery and the tested explicit
workflow, not live-model obedience, the invocation policy flag's effect in
isolation, all native tools/events, remote marketplace publication, a minimum
supported Codex version, or setup under other approval/sandbox modes. Helper
tests check skill-body evidence, attributed tool results, pending-session
detection and completion publication. Expected-denial turns reject pending output
on the original call before any polling; unrelated tool failures cannot count
as hook denials. Tool calls yield up to 30 seconds and
permit at most three 10-second native polling follow-ups; request, TUI and outer
runner deadlines remain bounded. No real host installation or binary export is
performed. Onboarding has its own completion publisher and cannot satisfy the
existing conformance smoke's pass/export contract.

To reproduce using an existing `clooks-e2e` image with expect, curl and python3,
run from the Clooks repository and supply the retained 0.154.0 distribution:

    CLOOKS_CODEX_DIST=/absolute/path/to/x86_64-unknown-linux-musl \
      CLOOKS_MARKETPLACE_ROOT=/absolute/path/to/clooks-marketplace \
      bash scripts/test-codex-native.sh --onboarding

Focused helper tests run after compilation inside the test Docker container,
using disposable temporary directories:

    bun test ./test/tooling/onboarding-inputs.test.ts ./test/native-codex/onboarding.test.ts

To smoke-test a downloaded release artifact instead of recompiling Clooks, also
set `CLOOKS_TEST_BINARY` to its absolute path and `CLOOKS_TEST_BINARY_SHA256` to
the hash from its checksums file. The runner snapshots the artifact read-only;
the container verifies its hash before copying it to `dist/clooks`. No build
replaces it. Missing hashes, mismatches, and symlink inputs are rejected. The
normal source-build path is unchanged when the binary variable is absent.

The ordinary compiled onboarding E2E gate is separate from this native mode;
neither substitutes for the other.

## Related

- [Codex Native Testing](../codex-native.md) — parent overview and key files
- [Fixtures & Evidence](./fixtures-and-evidence.md)
- [Approval Case Evidence](./approval-cases.md)
- [Native Scenarios](./scenarios.md)
