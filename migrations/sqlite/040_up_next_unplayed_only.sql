-- Up next now holds only songs that haven't played yet. A song that starts
-- playing moves into play_queue_entries and becomes ordinary queue history,
-- so played-row anchors and the "current up-next entry" cursor go away.
DELETE FROM play_queue_up_next WHERE anchor_context_index IS NOT NULL;
DROP INDEX IF EXISTS idx_play_queue_up_next_anchor;
ALTER TABLE play_queue_up_next DROP COLUMN anchor_context_index;
ALTER TABLE play_queues DROP COLUMN current_manual_entry_id;
