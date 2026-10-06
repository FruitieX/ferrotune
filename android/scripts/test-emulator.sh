# Shared emulator selection for automated native Android tests.
adb="$ANDROID_HOME/platform-tools/adb"
adb_args=()
if [[ -n "${ANDROID_ADB_SERVER_ADDRESS:-}" ]]; then adb_args+=(-H "$ANDROID_ADB_SERVER_ADDRESS"); fi
test_serial="${ANDROID_SERIAL:-}"
if [[ -z "$test_serial" ]]; then
  test_serial=$("$adb" "${adb_args[@]}" devices | awk '$1 ~ /^emulator-/ && $2 == "device" { print $1; exit }')
fi
if [[ "$test_serial" != emulator-* ]]; then
  echo "Automated tests require an emulator; start an AVD and set ANDROID_SERIAL to its emulator serial." >&2
  exit 1
fi
adb_args+=(-s "$test_serial")
