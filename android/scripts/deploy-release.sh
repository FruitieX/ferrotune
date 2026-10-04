#!/usr/bin/env bash
# Installs the minified release build on a device for day-to-day use.
#
# The unsigned release APK is signed with the local debug keystore (like the
# Tauri `tauri-android-deploy` task), so it updates a debug install in place
# while running the R8-optimized code. Set FERROTUNE_RELEASE_KEYSTORE and
# friends to sign with the real release key instead.
set -euo pipefail

: "${ANDROID_HOME:?ANDROID_HOME must be set}"

unsigned="app/build/outputs/apk/release/app-release-unsigned.apk"
signed="app/build/outputs/apk/release/app-release-local.apk"
if [[ ! -f "$unsigned" ]]; then
  echo "Release APK not found at $unsigned; run moon run android:assemble-release first" >&2
  exit 1
fi

apksigner=$(find "$ANDROID_HOME/build-tools" -name apksigner | sort -V | tail -1)
if [[ -n "${FERROTUNE_RELEASE_KEYSTORE:-}" ]]; then
  "$apksigner" sign \
    --ks "$FERROTUNE_RELEASE_KEYSTORE" \
    --ks-pass "pass:${FERROTUNE_RELEASE_KEYSTORE_PASSWORD:?Set FERROTUNE_RELEASE_KEYSTORE_PASSWORD}" \
    --ks-key-alias "${FERROTUNE_RELEASE_KEY_ALIAS:?Set FERROTUNE_RELEASE_KEY_ALIAS}" \
    --key-pass "pass:${FERROTUNE_RELEASE_KEY_PASSWORD:?Set FERROTUNE_RELEASE_KEY_PASSWORD}" \
    --out "$signed" "$unsigned"
else
  keystore="$HOME/.android/debug.keystore"
  if [[ ! -f "$keystore" ]]; then
    mkdir -p "$(dirname "$keystore")"
    keytool -genkeypair -keystore "$keystore" -storepass android -alias androiddebugkey \
      -keypass android -keyalg RSA -keysize 2048 -validity 10000 \
      -dname "CN=Android Debug,O=Android,C=US"
  fi
  "$apksigner" sign --ks "$keystore" --ks-pass pass:android \
    --ks-key-alias androiddebugkey --key-pass pass:android \
    --out "$signed" "$unsigned"
fi

adb_args=()
if [[ -n "${ANDROID_ADB_SERVER_ADDRESS:-}" ]]; then
  adb_args+=(-H "$ANDROID_ADB_SERVER_ADDRESS")
fi
if [[ -n "${ANDROID_SERIAL:-}" ]]; then
  adb_args+=(-s "$ANDROID_SERIAL")
fi

adb="${ANDROID_HOME}/platform-tools/adb"
"$adb" "${adb_args[@]}" install -r "$signed"
"$adb" "${adb_args[@]}" shell am start -S -n com.ferrotune.music.native/com.ferrotune.music.MainActivity
