# Attention Required

Expose selected-provider identity on every hook context without changing adapter decisions. Implementation and parent validation are complete; evidence is in the adjacent ExecPlan.

## Danger Zone Changes

### Shared context and execution boundary

**What changes:** Required BaseContext.provider is assigned by runEngineCore after raw normalization and inherited by lifecycle input and sequential/parallel context copies.
**Why:** Portable hooks need reliable provider identity without interpreting ambient environment.
**Why it matters:** Review raw spoof resistance, explicit adapter authority, all context construction paths, and preservation of existing output translation. This does not make trusted hook objects immutable or introduce a permission boundary.

### Public author declarations and synthetic input boundary

**What changes:** Public Provider is exported and generated into all author declaration mirrors. Synthetic helpers default undefined to Claude and reject illegal explicit values; CLI converts invalid provider into a usage error.
**Why:** Tests must support deliberate provider branches without leaking arbitrary JSON into a closed public union.
**Why it matters:** Review type-only dependency direction, all event/lifecycle surfaces, generated export parity, backwards-compatible fixtures, and rejection before handler execution. Synthetic Codex identity does not apply Codex wire normalization or result policy.
