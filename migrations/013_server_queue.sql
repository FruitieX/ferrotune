-- Server-side playback queue management
-- Refactors queue to be server-authoritative with shuffle state, source tracking, and pagination support

-- Drop existing tables (they will be recreated with new schema)
DROP TABLE IF EXISTS play_queue_entries;
DROP TABLE IF EXISTS play_queues;

-- Main queue metadata table - one queue per user
CREATE TABLE IF NOT EXISTS play_queues (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    
    -- Queue source information (where the queue came from)
    source_type TEXT NOT NULL DEFAULT 'other',  -- library, album, artist, playlist, genre, search, favorites, history, other
    source_id TEXT,  -- ID of the source (album ID, artist ID, playlist ID, etc.)
    source_name TEXT,  -- Display name of the source
    
    -- Current playback position
    current_index INTEGER NOT NULL DEFAULT 0,  -- Current position in queue (0-based)
    position_ms INTEGER NOT NULL DEFAULT 0,  -- Playback position in milliseconds within current song
    
    -- Shuffle state
    is_shuffled INTEGER NOT NULL DEFAULT 0,  -- Boolean: is shuffle enabled
    shuffle_seed INTEGER,  -- Seed for reproducible shuffle
    shuffle_indices_json TEXT,  -- JSON array of shuffled indices, e.g., [3, 0, 2, 1]
    
    -- Repeat mode
    repeat_mode TEXT NOT NULL DEFAULT 'off',  -- off, all, one
    
    -- Filters and sorting (for queue regeneration if needed)
    filters_json TEXT,  -- JSON object with filter criteria
    sort_json TEXT,  -- JSON object with sort criteria
    
    -- Timestamps
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    changed_by TEXT NOT NULL DEFAULT 'ferrotune-web'
);

-- Queue entries - the materialized song list
CREATE TABLE IF NOT EXISTS play_queue_entries (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    queue_position INTEGER NOT NULL,  -- Position in the original (unshuffled) queue
    PRIMARY KEY (user_id, queue_position)
);

-- Index for efficient queue entry lookups
CREATE INDEX IF NOT EXISTS idx_play_queue_entries_user ON play_queue_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_play_queue_entries_song ON play_queue_entries(song_id);
