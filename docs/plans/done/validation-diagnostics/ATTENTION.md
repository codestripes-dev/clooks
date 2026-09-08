# Attention Required

Improve shared test diagnostics and enforce actual coverage configuration.

Completed with code/QA approval and passing Docker functional/static checks. Coverage execution correctly fails the unchanged thresholds; no coverage success is claimed. See `PLAN-0017-validation-diagnostics.md` alongside this file for evidence.

## Danger Zone Changes

### Shared test harness

**What changes:** Add raw subprocess metadata without changing normalized exitCode.
**Why:** Signal termination must not be confused with child-selected failure.
**Review:** All three invocation paths must preserve stdout/stderr and existing numeric semantics; diagnostics must appear on failed assertions.

### Validation configuration

**What changes:** Mount bunfig in Docker and remove the coverage script's lossy pipeline.
**Why:** Missing configuration and swallowed child failures can falsely report success.
**Review:** Confirm E2E discovery remains nonempty and coverage failures propagate unchanged. Thresholds and fixture exclusions must not be weakened.
