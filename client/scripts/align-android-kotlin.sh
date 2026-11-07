#!/usr/bin/env bash
# `tauri android init` regenerates the Gradle project with the Kotlin Gradle
# plugin version baked into the Tauri CLI template. Libraries compiled with a
# newer Kotlin (e.g. play-services-cast-framework 23) fail to compile against
# it, so pin the generated project to the Kotlin version the native Android
# app uses (kept current by Renovate in android/gradle/libs.versions.toml).
set -euo pipefail

cd "$(dirname "$0")/.."

BUILD_FILE="src-tauri/gen/android/build.gradle.kts"
BUILDSRC_FILE="src-tauri/gen/android/buildSrc/build.gradle.kts"
VERSIONS_FILE="../android/gradle/libs.versions.toml"

if [[ ! -f "$BUILD_FILE" || ! -f "$BUILDSRC_FILE" ]]; then
  echo "Android project not initialized: $BUILD_FILE"
  echo "Run 'pnpm exec tauri android init' first."
  exit 1
fi

KOTLIN_VERSION=$(sed -n 's/^kotlin = "\([^"]*\)"$/\1/p' "$VERSIONS_FILE")
if [[ -z "$KOTLIN_VERSION" ]]; then
  echo "Could not read the kotlin version from $VERSIONS_FILE"
  exit 1
fi

if ! grep -q 'org.jetbrains.kotlin:kotlin-gradle-plugin:' "$BUILD_FILE"; then
  echo "No kotlin-gradle-plugin classpath entry found in $BUILD_FILE"
  exit 1
fi

sed -i "s/org\.jetbrains\.kotlin:kotlin-gradle-plugin:[^\"]*/org.jetbrains.kotlin:kotlin-gradle-plugin:${KOTLIN_VERSION}/" "$BUILD_FILE"

# buildSrc depends on AGP, which pulls in its own (older) Kotlin Gradle plugin,
# and buildSrc's classpath takes precedence over the root buildscript's.
# Depend on the pinned version there too so Gradle resolves to it.
sed -i '/org\.jetbrains\.kotlin:kotlin-gradle-plugin:/d' "$BUILDSRC_FILE"
if ! grep -q 'implementation("com.android.tools.build:gradle:' "$BUILDSRC_FILE"; then
  echo "No AGP dependency found in $BUILDSRC_FILE"
  exit 1
fi
sed -i "/implementation(\"com\.android\.tools\.build:gradle:/a\\    implementation(\"org.jetbrains.kotlin:kotlin-gradle-plugin:${KOTLIN_VERSION}\")" "$BUILDSRC_FILE"
echo "Pinned the Tauri Android Kotlin Gradle plugin to ${KOTLIN_VERSION}"
