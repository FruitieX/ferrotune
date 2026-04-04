#!/usr/bin/env bash
set -euo pipefail

echo "=== Ferrotune devcontainer post-create ==="

# --- direnv setup ---
if ! grep -q 'direnv hook bash' ~/.bashrc 2>/dev/null; then
    echo 'eval "$(direnv hook bash)"' >> ~/.bashrc
    echo "Added direnv hook to .bashrc"
fi

# Trust the workspace .envrc so nix flake activates automatically
if [[ -f /workspace/.envrc ]]; then
    direnv allow /workspace
    echo "direnv: allowed /workspace/.envrc"
fi

# --- Data directory ---
sudo mkdir -p /data
sudo chown -R "$(id -u):$(id -g)" /data
echo "Ensured /data directory"

# --- Playwright system dependencies ---
# Install system libraries needed by Chromium (used by Playwright E2E tests).
# The actual browser binary is installed by pnpm/moon tasks on demand.
if command -v npx &>/dev/null; then
    echo "Installing Playwright system dependencies..."
    sudo npx playwright install-deps chromium 2>/dev/null || true
fi

# --- User-local post-create hook ---
# This file is never committed (excluded via .git/info/exclude).
# The dev-container manager script generates it with user-specific setup
# (dotfiles, gh auth, aliases, etc.)
if [[ -f /workspace/.devcontainer/post-create-local.sh ]]; then
    echo "Running user-local post-create script..."
    bash /workspace/.devcontainer/post-create-local.sh
fi

echo "=== post-create done ==="
