#!/usr/bin/env bash
# Exercise the minified APK's reflective contracts on an emulator without installing it.
set -euo pipefail
: "${ANDROID_HOME:?Run inside the Android nix shell}"

apk="app/build/outputs/apk/release/app-release-unsigned.apk"
mapping="app/build/outputs/mapping/release/mapping.txt"
read -r api response move < <(node --input-type=module - "$mapping" <<'JS'
import { readFileSync } from 'node:fs';
const names = new Map();
let current, move;
for (const line of readFileSync(process.argv[2], 'utf8').split('\n')) {
  const match = line.match(/^(\S+) -> (\S+):$/);
  if (match) { current = match[1]; names.set(current, match[2]); }
  if (current === 'com.ferrotune.core.network.FerrotuneApi' && line.includes(' moveInQueue(')) {
    move = line.match(/ -> (\S+)$/)?.[1];
  }
}
const values = [
  names.get('com.ferrotune.core.network.FerrotuneApi'),
  names.get('com.ferrotune.core.network.generated.QueueSuccessResponse'),
  move,
];
if (values.some(value => !value)) throw new Error('Required release contract was stripped');
console.log(values.join(' '));
JS
)

source scripts/test-emulator.sh
work=$(mktemp -d)
remote="/data/local/tmp/ferrotune-release-contracts-$$"
cleanup() {
  rm -rf "$work"
  "$adb" "${adb_args[@]}" shell rm -rf "$remote" >/dev/null 2>&1 || true
}
trap cleanup EXIT
android_jar="$ANDROID_HOME/platforms/android-36/android.jar"
d8=$(find "$ANDROID_HOME/build-tools" -name d8 | sort -V | tail -1)
javac -cp "$android_jar" -d "$work" scripts/ReleaseSmoke.java
"$d8" --lib "$android_jar" --min-api 24 --output "$work" "$work/ReleaseSmoke.class"
"$adb" "${adb_args[@]}" shell mkdir -p "$remote"
"$adb" "${adb_args[@]}" push "$apk" "$remote/app.apk" >/dev/null
"$adb" "${adb_args[@]}" push "$work/classes.dex" "$remote/check.dex" >/dev/null
"$adb" "${adb_args[@]}" shell chmod 444 "$remote/app.apk" "$remote/check.dex"
"$adb" "${adb_args[@]}" shell "CLASSPATH=$remote/check.dex app_process /system/bin ReleaseSmoke $remote/app.apk $api $response $move"
