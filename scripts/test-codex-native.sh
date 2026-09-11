#!/usr/bin/env bash
set -euo pipefail
umask 022

if [[ $# != 1 || ( $1 != --unit && $1 != --smoke ) ]]; then
  echo 'Usage: bash scripts/test-codex-native.sh --unit|--smoke' >&2
  exit 64
fi
mode=$1
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
vendor=
if [[ "$mode" == --smoke ]]; then
  : "${CLOOKS_CODEX_DIST:?Set CLOOKS_CODEX_DIST to the explicit retained native distribution directory}"
  vendor=$(cd -- "$CLOOKS_CODEX_DIST" && pwd -P)
  [[ -f "$vendor/bin/codex" && -x "$vendor/bin/codex" ]] || {
    echo 'Required distribution has no executable bin/codex; nothing was run.' >&2
    exit 66
  }
fi
# No build, pull, downloader, host native execution or implicit home search.
image=$(docker image inspect --format '{{.Id}}' clooks-e2e)
mkdir -p "$root/tmp/codex-native-m1"
attempt=$(mktemp -d "$root/tmp/codex-native-m1/${mode#--}-XXXXXXXX")
name="clooks-native-m1-$(date -u +%Y%m%dT%H%M%SZ)-$$"
stage=setup
docker_rc=not-started
created=0
cleanup() {
  incoming_rc=$?
  trap - EXIT INT TERM
  set +e
  final_rc=$incoming_rc
  status_write_rc=0
  write_status() {
    printf '%s\n' "$2" > "$attempt/$1"
    write_rc=$?
    if [[ "$write_rc" != 0 ]]; then
      status_write_rc=$write_rc
      if [[ "$final_rc" == 0 ]]; then final_rc=74; fi
      echo "Could not write status: $attempt/$1" >&2
    fi
  }
  write_status runner.rc "$incoming_rc"
  if [[ "$stage" == setup ]]; then write_status setup.rc "$incoming_rc"; else write_status setup.rc 0; fi
  write_status docker.rc "$docker_rc"
  cleanup_rc=0
  if [[ "$created" == 1 ]]; then
    timeout 20s docker rm -f "$name" > "$attempt/cleanup.log" 2>&1
    cleanup_rc=$?
  fi
  write_status cleanup.rc "$cleanup_rc"
  launches=$(find "$attempt/export" -name native.launched.json -type f | wc -l)
  launch_scan_rc=$?
  write_status native-launch-scan.rc "$launch_scan_rc"
  if [[ "$launch_scan_rc" != 0 ]]; then
    launches=unknown
    native_attempt=unknown
  elif [[ "$launches" -gt 0 ]]; then native_attempt=1; else native_attempt=0; fi
  write_status native-launch-count "$launches"
  write_status native-attempt-count "$native_attempt"
  # The container seals its own entries. The host seals only the bind root.
  # Logs and status files deliberately remain writable; this is not immutable storage.
  chmod a-w "$attempt/export" 2> "$attempt/seal.log"
  seal_rc=$?
  write_status seal.rc "$seal_rc"
  writable=$(find "$attempt/export" \( -type f -o -type d \) -perm /222 -print -quit)
  export_rc=$?
  if [[ "$export_rc" == 0 && -n "$writable" ]]; then export_rc=74; fi
  write_status export-seal.rc "$export_rc"
  # Hash frozen source plus raw captures/logs. Finalization status files are separate.
  (cd "$attempt" && find input export -type f -print0 | sort -z | xargs -0 sha256sum &&
    sha256sum runner.sh command.sh attempt.log image-id revision tracked-source.diff) > "$attempt/artifacts.sha256"
  hash_rc=$?
  if [[ "$hash_rc" == 0 ]]; then
    (cd "$attempt" && sha256sum -c artifacts.sha256) > "$attempt/hash-check.log" 2>&1
    hash_rc=$?
  fi
  write_status hash.rc "$hash_rc"
  for failure_rc in "$cleanup_rc" "$launch_scan_rc" "$seal_rc" "$export_rc" "$hash_rc"; do
    if [[ "$final_rc" == 0 && "$failure_rc" != 0 ]]; then final_rc=$failure_rc; fi
  done
  write_status final.rc "$final_rc"
  write_status status-write.rc "$status_write_rc"
  write_status rc "$final_rc"
  if [[ "$status_write_rc" != 0 ]]; then
    # Best effort after a status-write failure; the process exit remains authoritative.
    write_status final.rc "$final_rc"
    write_status status-write.rc "$status_write_rc"
  fi
  echo "Artifacts: $attempt; final rc=$final_rc; native launches=$launches; export permission rc=$export_rc; status write rc=$status_write_rc"
  exit "$final_rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir "$attempt/input" "$attempt/export"
chmod 0777 "$attempt/export"
date -u +%FT%TZ > "$attempt/started-at"
printf '%s\n' "$image" > "$attempt/image-id"
git -C "$root" rev-parse HEAD > "$attempt/revision"
git -C "$root" diff --binary -- src test schemas scripts package.json tsconfig.json bunfig.toml .clooks/vendor/plugin > "$attempt/tracked-source.diff"
for path in src test schemas scripts tsconfig.json bunfig.toml package.json bun.lock; do
  cp -a "$root/$path" "$attempt/input/$path"
done
mkdir -p "$attempt/input/.clooks/vendor"
cp -a "$root/.clooks/vendor/plugin" "$attempt/input/.clooks/vendor/plugin"
cp "$root/scripts/test-codex-native.sh" "$attempt/runner.sh"
chmod -R a-w "$attempt/input"
(cd "$attempt/input" && find . -type f -print0 | sort -z | xargs -0 sha256sum) > "$attempt/source.sha256"

cmd=(docker run --pull never --name "$name" --network none --init
  --user root --entrypoint /bin/bash --label clooks.native=m1)
for path in src test schemas scripts tsconfig.json bunfig.toml package.json .clooks/vendor/plugin; do
  cmd+=(--mount "type=bind,src=$attempt/input/$path,dst=/app/$path,readonly")
done
if [[ "$mode" == --smoke ]]; then cmd+=(--mount "type=bind,src=$vendor,dst=/native,readonly"); fi
cmd+=(--mount "type=bind,src=$attempt/export,dst=/export"
  --env CLOOKS_NATIVE_LOGDIR=/export --env "CLOOKS_NATIVE_MODE=$mode"
  "$image" /app/test/native-codex/container-entrypoint.sh)
printf '%q ' timeout --signal=TERM --kill-after=15s 420s "${cmd[@]}" > "$attempt/command.sh"
printf '\n' >> "$attempt/command.sh"
created=1
stage=run
set +e
timeout --signal=TERM --kill-after=15s 420s "${cmd[@]}" > "$attempt/attempt.log" 2>&1
docker_rc=$?
set -e
rc=$docker_rc
if [[ "$rc" == 0 && ! -s "$attempt/export/passed.json" ]]; then rc=66; fi
exit "$rc"
