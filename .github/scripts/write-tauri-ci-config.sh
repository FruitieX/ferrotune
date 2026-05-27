#!/usr/bin/env bash
set -euo pipefail

output_path=${1:?Usage: write-tauri-ci-config.sh <output-path>}
: "${FERROTUNE_APP_VERSION_NAME:?FERROTUNE_APP_VERSION_NAME is required}"
: "${FERROTUNE_ANDROID_VERSION_CODE:?FERROTUNE_ANDROID_VERSION_CODE is required}"

mkdir -p "$(dirname "$output_path")"

node - "$output_path" <<'NODE'
const fs = require('fs');

const outputPath = process.argv[2];
const version = process.env.FERROTUNE_APP_VERSION_NAME;
const versionCode = Number(process.env.FERROTUNE_ANDROID_VERSION_CODE);

if (!version) {
  throw new Error('FERROTUNE_APP_VERSION_NAME is required');
}

if (!Number.isInteger(versionCode) || versionCode < 1 || versionCode > 2100000000) {
  throw new Error(`Invalid FERROTUNE_ANDROID_VERSION_CODE: ${process.env.FERROTUNE_ANDROID_VERSION_CODE}`);
}

const config = {
  version,
  build: {
    beforeBuildCommand: '',
  },
  bundle: {
    android: {
      versionCode,
      autoIncrementVersionCode: false,
    },
  },
};

fs.writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`);
NODE

echo "Wrote $output_path"