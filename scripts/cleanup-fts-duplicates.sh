#!/bin/bash
# Cleanup duplicate entries in FTS tables
#
# This script removes duplicate entries from the FTS (Full Text Search) tables
# that may have been created by the migration script.
#
# Usage:
#   ./cleanup-fts-duplicates.sh [database_path]
#
# If no database path is provided, defaults to ~/.local/share/ferrotune/ferrotune.db

set -e

DB_PATH="${1:-$HOME/.local/share/ferrotune/ferrotune.db}"

if [ ! -f "$DB_PATH" ]; then
    echo "Error: Database file not found: $DB_PATH"
    exit 1
fi

echo "=== FTS Duplicate Cleanup ==="
echo "Database: $DB_PATH"
echo ""

# Show current state
echo "Current FTS table counts:"
sqlite3 "$DB_PATH" "SELECT 'songs_fts: ' || COUNT(*) || ' rows, ' || COUNT(DISTINCT song_id) || ' unique' FROM songs_fts;"
sqlite3 "$DB_PATH" "SELECT 'albums_fts: ' || COUNT(*) || ' rows, ' || COUNT(DISTINCT album_id) || ' unique' FROM albums_fts;"
sqlite3 "$DB_PATH" "SELECT 'artists_fts: ' || COUNT(*) || ' rows, ' || COUNT(DISTINCT artist_id) || ' unique' FROM artists_fts;"
echo ""

# Create backup
BACKUP_PATH="${DB_PATH}.bak.$(date +%Y%m%d_%H%M%S)"
echo "Creating backup: $BACKUP_PATH"
cp "$DB_PATH" "$BACKUP_PATH"
echo ""

echo "Cleaning up duplicates..."

# The FTS5 tables don't have a rowid we can easily use for deduplication,
# so we need to rebuild them from scratch using the source tables.
sqlite3 "$DB_PATH" <<'EOF'
-- Rebuild songs_fts from songs table
DELETE FROM songs_fts;
INSERT INTO songs_fts (song_id, title, artist_name, album_name)
SELECT 
    s.id,
    s.title,
    (SELECT name FROM artists WHERE id = s.artist_id),
    COALESCE((SELECT name FROM albums WHERE id = s.album_id), '')
FROM songs s;

-- Rebuild albums_fts from albums table
DELETE FROM albums_fts;
INSERT INTO albums_fts (album_id, name, artist_name)
SELECT a.id, a.name, (SELECT name FROM artists WHERE id = a.artist_id)
FROM albums a;

-- Rebuild artists_fts from artists table
DELETE FROM artists_fts;
INSERT INTO artists_fts (artist_id, name, sort_name)
SELECT id, name, COALESCE(sort_name, name)
FROM artists;
EOF

echo ""
echo "After cleanup:"
sqlite3 "$DB_PATH" "SELECT 'songs_fts: ' || COUNT(*) || ' rows, ' || COUNT(DISTINCT song_id) || ' unique' FROM songs_fts;"
sqlite3 "$DB_PATH" "SELECT 'albums_fts: ' || COUNT(*) || ' rows, ' || COUNT(DISTINCT album_id) || ' unique' FROM albums_fts;"
sqlite3 "$DB_PATH" "SELECT 'artists_fts: ' || COUNT(*) || ' rows, ' || COUNT(DISTINCT artist_id) || ' unique' FROM artists_fts;"
echo ""
echo "Cleanup complete!"
echo "Backup saved to: $BACKUP_PATH"
