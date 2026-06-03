#!/usr/bin/env bash
set -euo pipefail

APP_ID="${FERROTUNE_ANDROID_APP_ID:-com.ferrotune.music}"
ADB_BIN="${ADB:-adb}"
OUTPUT_ROOT="${1:-test-results/android-diagnostics}"
REMOTE_DIAGNOSTICS_DIR="/sdcard/Android/data/${APP_ID}/files/diagnostics/native-audio"

if ! command -v "${ADB_BIN}" >/dev/null 2>&1; then
  echo "adb not found. Run inside the Android nix shell or set ADB=/path/to/adb." >&2
  exit 127
fi

mapfile -t CONNECTED_DEVICES < <("${ADB_BIN}" devices | awk 'NR > 1 && $2 == "device" { print $1 }')

if [[ -n "${ANDROID_SERIAL:-}" ]]; then
  DEVICE_SERIAL="${ANDROID_SERIAL}"
elif [[ "${#CONNECTED_DEVICES[@]}" -eq 1 ]]; then
  DEVICE_SERIAL="${CONNECTED_DEVICES[0]}"
elif [[ "${#CONNECTED_DEVICES[@]}" -eq 0 ]]; then
  echo "No authorized Android device found via adb." >&2
  exit 1
else
  echo "Multiple Android devices found. Set ANDROID_SERIAL to choose one:" >&2
  printf '  %s\n' "${CONNECTED_DEVICES[@]}" >&2
  exit 1
fi

adb_cmd() {
  "${ADB_BIN}" -s "${DEVICE_SERIAL}" "$@"
}

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
safe_serial="${DEVICE_SERIAL//[^A-Za-z0-9_.-]/_}"
output_dir="${OUTPUT_ROOT}/${timestamp}-${safe_serial}"
mkdir -p "${output_dir}"

{
  echo "collected_at_utc=${timestamp}"
  echo "device_serial=${DEVICE_SERIAL}"
  echo "app_id=${APP_ID}"
  echo "remote_diagnostics_dir=${REMOTE_DIAGNOSTICS_DIR}"
} > "${output_dir}/manifest.txt"

adb_cmd shell getprop > "${output_dir}/device-getprop.txt" || true
adb_cmd shell pm path "${APP_ID}" > "${output_dir}/package-path.txt" || true
adb_cmd shell dumpsys package "${APP_ID}" > "${output_dir}/package-dumpsys.txt" || true

if adb_cmd shell "test -d '${REMOTE_DIAGNOSTICS_DIR}'" >/dev/null 2>&1; then
  mkdir -p "${output_dir}/native-audio"
  if ! adb_cmd pull "${REMOTE_DIAGNOSTICS_DIR}" "${output_dir}/native-audio"; then
    echo "adb pull from ${REMOTE_DIAGNOSTICS_DIR} failed; trying run-as fallback." >&2
  fi
else
  echo "External diagnostics directory not found: ${REMOTE_DIAGNOSTICS_DIR}" >&2
fi

if [[ ! -d "${output_dir}/native-audio/native-audio" && ! -f "${output_dir}/native-audio/manifest.json" ]]; then
  if adb_cmd exec-out run-as "${APP_ID}" sh -c 'if cd files/diagnostics/native-audio 2>/dev/null; then tar -cf - .; elif cd no_backup/diagnostics/native-audio 2>/dev/null; then tar -cf - .; else exit 1; fi' > "${output_dir}/native-audio-private.tar"; then
    if [[ ! -s "${output_dir}/native-audio-private.tar" ]]; then
      rm -f "${output_dir}/native-audio-private.tar"
      echo "run-as fallback produced no diagnostics." >&2
    fi
  else
    rm -f "${output_dir}/native-audio-private.tar"
    echo "run-as fallback failed. This is expected for non-debuggable builds." >&2
  fi
fi

adb_cmd logcat -d -v threadtime -t 2000 \
  NativeAudioPlugin:D \
  PlaybackService:D \
  FerrotuneApiClient:D \
  ReplayGainAudioProcessor:D \
  NativeAudioLogger:D \
  '*:S' > "${output_dir}/logcat-tail.txt" || true

cat > "${output_dir}/README.txt" <<README
Ferrotune Android diagnostics bundle

Collected at: ${timestamp}
Device serial: ${DEVICE_SERIAL}
App id: ${APP_ID}

Primary native audio logs are expected under:
  native-audio/native-audio/

If the primary adb pull was unavailable but run-as worked, inspect:
  native-audio-private.tar

Fresh logcat tail for native audio tags:
  logcat-tail.txt

Correlate native JSONL timestamps, song ids, queue indexes, HTTP status codes,
and Media3 error codes with Ferrotune server /api/stream and transcode logs.
README

echo "Android diagnostics written to ${output_dir}"