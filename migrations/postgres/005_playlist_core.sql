CREATE TABLE playlist_folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id TEXT REFERENCES playlist_folders(id) ON DELETE CASCADE,
    owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    position BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    cover_art BYTEA
);

CREATE INDEX idx_playlist_folders_owner ON playlist_folders(owner_id);
CREATE INDEX idx_playlist_folders_parent ON playlist_folders(parent_id);

CREATE TABLE playlists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    comment TEXT,
    owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    folder_id TEXT REFERENCES playlist_folders(id) ON DELETE SET NULL,
    is_public BOOLEAN NOT NULL DEFAULT FALSE,
    song_count BIGINT NOT NULL DEFAULT 0,
    duration BIGINT NOT NULL DEFAULT 0,
    position BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_played_at TIMESTAMPTZ
);

CREATE INDEX idx_playlists_owner ON playlists(owner_id);
CREATE INDEX idx_playlists_folder ON playlists(folder_id);
CREATE INDEX idx_playlists_last_played ON playlists(last_played_at);

CREATE TABLE playlist_songs (
    playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    song_id TEXT REFERENCES songs(id) ON DELETE SET NULL,
    position BIGINT NOT NULL,
    missing_entry_data TEXT,
    missing_search_text TEXT,
    added_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    entry_id TEXT,
    PRIMARY KEY (playlist_id, position),
    CHECK (song_id IS NOT NULL OR missing_entry_data IS NOT NULL)
);

CREATE INDEX idx_playlist_songs_song ON playlist_songs(song_id);
CREATE INDEX idx_playlist_songs_entry_id ON playlist_songs(playlist_id, entry_id);

CREATE TABLE playlist_shares (
    playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    shared_with_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    can_edit BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (playlist_id, shared_with_user_id)
);

CREATE INDEX idx_playlist_shares_playlist ON playlist_shares(playlist_id);
CREATE INDEX idx_playlist_shares_user ON playlist_shares(shared_with_user_id);

CREATE TABLE user_playlist_overrides (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    folder_id TEXT REFERENCES playlist_folders(id) ON DELETE SET NULL,
    PRIMARY KEY (user_id, playlist_id)
);

CREATE INDEX idx_user_playlist_overrides_user ON user_playlist_overrides(user_id);