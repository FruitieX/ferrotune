#!/usr/bin/env bash
set -euo pipefail

output_path=${1:?Usage: write-app-release-notes.sh <output-path>}
: "${FERROTUNE_APP_VERSION_NAME:?FERROTUNE_APP_VERSION_NAME is required}"
: "${FERROTUNE_ANDROID_VERSION_CODE:?FERROTUNE_ANDROID_VERSION_CODE is required}"
: "${FERROTUNE_RELEASE_TAG:?FERROTUNE_RELEASE_TAG is required}"

mkdir -p "$(dirname "$output_path")"

commit_url="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-FruitieX/ferrotune}/commit/${GITHUB_SHA:-unknown}"
run_url="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-FruitieX/ferrotune}/actions/runs/${GITHUB_RUN_ID:-unknown}"

cat > "$output_path" <<EOF
Automated Ferrotune app build from main.

- Commit: ${GITHUB_SHA:-unknown}
- Commit URL: $commit_url
- Workflow run: $run_url
- App version: $FERROTUNE_APP_VERSION_NAME
- Android versionCode: $FERROTUNE_ANDROID_VERSION_CODE

Artifacts:

- The Android universal APK is signed with the Ferrotune Android release key and is intended for Obtainium.
- Desktop bundles are unsigned and not notarized.

Android update note:

Devices that currently have a debug-keystore build installed from local USB deployment must uninstall that build once before installing this release-signed APK.
EOF

cat "$output_path"