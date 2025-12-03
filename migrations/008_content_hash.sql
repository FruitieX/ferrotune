-- Two-phase duplicate detection: partial hash (always computed) and full hash (collision candidates only)

-- Add hash columns to songs table
ALTER TABLE songs ADD COLUMN partial_hash TEXT;
ALTER TABLE songs ADD COLUMN full_file_hash TEXT;

-- Index on full_file_hash for efficient duplicate queries
-- Only non-null values are indexed, which are the collision candidates
CREATE INDEX IF NOT EXISTS idx_songs_full_hash ON songs(full_file_hash) WHERE full_file_hash IS NOT NULL;

-- Index on partial_hash for finding collisions during scan
CREATE INDEX IF NOT EXISTS idx_songs_partial_hash ON songs(partial_hash) WHERE partial_hash IS NOT NULL;
