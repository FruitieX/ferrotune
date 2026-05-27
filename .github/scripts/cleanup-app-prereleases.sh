#!/usr/bin/env bash
set -euo pipefail

keep=${1:-10}
if [[ ! "$keep" =~ ^[0-9]+$ ]] || (( keep < 1 )); then
  echo "Keep count must be a positive integer, got: $keep" >&2
  exit 1
fi

mapfile -t tags < <(
  gh release list \
    --limit 100 \
    --json tagName,isPrerelease \
    --jq '.[] | select(.isPrerelease and (.tagName | startswith("app-main-"))) | .tagName'
)

for index in "${!tags[@]}"; do
  if (( index < keep )); then
    continue
  fi

  tag=${tags[$index]}
  echo "Deleting old app prerelease: $tag"
  gh release delete "$tag" --yes --cleanup-tag || true
done