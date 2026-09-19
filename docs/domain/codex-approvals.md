# Codex Approvals: Historical Token Runtime

The former token-retry runtime, `clooks approve` command, token store and shell
carrier handling are removed. Current `ctx.ask` behavior uses
[shared live approval checkpoints](interactive-approvals/engine-checkpoints.md#engine-checkpoints)
without replaying earlier hooks. The public `ctx.ask` API is unchanged;
`ctx.defer` remains a separate result with its existing agent restrictions.

Existing `.clooks/approvals/codex.sqlite` databases and sidecars remain inert and
untouched by token retirement. Token-looking command text and environment
variables neither register consent nor discharge a live checkpoint.

The [historical native hybrid receipts](testing/codex-native/approval-cases.md#hybrid-approval-case-evidence)
describe the retired implementation only. They do not validate shared live
checkpoints; see [current native approval coverage](testing/interactive-approvals.md).
