-- Add entry_id column to playlist_songs for stable entry identification
-- This allows us to refer to playlist entries reliably even after reordering

-- Add entry_id column (UUID stored as TEXT)
ALTER TABLE playlist_songs ADD COLUMN entry_id TEXT;

-- Backfill existing entries with generated UUIDs
-- SQLite doesn't have built-in UUID function, so generate a random hex string
UPDATE playlist_songs 
SET entry_id = lower(
    hex(randomblob(4)) || '-' ||
    hex(randomblob(2)) || '-4' ||
    substr(hex(randomblob(2)), 2) || '-' ||
    substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' ||
    hex(randomblob(6))
)
WHERE entry_id IS NULL;

-- Create index for lookups by entry_id within a playlist
CREATE INDEX IF NOT EXISTS idx_playlist_songs_entry_id ON playlist_songs(playlist_id, entry_id);
