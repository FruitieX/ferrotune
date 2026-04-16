-- Match dictionary table for storing user-confirmed track matches
-- These matches can be reused across all import types (playlists, favorites, play counts)

CREATE TABLE IF NOT EXISTS match_dictionary (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Normalized lookup key (lowercase, no punctuation)
    lookup_key TEXT NOT NULL,
    -- Original import data for reference
    original_title TEXT,
    original_artist TEXT,
    original_album TEXT,
    original_duration_ms INTEGER,
    -- The matched song
    song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    -- When this match was created/updated
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Each user can only have one match per lookup key
    UNIQUE(user_id, lookup_key)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_match_dictionary_user_key ON match_dictionary(user_id, lookup_key);
