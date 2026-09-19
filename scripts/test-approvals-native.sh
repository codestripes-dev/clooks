#!/usr/bin/env bash
set -euo pipefail
# Arguments are explicit case names or --baseline; the native driver validates selection.
: "${CLOOKS_CLAUDE_BINARY:?Supply an explicit existing Claude executable}"
: "${CLOOKS_CODEX_BINARY:?Supply an explicit existing Codex executable}"
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
image=$(docker image inspect --format '{{.Id}}' clooks-e2e)
mkdir -p "$root/tmp/approvals-native"
attempt=$(mktemp -d "$root/tmp/approvals-native/run-XXXXXXXX")
name="clooks-approvals-$$-$(date +%s)"
mkdir "$attempt/input" "$attempt/native" "$attempt/export"
chmod 0777 "$attempt/export"
for agent in claude codex; do
  variable="CLOOKS_${agent^^}_BINARY"
  source=$(readlink -f -- "${!variable}")
  [[ -f "$source" && -x "$source" ]]
  cp -- "$source" "$attempt/native/$agent"
  sha256sum -- "$source" >> "$attempt/original-binaries.sha256"
done
# Freeze native approval fixtures, reused native model helpers, and installed dependencies.
cp -a "$root/test" "$attempt/input/test"
cp -a "$root/node_modules" "$attempt/input/node_modules"
cp "$root/package.json" "$root/bun.lock" "$attempt/input/"
generated=false
for arg in "$@"; do
  [[ $arg != --generated ]] || generated=true
done
if [[ $generated == true ]]; then
  cp -a "$root/src" "$root/schemas" "$attempt/input/"
  mkdir -p "$attempt/input/.clooks/vendor"
  cp -a "$root/.clooks/vendor/plugin" "$attempt/input/.clooks/vendor/"
  cp "$root/tsconfig.json" "$root/bunfig.toml" "$attempt/input/"
  git -C "$root" rev-parse HEAD > "$attempt/input/source-commit"
fi
cp "$root/scripts/test-approvals-native.sh" "$attempt/runner.sh"
chmod -R a-w "$attempt/input" "$attempt/native"
(cd "$attempt" && find input native -type f -print0 | sort -z | xargs -0 sha256sum) > "$attempt/inputs.sha256"
printf '%s\n' "$image" > "$attempt/image-id"
cleanup() {
  rc=$?
  trap - EXIT INT TERM
  set +e
  owner=$(docker inspect --format '{{index .Config.Labels "clooks.approvals.attempt"}}' "$name" 2> "$attempt/cleanup.log")
  inspect_rc=$?
  cleanup_rc=0
  if [[ $inspect_rc == 0 && "$owner" == "${attempt##*/}" ]]; then
    timeout 20s docker rm -f "$name" >> "$attempt/cleanup.log" 2>&1
    cleanup_rc=$?
  elif [[ $inspect_rc == 0 ]]; then
    echo 'Refusing cleanup of a container not owned by this attempt' >> "$attempt/cleanup.log"
    cleanup_rc=77
  elif ! docker info >/dev/null 2>&1; then
    cleanup_rc=74
  fi
  (cd "$attempt" && sha256sum -c inputs.sha256) > "$attempt/hash-check.log" 2>&1
  hash_rc=$?
  sha256sum -c "$attempt/original-binaries.sha256" >> "$attempt/hash-check.log" 2>&1
  original_rc=$?
  [[ $rc != 0 || $cleanup_rc == 0 ]] || rc=$cleanup_rc
  [[ $rc != 0 || $hash_rc == 0 ]] || rc=$hash_rc
  [[ $rc != 0 || $original_rc == 0 ]] || rc=$original_rc
  printf '%s\n' "$cleanup_rc" > "$attempt/cleanup.rc"
  printf '%s\n' "$rc" > "$attempt/final.rc"
  echo "Artifacts: $attempt; final rc=$rc"
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
cmd=(docker run --pull never --name "$name" --label clooks.native=approvals-m1
  --label "clooks.approvals.attempt=${attempt##*/}" --network none --init
  --user testuser --entrypoint /bin/bash
  --mount "type=bind,src=$attempt/input/test,dst=/app/test,readonly"
  --mount "type=bind,src=$attempt/input/node_modules,dst=/app/node_modules,readonly"
  --mount "type=bind,src=$attempt/native,dst=/native,readonly"
  --mount "type=bind,src=$attempt/export,dst=/export")
if [[ $generated == true ]]; then
  cmd+=(--mount "type=bind,src=$attempt/input,dst=/snapshot,readonly")
fi
cmd+=("$image" /app/test/native-approvals/container.sh "$@")
printf '%q ' "${cmd[@]}" > "$attempt/command.sh"
printf '\n' >> "$attempt/command.sh"
echo "Artifacts: $attempt"
timeout --signal=TERM --kill-after=15s 900s "${cmd[@]}" 2>&1 | tee "$attempt/attempt.log"
[[ -s "$attempt/export/passed.json" ]]
