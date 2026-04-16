-- Add source_api column to play_queues to distinguish which API created the queue.
-- 'ferrotune' = live session queue system, 'subsonic' = OpenSubsonic save/restore playqueue API.
ALTER TABLE play_queues ADD COLUMN source_api TEXT NOT NULL DEFAULT 'ferrotune';

-- Tag existing playqueue-* queues as subsonic-originated
UPDATE play_queues SET source_api = 'subsonic' WHERE session_id LIKE 'playqueue-%';
