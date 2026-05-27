#!/usr/bin/env bash
set -euo pipefail

unsigned_apk=${1:?Usage: sign-android-apk.sh <unsigned-apk> <signed-apk>}
signed_apk=${2:?Usage: sign-android-apk.sh <unsigned-apk> <signed-apk>}

: "${ANDROID_HOME:?ANDROID_HOME is required}"
: "${ANDROID_RELEASE_KEYSTORE_BASE64:?ANDROID_RELEASE_KEYSTORE_BASE64 is required}"
: "${ANDROID_RELEASE_KEYSTORE_PASSWORD:?ANDROID_RELEASE_KEYSTORE_PASSWORD is required}"
: "${ANDROID_RELEASE_KEY_ALIAS:?ANDROID_RELEASE_KEY_ALIAS is required}"
: "${ANDROID_RELEASE_KEY_PASSWORD:?ANDROID_RELEASE_KEY_PASSWORD is required}"

if [[ ! -f "$unsigned_apk" ]]; then
  echo "Unsigned APK not found: $unsigned_apk" >&2
  exit 1
fi

apksigner=$(find "$ANDROID_HOME" -name apksigner | sort -V | tail -n 1)
if [[ -n "$apksigner" ]]; then
  apksigner_cmd=("$apksigner")
else
  apksigner_jar=$(find "$ANDROID_HOME" -name apksigner.jar | sort -V | tail -n 1)
  if [[ -z "$apksigner_jar" ]]; then
    echo "apksigner was not found under ANDROID_HOME=$ANDROID_HOME" >&2
    exit 1
  fi
  apksigner_cmd=(java -jar "$apksigner_jar")
fi

tmp_dir=${RUNNER_TEMP:-${TMPDIR:-.}}
mkdir -p "$tmp_dir" "$(dirname "$signed_apk")"
keystore=$(mktemp "$tmp_dir/ferrotune-release-keystore.XXXXXX")
trap 'rm -f "$keystore"' EXIT

printf '%s' "$ANDROID_RELEASE_KEYSTORE_BASE64" | base64 --decode > "$keystore"

"${apksigner_cmd[@]}" sign \
  --out "$signed_apk" \
  --ks "$keystore" \
  --ks-pass "pass:$ANDROID_RELEASE_KEYSTORE_PASSWORD" \
  --ks-key-alias "$ANDROID_RELEASE_KEY_ALIAS" \
  --key-pass "pass:$ANDROID_RELEASE_KEY_PASSWORD" \
  "$unsigned_apk"

"${apksigner_cmd[@]}" verify --verbose --print-certs "$signed_apk"
echo "Signed APK: $signed_apk"