CREATE TABLE listening_sessions (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    duration_seconds INTEGER NOT NULL,
    listened_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    skipped BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_listening_sessions_user_time ON listening_sessions(user_id, listened_at);
CREATE INDEX idx_listening_sessions_song ON listening_sessions(song_id);