-- Add instance_id column to play_queues for unique queue identification
-- This is a UUID generated on each queue start, used to detect queue changes
ALTER TABLE play_queues ADD COLUMN instance_id TEXT;
