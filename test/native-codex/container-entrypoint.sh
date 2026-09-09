#!/usr/bin/env bash
set -euo pipefail

if [[ ${1:-} != --inside ]]; then
  # Root setup is limited to this disposable-container login-shell discovery link.
  ln -s /app/dist/clooks /usr/local/bin/clooks
  exec su -s /bin/bash testuser -c 'exec /bin/bash /app/test/native-codex/container-entrypoint.sh --inside'
fi

[[ $(id -u) != 0 && ${CLOOKS_NATIVE_LOGDIR:-} == /export ]]
case ${CLOOKS_NATIVE_MODE:-} in
  --unit) selected=./test/native-codex/harness.test.ts ;;
  --smoke) selected=./test/native-codex/native-conformance.smoke.test.ts ;;
  *) echo 'Missing native test mode' >&2; exit 64 ;;
esac

bun --version > /export/bun-version
set +e
/bin/bash test/docker-entrypoint.sh "$selected"
test_rc=$?
printf '%s\n' "$test_rc" > /export/test.rc || exit 74
status_rc=not-run
if [[ "$test_rc" == 0 ]]; then
  CLOOKS_NATIVE_TEST_RC="$test_rc" bun -e '
    import { publishPassed } from "./test/native-codex/harness.ts";
    process.exit(publishPassed(process.env.CLOOKS_NATIVE_LOGDIR,
      process.env.CLOOKS_NATIVE_MODE, Number(process.env.CLOOKS_NATIVE_TEST_RC)));
  '
  status_rc=$?
fi
printf '%s\n' "$status_rc" > /export/status.rc || exit 74
artifact_rc=0
if [[ "$test_rc" == 0 && "$status_rc" == 0 && "$CLOOKS_NATIVE_MODE" == --smoke ]]; then
  bun -e '
    import { exportSmokeBinary } from "./test/native-codex/harness.ts";
    exportSmokeBinary("/export", "--smoke", "/app/dist/clooks");
  '
  artifact_rc=$?
fi
printf '%s\n' "$artifact_rc" > /export/artifact.rc || exit 74
# The non-root creator can seal its own exports; the host only seals the bind root.
find /export -mindepth 1 -exec chmod a-w {} +
seal_rc=$?
printf 'Native container test rc=%s; completion rc=%s; export chmod rc=%s\n' "$test_rc" "$status_rc" "$seal_rc"
if [[ "$test_rc" != 0 ]]; then exit "$test_rc"; fi
if [[ "$status_rc" != 0 ]]; then exit "$status_rc"; fi
if [[ "$artifact_rc" != 0 ]]; then exit "$artifact_rc"; fi
if [[ "$seal_rc" != 0 ]]; then exit 74; fi
exit 0
