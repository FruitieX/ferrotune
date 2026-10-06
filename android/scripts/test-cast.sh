#!/usr/bin/env bash
set -euo pipefail
: "${ANDROID_HOME:?Run inside the Android nix shell}"
source scripts/test-emulator.sh
original_mode=$("$adb" "${adb_args[@]}" shell cmd uimode night | sed -n 's/^Night mode: //p' | tr -d '\r')
trap '"$adb" "${adb_args[@]}" shell cmd uimode night "${original_mode:-auto}" >/dev/null' EXIT
for mode in no yes; do
  "$adb" "${adb_args[@]}" shell cmd uimode night "$mode"
  ANDROID_SERIAL="$test_serial" ./gradlew :app:connectedDebugAndroidTest \
    -Pandroid.injected.device.serial="$test_serial" "$@"
done
