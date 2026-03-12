#!/usr/bin/env bash
# Kill stale Gradle/Kotlin daemons that cause Android builds to hang
set -e

echo "Stopping Gradle daemons..."
pkill -f GradleDaemon 2>/dev/null && echo "Killed GradleDaemon processes" || echo "No GradleDaemon processes found"
pkill -f GradleWrapperMain 2>/dev/null && echo "Killed GradleWrapperMain processes" || echo "No GradleWrapperMain processes found"

echo "Stopping Kotlin daemons..."
pkill -f "kotlin-daemon" 2>/dev/null && echo "Killed Kotlin daemon processes" || echo "No Kotlin daemon processes found"
pkill -f "org.jetbrains.kotlin" 2>/dev/null && echo "Killed Kotlin compiler processes" || echo "No Kotlin compiler processes found"

echo "Cleaning daemon temp files..."
rm -rf /tmp/kotlin-daemon* ~/.kotlin/daemon
echo "Cleaned Kotlin daemon temp files"

if [ -x "src-tauri/gen/android/gradlew" ]; then
  echo "Stopping Gradle wrapper..."
  (cd src-tauri/gen/android && ./gradlew --stop 2>/dev/null) || true
fi

echo "Done. You can now retry the Android build."
