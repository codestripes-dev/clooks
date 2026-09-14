# Codex Event Fixtures

These JSON fixtures are shaped from official Codex hook documentation and are runtime-unverified. Revalidate them against real Codex hook payloads before using them for adapter normalization, translation, or registration behavior.

`session-end-other.json` is a synthetic source-shaped contract fixture for the pinned `rust-v0.153.4` source (`3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`), not a captured runtime payload. It includes only event, session ID, cwd, nullable transcript path and `reason: other`; no model, permission mode or turn ID is fabricated. Its registered-entrypoint compiled smoke lives in `test/e2e/codex-session-end.e2e.test.ts` and is not native Codex execution evidence.
