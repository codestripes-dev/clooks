import { Command } from 'commander'
import { ApprovalStore } from '../agents/codex/approval-store.js'
import { getCtx } from '../tui/context.js'
import { jsonSuccess } from '../tui/json-envelope.js'
import { printError, printSuccess } from '../tui/output.js'

export function createApproveCommand(
  createStore: () => ApprovalStore = () => new ApprovalStore(),
): Command {
  return new Command('approve')
    .description('Acknowledge a short-lived Codex hook approval token')
    .argument('<token>', 'Approval token to acknowledge')
    .action((token: string, _opts, cmd: Command) => {
      const ctx = getCtx(cmd)
      try {
        const record = createStore().acknowledge(token)
        if (ctx.json) {
          process.stdout.write(
            jsonSuccess('approve', {
              token: record.token,
              expiresAt: record.expiresAt,
              acknowledgedAt: record.acknowledgedAt,
            }) + '\n',
          )
        } else {
          printSuccess(
            ctx,
            `Approval acknowledged. Expires at ${new Date(record.expiresAt).toISOString()}.`,
          )
        }
      } catch (error) {
        printError(ctx, 'approve', error instanceof Error ? error.message : String(error))
        process.exit(1)
      }
    })
}
