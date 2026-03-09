import { VERSION } from './index'
import { runEngine, EXIT_OK, EXIT_STDERR } from './engine.js'
import { KNOWN_COMMANDS } from './known-commands.js'

export { KNOWN_COMMANDS } from './known-commands.js'

// --- Mode flag ---
// Determines signal handler behavior. Engine mode (default) is fail-closed;
// CLI mode exits cleanly on signals for interactive use.
let currentMode: 'engine' | 'cli' = 'engine'

// Global signal handlers — installed first, before any hook code runs.
// These are the ONLY code paths that should produce exit 2 + stderr.
// Everything else uses exit 0 + JSON.
process.on("uncaughtException", (err) => {
  const name = err?.constructor?.name ?? "Error";
  const message = err?.message ?? String(err);
  process.stderr.write(
    `clooks: uncaught exception: ${name}: ${message}\n`
  );
  process.exit(EXIT_STDERR);
});

process.on("unhandledRejection", (reason: unknown) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  process.stderr.write(`clooks: unhandled rejection: ${msg}\n`);
  process.exit(EXIT_STDERR);
});

process.on("SIGTERM", () => {
  if (currentMode === 'engine') {
    process.stderr.write("clooks: killed by SIGTERM\n");
    process.exit(EXIT_STDERR);
  } else {
    process.exit(0);
  }
});

process.on("SIGINT", () => {
  if (currentMode === 'engine') {
    process.stderr.write("clooks: interrupted\n");
    process.exit(EXIT_STDERR);
  } else {
    process.exit(0);
  }
});

const args = process.argv.slice(2)

// Version check first — before any dispatch logic.
if (args.includes('--version') || args.includes('-v')) {
  console.log(`clooks ${VERSION}`)
  process.exit(EXIT_OK)
}

// Find first positional arg (skips flags starting with -)
const firstPositional = args.find(a => !a.startsWith('-'))

if (firstPositional !== undefined && KNOWN_COMMANDS.has(firstPositional)) {
  // CLI mode — recognized subcommand
  currentMode = 'cli'
  const { runCLI } = await import('./router.js')
  await runCLI(args)
} else if (args.length > 0) {
  // Has args but no recognized subcommand — let Commander handle.
  // Covers: --help, misspelled subcommands, unknown flags.
  currentMode = 'cli'
  const { runCLI } = await import('./router.js')
  await runCLI(args)
} else if (!process.stdin.isTTY) {
  // No args, piped stdin — engine mode.
  runEngine()
} else {
  // No args, TTY stdin — show help.
  currentMode = 'cli'
  const { runCLI } = await import('./router.js')
  await runCLI(args)
}
