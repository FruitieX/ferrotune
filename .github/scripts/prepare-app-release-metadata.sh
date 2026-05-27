#!/usr/bin/env bash
set -euo pipefail

base_version=$(node -e "const fs = require('fs'); const cfg = JSON.parse(fs.readFileSync('client/src-tauri/tauri.conf.json', 'utf8')); process.stdout.write(cfg.version);")
IFS='.' read -r major minor _patch <<< "$base_version"
major=${major:-0}
minor=${minor:-0}

run_number=${GITHUB_RUN_NUMBER:-1}
if [[ ! "$run_number" =~ ^[0-9]+$ ]]; then
  echo "GITHUB_RUN_NUMBER must be numeric, got: $run_number" >&2
  exit 1
fi

version_name="${major}.${minor}.${run_number}"
version_code=$((1000 + run_number))
if (( version_code <= 1000 )); then
  version_code=1001
fi

sha=${GITHUB_SHA:-$(git rev-parse HEAD)}
short_sha=${sha:0:7}
asset_version="main-${version_code}-${short_sha}"
tag_name="app-main-${version_code}-${short_sha}"
release_name="Ferrotune app build ${version_name}"

write_output() {
  local key=$1
  local value=$2
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    printf '%s=%s\n' "$key" "$value" >> "$GITHUB_OUTPUT"
  fi
}

write_output version_name "$version_name"
write_output version_code "$version_code"
write_output short_sha "$short_sha"
write_output asset_version "$asset_version"
write_output tag_name "$tag_name"
write_output release_name "$release_name"

mkdir -p app-release
cat > app-release/app-build-metadata.env <<EOF
FERROTUNE_APP_VERSION_NAME=$version_name
FERROTUNE_ANDROID_VERSION_CODE=$version_code
FERROTUNE_SHORT_SHA=$short_sha
FERROTUNE_ASSET_VERSION=$asset_version
FERROTUNE_RELEASE_TAG=$tag_name
FERROTUNE_RELEASE_NAME=$release_name
EOF

cat app-release/app-build-metadata.env