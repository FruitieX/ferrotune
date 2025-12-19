-- Migration: Change playlist_songs.song_id foreign key from CASCADE to SET NULL
-- 
-- This allows songs to be deleted without removing the playlist entry.
-- Instead, the song_id becomes NULL, and missing_entry_data contains the
-- song's metadata for potential re-matching later.
--
-- SQLite doesn't support altering foreign key constraints, so we must
-- recreate the table with the new constraint.

-- Disable foreign key checks temporarily for the migration
PRAGMA foreign_keys = OFF;

-- Create new table with the correct foreign key behavior
CREATE TABLE playlist_songs_new (
    playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    song_id TEXT REFERENCES songs(id) ON DELETE SET NULL,
    position INTEGER NOT NULL,
    missing_entry_data TEXT,
    missing_search_text TEXT,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    entry_id TEXT,
    PRIMARY KEY (playlist_id, position),
    CHECK (song_id IS NOT NULL OR missing_entry_data IS NOT NULL)
);

-- Copy existing data
INSERT INTO playlist_songs_new (playlist_id, song_id, position, missing_entry_data, missing_search_text, added_at, entry_id)
SELECT playlist_id, song_id, position, missing_entry_data, missing_search_text, added_at, entry_id
FROM playlist_songs;

-- Drop old table
DROP TABLE playlist_songs;

-- Rename new table
ALTER TABLE playlist_songs_new RENAME TO playlist_songs;

-- Recreate the index
CREATE INDEX IF NOT EXISTS idx_playlist_songs_song ON playlist_songs(song_id);

-- Recreate the entry_id index (from migration 006)
CREATE INDEX IF NOT EXISTS idx_playlist_songs_entry_id ON playlist_songs(playlist_id, entry_id);

-- Re-enable foreign key checks
PRAGMA foreign_keys = ON;
