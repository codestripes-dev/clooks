import { VERSION } from './version'
import { runEngine, EXIT_OK, EXIT_STDERR } from './engine'
import { defaultDeps } from './engine/run.js'
import { KNOWN_COMMANDS } from './known-commands.js'

export { KNOWN_COMMANDS } from './known-commands.js'

// --- Mode flag ---
// Determines signal handler behavior. Engine mode (default) is fail-closed;
// CLI mode exits cleanly; MCP aborts and awaits the server's cleanup.
const args = process.argv.slice(2)
const firstPositional = args.find((a) => !a.startsWith('-'))
let currentMode: 'engine' | 'cli' | 'mcp' = firstPositional === 'mcp' ? 'mcp' : 'engine'
const mcpShutdown = new AbortController()
const engineShutdown = new AbortController()
let approvalLifecycleActive = false

function fatalExit(): void {
  if (currentMode === 'mcp') {
    process.exitCode = EXIT_STDERR
    mcpShutdown.abort()
    return
  }
  if (currentMode === 'engine' && approvalLifecycleActive) {
    engineShutdown.abort()
    return
  }
  process.exit(EXIT_STDERR)
}

// Global signal handlers — installed first, before any hook code runs.
// These are the ONLY code paths that should produce exit 2 + stderr.
// Everything else uses exit 0 + JSON.
process.on('uncaughtException', (err) => {
  const name = err?.constructor?.name ?? 'Error'
  const message = err?.message ?? String(err)
  process.stderr.write(`clooks: uncaught exception: ${name}: ${message}\n`)
  fatalExit()
})

process.on('unhandledRejection', (reason: unknown) => {
  const msg = reason instanceof Error ? reason.message : String(reason)
  process.stderr.write(`clooks: unhandled rejection: ${msg}\n`)
  fatalExit()
})

process.on('SIGTERM', () => {
  if (currentMode === 'mcp') {
    mcpShutdown.abort()
    return
  }
  if (currentMode === 'engine') {
    process.stderr.write('clooks: killed by SIGTERM\n')
    fatalExit()
  } else {
    process.exit(0)
  }
})

process.on('SIGINT', () => {
  if (currentMode === 'mcp') {
    mcpShutdown.abort()
    return
  }
  if (currentMode === 'engine') {
    process.stderr.write('clooks: interrupted\n')
    fatalExit()
  } else {
    process.exit(0)
  }
})

// Version check first — before any dispatch logic.
if (args.includes('--version') || args.includes('-v')) {
  const output = currentMode === 'mcp' ? process.stderr : process.stdout
  output.write(`clooks ${VERSION}\n`)
  process.exit(EXIT_OK)
}

if (firstPositional !== undefined && KNOWN_COMMANDS.has(firstPositional)) {
  // CLI mode — recognized subcommand
  if (currentMode === 'mcp') {
    try {
      const { runCLI } = await import('./router.js')
      await runCLI(args, { signal: mcpShutdown.signal })
    } catch (error) {
      process.stderr.write(
        `clooks mcp: ${error instanceof Error ? error.message : String(error)}\n`,
      )
      fatalExit()
    }
  } else {
    currentMode = 'cli'
    const { runCLI } = await import('./router.js')
    await runCLI(args)
  }
} else if (args.length > 0) {
  // Has args but no recognized subcommand — let Commander handle.
  // Covers: --help, misspelled subcommands, unknown flags.
  currentMode = 'cli'
  const { runCLI } = await import('./router.js')
  await runCLI(args)
} else if (!process.stdin.isTTY) {
  // No args, piped stdin — engine mode.
  await runEngine({
    ...defaultDeps,
    signal: engineShutdown.signal,
    onApprovalLifecycle: (active) => {
      approvalLifecycleActive = active
    },
  })
} else {
  // No args, TTY stdin — show help.
  currentMode = 'cli'
  const { runCLI } = await import('./router.js')
  await runCLI(args)
}
