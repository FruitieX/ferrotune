#!/usr/bin/env bash
# Regenerate Kotlin DTOs from the committed ts-rs TypeScript contracts.
#
# Run `moon run generate-bindings` first when Rust response types changed;
# this script only converts the committed TS output and never invokes cargo.
#
# Run from anywhere; it resolves the repository root itself.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$REPO_ROOT"
exec node android/scripts/generate-kotlin-bindings.mjs
