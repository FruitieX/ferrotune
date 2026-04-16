-- Add source_entry_id to play_queue_entries
-- This stores the original playlist entry_id when a queue is materialized from a playlist,
-- allowing stable "now playing" tracking even when the playlist is reordered.
ALTER TABLE play_queue_entries ADD COLUMN source_entry_id TEXT;
