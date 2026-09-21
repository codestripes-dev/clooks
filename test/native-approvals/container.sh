#!/usr/bin/env bash
set -uo pipefail
[[ $(id -u) != 0 ]] || exit 66
bun test ./test/native-approvals/channel.test.ts ./test/native-approvals/overlap.test.ts ./test/native-approvals/boundary.test.ts ./test/native-approvals/run.test.ts ./test/native-approvals/generated.test.ts ./test/native-approvals/native-config.test.ts
unit_rc=$?
[[ $unit_rc == 0 ]] || exit "$unit_rc"
for arg in "$@"; do
  if [[ $arg == --runtime-advisory ]]; then
    bun test ./src/commands/init-advisory.test.ts ./test/native-approvals/runtime-advisory.test.ts
    advisory_unit_rc=$?
    [[ $advisory_unit_rc == 0 ]] || exit "$advisory_unit_rc"
  fi
  if [[ $arg == --generated || $arg == --runtime-advisory ]]; then
    mkdir -p /app/generated-build /export/build
    cp -a /snapshot/src /snapshot/schemas /snapshot/scripts /app/generated-build/
    mkdir -p /app/generated-build/.clooks/vendor
    cp -a /snapshot/.clooks/vendor/plugin /app/generated-build/.clooks/vendor/
    cp /snapshot/package.json /snapshot/bun.lock /snapshot/tsconfig.json /app/generated-build/
    ln -s /app/test /app/generated-build/test
    ln -s /app/node_modules /app/generated-build/node_modules
    cp /snapshot/source-commit /export/build/source-commit
    bun run --cwd /app/generated-build typecheck > /export/build/typecheck.log 2>&1
    typecheck_rc=$?
    [[ $typecheck_rc == 0 ]] || exit "$typecheck_rc"
    bun build --compile --bytecode --format=esm --outfile /export/build/clooks /app/generated-build/src/cli.ts > /export/build/build.log 2>&1
    build_rc=$?
    [[ $build_rc == 0 ]] || exit "$build_rc"
    sha256sum /export/build/clooks > /export/build/binary.sha256
    find /snapshot/src /snapshot/schemas -type f -exec sha256sum {} + > /export/build/sources.sha256
    bun --version > /export/build/bun-version
  fi
done
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
