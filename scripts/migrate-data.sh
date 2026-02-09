#!/bin/bash
# Ferrotune Database Migration Script
# 
# This script migrates data from an old database (using migrations 001-011)
# to a new database with the consolidated schema.
#
# Usage:
#   ./migrate-data.sh <old_database.db> <new_database.db>
#
# Example:
#   ./migrate-data.sh /path/to/old/ferrotune.db /path/to/new/ferrotune.db
#
# IMPORTANT: 
# 1. Back up your old database before running this script
# 2. The new database should be freshly created by ferrotune (run the server once)
# 3. This script migrates all user data, preserving IDs and relationships

set -e

if [ $# -ne 2 ]; then
    echo "Usage: $0 <old_database.db> <new_database.db>"
    echo ""
    echo "Example: $0 ./old_ferrotune.db ./new_ferrotune.db"
    exit 1
fi

OLD_DB="$1"
NEW_DB="$2"

if [ ! -f "$OLD_DB" ]; then
    echo "Error: Old database file not found: $OLD_DB"
    exit 1
fi

if [ ! -f "$NEW_DB" ]; then
    echo "Error: New database file not found: $NEW_DB"
    echo "Please run ferrotune once to create a fresh database with the new schema."
    exit 1
fi

echo "=== Ferrotune Data Migration ==="
echo "Source: $OLD_DB"
echo "Target: $NEW_DB"
echo ""

# Create a temporary SQL file for the migration
TEMP_SQL=$(mktemp)
trap "rm -f $TEMP_SQL" EXIT

# We need to attach the old database and copy data table by table
cat > "$TEMP_SQL" << 'EOF'
-- Attach the old database
ATTACH DATABASE 'OLD_DB_PATH' AS old_db;

-- Disable foreign keys temporarily for the migration
PRAGMA foreign_keys = OFF;

-- Clear existing data in target tables (except _sqlx_migrations)
DELETE FROM users;
DELETE FROM api_keys;
DELETE FROM music_folders;
DELETE FROM artists;
DELETE FROM albums;
DELETE FROM songs;
DELETE FROM cover_art_thumbnails;
DELETE FROM starred;
DELETE FROM ratings;
DELETE FROM user_preferences;
DELETE FROM user_library_access;
DELETE FROM shuffle_excludes;
DELETE FROM playlist_folders;
DELETE FROM playlists;
DELETE FROM playlist_songs;
DELETE FROM playlist_shares;
DELETE FROM smart_playlists;
DELETE FROM play_queues;
DELETE FROM play_queue_entries;
DELETE FROM scrobbles;
DELETE FROM listening_sessions;
DELETE FROM tagger_sessions;
DELETE FROM tagger_session_tracks;
DELETE FROM tagger_pending_edits;
DELETE FROM tagger_scripts;
DELETE FROM server_config;

-- Also clear FTS tables
DELETE FROM songs_fts;
DELETE FROM artists_fts;
DELETE FROM albums_fts;

-- Migrate server_config
INSERT INTO server_config (key, value, updated_at)
SELECT key, value, updated_at FROM old_db.server_config;

-- Migrate users
INSERT INTO users (id, username, password_hash, subsonic_token, email, is_admin, created_at)
SELECT id, username, password_hash, subsonic_token, email, is_admin, created_at FROM old_db.users;

-- Migrate api_keys
INSERT INTO api_keys (token, user_id, name, created_at, last_used)
SELECT token, user_id, name, created_at, last_used FROM old_db.api_keys;

-- Migrate music_folders (watch_enabled added in migration 004)
INSERT INTO music_folders (id, name, path, enabled, watch_enabled, last_scanned_at, scan_error)
SELECT id, name, path, enabled, 
       COALESCE(watch_enabled, 0), 
       last_scanned_at, scan_error 
FROM old_db.music_folders;

-- Migrate artists (cover_art_hash added in migration 002)
-- Note: The artists_fts trigger will automatically populate artists_fts
INSERT INTO artists (id, name, sort_name, album_count, cover_art_hash)
SELECT id, name, sort_name, album_count, cover_art_hash FROM old_db.artists;

-- Migrate albums (cover_art_hash added in migration 002)
-- Note: The albums_fts trigger will automatically populate albums_fts
INSERT INTO albums (id, name, artist_id, year, genre, song_count, duration, cover_art_hash, created_at)
SELECT id, name, artist_id, year, genre, song_count, duration, cover_art_hash, created_at FROM old_db.albums;

-- Migrate songs (cover_art_hash from 002, marked_for_deletion_at from 010)
-- Note: The songs_fts trigger will automatically populate songs_fts
INSERT INTO songs (id, title, album_id, artist_id, music_folder_id, track_number, disc_number,
                   year, genre, duration, bitrate, file_path, file_size, file_format, file_mtime,
                   partial_hash, full_file_hash, cover_art_hash, marked_for_deletion_at,
                   created_at, updated_at)
SELECT id, title, album_id, artist_id, music_folder_id, track_number, disc_number,
       year, genre, duration, bitrate, file_path, file_size, file_format, file_mtime,
       partial_hash, full_file_hash, cover_art_hash, 
       CASE WHEN EXISTS(SELECT 1 FROM pragma_table_info('songs') WHERE name='marked_for_deletion_at')
            THEN marked_for_deletion_at ELSE NULL END,
       created_at, updated_at
FROM old_db.songs;

-- Migrate cover_art_thumbnails
INSERT INTO cover_art_thumbnails (hash, small, medium, updated_at)
SELECT hash, small, medium, updated_at FROM old_db.cover_art_thumbnails;

-- Migrate starred
INSERT INTO starred (user_id, item_type, item_id, starred_at)
SELECT user_id, item_type, item_id, starred_at FROM old_db.starred;

-- Migrate ratings
INSERT INTO ratings (user_id, item_type, item_id, rating, rated_at)
SELECT user_id, item_type, item_id, rating, rated_at FROM old_db.ratings;

-- Migrate user_preferences
INSERT INTO user_preferences (user_id, accent_color, custom_accent_hue, custom_accent_lightness,
                              custom_accent_chroma, preferences_json, updated_at)
SELECT user_id, accent_color, custom_accent_hue, custom_accent_lightness,
       custom_accent_chroma, preferences_json, updated_at FROM old_db.user_preferences;

-- Migrate user_library_access
INSERT INTO user_library_access (user_id, music_folder_id, created_at)
SELECT user_id, music_folder_id, created_at FROM old_db.user_library_access;

-- Migrate shuffle_excludes
INSERT INTO shuffle_excludes (id, user_id, song_id, created_at)
SELECT id, user_id, song_id, created_at FROM old_db.shuffle_excludes;

-- Migrate playlist_folders
INSERT INTO playlist_folders (id, name, parent_id, owner_id, position, created_at)
SELECT id, name, parent_id, owner_id, position, created_at FROM old_db.playlist_folders;

-- Migrate playlists
INSERT INTO playlists (id, name, comment, owner_id, folder_id, is_public, song_count, duration,
                       position, created_at, updated_at)
SELECT id, name, comment, owner_id, folder_id, is_public, song_count, duration,
       position, created_at, updated_at FROM old_db.playlists;

-- Migrate playlist_songs (added_at from 005, entry_id from 006, SET NULL behavior from 007)
INSERT INTO playlist_songs (playlist_id, song_id, position, missing_entry_data, missing_search_text, added_at, entry_id)
SELECT playlist_id, song_id, position, missing_entry_data, missing_search_text, added_at, entry_id 
FROM old_db.playlist_songs;

-- Migrate playlist_shares
INSERT INTO playlist_shares (playlist_id, shared_with_user_id, can_edit, created_at)
SELECT playlist_id, shared_with_user_id, can_edit, created_at FROM old_db.playlist_shares;

-- Migrate smart_playlists (from migration 004)
INSERT INTO smart_playlists (id, name, comment, owner_id, is_public, rules_json, sort_field,
                             sort_direction, max_songs, created_at, updated_at)
SELECT id, name, comment, owner_id, is_public, rules_json, sort_field,
       sort_direction, max_songs, created_at, updated_at FROM old_db.smart_playlists;

-- Migrate play_queues (total_count, is_lazy, song_ids_json from 011)
INSERT INTO play_queues (user_id, source_type, source_id, source_name, current_index, position_ms,
                         is_shuffled, shuffle_seed, shuffle_indices_json, repeat_mode, filters_json,
                         sort_json, total_count, is_lazy, song_ids_json, created_at, updated_at, changed_by)
SELECT user_id, source_type, source_id, source_name, current_index, position_ms,
       is_shuffled, shuffle_seed, shuffle_indices_json, repeat_mode, filters_json,
       sort_json, 
       COALESCE(total_count, NULL),
       COALESCE(is_lazy, 0),
       COALESCE(song_ids_json, NULL),
       created_at, updated_at, changed_by FROM old_db.play_queues;

-- Migrate play_queue_entries
INSERT INTO play_queue_entries (user_id, song_id, queue_position, entry_id)
SELECT user_id, song_id, queue_position, entry_id FROM old_db.play_queue_entries;

-- Migrate scrobbles (enhanced in migration 003)
INSERT INTO scrobbles (id, user_id, song_id, played_at, submission, play_count, description)
SELECT id, user_id, song_id, played_at, submission, 
       COALESCE(play_count, 1),
       description FROM old_db.scrobbles;

-- Migrate listening_sessions
INSERT INTO listening_sessions (id, user_id, song_id, duration_seconds, listened_at)
SELECT id, user_id, song_id, duration_seconds, listened_at FROM old_db.listening_sessions;

-- Migrate tagger_sessions (from migration 009)
INSERT INTO tagger_sessions (id, user_id, active_rename_script_id, active_tag_script_id, target_library_id,
                             visible_columns, column_widths, file_column_width, show_library_prefix,
                             show_computed_path, details_panel_open, dangerous_char_mode,
                             dangerous_char_replacement, created_at, updated_at)
SELECT id, user_id, active_rename_script_id, active_tag_script_id, target_library_id,
       visible_columns, column_widths, file_column_width, show_library_prefix,
       show_computed_path, details_panel_open, dangerous_char_mode,
       dangerous_char_replacement, created_at, updated_at FROM old_db.tagger_sessions;

-- Migrate tagger_session_tracks
INSERT INTO tagger_session_tracks (id, session_id, track_id, track_type, position)
SELECT id, session_id, track_id, track_type, position FROM old_db.tagger_session_tracks;

-- Migrate tagger_pending_edits
INSERT INTO tagger_pending_edits (id, session_id, track_id, track_type, edited_tags, computed_path,
                                  cover_art_removed, cover_art_filename, created_at, updated_at)
SELECT id, session_id, track_id, track_type, edited_tags, computed_path,
       cover_art_removed, cover_art_filename, created_at, updated_at FROM old_db.tagger_pending_edits;

-- Migrate tagger_scripts
INSERT INTO tagger_scripts (id, user_id, name, type, script, position, created_at, updated_at)
SELECT id, user_id, name, type, script, position, created_at, updated_at FROM old_db.tagger_scripts;

-- Re-enable foreign keys
PRAGMA foreign_keys = ON;

-- Detach old database
DETACH DATABASE old_db;

-- Verify integrity
PRAGMA integrity_check;
EOF

# Replace the placeholder with actual path
sed -i "s|OLD_DB_PATH|$OLD_DB|g" "$TEMP_SQL"

echo "Running migration..."
sqlite3 "$NEW_DB" < "$TEMP_SQL"

echo ""
echo "=== Migration Complete ==="
echo ""
echo "Verifying row counts..."
echo ""

# Show row counts for verification
sqlite3 "$OLD_DB" "SELECT 'Old DB - users: ' || COUNT(*) FROM users;"
sqlite3 "$NEW_DB" "SELECT 'New DB - users: ' || COUNT(*) FROM users;"
sqlite3 "$OLD_DB" "SELECT 'Old DB - songs: ' || COUNT(*) FROM songs;"
sqlite3 "$NEW_DB" "SELECT 'New DB - songs: ' || COUNT(*) FROM songs;"
sqlite3 "$OLD_DB" "SELECT 'Old DB - playlists: ' || COUNT(*) FROM playlists;"
sqlite3 "$NEW_DB" "SELECT 'New DB - playlists: ' || COUNT(*) FROM playlists;"
sqlite3 "$OLD_DB" "SELECT 'Old DB - playlist_songs: ' || COUNT(*) FROM playlist_songs;"
sqlite3 "$NEW_DB" "SELECT 'New DB - playlist_songs: ' || COUNT(*) FROM playlist_songs;"
sqlite3 "$OLD_DB" "SELECT 'Old DB - scrobbles: ' || COUNT(*) FROM scrobbles;"
sqlite3 "$NEW_DB" "SELECT 'New DB - scrobbles: ' || COUNT(*) FROM scrobbles;"

echo ""
echo "Migration complete! You can now use the new database with ferrotune."
echo ""
echo "To use the migrated database in production:"
echo "1. Stop the ferrotune server"
echo "2. Replace the old database with the new one"
echo "3. Start the ferrotune server"
