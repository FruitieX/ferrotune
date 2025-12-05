-- Add unique entry_id to queue entries for stable React keys
-- This allows the same song to appear multiple times in the queue

ALTER TABLE play_queue_entries ADD COLUMN entry_id TEXT NOT NULL DEFAULT '';

-- Populate existing entries with UUIDs
UPDATE play_queue_entries SET entry_id = lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)));

-- Create index for fast lookups by entry_id
CREATE INDEX IF NOT EXISTS idx_play_queue_entries_entry_id ON play_queue_entries(user_id, entry_id);
