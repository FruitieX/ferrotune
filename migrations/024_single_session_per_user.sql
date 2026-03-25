-- Migrate from multi-session to single-session-per-user model.
-- Each user now has exactly one persistent session (never deleted).
-- Multiple clients connect to the same session; ownership is tracked via owner_client_id.

-- Step 1: Add new owner tracking columns
ALTER TABLE playback_sessions ADD COLUMN owner_client_id TEXT;
ALTER TABLE playback_sessions ADD COLUMN owner_client_name TEXT NOT NULL DEFAULT 'ferrotune-web';

-- Step 2: Deduplicate — keep only the most recent session per user.
-- First, migrate queue data from sessions that will be deleted.
-- For each user, keep the session with the latest last_heartbeat.

-- Clean up orphaned queue entries whose session no longer exists
DELETE FROM play_queue_entries
WHERE session_id != '' AND session_id NOT IN (SELECT id FROM playback_sessions);

-- Clean up orphaned queues whose session no longer exists
DELETE FROM play_queues
WHERE session_id NOT IN (SELECT id FROM playback_sessions);

-- Move queue entries from duplicate sessions to the kept session
UPDATE play_queue_entries
SET session_id = (
    SELECT ps_keep.id
    FROM playback_sessions ps_keep
    WHERE ps_keep.user_id = (
        SELECT user_id FROM playback_sessions WHERE id = play_queue_entries.session_id
    )
    ORDER BY ps_keep.last_heartbeat DESC
    LIMIT 1
)
WHERE session_id NOT IN (
    SELECT kept.id FROM (
        SELECT id, user_id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY last_heartbeat DESC) AS rn
        FROM playback_sessions
    ) kept
    WHERE kept.rn = 1
)
AND session_id IN (SELECT id FROM playback_sessions);

-- Move queues from duplicate sessions to the kept session
UPDATE play_queues
SET session_id = (
    SELECT ps_keep.id
    FROM playback_sessions ps_keep
    WHERE ps_keep.user_id = (
        SELECT user_id FROM playback_sessions WHERE id = play_queues.session_id
    )
    ORDER BY ps_keep.last_heartbeat DESC
    LIMIT 1
)
WHERE session_id NOT IN (
    SELECT kept.id FROM (
        SELECT id, user_id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY last_heartbeat DESC) AS rn
        FROM playback_sessions
    ) kept
    WHERE kept.rn = 1
)
AND session_id IN (SELECT id FROM playback_sessions);

-- Delete duplicate sessions (keeps only the most recent per user)
DELETE FROM playback_sessions
WHERE id NOT IN (
    SELECT kept.id FROM (
        SELECT id, user_id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY last_heartbeat DESC) AS rn
        FROM playback_sessions
    ) kept
    WHERE kept.rn = 1
);

-- Step 3: Copy client_name to owner_client_name for existing sessions
UPDATE playback_sessions SET owner_client_name = client_name;

-- Step 4: Add unique index to enforce one session per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_playback_sessions_user_id_unique ON playback_sessions(user_id);
