-- Add last_played_at column to playlists and smart_playlists tables
-- This tracks when each playlist was last started for playback,
-- enabling "Continue Listening" and "Recently Played" features on the home page.

ALTER TABLE playlists ADD COLUMN last_played_at TIMESTAMP;
ALTER TABLE smart_playlists ADD COLUMN last_played_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_playlists_last_played ON playlists(last_played_at);
CREATE INDEX IF NOT EXISTS idx_smart_playlists_last_played ON smart_playlists(last_played_at);
