#!/bin/zsh
set -euo pipefail
here=${0:A:h}
"$here/build.sh"
xcrun clang -O0 -fobjc-arc -framework AppKit -framework Foundation \
  -fmodules-cache-path="$here/.build/module-cache" \
  "$here/test-shutdown-state.m" -o "$here/.build/test-shutdown-state"
"$here/.build/test-shutdown-state"
node "$here/test-shutdown.mjs"
