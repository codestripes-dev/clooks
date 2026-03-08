#!/usr/bin/env bash
# Hook: no-compound-commands (PreToolUse)
# Blocks compound bash commands (&&, ||, ;) unless prefixed with ALLOW_COMPOUND=true
# Encourages using built-in Claude tools or separate Bash calls instead.
#
# Usage:
#   As hook: registered in .claude/settings.json, receives JSON on stdin
#   Testing: .claude/hooks/no-compound-commands.sh --test

set -euo pipefail

# ---------------------------------------------------------------------------
# Core logic
# ---------------------------------------------------------------------------

check_command() {
  local input="$1"

  local tool_name
  tool_name=$(echo "$input" | jq -r '.tool_name // empty')
  if [[ "$tool_name" != "Bash" ]]; then
    return 0
  fi

  local command
  command=$(echo "$input" | jq -r '.tool_input.command // empty')
  if [[ -z "$command" ]]; then
    return 0
  fi

  # Allow if prefixed with ALLOW_COMPOUND=true
  if [[ "$command" == ALLOW_COMPOUND=true* ]]; then
    return 0
  fi

  # Strip out single-quoted strings, double-quoted strings, and comments
  # to avoid false positives on operators inside strings
  local sanitized
  sanitized=$(echo "$command" | sed \
    -e "s/'[^']*'//g" \
    -e 's/"[^"]*"//g' \
    -e 's/#.*$//')

  # Check for compound operators: && || ;
  # Exclude ;; (case statement terminators)
  if echo "$sanitized" | grep -qE '&&|\|\||[^;];[^;]|^;[^;]|[^;];$'; then
    cat >&2 <<'MSG'
Compound command detected. Instead:
  - Use built-in Claude tools (Read, Write, Edit, Grep, Glob) instead of bash
  - Run commands separately in individual Bash calls
  - Write a dedicated bash script in tmp/ for multi-step sequences
  - If both commands MUST run together and a script is overkill, prefix with ALLOW_COMPOUND=true
MSG
    return 2
  fi

  return 0
}

# ---------------------------------------------------------------------------
# Tests (run with --test)
# ---------------------------------------------------------------------------

