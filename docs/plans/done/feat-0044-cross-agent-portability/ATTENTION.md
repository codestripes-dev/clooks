# Attention Required

Completed C1 registration corrections, 2026-09-07. This snapshot accompanies the archived plan; the active epic retains its shared ATTENTION and downstream runtime work.

## Registration Files

**What changed:** Strict readers, bounded generated-command ownership and atomic file replacement preserve unrelated hooks and existing modes in both registrars.
**Why:** Permissive shape coercion, substring ownership and in-place writes could destroy user data.
**Review focus:** Malformed input and failed writes preserve bytes; only owned commands are removed. Unknown events remain bounded, not silently added to registration scope.

## Shared Runtime Deletion

**What changed:** Final deletion intent determines cleanup scope. Explicit consent, all-file preflight and remaining-reference inspection precede shared-directory deletion. Global cleanup considers effective and recorded Codex homes.
**Why:** Surviving registrations must not point at a deleted launcher.
**Review focus:** Decline/cancellation preserves the current scope; partial successful files or earlier scopes are not rolled back. Unknown-event references retain cleanup identity. Older unrecorded homes require explicit cleanup rather than a home scan.

## Home Identity and Launcher Eligibility

**What changed:** Global Codex registration resolves physical CODEX_HOME. A two-line recovery record retains cleanup identity; a separate four-line receipt records successful registration and a POSIX checksum of hooks bytes.
**Why:** Early markers and hard-coded homes could suppress project execution after failed or mismatched setup.
**Review focus:** Selected Codex/all setup validates without writes, persists recovery, retires the old receipt, repairs shared files, registers, then publishes. Failures retain identity and favor project execution. Claude-only setup remains independent and may restore an existing matching Codex receipt through shared-launcher repair, even before a later Claude registration failure. Receipt/hooks file symlinks are rejected; physical directory aliases and regular executable launcher symlinks remain supported. Untraversable original path spellings fall through. The CLI checksum subprocess has a ten-second forced-termination bound.

## Verification and Limits

Independent code review and QA approved. Final Docker full units: 1,957 passed, zero failures, 6,926 assertions. Final Docker full E2E: 600 passed, zero failures, 5,285 assertions across 44 files. Typecheck, formatting, lint and ShellCheck passed; 112 existing lint warnings remain. The previously logged unchanged-fixture coverage-threshold issue is not claimed resolved.

All init/uninstall testing and binary builds ran inside disposable Docker. No real home, credentials, trust state or installed binary was changed. The unrelated TODO remains untouched. README, schema, production discovery and Codex runtime adapter were not changed.

Stored state proves registration freshness, not native hook activation, exactly-once execution or live Codex decision enforcement. Re-init each project as well as global setup to upgrade older existence-only launchers. Repository trust and merged home/project/local execution remain established behavior; no permission-model redesign was introduced.
