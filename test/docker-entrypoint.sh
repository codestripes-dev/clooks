#!/usr/bin/env bash
set -euo pipefail

# Verify bind-mounts are present
if [ ! -f src/cli.ts ]; then
  echo "ERROR: src/ not bind-mounted. Use 'bun run test:e2e:run' or add -v ./src:/app/src:ro" >&2
  exit 1
fi

# Compile binary from mounted source
if [ ! -f bunfig.toml ]; then
  echo "ERROR: bunfig.toml not bind-mounted; validation must use repository test configuration." >&2
  exit 1
fi

./node_modules/.bin/tsc --noEmit
mkdir -p dist
if [[ -n ${CLOOKS_TEST_BINARY:-} ]]; then
  : "${CLOOKS_TEST_BINARY_SHA256:?An external test binary requires its expected SHA-256}"
  [[ -f "$CLOOKS_TEST_BINARY" && ! -L "$CLOOKS_TEST_BINARY" ]]
  actual=$(sha256sum "$CLOOKS_TEST_BINARY")
  [[ ${actual%% *} == "$CLOOKS_TEST_BINARY_SHA256" ]] || {
    echo 'External test binary checksum mismatch' >&2
    exit 66
  }
  cp "$CLOOKS_TEST_BINARY" dist/clooks
  chmod 0755 dist/clooks
else
  bun build --compile --bytecode --format=esm --outfile dist/clooks src/cli.ts
fi

# Run tests — default to test/e2e/ if no args given
if [ $# -eq 0 ]; then
  exec bun test ./test/e2e/
else
  exec bun test "$@"
fi
