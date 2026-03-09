import { VERSION } from './index'
import { runEngine, EXIT_OK, EXIT_STDERR } from './engine.js'

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
  process.stderr.write("clooks: killed by SIGTERM\n");
  process.exit(EXIT_STDERR);
});

process.on("SIGINT", () => {
  process.stderr.write("clooks: interrupted\n");
  process.exit(EXIT_STDERR);
});

const args = process.argv.slice(2)

if (args.includes('--version') || args.includes('-v')) {
  console.log(`clooks ${VERSION}`)
  process.exit(EXIT_OK)
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(`clooks ${VERSION}`)
  console.log('')
  console.log('A hook runtime for AI coding agents.')
  console.log('')
  console.log('Usage:')
  console.log('  clooks [options]')
  console.log('')
  console.log('Options:')
  console.log('  -v, --version  Print version')
  console.log('  -h, --help     Print this help')
  process.exit(EXIT_OK)
}

// No CLI flags — run the hook execution engine.
// Reads stdin JSON, matches against hooks, executes, and writes stdout.
runEngine()
