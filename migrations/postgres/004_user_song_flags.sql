CREATE TABLE disabled_songs (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, song_id)
);

CREATE INDEX idx_disabled_songs_user_id ON disabled_songs(user_id);
CREATE INDEX idx_disabled_songs_song_id ON disabled_songs(song_id);

CREATE TABLE shuffle_excludes (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, song_id)
);

CREATE INDEX idx_shuffle_excludes_user_song ON shuffle_excludes(user_id, song_id);