# Shared Interactive Approval Transport

The shared transport lives in `src/interaction/`; `clooks mcp` exposes its MCP
stdio endpoint. It connects one command invocation to its matching native MCP
check without replaying the command. Engine checkpoints are implemented in
`execute.ts`, `run.ts` and `live-approvals.ts` and validated through the compiled
test suite. The transport itself does not execute hooks or install registration.
The historical Codex token-retry runtime, `clooks approve` command and token
store are removed. Legacy databases remain inert and untouched; token-looking
shell text and environment variables cannot grant consent. Compiled engine
validation is separate from native generated-registration conformance.

This index points to focused sub-docs in `docs/domain/interactive-approvals/`. The detailed material is split across files to stay under the 300-line per-file domain-doc cap.

## Sub-docs

| Document | Path | Topics |
|----------|------|--------|
| Internal Command API | `interactive-approvals/command-api.md` | `createApprovalInteraction`, `ApprovalInteraction`, question/reply shape, closure and failure latching |
| Engine Checkpoints | `interactive-approvals/engine-checkpoints.md` | `executeHooks` interaction/signal arguments, lifetime boundary, sequential/parallel ask handling, reconfirmation |
| Generated Registration & Identity | `interactive-approvals/registration-and-identity.md` | Registration command/companion/server preparation, suppression, uninstall; the `CheckInput` identity/wire-key schema and mailbox rendezvous |
| MCP Server | `interactive-approvals/mcp-server.md` | `handleApprovalCheck`, message layout per agent, elicitation schema/response validation, `createApprovalServer`, stream/signal handling |
| Storage & Validation | `interactive-approvals/storage-and-validation.md` | Storage layout and limits, cleanup/retention, and the compiled validation-boundary test inventory |
