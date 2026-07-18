#!/usr/bin/env bash
set -euo pipefail

requirement="${1:-}"

case "$requirement" in
  docker)
    if ! command -v docker >/dev/null 2>&1; then
      printf 'Docker is required for PostgreSQL tests but was not found in PATH.\n' >&2
      exit 1
    fi
    if ! docker info >/dev/null 2>&1; then
      printf 'Docker is required for PostgreSQL tests but the daemon is unavailable.\n' >&2
      exit 1
    fi
    ;;
  hurl)
    if ! command -v hurl >/dev/null 2>&1; then
      printf 'Hurl is required for integration tests but was not found in PATH.\n' >&2
      exit 1
    fi
    ;;
  *)
    printf 'Usage: %s <docker|hurl>\n' "$0" >&2
    exit 2
    ;;
esac
