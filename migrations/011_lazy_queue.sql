-- Support lazy queue materialization for large queues
-- Instead of storing all song IDs upfront, we can materialize pages on-demand

-- Add total_count column to store expected count without materializing all songs
ALTER TABLE play_queues ADD COLUMN total_count INTEGER DEFAULT NULL;

-- Add flag to indicate this queue uses lazy materialization (entries are computed, not stored)
ALTER TABLE play_queues ADD COLUMN is_lazy INTEGER NOT NULL DEFAULT 0;

-- Add song_ids_json for explicit song ID queues (history, custom queues)
-- Only used when is_lazy=0 and entries can't be reconstructed from source
ALTER TABLE play_queues ADD COLUMN song_ids_json TEXT DEFAULT NULL;
