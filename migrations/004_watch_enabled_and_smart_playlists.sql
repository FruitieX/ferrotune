-- Migration: Add watch_enabled to music_folders and smart_playlists table
-- Created: 2024-12-14

-- Add watch_enabled column to music_folders for auto-scan on file changes
ALTER TABLE music_folders ADD COLUMN watch_enabled BOOLEAN NOT NULL DEFAULT 0;

-- Smart playlists - dynamic playlists based on filter rules
CREATE TABLE IF NOT EXISTS smart_playlists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    comment TEXT,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_public BOOLEAN NOT NULL DEFAULT 0,
    -- JSON object with filter rules. Example:
    -- {
    --   "conditions": [
    --     { "field": "year", "operator": "gte", "value": 2020 },
    --     { "field": "playCount", "operator": "gte", "value": 5 }
    --   ],
    --   "logic": "and"
    -- }
    rules_json TEXT NOT NULL,
    sort_field TEXT,           -- Sort field: 'playCount', 'lastPlayed', 'dateAdded', 'title', 'year', etc.
    sort_direction TEXT DEFAULT 'desc',
    max_songs INTEGER,         -- Optional limit on number of songs
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_smart_playlists_owner ON smart_playlists(owner_id);
