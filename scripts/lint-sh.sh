#!/usr/bin/env bash
set -euo pipefail

# Check if shellcheck is installed
if ! command -v shellcheck >/dev/null 2>&1; then
  echo "ShellCheck not installed, skipping shell lint"
  echo "Install: brew install shellcheck (Mac) or apt install shellcheck (Linux)"
  exit 0
fi

# Find .sh files, excluding node_modules and tmp
mapfile -t files < <(find . -name '*.sh' -not -path './node_modules/*' -not -path './tmp/*' -not -path './.git/*')

# Exit if no .sh files found
if [ ${#files[@]} -eq 0 ]; then
  echo "No .sh files found, skipping shell lint"
  exit 0
fi

# Run shellcheck on found files, exit with its exit code
echo "Running ShellCheck on ${#files[@]} file(s)..."
shellcheck "${files[@]}"
