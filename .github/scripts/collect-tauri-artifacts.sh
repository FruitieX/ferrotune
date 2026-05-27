#!/usr/bin/env bash
set -euo pipefail

bundle_root=${1:?Usage: collect-tauri-artifacts.sh <bundle-root> <output-dir> <platform> <asset-version>}
output_dir=${2:?Usage: collect-tauri-artifacts.sh <bundle-root> <output-dir> <platform> <asset-version>}
platform=${3:?Usage: collect-tauri-artifacts.sh <bundle-root> <output-dir> <platform> <asset-version>}
asset_version=${4:?Usage: collect-tauri-artifacts.sh <bundle-root> <output-dir> <platform> <asset-version>}

if [[ ! -d "$bundle_root" ]]; then
  echo "Tauri bundle directory not found: $bundle_root" >&2
  exit 1
fi

mkdir -p "$output_dir"
count=0

while IFS= read -r -d '' artifact; do
  base=$(basename "$artifact")
  safe_base=$(printf '%s' "$base" | tr ' ' '_' | tr -cd 'A-Za-z0-9._+-')
  if [[ -z "$safe_base" ]]; then
    safe_base="artifact-${count}"
  fi

  cp "$artifact" "$output_dir/ferrotune-desktop-${platform}-${asset_version}-${safe_base}"
  count=$((count + 1))
done < <(
  find "$bundle_root" -type f \
    \( -name '*.AppImage' \
    -o -name '*.deb' \
    -o -name '*.rpm' \
    -o -name '*.dmg' \
    -o -name '*.msi' \
    -o -name '*.exe' \
    -o -name '*.app.tar.gz' \) \
    -print0
)

if (( count == 0 )); then
  echo "No Tauri artifacts found under $bundle_root" >&2
  find "$bundle_root" -maxdepth 4 -type f | sort >&2
  exit 1
fi

find "$output_dir" -type f | sort