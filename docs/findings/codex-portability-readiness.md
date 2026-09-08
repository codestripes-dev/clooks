# Codex Portability Readiness

### Native conformance and recipient readability remain unverified

**Severity:** friction
**Date:** 2026-09-08
**Context:** The ten-event Codex adapter has source-backed mappings and passing Clooks unit and compiled-binary Docker coverage. Those checks do not establish native activation or enforcement. See [Testing evidence levels](../domain/testing.md#codex-evidence-levels) for capability classifications.

Remaining work:

- **Native conformance:** Verify registration activation, input delivery and output enforcement in Codex itself. No upstream parser/executor or live-native execution evidence was obtained; historical probe dispositions remain in the runtime evidence. A registration receipt does not establish that hooks are enabled, reviewed or executed, and replay does not establish exactly-once delivery.
- **Recipient readability:** Establish whether the intended native recipient can read generated handoff files before enabling file-based delivery. Until then, qualifying handoff remains inline.
- **Claude global command quoting:** `globalEntrypointCommand` in `src/commands/init.ts` emits an unquoted absolute launcher path. Paths requiring shell quoting can fail. A bounded quoting migration needs registration/removal compatibility tests and shell smoke coverage. See [Bash Entrypoint](../domain/bash-entrypoint.md#hook-registration).

**Disposition:** Native conformance is the next release-confidence gate. Internal Review history ambiguity remains an accepted, nonblocking best-effort limitation, not a request to disable history or redesign permissions. Clooks continues to assume a trusted repository. Completed implementation and isolated test-attempt history belong in the archived plan and milestone evidence, not active readiness findings.
