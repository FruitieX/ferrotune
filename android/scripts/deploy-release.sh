#!/usr/bin/env bash
# Builds the minified release APK the way CI does and installs it on a device,
# so a local build updates a CI install and later CI builds update it in turn:
#
# - Signed with the release key: FERROTUNE_RELEASE_KEYSTORE (+ _PASSWORD,
#   FERROTUNE_RELEASE_KEY_ALIAS, FERROTUNE_RELEASE_KEY_PASSWORD) when set,
#   otherwise read from 1Password with op-agent. Without either it falls back to
#   the local debug keystore (fine for emulators; a phone with a CI build
#   rejects it).
# - versionCode is what the newest CI run publishes (1000 + its run number) and
#   never below the build already on the device. Every CI run started later
#   has a higher code, so it installs over this one.
# - Push config from FERROTUNE_GOOGLE_SERVICES_JSON, app/google-services.json
#   or 1Password, so push wake-ups work like in CI builds.
#
# FERROTUNE_ANDROID_VERSION_CODE overrides the computed version code.
set -euo pipefail

: "${ANDROID_HOME:?ANDROID_HOME must be set}"
cd "$(dirname "$0")/.."

package=org.fruitiex.ferrotune
op_vault=Agents
op_keystore="ferrotune-release.jks (Android release keystore)"
op_keystore_passwords="ferrotune release keystore passwords"
op_google_services="Ferrotune firebase google-services.json"

adb="${ANDROID_HOME}/platform-tools/adb"
adb_args=()
if [[ -n "${ANDROID_SERIAL:-}" ]]; then
  adb_args+=(-s "$ANDROID_SERIAL")
fi

tmp_dir=$(mktemp -d)
chmod 700 "$tmp_dir"
trap 'rm -rf "$tmp_dir"' EXIT

have_op() { command -v op-agent >/dev/null 2>&1; }

# Version: the newest CI run's code, or the installed one if that is higher.
installed_code=$("$adb" "${adb_args[@]}" shell dumpsys package "$package" 2>/dev/null |
  grep -o 'versionCode=[0-9]*' | head -1 | cut -d= -f2 || true)
ci_run=$(gh run list -R FruitieX/ferrotune --workflow ci.yml -L 1 --json number -q '.[0].number' 2>/dev/null || true)
if [[ -z "${FERROTUNE_ANDROID_VERSION_CODE:-}" ]]; then
  code=1
  [[ "$ci_run" =~ ^[0-9]+$ ]] && code=$((1000 + ci_run))
  [[ "$installed_code" =~ ^[0-9]+$ ]] && ((installed_code > code)) && code=$installed_code
  if ((code == 1)); then
    echo "warning: couldn't read the newest CI run (gh) or the installed version; using versionCode 1" >&2
  fi
  export FERROTUNE_ANDROID_VERSION_CODE=$code
fi
base_version=$(grep -m1 '"version"' ../client/src-tauri/tauri.conf.json | sed -E 's/.*"([0-9]+)\.([0-9]+)\.[0-9]+".*/\1.\2/')
export FERROTUNE_APP_VERSION_NAME="${FERROTUNE_APP_VERSION_NAME:-${base_version}.$((FERROTUNE_ANDROID_VERSION_CODE - 1000))-local.$(git rev-parse --short=7 HEAD)}"
echo "Building $FERROTUNE_APP_VERSION_NAME (versionCode $FERROTUNE_ANDROID_VERSION_CODE; installed: ${installed_code:-none})"

# Push config.
if [[ -z "${FERROTUNE_GOOGLE_SERVICES_JSON:-}" && ! -f app/google-services.json ]]; then
  if have_op && op-agent document get "$op_google_services" --vault "$op_vault" \
      --out-file "$tmp_dir/google-services.json" >/dev/null 2>&1; then
    export FERROTUNE_GOOGLE_SERVICES_JSON="$tmp_dir/google-services.json"
  else
    echo "warning: no google-services.json; this build has no push wake-ups" >&2
  fi
fi

./gradlew :app:assembleRelease

unsigned="app/build/outputs/apk/release/app-release-unsigned.apk"
signed="app/build/outputs/apk/release/app-release-local.apk"
apksigner=$(find "$ANDROID_HOME/build-tools" -name apksigner | sort -V | tail -1)

# Release key: environment first, then 1Password.
if [[ -z "${FERROTUNE_RELEASE_KEYSTORE:-}" ]] && have_op &&
    op-agent document get "$op_keystore" --vault "$op_vault" --out-file "$tmp_dir/release.jks" >/dev/null 2>&1; then
  FERROTUNE_RELEASE_KEYSTORE="$tmp_dir/release.jks"
  FERROTUNE_RELEASE_KEYSTORE_PASSWORD=$(op-agent read "op://$op_vault/$op_keystore_passwords/password")
  FERROTUNE_RELEASE_KEY_ALIAS=$(op-agent read "op://$op_vault/$op_keystore_passwords/key_alias")
  FERROTUNE_RELEASE_KEY_PASSWORD=$(op-agent read "op://$op_vault/$op_keystore_passwords/key_password")
fi

if [[ -n "${FERROTUNE_RELEASE_KEYSTORE:-}" ]]; then
  if [[ ! -f "$FERROTUNE_RELEASE_KEYSTORE" ]]; then
    echo "FERROTUNE_RELEASE_KEYSTORE points at a missing file: $FERROTUNE_RELEASE_KEYSTORE" >&2
    exit 1
  fi
  "$apksigner" sign \
    --ks "$FERROTUNE_RELEASE_KEYSTORE" \
    --ks-pass "pass:${FERROTUNE_RELEASE_KEYSTORE_PASSWORD:?Set FERROTUNE_RELEASE_KEYSTORE_PASSWORD}" \
    --ks-key-alias "${FERROTUNE_RELEASE_KEY_ALIAS:?Set FERROTUNE_RELEASE_KEY_ALIAS}" \
    --key-pass "pass:${FERROTUNE_RELEASE_KEY_PASSWORD:?Set FERROTUNE_RELEASE_KEY_PASSWORD}" \
    --out "$signed" "$unsigned"
else
  echo "warning: no release key; signing with the debug keystore (a CI install won't accept this APK)" >&2
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

"$adb" "${adb_args[@]}" install -r "$signed"
"$adb" "${adb_args[@]}" shell am start -S -n "$package/com.ferrotune.music.MainActivity"
