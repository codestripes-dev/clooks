import { VERSION } from './index'
import { runEngine } from './engine.js'

const args = process.argv.slice(2)

if (args.includes('--version') || args.includes('-v')) {
  console.log(`clooks ${VERSION}`)
  process.exit(0)
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
  process.exit(0)
}

// No CLI flags — run the hook execution engine.
// Reads stdin JSON, matches against hooks, executes, and writes stdout.
runEngine()
