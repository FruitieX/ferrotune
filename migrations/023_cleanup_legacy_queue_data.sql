-- Remove legacy queue data that was created without a session_id.
-- All queue operations now require a session_id; rows with session_id = ''
-- are orphaned remnants of the pre-session era.

DELETE FROM play_queue_entries WHERE session_id = '';
DELETE FROM play_queues WHERE session_id = '';
