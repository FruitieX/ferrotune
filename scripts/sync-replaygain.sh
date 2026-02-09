#!/bin/bash
# Sync computed ReplayGain values from dev database to production database
# Matches songs by file_path using ATTACH DATABASE for robust handling

set -euo pipefail

DEV_DB="${DEV_DB:-$HOME/.local/share/ferrotune/ferrotune.db}"
PROD_DB="${PROD_DB:-/mnt/h/ferrotune-data/ferrotune.db}"

# Use -init /dev/null to skip .sqliterc
sqlite() {
    command sqlite3 -init /dev/null -batch "$@"
}

if [[ ! -f "$DEV_DB" ]]; then
    echo "Error: Dev database not found at $DEV_DB"
    exit 1
fi

if [[ ! -f "$PROD_DB" ]]; then
    echo "Error: Prod database not found at $PROD_DB"
    exit 1
fi

echo "Dev database: $DEV_DB"
echo "Prod database: $PROD_DB"

# Count songs with ReplayGain data in dev
dev_count=$(sqlite "$DEV_DB" "SELECT COUNT(*) FROM songs WHERE computed_replaygain_track_gain IS NOT NULL")
echo "Songs with computed ReplayGain in dev: $dev_count"

# Create a backup of prod database
backup_file="${PROD_DB}.backup.$(date +%Y%m%d_%H%M%S)"
echo "Creating backup at $backup_file..."
cp "$PROD_DB" "$backup_file"

# Update prod database by attaching dev database directly
echo "Syncing ReplayGain data to prod database..."

sqlite "$PROD_DB" <<EOF
ATTACH DATABASE '$DEV_DB' AS dev;

UPDATE songs
SET 
    computed_replaygain_track_gain = dev_songs.computed_replaygain_track_gain,
    computed_replaygain_track_peak = dev_songs.computed_replaygain_track_peak
FROM dev.songs AS dev_songs
WHERE songs.file_path = dev_songs.file_path
  AND dev_songs.computed_replaygain_track_gain IS NOT NULL;

SELECT 'Updated ' || changes() || ' songs';

DETACH DATABASE dev;
EOF

# Verify
prod_count=$(sqlite "$PROD_DB" "SELECT COUNT(*) FROM songs WHERE computed_replaygain_track_gain IS NOT NULL")
echo "Songs with computed ReplayGain in prod after sync: $prod_count"

echo "Done! Backup saved at: $backup_file"
