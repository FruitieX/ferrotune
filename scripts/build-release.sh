#!/bin/bash
# Build script for creating a Ferrotune release with embedded UI
# This script builds both the Next.js client and the Rust server

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== Building Ferrotune with Embedded UI ==="

# Step 1: Build Next.js client as static export
echo ""
echo "Step 1: Building Next.js client..."
cd "$PROJECT_DIR/client"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing npm dependencies..."
    npm install
fi

# Build with static export enabled
echo "Building static export..."
NEXT_OUTPUT_STATIC=1 npm run build

# Verify export was created
if [ ! -f "out/index.html" ]; then
    echo "Error: Static export failed - out/index.html not found"
    exit 1
fi

echo "Static export created successfully: $(du -sh out | cut -f1)"

# Step 2: Build Rust server with embedded UI
echo ""
echo "Step 2: Building Rust server with embedded UI..."
cd "$PROJECT_DIR"

cargo build --release --features embedded-ui

# Verify binary was created
BINARY_PATH="$PROJECT_DIR/target/release/ferrotune"
if [ ! -f "$BINARY_PATH" ]; then
    echo "Error: Release build failed - binary not found"
    exit 1
fi

echo "Binary built successfully: $(du -sh "$BINARY_PATH" | cut -f1)"

echo ""
echo "=== Build Complete ==="
echo "Binary location: $BINARY_PATH"
echo ""
echo "Run the server with:"
echo "  $BINARY_PATH --config config.example.toml serve"
echo ""
echo "Access the web UI at http://localhost:4040/"
