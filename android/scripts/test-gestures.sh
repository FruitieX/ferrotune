#!/usr/bin/env bash
set -euo pipefail
: "${ANDROID_HOME:?Run inside the Android nix shell}"
source scripts/test-emulator.sh
ANDROID_SERIAL="$test_serial" ./gradlew :feature:player:connectedDebugAndroidTest \
  -Pandroid.injected.device.serial="$test_serial"
