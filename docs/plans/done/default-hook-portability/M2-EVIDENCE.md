# M2 Validation and Promotion Evidence

M2 is complete as reported by the parent on 2026-09-08. No global installation, native pack validation, staging or commit is claimed. Author: Joe-Degler.

## Accepted Gates

Final candidate reviewer and QA GO bind manifest `8e20c301c503f9303bbb75cb260b2e59a5dbc73a0865f7edfdf4d77eca04dd84`. Parent reports full candidate 960/0, focused 1007/0 and backup-helper 9/0, with all statuses 0. Full units `m2-units-PV6o1M` passed 2961/0; scoped lint `m6ZTOf` passed. These do not establish repository-wide lint, formatting or coverage gates.

Parent authorized the three-file guarded canonical promotion. Standard post-promotion E2E `promoted-e2e-BhAOWM` passed 960 tests, 0 failed in 153.73 seconds; execution and capture statuses 0. Final reviewer/QA GO obtained. Documentation owner independently compared canonical and candidate SHA-256 values after promotion:

    clooks-core-hooks/no-bare-mv.ts
    1f4ac003899b98aff2299b74d6116f53b3b07cd73d60da4db9b445ff72f5fc93
    clooks-core-hooks/no-auto-confirm.ts
    2d450d9390d53fbfcf910c9df224c8dc9c420cc4f9cb30666a185b43724cf58a
    clooks-project-hooks/no-edit-protected.ts
    9b6ec1aa01604e295d230eb86df32ffbef915e4a7780441f4d23448d874fd489

Canonical root is `.clooks/vendor/plugin`; validated candidate root was `tmp/default-hook-portability/candidate/plugin`. All three pairs matched. Files present locally are not committed reproducibility; final dependency inclusion still requires separate commit approval.

## Test-Only Adjustments

Earlier focused counts included 769 and 782 before further bounded-case splits, then 894 and final 1007. Candidate `m2-e2e-s5cMaR` reported 842/2 with two large-loop five-second timeouts. Candidate `m2-e2e-0uyDgu` reported 955/1 across 956 tests in 489.67 seconds; its only failure was the existing 22-replay prompt-boundary case taking 6.8 seconds against five seconds. Parent authorized assertion-preserving scenario splits, not runtime changes or threshold increases. Focused `lxM0jW` then passed 1007/0 across four files in 128.76 seconds, including the split case. Failed attempts are retained as evidence, not permanent production findings.

## Behavior Boundary

The promoted hooks use the existing unknown-tool context for exact Codex patch command-header scanning, including both move paths, without applying content or replacing native validation. Move inspection supports literal standalone two-operand mv with optional -- and argv-only git dry-run; unsupported syntax skips, dry-run failure retains its existing allow fallback, and history preservation is not guaranteed. Confirmation inspection preserves supported literal quoted tokens but is not a complete shell interpreter. Stable details are in `docs/domain/vendoring/overview.md`.

Unit and compiled-binary Docker success are not native apply_patch evidence. Native actual-pack testing remains M4. M3 is now parent-authorized, with inactive candidate README work and same-milestone domain updates after source inspection.
