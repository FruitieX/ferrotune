#!/usr/bin/env bash
set -euo pipefail

RES_DIR="src-tauri/gen/android/app/src/main/res"

if [[ ! -d "$RES_DIR" ]]; then
  echo "Android project not initialized: $RES_DIR"
  echo "Run 'npx tauri android init' first."
  exit 1
fi

mkdir -p \
  "$RES_DIR/drawable" \
  "$RES_DIR/mipmap-anydpi-v26" \
  "$RES_DIR/mipmap-anydpi-v33"

# Set background color to match the icon's rust color (#b45309)
cat > "$RES_DIR/values/ic_launcher_background.xml" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="ic_launcher_background">#b45309</color>
</resources>
EOF

# Remove the incorrect default Android Studio background drawable if present
rm -f "$RES_DIR/drawable/ic_launcher_background.xml"

# Adaptive icon foreground: wrap the Tauri-generated foreground PNG in an inset
# to add padding for Android's adaptive icon safe zone. Without this, the icon
# appears too zoomed in because Android clips adaptive icons to a ~66dp circle/
# squircle from the 108dp canvas. The 12dp inset shrinks the foreground to fit
# comfortably within the safe zone.
cat > "$RES_DIR/drawable/ic_launcher_foreground_inset.xml" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<inset xmlns:android="http://schemas.android.com/apk/res/android"
    android:drawable="@mipmap/ic_launcher_foreground"
    android:insetLeft="12dp"
    android:insetTop="12dp"
    android:insetRight="12dp"
    android:insetBottom="12dp" />
EOF

cat > "$RES_DIR/mipmap-anydpi-v26/ic_launcher.xml" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground_inset" />
</adaptive-icon>
EOF

# Monochrome icon: Lucide Music2 (double note) matching the actual Ferrotune icon
cat > "$RES_DIR/drawable/ic_launcher_monochrome.xml" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <!-- Lucide Music2: double note with stems, beam, and note heads -->
    <path
        android:fillColor="#00000000"
        android:strokeColor="#FF000000"
        android:strokeWidth="2"
        android:strokeLineCap="round"
        android:strokeLineJoin="round"
        android:pathData="M9,18L9,5 M21,16L21,3 M9,5l12,-2" />
    <path
        android:fillColor="#00000000"
        android:strokeColor="#FF000000"
        android:strokeWidth="2"
        android:strokeLineCap="round"
        android:strokeLineJoin="round"
        android:pathData="M6,18m-3,0a3,3 0,1 1,6 0a3,3 0,1 1,-6 0" />
    <path
        android:fillColor="#00000000"
        android:strokeColor="#FF000000"
        android:strokeWidth="2"
        android:strokeLineCap="round"
        android:strokeLineJoin="round"
        android:pathData="M18,16m-3,0a3,3 0,1 1,6 0a3,3 0,1 1,-6 0" />
</vector>
EOF

cat > "$RES_DIR/drawable/ic_launcher_monochrome_inset.xml" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<inset xmlns:android="http://schemas.android.com/apk/res/android"
    android:drawable="@drawable/ic_launcher_monochrome"
    android:insetLeft="18dp"
    android:insetTop="18dp"
    android:insetRight="18dp"
    android:insetBottom="18dp" />
EOF

cat > "$RES_DIR/mipmap-anydpi-v33/ic_launcher.xml" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground_inset" />
    <monochrome android:drawable="@drawable/ic_launcher_monochrome_inset" />
</adaptive-icon>
EOF

echo "Synced Android launcher icon resources with adaptive insets and monochrome layer."
