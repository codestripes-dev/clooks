#!/usr/bin/env bash
set -euo pipefail

# Verify bind-mounts are present
if [ ! -f src/cli.ts ]; then
  echo "ERROR: src/ not bind-mounted. Use 'bun run test:e2e:run' or add -v ./src:/app/src:ro" >&2
  exit 1
fi

# Compile binary from mounted source
./node_modules/.bin/tsc --noEmit
mkdir -p dist
bun build --compile --outfile dist/clooks src/cli.ts

# Run tests — default to test/e2e/ if no args given
if [ $# -eq 0 ]; then
  exec bun test test/e2e/
else
  exec bun test "$@"
fi
