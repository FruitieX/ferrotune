-- Add last_playing_at column to track when the owner last had active playback.
-- Used by the inactivity auto-disown mechanism: if the owner hasn't been playing
-- for 5 minutes, ownership is cleared so the next client to start playback
-- becomes the owner automatically.
ALTER TABLE playback_sessions ADD COLUMN last_playing_at TIMESTAMP;
