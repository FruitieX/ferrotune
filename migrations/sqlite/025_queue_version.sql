-- Add version column to play_queues for optimistic concurrency control.
-- Each mutation increments the version; concurrent modifications can be
-- detected and safely serialized.
ALTER TABLE play_queues ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
