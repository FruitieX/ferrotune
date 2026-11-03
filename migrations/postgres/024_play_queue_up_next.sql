-- Up-next queue: songs explicitly queued by the user ("Play next" / "Add to
-- queue"). The playback context (playlists, albums, library, ...) stays in
-- play_queues/play_queue_entries and is never rewritten by queue actions.
--
-- `anchor_context_index` is NULL while a row is still upcoming. When the row
-- starts playing it is anchored to the context index it played under, so the
-- merged queue view can keep it in history between that context track and the
-- next one.
ALTER TABLE play_queues ADD COLUMN current_manual_entry_id TEXT;

CREATE TABLE IF NOT EXISTS play_queue_up_next (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES playback_sessions(id) ON DELETE CASCADE,
    entry_id TEXT NOT NULL,
    song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    sequence BIGINT NOT NULL,
    anchor_context_index BIGINT,
    PRIMARY KEY (session_id, entry_id)
);

CREATE INDEX IF NOT EXISTS idx_play_queue_up_next_session
    ON play_queue_up_next(session_id, sequence);
CREATE INDEX IF NOT EXISTS idx_play_queue_up_next_anchor
    ON play_queue_up_next(session_id, anchor_context_index);
