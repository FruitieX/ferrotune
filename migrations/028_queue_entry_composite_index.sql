-- Add composite index for common queue entry lookups
-- Covers WHERE session_id = ? ORDER BY queue_position queries
CREATE INDEX IF NOT EXISTS idx_play_queue_entries_session_pos
    ON play_queue_entries(session_id, queue_position);
