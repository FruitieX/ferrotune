#!/usr/bin/env bash
set -euo pipefail

if [[ "${CI:-}" == "true" ]]; then
    set -x
    if command -v google-chrome-stable >/dev/null 2>&1; then
        google-chrome-stable --version
    elif command -v google-chrome >/dev/null 2>&1; then
        google-chrome --version
    else
        echo "CI Playwright tests use the system Chrome channel, but Chrome was not found." >&2
        exit 1
    fi

    timeout 60 pnpm exec playwright install ffmpeg
    echo "Skipping Playwright browser download in CI."
    exit 0
fi

pnpm exec playwright install chromium "$@"