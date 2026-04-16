-- Add queue source tracking to scrobbles so we can distinguish
-- playback sources (e.g., album vs playlist) in queries like "continue listening"
ALTER TABLE scrobbles ADD COLUMN queue_source_type TEXT;
ALTER TABLE scrobbles ADD COLUMN queue_source_id TEXT;
