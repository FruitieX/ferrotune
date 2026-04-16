CREATE TABLE playback_sessions (
    id TEXT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    client_name TEXT NOT NULL DEFAULT 'ferrotune-web',
    is_playing BOOLEAN NOT NULL DEFAULT FALSE,
    current_song_id TEXT,
    current_song_title TEXT,
    current_song_artist TEXT,
    last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    owner_client_id TEXT,
    owner_client_name TEXT NOT NULL DEFAULT 'ferrotune-web',
    last_playing_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_playback_sessions_user_id_unique ON playback_sessions(user_id);
CREATE INDEX idx_playback_sessions_heartbeat ON playback_sessions(last_heartbeat);

CREATE TABLE play_queues (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL DEFAULT 'other',
    source_id TEXT,
    source_name TEXT,
    current_index BIGINT NOT NULL DEFAULT 0,
    position_ms BIGINT NOT NULL DEFAULT 0,
    is_shuffled BOOLEAN NOT NULL DEFAULT FALSE,
    shuffle_seed BIGINT,
    shuffle_indices_json TEXT,
    repeat_mode TEXT NOT NULL DEFAULT 'off',
    filters_json TEXT,
    sort_json TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    changed_by TEXT NOT NULL DEFAULT 'ferrotune-web',
    total_count BIGINT,
    is_lazy BOOLEAN NOT NULL DEFAULT FALSE,
    song_ids_json TEXT,
    instance_id TEXT,
    session_id TEXT NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    source_api TEXT NOT NULL DEFAULT 'ferrotune',
    PRIMARY KEY (user_id, session_id)
);

CREATE INDEX idx_play_queues_session_id ON play_queues(session_id);

CREATE TABLE play_queue_entries (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    queue_position BIGINT NOT NULL,
    entry_id TEXT NOT NULL DEFAULT '',
    source_entry_id TEXT,
    session_id TEXT NOT NULL,
    PRIMARY KEY (user_id, session_id, queue_position)
);

CREATE INDEX idx_play_queue_entries_user ON play_queue_entries(user_id);
CREATE INDEX idx_play_queue_entries_song ON play_queue_entries(song_id);
CREATE INDEX idx_play_queue_entries_entry_id ON play_queue_entries(user_id, entry_id);
CREATE INDEX idx_play_queue_entries_session_id ON play_queue_entries(session_id);
CREATE INDEX idx_play_queue_entries_session_pos ON play_queue_entries(session_id, queue_position);