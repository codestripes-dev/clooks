import { Command } from 'commander'

interface McpOptions {
  signal?: AbortSignal
}

async function startServer(options: McpOptions): Promise<void> {
  const { runApprovalServer } = await import('../interaction/server.js')
  await runApprovalServer(options)
}

export function createMcpCommand(
  options: McpOptions = {},
  runServer: (options: McpOptions) => Promise<void> = startServer,
): Command {
  return new Command('mcp')
    .description('Serve shared hook approvals over MCP stdio')
    .exitOverride()
    .configureOutput({ writeOut: (text) => process.stderr.write(text) })
    .action(async () => {
      await runServer(options)
    })
}
