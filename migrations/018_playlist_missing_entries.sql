-- Support for missing/unmatched entries in playlists
-- When a playlist is imported and some tracks cannot be matched,
-- we can store the original entry info and display them as "missing"

-- Make song_id nullable to allow missing entries
-- Add missing_entry_data to store original playlist entry info as JSON
-- The JSON contains: title, artist, album, duration, raw (original line)

-- First, create a new table with the updated schema
CREATE TABLE playlist_songs_new (
    playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    song_id TEXT REFERENCES songs(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    -- JSON data for missing/unmatched entries: { title, artist, album, duration, raw }
    missing_entry_data TEXT,
    PRIMARY KEY (playlist_id, position),
    -- Ensure either song_id OR missing_entry_data is set (or both for matched entries we want to track)
    CHECK (song_id IS NOT NULL OR missing_entry_data IS NOT NULL)
);

-- Copy existing data
INSERT INTO playlist_songs_new (playlist_id, song_id, position)
SELECT playlist_id, song_id, position FROM playlist_songs;

-- Drop old table and rename new one
DROP TABLE playlist_songs;
ALTER TABLE playlist_songs_new RENAME TO playlist_songs;

-- Recreate index
CREATE INDEX IF NOT EXISTS idx_playlist_songs_song ON playlist_songs(song_id);
