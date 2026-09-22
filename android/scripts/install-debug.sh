#!/usr/bin/env bash
set -euo pipefail

: "${ANDROID_HOME:?ANDROID_HOME must be set}"

apk="app/build/outputs/apk/debug/app-debug.apk"
if [[ ! -f "$apk" ]]; then
  echo "Debug APK not found at $apk; run moon run android:assemble-debug first" >&2
  exit 1
fi

adb_args=()
if [[ -n "${ANDROID_ADB_SERVER_ADDRESS:-}" ]]; then
  adb_args+=(-H "$ANDROID_ADB_SERVER_ADDRESS")
fi
if [[ -n "${ANDROID_SERIAL:-}" ]]; then
  adb_args+=(-s "$ANDROID_SERIAL")
fi

"${ANDROID_HOME}/platform-tools/adb" "${adb_args[@]}" install -r "$apk"
