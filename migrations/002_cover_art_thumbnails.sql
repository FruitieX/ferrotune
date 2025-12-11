-- 002: Cover Art Thumbnails (Hash-based deduplication)
-- Replaces previous album_thumbnails implementation

CREATE TABLE cover_art_thumbnails (
    hash TEXT PRIMARY KEY,
    small BLOB NOT NULL,
    medium BLOB NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_cover_art_thumbnails_updated ON cover_art_thumbnails(updated_at);

-- Add cover_art_hash column to entities
ALTER TABLE songs ADD COLUMN cover_art_hash TEXT;
ALTER TABLE albums ADD COLUMN cover_art_hash TEXT;
ALTER TABLE artists ADD COLUMN cover_art_hash TEXT;

-- Index for lookups
CREATE INDEX idx_songs_cover_art ON songs(cover_art_hash) WHERE cover_art_hash IS NOT NULL;
