-- Add search_text column for missing entry filtering
-- This is a denormalized column that allows filtering missing entries
-- without JSON parsing (SQLite doesn't support native JSON queries)

-- We need to recreate the table to add the new column with proper constraints
CREATE TABLE playlist_songs_new (
    playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    song_id TEXT REFERENCES songs(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    -- JSON data for missing/unmatched entries: { title, artist, album, duration, raw }
    missing_entry_data TEXT,
    -- Denormalized search text from missing_entry_data for filtering
    -- Contains: "artist - album - title" or raw field if no structured data
    missing_search_text TEXT,
    PRIMARY KEY (playlist_id, position),
    -- Ensure either song_id OR missing_entry_data is set
    CHECK (song_id IS NOT NULL OR missing_entry_data IS NOT NULL)
);

-- Copy existing data
INSERT INTO playlist_songs_new (playlist_id, song_id, position, missing_entry_data)
SELECT playlist_id, song_id, position, missing_entry_data FROM playlist_songs;

-- Drop old table and rename new one
DROP TABLE playlist_songs;
ALTER TABLE playlist_songs_new RENAME TO playlist_songs;

-- Recreate index for song_id
CREATE INDEX IF NOT EXISTS idx_playlist_songs_song ON playlist_songs(song_id);
