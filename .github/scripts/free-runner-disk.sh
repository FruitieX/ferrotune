#!/usr/bin/env bash
# GitHub's ubuntu-latest runners ship with large preinstalled SDKs that our
# jobs never use (the Android jobs take their SDK and NDK from Nix). Without
# removing them, the Nix NDK unpack and the Rust test linking can run out of
# disk ("No space left on device", ld "Bus error").
set -euo pipefail

df -h /
sudo rm -rf \
  /usr/local/lib/android \
  /usr/share/dotnet \
  /usr/share/swift \
  /opt/ghc \
  /usr/local/.ghcup \
  /opt/hostedtoolcache/CodeQL
df -h /
