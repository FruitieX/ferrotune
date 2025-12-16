-- Add added_at column to playlist_songs to track when songs were added to playlists
-- Backfill existing entries with the playlist's created_at timestamp for better UX

-- Add the column with a temporary default
ALTER TABLE playlist_songs ADD COLUMN added_at TIMESTAMP;

-- Backfill existing entries with the playlist's created_at
UPDATE playlist_songs 
SET added_at = (
    SELECT created_at FROM playlists WHERE playlists.id = playlist_songs.playlist_id
)
WHERE added_at IS NULL;

-- For any entries where playlist doesn't exist (shouldn't happen), use current timestamp
UPDATE playlist_songs 
SET added_at = CURRENT_TIMESTAMP 
WHERE added_at IS NULL;