run_tests() {
  local passed=0
  local failed=0
  local total=0

  # Helper: build a PreToolUse JSON payload
  make_input() {
    local tool="$1"
    local cmd="$2"
    jq -n --arg t "$tool" --arg c "$cmd" '{tool_name: $t, tool_input: {command: $c}}'
  }

  # Assert the check returns the expected exit code
  assert_exit() {
    local label="$1"
    local expected="$2"
    local input="$3"
    total=$((total + 1))

    local actual
    check_command "$input" >/dev/null 2>&1 && actual=0 || actual=$?
    if [[ "$actual" -eq "$expected" ]]; then
      passed=$((passed + 1))
      printf "  \033[32mPASS\033[0m %s\n" "$label"
    else
      failed=$((failed + 1))
      printf "  \033[31mFAIL\033[0m %s (expected exit %d, got %d)\n" "$label" "$expected" "$actual"
    fi
  }

  echo "Running no-compound-commands tests..."
  echo ""

  # -- Should ALLOW (exit 0) ------------------------------------------------

  echo "== Should allow =="

  assert_exit "non-Bash tool passes through" 0 \
    "$(make_input "Read" "some file")"

  assert_exit "empty tool_name passes through" 0 \
    '{"tool_input": {"command": "ls"}}'

  assert_exit "empty command passes through" 0 \
    "$(make_input "Bash" "")"

  assert_exit "simple command: ls" 0 \
    "$(make_input "Bash" "ls -la")"

  assert_exit "simple command: git status" 0 \
    "$(make_input "Bash" "git status")"

  assert_exit "piped command: ps aux | grep node" 0 \
    "$(make_input "Bash" "ps aux | grep node")"

  assert_exit "piped command: cat file | sort | uniq" 0 \
    "$(make_input "Bash" "cat file | sort | uniq")"

  assert_exit "redirect: echo foo > file" 0 \
    "$(make_input "Bash" "echo foo > file.txt")"

  assert_exit "subshell: \$(command)" 0 \
    "$(make_input "Bash" 'echo $(date)')"

  assert_exit "ALLOW_COMPOUND=true prefix with &&" 0 \
    "$(make_input "Bash" "ALLOW_COMPOUND=true cd /tmp && ls")"

  assert_exit "ALLOW_COMPOUND=true prefix with ;" 0 \
    "$(make_input "Bash" "ALLOW_COMPOUND=true echo a; echo b")"

  assert_exit "ALLOW_COMPOUND=true prefix with ||" 0 \
    "$(make_input "Bash" "ALLOW_COMPOUND=true cmd1 || cmd2")"

  assert_exit "&& inside single-quoted string" 0 \
    "$(make_input "Bash" "echo 'foo && bar'")"

  assert_exit "&& inside double-quoted string" 0 \
    "$(make_input "Bash" 'echo "foo && bar"')"

  assert_exit "; inside single-quoted string" 0 \
    "$(make_input "Bash" "echo 'a; b'")"

  assert_exit "; inside double-quoted string" 0 \
    "$(make_input "Bash" 'echo "a; b"')"

  assert_exit "|| inside double-quoted string" 0 \
    "$(make_input "Bash" 'echo "a || b"')"

  assert_exit "&& in comment only" 0 \
    "$(make_input "Bash" "echo hello # && this is a comment")"

  assert_exit ";; case terminator" 0 \
    "$(make_input "Bash" 'case $x in foo) echo hi;; esac')"

  assert_exit "background process with &" 0 \
    "$(make_input "Bash" "sleep 10 &")"

  assert_exit "single command with flags" 0 \
    "$(make_input "Bash" "npm install --save-dev typescript")"

  assert_exit "heredoc with EOF" 0 \
    "$(make_input "Bash" 'cat <<EOF
hello world
EOF')"

  echo ""

  # -- Should BLOCK (exit 2) ------------------------------------------------

  echo "== Should block =="

  assert_exit "&&: cd dir && ls" 2 \
    "$(make_input "Bash" "cd /tmp && ls")"

  assert_exit "&&: mkdir -p dir && cd dir" 2 \
    "$(make_input "Bash" "mkdir -p foo && cd foo")"

  assert_exit "||: cmd1 || cmd2" 2 \
    "$(make_input "Bash" "make || echo failed")"

  assert_exit ";: echo a; echo b" 2 \
    "$(make_input "Bash" "echo a; echo b")"

  assert_exit ";: cd /tmp; ls" 2 \
    "$(make_input "Bash" "cd /tmp; ls")"

  assert_exit "mixed: cmd1 && cmd2 || cmd3" 2 \
    "$(make_input "Bash" "cmd1 && cmd2 || cmd3")"

  assert_exit "triple &&: a && b && c" 2 \
    "$(make_input "Bash" "a && b && c")"

  assert_exit "&& with pipe: cmd1 | cmd2 && cmd3" 2 \
    "$(make_input "Bash" "ls | grep foo && echo done")"

  assert_exit "; at end: echo hello;" 2 \
    "$(make_input "Bash" "echo hello;")"

  assert_exit "&& outside quotes, also inside: echo \"a && b\" && echo c" 2 \
    "$(make_input "Bash" 'echo "a && b" && echo c')"

  echo ""

  # -- Summary --------------------------------------------------------------

  echo "== Results =="
  printf "  Total: %d | \033[32mPassed: %d\033[0m | \033[31mFailed: %d\033[0m\n" "$total" "$passed" "$failed"

  if [[ "$failed" -gt 0 ]]; then
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

if [[ "${1:-}" == "--test" ]]; then
  run_tests
  exit $?
fi

# Normal hook mode: read from stdin
input=$(cat)
check_command "$input"
exit $?
