#!/usr/bin/env bash
set -uo pipefail
[[ $(id -u) != 0 ]] || exit 66
bun test ./test/native-approvals/channel.test.ts ./test/native-approvals/overlap.test.ts ./test/native-approvals/boundary.test.ts ./test/native-approvals/run.test.ts
unit_rc=$?
[[ $unit_rc == 0 ]] || exit "$unit_rc"
bun /app/test/native-approvals/run.ts "$@"
rc=$?
# The test owner makes disposable native private directories inspectable only
# after clients exit; host HOME and client configuration are never mounted.
find /export -mindepth 1 \( -type f -o -type d \) -exec chmod a+rX {} +
permission_rc=$?
printf '%s\n' "$rc" > /export/test.rc
printf '%s\n' "$permission_rc" > /export/permissions.rc
[[ $rc != 0 || $permission_rc == 0 ]] || rc=$permission_rc
exit "$rc"
